"use client";

import { useEffect, useState } from "react";
import { PhoneProvider, usePhone } from "@/context/PhoneContext";
import { PhoneFrame } from "@/components/phone/PhoneFrame";
import { SplashScreen } from "@/components/phone/SplashScreen";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeScreen } from "@/components/phone/home/HomeScreen";
import { AppWindow } from "@/components/phone/AppWindow";
import { installTapFallback } from "@/lib/tapFallback";
import { startFontPrefetch } from "@/lib/font-prefetch";
import { getChatPrefs } from "@/lib/settings/chat";

/**
 * 系统层：开屏 → 主屏幕（双页）＋状态栏＋Dock，App 以覆盖层打开。
 * pageIndex 放在这一层，状态栏才能跟着第二页星空切换明暗。
 */
function PhoneOs() {
  const [splashDone, setSplashDone] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const { currentApp } = usePhone();

  // body 底色跟随当前上下文同步（开屏深／主屏统一白紫渐变底／App 用登记表 shellBg）。
  // 真机 PWA 全屏时，视口外若有露出区域（安全区边缘），由 body 底色填充，
  // 动态同步保证任何页面下边缘都与内容同色，不再出现穿帮色带。
  useEffect(() => {
    let bg = "#f8f5fd"; // 主屏两页：统一壁纸（白紫渐变），取渐变中段色
    if (!splashDone) bg = "#0b0a14"; // 开屏：深紫黑
    else if (currentApp) bg = currentApp.shellBg ?? "#fbf9ff"; // App：登记表为准
    document.body.style.backgroundColor = bg;
    document.documentElement.style.backgroundColor = bg;
  }, [splashDone, currentApp]);

  // 兜住 iOS 选字后 click 假死（WebKit 288461）：见 lib/tapFallback.ts。
  useEffect(() => installTapFallback(), []);

  // 开屏过后，纯后台静默补齐整量字形（失败自动重试到成功、仅下次启动前生效一次）；
  // 见 lib/font-prefetch.ts。basePath 与字体 @font-face 同源。
  useEffect(() => {
    if (splashDone) startFontPrefetch(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  }, [splashDone]);

  /* 流畅模式总闸（1.9.6）：按 chat-prefs 的 smoothMode 在 <html> 上挂／摘
     `.smooth-mode`（样式见 globals.css 那一段）。设置页里一开关就落库并喊一声
     `stellasei:prefs-changed`（见 saveChatPrefs），这里跟着重读，不必刷新页面。 */
  useEffect(() => {
    const apply = () => {
      void getChatPrefs().then((p) => {
        document.documentElement.classList.toggle("smooth-mode", p.smoothMode);
      });
    };
    apply();
    window.addEventListener("stellasei:prefs-changed", apply);
    return () => window.removeEventListener("stellasei:prefs-changed", apply);
  }, []);

  return (
    <PhoneFrame>
      {!splashDone ? <SplashScreen onFinish={() => setSplashDone(true)} /> : null}

      {/* 主屏：App 打开时整块从渲染里摘掉（`display:none`）。
          主屏是「一屏两层」——200% 宽的翻页 track（`translate3d` 常驻一个合成层）
          ＋ Dock 那枚 `blur(24px) saturate(160%)` 的大毛玻璃。被 App 盖住时，浏览器
          并不会「看不见就不算」：照样得把这两层合成一遍，于是手机在任何一页
          （设置、档案……）都在替一块没人看的主屏干活——发烫、拖沓（1.9.7）。
          盖住就摘掉；收起 App 回来只是重新布局一次，肉眼无差。 */}
      <div
        className="absolute inset-0"
        style={currentApp ? { display: "none" } : undefined}
      >
        <HomeScreen pageIndex={pageIndex} onPageChange={setPageIndex} />
      </div>
      <AppWindow />
      {/* 主屏两页统一浅色壁纸，状态栏恒用深色文字；App 自理明暗。 */}
      <StatusBar light={false} />
    </PhoneFrame>
  );
}

export default function Home() {
  return (
    <PhoneProvider>
      <PhoneOs />
    </PhoneProvider>
  );
}
