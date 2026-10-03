/**
 * 类人分层记忆系统（v2）。
 *
 * 衰减链：当前批（原文）→ 短期（分类条目，可编辑）→ 中期（只读，保事件丢细节）
 *         → 长期（只读，只留印象）。
 * 旁路：重要记忆（core）永不压缩永不遗忘；用户手动标的（pinnedByUser）AI 不得推翻。
 *
 * 关键机制：
 * - 整批浓缩（有取有舍）：当前批攒满 contextLimit 条（默认 50）
 *   → 整批交给 AI 浓缩成短期条目——按「该收什么／不该收什么」两张清单筛（1.7.64），
 *   一条一件事、每条 80 字以内、条数不设上限，同类重复合并成一条
 *   → 水位线推进、计数清零。细节的「遗忘」推迟到中期压缩去做（分层更类人：
 *   近期记得细，久了才模糊）。
 * - 对账：浓缩时把「未兑现的承诺／未解的心结」一并喂给 AI；新对话里兑现了／和好了
 *   → 旧条目状态流转（fulfilledIso / resolvedIso），同时在「我们的经历」新增对应事件；
 *   一般性矛盾以新为准（旧条目作废）。
 * - 压缩吸并（分层按天走，1.7.66）：短期老于 7 天（或某类当天堆满 20 条）→ 轻压进中期，
 *   只把该分类连同中期同分类条目交给 AI 合并压缩（谁够条件压谁，不一锅端）；
 *   中期老于 15 天 → 重压成骨架（仍在中期，产出盖 refinedIso 免得反复压）；
 *   中期老于 30 天 → 进长期（只增式追加）。讲同一件事的新旧条目熔成一条（不会两条并行）。
 *   压缩优先保住：重要 ＞ 节点/承诺/心结 ＞ 一般。
 * - 注入：四层的记忆条目**全量**注入，不设条数上限、
 *   不按话题重排，每层固定按事情发生时间新→旧列；分层标题自带清晰度
 *   （「细节已模糊」「只剩模糊印象」），层内不再另写说明（1.4.6 砍掉——
 *   参考项目记忆槽零说明，只留「近期层压倒旧层」一句消歧）。
 *   原文（完整对话历史）同时照常全部发送，记忆只是「多一份摘要」，永不顶替原文。
 *
 * 记忆跟着「角色 × 面具」走；存储键 v2（旧 v1 数据自然作废，测试期清零重来）。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import { fetchAIReply, fetchAIStreamReply, readVoiceContent } from "@/lib/chat/chatApi";
import { getApiBundle, getConversations } from "@/lib/settings/chat";
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
 *  不至于当成自己从没发过。 */
export const MOMENT_INJECT_MAX = 40;

/** 动态「压缩」后保留的最近原文条数：比它更旧的会被压成一段模糊印象。
 *  真人也只记得近的，久的只剩个大概。 */
const MOMENT_KEEP = 12;
/** 没被压过的动态攒到这么多条才动手（少于这个数还不够格「模糊」，压了反而假）。 */
const MOMENT_COMPRESS_AT = 20;

/** 分层压缩刻度（1.7.66，恩熙 2026-09-29 定：一周全细节、半月有经过、一月剩骨架、更早只剩印象）。
 *  1.7.66 之前短→中按「某分类满 20 条」、中→长按「中期满 10 条」走**条数**，
 *  聊得越猛压得越快、一天的细节当天就糊掉；恩熙的直觉是「人一天说太多本来也会当天忘一部分」，
 *  所以改成按**天**走（条数只留作兜底）。下面的常数是默认值，每份记忆都能在设置里拧（见 `scaleOf`）。 */
/** 短期保鲜（天）：短期条目超过这么多天轻压进中期。恩熙定的一周。 */
const SHORT_FRESH_DAYS = 7;
/** 短期当天上限（条）：某类条目同一天堆到这么多条就当天收口（兜底，防某天爆发式聊天撑爆短期）。 */
const SHORT_SAME_DAY_MAX = 20;
/** 中期熔合门槛（天）：中期条目老于这么多天才重压成骨架。 */
const MID_REFINE_DAYS = 15;
/** 中期保鲜（天）：中期条目超过这么多天进长期（印象化）。 */
const MID_FRESH_DAYS = 30;
/** 中期条数上限（条）：某类中期条目堆到这么多条就强制重压（兜底）。 */
const MID_MAX_ITEMS = 60;
/** 单次补压上限（条）：打开记忆 App 时一次最多补压多少条（约 5 趟），压不完下次接着压。 */
const CATCHUP_BUDGET = 200;
/** 失败跳闸（次）：同一桶（分类 × 来源）连着失败这么多趟就跳过它，
 *  把它最老那天记进 `failedDays`——不让一批永不成功的素材每次打开都白跑一趟、堵着后面的日子。 */
const FAIL_TRIP = 3;

/** 分层刻度默认值（记忆 App 设置区展示与读侧兜底共用，别再各写一份）。 */
export const MEMORY_SCALE_DEFAULTS = {
  shortFreshDays: SHORT_FRESH_DAYS,
  shortSameDayMax: SHORT_SAME_DAY_MAX,
  midRefineDays: MID_REFINE_DAYS,
  midFreshDays: MID_FRESH_DAYS,
  midMaxItems: MID_MAX_ITEMS,
  catchupBudget: CATCHUP_BUDGET,
} as const;

/** 记忆浓缩／压缩这类内部请求的输出上限（token）。
 *  它们要一口气吐整批条目的 JSON；1.7.64 起提示词改成「单条 80 字以内、条数不设上限」，
 *  但一场见面、一整批素材仍可能产出几十条，额度照样得给足。
 *  思考型模型的思考也吃同一份额度——原先给的 8000 真机上会写到一半被掐断
 *  （finish_reason=length），手动点压缩就弹「回复被输出上限截断，已放弃本次结果」。
 *  上限只是天花板，用不到的额度不花钱，宁可给宽，别让整趟白跑。 */
const MEMORY_TASK_MAX_TOKENS = 32000;

/** 记忆浓缩／压缩这类内部请求的超时（毫秒）。
 *  非流式下服务端得等整段生成完才回响应头——普通请求那 60 秒根本不够，
 *  真机上会 abort 成「请求超时」，手动点压缩会弹这句、自动压缩则只在控制台留一行。
 *  压缩已分批（见 COMPRESS_BATCH），单趟素材不多、几十秒就回；这个上限留给
 *  还没分批的浓缩，也当压缩每批的兜底。 */
const MEMORY_TASK_TIMEOUT_MS = 600_000;

/** 压缩一趟最多喂多少条素材（分批）。
 *  手动整层压缩时池子可能攒了几百条：一口吃下去一趟要生成十几分钟，还容易顶到
 *  输出上限被切。切成小批逐趟压，每趟几十条、几十秒就回；哪一趟失败就整趟作废、
 *  下次重来，绝不会把半截结果写进记忆。 */
const COMPRESS_BATCH = 40;

/** 分类中文名（提示词与 UI 共用）。 */
export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  mine: "我的事",
  theirs: "TA 的事",
  us: "我们的经历",
  milestone: "关系节点",
  promise: "承诺与约定",
  other: "其他",
};

