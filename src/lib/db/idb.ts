/**
 * 极薄的 IndexedDB Promise 封装。
 *
 * 为什么不用 localStorage：
 * - 记忆碎片、聊天记录、照片（Blob）数据量会持续增长，localStorage 容量小且同步阻塞。
 * - 一期只需要一个键值库（kv）；现在多了 messages（消息仓库），日后还要加 memories 等，
 *   都在 DB_VERSION 升级、在 onupgradeneeded 里补建即可。
 *
 * 两个库的分工：
 * - kv：零散的键值（会话元数据、各类设定……），一笔一个 key，整份读出/整份写回。
 * - messages：聊天消息，**一条消息一行**（keyPath = id），靠 `byConv` 索引按会话取。
 *   为什么单开：会话那边原来是「整个阵列（含全部消息）存成一个键」，每发一条都要把
 *   全部消息读出来再整份写回去（O(全部消息)），聊天一多就越来越卡。拆开后，
 *   发一条＝只写这一行（O(1)），会话元数据（不含消息）单独一笔、写得也轻。
 *
 * 注意：本模组只能在客户端调用（IndexedDB 不存在於 SSR）。
 * 请在 useEffect／事件处理中使用，切勿在元件渲染期直接调用。
 */

const DB_NAME = "stellasei-new";
const DB_VERSION = 2;
const KV_STORE = "kv";
const MESSAGES_STORE = "messages";
/** 消息仓库里「这行属于哪个会话」的目录索引（按 convId 取一个会话的全部消息）。 */
const MESSAGES_BY_CONV = "byConv";

/**
 * 消息仓库里一行记录的公共骨架：任何一条消息落库时都带上
 * - convId：它属于哪个会话（`${characterId}::${maskId}`），`byConv` 索引认它；
 * - seq：会话内单调递增序号（1 起）。**不能拿 id／createdAt 排序**——id 是 uuid、
 *   顺序≠先后；createdAt 会有同毫秒、或回执/回声沿用原时间戳的情况——所以专门留一个序号。
 * 其余字段就是该条 ChatMessage 本身（role/content/createdAt/…）。
 */
export interface MessageRow {
  id: string;
  convId: string;
  seq: number;
}

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
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          // 消息库：一条消息一行（keyPath = id），另有 byConv 索引按会话取。
          const messages = db.createObjectStore(MESSAGES_STORE, {
            keyPath: "id",
          });
          messages.createIndex(MESSAGES_BY_CONV, "convId", { unique: false });
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

function runStoreTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = fn(tx.objectStore(storeName));
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

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return runStoreTx(KV_STORE, mode, fn);
}

/**
 * 事务里跑一段「自己驱动游标／多步」的活儿（不只是一个 request）。
 *
 * runStoreTx 只等「某一个 request」的结果；但像「按索引删掉一个会话的全部消息」
 * 这种要开游标逐条删的，没法用单个 request 表达。这里把事务交给 work 自己掌控，
 * work 里读 cursor、continue；游标跑空后事务自动提交，提交成功才算完成。
 */
function runStoreOp(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(txAbortError(tx, "IndexedDB 事务"));
        tx.oncomplete = () => resolve();
        try {
          work(tx.objectStore(storeName));
        } catch (error) {
          reject(error);
        }
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

/* ============================ 消息仓库（messages） ============================
 * 一条消息一行。对外约定：任何 ChatMessage 落库时都被包成 MessageRow，
 * 也就是「消息本体 + convId + seq」。取出来时由上层把 convId/seq 剥掉还原成
 * ChatMessage，所以聊天那边感觉不到多了一层。
 * ========================================================================== */

/** 写入（覆写）一条消息。 */
export async function msgPut<T extends MessageRow>(row: T): Promise<void> {
  await runStoreTx(MESSAGES_STORE, "readwrite", (store) => store.put(row));
}

/** 批量写入（覆写）消息，一次事务。 */
export async function msgPutAll<T extends MessageRow>(rows: T[]): Promise<void> {
  if (rows.length === 0) return;
  await runStoreOp(MESSAGES_STORE, "readwrite", (store) => {
    for (const row of rows) store.put(row);
  });
}

/** 按 id 取一条消息；不存在时回传 undefined。 */
export async function msgGet<T extends MessageRow>(
  id: string,
): Promise<T | undefined> {
  return runStoreTx<T | undefined>(MESSAGES_STORE, "readonly", (store) =>
    store.get(id) as IDBRequest<T | undefined>,
  );
}

/** 取某个会话的全部消息（走 byConv 索引；顺序未定，排序交给上层）。 */
export async function msgGetByConv<T extends MessageRow>(
  convId: string,
): Promise<T[]> {
  return runStoreTx<T[]>(MESSAGES_STORE, "readonly", (store) =>
    store.index(MESSAGES_BY_CONV).getAll(convId) as IDBRequest<T[]>,
  );
}

/** 取全部消息（迁移／体检用；日常读单一会话请走 msgGetByConv）。 */
export async function msgGetAll<T extends MessageRow>(): Promise<T[]> {
  return runStoreTx<T[]>(MESSAGES_STORE, "readonly", (store) =>
    store.getAll() as IDBRequest<T[]>,
  );
}

/** 删掉一条消息；id 不存在也不会报错。 */
export async function msgDelete(id: string): Promise<void> {
  await runStoreTx(MESSAGES_STORE, "readwrite", (store) => store.delete(id));
}

/** 删掉某个会话的全部消息（按 byConv 索引开游标逐条删）。 */
export async function msgDeleteByConv(convId: string): Promise<void> {
  await runStoreOp(MESSAGES_STORE, "readwrite", (store) => {
    const index = store.index(MESSAGES_BY_CONV);
    const request = index.openCursor(IDBKeyRange.only(convId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}

/**
 * 游标逐条过一遍消息库（存储体检用）。
 *
 * 与 kvEach 同理：不收集成阵列，回调里当场量完即丢引用。
 */
export function msgEach<T extends MessageRow>(
  visit: (row: T) => void,
): Promise<void> {
  return runStoreOp(MESSAGES_STORE, "readonly", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      visit(cursor.value as T);
      cursor.continue();
    };
  });
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
