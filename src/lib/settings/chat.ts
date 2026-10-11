/**
 * 星绥通讯持久化（IndexedDB）。
 *
 * 会话按「角色 × 面具」归档：换面具＝换身份重新聊，
 * 每个面具对每个角色各有一份独立的聊天记录与每聊天设定。
 *
 * 数据分两处放：
 * - chat-conversations（kv 库）—— 会话**元数据**阵列（每聊天设定／动态／签名……），
 *   **不含消息**。1.12.54 起消息已挪走，这里只留骨架。
 * - messages（独立仓库）—— 聊天消息，**一条一行**（keyPath = id）＋ `byConv` 索引。
 *   为什么拆：从前把全部消息塞在会话阵列里整份存一个键，每发一条都要「读全量 → 改 →
 *   写全量」（O(全部消息)），聊得越多越卡；拆开后发一条＝只写这一行（O(1)）。
 *   每条消息落库时盖上 `convId`（属于哪个会话）与 `seq`（会话内单调序号，读时按它排）。
 * - chat-character-settings —— 角色级的三样（个别 API／语音参数／生图参考图），跟角色走
 * - api-settings-bundle —— 三类 API 设定（文本／图文／语音，各自独立）
 *   （旧版单份 chat-api-settings 读取时自动迁移为「文本 API」）
 */

import {
  kvGet,
  kvSet,
  msgDelete,
  msgDeleteByConv,
  msgGet,
  msgGetAll,
  msgGetByConv,
  msgPut,
  msgPutAll,
  type MessageRow,
} from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { DEFAULT_MASK_ID, ensureMasks } from "@/lib/settings/mask";
import { getArchives, saveArchive } from "@/lib/settings/contact";
import {
  DEFAULT_API_SETTINGS,
  DEFAULT_IMAGE_EXTRAS,
  DEFAULT_VOICE_EXTRAS,
  type ApiCategory,
  type ApiPresetEntry,
  type ApiSettingsBundle,
  type ChatApiSettings,
  type ChatMessage,
  type Conversation,
  type ImageApiExtras,
  type MomentComment,
  type MomentLike,
  type MomentVisibility,
  type OfflineEntry,
  type OfflineScene,
  type SelfMoment,
  type VoiceApiExtras,
} from "@/types/chat";

const CONVERSATIONS_KEY = "chat-conversations";
const CHAR_SETTINGS_KEY = "chat-character-settings";
const API_SETTINGS_KEY = "chat-api-settings";

/** 会话 id ＝「角色id::面具id」（仅作唯一标识，查找一律走 characterId＋maskId）。
 *  导出给「自动生图」用：聊天那边画完动态配图要按会话 id 回写（见 generateMomentImage）。 */
export function convId(characterId: string, maskId: string): string {
  return `${characterId}::${maskId}`;
}

/** 旧资料补齐 maskId：没有面具概念的旧会话全部归默认面具。 */
function normalizeConv(c: Conversation): Conversation {
  const maskId = c.maskId ?? DEFAULT_MASK_ID;
  return {
    ...c,
    maskId,
    id: c.id.includes("::") ? c.id : convId(c.characterId, maskId),
  };
}

/** 在阵列里找「角色 × 面具」的会话下标。 */
function findIdx(list: Conversation[], characterId: string, maskId: string): number {
  return list.findIndex((c) => c.characterId === characterId && c.maskId === maskId);
}

/** 会话上可被局部更新的栏位（消息阵列另有专门入口）。 */
export type ConversationPatch = Partial<
  Pick<
    Conversation,
    | "isPinned"
    | "isMuted"
    | "manualReply"
    | "translate"
    | "transCache"
    | "bubbleLimit"
    | "bubbleMax"
    | "offlineWordsMin"
    | "offlineWordsMax"
    | "offlineReturnNote"
    | "offlineMemoryRounds"
    | "offlineOpen"
    | "unreadCount"
    | "chatBgUrl"
    | "fontSize"
    | "charAvatar"
    | "myAvatar"
    | "charRefImage"
    | "signature"
    | "friendStatus"
    | "removedAt"
    | "friendRequestMsg"
    | "blocked"
    | "blockCount"
    | "apiOverrides"
    | "voiceOverride"
    | "voicePromptOverride"
    | "proactiveOn"
    | "proactiveBaseMin"
    | "proactiveQuiet"
  >
>;

/* 会话写入串行链：本模组每个写接口都是「读整份会话元数据 → 改 → 写回」，
   并发调用会互相覆盖（典型：媒体占位回填的同时用户又发了消息，
   后写的把先写的抹掉——表现就是「刚生成好的语音/图片突然没了」）。
   所有会写 chat-conversations 的入口统一排进这一条队，逐个执行。
   链条吞掉错误继续排；错误仍抛给本次调用方。 */
let convWriteChain: Promise<unknown> = Promise.resolve();

function serializeConvWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = convWriteChain.then(task);
  convWriteChain = run.catch(() => {});
  return run;
}

/* ------------------------- 消息仓库：读骨架 / 挂回 / 迁移 ------------------------- */

/** 消息在 messages 仓库里的落库形状＝消息本体 + `convId` + `seq`（见 db/idb.ts）。 */
type StoredMessage = ChatMessage & MessageRow;

/** 从落库行还原成 ChatMessage（把 `convId`／`seq` 这两个「库内部」栏位剥掉）。 */
function toChatMessage(row: StoredMessage): ChatMessage {
  const message = { ...row };
  delete (message as Partial<MessageRow>).convId;
  delete (message as Partial<MessageRow>).seq;
  return message;
}

/** 老数据「消息还内嵌在会话里」是否已搬完的标记（只搬一次）。 */
const MSG_MIGRATION_KEY = "chat-messages-migrated-v1";
/** 迁移闸门：同一分页里并发读会话时只跑一次搬运，别互相踩。 */
let migrationGate: Promise<void> | null = null;

/**
 * 把老数据里「内嵌在会话阵列中的消息」搬进 messages 仓库（只做一次）。
 *
 * 旧版把每条会话的全部消息塞在会话阵列里、整份存成一个键；现在消息改存 messages
 * 仓库（一条一行）。头一次读会话时搬一次：逐条写成 MessageRow（补 `convId` 与按阵列
 * 顺序补 `seq`），会话本体只留元数据（`messages=[]`、`msgSeq=条数`），最后盖标记。
 * 幂等：`put` 同 id 覆盖；标记在就直接跳过；模块级闸门防并发重复搬。
 * 出错不写标记：下次读会话还会再试，不会把消息卡死。
 */
function migrateMessagesOnce(): Promise<void> {
  if (migrationGate) return migrationGate;
  migrationGate = (async () => {
    if (await kvGet<boolean>(MSG_MIGRATION_KEY)) return;
    const raw = await kvGet<Conversation[]>(CONVERSATIONS_KEY);
    if (!Array.isArray(raw) || raw.length === 0) {
      await kvSet(MSG_MIGRATION_KEY, true);
      return;
    }
    const rows: StoredMessage[] = [];
    const next = raw.map((c0) => {
      const c = normalizeConv(c0);
      const messages = Array.isArray(c.messages) ? c.messages : [];
      let seq = 0;
      for (const m of messages) {
        seq += 1;
        rows.push({ ...m, convId: c.id, seq });
      }
      return { ...c, messages: [], msgSeq: seq };
    });
    if (rows.length > 0) await msgPutAll(rows);
    await kvSet(CONVERSATIONS_KEY, next);
    await kvSet(MSG_MIGRATION_KEY, true);
  })().catch((error) => {
    migrationGate = null;
    throw error;
  });
  return migrationGate;
}

/**
 * 读会话**元数据**列表（不含消息）：从 chat-conversations 拿骨架，`messages` 一律
 * 清空、由 `attachMessages` 另外挂回。读之前先跑一次老数据迁移。
 * 写路径也用它：改会话元数据时不必再把全部消息读出来。
 */
async function readConvList(): Promise<Conversation[]> {
  await migrateMessagesOnce();
  const saved = await kvGet<Conversation[]>(CONVERSATIONS_KEY);
  if (!Array.isArray(saved)) return [];
  return saved.map((c) => ({ ...normalizeConv(c), messages: [] }));
}

/**
 * 把消息挂回会话：一次取全量消息，按 `convId` 分组、按 `seq` 排序，剥掉库内部栏位后挂回。
 *
 * 阶段①为「对外行为完全不变」仍全量挂回（消费点拿到的 Conversation 还是带完整 messages）；
 * 收窄成「只读当前会话 + 最近 N 条」留待下一步。
 */
