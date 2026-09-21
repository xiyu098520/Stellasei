/**
 * 輕量型别安全事件汇流排。
 *
 * 一期用途：App 开关、布局切换等客户端事件。
 * 二期用途：生活节奏时间线、Web Push / Supabase 云端触发的事件，
 *           全部统一从这里进入 UI——「重逢补全」与「即时推送」是同一条事件管线，
 *           差别只在事件由本地排程还是云端送达。因此介面现在就定下来。
 */

import type { AppId, HomeLayoutMode } from "@/types/app";

/** 生活节奏时间线事件（一期只定形状，产生器之后实现）。 */
export interface TimelineEvent {
  /** 事件种类，例如 status-change / he-messages / reminder。 */
  type: string;
  /** 事件发生时间（epoch ms）；重逢补全时可能是过去的时间点。 */
  at: number;
  /** 关联的 App 或角色（可選）。 */
  appId?: AppId;
  payload?: unknown;
}

/** 全机事件清单。新增事件在这里登记型别，emit/on 自动取得检查。 */
export interface StellaseiEventMap {
  "app:open": { appId: AppId };
  "app:close": { appId: AppId | null };
  "home:layout-change": { mode: HomeLayoutMode };
  "timeline:event": TimelineEvent;
}

type EventHandler<T> = (payload: T) => void;

/** 建立一个型别安全的事件汇流排。 */
function createEventBus<T extends object>() {
  // 刻意不使用 React state：事件订閱可以跨元件、跨鉤子独立存在。
  const listeners = new Map<keyof T, Set<(payload: T[keyof T]) => void>>();

  function on<K extends keyof T>(event: K, handler: EventHandler<T[K]>): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler as (payload: T[keyof T]) => void);
    // 回传取消订閱函数，useEffect 直接 return 即可，避免洩漏。
    return () => off(event, handler);
  }

  function off<K extends keyof T>(event: K, handler: EventHandler<T[K]>): void {
    listeners.get(event)?.delete(handler as (payload: T[keyof T]) => void);
  }

  function emit<K extends keyof T>(event: K, payload: T[K]): void {
    listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        // 一个監听器出错不影响其他監听器
        console.error(`[eventBus] 監听器处理「${String(event)}」时失败:`, error);
      }
    });
  }

  return { on, off, emit };
}

/** 全域单例：整支手机共用一条事件管线。 */
export const appBus = createEventBus<StellaseiEventMap>();
