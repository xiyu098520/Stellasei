"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 开屏：深紫星空、星芒呼吸、STELLASEI 淡入。
 * - 2.4 秒起自动淡出（CSS 自己走完，2.8 秒已不可见，见下），亦可点击跳过。
 * - 用 sessionStorage 记住本次浏览工作階段已看过；严格仅客户端读写。
 * - **2026-10-13 恩熙：开屏不许再等字体下载。** 原先是等 `document.fonts.ready`
 *   （即等思源宋体子集下完）才播入场，PWA 冷启动时若脚本迟迟没接管，内容会被
 *   `opacity:0` 门禁永久藏住、只剩一行「点击任意处进入」。
 * - **1.12.98：开屏也不许再等脚本。** 退场原先 100% 靠 React 的 setTimeout，
 *   应用包一旦没起来（旧 HTML 缓存指着已删除的分片是最常见的一种），这层就永久
 *   盖着、「点击任意处进入」也点不动。现在退场有两条线：
 *   CSS 的 `splash-auto-out` 到点自己把它淡成 `visibility:hidden`（脚本在不在都算数），
 *   JS 只负责到点把这层从渲染里摘掉。
 * - **1.12.99：连「点一下就走」也不经过 JS 了。** 原先它挂在 React 的 onClick 上，
 *   应用包没起来时点了没反应。现在这层是个 `<label for>`，点它＝浏览器原生去勾选
 *   那枚隐藏 radio，CSS 据此立刻淡出（见 globals.css 的 `.splash-skip`）。
 *   React 的 onClick 仍在，只是负责把这一层从渲染里摘掉。
 */
export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const finishedRef = useRef(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const alreadySeen =
      window.sessionStorage.getItem("stellasei:splash-seen") === "1";
    // 首次到访：2.4 秒交给 CSS 自己淡出，JS 只陪着卸载。
    // 本次会话已看过：900ms 就用 JS 淡出，不必再等满一遍。
    const timer = setTimeout(() => beginLeave(alreadySeen), alreadySeen ? 900 : 2400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** withFade=false：画面交给 CSS 的自动退场，这里只按时卸载。 */
  function beginLeave(withFade: boolean) {
    // 自动逾时与手动跳过可能竞相调用，只允许进入一次。
    if (finishedRef.current) return;
    finishedRef.current = true;

    window.sessionStorage.setItem("stellasei:splash-seen", "1");
    if (withFade) setLeaving(true);
    // 淡出 400ms：withFade 时对齐 splash-auto-out 的时长，否则对齐 CSS 预留的余量。
    setTimeout(onFinish, withFade ? 400 : 420);
  }

  return (
    <>
      {/* 看不见的开关：label 点它会勾上，全程原生行为、不需要脚本。 */}
      <input
        type="radio"
        id="stellasei-splash-skip"
        name="stellasei-splash-skip"
        className="splash-skip"
        aria-hidden="true"
        tabIndex={-1}
      />
      <label
        htmlFor="stellasei-splash-skip"
        aria-label="点击跳过开屏"
        // 自动退场已经起步（>2.3s）就别再重启淡出动画——那会把淡下去的一层
        // 重新拉回不透明、闪一下；此时直接卸载。
        onClick={() => beginLeave(Date.now() - mountedAt.current < 2300)}
        // 底色在 globals.css 的 .splash-panel 里，别改用 Tailwind 的任意值类名：
        // 它紧贴下面的 `${` 会被扫描器读成带 `$` 的无效类，规则直接不生成。
        className={`splash-panel absolute inset-0 z-50 flex flex-col items-center justify-center${
          leaving ? " splash-leaving" : ""
        }`}
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
      </label>
    </>
  );
}