async function attachMessages(list: Conversation[]): Promise<void> {
  if (list.length === 0) return;
  const rows = await msgGetAll<StoredMessage>();
  const grouped = new Map<string, StoredMessage[]>();
  for (const row of rows) {
    const arr = grouped.get(row.convId);
    if (arr) arr.push(row);
    else grouped.set(row.convId, [row]);
  }
  for (const c of list) {
    const arr = grouped.get(c.id) ?? [];
    arr.sort((a, b) => a.seq - b.seq);
    c.messages = arr.map(toChatMessage);
  }
}

/* --------------------------- 气泡条数（每聊天） --------------------------- */

/** 气泡条数上限的默认值（没设过的会话按这个走）。 */
export const DEFAULT_BUBBLE_MAX = 5;
/** 气泡条数上限的可设范围（界面步进与夹取共用）。 */
export const BUBBLE_MIN = 1;
export const BUBBLE_MAX = 15;

/** 气泡条数上限：取整并夹进 1–15，脏数据（NaN／小数／越界）一律拉回合法值。 */
export function clampBubbleMax(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_BUBBLE_MAX;
  return Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, n));
}

/**
 * 某场对话一轮最多几条气泡：0＝不限。
 *
 * 每聊天设定（跟置顶／免打扰同一份存档，**这个角色归这个角色**）：
 * 没设过的会话＝默认开、5 条——所以只有显式 `false` 才算「关」。
 * 会话还没建立时也返回 0（没聊过就没什么可裁的）。
 */
export function bubbleCapOf(conv: Conversation | null | undefined): number {
  if (!conv || conv.bubbleLimit === false) return 0;
  return clampBubbleMax(conv.bubbleMax);
}

/* --------------------------- 主动找我（每聊天） --------------------------- */

/** 主动找我的基础间隔默认值（分钟）：6 小时——跟老引擎 4~8 小时的平均一个量级。 */
export const DEFAULT_PROACTIVE_BASE_MIN = 360;
/** 基础间隔可设范围（分钟）：15 分钟到 24 小时。 */
export const PROACTIVE_BASE_FLOOR = 15;
export const PROACTIVE_BASE_CEIL = 24 * 60;

/** 基础间隔：取整并夹进 15–1440，脏数据（NaN／小数／越界）一律拉回合法值。 */
export function clampProactiveBaseMin(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_PROACTIVE_BASE_MIN;
  return Math.min(PROACTIVE_BASE_CEIL, Math.max(PROACTIVE_BASE_FLOOR, n));
}

/** 这个角色要不要主动找我（来消息、发动态）：单聊天没单独设过＝跟随全局默认。 */
export function proactiveOnOf(conv: Conversation | null | undefined): boolean {
  return conv?.proactiveOn ?? chatPrefsSnapshot().proactiveOn;
}

/** 这场对话的主动基础间隔（分钟）：单聊天没单独设过＝跟随全局默认。 */
export function proactiveBaseMinOf(conv: Conversation | null | undefined): number {
  return clampProactiveBaseMin(conv?.proactiveBaseMin ?? chatPrefsSnapshot().proactiveBaseMin);
}

/** 这场对话深夜要不要安静：单聊天没单独设过＝跟随全局默认。 */
export function proactiveQuietOf(conv: Conversation | null | undefined): boolean {
  return conv?.proactiveQuiet ?? chatPrefsSnapshot().proactiveQuiet;
}

/* ----------------------------- 线下场合（每聊天） ----------------------------- */

/** 线下每段回应的字数：默认 300–600，可设范围 100–3000（见 settings 页的步进）。 */
export const DEFAULT_OFFLINE_WORDS_MIN = 300;
export const DEFAULT_OFFLINE_WORDS_MAX = 600;
export const OFFLINE_WORDS_FLOOR = 100;
export const OFFLINE_WORDS_CEIL = 3000;

function clampWords(value: number | undefined, fallback: number): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(OFFLINE_WORDS_CEIL, Math.max(OFFLINE_WORDS_FLOOR, n));
}

/** 某场对话的线下字数要求：取整夹进 100–3000，脏数据拉回默认；上下限颠倒就地对调。 */
export function offlineWordsOf(conv: Conversation | null | undefined): {
  min: number;
  max: number;
} {
  const min = clampWords(conv?.offlineWordsMin, DEFAULT_OFFLINE_WORDS_MIN);
  const max = clampWords(conv?.offlineWordsMax, DEFAULT_OFFLINE_WORDS_MAX);
  return min <= max ? { min, max } : { min: max, max: min };
}

/** 线下记忆「带最近几轮」：默认 10 轮，可设范围 2–30（见线下设置页的步进）。
 *  一个数管两件事：每次只把最近这么多轮的原文摆给他；每攒够这么多轮就把这段归总一次。 */
export const DEFAULT_OFFLINE_MEMORY_ROUNDS = 10;
export const OFFLINE_ROUNDS_FLOOR = 2;
export const OFFLINE_ROUNDS_CEIL = 30;

function clampRounds(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_OFFLINE_MEMORY_ROUNDS;
  return Math.min(OFFLINE_ROUNDS_CEIL, Math.max(OFFLINE_ROUNDS_FLOOR, n));
}

/** 某场对话的线下记忆轮数：取整夹进 2–30，脏数据拉回默认 10。 */
export function offlineMemoryRoundsOf(conv: Conversation | null | undefined): number {
  return clampRounds(conv?.offlineMemoryRounds);
}

/* 线下记录单开一份存档：线上线下两套写法，混进 messages 会牵动未读数、列表预览、
   记忆与媒体占位一大片假设（见 types/chat.ts 的 OfflineScene 注）。 */
const OFFLINE_SCENES_KEY = "chat-offline-scenes";

type OfflineSceneMap = Record<string, OfflineScene>;

/** 读某场对话的线下记录（没下过线＝空一场）。 */
export async function getOfflineScene(
  characterId: string,
  maskId: string,
): Promise<OfflineScene> {
  const map = (await kvGet<OfflineSceneMap>(OFFLINE_SCENES_KEY)) ?? {};
  const found = map[convId(characterId, maskId)];
  const now = new Date().toISOString();
  return found ?? { convId: convId(characterId, maskId), entries: [], createdAt: now, updatedAt: now };
}

