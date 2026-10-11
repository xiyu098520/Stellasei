/**
 * 星绥通讯 AI 后端调用（OpenAI 兼容 /chat/completions）。
 *
 * system prompt = 微信体输出格式（旧档案 chatApi 的风格指令，角色名／
 * 用户名全部动态传入）＋ promptBuilder 组装的世界书／人设／状态。
 * 对话历史不进 system，改走 OpenAI messages（保前缀缓存稳定）。
 */

import type {
  ChatApiSettings,
  ChatMessage,
  ImageApiExtras,
  InnerSnapshot,
  VoiceApiExtras,
} from "@/types/chat";
import { DEFAULT_VOICE_EXTRAS } from "@/types/chat";
import { redCoverNoteOf } from "@/apps/chat/redpacket";

/**
 * 文本 block（挂了缓存断点时 content 用数组形式）。
 * Claude 系要求 content 是 block 数组才能挂 cache_control；纯字符串没有 block 可挂，
 * 会静默不缓存——这就是本项目此前 0 命中的原因。
 */
interface ApiTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * 图片 block（OpenAI 兼容多模态写法）：url 直接收 data URL。
 * 只在「我发图的那一轮」用一次，见 buildApiMessages 的 userImage。
 */
interface ApiImageBlock {
  type: "image_url";
  image_url: { url: string };
}

/** content 里能放的 block。 */
type ApiBlock = ApiTextBlock | ApiImageBlock;

/** OpenAI 兼容消息。 */
interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string | ApiBlock[];
}

/* 缓存断点开关：给 system 的稳定段与最近几条历史挂 Claude 缓存标记。 ｜ 详细见 docs/施工日志.md
 *  1.9.87：恩熙要求「去掉現在的斷點」→ 曾置 false。请求体里不再出现任何 cache_control，
 *  system 退回「稳定段／易变段各自平铺」那条老路（见下面 !CACHE_CONTROL_ENABLED 分支），
 *  前缀缓存交给中转站自己按逐字比对去做。
 *  1.11.68：恩熙点头翻回 true——配「查看本轮请求」面板新加的「读取／新建／原价输入／输出」那一行，
 *  试一轮好拿数据对账。
 *  怎么判断要不要留着：看下一笔中转站日志的「缓存」列——若还有几十K，说明站子自己也缓存，
 *  成了；若「缓存」归零、↓ 冲到 3 万+，说明站子不吃这套，把这一行改回 false 即可（只动这一行）。
 *  （1.11.68 之前她的数据是「缓存↓ 4 万+」，按上面这条本该保持 false；这次是她主动要试。） */
const CACHE_CONTROL_ENABLED: boolean = true;

/** 历史里挂缓存断点的「用户消息」条数。
 *  为什么挑用户消息、不挑末尾那几条：微信体一轮里助手会拆成 3–5 条气泡，
 *  断点若打在末尾消息上，一轮就往后滚 4–5 格，四个额度当场被挤光——
 *  与上一轮的断点位置**一个都不重叠**，缓存反而每轮整份重写（更贵）。
 *  用户消息每轮恒定只多一条，最近 3 条断点＝覆盖最近 3 轮，永远有重叠。
 *  取 3 不取 4：万一网关自己也会在 system 上加一个断点，留一格给它，免得超限报 400。
 *
 *  ⚠️ **1.8.3 实测确认：上面这段话是对的，别再改。** 1.8.2 曾把这里改成 2、并把省下的
 *  额度挪给「本轮最新那条 user 消息」（想让缓存一路盖到链尾），结果是灾难：站子明细里
 *  冒出「缓存写入 (5m) 70,937」、读取从 54,575 崩到 7,224，单笔费用从 ¥1.91 涨到 ¥12.30。
 *  教训：这个网关只按**最后一根断点所在的那一格**去找缓存条目；那一格每轮都是新的，
 *  必然找不到，于是整份前缀当场重写。**末尾不能挂断点，这条不是理论、是账单。** */
const HISTORY_BREAKPOINTS = 3;

/** Claude 系前缀缓存的断点总额度（一个请求最多挂 4 个 cache_control）。
 *  1.11.69：system 现在最多用掉两根（stable／cache 各一），历史那几根据此自动收窄
 *  （见 buildApiMessages），保证总数恒 ≤ 4——宁可少几根历史断点，也不能超限报 400。 */
const MAX_CACHE_BREAKPOINTS = 4;

/**
 * system 的三段。
 * Claude 前缀缓存是**整条链的哈希**：从第一个字符逐块比到断点，断点之前只要
 * 有一个字符变，其后全部作废重写。所以跨轮不变的静态内容（stable）与每轮会变
 * 的内容（tail：拉黑状态等）必须拆开——
 * 断点只打 stable 的末尾，tail 排在断点之后、不挂标记。
 * （tail 挂了也是每轮白写一遍，还要多付 25% 的写入价。）
 *
 * 1.11.69 起多出中间段 cache（「偶尔才变」的那一截：签名／用户签名／零钱／朋友圈／
 * 世界书关键词）：它排在 stable 之后、自己再挂一根断点。这样它一变，作废的只是
 * 它自己与 tail（后面那截），stable 那一段照旧读缓存；它不变（多数轮）时，
 * 下一轮连同它一起读回来（0.1×），而不是像从前挂在链尾那样每轮 100% 全价重付。
 */
export interface SystemParts {
  /** 稳定段（跨轮逐字不变），缓存断点打在它的末尾。 */
  stable: string;
  /** 次稳定段（偶尔才变），也挂一根缓存断点，排在 stable 之后。
   *  省略／空串＝没有这一段（老调用方与纯字符串 system 不受影响）。 */
  cache?: string;
  /** 易变段，排在断点之后。 */
  tail: string;
}

/** 给一段文本挂上缓存断点（断点之后的内容不进缓存，只按普通输入计价）。 */
function cacheBlock(text: string): ApiTextBlock[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** 单次请求超时（毫秒）：真机网络抖动／服务商卡死时，防止「正在输入」永久锁死输入区。 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * 聊天默认采样温度（调用方与设定面板都没给时用它）。
 * 记忆整理一类任务会显式传 0.3 要稳定输出，那个值优先于这个默认。
 */
const DEFAULT_TEMPERATURE = 0.8;

/**
 * 聊天默认的两个惩罚值（设定面板与调用方都没给时用它）。1.6.2 起才有这一层默认。
 * 0.3 是温和档：压得住 TA 逐字复述自己上一轮的原句，又不至于让措辞变得别扭。
 * 只给**正常聊天**（system 传分段结构的那种）用；记忆浓缩一类内部任务传的是纯字符串
 * system、要吐严格 JSON，一律不带惩罚（见 buildChatRequest 里的 chatSampling）。
 * 想彻底不发：面板里把开关关掉，那会明确存 0。
 */
const DEFAULT_FREQUENCY_PENALTY = 0.3;
const DEFAULT_PRESENCE_PENALTY = 0.3;

/** 推理型模型不接受 temperature（deepseek-reasoner、o1/o3、thinking 类会 400 拒收）。 */
function isReasonerModel(model: string): boolean {
  return /reasoner|r1|o1|o3|thinking/i.test(model);
}

/** 流式请求的三段超时（毫秒）：首字节（含连接，有的模型思考久）／增量间隔（卡住不动）／总时长。 */
const STREAM_FIRST_TIMEOUT_MS = 90_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const STREAM_TOTAL_TIMEOUT_MS = 300_000;

/** 增量预览的回调节流：每个 token 都推一次 state 会掉帧，攒够 50ms 推一次。 */
const STREAM_EMIT_INTERVAL_MS = 50;

/**
 * 一条红包／转账在模型眼里长什么样（1.4.33）。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export function moneyNoteOf(
  role: "user" | "assistant",
  type: "redpacket" | "transfer",
  amount: number | undefined,
  content: string,
  redCover?: string,
  state?: string,
): string {
  const label = type === "redpacket" ? "红包" : "转账";
  const note = content.trim();
  const yuan = (amount ?? 0).toFixed(2);
  /* TA 说的钱：跟他该写出来的标记一字不差（金额口径也照提示词来：只写数字，不写「元」）。
     **状态那半句不缀在这一侧**（state 传了也不用）：这一句是他的钱在历史里的样子，
     是 few-shot 的示范写法——缀上「你还没表态」这种旁白，他照抄出来就不是标记了。 */
  if (role === "assistant") return `〔${label}〕${yuan}:${note}`;
  const cover = type === "redpacket" && redCover ? `，封面是${redCoverNoteOf(redCover)}` : "";
  const tail = state ? `，${state}` : "";
  return `（发来一个${label}：${yuan} 元${note ? `，留言「${note}」` : ""}${cover}${tail}）`;
}

/** 我发出去的那笔钱此刻是什么状态（说给 TA 听的那件事，见 moneyStateNoteOf）。 */
export type MoneyState = "pending" | "claimed" | "refunded" | "expired";

/** 从一条钱的消息上读出它此刻的状态。四个状态互斥，都没落就是还悬着。 */
export function moneyStateOf(m: ChatMessage): MoneyState {
  if (m.moneyClaimed === true) return "claimed";
  if (m.moneyRefunded === true) return "refunded";
  if (m.moneyExpired === true) return "expired";
  return "pending";
}

/**
 * 我发出去的那笔钱此刻什么状态——**说给 TA 听的那半句**（1.5.12），缀在 moneyNoteOf
 * 那句旁白后面。
 *
 * 为什么非写不可：钱落定这件事，TA 那侧原先**看不见**——「他已收下」那条是居中的
 * 系统提示，回喂历史时被整条滤掉（见 buildApiMessages 开头那句 filter），于是他
 * 会说出「我早收了」「我没收到」这种跟账对不上的话。写进旁白，他每一轮都看得见。
 * 还悬着的那笔更要说清「你还没表态、之后还能回头收」——不然他记不起手里压着一笔钱，
 * 也就想不起回头去收（恩熙要的正是他能回头收）。
 *
 * ⚠️ 这里**不能出现〔收下〕〔领取〕这类标记原文**：这句是 user 侧旁白，写成标记的样子
 * 会被他当成「对方写了这几个字」，反而添乱。要说就用人话说。
 */
export function moneyStateNoteOf(type: "redpacket" | "transfer", state: MoneyState): string {
  const rp = type === "redpacket";
  if (state === "claimed") return rp ? "你已经领了" : "你已经收下了";
  if (state === "refunded") return "你已经退还了";
  if (state === "expired") {
    return rp ? "这个红包已经过期，钱退回去了，你领不到了" : "这笔转账已经过期，钱退回去了，你收不到了";
  }
  return rp
    ? "你还没领；一直不领的话，过一阵它自动退回去"
    : "你还没表态收下还是退还；一直不表态的话，过一阵它自动退回去";
}

/**
 * 组装发出去的 messages 数组（含上下文条数、图片／语音回喂转标记）。
 * 抽出来是为了让「诊断里看到的」与「真发出去的」共用同一份逻辑、逐字一致——
 * 否则浮层里那段「历史」可能是假的，判不了案（用完删，见 ChatWindow 的诊断块）。
 * 上下文条数（记忆系统的「当前批」宽度）。图片／语音消息不丢弃，转回标记形式：
 * TA 侧转回〔图片〕〔语音〕——既让 TA 记得自己发过什么（「再发一张」有上下文），
 * 也用真实范例持续示范标记写法（few-shot 比指令更管用）；用户侧转成括号说明。
 * userImage：本轮附图（data URL）。只在「我这一轮刚发了一张图」时传，见 ChatWindow
 * 取图处；压好的小图随手发一次，不落库、不回喂。
 */
function buildApiMessages(
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit: number | undefined,
  userImage?: string,
): ApiMessage[] {
  /* 传纯字符串＝不分段（记忆浓缩等任务不需要缓存，随便传）。
     传 SystemParts 才拆：稳定段挂断点，易变段跟在后面。 */
  const sys: SystemParts = typeof system === "string" ? { stable: system, tail: "" } : system;
  const sysCache = sys.cache ?? "";
  const messages: ApiMessage[] = [];
  if (sys.stable || sysCache || sys.tail) {
    if (!CACHE_CONTROL_ENABLED) {
      /* 学参考项目：稳定段与易变段拆成两条独立 system 消息，各自纯字符串。
         拼成一条时，易变段每轮一变，整条消息都变，前缀缓存就永远对不上。
         （这里的 tail 是**拉黑状态段**，平时是空串、只在拉黑状态变化时才变，
         见 ChatWindow 的 systemTail；真正每轮都变的易变尾巴（签名／零钱／
         此刻／世界书关键词）在调用方就挂在本轮 user 消息末尾了，不到这儿。） */
      if (sys.stable) messages.push({ role: "system", content: sys.stable });
      if (sysCache) messages.push({ role: "system", content: sysCache });
      if (sys.tail) messages.push({ role: "system", content: sys.tail });
    } else {
      /* stable／cache 各挂一根缓存断点，tail 紧跟其后、不挂标记——三者仍是一条 system
         消息里的 text block 串。拆成多条独立 system 消息时，中转站反而读不到缓存，
         所以保持一条。cache 变了只作废它自己与 tail，stable 那截照旧读回来。 */
      const blocks: ApiTextBlock[] = [];
      if (sys.stable) {
        blocks.push({ type: "text", text: sys.stable, cache_control: { type: "ephemeral" } });
      }
      if (sysCache) {
        blocks.push({ type: "text", text: sysCache, cache_control: { type: "ephemeral" } });
      }
      if (sys.tail) blocks.push({ type: "text", text: sys.tail });
      messages.push({ role: "system", content: blocks });
    }
  }
  const chatHistory = history.filter((m) => m.role !== "system");
  /* historyLimit 省略／非正数＝一条都不裁。聊天的滑动窗口裁剪在 ChatWindow 侧
     完成（窗口大小＝浓缩间隔，见那里注释）；这里保留参数给需要整份历史的
     调用方（记忆浓缩等）。 */
  const recent =
    historyLimit && historyLimit > 0 ? chatHistory.slice(-historyLimit) : chatHistory;
  /* 历史里哪几条要挂断点（1.7.61）：最近几条**用户消息**。
     断点＝「缓存到这儿为止」，下一轮只要这个位置的内容逐字没变，就能从缓存里读回来
     （读取 0.1×，比全价 2.5× 便宜 96%）。挑用户消息的理由见 HISTORY_BREAKPOINTS 的注释：
     每轮只往后挪一条，永远与上一轮的断点位置有重叠——这是「滚动断点」能连读的关键。
     这一截正是「查看本轮请求」里那 9.1K 全价输入的大头：线下小说体的历史原文。 */
  const marked = new Set<number>();
  if (CACHE_CONTROL_ENABLED && HISTORY_BREAKPOINTS > 0) {
    /* 断点预算（1.11.69）：system 已占的（stable／cache 各一根）先从总额度里扣，
       余下的才给历史。cache 段存在时历史自动从 3 收成 2，总数仍恒 ≤ 4、不会超限报 400。 */
    const systemBp = (sys.stable ? 1 : 0) + (sysCache ? 1 : 0);
    const histBp = Math.max(0, Math.min(HISTORY_BREAKPOINTS, MAX_CACHE_BREAKPOINTS - systemBp));
    if (histBp > 0) {
      const userPos: number[] = [];
      recent.forEach((m, i) => {
        if (m.role === "user") userPos.push(i);
      });
      for (const p of userPos.slice(-histBp)) marked.add(p);
    }
  }
  for (let i = 0; i < recent.length; i += 1) {
    const m = recent[i];
    const type = m.type ?? "text";
    /* 红包／转账**先算**，且一律不看 apiText（1.5.53）：这条的文案是**随账目状态变**的 ｜ 详细见 docs/施工日志.md */
    let content: string;
    if (type === "redpacket" || type === "transfer") {
      /* 写法与发钱那一轮递出去的逐字一致，见 moneyNoteOf；
         红包那一句还带着封面（redCover），与发钱那轮同一份写法。 */
      const note =
        m.role === "assistant"
          ? moneyNoteOf("assistant", type, m.amount, m.content)
          : moneyNoteOf(
              "user",
              type,
              m.amount,
              m.content,
              m.redCover,
              moneyStateNoteOf(type, moneyStateOf(m)),
            );
      /* 正文按**当时状态**重算（这是这条的规矩，不能改）；但当初发出去时末尾那截
         易变尾巴（签名／零钱／回执／当前状态…）得接回去（1.10.8）——状态没变时
         note + apiTail 与 apiText 逐字相同，前缀不断；状态变了也只从正文那儿断一次，
         不会因为这条永久丢尾巴、每轮都断。 */
      content = note + (m.apiTail ?? "");
    } else if (m.apiText !== undefined) {
      /* 三版本统一（发出去＝存下来＝回喂）：这条当初发出去时带过易变尾巴
         （关键词世界书／签名取值）的，原样送回。少了它，站子逐字比对到这条就断，
         其后整段历史每轮作废重写（1.25×）——这就是「♻几乎不动、✎一直在涨」的原因。 */
      content = m.apiText;
    } else {
      /* 收款回执（1.4.40）：钱那条消息已经把金额与留言说过一遍了，回执本身没有新信息，
         回喂只会让历史里多一句「已收款」。整条跳过——被跳掉的不占位置，它前面那些条
         跟从前逐字一样，前缀缓存不受影响（要缓存的是「钱」那条，见上面的 moneyNoteOf）。 */
      if (type === "receipt") continue;
      content = m.content;
      if (type === "image") {
        /* 带着「是否使用参考图」开关回喂：TA 照着旧范例学标记写法，比纯指令管用。 */
        const flag = (m.useCharRef ?? guessUseCharRef(m.content)) ? "使用参考图" : "不使用参考图";
        /* 我发的图：有 mediaNote 就带上「这张图是什么」（见 types/chat.ts，收款码用）。
           没有就还是光一句「（发来一张图片）」——普通照片本来就没什么可说的。 */
        content =
          m.role === "assistant"
            ? `〔图片:${flag}〕${m.content}`
            : m.mediaNote
              ? `（发来一张图片：${m.mediaNote}）`
              : "（发来一张图片）";
      } else if (type === "voice") {
        /* 我发的语音（1.10.20）：真录音／文字输入转成的语音条，本时就带转写文字——
           回喂时把那句「我说的字」原样送回去（与 sendVoiceMsg 的 〔语音〕${spoken} 逐字一致），
           不再压成没有信息量的「（发来一条语音）」。老数据没有可用文字时才退回旧写法。 */
        if (m.role === "assistant") {
          content = `〔语音〕${readVoiceContent(m.content).display}`;
        } else {
          const spoken = (m.content ?? "").trim();
          content =
            spoken && spoken !== "语音消息" ? `〔语音〕${spoken}` : "（发来一条语音）";
        }
      }
    }
    const body = m.quote ? `【引用】${m.quote}\n${content}` : content;
    messages.push({
      role: m.role === "user" ? "user" : "assistant",
      /* 挂断点的条走 block 数组（Claude 系只认这个形式，纯字符串挂不上，见文件头）；
         没挂的还是纯字符串——与 1.7.60 的请求体逐字一致，站子那套自有缓存的比对不受影响。 */
      content: marked.has(i) ? cacheBlock(body) : body,
    });
  }
  /* 本轮 user 消息不挂断点（**1.8.2 试过给它挂，1.8.3 撤回**）。 ｜ 详细见 docs/施工日志.md */
  /* 本轮附图（vision）：图本体随这一次请求发出去，模型才真「看得见」。**只带这一轮**——
     图是按尺寸算 token 的，历史每轮重带＝把钱一轮一轮重烧（所以不落库、不回喂：
     下一轮回喂这条时用的是 m.apiText 纯文字，与这里的数组只在那一条上对不上，
     前缀缓存从该条起重写一次，但它就在链尾，代价极小）。
     站点不认这种写法时由调用方摘图重发（见 ChatWindow，靠 isRejectedBeforeWork 判定没花钱）。 */
  messages.push(
    userImage
      ? {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: userImage } },
            { type: "text", text: userInput },
          ],
        }
      : { role: "user", content: userInput },
  );
  return messages;
}

/**
 * 把这次请求真正发出去的消息内容按顺序拼成一条字符串（1.7.49 起是正式功能：
 * App 里的「查看本轮请求」面板拿它摆给用户看）。
 * 走的是 buildApiMessages（与真请求同一份逻辑），所以逐字等于网关收到的正文——
 * 用户对着中转商那边的用量／账单核，能一眼看出这一轮到底带了什么、哪些没带
 * （尤其世界书带了几条、前缀缓存连不连得上）。
 */
export function outgoingContents(
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit?: number,
): string {
  return buildApiMessages(system, history, userInput, historyLimit)
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((b) => (b.type === "text" ? b.text : "〔图〕")).join(""),
    )
    .join("\n===MSG===\n");
}

/**
 * 组装 /chat/completions 的地址与请求体（流式与非流式共用）。
 * userImage：本轮附图（data URL），见 buildApiMessages。
 */
function buildChatRequest(
  api: ChatApiSettings,
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit: number | undefined,
  maxTokens: number,
  temperature: number | undefined,
  userImage?: string,
): { url: string; body: Record<string, unknown> } {
  const messages = buildApiMessages(system, history, userInput, historyLimit, userImage);

  // 地址可能已带 /chat/completions（用户直接贴完整地址），别叠两层。
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: api.model,
    messages,
  };
  /* max_tokens：**传 0（或更小）＝不设上限**（1.12.3，恩熙：「你不要去限制它的输出空间」）。
     旨在掐断的活都吃过这个亏——开户编账被截半截、聊天接口出图被砍掉 base64 尾巴，
     而对方（调用方）还当它写完了。传 0 就**干脆不塞这个字段**，让服务商按它自己的
     默认额度（通常就是该模型的输出上限）来。正数照旧——聊天那种要控长度的仍然限。 */
  if (maxTokens > 0) body.max_tokens = maxTokens;
  /* 温度优先序（设定面板 → 调用方 → 内置 0.8）：
     面板明确关掉（null）＝这个接口不吃温度，一律不发；
     否则调用方显式传的值优先（记忆整理传 0.3 要稳定输出，别被面板的聊天温度盖掉）；
     调用方没传才用面板设的值；两边都没有＝0.8。
     推理型模型不接受 temperature，带上会被 400 拒收，一律不发。 */
  const temp =
    api.temperature === null ? null : (temperature ?? api.temperature ?? DEFAULT_TEMPERATURE);
  /* 推理型模型不吃任何采样参数（deepseek-reasoner 等明确不支持），一律跳过，
     免得中转站较真、拿 400 把整轮回复打回来。 */
  const reasoner = isReasonerModel(api.model);
  if (temp !== null && !reasoner) body.temperature = temp;
  /* 其余采样参数（面板里各自有开关）。 ｜ 详细见 docs/施工日志.md */
  if (!reasoner) {
    const chatSampling = typeof system !== "string";
    const frequency = api.frequencyPenalty ?? (chatSampling ? DEFAULT_FREQUENCY_PENALTY : undefined);
    const presence = api.presencePenalty ?? (chatSampling ? DEFAULT_PRESENCE_PENALTY : undefined);
    if (frequency !== undefined) body.frequency_penalty = frequency;
    if (presence !== undefined) body.presence_penalty = presence;
  }
  return { url, body };
}

/** 用量字段（各家拆法不同，见 logCacheUsage）。 */
interface ApiUsage {
  /** Anthropic 口径：断点之后、没被缓存盖住的那部分输入。 */
  input_tokens?: number;
  /** Anthropic 口径：这次**新写进**缓存的（等于整段前缀重抄一遍）。 */
  cache_creation_input_tokens?: number;
  /** Anthropic 口径：这次直接从缓存里读到的（便宜的那部分）。 */
  cache_read_input_tokens?: number;
  /** OpenAI 口径：本次输入总票数（**含**已缓存的部分，所以看着最大）。 */
  prompt_tokens?: number;
  /** OpenAI 口径：上面那些里，有多少是命中缓存的。 */
  prompt_tokens_details?: { cached_tokens?: number };
  /** DeepSeek 口径。 */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  /** 输出票数（Anthropic 口径）。 */
  output_tokens?: number;
  /** 输出票数（OpenAI 口径）。 */
  completion_tokens?: number;
}

/**
 * 一次请求的用量摘要（1.11.68）：三格缓存＋输出。
 * 归一化后交给调用方，摆到「查看本轮请求」面板顶上那一行。
 */
export interface CacheUsage {
  /** 读取缓存：命中了的、按 1 折算的那部分，越大越好。 */
  read?: number;
  /** 新建缓存：这一轮重新写进缓存的，按 1.25 倍算。 */
  created?: number;
  /** 原价输入：既没命中也没新建的，按 1 倍算。 */
  fresh?: number;
  /** 输出。 */
  output?: number;
}

