"use client";

/**
 * 存储体检（设置 App 内页）。
 *
 * 目的只有一个：把「到底是谁把空间吃了」变成看得见的数字。
 * 上面那个数是星绥自己的数据（逐条数出来的），下面那个数是浏览器报的整站占用
 * 与手机给的额度；两个数对不上是正常的（差额是缓存等我们数不到的东西）。
 * 只读不写：本页不会删任何东西。
 *
 * 皮肤：撞色贴纸（恩熙 2026-09-20 定），底料与配色取自 pop-style.ts。
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { POP_CARD, POP_TONE } from "@/components/phone/apps/pop-style";
import { formatBytes, scanStorageSpace, type StorageSnapshot } from "@/lib/db/storage-space";

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

function SectionLabel({ children, tone }: { children: string; tone: "blue" | "orange" }) {
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
  const [scanning, setScanning] = useState(true);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      setSnapshot(await scanStorageSpace());
    } catch {
      setSnapshot(null);
    } finally {
      setScanning(false);
    }
  }, []);

  /* 初次进入自动数一遍。没有直接调 runScan：在 effect 里同步 setState 会触发级联
     渲染（eslint 也会拦），所以第一遍自己走，只在拿到结果之后才更新状态。 */
  useEffect(() => {
    let alive = true;
    scanStorageSpace()
      .then((result) => {
        if (alive) setSnapshot(result);
      })
      .catch(() => {
        if (alive) setSnapshot(null);
      })
      .finally(() => {
        if (alive) setScanning(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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

      <button type="button" onClick={() => void runScan()} disabled={scanning} className={POP_BTN}>
        <RefreshCw size={16} strokeWidth={2.2} className={scanning ? "animate-spin" : ""} />
        {scanning ? "正在统计…" : "重新统计"}
      </button>
    </div>
  );
}
