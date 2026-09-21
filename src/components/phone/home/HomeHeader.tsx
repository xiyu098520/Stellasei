"use client";

import { useNow } from "@/hooks/useNow";

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MONTH_CN = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

/**
 * 网格页顶部刊头（简约版，完整杂志刊头在 MagazineLayout）。
 * - 左边：STELLASEI 小字 ＋ 中文副标
 * - 右边：Playfair 时间 ＋ 日期
 * - 中间：装饰分隔线（跟杂志页风格一致的半透明渐变）
 */
export function HomeHeader() {
  const now = useNow();

  if (!now) {
    // SSR / 首次挂载前的占位，避免 layout 跳动。
    return <div className="h-[76px]" aria-hidden />;
  }

  const date = new Date(now);
  const time = date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dateLabel = `${MONTH_CN[date.getMonth()]}${date.getDate()}日 · ${WEEKDAY_CN[date.getDay()]}`;

  return (
    <div className="px-5 pb-5 pt-2">
      <div className="flex items-end justify-between mb-3">
        <div>
          <p
            className="font-serif text-[15px] tracking-[0.28em] leading-none text-black/70 pl-[0.28em]"
          >
            STELLASEI
          </p>
          <p
            className="font-song text-[10px] tracking-[0.32em] mt-1 pl-[0.32em] text-black/30"
          >
            星绥 · 星空传讯
          </p>
        </div>
        <div className="text-right">
          <p
            className="font-serif text-[22px] font-light leading-none text-black/60 tabular-nums"
          >
            {time}
          </p>
          <p className="text-[9.5px] tracking-wider text-black/28 mt-1">
            {dateLabel}
          </p>
        </div>
      </div>

      {/* 装饰分割线：半透明渐变 ＋ 四角装饰点（杂志页同样式） */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-black/12 to-transparent" />
        <div className="w-1 h-1 bg-black/28 rotate-45" />
        <div className="w-1.5 h-1.5 rounded-full border border-black/18" />
        <div className="w-1 h-1 bg-black/28 rotate-45" />
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-black/12 to-transparent" />
      </div>
    </div>
  );
}
