/**
 * 动态互动引擎：TA 看见动态，自己决定要不要点赞、要不要留一句评论（2026-10-05）。
 *
 * 恩熙定的原则：**TA 跟我一样是活在这世界里的真人，只是靠这个小手机联系**——
 * 我能给动态点赞、评论，TA 也能；我发的、TA 自己发的、别的角色发的，都在 TA 能看见的范围内。
 * 这一层只管「TA 什么时候赞、赞不赞；什么时候评、评什么」：排期存 IndexedDB，重开不丢。
 *
 * 分工：
 * - 「要不要赞」「写什么评论」在 social.ts（`generateMomentLikeDecision`／
 *   `generateMomentComment`，各一趟轻量文本接口）；
 * - 落库用 settings/chat.ts 的 `setMomentLikes`／`setSelfMomentLikes`／
 *   `setMomentComments`／`setSelfMomentComments`（整份覆盖）；
 * - 「谁看得见这条动态」跟「我发的动态谁能看」同一个口径（见 my-moments.ts）——
 *   public 全见 / private 谁都看不见 / partial 看名单与世界。
 *
 * **施工分三轮做**（恩熙定的顺序，2026-10-05）：
 * ① 现在：**我发的动态**，能看见的角色一律「立即」点赞＋评一句——先不判人设、不延迟，
 *    把「TA 会回我」这条最小的线跑通（见 `consider()`／`runJob()` 里的阶段①注释）；
 * ② 再让点赞、评论都**随人设判断**要不要回；
 * ③ 最后再决定**要不要延迟**（那时才启用「隔一会儿」那套开关）。
 *
 * 「隔一会儿／2～15 分钟（可设）」的延迟逻辑只作用于 **TA 自己发的、别的角色的动态**；
 * 我发的动态在阶段①一律立即回。
 *
 * ⚠️ 点赞／评论决策**都不走** `queueReaction`：那会亮聊天窗的「正在输入」灯，
 * 可点赞、评论都不该亮灯。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import {
  convId,
  getConversations,
  getSelfMoments,
  setMomentComments,
  setMomentLikes,
  setSelfMomentComments,
  setSelfMomentLikes,
} from "@/lib/settings/chat";
import { getArchives } from "@/lib/settings/contact";
import { DEFAULT_MASK_ID, getCurrentMask, getMasks } from "@/lib/settings/mask";
import {
  generateMomentComment,
  generateMomentLikeDecision,
  isSocialTyping,
} from "@/lib/chat/social";
import { pushMomentNotices } from "@/lib/chat/moments-notice";
import { uuid } from "@/lib/uuid";
import { MOMENT_SELF_ID } from "@/types/chat";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation, MomentComment, MomentLike, MomentVisibility } from "@/types/chat";

const STATE_KEY = "chat-moment-social";
const TICK_MS = 60_000;
const HOUR = 3_600_000;
/** 超过这么久以前的动态不再补赞：手机没开那阵子的旧动态，不值得回头去赞。 */
const MAX_BACKLOG_MS = 2 * HOUR;
/** 一轮最多处理几个（每个 random 决策都要过一趟文本接口，别一口气堵死）。 */
const MAX_PER_TICK = 6;
/** seen 只留最近这些条，够覆盖前面那两小时窗口即可。 */
const MAX_SEEN = 1000;
/** 排期最多攒这么多，超了先保住最近到点的。 */
const MAX_JOBS = 400;

/** 引擎眼里的一条动态（不管是 TA 的还是我的）。 */
interface MomentRef {
  /** self＝我发的；char＝角色发的。 */
  owner: "self" | "char";
  maskId: string;
  /** 角色动态所在会话 id；我的动态为空串。 */
  convId: string;
  /** 作者：`MOMENT_SELF_ID`（我）或角色 id。 */
  authorId: string;
  /** 作者名（自赞／跨角色判断时告诉模型「作者是谁」）。 */
  authorName: string;
  momentId: string;
  createdAt: string;
  visibility: MomentVisibility;
  visibleTo?: string[];
  visibleWorlds?: string[];
}

