"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 开屏：深紫星空、星芒呼吸、STELLASEI 淡入。
 * - 2.8 秒后自动进入，亦可点击跳过。
 * - 用 sessionStorage 记住本次浏览工作階段已看过；严格仅客户端读写。
 * - 入场等 Web 字体就绪后再播：PWA 冷启动时页面最忙，字体换装会改变文本
 *   度量带动版面、主线程拥挤导致动画头几帧掉帧（表现为一顿一顿的位移）。
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    // 双 rAF：确保首帧排版已发生、字体请求已发出，之后 fonts.ready
    // （成功或失败都会 resolve）才真正等到加载收尾，避免过早放行。
    let alive = true;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.fonts.ready.then(() => {
          if (alive) setFontsReady(true);
        });
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  useEffect(() => {
    const alreadySeen =
      window.sessionStorage.getItem("stellasei:splash-seen") === "1";
    const duration = alreadySeen ? 900 : 2800;

    const leaveTimer = setTimeout(beginLeave, duration);
    return () => clearTimeout(leaveTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginLeave() {
    // 自动逾时与手动跳过可能竞相调用，只允许进入一次。
    if (finishedRef.current) return;
    finishedRef.current = true;

    window.sessionStorage.setItem("stellasei:splash-seen", "1");
    setLeaving(true);
    // 与 splash-fade-out 的 380ms 对齐：动画结束时整层已透明，卸载零闪跳。
    setTimeout(onFinish, 380);
  }

  return (
    <div
      role="button"
      aria-label="点击跳过开屏"
      onClick={beginLeave}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0a14]"
      style={
        leaving
          ? {
              animation: "splash-fade-out 0.38s ease-out both",
              pointerEvents: "none",
            }
          : undefined
      }
    >
      {/* 星点背景 */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.8), transparent), radial-gradient(1px 1px at 70% 18%, rgba(255,255,255,0.55), transparent), radial-gradient(1.5px 1.5px at 40% 70%, rgba(207,198,255,0.7), transparent), radial-gradient(1px 1px at 82% 62%, rgba(255,255,255,0.5), transparent), radial-gradient(1px 1px at 12% 80%, rgba(207,198,255,0.6), transparent), radial-gradient(1.2px 1.2px at 58% 42%, rgba(255,255,255,0.45), transparent)",
        }}
        aria-hidden
      />
      <div
        className="relative flex flex-col items-center"
        style={
          fontsReady
            ? {
                // 提前提升合成层，避免动画首帧才栅格化造成的顿挫。
                willChange: "transform, opacity",
                animation: leaving
                  ? "splash-content-out 0.32s cubic-bezier(0.4, 0, 1, 1) both"
                  : "splash-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
              }
            : // 字体未就绪：先整组藏住，就绪后一次到位地入场。
              { opacity: 0 }
        }
      >
        <svg width="72" height="72" viewBox="0 0 24 24" className="text-[#cbbfff]">
          <path
            d="M12 2 L13.9 8.1 L20 10 L13.9 11.9 L12 18 L10.1 11.9 L4 10 L10.1 8.1 Z"
            fill="currentColor"
          />
        </svg>
        <h1 className="mt-7 font-serif text-[28px] font-medium tracking-[0.42em] text-[#efeaff] pl-[0.42em]">
          STELLASEI
        </h1>
        <p className="mt-3 font-song text-[12px] tracking-[0.5em] text-white/45 pl-[0.5em]">
          星绥 · 星空传讯
        </p>
      </div>
      <p className="absolute bottom-10 text-[10px] tracking-widest text-white/25">
        点击任意处进入
      </p>
    </div>
  );
}