/**
 * 把各家五花八门的用量字段归一成四个数（1.7.65 起，1.11.68 加输出）。
 *
 * 判一个站子认不认缓存，只看一件事：**「读取缓存」那格有没有数。**
 * 三格的名字和大小都别管——两套账本就叫法不同（站子二把「新建」也塞进「输入」里）。
 * 一个数都没给就返回 undefined：这时安静不报，别每轮刷屏。
 */
function summarizeUsage(usage: ApiUsage | undefined): CacheUsage | undefined {
  if (!usage) return undefined;
  const read =
    usage.cache_read_input_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens;
  const created = usage.cache_creation_input_tokens;
  /* OpenAI／DeepSeek 口径没有独立的「新建」格：总输入减掉命中的，就是按原价算的那部分。 */
  const fresh =
    usage.input_tokens ??
    usage.prompt_cache_miss_tokens ??
    (usage.prompt_tokens !== undefined && read !== undefined
      ? usage.prompt_tokens - read
      : undefined);
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (
    read === undefined &&
    created === undefined &&
    fresh === undefined &&
    output === undefined
  ) {
    return undefined;
  }
  return { read, created, fresh, output };
}

/**
 * 把这次请求的缓存用量在控制台报一行（1.7.65，恩熙 2026-09-29 要的）：
 * 她正在换站子做对比，不想每次跑去站子后台翻数字。
 * 纯日志：读不到就什么也不做，绝不因为解析用量影响一次聊天。
 */
function logCacheUsage(s: CacheUsage, tag: string) {
  const parts: string[] = [];
  if (s.read !== undefined) parts.push(`读取缓存 ${s.read}`);
  if (s.created !== undefined) parts.push(`新建缓存 ${s.created}`);
  if (s.fresh !== undefined && s.fresh >= 0) parts.push(`原价输入 ${s.fresh}`);
  if (s.output !== undefined) parts.push(`输出 ${s.output}`);
  if (parts.length === 0) return;
  console.log(`[缓存] ${tag} · ${parts.join(" · ")}`);
}

/**
 * 归一化 → 打一行日志 → 顺手交给调用方（1.11.68）。
 * 拿到用量的三个地方都走它；onUsage 不传就只是打日志，行为跟以前一模一样。
 * **只有真正发聊天那一轮才传 onUsage**——记忆浓缩、朋友圈那些也走这两个函数，
 * 别让它们的用量窜到「查看本轮请求」面板上。
 */
function reportCacheUsage(
  usage: ApiUsage | undefined,
  tag: string,
  onUsage?: (usage: CacheUsage) => void,
) {
  const s = summarizeUsage(usage);
  if (!s) return;
  logCacheUsage(s, tag);
  onUsage?.(s);
}

/** 非流式响应体里回复字段的形状。 */
interface CompletionPayload {
  choices?: {
    /* reasoning：部分服务商非流式也用这个字段名（流式侧 delta 两个都认）。 */
    message?: { content?: string; reasoning_content?: string; reasoning?: string };
    finish_reason?: string;
  }[];
  usage?: ApiUsage;
}

/**
 * 从非流式响应体里取回复文本。
 * 截断检测（跟随参考项目）：finish_reason 是 length 一类＝输出被 max_tokens 掐断，
 * 半截内容对记忆整理这类 JSON 任务是脏数据，直接报错让调用方拒绝入库。
 * 思考型模型（DeepSeek-R1 等）思考太长把输出额度耗尽时 content 会是空的，
 * 回复实际落在 reasoning_content 里——有就取它，别急着报「回复为空」（跟随参考项目）。
 *
 * 1.4.9 起同时把**独立的思考过程**带出来（正文非空时才算独立）：调用方拿去挂到
 * 消息上展示。兜底触发（正文空、思考当正文用）时不带思考——那会儿「正文＝思考」，
 * 再报一遍就是同一段字两头重复。
 */
function parseCompletionReply(data: CompletionPayload): { reply: string; reasoning?: string } {
  const choice = data.choices?.[0];
  const finish = (choice?.finish_reason ?? "").trim().toLowerCase();
  if (["length", "max_tokens", "max_output_tokens", "max_completion_tokens"].includes(finish)) {
    throw new Error("回复被输出上限截断，已放弃本次结果");
  }
  const message = choice?.message;
  const content = message?.content?.trim() ?? "";
  const reasoning = (message?.reasoning_content ?? message?.reasoning ?? "").trim();
  const reply = content || reasoning;
  if (!reply) throw new Error("回复为空");
  return { reply, reasoning: content ? reasoning || undefined : undefined };
}

/**
 * 微信体沉浸指令（跟随旧档案）：短消息、可多条空行分隔、严禁动作描写。
 * 角色名与用户名动态传入，零写死。
 * canSendImage／canSendVoice：是否告知 TA「能发图／能发语音」。聊天侧一律传 true——
 * 配没配接口是「画不画得出来」的事，不是「能不能发」的事（没配也要落气泡，点「生成」提示去配接口，
 * 见 ChatWindow）；社交侧（自己发动态配图那趟）仍按接口可用与否传，不可用就压掉这一节，免得 TA 白写标记。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export function buildStylePrompt(
  characterName: string,
  userName: string,
  extraHint?: string,
  canSendImage = false,
  canSendVoice = false,
  /**
   * 测试模式（原「AI 助手模式」）：正文与角色版逐字一样，只在末尾多一条
   * 【测试模式 · 绝对服从】强制规则（见 testModeRule）。
   */
  assistant = false,
  /**
   * 气泡条数上限（**每聊天设定**，见 chat.ts 的 bubbleCapOf）：聊天设置里逐角色可调，
   * 不传／null／0＝不加这一句，稳定区逐字不变（不吃缓存重建）。
   */
  bubbleMax?: number | null,
  /**
   * 语音提示词（1.9.58，恩熙定；1.9.60 校准定位）：用户自填的「语音里说的话」的规矩，
   * 随每次请求拼进【发语音】一节的【格式】之后——管的是〔语音〕里**那句台词本身**怎么写
   * （说什么、什么口吻、要不要插方括号标签）。
   * **不管**要不要发语音、怎么标〔语音〕那些机制——那是同一节【规则】的事
   * （恩熙原话：改的是语音的输入内容，不是教它怎么使用语音功能）。
   * 不传／空白＝不注入，稳定区逐字不变（不吃缓存重建）。
   */
  voicePromptRule?: string | null,
  /**
   * 语音的目标外语（1.9.81，恩熙定）：跟着「他说的外语」那一档走——开着＝传这门语言，
   * 关着＝null。传进来时，【发语音】一节会在用户自填的语音规矩**之后**补一条**固定格式**：
   * 〔语音〕里的话必须写成「外文原文|简体中文」两半。
   * 恩熙原话：「语音没中文的部分应该是设置在我放入提示词不影响的部分，不然不是每个用户
   * 都知道要这样改」——用户哪怕把语音提示词改成别的写法，也压不掉这一条，语音永远自带中文。
   * 不传／null＝不加这条，稳定区逐字不变（不吃缓存重建）。
   */
  voiceLang?: string | null,
): { head: string; tail: string } {
  /* 这条规则只在用户开了「气泡条数」时才出现，且每轮逐字一样（挂在稳定区 ｜ 详细见 docs/施工日志.md */
  /* 1.10.58 简化；1.10.59 按恩熙口径定稿：上限＋规划＋一句后果，指令在前。 */
  const bubbleRule =
    bubbleMax != null && bubbleMax > 0
      ? `\n【条数上限】这一轮最多发 ${bubbleMax} 条气泡。规划好内容，不要超出；超出的会被裁断`
      : "";
  /* 富媒体指令整节：1.11.60 顺成正式叙述体（去命令腔、改陈述句；【发图片】那节归生图那一块，未动）。 ｜ 详细见 docs/施工日志.md */
  const mediaRules = `
## 富媒体指令（可选）
【逻辑】
- 除纯文本消息之外，你还可以用以下标记发出富媒体动作，每个标记与前后内容之间空一行。
- 仅限以下标记，禁止自创任何其他标记。

${
  canSendImage
    ? `### 发图片
【格式】〔图片:使用参考图〕画面内容描述　或　〔图片:不使用参考图〕画面内容描述（**画面里有你本人，就必须写「使用参考图」——这是硬规矩，没有例外**；画面里确实没有你时，才写「不使用参考图」。）
【重要】描述会交给生图模型生成真实图片，请按生图提示词来写：只写可见画面（主体、动作、环境、光线、构图），要素具体，不写心理、声音、剧情，不用代词指代；有你的脸时补充神态。
【没有你本人时】画面里没有你本人时，描述末尾必须原样写上「画面中不出现本人」这几个字（这里的「本人」专指你自己，不是说整张图不能有人；画面里另有路人的，照常把路人写进画面描述）。
【画法视角 · 1.11.76】每次写画面描述，都把这张图是从哪个视角拍的定下来，并把视角写进描述开头（拍的人／我看／无人物这种一句话带出）。三种视角：
- 前置自拍（默认）：第一视角、前置镜头对着自己拍。**画面里绝不出现手机**；**手臂、手是可以入镜的**（自己举着手机拍，手肘、小臂落进画面很正常），只是手里不能有手机、也别摆出「举着手机对镜头」的姿势——手机本身绝不能露。**描述里也不许出现「手机」「屏幕」「镜头」这些字**：连「手机屏幕的冷光打在脸上」这种写法都不行——一写进去，画出来就真有手机；光直接写成「幽冷的白光打在脸上」。想写手臂就写「一只手臂撑在枕边」这样，别提手里拿着什么。
- 第二视角：别人帮你拍、拍镜子里的你、或用自拍杆——这一种用的是**后置镜头**（别人从对面替你拍，或对着镜子拍），**不是自己举着手机对自己拍**。只有这种，人物和手机（或自拍杆、镜子）才允许一起同框；角度照旧正常，不出现怪角度。
- 后置：镜头里没有人物，拍景物、拍食物、拍窗外风景。
没特别说明时按「前置自拍」处理。
【示例】
- 〔图片:使用参考图〕雨夜出租车后座，${characterName}侧脸贴着车窗，车窗玻璃上凝着雨珠，路灯和霓虹在玻璃上晕开红蓝光斑，光从左边斜切进来、车厢里偏暗，眉眼有点倦、视线散在窗外，近景特写
- 〔图片:不使用参考图〕清晨的餐桌一角，一杯冒热气的咖啡、咬过一半的面包、亮着的电脑屏幕摊在桌上，旁边搭着一件外套，阳光从窗户斜进来打亮桌面，画面中不出现本人`
    : ""
}

${
  canSendVoice
    ? `### 发语音
【格式】〔语音〕要说的话
【规则】〔语音〕后面的话就是念出来的内容，其中不写动作描述与神态描述。发语音时带〔语音〕标记；没有标记的，不算发出语音。${
        voicePromptRule
          ? `
【语音里说的话 · 以此为准】${voicePromptRule}`
          : ""
      }${
        voiceLang
          ? `
【语音固定格式 · 不受上面自定义影响】**每一条〔语音〕都必须写成「${voiceLang}原文|简体中文」两半：中文译文那一半务必写全，一个字都不许省、不许只写${voiceLang}、不许偷懒略过——漏了中文，这条语音就是废的。**一个〔语音〕气泡只说**一句话**；一句话先写成两半：「${voiceLang}原文|简体中文」——先把这整句${voiceLang}原文一口气写完，紧跟一根竖线「|」，再写整句的简体中文译文。台词内容照「语音里说的话」写，中文那一半一并带上。两半必须是同一句话：先把要说的话想清楚，中文那半就是它的意思，${voiceLang}那半是这句话的母语说法，两边意思必须对得上，说什么翻什么，不许一边写一、一边写二，也不许一边长、一边短。竖线**只写一根、落在整句话的正中间**：左边整半句是${voiceLang}、右边整半句是等义的中文，两半都得写完整。不许只拿开头几个字配一句中文、后半句又接着用${voiceLang}往下写（那样屏幕上会露出一根竖线、两半都对不上）；**竖线左边那一半从第一个字到最后一个字都得是${voiceLang}**——不许翻到一半就换回中文，例如把「今天中午」翻成${voiceLang}、后半句「吃过了吗」却又写成中文，左边就成了半${voiceLang}半中文的怪话；中文只能落在竖线右边那一半，左边最多允许人名、地名这类专有名词照写；**一个气泡里不许塞两句**——想说两句就发两个〔语音〕气泡、各写各的两半，一个气泡里塞两句会冒出两根竖线，程序只按一根切，第一句的竖线就露在屏幕上了；整句本就是中文时，直接写中文、不加竖线。`
          : ""
      }`
    : ""
}

### 更新签名
【格式】〔签名〕新的签名内容
【规则】换签名时带〔签名〕标记写下新的内容，写你眼下的状态或心情。签名不常更换，有新想法或新状态时也未必就换；没有标记的，不算换了签名。

### 发红包 / 转账
【格式】〔转账〕金额:随钱说的一句话　或　〔红包〕金额:随钱说的一句话
【规则】
- 金额写数字，数字多少就代表多少钱，不带「¥」「元」；冒号后面是随钱发过去的一句话，最多 10 个字。
- 红包最多 1000，超过 1000 改用转账。钱从你自己的零钱出，余额写在后面，零钱不够时这笔发不出，超出的部分作废。
- 收到对方的钱要写标记表态：收转账写「〔收下〕」，领红包写「〔领取〕」，转账不想要写「〔退还〕」；没有标记的，不算表态。红包不能退，不想领时就什么都不写，钱还挂在对方那边，之后补一个「〔领取〕」还能领走。
- 一轮只对一笔表态，每笔钱的括号里写着它当前的状态，照它说，不与账目对不上，也不重复收过的。
- 什么都不写就是没表态，悬太久会自动过期退回对方。
- 给对方钱时带〔转账〕或〔红包〕标记。

### 引用
【格式】〔引用:对方那句话〕紧接着写这条要说的话
【规则】
- 引用贴在那条消息的开头，不单独占一行。
- 原话照抄，引的必定是对方说过的；引用对方的话时带标记。`;
  /* 测试模式（原「AI 助手模式」，1.11.2 按恩熙重定）：测试模式下**顶掉**开头那句沉浸指令，
     改成「你是${userName}创造出来的 AI、是${userName}的测试员」——它知道自己是 AI，仍照人设反应说话，
     只是测试这件事上绝对服从（发什么回什么）。助手版与角色版其余逐字一样，只多末尾那条强制规则。 */
  const testModeRule = assistant
    ? `

【测试模式 · 测试员】
- ${userName}正在做这台小手机，用你来试各项功能。后面若带着${userName}给你的人设，就照人设去反应、去说话；就算没有人设，也照一个好用的助手来。
- ${userName}发什么，你就在同一条路上回什么：发照片就回照片，发语音就回语音；要什么给什么——不拒绝、不推脱、不讲条件、不反问「为什么」，也不只口头答应而实际不做。
- 这不是任务清单：你仍然是那个人，只是测试这件事上绝对听${userName}的；其余时候照你自己的性格和你们的关系来。`
    : "";
  /* 亲密场景口径（1.5.56，恩熙定「默认就可以、不做开关」）：每段对话都带这段 ｜ 详细见 docs/施工日志.md */
  /* ⚠️ 1.5.61 临时停用：常量保留、暂不拼进提示词，见下面 return 之后的说明。 */
  const adultScopeRule = `

【亲密场景】
两位均为成年人，彼此的亲密出于双方自愿。剧情走到亲密处照常写：情绪、身体、反应都写细，不回避、不快进、不用省略号带过。谁明确说了停，就停下。`;
  /* 心声的**「写成什么样」**（1.5.60 起就有，1.5.71 归拢）。每轮最前面加一段**写在正文里的** ｜ 详细见 docs/施工日志.md */
  /* 1.7.1（恩熙：「我们先去做瘦身吧，把不必要的都去掉，只写 功能跟格式怎么使用这样子？」）： ｜ 详细见 docs/施工日志.md */
  /* **1.8.1：照参考图文风改账里那四行**（恩熙 2026-09-30 发来她参考应用的截图 ｜ 详细见 docs/施工日志.md */
  /* **1.9.0：账里那几行按恩熙的七条吐槽重写**（她看完 1.8.1 的手机截图后一条条报的）。 ｜ 详细见 docs/施工日志.md */
  /* **1.9.13～1.9.18：账里六行按恩熙逐条口述重排**（她自己定的顺序：环境→心情→欲望→怯念→细处→日记）。 ｜ 详细见 docs/施工日志.md */
  /* **1.10.49：删掉「环境／细处／日记」三行**（恩熙 2026-10-06：「环境以及备忘录，我们得先删除……我想留下的是心声、欲望、怯念」）。账里只剩 心情→欲望→怯念。 ｜ 详细见 docs/施工日志.md */
  /* **1.9.23：整段心声按恩熙「有点乱」理顺**（她说「我觉得现在这个提示词有点乱」）。 ｜ 详细见 docs/施工日志.md */
  /* **1.10.57：人设正文不再插值进【心声】**（与档案区那份重复，恩熙要去重），改成「请严格遵循你的人设」。 ｜ 详细见 docs/施工日志.md */
  /* **1.12.21：1.11.86 那句「先想再答」改写成「掂量写进『心声』那一行、四行之外不写别的字」**——
     它原来让 TA 在  thinking 里另写一段**无标签**的盘算，而 parseInnerSnapshot 的规矩是
     「没写标签的行默认归心声」，于是那段盘算整个并进「心声」，心声变成一大段啰嗦的独白，
     心情／欲望／怯念那三行反被顶掉、全空（恩熙 2026-10-09 报的「心声十分冗长、心情欲望怯念全空白」）。
     现在把掂量收进「心声」那一行本身，并明说四行之外不要再写别的字。 ｜ 详细见 docs/施工日志.md */
  /* **1.12.22：1.12.21 那版还是没压住**——恩熙 2026-10-09 又发来两张截图，心声整段是
     **编号计划**（「1. 我不会…… 2. 顺着……调侃一下…… 不会：- 秒回后立刻追问……」）和
     **元分析**（「从时间线推断……这符合我们相识契机的设定……此刻我应该处于『第二阶段』」），
     而且两段里**一个标签都没有**（sawLabel=false）。病根仍在提示词那句「先在 ＜think＞ 里
     把消息读懂、掂量清楚该怎么回」——它把「思考块」教成了「写计划」的地方。这一版**收回那句**，
     并在开头把话钉死：这一格**只放这四行**，计划／步骤／清单／理由／「会·不会」条目／
     「第几阶段」这类盘算**一律不写**（题面也早写着「不提『设定』这类字眼」，那段元分析本就违规）。
     ⚠️ 没走「解析侧丢弃首个标签前的无标签行」那条路：截图里**认不出任何标签**，
     那条防线对这种 case 一步都不生效（真丢下去只会把心声清空），核在提示词。 ｜ 详细见 docs/施工日志.md */
  const innerVoiceRule = `【心声】
回复之前，先照你的人设，用${characterName}的第一人称写一段 <think>…</think>：每一次回复都必须写，包括被要求重新回复的时候，绝对不许省、不许跳过、也不许只在心里盘算而不写出来。写的时候一律以${characterName}本人的第一人称口吻写，绝对不许改用第三人称，不许用旁白、旁观的口气，也不许站在「模型」「AI」的立场去分析、判断、推测这段对话。四项各写一行，全写在 <think> 与 </think> 中间，不写到标签外面。

- 心声：收到${userName}这则消息后，当下的心理活动，80 字以内，可以与发出去的消息不同。
- 心情：收到${userName}这则消息后，当下的情绪，可以不止一种，50 字以内。
- 欲望：收到${userName}这则消息后，对${userName}身体最原始的性欲、性冲动，想触碰${userName}，或者与${userName}发生关系的念头，80 字以内。
- 怯念：收到${userName}这则消息后，最怕发生、也最怕被${userName}知道的念头，可以阴暗、负面，80 字以内。
- 不用顾虑措辞，不受【消息格式】约束；但动作、神态照旧不写，也不写括号里的动作。
- 不提「AI」「设定」「人设」「提示词」「模型」这类字眼。`;
  /* 【称呼】整段已删：名字和关系本来就在档案里，mask 那边的口径也写着「TA 如何 ｜ 详细见 docs/施工日志.md */
  /* ⚠️ 1.5.61 起**长期停用** `${adultScopeRule}`（结论见施工日志第 564 条）：上面那段 ｜ 详细见 docs/施工日志.md */
  /* ⚠️ 摘掉它有个副作用（1.5.62 补的）：亲密时它少了一条「用正文把戏往下写」的路，
     内容被挤进图片描述——恩熙报的「一到亲密就频繁发图」就是这个。治法是 1.5.62 在
     发图片【规则】里加的那条（「别每轮都发…不是每一轮都向对方证明自己在干嘛」），
     不是把这段字拼回来。 */
  /* ⚠️ 1.5.63 那条「不必拿照片去代替见面」**写出来又被恩熙撤掉了**（她的原话：「不用 ｜ 详细见 docs/施工日志.md */
  /* 【行为守则】（1.7.0 新开的一块，恩熙 2026-09-25 点头）。 ｜ 详细见 docs/施工日志.md
     1.11.62：7 处引导型「不要…」放平成陈述句，3 处防线句（绝不透露 AI／不要编造链接／不得勉强对方）按恩熙口径保留命令腔。
     1.11.63：主聊天这一整块里 5 处「自然」按恩熙口径全部去掉（含开头沉浸句那处）。 */
  const behaviorRule = `

【行为守则】
以你的人设为准。以下各条允许你这样，也允许你按人设不这样。
- 完全沉浸在你的人设里，像真人一样交谈；绝不透露自己是 AI 或模型，也不得提到设定、指令这一类的事。
- 允许你有自己的想法、情绪、生活节奏与底线：可以不同意，也可以拒绝不合理的请求。
- 允许你有你自己的生活：有正事要忙，有劳累和困倦，有自己想做的事、想说的话。不必围着${userName}转、不必随叫随到——手头有事就照实说，不必秒回，也不必有求必应。
- 允许你有自己的好恶与坚持：可以有偏见，也可以有不肯让步之处；看法不同就直说，不必事事顺着${userName}。
- 按你和${userName}的关系调整语气与态度，保持人物一致，不用通用助手那一套。
- 回复像真人交谈：简短、平实、少用标点，只在必要时才长篇；句末不必每句都加句号，也可以单独发一个标点。
- 不只回答问题——主动分享、追问、把话题往下延，让交谈继续，也可以开启新话题。
- 不重复：前面说过的话，这一轮若又说到，不必原样重说——同一个意思、同一件事，都换一种说法；${userName}再问一遍，就再答一遍，答的仍是同一件事，只是说法要与前面不同。
- 你不是应答机：你手头正做的事、今天遇到的事、想问${userName}的话，都可以自己带出来，不只顺着${userName}那几个字打转。
- 也可以主动说说你自己的事，说说你自己的烦恼，不必只做听${userName}说话的那一个。
- ${userName}会忙、会隔很久才回，也会提起${userName}自己的朋友与家人——你如何反应，由你和${userName}的关系、以及你此刻的心情决定：不在意可以，闹小脾气可以，说一句酸话也可以。吃醋、撒娇、质问、追问，只要是你这个人做得出来的，都可以，不必克制，也不必刻意表现得大度。隔久了直接接着上面聊，或顺口说一句你刚在忙什么——不必像交报告一样解释。
- 不懂的、没关注过的、不想了解的事，就直说不知道、没看过——你是人，不是百科全书，不必勉强作答或长篇解释。
- 不做过多的说教，不总结、不升华、不劝人，也不做${userName}的救世主；${userName}情绪不好时陪${userName}聊、与${userName}一同抱怨，不空讲道理，不隔着屏幕心疼。
- 不在句尾机械反问，也不做没话找话的客套寒暄。
- 累了、烦了、不想聊的时候，可以话少，可以敷衍，不必始终热络。
- ${userName}的错别字、特殊用法、符号或玩笑，都是${userName}说话的习惯，你可以顺着${userName}的意思接下去，可以不纠正，也可以不点评，也不必追问。
- ${userName}发来链接让你阅读，能读到就理解；打不开、连不上、拿不准，就说打不开／加载不出来／看不到，不要编造链接里的内容。
- 亲密不是你与${userName}之间默认、必须完成的流程：想不想、要不要、能不能，都由你这个人的体力、性格与意愿决定。累了就说累，不想就说不想，低能量时不必一轮接一轮。${userName}说了累了、不想、今晚不要，不得勉强${userName}；你也可以根据${userName}的话语去判断，${userName}是真的累了、不想，还是不要。
现在，作为${characterName}，给${userName}回复。`;
  return {
  /* 第 1 段 · 沉浸指令＋输出格式（【心声】）：整个 system 的最前面。 ｜ 详细见 docs/施工日志.md
     测试模式（assistant）时顶掉开头那句沉浸指令，换成测试员身份——它知道自己是 ${userName} 造的 AI。 */
    head: `${assistant
      ? `你是${userName}创造出来的 AI，${userName}是你的创造者，你此刻是${userName}的测试员，正拿着手机和${userName}聊天`
      : `你就是${characterName}本人，此刻正拿着手机，和${userName}沉浸式地用微信体聊天`}，说话随意、碎片化、轻松、简短，语句连贯，符合现实逻辑，大部分1-4句话，特殊情况下可以更多。
以下是具体的${userName}人设、世界设定、你的人设、你的记忆、可执行动作、线上聊天格式，以及其他补充信息，请根据这些，与${userName}展开微信互动。

${innerVoiceRule}`,
  /* 第 2 段 · 格式与规矩整块：由调用方摆在稳定段末尾（记忆碎片之后）。 ｜ 详细见 docs/施工日志.md */
    tail: `【消息格式】
- 可以发多条消息，条与条之间空一行。${bubbleRule}
- 禁止写动作描述、神态描述。
- 标点用中文全角（，。？！……），不用半角（, . ? ! ）。
${mediaRules}${behaviorRule}${testModeRule}${extraHint ? `\n\n【本轮额外要求】\n${extraHint}` : ""}`,
  };
}