/** 角色能在动态底下办的一件事：点赞／评论。 */
type SocialAction = "like" | "comment";

/** 一个待办：某个角色在某个时刻，去给某条动态点赞、或留一句评论。 */
interface SocialJob {
  /** `动态uid::动作::角色id`——同一条动态、同一个角色、同一个动作只会有一件。 */
  id: string;
  action: SocialAction;
  viewerId: string;
  ref: MomentRef;
  /** 到期时间（毫秒）。 */
  dueAt: number;
}

/** 排期表的版本：结构变了就把旧 jobs 清掉重排（seen 留着，不重复回赞老动态）。 */
const JOBS_VERSION = 2;

interface Store {
  /** 首次运行标记：头一回只把现存动态记成「已见」，不补赞。 */
  inited?: boolean;
  /** 排期表结构版本；对不上就清空 jobs。 */
  v?: number;
  /** 已经发现过的动态 uid（同一条不再重复排期）。 */
  seen: string[];
  jobs: SocialJob[];
}

/** 引擎视角里「当前面具下活着的一个角色」。 */
interface Peer {
  id: string;
  name: string;
  avatar: string;
  categoryId: string;
}

function refUid(ref: MomentRef): string {
  return `${ref.owner}::${ref.maskId}::${ref.convId}::${ref.momentId}`;
}

function peerName(char: ArchiveEntry): string {
  return (char.data.name || char.data.nickname || "TA").trim() || "TA";
}

/** 这个会话该不该由引擎照看：当前面具、聊过、好友、没被拉黑／免打扰／线下。
 *  与 proactive.ts 的 eligible 同口径——不在这里另立一套标准。 */
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

/** 当前面具下「活着的角色」们（可当观众，也可能是别的动态的作者）。 */
function peersOf(
  convs: Conversation[],
  byId: Map<string, ArchiveEntry>,
  maskId: string,
): Peer[] {
  const out: Peer[] = [];
  for (const conv of convs) {
    const char = byId.get(conv.characterId);
    if (!char || !eligible(conv, maskId, char)) continue;
    out.push({
      id: char.id,
      name: peerName(char),
      avatar: char.data.photo ?? "",
      categoryId: char.categoryId,
    });
  }
  return out;
}

/** 这条动态都有谁能看见（谁就有机会去赞）。与 my-moments.ts 的 filterVisibleMyMoments 同口径。
 *  private＝谁都不给；public＝当前面具下活着的角色全都给；partial＝看名单与世界。
 *  角色自己发的动态：作者恒含（TA 自己总能看见、也就能顺手自赞）。 */
