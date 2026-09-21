/**
 * 「存储体检」引擎：把本机占用按用户看得懂的类别数出来。
 *
 * 两个数字来源不同，别混：
 * - usedBytes／quotaBytes 是浏览器报的（navigator.storage.estimate），
 *   算的是整个站点的占用（含缓存等我们数不到的），quotaBytes 是手机给的上限。
 * - categories 是我们自己一条条数出来的应用数据，加起来才是「星绥自己占了多少」。
 *
 * 只统计、不清理。清理要动业务数据的引用关系，得各自走业务模块的写路径。
 * 注意：本模组只能在客户端调用（IndexedDB 不存在于 SSR）。
 */

import { kvEach } from "@/lib/db/idb";
import { eachMediaSummary } from "@/lib/db/media-store";

export type StorageCategoryId = "chat" | "media" | "archives" | "memories" | "other";

export interface StorageCategoryStat {
  id: StorageCategoryId;
  label: string;
  /** 一句话说明这类是什么，点开能看懂。 */
  description: string;
  bytes: number;
  /** 条目数（几个对话／几张图……），单位见 unit。 */
  count: number;
  unit: string;
}

export interface StorageSnapshot {
  /** 浏览器报的整站占用。 */
  usedBytes: number;
  /** 手机给这个站点的上限；拿不到时为 0。 */
  quotaBytes: number;
  /** 上面两个数是从哪拿到的；none 表示这台设备没给。 */
  quotaSource: QuotaSource;
  /** 站点到底支不支持 navigator.storage——用来区分「系统版本旧」和「浏览器只回 0」。 */
  storageApiAvailable: boolean;
  /** 应用数据分类明细（不含浏览器缓存等）。 */
  categories: StorageCategoryStat[];
  /** 各类合计＝星绥自己占了多少。 */
  totalBytes: number;
}

export type QuotaSource = "estimate" | "webkit" | "none";

const CATEGORY_META: Record<
  StorageCategoryId,
  { label: string; description: string; unit: string }
> = {
  chat: {
    label: "聊天记录",
    description: "所有对话的文字消息与每聊天设定。",
    unit: "个对话",
  },
  media: {
    label: "图片仓库",
    description: "聊天里收到和生成的图片本体，另存在独立的库里。",
    unit: "张",
  },
  archives: {
    label: "档案",
    description: "角色档案与档案分类。",
    unit: "份",
  },
  memories: {
    label: "记忆",
    description: "角色记住的事（记忆碎片）。",
    unit: "条",
  },
  other: {
    label: "其他",
    description: "身份、面具、世界书、API 设定等零散数据。",
    unit: "项",
  },
};

/** 哪些键归到哪一类；没列到的键一律进「其他」。 */
const KEY_CATEGORY: Record<string, StorageCategoryId> = {
  "chat-conversations": "chat",
  archives: "archives",
  "archive-categories": "archives",
  "character-memories-v2": "memories",
};

/** 估算一个值的 UTF-8 字节数（统计用，不求字节级精确）。 */
export function estimateValueBytes(value: unknown): number {
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value === undefined) return 0;
  if (value === null) return 4;

  if (typeof value === "string") return utf8Bytes(value) + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;

  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 2 + Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + estimateValueBytes(item), 0);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 2;
    return (
      2 +
      Math.max(0, entries.length - 1) +
      entries.reduce((sum, [key, child]) => sum + utf8Bytes(key) + 3 + estimateValueBytes(child), 0)
    );
  }

  return 0;
}

/** 逐字符累加 UTF-8 字节数，零内存分配。 */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** 一个值的条目数：阵列算长度，其他算 1 项。 */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 1;
}

/** 旧 WebKit 的替代接口（新标准没有时才走这条）。 */
interface WebkitTemporaryStorage {
  queryUsageAndQuota?: (
    success: (usage: number, quota: number) => void,
    failure?: () => void,
  ) => void;
}

/**
 * 问浏览器要「整站占用 / 额度」。
 *
 * 各家实现不一，旧设备还可能干脆没有这个接口，所以按顺序逐条试：
 * 1. navigator.storage.estimate()（新标准；Safari 要 15.2 以上）
 * 2. navigator.webkitTemporaryStorage.queryUsageAndQuota（旧 WebKit 的老路）
 * 3. 都拿不到 → 如实标 none，由页面明说「这台设备没给」，而不是留两行空白让人以为是坏了
 */
async function readQuota(): Promise<{
  usedBytes: number;
  quotaBytes: number;
  source: QuotaSource;
  storageApiAvailable: boolean;
}> {
  const storageApiAvailable =
    typeof navigator !== "undefined" && typeof navigator.storage !== "undefined";

  if (storageApiAvailable) {
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate?.usage ?? 0;
      const quota = estimate?.quota ?? 0;
      if (used > 0 || quota > 0) {
        return { usedBytes: used, quotaBytes: quota, source: "estimate", storageApiAvailable };
      }
    } catch {
      /* 这条路不通就试下一条。 */
    }
  }

  const legacy = (navigator as Navigator & { webkitTemporaryStorage?: WebkitTemporaryStorage })
    .webkitTemporaryStorage;
  if (legacy?.queryUsageAndQuota) {
    const reading = await new Promise<{ usage: number; quota: number } | null>((resolve) => {
      try {
        legacy.queryUsageAndQuota?.(
          (usage, quota) => resolve({ usage, quota }),
          () => resolve(null),
        );
      } catch {
        resolve(null);
      }
    });
    if (reading && (reading.usage > 0 || reading.quota > 0)) {
      return {
        usedBytes: reading.usage,
        quotaBytes: reading.quota,
        source: "webkit",
        storageApiAvailable,
      };
    }
  }

  return { usedBytes: 0, quotaBytes: 0, source: "none", storageApiAvailable };
}

/** 数一遍本机占用。任何一步失败都当 0，不让体检页自己崩掉。 */
export async function scanStorageSpace(): Promise<StorageSnapshot> {
  const totals: Record<StorageCategoryId, { bytes: number; count: number }> = {
    chat: { bytes: 0, count: 0 },
    media: { bytes: 0, count: 0 },
    archives: { bytes: 0, count: 0 },
    memories: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };

  await kvEach((key, value) => {
    const bucket = totals[KEY_CATEGORY[key] ?? "other"];
    bucket.bytes += estimateValueBytes(value);
    bucket.count += countOf(value);
  }).catch(() => undefined);

  await eachMediaSummary((item) => {
    totals.media.bytes += item.size;
    totals.media.count += 1;
  }).catch(() => undefined);

  const quota = await readQuota();

  const categories = (Object.keys(totals) as StorageCategoryId[]).map((id) => ({
    id,
    ...CATEGORY_META[id],
    bytes: totals[id].bytes,
    count: totals[id].count,
  }));

  return {
    usedBytes: quota.usedBytes,
    quotaBytes: quota.quotaBytes,
    quotaSource: quota.source,
    storageApiAvailable: quota.storageApiAvailable,
    categories,
    totalBytes: categories.reduce((sum, item) => sum + item.bytes, 0),
  };
}

/** 把字节数说成人话：1.2 MB / 340 KB / — 。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}