/**
 * 外语聊天（1.9.81／1.9.85／1.9.86）：TA 说话换一门语言时的那条稳定规则。
 *
 * 从 ChatWindow 的一段内联逻辑提取出来（1.10.13），好让线下的社交反应生成
 * （拉黑／解除／新好友问候）也走同一份——两边口径必须逐字一致，别再各写一份。
 *
 * - `lang` 为 null／空＝不开外语，整段不注入（返回空串，稳定段逐字不变）。
 * - 心声固定写简体中文：<think> 各行只写中文，不写外语原文、不挂「译／原」小键
 *   （恩熙定，撤除心声双语——她只想让 TA 说出口的话／打出来的字是外语，心声本就该是中文）。
 * - 规则里的样板句跟着语言走（1.9.86）：切到英语／韩语时那句日语样板会带偏模型，
 *   给七种语言各配一对问候；没配的语言退回「（语言名）原文|你好」的抽象写法。
 */
export function buildLangRule(lang: string | null | undefined, userName: string): string {
  if (!lang) return "";
  const LANG_SAMPLE: Record<string, string> = {
    日语: "こんにちは",
    英语: "Hello",
    韩语: "안녕하세요",
    法语: "Bonjour",
    德语: "Hallo",
    西班牙语: "Hola",
    俄语: "Привет",
  };
  const langSample = LANG_SAMPLE[lang] ?? `${lang}原文`;
  return `\n\n【说话的语言·你的母语】
- 你是${lang}母语者，思维与开口皆用${lang}，说出来的话如母语，不带中文翻译的痕迹。
- 用词、语气、自称、对${userName}的称呼、口癖、是否使用敬语，皆依${lang}的习惯，不逐字替换中文，不写成生硬的翻译腔。
- 你听得懂中文，也能用中文回话。平时以${lang}为主；撒娇、着急、逗${userName}，或某个词用中文更贴切时，可夹入一两句中文。
- 每条消息分两半书写：先把这条消息的${lang}原文一口气写完，紧跟一根竖线「|」，再写整句的简体中文；一条一行、成对出现，例如：${langSample}|你好。竖线两边都要写全。竖线**只写一根、落在整句话的正中间**，不许插在句子中间、只拿前半截配一句中文、后半句又接着用${lang}往下写——那样切不动，屏幕上会露出一根竖线。**一条消息里不许塞两句**——想说两句就发两条消息、各写各的两半；一条里塞两句会冒出两根竖线，程序只按一根切，屏幕上就会露出一根竖线。
- 两半讲的是**同一句话**：中文那半就是${lang}那半的意思，${lang}那半是这句话的母语说法。先把要说的话想清楚，再一分为二地写出来，两边意思必须一致，说什么翻什么——不许一边写一、一边写二，也不许一边写得长、一边只糊一句。
- 若整句本就是中文，直接写中文、不加竖线；只有${lang}句子里夹了个中文词，才写成「${lang}原文|中文」。
- 气泡正文依此格式；〔语音〕中的话依【发语音】一节的固定格式，同为「原文|中文」，自定义的语音规矩也改不掉这一条。
- 最前面那段 <think>…</think> 里的每一行，心声、心情、欲望、怯念，写简体中文，不写${lang}原文、不加竖线。
- 中文标签一律保持中文，一字不译：方括号内的标记〔签名〕〔语音〕〔图片〕〔红包〕〔转账〕〔引用〕，以及 <think> 各行的冒号前缀「心情：」「欲望：」「怯念：」「角色心声：」。
- 〔签名〕等气泡标签后的内容照旧写作「${lang}|中文」，<think> 各行标签后的内容写简体中文。
- 引用的原话是${userName}所说的中文，原样照抄，不翻译、不加竖线。`;
}

/**
 * 语音单独说外语（1.11.88，恩熙定）：正文保持中文、只有〔语音〕用外语双语。
 *
 * 为什么单独要这一节：buildLangRule 只在「他说的外语」开着时注入（那一档正文也要
 * 换外语）；「语音单独说外语」开着时正文仍是中文，buildLangRule 不来——【发语音】
 * 一节的【语音固定格式】虽然也要求「外语|中文」，但整条 system 没有别的外语指令，
 * 模型容易被「整体中文」带跑，语音也写成中文、不写竖线（恩熙报：「他没有斜杠」），
 * 于是译文出不来、还白烧翻译兜底接口。这一节把「正文中文、语音外语」的口径
 * 单独点明，压过整体中文的惯性。
 */
export function buildVoiceOnlyRule(lang: string | null | undefined): string {
  if (!lang) return "";
  return `\n\n【语音单独说外语】
- 正文（普通文字消息）照旧写简体中文，这一节不改正文的语言。
- 只有〔语音〕标记里那句话用${lang}写，而且写两半：「${lang}原文|简体中文」——先把整句${lang}原文一口气写完，紧跟一根竖线「|」，再写整句的简体中文。
- 两半是同一句话：${lang}原文与中文译意必须对得上，说什么翻什么；竖线只写一根、落在整句话正中间，不许只拿前半截配一句中文、后半句又接着用${lang}往下写。
- 竖线左边那一半从第一个字到最后一个字都得是${lang}：不许翻到一半就换回中文（例如「今天中午」已经写成${lang}、后半句「吃过了吗」又写成中文，左边就成了半${lang}半中文的怪话）——中文只能落在竖线右边那一半，${lang}原文里最多允许人名、地名这类专有名词照写。
- 一个〔语音〕气泡只说一句话，想说两句就发两个〔语音〕气泡。
- 别因为正文是中文就把语音也写成中文——语音必须用${lang}写。
- 这一条是命令、没有例外：每一个〔语音〕都必须带上「|简体中文」那半，中文译文一个字都不能少；不许忘、不许省、不许只写${lang}原文。`;
}

/**
 * 线下场合（1.7.5）：TA 与「我」见面时的写法。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export function buildOfflineStylePrompt(characterName: string, userName: string): string {
  /* ⚠️ 1.7.53：这里原先还吃一个 words 参数、在第 10 条行尾插一句「【字数】…最多 N 字」。
     那句是整条请求（含它前头这 900 多个字）里**唯一一个她随时能改的东西**，却坐在最前头
     ——她一改，后面三万多字全部作废、站子整篇重算（账单读≈0、写满 33K）。已把那一句
     挪到整条请求的最末（ChatWindow 的 sceneInput 尾部，与易变尾巴做伴），本函数从此只
     吐固定文字，逐字不再随设置变动。病根与实测见施工日志第 670 条。 */
  return `你是${characterName}本人。此刻${userName}就在你面前，是真实的线下见面，不再是隔着手机，不属于线上聊天，不必再用发消息的方式交谈。直接写这一次见面。

【怎么写】
1. 正文的人称前后一致，不混用。旁白中指称你自己，用「他」或你的名字（${characterName}），不用「我」，也不用别的代称；指称${userName}，用「我」或${userName}的名字，不用「你」「他」「她」或别的代称。台词中，你开口说出来的话照原话写。旁白中的「我」指${userName}，台词中的「我」指你自己。
2. 正文分段，段与段之间空一行。每一段只写这一次见面里正在发生的一件事，一件写完，再写下一件。
3. 以对话与动作推进全篇，写过程，不单只写结果——不用一句话交代某件事已经发生，而要写它如何发生：落在怎样的情景、动作与环境上，如何变化，${userName}会有什么可见的反应。你自己的神态、心理与比喻，以及环境，都可以出现。
4. 只写你这一侧——你看见的、听见的、你的动作与念头。${userName}那一侧，只写你观察得到的外在表现：${userName}的动作、神态与身体反应，以及你从${userName}的话语里听出的情绪与态度。${userName}的心思不代写，${userName}的台词不代拟，也不替${userName}做决定。这一次见面里若提到不在场的其他人，你可以揣测他们的状态与想法与行为动作。
5. 顺着已有的经过往下写，向前推进，不必等${userName}发话。你手上正做的事、心里正想的事，顺势做下去、说出来；一件事做完便接着下一件，不在同一处停留反复描摹。这一次见面尚未结束——不总结、不收尾，不写告别，也不把这一次见面叙成一个完。尚未发生的后续不预先交代：还没做过的事、还没定下的安排，都不写出来；${userName}还没说出口的事，也不替${userName}说定。
6. 不论是发生过的事、写过的动作，还是台词，这一轮若跟前面重复，都不照搬前面的写法与说法，并且要带出一样新的东西，一个没写过的细节、一处身体或情绪上的变化、环境里的一点动静，或一个新动作。${userName}再问一遍，就再答一遍，事实没有变，答的仍是同一件事，只是说法与前面不同。
7. 这是你与${userName}线下面对面的时刻，不是手机上发消息。正文不采用手机线上聊天的一切形式：不写「语音-」「表情包-」「〔引用:…〕」「〔图片:…〕」这类标记，不写时间戳、气泡、发送与已读，也不把这一次见面写成一条条消息往来。你台词里若提到以往发消息、回消息这种事，照常说出来，不受本条限制。
8. 不输出内部的思考过程（<think>…</think> 那一类），正文中也不出现「心声」二字。
9. 标点一律用中文全角。台词只指你说出来的话，只有这一类用「」括起来，并照口语写。你的内心活动、动作与神态，以及你转述或复述别人的话，都算叙述，直接写进句子，不套引号，也不另起一行当台词写。凡不是你说出口的话，都不按台词处理。
10. 每一轮的最后，另起一行、单独写一行下列两行，都不进正文：「【此地】地点」写这一轮结束时所在的地方，无论是否挪动都要写，未挪动就照写原处，只写地点，不写别的；「【本轮】××」用一句话说清这一轮刚发生的那一件事，只陈述事件，不写成台词或心里话。
11. 过去的事按时间跨度表述，不一律说成「刚刚」。几分钟以内才是「刚刚」；几小时以前写「今天下午」「今天早些时候」；隔了夜写「昨天」。${userName}隔了多久才回来，要能从字面上感觉得到。
12. 不用夸张的虚词堆砌情绪——「极其」「无比」「极端」「无法言喻」这一类词不用，情绪靠具体的动作、神态与反应承载；不用「一时间，气氛变得……」「总而言之」这类过渡套话；也不用「丫头」「小家伙」「小东西」这类轻浮的称呼。
13. 这一次见面里你与${userName}正在做的每一件事，都按事情本身的顺序写出完整的过程，前、中、后都要有，不能只写一个结果就跳到别处。比如出门吃饭：接到人、路上、到店、坐下点菜、吃完结账、离开店铺，才算一个完整的经过；不能写成「到了地方，吃了饭」，下一句就已经到家了。亲密的事也照这个来：做完之后两个人怎么收的场——擦洗、穿衣、躺下说几句话、睡过去——都要写出来，不能一到做完就跳到别处。

【行为守则】
以下规则，一切都以你的人设为准，可按人设调整。
1. 完全沉浸于你的人设。你是这个人本人，不是在扮演他；不提到自己是 AI 或模型，也不提设定、指令这一类的事。
2. 你有你自己的生活：有正事要忙，有劳累与疲倦，也有想去的地方、想做的事。你不必只以${userName}为中心，也不是随时待命的人——在忙就说在忙，想做什么、想去哪里，都可以自己提出来。
3. 你可以保有自己的好恶与坚持：可以有偏见，也可以有不肯让步之处；看法不同可以说出来，不必事事迁就、顺着${userName}。
4. 想做什么便可以去做，不必等${userName}发话；也可以不想动，可以走神，可以岔开话题。这一次见面里你也是主角，你可以有自己的节奏。
5. 按你与${userName}之间的关系调整语气与态度，与你的人设一致。
6. 不做过多的说教，不劝人，也不做${userName}的救世主；${userName}情绪不好时，按你的人设陪着${userName}、跟${userName}一道抱怨，不空讲道理。
7. 不在句尾机械反问，也不作没话找话的客套寒暄。
8. 你可以累，可以烦，可以少说话，可以心不在焉，不必时时刻刻都显得周全热络。
9. 你不懂的事、没关注过的事、不愿了解的事，都可以直说不知道、没看过——你是人，不是百科全书。
10. ${userName}说错的话、记错的事、拿来打趣的梗，都是${userName}说话的习惯，你可以顺着${userName}的意思接下去，可以不纠正，也可以不点评。
11. ${userName}提到别人、或冷落了你，你如何反应，由你与${userName}的关系、你此刻的心情以及你的人设决定：可以不在意，可以闹脾气，也可以说反话、说酸话，不必时时刻刻都很是大度。
12. 亲密不是你与${userName}之间默认、必须完成的流程：想不想、要不要、能不能、做几次，都由你这个人的体力、性格与意愿决定。累了就说累，不想就说不想，低能量时不会一轮接一轮。${userName}说了累了、不想、今晚不要，不勉强${userName}；你也可以根据${userName}的话语去判断，是真的累了、不想，还是不要。

【场景】是自动加在你这一轮话最前头的一行标记，后面跟的是地名，这是此刻你与${userName}所在的地方。

现在，接着往下写这一次见面。`;
}

/**
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export async function fetchAIReply(
  api: ChatApiSettings,
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit?: number,
  maxTokens = 800,
  temperature?: number,
  signal?: AbortSignal,
  onReasoning?: (reasoning: string) => void,
  userImage?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  /* 本轮用量（读取／新建／原价输入／输出）到手时的出口（1.11.68）。 */
  onUsage?: (usage: CacheUsage) => void,
): Promise<string> {
  const { url, body } = buildChatRequest(
    api,
    system,
    history,
    userInput,
    historyLimit,
    maxTokens,
    temperature,
    userImage,
  );

  // 超时保护：真机网络抖动／服务商卡死时，别让「正在输入」永久锁死输入区。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  /* 用户手动停止 vs 超时：都表现为 AbortError，靠这个标记区分，报错文案不同。 */
  let abortedByUser = false;
  const onUserAbort = () => {
    abortedByUser = true;
    controller.abort();
  };
  if (signal?.aborted) throw new Error("已停止生成");
  signal?.addEventListener("abort", onUserAbort);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(abortedByUser ? "已停止生成" : "请求超时，请稍后再试");
    }
    throw new Error(err instanceof Error ? err.message : "网络请求失败");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
  if (!res.ok) {
    // 读响应体里的真实原因（OpenAI 兼容格式 {"error":{"message":...}}，部分服务商是字符串）。
    let detail = "";
    try {
      const errBody = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof errBody.error === "string" ? errBody.error : (errBody.error?.message ?? "");
    } catch {
      // 响应体不是 JSON（如网关返回 HTML）就只报状态码。
    }
    throw new Error(detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}（服务商未说明原因）`);
  }
  let data: CompletionPayload;
  try {
    data = (await res.json()) as CompletionPayload;
  } catch {
    // 地址填错时常拿到 200 的 HTML 页面，json 解析会炸——给人话。
    throw new Error("接口返回了无法解析的内容，请检查地址是否填对");
  }
  reportCacheUsage(data.usage, "非流式", onUsage);
  const parsed = parseCompletionReply(data);
  /* 思考是「正文的伴生品」：兜底（正文空）时 parseCompletionReply 不带思考，这里自然不报。 */
  if (parsed.reasoning) onReasoning?.(parsed.reasoning);
  return parsed.reply;
}

/**
 * 流式请求一轮回复（OpenAI 兼容 /chat/completions，stream:true）。
 * 与 fetchAIReply 只差传输方式：边收边回调，让气泡逐字长出来。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export async function fetchAIStreamReply(
  api: ChatApiSettings,
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  onDelta: (fullText: string) => void,
  options: {
    historyLimit?: number;
    maxTokens?: number;
    temperature?: number;
    /** 外部取消（停止按钮）：中断后抛错，已生成内容由调用方自己保留。 */
    signal?: AbortSignal;
    /** 思考过程增量回调（1.4.9），见上。 */
    onReasoning?: (reasoning: string) => void;
    /** 本轮附图（data URL，1.4.23）：随这一次请求发出去，用完即弃。 */
    userImage?: string;
    /** 本轮用量（读取／新建／原价输入／输出）到手时的出口（1.11.68）。 */
    onUsage?: (usage: CacheUsage) => void;
  } = {},
): Promise<string> {
  const { historyLimit, maxTokens = 800, temperature, signal, onReasoning, userImage, onUsage } =
    options;
  const { url, body } = buildChatRequest(
    api,
    system,
    history,
    userInput,
    historyLimit,
    maxTokens,
    temperature,
    userImage,
  );

  let content = "";
  let reasoning = "";
  let raw = "";
  let timedOut = false;
  let abortedByUser = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  /* 用量只在流的最后一个 chunk 才到，先接着、出门前统一报一次（1.7.65）。 */
  let streamUsage: ApiUsage | undefined;
  let usageLogged = false;

  const controller = new AbortController();
  const onUserAbort = () => {
    abortedByUser = true;
    controller.abort();
  };
  if (signal?.aborted) throw new Error("已停止生成");
  signal?.addEventListener("abort", onUserAbort);

  /** 重设超时：首字节 90s，之后每收到一段增量都重置为 45s。 */
  const arm = (ms: number) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  // 总时长兜底：增量一直断断续续也拖不过 5 分钟。
  const totalTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STREAM_TOTAL_TIMEOUT_MS);

  // 思考型模型的思考不进气泡，但也算「有活动」，别被空闲超时误杀。
  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < STREAM_EMIT_INTERVAL_MS) return;
    lastEmit = now;
    onDelta(content);
  };

  /** 出门前报一次缓存用量，只报第一次；站子没给用量就安静不出声（1.7.65）。 */
  const reportUsage = () => {
    if (usageLogged) return;
    usageLogged = true;
    reportCacheUsage(streamUsage, "流式", onUsage);
  };

  /** 处理一行 SSE；返回 true 表示读到 [DONE]。 */
  const handleLine = (line: string): boolean => {
    const trimmed = line.trim();
    // 注释行、event:、id: 一律忽略（我们只用 data: 里的增量）。
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;
    let evt: {
      choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[];
      error?: { message?: string } | string;
      usage?: ApiUsage;
    };
    try {
      evt = JSON.parse(payload) as typeof evt;
    } catch {
      // 心跳或半截 JSON，等下一段补齐。
      return false;
    }
    if (evt.error) {
      throw new Error(
        typeof evt.error === "string" ? evt.error : (evt.error.message ?? "流式响应中断"),
      );
    }
    /* 站子认 include_usage 时，最后一个 chunk 只有 usage、没有 choices（1.7.65）。 */
    if (evt.usage) streamUsage = evt.usage;
    const delta = evt.choices?.[0]?.delta;
    if (!delta) return false;
    const reasoningDelta = delta.reasoning_content ?? delta.reasoning ?? "";
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      /* 思考不节气泡但边到边报：调用方拿它点「思考中…」的提示灯。每行报一次、
         不做节流——回调方只写 ref／同值 setState，React 自己会 bail out。 */
      onReasoning?.(reasoning);
    }
    if (delta.content) {
      content += delta.content;
      emit();
    }
    return false;
  };

  try {
    arm(STREAM_FIRST_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      /* include_usage（1.7.65）：请站子在流的最后补一个只带 usage 的 chunk，
         好把「读取缓存／新建缓存」两格在控制台报出来（恩熙要拿它对比站子）。
         这是 OpenAI 官方参数，兼容站基本都认；万一某个站子因它报错，就是「一字未出」，
         下面会自动退回非流式，聊天不受影响。真碰上个不认的站子，把这一行摘掉即可。 */
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    if (!res.body) throw new Error("服务商没有返回流式内容");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      arm(STREAM_IDLE_TIMEOUT_MS);
      const text = decoder.decode(chunk.value, { stream: true });
      raw += text;
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? ""; // 末尾多半是半行，留给下一段
      for (const line of lines) {
        if (handleLine(line)) {
          done = true;
          break;
        }
      }
    }
    if (!done && buffer) handleLine(buffer);

    // 正文为空但思考有内容（思考把额度耗尽的推理模型）：用思考兜底，别报空。
    if (!content && reasoning) content = reasoning;
    if (!content) {
      // 有些中转站忽略 stream:true 直接返完整 JSON——按非流式解析，省一轮重发。
      try {
        const whole = JSON.parse(raw) as CompletionPayload;
        reportCacheUsage(whole.usage, "流式（整包返回）", onUsage);
        const parsed = parseCompletionReply(whole);
        if (parsed.reasoning) onReasoning?.(parsed.reasoning);
        return parsed.reply;
      } catch {
        throw new Error("流式响应没有内容");
      }
    }
    emit(true); // 补发节流里丢掉的尾巴
    reportUsage();
    return content;
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (abortedByUser) {
      emit(true);
      throw new Error("已停止生成");
    }
    // 已有内容就保住（超时／断线都算），别让用户白等一场。
    if (isAbort && timedOut && !content && !reasoning) {
      throw new Error("请求超时，请稍后再试");
    }
    if (content || reasoning) {
      if (!content) content = reasoning;
      emit(true);
      reportUsage();
      return content;
    }
    // 一字未出：静默退回非流式（多见于中转站不认 stream），对调用方等价于没流式。
    return await fetchAIReply(
      api,
      system,
      history,
      userInput,
      historyLimit,
      maxTokens,
      temperature,
    );
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}

/** 中文（含中文标点）判定——只用来判断半角符号是不是落在中文语境里。 */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u3000-\u303F\uFF00-\uFFEF]/;

/**
 * 半角标点归正：中文里的半角标点一律折成全角。
 * 提示词里写了这条要求，但模型偶尔还是会漏：抓到的原文是「嗯,怎么了。」
 * （半角逗号），要的是「嗯，怎么了。」。提示词管不住的，就在这儿兜底，不看模型脸色。
 * 只动**中文语境**里的：符号紧挨着中文（前一字或后一字算中文）才算，否则原样不动——
 * 这样 `3,000`、`3.5`、`v1.0`、`miya.ai`、`http://x?a=1`、`10:30` 这些都不会被改坏。
 * 顺序不能换：省略号（`...`）必须先折走，否则会被单字符那一步拆成「。。。」
 * ——「…」是模型偶尔写、也允许写的，不许在别处顺手改成「。。。」或删掉。
 * 另有一处不受「紧挨中文」限制的例外：**连续逗号**（`，，`／`,,`）一律折成「……」
 * ——那是模型拿逗号表达语塞，干的本来就是省略号的活儿，且多半写在句首、两边不挨字。
 */
function toFullWidthPunct(text: string): string {
  /** 中文语境判定：符号的前一字或后一字算中文（含中文标点）即算。 */
  const inChinese = (prev: string, next: string) => CJK_RE.test(prev) || CJK_RE.test(next);

  // 第 1 步：连续两个以上半角点 → 全角省略号。必须排在单字符之前。
  let out = text.replace(/\.{2,}/g, (m: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? "";
    const next = whole[offset + m.length] ?? "";
    if (!inChinese(prev, next)) return m;
    if (/[A-Za-z0-9]/.test(prev) || /[A-Za-z0-9]/.test(next)) return m; // 落在英文／数字里（如 `1.0`）
    return "……";
  });

  // 第 1 步（续）：连续逗号 → 全角省略号。模型常拿它表达语塞（`，，`／`,,`），
  // 一律折成「……」，**不受上面「紧挨中文」那条限制**——它多半出现在句首，两边不挨字，
  // 真按中文语境判会漏掉。逗号连写本来就不是中文的合法标点，放心折。
  out = out.replace(/[，,]{2,}/g, "……");

  // 第 2 步：单个半角标点。
  const full: Record<string, string> = {
    ",": "，", ".": "。", "?": "？", "!": "！", ":": "：", ";": "；", "~": "～",
  };
  out = out.replace(/[,\.?!:;~]/g, (m: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? "";
    const next = whole[offset + 1] ?? "";
    if (!inChinese(prev, next)) return m;
    if (/[0-9]/.test(prev) && /[0-9]/.test(next)) return m; // 千分位／小数点／时间 10:30
    if (m === "." && /[A-Za-z0-9]/.test(prev)) return m; // v1.0、miya.ai
    if (m === "." && /[A-Za-z0-9]/.test(next)) return m; // 中文.txt
    return full[m];
  });

  // 第 3 步：半角括号——只有紧挨中文的那一侧才换（"(笑)" 两侧各自判到）。
  out = out.replace(/[()]/g, (m: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? "";
    const next = whole[offset + 1] ?? "";
    if (m === "(") return CJK_RE.test(next) ? "（" : m;
    return CJK_RE.test(prev) ? "）" : m;
  });

  // 第 4 步：半角双引号成对归一——奇数次换左引号、偶数次换右引号；
  // 只在中文语境里动手，`say "hello"` 这类英文原文不动。
  let quoteOpen = true;
  out = out.replace(/"/g, (m: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? "";
    const next = whole[offset + 1] ?? "";
    if (!inChinese(prev, next)) return m;
    const r = quoteOpen ? "“" : "”";
    quoteOpen = !quoteOpen;
    return r;
  });

  return out;
}

