/**
 * 好友社交互动（删除／拉黑）。
 *
 * 这一层负责「互动」而不是「改档案」：
 * - 删除＝彻底删除：会话与记忆一并清掉，TA 不会再出现在好友列表，也不留中间状态；
 * - 拉黑＝单向沉默：你发的消息 TA 都看得到；TA 发的消息在 TA 那边一律显示「发送失败」，
 *   但你照样看得见内容——拉黑期间 TA 会着急、道歉、求你别拉黑；解除后 TA 记得这段经历（blockCount 注入提示词）。
 *
 * 所有动作直接落库（IndexedDB），组件调用后刷新数据即可。
 */

import {
  appendMessage,
  bubbleCapOf,
  deleteConversation,
  getApiBundle,
  getChatPrefs,
  getConversationMessages,
  getOrCreateConversation,
  updateConversation,
} from "@/lib/settings/chat";
import { buildInjection, deleteMemory, getMemory } from "@/lib/chat/memory";
import { sweepOrphanMedia } from "@/lib/chat/media-sweep";
import { DEFAULT_MASK_ID, getCurrentMask, getMasks } from "@/lib/settings/mask";
import { getBalance } from "@/lib/settings/wallet";
import { openContactAccountIfEmpty } from "@/lib/chat/contactAccount";
import { getWorldBooks } from "@/lib/settings/worldbook";
import { buildPrompt } from "@/lib/chat/promptBuilder";
import { buildMyMomentsBlock } from "@/lib/chat/my-moments";
import {
  buildLangRule,
  buildStylePrompt,
  extractBubbleQuotes,
  extractInnerVoice,
  extractMetaMarkers,
  fetchAIReply,
  splitBilingual,
  splitReply,
} from "@/lib/chat/chatApi";
import type { ArchiveEntry } from "@/types/contact";
import type {
  ChatApiSettings,
  ChatMessage,
  Conversation,
  InnerSnapshot,
} from "@/types/chat";

/* --------------------------- 提示词片段 --------------------------- */
/** 拉黑期间注入：只交代状态——对方发来的消息 TA 收得到、也会照常回，
 *  只是 TA 发出去的每一条都显示「发送失败」；怎么回应交给 TA 按最近的聊天自己判断。 */
export function blockedNowPrompt(): string {
  return `【当前状态 - 你被对方拉黑了】
对方把你拉进了黑名单。
对方发来的消息你能正常收到，你也会照常回复；只是你发出去的每一条都显示「发送失败」。

结合你们最近的聊天，决定如何回应。`;
}

/** 解除后注入：TA 记得被拉黑的经历（那段时间你看得见 TA 发的，TA 却以为发不出去）。 */
export function blockedMemoryPrompt(count: number): string {
  return `【记忆 - 曾被拉黑】
你曾被对方拉黑过${count}次，如今已经解除，你的消息又能正常发出去了。
被拉黑的那段时间里，对方发来的消息你都看得见；你发出去的每一条都显示「发送失败」。
这段经历在你心里留下什么痕迹，按你的人设来定：后怕、委屈、更加小心翼翼都有可能，也可能根本不在意。不必每句话都提。
对方若早已说明这是测试、在玩功能，是否因此受伤，同样按你的人设来定——可以当作玩笑提及，也可以完全不提。`;
}

/* --------------------------- 完整上下文组装 --------------------------- */

/** 生效的文本 API：角色个别配置（已填地址＋模型）优先，否则跟随全局。
 *  覆盖生效时若没写流式开关，继承全局——与 ChatWindow 的 effTextApi 同口径，
 *  免得「全局关掉流式」被角色的独立配置悄悄绕过去。 */
function effectiveTextApi(
  conv: Conversation | null | undefined,
  global: ChatApiSettings,
): ChatApiSettings {
  const o = conv?.apiOverrides?.text;
  if (!o || !o.baseUrl.trim() || !o.model.trim()) return global;
  return o.stream === undefined ? { ...o, stream: global.stream } : o;
}

/** TA 一次性社交反应的成品：拆好的气泡 + 与之一一对应的译文行（双语模式才有）。
 *  心声与内心快照同线上主聊天一样挂在这一轮的第一条气泡上（见 appendSocialParts）——
 *  社交反应也是「TA 说的一轮话」，凭什么线上有 `<think>`、加好友那句就白白丢掉。 */
