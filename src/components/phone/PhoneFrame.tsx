import type { ReactNode } from "react";

/**
 * 手机舞台与外壳。
 *
 * 切换逻辑完全靠 CSS 媒体查詢（见 globals.css）：
 * - 宽屏（≥640px，电脑预览）：置中手机壳、圆角、边框、阴影、动态岛。
 * - 窄屏（真机／手机浏览器）：100vw × 100dvh 全屏，零边框。
 * 不做 JS 宽度偵测，避免摺叠屏幕／橫屏误判。
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="phone-stage">
      <div className="phone-shell">
        <div className="phone-dynamic-island" aria-hidden />
        {children}
      </div>
    </div>
  );
}