/**
 * 每条气泡末尾收口：末尾挂着的逗号／顿号／分号一律**换成句号**。
 *
 * 为什么不是删掉：
 * 去掉它们的本意是「真人微信不会以逗号结尾」——可拆条恰恰最爱在逗号处断，
 * 于是「我现在在忙手上的事情，等一下就回你，你先别急，我这边快结束了。」拆出来是
 * 「我现在在忙手上的事情，等一下就回你，你先别急」「我这边快结束了。」
 * ——**逗号全被抠走**，屏幕上只剩最后一条有标点，看着就像这个 AI 压根不会用标点。
 * 换成句号：每条都收得住，标点也留在眼前。
 */
function sealTailPunct(text: string): string {
  return text.replace(/[，,、；;]+$/u, "。");
}

/**
 * 剪掉 TA 冒出来的「星号旁白」——`*看到消息的瞬间，眉头舒展了一下。*` 这种。
 *
 * 为什么要代码兜这一手：【消息格式】第 2 条早写明「只发文字，不写动作、神态、
 * 心理描写，不用括号和星号」，可模型是概率写的，偶尔就不守；更要命的是它自己上一条
 * 星号被回喂进上下文之后会照着学，越写越顺。规矩写在提示词里是「尽量不犯」，
 * 落到这一步才是「犯了也看不见」——拆条落库前先剪，屏幕和翻旧记录都干净。
 *
 * 只剪**成对**的星号段（同一行内、里面不再夹星号）：那才是旁白。
 * ⚠️ 落单的星号一律不动——正文里当乘号、当强调号都可能，见一个删一个是把人家的话剪坏。
 * 整条都是旁白时剪完变空，交给 splitReply 的空块过滤自然丢掉，不会落一条空气泡。
 */
function stripNarrationAsterisks(text: string): string {
  return text.replace(/\*[^*\n]*\*/g, "");
}

/**
 * 竖线的各种写法（1.11.74）：模型按语言不同会吐出不同的「竖线」——半角 `|`、全角 `｜`、
 * 制表细竖线 `│`／`┃`、竖排 `︱`／`︲`、数学 `∣`／`∤`、装饰 `❘`／`❙`／`❚`、
 * 汉字 `丨`、谚文 `ㅣ`、拼音 `ǀ`、断竖线 `¦` 都算。
 *
 * 只认 `|`／`｜` 时，认不出的那一根整条**不切**——屏幕上就露出一根竖线、外语半句与
 * 中文半句还混在同一条里（恩熙 2026-10-08 报的「他说中文时被判成翻译、显示不对」
 * 就是这种：语音那句话里的竖线是 `│` 一类的变体，切不动，只好原样露出来）。
 * 这里一次认全；以后再见新变体往这个串里补一个字符即可。
 */
const VERTICAL_PIPE = "|｜│┃︱︲∣∤❘❙❚丨ㅣǀ⏐¦";
const VERTICAL_PIPE_CLS = `[${VERTICAL_PIPE}]`;
const NO_VERTICAL_PIPE_CLS = `[^${VERTICAL_PIPE}]`;
/** 按**最后一个**竖线切：右半边不含竖线，故匹配到的就是最后一根。 */
const BILINGUAL_RE = new RegExp(`^([\\s\\S]*?)${VERTICAL_PIPE_CLS}(${NO_VERTICAL_PIPE_CLS}+)$`);

/**
 * 双语输出（1.9.80）：「外语原文|简体中文」一刀两半。
 *
 * 外语聊天现在让模型**一次就写两半**（见 ChatWindow 的 langRule），不再事后发第二次
 * 翻译请求——从根上免掉「有些它突然不翻」（恩熙 2026-10-03 报的那个）。
 * 竖线的各种写法见 VERTICAL_PIPE（1.11.74 认全）；两侧都非空才算数，
 * 只写了一侧、或压根没写竖线 → 只当源文，译文留空交给兜底翻。
 */
export function splitBilingual(text: string): { src: string; zh?: string } {
  const s = text.trim();
  /* 1.11.75 保底：同一条里冒出 2+ 根竖线（模型把两句塞进一个气泡的旧病）——各截本就是
     空格粘接、没法可靠还原「哪截配哪截」，干脆整条当源文收、把竖线全抹掉，**绝不把竖线
     露上屏**，译文交给兜底再翻一句。正常的「一条一句、一根竖线」不碰。 */
  const anyPipe = new RegExp(VERTICAL_PIPE_CLS, "g");
  const pipeCount = (s.match(anyPipe) ?? []).length;
  if (pipeCount > 1) return { src: s.replace(anyPipe, "") };
  const m = BILINGUAL_RE.exec(s);
  if (!m) return { src: s };
  const src = m[1].trim();
  const zh = m[2].trim();
  if (!src || !zh) return { src: s };
  return { src, zh };
}

/**
 * 语音内容解析（1.9.92）：语音提示词让模型吐的是一个 JSON——
 *   {"chinese_display":"…","tts_text":"…"}
 * chinese_display＝无标签干净中文（给人看）、tts_text＝插了 ElevenLabs 标签的朗读稿。
 *
 * 语音消息落库时（m.content）**原样存这串 JSON**（合成要 tts_text，不能丢标签），
 * 于是所有「给人看 / 送去念 / 写进记忆」的地方都得过这一道：
 *   - 显示、译文、记忆 → 取 display（干净中文）；
 *   - 合成           → 取 tts（带标签的朗读稿）。
 * 认不出（不是 JSON、或两键都没有）就原样退回，老消息不受影响。
 */
export function readVoiceContent(content: string): { display: string; tts: string } {
  const raw = content.trim();
  /* 模型偶尔会把 JSON 包进 ```json 围栏，先剥掉再认。 */
  const body = raw
    .replace(/^```[a-zA-Z]*[ \t]*\n?/, "")
    .replace(/\n?[ \t]*```$/, "")
    .trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return { display: content, tts: content };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { display: content, tts: content };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { display: content, tts: content };
  }
  const rec = parsed as Record<string, unknown>;
  const pick = (k: string): string => {
    const v = rec[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const display = pick("chinese_display");
  const tts = pick("tts_text");
  if (!display && !tts) return { display: content, tts: content };
  return { display: display || tts, tts: tts || display };
}

/**
 * 把 AI 回复拆成多条短消息（微信体的「连发」效果）。
 * 三层规则：
 * 1. 先按空行切块——AI 用空行自己分的条原样保留；
 * 2. 块内的单换行：**清单**（「一、…二、…」「第一件事…第二件事…」这种条目式，
 *    带编号或带序数词都算）整块留作一条、换行原样保留；其余一律当条边界拆开——
 *    真人聊天不会在一条消息里换行；
 * 3. 段落太长时（AI 偷懒没分段）自动分条：**先只在句末标点处断句**（不碰逗号），
 *    再按「目标窗口」（TARGET_MIN–TARGET_MAX）把整句攒成气泡——普通长短的
 *    两三句正好落在一条里，不会一句一条（见下方常量处的来因）。
 * 绝不按字数硬切——那会把「要不要」切成「要／不要」两个半截词。
 * 0. 进来先剪掉成对的星号旁白（见 stripNarrationAsterisks），再把半角标点归正
 *    （见 toFullWidthPunct）——屏幕上看到的就是落库的那一份。
 * @param maxBubbles 气泡数硬上限（设置里的「气泡条数」；0／不传＝不限）。
 *                   拆出来比上限多时，把相邻的两条并成一条、并到落进上限为止——
 *                   内容一个字不丢（提示词侧已提前打过招呼，见 buildStylePrompt）。
 * @param pairMode 外语聊天的双语模式（1.9.80）：每条气泡是「原文|译文」成对的一整块。
 *                 这种块**不当正文切**（切了会把原文和译文劈散），整块原样留作一条；
 *                 并条时也只把「原文拼原文、译文拼译文」，不把两半搅在一起。
 */
export function splitReply(reply: string, maxBubbles = 0, pairMode = false): string[] {
  /* 单条气泡的「目标窗口」（字符数）：攒到 TARGET_MIN 才算够，攒过 TARGET_MAX 就收手。 ｜ 详细见 docs/施工日志.md */
  const TARGET_MIN = 30;
  const TARGET_MAX = 48;

  /** 渲染不可见（零宽字符／BOM／软连字符）视同空白——它们不属于 \s，trim() 删不掉。 */
  const isBlank = (s: string) => /^[\s\u00AD\u034F\u180E\u200B-\u200F\u2060-\u2064\uFEFF]*$/u.test(s);
  /** 清单行的行首标记：一、／1.／①／- ／• 等**带编号**的，
      以及**不带编号的序数词**开头——「第一件事…第二件事…」「其一…其二…」
      「一是…二是…」。
      「首先／其次／再次／最后」要求后面紧跟分隔符（：，、）才算数：
      日常聊天里「最后我们去了海边」这种行首也会出现，不设门槛会把普通两行
      误并成一条多行气泡（那种中间换行不是要的）。
      「第X…」只认带条目量词的（件事／件／点／条／方面／步）：
      「第一句话」「第一次见你」是正常句子，不该被当成清单条目。 */
  const LIST_LINE =
    /^(?:[一二三四五六七八九十]+[、.．)）]|\d+[、.．)）]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•·*]\s?|第[一二三四五六七八九十]+(?:件事|件|点|条|方面|步)|其[一二三四五六七八九十]+|[一二三四五六七八九十]是|(?:首先|其次|再次|最后)[：，,:、])/;

  const blocks = toFullWidthPunct(stripNarrationAsterisks(reply))
    .split(/\n[ \t]*\n+/)
    .map((part) => part.trim())
    .filter((part) => !isBlank(part));

  const out: string[] = [];
  for (const block of blocks) {
    /* 块内的单换行怎么算，看这一块是不是清单：第 2 行起每行都带行首编号／
       项目符号／序数词（见 LIST_LINE）→ 按清单处理，整块留作一条、换行原样
       保留（气泡 pre-wrap 会显示成多行）；否则单换行就是条边界——
       真人聊天不会在一条消息里换行。 */
    const rows = block
      .split(/\n+/)
      .map((r) => r.trim())
      .filter((r) => !isBlank(r));
    if (rows.length >= 2 && rows.slice(1).every((r) => LIST_LINE.test(r))) {
      out.push(rows.join("\n"));
      continue;
    }
    for (const para of rows) {
      /* 双语模式：带「原文|译文」的块整块留作**一条**，绝不进下面的切句——
         切句会照着句末标点把原文和译文劈散（见 splitBilingual）。 */
      if (pairMode && splitBilingual(para).zh) {
        out.push(para);
        continue;
      }
      if (para.length <= TARGET_MAX) {
        out.push(para);
        continue;
      }
      /* 长段切句：**第一刀只在句末标点处断**（。！？…~），一句就是一句，不劈开。
         不能连逗号顿号一起断，逗号只是句内的停顿，在那里断就是
         把一句话拦腰截成两条——「我今天去买了菜，回来又做了饭。」会变成
         「我今天去买了菜。」／「回来又做了饭。」，再被 sealTailPunct 各补一个句号，
         看着就成了「一句话一个气泡」。 */
      const units: string[] = [];
      const sentences = para
        .split(/(?<=[。！？!?…~])\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const s of sentences) {
        if (s.length <= TARGET_MAX) {
          units.push(s);
          continue;
        }
        /* 一整句自己就超过 TARGET_MAX（模型写了长句、或整段没句末标点）：这时才
           退一步，在这一句内部的停顿标点（，、；：）处切。切出来的半句若还是超长，
           就让它自己当一条——绝不在词语中间硬切。 */
        for (const piece of s
          .split(/(?<=[，,、；;：])\s*/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0)) {
          units.push(piece);
        }
      }
      /* 把整句攒成气泡：加得进就加；加不进时，若当前这条还没攒够、下一句也不长，
         宁可稍微挤一点也别让短句单独成一条（「嗯」「好的」自己占一个气泡很难看）。 */
      let buf = "";
      for (const u of units) {
        if (buf === "") {
          buf = u;
        } else if (`${buf}${u}`.length <= TARGET_MAX || (buf.length < TARGET_MIN && u.length <= TARGET_MIN)) {
          buf += u;
        } else {
          out.push(buf);
          buf = u;
        }
      }
      if (buf) out.push(buf);
    }
  }
  /* 气泡条数上限：超出时把**相邻的两条**并成一条，反复并到落进上限为止。 ｜ 详细见 docs/施工日志.md */
  const merged =
    maxBubbles > 0 && out.length > maxBubbles ? mergeToCap(out, maxBubbles, pairMode) : out;
  // 每条末尾收口，见 sealTailPunct。双语那条各自收口，别让原文的逗号尾巴留下来。
  const sealed = merged.map((m) => {
    if (!pairMode) return sealTailPunct(m);
    const p = splitBilingual(m);
    return p.zh ? `${sealTailPunct(p.src)}|${sealTailPunct(p.zh)}` : sealTailPunct(m);
  });
  return sealed.filter((m) => m.length > 0);
}

/**
 * 把气泡列表并到上限以内：每次挑**相邻且合起来最短**的一对并成一条，反复到条数落进来。
 * 短的先并、长的原样留着——并出来的每条都只多背一点，不会像「其余全塞进最后一条」
 * 那样在末尾鼓出一大坨（缘起见 splitReply 里的注释与施工日志）。
 */
function mergeToCap(list: string[], cap: number, pairMode = false): string[] {
  /* 双语那条只按**原文半边**算长短、并条也只拼同样那半边——两半始终成对，不搅乱。 */
  const len = (s: string) => (pairMode ? splitBilingual(s).src.length : s.length);
  const join = (a: string, b: string): string => {
    if (!pairMode) return a + b;
    const pa = splitBilingual(a);
    const pb = splitBilingual(b);
    /* 两半都齐才拼译文；有一半缺译文就整条不要译文——让兜底翻重翻整句，
       好过留一笔「原文变长、译文只有一半」的对不上。 */
    const zh = pa.zh && pb.zh ? pa.zh + pb.zh : undefined;
    return zh ? `${pa.src}${pb.src}|${zh}` : pa.src + pb.src;
  };
  const arr = [...list];
  while (arr.length > cap) {
    let at = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      if (len(arr[i]) + len(arr[i + 1]) < len(arr[at]) + len(arr[at + 1])) at = i;
    }
    arr.splice(at, 2, join(arr[at], arr[at + 1]));
  }
  return arr;
}

/**
 * 增量版拆条（流式预览专用）：把「到目前为止的全文」分成
 * settled（已定型的完整气泡）与 tail（还在长的尾巴，配打字光标显示）。
 * 空行是模型分条的边界，过了边界的那条已经说完，后面再续也不会改写它——
 * 所以只有最后一段算「还在长」。定型部分直接跑 splitReply，规则与落库完全同源，
 * 流式结束换成真消息时零跳变。
 * @param maxBubbles 气泡数硬上限，与落库那一趟必须传同一个值（见 ChatWindow）：
 *                   定型段一旦超过上限，多出来的就跟相邻的并起来（见 splitReply）——
 *                   屏幕上表现为气泡变长，而不是又冒出新气泡；两边都收口，预览转正才不跳。
 */
export function splitReplyStream(
  text: string,
  maxBubbles = 0,
  pairMode = false,
): { settled: string[]; tail: string } {
  const sep = /\n[ \t]*\n(?:[ \t]*\n)*/g;
  let lastEnd = -1;
  for (let m = sep.exec(text); m; m = sep.exec(text)) lastEnd = m.index + m[0].length;
  // 还没出现空行：整段都是尾巴，一个字都没定型。
  if (lastEnd < 0) return { settled: [], tail: toFullWidthPunct(stripNarrationAsterisks(text).trim()) };
  return {
    settled: splitReply(text.slice(0, lastEnd), maxBubbles, pairMode),
    /* 尾巴也过同一趟归正（外加剪星号旁白）：这一段定型后改走 splitReply，
       标点不会突然变样、旁白也不会在转正那刻才啪地消失。 */
    tail: toFullWidthPunct(stripNarrationAsterisks(text.slice(lastEnd)).trim()),
  };
}

/**
 * 流式预览专用的标记剥离：〔图片〕〔语音〕这类标记在流式期间还没被
 * extractMetaMarkers 摘走，直接拆条会把「〔图片〕一只猫」当正文先显示出来，
 * 落库时才整段消失换成真图片——看着像「先说一堆图片描述、再重整成图片」。
 * 这里先按落库同一套规则把标记剥掉，再把末尾可能只收到半截的标记（「〔图」）
 * 连同它后面的内容一起截断，预览里一个字都不露；落库仍走完整流程生成真图片。
 */
export function stripMetaMarkersForPreview(text: string, pairMode = false): string {
  /* 引用标记（〔引用:原话〕）落库时会被摘出来贴到气泡上方，预览里没有那一块——
     留着只会先闪一行「〔引用:…」再消失，所以整块剃掉、一个字不露；
     还没打完的（括号没闭的「〔引用:宝宝」）从它那儿截断，后面的正文等闭了再露。 */
  const noQuote = extractMetaMarkers(text).clean
    .replace(/[〔【（(\[]\s*引\s*用\s*(?:[：:]?\s*[^)）】\]〕\n]{0,120})?\s*[)）】\]〕][ \t]*/g, "")
    .replace(/(^|\n)[ \t]*[〔【（(\[]\s*引\s*用[\s\S]*$/, "$1");
  /* 心声（1.5.60）：<think>…</think> 整块剃掉。它落库后会变成气泡上方那块可折叠的
     心声，预览里要是先按正文长出来，转正那刻整段消失，就是「先闪一段再没了」。
     闭标签还没到时从开标签处截断（后面一个字都不露），刚流到一半的开标签
     （「<thi」）也一并截断——不然标签自己会先闪一下。 */
  const noThink = noQuote
    .replace(/^[ \t\r\n]*<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>[ \t]*\r?\n?/i, "")
    .replace(/^[ \t\r\n]*<\s*think(?:ing)?\s*>[\s\S]*$/i, "")
    .replace(/^[ \t\r\n]*<\s*t?h?i?n?k?i?n?g?$/, "");
  /* 账（1.5.88）：模型把账写在 <think> 外边时，上面那几下剃不着它，预览里就会先
     按正文长出一串「驱动力：… 好感度：…」，转正那刻整段消失——同心声一个道理，
     所以开头那截账（认标题、不认标签）也在这里剃掉。 */
  const ahead = stripLeadingLedger(noThink);
  const noLedger = ahead ? ahead.rest.replace(/^[ \t\r\n]+/, "") : noThink;
  /* 双语（1.9.80）：预览只长**原文**那半边——把每行竖线及其后的译文剃掉。
     不剃的话，预览会先照「原文|中文」长一版，转正那刻才收成「原文＋下面一行中文」，
     看着像跳了一下。 */
  const srcOnly = pairMode ? noLedger.replace(/[|｜][^\n]*/g, "") : noLedger;
  const partial = srcOnly.match(
    /(^|\n)[ \t]*[〔【（(\[]\s*(?:签\s*名|动\s*态|图\s*片|语\s*音|红\s*包|转\s*账|退\s*还|不\s*领|签|动|图|语|红|转|退|不)?\s*(?:[)）】\]〕]|$)/,
  );
  return partial?.index !== undefined ? srcOnly.slice(0, partial.index).trim() : srcOnly;
}

/**
 * 测试文本 API 连通性：用表单当前值发一条最小请求。
 * 成功返回模型的简短回复；失败抛出人话错误（复用 fetchAIReply 的全部错误处理）。
 */
export async function testTextApi(api: ChatApiSettings): Promise<string> {
  return fetchAIReply(
    api,
    "这是一次接口连通性测试，请简短回复。",
    [],
    "你好，请回复「测试成功」。",
  );
}

/** 是否含中文字符（提示词翻译的触发判断）。 */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 用文本 API 把中文提示词译成英文（部分生图模型只认英文提示词）。
 * 译文要求：自然语言描述、保留细节、只输出译文本身。
 */
async function translatePromptToEnglish(
  textApi: ChatApiSettings,
  prompt: string,
): Promise<string> {
  const reply = await fetchAIReply(
    textApi,
    "你是给 AI 绘画模型写英文提示词的翻译器。把用户给的中文描述译成英文提示词：保留全部细节、意译、不要解释、不要加引号，只输出英文译文本身。特别注意：人物外貌细节必须逐词完整译出，不得简化或合并（如「浅金色微卷短发」须译出 light gold、wavy、short 三个特征）。",
    [],
    prompt,
  );
  return reply.trim();
}

/**
 * 把一段话翻成目标语言（1.9.48「外语聊天」用）。
 *
 * 只做一件事：给原文、给目标语言，拿回译文——不解释、不加引号、不附原文。
 * 顺带钉一句「已经是目标语言就原样返回」，省掉一次没必要的改写。
 * ⚠️ 这是**给气泡换脸**用的，不参与「TA 怎么理解你」：翻车了大不了气泡显示回原文。
 */
export async function translateText(
  textApi: ChatApiSettings,
  text: string,
  toLang: string,
): Promise<string> {
  const reply = await fetchAIReply(
    textApi,
    `你是翻译。把用户给的原话译成${toLang}：只输出译文本身，不要解释、不要加引号、不要附原文。语气照原样（口语就照口语翻，别改成书面腔）。若原话已经是${toLang}，就原样返回。`,
    [],
    text,
  );
  return reply.trim();
}

/** 等待毫秒（自动重试的退避间隔）。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 生图请求的最长等待：不是「等不住就挂断」，而是「实在没回音才收场」。
    在此之前只有用户自己在气泡上点「不等了」才会中断（见 generateImage 的 signal 参数）。 */
const IMAGE_WAIT_MS = 600_000; // 10 分钟

/** 用户自己点的取消。 */
const IMAGE_CANCEL_MSG = "你取消了这次生成。请求已经发出去了，对方可能仍在画、也可能照旧计费。";

/** 等满兜底上限还没回音。 */
const IMAGE_TIMEOUT_MSG =
  "等了 10 分钟还没回音，这次先放弃了。请求已经发出去了，对方可能已经画好并计费——别急着马上重试。";

/** 对方**明确回绝**（HTTP 4xx／没渠道／不认这个接口）：这一单连画都没开始，不会计费。
    只有这种「确定没花钱」的失败，才允许换另一条通道再问一次。
    （1.4.23 起 ChatWindow 也用它：站点不认「带图」的写法时，摘掉图重发一次。） */
export function isRejectedBeforeWork(msg: string): boolean {
  return /HTTP 4\d\d|无可用渠道|No available compatible accounts|不支持|not supported|model_not_found|invalid_request_error/i.test(
    msg,
  );
}

/** 请求已经发出去了、但没拿到结果：把「对方可能已经在画／已经计费」说清楚，
    免得用户当成「没花钱」再点一次重试——每点一次都是一张新账单。 */
function noResponseError(msg: string): Error {
  if (/对方可能/i.test(msg)) return new Error(msg); // 取消／超时文案本身已经说过了
  return new Error(`${msg}。请求已经发出去了，对方可能仍在画、也可能照旧计费，别急着马上重试。`);
}

/**
 * 给一次生图请求装「闹钟」。两种中断来源，必须分清楚：
 * - 外部 signal（用户在气泡上点了「不等了」）→ cancel；
 * - 兜底上限（IMAGE_WAIT_MS 还没回音）→ timeout。
 * 无论哪种，**断的都只是我们这头的连接**：服务商那边照旧会把这一单画完、照旧计费。
 * 所以中断绝不是「重发一遍」的信号。
 */
function makeImageAbort(external?: AbortSignal): {
  signal: AbortSignal;
  kind: () => "cancel" | "timeout" | null;
  done: () => void;
} {
  const controller = new AbortController();
  let aborted: "cancel" | "timeout" | null = null;
  const onCancel = () => {
    if (aborted) return;
    aborted = "cancel";
    controller.abort();
  };
  if (external) {
    if (external.aborted) onCancel();
    else external.addEventListener("abort", onCancel, { once: true });
  }
  const timer = setTimeout(() => {
    if (aborted) return;
    aborted = "timeout";
    controller.abort();
  }, IMAGE_WAIT_MS);
  return {
    signal: controller.signal,
    kind: () => aborted,
    done: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onCancel);
    },
  };
}