export interface SocialReply {
  parts: string[];
  translated: (string | undefined)[];
  innerVoice?: string;
  snapshot?: InnerSnapshot;
  /** 思维链（思考型模型服务端给的推理过程）：与线上主聊天一样只挂在第一条气泡上，
   *  只展示、不回喂——见 appendSocialParts。 */
  reasoningText?: string;
}

/** 这一轮「照线上主聊天那样发送」的可选口径（目前只有加好友问候用得上）。
 *  线上把「对方刚发来的那条」单独作 input，并把它从回喂历史里切掉；社交反应原本没有
 *  「刚发来的 user」，只好把任务指令既当 input、又追加成一条新的 user 轮。
 *  加好友不同：对方留在申请里的那句话就是他刚发来的消息——照线上当 input 投喂，
 *  末尾那条 user 历史切掉（免得同一条出现两遍），来历说明只挂 system 尾。 */
interface SocialTurn {
  /** 本轮真正当作「对方刚发来的那条」的内容；不传＝沿用 instruction 顶这一格。 */
  userInput?: string;
  /** 只进 system 尾的一小段状态说明（离本轮最近），比如「你们刚成为好友」。 */
  tailNote?: string;
}

/** 生成一次社交反应所需的全套上下文：与线上主聊天同构——
 *  人设、世界书、记忆、风格规则、语言规则一样不少，社交反应不再是「写个小提示词」的降级品。 */
interface SocialContext {
  api: ChatApiSettings;
  charName: string;
  stable: string;
  tail: string;
  apiHistory: ChatMessage[];
  volatile: string;
  bubbleCap: number;
  pairMode: boolean;
  /** 本轮真正当 user 内容发出去的那一份（问候＝对方的申请附言；其余＝任务指令）。 */
  turnInput: string;
}

/** 按与 ChatWindow 同样的顺序攒出这套上下文。
 *  `instruction` 是这一轮临时追加的「任务指令」——它既当 buildPrompt 的 userInput
 *  （关键词世界书按它触发），又当这一轮真正发给模型的 user 内容；`turn` 传了 userInput
 *  时改用那一份当 user 内容（问候：对方刚发来的申请附言）。
 *  `allowImage`：这一趟允不允许 TA 配图（目前只有「自己发动态」为 true；且图文接口真能用
 *  时才真给——见下）。 */
