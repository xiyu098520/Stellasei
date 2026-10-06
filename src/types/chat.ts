/** 星绥通讯：会话、消息与 API 设定。 */

/**
 * 消息类型（跟随旧档案）：文字、文字图片、语音、红包、转账、收款回执、文件、位置、系统提示。
 *
 * `receipt`（收款回执，1.4.40）＝钱到账之后由**收款方**发出的那张卡片。微信里就这么走：
 * 他点收了你的转账，聊天里除了你那张变淡的转账卡，还会多出**他发的**一张
 * 「已收款 ¥520.00／已存入零钱」；他转给你、你点收，就多出你发的一张。
 * 所以它不是钱本身（钱在红包／转账那条消息上），只是「收下」这个动作的回执：
 * `amount` 是金额（元），`content` 是卡片上那句（转账「已收款」、红包「已领取」）。
 * 它**不回喂模型**——钱那条已经说过金额了，回执没有新信息（见 chatApi 的 buildApiMessages）。
 */
export type ChatMessageType =
  | "text"
  | "image"
  | "voice"
  | "redpacket"
  | "transfer"
  | "receipt"
  | "file"
  | "location"
  | "system";

/** 单条消息。 */
export interface ChatMessage {
  id: string;
  /** 谁说的：user＝我，assistant＝TA，system＝系统提示（居中分隔条）。 */
  role: "user" | "assistant" | "system";
  /** 消息类型；旧数据没有此栏位时按 text 处理。 */
  type?: ChatMessageType;
  content: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** 是否已读。 */
  isRead?: boolean;
  /** 语音时长（秒）。 */
  duration?: number;
  /** 图片本体（data URL；图文 API 生成的真图）。 */
  imageUrl?: string;
  /** 这张图是否用角色参考图锁定长相（TA 在〔图片:使用参考图〕标记里声明）。 */
  useCharRef?: boolean;
  /**
   * TA 在图片标记里**到底写没写**那个开关——诊断面板靠它说真话：
   * use＝写了「使用参考图」；none＝写了「不使用参考图」；absent＝没写，按画面描述猜的。
   * 老消息没有这一格（当成 absent 处理）。
   */
  refMark?: "use" | "none" | "absent";
  /**
   * 气泡下方那一行译文（1.9.48 起的「外语聊天」）：
   * - TA 说外语时＝翻出来的中文；
   * - 我说外语时＝我原本打的那句中文。
   * 原文在上、译文在下，**同一条消息**，不占上下文位置、不进记忆，关掉开关只是不显示。
   */
  translated?: string;
  /** 语音本体（data URL；语音 API 合成的真音频）。 */
  audioUrl?: string;
  /** 媒体还在生成中（图片占位气泡；生成完成后清除并填入本体）。 */
  pending?: boolean;
  /**
   * 占位框停在「等点一下才开始画」的状态：TA 已经把画面描述发来了，但设置里
   * 「自动生成」关着（见 ChatPrefs.autoGenerateImage），所以这一趟不去打接口、不花钱。
   * 和 pending 的区别：pending 是「已经在画了」，这个只是「还没开始画」。
   */
  awaitGen?: boolean;
  /** 媒体生成失败（占位保留，点击可重新生成）。 */
  error?: boolean;
  /** 失败原因原文（用完就留着：弹窗提示会被截断、转眼就没，出了问题查不着）。 */
  errorText?: string;
  /**
   * 这条系统提示是「这一轮没成」，可以一键重来：点提示下的「重新生成」＝先把这条
   * 提示从聊天记录里抹掉，再拿最后一条用户消息重跑一轮（不用重新打字）。
   * 只有失败／受阻的系统提示带它；其余系统提示（如「图文 API 未启用」）没有可重来的动作。
   */
  retryable?: boolean;
  /** 红包／转账金额（单位：元）；收款回执（type: "receipt"）用它带这笔钱的金额。 */
  amount?: number;
  /**
   * 这条红包／转账**接收方已经收下**（1.4.33 建，1.4.38 扩成两边共用一个口径）。
   *
   * 一条钱的消息只有一个接收方：TA 发来的接收方是我、我发出去的接收方是 TA，
   * 所以「收没收到」用同一个字段就够，不必再开一个。
   *
   * 两边的落法不同：
   *  - TA 发来的：我点「收下」那一刻落 true，免得同一条被点两次、同一笔钱领两遍；
   *  - 我发出去的（1.5.12 改）：钱在发出那一刻**只从我账上扣掉**，还没进 TA 的账，
   *    卡片停在「等他收下」；他回复里写了〔收下〕（红包写〔领取〕）才算他收下
   *    ——到这一刻才把钱加进他的零钱、落上 true（见 ChatWindow 的 markContactReceived）。
   *    **他没写就等于他没表态**（1.5.12 之前是「没写＝他收下」，那条口径已废）：
   *    钱继续悬着，他之后随时可以回过头补一个〔收下〕把钱领走；一直不表态就走
   *    moneyExpired——到点钱原路退回我出的那个口袋。绝不允许「嘴上说收了、账上没动」。
   */
  moneyClaimed?: boolean;
  /**
   * 这笔钱被**收款方退还**了（1.4.41 建，1.4.63 扩成两个方向共用）。
   *
   * 两个方向都会落它：
   *  - TA 发来的转账我不想要：我点开卡片点「退还」，钱原路回他的零钱，我这边一分没进；
   *  - 我发出去的转账他不想要：他在回复里写〔退还〕，钱原路回到我出钱的那个口袋
   *    （`payFrom` 决定是零钱还是那张卡）。
   * 所以它与 moneyClaimed 是**互斥**的：一条钱的消息只有一个接收方，退了就不该再能收。
   * 落这个标记为的是两件事：① 卡片点开里的按钮不再冒出来（否则退完还能再点一次收下，
   * 等于白拿一笔）；② 卡片底行写成「已退还」。
   * **红包没有「退还」这一说**（1.5.12 定，跟微信一致：红包只能开、不能退）：
   * 他写〔不领〕只是「这轮先不领」，钱照旧挂着、他随时能回头领，不落这一格；
   * 红包一直没人领就走 moneyExpired——钱同样原路回来，但由头和说法是「过期」。
   */
  moneyRefunded?: boolean;
  /**
   * 我发出去的这笔钱**到点过期了**（1.5.12）：他既没收下、也没退还，聊天往下又走过
   * 「上下文条数」那么多条（设置里的浓缩门槛 `contextLimit`，默认 50）之后，这一条
   * 已经滑出 TA 看得见的范围——他再也想不起、也再看不到这笔钱，等着就没意义了。
   * 这一刻钱原路回我出的那个口袋，卡片落成「已过期」。
   *
   * 为什么单开一格、不并进 moneyRefunded：「已退还」是他自己表的态（他主动不要），
   * 「已过期」是谁都没表态、往后聊着聊着自动退回——卡片上写的话不一样、记忆素材里
   * 说的事不一样，并成一个布尔就分不出来了。
   *
   * 只有我发出去的钱会落它（TA 发来的钱等的是我的动作，说不上过期）；
   * 与 moneyClaimed／moneyRefunded 三者互斥。
   */
  moneyExpired?: boolean;
  /**
   * 我发出去的这笔钱**从哪个口袋出的**（1.4.63）：`"balance"`＝零钱，其余是那张卡的 id。
   * 为什么要记住：钱先只从我账上扣掉、还没进 TA 的账，他要是退还、或是到点过期，
   * 得原路加回**出钱的那个口袋**——零钱回零钱、那张卡回那张卡。
   * 它同时也是「这笔钱还没给出去」的记号：1.4.63 之前发出去的老消息没有这一格，
   * 那种当时就一次性划走了（钱已在他账上），补账时不能再给他加一遍。
   */
  payFrom?: string;
  /**
   * 收款回执（type: "receipt"）专用的「原转账那条的时间戳」（1.4.84）。
   * 为什么要有它：回执右上角那枚短编号取的是时间戳末四位，1.4.82 起回执跟转账
   * 是「同一笔钱、双方各持一联」——**一联一个号就不像同一张票了**。恩熙原话：
   * 「收取跟退还，它右上角那个数字应该是编号，是一样的呀。」⇒ 回执落库时把
   * 原转账消息的 createdAt 抄一份在这，两联的编号都从它取，必然一致。
   * 只有 `buildReceiptMsg` 会写它；读它的只有回执卡的编号。**1.4.84 之前的
   * 老回执没有这格**——读侧一律 `payAt ?? createdAt` 兜底（老回执照旧用它自己
   * 的时间，不会崩、也不会串）。
   */
  payAt?: string;
  /**
   * 红包封面（1.4.89）：预设 id（"classic"/"crimson"/"pink"/"gold"，见 redpacket.ts）
   * 或一张自定义封面图的地址（媒体仓库引用串 `media-store://mc_xxx`，老数据也可能是
   * data URL——两种都认）。只有 type 为 redpacket 的消息用它；undefined＝没选过
   * （TA 发的红包就是这样，渲染时按消息 id 稳定挑一张预设，不必落库）。
   * 落库白名单见 settings/chat.ts 的 appendMessage（漏了它，封面一刷新就丢）。
   */
  redCover?: string;
  /** 文件名／文件大小。 */
  fileName?: string;
  fileSize?: number;
  /** 引用的原文摘要（引用回复时附带）。 */
  quote?: string;
  /**
   * 这条消息**发给模型时的完整原文**（含易变尾巴：关键词世界书／签名取值）。
   * 回喂历史时原样送回——「发出去＝存下来＝回喂」必须是同一份，否则站子逐字比对
   * 到这条就断，其后整段历史每轮作废重写。
   * 只给模型用，气泡里永远显示 content，用户看不到它。
   */
  apiText?: string;
  /**
   * 这条消息**发出去时那截易变尾巴**（签名／零钱／回执／关键词世界书／当前状态，
   * 以及线下那句说明）——单独记一份（1.10.8）。为什么单记：红包／转账的正文
   * 是**随账目状态变**的（见 chatApi 的 money 分支），回喂时要按当时状态重算，
   * 不能整条照抄 apiText；重算出的正文得把这一截尾巴接回去，前缀才不会从尾巴
   * 那儿整段断开。普通文本消息走 apiText 就够，这份是给 money 分支兜底的。
   * 只给模型用，气泡里不显示。
   */
  apiTail?: string;
  /**
   * 这张图「是什么」的说明（1.4.30）。模型不是扫码器，光看图读不出图里的字，
   * 所以发图时就把「图里装了什么」写成一句话存在这条消息上；回喂历史（含
   * 之后任意一轮）时带出去，TA 才一直记得这张图是什么，而不是只剩「（发来一张图片）」。
   * 目前只有收款码用它（编号与收款人是本地画的、模型解不出来的信息）。
   * 只给模型用，气泡里不显示。
   */
  mediaNote?: string;
  /**
   * 思考型模型这一轮的思考过程（reasoning_content；1.4.9）。
   * **只展示、永不回喂模型**——回喂历史只认 content（buildApiMessages 没读这格），
   * 部分服务商（DeepSeek 官方等）明确拒绝把 reasoning 送回，送了直接 400。
   * 挂在**该轮第一条 TA 气泡**上（一轮回复拆成多条气泡，思考只有一个）；
   * 气泡上方「思考过程」入口点开看。正文为空、思考被兜底当正文的那一轮不挂
   * （那时「正文＝思考」，挂了就是同一段字两头重复）。
   */
  reasoningText?: string;
  /**
   * 这一轮的心声（1.5.60）：TA 按要求写在回复最前面的那段 `<think>…</think>` 内心独白，
   * 落库前由 extractInnerVoice 摘出来，贴在**本轮第一条 TA 气泡**上方做成一截可折叠的
   * 心声（一轮只有一个，跟 reasoningText 一样只挂第一条）。
   * 与 reasoningText 的区别：那个是模型服务端自己的思考过程（不一定给、且不回喂），
   * 这个是**照提示词要求吐出来的输出文本**，给人读的。
   * 跟 reasoningText 一样**只展示、不回喂模型**——回喂历史只认 content。
   */
  innerVoice?: string;
  /**
   * 这一轮的**内心快照**（1.5.65）：他在干什么（行为动作）＋ 好感度 ＋ 他这一轮那八根劲儿。
   * 跟 innerVoice 同一处摘出来——都写在他回复最前面那个 `<think>` 块里，
   * 摘完一样只挂**本轮第一条气泡**（一轮只有一张快照），「心声档案」页右列的历史就是按它排的。
   * 跟 innerVoice／reasoningText 一样**只展示、不回喂模型**。
   * 老数据（1.5.64 及以前）没有这一格：没有就只当「这一轮只留了心声」，
   * 页面上那几格留白，不补 0（补 0 会假装他当时真的这分数）。
   */
  innerSnapshot?: InnerSnapshot;
  /** 这张图的生图诊断（走了哪条通道／参考图有没有真的送出／实发提示词原文）。 */
  diag?: ImageDiag;
}

