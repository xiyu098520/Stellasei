/**
 * 极薄的 IndexedDB Promise 封装。
 *
 * 为什么不用 localStorage：
 * - 记忆碎片、聊天记录、照片（Blob）数据量会持续增长，localStorage 容量小且同步阻塞。
 * - 一期只需要一个键值库（kv）；日后新增对象库（messages / memories…）时在 DB_VERSION 升级即可。
 *
 * 注意：本模组只能在客户端调用（IndexedDB 不存在於 SSR）。
 * 请在 useEffect／事件处理中使用，切勿在元件渲染期直接调用。
 */

const DB_NAME = "stellasei-new";
const DB_VERSION = 1;
const KV_STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("IndexedDB 只能在客户端使用（目前在 SSR 环境）"),
    );
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KV_STORE)) {
          // 键值库：每笔 { key, value }，value 可以是任意结构化数据（含 Blob）。
          db.createObjectStore(KV_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("IndexedDB 升级被其他分页封鎖，请关闭旧分页后重试"));
    });
  }

  return dbPromise;
}

interface KvRecord<T> {
  key: string;
  value: T;
}

/**
 * 事务被中止时，给出**真的**原因。
 *
 * 这里以前写死一句「多半是存储配额满了」：实测整库不到 10MB 也照报这句，
 * 纯属误导（还把人骗去查 API 设定）。现在照实报——浏览器给什么错就说什么，
 * 什么都没给就明说没给，不再替它编一个。
 *
 * name 标成 LocalDatabaseError：上层（聊天窗）据此分辨「是本机没写进去」还是
 * 「接口调不通」——这两件事给用户的提示不该长一样。
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
        const tx = db.transaction(KV_STORE, mode);
        const request = fn(tx.objectStore(KV_STORE));
        let result!: T;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(txAbortError(tx, "IndexedDB 事务"));
        /* 必须等 tx.oncomplete 才算成功：request 的 onsuccess 只代表「这一步做完了」，
           写事务还得等真正提交。配额不足等情况是提交阶段才失败——早 resolve 就是
           「假报成功」：上层以为存进去了，其实没落库（语音生成完却听不了就是这样来的）。 */
        tx.oncomplete = () => resolve(result);
      }),
  );
}

/** 读取一笔键值；不存在时回传 undefined。 */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const record = await runTx<KvRecord<T> | undefined>("readonly", (store) =>
    store.get(key) as IDBRequest<KvRecord<T> | undefined>,
  );
  return record?.value;
}

/** 写入一笔键值（覆写）。 */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  await runTx("readwrite", (store) =>
    store.put({ key, value } satisfies KvRecord<T>),
  );
}

/** 删除一笔键值；键不存在也不会报错。 */
export async function kvDelete(key: string): Promise<void> {
  await runTx("readwrite", (store) => store.delete(key));
}

/**
 * 游标逐条过一遍整库（存储体检用）。
 *
 * 为什么用回调而不是回传阵列：库里的值可能有几十 MB，先收集成阵列再统计等于
 * 把整库又复制一份进内存。回调里当场量完就把引用丢掉，内存占用只跟单笔有关。
 */
export function kvEach(visit: (key: string, value: unknown) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(KV_STORE, "readonly");
        const request = tx.objectStore(KV_STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const record = cursor.value as KvRecord<unknown>;
          visit(record.key, record.value);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(txAbortError(tx, "IndexedDB 统计事务"));
        tx.oncomplete = () => resolve();
      }),
  );
}

/** 测试与除错用：徹底删除整个数据库（正式功能不要调用）。 */
export async function dropDatabase(): Promise<void> {
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("删除数据库被其他分页封鎖，请关闭旧分页后重试"));
  });
}