async function buildSocialContext(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
  instruction: string,
  turn?: SocialTurn,
  allowImage = false,
): Promise<SocialContext> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  const d = character.data;
  const charName = d.name || d.nickname || "TA";
  /* 本轮真正当「刚发来的那条」的内容：问候＝对方的申请附言；其余社交反应＝任务指令。 */
  const turnInput = (turn?.userInput ?? "").trim() || instruction;
  /* 与 ChatWindow 同一趟齐活：世界书、每聊天设置、面具、TA 的零钱（顺带按人设开户）、记忆。 */
  const [books, prefs, masks, apiBundle, memory, taWallet, history] = await Promise.all([
    getWorldBooks(),
    getChatPrefs(),
    getMasks(),
    getApiBundle(),
    getMemory(character.id, maskId),
    openContactAccountIfEmpty({ ownerId: character.id, profile: d })
      .then((r) => r.balance)
      .catch(() => getBalance(character.id, "contact")),
    /* 社交反应要的是**完整对话历史**。会话列表拿到的 conv 只在 messages 里挂了最近一条、
       朋友圈那边更是从列表取 conv——一律不便携完整历史。这里直接按会话把全量读出来
       （只读这一个会话），凑上下文不缺口，也不必让每个调用方各自备齐。 */
    getConversationMessages(character.id, maskId),
  ]);
  const globalApi = apiBundle.text;
  const mask = masks.find((m) => m.id === maskId) ?? getCurrentMask(masks);
  const myName = (mask?.name ?? "").trim() || userName.trim() || "我";
  const bubbleCap = bubbleCapOf(conv);
  /* 记忆模块统一出口：原文窗口＋记忆块一处算出（社交反应与线上同口径）。 */
  const { trimmedHistory, memoryBlock } = await buildInjection(history, memory, myName);
  const built = buildPrompt({
    characterId: character.id,
    /* 他住的「世界」（档案分类）：世界书绑了世界时按它判命中。 */
    characterCategoryId: character.categoryId,
    profile: d,
    books,
    mode: "online",
    history,
    userInput: turnInput,
    userName: myName,
    userMask: mask,
    currentSignature: conv.signature,
    userSignature: mask?.signature ?? "",
    walletBalance: taWallet,
    memoryBlock,
    /* 我发的朋友圈里他有权看的那几条（1.10.27）：社交反应也照同一套可见范围拿。 */
    myMomentsBlock: await buildMyMomentsBlock(character.id, character.categoryId, maskId),
    /* 对话历史与最新消息改走 OpenAI messages（保前缀缓存稳定），与线上一致。 */
    excludeDialogue: true,
    sessionKey: `${character.id}::${maskId}`,
    timeAware: prefs.timeAware,
  });
  const trOut = conv.translate?.out;
  const pairMode = trOut?.on === true;
  /* 能力标记：绝大多数社交反应只发文字（凭空冒出〔图片〕标记没人接），一律 false；
     唯独「自己发动态」这趟允许配图（allowImage），且**只在图文接口真能用时**才给 true——
     否则提示词里那节会变成「你暂时无法发送图片」，TA 写了〔动态图〕也白写。语音这趟不接。 */
  const imgApi = apiBundle.image;
  const canImage =
    !!imgApi && imgApi.enabled && imgApi.baseUrl.trim() !== "" && imgApi.model.trim() !== "";
  const { head: stylePrompt, tail: styleRules } = buildStylePrompt(
    charName,
    myName,
    undefined,
    allowImage && canImage,
    false,
    d.isAssistant === true,
    bubbleCap > 0 ? bubbleCap : null,
    null,
    null,
  );
  const langRule = buildLangRule(pairMode ? (trOut?.lang ?? null) : null, myName);
  /* 拉黑状态注入：与线上同一套（拉黑中＝当前状态，解除过＝被拉黑记忆）。 */
  const socialPrompt = conv.blocked
    ? blockedNowPrompt()
    : (conv.blockCount ?? 0) > 0
      ? blockedMemoryPrompt(conv.blockCount ?? 1)
      : "";
  /* 临时状态说明（问候那一轮的「你们刚成为好友」）并进 system 尾——与拉黑状态同一格，
     离本轮最近；没有就保持逐字不变。 */
  const tailNote = (turn?.tailNote ?? "").trim();
  const tail = tailNote ? (socialPrompt ? `${socialPrompt}\n\n${tailNote}` : tailNote) : socialPrompt;
  const stable = stylePrompt + "\n\n" + built.stable + "\n\n" + styleRules + langRule;
  /* 回喂历史：线上把「本轮那条 user」切掉（它已单独作 input，留着就重复了），这里同口径。
     问候这一轮末尾那条 user 就是对方的申请附言，其后可能还跟着刚落下的「通过」系统提示，
     一并摘掉（系统提示本就不进上下文）。其余社交反应没有「刚发来的 user」，原样回喂。 */
  let apiHistory = trimmedHistory;
  if ((turn?.userInput ?? "").trim()) {
    let end = apiHistory.length;
    while (end > 0 && apiHistory[end - 1].role === "system") end--;
    if (end > 0 && apiHistory[end - 1].role === "user") end--;
    apiHistory = apiHistory.slice(0, end);
  }
  return {
    api: effectiveTextApi(conv, globalApi),
    charName,
    stable,
    tail,
    apiHistory,
    /* 1.11.69：线上主聊天把易变那截搬进了 system 缓存槽，而社交这条链仍按老样子
       整截挂在 turnInput 末尾；这儿把易变区与瞬时区拼回原来那一整截。
       1.11.70：签名／用户签名／零钱三行从易变区挪进了瞬时区——它们如今也在这一整截
       的最末尾（挂在 turnInput 尾部），社交反应的注入位置跟着一起变。 */
    volatile: [built.volatile, built.ephemeral].filter(Boolean).join("\n\n"),
    bubbleCap,
    pairMode,
    turnInput,
  };
}

/** 走完整管线生成一次社交反应，再过与线上同一趟后处理（心声／标记／拆条／双语劈分）。
 *  接口没配齐、请求失败、组装上下文出错、或模型明显拒答时一律返回 null，交给调用方落兜底模板。 */
