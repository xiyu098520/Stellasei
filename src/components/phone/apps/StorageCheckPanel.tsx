"use client";

/**
 * 存储体检（设置 App 内页）。
 *
 * 目的只有一个：把「到底是谁把空间吃了」变成看得见的数字。
 * 上面那个数是星绥自己的数据（逐条数出来的），下面那个数是浏览器报的整站占用
 * 与手机给的额度；两个数对不上是正常的（差额是缓存等我们数不到的东西）。
 *
 * 这一页只动一处：**收走没人认领的图**（第三张卡那颗粉按钮）。删消息、真删好友、
 * 换掉参考图与卡面之后，图本体还留在图片仓库里没人过问——这里先把「能腾出多少」
 * 数出来给她看，她按了才真删（见 `lib/chat/media-sweep`，那儿也是清空记忆／
 * 清空聊天记录跟着跑的那一趟）。除此之外本页不碰任何数据。
 *
 * 皮肤：撞色贴纸，底料与配色取自 pop-style.ts。
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { POP_CARD, POP_TONE } from "@/components/phone/apps/pop-style";
import { formatBytes, scanStorageSpace, type StorageSnapshot } from "@/lib/db/storage-space";
import { sweepOrphanMedia, type MediaSweepResult } from "@/lib/chat/media-sweep";

/** 分类配色：撞色盘，五类仍要一眼分得开（other 用灰，表示「杂项」）。 */
const CATEGORY_COLOR: Record<string, string> = {
  chat: POP_TONE.orange,
  media: POP_TONE.blue,
  archives: POP_TONE.purple,
  memories: POP_TONE.mint,
  other: "#B0AEA8",
};

/** 一行两端的排版。 */
const ROW = "flex items-center justify-between border-t-2 border-dashed border-[#EDEAE2] py-3 first:border-t-0 first:pt-0";

/** 主按钮（重新统计）：柠檬黄打底，按下往阴影里沉（只动 transform）。 */
const POP_BTN =
  "flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-[#141414] bg-[#D9F24D] px-4 py-3.5 text-[14px] font-bold text-[#141414] shadow-[3px_3px_0_#141414] transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-50";

function SectionLabel({ children, tone }: { children: string; tone: "blue" | "orange" | "pink" }) {
  return (
    <span
      className="mb-3 inline-block rounded-full border-2 border-[#141414] px-3 py-1 text-[11px] font-extrabold tracking-wide shadow-[2px_2px_0_#141414]"
      style={{ background: POP_TONE[tone] }}
    >
      {children}
    </span>
  );
}