/**
 * 内心快照（1.5.65，1.5.74 换过一版）。
 *
 * 只想清楚一件事：**它是 TA 那一刻的留影，不是我要打的分**——所以每一格都允许缺。
 * 缺＝「这一轮他没写」，不是 0；读侧（心声档案页）一律按「有没有」判，
 * 别拿 0 兜底（0 分摆上去像是真的算过他当时一点情绪都没有）。
 *
 * 动作与心声在提示词里是两件事：心声是第一人称的心里话（`innerVoice` 那格），
 * 动作是第三人称的「他此刻在做什么」——正文里不许写动作（【消息格式】第 2 条），
 * 这格就是那句「身体的事没处放」的出口。
 *
 * **1.7.92（恩熙：「我们就把根去掉，然后重新写提示词，让它能够呈现我们现在所需要的」）**：
 * 八根劲儿整套拆掉（原 `drives`／`driveReasons`／`wishDrive` 三个字段连带 DRIVE_META、
 * 解析里那套涨跌全删），账换成私密心声页真正要的那几格：穿着、心情（此刻）、
 * 欲望、怯念（私藏）、细处、日记（记录）。老消息里那几个旧字段还躺在库里，没人再读。
 *
 * **2026-10-06（恩熙：「环境以及备忘录，我们得先删除……我想留下的是心声、欲望、怯念」）**：
 * 环境（scene／action／outfit）、细处（memo）、日记（diary）三栏删掉，账里只剩
 * 心情、欲望、怯念。老消息里那几个旧字段还躺在库里，解析时照旧认得出、摘走丢掉。
 */
