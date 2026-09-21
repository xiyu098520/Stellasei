/**
 * App 登记表 —— 全机唯一的 App 清单数据源。
 *
 * 主屏幕网格、杂志排版、Dock、搜尋、日后推送都从这里取数据，
 * 新增／下架 App 只改这一份。
 *
 * 注意：这里只描述「App 是什么」，不描述「版面怎么排」。
 */

import type { ComponentType } from "react";
import type { AppDefinition, AppId, HomePageId } from "@/types/app";
import type { AppIconProps } from "@/apps/icons";
import {
  BeautifyIcon,
  ChatIcon,
  ContactsIcon,
  MemoryIcon,
  SettingsIcon,
  WorldBookIcon,
} from "@/apps/icons";

interface RegisteredApp extends AppDefinition {
  /** 图标元件（网格与 Dock 使用；杂志模式可改用自订视觉）。 */
  Icon: ComponentType<AppIconProps>;
}

/**
 * 一期登记清单（顺序即预设排序，可用 HomePreferences.appOrder 覆写）。
 * 生活节奏是后台引擎，没有主屏幕入口，故不在此登记。
 */
export const APPS: readonly RegisteredApp[] = [
  {
    id: "chat",
    name: "星绥通讯",
    nameEn: "STELLASEI",
    tagline: "TA 一直都在",
    accent: "#8fb6d9",
    order: 10,
    page: "page-1",
    dock: true,
    magazine: true,
    comingSoon: false,
    shellBg: "#FFFFFF", // 纯白＝聊天窗口最底端输入区（T.card）同色，别用 T.bg 的粉白
    // #FFF7F9：点输入框、键盘把整页顶上来时，透过半透明磨砂键盘看到的那一条是
    // #FFF7F9，而它上面紧挨着的输入区是纯白，两种白之间会露出一道横带。
    Icon: ChatIcon,
  },
  {
    id: "contacts",
    name: "档案",
    nameEn: "CONTACTS",
    tagline: "他是谁",
    accent: "#b06a72",
    order: 20,
    page: "page-1",
    dock: true,
    magazine: true,
    comingSoon: false,
    shellBg: "#FFFFFF", // 纯白＝档案页 A.bg 同色。若留深色（保密风时代的 #0a0a0a），
    // 点输入框、键盘把页面顶上去时，底下露出来的那条全是黑的，跟白纸对不上。
    Icon: ContactsIcon,
  },
  {
    id: "worldbook",
    name: "世界书",
    nameEn: "WORLD BOOK",
    tagline: "TA 活着的世界",
    accent: "#b49678",
    order: 30,
    page: "page-1",
    magazine: true,
    comingSoon: false,
    shellBg: "#EDEBE5", // 请柬的暖灰桌面（白纸压在它上面），真机边缘区需同色
    Icon: WorldBookIcon,
  },
  {
    id: "memory",
    name: "记忆",
    nameEn: "MEMORY",
    tagline: "你们之间的事",
    accent: "#96bea0",
    order: 40,
    page: "page-1",
    magazine: true,
    comingSoon: false,
    shellBg: "#F7FAF4", // 清新草木风，真机边缘区需同色
    Icon: MemoryIcon,
  },
  {
    id: "beautify",
    name: "美化",
    nameEn: "BEAUTIFY",
    tagline: "妝点这支手机",
    accent: "#c9a0d4",
    order: 50,
    page: "page-1",
    dock: true,
    magazine: false,
    comingSoon: false,
    Icon: BeautifyIcon,
  },
  {
    id: "settings",
    name: "设置",
    nameEn: "SETTINGS",
    tagline: "API、存储与同步",
    accent: "#9aa0a8",
    order: 60,
    page: "page-1",
    dock: true,
    magazine: false,
    comingSoon: false,
    shellBg: "#fdfcfb", // 米白琥珀风，真机边缘区需同色
    Icon: SettingsIcon,
  },
] satisfies RegisteredApp[];

const appById = new Map<AppId, RegisteredApp>(APPS.map((app) => [app.id, app]));

/** 依 id 取得 App 登记数据；找不到回传 undefined（调用端需处理）。 */
export function getApp(id: AppId): RegisteredApp | undefined {
  return appById.get(id);
}

/** 取得某一页的 App（顺序为登记表 order）。 */
export function getAppsByPage(page: HomePageId): RegisteredApp[] {
  return APPS.filter((app) => app.page === page);
}

/** 取得常駐 Dock 的 App。 */
export function getDockApps(): RegisteredApp[] {
  return APPS.filter((app) => app.dock).sort((a, b) => a.order - b.order);
}

/** 取得要在杂志模式精選的 App。 */
export function getMagazineApps(): RegisteredApp[] {
  return APPS.filter((app) => app.magazine).sort((a, b) => a.order - b.order);
}

export type { RegisteredApp };
