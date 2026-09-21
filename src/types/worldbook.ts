/**
 * 世界书数据模型。
 *
 * 结构参考 ai-virtual-phone（SillyTavern 同款思路）：
 * 「书」只是容器，真正的设定单元是「条目」——
 * 条目靠关键词触发注入，或勾「常驻」每轮必注入。
 * 不预设「法则/地点/NPC」等固定分类，内容组织完全交给恩熙。
 */

/** 世界书作用范围（绑定场景）。以后新增 App 场景时在此扩展。 */
export type WorldBookScope = "global" | "online" | "offline";

/** 作用范围的显示定义（UI 与组装 prompt 时共用）。 */
export const SCOPE_META: Record<
  WorldBookScope,
  { label: string; hint: string }
> = {
  global: { label: "全局", hint: "所有场景都注入" },
  online: { label: "仅线上", hint: "星绥通讯对话时注入" },
  offline: { label: "仅线下", hint: "情侣空间等本地场景" },
};

/**
 * 条目注入位置：决定内容插进 prompt 的哪一层。
 * 角色前＝人设之前；角色后＝人设之后；对话前＝对话历史之前；对话后＝最新消息之后。
 */
export type EntryPosition = "role_before" | "role_after" | "chat_before" | "chat_after";

/** 注入位置的显示定义（UI 与组装 prompt 时共用）。 */
export const POSITION_META: Record<
  EntryPosition,
  { label: string; hint: string }
> = {
  role_before: { label: "角色前", hint: "插在人设之前（最高优先级）" },
  role_after: { label: "角色后", hint: "插在人设之后（预设）" },
  chat_before: { label: "对话前", hint: "插在对话历史之前、记忆碎片之后" },
  chat_after: { label: "对话后", hint: "插在最新消息之后" },
};

/**
 * 注入位置的全部合法值。
 * 导入与旧数据归一化都从这里取，**别在别处手写枚举**——2026-09-17 修的那笔账
 * 就是因为在 worldbook.ts 里手写了 `dialogue_before/dialogue_after`（本项目根本没有的值），
 * 导致收录进来的书，只要原本是「对话前／对话后」，位置一律被悄悄降级成「角色后」。
 */
export const ENTRY_POSITIONS: EntryPosition[] = [
  "role_before",
  "role_after",
  "chat_before",
  "chat_after",
];

/** 归一化注入位置：缺省或非法值一律退回「角色后」。 */
export function normalizeEntryPosition(value: unknown): EntryPosition {
  return typeof value === "string" && (ENTRY_POSITIONS as string[]).includes(value)
    ? (value as EntryPosition)
    : "role_after";
}

/** 一条世界设定。 */
export interface WorldBookEntry {
  id: string;
  /** 条目名称（备注，给人看的）。 */
  title: string;
  /** 触发关键词，逗号分隔（如「星海城,北境」）。 */
  keys: string;
  /** 内容正文（给 AI 看的设定）。 */
  content: string;
  /** 常驻激活：每轮必注入，忽略关键词（世界法则用）。 */
  constant: boolean;
  /** 停用开关：暂时屏蔽不必删除。 */
  disabled: boolean;
  /** 注入位置。 */
  position: EntryPosition;
  /** 触发概率（0-100）：关键词命中后按此概率掷骰；常驻条目不受此影响。 */
  probability: number;
  createdAt: string;
  updatedAt: string;
}

/** 一本世界书（容器）。 */
export interface WorldBook {
  id: string;
  name: string;
  description: string;
  /** 作用范围：决定哪些场景会注入这本书的内容。 */
  scope: WorldBookScope;
  /** 绑定角色：仅这些角色的对话会读这本书；空阵列＝所有角色共享。 */
  boundCharacterIds: string[];
  entries: WorldBookEntry[];
  createdAt: string;
  updatedAt: string;
}
