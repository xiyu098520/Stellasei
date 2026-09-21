"use client";

import { useEffect, useState } from "react";
import { PhoneProvider, usePhone } from "@/context/PhoneContext";
import { PhoneFrame } from "@/components/phone/PhoneFrame";
import { SplashScreen } from "@/components/phone/SplashScreen";
import { StatusBar } from "@/components/phone/StatusBar";
import { HomeScreen } from "@/components/phone/home/HomeScreen";
import { AppWindow } from "@/components/phone/AppWindow";
import { installTapFallback } from "@/lib/tapFallback";

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

  return (
    <PhoneFrame>
      {!splashDone ? <SplashScreen onFinish={() => setSplashDone(true)} /> : null}

      <HomeScreen pageIndex={pageIndex} onPageChange={setPageIndex} />
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
