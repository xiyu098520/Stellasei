/**
 * 档案（角色档案）持久化。
 *
 * 两份数据：
 * - archives：档案条目阵列（每份属於一个分类）
 * - archive-categories：自订分类（"all" 已唤醒为内建，不存进这里）
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import {
  EMPTY_PROFILE,
  type ArchiveCategory,
  type ArchiveEntry,
  type ContactProfile,
} from "@/types/contact";

/** 空白档案数据工厂：唤醒新档案时用。 */
export { EMPTY_PROFILE };

const ARCHIVES_KEY = "archives";
const CATEGORIES_KEY = "archive-categories";
/** 助手「已辞退」标记（独立于档案数组，见 `isAssistantOff`）。 */
const ASSISTANT_OFF_KEY = "assistant-off";

/** 内建分类：已唤醒（未分类）。 */
export const DEFAULT_CATEGORY_ID = "all";

/* ----------------------------- 档案 CRUD ----------------------------- */

/** 生成手机号式短 ID（1 + [3,5,7,8,9] + 9 位随机数字）。 */
function genPhoneUid(): string {
  const second = [3, 5, 7, 8, 9][Math.floor(Math.random() * 5)];
  let rest = "";
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
  return `1${second}${rest}`;
}

/** 手机号式 ID 展示格式：138 0291 4756。 */
export function formatUid(uid: string): string {
  const d = uid.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` : uid;
}

/** 早期那些细碎栏位（并进新格后删掉，只在迁移里出现）。 */
type LegacyProfileFields = Partial<
  Record<
    | "feature"
    | "clothes"
    | "mark"
    | "desc"
    | "likes"
    | "hates"
    | "phrase"
    | "habit"
    | "storyBg"
    | "storyEvent"
    | "offlineStyle",
    string
  >
>;

const LEGACY_KEYS: (keyof LegacyProfileFields)[] = [
  "feature",
  "clothes",
  "mark",
  "desc",
  "likes",
  "hates",
  "phrase",
  "habit",
  "storyBg",
  "storyEvent",
  "offlineStyle",
];

/** 读取全部档案；缺 uid 的旧档案自动补齐并落库，旧栏位自动并进新格（无感迁移）。 */
export async function getArchives(): Promise<ArchiveEntry[]> {
  const saved = await kvGet<ArchiveEntry[]>(ARCHIVES_KEY);
  if (!saved) return [];
  const used = new Set(saved.map((a) => a.uid).filter(Boolean));
  let changed = false;
  const list = saved.map((raw) => {
    const data = { ...raw.data } as ContactProfile & LegacyProfileFields & { relDate?: string };
    let touched = false;

    /* 无感迁移：「重要日子」栏位已撤，旧数据里那个值其实就是生日——把那个
       值搬进 birth（birth 已有值则不动），再删掉这个键。只动这里：所有读档案的
       地方都走 getArchives()（联系人／聊天／记忆／世界书），所以搬一次就够。 */
    const relDate = data.relDate;
    if (typeof relDate === "string" && relDate.trim()) {
      if (!data.birth?.trim()) data.birth = relDate;
      touched = true;
    }

    /* 无感迁移：细碎栏位并进三个大格（格太多，用户不知道该往哪格写）。
       只在目标格还空着的时候并——用户若已经在新格里写了东西，那是最新的意思，不覆盖。
       并完删掉旧键：界面与提示词都不再认它们。 */
    const merge = (...keys: (keyof LegacyProfileFields)[]) =>
      keys.map((k) => (data[k] ?? "").trim()).filter(Boolean).join("\n");
    if (!data.looks?.trim()) {
      const merged = merge("feature", "clothes", "mark");
      if (merged) {
        data.looks = merged;
        touched = true;
      }
    }
    if (!data.persona?.trim()) {
      const merged = merge("desc", "likes", "hates", "phrase", "habit", "storyBg", "storyEvent");
      if (merged) {
        data.persona = merged;
        touched = true;
      }
    }
    /* 「线下表现」撤掉（线下等做到了再做），老内容追加进「对话参考」——不丢。 */
    const offline = (data.offlineStyle ?? "").trim();
    if (offline) {
      data.onlineStyle = [data.onlineStyle?.trim(), offline].filter(Boolean).join("\n");
      touched = true;
    }
    LEGACY_KEYS.forEach((k) => {
      if (k in data) {
        delete data[k];
        touched = true;
      }
    });
    if (data.relDate !== undefined) {
      delete data.relDate;
      touched = true;
    }

    let a: ArchiveEntry = raw;
    if (touched) {
      a = { ...raw, data };
      changed = true;
    }
    if (a.uid) return a;
    let uid = genPhoneUid();
    while (used.has(uid)) uid = genPhoneUid();
    used.add(uid);
    changed = true;
    return { ...a, uid };
  });
  if (changed) await kvSet(ARCHIVES_KEY, list);
  return list;
}

export async function createArchive(categoryId = DEFAULT_CATEGORY_ID): Promise<ArchiveEntry> {
  const list = await getArchives();
  const entry = createEntry(EMPTY_PROFILE, categoryId);
  await kvSet(ARCHIVES_KEY, [...list, entry]);
  return entry;
}

export async function saveArchive(id: string, profile: ContactProfile): Promise<void> {
  const list = await getArchives();
  const idx = list.findIndex((a) => a.id === id);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      data: profile,
      updatedAt: new Date().toISOString(),
    };
    await kvSet(ARCHIVES_KEY, list);
    /* 她亲手把某张档案的「AI 助手模式」重新打开 —— 那就是把助手请回来了，
       辞退标记顺手清掉，下一趟 `ensureAssistant` 才会重新认它、给各面具补绑定。 */
    if (profile.isAssistant === true) await setAssistantOff(false);
  }
}

export async function deleteArchive(id: string): Promise<ArchiveEntry[]> {
  const list = await getArchives();
  /* 她删掉的是助手档案 → 落一枚辞退标记，否则下次打开聊天 App 又被重建
     （见 `isAssistantOff`）。先记后删，记的是「她删过」，跟删掉的那条本身无关。 */
  if (list.some((a) => a.id === id && a.data.isAssistant === true)) {
    await setAssistantOff(true);
  }
  const updated = list.filter((a) => a.id !== id);
  await kvSet(ARCHIVES_KEY, updated);
  return updated;
}

/** 助手是否已被手动删掉（辞退标记）。
 *
 *  `ensureAssistant` 原来把「档案库里没有助手」一律当成「还没建过」，于是每删
 *  一次就自动补回一个。可这两种状态不是一回事：**从没建过**才该建，**删掉的**不该
 *  再冒出来。这枚标记就是分界线；档案删了就没了，痕迹只能另存一处才留得住。
 *  重新开启某张档案的助手模式即视为请回（见 `saveArchive`）。 */
export async function isAssistantOff(): Promise<boolean> {
  return (await kvGet<boolean>(ASSISTANT_OFF_KEY)) === true;
}

/** 写下／清掉辞退标记。一般不用直接调：删除与请回都已经接在 CRUD 上了。 */
export async function setAssistantOff(off: boolean): Promise<void> {
  await kvSet(ASSISTANT_OFF_KEY, off);
}

/** 把档案移到指定分类。 */
export async function moveArchive(id: string, categoryId: string): Promise<void> {
  const list = await getArchives();
  const idx = list.findIndex((a) => a.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], categoryId };
    await kvSet(ARCHIVES_KEY, list);
  }
}

/** 设为主页：把这条档案挪到最前面（列表页第一个）。
 *  卡册的次序就是这份数组的次序（`ArchiveList` 只按分类与搜索过滤、不重排），
 *  所以「排到第一个」只需要把它挪到数组头。已经是第一个就原样返回，不白写一次库。 */
export async function setArchiveHome(id: string): Promise<ArchiveEntry[]> {
  const list = await getArchives();
  const idx = list.findIndex((a) => a.id === id);
  if (idx <= 0) return list;
  const [entry] = list.splice(idx, 1);
  const updated = [entry, ...list];
  await kvSet(ARCHIVES_KEY, updated);
  return updated;
}

/** 手动排序：把这条档案挪到 `neighborId` 的前／后一位。
 *  顺序由使用者自己编排。
 *  为什么收的是「邻居」而不是下标：卡册只显示当前这一栏的人，档案数组里却混着别的
 *  世界——按邻居挪，挪完在**当前这一栏里**正好换到那个位置；按下标挪会出现
 *  「把 C 往前一位」但中间隔着别的世界的人、看着一动没动的情况。
 *  邻居找不到（不该发生）就原样放回，不白写一次库。 */
export async function moveArchiveNear(
  id: string,
  neighborId: string,
  place: "before" | "after",
): Promise<ArchiveEntry[]> {
  const list = await getArchives();
  const from = list.findIndex((a) => a.id === id);
  if (from < 0) return list;
  const [entry] = list.splice(from, 1);
  const at = list.findIndex((a) => a.id === neighborId);
  if (at < 0) {
    list.splice(from, 0, entry);
    return list;
  }
  list.splice(place === "before" ? at : at + 1, 0, entry);
  await kvSet(ARCHIVES_KEY, list);
  return list;
}

/* ----------------------------- 分类 CRUD ----------------------------- */

export async function getCategories(): Promise<ArchiveCategory[]> {
  const saved = await kvGet<ArchiveCategory[]>(CATEGORIES_KEY);
  return saved ?? [];
}

export async function addCategory(name: string): Promise<ArchiveCategory[]> {
  const list = await getCategories();
  const category: ArchiveCategory = { id: uuid(), name };
  const updated = [...list, category];
  await kvSet(CATEGORIES_KEY, updated);
  return updated;
}

export async function deleteCategory(id: string): Promise<ArchiveCategory[]> {
  const list = await getCategories();
  const updated = list.filter((c) => c.id !== id);
  await kvSet(CATEGORIES_KEY, updated);

  // 该分类下的档案退回「已唤醒」。
  const archives = await getArchives();
  const moved = archives.map((a) =>
    a.categoryId === id ? { ...a, categoryId: DEFAULT_CATEGORY_ID } : a,
  );
  await kvSet(ARCHIVES_KEY, moved);

  return updated;
}

/* ------------------------------- 工厂 -------------------------------- */

function createEntry(data: ContactProfile, categoryId: string): ArchiveEntry {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    uid: genPhoneUid(),
    createdAt: now,
    updatedAt: now,
    categoryId,
    data,
  };
}
