/**
 * 媒体仓库的收尾：把**没人认领的图**收走。
 *
 * 【为什么需要】图片本体住在独立仓库里（`stellasei-media`），消息／动态／卡面这些地方
 * 只留一句引用串。删消息的时候顺手回收那一张（见 `releaseImageAsset`）——可这条路
 * 只有「谁删谁知道」，凡是**删的时候没想到图**的地方，引用串一断，那张图就永远躺在
 * 仓库里没人管：真删好友（`hardDeleteFriend`）、换掉的参考图与卡面、老版本没来得及
 * 回收的那些。仓库只进不出，储存体检上那个数字就再也掉不下来。
 *
 * 【怎么认人】不查任何一张表，改成**反着扫**：把整库（`stellasei-new` 的 kv）逐条读一遍，
 * 把所有出现过的 `media-store://…` 抠出来——谁被写着就是「有人认领」。仓库里那些
 * 不在名单上的，就是断链的孤儿，收走。
 * 这么做的好处是**跟表结构无关**：日后哪儿又多了一个存图的地方（新字段、新名单），
 * 只要它落在 kv 里，这里自动认得，不必回来补一行。
 *
 * 【两条铁规矩】
 * 1. **读不全就整体不动**：扫库途中出任何岔子，一张都不删。宁可留垃圾，绝不误删。
 * 2. **刚出生的不收**：一分钟以内入库的图先放过（`GRACE_MS`）——那些多半正躺在
 *    某个还没落库的草稿里（刚挑好的红包封面、刚生成还没写回消息的那张），
 *    这会儿它们还没进 kv，扫出来就是「没人认领」，收走就是把人家正在用的图删了。
 *
 * 只在客户端调用（IndexedDB 不存在于 SSR）。
 */

import { disposeMediaBlob, eachMediaSummary, MEDIA_REF_PREFIX } from "@/lib/db/media-store";
import { kvEach } from "@/lib/db/idb";

/** 引用串的形状：前缀 + `mc_…`。取景后缀（`#p=…`）跟在后面，不属于 id，所以这里不吃 `#`。 */
const REF_RE = /media-store:\/\/[A-Za-z0-9_.-]+/g;

/** 一分钟以内入库的先放过（见文件头第 2 条）。 */
const GRACE_MS = 60_000;

/** 把一份 kv 值里藏着的引用串全抠出来（值可能嵌了好几层：会话里是消息数组、
   消息里还有封面串）。非字符串一律往下走，不碰 Blob 这类没有可读键的东西。 */
function collectRefs(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (!value.includes(MEDIA_REF_PREFIX)) return;
    for (const hit of value.matchAll(REF_RE)) into.add(hit[0]);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) collectRefs(item, into);
}

export interface MediaSweepResult {
  /** 收走的张数（`dryRun` 时＝**待收**的张数）。 */
  removed: number;
  /** 收走的体积（字节；`dryRun` 时＝待收的体积）。 */
  removedBytes: number;
  /** 还有人认领、原地留下的张数。 */
  kept: number;
  /** 扫库没读全，这一趟什么都没做——调用方据此别急着报「已清空」。 */
  aborted: boolean;
  /** 只数不删（存储体检页拿它先报个数）。 */
  dryRun: boolean;
}

/**
 * 扫一遍仓库，收走没人认领的图。
 *
 * 它在「清空记忆」「清空聊天记录」「真删好友」之后跟着跑：那几笔动作删掉的引用是明的，
 * 而这里兜的是**所有**断链的（包括这次动作之外的、历年攒下的）。
 * 不抛错：清理是收尾，出岔子就安静过，绝不挡用户手上那件事。
 *
 * 传 `{ dryRun: true }` 就只数不删——存储体检页要先把「能腾出多少」报出来，
 * 再让用户按那颗按钮（见 `StorageCheckPanel`）。
 */
export async function sweepOrphanMedia(
  options: { dryRun?: boolean } = {},
): Promise<MediaSweepResult> {
  const dryRun = options.dryRun === true;
  const claimed = new Set<string>();
  try {
    await kvEach((_key, value) => collectRefs(value, claimed));
  } catch {
    /* 读不全＝名单不可信，一张都不动。 */
    return { removed: 0, removedBytes: 0, kept: 0, aborted: true, dryRun };
  }

  const now = Date.now();
  const orphans: { id: string; size: number }[] = [];
  let kept = 0;
  try {
    await eachMediaSummary((item) => {
      if (claimed.has(item.id)) {
        kept += 1;
        return;
      }
      if (now - item.createdAt < GRACE_MS) {
        /* 刚落库、还没写进 kv 的（正当用着），当它有主。 */
        kept += 1;
        return;
      }
      orphans.push({ id: item.id, size: item.size });
    });
  } catch {
    return { removed: 0, removedBytes: 0, kept, aborted: true, dryRun };
  }

  const removedBytes = orphans.reduce((sum, item) => sum + item.size, 0);
  if (dryRun) {
    return { removed: orphans.length, removedBytes, kept, aborted: false, dryRun };
  }

  let removed = 0;
  for (const item of orphans) {
    try {
      await disposeMediaBlob(item.id);
      removed += 1;
    } catch {
      /* 一张没收掉不挡后面的——下一次清空时还会再扫到它。 */
    }
  }
  return { removed, removedBytes, kept, aborted: false, dryRun };
}