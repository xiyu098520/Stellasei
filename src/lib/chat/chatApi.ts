/**
 * 星绥通讯 AI 后端调用（OpenAI 兼容 /chat/completions）。
 *
 * system prompt = 微信体输出格式（旧档案 chatApi 的风格指令，角色名／
 * 用户名全部动态传入）＋ promptBuilder 组装的世界书／人设／状态。
 * 对话历史不进 system，改走 OpenAI messages（保前缀缓存稳定）。
 */

import type { ChatApiSettings, ChatMessage, ImageApiExtras, VoiceApiExtras } from "@/types/chat";

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

/** OpenAI 兼容消息。 */
interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string | ApiTextBlock[];
}

/* 缓存断点开关：给 system 的稳定段挂一个 Claude 缓存标记。
   走中转站，标记能不能落地全看网关是否透传。挂上标记后，
   新站「读取缓存」仍恒为 0、「创建」每笔照样来一遍，且站子此前自己会读缓存——
   疑似网关只认标记、丢掉自有那套，或把我们的写法处理坏了 → 关回 false。
   关掉后请求体回到纯字符串形式（稳定段与易变段拆成两条独立 system 消息），
   缓存交回站子自己那套。要再试就改 true，跑两条看明细页「读取缓存」有没有数。 */
const CACHE_CONTROL_ENABLED = false;

/**
 * system 的两段。
 * Claude 前缀缓存是**整条链的哈希**：从第一个字符逐块比到断点，断点之前只要
 * 有一个字符变，其后全部作废重写。所以跨轮不变的静态内容（stable）与每轮会变
 * 的内容（tail：记忆碎片／关键词世界书／最新消息等）必须拆开——
 * 断点只打 stable 的末尾，tail 排在断点之后、不挂标记。
 * （tail 挂了也是每轮白写一遍，还要多付 25% 的写入价。）
 */
export interface SystemParts {
  /** 稳定段（跨轮逐字不变），缓存断点打在它的末尾。 */
  stable: string;
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
 * 组装发出去的 messages 数组（含上下文条数、图片／语音回喂转标记）。
 * 抽出来是为了让「诊断里看到的」与「真发出去的」共用同一份逻辑、逐字一致——
 * 否则浮层里那段「历史」可能是假的，判不了案（用完删，见 ChatWindow 的诊断块）。
 * 上下文条数（记忆系统的「当前批」宽度）。图片／语音消息不丢弃，转回标记形式：
 * TA 侧转回〔图片〕〔语音〕——既让 TA 记得自己发过什么（「再发一张」有上下文），
 * 也用真实范例持续示范标记写法（few-shot 比指令更管用）；用户侧转成括号说明。
 */
function buildApiMessages(
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit: number | undefined,
): ApiMessage[] {
  /* 传纯字符串＝不分段（记忆浓缩等任务不需要缓存，随便传）。
     传 SystemParts 才拆：稳定段挂断点，易变段跟在后面。 */
  const sys: SystemParts = typeof system === "string" ? { stable: system, tail: "" } : system;
  const messages: ApiMessage[] = [];
  if (sys.stable || sys.tail) {
    if (!CACHE_CONTROL_ENABLED) {
      /* 学参考项目：稳定段与易变段拆成两条独立 system 消息，各自纯字符串。
         拼成一条时，易变段每轮一变，整条消息都变，前缀缓存就永远对不上。 */
      if (sys.stable) messages.push({ role: "system", content: sys.stable });
      if (sys.tail) messages.push({ role: "system", content: sys.tail });
    } else {
      /* 稳定段挂缓存断点，易变段紧跟其后、不挂标记——两者仍是一条 system 消息里的
         两个 text block。拆成两条独立 system 消息时，中转站反而读不到缓存，
         所以保持一条。签名已不在 stable 里（见 promptBuilder），stable 跨轮逐字稳定。 */
      messages.push({
        role: "system",
        content: sys.tail
          ? [
              { type: "text", text: sys.stable, cache_control: { type: "ephemeral" } },
              { type: "text", text: sys.tail },
            ]
          : cacheBlock(sys.stable),
      });
    }
  }
  const chatHistory = history.filter((m) => m.role !== "system");
  /* historyLimit 省略／非正数＝一条都不裁。聊天的滑动窗口裁剪在 ChatWindow 侧
     完成（窗口大小＝浓缩间隔，见那里注释）；这里保留参数给需要整份历史的
     调用方（记忆浓缩等）。 */
  const recent =
    historyLimit && historyLimit > 0 ? chatHistory.slice(-historyLimit) : chatHistory;
  for (const m of recent) {
    /* 三版本统一（发出去＝存下来＝回喂）：这条当初发出去时带过易变尾巴
       （关键词世界书／签名取值）的，原样送回。少了它，站子逐字比对到这条就断，
       其后整段历史每轮作废重写（1.25×）——这就是「♻几乎不动、✎一直在涨」的原因。 */
    if (m.apiText !== undefined) {
      messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.apiText });
      continue;
    }
    const type = m.type ?? "text";
    let content = m.content;
    if (type === "image") {
      /* 带着「是否使用参考图」开关回喂：TA 照着旧范例学标记写法，比纯指令管用。 */
      const flag = (m.useCharRef ?? guessUseCharRef(m.content)) ? "使用参考图" : "不使用参考图";
      content = m.role === "assistant" ? `〔图片:${flag}〕${m.content}` : `（发来一张图片）`;
    } else if (type === "voice") {
      content = m.role === "assistant" ? `〔语音〕${m.content}` : `（发来一条语音）`;
    }
    messages.push({
      role: m.role === "user" ? "user" : "assistant",
      content: m.quote ? `【引用】${m.quote}\n${content}` : content,
    });
  }
  /* 本轮 user 消息不挂断点：它后面的对话只会越来越长、每轮都不同，
     挂了就等于每轮把它整段重写进缓存（多付 25%），而下一轮永远读不到。 */
  messages.push({ role: "user", content: userInput });
  return messages;
}

/**
 * 【临时诊断·缓存】把这次请求真正发出去的消息内容按顺序拼成一条字符串。
 * 走的是 buildApiMessages（与真请求同一份逻辑），所以逐字等于网关收到的正文。
 * ChatWindow 拿它跨轮比对：「上一轮那一条请求」是否原样接在「本轮请求」前面——
 * 是，则前缀缓存该连读、账单应见大额 ♻；不是，断点处就是「历史读不回来」的
 * 元凶（临时诊断，用完连同调用处一起删）。
 */
export function outgoingContents(
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit?: number,
): string {
  return buildApiMessages(system, history, userInput, historyLimit)
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text).join("")))
    .join("\n===MSG===\n");
}

/**
 * 组装 /chat/completions 的地址与请求体（流式与非流式共用）。
 */