async function generateSocialReply(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
  instruction: string,
  turn?: SocialTurn,
): Promise<SocialReply | null> {
  /* 整段包住：组装上下文（读世界书／记录／记忆／面具／账本）里任一环抛错，都要当成
     「这一轮没生成」交回 null，让调用方去落兜底模板——异常若漏出去会被 queueReaction
     静默吞掉，加好友／拉黑之后 TA 会一条消息都发不出来，连兜底首句都没有。 */
  try {
    const ctx = await buildSocialContext(character, conv, userName, instruction, turn);
    const { api } = ctx;
    if (!(api.enabled && api.baseUrl.trim() && api.model.trim())) return null;
    let reply = "";
    /* 思维链跟线上一样收着（思考型模型这一轮吐的推理过程）：挂在第一条气泡上，见 appendSocialParts。 */
    let reasoning = "";
    try {
      reply = await fetchAIReply(
        api,
        { stable: ctx.stable, tail: ctx.tail },
        ctx.apiHistory,
        ctx.turnInput + (ctx.volatile ? `\n\n${ctx.volatile}` : ""),
        undefined,
        undefined,
        undefined,
        undefined,
        (r) => {
          reasoning = r;
        },
      );
    } catch {
      return null;
    }
    const voice = extractInnerVoice(reply);
    const extracted = extractMetaMarkers(voice.clean, ctx.charName);
    const clean = extracted.clean.trim();
    if (!clean || isChatRefusal(clean)) return null;
    /* 正文空、思考兜底当正文的那一轮：reasoning 与 reply 一模一样，那是正文不是思考，
       挂上去就是同一段字两头重复（同线上主聊天的把关口径）。 */
    const reasoningClean = reasoning.trim();
    const reasoningText = reasoningClean && reasoningClean !== reply.trim() ? reasoningClean : undefined;
    const rawParts = splitReply(clean, ctx.bubbleCap, ctx.pairMode);
    /* 社交反应不落引用，只用 extractBubbleQuotes 把〔引用:…〕标记剥掉，防漏字。 */
    const { parts: pairedParts } = extractBubbleQuotes(rawParts);
    const parts = ctx.pairMode ? pairedParts.map((p) => splitBilingual(p).src) : pairedParts;
    const inlineTrans = ctx.pairMode ? pairedParts.map((p) => splitBilingual(p).zh) : [];
    /* 译文与气泡逐字相同＝模型整句写中文没给竖线，抹掉那行，别重复挂一遍。 */
    const translated = parts.map((p, i) => {
      const zh = inlineTrans[i];
      return zh && zh.trim() !== p.trim() ? zh : undefined;
    });
    if (parts.length === 0) return null;
    /* 心声跟着走：`<think>` 里那几行不落正文，只挂在这一轮第一条 TA 的气泡上
       （跟线上主聊天同一处、同一个 i === 0 口径，见 ChatWindow）。 */
    return {
      parts,
      translated,
      innerVoice: voice.innerVoice,
      snapshot: voice.snapshot,
      reasoningText,
    };
  } catch {
    return null;
  }
}

/** 社交反应落库后的「有新消息」铃：这些反应都在后台写库，光靠列表刷新只能让外面的
 *  预览跟上——挂着的聊天窗（进过的对话不拆，只 display:none 藏着）自己的 messages
 *  是进场那一刻拉的一份，没人再告诉它回去重拉，就会一直停在「TA 还没说话」的样子：
 *  预览里已经有那句问候，点进去却是空白。聊天窗订阅它，落完库自己回去拉一次。 */
const socialAppendListeners = new Set<() => void>();

export function subscribeSocialAppend(cb: () => void): () => void {
  socialAppendListeners.add(cb);
  return () => {
    socialAppendListeners.delete(cb);
  };
}

function notifySocialAppend(): void {
  for (const cb of socialAppendListeners) cb();
}

/** 把一次社交反应的每一条依次落库（有译文才挂译文行）。
 *  `bumpUnread`＝这批反应落库时把列表未读 +1（主动消息用：用户多半不在这间，
 *  列表要能看到并带上红点；其它社交反应是用户自己触发的，不打扰）。 */
