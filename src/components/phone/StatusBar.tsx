"use client";

import { useNow } from "@/hooks/useNow";

/**
 * 极简状态栏：左侧时间，右侧信号／电量符号（一期纯视觉）。
 * 顶部留白吃安全区变数，避开劉海与动态岛。
 *
 * @param light 深色背景页（星空／开屏）传 true，改用浅色文字。
 */
export function StatusBar({ light = false }: { light?: boolean }) {
  const now = useNow();
  const time = now
    ? new Date(now).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--:--";

  return (
    <div
      className={`sim-status-bar pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between px-7 text-[13px] font-medium ${
        light ? "text-white/90" : "text-[#2a2740]"
      }`}
      style={{ paddingTop: "calc(var(--safe-area-top) + 10px)", minHeight: 44 }}
    >
      <span className="w-16 tabular-nums tracking-wide">{time}</span>
      <div className="flex items-center gap-1.5" aria-hidden>
        {/* 信号 */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" opacity="0.35" />
        </svg>
        {/* 电池 */}
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect
            x="0.5"
            y="0.5"
            width="21"
            height="11"
            rx="3"
            stroke="currentColor"
            opacity="0.45"
          />
          <rect x="2" y="2" width="16" height="8" rx="1.5" fill="currentColor" />
          <rect x="22.5" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.45" />
        </svg>
      </div>
    </div>
  );
}
