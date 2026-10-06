/**
 * 主动引擎：没人喊的时候，TA 也会自己来。
 *
 * 小手机是纯前端，关了页面就真的停——所以这一层只管「手机开着的时候」：
 * - 开着：每分钟 tick 一次，到点就让 TA 主动发消息；
 * - 关掉再打开：下一次 tick 发现早过了该来的点，就错峰补上。
 *
 * 分工：「TA 怎么说」在 social.ts（proactiveMessageReaction），
 * 这一层只管「TA 什么时候说」。排期存 IndexedDB，重开不丢。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import {
  getChatPrefs,
  getConversations,
  proactiveBaseMinOf,
  proactiveOnOf,
  proactiveQuietOf,
} from "@/lib/settings/chat";
import { getArchives } from "@/lib/settings/contact";
import { DEFAULT_MASK_ID, getCurrentMask, getMasks } from "@/lib/settings/mask";
import { isSocialTyping, proactiveMessageReaction } from "@/lib/chat/social";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";

const STATE_KEY = "chat-proactive";
const TICK_MS = 60_000;
/** 私聊：每个角色各设「基础时间」（默认 6 小时，见 settings/chat.ts 的 proactiveBaseMinOf），
 *  实际间隔在它上下浮动；TA 自己开口时也会把这个数改掉（见 social.ts 的 proactiveMessageReaction）。 */
/** 深夜安静（23:00 - 08:00）：只管私聊主动消息。 */
const QUIET_START = 23;
const QUIET_END = 8;
/** 打开补发错峰：第 i 个会话往后挪一点，免得一开手机好几个角色同时冒出来。 */
const OPEN_BASE_MS = 20_000;
const OPEN_STEP_MS = 45_000;
const OPEN_JITTER_MS = 60_000;

/** 一个「角色 × 面具」的排期。 */
interface ConvSchedule {
  /** 已计入的「最后动静」时间（毫秒）：变了＝又有新消息，重新排。 */
  lastActivityAt?: number;
  /** 上次排期时用的「基础时间」（分钟）：它一变（TA 写回／她手动调）就重排。 */
  baseMin?: number;
  /** 下次可以考虑主动发消息的时间（毫秒）。 */
  nextChatAt?: number;
}

type Store = Record<string, ConvSchedule>;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const keyOf = (characterId: string, maskId: string) => `${characterId}::${maskId}`;

/** 下次主动私聊隔多久：按这个角色的「基础时间」上下浮动——不当钟表，活一点。
 *  基础时间只有一个来源（角色设置里那个数，TA 自己开口后也会把它改掉），
 *  所以「谁最后改的算谁的」自然成立。 */
function chatGapMs(conv: Conversation): number {
  return proactiveBaseMinOf(conv) * 60_000 * rand(0.6, 1.6);
}

function isQuiet(now: number): boolean {
  const h = new Date(now).getHours();
  return h >= QUIET_START || h < QUIET_END;
}

function lastMsgMs(conv: Conversation): number {
  const t = conv.messages[conv.messages.length - 1]?.createdAt;
  const ms = t ? Date.parse(t) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/** 这个会话该不该由引擎照看：当前面具、聊过、好友、没被拉黑／免打扰／线下。 */
function eligible(conv: Conversation, maskId: string, char?: ArchiveEntry): boolean {
  if ((conv.maskId ?? DEFAULT_MASK_ID) !== maskId) return false;
  if (conv.chatStarted !== true) return false;
  if ((conv.friendStatus ?? "normal") !== "normal") return false;
  if (conv.blocked) return false;
  if (conv.isMuted) return false;
  if (conv.offlineOpen) return false;
  if (char?.data.isAssistant === true) return false;
  return true;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** 正在飞的那几趟主动消息：别在一个 tick 里重复派。 */
const firing = new Set<string>();

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    /* 顺手把全局偏好刷进内存快照：proactive*Of 是同步判定，靠它取最新值。 */
    await getChatPrefs();
    const masks = await getMasks();
    const maskId = getCurrentMask(masks)?.id ?? DEFAULT_MASK_ID;
    const userName = (masks.find((m) => m.id === maskId)?.name ?? "").trim() || "我";
    const [convs, archives] = await Promise.all([getConversations(), getArchives()]);
    const byId = new Map(archives.map((a) => [a.id, a]));
    const store = (await kvGet<Store>(STATE_KEY)) ?? {};
    const live = convs.filter((c) => eligible(c, maskId, byId.get(c.characterId)));
    const quietNow = isQuiet(now);

    for (let i = 0; i < live.length; i++) {
      const conv = live[i];
      const char = byId.get(conv.characterId);
      if (!char) continue;
      const key = keyOf(conv.characterId, maskId);
      const st = store[key] ?? {};
      const stagger = now + OPEN_BASE_MS + i * OPEN_STEP_MS + Math.random() * OPEN_JITTER_MS;

      /* 私聊档：有新消息、或基础时间被人改过（TA 自己写回／她手动调），都按
         「最后动静 + 这个角色的间隔」重排；头一回照面的会话给个错峰。 */
      const msgMs = lastMsgMs(conv);
      const baseMin = proactiveBaseMinOf(conv);
      if (
        st.lastActivityAt === undefined ||
        msgMs > st.lastActivityAt ||
        st.baseMin !== baseMin
      ) {
        st.lastActivityAt = msgMs;
        st.baseMin = baseMin;
        st.nextChatAt = Math.max(msgMs + chatGapMs(conv), stagger);
      }

      store[key] = st;
      /* TA 正在写（别的社交反应）或这间正飞着一趟＝这轮跳过，别叠上去。 */
      if (isSocialTyping(conv.characterId, maskId) || firing.has(key)) continue;

      /* 主动私聊：要开着「主动找我」、且不落在本角色的深夜静默里；到点了才让 TA 开口。
         深夜按住不动（排期不动，安静过去了下一轮自然补上）。 */
      const quietHold = quietNow && proactiveQuietOf(conv);
      if (
        proactiveOnOf(conv) &&
        !quietHold &&
        st.nextChatAt !== undefined &&
        now >= st.nextChatAt
      ) {
        st.nextChatAt = now + proactiveBaseMinOf(conv) * 60_000;
        firing.add(key);
        const expectedLastId = conv.messages[conv.messages.length - 1]?.id;
        void proactiveMessageReaction(char, maskId, userName, expectedLastId).finally(() =>
          firing.delete(key),
        );
        continue;
      }
    }

    /* 只清「角色已经没了」的旧档；换面具不清——换回来还能接着原来的排期走。 */
    for (const k of Object.keys(store)) {
      if (!byId.has(k.split("::")[0])) delete store[k];
    }
    await kvSet(STATE_KEY, store);
  } catch {
    /* 这一轮算不动就等下一轮，别把引擎打死。 */
  } finally {
    running = false;
  }
}

/** 起引擎：立刻跑一轮（补发），之后每分钟一轮；回前台也立刻补一轮。
 *  返回停止函数，交给外壳在卸载时调用。 */
export function startProactive(): () => void {
  if (timer !== null) return () => {};
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisible);
  };
}
