/**
 * 星绥通讯：动态页的**通知**。
 *
 * 通知做在封面与动态卡片之间的那个位置；这里只管**通知这份数据**，
 * 长什么样、摆哪儿由 `MomentsPage` 决定
 * （摆位：封面下沿那段、信息流上头）。
 *
 * 三样东西：
 * - `moments-notices` —— 通知列表（新→旧，最多留 20 条）。**单独一个键**，
 *   不塞进 `ChatMoment`：会话列表是「每次读整份」，别给那条热路径加负担。
 * - `moments-seen-at` —— 上一次看动态页的时刻。**只有比它新的动态才算「新通知」**，
 *   不然每次进来都会把老动态又报一遍（清空之后也会自己长回来）。
 * - 通知的 `id` 是**定死**的（`动态uid::kind`），所以同一条怎么推都只留一条。
 *
 * 现在接上的真渠道只有一种：「TA 发了新动态」。
 * 赞／评论／NPC 回复那几种等互动真做那轮，直接往这儿 `pushMomentNotices` 就行，
 * 形（kind）已经按三种分好了。
 */

import { kvGet, kvSet } from "@/lib/db/idb";

/** 通知的三种形。 */
export type MomentNoticeKind = "like" | "comment" | "post";

export interface MomentNotice {
  /** 定死的（`动态uid::kind`）——同一条推两遍也只留一条。 */
  id: string;
  kind: MomentNoticeKind;
  /** 谁：名字＋头像（都从动态作者那儿来）。 */
  fromName: string;
  fromAvatar?: string;
  /** 哪个会话的：换面具、朋友被假删之后，那条通知就不该再冒出来。 */
  convId: string;
  /** 摘句（评论内容／动态正文头一句）。`like` 不用。 */
  excerpt?: string;
  createdAt: string;
}

const NOTICES_KEY = "moments-notices";
const SEEN_KEY = "moments-seen-at";

/** 最多留这么多条：通知是「一眼扫过」的东西，堆着没意义。 */
const MAX_NOTICES = 20;

export async function getMomentNotices(): Promise<MomentNotice[]> {
  return (await kvGet<MomentNotice[]>(NOTICES_KEY)) ?? [];
}

/** 上一次看动态页的时刻（ISO）。没看过＝空串 → 现有的动态全都算「新」。 */
export async function getMomentsSeenAt(): Promise<string> {
  return (await kvGet<string>(SEEN_KEY)) ?? "";
}

export async function setMomentsSeenAt(iso: string): Promise<void> {
  await kvSet(SEEN_KEY, iso);
}

/** 推几条进来（新→旧，老的往后排）。id 重复的自动丢掉。 */
export async function pushMomentNotices(list: MomentNotice[]): Promise<void> {
  if (list.length === 0) return;
  const old = await getMomentNotices();
  const had = new Set(old.map((n) => n.id));
  const fresh = list.filter((n) => !had.has(n.id));
  if (fresh.length === 0) return;
  await kvSet(NOTICES_KEY, [...fresh, ...old].slice(0, MAX_NOTICES));
}

/** 全清。 */
export async function clearMomentNotices(): Promise<void> {
  await kvSet(NOTICES_KEY, []);
}