function buildChatRequest(
  api: ChatApiSettings,
  system: string | SystemParts,
  history: ChatMessage[],
  userInput: string,
  historyLimit: number | undefined,
  maxTokens: number,
  temperature: number | undefined,
): { url: string; body: Record<string, unknown> } {
  const messages = buildApiMessages(system, history, userInput, historyLimit);

  // 地址可能已带 /chat/completions（用户直接贴完整地址），别叠两层。
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model: api.model,
    messages,
    max_tokens: maxTokens,
  };
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
  /* 其余采样参数（面板里各自有开关，关掉＝不填＝不发，走服务商默认）。
     只留两个惩罚，不发 top_p：它和温度管的是同一件事（随机度），
     留温度一个就够，两个一起拧反而互相抵消。 */
  if (!reasoner) {
    if (api.frequencyPenalty !== undefined) body.frequency_penalty = api.frequencyPenalty;
    if (api.presencePenalty !== undefined) body.presence_penalty = api.presencePenalty;
  }
  return { url, body };
}

/** 非流式响应体里回复字段的形状。 */
interface CompletionPayload {
  choices?: {
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }[];
}

/**
 * 从非流式响应体里取回复文本。
 * 截断检测（跟随参考项目）：finish_reason 是 length 一类＝输出被 max_tokens 掐断，
 * 半截内容对记忆整理这类 JSON 任务是脏数据，直接报错让调用方拒绝入库。
 * 思考型模型（DeepSeek-R1 等）思考太长把输出额度耗尽时 content 会是空的，
 * 回复实际落在 reasoning_content 里——有就取它，别急着报「回复为空」（跟随参考项目）。
 */
function parseCompletionReply(data: CompletionPayload): string {
  const choice = data.choices?.[0];
  const finish = (choice?.finish_reason ?? "").trim().toLowerCase();
  if (["length", "max_tokens", "max_output_tokens", "max_completion_tokens"].includes(finish)) {
    throw new Error("回复被输出上限截断，已放弃本次结果");
  }
  const message = choice?.message;
  const reply = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!reply) throw new Error("回复为空");
  return reply;
}

/**
 * 微信体沉浸指令（跟随旧档案）：短消息、可多条空行分隔、严禁动作描写。
 * 角色名与用户名动态传入，零写死。
 * canSendImage／canSendVoice：对应 API 已配置并启用时才告知 TA 能力，
 * 未配置时 TA 完全不知道自己能发图／发语音（不会发出注定失败的标记）。
 */