export interface InnerSnapshot {
  /** 他此刻的心情（1.7.92）：一句话。不继承：它讲的就是这一刻，照搬上一轮就是假话。 */
  mood?: string;
  /** 没说出口的那个念头（1.7.92）：私密心声页「私藏」页签那格「欲望」——他心口压着、
   *  没打算说给她听的那点念头。句子可以露骨、可以阴暗（心声那一段本就许他坦诚这些波动）。 */
  desire?: string;
  /** 不敢细想的那件事（1.7.92）：「私藏」页签那格「怯念」——他此刻最怕发生、最怕被她
   *  知道的那件事。同样不继承。 */
  fear?: string;
  /**
   * 他这一轮**最想做的事**（1.5.96，**1.7.96 这一栏撤掉**——恩熙：「我们没有最想做的事
   * 这一个栏目吧」）：原先由八根里现在最高的那一根顶出来，真做出来了那根当场松下来
   * （1.7.92 八根拆掉时这一环已停）。这一栏撤掉后，长在它上面的念头池（wishPool.ts）
   * 与「你还惦记着」那句注入一并删——没有来路，一句都报不出来。老消息里这一格还躺着，
   * 没人再读，解析时照旧认得出、摘走丢掉。
   */
  wish?: string;
  /**
   * 这件事这一轮真做出来了没有（1.5.98）：**只看消息里有没有真东西**——这一轮真的发了
   * 语音／转了钱／写了签名／发了图片／发了动态标记（extractMetaMarkers 摘得出来的那几样），
   * 且这件事正好落在那个频道上。**1.7.96 起不再产出**（判它的 settleWish 随这一栏一并删），
   * 老消息里留着的那几格没人再读。
   */
  wishDone?: boolean;
}

/**
 * 生图诊断（排查用）。
 * 为什么要有它：出现「带参考图出的图既不像参考图、也不像人设」时，光看提示词层
 * 看不出原因——如果所用站点不认图片编辑接口，代码会退成**纯文生图**（参考图压根
 * 没进去），那时提示词写得再严也没用。这条把「实际发生了什么」落到消息上，可查。
 */
export interface ImageDiag {
  /** 实际生效的通道：images＝图片生图接口／edits＝图片编辑接口（参考图走这条）／
   *  chat＝聊天接口／nai＝NovelAI 官方接口（走服务端中转）。 */
  via: "images" | "chat" | "edits" | "nai";
  /** 这一次请求里真的送出去的参考图张数（0＝没送出去）。 */
  refsSent: number;
  /** 进生图层时手上准备好了几张参考图（0＝参考图根本没到生图层，问题在调用侧）。
   *  可选：旧记录没有这一格。 */
  refsPrepared?: number;
  /** refsSent 为 0 的原因（图片编辑接口被拒的原话，或调用侧说明为什么没带图）。 */
  refSkipReason?: string;
  /** 最终发给画图模型的那版提示词原文（开了翻译是译后英文）。 */
  prompt: string;
  /** 提示词翻译失败，已退回中文原文发送。 */
  translateFailed: boolean;
}

/**
 * 动态互动里代表「我（当前面具）」的固定作者 id。
 * 跟 `MomentLike`／`MomentComment` 里角色 id 同一个位子——一个面具一册动态，
 * 「我」在册内就是唯一的一个人，不需要再存面具 id。
 */
export const MOMENT_SELF_ID = "self";

/**
 * 动态底下的一条赞（2026-10-05）。
 * 「我」赞的、角色赞的都长这个样——角色那边把 id 换成角色 id 就行。
 */
export interface MomentLike {
  /** `MOMENT_SELF_ID`（我）或角色 id。 */
  byId: string;
  byName: string;
  byAvatar?: string;
  /** ISO 时间戳。 */
  at: string;
}

/**
 * 动态底下的一条评论（2026-10-05）。
 * 评论**分两层**：`replyToId` 空＝直接评这条动态（平铺）；
 * 有值＝挂在被回复的那条评论下面（恩熙：「艾特的情况下，会在被 @ 的那条底下单独出一层」）。
 */
export interface MomentComment {
  id: string;
  /** `MOMENT_SELF_ID`（我）或角色 id。 */
  byId: string;
  byName: string;
  byAvatar?: string;
  content: string;
  /** ISO 时间戳。 */
  at: string;
  /** 挂在哪条评论下（二级）；空＝直接评动态。 */
  replyToId?: string;
  /** 被 @ 到的人（`MOMENT_SELF_ID` 或角色 id）——只管展示与提醒，内容里照常写着 @名字。 */
  mentions?: string[];
}

/** TA 发的一条动态（随聊天累积，资料页时间轴展示）。
 *
 * TA 用〔动态图〕标记写一段画面描述（可选），生成图片是在朋友圈页面手动触发。
 *
 * imagePrompt：TA 写的画面描述（还没点生成时这里就已经有内容了）。
 * imageRef：点生成、接口跑完后，回写的 media-store:// 引用串。
 *   — 有 imagePrompt 但 imageRef 还在 → 显示「生成配图」按钮。
 *   — imageRef 已落 → 文字解说 + 下面摊一张图。
 *   — 没有 imagePrompt → 纯文字动态，没有任何按钮。
 */