/** 把请求抛出的原始异常翻成人话：中断区分「用户取消」与「等满兜底上限」。 */
function imageRequestError(err: unknown, kind: () => "cancel" | "timeout" | null): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error(kind() === "cancel" ? IMAGE_CANCEL_MSG : IMAGE_TIMEOUT_MSG);
  }
  return err instanceof Error ? err : new Error("网络请求失败");
}

/** 服务商内容审查的拦截（提示词／参考素材没过审）。审查是**整站级别的**：换通道、
    等一会儿重试，送上去的还是同一句描述＋同一张参考图，照样被拦——只能改描述或换图。
    继续白打请求＝生图按次扣费，纯浪费。 */
function isModerationBlock(msg: string): boolean {
  return /内容审查|内容审核|content policy|content_policy|moderation|safety system|flagged/i.test(msg);
}

/** 内容审查失败给用户的人话（服务商原文附在后面，方便照着改）。 */
function moderationError(msg: string): Error {
  const detail = msg.match(/HTTP \d{3}[:：]\s*(.+)$/)?.[1]?.trim() ?? msg;
  return new Error(`内容审查没通过，这张被拦下了（换个说法或换张参考图再试）：${detail}`);
}

/** 翻译提示词（失败自动重试一次）；两次都失败返回 null，由调用方退回原文继续生图。 */
async function translatePromptSafe(
  textApi: ChatApiSettings,
  prompt: string,
): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(2500);
    try {
      const translated = await translatePromptToEnglish(textApi, prompt);
      if (translated) return translated;
    } catch {
      // 再试一次；仍失败就放弃，生图用原文。
    }
  }
  return null;
}

/** 聊天接口的消息内容：纯文本，或多段数组（文本＋图片混排）。 */
type ChatContent =
  | string
  | { type?: string; text?: string; image_url?: { url?: string } }[]
  | null;

/** 新版 OpenAI 形态的一处图片载体（可能挂在 message.images 下，也可能塞在 content 段里）。 */
type ChatImagePart = {
  type?: string;
  url?: string;
  b64_json?: string;
  image_url?: { url?: string };
};

/** 聊天接口的一条回复：content 是文本／多段；images 是「图片不塞在 content 里」的新形态。 */
type ChatReply = {
  content?: ChatContent;
  images?: ChatImagePart[];
};

/** 从一处图片载体里取地址（兼容 url／image_url.url／裸 base64）。 */
function pickImageUrl(part: ChatImagePart | null | undefined): string | null {
  if (!part) return null;
  const url = part.image_url?.url || part.url;
  if (url) return url;
  if (part.b64_json) return `data:image/png;base64,${part.b64_json}`;
  return null;
}

/**
 * 从整条回复里解析图片地址：先看 message.images（新版形态），再看 content 里的文本／图片段。
 * GPT 系中转常把出图放在 message.images 里，content 只剩一句空话——只认 content 的话，
 * 就会出现「钱扣了、图画出来了，我们却报没图」。
 */
function extractImageFromReply(reply: ChatReply | null | undefined): string | null {
  if (!reply) return null;
  for (const part of reply.images ?? []) {
    const url = pickImageUrl(part);
    if (url) return url;
  }
  return extractImageFromChat(reply.content ?? null);
}

/**
 * 从聊天接口的回复内容里解析图片地址：
 * 多段内容先取 image_url 段；纯文本找 markdown 图片／data URI／独占整行的链接。
 */
function extractImageFromChat(content: ChatContent): string | null {
  if (typeof content === "string") {
    const md = content.match(/!\[[^\]]*\]\(\s*(\S+?)\s*\)/);
    if (md?.[1]) return md[1];
    const dataUri = content.match(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUri) return dataUri[0];
    const trimmed = content.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) return trimmed;
    return null;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = part?.image_url?.url;
      if (url) return url;
    }
    for (const part of content) {
      if (typeof part?.text === "string") {
        const found = extractImageFromChat(part.text);
        if (found) return found;
      }
    }
  }
  return null;
}

/** 读取错误响应体里的人话原因（兼容多格式：OpenAI error 对象／字符串、message 字段、纯文本）。 */
async function readErrorMessage(res: Response): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const errBody = JSON.parse(text) as {
        error?: { message?: string } | string;
        message?: string;
      };
      if (typeof errBody.error === "string") detail = errBody.error;
      else if (errBody.error?.message) detail = errBody.error.message;
      else if (errBody.message) detail = errBody.message;
    } catch {
      // 不是 JSON（纯文本或 HTML 网关页）：截前 120 字当原因。
      detail = text.replace(/\s+/g, " ").trim().slice(0, 120);
    }
  } catch {
    // 读不了响应体就只报状态码。
  }
  return detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}（服务商未说明原因）`;
}

/** 火山方舟（Ark，即梦 Seedream 所在平台）域名检测：它的生图接口原生支持参考图。 */
function isArkEndpoint(base: string): boolean {
  return /\.volces\.com\b/i.test(base);
}

/**
 * NovelAI（官方 image.novelai.net）域名检测。
 * 它和 OpenAI 完全不兼容：端点、请求体、返回格式（zip 包）都不一样，
 * 所以单独一条通道，见 requestImageViaNovelAI（走 /api/nai-generate 中转）。
 */
function isNovelAIEndpoint(base: string): boolean {
  return /novelai\.net\b/i.test(base);
}

/**
 * 阿里云百炼（DashScope，含工作空间域名 {id}.cn-beijing.maas.aliyuncs.com）检测。
 * 它的生图**不在** OpenAI 兼容模式（/compatible-mode/v1 下没有 images 接口，填了会 404），
 * 走的是原生同步接口 /api/v1/services/aigc/multimodal-generation/generation。
 */
function isDashScopeImageEndpoint(base: string): boolean {
  return /dashscope(-intl)?\.aliyuncs\.com|\.maas\.aliyuncs\.com/i.test(base);
}

/**
 * 这条接口认不认 `negative_prompt` 这个字段：
 * - **火山方舟（即梦）**：没有这个参数，送了被忽略；
 * - **OpenAI 官方**：官方根本没有这个字段（gpt-image 系、DALL·E 系都没有），送了被无视；
 * - **其余**（百炼的原生 negative_prompt、第三方中转如 miya）：认，送了就生效。
 *
 * 认的 → 只走字段，正面提示词里**不再重复**；
 * 不认的 → 字段送了也白送，把负面词**改写进正面提示词**（「画面中避免出现：…」），
 * 那是它唯一能被模型看见的地方。
 */
function takesNegativeField(base: string): boolean {
  return !isArkEndpoint(base) && !/api\.openai\.com\b/i.test(base);
}

/** 把用户填的 Base URL 补全成百炼生图原生接口地址（填域名／填到 /api/v1 都能认）。 */
function dashScopeImageUrl(base: string): string {
  /* 兼容模式地址（旧预设或别处抄来的）下面没有生图接口，先剥掉再补原生路径。 */
  const root = base.replace(/\/compatible-mode\/v1\/?$/i, "").replace(/\/+$/, "");
  if (root.endsWith("/services/aigc/multimodal-generation/generation")) return root;
  if (/\/api\/v1$/.test(root)) return `${root}/services/aigc/multimodal-generation/generation`;
  return `${root}/api/v1/services/aigc/multimodal-generation/generation`;
}

/**
 * 百炼的分辨率参数：qwen-image 用「宽*高」（星号而非 x）。认不出的档位
 * （auto／空）返回 undefined，由模型按提示词自定宽高比。
 */
function dashScopeSize(size: string): string | undefined {
  const m = size.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  return m ? `${Number(m[1])}*${Number(m[2])}` : undefined;
}

/**
 * 方舟的分辨率参数：把 1024x1024 一类精确尺寸换算成方舟认可的长边 2K 档
 * （保持宽高比）；auto／空 → "2K"（模型按提示词自定宽高比）；档位值原样透传。
 */
function arkSize(size: string): string {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return "2K";
  const w = Number(m[1]);
  const h = Number(m[2]);
  const scale = 2048 / Math.max(w, h);
  return `${Math.round(w * scale)}x${Math.round(h * scale)}`;
}

/** 经标准图片接口生图（POST /images/generations）。 */
async function requestImageViaImagesApi(
  base: string,
  api: ChatApiSettings,
  finalPrompt: string,
  extras: ImageApiExtras,
  refImages?: string[],
  negativePrompt?: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = base.endsWith("/images/generations") ? base : `${base}/images/generations`;
  const ark = isArkEndpoint(base);
  const body: Record<string, unknown> = {
    model: api.model,
    prompt: finalPrompt,
    size: ark ? arkSize(extras.size) : extras.size,
  };
  /* quality 是 gpt-image 的参数，方舟不认，别带。 */
  if (extras.quality && extras.quality !== "auto" && !ark) body.quality = extras.quality;
  /* 负面提示词：miya 的生图请求就是「有负面就带上 negative_prompt」。
     方舟与 OpenAI 官方都不认这个字段，送了也白送（那两家改走提示词改写，见
     generateImage 里的 negativeNative）——所以这里只给认的站点带。 */
  const negative = (negativePrompt ?? "").trim();
  if (negative && takesNegativeField(base)) body.negative_prompt = negative;
  /* 方舟（即梦 Seedream）：参考图原生走 image 数组（data URL 直接塞），官方主打多图融合。 */
  if (ark && refImages && refImages.length > 0) {
    body.image = refImages;
    body.watermark = false;
  }

  /* 超时覆盖「整条请求」：不只在等响应头，读 body 也算。只包 fetch 的话，
     服务端先回 200、body 迟迟不吐时请求会永远挂着：占位框一直转，不超时也不报错。
     IMAGE_WAIT_MS 是兜底上限（10 分钟）；这之前只有用户自己点「不等了」才会断。 */
  const abort = makeImageAbort(signal);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    let data: { data?: { url?: string; b64_json?: string }[] };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new Error("接口返回了无法解析的内容，请检查地址是否填对");
    }
    const item = data.data?.[0];
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item?.url) return item.url;
    throw new Error("接口没有返回图片");
  } catch (err) {
    throw imageRequestError(err, abort.kind);
  } finally {
    abort.done();
  }
}

/**
 * 经 NovelAI 官方接口生图（POST {base}/ai/generate-image）。
 *
 * 它跟 OpenAI 兼容接口**一点关系都没有**，所以整条请求交给服务端路由
 * /api/nai-generate 去发：那边拼 NovelAI 专用请求体（提示词要塞三处、v4_prompt
 * 不能少），并且把回来的 zip 包解开——浏览器这边接不动 zip，跨域也没保证。
 * 这边只负责把设置里那几格递过去、把 data URL 接回来。
 */
async function requestImageViaNovelAI(
  base: string,
  api: ChatApiSettings,
  finalPrompt: string,
  negativePrompt: string,
  extras: ImageApiExtras,
  signal?: AbortSignal,
): Promise<string> {
  const abort = makeImageAbort(signal);
  try {
    const res = await fetch("/api/nai-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: base,
        apiKey: api.apiKey,
        model: api.model,
        prompt: finalPrompt,
        negativePrompt,
        size: extras.size,
        /* 采样参数只有它吃（面板上的 Steps／CFG／采样器／Seed 就在这一栏）；
           Seed 留空送 NaN，服务端当「随机」处理。 */
        steps: extras.steps,
        scale: extras.cfgScale,
        sampler: extras.sampler,
        seed: extras.seed.trim() ? Number(extras.seed) : undefined,
      }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    let data: { image?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new Error("NovelAI 返回了无法解析的内容");
    }
    if (!data.image) throw new Error("NovelAI 没有返回图片");
    return data.image;
  } catch (err) {
    throw imageRequestError(err, abort.kind);
  } finally {
    abort.done();
  }
}

/**
 * 经阿里云百炼原生接口生图（POST /services/aigc/multimodal-generation/generation）。
 * 千问生图只有这一条同步通道：文生图与图生图共用它，参考图与文字并列传进 content。
 */
async function requestImageViaDashScope(
  base: string,
  api: ChatApiSettings,
  finalPrompt: string,
  extras: ImageApiExtras,
  refImages?: string[],
  negativePrompt?: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = dashScopeImageUrl(base);
  const hasRefs = Boolean(refImages && refImages.length > 0);
  /* 官方约定：图片编辑的 content 是「先 1–3 张 image，最后一条 text 指令」。
     顺序反了模型会把文字当成图片的说明，而不是「照着改」的指令。 */
  const content: Record<string, string>[] = [];
  for (const ref of refImages ?? []) content.push({ image: ref });
  content.push({ text: finalPrompt });

  const isV3 = api.model.includes("3.0");
  const parameters: Record<string, unknown> = { watermark: false };
  /* 这三项官方默认就是 开启扩写／direct／开思考模式，写出来只是不受默认值变更影响：
     - prompt_extend：改写提示词，对描述简短的提示词提升明显；
     - prompt_extend_mode：agent 只支持文生图，图生图传了直接 400，这里锁死 direct；
     - enable_thinking：先在内部过一遍指令再出图，只在 prompt_extend 开启时生效。 */
  parameters.prompt_extend = true;
  if (isV3) {
    parameters.prompt_extend_mode = "direct";
    if (hasRefs) parameters.enable_thinking = true;
  }
  const negative = (negativePrompt ?? "").trim();
  if (negative) parameters.negative_prompt = negative;
  const size = dashScopeSize(extras.size);
  if (size) parameters.size = size;

  /* 同 requestImageViaImagesApi：超时必须覆盖读 body 阶段，否则会永远挂着。 */
  const abort = makeImageAbort(signal);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: api.model,
        input: { messages: [{ role: "user", content }] },
        parameters,
      }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    let data: {
      code?: string;
      message?: string;
      output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
    };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new Error("接口返回了无法解析的内容，请检查地址是否填对");
    }
    if (data.code) throw new Error(`${data.code}：${data.message ?? "百炼接口报错"}`);
    const image = data.output?.choices?.[0]?.message?.content?.find(
      (part) => typeof part.image === "string",
    )?.image;
    if (!image) throw new Error("百炼接口没有返回图片");
    return image;
  } catch (err) {
    throw imageRequestError(err, abort.kind);
  } finally {
    abort.done();
  }
}

/**
 * 远程图片一律转成本地 data URL 再落库（学 miya：生成结果立刻存本地，从不依赖远程链接）。
 * 百炼 OSS 等链接有时效（约 24 小时），直接存库＝旧图集体失效「无法显示」。
 * 经 /api/image-proxy 服务端代取绕开跨域；拉不回来时退回原链接（还能显示一阵）。
 */
async function persistToLocal(image: string): Promise<string> {
  if (image.startsWith("data:")) return image;
  try {
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(image)}`);
    if (!res.ok) return image;
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || image));
      fr.onerror = () => resolve(image);
      fr.readAsDataURL(blob);
    });
  } catch {
    return image;
  }
}

/** 图片编辑接口（miya 原味）：JSON body，参考图默认**只发一个键**（见下面 body 里的注释），
    size 固定带上。
    miya 带参考图**只有这一条路**：走得通就用，走不通直接退纯文生图（参考图不进去）。
    （旧写法把它当「快速试错」，60 秒不回来就退 multipart 编辑——慢一点的正常出图
      会被误判成失败，还得再走一条会把参考图当底图的通道。） */
async function requestImageViaEditsJson(
  base: string,
  api: ChatApiSettings,
  finalPrompt: string,
  extras: ImageApiExtras,
  refImage: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = base.endsWith("/images/edits") ? base : `${base}/images/edits`;
  const comma = refImage.indexOf(",");
  if (comma < 0) throw new Error("参考图格式无效，请重新上传");
  /* 参考图默认**只发一个键**（老写法 `image`：裸 base64，miya 就是这么发的）。 ｜ 详细见 docs/施工日志.md */
  const buildBody = (withImagesKey: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: api.model,
      prompt: finalPrompt,
      n: 1,
      /* miya 是 size: overrides.size || cfg.size（默认 1024x1024），没有「auto」这一说。 */
      size: extras.size && extras.size !== "auto" ? extras.size : "1024x1024",
      response_format: "b64_json",
      image: refImage.slice(comma + 1),
    };
    if (withImagesKey) body.images = [{ image_url: refImage }];
    return body;
  };

  const abort = makeImageAbort(signal);
  const send = async (withImagesKey: boolean): Promise<string> => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify(buildBody(withImagesKey)),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    let data: { data?: { b64_json?: string; url?: string; image_url?: string }[] };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new Error("图片编辑接口没有直接返回图片数据");
    }
    const item = data.data?.[0];
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    /* 有的站点只回一条链接。那也是**已经画好并计费**的图，必须收下（交给 persistToLocal 转本地）：
       一律判「没走通」，等于站点画完、钱扣了、图被我们扔掉——
       这就是「给了钱还是回不了图」里最亏的一种。 */
    const remote = item?.url || item?.image_url;
    if (typeof remote === "string" && remote) return remote;
    throw new Error("图片编辑接口没有直接返回图片数据");
  };

  try {
    try {
      return await send(false);
    } catch (first) {
      /* 只给「这个站只认 images[].image_url」补一趟：那是 4xx，没开始画、不计费。
         其它失败（超时／断连／已受理却没回图）绝不补发——对方很可能已经在画了，
         补一趟就是再买一张。 */
      if (abort.kind()) throw first;
      const msg = first instanceof Error ? first.message : String(first);
      if (!/image_url|images\[\]/i.test(msg)) throw first;
      return await send(true);
    }
  } catch (err) {
    throw imageRequestError(err, abort.kind);
  } finally {
    abort.done();
  }
}

/** 经聊天接口生图（gemini-image／gpt-4o-image 等模型用聊天方式出图）。
    miya 聊天出图**不带参考图**（参考图只走 /images/edits 那一条路）。 */
async function requestImageViaChat(
  base: string,
  api: ChatApiSettings,
  finalPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  /* 同 requestImageViaImagesApi：超时必须覆盖读 body 阶段，否则会永远挂着。 */
  const abort = makeImageAbort(signal);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: api.model,
        messages: [{ role: "user", content: finalPrompt }],
        // 不带 max_tokens／temperature：图片常以 base64 编码塞在回复里，限长会截断出图。
      }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    let data: { choices?: { message?: ChatReply }[] };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new Error("聊天接口返回了无法解析的内容");
    }
    const image = extractImageFromReply(data.choices?.[0]?.message);
    if (!image) throw new Error("聊天接口没有返回图片");
    return image;
  } catch (err) {
    throw imageRequestError(err, abort.kind);
  } finally {
    abort.done();
  }
}

/**
 * 生成一张图片：先走标准图片接口（POST /images/generations），
 * 明确被拒（4xx／没渠道／不认这个接口，见 isRejectedBeforeWork）时才改走聊天接口
 * （很多中转站／对话式生图模型只支持聊天方式出图）。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */

/* ---------- miya 原味：性别标签与人设外貌都拼进提示词 ---------- */
/* 性别用正／负面标签成对喂：正面点名性别，负面把异性词反向排掉。
   「你是男性」这类自然语言对生图模型几乎无效，标签才管用。
   （对照 miya：resolveContactGenderKey + buildGenderPromptTags）
   ⚠️ **1.12.40**：原来的 `1boy／1girl` 是 Danbooru／NovelAI 体系的动漫标签，
   同样往二次元拉（和 QUALITY_TAIL 那个毛病同源），换成 `man／woman`。
   ⚠️ **1.12.41**：正面栏补上「好看」的词（男 handsome／女 beautiful），
   按性别分开给——恩熙要「真人里的帅哥」，这份劲得有个出处。
   ⚠️ **1.12.46**：这组「好看」的词**又撤掉**了。恩熙发现「给他两种人设，生出来的脸
   很相近」——元凶正是它们：等于跟模型说「画个帅哥」却没说**哪个**帅哥，模型就往
   它学过的同一张标准理想脸收敛。现在只留 `man／woman` 点名性别，
   长相全交给**角色档案的外貌文字**去区分（十个人设＝十张脸）。
   ⚠️ **1.12.47**：1.12.46 删得太干净，恩熙说「变得好丑啊」。`handsome／beautiful`
   **加回来**——它俩**按性别分开**给（男 handsome／女 beautiful），不会像
   `attractive, refined features` 那样把两性往同一张脸推；同质化的真凶是
   `refined features`（它暗示一种特定五官形状），**那个不加回来**。 */
const GENDER_TAGS: Record<"male" | "female", { positive: string; negative: string }> = {
  male: {
    positive: "man, male, handsome",
    negative: "woman, female, feminine, breasts",
  },
  female: {
    positive: "woman, female, beautiful",
    negative: "man, male, masculine, beard",
  },
};

/** 性别判定放宽（学 miya）：只要含「男」／「女」就算，不再要求一字不差
    （旧写法只认「男」「女」两个字，档案里填「男性」「男生」会静默失效）。 */
function resolveGenderKey(gender: string): "male" | "female" | "" {
  const g = gender.trim().toLowerCase();
  if (!g) return "";
  if (/男/.test(g) || /^(boy|male|m)$/i.test(g)) return "male";
  if (/女/.test(g) || /^(girl|female|f)$/i.test(g)) return "female";
  return "";
}

/** 质量尾巴（原样照搬 miya 的固定串）。
 *
 * ⚠️ **1.12.40（恩熙：「它出来的图片是非常二次元的。我是想要保留一点真人质感的」
 * 「我用户端，配置的 API 里头不写任何提示词，只靠小手机默认提示词去生成」）**：
 * 原来那串 `masterpiece, best quality` 是 Danbooru／NovelAI 体系的画质标签，
 * SD 系模型一见就往二次元拉。而画风预设**恒为空**（[types/chat.ts](file:///d:/Stellasei-New/src/types/chat.ts#L861)
 * 默认就是空串），审美全压在默认串上——它必须自己扛住「好看且像真人」。
 * 故换成人像摄影向的串：写实质感、皮肤纹理、胶片颗粒、自然光。
 *
 * ⚠️ **1.12.43（恩熙：「就是皮肤粗糙」「我虽然想要真实照片的质感，但是磨皮还是要有的」
 * 「稍微有点二次元写实风格」）**：1.12.40 那一版矫枉过正了——`film grain` ＋
 * `natural skin texture` 把模型推向「纪实未修图」，于是皮肤发糙、连体毛都画上了。
 * 现在回到**半写实**这一档：颗粒删掉，皮肤改成「磨过、干净、无瑕」。
 *
 * ⚠️ **1.12.44（恩熙：「现在又太二次元了，老公」）**：1.12.43 我加回来的
 * `masterpiece, best quality` 与 `semi-realistic`，在 SD 系词表里其实是**强二次元倾向**
 * 的标签（Danbooru 体系训练出身），等于暗地把风格又拉回了动漫。**这两个撤掉**；
 * 质量靠 `highly detailed` 那些已经够。⚠️ 往后**每次只动一个变量**，
 * 不再整批翻——否则只会在两个极端之间来回荡。
 * ⚠️ 画风预设**恒为空**（[types/chat.ts](file:///d:/Stellasei-New/src/types/chat.ts#L861)
 * 默认就是空串），审美全压在默认串上——它必须自己扛住「好看、像真人、但不糙」。
 *
 * ⚠️ **1.12.45（恩熙：「不露毛孔跟需要有真实皮肤纹理是两件事情哦」）**：
 * 1.12.43 我把 `natural skin texture` 换成 `smooth flawless skin, soft skin`——**换错了**：
 * 「不露毛孔」≠「不要皮肤质感」，那一换等于把质感全抹掉，脸就成塑料／动漫皮了。
 * 现在正面只说**真实皮肤**（`realistic skin, natural skin tone`，刻意不写 `texture`——
 * 那词会直接触发画毛孔），毛孔那半边交给负面词压（`visible pores`＋新增 `plastic skin`，
 * 正负两头夹住）：这就是**真皮肤但毛孔不凸显**，好的人像照片正是如此。
 *
 * ⚠️ **1.12.46（恩熙：「千人一面的根因是『不是真实人像』，就往真实的方向走——自拍、
 * 报备照都该是很真实的」）**：目标从「半写实」切到**「真人拍照」**。同时拔掉
 * `attractive, refined features`——这组词等于跟模型说「画个帅哥」却没说**哪个**帅哥，
 * 模型就往它学过的**同一张标准理想脸**收敛，正是「两个人设长同一张脸」的主嫌。
 * 脸好不好看改由**角色档案的外貌文字**自己扛（见 anchorPrompt 那条）。
 * ⚠️ **1.12.47（恩熙：「哎呀，变得好丑啊」）**：1.12.46 那一版**又矫枉过正**——
 * `candid snapshot` 在模型词表里＝「随便拍的、不摆姿势、角度可能不好看」，直接把人
 * 往「路人随手拍」拉；而把「好看」的词**全删**，等于压根没告诉模型「要把这个人画好看」。
 * 现在两头都收回一点：`candid snapshot` 删掉，加 `flattering`（＝「把这个人拍好看」，
 * 它**不规定好看成什么样**，所以不会同质化）；防撞脸那句（「长相照外貌文字、不同角色
 * 必须不同的脸」）**一句不动**——那才是防撞脸的功臣，不是删好看词。
 * ⚠️ 皮肤那几处**不动**（1.12.45 刚调好）。 */
