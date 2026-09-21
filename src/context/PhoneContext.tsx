"use client";

/**
 * 手机全域状态：当前打开的 App、主屏幕偏好。
 *
 * SSR 安全：所有持久化数据在 useEffect 后才读取，
 * 首次渲染一律是「主屏幕、尚无偏好」的安全预设，避免 hydration 不一致。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppId, HomeLayoutMode, HomePreferences } from "@/types/app";
import { getApp, type RegisteredApp } from "@/apps/registry";
import {
  DEFAULT_HOME_PREFERENCES,
  getHomePreferences,
  setHomeLayoutMode,
} from "@/lib/settings/home";
import { appBus } from "@/lib/eventBus";

interface PhoneContextValue {
  /** 当前全屏打开的 App；null 表示在主屏幕。 */
  currentApp: RegisteredApp | null;
  /** 主屏幕偏好；载入完成前为 null。 */
  prefs: HomePreferences | null;
  openApp: (id: AppId) => void;
  closeApp: () => void;
  /** 切换主屏幕布局（美化 App 调用），同时持久化并廣播事件。 */
  changeLayoutMode: (mode: HomeLayoutMode) => Promise<void>;
}

const PhoneContext = createContext<PhoneContextValue | null>(null);

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [currentApp, setCurrentApp] = useState<RegisteredApp | null>(null);
  const [prefs, setPrefs] = useState<HomePreferences | null>(null);

  // 客户端挂载后读取偏好。
  useEffect(() => {
    let cancelled = false;
    getHomePreferences()
      .then((loaded) => {
        if (!cancelled) setPrefs(loaded);
      })
      .catch((error) => {
        console.error("[PhoneContext] 读取主屏幕偏好失败，使用预设值:", error);
        if (!cancelled) setPrefs(DEFAULT_HOME_PREFERENCES);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openApp = useCallback((id: AppId) => {
    const app = getApp(id);
    if (!app) return;
    if (app.comingSoon) {
      // 即将推出的 App 也进入一个提示视窗，而不是静默无反应。
      setCurrentApp(app);
      appBus.emit("app:open", { appId: id });
      return;
    }
    setCurrentApp(app);
    appBus.emit("app:open", { appId: id });
  }, []);

  const closeApp = useCallback(() => {
    setCurrentApp((prev) => {
      appBus.emit("app:close", { appId: prev?.id ?? null });
      return null;
    });
  }, []);

  const changeLayoutMode = useCallback(async (mode: HomeLayoutMode) => {
    const next = await setHomeLayoutMode(mode);
    setPrefs(next);
    appBus.emit("home:layout-change", { mode });
  }, []);

  const value = useMemo(
    () => ({ currentApp, prefs, openApp, closeApp, changeLayoutMode }),
    [currentApp, prefs, openApp, closeApp, changeLayoutMode],
  );

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export function usePhone(): PhoneContextValue {
  const ctx = useContext(PhoneContext);
  if (!ctx) {
    throw new Error("usePhone 必须在 <PhoneProvider> 内使用");
  }
  return ctx;
}