export interface ChatMoment {
  id: string;
  content: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** TA 用〔动态图〕标记写的画面描述（可选）；在朋友圈手动点生成。 */
  imagePrompt?: string;
  /** 点生成后，接口跑完回写的 media-store:// 图片引用串。 */
  imageRef?: string;
  /**
   * 手动标为「重要」的动态：永远以原文留在 TA 的记忆里——
   * 不参与压缩（不会被合进模糊印象）、也不被注入上限挤掉。
   * 命名跟 `MemoryItem.pinnedByUser` 对齐（同一套「用户手动标的」口径）。
   */
  pinnedByUser?: boolean;
  /** 这条动态的赞（我／任何角色）。 */
  likes?: MomentLike[];
  /** 这条动态的评论（含二级回复）。 */
  comments?: MomentComment[];
  /**
   * TA 这条动态给谁看（2026-10-05）。恩熙定的原则：**TA 跟我一样是活在这世界里的
   * 真人，只是靠这个小手机联系**——我有的「分组可见」，TA 同样有。
   * 缺省＝公开（老数据没有这格也照公开走）；可见范围决定**谁能来赞／评**。
   */
  visibility?: MomentVisibility;
  /** 部分可见时才用：可见的角色 id 列表。 */
  visibleTo?: string[];
  /** 部分可见时才用：可见的「世界」（分类）id 列表。 */
  visibleWorlds?: string[];
}

/** 「我」自己发的一条动态的可见范围：公开／私密／部分可见。 */
export type MomentVisibility = "public" | "private" | "partial";

/**
 * 「我」自己发的一条动态（挂在面具下，不跟某个角色会话走）。
 *
 * 与 `ChatMoment`（TA 发的，落在各自的 `Conversation.moments`）分开存：
 * 我的这一份不分角色，一个面具一册。作者恒为当前面具——
 * 名字／头像渲染时从面具取，不在这份数据里重复存。
 */
export interface SelfMoment {
  id: string;
  /** 正文；配了图时可以留空（纯图动态）。 */
  content: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** 配图：media-store:// 引用串（可选）。 */
  imageRef?: string;
  /**
   * 「文字描述当图」（可选）：没画真图，只拿一段文字当这张配图——
   * 卡片上摊一张印着这段话的相纸；TA 收到的仍是「（配了一张图：<描述>）」，
   * 在它眼里这就是一张图片。由动态设置里那枚「配图自动生成」决定走这条路
   * （关＝文字当图；开＝把这段描述交给生图接口画成真图，落 imageRef）。
   */
  imageText?: string;
  /**
   * 发布那一刻让文本接口「看一眼」这张图写下的一句话——
   * TA 读「我在朋友圈发过的」时带着它，图才不会白发（一次花费、永久记住）。
   * 接口没配／不支持看图／识别失败时没有这格，照常发不受影响。
   */
  imageNote?: string;
  /** 自定义标签（存纯词，展示时前面带 #）。 */
  tags?: string[];
  /** 可见范围；缺省＝公开（老数据没有这格也照公开走）。 */
  visibility?: MomentVisibility;
  /** 部分可见时才用：可见的角色 id 列表。 */
  visibleTo?: string[];
  /** 部分可见时才用：可见的「世界」（分类）id 列表。存世界而不是名单——
      世界里的角色整批可见，且跟着名单走（角色进出世界，可见范围自动跟着变）。 */
  visibleWorlds?: string[];
  /** 这条动态的赞（我／任何角色）。 */
  likes?: MomentLike[];
  /** 这条动态的评论（含二级回复）。 */
  comments?: MomentComment[];
}

/** 短期记忆的分类（浓缩时 AI 归类，用户可在记忆 App 里改）。 */
export type MemoryCategory =
  | "mine" // 我的事：TA 记得的关于我的一切
  | "theirs" // TA 的事：TA 自己的喜好习惯近况
  | "us" // 我们的经历：带日期的共同事件
  | "milestone" // 关系节点：关系的转折点
  | "promise" // 承诺与约定：说好的、还没兑现的
  | "other"; // 其他

/** 记忆层级（衰减链：short → mid → long；core 是永不压缩的重要记忆）。 */
export type MemoryTier = "short" | "mid" | "long" | "core";

/** 一条记忆条目（所有层级共用一个结构）。 */
export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  category: MemoryCategory;
  /** 记忆正文（30-60 字的第三人称事实句）。 */
  content: string;
  /** 覆盖的时间段（ISO 起止）。 */
  fromIso: string;
  toIso: string;
  createdAt: string;
  /** 重要记忆（永不压缩永不遗忘；pinnedByUser＝用户手动标的，AI 对账不得推翻）。 */
  important: boolean;
  pinnedByUser?: boolean;
  /** 秘密标记（只属于你们俩的事，可叠加在任何分类上）。 */
  secret?: boolean;
  /** 未解心结标记（压缩时不许把「没和好」状态压掉）。 */
  grudge?: boolean;
  /** 心结解开的时间（ISO；有值＝已解开）。 */
  resolvedIso?: string;
  /** 承诺兑现的时间（ISO；有值＝已兑现）。 */
  fulfilledIso?: string;
  /** **来自线下见面**（1.7.46）：这一条是两人在同一处见面的经过归总出来的（不是手机上的聊天）。
   *  查看时带「线下 · 见面」小标；压缩时门槛更高（线下条目要满 40 条才压，线上 20 条）。 */
  offline?: boolean;
  /**
   * **最近一次「重压成骨架」的时间**（1.7.66，ISO）。
   *
   * 为什么非它不可：中期分两档（8~15 天还留着经过、16~30 天只剩骨架），判断重压的条件是
   * 「这条中期条目老于 15 天」。可一条条目过了 15 天之后，**之后每次检查它都依然「老于 15 天」**
   * ——不记一笔就会被反复重压，越压越干、还白花 API。这一格记下压过的时刻，压过就跳过。
   * 老数据没有这格＝没压过，照常参与（行为与加它之前一致，不需要迁移）。
   */
  refinedIso?: string;
}

/**
 * **一批「浓缩之前的原话」底稿**（记忆 App · 原始记录页用）。
 *
 * 每次线上浓缩成功，就把这一批被收走的聊天原话照录下来，跟产出的条目挂上钩——
 * 页面上「哪一天收走了哪几条、浓缩出了什么」才交代得清。
 * 存在 `CharacterMemory` 里＝跟记忆同生命周期：清空记忆时这份记录一删，底稿自然跟着没。
 */