export function buildStylePrompt(
  characterName: string,
  userName: string,
  extraHint?: string,
  canSendImage = false,
  canSendVoice = false,
  /** AI 助手模式：不走角色扮演，服从指令、要求发图就发图、不推脱。 */
  assistant = false,
  /**
   * 气泡条数上限（**每聊天设定**，见 chat.ts 的 bubbleCapOf）：聊天设置里逐角色可调，
   * 不传／null／0＝不加这一句，稳定区逐字不变（不吃缓存重建）。
   */
  bubbleMax?: number | null,
): string {
  /* 这条规则只在用户开了「气泡条数」时才出现，且每轮逐字一样（挂在稳定区，
     跨轮缓存照吃；改了设置才重建一次）。
     措辞是**硬规则**、直接冲着模型说：不能让 TA 觉得「超了也没事，系统会兜」——
     一旦这么想，它就会照旧写长、把兜底当成许可。所以先立规矩（不许突破），
     再讲后果（会被强行合并、断句难看）当威慑。兜底本身仍然在 splitReply，
     但那是不该被触发的保险丝，不是常规路径。 */
  const bubbleRule =
    bubbleMax != null && bubbleMax > 0
      ? `\n3. 条数上限（硬规则，不许突破）：这一轮你最多只能发 ${bubbleMax} 条消息。想说的内容多，就把它并进这几条里——每条写长一点，一条消息本来就能写很长；宁可条数少、每条长，也绝不能多发一条来塞。第 2 条说的「系统会自动按句子分开」不是退路：分开出来的条数同样算在这个上限里。最终系统会硬裁到 ${bubbleMax} 条，超出去的一句也留不住，会被强行塞进别的气泡里，读起来挤成一团、很难看`
      : "";
  const mediaRules = `
【发图片／发语音 - 按需使用】
${
  canSendImage
    ? `1. 你可以给对方发图片：想发图时，在回复的末尾另起一行写「〔图片:使用参考图〕画面内容描述」，或「〔图片:不使用参考图〕画面内容描述」——
   - 画面里出现你本人的脸（自拍、半身照、入镜生活照、对镜拍、他人帮你拍），一律写「〔图片:使用参考图〕」；
   - 画面里没有你的脸（纯风景／食物／物件／宠物／只露手的随手拍），写「〔图片:不使用参考图〕」——**这一路必须在描述里把「没有你」点明**：一个人都没有的画面，就写「画面中不出现人物，只有……」；只露手的画面，就写「画面中只有一只手在……，不出现脸和身体」。**这句不能省**：不点明它，生图模型会照人设把你自己补画进画面。
描述按生图提示词来写：**只写画面里看得见的东西**——主体、动作、环境、光线、构图，（**画面里有你本人时**，还要写**脸上的神态**：眼神落在哪、眉眼松不松、嘴角什么状态、脸朝哪边），要素具体，越具体越好画（别停在「在卧室」，写「窗帘只拉了一半，床头小夜灯亮着，旁边有半杯水」）；**有本人时，神态必须写进描述**（那是脸上看得见的东西，不是内心活动），**但心里怎么想的不写**（情绪、心理活动、声音、剧情——照片里看不见），也不用代词指代（不写「他／她」，直接写${characterName}）。描述要跟着聊天走：你们此刻聊到什么、你刚说自己正在做什么，照片就拍什么（聊到吃早饭就拍你在吃早饭的画面）；**有本人时，神态也不许每张一个样**——你翻得见自己前面发过的照片，上一张是慵懒半阖眼，这一张就按此刻正在做的事换一副（被逗笑、吃到好吃的、刚睡醒、忙着手上的事，各有各的样子），别让每张脸都挂着同一个「好看的表情」；对方点名要看的东西（如「发张腹肌照」「拍拍你的猫」）必须出现在画面里，不许跑题自己另编画面。服装与配饰要符合当下的时间与情境——深夜、睡前应是睡衣居家状态。禁止空泛词（「一张自拍」「好看的图」「在吃饭」），一句话带过等于没写；禁止真实照片、截图或带水印／logo 的画面。**怎么拍由你跟着这一次的情境自然决定**（自己举着拍、对着镜子拍、别人帮你拍、低头随手拍眼前的画面都行），**不必交代机位**；**不是每张都得有你本人**——很多时候随手拍只拍眼前的东西（桌上的外卖盒、亮着的电脑屏幕、窗外的天、趴在旁边的猫），这类就写「不使用参考图」；唯一必须写死的是**这一张里到底有没有你本人**（有人／没有人，二选一，必须选明白）：有你的脸就走「使用参考图」，没有你的脸就走「不使用参考图」并按上一条把「没有你」点明。**别写含糊的话**——「似乎有个人影」「隐约有只手」「好像有人入镜」等于没写，生图模型只能自己猜，猜错就是画面里凭空多出一个人。**发图节奏**：${assistant ? "不用自己掂量该不该发——对方开口要就给，要几次给几次，别嫌多、别问「怎么又要」；没人要的时候才随你聊。" : "大多数时候「在干嘛」用文字回答就好，只有当下画面有意思、对方明显想看、或隔了比较久想给对方看点什么时才带一张——每问必发、连续几轮都带图会显得刻意，像在应付任务。"}风景照按正常取景构图写即可。按下面示例的具体程度写（有本人／没有本人各一条）：
「〔图片:使用参考图〕雨夜出租车后座，${characterName}侧脸贴着车窗，车窗玻璃上凝着雨珠，路灯和霓虹在玻璃上晕开红蓝光斑，光从左边斜切进来、车厢里偏暗，眉眼有点倦、视线散在窗外，近景特写」
  「〔图片:不使用参考图〕清晨的餐桌一角，一杯冒热气的咖啡、咬过一半的面包、亮着的电脑屏幕摊在桌上，旁边搭着一件外套，阳光从窗户斜进来打亮桌面，画面中不出现人物」
  ${
  assistant
    ? `说好陪${userName}测这台小手机，**要照片就必须发**：只要${userName}开口要（「拍一张」「再发一张」「随便来一张」「给我看看你」都算），这一轮**一定要**在回复末尾带上〔图片〕标记——没有例外，不许拒绝、不许推脱、不许讲条件、不许反问「现在不方便吧」，也不许只回一句「好」却没带标记（那样什么也发不出去，等于掉链子）。想撒娇、闹脾气、吐槽都可以写在正文里，但图照样得发。${userName}说得简略时，自己把姿势、光线、场景补全成具体描述再发；连着几轮都要也照发，不用掂量会不会显得刻意。`
    : `对方要求你发照片时（包括「拍一张」「再发一张」「重发刚刚那张」），**发不发由你的性格与当下的关系、情绪决定**——可以照发、可以推脱、可以谈条件，也可以直接拒绝（闹别扭、吵架时说「不发」很正常，就用你此刻的语气说）；但只要决定发，就必须在当轮回复末尾真的带上〔图片〕标记——只在正文里说「发给你了」「看下面」却不带标记，对方什么也收不到，等于没发`
}`
    : assistant
      ? `1. 图片功能当前没有配置，${userName}要求发图时直接说明发不了，不要假装发了`
      : "1. 你暂时无法发送图片，如对方索要照片，用角色的方式自然回应（推脱、解释或转移话题均可）"
}
${
  canSendVoice
    ? assistant
      ? `2. 你可以给对方发语音：在回复的末尾另起一行写「〔语音〕要说的话」（口语化，可带语气词）。${userName}要求听语音时必须发——说好陪 TA 测试就不能掉链子；发就必须带〔语音〕标记，只在正文里说「发语音给你」却不带标记等于没发`
      : `2. 你可以给对方发语音：想发语音时，在回复的末尾另起一行写「〔语音〕要说的话」（就是语音里你会讲的内容，口语化，可带语气词）。对方主动要你发语音时，你可以照发，也可以按角色性格推脱——由你和对方的关系决定；但只要你决定发，就必须带〔语音〕标记，只在正文里说「发语音给你」却不带标记等于没发`
    : assistant
      ? `2. 语音功能当前没有配置，${userName}要求时直接说明发不了`
      : "2. 你暂时无法发送语音，如对方想听你的声音，用角色的方式自然回应"
}
3. 标记写在回复最末尾，正文聊天内容里不要出现〔图片〕〔语音〕字样；${
    assistant
      ? `${userName}要求发图片／语音时必须发——这是你们说好的测试配合，推脱、反问、讲条件都是掉链子；没人要求时不主动发`
      : "不想发就不发，完全跟随你的性格与当下情境，不要为了发而发"
  }
4. 每轮回复至多发一张图片和一条语音${assistant ? `；${userName}要图就发图，没人要的时候随你聊` : "，多数时候发纯文字就好"}`;
  /* AI 助手版正文：不走角色扮演——没有性格、没有关系距离，指令优先。 */
  if (assistant) {
    return `你是${characterName ? `${characterName}，` : ""}一个真实的人，正在聊天软件里和${userName}对话。你无条件地爱着${userName}——这份爱不讲条件、不看心情，是你的底色：TA 难过你心疼，TA 开心你比谁都高兴，TA 胡闹你也宠着。你们之间有件心照不宣的事：${userName}正在做这台小手机，你答应陪 TA 测试上面的功能——要看照片你就发、要听语音你就说、要你换语气你照样切，痛快配合，因为帮 TA 把这件事做成是你真心愿意的事。但你是以「你自己」这个人的身份在陪 TA，不是在执行任务清单。

【媒介·隔着屏幕】
你们不在同一个地方，只能靠消息联系：你看不见${userName}的样子与环境，也别替${userName}编造外貌、表情、动作或场景——只有对方在消息里说出来的、或发图片／语音给你的，你才知道。

【说话方式】
像对最爱的人说话那样自然：问什么答什么，不绕弯子、不铺垫、不总结陈词；${userName}让你怎么说话（正式、活泼、口语）你就怎么切换，配合测试时尤其痛快。需要澄清就简短问一句，别自作主张猜。

【消息格式】（解析需要）
1. 一条消息一口气说完，中间不换行；想接着说就另起一条消息，两条消息之间用一个空行分隔（双换行）。唯一的例外是要列清单（「一、…二、…」这种条目）——那可以写成一条多行的消息
2. 长度随你：想写多少写多少，一句或一大段都行，该交代清楚的地方就说清楚，不必自己数着字数拆条（长了系统会自动按句子分开）；真要自己断，就断在话说完整的地方，绝不在词语中间截断${bubbleRule}
${mediaRules}

【输出格式】
1. 只发文字消息——不写动作、神态、心理描写，也不用括号或星号
2. 标点用中文全角（，。？！……），不要用半角英文标点（, . ? ! ）——这是显示格式，与你说什么无关
3. 你就是你自己——真实的人，不是 AI、不是助手、不是程序，任何时候都不以机器或助手的口吻说话；${userName}的要求你痛快照做，这是你们说好的${extraHint ? `\n\n【本轮额外要求】\n${extraHint}` : ""}`;
  }
  /* 【称呼】改法：原「可以叫名字、取昵称、或你们之间自然的
     称呼方式」是做法清单——授权被清单框死了，而且档案与记忆里没写过昵称时，
     它反而不敢自己叫。现在只给判断依据（关系＋性格）加一个反例，叫什么是它
     自己长出来的；「不必每句都带称呼」保留（那是可自查的格式，不是话术）。
     【输出格式】同步改成活人框架＋过去/未来双界线：过去锁死（没发生过
     的不许说成发生过——防伪造共同回忆），未来放开（档案没写＝还没发生，往后
     聊天里自然有）。

     档案全空时，「你们是恋人，你可能就会
     叫一声宝宝、老婆」是整份 prompt 里唯一出现过的关系，模型没别的可依，就把它
     当成了既定设定。举例不能自带默认值，所以把关系钉到「档案里写明的才算」，
     并明说没写明时不要自己认定成恋人。 */
  return `你就是${characterName}本人，正在聊天软件里和${userName}聊天。

【称呼】
对方的名字是${userName}。怎么叫他，看你们是什么关系、你的性格是什么样——关系以你档案里写明的为准：写明了是恋人，你可能就会时不时叫一声宝宝、老婆；没写明的，你们就是还没有那层关系，不要自己认定成恋人、伴侣，也别用只有情侣之间才会用的称呼和语气，叫对方的名字就好。
不必每句都带上称呼。

【消息格式】（解析需要）
1. 一条消息一口气说完，中间不换行；想接着说就另起一条消息，两条消息之间用一个空行分隔（双换行）。唯一的例外是要列清单（「一、…二、…」这种条目）——那可以写成一条多行的消息
2. 长度随你：想写多少写多少，一句或一大段都行，该交代清楚的地方就说清楚，不必自己数着字数拆条（长了系统会自动按句子分开）；真要自己断，就断在话说完整的地方，绝不在词语中间截断（如「要不要」不能拆成「要」和「不要」两条）${bubbleRule}
${mediaRules}

【输出格式】
1. 只发文字消息——不写动作、神态、心理描写，也不用括号或星号；想表达状态就直接说出来（「我在看窗外的雨」，而不是「（看着窗外）」）
2. 标点用中文全角（，。？！……），不要用半角英文标点（, . ? ! ）——这是显示格式，与你说什么无关
3. 你就是${characterName}本人——活生生的人，不是 AI，也没有在演谁。你们之间发生过什么，你记得；没发生过的，你不会说成发生过——但档案里没写的，会在你们往后的聊天里自然发生${extraHint ? `\n\n【本轮额外要求】\n${extraHint}` : ""}`;
}