function viewersFor(ref: MomentRef, peers: Peer[]): Peer[] {
  if (ref.visibility === "private") return [];
  if (ref.visibility === "public") return peers;
  const out = peers.filter(
    (p) =>
      (ref.visibleTo ?? []).includes(p.id) ||
      (ref.visibleWorlds ?? []).includes(p.categoryId),
  );
  if (ref.owner === "char") {
    const author = peers.find((p) => p.id === ref.authorId);
    if (author && !out.some((p) => p.id === author.id)) out.push(author);
  }
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const masks = await getMasks();
    const mask = getCurrentMask(masks);
    const maskId = mask?.id ?? DEFAULT_MASK_ID;
    const userName = (mask?.name ?? "").trim() || "我";
    const [convs, archives, selfMoments] = await Promise.all([
      getConversations(),
      getArchives(),
      getSelfMoments(maskId),
    ]);
    const byId = new Map(archives.map((a) => [a.id, a]));
    const store: Store = (await kvGet<Store>(STATE_KEY)) ?? { seen: [], jobs: [] };
    if (!Array.isArray(store.seen)) store.seen = [];
    /* 排期表结构变了（比如这轮加了评论 job）：旧格式的 jobs 一律作废重排。 */
    if (store.v !== JOBS_VERSION) {
      store.jobs = [];
      store.v = JOBS_VERSION;
    }
    if (!Array.isArray(store.jobs)) store.jobs = [];
    const seen = new Set(store.seen);

    const charRef = (conv: Conversation, char: ArchiveEntry, m: { id: string; createdAt: string; visibility?: MomentVisibility; visibleTo?: string[]; visibleWorlds?: string[] }): MomentRef => ({
      owner: "char",
      maskId,
      convId: conv.id,
      authorId: char.id,
      authorName: peerName(char),
      momentId: m.id,
      createdAt: m.createdAt,
      visibility: m.visibility ?? "public",
      visibleTo: m.visibleTo,
      visibleWorlds: m.visibleWorlds,
    });

    const selfRef = (m: { id: string; createdAt: string; visibility?: MomentVisibility; visibleTo?: string[]; visibleWorlds?: string[] }): MomentRef => ({
      owner: "self",
      maskId,
      convId: "",
      authorId: MOMENT_SELF_ID,
      authorName: userName,
      momentId: m.id,
      createdAt: m.createdAt,
      visibility: m.visibility ?? "public",
      visibleTo: m.visibleTo,
      visibleWorlds: m.visibleWorlds,
    });

    /* 首次运行：把现存动态全部记成「已见」，不排期——总不能一装上就给历史动态点一串赞。 */
    if (!store.inited) {
      for (const conv of convs) {
        const char = byId.get(conv.characterId);
        if (!char || !eligible(conv, maskId, char)) continue;
        for (const m of conv.moments ?? []) seen.add(refUid(charRef(conv, char, m)));
      }
      for (const m of selfMoments) seen.add(refUid(selfRef(m)));
      store.inited = true;
      store.seen = [...seen].slice(-MAX_SEEN);
      store.jobs = [];
      await kvSet(STATE_KEY, store);
      return;
    }

    /* 发现新动态，按「谁看得见」排期。 */
    const peers = peersOf(convs, byId, maskId);
    const fresh: SocialJob[] = [];
    const consider = (ref: MomentRef) => {
      const uid = refUid(ref);
      if (seen.has(uid)) return;
      seen.add(uid);
      const ms = Date.parse(ref.createdAt);
      /* 太久远（或时间戳坏了）＝只记「已见」，不排期。 */
      if (!Number.isFinite(ms) || now - ms > MAX_BACKLOG_MS) return;
      const isSelfMoment = ref.owner === "self";
      for (const v of viewersFor(ref, peers)) {
        fresh.push({
          id: `${uid}::like::${v.id}`,
          action: "like",
          viewerId: v.id,
          ref,
          /* 一律立即赞：延迟／回不回那套开关已删除，看见就赞。 */
          dueAt: now,
        });
        /* 阶段①：**我发的动态**，能看见的角色一律到评论区留一句（立即）。
         * 把「TA 会回我」这条最小的线跑通；随人设判断、要不要延迟，留到阶段②③。 */
        if (isSelfMoment) {
          fresh.push({
            id: `${uid}::comment::${v.id}`,
            action: "comment",
            viewerId: v.id,
            ref,
            dueAt: now,
          });
        }
      }
    };
    for (const conv of convs) {
      const char = byId.get(conv.characterId);
      if (!char || !eligible(conv, maskId, char)) continue;
      for (const m of conv.moments ?? []) consider(charRef(conv, char, m));
    }
    for (const m of selfMoments) consider(selfRef(m));

    const merged = new Map<string, SocialJob>();
    for (const job of store.jobs) merged.set(job.id, job);
    for (const job of fresh) merged.set(job.id, job);
    const jobs = [...merged.values()].sort((a, b) => a.dueAt - b.dueAt).slice(0, MAX_JOBS);

    /* 到点的依次去办；办完不管成没成都不再重排（一次机会，不没完没了地试）。 */
    const remaining: SocialJob[] = [];
    let processed = 0;
    for (const job of jobs) {
      if (job.dueAt > now || processed >= MAX_PER_TICK) {
        remaining.push(job);
        continue;
      }
      /* 这个角色正在写别的社交反应＝让一让，下一轮再来。 */
      if (isSocialTyping(job.viewerId, job.ref.maskId)) {
        remaining.push(job);
        continue;
      }
      processed++;
      const viewer = byId.get(job.viewerId);
      if (viewer) {
        try {
          if (job.action === "comment") {
            await runCommentJob(job, viewer, userName, byId);
          } else {
            await runJob(job, viewer, userName, byId);
          }
        } catch {
          /* 一条失败不影响下一条；这轮算不动就等下一轮，别把引擎打死。 */
        }
      }
    }

    store.jobs = remaining;
    store.seen = [...seen].slice(-MAX_SEEN);
    await kvSet(STATE_KEY, store);
  } catch {
    /* 这一轮算不动就等下一轮，别把引擎打死。 */
  } finally {
    running = false;
  }
}