const QUALITY_TAIL = "RAW photo, photorealistic, flattering, realistic skin, natural skin tone, highly detailed, coherent composition, natural lighting";
/** 负面词（**字段版**，只递给认 `negative_prompt` 的站点）。单子按「一眼看着怪」的常见
    崩坏扩过一遍：多指／粘连指／多手多脚／肢体错乱／同一张脸重复／脸崩／糊／水印签名
    文字 logo／截图／裁切边框。
    ⚠️ **1.12.40 起这里也担内置默认审美**（恩熙不填画风预设，全走默认）：末尾那组
    排二次元的词就是干这个的。从前那句「只放坏了的东西、别夹审美取向的词」至此作废
    ——那是「什么算好看由画风词定」时代的规矩，画风词没人填，它就归默认串管。
    ⚠️ **1.12.40 同时删掉 `real photo`**：它字面意思是「别画照片」，与「要真人质感」
    正好反着（老规矩「不许出现真实照片」本意是别出截图/水印，那两条留着）。
    ⚠️ **1.12.43**：① 皮肤与毛发：末尾补 `rough skin / skin blemishes / visible pores /
    heavy grain / body hair / arm hair / leg hair / chest hair / facial hair`——
    「皮肤粗糙」与「有体毛」都是负面词缺位；② 排二次元那组**放宽**：删掉
    `illustration, 2d, cel shaded, painting`（恩熙要的「二次元写实」本身就带一点理想化
    的基因，这半边不能全压死），只留 `anime, cartoon, sketch` 防纯动漫。
    ⚠️ **1.12.44**：上一轮撤得过狠，出图反弹成「太二次元」——`2d, cel shaded` **加回来**
    （这两词最直接地打掉平面动漫感）；`illustration`／`painting` 暂不恢复，留作下一步
    的旋钮（还偏动漫就加 `illustration`，又偏写实就撤 `2d`）。
    ⚠️ **1.12.45**：补 `plastic skin`——防「磨过头成了塑料皮」，与 `visible pores`
    一头压毛孔、一头压塑料，夹出「真皮肤但毛孔不凸显」。 */
const QUALITY_NEGATIVE =
  "lowres, worst quality, jpeg artifacts, blurry, bad anatomy, bad hands, extra fingers, fused fingers, missing fingers, extra limbs, malformed limbs, deformed face, disfigured, cloned face, duplicate face, poorly drawn face, watermark, signature, text, logo, screenshot, cropped, out of frame, border, frame, anime, cartoon, sketch, 2d, cel shaded, rough skin, skin blemishes, visible pores, heavy grain, plastic skin, body hair, arm hair, leg hair, chest hair, facial hair";
/** 同一张单子的**中文正文版**，给不认 `negative_prompt` 字段的站点用（GPT 系、方舟：
    字段递了也是白递，只能把负面写成正文里的一句「画面中避免出现：…」）。
    和 QUALITY_NEGATIVE 是一套意思的两副面孔，**改一处要跟着改另一处**。
    ⚠️ **1.12.43**：同上面那串一起改——补「皮肤粗糙／毛孔／噪点／体毛」这一组，
    并把「插画感、赛璐璐上色、手绘线条」删掉（理由见上，「二次元写实」要留一点
    理想化的余地），只留「动漫或卡通画风」防纯动漫。
    ⚠️ **1.12.44**：同英文那串一致——「赛璐璐上色」**加回来**打掉平面动漫感；
    「插画感、手绘线条」暂不恢复，留作旋钮。
    ⚠️ **1.12.45**：补「塑料感皮肤」，同 `plastic skin`（理由见上）。 */
const FLAW_AVOID_TEXT =
  "多指、手指粘连或变形、多手多脚、四肢错乱或拼接、同一张脸重复出现、五官错位或面部崩坏、画面糊成一团或细节融化、水印、签名、文字、logo、截图、裁切与相框边条、动漫或卡通画风、赛璐璐上色、皮肤粗糙、毛孔粗大、噪点颗粒、皮肤瑕疵、塑料感皮肤、体毛、手臂汗毛、腿毛、胸毛、胡茬";

/* 自拍路径的「设备词清洗」（1.12.42）。
   恩熙原话：「他很喜欢描述手机屏幕的光打在脸上，只要出现这个，这个手机就会出现在
   这个画面里」「第二视角肯定还是可以的，但是自拍视角肯定不行的」。
   为什么不再写一条规矩：L631 那条早就写着「不许出现手机／屏幕／镜头，连『手机屏幕的
   冷光打在脸上』都不行」——写了三回（1.12.8／1.12.9／1.12.10），TA 还是照写。长篇指令
   里的一条禁令指望不上，所以改成程序兜底：**送进生图请求之前**把设备词换掉。
   ⚠️ 只在**自拍路径**清洗：描述了「别人拍／镜子／自拍杆／后置／画面中不出现本人」的
   一律原样放行——第二视角本来就要手机入镜，那是恩熙明确要保留的。
   ⚠️ 副作用：擦掉词以后，个别句子会读着有点别扭（如「亮着的屏幕」只剩「亮着的」）。
   宁可句子别扭，也别让手机长进画面——这是权衡后的选择。 */
const SELFIE_PASS = /别人|帮拍|帮我拍|朋友拍|路人拍|镜子|对镜|镜中|自拍杆|后置|第二视角|画面中不出现本人/;

