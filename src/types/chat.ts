/** 星绥通讯：会话、消息与 API 设定。 */

/** 消息类型（跟随旧档案）：文字、文字图片、语音、红包、转账、文件、位置、系统提示。 */
export type ChatMessageType =
  | "text"
  | "image"
  | "voice"
  | "redpacket"
  | "transfer"
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
  /** 红包／转账金额。 */
  amount?: number;
  /** 文件名／文件大小。 */
  fileName?: string;
  fileSize?: number;
  /** 引用的原文摘要（引用回复时附带）。 */
  quote?: string;
  /**
   * 这条消息**发给模型时的完整原文**（含易变尾巴：关键词世界书／签名取值）。
   * 回喂历史时原样送回——「发出去＝存下来＝回喂」必须是同一份，否则站子逐字比对
   * 到这条就断，其后整段历史每轮作废重写（见 AGENTS.md 第 55／56 条）。
   * 只给模型用，气泡里永远显示 content，用户看不到它。
   */
  apiText?: string;
  /** 这张图的生图诊断（走了哪条通道／参考图有没有真的送出／实发提示词原文）。 */
  diag?: ImageDiag;
}

/**
 * 生图诊断（排查用，2026-09-18 恩熙要求加）。
 * 为什么要有它：她反馈「带参考图出的图既不像参考图、也不像人设」时，光看提示词层
 * 看不出病根——如果所用站点不认图片编辑接口，代码会退成**纯文生图**（参考图压根
 * 没进去），那时提示词写得再严也没用。这条把「实际发生了什么」落到消息上，可查。
 */
export interface ImageDiag {
  /** 实际生效的通道：images＝图片生图接口／edits＝图片编辑接口（参考图走这条）／
   *  chat＝聊天接口／nai＝NovelAI 官方接口（走服务端中转）。 */
  via: "images" | "chat" | "edits" | "nai";
  /** 这一次请求里真的送出去的参考图张数（0＝没送出去）。 */
  refsSent: number;
  /** 进生图层时手上准备好了几张参考图（0＝参考图根本没到生图层，问题在调用侧）。
   *  可选：1.0.59 那批记录没有这一格。 */
  refsPrepared?: number;
  /** refsSent 为 0 的原因（图片编辑接口被拒的原话，或调用侧说明为什么没带图）。 */
  refSkipReason?: string;
  /** 最终发给画图模型的那版提示词原文（开了翻译是译后英文）。 */
  prompt: string;
  /** 提示词翻译失败，已退回中文原文发送。 */
  translateFailed: boolean;
}

/** TA 发的一条动态（随聊天累积，资料页时间轴展示）。
 *
 * 恩熙 2026-09-21：「他发图文不是只会发图片，还会配上文字解说。」
 * TA 用〔动态图〕标记写一段画面描述（可选），生成图片是恩熙在朋友圈页面手动触发。
 *
 * imagePrompt：TA 写的画面描述（恩熙还没点生成时这里就已经有内容了）。
 * imageRef：恩熙点生成、接口跑完后，回写的 media-store:// 引用串。
 *   — 有 imagePrompt 但 imageRef 还在 → 显示「生成配图」按钮。
 *   — imageRef 已落 → 文字解说 + 下面摊一张图。
 *   — 没有 imagePrompt → 纯文字动态，没有任何按钮。
 */
export interface ChatMoment {
  id: string;
  content: string;
  /** ISO 时间戳。 */
  createdAt: string;
  /** TA 用〔动态图〕标记写的画面描述（可选）；恩熙在朋友圈手动点生成。 */
  imagePrompt?: string;
  /** 恩熙点生成后，接口跑完回写的 media-store:// 图片引用串。 */
  imageRef?: string;
  /**
   * 恩熙手动标为「重要」的动态：永远以原文留在 TA 的记忆里——
   * 不参与压缩（不会被合进模糊印象）、也不被注入上限挤掉。
   * 恩熙 2026-09-21：「那朋友圈是不是也要有一个能够标记为重要 的功能呢？」
   * 命名跟 `MemoryItem.pinnedByUser` 对齐（同一套「用户手动标的」口径）。
   */
  pinnedByUser?: boolean;
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
   * 朋友圈动态的「模糊印象」：被压进这段回忆的那些旧动态合成的一段话。
   * 恩熙 2026-09-21：「朋友圈也可以去进行压缩，因为我肯定不会记得我上个月发的
   * 朋友圈内容写了什么」——跟记忆四层同构，近的原文照录、更早的只剩印象。
   * 存在这里＝跟记忆同生命周期：清空记忆时这份记录一删，印象自然跟着没。
   */
  momentDigest?: string;
  /** 已经压进 `momentDigest` 的那批动态的 id。
   *  记 id 而不是条数：恩熙可能随时把某条标为「重要」（见 `ChatMoment.pinnedByUser`），
   *  条数会跟着错位、让个别动态两头落空；按 id 认，标／取消都不会牵动已压好的那段。 */
  momentDigestIds?: string[];
  updatedAt: string;
}

/** 一个角色 × 一个面具一个会话（换面具＝换身份重新聊；id 为「角色id::面具id」）。 */
export interface Conversation {
  id: string;
  characterId: string;
  /** 会话所属面具 id；旧数据没有此栏位时视为默认面具。 */
  maskId?: string;
  messages: ChatMessage[];
  /** 这条会话「真聊过」没有（第一条消息落库时盖上；清记忆／清聊天记录都不摘）。
   *  列表拿它遮掉助手预绑的空会话，不能用「消息条数为 0」——2026-09-21 恩熙：
   *  「我重置记忆以后消息列表的对话框不见了应该要存在的」，按条数遮就会把清完的会话一起遮掉。 */
  chatStarted?: boolean;
  createdAt: string;
  updatedAt: string;
  /** 置顶聊天。 */
  isPinned?: boolean;
  /** 消息免打扰。 */
  isMuted?: boolean;
  /** 连续发送（手动回复）：开启后发消息不再自动回复、可以一条接一条地发，攒够了再按爱心让 TA 一次回完。 */
  manualReply?: boolean;
  /** 气泡条数：开着一轮回复最多 bubbleMax 条气泡（未设＝默认开，见 chat.ts 的 bubbleCapOf）。 */
  bubbleLimit?: boolean;
  /** 气泡条数上限（1-15，未设＝默认 5）。 */
  bubbleMax?: number;
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
  /** 频率惩罚（-2~2）：按词出现次数压，治复读。不填＝不发送。 */
  frequencyPenalty?: number;
  /** 存在惩罚（-2~2）：按词出现过没有压，治绕圈。不填＝不发送。 */
  presencePenalty?: number;
  /** MiniMax 团队 ID（仅 MiniMax 需要，见平台「账户管理」页）。 */
  groupId?: string;
  /** 来源预设方案 ID（角色设置页点选方案时记录；全局配置不带）。 */
  presetId?: string;
  /** 来源预设方案名（方案被删后仍能显示来源）。 */
  presetName?: string;
}

/** API 设定分类：文本（聊天回复）／图文（图片生成）／语音（语音合成）。 */
export type ApiCategory = "text" | "image" | "voice";

/** 三类 API 设定合集（各自独立配置、独立启停）。 */
export interface ApiSettingsBundle {
  text: ChatApiSettings;
  image: ChatApiSettings;
  voice: ChatApiSettings;
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
}

/** 语音附加参数默认值。 */
export const DEFAULT_VOICE_EXTRAS: VoiceApiExtras = {
  voice: "alloy",
  speed: 1,
  pitch: 0,
};

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