async function appendSocialParts(
  characterId: string,
  maskId: string,
  reply: SocialReply,
  opts?: { bumpUnread?: boolean },
): Promise<void> {
  for (let i = 0; i < reply.parts.length; i++) {
    const tr = reply.translated[i];
    await appendMessage(characterId, maskId, {
      role: "assistant",
      content: reply.parts[i],
      isRead: false,
      ...(tr ? { translated: tr } : {}),
      /* 心声／内心快照只挂本轮第一条（跟线上主聊天一个口径，见 ChatWindow）。
         TA 写在最前面那个 `<think>` 块里，摘走后本就不进正文，这里补落回库，
         心声档案页与气泡上方那块折叠心声才看得见——不然加好友第一句永远是「没心声」。 */
      ...(i === 0 && reply.innerVoice ? { innerVoice: reply.innerVoice } : {}),
      ...(i === 0 && reply.snapshot ? { innerSnapshot: reply.snapshot } : {}),
      /* 思维链也只在第一条上挂（同线上，见 ChatWindow）。 */
      ...(i === 0 && reply.reasoningText ? { reasoningText: reply.reasoningText } : {}),
    }, opts);
  }
  /* 全部落完再摇铃：漏在半截摇，聊天窗会拉到一个只写了几条、还差尾巴的中间态。 */
  notifySocialAppend();
}

/** 拒答识别（1.7.4）：只认「AI 腔的拒绝」，不认剧里具体的事。
    聊天里的 TA 是活人，按人设本来就能说「抱歉，我不能答应」（见【行为守则】第 2 条），
    宽松地按「抱歉，我不能…」判会把正常回复一并吞掉。所以只认：
    自称 AI／模型／助手，或回绝的是**生成这件事本身**（继续／协助／这个请求），
    而不是剧里某件具体的事。 */