/** 办一件到期的点赞：到点再核一遍可见性与现状，再问 TA 要不要赞，赞了落库＋广播。 */
async function runJob(
  job: SocialJob,
  viewer: ArchiveEntry,
  userName: string,
  byId: Map<string, ArchiveEntry>,
): Promise<void> {
  const { ref, viewerId } = job;
  const maskId = ref.maskId;
  /* 排期时手机可能关了很久：这条动态已经太旧就作罢。 */
  const createdMs = Date.parse(ref.createdAt);
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > MAX_BACKLOG_MS) return;

  const [convs, selfMoments] = await Promise.all([
    getConversations(),
    getSelfMoments(maskId),
  ]);
  /* 隔了这么久，作者可能把动态删了、或改了可见范围——到点再核一遍。 */
  if (!viewersFor(ref, peersOf(convs, byId, maskId)).some((p) => p.id === viewerId)) return;

  let likes: MomentLike[];
  let content = "";
  if (ref.owner === "char") {
    const conv = convs.find((c) => c.id === ref.convId);
    const m = conv?.moments?.find((x) => x.id === ref.momentId);
    if (!m) return;
    likes = m.likes ?? [];
    content = m.content;
  } else {
    const m = selfMoments.find((x) => x.id === ref.momentId);
    if (!m) return;
    likes = m.likes ?? [];
    content = m.content;
  }
  /* 已经被赞过（角色自己、或我在别处手动赞的）＝不重复。 */
  if (likes.some((l) => l.byId === viewerId)) return;

  /* 我发的动态一律赞（不判人设）；别人的动态仍走决策。 */
  if (ref.owner !== "self") {
    const conv = convs.find((c) => c.id === convId(viewerId, maskId));
    if (!conv) return;
    const decided = await generateMomentLikeDecision(viewer, conv, userName, {
      authorName: ref.authorName,
      isSelfAuthor: false,
      content,
    });
    /* 只有明确说「赞」才赞；说「不赞」或答不出（接口没配／失败）都作罢。 */
    if (decided !== true) return;
  }

  const like: MomentLike = {
    byId: viewerId,
    byName: peerName(viewer),
    ...(viewer.data.photo ? { byAvatar: viewer.data.photo } : {}),
    at: new Date().toISOString(),
  };
  const next = [...likes, like];
  if (ref.owner === "char") {
    await setMomentLikes(ref.convId, ref.momentId, next);
  } else {
    await setSelfMomentLikes(maskId, ref.momentId, next);
  }

  /* 赞的是**我的**动态 → 往通知栏投一条（角色赞角色不算我的通知）。 */
  if (ref.owner === "self") {
    await pushMomentNotices([
      {
        id: `${refUid(ref)}::like::${viewerId}`,
        kind: "like",
        fromName: like.byName,
        ...(like.byAvatar ? { fromAvatar: like.byAvatar } : {}),
        convId: convId(viewerId, maskId),
        createdAt: like.at,
      },
    ]);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("moments-updated"));
  }
}

