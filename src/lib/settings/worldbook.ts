/**
 * 世界书持久化（IndexedDB KV）。
 *
 * 一份数据：world-books —— 世界书阵列（含各自的条目）。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { normalizeEntryPosition } from "@/types/worldbook";
import type { WorldBook, WorldBookEntry, WorldBookScope } from "@/types/worldbook";

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
  // 旧数据归一化：补注入位置/触发概率默认值；单选绑定迁移为多选数组（结构升级不丢旧书）。
  return saved.map((b) => ({
    ...b,
    boundCharacterIds:
      b.boundCharacterIds ?? ((b as { boundCharacterId?: string | null }).boundCharacterId
        ? [(b as { boundCharacterId?: string | null }).boundCharacterId as string]
        : []),
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
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  /* 恩熙 2026-09-19：新立的卷排在已有书之后，不从前面插队。
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

/* ----------------------------- 导入 ----------------------------- */

/**
 * 批量收录世界书：重编书与条目 id 后追加到书架（不覆盖现有书）。
 * 条目缺省栏位自动补默认值，坏行跳过不中断。
 * 返回 [收录后的完整书架, 成功条数]。
 */
export async function importWorldBooks(
  incoming: unknown[],
): Promise<[WorldBook[], number]> {
  const books = await getWorldBooks();
  const now = new Date().toISOString();
  let count = 0;

  const parsed: WorldBook[] = [];
  incoming.forEach((raw) => {
    if (typeof raw !== "object" || raw === null) return;
    const b = raw as Record<string, unknown>;
    const entries = Array.isArray(b.entries) ? b.entries : [];
    const book: WorldBook = {
      id: uuid(),
      name: typeof b.name === "string" && b.name ? b.name : "收录之书",
      description: typeof b.description === "string" ? b.description : "",
      scope:
        b.scope === "online" || b.scope === "offline" ? b.scope : "global",
      boundCharacterIds: [],
      entries: entries
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e) => ({
          id: uuid(),
          title: typeof e.title === "string" ? e.title : "",
          keys: typeof e.keys === "string" ? e.keys : "",
          content: typeof e.content === "string" ? e.content : "",
          constant: e.constant === true,
          disabled: e.disabled === true,
          position: normalizeEntryPosition(e.position),
          probability:
            typeof e.probability === "number" && e.probability >= 0 && e.probability <= 100
              ? Math.round(e.probability)
              : 100,
          createdAt: now,
          updatedAt: now,
        })),
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
    count += 1;
  });

  const merged = [...parsed, ...books];
  await saveWorldBooks(merged);
  return [merged, count];
}
