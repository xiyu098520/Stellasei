"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 开屏：深紫星空、星芒呼吸、STELLASEI 淡入。
 * - 2.8 秒后自动进入，亦可点击跳过。
 * - 用 sessionStorage 记住本次浏览工作階段已看过；严格仅客户端读写。
 * - **2026-10-13 恩熙：开屏不许再等字体下载。** 原先是等 `document.fonts.ready`
 *   （即等思源宋体子集下完）才播入场，PWA 冷启动时若脚本迟迟没接管，内容会被
 *   `opacity:0` 门禁永久藏住、只剩一行「点击任意处进入」。现刊头直接改用系统
 *   衬线／宋体（iOS／Windows 自带，零下载、零闪），并删掉等字体的门禁——
 *   挂载即播入场，任何情况下都能立刻看到 STELLASEI。
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const finishedRef = useRef(false);

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
        style={{
          // 提前提升合成层，避免动画首帧才栅格化造成的顿挫。
          willChange: "transform, opacity",
          animation: leaving
            ? "splash-content-out 0.32s cubic-bezier(0.4, 0, 1, 1) both"
            : "splash-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <svg width="72" height="72" viewBox="0 0 24 24" className="text-[#cbbfff]">
          <path
            d="M12 2 L13.9 8.1 L20 10 L13.9 11.9 L12 18 L10.1 11.9 L4 10 L10.1 8.1 Z"
            fill="currentColor"
          />
        </svg>
        <h1
          className="mt-7 text-[28px] font-medium tracking-[0.42em] text-[#efeaff] pl-[0.42em]"
          style={{ fontFamily: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif' }}
        >
          STELLASEI
        </h1>
        <p
          className="mt-3 text-[12px] tracking-[0.5em] text-white/45 pl-[0.5em]"
          style={{ fontFamily: '"Songti SC", "STSong", "SimSun", Georgia, serif' }}
        >
          星绥 · 星空传讯
        </p>
      </div>
      <p className="absolute bottom-10 text-[10px] tracking-widest text-white/25">
        点击任意处进入
      </p>
    </div>
  );
}
