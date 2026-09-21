/**
 * 聊天媒体的独立仓库（单独一个 IndexedDB 库）。
 *
 * 为什么另开一个库、不往 stellasei-new 的 kv 里塞：
 * - 图片是二进制大件。以前把整串 data URL 写进消息字段，读一次会话等于把所有图片
 *   一起读出来（参考项目自己在 storage-space 注释里记过这个坑：消息表带 dataURL
 *   音频时，进统计页会整页 OOM 闪退）。
 * - 分开之后，图片的体积统计与清理都不用碰聊天记录本体。
 *
 * 消息里只存引用串 `media-store://mc_xxx`，取用时再换回 Blob／临时地址。
 * 注意：本模组只能在客户端调用（IndexedDB 不存在于 SSR）。
 */

const DB_NAME = "stellasei-media";
const DB_VERSION = 1;
const MEDIA_STORE = "media";

/** 引用串前缀。和参考项目同名同形，日后照抄它的清理逻辑时不用换算。 */
export const MEDIA_REF_PREFIX = "media-store://";

interface MediaRecord {
  id: string;
  blob: Blob;
  mime: string;
  kind: string;
  size: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB 只能在客户端使用（目前在 SSR 环境）"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          const store = db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
          /* 建时间索引：日后「只保留最近 N 天」的清理和体积统计都靠它。 */
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("媒体仓库打开被其他分页封锁，请关闭旧分页后重试"));
    });
  }
  return dbPromise;
}

/**
 * 事务被中止时，给出**真的**原因（与 idb.ts 同款，两个库各自独立不互相引用）。
 * 以前写死的「多半是存储配额满了」是猜的，实测数据不到 10MB 也会报，误导人。
 */
function txAbortError(tx: IDBTransaction, prefix: string): Error {
  const error = tx.error;
  const wrap = (message: string) => {
    const out = new Error(message);
    out.name = "LocalDatabaseError";
    return out;
  };

  if (!error) {
    return wrap(
      `${prefix}被中止：浏览器没给原因（常见于页面被系统暂停、或数据库连接被回收，与空间不足无关）`,
    );
  }

  const name = error.name || "Error";
  if (name === "QuotaExceededError" || /quota|配额/i.test(error.message ?? "")) {
    return wrap(`${prefix}被中止：存储额度确实不够了（${name}）`);
  }

  const detail = error.message && error.message !== name ? `：${error.message}` : "";
  return wrap(`${prefix}被中止：${name}${detail}`);
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, mode);
        const request = fn(tx.objectStore(MEDIA_STORE));
        let result!: T;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(txAbortError(tx, "媒体仓库事务"));
        /* 必须等 tx.oncomplete 才算成功——写事务是提交阶段才可能因配额不足而失败，
           早 resolve 就是「假报成功」，上层以为存进去了其实没落库。 */
        tx.oncomplete = () => resolve(result);
      }),
  );
}

/** 判断一个字符串是不是媒体引用串。 */
export function isMediaRef(value: string | undefined | null): boolean {
  return !!value && value.startsWith(MEDIA_REF_PREFIX);
}