export function StorageCheckPanel() {
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null);
  /** 没人认领的图（只数不删的那一趟结果）。 */
  const [orphans, setOrphans] = useState<MediaSweepResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [clearing, setClearing] = useState(false);
  /** 刚收走那一趟的回执（按下按钮之后才出现的那枚标签）。 */
  const [justCleared, setJustCleared] = useState<MediaSweepResult | null>(null);

  /** 数两样：星绥自己的数据 ＋ 仓库里没人认领的图（后者只数不删）。 */
  const loadAll = useCallback(async () => {
    const [snap, pending] = await Promise.all([
      scanStorageSpace().catch(() => null),
      sweepOrphanMedia({ dryRun: true }).catch(() => null),
    ]);
    return { snap, pending };
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setJustCleared(null);
    const { snap, pending } = await loadAll();
    setSnapshot(snap);
    setOrphans(pending);
    setScanning(false);
  }, [loadAll]);

  /* 初次进入自动数一遍。没有直接调 runScan：在 effect 里同步 setState 会触发级联
     渲染（eslint 也会拦），所以第一遍自己走，只在拿到结果之后才更新状态。 */
  useEffect(() => {
    let alive = true;
    loadAll()
      .then(({ snap, pending }) => {
        if (!alive) return;
        setSnapshot(snap);
        setOrphans(pending);
      })
      .finally(() => {
        if (alive) setScanning(false);
      });
    return () => {
      alive = false;
    };
  }, [loadAll]);

  /** 收走没人认领的图，再数一遍（总数与待收数都会跟着掉下来）。 */
  const clearOrphans = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    const done = await sweepOrphanMedia().catch(() => null);
    setJustCleared(done && !done.aborted && done.removed > 0 ? done : null);
    const { snap, pending } = await loadAll();
    setSnapshot(snap);
    setOrphans(pending);
    setClearing(false);
  }, [clearing, loadAll]);

  const pendingCount = orphans?.removed ?? 0;
  const pendingBytes = orphans?.removedBytes ?? 0;
  /* 数不出来（扫库没读全）时别摆一个「0 张」——那会让人以为干净了。 */
  const sweepUnknown = !scanning && !orphans;
  const canClear = !scanning && !clearing && pendingCount > 0;

  const totalBytes = snapshot?.totalBytes ?? 0;
  const quotaBytes = snapshot?.quotaBytes ?? 0;
  const usedBytes = snapshot?.usedBytes ?? 0;
  const usedPercent = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

  /* 额度这两行是问浏览器要的，有的机型/隐私模式就是不给。拿不到时要说清楚
     「是设备没给」，不能只留一条横线——那看着像坏了。 */
  const quotaKnown = quotaBytes > 0;
  const quotaPending = scanning && !snapshot;
  const quotaUnknownText = quotaPending ? "…" : "设备未提供";
  const quotaHint = snapshot?.storageApiAvailable
    ? "浏览器这次没给这个数（部分机型、隐私模式下会这样），不影响使用。"
    : "这台设备的浏览器不提供这个数（系统版本偏旧），不影响使用。";

  return (
    <div className="space-y-5">
      {/* 星绥自己的数据 */}
      <div className={POP_CARD + " px-5 py-5"}>
        <SectionLabel tone="blue">Stellasei · 星绥的数据</SectionLabel>
        <div className="text-[34px] font-extrabold leading-none tracking-tight text-[#141414]">
          {scanning ? "统计中…" : formatBytes(totalBytes)}
        </div>

        {snapshot ? (
          <>
            {/* 占比条：一条白槽＋几段撞色 */}
            <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full border-2 border-[#141414] bg-white">
              {snapshot.categories.map((item) =>
                item.bytes > 0 && totalBytes > 0 ? (
                  <div
                    key={item.id}
                    style={{
                      width: `${(item.bytes / totalBytes) * 100}%`,
                      backgroundColor: CATEGORY_COLOR[item.id],
                    }}
                  />
                ) : null,
              )}
            </div>

            <div className="mt-4 space-y-3">
              {snapshot.categories.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-[4px] border-2 border-[#141414]"
                    style={{ backgroundColor: CATEGORY_COLOR[item.id] }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-[#141414]">{item.label}</div>
                    <div className="mt-0.5 text-[11px] font-medium leading-relaxed text-[#8C8C8C]">
                      {item.description}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13px] font-extrabold text-[#141414]">
                      {formatBytes(item.bytes)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-medium text-[#8C8C8C]">
                      {item.count} {item.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* 浏览器/手机这边看到的 */}
      <div className={POP_CARD + " px-5 py-5"}>
        <SectionLabel tone="orange">Browser · 站点与额度</SectionLabel>

        <div>
          <div className={ROW}>
            <span className="text-[13px] font-bold text-[#141414]">站点总占用</span>
            <span className="text-[14px] font-extrabold text-[#141414]">
              {quotaKnown ? formatBytes(usedBytes) : quotaUnknownText}
            </span>
          </div>
          <div className={ROW}>
            <span className="text-[13px] font-bold text-[#141414]">手机给的额度</span>
            <span className="text-[14px] font-extrabold text-[#141414]">
              {quotaKnown ? formatBytes(quotaBytes) : quotaUnknownText}
            </span>
          </div>
          <div className={ROW}>
            <span className="text-[13px] font-bold text-[#141414]">占用比例</span>
            <span className="text-[14px] font-extrabold text-[#141414]">
              {quotaKnown
                ? `${usedPercent < 1 ? usedPercent.toFixed(2) : usedPercent.toFixed(1)}%`
                : quotaUnknownText}
            </span>
          </div>
        </div>

        <p className="mt-4 text-[11px] font-medium leading-relaxed text-[#8C8C8C]">
          {quotaKnown || quotaPending
            ? "「站点总占用」是浏览器报的整个站点用量，含缓存等数不到的部分，所以通常比上面的星绥数据大一点；「额度」是手机给这个站点的上限，满了才会写不进去。"
            : `这几行空着不是坏了——${quotaHint}上面那笔「星绥的数据」是我们自己一条条数出来的，照样准。`}
        </p>
      </div>

      {/* 图片仓库：没人认领的图 */}
      <div className={POP_CARD + " px-5 py-5"}>
        <SectionLabel tone="pink">Clear · 清除缓存</SectionLabel>

        <div className="flex items-end gap-2">
          <span className="text-[34px] font-extrabold leading-none tracking-tight text-[#141414]">
            {scanning ? "统计中…" : sweepUnknown ? "—" : formatBytes(pendingBytes)}
          </span>
          {!scanning && !sweepUnknown ? (
            <span className="pb-1 text-[12px] font-bold text-[#8C8C8C]">{pendingCount} 张</span>
          ) : null}
        </div>

        <p className="mt-3 text-[11px] font-medium leading-relaxed text-[#8C8C8C]">
          {sweepUnknown
            ? "这一趟没数出来（仓库这次读不全）。数不全就一张都不会动，换「重新统计」再试一次。"
            : "这里说的「缓存」不是临时文件，是没有人再用的图——删掉的消息、真删掉的好友、换掉的参考图或卡面留下的，图本体还躺在图片仓库里占着位置。收走它们，聊天里还看得见的图一张都不会动。"}
        </p>

        {justCleared ? (
          <span
            className="mt-3 inline-block rounded-full border-2 border-[#141414] px-3 py-1 text-[11px] font-extrabold shadow-[2px_2px_0_#141414]"
            style={{ background: POP_TONE.pink }}
          >
            已收走 {justCleared.removed} 张 · 腾出 {formatBytes(justCleared.removedBytes)}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void clearOrphans()}
          disabled={!canClear}
          className={POP_BTN + " mt-4"}
          /* 形状照主按钮，底换成粉：这一页里「清理」是要紧事，跟「重新统计」那颗黄的分开。 */
          style={{ background: POP_TONE.pink }}
        >
          <Trash2 size={16} strokeWidth={2.2} />
          {clearing
            ? "正在收走…"
            : scanning
              ? "正在统计…"
              : canClear
                ? `收走这 ${pendingCount} 张`
                : "没有可收的"}
        </button>
      </div>

      <button type="button" onClick={() => void runScan()} disabled={scanning} className={POP_BTN}>
        <RefreshCw size={16} strokeWidth={2.2} className={scanning ? "animate-spin" : ""} />
        {scanning ? "正在统计…" : "重新统计"}
      </button>
    </div>
  );
}
