/**
 * 类人分层记忆系统（v2，2026-09-15 与用户共同设计）。
 *
 * 衰减链：当前批（原文）→ 短期（分类条目，可编辑）→ 中期（只读，保事件丢细节）
 *         → 长期（只读，只留印象）。
 * 旁路：重要记忆（core）永不压缩永不遗忘；用户手动标的（pinnedByUser）AI 不得推翻。
 *
 * 关键机制：
 * - 整批浓缩（2026-09-16 改「短期保全」）：当前批攒满 contextLimit 条（默认 50）
 *   → 整批交给 AI 浓缩成短期条目——只删寒暄/纯玩笑/客套口水话，实质内容
 *   （事件、决定、情绪、偏好禁忌、新得知的信息）基本全收，同话题并一条、不限字数
 *   → 水位线推进、计数清零。细节的「遗忘」推迟到中期压缩去做（分层更类人：
 *   近期记得细，久了才模糊）。
 * - 对账：浓缩时把「未兑现的承诺／未解的心结」一并喂给 AI；新对话里兑现了／和好了
 *   → 旧条目状态流转（fulfilledIso / resolvedIso），同时在「我们的经历」新增对应事件；
 *   一般性矛盾以新为准（旧条目作废）。
 * - 压缩吸并（2026-09-16 改按分类）：短期某分类满 MID_THRESHOLD 条（20）→ 只把
 *   该分类连同中期同分类条目交给 AI 合并压缩（谁满压谁，不一锅端）；
 *   中期→长期仍整层（满 10）。讲同一件事的新旧条目熔成一条（不会两条并行）。
 *   压缩优先保住：重要 ＞ 节点/承诺/心结 ＞ 一般。
 * - 注入（2026-09-17 恩熙定「甲」）：四层的记忆条目**全量**注入，不设条数上限、
 *   不按话题重排，每层固定按事情发生时间新→旧列；各层带「清晰度」说明——长期只是
 *   印象，营造「模糊印象→被追问→靠中期/短期捞回细节」的真人回忆感。
 *   原文（完整对话历史）同时照常全部发送，记忆只是「多一份摘要」，永不顶替原文。
 *
 * 记忆跟着「角色 × 面具」走；存储键 v2（旧 v1 数据自然作废，测试期清零重来）。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { fetchAIReply } from "@/lib/chat/chatApi";
import { getConversations } from "@/lib/settings/chat";
import { DEFAULT_MASK_ID } from "@/lib/settings/mask";
import type {
  ChatApiSettings,
  CharacterMemory,
  ChatMessage,
  ChatMoment,
  MemoryCategory,
  MemoryItem,
} from "@/types/chat";

const MEMORY_KEY = "character-memories-v2";

/** 朋友圈（动态）注入上限：动态没有层级、越攒越多，全量灌进上下文迟早撑爆。
 *  只列最近的这么些条，更早的报个条数——TA 至少知道「往后还发过不少」，
 *  不至于当成自己从没发过。（恩熙 2026-09-21 要把动态纳入记忆。） */
export const MOMENT_INJECT_MAX = 40;

/** 动态「压缩」后保留的最近原文条数：比它更旧的会被压成一段模糊印象。
 *  恩熙 2026-09-21：「朋友圈也可以去进行压缩，因为我肯定不会记得我上个月发的
 *  朋友圈内容写了什么，对不对？」——真人也只记得近的，久的只剩个大概。 */
const MOMENT_KEEP = 12;
/** 没被压过的动态攒到这么多条才动手（少于这个数还不够格「模糊」，压了反而假）。 */
const MOMENT_COMPRESS_AT = 20;

/** 短期某分类满多少条（非重要）触发该分类压缩进中期。
 *  2026-09-16 恩熙拍板两条：①「短期保全」——整理只删寒暄口水话，实质内容
 *  基本全收（不限字数）；②「按分类压缩」——单标签满 20 条才压该标签
 *  （承诺与约定满 20 就专门压承诺类），不一锅端整层。 */
const MID_THRESHOLD = 20;
/** 中期满多少条触发压缩进长期。 */
const LONG_THRESHOLD = 10;

/** 分类中文名（提示词与 UI 共用）。 */
export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  mine: "我的事",
  theirs: "TA 的事",
  us: "我们的经历",
  milestone: "关系节点",
  promise: "承诺与约定",
  other: "其他",
};

/* ----------------------------- 存取 ----------------------------- */