/** 整份写回某场对话的线下记录（页面持状态、攒够一次写）。 */
export function saveOfflineScene(
  characterId: string,
  maskId: string,
  entries: OfflineEntry[],
): Promise<OfflineScene> {
  const id = convId(characterId, maskId);
  return serializeConvWrite(async () => {
    const map = (await kvGet<OfflineSceneMap>(OFFLINE_SCENES_KEY)) ?? {};
    const now = new Date().toISOString();
    const prev = map[id];
    const scene: OfflineScene = {
      convId: id,
      entries,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await kvSet(OFFLINE_SCENES_KEY, { ...map, [id]: scene });
    return scene;
  });
}

/** 清掉某场对话的线下记录（「重开一场」用；清完这一场就当没下过线）。 */
export function clearOfflineScene(characterId: string, maskId: string): Promise<void> {
  const id = convId(characterId, maskId);
  return serializeConvWrite(async () => {
    const map = (await kvGet<OfflineSceneMap>(OFFLINE_SCENES_KEY)) ?? {};
    if (!(id in map)) return;
    const next = { ...map };
    delete next[id];
    await kvSet(OFFLINE_SCENES_KEY, next);
  });
}

/* ----------------------- 角色级设置（跟角色走，不跟面具） ----------------------- */

/** 角色级的四样：个别 API 覆盖、语音参数覆盖、语音提示词覆盖、角色生图参考图。
 *
 *  这几样从「角色 × 面具」提到角色身上：同一角色所有面具共用一份，
 *  在 A 面具配好的，切到 B 面具进去还是那套。
 *  （置顶／免打扰／背景／字号那些仍是每聊天设定，继续跟面具走，别混。）
 *
 *  存档：chat-character-settings ＝ { [角色id]: CharacterChatSettings }。 */
export type CharacterChatSettings = Pick<
  Conversation,
  "apiOverrides" | "voiceOverride" | "voicePromptOverride" | "charRefImage"
>;

/** 角色级的栏位名（迁移与清空时按这几个走）。 */
const CHAR_LEVEL_KEYS = [
  "apiOverrides",
  "voiceOverride",
  "voicePromptOverride",
  "charRefImage",
] as const;

async function getAllCharSettings(): Promise<Record<string, CharacterChatSettings>> {
  const saved = await kvGet<Record<string, CharacterChatSettings>>(CHAR_SETTINGS_KEY);
  return saved && typeof saved === "object" ? saved : {};
}

/** 老数据迁移：这几样过去存在会话上，头一次读时从该角色的会话里把它们提上来。 */
function seedCharSettings(list: Conversation[], characterId: string): CharacterChatSettings {
  const found: CharacterChatSettings = {};
  for (const c of list) {
    if (c.characterId !== characterId) continue;
    if (found.apiOverrides === undefined && c.apiOverrides !== undefined) {
      found.apiOverrides = c.apiOverrides;
    }
    if (found.voiceOverride === undefined && c.voiceOverride !== undefined) {
      found.voiceOverride = c.voiceOverride;
    }
    if (found.voicePromptOverride === undefined && c.voicePromptOverride !== undefined) {
      found.voicePromptOverride = c.voicePromptOverride;
    }
    if (found.charRefImage === undefined && c.charRefImage !== undefined) {
      found.charRefImage = c.charRefImage;
    }
  }
  return found;
}

/** 把角色级的几样盖到会话上：**角色级是这几样的唯一出处**——角色级没有就是没有，
 *  不回落会话上可能残留的旧副本（否则「关掉个别 API」会被旧值顶回来）。 */
function applyCharSettings(c: Conversation, s: CharacterChatSettings | undefined): Conversation {
  return {
    ...c,
    apiOverrides: s?.apiOverrides,
    voiceOverride: s?.voiceOverride,
    voicePromptOverride: s?.voicePromptOverride,
    charRefImage: s?.charRefImage,
  };
}

/* 角色设置变更的「铃」：个别 API／语音参数／生图参考图都是**角色级**的，写入口在
   通讯录的资料页（CharacterSettingsPanel → updateCharChatSettings）。可聊天窗口是
   **常驻挂载**的（退回只是 display:none，见 ChatApp），它的 conv 只在进场那一刻读一次；
   资料页在别处把设置改掉，挂着的聊天窗没人告诉它，就会一直捧着进场时那份旧值——
   典型表现：换完参考图回聊天室生图，仍报「参考图读不出数据」，非把 App 整个重启才生效。
   聊天窗订阅它，落完库自己回去重拉一次（与 social.ts 的 subscribeSocialAppend 同一套路）。 */
const charSettingsListeners = new Set<() => void>();

export function subscribeCharChatSettings(cb: () => void): () => void {
  charSettingsListeners.add(cb);
  return () => {
    charSettingsListeners.delete(cb);
  };
}

function notifyCharChatSettings(): void {
  for (const cb of charSettingsListeners) cb();
}

/** 写某角色的角色级设置（只收这三样；显式传 `undefined` ＝ 清掉那一项）。 */
export async function updateCharChatSettings(
  characterId: string,
  patch: CharacterChatSettings,
): Promise<CharacterChatSettings> {
  const all = await getAllCharSettings();
  const next: CharacterChatSettings = { ...all[characterId], ...patch };
  for (const k of CHAR_LEVEL_KEYS) if (next[k] === undefined) delete next[k];
  all[characterId] = next;
  await kvSet(CHAR_SETTINGS_KEY, all);
  /* 落库完再摇铃：挂着的聊天窗据此重拉 conv，新参考图当场生效，不必重启。 */
  notifyCharChatSettings();
  return next;
}

/* ----------------------------- 会话 CRUD ----------------------------- */

/** 读全部会话；顺手把这「角色级三样」盖上去（见上），并给还没记录的角色补一份迁移档。 */
export async function getConversations(): Promise<Conversation[]> {
  const list = await readConvList();
  /* 「聊过没有」这枚戳子的一次性补盖：重置记忆后消息列表的对话框也该还在，
     老数据没戳子，按「手上有消息」补一次——有消息＝确实聊过，盖上；
     一条消息也没有＝从没聊过（助手预绑的空会话），不盖。
     1.12.54：消息已搬进独立仓库，这里改看 msgSeq（＞0 即聊过、不读消息本体）。 */
  let stamped = false;
  for (const c of list) {
    if (c.chatStarted === undefined && (c.msgSeq ?? 0) > 0) {
      c.chatStarted = true;
      stamped = true;
    }
  }
  if (stamped) await kvSet(CONVERSATIONS_KEY, list);
  const all = await getAllCharSettings();
  let migrated = false;
  for (const c of list) {
    if (all[c.characterId]) continue;
    all[c.characterId] = seedCharSettings(list, c.characterId);
    migrated = true;
  }
  if (migrated) await kvSet(CHAR_SETTINGS_KEY, all);
  await attachMessages(list);
  return list.map((c) => applyCharSettings(c, all[c.characterId]));
}

/** 取某角色在某面具下的会话；没有则建一个空的（不落库，首条消息才写）。 */
export async function getOrCreateConversation(
  characterId: string,
  maskId: string,
): Promise<Conversation> {
  const list = await getConversations();
  const found = list[findIdx(list, characterId, maskId)];
  if (found) return found;
  const now = new Date().toISOString();
  return {
    id: convId(characterId, maskId),
    characterId,
    maskId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 追加一条消息（会话不存在则顺手建立）。
 *  第四项 `bumpUnread`＝这条落库的同时把列表未读 +1（列表要能看到最新消息、
 *  并带上通知）。由聊天窗判断「人不在这一间」时才传 true，跟消息写在同一笔里，
 *  免得两次读改写互相覆盖）。 */
export function appendMessage(
  ...args: Parameters<typeof appendMessageNow>
): Promise<Conversation> {
  return serializeConvWrite(() => appendMessageNow(...args));
}

async function appendMessageNow(
  characterId: string,
  maskId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
  opts?: { bumpUnread?: boolean },
): Promise<Conversation> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  const now = new Date().toISOString();
  const convKey = convId(characterId, maskId);
  const full: ChatMessage = {
    id: message.id ?? uuid(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? now,
    ...(message.type !== undefined ? { type: message.type } : {}),
    ...(message.isRead !== undefined ? { isRead: message.isRead } : {}),
    ...(message.duration !== undefined ? { duration: message.duration } : {}),
    ...(message.imageUrl !== undefined ? { imageUrl: message.imageUrl } : {}),
    ...(message.audioUrl !== undefined ? { audioUrl: message.audioUrl } : {}),
    ...(message.pending !== undefined ? { pending: message.pending } : {}),
    ...(message.awaitGen !== undefined ? { awaitGen: message.awaitGen } : {}),
    ...(message.error !== undefined ? { error: message.error } : {}),
    ...(message.errorText !== undefined ? { errorText: message.errorText } : {}),
    ...(message.retryable !== undefined ? { retryable: message.retryable } : {}),
    ...(message.amount !== undefined ? { amount: message.amount } : {}),
    /* 1.4.33：红包／转账「已收下」的标记。跟 mediaNote 那次一个道理——
       这里是逐字段白名单，漏了它，标记就只活在内存里、一刷新就没了。 */
    ...(message.moneyClaimed !== undefined ? { moneyClaimed: message.moneyClaimed } : {}),
    /* 1.4.41：红包／转账「已退还」的标记。同上一行的道理，这里是逐字段白名单，
       漏了它，标记只活在内存里、一刷新「退还」那笔又变成可收下的。 */
    ...(message.moneyRefunded !== undefined ? { moneyRefunded: message.moneyRefunded } : {}),
    /* 1.5.12：我发出去的钱「到点过期、已原路退回」的标记。同上面几行的道理，
       这里是逐字段白名单，漏了它，标记只活在内存里、一刷新这笔又变回「等他收下」、
       还能再被收一次。 */
    ...(message.moneyExpired !== undefined ? { moneyExpired: message.moneyExpired } : {}),
    /* 1.4.63：我发出去的钱「从哪个口袋出的」。同一个道理，漏了它，一刷新就丢——
       他退还时找不回「哪来的」，钱就不知道该回零钱还是回那张卡。 */
    ...(message.payFrom !== undefined ? { payFrom: message.payFrom } : {}),
    /* 1.4.84：回执那条抄的「原转账时间戳」（两联的编号都从它取）。同上面几行的道理，
       这里是逐字段白名单，漏了它，payAt 只活在内存里、一刷新两联的号又对不上了。 */
    ...(message.payAt !== undefined ? { payAt: message.payAt } : {}),
    /* 1.4.89：红包封面（预设 id 或自定义图的引用串）。同上面几行的道理，
       这里是逐字段白名单，漏了它，封面只活在内存里、一刷新就回到默认那张。 */
    ...(message.redCover !== undefined ? { redCover: message.redCover } : {}),
    ...(message.fileName !== undefined ? { fileName: message.fileName } : {}),
    ...(message.fileSize !== undefined ? { fileSize: message.fileSize } : {}),
    ...(message.quote !== undefined ? { quote: message.quote } : {}),
    /* 1.5.60：这一轮的心声（<think>…</think> 摘出来的内心独白）。同上面几行的道理，
       这里是逐字段白名单，漏了它，心声只活在内存里、一刷新就整块没了。 */
    ...(message.innerVoice !== undefined ? { innerVoice: message.innerVoice } : {}),
    /* 1.5.65：这一轮的内心快照（动作／好感／欲望／六维，跟心声同一个 <think> 块里摘的）。
       同上面几行的道理，这里是逐字段白名单，漏了它，快照只活在内存里、一刷新就整块没了，
       「心声档案」页的历史列也会跟着空掉。 */
    ...(message.innerSnapshot !== undefined ? { innerSnapshot: message.innerSnapshot } : {}),
    ...(message.apiText !== undefined ? { apiText: message.apiText } : {}),
    /* 1.10.8：与 apiText 同源的「发出去时那截易变尾巴」，红包含它回喂时才接得回尾巴。
       同上，逐字段白名单，漏了它一刷新就丢。 */
    ...(message.apiTail !== undefined ? { apiTail: message.apiTail } : {}),
    ...(message.mediaNote !== undefined ? { mediaNote: message.mediaNote } : {}),
    /* 1.9.51：外语聊天挂在这条气泡（他说的话／语音）上的中文译文。同上面几行的道理，
       这里是逐字段白名单，漏了它，译文只活在内存里——退出聊天再进来（从库里重读）
       那行中文就没了（恩熙：「退出小手机之后，我再点进来，我这个中文翻译就不见了」）。 */
    ...(message.translated !== undefined ? { translated: message.translated } : {}),
  };

  if (idx >= 0) {
    /* 会话内序号 +1：读时按它排，不靠 id／createdAt（见 MessageRow 说明）。 */
    const seq = (list[idx].msgSeq ?? 0) + 1;
    list[idx].msgSeq = seq;
    /* 戳子一盖上就不再摘：列表靠它认「这条会话聊过」，清完记忆那行也还留着。 */
    list[idx].chatStarted = true;
    list[idx].updatedAt = now;
    if (opts?.bumpUnread) list[idx].unreadCount = (list[idx].unreadCount ?? 0) + 1;
    await msgPut({ ...full, convId: convKey, seq });
    await kvSet(CONVERSATIONS_KEY, list);
    /* 回传的会话带上这条新消息：消费点若要看 messages 也看得到（历史行为不变）。 */
    list[idx].messages = [full];
    return list[idx];
  }

  const fresh: Conversation = {
    id: convKey,
    characterId,
    maskId,
    messages: [],
    msgSeq: 1,
    chatStarted: true,
    createdAt: now,
    updatedAt: now,
  };
  await msgPut({ ...full, convId: convKey, seq: 1 });
  await kvSet(CONVERSATIONS_KEY, [...list, fresh]);
  fresh.messages = [full];
  return fresh;
}

/** 删除一条消息（长按菜单的「删除」）。 */
export async function deleteMessage(
  characterId: string,
  maskId: string,
  messageId: string,
): Promise<Conversation | null> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  const convKey = convId(characterId, maskId);
  /* 仅当这条消息确实属于本会话才删（保持「按会话过滤」的旧语义）。 */
  const row = await msgGet<StoredMessage>(messageId);
  if (row && row.convId === convKey) await msgDelete(messageId);
  await kvSet(CONVERSATIONS_KEY, list);
  return list[idx];
}

/** 原位更新一条消息（图片占位气泡生成完成后填入本体等）。 */
export function updateMessage(
  ...args: Parameters<typeof updateMessageNow>
): Promise<Conversation | null> {
  return serializeConvWrite(() => updateMessageNow(...args));
}

async function updateMessageNow(
  characterId: string,
  maskId: string,
  message: ChatMessage,
): Promise<Conversation | null> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  const convKey = convId(characterId, maskId);
  /* 取回原行的 seq（序号跟着消息走、更新不改变先后）；不在本会话就只更新会话时间戳。 */
  const prev = await msgGet<StoredMessage>(message.id);
  if (prev && prev.convId === convKey) {
    await msgPut({ ...message, convId: convKey, seq: prev.seq });
  }
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
  return list[idx];
}

/** 归位手续给「跑到一半被杀掉」的图补的那句原因（真失败的原因来自生图层，
 *  绝不会长这样——所以它还能当「这行失败是归位手续写的」的记号用）。 */
const HEAL_NOTE = "上一趟还没画完，页面就被关掉或刷新了——点一下重新生成。";

/** 把库里「生成中」的图片／语音消息归位成「失败可重试」，返回更新后的会话。
 *  进入会话时调用：组件刚挂载，不可能还有活着的生成任务，残留的 pending 一定是
 *  上次刷新／重载把生成任务一起杀掉后留下的孤儿——不归位就会永远转圈，不超时也不报错。
 *  **「等点生成」的那种（awaitGen）不算孤儿**：它本来就没在跑、没花过钱，只是停在
 *  那儿等着点一下——归位成失败，等于一进聊天就看到「图片没发出来」，
 *  明明什么都没发生。
 *  归位时补一句人话当原因：空着 errorText 的话，纸面上只剩一句光秃秃的失败。
 *  归位时一定要补原因：不然「报了失败、却一句原因都没有」
 *  的图片消息没法跟被误判成孤儿的区分（真失败一定带原话）——还给「等点生成」那一态，
 *  没点过生成之前，纸面上只该有描述加一颗「生成」。
 *  没有残留时原样返回，不写库。 */
export async function healStalePendingMedia(
  characterId: string,
  maskId: string,
): Promise<Conversation | null> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  const convKey = convId(characterId, maskId);
  /* 消息已搬进独立仓库：按会话取回、按 seq 还原成从前那份有序列表。 */
  const rows = (await msgGetByConv<StoredMessage>(convKey)).sort((a, b) => a.seq - b.seq);
  const changed: StoredMessage[] = [];
  const healedById = new Map<string, ChatMessage>();
  for (const row of rows) {
    const m = toChatMessage(row);
    let next: ChatMessage | null = null;
    /* 被误判的历史残留：还原成「等点生成」（`pending` 一起带上，那颗「生成」按钮
       才认得这条路）。认出它的办法只有一个：**这行失败没有像样的原因**——
       空着，或者原因就是这份归位手续自己写的那句话。真失败的原因是从生图层带回来的
       （超时／被拒／读不出字节），绝不会长成 HEAL_NOTE 的样子。
       那条「点了生成、画到一半被刷新杀掉」的真孤儿也在其中被还成「等点生成」：
       没成之前只该看见描述和一颗生成，重画一下的成本远小于
       一进聊天就被通知一次失败。 */
    if (m.type === "image" && m.error && !m.imageUrl && (!m.errorText || m.errorText === HEAL_NOTE)) {
      next = { ...m, error: undefined, errorText: undefined, pending: true, awaitGen: true };
    } else if (m.pending && (m.type === "image" || m.type === "voice") && !m.awaitGen) {
      next = { ...m, pending: false, error: true, errorText: m.errorText ?? HEAL_NOTE };
    }
    if (!next) continue;
    healedById.set(row.id, next);
    changed.push({ ...next, convId: convKey, seq: row.seq });
  }
  if (changed.length === 0) return list[idx];
  await msgPutAll(changed);
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
  /* 回传的会话带上归位后的完整消息：调用方（聊天窗）会读它的 messages。 */
  list[idx].messages = rows.map((row) => healedById.get(row.id) ?? toChatMessage(row));
  return list[idx];
}