/** 记忆类内部任务（归总／压缩／朋友圈印象）统一走这里（恩熙 2026-09-28 定）：
 *  - 填了副 API 且已启用 → 走副 API（非流式，MEMORY_TASK_TIMEOUT_MS 兜底）——
 *    幕后活配个快模型，几十秒回，两头超时都碰不到；
 *  - 没填 → 主 API 改走**流式**：边生成边保活，中间商掐不了线——治的就是她报的
 *    「内容太多、一直说时间过长」（非流式下模型慢慢写大 JSON，网关等不到响应头
 *    就掐，或客户端 10 分钟兜底到点）。流式失败且一字未出时 fetchAIStreamReply
 *    自己会退回非流式，行为不比改动前差。
 *  回退：三处调用换回直呼 fetchAIReply（参数原样在调用处）即可。 */
async function fetchMemoryTask(
  fallbackApi: ChatApiSettings,
  system: string,
  userInput: string,
  opts: { maxTokens: number; temperature?: number; timeoutMs?: number },
): Promise<string> {
  const sub = (await getApiBundle()).sub;
  if (sub.enabled && sub.baseUrl && sub.apiKey && sub.model) {
    return fetchAIReply(
      sub,
      system,
      [],
      userInput,
      20,
      opts.maxTokens,
      opts.temperature ?? 0.3,
      undefined,
      undefined,
      undefined,
      opts.timeoutMs ?? MEMORY_TASK_TIMEOUT_MS,
    );
  }
  return fetchAIStreamReply(fallbackApi, system, [], userInput, () => {}, {
    historyLimit: 20,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.3,
  });
}

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

