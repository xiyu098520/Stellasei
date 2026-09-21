"use client";

import { useEffect, useState } from "react";

/**
 * 每分钟更新一次的当前时间（epoch ms）。
 * 初始为 null，由 useEffect 填入，避免 SSR／客户端时间差造成 hydration 不符。
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();

    // 对齐下一个整分再开始每分钟跳动，让显示与系统时钟同步。
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return now;
}