const CHAT_REFUSAL_RE =
  /(?:as an ai|i'?m an ai|作为\s*(?:一个)?\s*(?:ai|人工智能|语言模型|助手)|我(?:是|作为)(?:一个)?\s*(?:ai|人工智能|语言模型)|i (?:can'?t|cannot|won'?t|will not|am unable to)\s+(?:assist|help|continue|engage|participate|provide|generate|create|discuss|write|say|do)|(?:抱歉|对不起)[，,]?\s*(?:我)?(?:不能|无法|没办法)\s*(?:继续|协助|帮助|回答|参与|满足|提供|回应|生成)|我(?:不能|无法|没办法)\s*(?:继续|协助|帮助|参与|满足|提供|回应|生成)|(?:这个|这类|该|此类)\s*(?:请求|内容|话题|对话|题材)[^。！？\n]{0,12}(?:不能|无法|不便|不合适|抱歉))/i;

export function isChatRefusal(reply: string): boolean {
  /* 只看开头：拒答是一句开场白，不是正文里顺口一提（演到一半冒出这些词不算）。 */
  return CHAT_REFUSAL_RE.test(reply.slice(0, 60));
}

/* --------------------------- TA 的话（生成） --------------------------- */

/** 解除拉黑后 TA 的第一反应（走完整管线；没生成出来就安静过去）。
 *  只交代状态事实，不催 TA 做出反应——拉黑当下那条与拉黑期间的历史原文都在，
 *  TA 自己知道解除之后该怎么接。
 *  不编兜底话：硬塞的话会作为 TA 说过的内容进记忆，宁可这次没反应。 */
export async function generateUnblockReply(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<SocialReply | null> {
  const instruction = `刚刚，对方解除了对你的拉黑，你发出去的消息又能正常发出了。
只给出对话内容本身，不写动作描写。`;
  return generateSocialReply(character, conv, userName, instruction);
}

/** 拉黑当下 TA 的第一反应（走完整管线；没生成出来就安静过去）。
 *  按真实的时序写：TA 不是被通知「你被拉黑了」，而是先照常接了一句，
 *  看到这条显示「发送失败」，才察觉对方拉黑了自己，再接着说下去。
 *  不编兜底话：硬塞的话会作为 TA 说过的内容进记忆，宁可这次没反应。 */
export async function generateBlockedReply(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<SocialReply | null> {
  const instruction = `刚刚，对方把你拉黑了。
你还没察觉，第一条消息照常接着刚才的聊天说；这条发出去后，你发现显示「发送失败」，才知道对方拉黑了你——接着往下说。
只给出对话内容本身，不写动作描写。`;
  return generateSocialReply(character, conv, userName, instruction);
}

/** 通过好友申请后 TA 的第一句（走完整管线；没生成出来就安静过去）。
 *  加好友是「用户申请 → TA 通过」，所以这里是 TA 通过之后的第一句话。
 *  这一轮**照线上主聊天那样发**：对方留在申请里的那句话就是他刚发来的消息（作 input 投喂，
 *  末尾那条 user 历史切掉），「刚成为好友」只作一小段状态说明挂在 system 尾——
 *  从前写成「主动开口说你的第一句问候」，TA 答的是那句指令、不像在跟人聊天，这里改掉。
 *  不编兜底话：硬塞的问候会作为 TA 说过的内容进记忆，宁可这次没第一句。 */
export async function generateNewFriendGreeting(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
  greetText: string,
): Promise<SocialReply | null> {
  const attach = greetText.trim();
  const tailNote = `【状态 - 你们刚成为好友】你通过了 ${userName} 的好友申请。你们成了好友，根据 ${userName} 的好友申请内容，以你的人设方式回应对方。`;
  /* 对方没留附言时给一句中性占位，别让本轮没有「对方的话」（同线上发图那类没正文时的写法）。 */
  const incoming = attach || "（对方申请加你好友，没有别的话）";
  return generateSocialReply(character, conv, userName, tailNote, {
    userInput: incoming,
    tailNote,
  });
}

/* --------------------------- 动作（落库） --------------------------- */

/** 删除好友：把这一对「角色 × 面具」的绑定整个抹掉——
 *  会话（含聊天记录、每聊天设置、TA 发过的动态）＋记忆，一并清掉，
 *  不留 removed 之类的中间状态（旧版那套「假删等 TA 求加回」已经撤了）。
 *  角色档案本身不动，以后想聊可以自己从「添加朋友」再把他加回来。 */
export async function hardDeleteFriend(characterId: string, maskId: string): Promise<void> {
  await deleteConversation(characterId, maskId);
  await deleteMemory(characterId, maskId);
  /* 会话一删，他发过的那些图上的引用串就断了：这里不逐张去点（点不全，也容易漏），
     交给收尾那一趟——它反着扫全库，断链的一律收走（见 media-sweep；
     本函数正是那些「孤儿图」最主要的来源）。 */
  await sweepOrphanMedia();
}

/** 加好友那一刻，聊天页里那条「TA 通过了你的好友申请」。
 *  加好友是瞬间成立的（不等 TA 真去点「同意」），可用户要看见「通过」这个动作——
 *  先有这条，TA 接下来说的那句问候才落得有来处。问候关掉时整段静默，连这条也不落。 */
export async function appendFriendAcceptedNotice(
  character: ArchiveEntry,
  maskId: string,
): Promise<void> {
  const charName = character.data.name || character.data.nickname || "TA";
  await appendMessage(character.id, maskId, {
    role: "system",
    type: "system",
    content: `「${charName}」通过了你的好友申请，你们现在是好友了。`,
    isRead: true,
  });
}

/* --------------------------- 「TA 正在写」的登记表 --------------------------- */

/** 社交反应（加好友问候／拉黑／解除）的生成状态：从轮到它那一刻登记，落库完销号。
 *  这些反应都在后台跑，聊天窗并不知道有人在替 TA 写字——于是加完好友点进聊天，
 *  明明 TA 正在写、界面却一动不动，等半天才「啪」地冒出第一条。
 *  把「谁在写」从发起处抬到这里：起手登记、收工销号，聊天窗订阅一声铃就重渲染。
 *  key 与线上一致：`characterId::maskId`。 */
const socialTyping = new Set<string>();
const socialTypingListeners = new Set<() => void>();

const socialTypingKey = (characterId: string, maskId: string) => `${characterId}::${maskId}`;

/** 这个「角色 × 面具」的社交反应是不是正在生成。 */
export function isSocialTyping(characterId: string, maskId: string): boolean {
  return socialTyping.has(socialTypingKey(characterId, maskId));
}

/** 订阅登记表的变化，返回退订（配一个 tick state 用，同 moment-image 那套）。 */
export function subscribeSocialTyping(cb: () => void): () => void {
  socialTypingListeners.add(cb);
  return () => {
    socialTypingListeners.delete(cb);
  };
}

function markSocialTyping(characterId: string, maskId: string, on: boolean): void {
  const key = socialTypingKey(characterId, maskId);
  if (on) socialTyping.add(key);
  else socialTyping.delete(key);
  for (const cb of socialTypingListeners) cb();
}

/** TA 第一反应的后台队列：开关要先弹走、反应在后台慢慢写，但几次动作必须排队落库——
 *  连点「拉黑→解除」时若两段生成并发落库，聊天记录里 TA 的话会前后错位、红叹号区间也跟着判错。 */
let reactionChain: Promise<unknown> = Promise.resolve();
function queueReaction<T>(
  characterId: string,
  maskId: string,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const run = reactionChain.then(async () => {
    /* 轮到这一趟了才登记「正在写」：排在前头的还在写时，这一对的聊天窗不该亮灯。 */
    markSocialTyping(characterId, maskId, true);
    try {
      return await task();
    } finally {
      /* 无论成没成、落没落库，收工都要销号——不然「正在输入」会一直挂着。 */
      markSocialTyping(characterId, maskId, false);
    }
  });
  /* 链条吞掉错误继续排；错误不抛给本次调用方——生成失败就让它安静过去，开关状态早已落库。 */
  reactionChain = run.catch(() => {});
  return run.catch(() => undefined);
}

/** 拉黑开关的「立刻」半段：置状态＋落系统提示，落完就走——
 *  TA 的第一反应（要走一次文本 API，慢）放后台，见 blockedFirstReaction。 */
export async function blockFriend(
  character: ArchiveEntry,
  conv: Conversation,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  const charName = character.data.name || character.data.nickname || "TA";
  await updateConversation(character.id, maskId, { blocked: true });
  await appendMessage(character.id, maskId, {
    role: "system",
    type: "system",
    content: `已将「${charName}」加入黑名单。你发的消息 TA 都看得到；TA 发的消息在 TA 那边一直显示「发送失败」，你照样看得见。`,
    isRead: true,
  });
}

/** 拉黑当下 TA 的第一反应（慢的那半段）：排队后台跑，不阻塞开关。
 *  调用方 fire-and-forget 即可，落库完自己刷屏。 */
export function blockedFirstReaction(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  return queueReaction(character.id, maskId, async () => {
    /* 重拉最新会话：调用方手里的 conv 是点开关那一刻的快照，TA 的反应才跟得上最近聊到哪。 */
    const fresh = await getOrCreateConversation(character.id, maskId);
    const reply = await generateBlockedReply(character, fresh, userName);
    /* 没生成出来就安静过去，不落兜底模板（同主动开口那条口径）。 */
    if (!reply) return;
    /* 生成时已过同一趟后处理（拆条／双语），这里逐条落库即可。 */
    await appendSocialParts(character.id, maskId, reply);
  });
}

/** 通过好友申请后 TA 主动开口（慢的那半段）：排队后台跑，不阻塞加好友。
 *  调用方 fire-and-forget 即可，落库完自己刷屏。 */
export function newFriendGreetingReaction(
  character: ArchiveEntry,
  maskId: string,
  userName: string,
  greetText: string,
): Promise<void> {
  return queueReaction(character.id, maskId, async () => {
    /* 重拉最新会话：调用方手里的 conv 是点发送那一刻的快照。 */
    const fresh = await getOrCreateConversation(character.id, maskId);
    const reply = await generateNewFriendGreeting(character, fresh, userName, greetText);
    /* 没生成出来就安静过去，不落兜底模板（同主动开口那条口径）。 */
    if (!reply) return;
    /* 生成时已过同一趟后处理（拆条／双语），这里逐条落库即可。 */
    await appendSocialParts(character.id, maskId, reply);
  });
}

/** 解除拉黑的「立刻」半段：置状态＋记一次数＋落系统提示；TA 的回应放后台，见 unblockedFirstReaction。 */
export async function unblockFriend(
  character: ArchiveEntry,
  conv: Conversation,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  const charName = character.data.name || character.data.nickname || "TA";
  const count = (conv.blockCount ?? 0) + 1;
  await updateConversation(character.id, maskId, { blocked: false, blockCount: count });
  await appendMessage(character.id, maskId, {
    role: "system",
    type: "system",
    content: `已解除对「${charName}」的黑名单。`,
    isRead: true,
  });
}

/** 解除拉黑后 TA 的第一句（慢的那半段）：排队后台跑，不阻塞开关。 */
export function unblockedFirstReaction(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  return queueReaction(character.id, maskId, async () => {
    /* 必须重拉最新会话：不重拉的话拉黑期间聊过的那些就不在语境里，TA 解除后接不上最近聊到哪。 */
    const fresh = await getOrCreateConversation(character.id, maskId);
    const reply = await generateUnblockReply(character, fresh, userName);
    /* 没生成出来就安静过去，不落兜底模板（同主动开口那条口径）。 */
    if (!reply) return;
    /* 生成时已过同一趟后处理（拆条／双语），这里逐条落库即可。 */
    await appendSocialParts(character.id, maskId, reply);
  });
}
