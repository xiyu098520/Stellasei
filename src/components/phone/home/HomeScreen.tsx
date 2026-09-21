"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { APPS, getAppsByPage } from "@/apps/registry";
import { resolveAppOrder } from "@/lib/settings/home";
import { usePhone } from "@/context/PhoneContext";
import { GridLayout } from "@/components/phone/home/GridLayout";
import { Dock } from "@/components/phone/home/Dock";
import type { AppId, HomePageId } from "@/types/app";

const PAGES: HomePageId[] = ["page-1", "page-2"];

/** 翻页判定：超过页宽 15% 或至少 40px（参考项目同思路）。 */
const SWIPE_MIN = 40;
const SWIPE_RATIO = 0.15;
/** 拖动超过这个距离，松手后的 click 不再触发图标（防误点）。 */
const CLICK_SUPPRESS = 8;

/**
 * 主屏幕：可左右滑动的双页容器。
 * 手势层对齐参考项目 ai-virtual-phone 的做法：
 * - 用原生 touch 事件（touchmove 非被动）驱动，iOS 上 pointer events
 *   会被浏览器抢手势后发 pointercancel，靠不住
 * - 拖动时 1:1 跟手（CSS 变量 --swipe-drag 命令式更新，不走 React 渲染）
 * - 首尾页 0.25 橡皮筋阻尼；竖向移动为主时判定为滚动、放行
 * - 桌面预览用翻页圆点点击。
 */