export interface MemoryRawBatch {
  id: string;
  /** 这批原话覆盖的时间段（ISO 起止）。 */
  fromIso: string;
  toIso: string;
  /** 浓缩完成的时刻（ISO）——页面上那句「浓缩于 …」。 */
  condensedAtIso: string;
  /** 这批被收走的原话（浓缩前照录；系统消息不在此列）。 */
  messages: { id: string; role: ChatMessage["role"]; content: string; createdAt: string }[];
  /** 这批浓缩产出的记忆条目 id（跟 `items` 对得上）。 */
  itemIds: string[];
  /** 线下见面那条线归总出来的（以后接，线上为空）。 */
  offline?: boolean;
}

/** 角色的类人记忆（每个「角色 × 面具」一份，跟着会话走）。 */
export interface CharacterMemory {
  /** 会话 id（角色id::面具id）。 */
  convId: string;
  characterId: string;
  maskId: string;
  /** 记忆开关（关闭＝不浓缩不压缩也不注入，已有记忆保留）。 */
  enabled: boolean;
  /** 上下文条数：当前批攒满多少条触发整批浓缩（10 步进，默认 50）。 */
  contextLimit: number;
  /** 自动浓缩开关（关＝攒满也不自动浓缩，只能手动归总）。 */
  autoCondense: boolean;
  /** 全部记忆条目（短期/中期/长期/重要混存，按 tier 过滤展示）。 */
  items: MemoryItem[];
  /** 已浓缩到哪条消息（ISO 水位线；之后的是「当前批」）。 */
  summarizedToIso: string;
  /** 当前批已攒的消息条数（达到 contextLimit 触发浓缩）。 */
  newCount: number;
  /**
   * **线下这一条线的水位线**（1.7.46，ISO）：已经归总进记忆的线下记录截止到哪一条。
   *  与 `summarizedToIso`（只管线上的消息）各管各的——线下自己按「几轮」归总一次，
   *  线上那趟浓缩再遇到线下素材时，要跳过这段已经归总过的，免得同一段见面被归总两遍、
   *  记忆里出现两份。
   */
  offlineSummarizedTo?: string;
  /**
   * 朋友圈动态的「模糊印象」：被压进这段回忆的那些旧动态合成的一段话。
   * 跟记忆四层同构，近的原文照录、更早的只剩印象。
   * 存在这里＝跟记忆同生命周期：清空记忆时这份记录一删，印象自然跟着没。
   */
  momentDigest?: string;
  /** 已经压进 `momentDigest` 的那批动态的 id。
   *  记 id 而不是条数：随时可能把某条标为「重要」（见 `ChatMoment.pinnedByUser`），
   *  条数会跟着错位、让个别动态两头落空；按 id 认，标／取消都不会牵动已压好的那段。 */
  momentDigestIds?: string[];
  /**
   * 「我」发的朋友圈的「模糊印象」：被压进这段回忆的那些旧动态合成的一段话。
   * 与 `momentDigest` 同构，只是这条线记的是**她发的**动态——只有这个角色（这个世界）
   * 有权看的那些；可见范围在压缩时已按角色筛过，被挡在外面的角色进不了它的印象。
   */
  myMomentsDigest?: string;
  /** 已经压进 `myMomentsDigest` 的那批动态的 id（理由同 `momentDigestIds`）。 */
  myMomentsDigestIds?: string[];
  /**
   * **浓缩底稿**：每次线上浓缩收走的那批聊天原话（新的在前，只留最近若干批）。
   * 记忆 App 的「原始记录」页就摊这个——跟记忆同生命周期，清空记忆时一删跟着没。
   * 老数据没这格＝没记过底稿，页面显示空态，不迁移。
   */
  rawBatches?: MemoryRawBatch[];
  /* ---------- 分层压缩刻度（1.7.66，都可在记忆 App 设置区里拧）----------
     一把好记的尺子：一周全细节、半月有经过、一月剩骨架、更早只剩印象。
     存的是「实际用值」；没设过（老数据）＝undefined，读侧一律用默认值兜底。 */
  /** 短期保鲜（天）：短期条目超过这么多天轻压进中期。默认 7。 */
  shortFreshDays?: number;
  /** 短期当天上限（条）：某类条目同一天堆到这么多条就当天收口（兜底）。默认 20。 */
  shortSameDayMax?: number;
  /** 中期熔合门槛（天）：中期条目老于这么多天才重压成骨架。默认 15。 */
  midRefineDays?: number;
  /** 中期保鲜（天）：中期条目超过这么多天进长期。默认 30。 */
  midFreshDays?: number;
  /** 中期条数上限（条）：某类中期条目堆到这么多条就强制重压（兜底）。默认 60。 */
  midMaxItems?: number;
  /** 单次补压上限（条）：打开记忆 App 时一次最多补压多少条，压不完下次接着压。默认 200。 */
  catchupBudget?: number;
  /** 短期注入上限（条）：0／没设＝关闭（短期条目全量注入）；
   *  开了＝短期只发最近的这么多条，多的不注入（溶池兜底，压下去还捞得回来）。默认关闭。 */
  shortInjectLimit?: number;
  /**
   * **同一批连着失败了几次**（1.7.66 失败跳闸）：键＝「分类|线上线下」，值＝连续失败次数。
   * 为什么要有它：某一天的那批素材一直压不出来（站子不稳、内容超长等），如果每次打开
   * 都重试一遍，一趟几十秒，会一直白花钱、还拖着后面的日子；连栽三次就跳过它，
   * 把那天的日期记进 `failedDays`，日历上标一句「这天的记忆没能整理」，让她自己决定
   * 要不要手动压。哪次压成功了就把这格删掉（说明这条路通了）。
   */
  compressFails?: Record<string, number>;
  /** 没能整理的那几天（YYYY-MM-DD，1.7.66）：日历在那天角上标一句，别的什么都不做。 */
  failedDays?: string[];
  updatedAt: string;
}

/**
 * 线下场合（1.7.5）：一条记录。
 *
 * 线上线下是两套写法，所以线下单开一份记录（存 `chat-offline-scenes`），不塞进
 * `Conversation.messages`——那边绑着未读数、列表预览、媒体占位一大片假设。
 * 但**记忆是通的**（1.7.7）：浓缩时把这份记录并进线上素材，线上请求也带一截最近的经过
 * （见 OfflineScenePage 的 withOffline / offlineTranscript）。
 * `user`＝她这一轮写的行动／话，`assistant`＝TA 那一段，`system`＝失败提示（可重来）。
 */
