/**
 * 面具（用户人设）：头像＋名字＋签名＋人设＋性别＋生日＋补充。
 *
 * 在星绥通讯「我的」页管理；「使用中」的面具决定：
 * - 你的名字（prompt 的 userName；TA 如何称呼你由其人设与关系自行判断；空名以「我」兜底）
 * - 你的个性签名（侧边栏展示；也作为「你的当前签名」注入 prompt）
 * - 人设信息注入 system prompt（栏位全空则不注入，TA 眼中只有「我」）
 *
 * 系统自带一个不可删除的「默认面具」（id 固定），初始全空；
 * 没有使用任何面具时即处于默认面具的空白态。
 * 同一时间至多一个面具处于使用中。仅在客户端读写 IndexedDB。
 */

import { kvGet, kvSet } from "@/lib/db/idb";

const MASKS_KEY = "masks";

/** 默认面具的固定 id（系统自带，不可删除）。 */
export const DEFAULT_MASK_ID = "default";

export interface Mask {
  id: string;
  /** 对外短 ID（微信号式，可在「我的」页手动修改）。 */
  uid: string;
  /** 名字（告诉 TA 你叫什么；如何称呼由 TA 判断）；空串以「我」自称。 */
  name: string;
  /**
   * 个性签名（这一张面具自己的）。
   * 签名原本是全局一个字段（旧 identity 存储），换面具不换签名；
   * 现在并进来，换面具＝换签名。空串时展示端用 SIGNATURE_FALLBACK。
   */
  signature: string;
  /** 人设描述（注入 prompt）。 */
  persona: string;
  /** 性别（女／男／其他，如天使等无性别；空串未填写）。 */
  gender: string;
  /** 生日（YYYY-MM-DD）；空串表示未填。 */
  birth: string;
  /** 补充说明（自由填写，注入 prompt）。 */
  extra: string;
  /** 头像（dataURL；空串用渐变底＋名字首字）。 */
  avatar: string;
  createdAt: string;
  /** 使用中（同一时间至多一个）。 */
  current: boolean;
}

/** 面具 ID 的合法格式（4-20 位字母／数字／横线）。 */
export const MASK_UID_RE = /^[a-zA-Z0-9-]{4,20}$/;

/** 生成随机面具 ID（8 位小写字母数字，避开易混淆字符）。 */
export function genMaskUid(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let uid = "";
  for (let i = 0; i < 8; i++) uid += chars[Math.floor(Math.random() * chars.length)];
  return uid;
}

/** 补齐缺失栏位（旧资料兼容；uid 缺失时补随机值）。 */
function normalize(m: Partial<Mask>): Mask {
  return {
    id: m.id ?? "",
    uid: m.uid ?? "",
    name: m.name ?? "",
    signature: m.signature ?? "",
    persona: m.persona ?? "",
    gender: m.gender ?? "",
    birth: m.birth ?? "",
    extra: m.extra ?? "",
    avatar: m.avatar ?? "",
    createdAt: m.createdAt ?? new Date().toISOString(),
    current: m.current ?? false,
  };
}

/** 读取面具列表；缺 uid 的自动补齐并落库（无感迁移）。 */
export async function getMasks(): Promise<Mask[]> {
  const saved = await kvGet<Mask[]>(MASKS_KEY);
  if (!Array.isArray(saved)) return [];
  const used = new Set<string>();
  const list = saved.map(normalize).map((m) => {
    if (m.uid) {
      used.add(m.uid);
      return m;
    }
    let uid = genMaskUid();
    while (used.has(uid)) uid = genMaskUid();
    used.add(uid);
    return { ...m, uid };
  });
  if (list.some((m, i) => m.uid !== saved[i]?.uid)) {
    await kvSet(MASKS_KEY, list);
  }
  return list;
}

/**
 * 读取面具列表并确保「默认面具」存在（不存在则创建并置顶）。
 * 初始无人使用时默认面具自动换上。ChatApp 载入时调用。
 */
export async function ensureMasks(): Promise<Mask[]> {
  const masks = await getMasks();
  if (masks.some((m) => m.id === DEFAULT_MASK_ID)) return masks;
  const def: Mask = {
    id: DEFAULT_MASK_ID,
    uid: genMaskUid(),
    name: "",
    signature: "",
    persona: "",
    gender: "",
    birth: "",
    extra: "",
    avatar: "",
    createdAt: new Date().toISOString(),
    current: !masks.some((m) => m.current),
  };
  const next = [def, ...masks];
  await kvSet(MASKS_KEY, next);
  return next;
}

export async function saveMasks(masks: Mask[]): Promise<void> {
  await kvSet(MASKS_KEY, masks);
}

/** 取使用中的面具（无则 null）。 */
export function getCurrentMask(masks: Mask[]): Mask | null {
  return masks.find((m) => m.current) ?? null;
}

/**
 * 旧版全局签名 → 并进面具的**一次性迁移**（返回 null 表示无需改动）。
 *
 * 签名升级前单独存在 `identity` 那一个全局字段里；
 * 升级后首次载入若旧值还在，就填给「使用中」那张面具（只填空位，已有的不覆盖），
 * 调用方搬完把旧字段清空——否则故意把面具签名清掉后，刷新又会被搬回来。
 */
export function migrateLegacySignature(masks: Mask[], legacy: string): Mask[] | null {
  const s = legacy.trim();
  if (!s) return null;
  const at = masks.findIndex((m) => m.current);
  const idx = at >= 0 ? at : masks.findIndex((m) => m.id === DEFAULT_MASK_ID);
  if (idx < 0 || masks[idx].signature.trim()) return null;
  return masks.map((m, i) => (i === idx ? { ...m, signature: s } : m));
}