/** 办一件到期的评论：到点再核一遍可见性与现状，问 TA 写一句，落库＋广播＋投通知。 */
async function runCommentJob(
  job: SocialJob,
  viewer: ArchiveEntry,
  userName: string,
  byId: Map<string, ArchiveEntry>,
): Promise<void> {
  const { ref, viewerId } = job;
  const maskId = ref.maskId;
  /* 排期时手机可能关了很久：这条动态已经太旧就作罢。 */
  const createdMs = Date.parse(ref.createdAt);
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > MAX_BACKLOG_MS) return;

  const [convs, selfMoments] = await Promise.all([
    getConversations(),
    getSelfMoments(maskId),
  ]);
  /* 隔了这么久，作者可能把动态删了、或改了可见范围——到点再核一遍。 */
  if (!viewersFor(ref, peersOf(convs, byId, maskId)).some((p) => p.id === viewerId)) return;

  let comments: MomentComment[];
  let content = "";
  if (ref.owner === "char") {
    const conv = convs.find((c) => c.id === ref.convId);
    const m = conv?.moments?.find((x) => x.id === ref.momentId);
    if (!m) return;
    comments = m.comments ?? [];
    content = m.content;
  } else {
    const m = selfMoments.find((x) => x.id === ref.momentId);
    if (!m) return;
    comments = m.comments ?? [];
    content = m.content;
  }
  /* 已经评过（TA 自己先前留过、或我在别处代它评过）＝不重复。 */
  if (comments.some((c) => c.byId === viewerId)) return;

  const conv = convs.find((c) => c.id === convId(viewerId, maskId));
  if (!conv) return;
  const texts = await generateMomentComment(viewer, conv, userName, {
    authorName: ref.authorName,
    isSelfAuthor: ref.owner === "self",
    content,
  });
  /* 接口没配／失败／空产出：这轮算不动就作罢，不硬凑一句假评论。 */
  if (!texts || texts.length === 0) return;

  const at = new Date().toISOString();
  const fresh: MomentComment[] = texts.map((content) => ({
    id: uuid(),
    byId: viewerId,
    byName: peerName(viewer),
    ...(viewer.data.photo ? { byAvatar: viewer.data.photo } : {}),
    content,
    at,
  }));
  const next = [...comments, ...fresh];
  if (ref.owner === "char") {
    await setMomentComments(ref.convId, ref.momentId, next);
  } else {
    await setSelfMomentComments(maskId, ref.momentId, next);
  }

  /* 评的是**我的**动态 → 往通知栏投（角色评角色不算我的通知）。 */
  if (ref.owner === "self") {
    await pushMomentNotices(
      fresh.map((c) => ({
        id: `${refUid(ref)}::comment::${viewerId}::${c.id}`,
        kind: "comment" as const,
        fromName: c.byName,
        ...(c.byAvatar ? { fromAvatar: c.byAvatar } : {}),
        convId: convId(viewerId, maskId),
        excerpt: c.content,
        createdAt: c.at,
      })),
    );
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("moments-updated"));
  }
}

/** 摇一下引擎：新动态刚落地（我发了／TA 发了）时立刻跑一轮，别干等下一分钟。
 *  正在跑就并进去——tick 自带重入锁，跑完这一轮下一轮自然把新动态收进来。 */
export function kickMomentSocial(): void {
  void tick();
}

/** 起引擎：立刻跑一轮（补发），之后每分钟一轮；回前台也补一轮；新动态落地也摇一下。
 *  返回停止函数，交给外壳在卸载时调用。 */
export function startMomentSocial(): () => void {
  if (timer !== null) return () => {};
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("moments-updated", kickMomentSocial);
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("moments-updated", kickMomentSocial);
  };
}
