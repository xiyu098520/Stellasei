/**
 * 主屏幕偏好的持久化（布局模式、App 排序）。
 *
 * 一期：读写设定本身先完成；拖动排序 UI 之后接上，
 * 只要更新 appOrder，所有布局渲染器会自动跟著变，无需重构。
 */

import type { AppDefinition, AppId, HomePreferences } from "@/types/app";
import { kvGet, kvSet } from "@/lib/db/idb";

const KEY = "settings:home";

/**
 * 施工期预设为 grid（管线先在最简单的网格上验证）。
 * 杂志布局完成后，把此预设改为 "magazine"——它是最终的预设主画面。
 */
export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  layoutMode: "grid",
  appOrder: [],
};

/** 读取主屏幕偏好；缺漏栏位自动补预设值，相容日后扩栏。 */
export async function getHomePreferences(): Promise<HomePreferences> {
  const saved = await kvGet<Partial<HomePreferences>>(KEY);
  return {
    layoutMode: saved?.layoutMode ?? DEFAULT_HOME_PREFERENCES.layoutMode,
    appOrder: Array.isArray(saved?.appOrder) ? saved!.appOrder : [],
  };
}

/** 整份覆写主屏幕偏好。 */
export async function saveHomePreferences(
  preferences: HomePreferences,
): Promise<void> {
  await kvSet(KEY, preferences);
}

/** 只切换布局模式（美化 App 使用）。 */
export async function setHomeLayoutMode(
  layoutMode: HomePreferences["layoutMode"],
): Promise<HomePreferences> {
  const current = await getHomePreferences();
  const next: HomePreferences = { ...current, layoutMode };
  await saveHomePreferences(next);
  return next;
}

/**
 * 依「使用者自订排序 → 登记表预设 order」产出最终顺序。
 * appOrder 中没列到的 App（例如新加的）自动往后补，避免憑空消失。
 */
export function resolveAppOrder(
  apps: readonly AppDefinition[],
  customOrder: readonly AppId[],
): AppId[] {
  const customRank = new Map(customOrder.map((id, index) => [id, index]));
  return [...apps]
    .sort((a, b) => {
      const ra = customRank.has(a.id) ? customRank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = customRank.has(b.id) ? customRank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.order - b.order;
    })
    .map((app) => app.id);
}