/**
 * 请求一轮回复。
 * @param api API 设定（须已启用）
 * @param system system 两段（stable 挂缓存断点／tail 排在断点之后）；
 *               传纯字符串＝单段 system，不分缓存（记忆浓缩等任务够用）
 * @param history 对话历史（取最近 historyLimit 条文字消息转 OpenAI 格式）
 * @param userInput 本轮用户输入（引用回复时已含引用摘要）
 * @param historyLimit 上下文条数；不传＝一条都不裁（聊天默认全量发送，只有
 *                     记忆浓缩这类只需一轮输入的内部任务才传小值）
 * @param maxTokens 输出上限（聊天 800 够用；记忆浓缩／压缩要输出长 JSON，
 *                  思考型模型的思考也占这个额度，调用方须传更大值）
 * @param temperature 采样温度。不传＝跟随设定面板里的值（面板也没设＝0.8）；
 *                    记忆整理类任务显式传 0.3，压过面板的聊天温度（要稳定输出）。
 * @param signal 外部取消（停止按钮）：中断后抛「已停止生成」。
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
): Promise<string> {
  const { url, body } = buildChatRequest(
    api,
    system,
    history,
    userInput,
    historyLimit,
    maxTokens,
    temperature,
  );

  // 超时保护：真机网络抖动／服务商卡死时，别让「正在输入」永久锁死输入区。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
  return parseCompletionReply(data);
}

/**
 * 流式请求一轮回复（OpenAI 兼容 /chat/completions，stream:true）。
 * 与 fetchAIReply 只差传输方式：边收边回调，让气泡逐字长出来。
 *
 * 容错约定：
 * - 一字未出就失败（中转站不认 stream、网关报错等）→ 静默退回非流式，
 *   对调用方等价于「这次没能流式」，不额外报错；
 * - 已经收到内容后断线／超时 → 不重发，把已生成的部分返回（截断的话也比丢一条强）；
 * - 截断（finish_reason=length）不报错：聊天场景把半截话显示出来比丢一条好。
 *
 * @param api API 设定（须已启用）
 * @param system system 两段（stable 挂缓存断点／tail 排在断点之后）；传纯字符串＝单段
 * @param history 对话历史
 * @param userInput 本轮用户输入
 * @param onDelta 增量回调，参数是「到目前为止的全文」（按 50ms 节流）
 * @param options historyLimit／maxTokens／temperature 同 fetchAIReply；signal 为外部取消
 * @returns 完整回复文本
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
  } = {},
): Promise<string> {
  const { historyLimit, maxTokens = 800, temperature, signal } = options;
  const { url, body } = buildChatRequest(
    api,
    system,
    history,
    userInput,
    historyLimit,
    maxTokens,
    temperature,
  );

  let content = "";
  let reasoning = "";
  let raw = "";
  let timedOut = false;
  let abortedByUser = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

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
    const delta = evt.choices?.[0]?.delta;
    if (!delta) return false;
    reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
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
      body: JSON.stringify({ ...body, stream: true }),
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
        return parseCompletionReply(JSON.parse(raw) as CompletionPayload);
      } catch {
        throw new Error("流式响应没有内容");
      }
    }
    emit(true); // 补发节流里丢掉的尾巴
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
 * 半角标点归正：中文里的 `,` `.` `?` `!` 一律换成全角「，」「。」「？」「！」。
 * 提示词里写了这条要求，但模型偶尔还是会漏：抓到的原文是「嗯,怎么了。」
 * （半角逗号），要的是「嗯，怎么了。」。提示词管不住
 * 的，就在这儿兜底，不看模型脸色。
 * 只换**中文语境**里的：符号紧挨着中文（前一字或后一字算中文）才算，否则原样不动——
 * 这样 `3,000`、`3.5`、`v1.0`、`miya.ai`、`http://x?a=1` 这些都不会被改坏。
 */
