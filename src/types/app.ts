/**
 * 手机外壳与 App 登记的全域型别。
 *
 * 设计原则：每个 App 只在「App 登记表」注冊一次，
 * 主屏幕的网格布局、杂志布局、Dock 都从同一份数据渲染。
 */

/** 一期会出现在手机里的 App。新 App 一律先在这里登记。 */
export type AppId =
  | "chat" // 星绥通讯（心臟）
  | "contacts" // 他的角色档案（旧称「联系人」）
  | "worldbook" // 世界书
  | "memory" // 类人记忆
  | "rhythm" // 生活节奏（一期以设定/状态呈现，不一定有独立入口）
  | "beautify" // 美化（布局／桌布／主题）
  | "settings"; // 设置（API、存储、云同步）

/** 主屏幕布局模式：恩熙自创杂志排版 或 iOS 经典网格。 */
export type HomeLayoutMode = "magazine" | "grid";

/** 主屏幕页面：第一页浅色杂志、第二页深紫星空。 */
export type HomePageId = "page-1" | "page-2";

/**
 * App 登记数据。版面几何（网格第几栏、杂志卡片位置）不放在这里，
 * 由各布局渲染器与使用者排序阵列決定，维持单一职責。
 */
export interface AppDefinition {
  id: AppId;
  /** 中文名称，显示在图标下方／卡片上。 */
  name: string;
  /** 英文小字，杂志模式使用（例如 Date、Mindscape）。 */
  nameEn?: string;
  /** 詩化标语，杂志模式卡片使用。 */
  tagline?: string;
  /** 主题色（hex 或 rgba），作为各 App 的视觉錨点。 */
  accent?: string;
  /** 预设排序，数字越小越靠前；日后拖动排序覆写此值。 */
  order: number;
  /** 放在哪一页主屏幕。 */
  page: HomePageId;
  /** 是否常駐底部 Dock。 */
  dock?: boolean;
  /** 是否在杂志模式精選展示（杂志页只擺放被精選的 App）。 */
  magazine?: boolean;
  /** 一期尚未实现的 App 显示为即将推出，点击不进入空白页。 */
  comingSoon?: boolean;
  /**
   * App 全屏时的外壳背景色。真机 PWA 全屏模式下，视口外露出的
   * 边缘区（刘海／Home 条区域）由 body 底色填充，需与之同步才不穿帮。
   * 缺省视为浅色（#fbf9ff，AppChrome light）。
   */
  shellBg?: string;
}

/** 持久化的主屏幕偏好。 */
export interface HomePreferences {
  layoutMode: HomeLayoutMode;
  /**
   * 使用者自订排序（AppId）。缺省时回退到 AppDefinition.order。
   * 一期先只存数据、渲染时读取；拖动 UI 之后接上即可生效。
   */
  appOrder: AppId[];
}