/** 更新设置（开关／上下文条数／自动浓缩／分层刻度五项）。 */
export async function updateMemorySettings(
  characterId: string,
  maskId: string,
  patch: Partial<
    Pick<
      CharacterMemory,
      | "enabled"
      | "contextLimit"
      | "autoCondense"
      | "shortFreshDays"
      | "shortSameDayMax"
      | "midRefineDays"
      | "midFreshDays"
      | "midMaxItems"
      | "catchupBudget"
      | "shortInjectLimit"
    >
  >,
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

/**
 * 素材里的时间戳：**本地** MM-DD HH:mm。
 *
 * 别再切 ISO 字符串——库里存的是 UTC，在咱们这边（UTC+8）凌晨 0～8 点这段会整整差一天：
 * 29 号凌晨聊的天会被写成「09-28 16:30」，TA 照着写进记忆就成了「28 号的事」
 * （恩熙 2026-09-29 凌晨问的「已经是 29 号凌晨了，他记忆还归在 28 号」就是它）。
 */
const shortTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 素材格式化：一条消息 → 「时间 名字：内容」（媒体消息转文字说明）。
 *  原话一字不截——宁可整理素材长一点，也不让 TA 看到残句。 */
function formatSource(messages: ChatMessage[], charName: string, myName: string): string {
  return messages
    .map((m) => {
      const time = shortTime(m.createdAt);
      /* 系统提示（1.4.42）：这类消息不是谁说的话，署名让给「系统」。
         不这么办，「你已领取 XX 的红包」会被素材记成**TA 说的**——整理记忆时就当真了。 */
      const isSys = m.role === "system" || m.type === "system";
      const who = isSys ? "系统" : m.role === "user" ? myName : charName;
      let body = m.content;
      if (m.type === "image") body = `〔发来图片：${m.content}〕`;
      if (m.type === "voice") body = `〔发来语音：${readVoiceContent(m.content).display}〕`;
      /* 收款回执（1.4.40）：卡片上没有话，别让素材里冒出光秃秃一句「已收款」
         （看着像这个人说了这么一句）。写成带金额的说明，跟图／语音一个口径。 */
      if (m.type === "receipt") body = `〔${m.content}：${(m.amount ?? 0).toFixed(2)} 元〕`;
      /* 钱落定（1.5.12）：TA 转来、我退回的那笔照旧缀「（已退还）」——不缀的话整理
         记忆时会当成「他给过我这笔钱」。过期（我发的、他一直没领，钱已退回我这儿）
         只缀在我发的钱上。红包不能退还（跟微信一致：只能开、不能退）：旧数据里
         我发的红包带「已退还」的，实际就是钱回了口袋，照「已过期」说，
         别让 TA 学出「退红包」这个动作。 */
      if (m.moneyRefunded) {
        body = `${body}${m.role === "user" && m.type === "redpacket" ? "（已过期）" : "（已退还）"}`;
      }
      if (m.role === "user" && m.moneyExpired) {
        body = `${body}（已过期）`;
      }
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

/** 浓缩提示词：一批对话 → 短期记忆条目（JSON）＋对账指令。
 *  offline＝这批素材是两人**线下见面的经过**（1.7.46）：措辞换成「见面」。
 *  recorded＝**这场见面前面几次归总已经记下的条目**（1.7.64）。
 *  为什么要它：线下是按「每几轮」分几次归总的（见 maybeRunOfflineCondense 的轮数门槛），
 *  而每一趟只看得见自己那一段素材——后一趟不知道前一趟写过什么，于是同一段场景被写两遍
 *  （恩熙 2026-09-29 报「线下非常冗长、有些东西是重复的」）。把已记条目喂进去，
 *  它才知道哪些不必再写。 */
function condensePrompt(
  charName: string,
  myName: string,
  events: string,
  from: string,
  to: string,
  accounts: MemoryItem[],
  offline = false,
  recorded: MemoryItem[] = [],
): string {
  /* 8.6 真人化第一刀（恩熙 2026-09-28 点头）：开场身份从「记忆整理助手」换成
     TA 本人——身份是助手时，后面再要求第一人称、称「你」都是拧着的，模型两头
     打架，出来的就是报告腔；身份对了那些要求自然就顺了。「睡前回想今天」是
     归总的正确心境：不是执行任务，是回忆。回退：整句换回「你是记忆整理助手。
     根据以下 ${charName} 与 ${myName} 的……提炼值得长期记住的记忆条目。」即可，
     其余一字未动。 */
  /* 1.7.64 提炼要求重写（恩熙 2026-09-29 点头）。原来的写法是「凡有实质内容的都要收进
     记忆，宁多勿漏……不规定字数，长度由内容决定」——等于敞开灌水，于是记忆条目又长又碎
     （她的原话：「有些东西是可以不被记下的」「线下非常冗长，有些东西都是重复的」）。
     新的三节都写成**正式声明体、不带任何举例**（她的要求：「你要明确」「不要有过多的
     举例，最好是不要有举例」「不要讲这些会让 AI 很恍惚的词」）：
     ① 收录的边界＝该收什么／不该收什么两张清单（原来那版只有一句「只丢寒暄口水话」）；
     ② 分类＝六类定义，**other 这次补上了定义**（从前是裸的，什么都往里塞）；
     ③ 写法＝一条一件事、单条 80 字以内（important 不受限）、条数不设上限、
        同类重复合并成一条只留节点意义的那次（治线下亲密互动一场写三十条）、
        以及「只是提过不许写成约定／玩笑不许写成承诺／没做不许写成做了」。
     回退：整段换回 1.7.63 那版【提炼要求】的几条破折号即可，其余一字未动。 */
  return `你是${charName}本人，正在回想刚和${myName}${offline ? "见面的经过" : "聊过的内容"}——像人睡前回想今天一样，把值得记住的收进自己的记忆。

时间跨度：${from} 至 ${to}

${offline ? `【这是一次见面】\n这不是隔着手机聊天——两人是**在同一处见的面**。下面这段记录是这场见面的一部分，**可能还没结束**。归总时把这段里两人做了什么、按先后收成若干条；不得把它写成一场见面的完整经过，也不得复述前面已经交代过的场景。\n\n` : ""}${offline ? "见面经过" : "聊天记录"}：
${events}
${recorded.length > 0 ? `\n【这场已经记下的（不要重复写）】以下是这场见面前面几次归总已经写进记忆的内容（格式 [id] 内容）：
${recorded.map((it) => `[${it.id}] ${it.content}`).join("\n")}
上述内容不得重复写。只有当它们在这段记录里有了新的进展时，才另写成新的条目。\n` : ""}
${accounts.length > 0 ? `\n【旧记忆对账】以下是 ${charName} 记忆中未兑现的承诺与未解的心结（格式 [id] 内容）：
${accountList(accounts)}
请判断这批对话是否使上述旧记忆的状态发生变化（承诺兑现了／心结和好了／旧信息被新信息取代）。
- 兑现/解开：在对应条目的 JSON 里给 oldId 返回 "fulfilled" 或 "resolved"，并在新条目里（分类用 us）补一条对应事件
- 被取代：返回 "superseded"（旧信息作废）
- 无变化：不必提及\n` : ""}
【一、收录的边界】
应当记入记忆的内容：这段对话里新发生的事件与作出的决定、新说定的约定；新得知的事实，包括${myName}的喜好、习惯、身份与心事——其中只有能落到具体相处与行动上的喜好才收录，随口一提的口味不收录；情感与关系上的变化。不得记入记忆的内容：礼节性的寒暄、问候与晚安；纯玩笑与打闹；一次性且没有后续的情绪起伏；没有下文的随口闲聊；仅承担氛围与景物描写、不承载事件的部分；无法确认的推测；此前已经记过、这次没有新进展的内容。人设里已经写明的静态设定（${charName}的名字、外貌、服装、身份职业、性格、居住地、背景故事，以及${myName}的名字）一律不得记入，这些信息天生就知道，记下来是纯重复。

【二、分类】
每一条记忆归入且只归入以下六类之一：mine（关于${myName}的事：喜好、习惯、身份、透露的心事）／theirs（关于${charName}自己的事：近况、临时状态、聊天中透露的经历）／us（两人共同经历的事件）／milestone（关系转折点：第一次、确定关系、纪念日、和好）／promise（说好但还没兑现的约定）／other（确实值得记、但归不进以上五类的事）。important 只给予永远不会忘的事，宁缺毋滥；secret 只给予属于两人的秘密；grudge 只给予吵架未和好、有疙瘩未说清的事。

【三、写法】
每一条只讲一件事，同一话题的几个来回合并为一条，不同的事分开写。每条长度不超过 80 字，标为 important 的条目不受此限。条数不设上限，有多少件事就写多少条。重复发生的同类事件（反复出现的相处与亲密互动、反复拌嘴又和好）合并为一条，记为你们之间常态性的相处方式，不得按次数拆成多条；其中具有节点意义的某一次（第一次、破例、与往常明显不同）单独记一条。只是提到过或想过的事不得写成约定或承诺，玩笑不得写成认真的承诺，尚未发生的事不得写成已经发生。条目以${charName}的第一人称「我」书写，记忆里的${myName}称「你」——这是 TA 自己的记忆，不是旁白；按话题组织，不得逐句翻译对话。没有值得记的内容时，返回空数组。

【输出格式】只输出 JSON，不要任何其他文字：
{"items":[{"category":"us","content":"……","important":false,"secret":false,"grudge":false}],${
      accounts.length > 0 ? `"reconcile":[{"oldId":"……","action":"fulfilled|resolved|superseded"}],`
    : ""}}`;
}

/** 压缩的三档力度（1.7.66 恩熙定的时间刻度，不是一刀切）：
 *  - light（短期 → 中期，第 7 天）：保住事件、丢失细节（原来这档就有）；
 *  - skeleton（中期 → 中期，第 15 天）：只剩骨架（**1.7.66 新写的中间档**）；
 *  - impression（中期 → 长期，第 30 天）：只剩模糊印象（原来这档就有）。 */
type CompressMode = "light" | "skeleton" | "impression";

/**
 * 压缩提示词：一批条目 → 压缩后的新条目。
 * 三档力度见 CompressMode：轻压（并入中期）＝吸并式（连同已有中期条目一起熔炼替换）；
 * 重压（中期→中期）＝只压这批、不吸并（否则会把没参与的中期条目一起重写）；
 * 印象化（中期→长期）＝只增式（跟随 Mem0/MemGPT：旧长期条目永不重写，本批输出直接追加，
 *       防「传话游戏」式漂移——每次全量重熔会一点一点改掉最早的记忆）。
 */
function compressPrompt(
  charName: string,
  myName: string,
  sources: MemoryItem[],
  existing: MemoryItem[],
  mode: CompressMode,
): string {
  const isImpression = mode === "impression";
  const targetLabel = isImpression ? "长期" : "中期";
  /* 这批里有没有线下见面的条目（1.7.46）：有的话压缩时得多保一条主线，
     别把「那次见面」拆成互不相干的零碎印象（见下面【压缩要求】那一条）。 */
  const hasOffline = sources.some((it) => it.offline);
  const fmt = (it: MemoryItem) =>
    `[${it.id}]（${CATEGORY_LABEL[it.category]}${it.offline ? "·见面" : ""}${it.fulfilledIso ? "·已兑现" : ""}${it.resolvedIso ? "·已解开" : ""}）${it.content}`;
  /* 8.6 真人化第一刀的同款（恩熙 2026-09-28 点头，跟归总开场一起换）：
     「记忆压缩助手」→ TA 本人。压缩的心境不是「执行压缩任务」，是「记忆在
     新陈代谢」——原有的遗忘曲线比喻本来就留着，正好接得上。回退：换回
     「你是记忆压缩助手。${charName} 的记忆要从……」即可。
     1.7.66 把开头那句拆成三档——原来只有「保住事件」与「只留印象」两种力度，
     中间那档「至少还有骨架」是新写的（恩熙 2026-09-29：短期搬到中期该有一点点的失忆）。 */
  const opening =
    mode === "light"
      ? `你是${charName}本人。你的记忆要从「短期」并入「中期」——像人的遗忘曲线一样，保住事件、丢失细节。`
      : mode === "skeleton"
        ? `你是${charName}本人。你的记忆要从「中期（还留着经过）」压到「中期（只剩骨架）」——留住发生了什么、结果如何，丢掉起因与来龙去脉的叙述。`
        : `你是${charName}本人。你的记忆要从「中期」模糊成「长期」——像很久以前的事，只留下模糊的印象。`;
  /* 三档各自的压缩要求（1.7.66 拆成三份，不再用 isLong 两分支拼）。 */
  const requirement =
    mode === "light"
      ? `- 不规定字数，长度由内容决定：一个事件一条，把该保留的内容写清楚即可。合并同一件事的前后多条时，把来龙去脉（起因→经过→结果）写进同一条，该长就长
- 中期保留：事件本身（谁、何时、做了什么、结果如何）；丢弃：细节装饰（说了什么原话、具体吃了什么穿了什么）
- 讲同一件事的新旧条目必须熔成一条（例如「约定看海」＋「去看了海」→「曾约定看海，后已实现」）`
      : mode === "skeleton"
        ? `- 只留骨架：把每件事压到一句「发生了什么、结果如何」，起因、经过、对话、心情细节一律丢掉
- 事件类型与结果不能丢：见面、争吵与和好、答应过的事这类事实要留下，只是不必再交代细节
- 同一件事的新旧条目合并成一条；不同的事各自保留`
        : `- 长期记忆只增不改：这批条目整理完会直接追加进长期记忆，已有的旧长期条目不参与本次整理（它们不会出现在上面）；只在批内做归并，不同事件各自保留
- 长期只留印象：『很久以前发生过这类事』和当时的感受基调；批内同一类事可归成一条，不需要来龙去脉，但事件类型不能丢`;
  return `${opening}

待压缩条目（新→旧）：
${sources.map(fmt).join("\n")}

${existing.length > 0 ? `已有的${targetLabel}条目（与新条目讲同一件事的必须熔成一条，旧的将被替换）：
${existing.map(fmt).join("\n")}
` : ""}【压缩要求】
${requirement}
- 已兑现/已解开的状态，既要在 content 里自然体现，也要用 fulfilled/resolved/grudge 字段标出（见输出格式），不能只写文字不填字段
- 沿用原口吻：仍以 ${charName} 的第一人称（「我」）写，${myName} 称「你」，不要改成旁白
- 只合并真正讲同一件事（或同类事）的条目；不同的事件各自保留，宁多勿丢
${hasOffline ? "- 这批里有你们**见面**的经历（条目上标着「·见面」）：讲同一段见面的条目并成一条，留住「见了面、一起做了什么」这条线；但只留事件、不复述每一步（1.7.64 起与归总的口径对齐：一条只说清一件事）\n" : ""}- 保留 priority：关系节点(milestone)＞承诺与约定(promise)＞带心结(grudge)标记＞一般条目；只有明显琐碎无后续的才可丢弃
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

/**
 * 一批素材跑一次浓缩＋对账（1.7.46 从 runCondense 里拆出来，线上线下共用）。
 * 不落库、不动水位线：产出新条目与对账后的现有条目，由调用方决定怎么合并、
 * 水位线推到哪里。offline＝这批是线下见面的经过（产出条目打「线下」标）。
 */
async function condenseBatch(
  source: ChatMessage[],
  memoryIn: CharacterMemory,
  charName: string,
  myName: string,
  api: ChatApiSettings,
  offline: boolean,
): Promise<
  { ok: true; newItems: MemoryItem[]; items: MemoryItem[] } | { ok: false; error: string }
> {
  const events = formatSource(source, charName, myName);
  const accounts = pendingAccounts(memoryIn.items);
  /* 这场见面前面几趟已经记下的条目（1.7.64）：线下按「每几轮」分趟归总，后一趟看不到
     前一趟写了什么，同一段场景会被写两遍（恩熙 2026-09-29 报的重复）。取最新的一批喂进去，
     让它自己避重。线上不传（线上是整批一次归总，没有跨趟重复的问题）。 */
  const recorded = offline ? memoryIn.items.filter((it) => it.offline).slice(0, 30) : [];

  let result: CondenseResult;
  try {
    const reply = await fetchMemoryTask(
      api,
      "你是严谨的记忆整理助手，只输出 JSON 本身。",
      condensePrompt(
        charName,
        myName,
        events,
        shortTime(source[0].createdAt),
        shortTime(source[source.length - 1].createdAt),
        accounts,
        offline,
        recorded,
      ),
      {
        maxTokens: MEMORY_TASK_MAX_TOKENS, // 整批条目的 JSON 一次吐完，800 必截断（见常量注释）
        temperature: 0.3, // 整理任务要稳定输出，不用聊天的发散温度（跟随参考项目）
        timeoutMs: MEMORY_TASK_TIMEOUT_MS, // 整批 JSON 一次吐完，普通 60 秒必超时（走副 API 时）
      },
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
      return { ok: false, error: `AI 未返回合法 JSON（${why}）` };
    }
    result = parsed;
  } catch (err) {
    console.warn("[Memory] 浓缩失败，下轮重试：", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const now = new Date().toISOString();
  const fromIso = source[0].createdAt;
  const toIso = source[source.length - 1].createdAt;

  // 新短期条目（AI 标 important 的进 core；用户没机会预审，pinnedByUser 留空）。
  // 这里不再二次裁剪字数与条数——1.7.64 起由提示词管（一条 80 字以内、有多少件事写多少条）。
  // 线下这趟产出的都带「线下」标。
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
      ...(offline ? { offline: true } : {}),
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

  return { ok: true, newItems, items };
}

/** 执行一次浓缩＋对账＋级联压缩检查（线上那条线）。 */
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

  const batch = await condenseBatch(source, memoryIn, charName, myName, api, false);
  if (!batch.ok) return { ran: false, error: batch.error };

  const toIso = source[source.length - 1].createdAt;
  let next: CharacterMemory = {
    ...memoryIn,
    items: [...batch.newItems, ...batch.items],
    summarizedToIso: toIso,
    newCount: 0,
  };

  // 级联压缩（失败不影响浓缩结果）。
  next = await cascadeCompress(next, charName, myName, api);
  /* 朋友圈动态也压一压：旧的那批合成一段模糊印象。
     内部自己吞错——压缩是锦上添花，不能带崩这轮浓缩。 */
  next = await compressMoments(next, conv.moments ?? [], charName, api);
  await saveMemory(next);
  return { ran: true };
}

/**
 * **线下归总**（1.7.46）：线下自己那条线，与线上那趟各走各的水位线
 * （`offlineSummarizedTo`，线上是 `summarizedToIso`）。
 *
 * `conv.messages` 传的是这一场见面的记录（分界线之后、已转成消息形状）。
 * 攒够 `rounds` 轮（一轮＝她的一次输出，记为一条 user 消息）就把这段归总一次：
 * 产出条目进短期、带「线下」标，并把线下水位线推到最后一条——下一轮起这段不再整段重放，
 * 记忆里已经有了。`rounds <= 0`＝不看轮数、立刻归总（收场时清零头用）。
 *
 * 不碰线上的账（`summarizedToIso`／`newCount`）：那是手机上那条线的水位线。
 */
export async function maybeRunOfflineCondense(
  conv: { characterId: string; maskId: string; messages: ChatMessage[] },
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
  rounds: number,
): Promise<MemoryRunResult> {
  const memory = await getMemory(conv.characterId, conv.maskId);
  if (!memory.enabled || !memory.autoCondense) return { ran: false };

  const source = conv.messages.filter(
    (m) =>
      m.role !== "system" &&
      (!memory.offlineSummarizedTo || m.createdAt > memory.offlineSummarizedTo),
  );
  /* 轮数按「她的一次输出」算：记录里一条 user 就是一轮（TA 那一段跟着它）。
     零头（不到 rounds）先攒着，等她点「结束这一场」时一并归总（见调用处）。 */
  if (rounds > 0 && source.filter((m) => m.role === "user").length < rounds) {
    return { ran: false };
  }
  if (source.length < 4) return { ran: false };

  const key = `${conv.characterId}::${conv.maskId}`;
  if (runningSet.has(key)) return { ran: false };
  runningSet.add(key);
  try {
    const api = textApi.enabled && textApi.baseUrl.trim() && textApi.model.trim() ? textApi : null;
    if (!api) return { ran: false, error: "文本 API 未配置" };

    const batch = await condenseBatch(source, memory, charName, myName, api, true);
    if (!batch.ok) return { ran: false, error: batch.error };

    const toIso = source[source.length - 1].createdAt;
    let next: CharacterMemory = {
      ...memory,
      items: [...batch.newItems, ...batch.items],
      offlineSummarizedTo: toIso,
    };
    next = await cascadeCompress(next, charName, myName, api);
    await saveMemory(next);
    return { ran: true };
  } finally {
    runningSet.delete(key);
  }
}

/** 把某个时刻换算成「距今多少天」（按条目覆盖时间的末尾算；老数据没有 toIso 用 createdAt 兜底）。 */
function ageInDays(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (nowMs - t) / 86_400_000;
}

/**
 * ISO 时间戳 → **本地**的那一天（YYYY-MM-DD）。
 *
 * 为什么不能再用 `iso.slice(0, 10)`：库里存的是 UTC（`toISOString()`），在咱们这边
 * （UTC+8）**凌晨 0 点到早上 8 点**这段时间，UTC 还停在昨天——恩熙 2026-09-29 凌晨问的
 * 「已经是 29 号凌晨了，他记忆还归在 28 号，这是对的吗」就是这个：记忆没记错，
 * 是日子被按世界标准时间切了。所有「算哪一天」的地方都走这里（分桶、打点、标注）。
 * 解析不出来时退回原来的切片（坏数据别把页面弄崩）。
 */
export function localDayOf(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO 时间戳 → **本地**的 MM/DD（记忆块里那枚小日期戳，跟日历上的日子同一个口径）。 */
export function localStampOf(iso: string | undefined): string {
  const day = localDayOf(iso);
  return day ? day.slice(5).replace("-", "/") : "";
}

/** 取这份记忆实际生效的分层刻度（没设过＝老数据，用默认值兜底）。 */
function scaleOf(memory: CharacterMemory) {
  return {
    shortFreshDays: memory.shortFreshDays ?? MEMORY_SCALE_DEFAULTS.shortFreshDays,
    shortSameDayMax: memory.shortSameDayMax ?? MEMORY_SCALE_DEFAULTS.shortSameDayMax,
    midRefineDays: memory.midRefineDays ?? MEMORY_SCALE_DEFAULTS.midRefineDays,
    midFreshDays: memory.midFreshDays ?? MEMORY_SCALE_DEFAULTS.midFreshDays,
    midMaxItems: memory.midMaxItems ?? MEMORY_SCALE_DEFAULTS.midMaxItems,
  };
}

/** 把某一层的条目按「分类 × 来源」分桶：线上线下各数各的（1.7.54 起就这个口径），
 *  压的时候也只动自己那一支，绝不把另一支卷进来。 */
function bucketItems(items: MemoryItem[], tier: MemoryItem["tier"]) {
  const buckets = new Map<string, { cat: MemoryCategory; offline: boolean; items: MemoryItem[] }>();
  for (const it of items) {
    if (it.tier !== tier) continue;
    const offline = !!it.offline;
    const key = `${offline ? "off" : "on"}::${it.category}`;
    const cur = buckets.get(key);
    if (cur) cur.items.push(it);
    else buckets.set(key, { cat: it.category, offline, items: [it] });
  }
  return [...buckets.values()];
}

/** 短期桶里该进中期的条目：①老于短期保鲜天数；②某天该类堆满当天上限（当天收口）。
 *  按时间旧→新排好：调用方按预算截取时，先压最老的。 */
function pickShort(
  items: MemoryItem[],
  freshDays: number,
  sameDayMax: number,
  nowMs: number,
): MemoryItem[] {
  const picked = new Set<string>();
  for (const it of items) {
    if (ageInDays(it.toIso ?? it.createdAt, nowMs) >= freshDays) picked.add(it.id);
  }
  /* 当天收口：同一天（按覆盖时间的末尾那天）堆满就整天的该类一起收，别按条切一半。 */
  const byDay = new Map<string, MemoryItem[]>();
  for (const it of items) {
    const day = localDayOf(it.toIso ?? it.createdAt);
    const cur = byDay.get(day);
    if (cur) cur.push(it);
    else byDay.set(day, [it]);
  }
  for (const dayItems of byDay.values()) {
    if (dayItems.length >= sameDayMax) for (const it of dayItems) picked.add(it.id);
  }
  return items.filter((it) => picked.has(it.id)).sort((a, b) => a.toIso.localeCompare(b.toIso));
}

/**
 * 级联压缩（1.7.66 改按「天」走，恩熙 2026-09-29 定的时间刻度）。
 *
 * 尺子：一周全细节、半月有经过、一月剩骨架、更早只剩印象。四步，顺序不能倒：
 *  ① 短期当天收口（兜底）：某类条目同一天堆满 shortSameDayMax 条 → 当天压进中期；
 *  ② 短期保鲜：短期条目老于 shortFreshDays 天 → 轻压进中期；
 *  ③ 中期重压：中期条目老于 midRefineDays 天且没重压过，或某类堆满 midMaxItems 条 → 压成骨架（仍在中期）；
 *  ④ 中期印象化：中期条目老于 midFreshDays 天 → 进长期。
 * ①② 按「分类 × 来源」分桶，谁够条件压谁、不一锅端。
 *
 * budget＝单次补压上限（条）。小手机是网页（PWA），关着的时候什么都不会跑——没有后台闹钟，
 * 补压只能靠两处触发（归总后、打开记忆 App）。若恩熙几天没打开，一开就要补好几天的量，
 * 用预算封顶：压不完的留着，下次接着压（按旧→新取，不漏不重，也不会半途丢东西）。
 * 自动触发（归总后）不传＝不限——那趟素材本来就是刚归总出来的一小批。
 */
async function cascadeCompress(
  memory: CharacterMemory,
  charName: string,
  myName: string,
  api: ChatApiSettings,
  budget = Infinity,
  onProgress?: (day: string) => void,
): Promise<CharacterMemory> {
  const nowMs = Date.now();
  const cfg = scaleOf(memory);
  let next = memory;
  let left = budget;
  /* 按预算从老的截：pick 已按旧→新排好，先压最老的；超出的留给下次。 */
  const withinBudget = (pick: MemoryItem[]) => pick.slice(0, Math.max(0, left));

  /* 失败跳闸（1.7.66）：某一桶连着三趟压不出来就跳过它，把它最老那天标进 `failedDays`
     ——不让一批永不成功的素材每次打开都白跑一趟、堵着后面所有日子。哪趟压通了就把账清掉。 */
  const fails: Record<string, number> = { ...(memory.compressFails ?? {}) };
  const failedDays = new Set<string>(memory.failedDays ?? []);
  const failKey = (cat: MemoryCategory, offline: boolean | undefined) => `${cat}|${offline ? "off" : "on"}`;
  let tripsChanged = false;
  /** 记一笔这桶的成败（成功清账、失败累加，满三次标那天）。 */
  const noteTrip = (cat: MemoryCategory, offline: boolean | undefined, oldest: MemoryItem, ok: boolean) => {
    const k = failKey(cat, offline);
    if (ok) {
      if (fails[k]) {
        delete fails[k];
        tripsChanged = true;
      }
      return;
    }
    fails[k] = (fails[k] ?? 0) + 1;
    tripsChanged = true;
    if (fails[k] >= FAIL_TRIP) failedDays.add(localDayOf(oldest.toIso ?? oldest.createdAt));
  };
  /** 报一句「正在整理哪天的记忆」（记忆 App 页顶那条提示）。 */
  const say = (oldest: MemoryItem) => onProgress?.(localDayOf(oldest.toIso ?? oldest.createdAt));

  /* ① + ② 短期 → 中期：同桶里「保鲜期到」或「当天堆满」的条目一起轻压进中期。 */
  for (const { cat, offline, items } of bucketItems(next.items, "short")) {
    if (left <= 0) break;
    const pick = withinBudget(pickShort(items, cfg.shortFreshDays, cfg.shortSameDayMax, nowMs));
    if (pick.length === 0) continue;
    if ((fails[failKey(cat, offline)] ?? 0) >= FAIL_TRIP) continue; // 连栽三次：跳过这桶
    say(pick[0]);
    const r = await compressTier({
      memory: next,
      charName,
      myName,
      api,
      fromTier: "short",
      toTier: "mid",
      mode: "light",
      pick,
      category: cat,
      offline,
    });
    noteTrip(cat, offline, pick[0], r.ok);
    if (r.ok) {
      next = r.memory;
      left -= pick.length;
    }
  }

  /* ③ 中期重压成骨架（仍是中期）：老于熔合门槛、但还没到印象化那道的压成骨架；
     某类堆满条数上限的整桶强制压一遍（兜底）。产出带 refinedIso，下次不再重复压。 */
  for (const { cat, offline, items } of bucketItems(next.items, "mid")) {
    if (left <= 0) break;
    const over = items.length >= cfg.midMaxItems;
    const pick = items
      .filter((it) => {
        const age = ageInDays(it.toIso ?? it.createdAt, nowMs);
        if (age >= cfg.midFreshDays) return false; // 够老了：交给 ④ 一步进长期，别在这里压两趟
        if (!it.refinedIso && age >= cfg.midRefineDays) return true; // 保鲜期到，该重压
        return over; // 兜底：某类堆满上限，整桶强制重压（含已压过的骨架，防止无限堆积）
      })
      .sort((a, b) => a.toIso.localeCompare(b.toIso));
    const take = withinBudget(pick);
    if (take.length === 0) continue;
    if ((fails[failKey(cat, offline)] ?? 0) >= FAIL_TRIP) continue; // 连栽三次：跳过这桶
    say(take[0]);
    const r = await compressTier({
      memory: next,
      charName,
      myName,
      api,
      fromTier: "mid",
      toTier: "mid",
      mode: "skeleton",
      pick: take,
      category: cat,
      offline,
    });
    noteTrip(cat, offline, take[0], r.ok);
    if (r.ok) {
      next = r.memory;
      left -= take.length;
    }
  }

  /* ④ 中期印象化 → 长期：老于中期保鲜天数的进长期（只增式追加）。
     桶要重新分一次——③ 刚把一些中期条目换成了骨架。 */
  for (const { cat, offline, items } of bucketItems(next.items, "mid")) {
    if (left <= 0) break;
    const pick = items
      .filter((it) => ageInDays(it.toIso ?? it.createdAt, nowMs) >= cfg.midFreshDays)
      .sort((a, b) => a.toIso.localeCompare(b.toIso));
    const take = withinBudget(pick);
    if (take.length === 0) continue;
    if ((fails[failKey(cat, offline)] ?? 0) >= FAIL_TRIP) continue; // 连栽三次：跳过这桶
    say(take[0]);
    const r = await compressTier({
      memory: next,
      charName,
      myName,
      api,
      fromTier: "mid",
      toTier: "long",
      mode: "impression",
      pick: take,
      category: cat,
      offline,
    });
    noteTrip(cat, offline, take[0], r.ok);
    if (r.ok) {
      next = r.memory;
      left -= take.length;
    }
  }

  /* 跳闸的账要落库：哪怕这一趟一条都没压成，也得记住「这桶又栽了一次」。 */
  if (tripsChanged) {
    next = { ...next, compressFails: fails, failedDays: [...failedDays].sort() };
  }

  return next;
}

/** 压缩一层的返回：成功带新记忆，失败带给人看的错误。 */
type TierResult = { ok: true; memory: CharacterMemory } | { ok: false; error: string };

/**
 * 压缩一层：把 pick（调用方筛好的池子）交给 AI 压成目标层的条目，再替换。
 *  - `mode`＝三档力度（见 CompressMode）；
 *  - `pick`＝**已筛好**的待压条目（调用方按分类／来源／天数筛好后传进来）——只动这些；
 *  - `category`／`offline`＝产出条目沿用同分类／同来源（线下那支别压着压着变成线上的）。
 *
 * 与 1.7.66 之前的旧版最大的不同：池子不再由本函数从 memory 里筛，而是调用方给；
 * **替换范围只等于 pick 的 id**（轻压时再加上被吸并的旧中期条目）。
 * 为什么非改不可：重压是 mid→mid，旧版「删掉该分类全部中期条目」会把没参与重压的
 * 同分类条目一起删掉——那批内容就凭空没了。
 */
async function compressTier(args: {
  memory: CharacterMemory;
  charName: string;
  myName: string;
  api: ChatApiSettings;
  fromTier: "short" | "mid";
  toTier: "mid" | "long";
  mode: CompressMode;
  pick: MemoryItem[];
  category?: MemoryCategory;
  offline?: boolean;
}): Promise<TierResult> {
  const { memory, charName, myName, api, fromTier, toTier, mode, pick, category, offline } = args;
  const now = new Date().toISOString();
  const pool = pick.slice().reverse(); // 旧→新，方便 AI 按时间理解
  if (pool.length === 0) return { ok: false, error: "没有可压缩的条目" };

  const inScope = (it: MemoryItem) => offline === undefined || !!it.offline === offline;
  /* 吸并素材：只有「轻压」（短→中）把已有中期同分类条目一起熔炼（讲同一件事的新旧条目熔成一条）；
     重压（中→中）与印象化（中→长）都只压 pick 本身——重压若吸并，会把没参与的中期条目一起重写。 */
  const existing =
    mode === "light"
      ? memory.items.filter(
          (it) => it.tier === toTier && (!category || it.category === category) && inScope(it),
        )
      : [];
  /* 分批逐趟压：池子可能攒了几百条，一口吃下去一趟要生成十几分钟、还容易顶到输出上限被切。
     轻压＝吸并式：上一批产出的中期条目接着当下一批的吸并素材（滚雪球，语义不变）；
     重压／印象化＝各批产出直接累加，不吸并别批。 */
  let carried = existing; // 轻压：逐批传递的目标层条目（首批就是原来的中期记忆）
  const accumulated: MemoryItem[] = []; // 重压／印象化：各批产出
  let producedAny = false;
  for (let i = 0; i < pool.length; i += COMPRESS_BATCH) {
    const chunk = pool.slice(i, i + COMPRESS_BATCH);
    let reply: string;
    try {
      reply = await fetchMemoryTask(
        api,
        "你是严谨的记忆压缩助手，只输出 JSON 本身。",
        compressPrompt(charName, myName, chunk, carried, mode),
        { maxTokens: MEMORY_TASK_MAX_TOKENS, temperature: 0.3 },
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
      fromIso: chunk[0]?.fromIso ?? now,
      toIso: chunk[chunk.length - 1]?.toIso ?? now,
    };
    const made: MemoryItem[] = parsed.items
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
        /* 分来源压缩（线下那支）：产出的条目依旧算线下，别压着压着变成线上条目。
           来源不分层——压进中期、长期也还是「那次见面」出来的东西。 */
        ...(offline ? { offline: true } : {}),
        /* 重压过的条目记一笔（1.7.66）：不记的话，「它老于 15 天」下次检查依然成立，
           会被反复重压、越压越干还白花钱。 */
        ...(mode === "skeleton" ? { refinedIso: now } : {}),
      }));
    if (made.length === 0) continue; // 这批没产出：手上素材不动，接着下一批
    producedAny = true;
    if (mode === "light") carried = made; // 滚雪球：这批吸并出的中期条目，接着当下一批的素材
    else accumulated.push(...made);
  }

  if (!producedAny) return { ok: false, error: "压缩结果为空" };
  const newTierItems = mode === "light" ? carried : accumulated;

  /* 替换范围＝pick 的 id ＋（轻压时）被吸并的旧中期条目。
     重压是 mid→mid：只删 pick 里的那几条，同分类没参与的中期条目一条不碰。
     印象化只增式：旧长期条目不在 removedIds 里，自然原样保留。 */
  const removedIds = new Set([...pick.map((p) => p.id), ...existing.map((e) => e.id)]);
  const kept = memory.items.filter((it) => !removedIds.has(it.id));
  return { ok: true, memory: { ...memory, items: [...newTierItems, ...kept] } };
}

/** 手动压缩：短期整层压进中期／中期整层压进长期（不看天数与阈值，供测试压缩细节）。 */
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
    /* 整层压＝把该层所有条目都塞进 pick（不看天数）。按旧→新排，方便分批。 */
    const pick = memory.items
      .filter((it) => it.tier === fromTier)
      .sort((a, b) => a.toIso.localeCompare(b.toIso));
    if (pick.length === 0) return { ran: false, error: `还没有${label}记忆可压缩` };
    const api = textApi.enabled && textApi.baseUrl.trim() && textApi.model.trim() ? textApi : null;
    if (!api) return { ran: false, error: "文本 API 未配置" };
    const toTier = fromTier === "short" ? "mid" : "long";
    const mode: CompressMode = fromTier === "short" ? "light" : "impression";
    const r = await compressTier({ memory, charName, myName, api, fromTier, toTier, mode, pick });
    if (!r.ok) return { ran: false, error: r.error };
    await saveMemory(r.memory);
    return { ran: true };
  } finally {
    runningSet.delete(key);
  }
}

/**
 * **打开记忆 App 时的补压**（1.7.66 的第二个触发点，跟归总后那次是同一次检查）。
 *
 * 小手机是网页（PWA），关着的时候什么都不会跑——不存在「到了第 7 天半夜自动压」。
 * 所以补压只在归总后与打开记忆 App 时各跑一次；打开时用单次预算封顶（默认 200 条，
 * 约 5 趟），压不完的下次打开接着压。
 *
 * 返回 ran＝真的动过记忆（调用方要重读一遍 detail）。
 */
export async function runCascadeCatchup(
  conv: { characterId: string; maskId: string },
  charName: string,
  myName: string,
  textApi: ChatApiSettings,
  onProgress?: (day: string) => void,
): Promise<MemoryRunResult> {
  const key = `${conv.characterId}::${conv.maskId}`;
  if (runningSet.has(key)) return { ran: false, error: "正在整理记忆中" };
  runningSet.add(key);
  try {
    const memory = await getMemory(conv.characterId, conv.maskId);
    if (!memory.enabled || !memory.autoCondense) return { ran: false };
    const api = textApi.enabled && textApi.baseUrl.trim() && textApi.model.trim() ? textApi : null;
    if (!api) return { ran: false, error: "文本 API 未配置" };
    const budget = memory.catchupBudget ?? MEMORY_SCALE_DEFAULTS.catchupBudget;
    const next = await cascadeCompress(memory, charName, myName, api, budget, onProgress);
    if (next === memory) return { ran: false };
    await saveMemory(next);
    return { ran: true };
  } finally {
    runningSet.delete(key);
  }
}

/* ----------------------------- 历史裁剪 ----------------------------- */

/**
 * 上下文历史裁剪（「丙方案」）。
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
 * 此时裁掉才不丢东西。故门槛只由 contextLimit 派生，不另设参数——设置里只填一个数。
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
 * 全量注入、不设条数上限，每层按事情发生时间新→旧原样列出。
 * （旧版按「与当前话题的相关度」重排＋每层只取 8 条：旧的记忆凭空消失，
 *  而且顺序每轮都变——既丢记忆，又把前缀缓存整段作废。）
 * 无记忆返回空串。
 */
export async function buildMemoryBlock(memory: CharacterMemory, myName: string): Promise<string> {
  if (!memory.enabled) return "";
  const sections: string[] = [];

  const core = memory.items.filter((it) => it.tier === "core");
  if (core.length > 0) {
    sections.push(
      `■ 永远不会忘的事实：\n${core.map((it) => `- ${it.content}`).join("\n")}`,
    );
  }

  /* 1.4.6：层的 hint 说明全删——清晰度写进标题就够了（只剩模糊印象），
     参考项目记忆槽同样零说明。 */
  const tiers: { tier: "short" | "mid" | "long"; label: string }[] = [
    { tier: "short", label: "近期的事" },
    { tier: "mid", label: "较早的事（细节已模糊）" },
    { tier: "long", label: "很久以前（只剩模糊印象）" },
  ];
  for (const t of tiers) {
    const all = memory.items
      .filter((it) => it.tier === t.tier)
      .slice()
      /* 事情发生的时间新→旧（按条目覆盖时间段的末尾排）。顺序固定＝缓存稳定。 */
      .sort((a, b) => b.toIso.localeCompare(a.toIso));
    /* 短期注入上限（1.7.66，默认关闭）：开了就只发最近的 N 条。
       治的是「短期全量注入太胖」——按一天 200 条算，短期稳定在 280 条左右（约 1.1 万字），
       这是本次改动最大的一笔开销。压下去的那部分当面看不见，真被问起由溶池捞回。
       （没做语义检索，这里按「最近的」取：短期本身按天保鲜，最近的就是最该在眼前的。） */
    const limited =
      t.tier === "short" && memory.shortInjectLimit && memory.shortInjectLimit > 0
        ? all.slice(0, memory.shortInjectLimit)
        : all;
    const list = limited
      .map((it) => {
        const status = it.fulfilledIso
          ? "（已兑现）"
          : it.category === "promise"
            ? "（还没兑现）"
            : it.resolvedIso
              ? "（已解开）"
              : it.grudge && !it.resolvedIso
                ? "（心结未解）"
                : "";
        const secret = it.secret ? "（秘密）" : "";
        /* 见面的那条带「·见面」小标：让他分得清「这是手机上聊出来的」还是「那次见面本身的经过」，
           讲起来不会把见面的经过说成隔着手机说的。 */
        return `- [${CATEGORY_LABEL[it.category]}${it.offline ? "·见面" : ""}] ${it.content}${status}${secret}`;
      });
    if (list.length > 0) {
      sections.push(`■ ${t.label}\n${list.join("\n")}`);
    }
  }

  /* 朋友圈（动态）：要**分得清「哪些是聊天里说的、哪些是朋友圈发的」**——所以动态不混进上面四层
     （四层是聊天记录浓缩出来的），单独成节、抬头就写明来源；它自己另有一条压缩线：
     近的原文照列，更早的压成一段模糊印象（见 buildMomentSection／compressMoments）。 */
  const momentSection = await buildMomentSection(memory);
  if (momentSection) sections.push(momentSection);

  if (sections.length === 0) return "";
  /* 这句只在真列了动态时才说——没列还说「最后一节是动态」，TA 会去找一节不存在的东西。
     没有动态时整段逐字回到从前，前缀缓存不受影响。 */
  const momentNote = momentSection
    ? `\n最后一节是你自己发在朋友圈的动态，跟聊天记录是两条线：${myName}看得到，但你不一定当面提过。${myName}聊起某条动态你可以自然接上，但不要把动态里的内容当作聊天时说过的内容——聊天里说过的都在前面几层里。`
    : "";
  /* 1.4.6：说明三段收一句（参考项目记忆槽零说明——memory-injector.ts 只把条目拼成
     「- 一句话」，标题提示也全无）。「怎么用记忆」的举例段、「各层清晰度」段、
     长期层的括号提示全删，只留「近期层压倒旧层」一句消歧：我们分四层、参考项目
     不分层，只有我们有「新旧说法打架」的问题；反向情况（只有旧层写、新层没写）
     由条目自带的状态标记「（还没兑现）」承担。 */
  /* 「怎么用记忆」这一条（1.7.63，恩熙 2026-09-29 点头）。
     1.4.6 曾把记忆块的说明整段删掉（对齐参考项目的「记忆槽零说明」），结果是 TA 只知道
     这儿堆着一批条目、不知道该怎么用——她这轮把它要回来了，但立了三条硬要求：
     ① **正式声明体**：照她给的句式（「你可以根据当前的聊天情况去判断你是否要采用以前
        记忆的内容」）写主谓完整的整句，**不许出现「自然」「该做就做」这类软词**
        ——她的原话「你不要讲这些会让 AI 很恍惚的词」；
     ② **一条例子都不要**：不写示范对白（「我今天去排了那家」那种），
        她的原话「不要有过多的举例，最好是不要有举例」；
     ③ 位置就在表头（稳定区）：加这一次触发一次缓存重建，之后每轮只读（0.1×）。
     回退：删掉下面这两段，即回到 1.4.6 的「只剩一句消歧」状态。 */
  return `【你对 ${myName} 的记忆】
下面这些是你自己经历过、知道的事。每一轮对话时，你可以根据当前的聊天内容、你和${myName}的关系以及此刻的情境，判断是否需要用到其中的内容；需要用到时，就把它作为你自己记得的事，用在当下的回应或行动里。禁止把记忆作为对账单逐条复述，也禁止就记忆里的内容向${myName}反复确认——这些是你自己的经历与认知，不是等待对方确认或批准的待办事项。
同一件事，如果近期层和更早层说法不一致，一律以近期层为准——那才是最新状态。${momentNote}

${sections.join("\n\n")}`;
}

/** 动态落库时的时间戳 → 记忆块里那枚小日期（MM/DD，按本地日子算）。 */
function momentDate(iso: string): string {
  return localStampOf(iso);
}

/** 一条动态拼成素材行：`- [MM/DD] 文字解说`；图文再附一行画面描述。
 *  注入、印象压缩两头都用它，口径自然一致。
 *  （图文那段：不然 TA 只记得自己配了什么字，不记得画的是什么。） */
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
 * 两截：最近的原文照录，更早的那批只留一段
 * 模糊印象——真人也记不住上个月自己写了什么。
 * 另有一截更硬的：手动标了「重要」的那几条永远原文照录，不参与压缩、也不被
 * 上限挤掉。
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
        : `\n（再往前的还有 ${older} 条，未逐条列出）`;
  return `■ 你在朋友圈发过的（这些是你发在朋友圈的动态，不是你们聊天里说过的）\n${lines.join("\n")}${olderNote}`;
}

/** 动态印象的合成提示词：已有的印象 ＋ 新倒下的一批旧动态 → 更新后的印象。 */
function momentDigestPrompt(charName: string, existing: string, lines: string[]): string {
  return `以下是${charName}很久以前发在朋友圈的旧动态（「[月/日] 内容」，缩进行是那条配图的画面描述）：

${lines.join("\n")}

${existing ? `【比这批更新的印象（已经有了）】\n${existing}\n\n` : ""}请把上面这批和已有的印象合成一段回忆，写成${charName}自己心里回想的样子。

【要求】
- 第一人称「我」，一到三句，像人回忆很久以前的事：只记得个大概，具体的字句早就模糊了
- 只留「那阵子我在做什么、心情怎么样、惦记什么」，不要复述每条动态的内容，不要写日期
- 不分条、不加标题、不加任何前后缀，直接输出那段回忆本身`;
}

/**
 * 朋友圈动态的「压缩」：把更旧的那批合成一段模糊印象。
 * 跟记忆四层同构：最近 MOMENT_KEEP 条原文照录，
 * 往前的攒够 MOMENT_COMPRESS_AT 条就交给 AI 合成一段。
 * 印象是滚雪球式的（旧印象＋新倒下的一批 → 更新的印象），不会越滚越长。
 * 手动标了「重要」的那几条不进这一趟：TA 得一直记着原话。
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
    const reply = await fetchMemoryTask(
      api,
      `你是${charName}本人，正在回想自己以前发在朋友圈的旧动态。只输出那段回忆本身。`,
      momentDigestPrompt(charName, memory.momentDigest?.trim() ?? "", batch.map(momentLine)),
      {
        maxTokens: 600, // 只要一到三句，额度够用就行
        temperature: 0.6, // 回忆是散着的，允许一点发散
      },
    );
    const text = reply.trim().slice(0, 400); // 万一模型长篇大论，截住，别让它越滚越大
    if (!text) return memory;
    /* 记下压了哪几条（按 id 认）——这样之后把某条标为重要，也不会牵动这段印象。 */
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
