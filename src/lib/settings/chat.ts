/**
 * 星绥通讯持久化（IndexedDB KV）。
 *
 * 会话按「角色 × 面具」归档：换面具＝换身份重新聊，
 * 每个面具对每个角色各有一份独立的聊天记录与每聊天设定。
 *
 * 三份数据：
 * - chat-conversations —— 会话阵列（含置顶／背景／字号等每聊天设定）
 * - chat-character-settings —— 角色级的三样（个别 API／语音参数／生图参考图），跟角色走
 * - api-settings-bundle —— 三类 API 设定（文本／图文／语音，各自独立）
 *   （旧版单份 chat-api-settings 读取时自动迁移为「文本 API」）
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { DEFAULT_MASK_ID, ensureMasks } from "@/lib/settings/mask";
import { createArchive, getArchives, saveArchive, EMPTY_PROFILE, isAssistantOff } from "@/lib/settings/contact";
import {
  DEFAULT_API_SETTINGS,
  DEFAULT_IMAGE_EXTRAS,
  DEFAULT_VOICE_EXTRAS,
  type ApiCategory,
  type ApiPresetEntry,
  type ApiSettingsBundle,
  type ChatApiSettings,
  type ChatMessage,
  type ChatMoment,
  type Conversation,
  type ImageApiExtras,
  type OfflineEntry,
  type OfflineScene,
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
  >
>;

/* 会话写入串行链：本模组每个写接口都是「读整份会话阵列 → 改 → 写回」，
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
  return next;
}

/* ----------------------------- 会话 CRUD ----------------------------- */

/** 读全部会话；顺手把这「角色级三样」盖上去（见上），并给还没记录的角色补一份迁移档。 */
export async function getConversations(): Promise<Conversation[]> {
  const saved = await kvGet<Conversation[]>(CONVERSATIONS_KEY);
  if (!Array.isArray(saved)) return [];
  const list = saved.map(normalizeConv);
  /* 「聊过没有」这枚戳子的一次性补盖：重置记忆后消息列表的对话框也该还在，
     老数据没戳子，按「手上有消息」补一次——有消息＝确实聊过，盖上；
     一条消息也没有＝从没聊过（助手预绑的空会话），不盖。 */
  let stamped = false;
  for (const c of list) {
    if (c.chatStarted === undefined && c.messages.length > 0) {
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  const now = new Date().toISOString();
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
    ...(message.mediaNote !== undefined ? { mediaNote: message.mediaNote } : {}),
    /* 1.9.51：外语聊天挂在这条气泡（他说的话／语音）上的中文译文。同上面几行的道理，
       这里是逐字段白名单，漏了它，译文只活在内存里——退出聊天再进来（从库里重读）
       那行中文就没了（恩熙：「退出小手机之后，我再点进来，我这个中文翻译就不见了」）。 */
    ...(message.translated !== undefined ? { translated: message.translated } : {}),
  };

  if (idx >= 0) {
    list[idx].messages.push(full);
    /* 戳子一盖上就不再摘：列表靠它认「这条会话聊过」，清完记忆那行也还留着。 */
    list[idx].chatStarted = true;
    list[idx].updatedAt = now;
    if (opts?.bumpUnread) list[idx].unreadCount = (list[idx].unreadCount ?? 0) + 1;
    await kvSet(CONVERSATIONS_KEY, list);
    return list[idx];
  }

  const fresh: Conversation = {
    id: convId(characterId, maskId),
    characterId,
    maskId,
    messages: [full],
    chatStarted: true,
    createdAt: now,
    updatedAt: now,
  };
  await kvSet(CONVERSATIONS_KEY, [...list, fresh]);
  return fresh;
}

/** 删除一条消息（长按菜单的「删除」）。 */
export async function deleteMessage(
  characterId: string,
  maskId: string,
  messageId: string,
): Promise<Conversation | null> {
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  list[idx].messages = list[idx].messages.filter((m) => m.id !== messageId);
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  list[idx].messages = list[idx].messages.map((m) => (m.id === message.id ? message : m));
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return null;
  let healed = false;
  list[idx].messages = list[idx].messages.map((m) => {
    /* 被误判的历史残留：还原成「等点生成」（`pending` 一起带上，那颗「生成」按钮
       才认得这条路）。认出它的办法只有一个：**这行失败没有像样的原因**——
       空着，或者原因就是这份归位手续自己写的那句话。真失败的原因是从生图层带回来的
       （超时／被拒／读不出字节），绝不会长成 HEAL_NOTE 的样子。
       那条「点了生成、画到一半被刷新杀掉」的真孤儿也在其中被还成「等点生成」：
       没成之前只该看见描述和一颗生成，重画一下的成本远小于
       一进聊天就被通知一次失败。 */
    if (m.type === "image" && m.error && !m.imageUrl && (!m.errorText || m.errorText === HEAL_NOTE)) {
      healed = true;
      return { ...m, error: undefined, errorText: undefined, pending: true, awaitGen: true };
    }
    if (!m.pending || (m.type !== "image" && m.type !== "voice")) return m;
    if (m.awaitGen) return m;
    healed = true;
    return {
      ...m,
      pending: false,
      error: true,
      errorText: m.errorText ?? HEAL_NOTE,
    };
  });
  if (!healed) return list[idx];
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
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
  const list = await getConversations();
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx >= 0 && (list[idx].unreadCount ?? 0) > 0) {
    list[idx].unreadCount = 0;
    await kvSet(CONVERSATIONS_KEY, list);
  }
}