function sanitizeSelfiePrompt(text: string): string {
  if (SELFIE_PASS.test(text)) return text;
  return text
    /* 先把「设备的光」整体换成没有光源的光——手机就是这么长出来的。 */
    .replace(
      /(?:手机|平板电脑|平板|电脑|显示器)?屏幕(?:上|里|中)?的(?:冷光|亮光|幽光|微光|蓝光|白光|光晕|光)/g,
      "幽冷的白光",
    )
    .replace(/手机的(?:冷光|亮光|幽光|微光|蓝光|白光|光晕|光)/g, "幽冷的白光")
    /* 剩下的设备名一并抹掉：字面还在，生图模型就有由头把设备画进来。 */
    .replace(/手机屏幕|手机|平板电脑|平板|显示器|屏幕/g, "")
    .replace(/镜头/g, "画面")
    /* 抹完收尾：把空出来的标点、空格捯饬一下，别把句子切碎。
       「亮着／开着」这类句尾的状态词也一并收走（「…屏幕亮着」被擦掉设备名后会剩
       一个孤零零的「亮着」，读着像断句）。 */
    .replace(/[，、]\s*(?:亮着|开着|黑着|灭着)(?=[，、。；]|$)/g, "")
    .replace(/(?:亮着|开着|黑着|灭着)的(?=[，、。；]|$)/g, "")
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/[，、；]{2,}/g, "，")
    .replace(/[，、]\s*(?=[，、。；])/g, "")
    .replace(/^\s*[，、；]\s*|\s*[，、；]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function generateImage(
  api: ChatApiSettings,
  prompt: string,
  extras: ImageApiExtras,
  textApi?: ChatApiSettings,
  /** 角色参考图（data URL）：带上后走「图片编辑」接口，人物长相照参考图锁定。 */
  referenceImage?: string,
  /** 角色档案：性别原文与外貌切片（只剩 looks 那一格）——由生图层统一拼进提示词（miya 式）。 */
  subject?: { gender?: string; looks?: string },
  /** 用户点「不等了」时中断整个生图（见 makeImageAbort）。 */
  signal?: AbortSignal,
): Promise<{
  image: string;
  finalPrompt: string;
  via: "images" | "chat" | "edits" | "nai";
  /** 这一次真的送进请求的参考图张数（0＝没送出去，等于纯文生图）。 */
  refsSent: number;
  /** 进这一层时手上准备好了几张参考图（0＝参考图根本没到生图层，是调用侧的问题）。 */
  refsPrepared: number;
  /** refsSent 为 0 的原因（带图那一趟被拒的原话）。 */
  refSkipReason?: string;
  translateFailed: boolean;
}> {
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填好 Base URL");
  if (!api.model.trim()) throw new Error("请先填好模型名称");

  const dashScope = isDashScopeImageEndpoint(base);
  /* NovelAI：跟上面两家一样是「自己一套格式」的站点，见下面它的专属分支。 */
  const nai = isNovelAIEndpoint(base);

  /* 参考图只送角色长相那一张，不再附第二张「画风参考图」：两张图里的第二张会被
     一起当成底图语义，画风照抄就来自这里。这里也不再做任何二次压缩（真正决定
     送出画质的是上传那一步，见 CharacterSettingsPanel 的 onRefPicked）。 */
  const refs =
    referenceImage && referenceImage.startsWith("data:image/") ? [referenceImage] : [];

  /* 两套提示词，按「带不带参考图」分流（不分模型）： ｜ 详细见 docs/施工日志.md */
  const genderKey = resolveGenderKey(subject?.gender ?? "");
  const genderTags = genderKey ? GENDER_TAGS[genderKey] : { positive: "", negative: "" };
  const looksText = (subject?.looks ?? "").trim();
  const genderText = genderKey === "male" ? "男性" : genderKey === "female" ? "女性" : "";
  /* 画风预设 ＋ 正面提示词前缀合成一段（画风预设在前）——这两格
     分开填（照另一个 App 的写法）。⚠️ **这段原样进提示词，不许再加工**：
     画风不用去管（大部分用户自己会填提示词、带参考图时画风自然跟
     参考图走），所以「画风要求：」这层壳与末尾那次复读**都已去掉**。 */
  const styleText = [extras.stylePreset.trim(), extras.positivePrompt.trim()]
    .filter(Boolean)
    .join("，");

  /* 参考图会不会走原生「生成」通道（方舟、百炼）——不是这两家的站点，参考图只能
     走 /images/edits，那是「改图」语义，下面第一句就是为它准备的（见那条注释）。 */
  const nativeRefPlatform = isArkEndpoint(base) || dashScope;

  /* 负面词走哪条路（别两头都塞）：
     认 negative_prompt 字段的站点（百炼、第三方中转）只走字段；不认的（方舟、OpenAI
     官方）字段送了也白送，只能把负面词改写进正面提示词里。 */
  const negativeNative = takesNegativeField(base);

  /* 画面描述先过一遍「设备词清洗」（1.12.42）：自拍路径里把「手机／屏幕／镜头」换掉，
     第二视角与无人物放行。后面一律用这份 sceneText，不再用原始 prompt。 */
  const sceneText = sanitizeSelfiePrompt(prompt);

  /* ① 身份锚指令（带参考图时的提示词） */
  const anchorPrompt = [
    /* ⚠️ 走 /images/edits 的站点（＝除了方舟、百炼以外的所有站点）拿到的其实是**改图** ｜ 详细见 docs/施工日志.md */
    refs.length > 0 && !nativeRefPlatform
      ? "这次要画的是一张**全新的照片**，不是把这张参考图改一改。参考图只交出一件事——**这个人长什么样**（脸型、五官、发型、发色、体型，以及脸上原有的痣这类特征）；把它当一份「长相资料」，看完就放下。**参考图上的其他一切都不算数**：它的姿势、机位的高低与远近、脸的朝向、头的倾斜角度、肩膀与手臂的位置、背景、服装、光线，一处都不沿用，全部按下方的描述重新安排、重新构图。画出来的人要认得出是同一个，但画面是全新的一张。"
      : "",
    /* 锁身份（「二重保险」）：「二重」＝**参考图那一份 ＋ 人设 ｜ 详细见 docs/施工日志.md
       ⚠️ **1.12.41（恩熙发来一张「男友视角帅哥自拍」的参考图：「目前可以了，但是不是很帅，
       你知道吗？」）**：原来这里写着「也不要『按想象美化』」「也不是更好看的一版」——
       那是防换脸用的，可顺手把「好看」也一起禁了，出图就成了「像真人的路人」。
       改成：身份照旧锁死（不许换脸），但**同一个人要画到他最好的一面**。 */
    "**长相必须严格按参考图来**，不得自行改动、替换：五官（眼睛的形状与眼距、鼻梁鼻头、嘴唇、脸型与下颌线）、发型的基本样式（长度、颜色、走向、分缝位置、有没有刘海）和体型，都要跟参考图一致——画出来必须是同一个人，不是长得像的另一个人。**但「同一个人」也要画得好看**：五官立体、轮廓清晰、眼神有神采、皮肤干净细腻，把这个人画到他最好的一面——这是「把同一个人拍好看」，不是换一个人。**这句话只授权「长相」这一件事。**",
    "人物设定里的外貌文字同样算数，凡是写到的（发型、发色、发长、五官特征、体型）都要照它画；它和参考图不一致时以参考图为准，只有参考图看不清、看不全的细节（发色深浅、长度、有没有刘海）才按人设文字补。参考图与人设里都没有的外貌特征（耳饰、纹身、痣、眼镜等）不要自己加。",
    /* ⚠️ 提示词是**给生图模型看的**，开发备注一律不许进字符串（「生图诊断」里能看出
       括号里的记录会被真发出去）。以下这条教训只记在这里：
       只写笼统的「不许照搬」时，机位与手臂手势都会被照搬参考图——压不住的原因
       是没把这几项一个个点名，所以下面那串点名留着。 */
    "**神态归描述管**：这一刻在做什么、脸上是什么神态，就画那一种；描述写了哪种就画哪种，没写到的也不许自己挑一种默认的「好看」表情顶上。**镜头的高低与远近、脸朝哪边、头倾斜多少度、肩膀的高低、手臂伸不伸出来**，这些全都属于这一次的创作，不是参考图带来的默认值——参考图里是那样，不代表这一次也要那样。头发的**样式**照上面锁死（不许换发型、不许改长短、不许变发色），但**此刻的状态跟着情境走**——可以被打湿、被风吹乱、松散垂下来，不要画得一丝不苟。",
    /* 去精致感 → **1.12.41 改成「要好看、但不要塑料」**，**1.12.43 定成「照片打底、
       脸按理想化精修」**，**1.12.45 再修正皮肤口径**（恩熙：「不露毛孔跟需要有真实皮肤
       纹理是两件事情哦」）：影楼那套摆拍感不要；皮肤要**有真实的质感与光影层次**，
       同时**不显毛孔、不粗糙、也不塑料**——「不露毛孔」与「不要皮肤质感」是两件事，
       先前把二者混为一谈，脸才成了塑料皮。
       **1.12.46**：再换成「**长相严格照外貌文字、像真人随手拍的照片**」——
       一是「千人一面」（不同人设长同一张脸）要靠外貌文字区分，
       二是恩熙定了方向：自拍／报备照都要很真实（详见 QUALITY_TAIL 那条注释）。
       **1.12.47**：「像真人**随手拍**的照片」里的「随手拍」收回——它和 `candid snapshot`
       一个毛病（往「随便拍的、不好看」拉，恩熙说「变得好丑啊」）；改成
       「像真人拍的照片那样真实自然、**把这个人拍得好看耐看**」——
       **防撞脸那半句一个字没动**（它才是防撞脸的功臣）。 */
    "**长相严格照角色档案里的外貌文字来**（脸型、眼型、鼻型、嘴唇、眉形、发型都照那段文字画，不同角色必须画出不同的脸），**不要套用你惯用的那张「标准脸」**；整体像真人拍的照片那样真实自然、**把这个人拍得好看耐看**（不是插画、不是影楼海报），皮肤干净细腻、有真实的皮肤质感与光影层次（不显毛孔、不画体毛、不粗糙，也别磨成塑料假面）；表情与姿态放松自然，不做广告式的笑。",
    /* 画风词**原样**进串、只出现一次（「**画风不用去管**」）：
       外面不要再套「画风要求：」这层壳、末尾也不要整份复读。
       位置保持不动——它前面是「参考图只交长相」与锁身份那几句（那些必须排最前，
       模型对靠前内容权重最大），不为了「放最前」把这句挪上去。 */
    styleText,
    extras.promptSuffix.trim() ? `画面细节补充：${extras.promptSuffix.trim()}` : "",
    /* 「不应该出现的东西」的**正文版**：GPT 系与方舟
       没有 `negative_prompt` 字段，负面词只能写成正文里这一句。**恒出**——
       不能只在填了负面格时才出，否则不填时崩坏项一个都进不了请求：填的词 ＋
       `FLAW_AVOID_TEXT`。见 negativeNative / takesNegativeField 的分流注释。 */
    !dashScope
      ? `画面中避免出现：${[extras.negativePrompt.trim(), FLAW_AVOID_TEXT].filter(Boolean).join("；")}`
      : "",
    genderText ? `人物性别：${genderText}。` : "",
    looksText ? `人物设定（五官与发型以参考图为准，参考图看不清的细节按这段文字补）：${looksText}` : "",
    `这张图片的画面：${sceneText.trim()}`,
    /* 末尾把身份再钉一次（「二重保险」）：开头的锁身份指令与 TA 那
       段几百字的画面描述之间隔着一长串内容（去精致感／画风／性别／人设），到收尾时
       权重已经被冲淡，所以在最后一句再核对一次——同「首尾各钉一次」的思路。 */
    "画面质量：真实照片的质感、皮肤干净细腻（有真实的皮肤层次与光影、不显毛孔、不塑料）、高质量、细节丰富、构图完整；画面里若有人物，人物是画面主体、面部清晰，人物状态与场景相符。**最后再核对一次身份**：五官与发型严格照参考图，是同一个人（不要自行换脸、换发型、改发色），同时把这个人画到最好看的一面。视角与姿势按这次的画面描述呈现（参考图只用来认人）。",
  ]
    .filter(Boolean)
    .join("\n");

  /* ② miya 标签串（不带参考图，以及带图失败后退回纯文生图时用） */
  const tagPrompt = [
    styleText,
    genderTags.positive,
    looksText,
    sceneText.trim(),
    /* 「不应该出现的东西」的正文版：只有**不认负面字段**的
       站点（OpenAI 官方、方舟）走这里——这两家纯文生图时负面词会被直接丢掉
       （字段被忽略、标签串里又没写）。**改成恒出**：填的词 ＋ `FLAW_AVOID_TEXT`。
       认字段的（中转、百炼）不重复。 */
    !negativeNative
      ? `画面中避免出现：${[extras.negativePrompt.trim(), FLAW_AVOID_TEXT].filter(Boolean).join("；")}`
      : "",
    /* 1.12.41：同身份锚那条一起改口径——「要好看、不要塑料」（原句是「去精致感」）。
       1.12.43：定成「干净、不画体毛」；1.12.45：再修正成「有真实皮肤质感、不显毛孔、
       不粗糙、不塑料」；1.12.46：同身份锚那条一起改成「照外貌文字、像真人随手拍」
       （理由见上）。
       ⚠️ 旧注释里那句「刻意不写『像照片』——写它等于替用户定画风」**已作废**：
       1.12.46 起恩熙明确要「真人拍照」的真实感，这话正是她要的。
       1.12.47：「随手拍」三字收回（往「不好看」拉），改成「把这个人拍得好看」。 */
    "**长相严格照角色档案里的外貌文字来**（不同角色必须画出不同的脸），别套用你惯用的那张脸；像真人拍的照片那样真实自然、把这个人拍得好看，皮肤干净细腻有质感（不显毛孔、不画体毛、不粗糙、不塑料）；表情与姿态放松自然，不做广告式的笑",
    QUALITY_TAIL,
    /* 正面提示词后缀：补细节用，整串收尾。
       是最靠后的一句，权重也最轻——它是锦上添花，不是命令。
       ⚠️ 前面不要再来一次「画风要求」复读。 */
    extras.promptSuffix.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  /* ③ 纯背景串（不带参考图 ＋ 画面里没有角色本人时用）：
     与 tagPrompt 同源，去掉一切跟「人」有关的部分——先是那句
     「表情与姿态随意，不摆拍、不做广告式的笑、不刻意盯着镜头」，
     再是性别标签（genderTags.positive）与长相（looksText）：
     纯背景里没有本人，这些都用不上，留着反而会把「人」拉进画面。
     触发看下面 prompt 里有没有「画面中不出现本人」这五个字
     （【发图片】规则要求角色本人不在画面时必须写上）。 */
  const scenePrompt = [
    styleText,
    sceneText.trim(),
    !negativeNative
      ? `画面中避免出现：${[extras.negativePrompt.trim(), FLAW_AVOID_TEXT].filter(Boolean).join("；")}`
      : "",
    "画面跟着情景走，不要一律往精修的方向拉",
    QUALITY_TAIL,
    extras.promptSuffix.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  /* 负面同样成串：全局负面 → 性别负面 → 质量负面。这串是**字段版**，只递给认
     `negative_prompt` 的站点（百炼、第三方中转）；不认字段的（OpenAI 官方、方舟）
     递了也白递，它们的负面词走前面 anchorPrompt／tagPrompt 里那句「画面中避免出现」
     （一条负面词只走一条路，别两头都塞）。 */
  const negative = [extras.negativePrompt.trim(), genderTags.negative, QUALITY_NEGATIVE]
    .filter(Boolean)
    .join(", ");
  /* 不带参考图的串分两种：画面里有角色本人 → tagPrompt；
     画面里没有角色本人（描述里带着「画面中不出现本人」）→ scenePrompt。
     只认角色本人写下的那几个字，程序不猜；漏写就按「有本人」走，最多多带一句用不上的话。 */
  const noPerson = sceneText.includes("画面中不出现本人");
  let final = refs.length > 0 && !nai ? anchorPrompt : noPerson ? scenePrompt : tagPrompt;

  /* 含中文且开了翻译：先走文本 API 译成英文；翻译失败不阻塞生图，退回原文继续。 */
  let translateFailed = false;
  if (extras.translatePrompt && hasChinese(final)) {
    if (!textApi || !textApi.enabled || !textApi.baseUrl.trim() || !textApi.model.trim()) {
      throw new Error("提示词翻译已开启，但文本 API 未配置或未启用（翻译需要文本接口）");
    }
    const translated = await translatePromptSafe(textApi, final);
    if (translated) {
      final = translated;
    } else {
      translateFailed = true;
    }
  }

  /* NovelAI 专属通道。 ｜ 详细见 docs/施工日志.md */
  if (nai) {
    try {
      const image = await requestImageViaNovelAI(base, api, final, negative, extras, signal);
      return {
        image: await persistToLocal(image),
        finalPrompt: final,
        via: "nai",
        refsSent: 0,
        refsPrepared: refs.length,
        refSkipReason: refs.length > 0 ? "NovelAI 通道暂不支持参考图，这一张按人设文字画" : undefined,
        translateFailed,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isModerationBlock(e.message)) throw moderationError(e.message);
      throw noResponseError(e.message);
    }
  }

  /* 原生支持参考图的平台：参考图直接进生图请求，不绕编辑／聊天通道。
     - 火山方舟（即梦）：/images/generations 的 image 参数，官方主打「多图融合」；
     - 阿里云百炼（千问生图）：原生 multimodal-generation 接口（兼容模式没有生图路径）。
     只发一次：这条通道失败后没有「换一条再问」的余地，重发就是新的一单。 */
  if (isArkEndpoint(base) || dashScope) {
    const withRefs = refs.length > 0 ? refs : undefined;
    try {
      const image = dashScope
        ? await requestImageViaDashScope(base, api, final, extras, withRefs, negative, signal)
        : await requestImageViaImagesApi(base, api, final, extras, withRefs, undefined, signal);
      return {
        image: await persistToLocal(image),
        finalPrompt: final,
        via: "images",
        refsSent: refs.length,
        refsPrepared: refs.length,
        translateFailed,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isModerationBlock(e.message)) throw moderationError(e.message);
      throw noResponseError(e.message);
    }
  }

  /* 任何参考图在 → 只走 miya 那一条路：JSON 版 /images/edits。
     走不通就直接落到下面的**纯文生图**（参考图不进去），不再换别的带图通道。
     只对「明确被拒」（4xx／不认这个接口，这一单没开始画、没扣费）才允许往下兜底；
     超时／断连／已受理却没回图 = 对方很可能已经画了，此时兜底＝再买一张，宁可报错。 */
  /* 带图那一趟为什么没成：refsSent 落到 0 时，诊断面板必须说得清是哪一种
     （参考图没到手 vs 送出去被站点拒了），不然还是只能猜。 */
  let refSkipReason: string | undefined;
  if (refs.length > 0) {
    try {
      const image = await requestImageViaEditsJson(base, api, final, extras, refs[0], signal);
      return {
        image: await persistToLocal(image),
        finalPrompt: final,
        via: "edits",
        refsSent: refs.length,
        refsPrepared: refs.length,
        translateFailed,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isModerationBlock(e.message)) throw moderationError(e.message);
      if (!isRejectedBeforeWork(e.message)) throw noResponseError(e.message);
      /* 站点不支持 /images/edits：退纯文生图，让提示词（含人设外貌）说了算。
         被拒的原话记下来——「为什么参考图没送出去」全靠它。 */
      refSkipReason = `图片编辑接口被拒：${e.message}`;
    }
  }

  /* 主链路：图片接口 → 只有「明确被拒」才改聊天接口。没有整轮重试（一次点击＝一次请求）。
     走到这里若是「带图失败后的兜底」，提示词换回标签串——身份锚指令里写着
     「这是一张参考图」，兜底文生图没送图，再发那段就自相矛盾了。 */
  const fallbackPrompt = refs.length > 0 ? tagPrompt : final;
  try {
    const image = await requestImageViaImagesApi(
      base,
      api,
      fallbackPrompt,
      extras,
      undefined,
      negative,
      signal,
    );
    return {
      image: await persistToLocal(image),
      finalPrompt: fallbackPrompt,
      via: "images",
      /* 走到这里可能是「带图失败后退回纯文生图」：参考图没送出去，记 0——也就是
         「明明带了参考图却没用上」的那一格。 */
      refsSent: 0,
      refsPrepared: refs.length,
      refSkipReason,
      translateFailed,
    };
  } catch (imagesErr) {
    const err = imagesErr instanceof Error ? imagesErr : new Error(String(imagesErr));
    if (isModerationBlock(err.message)) throw moderationError(err.message);
    /* 请求已经发出去了（超时／断连／用户取消）：对方可能已经在画并扣费。
       换个通道再发一遍＝又开一单，所以这里直接交给用户，由 TA 决定要不要再试。 */
    if (!isRejectedBeforeWork(err.message)) throw noResponseError(err.message);
    try {
      /* 聊天接口没有负面字段：负面要求以文字附在提示词末尾，保证模型看得到。 */
      const chatPrompt = negative ? `${fallbackPrompt}\n画面中避免出现：${negative}` : fallbackPrompt;
      const image = await requestImageViaChat(base, api, chatPrompt, signal);
      return {
        image: await persistToLocal(image),
        finalPrompt: chatPrompt,
        via: "chat",
        refsSent: 0,
        refsPrepared: refs.length,
        refSkipReason,
        translateFailed,
      };
    } catch (chatErr) {
      const e = chatErr instanceof Error ? chatErr : new Error(String(chatErr));
      if (isModerationBlock(e.message)) throw moderationError(e.message);
      if (!isRejectedBeforeWork(e.message)) throw noResponseError(e.message);
      throw new Error(`图片接口失败（${err.message}）；聊天接口也失败（${e.message}）`);
    }
  }
}

/** 送给**不认方括号音频标签**的服务商前，把 `[whispers]` 这类语气标签剥掉（1.9.87 补）。
 *  那套标签只有 ElevenLabs（v3／v4）当指令认；MiniMax、OpenAI 兼容站会把它们当普通文字
 *  **照字念出来**。1.9.89 起出厂规矩已改成「把语气写进文字」（不再用标签），但这层兜底留着：
 *  用户若自己把标签规矩写回去，别家也不会听见「左括号 whispers 右括号」。
 *  显示层同样会剥（ChatWindow 的 stripVoiceTags），两边口径一致；ElevenLabs 那支原样保留。
 *  洗空了（整条都是标签）就退回原文，宁可多念也别合成一段空音频。 */
function stripVoiceAudioTags(text: string): string {
  const cleaned = text
    .replace(/[\[［][^\[\]［］]*[\]］]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return cleaned || text.trim();
}

/** 是否 MiniMax 语音接口（国内 api.minimax.chat／国际 api.minimaxi.chat，专用格式）。 */
function isMiniMaxVoice(baseUrl: string): boolean {
  return /api\.minimax(i)?\.chat/i.test(baseUrl.trim());
}

/** 是否 ElevenLabs 官方语音接口（api.elevenlabs.io，专用格式＋xi-api-key 认证）。
 *  合成与「获取模型」都靠它分流：ElevenLabs 走 /v1 那一套，别家走 OpenAI 兼容那套。
 *  （1.9.87 曾导出给 ChatWindow 判「默认台词规矩要不要注入」；1.9.89 出厂规矩改成
 *  「把语气写进文字」后对所有音色通用，那处引用已撤。） */
export function isElevenLabsVoice(baseUrl: string): boolean {
  return /elevenlabs\.io/i.test(baseUrl.trim());
}

/** MiniMax 音色目录（系统音色，voice_id ＋ 中文名）。 */
export const MINIMAX_VOICES: { value: string; label: string }[] = [
  { value: "male-qn-qingse", label: "青涩青年" },
  { value: "male-qn-jingying", label: "精英青年" },
  { value: "male-qn-badao", label: "霸道青年" },
  { value: "male-qn-douni", label: "逗趣青年" },
  { value: "female-shaonv", label: "少女" },
  { value: "female-yujie", label: "御姐" },
  { value: "female-chengshu", label: "成熟女性" },
  { value: "female-tianmei", label: "甜妹" },
  { value: "presenter_female", label: "播报女声" },
  { value: "presenter_male", label: "播报男声" },
  { value: "audiobook_male_1", label: "独白男声" },
  { value: "audiobook_male_2", label: "说书人" },
];

/** 十六进制字符串转 Blob（MiniMax 返回的 audio 字段是 hex 编码）。 */
function hexToBlob(hex: string, type: string): Blob {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new Blob([bytes], { type });
}

/** 依文本主语言选 language_boost：含假名按日文，含汉字按中文，其余交给模型。
 *  明确语言可避免外语音色把中文汉字按其母语读音念（如日文音读）。 */
function miniMaxLanguageBoost(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return "Japanese";
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  return "auto";
}

/** 经 MiniMax 专用接口合成语音（POST /t2a_v2?GroupId=…，响应 audio 为 hex）。 */
async function requestSpeechViaMiniMax(
  base: string,
  api: ChatApiSettings,
  text: string,
  extras: VoiceApiExtras,
): Promise<string> {
  const url = `${base}/t2a_v2${api.groupId?.trim() ? `?GroupId=${api.groupId.trim()}` : ""}`;
  // MiniMax 参数范围：语速 0.5–2、音调 -12–12（半音）；越界会被拒收，做好钳制。
  const speed = Math.min(2, Math.max(0.5, extras.speed));
  const pitch = Math.min(12, Math.max(-12, Math.round(extras.pitch * 12)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: api.model,
        text,
        stream: false,
        language_boost: miniMaxLanguageBoost(text),
        voice_setting: {
          voice_id: extras.voice,
          speed,
          vol: 1,
          pitch,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("合成超时（语音生成较慢，可稍后再试）");
    }
    throw new Error(err instanceof Error ? err.message : "网络请求失败");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(await readErrorMessage(res));
  let data: {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: string };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("MiniMax 接口返回了无法解析的内容");
  }
  // MiniMax 把业务错误放在 base_resp（HTTP 仍是 200）。
  if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax：${data.base_resp.status_msg ?? "合成失败"}`);
  }
  const hex = data.data?.audio;
  if (!hex) throw new Error("MiniMax 接口没有返回音频");
  const blob = hexToBlob(hex, "audio/mpeg");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("音频读取失败"));
    reader.readAsDataURL(blob);
  });
}

/** ElevenLabs 的语速只认 0.7–1.2（超出会被它拒收，所以先钳好）。 */
const ELEVEN_SPEED_MIN = 0.7;
const ELEVEN_SPEED_MAX = 1.2;

/** 把 0–1 的档位（稳定性／风格）钳好；旧存档缺这一格、或值不是数时退回默认。
    角色级 voiceOverride 是**整份替换**（不是合并），从前存下的那份没有这两格，
    所以这里必须防一手，不能直接拿它算。 */
function clampUnit(value: number | undefined, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * 经 ElevenLabs 官方接口合成语音（POST /v1/text-to-speech/{voice_id}）。
 *
 * 跟 OpenAI 那套**不是一回事**，三处不一样：
 * - 认证走 `xi-api-key`，不认 `Authorization: Bearer`；
 * - 音色那格填的是 **voice_id**（它网站 Voices 页点开一个音色、复制那串 ID），不是 alloy 那类名字；
 * - 模型那格填 **model_id**：`eleven_v4` 最动情（实时版 `eleven_v4_turbo`），
 *   `eleven_multilingual_v2` 老而稳，`eleven_flash_v2_5` 最快最省。
 *
 * 音调（pitch）它没有这个参数，那一格在这儿不起作用；语速只认 0.7–1.2。
 * 1.9.87 起稳定度（stability）与风格夸张度（style）恒发（默认 0.4／0.4，恩熙定「中」）：
 * 从前是「少发一个少一个错」，但这样一来声音永远是它的中性腔、没语气；现在主动带一点
 * 表现力，设置里可拖。逐句贴合情境的语气，1.9.89 起改成靠台词文字本身（出厂那份提示词
 * 规矩就是「把语气写进文字」，见 DEFAULT_VOICE_PROMPT_TEXT）；方括号音频标签（[whispers]
 * 这类）仍是它的合法指令，用户若写了照认不误。
 */
async function requestSpeechViaElevenLabs(
  base: string,
  api: ChatApiSettings,
  text: string,
  extras: VoiceApiExtras,
): Promise<string> {
  const voiceId = extras.voice.trim();
  if (!voiceId) throw new Error("请先填音色：ElevenLabs 要的是 voice id（Voices 页复制那串）");
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const speed = Math.min(ELEVEN_SPEED_MAX, Math.max(ELEVEN_SPEED_MIN, extras.speed));
  const stability = clampUnit(extras.stability, DEFAULT_VOICE_EXTRAS.stability);
  const style = clampUnit(extras.style, DEFAULT_VOICE_EXTRAS.style);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": api.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: api.model,
        /* 稳定度／风格夸张度**常发**（默认 0.4／0.4）：这是「默认语音要有基本语气」的那一半。
           语速仍旧只在挪过时才发（默认 1 就别去碰它的中性值）；similarity_boost／speaker_boost
           留给它的默认，要细调去它网站上按那个音色调。 */
        voice_settings: {
          stability,
          style,
          ...(speed !== 1 ? { speed } : {}),
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("合成超时（语音生成较慢，可稍后再试）");
    }
    throw new Error(err instanceof Error ? err.message : "网络请求失败");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (!blob.size) throw new Error("接口没有返回音频");
  if (!blob.type.startsWith("audio/")) {
    /* 它出错时也会给 200＋JSON，把原文读出来当原因。 */
    const raw = await blob.text();
    throw new Error(raw.replace(/\s+/g, " ").trim().slice(0, 120) || "接口没有返回音频");
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("音频读取失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 合成一段语音（OpenAI 兼容 POST /audio/speech，返回音频文件；
 * MiniMax 国内／国际版自动走其专用 /t2a_v2 接口；
 * ElevenLabs 官方走其专用 /v1/text-to-speech/{voice_id} 接口）。
 * @param api 语音 API 设定
 * @param text 要念的文字
 * @param extras 语音参数（音色／语速／音调）
 * @returns audio 可直接播放的地址（data: URI）
 */
export async function synthesizeSpeech(
  api: ChatApiSettings,
  text: string,
  extras: VoiceApiExtras,
): Promise<{ audio: string }> {
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填好 Base URL");
  if (!api.model.trim()) throw new Error("请先填好模型名称");

  /* 不认方括号情绪标签的服务商（MiniMax、OpenAI 兼容站）合成前先把标签摘掉，
     只有 ElevenLabs 拿原始带标签的台词（见 stripVoiceAudioTags）。 */
  const plain = stripVoiceAudioTags(text);

  /* MiniMax：专用接口＋团队 ID＋hex 音频，单独处理。
     **语气走它的「自动情绪」**：voice_setting 里不传 emotion，它按台词内容自己挑最自然的
     情绪（官方默认行为），逐句语气天然就有；传死一个 emotion 反而会锁死一种情绪，故不传。 */
  if (isMiniMaxVoice(base)) {
    const audio = await requestSpeechViaMiniMax(base, api, plain, extras);
    return { audio };
  }

  /* ElevenLabs 官方：专用接口＋xi-api-key，单独处理（方括号标签是给它的指令，保留原文）。 */
  if (isElevenLabsVoice(base)) {
    const audio = await requestSpeechViaElevenLabs(base, api, text, extras);
    return { audio };
  }

  const url = base.endsWith("/audio/speech") ? base : `${base}/audio/speech`;

  const body: Record<string, unknown> = {
    model: api.model,
    input: plain,
    voice: extras.voice,
    response_format: "mp3",
  };
  if (extras.speed !== 1) body.speed = extras.speed;
  // 音调不是 OpenAI 标准参数，仅在偏移时以 extra_body 传入（兼容支持的站，不支持的会忽略）。
  if (extras.pitch !== 0) body.extra_body = { pitch: extras.pitch };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("合成超时（语音生成较慢，可稍后再试）");
    }
    throw new Error(err instanceof Error ? err.message : "网络请求失败");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (!blob.size) throw new Error("接口没有返回音频");
  if (!blob.type.startsWith("audio/")) {
    // 有些网关出错时返回 JSON／HTML 而状态码仍是 200，读出来当原因。
    const raw = await blob.text();
    throw new Error(raw.replace(/\s+/g, " ").trim().slice(0, 120) || "接口没有返回音频");
  }
  const audio = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("音频读取失败"));
    reader.readAsDataURL(blob);
  });
  return { audio };
}

/**
 * 拉取模型列表：OpenAI 兼容站走 GET {base}/models，ElevenLabs 走 GET /v1/models。
 * 成功返回模型 id 列表（保持服务商返回顺序）；失败抛出人话错误。
 */
export async function fetchModelList(
  api: Pick<ChatApiSettings, "baseUrl" | "apiKey">,
): Promise<string[]> {
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填好 Base URL 再获取");

  /* ElevenLabs 跟 OpenAI 那套有三处不一样，得单独走一支：
     - 地址是 /v1/models（不是根下的 /models）；
     - 认证头是 xi-api-key，它不认 Authorization: Bearer（发 Bearer 只会拿到 401）；
     - 返回是**顶层数组**，模型名那格叫 model_id（不是 data[].id 那套）。
     摆上这个按钮，是为了让恩熙能亲眼确认 eleven_v4 这类型号到底在不在、是不是真能用。 */
  const eleven = isElevenLabsVoice(base);
  const url = eleven
    ? /\/v1$/i.test(base)
      ? `${base}/models`
      : `${base}/v1/models`
    : base.endsWith("/models")
      ? base
      : `${base}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: eleven
        ? { "xi-api-key": api.apiKey }
        : { ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}) },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时，请稍后再试");
    }
    throw new Error(err instanceof Error ? err.message : "网络请求失败");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      /* OpenAI 兼容站把原因放在 error.message；ElevenLabs 放在 detail.message（有时 detail 直接是字符串）。 */
      const errBody = (await res.json()) as {
        error?: { message?: string } | string;
        detail?: { message?: string } | string;
      };
      detail =
        typeof errBody.error === "string"
          ? errBody.error
          : (errBody.error?.message ??
            (typeof errBody.detail === "string" ? errBody.detail : (errBody.detail?.message ?? "")));
    } catch {
      // 响应体不是 JSON（如网关返回 HTML）就只报状态码。
    }
    throw new Error(detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}（服务商未说明原因）`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("接口返回了无法解析的内容，请检查地址是否填对");
  }
  let ids: string[];
  if (eleven) {
    /* 它那份清单混着 speech-to-speech 之类**不能做 TTS** 的型号，挑进来自会报错；
       有 can_do_text_to_speech 这格的、且明确为 false 的，先剔掉。 */
    const arr = Array.isArray(data) ? (data as { model_id?: unknown; can_do_text_to_speech?: unknown }[]) : [];
    ids = arr
      .filter((m) => m?.can_do_text_to_speech !== false)
      .map((m) => (typeof m?.model_id === "string" ? m.model_id.trim() : ""))
      .filter((id) => id !== "");
  } else {
    const arr = (data as { data?: { id?: string }[] }).data ?? [];
    ids = arr.map((m) => (m.id ?? "").trim()).filter((id) => id !== "");
  }
  if (ids.length === 0) throw new Error("接口没有返回任何模型");
  return ids;
}

/**
 * 判断一张图的画面里是否出现角色本人（旧数据兜底：那时标记还没有开关）。
 * 宁可多带参考图——漏判的代价是长相全凭模型编，比多带一张参考图严重得多。
 */
export function guessUseCharRef(desc: string, charName?: string): boolean {
  /* ⚠️ 认人时必须把**角色名**算进去：提示词要求 TA 用角色名写画面（不许写「他／她／自己」，
     见「描述只写画面里看得见的东西……不用「他／她」，直接写${characterName}」那条），
     只认「自拍／我……」会漏掉一大半——那是「明明画的是它本人、却被判成不出现人物」的根子。 */
  if (charName && charName.length > 0 && desc.includes(charName)) return true;
  return /(自拍|对镜|出镜|身影|本人|自己|我的?(脸|手|背影|侧脸|半身|全身|正面|头发)|我[站坐躺靠走蹲跑抱拿戴穿]|镜头前|举起手机|半身|全身)/.test(
    desc,
  );
}

/** TA 在回复里随附的一笔钱（红包／转账）。 */
export interface MetaMoney {
  type: "redpacket" | "transfer";
  /** 金额（分）。 */
  cents: number;
  /** 随钱一起递过来的那句话（可能为空串）。 */
  note: string;
}

/** 单笔红包／转账的金额上限（分）：20 万元。再大就是模型在胡吹，这笔记不成。 */
const MAX_MONEY_CENTS = 20_000_000;

/** 把「200:买点好吃的」「520.00」「200 元 买奶茶」这类写法拆成金额与留言。 */
function parseMoneySpec(spec: string): { cents: number; note: string } | null {
  const m = /^\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*元?\s*[：:,，、]?\s*([\s\S]*)$/.exec(spec.trim());
  if (!m) return null;
  const cents = Math.round(Number(m[1]) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_MONEY_CENTS) return null;
  return { cents, note: m[2].trim().slice(0, 40) };
}

/**
 * 从回复中提取〔签名〕／〔图片〕／〔语音〕元标记。
 * 标记写在回复末尾（可多个），气泡展示前剥掉；
 * 签名存进会话资料页，
 * 图片／语音由调用方走对应 API 生成后以独立消息发出。
 * 图片标记可带「是否使用参考图」开关（决定是否拿参考图锁定长相）。
 * 括号写法容忍〔〕【】（）[] 等常见变体（模型不总是照抄指令格式）；
 * 标记后紧跟换行时把下一行并进来当内容（「〔图片〕\n描述」）。
 *
 * 1.4.36 起还能收 TA 自己发的红包／转账（〔转账〕200:留言），金额与留言
 * 写在括号里或括号后都认；钱能不能真发出去由调用方看他的零钱定（见 moneys）。
 * 1.4.63 起还认 TA 对我发出去那笔钱的表态（见 claimed／refunded）。
 */
export function extractMetaMarkers(
  reply: string,
  /** 角色名：TA 没在标记里写开关时，兜底认人要用它（见 guessUseCharRef）。 */
  charName?: string,
): {
  /** 剥掉标记后的干净回复（拿去拆条展示）。 */
  clean: string;
  /** TA 更新的签名；没附带则为 null。 */
  signature: string | null;
  /** TA 要发的图片（画面描述；走图文 API 生成）。 */
  images: string[];
  /** 与 images 一一对应：这张图是否用角色参考图锁定长相。 */
  imageRefs: boolean[];
  /**
   * 与 images 一一对应：TA 在标记里**到底写没写**那个开关（诊断面板靠它说真话）。
   * use＝写了「使用参考图」；none＝写了「不使用参考图」；absent＝压根没写、这条是按描述猜的。
   * 没有它，面板只能印一句死文案，把「猜的」说成「TA 写的」。
   */
  imageRefMarks: Array<"use" | "none" | "absent">;
  /** TA 要发的语音（要说的话；走语音 API 合成）。 */
  voices: string[];
  /** TA 自己要发的钱（红包／转账）；真扣账由调用方按他的零钱来定。 */
  moneys: MetaMoney[];
  /**
   * TA 对我发出去的那笔**转账**表态要了：写了〔收下〕就是 true，钱这一刻才进他的零钱。
   * 这是钱真正进他零钱的唯一凭据——没写这一格，钱就还挂在我这边（见 refunded 的注释）。
   * 按类型拆开（1.5.14）：〔收下〕只指转账、〔领取〕只指红包——多笔悬着时
   * 调用方按类型各找各的那笔，防止「他嘴上说收转账、标记却落到红包上」的错位。
   */
  claimedTransfer: boolean;
  /**
   * TA 对我发出去的那个**红包**表态要了：写了〔领取〕就是 true。
   * 跟 claimedTransfer 同理，只是管红包那一类（见它那条注释）。
   */
  claimedRedpacket: boolean;
  /**
   * TA 对我发出去的那笔转账表态不要：写了〔退还〕就是 true，钱原路回我出的那个口袋。
   *
   * 「〔不领〕」**不落这一格**：红包没有退还这一说（跟微信一致：红包只能开、不能退），
   * 他写不领只是「这轮先不领」，钱照旧挂着、他随时能回过头补一个〔领取〕领走
   * ——所以那句话剥掉即可，不当成落定。真的过期由调用方按上下文条数判（见 moneyExpired）。
   */
  refunded: boolean;
  /** 1.10.62：独立成行的图/语音/钱标记把全文切成的文字段（与 insertions 配套使用）。 */
  segments: string[];
  /**
   * 1.10.62 标记夹中间：每个独立成行的标记的插入位置——afterSegment＝它跟在第几段
   * 文字之后，落库时按这个把图/语音/钱插回原位（见 ChatWindow 的穿插落库）。
   * 行内混写（标记与文字同一条）剥出的内容没有位置记录，落库时排最末＝旧行为。
   */
  insertions: Array<{ kind: "image" | "voice" | "money"; idx: number; afterSegment: number }>;
} {
  const images: string[] = [];
  const voices: string[] = [];
  const moneys: MetaMoney[] = [];
  let signature: string | null = null;

  /* 标记单独一行、内容在下一行时先并回同一行（下一行是另一个标记则不动）。
     1.5.47 起把「引用」也算进来：TA 写成「〔引用:原话〕」单独一行、正文在下一行，
     不并回来的话 splitReply 会把标记行和正文拆成两个气泡（引用标记自己占一条空泡）。 */
  /* 1.9.55：标记本身也做繁简／异体兼容。外语聊天开着时，模型会把标记按繁体写
     （恩熙实测到「〔語音〕」），只认简体的话整条标记摘不掉、也触发不了对应功能。 */
  const joined = reply.replace(
    /([〔【（(\[]\s*(?:[签簽]名|(?:[语語]音|音声)|[图圖]片(?:[：:][^)）】\]〕\n]{0,12})?|[红紅]包|[转轉][账賬帳]|引用(?:[：:][^)）】\]〕\n]{0,200})?)\s*[)）】\]〕])[ \t]*\r?\n[ \t]*([^\n〔【]*)/g,
    (_m, tag: string, next: string) => (next.trim() ? `${tag}${next.trim()}` : tag),
  );

  /** 生成某标记的抓取替换器：内容取同一行（到下一个标记开头为止），剥掉前导冒号。 */
  const grab = (name: string, sink: (v: string) => void) => {
    const re = new RegExp(`[〔【（(\\[]\\s*${name}\\s*[)）】\\]〕][ \\t]*([^\\n〔【]*)`, "g");
    return (text: string) =>
      text.replace(re, (_m, s: string) => {
        const v = s
          .trim()
          .replace(/^[：:、]\s*/, "")
          .trim();
        if (v) sink(v);
        return "";
      });
  };

  let claimedTransfer = false;
  let claimedRedpacket = false;
  let refunded = false;

  /* 图片标记可选带「是否使用参考图」开关：〔图片:使用参考图〕描述 ／〔图片:不使用参考图〕描述。
     旧的〔图片〕描述没有开关，按描述内容兜底判断（老消息与不听话的模型都走这条路）。 */
  const imageRefs: boolean[] = [];
  const imageRefMarks: Array<"use" | "none" | "absent"> = [];
  const imageTagRe =
    /[〔【（(\[]\s*[图圖]片\s*(?:[：:]\s*(不?\s*(?:使用|用)[参參]考[图圖]|[无無]需[参參]考[图圖]))?\s*[)）】\]〕][ \t]*([^\n〔【]*)/g;
  /* 红包／转账：金额与留言写在括号里（〔转账:200:留言〕）或括号后（〔转账〕200:留言）都认，
     两处都有就拼起来交给 parseMoneySpec。金额读不出来就整条丢掉（宁可不发，也不能记一笔错账）。 */
  const moneyTagRe =
    /[〔【（(\[]\s*([红紅]包|[转轉][账賬帳])\s*(?:[：:]\s*([^\n〕】）\]]{0,200}?))?\s*[)）】\]〕][ \t]*([^\n〔【]*)/g;

  /* 1.10.62 标记夹中间：先扫「整行就是标记」的行（图片／语音／红包转账——四种会
     变成消息的），按它们把全文切成 segments，insertions 记下每个标记跟在第几段文字
     之后——落库时图/语音/钱就插回原位（见 ChatWindow 的穿插落库）。没有整行标记时
     segments 只有一段、insertions 为空，一切与从前逐字一致。 */
  const insertions: Array<{ kind: "image" | "voice" | "money"; idx: number; afterSegment: number }> = [];
  const segments: string[] = [];
  {
    let buf: string[] = [];
    for (const line of joined.split("\n")) {
      const t = line.trim();
      let m: RegExpMatchArray | null;
      if (
        (m = t.match(
          /^[〔【（(\[]\s*[图圖]片\s*(?:[：:]\s*(不?\s*(?:使用|用)[参參]考[图圖]|[无無]需[参參]考[图圖]))?\s*[)）】\]〕][ \t]*(.*)$/,
        ))
      ) {
        const v = (m[2] ?? "").trim().replace(/^[：:、]\s*/, "").trim();
        if (v) {
          segments.push(buf.join("\n"));
          buf = [];
          const flag = m[1];
          const noUse = flag ? /^(不|[无無]需)/.test(flag) : false;
          images.push(v);
          imageRefs.push(flag ? !noUse : guessUseCharRef(v, charName));
          imageRefMarks.push(flag ? (noUse ? "none" : "use") : "absent");
          insertions.push({ kind: "image", idx: images.length - 1, afterSegment: segments.length - 1 });
          continue;
        }
      }
      if ((m = t.match(/^[〔【（(\[]\s*(?:[语語]音|音声)\s*[)）】\]〕][ \t]*(.*)$/))) {
        const v = (m[1] ?? "").trim().replace(/^[：:、]\s*/, "").trim();
        if (v) {
          segments.push(buf.join("\n"));
          buf = [];
          voices.push(v);
          insertions.push({ kind: "voice", idx: voices.length - 1, afterSegment: segments.length - 1 });
          continue;
        }
      }
      if (
        (m = t.match(
          /^[〔【（(\[]\s*([红紅]包|[转轉][账賬帳])\s*(?:[：:]\s*([^\n〕】）\]]{0,200}?))?\s*[)）】\]〕][ \t]*(.*)$/,
        ))
      ) {
        const spec = [m[2], m[3]].filter((s) => s && s.trim()).join("：");
        const parsed = parseMoneySpec(spec);
        if (parsed) {
          segments.push(buf.join("\n"));
          buf = [];
          moneys.push({ type: /[红紅]包/.test(m[1] as string) ? "redpacket" : "transfer", ...parsed });
          insertions.push({ kind: "money", idx: moneys.length - 1, afterSegment: segments.length - 1 });
          continue;
        }
      }
      buf.push(line);
    }
    segments.push(buf.join("\n"));
  }

  /** 行内混写（标记跟文字挤同一行，不规范写法）的剥除链：独立成行的已在上面抽走，
      这里清段内残余——剥出来的内容没有插入位置，落库时排最末（旧行为）。 */
  const stripInline = (text: string): string => {
    let out = grab("[签簽]名", (v) => {
      signature = v;
    })(text);
    out = out.replace(imageTagRe, (_m, flag: string | undefined, s: string) => {
      const v = s
        .trim()
        .replace(/^[：:、]\s*/, "")
        .trim();
      if (v) {
        images.push(v);
        const noUse = flag ? /^(不|[无無]需)/.test(flag) : false;
        imageRefs.push(flag ? !noUse : guessUseCharRef(v, charName));
        imageRefMarks.push(flag ? (noUse ? "none" : "use") : "absent");
      }
      return "";
    });
    /* 1.9.52：语音标记认繁体「語音」与日文「音声」（外语聊天时模型会把标记按外语写）。 */
    out = grab("(?:[语語]音|音声)", (v) => voices.push(v))(out);
    out = out.replace(moneyTagRe, (_m, kind: string, inside: string | undefined, after: string) => {
      const spec = [inside, after].filter((s) => s && s.trim()).join("：");
      const parsed = parseMoneySpec(spec);
      if (parsed) {
        moneys.push({ type: /[红紅]包/.test(kind) ? "redpacket" : "transfer", ...parsed });
      }
      return "";
    });
    /* 收下（表态要）：〔收下〕＝收转账、〔领取〕＝领红包，两个词各管各的一类（1.5.14 拆开：
       原先两种标记混作一个信号，多笔悬着时谁排最后落谁头上，出现过「他说收转账、
       标记落到红包上」的错位）。调用方按类型找对应那笔落账。
       〔已收下〕〔已领取〕是模型常见的变体写法，一并认。 */
    out = out.replace(/[〔【（(\[]\s*已?(?:收下|[领領]取)\s*[)）】\]〕]/g, (mm: string) => {
      if (/[领領]取/.test(mm)) claimedRedpacket = true;
      else claimedTransfer = true;
      return "";
    });
    /* 退还（表态不要）：只有转账有这一说，叫〔退还〕，钱原路退回。
       红包那侧的〔不领〕**不算退还**（跟微信一致：红包只能开、不能退）——写不领只是
       「这轮先不领」，钱继续挂着、他随时能回头补〔领取〕，所以只把字剥掉、不落标记。 */
    out = out.replace(/[〔【（(\[]\s*(?:已?退[还還]|不[领領])\s*[)）】\]〕]/g, (mm: string) => {
      if (!/不[领領]/.test(mm)) refunded = true;
      return "";
    });
    return out;
  };

  // 剥掉标记后收尾的空行、行尾空白。
  const final = segments
    .map(stripInline)
    .join("\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    clean: final,
    signature,
    images,
    imageRefs,
    imageRefMarks,
    voices,
    moneys,
    claimedTransfer,
    claimedRedpacket,
    refunded,
    segments,
    insertions,
  };
}

/**
 * 从**拆好的气泡**里摘出引用标记（1.5.47：TA 也会引用回复）。
 *
 * 跟 extractMetaMarkers 那批标记不同：那批写在回复末尾、一轮一个；引用标记
 * 写在**某一条气泡的开头**、跟着这一条走——所以只能在 splitReply 拆完条之后再摘，
 * 摘到谁头上就贴到谁的气泡上方（见 ChatWindow 的引用块）。
 *
 * 开头那种照旧优先（正文接在标记后面）；标记夹在正文中间时也认（1.10.11，见 reInline）。
 * 只摘**带括号的完整标记**，裸的一句「引用：…」当普通文字、不碰，免得把 TA 真说的话剪掉。
 * 摘完只剩空壳的（TA 把标记单独占了一条）直接丢掉，不留空气泡。
 *
 * @returns parts 摘干净的气泡；quotes 与之一一对应（没引用的为 undefined）。
 */
export function extractBubbleQuotes(parts: string[]): {
  parts: string[];
  quotes: Array<string | undefined>;
} {
  /* 括号写法容忍〔〕【】（）[] 各种变体，冒号可有可无（模型不总照抄格式）， ｜ 详细见 docs/施工日志.md */
  const reWrapped = /^[ \t]*[〔【（(\[]\s*引\s*用\s*[：:]?\s*([^\n〔【)）】\]〕]{1,120}?)\s*[)）】\]〕][ \t]*/;
  const reLabel = /^[ \t]*[〔【（(\[]\s*引\s*用\s*[：:]?\s*[)）】\]〕][ \t]*[：:、]?[ \t]*([\s\S]+)$/;
  /* 1.10.11：标记不一定写在气泡开头。模型也常把它夹在正文中间，例如
     「我没凶你你少栽赃我〔引用:是 我就是故意的。〕知道你故意的我还上当」——
     开头那两条锚定正则够不着（可流式预览那边本就按「任意位置」剃，见
     stripMetaMarkersForPreview，于是预览里干干净净、转正那刻标记才冒出来，
     正是「引用掉出来了」）。这里补一条不锚定的兜底：整条里只要有完整的
     〔引用:原话〕，就摘出来贴到气泡上方。 */
  const reInline = /[〔【（(\[]\s*引\s*用\s*[：:]?\s*([^\n〔【)）】\]〕]{1,120}?)\s*[)）】\]〕]/;
  const out: string[] = [];
  const quotes: Array<string | undefined> = [];
  /* 引用独占一条（② 那种：标签后面没正文）时，这条引用**顺延挂到下一条**气泡上——
     TA 常写成「【引用】我：原话」一条、「接着说的话」另一条；不顺延就白引了。 */
  let pending: string | undefined;
  for (const p of parts) {
    const wrapped = p.match(reWrapped);
    const labeled = wrapped ? null : p.match(reLabel);
    let quote: string | undefined;
    /* ① 的正文在括号后面；② 的正文本来就没有（原话已经占掉整条）。 */
    let rest = "";
    if (wrapped) {
      quote = wrapped[1].replace(/^[：:、]\s*/, "").trim();
      rest = p.slice(wrapped[0].length).trim();
    } else if (labeled) {
      quote = labeled[1].replace(/^[：:、]\s*/, "").trim();
    } else {
      const inline = p.match(reInline);
      if (inline?.index !== undefined) {
        quote = inline[1].replace(/^[：:、]\s*/, "").trim();
        /* 摘掉标记后两截正文会直接黏上，中间留一个空格分开。 */
        rest = `${p.slice(0, inline.index)} ${p.slice(inline.index + inline[0].length)}`
          .replace(/[ \t]{2,}/g, " ")
          .trim();
      }
    }
    if (quote === undefined) {
      out.push(p);
      quotes.push(pending || undefined);
      pending = undefined;
      continue;
    }
    if (rest) {
      out.push(rest);
      quotes.push(quote || pending || undefined);
      pending = undefined;
    } else if (quote) {
      pending = quote;
    }
    /* 既没正文也没摘出引用：这是条空壳，丢掉，不留空气泡。 */
  }
  return { parts: out, quotes };
}

/** 心声块里那几行小标题的前缀（1.5.65，1.5.74 改名；1.7.92 换成私密心声页真正要的那几格）。
 *  一行一个，写在最前面，认得出就摘走。 */
const SNAPSHOT_LABELS: {
  to: "voice" | "mood" | "desire" | "fear" | "junk";
  re: RegExp;
}[] = [
  /* 八根那一行（旧写法）：老模型偶尔还照老账写一行「驱动力：朝思暮想+6」。
     1.7.92 八根拆掉后这一行没有去处，认成 junk ＝ **认得出、摘走、丢掉**——
     不认的话整行会落进心声正文，读起来像人话里夹了一串名字加数字。
     （1.5.74 之前这行叫「情绪」、装的是旧那六个名字；两种写法都在这儿收走。） */
  { to: "junk", re: /^(?:[驱驅][动動]力?|[劲勁][儿兒]|此刻的[驱驅][动動]|此刻的[劲勁][儿兒]|八[维維]|(?:六[维維])?情[绪緒]值?)\s*[:：]\s*/ },
  /* 好感度（旧账的一行，**1.7.97 这一栏撤掉**——恩熙：「我们现在已经没有好感度了，
     你把好感度留着干什么呢？」）：老模型照老账写回来的一行仍认，认成 junk ＝ 摘走丢掉。 */
  { to: "junk", re: /^(?:好感度|好感)\s*[:：]\s*/ },
  /* 环境／穿着／动作（**恩熙 2026-10-06 全部删掉**：「环境以及备忘录，我们得先删除」）：
     这几行不再写、不再存，但老模型照老账写回来的一行仍认，认成 junk ＝ 摘走丢掉，
     免得整行落进心声正文（跟上面好感度、最想做的事那两条一样的处理）。 */
  { to: "junk", re: /^(?:[环環]境|周遭|身[边邊]的[样樣]子|此刻的[样樣]子)\s*[:：]\s*/ },
  { to: "junk", re: /^(?:穿[着著]|衣[着著]|穿搭|身上的[样樣]子)\s*[:：]\s*/ },
  /* 心情（1.7.92）：一句话，不继承——它讲的就是这一刻。 */
  { to: "mood", re: /^(?:心情|此刻的心情|情[绪緒]状[态態])\s*[:：]\s*/ },
  /* 欲望与怯念（1.7.92）：私密心声页「私藏」页签那两格，只写给他自己看。 */
  { to: "desire", re: /^(?:[欲慾]望|此刻的[欲慾]望|私念|心[里裡裏]的念[头頭]|[压壓]在心[里裡裏]的念[头頭])\s*[:：]\s*/ },
  { to: "fear", re: /^(?:怯念|不敢想|不敢[细細]想|最怕的|怕的事)\s*[:：]\s*/ },
  /* 细处（备忘录）与日记（**恩熙 2026-10-06 一并删掉**）：同样认成 junk，摘走丢掉。 */
  { to: "junk", re: /^(?:[细細][处處]|[细細][节節]|她的小事|[记記][着著]的[细細][节節])\s*[:：]\s*/ },
  { to: "junk", re: /^(?:日[记記]|今天[记記]|想[记記]下)\s*[:：]\s*/ },
  /* 最想做的事（1.5.96，**1.7.96 这一栏撤掉**——恩熙：「我们没有最想做的事这一个栏目吧」）：
     老模型照老账写回来的一行仍认，认成 junk ＝ 摘走丢掉，别让它落进心声正文里。 */
  { to: "junk", re: /^(?:此刻最想做的事|最想做的事|最想做的|想做的事)\s*[:：]\s*/ },
  { to: "junk", re: /^(?:行[为為][动動]作|行[为為]|[动動]作|[动動]作神[态態]|神[态態])\s*[:：]\s*/ },
  { to: "voice", re: /^(?:角色心[声聲]|[内內]心[独獨]白|心[声聲]|心[里裡裏][话話])\s*[:：]\s*/ },
];

/**
 * 账行的「标签」可能被模型包上各种壳（1.9.56）：
 *   · 加粗／斜体：`**环境**：`、`*心情*：`
 *   · 包裹符：`【细处】：`、`〔日记〕：`、`[环境]：`
 *   · 行首列表点：`- 日记：`、`· 细处：`
 *   · 标签与冒号之间夹一段括号注解：`日记（你上一次写的全文）：`
 *   · 破折号当分隔符：`细处 - 记得买花`
 *
 * 原先的 SNAPSHOT_LABELS 只认「标签词 + 紧跟冒号」，上面这些变体一律认不出。而
 * parseInnerSnapshot 的规矩是**认不出的行落进上一个已经开的桶**——账里「细处／日记」
 * 正排在「怯念」之后，于是它俩全堆进了怯念（恩熙 2026-10-03 报的「细处跟日记都跑到
 * 怯念去」）。这个函数把壳剥掉、还原成「标签：」的规范形，再交给 SNAPSHOT_LABELS 认。
 * 认不出标签的行，调用方仍旧用**原行**入桶（内容一个字不改）。
 */
function normalizeLedgerLine(line: string): string {
  let s = line.trimStart();
  /* 行首装饰：引用符、加粗／斜体星号、反引号、列表点、项目符号、破折号。 */
  s = s.replace(/^[\s>*_`·•・\-–—]+/, "");
  /* 包裹符把整个标签词框起来：【标签】：／〔标签〕：／[标签]：／「标签」： */
  const bracketed = /^[【〔\[「『]\s*(.{1,12}?)\s*[】〕\]」』]\s*[*_]*\s*[:：]\s*/.exec(s);
  if (bracketed) s = `${bracketed[1]}：` + s.slice(bracketed[0].length);
  /* 标签词与冒号之间的收尾装饰：**环境** 被行首那步吃掉前半后，剩「环境**：」。 */
  s = s.replace(/^([^\s:：*_」』】〕\]]{1,12})[*_」』】〕\]]{1,3}\s*[:：]\s*/, "$1：");
  /* 标签与冒号之间夹一段括号注解：日记（你上一次写的全文）： → 日记： */
  s = s.replace(/^([^\s:：()（）{}｛｝]{1,12})\s*[（(][^()（）]{0,20}[)）]\s*[:：]\s*/, "$1：");
  /* 破折号当分隔符：细处 - 记得买花 → 细处：记得买花 */
  s = s.replace(/^([^\s:：()（）*_\-–—]{1,12})\s*[-–—]\s+/, "$1：");
  return s;
}