export interface OfflineEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** 这条系统提示是「这一轮没成」，可一键重来（照 ChatMessage.retryable）。 */
  retryable?: boolean;
  /** 两场之间的**分界线**（1.7.9）：按「结束」收场时压一条在尾巴上，
   *  只给屏幕看——不进记忆、不喂模型、不占字数（`offlineAsMessages` 滤掉 system）。 */
  divider?: boolean;
  /** 她这一条是**动作／神情／心里那句**（1.7.11）：输入栏左边那颗斜体钮开着时写下来的。
   *  渲染成浅灰斜体旁白（不走右粉气泡），喂模型时包上 `*…*`——与 TA 那侧的旁白同一个写法。 */
  act?: boolean;
  /** 这一条**发给模型时的完整原文**（1.7.51）：她这一轮的话后面还挂着「【场景】××」
   *  「【已经演过的】…」与此刻那串易变尾巴（见 ChatWindow 的 generateOfflineReply），
   *  这里记的**就是那一整份**。回喂历史时原样送回——「发出去＝存下来＝回喂」必须是同一份，
   *  否则站子逐字比对到这条就断，其后整段每轮作废重写（与 ChatMessage.apiText 同一格道理）。
   *  只给模型用，气泡里永远显示 content，她看不到它；长按改话时连同它一起抹掉。
   *  旧记录没有这一栏：那条走原有的光原文回喂，照旧。 */
  apiText?: string;
  /** **进度行**（1.7.45）：TA 每一轮结尾另起一行留的那句「【本轮】……」（一句话说清这一轮
   *  刚发生的那一件事）。`OfflineScenePage` 接话时把它从正文里摘出来、挂在**这一轮最后一条**
   *  `assistant` 记录上——不进正文、不显示、也不算他戏里的话；发下一轮请求时由 `ChatWindow`
   *  把前面各轮的 beat 按顺序拼成一份「【已经演过的】」进度单，摆在他眼前，治他绕回老话题、
   *  复读老台词（照参考项目那套每轮自报一条事件小结的做法）。旧记录没有这一栏，照旧。 */
  beat?: string;
  /**
   * 她**连发**攒下的那几条已经并进后面那条了（1.8.4）：值是承接那条的 id。
   *
   * 为什么要有它：她一口气写好几句再按爱心（线下锁死连发，见 `send`／`forceReply`），
   * 记录里就是连着好几条 `user`。一条一条当独立对话轮次摆给模型，模型常只应最后一条
   * （她报的「打三行字，他只读了一两条」）。所以发出去时把这一串合成**一轮**：
   * 承接那条（最后一条）记下合并后的原文（见 `mergedText`／`apiText`），前几条落这一格。
   * 回喂历史（`offlineAsMessages`）跳过它们，屏幕上照旧一格一句话、不并、不删。
   */
  foldedInto?: string;
  /**
   * 承接那条记的**合并原文**（1.8.4）：那串连发的话按顺序接起来（`offlineAsMessages`
   * 非回喂那一路也读它，记忆归总与回线上那份「经过」才不会丢掉前几句）。
   * `apiText` 是同一份再加【场景】／【进度】／此刻那串易变尾巴——两者分工同别处：
   * 这个给记忆，那个给回喂。只有承接那条会有它（单发一条时不写，照旧走 `content`）。
   */
  mergedText?: string;
  /** **场景签**（1.7.32）：她在输入框上方那条淡功能条上按「场景签」手标的地点，
   *  压成一条 `role:"system"` 的记录——与分界线同理，**只给屏幕看**：不进记忆、不喂模型
   *  （`offlineAsMessages` 滤掉的就是 system）。
   *  喂料走另一路：ChatWindow 从记录里倒着取**最后一条场景签**（跨过「这一场到此」那条线
   *  就归零），拼一行「【场景】××」挂在她这一轮的话后面（见 currentSceneOf）。 */
  scene?: string;
}