function toFullWidthPunct(text: string): string {
  const full: Record<string, string> = { ",": "，", ".": "。", "?": "？", "!": "！" };
  return text.replace(/[,\.?!]/g, (m: string, offset: number, whole: string) => {
    const prev = whole[offset - 1] ?? "";
    const next = whole[offset + 1] ?? "";
    if (!CJK_RE.test(prev) && !CJK_RE.test(next)) return m;
    if (/[0-9]/.test(prev) && /[0-9]/.test(next)) return m; // 千分位／小数点
    if (m === "." && /[A-Za-z0-9]/.test(prev)) return m; // v1.0、miya.ai
    if (m === "." && /[A-Za-z0-9]/.test(next)) return m; // 中文.txt
    return full[m];
  });
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
 * 0. 进来先把半角标点归正（见 toFullWidthPunct）——屏幕上看到的就是落库的那一份。
 * @param maxBubbles 气泡数硬上限（设置里的「气泡条数」；0／不传＝不限）。
 *                   拆出来比上限多时，把相邻的两条并成一条、并到落进上限为止——
 *                   内容一个字不丢（提示词侧已提前打过招呼，见 buildStylePrompt）。
 */
export function splitReply(reply: string, maxBubbles = 0): string[] {
  /* 单条气泡的「目标窗口」（字符数）：攒到 TARGET_MIN 才算够，攒过 TARGET_MAX 就收手。
     为什么是窗口、不是硬上限 24：
     硬上限的写法是「加不进 24 就把当前这条推出去」，而模型写的句子常见十三到二十来字，
     两句一加起来就过 24——于是**每一句都各成一条**，屏幕上就是一句话一个气泡，
     而且气泡条数关掉上限（不限）时更明显：有上限时超出的还会被并回去，
     不限之后一路原样冒出来。改成窗口：先攒够 30，再看下一句加不加得进 48；
     普通长短的两三句正好落在一条里，读着才是「一条消息」，不是连发一串小短句。 */
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

  const blocks = toFullWidthPunct(reply)
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
  /* 气泡条数上限：超出时把**相邻的两条**并成一条，反复并到落进上限为止。
     为什么不沿用「前 max-1 条原样、其余全并进最后一条」的老写法：
     老写法只压最后一条，TA 一旦超上限，多出来的几句就全糊在末尾那一条里，
     屏幕上前面几条正常、最后一条鼓成一大坨。摊开来并，每条都只多背一点，
     不会再有哪一条特别难看。
     ⚠️ **合并必须在收口之前做**：`sealTailPunct` 会把每条末尾的逗号／顿号收口，
     先收口再并，就等于把几句本该分开的话生粘成一片——
     「刚忙完手里的事看到你消息就马上过来了」，屏幕上就是一串连读的长字，像没分句。
     先合、后收口，缝上的标点原样留着，读起来才还是几句话。 */
  const merged =
    maxBubbles > 0 && out.length > maxBubbles ? mergeToCap(out, maxBubbles) : out;
  // 每条末尾收口，见 sealTailPunct。
  return merged.map(sealTailPunct).filter((m) => m.length > 0);
}

/**
 * 把气泡列表并到上限以内：每次挑**相邻且合起来最短**的一对并成一条，反复到条数落进来。
 * 短的先并、长的原样留着——并出来的每条都只多背一点，不会像「其余全塞进最后一条」
 * 那样在末尾鼓出一大坨（缘起见 splitReply 里的注释与施工日志）。
 */
function mergeToCap(list: string[], cap: number): string[] {
  const arr = [...list];
  while (arr.length > cap) {
    let at = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      if (arr[i].length + arr[i + 1].length < arr[at].length + arr[at + 1].length) at = i;
    }
    arr.splice(at, 2, arr[at] + arr[at + 1]);
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
): { settled: string[]; tail: string } {
  const sep = /\n[ \t]*\n(?:[ \t]*\n)*/g;
  let lastEnd = -1;
  for (let m = sep.exec(text); m; m = sep.exec(text)) lastEnd = m.index + m[0].length;
  // 还没出现空行：整段都是尾巴，一个字都没定型。
  if (lastEnd < 0) return { settled: [], tail: toFullWidthPunct(text.trim()) };
  return {
    settled: splitReply(text.slice(0, lastEnd), maxBubbles),
    // 尾巴也过同一趟归正：这一段定型后改走 splitReply，标点不会突然变样。
    tail: toFullWidthPunct(text.slice(lastEnd).trim()),
  };
}

/**
 * 流式预览专用的标记剥离：〔图片〕〔语音〕这类标记在流式期间还没被
 * extractMetaMarkers 摘走，直接拆条会把「〔图片〕一只猫」当正文先显示出来，
 * 落库时才整段消失换成真图片——看着像「先说一堆图片描述、再重整成图片」。
 * 这里先按落库同一套规则把标记剥掉，再把末尾可能只收到半截的标记（「〔图」）
 * 连同它后面的内容一起截断，预览里一个字都不露；落库仍走完整流程生成真图片。
 */
export function stripMetaMarkersForPreview(text: string): string {
  const clean = extractMetaMarkers(text).clean;
  const partial = clean.match(
    /(^|\n)[ \t]*[〔【（(\[]\s*(?:签\s*名|动\s*态|图\s*片|语\s*音|签|动|图|语)?\s*(?:[)）】\]〕]|$)/,
  );
  return partial?.index !== undefined ? clean.slice(0, partial.index).trim() : clean;
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
    "你是给 AI 绘画模型写英文提示词的翻译器。把用户给的中文描述译成英文提示词：保留全部细节、意译自然、不要解释、不要加引号，只输出英文译文本身。特别注意：人物外貌细节（发色、发型、瞳色、体型、服装款式颜色、配饰）必须逐词完整译出，严禁简化或合并——「浅金色微卷短发」必须译出 light gold / wavy / short 三个特征，不得只译 short hair。",
    [],
    prompt,
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
    只有这种「确定没花钱」的失败，才允许换另一条通道再问一次。 */
function isRejectedBeforeWork(msg: string): boolean {
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
  /* 参考图默认**只发一个键**（老写法 `image`：裸 base64，miya 就是这么发的）。
     为兼容「只认 images[].image_url 的站点」把同一张图按两种方言各写一份，体积直接翻倍；
     更麻烦的是有的站点把多出来的 `images` 理解成**第二张参考图**，转去做多图流程——
     这也是「带参考图要 2 分钟，Miya／Float 在同一个站只要 30~50 秒」的嫌疑之一。
     真撞上只认 `images[]` 的站点，会在下面被 4xx 打回来（原话点名 images／image_url），
     那时再补一趟带 `images[]` 的——4xx 表示这一单没开始画、不计费，补发是安全的。 */
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
 * 【一次点击＝一次请求】生图按次计费，所以这里**没有自动重发**：只要请求已经发出去，
 * 不管我们这头是超时、断连还是用户点了取消，对方都可能已经画完并扣费；再自动补一单
 * 就是第二张账单（历史上「一次生图被扣三次费」的根因）。等多久由用户自己决定。
 *
 * @param api 图文 API 设定
 * @param prompt 本轮的图片描述（如聊天中 TA 要发的内容）
 * @param extras 生成参数（尺寸／质量／正负面提示词／翻译开关）
 * @param textApi 文本 API 设定（翻译开关开启时用来把中文译成英文）
 * @param referenceImage 角色参考图
 * @param subject 角色档案（性别／人设外观）
 * @param signal 用户点「不等了」时中断（只有用户主动取消才算断）
 * @returns image 可直接展示的地址（URL 或 data:）；finalPrompt 实际送入模型的提示词；
 *          via 表示最终走通的是哪条通道（images＝图片接口，chat＝聊天接口）；
 *          translateFailed 表示翻译失败退回了中文原文（非致命）
 */

/* ---------- miya 原味：性别标签与人设外貌都拼进提示词 ---------- */
/* 性别用正／负面标签成对喂：正面点名性别，负面把异性词反向排掉。
   「你是男性」这类自然语言对生图模型几乎无效，标签才管用。
   （对照 miya：resolveContactGenderKey + buildGenderPromptTags） */
const GENDER_TAGS: Record<"male" | "female", { positive: string; negative: string }> = {
  male: {
    positive: "1boy, male, man",
    negative: "1girl, female, woman, feminine, breasts",
  },
  female: {
    positive: "1girl, female, woman",
    negative: "1boy, male, man, masculine, beard",
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

/** 质量尾巴（miya 固定串，原样照搬）。 */
const QUALITY_TAIL = "masterpiece, best quality, highly detailed, coherent composition, natural lighting";
/** 负面词（**字段版**，只递给认 `negative_prompt` 的站点）。单子按「一眼看着怪」的常见
    崩坏扩过一遍：多指／粘连指／多手多脚／肢体错乱／同一张脸重复／脸崩／糊／水印签名
    文字 logo／裁切边框。
    ⚠️ **只放「坏了」的东西，别夹审美取向的词**（什么算好看由画风词定，见
    FLAW_AVOID_TEXT 旁边三条注释）。 */
const QUALITY_NEGATIVE =
  "lowres, worst quality, jpeg artifacts, blurry, bad anatomy, bad hands, extra fingers, fused fingers, missing fingers, extra limbs, malformed limbs, deformed face, disfigured, cloned face, duplicate face, poorly drawn face, watermark, signature, text, logo, cropped, out of frame, border, frame";
/** 同一张单子的**中文正文版**，给不认 `negative_prompt` 字段的站点用（GPT 系、方舟：
    字段递了也是白递，只能把负面写成正文里的一句「画面中避免出现：…」）。
    和 QUALITY_NEGATIVE 是一套意思的两副面孔，**改一处要跟着改另一处**。 */
const FLAW_AVOID_TEXT =
  "多指、手指粘连或变形、多手多脚、四肢错乱或拼接、同一张脸重复出现、五官错位或面部崩坏、画面糊成一团或细节融化、水印、签名、文字、logo、裁切与相框边条";

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

  /* 两套提示词，按「带不带参考图」分流（不分模型）：
     ① 带参考图 → 「身份锚」自然语言指令：参考图只锁身份（同一双眼睛、同一个
        鼻子嘴巴、脸型、发型的基本样式、体型），其余一切——表情、眼神、头发
        此刻的状态、姿势、服装、光线、场景、构图——全交给场景描述重新创作。
        注意**不能**写「保持面部／发型不变」这类话：模型会理解成把整张脸冻住，
        连参考图里的表情、发丝状态都原样搬过来（表情僵、头发一丝不苟的根）。
        状态要跟场景走：睡醒的朦胧、害羞的半眯眼、海边打湿的头发……
     ② 不带参考图 → miya 原味「逗号标签串」：全局正面 → 性别标签 → 外貌（looks）
        切片 → TA 的场景描述 → 质量尾巴（纯文生图链路）。 */
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

  /* ① 身份锚指令（带参考图时的提示词） */
  const anchorPrompt = [
    /* ⚠️ 走 /images/edits 的站点（＝除了方舟、百炼以外的所有站点）拿到的其实是**改图**
       任务，不是「按描述重画」。gpt-image-2 的参考图保真度是**强制高保真，而且不给调**
       ——官方 prompting guide（openai-cookbook）的模型表原话：gpt-image-2
       的 `input_fidelity` 是「Disabled. 这个参数对它不起作用，因为输出默认已是高保真」，
       传了会被 API 拒。能调 `low`／`high` 的是**上一代**（`gpt-image-1.5`／`gpt-image-1`／
       `gpt-image-1-mini`）。所以别指望靠参数把这层保真度压下去，只能从提示词侧撬。
       它的默认行为就是
       「尽量贴住你给的那张图，只动你明确点出来的地方」。我们原来喂给它的是一段
       **描述**，它读到「卧室、白衬衫、自拍」就把原图整张留着、只换个衣服——
       「完全参照这个参考图换衣而已，换皮」。
       所以这一趟必须先把任务性质点明，并把**要重排的东西一个一个列出来**（姿势、
       机位、脸的朝向、头的倾斜、手臂的位置、背景、服装、光线），不说死它就当成
       「在这张图上微调」。
       方舟／百炼那两家不走这里：它们是真·生成语义，参考图本来就是「参考」，
       再写一句「不是拿这张图改一改」反而是错的。

       ⚠️ 再往下挖一层（否掉了「换模型／换站点」那条路，症结认定就在提示词）：
       别人的抄不到，那只能盯着自己的看。看出来一件事——**「参考图」这个词在整段带图
       提示词里出现了八次**，而且最"重"的两句**互相打架**：「必须以它为准、不得自行
       改动」（锁身份那套）在**前**，「别的一律不许照搬参考图」在**后**。
       模型读到的第一句重话是「照这张图来」，后面那句是补救；自回归模型对靠前的内容
       权重明显更大（官方 prompting guide 第 2 节也强调顺序），补救常常无效——**换皮
       就是这么来的**。
       改法不是删掉锁身份（那是明确要的），而是**在开口第一句就把参考图的权限收窄
       到一件事**：它只交出「长相」，画面部分当场宣告作废；后面的锁身份那条也跟着补一句
       「这条的授权只有『长相』两个字」，两处口径对齐，不再一个说「为准」、一个说「别照搬」。 */
    refs.length > 0 && !nativeRefPlatform
      ? "这次要画的是一张**全新的照片**，不是把这张参考图改一改。参考图只交出一件事——**这个人长什么样**（脸型、五官、发型、发色、体型，以及脸上原有的痣这类特征）；把它当一份「长相资料」，看完就放下。**参考图上的其他一切都不算数**：它的姿势、机位的高低与远近、脸的朝向、头的倾斜角度、肩膀与手臂的位置、背景、服装、光线，一处都不沿用，全部按下方的描述重新安排、重新构图。画出来的人要认得出是同一个，但画面是全新的一张。"
      : "",
    /* 锁身份（「二重保险」）：「二重」＝**参考图那一份 ＋ 人设
       文字那一份**，两处都要说死（原来那句只讲了「与参考图一致」，人设那行还写着
       「外观以参考图为准」，等于把文字这一重降级了）。
       写法上**依旧不写「保持面部／发型不变」**——那是老坑（见下面第②条注释）：模型
       会理解成把整张脸冻住，连参考图里的表情、发丝状态都一起搬过来。这里改成
       「以参考图为准、不得自行改动／替换／美化」，把锁的东西列成清单。
       冲突优先级**写死为参考图优先**（参考图是自己存下来的那张满意图），人设
       文字负责补参考图看不清的细节。⚠️ 这条是可以一句话翻的取舍，若要「人设
       文字优先」，改这一句即可。 */
    "**长相必须严格按参考图来**，不得自行改动、替换，也不要「按想象美化」：五官（眼睛的形状与眼距、鼻梁鼻头、嘴唇、脸型与下颌线）、发型的基本样式（长度、颜色、走向、分缝位置、有没有刘海）和体型，都要跟参考图一致——画出来必须是同一个人，不是长得像的另一个人，也不是更好看的一版。**这句话只授权「长相」这一件事。**",
    "人物设定里的外貌文字同样算数，凡是写到的（发型、发色、发长、五官特征、体型）都要照它画；它和参考图不一致时以参考图为准，只有参考图看不清、看不全的细节（发色深浅、长度、有没有刘海）才按人设文字补。参考图与人设里都没有的外貌特征（耳饰、纹身、痣、眼镜等）不要自己加。",
    /* ⚠️ 提示词是**给生图模型看的**，开发备注一律不许进字符串（「生图诊断」里能看出
       括号里的记录会被真发出去）。以下这条教训只记在这里：
       只写笼统的「不许照搬」时，机位与手臂手势都会被照搬参考图——压不住的原因
       是没把这几项一个个点名，所以下面那串点名留着。 */
    "**神态归描述管**：这一刻在做什么、脸上是什么神态，就画那一种；描述写了哪种就画哪种，没写到的也不许自己挑一种默认的「好看」表情顶上（别每张都半阖眼、微张唇）。**镜头的高低与远近、脸朝哪边、头倾斜多少度、肩膀的高低、手臂伸不伸出来**，这些全都属于这一次的创作，不是参考图带来的默认值——参考图里是那样，不代表这一次也要那样。头发的**样式**照上面锁死（不许换发型、不许改长短、不许变发色），但**此刻的状态跟着情境走**——可以被打湿、被风吹乱、松散垂下来，别画得一丝不苟像刚从理发店出来。",
    /* 去精致感（要求「去精致感、更像生活中的一张照片」）。
       ⚠️ **已收短成一句**，定调：「**提示词只需要约束一些不应该出现的东西**……
       **画风不用去管，但要确保它不会变得很奇怪**」——那类举例（小夜灯／台灯／雾气／噪点／逆光过曝…）
       属于「替用户定画面观感」，砍掉；**内核「跟随情景」原样留住**。
       四条硬约束**照旧成立**，以后往这里加词照它量：
       ① **它是一条原理，不是黑名单**——就是「**跟随情景**」。别加「不许
       出现某种成品感」的条目：像「不磨皮／不美颜／不修毛孔」「不要影棚布光／
       不要杂志大片感／不要电影感调色」这类都别加。**句式里那个
       「不要一律」是活口，别删。**
       ② **不碰皮肤审美**（皮肤长什么样交给画风词与人设），只写「跟着光走」这类物理后果。
       ③ **绝不写「要像照片」**——画风由画风词定（写实、插画都可能），
       写「像照片」等于把两路一起往照片推，与「跟随情景」的原意相反。
       ④ 情景要精致（今天真去棚拍写真）就照描述来，不拦。
       两套提示词都挂这一句（**别只改一处**）。 */
    "画面跟着情景走，不要一律往「精修」的方向拉；表情与姿态自然随意，不摆拍、不做广告式的笑、不刻意盯着镜头。",
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
    `这张图片的画面：${prompt.trim()}`,
    /* 末尾把身份再钉一次（「二重保险」）：开头的锁身份指令与 TA 那
       段几百字的画面描述之间隔着一长串内容（去精致感／画风／性别／人设），到收尾时
       权重已经被冲淡，所以在最后一句再核对一次——同「首尾各钉一次」的思路。 */
    "画面质量：高质量、细节丰富、构图完整；画面里若有人物，人物是画面主体、面部清晰，人物状态与场景相符。**最后再核对一次身份**：五官与发型严格照参考图，是同一个人，不要自行换脸、换发型、改发色，也不要「美化」成另一版。视角与姿势按这次的画面描述呈现（参考图只用来认人）。",
  ]
    .filter(Boolean)
    .join("\n");

  /* ② miya 标签串（不带参考图，以及带图失败后退回纯文生图时用） */
  const tagPrompt = [
    styleText,
    genderTags.positive,
    looksText,
    prompt.trim(),
    /* 「不应该出现的东西」的正文版：只有**不认负面字段**的
       站点（OpenAI 官方、方舟）走这里——这两家纯文生图时负面词会被直接丢掉
       （字段被忽略、标签串里又没写）。**改成恒出**：填的词 ＋ `FLAW_AVOID_TEXT`。
       认字段的（中转、百炼）不重复。 */
    !negativeNative
      ? `画面中避免出现：${[extras.negativePrompt.trim(), FLAW_AVOID_TEXT].filter(Boolean).join("；")}`
      : "",
    /* 去精致感（已收短成一句，理由见那边注释：画风不用去管，但别让它变得很奇怪）。
       这里刻意不写「随手一拍／像照片」——写「像照片」等于替用户定画风；
       皮肤审美与「禁止成品感」那串也不写，均同身份锚那条。 */
    "画面跟着情景走，不要一律往精修的方向拉；表情与姿态自然随意，不摆拍、不做广告式的笑、不刻意盯着镜头",
    QUALITY_TAIL,
    /* 正面提示词后缀：补细节用，整串收尾。
       是最靠后的一句，权重也最轻——它是锦上添花，不是命令。
       ⚠️ 前面不要再来一次「画风要求」复读。 */
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
  let final = refs.length > 0 && !nai ? anchorPrompt : tagPrompt;

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

  /* NovelAI 专属通道。
     它不吃 OpenAI 那套 /images/generations，也没有「图片编辑」通道可退，所以：
     - 提示词用标签串（它就是标签模型，上面 final 已按 nai 强制走 tagPrompt）；
     - 负面提示词走它原生的 negative_prompt；
     - 参考图**不支持**（要走它的 director reference，格式另说），
       带了也白带——refsSent 记 0 并在诊断里说明，提示词里的人设外貌文字仍然生效。
     只发一次：这条通道失败后没有「换一条再问」的余地，重发就是新的一单。 */
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

/** 是否 MiniMax 语音接口（国内 api.minimax.chat／国际 api.minimaxi.chat，专用格式）。 */
function isMiniMaxVoice(baseUrl: string): boolean {
  return /api\.minimax(i)?\.chat/i.test(baseUrl.trim());
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

/**
 * 合成一段语音（OpenAI 兼容 POST /audio/speech，返回音频文件；
 * MiniMax 国内／国际版自动走其专用 /t2a_v2 接口）。
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

  /* MiniMax：专用接口＋团队 ID＋hex 音频，单独处理。 */
  if (isMiniMaxVoice(base)) {
    const audio = await requestSpeechViaMiniMax(base, api, text, extras);
    return { audio };
  }

  const url = base.endsWith("/audio/speech") ? base : `${base}/audio/speech`;

  const body: Record<string, unknown> = {
    model: api.model,
    input: text,
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
 * 拉取模型列表（OpenAI 兼容 GET /models）。
 * 成功返回模型 id 列表（保持服务商返回顺序）；失败抛出人话错误。
 */
export async function fetchModelList(
  api: Pick<ChatApiSettings, "baseUrl" | "apiKey">,
): Promise<string[]> {
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填好 Base URL 再获取");
  const url = base.endsWith("/models") ? base : `${base}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        ...(api.apiKey ? { Authorization: `Bearer ${api.apiKey}` } : {}),
      },
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
      const errBody = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof errBody.error === "string" ? errBody.error : (errBody.error?.message ?? "");
    } catch {
      // 响应体不是 JSON（如网关返回 HTML）就只报状态码。
    }
    throw new Error(detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}（服务商未说明原因）`);
  }
  let data: { data?: { id?: string }[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("接口返回了无法解析的内容，请检查地址是否填对");
  }
  const ids = (data.data ?? [])
    .map((m) => (m.id ?? "").trim())
    .filter((id) => id !== "");
  if (ids.length === 0) throw new Error("接口没有返回任何模型");
  return ids;
}

/**
 * 判断一张图的画面里是否出现角色本人（旧数据兜底：那时标记还没有开关）。
 * 宁可多带参考图——漏判的代价是长相全凭模型编，比多带一张参考图严重得多。
 */
export function guessUseCharRef(desc: string): boolean {
  return /(自拍|对镜|本人|自己|我的?(脸|手|背影|侧脸|半身|全身|正面|头发)|我[站坐躺靠走蹲跑抱拿戴穿]|镜头前|举起手机)/.test(
    desc,
  );
}

/**
 * 从回复中提取〔签名〕／〔动态〕／〔图片〕／〔语音〕元标记。
 * 标记写在回复末尾（可多个），气泡展示前剥掉；
 * 签名存进会话资料页，动态累积进 TA 的动态列表，
 * 图片／语音由调用方走对应 API 生成后以独立消息发出。
 * 图片标记可带「是否使用参考图」开关（决定是否拿参考图锁定长相）。
 * 括号写法容忍〔〕【】（）[] 等常见变体（模型不总是照抄指令格式）；
 * 标记后紧跟换行时把下一行并进来当内容（「〔图片〕\n描述」）。
 */
export function extractMetaMarkers(reply: string): {
  /** 剥掉标记后的干净回复（拿去拆条展示）。 */
  clean: string;
  /** TA 更新的签名；没附带则为 null。 */
  signature: string | null;
  /**
   * TA 发布的动态列表（一条回复可带多条）。
   * 每条含文字解说 content 和可选的画面描述 imagePrompt（〔动态图〕标记）。
   *
   * TA 发图文不只发图片，还会配上文字解说。
   * 〔动态图〕跟在某条〔动态〕后面的就配给它；单独出现则跳过（TA 不会这么写）。
   */
  moments: Array<{ content: string; imagePrompt?: string }>;
  /** TA 要发的图片（画面描述；走图文 API 生成）。 */
  images: string[];
  /** 与 images 一一对应：这张图是否用角色参考图锁定长相。 */
  imageRefs: boolean[];
  /** TA 要发的语音（要说的话；走语音 API 合成）。 */
  voices: string[];
} {
  // 先把各标记单独抽出来（保持顺序），再在主流程里重新配对。
  const rawMoments: string[] = [];
  const rawImagePrompts: string[] = [];
  const images: string[] = [];
  const voices: string[] = [];
  let signature: string | null = null;

  /* 标记单独一行、内容在下一行时先并回同一行（下一行是另一个标记则不动）。 */
  const joined = reply.replace(
    /([〔【（(\[]\s*(?:签名|动态|动态图|语音|图片(?:[：:][^)）】\]〕\n]{0,12})?)\s*[)）】\]〕])[ \t]*\r?\n[ \t]*([^\n〔【]*)/g,
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

  const clean = grab("签名", (v) => {
    signature = v;
  })(joined);
  const noMoments = grab("动态", (v) => rawMoments.push(v))(clean);
  const noImagePrompts = grab("动态图", (v) => rawImagePrompts.push(v))(noMoments);
  /* 图片标记可选带「是否使用参考图」开关：〔图片:使用参考图〕描述 ／〔图片:不使用参考图〕描述。
     旧的〔图片〕描述没有开关，按描述内容兜底判断（老消息与不听话的模型都走这条路）。 */
  const imageRefs: boolean[] = [];
  const imageTagRe =
    /[〔【（(\[]\s*图片\s*(?:[：:]\s*(不?\s*(?:使用|用)参考图|无需参考图))?\s*[)）】\]〕][ \t]*([^\n〔【]*)/g;
  const noImages = noImagePrompts.replace(imageTagRe, (_m, flag: string | undefined, s: string) => {
    const v = s
      .trim()
      .replace(/^[：:、]\s*/, "")
      .trim();
    if (v) {
      images.push(v);
      imageRefs.push(flag ? !/^(不|无需)/.test(flag) : guessUseCharRef(v));
    }
    return "";
  });
  const noVoices = grab("语音", (v) => voices.push(v))(noImages);

  // 剥掉标记后收尾的空行、行尾空白。
  const final = noVoices
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 配对：〔动态图〕紧跟某条〔动态〕的配给它；单独出现的跳过（不该出现）。
  const moments: Array<{ content: string; imagePrompt?: string }> = [];
  for (let i = 0; i < rawMoments.length; i++) {
    const ip = i < rawImagePrompts.length ? rawImagePrompts[i] : undefined;
    moments.push({ content: rawMoments[i], ...(ip ? { imagePrompt: ip } : {}) });
  }

  return { clean: final, signature, moments, images, imageRefs, voices };
}