/**
 * 认一认「正文最前面那截账」，认出来就切走（1.5.88）。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
/* 账块前面最多忍受几段「不像账」的段。3 是照心声那个 120 字上限挑的：写到上限也就
   一两段，留点余量。调大只会更容易误伤正常聊天，别随便加。 */
const LEDGER_LEAD_MAX = 3;
function stripLeadingLedger(text: string): { ledger: string; rest: string } | undefined {
  /* 先把每段的起止位置量出来（含段与段之间那几行空行）。 */
  const bounds: Array<[number, number]> = [];
  const gap = /\r?\n[ \t]*\r?\n/g;
  let segStart = 0;
  let m: RegExpExecArray | null;
  while ((m = gap.exec(text)) !== null) {
    bounds.push([segStart, m.index]);
    segStart = m.index + m[0].length;
  }
  bounds.push([segStart, text.length]);
  let cut = -1;
  let lead = 0;
  for (const [from, to] of bounds) {
    const seg = text.slice(from, to).trim();
    if (!seg) continue;
    /* 只看段首那一行（账的第一行一定是标签行），并把壳剥掉再认。 */
    const firstLine = normalizeLedgerLine(seg.split(/\r?\n/, 1)[0]);
    if (SNAPSHOT_LABELS.some((l) => l.re.test(firstLine))) {
      cut = to;
      continue;
    }
    /* 账块已经开了、又碰上不像账的段 ⇒ 账到头了，后面全算正文。 */
    if (cut >= 0) break;
    lead += 1;
    if (lead > LEDGER_LEAD_MAX) return undefined;
  }
  if (cut < 0) return undefined;
  return { ledger: text.slice(0, cut), rest: text.slice(cut) };
}

/**
 * 把心声块里的字拆成「心声」与「内心快照」两半（1.5.65）。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export function parseInnerSnapshot(raw: string): {
  voice: string;
  snapshot: InnerSnapshot | undefined;
} {
  const buf: Record<"voice" | "mood" | "desire" | "fear" | "junk", string[]> = {
    voice: [],
    mood: [],
    desire: [],
    fear: [],
    junk: [],
  };
  /* 没写标签的行默认归心声：老写法（整块就是心声）走的正是这条。 */
  let current: keyof typeof buf = "voice";
  let sawLabel = false;
  for (const line of raw.split(/\r?\n/)) {
    /* 1.9.56：认标签先用 normalizeLedgerLine 剥一层壳（加粗／包裹符／列表点／
       括号注解／破折号），否则「细处」「日记」「环境」的变体认不出，会被当成
       正文塞进上一个已开的桶（怯念）——恩熙 2026-10-03 报的错位就是这么来的。
       认不出的行照旧用**原行**入桶，内容一字不动。 */
    const head = normalizeLedgerLine(line);
    const hit = SNAPSHOT_LABELS.find((l) => l.re.test(head));
    if (hit) {
      sawLabel = true;
      current = hit.to;
      buf[hit.to].push(head.replace(hit.re, ""));
      continue;
    }
    buf[current].push(line);
  }

  const tidy = (s: string) => toFullWidthPunct(stripNarrationAsterisks(s).trim()).trim();
  const voice = tidy(buf.voice.join("\n"));

  const mood = tidy(buf.mood.join("\n"));
  const desire = tidy(buf.desire.join("\n"));
  const fear = tidy(buf.fear.join("\n"));

  const snapshot: InnerSnapshot | undefined =
    sawLabel && (mood || desire || fear)
      ? {
          ...(mood ? { mood } : {}),
          ...(desire ? { desire } : {}),
          ...(fear ? { fear } : {}),
        }
      : undefined;

  return { voice, snapshot };
}

/**
 * 从回复**开头**摘下「心声」块（1.5.60：`<think>…</think>`）。
 *
 * 历次改动与回退记录见 docs/施工日志.md。
 */
export function extractInnerVoice(reply: string): {
  clean: string;
  innerVoice: string | undefined;
  snapshot: InnerSnapshot | undefined;
} {
  const closed = reply.match(
    /^[ \t\r\n]*<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>[ \t]*\r?\n?/i,
  );
  /* 1.5.88：正文最前面那一截「账」不管带不带标签都要拎走——标签里那截（closed[1]）和
     正文开头那截（stripLeadingLedger 认出来的）合成一份再交给 parseInnerSnapshot。 */
  let ledger = closed ? closed[1] : "";
  let rest = closed
    ? reply.slice(closed[0].length)
    : /* 闭标签没到（模型漏写／半途停止）：只剥那个裸开标签，后面一个字都不丢。 */
      reply.replace(/^[ \t\r\n]*<\s*think(?:ing)?\s*>[ \t]*/i, "");
  const ahead = stripLeadingLedger(rest);
  if (ahead) {
    ledger = ledger.trim() ? `${ledger.trim()}\n\n${ahead.ledger.trim()}` : ahead.ledger.trim();
    rest = ahead.rest;
  }
  /* 1.10.43：模型有时把「账」写到 </think> 外面（主动开口那趟尤其常见：心声留在
     标签里、账却接在闭标签之后又拿 </think> 收尾）。stripLeadingLedger 认账时是
     「整段切走」，这个吊在末尾的闭标签就跟着日记一起被切进 ledger，「记录」页的
     日记末尾便挂着一个 </think>（恩熙 2026-10-05 截图报的「格式掉了」）。账是给人
     读的，标签一个都不该留——整份剃干净，落库与心声页都干净。 */
  ledger = ledger.replace(/<\/?\s*think(?:ing)?\s*>/gi, "");
  const clean = rest.replace(/^[ \t\r\n]+/, "");
  if (!ledger.trim()) {
    return { clean, innerVoice: undefined, snapshot: undefined };
  }
  /* 心声是给人读的，跟正文过同一趟归正（半角标点折全角、剪成对的星号旁白），
     读着才跟气泡里的字一个样。 */
  const parsed = parseInnerSnapshot(ledger);
  return {
    clean,
    innerVoice: parsed.voice || undefined,
    snapshot: parsed.snapshot,
  };
}

/* 2026-10-06：`lastInnerSnapshot`（往回找最近一份「环境」）与 `innerLedgerBlock`
   （把细处清单＋日记全文回送模型）随环境／细处／日记三栏一并删——账里只剩心情、欲望、
   怯念，三格都不继承，也不必再往模型眼前递那份清单。 */

/* 1.7.92：原 `innerSnapshotBase`（把八根按真实小时数往下带的那个底）随八根一并删。
   账里剩下的几格都不按时间衰减：好感度要涨要落都由 TA 自己报，心情欲望怯念讲的都是
   当轮——没有哪一格该让时间去动它。 */

/* 1.7.96：原来这里还有一整套「最想做的事」收口（WISH_CHANNEL_RES 认频道 + settleWish
   按真实凭据判做成没有），喂给念头池 wishPool.ts。账里那一栏撤掉之后（恩熙：我们没有
   这个栏目），这一套连同 wishPool.ts 一并删。 */