/** 更新会话本身（置顶、免打扰、背景、字号、头像等）。会话不存在则先建立。 */
export function updateConversation(
  ...args: Parameters<typeof updateConversationNow>
): Promise<Conversation> {
  return serializeConvWrite(() => updateConversationNow(...args));
}

async function updateConversationNow(
  characterId: string,
  maskId: string,
  patch: ConversationPatch,
): Promise<Conversation> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  const now = new Date().toISOString();
  if (idx < 0) {
    const fresh: Conversation = {
      id: convId(characterId, maskId),
      characterId,
      maskId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
    await kvSet(CONVERSATIONS_KEY, [...list, fresh]);
    return fresh;
  }
  list[idx] = { ...list[idx], ...patch, updatedAt: now };
  await kvSet(CONVERSATIONS_KEY, list);
  return list[idx];
}

/** 标记已读（清零未读数）。 */
export async function markConversationRead(
  characterId: string,
  maskId: string,
): Promise<void> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx >= 0 && (list[idx].unreadCount ?? 0) > 0) {
    list[idx].unreadCount = 0;
    await kvSet(CONVERSATIONS_KEY, list);
  }
}

/**
 * 确保内置 AI 助手就位（打开聊天 App 时调用一次）：
 * - 档案库里已有「助手模式」档案、还是更早的旧默认（星绥助手／私人 AI 助手）→ 自动升级成新默认；
 * - 每个已建面具没跟助手绑定 → 自动建立绑定（建一条空会话）。
 *
 * **1.12.33 起不再「开箱即用」**：全新手机（档案库里一张助手档案都没有）不再自动
 * 预置默认助手星绥——想要的话，自己到档案里开启「AI 助手模式」即可，之后照旧自动升级
 * 默认值、补面具绑定。这样「全新没助手」和「自己删了助手」终于是同一个结果，
 * 省掉了原先靠辞退标记区分「从没建过／亲手删掉」的那套绕法。
 * 「删除好友」仍是假删／真删会话，档案不动，不走这条路。
 */