export function HomeScreen({
  pageIndex,
  onPageChange,
}: {
  pageIndex: number;
  onPageChange: (index: number) => void;
}) {
  const { prefs } = usePhone();
  const trackRef = useRef<HTMLDivElement | null>(null);
  // 触摸手势状态（监听器闭包内读写，不走 React 状态）。
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    dx: number; // 已套阻尼的当前位移
    locked: boolean | null; // null=未判定方向 true=横向拖 false=竖向滚动
  } | null>(null);
  // 最近一次拖动的原始位移，用于松手后抑制误点图标。
  const lastDragPx = useRef(0);

  // 解析最终顺序，并把 Dock App 从网格中排除（它们只待在 Dock）。
  const orderRank = new Map<AppId, number>(
    resolveAppOrder(APPS, prefs?.appOrder ?? []).map((id, index) => [id, index]),
  );
  const page1Apps = getAppsByPage("page-1")
    .filter((app) => !app.dock)
    .sort((a, b) => (orderRank.get(a.id) ?? 0) - (orderRank.get(b.id) ?? 0));

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const isFirst = pageIndex === 0;
    const isLast = pageIndex === PAGES.length - 1;
    /** 越界方向套 0.25 橡皮筋阻尼。 */
    const rubber = (dx: number) => (isFirst && dx > 0) || (isLast && dx < 0) ? dx * 0.25 : dx;

    /** 拖动中：关 transition、写 --swipe-drag。 */
    const applyDrag = (dx: number) => {
      el.classList.add("swiping");
      el.style.setProperty("--swipe-drag", `${dx}px`);
    };

    /** 松手：按阈值翻页或弹回。 */
    const finish = (dampedDx: number) => {
      const damped = (isFirst && dampedDx > 0) || (isLast && dampedDx < 0);
      const raw = damped ? dampedDx / 0.25 : dampedDx;
      const pageWidth = el.clientWidth / 2; // track 宽 200%，一页是一半
      const threshold = Math.max(SWIPE_MIN, pageWidth * SWIPE_RATIO);
      el.classList.remove("swiping");
      el.style.setProperty("--swipe-drag", "0px");
      if (raw < -threshold && !isLast) onPageChange(pageIndex + 1);
      else if (raw > threshold && !isFirst) onPageChange(pageIndex - 1);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        gestureRef.current = null;
        return;
      }
      const t = e.touches[0];
      gestureRef.current = { startX: t.clientX, startY: t.clientY, dx: 0, locked: null };
      lastDragPx.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;

      // 首次明显移动时判定方向：竖向为主则交还滚动，不拦。
      if (g.locked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        g.locked = Math.abs(dx) >= Math.abs(dy);
        if (!g.locked) {
          gestureRef.current = null;
          return;
        }
      }

      // 横向拖动：阻止页面滚动/回弹（监听为非被动才能生效）。
      e.preventDefault();
      const eff = rubber(dx);
      g.dx = eff;
      lastDragPx.current = Math.abs(dx);
      applyDrag(eff);
    };

    const onTouchEnd = () => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || g.locked !== true) return;
      finish(g.dx);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pageIndex, onPageChange]);

  /** 拖动后的补发 click 抑制（不然翻页同时会误开图标）。 */
  const handleClickCapture = (e: React.MouseEvent) => {
    if (lastDragPx.current > CLICK_SUPPRESS) {
      e.preventDefault();
      e.stopPropagation();
      lastDragPx.current = 0;
    }
  };

  return (
    <div className="absolute inset-0">
      {/* 统一壁纸层：不随翻页移动，两页共享同一张。
          之后美化 App 换壁纸只改这里（或做成 CSS 变量/图片）。
          白紫渐变：暖白打底，顶部与底部微微泛紫。 */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "linear-gradient(180deg, #f4f0fb 0%, #fcfaff 34%, #f8f5fd 68%, #efe9f9 100%)",
        }}
        aria-hidden
      />

      {/* 滑动页面 track：位移 = --swipe-page(React) + --swipe-drag(拖动中) */}
      <div
        ref={trackRef}
        className="home-swipe-track relative flex h-full"
        style={
          {
            width: `${PAGES.length * 100}%`,
            "--swipe-page": pageIndex,
            touchAction: "pan-y",
          } as CSSProperties
        }
        onClickCapture={handleClickCapture}
      >
        {/* 第一页：标准 iOS 网格（杂志排版是下一个重头戏）。底色由壁纸层统一。 */}
        <section className="relative flex h-full w-1/2 flex-col">
          {/* 点状纹理（旧项目同款：极淡的紫，几乎感觉不到但有質感）。 */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(139,92,246,0.06) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
            aria-hidden
          />
          <div
            className="relative z-10 flex-1 overflow-y-auto pt-[calc(var(--safe-area-top)+var(--sim-status-h)+6px)] pb-[calc(var(--safe-area-bottom)+114px)]"
            style={{ scrollbarWidth: "none" }}
          >
            {/*
              一期：布局偏好只有 grid 可用。
              杂志排版完成后，这里依 prefs.layoutMode 分流到 <MagazineLayout />。
            */}
            <GridLayout apps={page1Apps} />
          </div>
        </section>

        {/* 第二页：星空占位（壁纸层统一底色；美术后续做） */}
        <section className="relative flex h-full w-1/2 flex-col items-center justify-center px-8 text-center">
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(1px 1px at 24% 26%, rgba(255,255,255,0.8), transparent), radial-gradient(1.4px 1.4px at 62% 18%, rgba(207,198,255,0.7), transparent), radial-gradient(1px 1px at 80% 58%, rgba(255,255,255,0.5), transparent), radial-gradient(1px 1px at 34% 72%, rgba(207,198,255,0.55), transparent)",
            }}
            aria-hidden
          />
          <p className="relative font-serif text-[15px] tracking-[0.3em] text-[#5b4a8a]/70 pl-[0.3em]">
            STARRY PAGE
          </p>
          <p className="relative mt-3 font-song text-[12px] leading-relaxed tracking-[0.2em] text-[#5b4a8a]/38">
            第二页星空
            <br />
            即将被点亮
          </p>
        </section>
      </div>

      {/* 页面指示点（桌面预览可点击翻页） */}
      <div
        className="absolute inset-x-0 z-30 flex items-center justify-center gap-2"
        style={{ bottom: "calc(var(--safe-area-bottom) + 110px)" }}
      >
        {PAGES.map((page, index) => (
          <button
            key={page}
            type="button"
            aria-label={`切换到第 ${index + 1} 页`}
            onClick={() => onPageChange(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === pageIndex
                ? "w-4 bg-[#6d5db3]"
                : "w-1.5 bg-[#6d5db3]/30 hover:bg-[#6d5db3]/50"
            }`}
          />
        ))}
      </div>

      <Dock />
    </div>
  );
}