/**
 * 确保内置 AI 助手就位（打开聊天 App 时调用一次）：
 * - **没删过**助手、而档案库里又没有「助手模式」档案 → 自动建一个（星绥）；
 * - 已有档案还是更早的旧默认（星绥助手／私人 AI 助手）→ 自动升级成新默认；
 * - 每个已建面具没跟助手绑定 → 自动建立绑定（建一条空会话）。
 * 助手由此开箱即用地躺在每个面具的通讯人列表里，想用就直接找它聊，不想用就不理。
 *
 * ⚠️ 原写法分不清「从没建过」和「自己删的」：助手档案删了、下次开聊天 App 又被补回来，
 * 像永远删不掉——前者该建，后者不该再冒出来。现在靠 `isAssistantOff()` 那枚
 * 辞退标记分界（删除时落下、重新打开某张档案的助手模式即清掉；**1.4.16 起
 * 关掉最后一张助手档案的开关同样落标记**——不然关一次开关、下次进聊天又自动
 * 补一个，跟删了又蹦是同一种乱象）。
 * 「删除好友」仍是假删／真删会话，档案不动，不走这条路。
 */
export async function ensureAssistant(): Promise<void> {
  const archives = await getArchives();
  const found = archives.filter((a) => a.data.isAssistant === true);
  /* 档案库里一个助手都没有、而那枚辞退标记又立着 → 是亲手删的，**别再长出来**。
     （标记只拦「重建」：万一还留着另一张助手档案，升级默认值、补面具绑定这些
     正事照旧要办，所以判据是「没有 ＋ 被辞退」而不是单看标记。） */
  if (found.length === 0 && (await isAssistantOff())) return;
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
  let assistant = found[0];
  if (!assistant) {
    assistant = await createArchive();
    await saveArchive(assistant.id, {
      ...EMPTY_PROFILE,
      name: "星绥",
      nickname: "小绥",
      isAssistant: true,
    });
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
 * 记录 TA 在回复末尾附带的元信息（〔签名〕／〔动态〕／〔动态图〕标记解析结果）。
 * 签名整条覆盖；动态追加进既有列表；每条动态可附带一条 imagePrompt（TA 写的画面描述）。
 * 会话不存在则先建立。
 *
 * 返回**这一趟新落库的那些动态**（带内部 id）。生成配图这件事本身不在这里跑——
 * 手动那一趟在朋友圈页面点；「自动生图」开着时由调用方拿着
 * 这些 id 去跑（见 `generateMomentImage`）。id 只有这里知道，所以必须交出去。
 */
export async function appendMetaUpdates(
  characterId: string,
  maskId: string,
  meta: { signature?: string; moments?: Array<{ content: string; imagePrompt?: string }> },
): Promise<ChatMoment[]> {
  const hasSig = typeof meta.signature === "string" && meta.signature.trim();
  const newMoments = (meta.moments ?? []).filter((m) => m.content.trim());
  if (!hasSig && newMoments.length === 0) return [];
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  const now = new Date().toISOString();
  const created: ChatMoment[] = newMoments.map((m) => ({
    id: uuid(),
    content: m.content.trim(),
    createdAt: now,
    ...(m.imagePrompt?.trim() ? { imagePrompt: m.imagePrompt.trim() } : {}),
  }));
  if (idx < 0) {
    const fresh: Conversation = {
      id: convId(characterId, maskId),
      characterId,
      maskId,
      messages: [],
      createdAt: now,
      updatedAt: now,
      ...(hasSig ? { signature: meta.signature!.trim() } : {}),
      ...(created.length > 0 ? { moments: created } : {}),
    };
    await kvSet(CONVERSATIONS_KEY, [...list, fresh]);
    return created;
  }
  if (hasSig) list[idx].signature = meta.signature!.trim();
  if (created.length > 0) {
    list[idx].moments = [...(list[idx].moments ?? []), ...created];
  }
  list[idx].updatedAt = now;
  await kvSet(CONVERSATIONS_KEY, list);
  return created;
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
  const list = await getConversations();
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
  const list = await getConversations();
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
  const list = await getConversations();
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return;
  list[idx].messages = [];
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
  const list = await getConversations();
  const idx = findIdx(list, characterId, maskId);
  if (idx < 0) return;
  list[idx].moments = [];
  delete list[idx].signature;
  list[idx].updatedAt = new Date().toISOString();
  await kvSet(CONVERSATIONS_KEY, list);
}

/** 删除会话本身（＝解除绑定：聊天记录＋每聊天设定一并删除；角色档案不受影响）。 */
export async function deleteConversation(characterId: string, maskId: string): Promise<void> {
  const list = await getConversations();
  const next = list.filter((c) => !(c.characterId === characterId && c.maskId === maskId));
  if (next.length !== list.length) {
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

/** 对话行为偏好（全局一份，不分角色与面具；每聊天设定在 Conversation 上）。 */
export interface ChatPrefs {
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
   * 系统提示词，让 TA 照这份规矩写〔语音〕里那句台词（说什么、什么口吻、要不要插
   * 方括号标签）——只管内容，不管要不要发语音、怎么标〔语音〕。
   * 全局一份；角色可在「角色设置 · 语音提示词」里单独覆盖。
   */
  voicePromptOn: boolean;
  /** 〔语音〕里说的话的规矩原文（开关打开且非空时才注入）。 */
  voicePromptText: string;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  timeAware: true,
  autoGenerateImage: true,
  showReasoning: true,
  smoothMode: false,
  voicePromptOn: false,
  voicePromptText: "",
};

/** 把存档补全成一份合法偏好（缺漏栏位补预设值，方便日后加开关）。 */
function normalizePrefs(saved: Partial<ChatPrefs>): ChatPrefs {
  return {
    timeAware: saved.timeAware ?? DEFAULT_CHAT_PREFS.timeAware,
    autoGenerateImage: saved.autoGenerateImage ?? DEFAULT_CHAT_PREFS.autoGenerateImage,
    showReasoning: saved.showReasoning ?? DEFAULT_CHAT_PREFS.showReasoning,
    smoothMode: saved.smoothMode ?? DEFAULT_CHAT_PREFS.smoothMode,
    voicePromptOn: saved.voicePromptOn ?? DEFAULT_CHAT_PREFS.voicePromptOn,
    voicePromptText: saved.voicePromptText ?? DEFAULT_CHAT_PREFS.voicePromptText,
  };
}

/** 读取对话偏好；缺漏栏位补预设值，方便日后加开关。 */
export async function getChatPrefs(): Promise<ChatPrefs> {
  return normalizePrefs((await kvGet<Partial<ChatPrefs>>(CHAT_PREFS_KEY)) ?? {});
}

/** 局部更新对话偏好（只传要改的那个开关）。 */
export async function saveChatPrefs(patch: Partial<ChatPrefs>): Promise<ChatPrefs> {
  const next = normalizePrefs({ ...(await getChatPrefs()), ...patch });
  await kvSet(CHAT_PREFS_KEY, next);
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