export async function ensureAssistant(): Promise<void> {
  const archives = await getArchives();
  const found = archives.filter((a) => a.data.isAssistant === true);
  /* 一张助手档案都没有 → 直接收工，不再自动创建。 */
  if (found.length === 0) return;
  const assistant = found[0];
  /* 所有助手档案都升级旧默认值（防删建历史留下多个），只认旧默认值——
     名字／职业被用户自己改过的，一个字不动。 */
  for (const a of found) {
    const d = a.data;
    if (d.name === "星绥助手" || d.occupation === "私人 AI 助手" || d.labels === "助手") {
      await saveArchive(a.id, {
        ...d,
        ...(d.name === "星绥助手" ? { name: "星绥" } : {}),
        ...(d.occupation === "私人 AI 助手" ? { occupation: "" } : {}),
        ...(d.labels === "助手" ? { labels: "" } : {}),
      });
    }
  }
  const [masks, convs] = await Promise.all([ensureMasks(), getConversations()]);
  for (const m of masks) {
    const bound = convs.find((c) => c.characterId === assistant.id && c.maskId === m.id);
    /* 助手会话默认**不限条数**：助手的回答本来就长、句数又多，压到默认的 5 条
       就是「前 4 条照旧、超出的全并进最后一条」——最后那一条是一整串连读的长字，
       屏幕上看着像压根没分句。绑定时直接带上不限，想管的话在聊天设置里开回来即可。 */
    if (!bound) {
      await updateConversation(assistant.id, m.id, { bubbleLimit: false });
      continue;
    }
    /* 老会话：只改**从没动过**气泡设置的（两个栏位都没值）——
       亲手调过条数的，一个字不动。 */
    if (bound.bubbleLimit === undefined && bound.bubbleMax === undefined) {
      await updateConversation(assistant.id, m.id, { bubbleLimit: false });
    }
  }
}

/**
 * 记录 TA 在回复末尾附带的元信息（〔签名〕标记解析结果）。
 * 签名整条覆盖。会话不存在则先建立。
 */
