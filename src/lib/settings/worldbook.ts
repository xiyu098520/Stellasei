/**
 * 世界书持久化（IndexedDB KV）。
 *
 * 一份数据：world-books —— 世界书阵列（含各自的条目）。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { normalizeEntryPosition } from "@/types/worldbook";
import {
  type EntryPosition,
  type WorldBook,
  type WorldBookEntry,
  type WorldBookScope,
} from "@/types/worldbook";

const BOOKS_KEY = "world-books";

/**
 * 解析条目关键词为阵列：中英文逗号均可分隔，自动去空白与空项。
 * UI 标签显示与未来 prompt 组装器的关键词匹配共用此函数，保证口径一致。
 */
export function parseEntryKeys(keys: string): string[] {
  return keys
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function getWorldBooks(): Promise<WorldBook[]> {
  const saved = await kvGet<WorldBook[]>(BOOKS_KEY);
  if (!saved) return [];
  // 旧数据归一化：补注入位置/触发概率默认值；单选绑定迁移为多选数组；补绑定世界栏位（结构升级不丢旧书）。
  return saved.map((b) => ({
    ...b,
    boundCharacterIds:
      b.boundCharacterIds ?? ((b as { boundCharacterId?: string | null }).boundCharacterId
        ? [(b as { boundCharacterId?: string | null }).boundCharacterId as string]
        : []),
    boundCategoryIds: b.boundCategoryIds ?? [],
    entries: b.entries.map((e) => ({
      ...e,
      position: normalizeEntryPosition(e.position),
      probability: e.probability ?? 100,
    })),
  }));
}

export async function saveWorldBooks(books: WorldBook[]): Promise<void> {
  await kvSet(BOOKS_KEY, books);
}

/** 新建一本空书（默认全局范围），返回新书。 */
export async function createWorldBook(name = "未命名之书"): Promise<WorldBook> {
  const books = await getWorldBooks();
  const now = new Date().toISOString();
  const book: WorldBook = {
    id: uuid(),
    name,
    description: "",
    scope: "global" satisfies WorldBookScope,
    boundCharacterIds: [],
    boundCategoryIds: [],
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  /* 新立的卷排在已有书之后，不从前面插队。
     牌桌是按这个数组顺序排的，所以顺序＝牌序：第一本永远在第一张，新书落末位。 */
  await saveWorldBooks([...books, book]);
  return book;
}

/** 更新一本书的任意栏位（浅合并）。 */
export async function updateWorldBook(
  id: string,
  patch: Partial<Omit<WorldBook, "id" | "entries">>,
): Promise<void> {
  const books = await getWorldBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx >= 0) {
    books[idx] = { ...books[idx], ...patch, updatedAt: new Date().toISOString() };
    await saveWorldBooks(books);
  }
}

/** 删除一本书。 */
export async function deleteWorldBook(id: string): Promise<void> {
  const books = await getWorldBooks();
  await saveWorldBooks(books.filter((b) => b.id !== id));
}

/* ----------------------------- 条目 CRUD ----------------------------- */

/** 给某本书追加一条空条目，返回完整条目。 */
export async function addEntry(
  bookId: string,
  entry: Partial<WorldBookEntry> = {},
): Promise<WorldBookEntry> {
  const books = await getWorldBooks();
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx < 0) throw new Error("世界书不存在");
  const now = new Date().toISOString();
  const full: WorldBookEntry = {
    id: uuid(),
    title: "",
    keys: "",
    content: "",
    constant: false,
    disabled: false,
    position: "role_after",
    probability: 100,
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
  books[idx].entries.push(full);
  books[idx].updatedAt = now;
  await saveWorldBooks(books);
  return full;
}

/** 更新某本书里的一条条目（浅合并）。 */
export async function updateEntry(
  bookId: string,
  entryId: string,
  patch: Partial<Omit<WorldBookEntry, "id">>,
): Promise<void> {
  const books = await getWorldBooks();
  const book = books.find((b) => b.id === bookId);
  const entry = book?.entries.find((e) => e.id === entryId);
  if (book && entry) {
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
    book.updatedAt = new Date().toISOString();
    await saveWorldBooks(books);
  }
}

/** 删除某本书里的一条条目。 */
export async function deleteEntry(bookId: string, entryId: string): Promise<void> {
  const books = await getWorldBooks();
  const book = books.find((b) => b.id === bookId);
  if (book) {
    book.entries = book.entries.filter((e) => e.id !== entryId);
    book.updatedAt = new Date().toISOString();
    await saveWorldBooks(books);
  }
}

/**
 * 酒馆（SillyTavern／社区）导出的条目位置是数字，与本项目的四种位置对得上：
 * 0=角色定义前／1=角色定义后／2=作者注释顶／3=作者注释底／4=示例对话顶／5=示例对话底。
 * 后两种（示例对话）我们没有对应的格子，落到「对话后」，别丢。
 */
function mapNumericPosition(value: number): EntryPosition {
  if (value === 0) return "role_before";
  if (value === 1) return "role_after";
  if (value === 2) return "chat_before";
  return "chat_after";
}

/** 关键词：本项目是逗号分隔的字符串，酒馆是字符串阵列，两种都收。 */
function readKeys(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((k): k is string => typeof k === "string")
    .map((k) => k.trim())
    .filter(Boolean)
    .join(",");
}

/**
 * 收录时把一条原始条目归一成项目里的条目，两种来源格式都过这里。
 *
 * ⚠️ 1.6.8 之前这里只认自家的写法——`entries` 得是**阵列**，关键词栏位叫 `keys`、
 * 停用叫 `disabled`、位置是字符串。而酒馆／社区导出的书 `entries` 是**对象**
 * （键是序号），条目里关键词叫 `key`（阵列）、备注叫 `comment`、停用叫 `disable`、
 * 位置是**数字** —— 于是整本书被收进来却一条条目都没有，界面还报「收录成功」。
 * 恩熙报的「活人感世界书插到别的小手机就好使、插到咱们这儿一点反应没有」，
 * 就是这条（见施工日志第 613 条）。
 */
function normalizeImportedEntry(
  raw: Record<string, unknown>,
  now: string,
): WorldBookEntry | null {
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  /* 没正文的条目永远注不进提示词，不入库——省得书架里躺一堆空条目。 */
  if (!content) return null;
  return {
    id: uuid(),
    title:
      typeof raw.title === "string"
        ? raw.title
        : typeof raw.comment === "string"
          ? raw.comment
          : "",
    keys: readKeys(raw.keys ?? raw.key),
    content,
    constant: raw.constant === true,
    /* 自家叫 disabled，酒馆叫 disable，两个都认。 */
    disabled: raw.disabled === true || raw.disable === true,
    position:
      typeof raw.position === "number"
        ? mapNumericPosition(raw.position)
        : normalizeEntryPosition(raw.position),
    probability:
      typeof raw.probability === "number" && raw.probability >= 0 && raw.probability <= 100
        ? Math.round(raw.probability)
        : 100,
    createdAt: now,
    updatedAt: now,
  };
}

/** 条目列表归一：`entries` 是阵列（自家）或对象（酒馆，键是序号）都认。 */
function normalizeImportedEntries(value: unknown, now: string): WorldBookEntry[] {
  const rows: Record<string, unknown>[] = Array.isArray(value)
    ? (value.filter((e) => typeof e === "object" && e !== null) as Record<string, unknown>[])
    : typeof value === "object" && value !== null
      ? (Object.values(value).filter(
          (e) => typeof e === "object" && e !== null,
        ) as Record<string, unknown>[])
      : [];
  return rows
    .map((e) => normalizeImportedEntry(e, now))
    .filter((e): e is WorldBookEntry => e !== null);
}

/* ----------------------------- 导入 ----------------------------- */

/**
 * 批量收录世界书：重编书与条目 id 后追加到书架（不覆盖现有书）。
 * 条目缺省栏位自动补默认值，坏行跳过不中断。
 * 返回 [收录后的完整书架, 收录的书数, 收录的条目数]。
 */
export async function importWorldBooks(
  incoming: unknown[],
): Promise<[WorldBook[], number, number]> {
  const books = await getWorldBooks();
  const now = new Date().toISOString();
  let bookCount = 0;
  let entryCount = 0;

  const parsed: WorldBook[] = [];
  incoming.forEach((raw) => {
    if (typeof raw !== "object" || raw === null) return;
    const b = raw as Record<string, unknown>;
    const entries = normalizeImportedEntries(b.entries, now);
    /* 一条都没落进来的书不入库：从前照收，书架里多出一本空书、界面还报「收录成功」，
       等于把「格式没收进来」这件事悄悄咽掉（1.6.8 改，原因见上面那条注释）。 */
    if (entries.length === 0) return;
    const book: WorldBook = {
      id: uuid(),
      name: typeof b.name === "string" && b.name ? b.name : "收录之书",
      description: typeof b.description === "string" ? b.description : "",
      scope:
        b.scope === "online" || b.scope === "offline" ? b.scope : "global",
      boundCharacterIds: [],
      boundCategoryIds: Array.isArray(b.boundCategoryIds)
        ? b.boundCategoryIds.filter((x): x is string => typeof x === "string")
        : [],
      entries,
      createdAt: now,
      updatedAt: now,
    };
    // boundCharacterIds 单选旧格式迁移。
    if (typeof b.boundCharacterId === "string" && b.boundCharacterId) {
      book.boundCharacterIds = [b.boundCharacterId];
    } else if (
      Array.isArray(b.boundCharacterIds) &&
      b.boundCharacterIds.every((x) => typeof x === "string")
    ) {
      book.boundCharacterIds = b.boundCharacterIds as string[];
    }
    parsed.push(book);
    bookCount += 1;
    entryCount += entries.length;
  });

  const merged = [...parsed, ...books];
  /* 一本都没收进来就别写库（否则只是把原样读出来的书架原样写回去）。 */
  if (parsed.length > 0) await saveWorldBooks(merged);
  return [merged, bookCount, entryCount];
}