function newMediaId(): string {
  return `${MEDIA_REF_PREFIX}mc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 存入一笔媒体，回传引用串。写不进去（配额满等）会抛错，由调用方兜底。 */
export async function putMediaBlob(blob: Blob, kind = "image"): Promise<string> {
  const id = newMediaId();
  await runTx("readwrite", (store) =>
    store.put({
      id,
      blob,
      mime: blob.type || "application/octet-stream",
      kind,
      size: blob.size,
      createdAt: Date.now(),
    } satisfies MediaRecord),
  );
  return id;
}

/** 取回一笔媒体；引用不存在或库被清过时回传 undefined。 */
export async function getMediaBlob(id: string): Promise<Blob | undefined> {
  if (!isMediaRef(id)) return undefined;
  const record = await runTx<MediaRecord | undefined>("readonly", (store) =>
    store.get(id) as IDBRequest<MediaRecord | undefined>,
  );
  return record?.blob;
}

/** 删除一笔媒体；不存在也不报错。 */
export async function deleteMediaBlob(id: string): Promise<void> {
  if (!isMediaRef(id)) return;
  await runTx("readwrite", (store) => store.delete(id));
}

/** 媒体摘要：只够做体积统计，不含 blob 本体。 */
export interface MediaSummary {
  id: string;
  size: number;
  kind: string;
  createdAt: number;
}

/**
 * 游标逐条列出媒体摘要（存储体检用）。
 *
 * 只读 record.size，不去碰 record.blob——一碰就是把整张图读进内存，
 * 张数一多统计页自己就先撑爆了（参考项目在 storage-space 注释里记过这个坑）。
 */
export function eachMediaSummary(visit: (item: MediaSummary) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, "readonly");
        const request = tx.objectStore(MEDIA_STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const record = cursor.value as MediaRecord;
          visit({
            id: record.id,
            size: record.size,
            kind: record.kind,
            createdAt: record.createdAt,
          });
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(txAbortError(tx, "媒体仓库统计事务"));
        tx.oncomplete = () => resolve();
      }),
  );
}

/* ── 临时地址缓存 ──────────────────────────────────────────────────────────
   一个引用只读一次库、只建一个 blob 地址：同一条消息反复上屏（滚动、切页、
   点开大图）都直接命中，不重复读库，也不会堆一堆没释放的地址。 */

const urlCache = new Map<string, string>();
const blobCache = new Map<string, Blob>();

/** 缓存上限：超过就撤掉最早的那几个，别让地址无限堆在内存里。 */
const MAX_CACHED_URLS = 60;

function cacheBlobUrl(id: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  blobCache.set(id, blob);
  while (urlCache.size > MAX_CACHED_URLS) {
    const oldest = urlCache.keys().next().value as string | undefined;
    if (!oldest || oldest === id) break;
    const dead = urlCache.get(oldest);
    if (dead) URL.revokeObjectURL(dead);
    urlCache.delete(oldest);
    blobCache.delete(oldest);
  }
  return url;
}

/** 同步查缓存里已经解好的地址——刚生成完的图靠它做到零延迟上屏。 */
export function getCachedMediaUrl(value: string | undefined): string | undefined {
  if (!isMediaRef(value)) return undefined;
  return urlCache.get(value as string);
}

/** 同步查缓存里已经解好的 Blob——保存到相册时可以直接用，不必再读一次库。 */
export function getCachedMediaBlob(value: string | undefined): Blob | undefined {
  if (!isMediaRef(value)) return undefined;
  return blobCache.get(value as string);
}

/** 入库后预热：把刚存好的图直接放进缓存，上屏那一刻就命中。 */
export function primeMediaCache(id: string, blob: Blob): string {
  return urlCache.get(id) ?? cacheBlobUrl(id, blob);
}

/**
 * 只进内存、不进仓库的一笔图——仓库写不进去（配额满等）时的兜底。
 *
 * 为什么需要它：生成结果拿到手时是一整串 base64 data URL（好几 MB）。仓库写不进去时
 * 若退回那张原图，这几 MB 就会住进消息的 imageUrl 字段——而会话记录是「每次读列表
 * 都要整份读出」的那一份，图一旦住进去，整个聊天都可能再也存不进去。
 * 这里给个只活在内存里的引用串：这一趟照常上屏、照常能存相册；刷新后缓存清空，
 * 气泡会如实显示「图片已过期或丢失·点此重新生成」。
 */
export function primeEphemeralMedia(blob: Blob): { ref: string; previewUrl: string } {
  const id = newMediaId();
  return { ref: id, previewUrl: cacheBlobUrl(id, blob) };
}

/**
 * 彻底丢掉一笔媒体：先撤掉缓存地址（免得内存里一直挂着），再从仓库删除。
 * 删消息、重新生成（旧图被替换）时调用——不然仓库只进不出，早晚撑满。
 */
export async function disposeMediaBlob(id: string): Promise<void> {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
    blobCache.delete(id);
  }
  await deleteMediaBlob(id);
}

/**
 * 把消息里存的地址解析成能直接给 <img> 用的地址：
 * 引用串 → 读库 → 临时地址；老数据（data URL／http 链接）→ 原样回传。
 */
export async function resolveMediaSrc(value: string): Promise<string> {
  if (!isMediaRef(value)) return value;
  const hit = urlCache.get(value);
  if (hit) return hit;
  const blob = await getMediaBlob(value);
  if (!blob) return "";
  return cacheBlobUrl(value, blob);
}