export async function appendMetaUpdates(
  characterId: string,
  maskId: string,
  meta: { signature?: string },
): Promise<void> {
  const sig = typeof meta.signature === "string" ? meta.signature.trim() : "";
  if (!sig) return;
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  const now = new Date().toISOString();
  if (idx < 0) {
    const fresh: Conversation = {
      id: convId(characterId, maskId),
      characterId,
      maskId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      signature: sig,
    };
    await kvSet(CONVERSATIONS_KEY, [...list, fresh]);
    return;
  }
  list[idx].signature = sig;
  list[idx].updatedAt = now;
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 给指定动态回写图片引用（在朋友圈页面手动点生成后调用）。
 * conversationId 本身就唯一确定「角色 × 面具」，直接按它找会话。
 */
export async function setMomentImageRef(
  conversationId: string,
  momentId: string,
  imageRef: string,
): Promise<void> {
  const list = await readConvList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx < 0) return;
  const mIdx = (list[idx].moments ?? []).findIndex((m) => m.id === momentId);
  if (mIdx < 0) return;
  list[idx].moments![mIdx].imageRef = imageRef;
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 改一条动态的画面描述。
 * TA 写错了／写得不对味，可以在生成前改掉，改完就是这条动态的新描述——
 * 不写回的话下次点开又变回 TA 原本写的，等于白改。传空串＝把描述清掉。
 */
export async function setMomentImagePrompt(
  conversationId: string,
  momentId: string,
  imagePrompt: string,
): Promise<void> {
  const list = await readConvList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx < 0) return;
  const mIdx = (list[idx].moments ?? []).findIndex((m) => m.id === momentId);
  if (mIdx < 0) return;
  const text = imagePrompt.trim();
  if (text) {
    list[idx].moments![mIdx].imagePrompt = text;
  } else {
    delete list[idx].moments![mIdx].imagePrompt;
  }
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 标／取消标某条动态为「重要」。标了的那条永远以原文留在 TA 的记忆里：不会被合进
 * 模糊印象，也不会被注入上限挤掉（见 `memory.ts` 的 buildMomentSection）。
 */
export async function setMomentPinned(
  conversationId: string,
  momentId: string,
  pinned: boolean,
): Promise<void> {
  const list = await readConvList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx < 0) return;
  const mIdx = (list[idx].moments ?? []).findIndex((m) => m.id === momentId);
  if (mIdx < 0) return;
  if (pinned) {
    list[idx].moments![mIdx].pinnedByUser = true;
  } else {
    delete list[idx].moments![mIdx].pinnedByUser;
  }
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 整份覆盖某条 TA 动态的赞（2026-10-05）。
 * 赞是「一份名单」不是「一条流水」——我赞／取消赞、角色赞／取消赞都改这份名单，
 * 所以写入一律是整份覆盖；空名单就把这格删掉（回到老数据的样子）。
 */
export async function setMomentLikes(
  conversationId: string,
  momentId: string,
  likes: MomentLike[],
): Promise<void> {
  const list = await readConvList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx < 0) return;
  const mIdx = (list[idx].moments ?? []).findIndex((m) => m.id === momentId);
  if (mIdx < 0) return;
  if (likes.length > 0) {
    list[idx].moments![mIdx].likes = likes;
  } else {
    delete list[idx].moments![mIdx].likes;
  }
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/** 整份覆盖某条 TA 动态的评论（含二级回复），空名单删格。 */
export async function setMomentComments(
  conversationId: string,
  momentId: string,
  comments: MomentComment[],
): Promise<void> {
  const list = await readConvList();
  const idx = list.findIndex((c) => c.id === conversationId);
  if (idx < 0) return;
  const mIdx = (list[idx].moments ?? []).findIndex((m) => m.id === momentId);
  if (mIdx < 0) return;
  if (comments.length > 0) {
    list[idx].moments![mIdx].comments = comments;
  } else {
    delete list[idx].moments![mIdx].comments;
  }
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 清空某角色在某面具下的全部消息（保留每聊天设定）。
 *
 * ⚠️ **顺手把「曾被拉黑过几次」一并抹掉**（2026-09-22 恩熙：「重置记忆，它不会
 * 重置我拉黑过他的记忆」）。`blockCount` **不在记忆仓库里、挂在会话上**，所以
 * 「清消息 ＋ 删记忆」那两条路都漏掉它：清完之后 TA 那边**还记得被拉黑过 N 次**，
 * 每轮照样把【记忆 - 曾被拉黑】那句话（见 `lib/chat/social.ts` 的
 * `blockedMemoryPrompt`）注入 system——她刚把一切清空从头来过，TA 却还在委屈、
 * 后怕、小心翼翼，看着就像「胡说八道」。
 * ⇒ **拉黑留下的是记忆、不是设定**，记忆一清它就该跟着走；放在这儿是因为
 * **两条重置路（记忆 App 的「重置记忆」／聊天里的「清空聊天记录」）都过这个函数**，
 * 不用各自记着。
 * ⚠️ **`blocked`（当下正在拉黑）不动**——那是她在设置里亲手开着的状态，不是回忆；
 * 要解除走「解除拉黑」，不在这儿替她偷偷解。
 */
export async function clearConversation(characterId: string, maskId: string): Promise<void> {
  /* 线下那一场也算这个会话的记录，一并倒掉（1.7.39，恩熙：「在记忆里面清除了角色的记忆，
     那应该是包含线上线下的一块清」）。清在这儿而不是各自去记：两条重置路（记忆 App 的
     「重置记忆」／聊天里的「清空聊天记录」）都过这个函数，跟上面 blockCount 同一个道理。 */
  await clearOfflineScene(characterId, maskId);
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return;
  /* 消息已搬进独立仓库：按会话整段删掉（只删本会话的行）。 */
  await msgDeleteByConv(convId(characterId, maskId));
  list[idx].msgSeq = 0;
  list[idx].unreadCount = 0;
  delete list[idx].blockCount;
  /* 记录都倒空了，线下那一场自然也不算还开着：把总闸放平，线上输入解锁
     （不然她会卡在「见着面」那一条锁上，而那一场已经一个字都没了）。 */
  delete list[idx].offlineOpen;
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/**
 * 清空某角色在某面具下发过的动态（朋友圈）＋ TA 自己改过的签名。
 * 两样都是 TA 随着聊天攒在自己名下的东西，记忆都重置了、留着就说不通。
 * 签名清掉后资料页回落到档案自带的默认签名
 * （`defaultSignature(character.data)`）。
 *
 * 跟「清空聊天记录」分开走：那条路只清消息、动态和签名都留着（只是想倒掉聊天）。
 * 会话不存在就什么也不做——**绝不能顺手建一条空的**，否则没聊过的助手绑定
 * 会凭空多出一行。
 */
export async function clearMomentsAndSignature(
  characterId: string,
  maskId: string,
): Promise<void> {
  const list = await readConvList();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return;
  list[idx].moments = [];
  delete list[idx].signature;
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/** 删除会话本身（＝解除绑定：聊天记录＋每聊天设定一并删除；角色档案不受影响）。 */
export async function deleteConversation(characterId: string, maskId: string): Promise<void> {
  const list = await readConvList();
  const next = list.filter((c) => !(c.characterId === characterId && c.maskId === maskId));
  if (next.length !== list.length) {
    /* 会话没了，它名下的消息也一并清掉，不留孤儿行。 */
    await msgDeleteByConv(convId(characterId, maskId));
    await kvSet(CONVERSATIONS_KEY, next);
  }
}

/* ----------------------------- API 设定 ----------------------------- */

const API_BUNDLE_KEY = "api-settings-bundle";

/**
 * 「画风参考」功能已下线（画风图会被生图模型当成第二张底图，导致姿势
 * 表情整张照抄参考图）：老配置里可能还留着 `styleImage`（base64 大图）与
 * `stylePrompt`，读到即剥掉并落库，不让死数据白占存储（无感迁移）。
 */
function stripLegacyStyleExtras(extras: ImageApiExtras): {
  value: ImageApiExtras;
  changed: boolean;
} {
  const legacy = extras as ImageApiExtras & { styleImage?: string; stylePrompt?: string };
  if (legacy.styleImage === undefined && legacy.stylePrompt === undefined) {
    return { value: extras, changed: false };
  }
  const value = { ...legacy };
  delete value.styleImage;
  delete value.stylePrompt;
  return { value, changed: true };
}

/**
 * 三类 API 设定合集（文本／图文／语音）。
 * 旧版本只存单份设定（chat-api-settings 键）：读取时自动并进「文本 API」，
 * 图文／语音没有存过就是空白默认值。
 */
export async function getApiBundle(): Promise<ApiSettingsBundle> {
  const [bundle, legacy] = await Promise.all([
    kvGet<Partial<ApiSettingsBundle>>(API_BUNDLE_KEY),
    kvGet<ChatApiSettings>(API_SETTINGS_KEY),
  ]);
  const imageExtras = stripLegacyStyleExtras({ ...DEFAULT_IMAGE_EXTRAS, ...bundle?.imageExtras });
  if (imageExtras.changed) {
    await kvSet(API_BUNDLE_KEY, { ...bundle, imageExtras: imageExtras.value });
  }
  return {
    text: { ...DEFAULT_API_SETTINGS, ...legacy, ...bundle?.text },
    image: { ...DEFAULT_API_SETTINGS, ...bundle?.image },
    voice: { ...DEFAULT_API_SETTINGS, ...bundle?.voice },
    /* 副 API（1.2）：老数据没有这一格，读出来就是空白默认（未启用）——
       未启用时记忆任务自动退回主文本接口，行为跟没有副 API 一模一样。 */
    sub: { ...DEFAULT_API_SETTINGS, ...bundle?.sub },
    imageExtras: imageExtras.value,
    voiceExtras: { ...DEFAULT_VOICE_EXTRAS, ...bundle?.voiceExtras },
  };
}

/** 保存某一类 API 设定（其余两类与附加参数保持原样）。 */
export async function saveApiCategory(
  category: ApiCategory,
  settings: ChatApiSettings,
): Promise<void> {
  const bundle = await getApiBundle();
  await kvSet(API_BUNDLE_KEY, { ...bundle, [category]: settings });
}

/** 保存图文 API 附加参数（尺寸／质量／提示词）。 */
export async function saveImageExtras(extras: ImageApiExtras): Promise<void> {
  const bundle = await getApiBundle();
  await kvSet(API_BUNDLE_KEY, { ...bundle, imageExtras: extras });
}

/** 保存语音 API 附加参数（音色／语速／音调）。 */
export async function saveVoiceExtras(extras: VoiceApiExtras): Promise<void> {
  const bundle = await getApiBundle();
  await kvSet(API_BUNDLE_KEY, { ...bundle, voiceExtras: extras });
}

/** 文本 API 设定（聊天回复用；兼容旧调用方）。 */
export async function getApiSettings(): Promise<ChatApiSettings> {
  return (await getApiBundle()).text;
}

/* --------------------------- API 预设方案 --------------------------- */

const API_PRESETS_KEY = "api-presets";

/** 全量预设方案（内部用：kvSet 整体覆盖，改某一类须先读全量）。 */
async function getAllApiPresets(): Promise<Partial<Record<ApiCategory, ApiPresetEntry[]>>> {
  return (await kvGet<Partial<Record<ApiCategory, ApiPresetEntry[]>>>(API_PRESETS_KEY)) ?? {};
}

/** 某分类下的全部预设方案（新→旧）；图文方案里的画风参考死字段顺手清掉（无感迁移）。 */
export async function getApiPresets(category: ApiCategory): Promise<ApiPresetEntry[]> {
  const all = await getAllApiPresets();
  const list = all[category] ?? [];
  let changed = false;
  const next = list.map((p) => {
    if (!p.imageExtras) return p;
    const cleaned = stripLegacyStyleExtras(p.imageExtras);
    if (!cleaned.changed) return p;
    changed = true;
    return { ...p, imageExtras: cleaned.value };
  });
  if (changed) await kvSet(API_PRESETS_KEY, { ...all, [category]: next });
  return next;
}

/**
 * 新增／更新预设方案：带 id 且存在为更新（改名也走这里），
 * 否则新增并排到最前。
 */
export async function saveApiPreset(
  category: ApiCategory,
  preset: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 语音方案携带：音色／语速／音调。 */
    voiceExtras?: VoiceApiExtras;
    /** 图文方案携带：尺寸／质量／提示词等。 */
    imageExtras?: ImageApiExtras;
  },
): Promise<ApiPresetEntry> {
  const all = await getAllApiPresets();
  const list = all[category] ?? [];
  const now = new Date().toISOString();
  if (preset.id) {
    const idx = list.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...preset, updatedAt: now };
      await kvSet(API_PRESETS_KEY, { ...all, [category]: list });
      return list[idx];
    }
  }
  const entry: ApiPresetEntry = {
    id: uuid(),
    name: preset.name.trim() || "未命名方案",
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey,
    model: preset.model,
    ...(preset.voiceExtras ? { voiceExtras: preset.voiceExtras } : {}),
    ...(preset.imageExtras ? { imageExtras: preset.imageExtras } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await kvSet(API_PRESETS_KEY, { ...all, [category]: [entry, ...list] });
  return entry;
}

/** 删除某分类下的一个预设方案。 */
export async function deleteApiPreset(category: ApiCategory, id: string): Promise<void> {
  const all = await getAllApiPresets();
  const list = (all[category] ?? []).filter((p) => p.id !== id);
  await kvSet(API_PRESETS_KEY, { ...all, [category]: list });
}

/* ----------------------------- 对话偏好 ----------------------------- */

const CHAT_PREFS_KEY = "chat-prefs";

/** 「语音提示词默认规矩」一次性迁移的戳子（1.9.87）：补过一次就不再补，见 getChatPrefs。 */
const VOICE_PROMPT_DEFAULT_MIGRATED_KEY = "chat-prefs-voice-default-v1";

/** 「语音提示词出厂原文换版」一次性迁移的戳子（1.9.89）：把方括号标签那版换成
 *  「把语气写进文字」版，见 getChatPrefs。 */
const VOICE_PROMPT_TEXT_MIGRATED_V2_KEY = "chat-prefs-voice-default-v2";

/** 对话行为偏好（全局一份，不分角色与面具；每聊天设定在 Conversation 上）。 */
export interface ChatPrefs {
  /**
   * 主动找我（全局默认）：TA 会不会自己来找你（**来消息**）。这是**全局默认**，
   * 单个聊天没单独设过时就按它走；单聊天设过的以单聊天为准。
   * 默认开——「角色有自己的生活」是星绥的底色。
   * 注意：**只管私聊主动消息**。
   */
  proactiveOn: boolean;
  /** 主动找我的基础间隔（分钟）全局默认，单聊天没设过时按它走。 */
  proactiveBaseMin: number;
  /** 深夜静默全局默认：开着＝深夜不打扰，单聊天没设过时按它走。**只管私聊**。 */
  proactiveQuiet: boolean;
  /**
   * 时间感知：打开后把「此刻的真实时间」注入本轮提示词，TA 在「现在几点」
   * 这件事上就不会乱编（在此之前 TA 只能从聊天内容猜，同一晚前后能说反）。
   * 关掉＝完全不注入，行为与从前一致。
   */
  timeAware: boolean;
  /**
   * 自动生成：TA 要发图时（回复里写了〔图片〕标记）是否立刻去画。
   * 开着（默认）＝照旧收到标记就画；关掉＝先把画面描述摆在占位框里等你点「生成」，
   * 不点就不画——生图按次计费，想自己看文字决定要不要这张，就把这个关掉。
   * 注意这是**全局习惯**，不跟预设方案走：切换图文方案不会改它。
   */
  autoGenerateImage: boolean;
  /**
   * 自动合成：TA 要发语音时（回复里写了〔语音〕标记）是否立刻去合成。
   * 开着（默认）＝收到标记就合；关掉＝先把语音气泡摆在那儿（播放键、波形、时长都在，
   * 翻开还能看文字），点一下才合——合成按次计费，想自己决定要不要这条就把这个关掉。
   * 注意这是**全局习惯**，不跟预设方案走：切换语音方案不会改它。
   */
  autoGenerateVoice: boolean;
  /**
   * 配图自动生成（1.10.38）：**我**发动态时用「文字描述」当配图，要不要把这段描述
   * 交给生图接口真画一张。关着（默认）＝不画、不花钱，这段描述**就当这张图**发给 TA
   * （TA 认为它是一张图片）；开着＝自动画成真图再发，TA 看到的是真图。
   * ⚠︎ 只管**我发的**动态，跟上面那枚 `autoGenerateImage`（管 TA 自己动态配图）是两回事。
   * 全局习惯，不跟预设方案走。
   */
  autoGenerateMyMomentImage: boolean;
  /**
   * 「配图自动生成」用的生图接口（1.10.38）：只在上面那枚开关开着时才有意义。
   * **不填／baseUrl 空** ＝ 跟随主「图文 API」；填了 ＝ 用这一套（地址／密钥／模型），
   * 生图参数（尺寸／画风／提示词）仍沿用主图文 API 那一份 extras。
   * ⚠️ 这份**只活在动态设置这一处**，跟设置里那批图文预设**互不往来**——恩熙拍板：
   * 别让一个功能在两处都要维护，越做越多时顾不过来。
   */
  myMomentImageApi?: { baseUrl: string; apiKey: string; model: string };
  /**
   * 显示思维链（1.4.9）：思考型模型（DeepSeek-R1 等）单独吐的思考过程要不要在
   * 气泡上方露「思考过程」入口。开着（默认）＝有思考的消息可以点开看；关＝入口
   * 整个不显示（思考照收照存，只是不露入口——重新打开还能看，不丢）。
   * 普通模型没有思考内容，这个开关对它们无感。
   */
  showReasoning: boolean;
  /**
   * 流畅模式（1.9.6）：手机发烫、点一下要等半天时的「救急总闸」。打开后全局停掉
   * 动画、过渡与毛玻璃（见 globals.css 的 `html.smooth-mode`），只留最朴素的一层皮，
   * 界面瞬时响应、CPU 负担骤降。关掉＝恢复原有的动效与玻璃质感。
   * 默认关：动效与玻璃是星绥的样子的一部分，只在扛不住时才该让位。
   */
  smoothMode: boolean;
  /**
   * 语音提示词开关：打开后把下面那段「〔语音〕里说的话」的规矩拼进发给聊天模型的
   * 系统提示词，让 TA 照这份规矩写〔语音〕里那句台词（说什么、什么口吻、怎么断句）
   * ——只管内容，不管要不要发语音、怎么标〔语音〕。
   * 全局一份；角色可在「角色设置 · 语音提示词」里单独覆盖。
   */
  voicePromptOn: boolean;
  /** 〔语音〕里说的话的规矩原文（开关打开且非空时才注入）。 */
  voicePromptText: string;
}

/**
 * 「语音提示词」的默认规矩（1.9.89 改版）：〔语音〕里那句台词要像**真的说出口**，
 * 语气写在字里，不靠标签。
 *
 * 为什么改：1.9.87 那版是教模型往台词前插英文方括号音频标签（[whispers] 这类）——
 * 只有 ElevenLabs 的 v3／v4 认，v2 与 flash／turbo 会把它**照字念出来**；实测中文角色
 * 在中文台词前挂英文标签太反直觉，模型常常不写、写错，恩熙听到的仍是生硬的中性腔
 *（该轻声的地方反而强硬）。改成把语气做进文字本身——省略号、断句、语气词、句子长短——
 * 这条路对**所有**音色都成立（ElevenLabs／MiniMax／OpenAI 兼容都吃这套），也没有
 * 「换个音色就失效」的毛病。
 *
 * 方括号标签的机制没删：显示层照旧剥（ChatWindow 的 stripVoiceTags），合成侧照旧给
 * 别家剥（chatApi 的 stripVoiceAudioTags）。想玩标签的人，自己在设置里把那段规矩写回去即可。
 * 用户随时可在设置里改这段文字、或整个关掉（角色级也能单独覆盖）。
 */
export const DEFAULT_VOICE_PROMPT_TEXT =
  "〔语音〕里的话写成日常口语。该轻的地方用省略号和断句放软，该硬的地方不放软。语气词按人设写足，迟疑、撒娇、委屈、试探都写在字面上。一句不宜过长。括号动作、星号、emoji 都不写。";

/** 1.9.87～1.9.88 那版出厂「语音提示词」原文（教模型插方括号标签那套）。
 *  老装置上存的还是这一份，1.9.89 改版时要一次性换成新原文（见 getChatPrefs）。 */
const LEGACY_VOICE_PROMPT_TEXT_V1 =
  "说话时带上当下的口吻，让声音有情绪：在这句台词最前面加一个英文半角方括号标签，例如 [whispers]（气声低语）、[laughs]（笑）、[sighs]（叹气）、[excited]（兴奋）、[sad]（低落）、[angry]（生气）、[sarcastic]（揶揄）、[softly]（轻声）、[nervous]（紧张）、[curious]（好奇）。一句话最多一个标签；平常闲聊不必每句都加，只在情绪明显、或想让声音换个语气时才加，挑最贴当下情境的那一个。标签不会显示给对方看，只影响声音听起来的样子。";

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  proactiveOn: true,
  proactiveBaseMin: DEFAULT_PROACTIVE_BASE_MIN,
  proactiveQuiet: true,
  timeAware: true,
  autoGenerateImage: true,
  autoGenerateVoice: true,
  autoGenerateMyMomentImage: false,
  showReasoning: true,
  smoothMode: false,
  /* 1.9.87：默认开、并带上默认语音规矩（见上）。目标就是「默认语音就该有基本语气」，
     不该让用户先去设置里自己开一道开关才有——所以这次默认值直接改成开。 */
  voicePromptOn: true,
  voicePromptText: DEFAULT_VOICE_PROMPT_TEXT,
};

/* 全局偏好的内存快照：主动引擎的判定是同步的（proactive*Of），读不了异步存档，
   于是 getChatPrefs／saveChatPrefs 顺手在这里留一份最新的，供同步回落使用。 */
let prefsSnapshot: ChatPrefs | null = null;

/** 同步取全局偏好最新快照；还没读过存档时给出厂默认（不会误关任何东西）。 */
export function chatPrefsSnapshot(): ChatPrefs {
  return prefsSnapshot ?? DEFAULT_CHAT_PREFS;
}

/** 把存档补全成一份合法偏好（缺漏栏位补预设值，方便日后加开关）。 */
function normalizePrefs(saved: Partial<ChatPrefs>): ChatPrefs {
  return {
    proactiveOn: saved.proactiveOn ?? DEFAULT_CHAT_PREFS.proactiveOn,
    proactiveBaseMin: clampProactiveBaseMin(saved.proactiveBaseMin),
    proactiveQuiet: saved.proactiveQuiet ?? DEFAULT_CHAT_PREFS.proactiveQuiet,
    timeAware: saved.timeAware ?? DEFAULT_CHAT_PREFS.timeAware,
    autoGenerateImage: saved.autoGenerateImage ?? DEFAULT_CHAT_PREFS.autoGenerateImage,
    autoGenerateVoice: saved.autoGenerateVoice ?? DEFAULT_CHAT_PREFS.autoGenerateVoice,
    autoGenerateMyMomentImage:
      saved.autoGenerateMyMomentImage ?? DEFAULT_CHAT_PREFS.autoGenerateMyMomentImage,
    /* 可选：不填＝跟随主图文 API。原样透传，别去补默认（补了就成「自定义」了）。 */
    myMomentImageApi: saved.myMomentImageApi,
    showReasoning: saved.showReasoning ?? DEFAULT_CHAT_PREFS.showReasoning,
    smoothMode: saved.smoothMode ?? DEFAULT_CHAT_PREFS.smoothMode,
    voicePromptOn: saved.voicePromptOn ?? DEFAULT_CHAT_PREFS.voicePromptOn,
    voicePromptText: saved.voicePromptText ?? DEFAULT_CHAT_PREFS.voicePromptText,
  };
}

/** 读取对话偏好；缺漏栏位补预设值，方便日后加开关。 */
export async function getChatPrefs(): Promise<ChatPrefs> {
  const prefs = normalizePrefs((await kvGet<Partial<ChatPrefs>>(CHAT_PREFS_KEY)) ?? {});
  /* 1.9.87 一次性迁移：默认语音要有基本语气，于是给「语音提示词」配了默认规矩并默认开。
     但 saveChatPrefs 存的是**整份**，老装置那份里 voicePromptOn=false、正文空，改
     DEFAULT_CHAT_PREFS 对它不生效——所以这里补一次：只在「从没开过、正文也空」时填默认，
     用户自己开过或写过一字的都不碰。marker 记一笔，补过就不再来（免得她手动清空后被塞回）。 */
  if (!(await kvGet<boolean>(VOICE_PROMPT_DEFAULT_MIGRATED_KEY))) {
    if (!prefs.voicePromptOn && !prefs.voicePromptText.trim()) {
      prefs.voicePromptOn = true;
      prefs.voicePromptText = DEFAULT_VOICE_PROMPT_TEXT;
      await kvSet(CHAT_PREFS_KEY, prefs);
    }
    await kvSet(VOICE_PROMPT_DEFAULT_MIGRATED_KEY, true);
  }
  /* 1.9.89 一次性迁移：出厂那份默认规矩从「插方括号标签」改成「把语气写进文字」。
     老装置上存的还是旧原文（v1 那段已补过、不会再动），这里把它换成新原文——但
     **只换一字未改的**：她要是自己改过这段规矩，就一个字都不碰。 */
  if (!(await kvGet<boolean>(VOICE_PROMPT_TEXT_MIGRATED_V2_KEY))) {
    if (prefs.voicePromptText.trim() === LEGACY_VOICE_PROMPT_TEXT_V1.trim()) {
      prefs.voicePromptText = DEFAULT_VOICE_PROMPT_TEXT;
      await kvSet(CHAT_PREFS_KEY, prefs);
    }
    await kvSet(VOICE_PROMPT_TEXT_MIGRATED_V2_KEY, true);
  }
  prefsSnapshot = prefs;
  return prefs;
}

/** 局部更新对话偏好（只传要改的那个开关）。 */
export async function saveChatPrefs(patch: Partial<ChatPrefs>): Promise<ChatPrefs> {
  const next = normalizePrefs({ ...(await getChatPrefs()), ...patch });
  await kvSet(CHAT_PREFS_KEY, next);
  prefsSnapshot = next;
  /* 喊一声：挂在别处的界面（根层按 smoothMode 给 <html> 挂类）跟着重读，
     不必刷新页面（1.9.6）。 */
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("stellasei:prefs-changed"));
  }
  return next;
}