/** 线下场合（1.7.5）：一个会话（角色 × 面具）的下线记录。 */
export interface OfflineScene {
  /** 会话 id（`${characterId}::${maskId}`）。 */
  convId: string;
  entries: OfflineEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 「外语聊天」的每聊天设定（1.9.48）。
 *
 * 口径（1.9.50 扩过一版）：**他说出口的话**（气泡正文 ＋ 语音）直接用 `lang`，气泡下方
 * **自动**挂一行中文；**他写下的字**（签名、心声、日记、环境／心情／欲望／怯念／细处）
 * 也用 `lang` 写，但**不自动翻**——在「名字下方的签名」和「心声页」里**点一下才翻**成中文，
 * 再点切回外语（译文缓存在 `Conversation.transCache`）。动态（朋友圈）这一版仍不动。
 *
 * - `out`：他说外语。开了之后他写气泡用 `lang`，气泡下方挂一行中文；语音也念这个语言。
 * - `in`：我说的话。开了之后我在输入框里照打中文，发出去前翻成 `lang`，
 *   气泡显示外语、下面挂我那句中文本意。
 * - `show*`：各自那一行译文显不显示（关掉＝只留外语，但译文照旧存着，随时能翻出来）。
 * - `api`：翻译交给哪套文本接口；`sub`＝副接口（便宜、够用），留空／没配会自动退回主接口。
 *   1.9.80 起他说话改成**一次就写「原文|中文」两半**（不再事后发第二次请求），
 *   这一套只当**兜底**：哪句漏写了竖线，才用它补翻。
 * - `inner`：心声页双语（1.9.80）。`: true` 时回复最前面那段 <think> 里的每一行也照
 *   「原文|中文」一次写完，心声页进去就显中文、不用点；关着则只写外语、照旧点一下才翻。
 */
export interface TranslateSetting {
  out: { on: boolean; lang: string; show: boolean };
  in: { on: boolean; lang: string; show: boolean };
  api: "main" | "sub";
  inner: boolean;
}

/** 语言一览：给设置页的下拉用（存的是这几个值，翻译提示词照它写）。 */
export const TRANSLATE_LANGS: { value: string; label: string }[] = [
  { value: "日语", label: "日语" },
  { value: "英语", label: "英语" },
  { value: "韩语", label: "韩语" },
  { value: "法语", label: "法语" },
  { value: "德语", label: "德语" },
  { value: "西班牙语", label: "西班牙语" },
  { value: "俄语", label: "俄语" },
];

/** 一个角色 × 一个面具一个会话（换面具＝换身份重新聊；id 为「角色id::面具id」）。 */
export interface Conversation {
  id: string;
  characterId: string;
  /** 会话所属面具 id；旧数据没有此栏位时视为默认面具。 */
  maskId?: string;
  messages: ChatMessage[];
  /** 这条会话「真聊过」没有（第一条消息落库时盖上；清记忆／清聊天记录都不摘）。
   *  列表拿它遮掉助手预绑的空会话，不能用「消息条数为 0」——重置记忆后消息列表的
   *  对话框应该还在，按条数遮就会把清完的会话一起遮掉。 */
  chatStarted?: boolean;
  createdAt: string;
  updatedAt: string;
  /** 置顶聊天。 */
  isPinned?: boolean;
  /** 消息免打扰。 */
  isMuted?: boolean;
  /** 连续发送（手动回复）：开启后发消息不再自动回复、可以一条接一条地发，攒够了再按爱心让 TA 一次回完。 */
  manualReply?: boolean;
  /** 外语聊天（1.9.48）：他说外语、我说中文，气泡下方各挂一行中文。见 TranslateSetting。 */
  translate?: TranslateSetting;
  /** 外语聊天（1.9.50）：「点一下才翻」的那些字的**中文译文缓存**——键＝源文（外语）逐字，
   *  值＝中文。签名、心声页里的心声／日记／环境／心情／欲望／怯念／细处都存这儿。
   *  翻过一次就记着：再点瞬间切中文、也不再多花钱。签名在会话载入时提前翻好存进来
   *  （就一行、很少变），点的那一下零等待（恩熙：「会不会有延迟」）。 */
  transCache?: Record<string, string>;
  /** 气泡条数：开着一轮回复最多 bubbleMax 条气泡（未设＝默认开，见 chat.ts 的 bubbleCapOf）。 */
  bubbleLimit?: boolean;
  /** 气泡条数上限（1-15，未设＝默认 5）。 */
  bubbleMax?: number;
  /** 线下场合：每段回应的字数下限（未设＝默认 300，见 settings/chat.ts 的 offlineWordsOf）。 */
  offlineWordsMin?: number;
  /** 线下场合：每段回应的字数上限（未设＝默认 600）。 */
  offlineWordsMax?: number;
  /** 线下场合：记忆带最近几轮（未设＝默认 10，范围 2-30，见 settings/chat.ts 的 offlineMemoryRoundsOf）。
   *  一个数管两件事：每次只把最近这么多轮的原文摆给他；每攒够这么多轮就把这段归总一次、
   *  进短期记忆（旧的不再整段重放，已经在记忆里了）。 */
  offlineMemoryRounds?: number;
  /** 刚在线下见过面（1.7.5）：线上下一轮自动带一句「你们刚见过，别装不知道」，用掉即清。 */
  offlineReturnNote?: boolean;
  /** 线下这一场**正开着**（1.7.39，落库＝线上线下的总闸）：开着的时候线上发不了消息。
   *  只有线下页里那颗「结束这一场」把它放平；线下页左上角的「返回」只是把这一页收起来
   *  （回线上看记录），这一栏照旧是 true。App 重开／杀掉再进这个会话也认它——
   *  直接又回到线下那一页，不必再点一次「去见他」。 */
  offlineOpen?: boolean;
  /** 未读消息数。 */
  unreadCount?: number;
  /** 自定义聊天背景图（data URL，未设＝默认底色，见 chat/shared.ts 的 CHAT_BG_DEFAULT）。 */
  chatBgUrl?: string;
  /** 聊天字号（10-24，默认 14）。 */
  fontSize?: number;
  /** 自定义角色头像（仅本聊天生效，不改动档案本体）。 */
  charAvatar?: string;
  /** 自定义我的头像（仅本聊天生效）。 */
  myAvatar?: string;
  /** 角色参考图（TA 发自拍时连同描述走「图片编辑」接口，锁定长相；仅本聊天生效）。
   *  新数据存的是图片仓库引用串 `media-store://mc_xxx`（图本身在独立库里，免得会话记录
   *  这个「整份读出」的键被 base64 撑爆）；老数据仍是 data URL，两种都要认。 */
  charRefImage?: string;
  /** 动态签名（TA 随聊天自行更新；空则资料页显示档案默认）。 */
  signature?: string;
  /** TA 发过的动态（随聊天累积）。 */
  moments?: ChatMoment[];
  /** 好友状态：normal 正常／removed 已删除（记录保留，等 TA 发来好友申请）／requested TA 已发来申请。 */
  friendStatus?: "normal" | "removed" | "requested";
  /** 删除好友的时间（ISO；用于计算 TA 何时发来好友申请）。 */
  removedAt?: string;
  /** TA 好友申请附的话（再给我一次机会之类，按 TA 人设生成）。 */
  friendRequestMsg?: string;
  /** 拉黑中（TA 那边显示消息发不出去，但消息其实会送达）。 */
  blocked?: boolean;
  /** 被拉黑过的次数（解除后 TA 会记得这段经历）。 */
  blockCount?: number;
  /** 角色设置：个别 API 配置（覆盖全局；未配置的分类跟随全局）。 */
  apiOverrides?: {
    text?: ChatApiSettings;
    image?: ChatApiSettings;
    voice?: ChatApiSettings;
  };
  /** 角色设置：个别语音参数（音色/语速/音调；空则跟随全局）。 */
  voiceOverride?: VoiceApiExtras;
  /** 角色设置：个别语音提示词（不存在则跟随全局；存在＝这个角色单独用这份规矩）。 */
  voicePromptOverride?: VoicePromptConfig;
  /** 主动找我（1.10.30）：TA 没被喊也会自己来消息、自己发动态（未设＝默认开，见 settings/chat.ts 的 proactiveOnOf）。 */
  proactiveOn?: boolean;
  /** 主动找我的基础间隔（分钟；未设＝默认 360，见 proactiveBaseMinOf）。
   *  这只是个标称值，TA 会按你们的情景自己浮动多久再来。 */
  proactiveBaseMin?: number;
  /** 深夜模式（1.10.30）：开（默认）则 23:00-08:00 不主动来消息；关掉则深夜也照发。见 proactiveQuietOf。 */
  proactiveQuiet?: boolean;
}

/** API 设定：填好并启用后才会请求真后端。 */
export interface ChatApiSettings {
  /** OpenAI 兼容 base URL（含 /v1）。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否已启用真后端；false 时不请求，发消息只会得到系统提示。 */
  enabled: boolean;
  /**
   * 流式输出：开启后边生成边显示（打字机效果），关闭则等 TA 整段写完一次显示。
   * 不填视为开启；服务商不支持流式时可关掉，省去一次失败的尝试。
   */
  stream?: boolean;
  /**
   * 采样温度（0~2）：越高越发散、越低越稳。三种状态：
   * 不填＝跟随调用方默认（聊天 0.8，记忆整理 0.3）；数值＝按它发；
   * `null`＝**这个接口不吃温度**，一律不发（部分代理开了思考就拒收 temperature）。
   * 推理型模型（deepseek-reasoner、o1/o3 等）始终不发。
   */
  temperature?: number | null;
  /** 频率惩罚（-2~2）：按词出现次数压，治复读。不填＝按内置温和值（0.3）发；设 0＝不发。 */
  frequencyPenalty?: number;
  /** 存在惩罚（-2~2）：按词出现过没有压，治绕圈。不填＝按内置温和值（0.3）发；设 0＝不发。 */
  presencePenalty?: number;
  /** MiniMax 团队 ID（仅 MiniMax 需要，见平台「账户管理」页）。 */
  groupId?: string;
  /** 来源预设方案 ID（角色设置页点选方案时记录；全局配置不带）。 */
  presetId?: string;
  /** 来源预设方案名（方案被删后仍能显示来源）。 */
  presetName?: string;
}

/** API 设定分类：文本（聊天回复）／图文（图片生成）／语音（语音合成）／副（幕后活专用）。 */
export type ApiCategory = "text" | "image" | "voice" | "sub";

/** 四类 API 设定合集（各自独立配置、独立启停）。 */
export interface ApiSettingsBundle {
  text: ChatApiSettings;
  image: ChatApiSettings;
  voice: ChatApiSettings;
  /**
   * 副 API（1.2，恩熙 2026-09-28 拍板动工）：幕后活专用——记忆归总／压缩、查手机时给
   * TA 开的账本（1.9.4）这类「不需要文采、要稳要快」的活优先走它，可以配个更便宜更快的模型。
   * 留空／未启用＝这些活退回主文本接口（改走流式保活，见 memory 的 fetchMemoryTask）。
   */
  sub: ChatApiSettings;
  /** 图文 API 附加参数（生成图片时的尺寸／质量／提示词）。 */
  imageExtras: ImageApiExtras;
  /** 语音 API 附加参数（合成语音时的音色／语速／音调）。 */
  voiceExtras: VoiceApiExtras;
}

/** 图文 API 附加参数（仅 image 分类使用）。 */
export interface ImageApiExtras {
  /** 图片尺寸（如 1024x1024）。 */
  size: string;
  /** 图片质量：auto / low / medium / high。 */
  quality: string;
  /** 画风预设：整段画风描述，拼在正面提示词最前面（可留空）。 */
  stylePreset: string;
  /** 正面提示词前缀（拼在提示词最前面、画风预设之后）。 */
  positivePrompt: string;
  /** 正面提示词后缀（拼在提示词末尾，用来补细节）。 */
  promptSuffix: string;
  /** 负面提示词（想避免出现的内容）。 */
  negativePrompt: string;
  /** 中文提示词先经文本 API 译成英文再生图（需配置并启用文本 API）。 */
  translatePrompt: boolean;
  /** 锁脸方式：ref＝角色参考图（长相稳定，但表情角度容易跟着参考图走）；
      text＝纯文字锁脸（miya 同款：不送参考图，长相全靠人设文字，表情角度完全自由、偶尔走样）。
      缺省按 ref。 */
  faceLockMode?: "ref" | "text";
  /* ---- 下面四个采样参数只有 NovelAI 官方接口吃，别的接口一律忽略 ---- */
  /** 采样步数（1–50，默认 28）。 */
  steps: number;
  /** 提示词引导强度 CFG Scale（0–10，默认 5）。 */
  cfgScale: number;
  /** 采样器（NovelAI 的 sampler 名，默认 k_euler_ancestral）。 */
  sampler: string;
  /** 随机种子（空字符串＝每次随机）。 */
  seed: string;
}

/** 图文附加参数默认值。 */
export const DEFAULT_IMAGE_EXTRAS: ImageApiExtras = {
  size: "1024x1024",
  quality: "auto",
  stylePreset: "",
  positivePrompt: "",
  promptSuffix: "",
  negativePrompt: "",
  translatePrompt: false,
  steps: 28,
  cfgScale: 5,
  sampler: "k_euler_ancestral",
  seed: "",
};

/** 语音 API 附加参数（仅 voice 分类使用）。 */
export interface VoiceApiExtras {
  /** 音色（服务商的 voice 名，如 alloy / nova / 沉郁大叔…）。 */
  voice: string;
  /** 语速（0.25–4.0，1＝正常）。 */
  speed: number;
  /** 音调（-1 到 1，0＝正常）。 */
  pitch: number;
  /**
   * 情绪起伏档（0–1，0.5＝中性；越低越有情绪起伏、越活，越高越平）。**仅 ElevenLabs 用**，
   * 对应它 voice_settings.stability；别家服务商没这一格，传了也被忽略。
   */
  stability: number;
  /**
   * 风格夸张度（0–1，0＝自然；越高越入戏、越夸张）。**仅 ElevenLabs 用**，对应它
   * voice_settings.style；别家服务商没这一格。
   */
  style: number;
}

/** 语音附加参数默认值。 */
export const DEFAULT_VOICE_EXTRAS: VoiceApiExtras = {
  voice: "alloy",
  speed: 1,
  pitch: 0,
  /* 1.9.87：默认给一点表现力（恩熙定「中」）——0.5 是 ElevenLabs 的中性值，往下压一点
     声音就更有起伏、更像在跟人说话而不是念稿；style 抬一点让它更入戏。两格都只是**默认**，
     设置里可随时拖。 */
  stability: 0.4,
  style: 0.4,
};

/**
 * 语音提示词配置：一段用户自填的「〔语音〕里说的话」的规矩，随每次请求拼进发给聊天
 * 模型的系统提示词（见 chatApi.ts 的 buildStylePrompt「### 发语音」一节的【格式】之后），
 * 让聊天模型按这份规矩写〔语音〕里**那句台词本身**（说什么、什么口吻、要不要插
 * ElevenLabs 方括号标签）。**不管**要不要发语音、怎么标〔语音〕——那是同一节【规则】的事。
 *
 * 全局一份（ChatPrefs 的 voicePromptOn / voicePromptText）；
 * 角色可单独覆盖：`voicePromptOverride` **存在**＝这个角色用自己这份（不回落全局），
 * 不存在＝跟随全局（与 voiceOverride 同一种 presence＝开启的写法）。
 */
export interface VoicePromptConfig {
  /** 语音里说的话的规矩原文。 */
  text: string;
}

/** 用户自存的 API 预设方案（可命名、可改名、可删除；按分类归档）。 */
export interface ApiPresetEntry {
  id: string;
  /** 显示名（可随时改）。 */
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 语音生成参数（仅语音方案携带：音色／语速／音调）。 */
  voiceExtras?: VoiceApiExtras;
  /** 图文生成参数（仅图文方案携带：尺寸／质量／提示词等）。 */
  imageExtras?: ImageApiExtras;
  /** ISO 创建时间。 */
  createdAt: string;
  /** ISO 最后修改时间。 */
  updatedAt: string;
}

/** API 设定预设值。 */
export const DEFAULT_API_SETTINGS: ChatApiSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  enabled: false,
};