function defaultMemory(convId: string, characterId: string, maskId: string): CharacterMemory {
  return {
    convId,
    characterId,
    maskId,
    enabled: true,
    contextLimit: 50,
    autoCondense: true,
    items: [],
    summarizedToIso: "",
    newCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function loadAll(): Promise<CharacterMemory[]> {
  const saved = await kvGet<CharacterMemory[]>(MEMORY_KEY);
  return Array.isArray(saved) ? saved : [];
}

/** 取某绑定的记忆（没有则返回默认值，不落库）。 */
export async function getMemory(characterId: string, maskId: string): Promise<CharacterMemory> {
  const all = await loadAll();
  const found = all.find((m) => m.characterId === characterId && m.maskId === maskId);
  return found ?? defaultMemory(`${characterId}::${maskId}`, characterId, maskId);
}

/** 整份保存（读-改-写排队，防并发覆盖）。 */
let writeChain: Promise<unknown> = Promise.resolve();

export function saveMemory(next: CharacterMemory): Promise<CharacterMemory> {
  const run = writeChain.then(async () => {
    const all = await loadAll();
    const idx = all.findIndex(
      (m) => m.characterId === next.characterId && m.maskId === next.maskId,
    );
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = stamped;
    else all.push(stamped);
    await kvSet(MEMORY_KEY, all);
    return stamped;
  });
  writeChain = run.catch(() => {});
  return run;
}

/** 全部记忆（记忆 App 列表用，按更新时间新→旧）。 */
export async function getAllMemories(): Promise<CharacterMemory[]> {
  const all = await loadAll();
  return all.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 更新设置（开关／上下文条数／自动浓缩）。 */
export async function updateMemorySettings(
  characterId: string,
  maskId: string,
  patch: Partial<Pick<CharacterMemory, "enabled" | "contextLimit" | "autoCondense">>,
): Promise<CharacterMemory> {
  const cur = await getMemory(characterId, maskId);
  return saveMemory({ ...cur, ...patch });
}

/** 删除某绑定的全部记忆。 */
export async function deleteMemory(characterId: string, maskId: string): Promise<void> {
  const all = await loadAll();
  const next = all.filter((m) => !(m.characterId === characterId && m.maskId === maskId));
  if (next.length !== all.length) await kvSet(MEMORY_KEY, next);
}

/** 编辑一条短期/重要记忆（中期长期只读，UI 层拦截；标重要会同步换层）。 */
export async function updateMemoryItem(
  characterId: string,
  maskId: string,
  itemId: string,
  patch: Partial<
    Pick<
      MemoryItem,
      "content" | "category" | "important" | "pinnedByUser" | "secret" | "grudge" | "tier"
    >
  >,
): Promise<CharacterMemory> {
  const cur = await getMemory(characterId, maskId);
  return saveMemory({
    ...cur,
    items: cur.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
  });
}

/** 删除一条记忆（任何层都可整条删除）。 */
export async function deleteMemoryItem(
  characterId: string,
  maskId: string,
  itemId: string,
): Promise<CharacterMemory> {
  const cur = await getMemory(characterId, maskId);
  return saveMemory({ ...cur, items: cur.items.filter((it) => it.id !== itemId) });
}

/* ----------------------------- 浓缩提示词 ----------------------------- */

const shortTime = (iso: string) => iso.slice(5, 16).replace("T", " ");

/** 素材格式化：一条消息 → 「时间 名字：内容」（媒体消息转文字说明）。
 *  2026-09-17 恩熙定「甲」：原话一字不截——宁可整理素材长一点，也不让 TA 看到残句。 */
function formatSource(messages: ChatMessage[], charName: string, myName: string): string {
  return messages
    .map((m) => {
      const time = m.createdAt.slice(5, 16).replace("T", " ");
      const who = m.role === "user" ? myName : charName;
      let body = m.content;
      if (m.type === "image") body = `〔发来图片：${m.content}〕`;
      if (m.type === "voice") body = `〔发来语音：${m.content}〕`;
      return `${time} ${who}：${body}`;
    })
    .join("\n");
}

/** 对账素材：未兑现的承诺＋未解的心结（带 id，供 AI 引用做状态流转）。 */
function pendingAccounts(items: MemoryItem[]): MemoryItem[] {
  return items.filter(
    (it) =>
      (it.category === "promise" && !it.fulfilledIso) ||
      (it.grudge && !it.resolvedIso),
  );
}

function accountList(accounts: MemoryItem[]): string {
  if (accounts.length === 0) return "（无）";
  return accounts
    .map((a) => `[${a.id}] ${CATEGORY_LABEL[a.category]}：${a.content}`)
    .join("\n");
}

/** 浓缩提示词：一批对话 → 短期记忆条目（JSON）＋对账指令。 */
function condensePrompt(
  charName: string,
  myName: string,
  events: string,
  from: string,
  to: string,
  accounts: MemoryItem[],
): string {
  return `你是记忆整理助手。根据以下 ${charName} 与 ${myName} 的聊天记录，提炼值得长期记住的记忆条目。

时间跨度：${from} 至 ${to}

聊天记录：
${events}

${accounts.length > 0 ? `【旧记忆对账】以下是 ${charName} 记忆中未兑现的承诺与未解的心结（格式 [id] 内容）：
${accountList(accounts)}
请判断这批对话里有没有让上述旧记忆的状态发生变化（承诺兑现了／心结和好了／旧信息被新信息取代）。
- 兑现/解开：在对应条目的 JSON 里给 oldId 返回 "fulfilled" 或 "resolved"，并在新条目里（分类用 us）补一条对应事件
- 被取代：返回 "superseded"（旧信息作废）
- 没变化：不用提它

` : ""}【提炼要求】
- 人设里已有的信息一律不记录：${charName} 的名字、外貌（发色瞳色身形体态）、服装、身份职业、性格、居住地、背景故事等静态设定，TA 天生就知道（每轮对话都自带），记下来是纯重复；同理 ${myName} 的名字也不记。只记聊天中新发生、新得知的动态信息
- 分类（category）只能是：mine（关于${myName}的事：喜好、习惯、身份、透露的心事）／theirs（关于${charName}自己的事：近况、临时状态、聊天中透露的经历）／us（两人共同经历的事件）／milestone（关系转折点：第一次、确定关系、纪念日、和好）／promise（说好的还没兑现的约定）／other
- important（true）只给「永远不会忘的事」：人设没写但聊天中确认的重大事实（生日、家庭、重大纪念日、关键共同决定），宁缺毋滥
- secret（true）：只属于两人的秘密才标
- grudge（true）：吵架没和好、有疙瘩没说清才标
- 提炼方式（短期记忆要「保全」而不是「摘句」）：只丢弃寒暄、打招呼、纯玩笑、客套口水话；凡有实质内容的对话——新得知的事、发生的事件、做的决定、情绪变化、透露的偏好与禁忌——都要收进记忆，宁多勿漏。同一话题的几个来回并成一条讲清来龙去脉，不规定字数，长度由内容决定
- 用 ${charName} 自己的口吻写（第一人称「我」），回忆里的 ${myName} 称「你」——这是 TA 自己的记忆，不是旁白；条目之间按话题组织、不要逐句翻译对话
- 没有值得记的就返回空数组

【输出格式】只输出 JSON，不要任何其他文字：
{"items":[{"category":"us","content":"……","important":false,"secret":false,"grudge":false}],${
      accounts.length > 0 ? `"reconcile":[{"oldId":"……","action":"fulfilled|resolved|superseded"}],`
    : ""}}`;
}

/**
 * 压缩提示词：一批短期（或中期）条目 → 压缩后的新条目。
 * 中期＝吸并式（连同已有中期条目一起熔炼替换）；
 * 长期＝只增式（跟随 Mem0/MemGPT：旧长期条目永不重写，本批输出直接追加，
 *       防「传话游戏」式漂移——每次全量重熔会一点一点改掉最早的记忆）。
 */
function compressPrompt(
  charName: string,
  myName: string,
  sourceTier: "short" | "mid",
  sources: MemoryItem[],
  existing: MemoryItem[],
  targetLabel: string,
): string {
  const isLong = targetLabel === "长期";
  const fmt = (it: MemoryItem) =>
    `[${it.id}]（${CATEGORY_LABEL[it.category]}${it.fulfilledIso ? "·已兑现" : ""}${it.resolvedIso ? "·已解开" : ""}）${it.content}`;
  return `你是记忆压缩助手。${charName} 的记忆要从「${sourceTier === "short" ? "短期" : "中期"}」压缩到「${targetLabel}」——像人的遗忘曲线一样${isLong ? "只留下模糊的印象" : "保住事件、丢失细节"}。

待压缩条目（新→旧）：
${sources.map(fmt).join("\n")}

${existing.length > 0 ? `已有的${targetLabel}条目（与新条目讲同一件事的必须熔成一条，旧的将被替换）：
${existing.map(fmt).join("\n")}
` : ""}【压缩要求】
${isLong ? `- 长期记忆只增不改：这批条目整理完会直接追加进长期记忆，已有的旧长期条目不参与本次整理（它们不会出现在上面）；只在批内做归并，不同事件各自保留` : "- 不规定字数，长度由内容决定：一个事件一条，把该保留的写清楚就行。合并同一件事的前后多条时，把来龙去脉（起因→经过→结果）写进同一条，该长就长"}
- ${isLong ? "长期只留印象：『很久以前发生过这类事』和当时的感受基调；批内同一类事可归成一条（如多次吵架又和好→「常有摩擦但总会和好」），不需要来龙去脉，但事件类型不能丢" : "中期保留：事件本身（谁、何时、做了什么、结果如何）；丢弃：细节装饰（说了什么原话、具体吃了什么穿了什么）"}
${isLong ? "" : "- 讲同一件事的新旧条目必须熔成一条（例如「约定看海」＋「去看了海」→「曾约定看海，后已实现」）"}
- 已兑现/已解开的状态，既要在 content 里自然体现（如「后已实现」「后来和好」），也要用 fulfilled/resolved/grudge 字段标出（见输出格式），不能只写文字不填字段
- 沿用原口吻：仍以 ${charName} 的第一人称（「我」）写，${myName} 称「你」，不要改成旁白
- 只合并真正讲同一件事（或同类事）的条目；不同的事件各自保留，宁多勿丢
- 保留 priority：关系节点(milestone)＞承诺与约定(promise)＞带心结(grudge)标记＞一般条目；只有明显琐碎无后续的才可丢弃
- category 保持原分类；important 条目不会出现在这里（它们永不压缩）

【输出格式】只输出 JSON：
{"items":[{"category":"us","content":"……","fulfilled":false,"resolved":false,"grudge":false}]}`;
}

/* ----------------------------- AI 结果解析 ----------------------------- */

interface CondenseResult {
  items: {
    category: MemoryCategory;
    content: string;
    important?: boolean;
    secret?: boolean;
    grudge?: boolean;
  }[];
  reconcile?: { oldId: string; action: "fulfilled" | "resolved" | "superseded" }[];
}

/**
 * 从 AI 回复里抠 JSON（容忍 markdown 代码块包裹、前后说明文字、思考段里的花括号）。
 * 不能直接「第一个 { 到最后一个 }」：思考型模型的话题里常带花括号，
 * 那样切出来的整段不是 JSON，而真正的 JSON 明明就在后面。
 * 改成从每个 { 起做括号配对扫描，取第一段能解析成功的。
 */
function parseJsonReply<T>(reply: string, diag?: { reason?: string }): T | null {
  const text = reply.trim();
  /* 记下「最长的那段」的报错：思考段往往也是一个闭合的 {…}，
     但它比真 JSON 短得多——留长的那条的报错才是真线索。 */
  let bestLen = 0;
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    const end = matchBrace(text, i);
    if (end < 0) continue;
    const raw = text.slice(i, end + 1);
    try {
      const parsed = JSON.parse(raw) as T;
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) {
      if (diag && raw.length > bestLen) {
        bestLen = raw.length;
        diag.reason = err instanceof Error ? err.message : String(err);
      }
      /* 原样不合法：模型偶尔多打尾随逗号、正文里带裸换行或没转义的引号，温柔修一遍再试 */
      try {
        const fixed = JSON.parse(fixLooseJson(raw)) as T;
        if (fixed && typeof fixed === "object") return fixed;
      } catch {
        /* 这一段还是不行，换下一个 { 起点再试 */
      }
    }
  }
  return null;
}

/**
 * 温柔修模型的常见手滑（正文内容只补转义、不改一个字）：
 * - 字符串外：中文逗号／顿号／冒号被当分隔符、末尾多一个逗号、中文引号当定界符
 * - 字符串内：正文里的裸换行／制表符／没转义的引号（模型排版时最容易犯）
 */
function fixLooseJson(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") continue;
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      if (ch === '"') {
        /* 后面（跳过空白）不是 , } ] : 的话，它就不是收尾的定界符，
           而是正文里的引号（「他说"你好"」这种），转义掉。 */
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j += 1;
        const next = s[j];
        if (next === undefined || ",}]:".includes(next)) {
          inStr = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "“" || ch === "”") {
      inStr = true;
      out += '"';
      continue;
    }
    if (ch === "，" || ch === "、") {
      out += ",";
      continue;
    }
    if (ch === "：") {
      out += ":";
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (s[j] === "}" || s[j] === "]") {
        i = j - 1; // 尾随逗号丢掉，顺带跳过它后面的空白
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** 判断回复是「被掐断」还是「格式错」——手机端 toast 一眼能念出来。 */
function describeBadReply(reply: string): string {
  const text = reply.trim();
  const first = text.indexOf("{");
  if (first < 0) return "整段没有 JSON";
  let closed = false;
  for (let i = first; i >= 0; i = text.indexOf("{", i + 1)) {
    const end = matchBrace(text, i);
    if (end >= 0) {
      closed = true;
      i = end;
    }
  }
  return closed ? "有完整的 JSON 段但格式不对" : "JSON 没写完就被掐断（括号不闭合）";
}

/** 从 { 起做括号配对（跳过字符串内和转义的花括号），返回配对的 } 下标；不闭合返回 -1。 */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const VALID_CATEGORIES: MemoryCategory[] = [
  "mine",
  "theirs",
  "us",
  "milestone",
  "promise",
  "other",
];

/* ----------------------------- 管线 ----------------------------- */

/** 并发锁：同一绑定的记忆管线不重入。 */
const runningSet = new Set<string>();

export type MemoryRunResult = { ran: boolean; error?: string };

/** 浓缩管线要的那点会话信息（直接从 Conversation 上取；
 *  `moments` 是朋友圈动态，跑完浓缩顺带把旧的压成一段印象）。 */
export type MemorySource = {
  characterId: string;
  maskId: string;
  messages: ChatMessage[];
  moments?: ChatMoment[];
};

/**
 * 每轮回复后调用：计数达标就整批浓缩＋级联压缩＋对账（后台执行，失败只进 console）。
 */
export async function maybeRunMemoryPipeline(
  conv: MemorySource,
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
): Promise<MemoryRunResult> {
  const memory = await getMemory(conv.characterId, conv.maskId);
  if (!memory.enabled || !memory.autoCondense) return { ran: false };
  if (memory.newCount < memory.contextLimit) return { ran: false };
  const key = `${conv.characterId}::${conv.maskId}`;
  if (runningSet.has(key)) return { ran: false };
  runningSet.add(key);
  try {
    return await runCondense(conv, charName, myName, textApi, memory);
  } finally {
    runningSet.delete(key);
  }
}

/** 手动归总：不管攒没攒满，把当前批（水位线后全部消息）立刻浓缩。 */
export async function forceCondense(
  conv: MemorySource,
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
): Promise<MemoryRunResult> {
  const key = `${conv.characterId}::${conv.maskId}`;
  if (runningSet.has(key)) return { ran: false, error: "正在整理记忆中" };
  runningSet.add(key);
  try {
    const memory = await getMemory(conv.characterId, conv.maskId);
    return await runCondense(conv, charName, myName, textApi, memory, true);
  } finally {
    runningSet.delete(key);
  }
}

/** 执行一次浓缩＋对账＋级联压缩检查。 */
async function runCondense(
  conv: MemorySource,
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
  memoryIn: CharacterMemory,
  manual = false,
): Promise<MemoryRunResult> {
  // 当前批素材：水位线之后的全部对话消息（不设条数上限，原话全给）。
  const source = conv.messages.filter(
    (m) =>
      m.role !== "system" &&
      (!memoryIn.summarizedToIso || m.createdAt > memoryIn.summarizedToIso),
  );
  if (source.length < 4) {
    if (manual) return { ran: false, error: "当前批还没有可归总的对话" };
    await saveMemory({ ...memoryIn, newCount: 0 });
    return { ran: false };
  }

  const api = textApi.enabled && textApi.baseUrl.trim() && textApi.model.trim() ? textApi : null;
  if (!api) return { ran: false, error: "文本 API 未配置" };

  const events = formatSource(source, charName, myName);
  const accounts = pendingAccounts(memoryIn.items);

  let result: CondenseResult;
  try {
    const reply = await fetchAIReply(
      api,
      "你是严谨的记忆整理助手，只输出 JSON 本身。",
      [],
      condensePrompt(charName, myName, events, shortTime(source[0].createdAt), shortTime(source[source.length - 1].createdAt), accounts),
      20,
      8000, // 浓缩要输出整批条目的 JSON，思考型模型的思考也占额度——800 必截断
      0.3, // 整理任务要稳定输出，不用聊天的发散温度（跟随参考项目）
    );
    const diag: { reason?: string } = {};
    const parsed = parseJsonReply<CondenseResult>(reply, diag);
    if (!parsed || !Array.isArray(parsed.items)) {
      console.warn("[Memory] 浓缩结果不是合法 JSON：", reply.slice(0, 500));
      /* 后台触发时手机看不到控制台，把回复形状和解析器的原话写进 error——
         手动归总的 toast 一显示，念出来就能定位。 */
      const why = diag.reason
        ? diag.reason.replace(/\s+/g, " ").slice(0, 70)
        : parsed
          ? "JSON 解析成功但 items 不是数组"
          : describeBadReply(reply);
      return { ran: false, error: `AI 未返回合法 JSON（${why}）` };
    }
    result = parsed;
  } catch (err) {
    console.warn("[Memory] 浓缩失败，下轮重试：", err);
    return { ran: false, error: err instanceof Error ? err.message : String(err) };
  }

  const now = new Date().toISOString();
  const fromIso = source[0].createdAt;
  const toIso = source[source.length - 1].createdAt;

  // 新短期条目（AI 标 important 的进 core；用户没机会预审，pinnedByUser 留空）。
  // 2026-09-17 恩熙定「甲」：条数与字数都不再砍——AI 提炼多少就收多少。
  const newItems: MemoryItem[] = result.items
    .filter((r) => r.content && r.content.length >= 8 && VALID_CATEGORIES.includes(r.category))
    .map((r) => ({
      id: uuid(),
      tier: (r.important ? "core" : "short") as MemoryItem["tier"],
      category: r.category,
      content: r.content.trim(),
      fromIso,
      toIso,
      createdAt: now,
      important: !!r.important,
      secret: !!r.secret,
      grudge: !!r.grudge,
    }));

  // 对账：旧条目状态流转（pinnedByUser 的重要记忆只许补充不许推翻）。
  let items = memoryIn.items;
  const reconcile = Array.isArray(result.reconcile) ? result.reconcile : [];
  for (const r of reconcile) {
    if (!r.oldId || !r.action) continue;
    items = items.map((it) => {
      if (it.id !== r.oldId) return it;
      // 用户手动标的重要记忆：AI 不能动状态，跳过（内容补充由新条目承担）。
      if (it.pinnedByUser) return it;
      if (r.action === "fulfilled") return { ...it, fulfilledIso: now };
      if (r.action === "resolved") return { ...it, resolvedIso: now };
      return null; // superseded → 稍后过滤
    }).filter((it): it is MemoryItem => it !== null);
  }

  let next: CharacterMemory = {
    ...memoryIn,
    items: [...newItems, ...items],
    summarizedToIso: toIso,
    newCount: 0,
  };

  // 级联压缩（失败不影响浓缩结果）。
  next = await cascadeCompress(next, charName, myName, api);
  /* 朋友圈动态也压一压：旧的那批合成一段模糊印象（恩熙 2026-09-21 要的）。
     内部自己吞错——压缩是锦上添花，不能带崩这轮浓缩。 */
  next = await compressMoments(next, conv.moments ?? [], charName, api);
  await saveMemory(next);
  return { ran: true };
}

/** 级联压缩：短期按分类分别触发（谁满压谁，不一锅端）；中期满 → 长期（整层吸并）。 */
async function cascadeCompress(
  memory: CharacterMemory,
  charName: string,
  myName: string,
  api: ChatApiSettings,
): Promise<CharacterMemory> {
  let next = memory;

  // 短期 → 中期（按分类计数：「承诺与约定」满 20 就只压承诺类，别的分类原地不动）。
  // 各分类条目互不重叠，压缩 A 类不影响 B 类的计数，循环里逐类判定即可。
  const shortByCat = new Map<MemoryCategory, number>();
  for (const it of next.items) {
    if (it.tier !== "short") continue;
    shortByCat.set(it.category, (shortByCat.get(it.category) ?? 0) + 1);
  }
  for (const [cat, count] of shortByCat) {
    if (count >= MID_THRESHOLD) {
      const r = await compressTier(next, charName, myName, api, "short", "mid", MID_THRESHOLD, false, cat);
      if (r.ok) next = r.memory;
    }
  }

  // 中期 → 长期（中期已是事件级条目、量少，维持整层触发）
  const midPool = next.items.filter((it) => it.tier === "mid");
  if (midPool.length >= LONG_THRESHOLD) {
    const r = await compressTier(next, charName, myName, api, "mid", "long", LONG_THRESHOLD);
    if (r.ok) next = r.memory;
  }

  return next;
}

/** 压缩一层的返回：成功带新记忆，失败带给人看的错误。 */
type TierResult = { ok: true; memory: CharacterMemory } | { ok: false; error: string };

/** 压缩一层：取池子里的条目＋目标层已有条目 → AI 吸并 → 替换。
 *  category 指定＝只压该分类（自动触发的分标签压缩）：池子、吸并素材、
 *  替换范围都限定同分类——别分类的条目一律不动（否则会被误删）。
 *  manual＝不看阈值直接压（测试用；手动按钮不传 category＝整层压）。 */
async function compressTier(
  memory: CharacterMemory,
  charName: string,
  myName: string,
  api: ChatApiSettings,
  fromTier: "short" | "mid",
  toTier: "mid" | "long",
  threshold: number,
  manual = false,
  category?: MemoryCategory,
): Promise<TierResult> {
  const now = new Date().toISOString();
  // 池子：非重要的条目（重要＝core 层，天然不在 short/mid 池里），按分类过滤。
  const pool = memory.items
    .filter((it) => it.tier === fromTier && (!category || it.category === category))
    .slice()
    .reverse(); // 旧→新，方便 AI 按时间理解
  if (pool.length === 0 || (!manual && pool.length < threshold)) {
    return { ok: false, error: "没有可压缩的条目" };
  }

  // 长期＝只增式：旧长期条目不进素材（不重写、不替换，输出直接追加）；
  // 中期＝吸并式：已有中期条目一起熔炼（分标签压缩时只吸并同分类的）。
  // core 永不参与（不在 short/mid 池里）。
  const isLong = toTier === "long";
  const existing = isLong
    ? []
    : memory.items.filter((it) => it.tier === toTier && (!category || it.category === category));
  let reply: string;
  try {
    reply = await fetchAIReply(
      api,
      "你是严谨的记忆压缩助手，只输出 JSON 本身。",
      [],
      compressPrompt(charName, myName, fromTier, pool, existing, toTier === "mid" ? "中期" : "长期"),
      20,
      8000, // 压缩素材多＋思考型模型的思考占额度，给足防截断
      0.3,
    );
  } catch (err) {
    console.warn(`[Memory] ${fromTier}→${toTier} 压缩失败：`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const parsed = parseJsonReply<{
    items: { category: MemoryCategory; content: string; fulfilled?: boolean; resolved?: boolean; grudge?: boolean }[];
  }>(reply);
  if (!parsed || !Array.isArray(parsed.items)) {
    // 原文记进 console，方便排查 AI 到底回了什么。
    console.warn(`[Memory] ${fromTier}→${toTier} 压缩结果不是合法 JSON：`, reply.slice(0, 300));
    return { ok: false, error: "AI 未返回合法 JSON（详见控制台）" };
  }

  const range = {
    fromIso: pool[0]?.fromIso ?? now,
    toIso: pool[pool.length - 1]?.toIso ?? now,
  };
  const newTierItems: MemoryItem[] = parsed.items
    .filter((r) => r.content && VALID_CATEGORIES.includes(r.category))
    .map((r) => ({
      id: uuid(),
      tier: toTier,
      category: r.category,
      content: r.content.trim(),
      fromIso: range.fromIso,
      toIso: range.toIso,
      createdAt: now,
      important: false,
      /* 压缩别再把「已兑现/已解开/有疙瘩」这几个状态丢了——否则一条「约定看海」被压进中期后
         又变回「未兑现」，对账反复问、注入时也不显示已兑现，模型就会误以为还没去看过海。 */
      ...(r.fulfilled ? { fulfilledIso: now } : {}),
      ...(r.resolved ? { resolvedIso: now } : {}),
      ...(r.grudge ? { grudge: true } : {}),
    }));

  if (newTierItems.length === 0) return { ok: false, error: "压缩结果为空" };

  // 移除池子条目；中期模式连同被吸并的旧目标层条目一起替换，长期模式旧条目原样保留（追加）。
  // 分标签压缩时只替换同分类的目标层条目——别分类的绝不能被动到（否则误删）。
  const removedIds = new Set(pool.map((p) => p.id));
  const kept = memory.items.filter((it) => {
    if (removedIds.has(it.id)) return false;
    if (isLong) return true; // 长期只增：旧长期一律保留
    if (it.tier !== toTier) return true; // 非目标层不动
    return category ? it.category !== category : false; // 无分类＝整层替换；有分类＝只换同分类
  });
  return { ok: true, memory: { ...memory, items: [...newTierItems, ...kept] } };
}

/** 手动压缩：短期整层压进中期／中期整层压进长期（不看阈值，供测试压缩细节）。 */
export async function forceCompress(
  conv: { characterId: string; maskId: string },
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
  fromTier: "short" | "mid",
): Promise<MemoryRunResult> {
  const key = `${conv.characterId}::${conv.maskId}`;
  if (runningSet.has(key)) return { ran: false, error: "正在整理记忆中" };
  runningSet.add(key);
  try {
    const memory = await getMemory(conv.characterId, conv.maskId);
    const label = fromTier === "short" ? "短期" : "中期";
    if (memory.items.filter((it) => it.tier === fromTier).length === 0) {
      return { ran: false, error: `还没有${label}记忆可压缩` };
    }
    const api = textApi.enabled && textApi.baseUrl.trim() && textApi.model.trim() ? textApi : null;
    if (!api) return { ran: false, error: "文本 API 未配置" };
    const toTier = fromTier === "short" ? "mid" : "long";
    const r = await compressTier(memory, charName, myName, api, fromTier, toTier, 0, true);
    if (!r.ok) return { ran: false, error: r.error };
    await saveMemory(r.memory);
    return { ran: true };
  } finally {
    runningSet.delete(key);
  }
}

/* ----------------------------- 历史裁剪 ----------------------------- */

/**
 * 上下文历史裁剪（2026-09-17 晚定案「丙方案」，接替「每轮滑动窗口」）。
 *
 * 平时**一条不裁**（只增不减：前缀每轮只在尾巴上添新消息，站子的自动前缀缓存
 * 轮轮命中）；总条数攒到「浓缩门槛」的下一个整数倍时切**一刀**，切掉最老那批、
 * 留下「浓缩门槛」条——裁断那一轮前缀变了、缓存重建一笔（贵这一下，1.25×），
 * 之后接着只增不减，直到再攒够一个门槛。代价因此从「每轮都亏」变成「每 N 轮亏一轮」。
 *
 * **刀必须钉在整倍线上（别写成 slice(-contextLimit)）**：若每轮都取「最近 N 条」，
 * 新消息一进，窗口就往前滑一格，开头跟着变——等于每轮都把整段缓存作废。
 * 钉成整倍后，同一段区间内开头恒定（只往尾巴上加），只有跨线那一轮断一次。
 *
 * **为什么恒为两倍（硬规则，别改）**：裁掉的那批必须已经浓缩进记忆（先浓缩、后裁）。
 * 浓缩按 contextLimit 条触发，等攒到 2×contextLimit 时最老那一半早已入库，
 * 此时裁掉才不丢东西。故门槛只由 contextLimit 派生，不另设参数——恩熙只填一个数。
 *
 * 记忆关闭、自动浓缩关闭（没有摘要兜底）或门槛非正数时一律不裁：这时裁掉就是真丢。
 */
export function trimHistory(
  history: ChatMessage[],
  memory: CharacterMemory | null,
): ChatMessage[] {
  const nonSystem = history.filter((m) => m.role !== "system");
  if (!memory || !memory.enabled || !memory.autoCondense || memory.contextLimit <= 0) {
    return nonSystem;
  }
  const limit = memory.contextLimit;
  const total = nonSystem.length;
  if (total < limit * 2) return nonSystem;
  /* 刀钉在 limit 的整数倍上：只有总条数跨过下一条整倍线时才切，切完留 limit 条。
     区间内（如 100~149 条）起点恒定，前缀逐轮只增，缓存连读；
     跨线那一轮（150 条）起点前移 limit，断一次再重建。 */
  const cut = limit * (Math.floor(total / limit) - 1);
  return nonSystem.slice(cut);
}

/* ----------------------------- 注入 ----------------------------- */

/**
 * 生成注入 prompt 的「记忆碎片」块。
 * 2026-09-17 恩熙定「甲」：全量注入、不设条数上限，每层按事情发生时间新→旧原样列出。
 * （旧版按「与当前话题的相关度」重排＋每层只取 8 条：旧的记忆凭空消失，
 *  而且顺序每轮都变——既丢记忆，又把前缀缓存整段作废。）
 * 无记忆返回空串。
 */
export async function buildMemoryBlock(
  memory: CharacterMemory,
  charName: string,
  myName: string,
): Promise<string> {
  if (!memory.enabled) return "";
  const sections: string[] = [];

  const core = memory.items.filter((it) => it.tier === "core");
  if (core.length > 0) {
    sections.push(
      `■ 永远不会忘的事实：\n${core.map((it) => `- ${it.content}`).join("\n")}`,
    );
  }

  const tiers: { tier: "short" | "mid" | "long"; label: string; hint: string }[] = [
    { tier: "short", label: "近期的事", hint: "" },
    { tier: "mid", label: "较早的事（细节已模糊）", hint: "" },
    {
      tier: "long",
      label: "很久以前（只剩模糊印象）",
      hint: "这些只是印象，不要假装记得细节；被问起细节时先试着回想较早的记忆。同类条目多次出现＝这类事发生过多次",
    },
  ];
  for (const t of tiers) {
    const list = memory.items
      .filter((it) => it.tier === t.tier)
      .slice()
      /* 事情发生的时间新→旧（按条目覆盖时间段的末尾排）。顺序固定＝缓存稳定。 */
      .sort((a, b) => b.toIso.localeCompare(a.toIso))
      .map((it) => {
        const status = it.fulfilledIso
          ? "（已兑现）"
          : it.category === "promise"
            ? "（还没兑现）"
            : it.resolvedIso
              ? "（已解开）"
              : it.grudge && !it.resolvedIso
                ? "（还有疙瘩没解开）"
                : "";
        const secret = it.secret ? "（秘密）" : "";
        return `- [${CATEGORY_LABEL[it.category]}] ${it.content}${status}${secret}`;
      });
    if (list.length > 0) {
      sections.push(
        `■ ${t.label}${t.hint ? `\n（${t.hint}）` : ""}\n${list.join("\n")}`,
      );
    }
  }

  /* 朋友圈（动态）：恩熙 2026-09-21 要「把动态纳入记忆」，并且要在记忆里
     **分得清「哪些是聊天里说的、哪些是朋友圈发的」**——所以动态不混进上面四层
     （四层是聊天记录浓缩出来的），单独成节、抬头就写明来源。
     动态**不混进聊天那条浓缩线**（四层是聊天记录浓缩出来的）；它自己另有一条：
     近的原文照列，更早的压成一段模糊印象（见 buildMomentSection／compressMoments）。 */
  const momentSection = await buildMomentSection(memory);
  if (momentSection) sections.push(momentSection);

  if (sections.length === 0) return "";
  /* 这句只在真列了动态时才说——没列还说「最后一节是动态」，TA 会去找一节不存在的东西。
     没有动态时整段逐字回到从前，前缀缓存不受影响。 */
  const momentNote = momentSection
    ? "\n最后一节是你自己发在朋友圈的动态，跟聊天记录是两条线：她刷得到、但你不一定当面跟她提过。她聊起某条动态你可以自然接上，但别把动态里的内容当成「聊天时我跟你说过」——聊天里说过的都在前面几层里。"
    : "";
  return `【你对 ${myName} 的记忆】
以下是 ${charName} 对 ${myName} 的真实记忆。这些记忆是你自己的认知，不是要背诵的条目：可以顺着当下把它们化成自然的行动或提议（记得${myName}想看海，就主动提议哪天一起去看海；记得${myName}爱喝楼下那家咖啡，就顺口带一句点了外卖），但不要生硬地把条目念出来，不要用「你上次说」「我记得你喜欢」去复述或追问，除非对方这次真的提到了，才顺其自然地接。
不同层的记忆清晰度不同，越久远越模糊，这是正常的；与当下话题相关的旧记忆被想起是自然的。近期对话里已经聊过的，就别照着记忆再重讲一遍。
记忆按时间从近到远分了几层。同一件事，如果近期层和更早层说法不一致，一律以近期层为准——那才是最新状态。比如更早层写着「约定去看海」，近期层写着「已经去过海了」，就说明看海这件事已经发生、约定了结了，别再当成还没去做；反过来，如果只有更早层写了「约定去看海」、近期层没有任何相关记录，那它就是个还没兑现的旧约定。${momentNote}

${sections.join("\n\n")}`;
}

/** 动态落库时的时间戳 → 记忆块里那枚小日期（MM/DD）。 */
function momentDate(iso: string): string {
  return iso.slice(5, 10).replace("-", "/");
}

/** 一条动态拼成素材行：`- [MM/DD] 文字解说`；图文再附一行画面描述。
 *  注入、印象压缩两头都用它，口径自然一致。
 *  （图文那段是恩熙 2026-09-21 要的：「如果他是发的图文，那他图片应该也要有
 *  文字描述写进去」——不然 TA 只记得自己配了什么字，不记得画的是什么。） */
function momentLine(m: ChatMoment): string {
  const head = `- [${momentDate(m.createdAt)}] ${m.content.trim()}`;
  const pic = m.imagePrompt?.trim();
  return pic ? `${head}\n  （配图：${pic}）` : head;
}

/** 已经压进印象的那些动态 id。印象得跟 id 配套：只有印象文字在、却没记下压过哪几条
 *  （理论上不会）时就当一条没压过——宁可多列几条原文，也不能凭一条无根的印象让 TA 编。 */
function momentCovered(memory: CharacterMemory): Set<string> {
  if (!memory.momentDigest?.trim()) return new Set();
  return new Set(memory.momentDigestIds ?? []);
}

/**
 * 把某绑定发过的朋友圈动态拼成记忆块的一节（没有则空串）。
 * 数据不另存一份，直接读那条会话的 `moments`——动态页、记忆页、注入用的是同一份源，
 * 清空记忆时那边一清，这里自然就空了（不会留下对不上的影子）。
 *
 * 两截（恩熙 2026-09-21 要的「动态也压缩」）：最近的原文照录，更早的那批只留一段
 * 模糊印象——真人也记不住上个月自己写了什么。
 * 另有一截更硬的：恩熙手动标了「重要」的那几条永远原文照录，不参与压缩、也不被
 * 上限挤掉（恩熙同日：「那朋友圈是不是也要有一个能够标记为重要 的功能呢？」）。
 */
async function buildMomentSection(memory: CharacterMemory): Promise<string> {
  const all = await getConversations();
  const conv = all.find(
    (c) => c.characterId === memory.characterId && (c.maskId ?? DEFAULT_MASK_ID) === memory.maskId,
  );
  const list = (conv?.moments ?? []).filter((m) => m.content.trim());
  if (list.length === 0) return "";
  const digest = memory.momentDigest?.trim() ?? "";
  const covered = momentCovered(memory);
  /* 标为重要的先摆出来（TA 心里最当回事的几条）。 */
  const pinned = list.filter((m) => m.pinnedByUser);
  /* 其余可列原文的：印象之外的、也没标重要的。库里是旧→新。 */
  const live = list.filter((m) => !m.pinnedByUser && !covered.has(m.id));
  /* 取最近一批；连同重要的那些各倒成新→旧，重要的摆最前（顺序固定＝前缀缓存稳）。 */
  const recent = live.slice(-MOMENT_INJECT_MAX);
  const lines = [...pinned.slice().reverse(), ...recent.slice().reverse()].map(momentLine);
  /* 尾巴交代「更早的还有什么」：压过就报印象，一条没压过就只报条数。 */
  const older = list.length - pinned.length - recent.length;
  const olderNote =
    older <= 0
      ? ""
      : digest
        ? `\n（再往前的约 ${older} 条，你只记得个大概：${digest}）`
        : `\n（再往前的还有 ${older} 条，没一条条列出来）`;
  return `■ 你在朋友圈发过的（这些是你发在朋友圈的动态，不是你们聊天里说过的）\n${lines.join("\n")}${olderNote}`;
}

/** 动态印象的合成提示词：已有的印象 ＋ 新倒下的一批旧动态 → 更新后的印象。 */
function momentDigestPrompt(charName: string, existing: string, lines: string[]): string {
  return `以下是${charName}很久以前发在朋友圈的旧动态（「[月/日] 内容」，缩进行是那条配图的画面描述）：

${lines.join("\n")}

${existing ? `【比这批更新的印象（已经有了）】\n${existing}\n\n` : ""}请把上面这批和已有的印象合成一段回忆，写成${charName}自己心里回想的样子。

【要求】
- 第一人称「我」，一到三句，像人回忆很久以前的事：只记得个大概，具体的字句早就模糊了
- 只留「那阵子我在做什么、心情怎么样、老惦记什么」，别复述每条动态的内容，别写日期
- 不分条、不加标题、不加任何前后缀，直接输出那段回忆本身`;
}

/**
 * 朋友圈动态的「压缩」：把更旧的那批合成一段模糊印象。
 * 恩熙 2026-09-21：「我觉得朋友圈也可以去进行压缩，因为我肯定不会记得我上个月发的
 * 朋友圈内容写了什么，对不对？」——跟记忆四层同构：最近 MOMENT_KEEP 条原文照录，
 * 往前的攒够 MOMENT_COMPRESS_AT 条就交给 AI 合成一段。
 * 印象是滚雪球式的（旧印象＋新倒下的一批 → 更新的印象），不会越滚越长。
 * 恩熙手动标了「重要」的那几条不进这一趟：TA 得一直记着原话。
 * 失败原样返回：压缩是锦上添花，不许带崩这轮浓缩。
 */
async function compressMoments(
  memory: CharacterMemory,
  moments: ChatMoment[],
  charName: string,
  api: ChatApiSettings,
): Promise<CharacterMemory> {
  const covered = momentCovered(memory);
  /* 待压的池子：有内容的、没标重要的、还没进过印象的。 */
  const pool = moments.filter((m) => m.content.trim() && !m.pinnedByUser && !covered.has(m.id));
  if (pool.length <= MOMENT_COMPRESS_AT) return memory;
  const batch = pool.slice(0, pool.length - MOMENT_KEEP);
  if (batch.length === 0) return memory;
  try {
    const reply = await fetchAIReply(
      api,
      `你是${charName}本人，正在回想自己以前发在朋友圈的旧动态。只输出那段回忆本身。`,
      [],
      momentDigestPrompt(charName, memory.momentDigest?.trim() ?? "", batch.map(momentLine)),
      20,
      600, // 只要一到三句，额度够用就行
      0.6, // 回忆是散着的，允许一点发散
    );
    const text = reply.trim().slice(0, 400); // 万一模型长篇大论，截住，别让它越滚越大
    if (!text) return memory;
    /* 记下压了哪几条（按 id 认）——这样之后恩熙把某条标为重要，也不会牵动这段印象。 */
    return {
      ...memory,
      momentDigest: text,
      momentDigestIds: [...(memory.momentDigestIds ?? []), ...batch.map((m) => m.id)],
    };
  } catch (err) {
    console.warn("[Memory] 动态印象压缩失败，下轮再试：", err);
    return memory;
  }
}

/** 每轮对话后累加当前批消息数（user＋assistant 各算一条）。 */
export async function bumpMemoryCount(
  characterId: string,
  maskId: string,
  added: number,
): Promise<void> {
  if (added <= 0) return;
  const cur = await getMemory(characterId, maskId);
  if (!cur.enabled) return;
  await saveMemory({ ...cur, newCount: cur.newCount + added });
}