/* ── 动态页的封面。
   只存**一笔**、**不跟面具走**：封面是「我这个人」的样子，换面具不该把它换掉。
   存的是 `media-store://` 引用串而不是图本身——跟聊天图片同一条规矩：图进独立仓库，
   设定里只留一句引用串（见 media-asset.ts 顶上那三条）。空串＝没换过，走默认渐变。 ── */
const MOMENTS_COVER_KEY = "moments-cover";

/** 读封面引用串；没换过／已还原时回空串。 */
export async function getMomentsCover(): Promise<string> {
  return (await kvGet<string>(MOMENTS_COVER_KEY)) ?? "";
}

/** 写封面引用串（传空串＝还原成默认渐变）。 */
export async function saveMomentsCover(ref: string): Promise<void> {
  await kvSet(MOMENTS_COVER_KEY, ref);
}

/* ── 「我」自己发的动态（2026-10-04）。
   存一份 `Record<面具id, SelfMoment[]>`：动态页只看当前面具那一册。
   跟 TA 的动态（落在各自的 `Conversation.moments`）**分开存**——我的这些不分角色。 ── */
const SELF_MOMENTS_KEY = "moments-self";

/** 读某个面具下「我」发过的全部动态（落库顺序：旧→新，渲染时再统一排）。 */
export async function getSelfMoments(maskId: string): Promise<SelfMoment[]> {
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  return all[maskId] ?? [];
}

/** 「我」发一条动态：追加进该面具那一册，返回落库后的那条（带 id 与时间）。 */
export async function addSelfMoment(
  maskId: string,
  draft: {
    content: string;
    imageRef?: string;
    imageText?: string;
    tags?: string[];
    visibility?: MomentVisibility;
    visibleTo?: string[];
    visibleWorlds?: string[];
  },
): Promise<SelfMoment> {
  const content = draft.content.trim();
  const imageRef = draft.imageRef?.trim();
  /* 「文字描述当图」：图没落成真图、但有这段描述时才算数（有真图就不存文字，免得打架）。 */
  const imageText = imageRef ? undefined : draft.imageText?.trim();
  const tags = (draft.tags ?? []).map((t) => t.trim().replace(/^#+/, "")).filter(Boolean);
  const visibility = draft.visibility ?? "public";
  const item: SelfMoment = {
    id: uuid(),
    content,
    createdAt: new Date().toISOString(),
    ...(imageRef ? { imageRef } : {}),
    ...(imageText ? { imageText } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    visibility,
    ...(visibility === "partial" && draft.visibleTo?.length
      ? { visibleTo: draft.visibleTo }
      : {}),
    ...(visibility === "partial" && draft.visibleWorlds?.length
      ? { visibleWorlds: draft.visibleWorlds }
      : {}),
  };
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  all[maskId] = [...(all[maskId] ?? []), item];
  await kvSet(SELF_MOMENTS_KEY, all);
  return item;
}

/**
 * 回写「看图写的一句话」（发布带图动态后异步调用）。
 * 只补 imageNote，不碰别的；找不到那一条就什么也不做（图已删等）。
 */
export async function setSelfMomentImageNote(
  maskId: string,
  momentId: string,
  imageNote: string,
): Promise<void> {
  const text = imageNote.trim();
  if (!text) return;
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  const list = all[maskId];
  if (!list) return;
  const idx = list.findIndex((m) => m.id === momentId);
  if (idx < 0) return;
  list[idx].imageNote = text;
  await kvSet(SELF_MOMENTS_KEY, all);
}

/**
 * 整份覆盖「我」某条动态的赞（2026-10-05）。空名单删格。
 * 赞写在这儿而不是各自去记：我赞／取消赞都改这份名单（角色赞将来走同一格）。
 */
export async function setSelfMomentLikes(
  maskId: string,
  momentId: string,
  likes: MomentLike[],
): Promise<void> {
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  const list = all[maskId];
  if (!list) return;
  const idx = list.findIndex((m) => m.id === momentId);
  if (idx < 0) return;
  if (likes.length > 0) {
    list[idx].likes = likes;
  } else {
    delete list[idx].likes;
  }
  await kvSet(SELF_MOMENTS_KEY, all);
}

/** 整份覆盖「我」某条动态的评论（含二级回复），空名单删格。 */
export async function setSelfMomentComments(
  maskId: string,
  momentId: string,
  comments: MomentComment[],
): Promise<void> {
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  const list = all[maskId];
  if (!list) return;
  const idx = list.findIndex((m) => m.id === momentId);
  if (idx < 0) return;
  if (comments.length > 0) {
    list[idx].comments = comments;
  } else {
    delete list[idx].comments;
  }
  await kvSet(SELF_MOMENTS_KEY, all);
}

/** 删掉「我」的某条动态（2026-10-05）：整条从该面具那一册滤掉。
    它的赞／评本来就挂在这一条上，跟着一起走。找不到那一条就什么也不做。 */
export async function removeSelfMoment(maskId: string, momentId: string): Promise<void> {
  const all = (await kvGet<Record<string, SelfMoment[]>>(SELF_MOMENTS_KEY)) ?? {};
  const list = all[maskId];
  if (!list) return;
  const next = list.filter((m) => m.id !== momentId);
  if (next.length === list.length) return;
  all[maskId] = next;
  await kvSet(SELF_MOMENTS_KEY, all);
}
