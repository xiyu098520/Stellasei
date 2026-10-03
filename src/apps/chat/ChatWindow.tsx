"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronUp,
  Clock,
  Copy,
  CreditCard,
  Download,
  File,
  FileText,
  Heart,
  Image as ImageIcon,
  Languages,
  MapPin,
  Mic,
  MoreHorizontal,
  Pause,
  PenLine,
  Phone,
  Play,
  Plus,
  Quote,
  RotateCcw,
  Send,
  Smartphone,
  SquareStop,
  Star,
  Stethoscope,
  Trash2,
  User,
  Video,
  X,
} from "lucide-react";
import {
  appendMessage,
  appendMetaUpdates,
  bubbleCapOf,
  clearConversation,
  convId,
  deleteMessage,
  getChatPrefs,
  getOfflineScene,
  getOrCreateConversation,
  healStalePendingMedia,
  markConversationRead,
  offlineMemoryRoundsOf,
  offlineWordsOf,
  updateConversation,
  updateMessage,
  type ConversationPatch,
} from "@/lib/settings/chat";
import { getWorldBooks } from "@/lib/settings/worldbook";
import type { Mask } from "@/lib/settings/mask";
import { buildImageSubject, buildPrompt, type PromptSection } from "@/lib/chat/promptBuilder";
import {
  buildOfflineStylePrompt,
  buildStylePrompt,
  extractBubbleQuotes,
  extractInnerVoice,
  extractMetaMarkers,
  fetchAIReply,
  fetchAIStreamReply,
  innerLedgerBlock,
  lastInnerSnapshot,
  generateImage,
  guessUseCharRef,
  isRejectedBeforeWork,
  moneyNoteOf,
  moneyStateNoteOf,
  outgoingContents,
  splitBilingual,
  splitReply,
  splitReplyStream,
  stripMetaMarkersForPreview,
  synthesizeSpeech,
  translateText,
} from "@/lib/chat/chatApi";
import { applyRegexRules, loadRegexRules } from "@/lib/chat/regexRules";
/* TA 那本账的「开户」（1.4.36）：第一次跟他说话（或第一次翻他手机）时，
   按人设给他开一本有来历的账——否则他手上一分钱没有，发红包／转账都无从谈起。 */
import { openContactAccountIfEmpty } from "@/lib/chat/contactAccount";
import type { RegexRule } from "@/types/regex";
import { getApiBundle } from "@/lib/settings/chat";
/* 钱包：发红包／转账要真从我的零钱（或某张卡）扣钱（1.4.33）。
   1.4.63 起改成**先只扣我**（`payOutToContact`）——钱不进他的账，等他表态；
   他退还／红包不领，再原路收回我出的那个口袋（`takeBackToPocket`）。
   收款码的编号也存在同一本账里（`getPayCode`），码图现画（`renderPayCodeDataUrl`）。 */
import {
  RED_PACKET_MAX_CENTS,
  adjustBalance,
  formatYuan,
  getBalance,
  getPayCode,
  getPayPassword,
  listCards,
  parseYuan,
  payOutToContact,
  takeBackToPocket,
  type WalletCard,
} from "@/lib/settings/wallet";
import { renderPayCodeDataUrl } from "@/lib/settings/paycode";
import { generateMomentImage } from "@/lib/chat/moment-image";
import {
  blockFriend,
  blockedFirstReaction,
  blockedMemoryPrompt,
  blockedNowPrompt,
  hardDeleteFriend,
  isChatRefusal,
  removeFriend,
  unblockFriend,
  unblockedFirstReaction,
} from "@/lib/chat/social";
import {
  bumpMemoryCount,
  buildMemoryBlock,
  deleteMemory,
  getMemory,
  maybeRunMemoryPipeline,
  maybeRunOfflineCondense,
  trimHistory,
} from "@/lib/chat/memory";
import { uuid } from "@/lib/uuid";
import {
  getCachedMediaBlob,
  mediaRefToDataUrl,
  mediaRefToVisionDataUrl,
  persistImageAsset,
  releaseImageAsset,
  saveImageToDevice,
  useMediaSrc,
} from "@/lib/chat/media-asset";
/* 清空的收尾：断链的图（这一趟清掉的、以及历年攒下的孤儿）一并从仓库收走。 */
import { sweepOrphanMedia } from "@/lib/chat/media-sweep";
import { readQrNote } from "@/lib/chat/qr-read";
import { APP_VERSION } from "@/lib/version";
import {
  AVATAR_GRADIENT,
  CHAT_BG_DEFAULT,
  CHAT_PAGE_SIZE,
  KAI,
  SANS,
  SERIF,
  T,
  TYPE_CN,
  dayLabel,
  defaultSignature,
  msgTime,
  sameDay,
} from "./shared";
import ChatSettingsPanel from "./ChatSettingsPanel";
import InnerVoicePage from "./InnerVoicePage";
import OfflineScenePage, {
  offlineAsMessages,
  offlineTranscript,
  onlineTranscript,
  sceneEntriesOf,
  currentSceneOf,
  type OfflineGenerate,
} from "./OfflineScenePage";
/* 钱这一族的账册料：气泡上那三张钱卡（红包／转账／回执）挂的就是
   书写体、等宽数字与硬影这几个。
   （转账／红包的**填写界面** 1.4.54 起搬去 `MoneySendView` 单独一页了，
   那一页自己引 `WalletSheet` 里的方签与输入样式。） */
import { WALLET_MONO, WALLET_PAPER_SHADOW } from "./WalletSheet";
/* 红包封面（1.4.89）：预设表与「自定义图封面」的判定——红包卡与开红包页共用。
   铺法得跟着取景位置走（1.5.5 起封面能挪），所以统一从这几个小工具出，
   别在各处自己拼 `url(...) center/cover`——那样挪过的位置就白挪了。 */
import {
  isCustomRedCover,
  RED_COVER_CLAIMED_VEIL,
  RED_COVER_TONE,
  redCoverBgOf,
  redCoverPosOf,
  redCoverPresetOf,
  redCoverRefOf,
  redCoverSrcRefOf,
} from "./redpacket";
/* 我弄过的红包封面（1.5.5）：发出去那一刻顺手收一条进库，下次发红包就在画廊里挑。
   还有一格「眼下用的那张」（1.5.10）：她选定一张就成了**各处通用的默认**，换到哪个
   对话框、重开 App 都还是它，所以得落库——以前只活在内存里，退出会话就忘了。 */
import {
  getDefaultRedCover,
  putRedCoverToLibrary,
  setDefaultRedCover,
} from "@/lib/chat/red-cover-store";
/* 红包封套的两张正脸：没开的封套（带「開」）与开完的金额卡。
   开红包那一页与发红包那页的试衣间共用同一张脸，形状都在那个文件里。 */
import { RedEnvelopeCard, RedOpenedCard, RedPacketGlyph } from "./RedPacketCards";
/* 转账／红包的填写页（1.4.54）：恩熙要「像微信那样跳出一个整页」——不再是底下滑上来的
   面板。这里只管开关与递参数，钱怎么划走仍归 `doSendMoney`。 */
import MoneySendView from "./MoneySendView";
/* 支付密码那道闸（1.4.51）：钱出去之前弹六个格子的键盘（见 PayPasswordSheet）。 */
import PayPasswordSheet from "./PayPasswordSheet";
import type { ArchiveEntry } from "@/types/contact";
import type {
  ChatApiSettings,
  CharacterMemory,
  ChatMessage,
  ChatMoment,
  Conversation,
  ImageApiExtras,
  ImageDiag,
  VoiceApiExtras,
} from "@/types/chat";

/* =======================================================================
 * 对话页（黑粉蓝板——白卡面、亮粉主色、无衬线）
 * 顶栏／气泡／长按菜单／引用／加号面板／红包转账填写页／每聊天设定
 * ===================================================================== */

/** 长按菜单最宽一档的宽度（夹取用，见 onLongStart）。往菜单里加按钮要跟着加。 */
const MENU_MAX_W = 290;

/** 生图通道的中文说法（诊断面板显示用，见 diagView）。
    `images` 一条通道两用（原生带图与纯文生图都走它），带没带参考图看 refsSent 那一格。 */
const DIAG_VIA_CN: Record<ImageDiag["via"], string> = {
  images: "图片生图接口",
  edits: "图片编辑接口（参考图走这条）",
  chat: "聊天接口",
  nai: "NovelAI 接口",
};

/* 加号面板里那些项——
   本来就分两等：格子里的都是「发什么内容」，通栏那条「重新回复」是「让对面做一件事」。
   内容项两列排，末行只剩一个（1.4.24 加了「收款码」）就让它自己收尾，
   那一格不再描竖栏线（见下面列表里的说明）。 */
const PLUS_ITEMS = [
  /* 「图片」把拍照并进来了（2026-10-02）：点它先问「图从哪来」，
     手机相册那一路本来就把「拍照」含在里面（系统选图里就有相机）。 */
  { name: "图片", icon: ImageIcon },
  { name: "语音消息", icon: Mic },
  /* 两个通话各占一格：视频通话／语音通话（功能待做，点下去先如实说一句）。 */
  { name: "视频通话", icon: Video },
  { name: "语音通话", icon: Phone },
  { name: "红包", icon: IconRedPacket },
  /* 转账用卡片（原来那个来回箭头不好看）。 */
  { name: "转账", icon: CreditCard },
  { name: "文件", icon: File },
  { name: "位置", icon: MapPin },
  /* 收款码（1.4.24）：把我钱包里那张码当图片发给 TA——一张图，走的是发图那条路。
     这两枚不走 lucide，用我们自己画的那版（见 IconRedPacket／IconPayCode）。 */
  { name: "收款码", icon: IconPayCode },
] as const;

/* 「重新回复」不是发内容，是让对面重答一遍——单独一条通栏动作，走糖。 */
const PLUS_ACTION = { name: "重新回复", icon: RotateCcw } as const;

/* 加号面板里这两枚图标不走 lucide，用我们自己画的那版（跟预览页逐笔一样）：
   红包＝一枚圆角信封、顶上一个 V 形封口；收款码＝三个大方块 ＋ 三个小方块。
   lucide 那两枚（礼物盒／通用二维码）跟我们要的不是一个东西。
   两者都只吃 size／strokeWidth，跟 lucide 一样，所以能直接摆进 PLUS_ITEMS。 */
function IconRedPacket({ size = 21, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 8.5l8 5.2 8-5.2" />
    </svg>
  );
}

function IconPayCode({ size = 21, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="14" width="3" height="3" rx="0.6" />
      <rect x="18" y="18" width="3" height="3" rx="0.6" />
      <rect x="14" y="18" width="3" height="3" rx="0.6" />
    </svg>
  );
}

/* 「去见他」（1.7.5）：第二条通栏动作。线上是隔着手机的微信体，这条是「见面」——
   点开进线下场合那一页（OfflineScenePage），小说笔法写一场，不再一条条发消息。
   与「重新回复」并列摆，同为糖色通栏（都不是「发内容」）。 */
const PLUS_OFFLINE_ACTION = { name: "去见他", icon: User } as const;

/* 「重新回复」不填提示词时的兜底（放开空输入）：空着点确认
   就是「让它自己重新生成」。原样重跑结果往往和上一条几乎一样，所以补一句换说法的
   要求——不填是重生成，填了才是按提示词改语气。 */
const RETELL_FALLBACK_HINT = "换个说法，把这一句重新回一遍，别和上次一个样。";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 翻一句，翻不动再试一次（1.9.57）。
 *
 * 恩熙 2026-10-03：「为什么有些会翻，有些不会翻呀？」——译文是每条单独打一次
 * 翻译接口换来的，网络／限流抽一下，那一条就永久空着（还找补不回来）。这里给它
 * 两次机会：接口报错、返回空、或者把原话原样吐回来（说明它根本没干活），都当翻
 * 不动，隔半秒再来一遍；两次都不行才返回 undefined（那一条就不露译文，不拖累别的）。
 */
async function translateWithRetry(
  api: ChatApiSettings,
  text: string,
  toLang: string,
): Promise<string | undefined> {
  const src = text.trim();
  if (!src) return undefined;
  for (let i = 0; i < 2; i++) {
    try {
      const t = (await translateText(api, text, toLang)).trim();
      if (t && t !== src) return t;
    } catch {
      /* 抽风了，隔半秒再试一次 */
    }
    if (i === 0) await delay(500);
  }
  return undefined;
}

/* 每条气泡的出场间隔（流式预览的节拍，与非流式逐条落库共用同一档）。 */
const STREAM_REVEAL_INTERVAL_MS = 700;

/* 流式预览的合批间隔（性能优化）。
   收流回调若「来一个 SSE 分片就 setStreamPreview 一次」，而 ChatWindow 里一次
   setState 就是整棵组件重渲染（含整段消息列表重建）。分片密集时每秒几十次，
   会话越长每次越贵，主线程一直被占满——「聊得比较久就发烫、迟钝」就是这个原因。
   攒起来每 80ms 放一帧：观感上还是「字在往外长」，重渲染频率从「分片数／秒」
   压到约 12 次／秒。 */
const STREAM_PREVIEW_FLUSH_MS = 80;

/* 红包封面那张图（自定义照片时）跟着往下带的距离：最近这么多条消息里还找得到
   那条红包，就继续把他的封面递过去。
   为什么不是一直带：图按尺寸算 token，一路带着等于每轮重烧一遍（见 requestReply
   里附图那段）。发完接着聊的这几轮他还看得见，聊远了就不带——那时候她也早聊别的了。 */
const COVER_VISION_RECENT = 8;

/** 已等待时长的人话（秒 → 「12 秒」／「1 分 12 秒」）。 */
function formatWait(secs: number): string {
  if (secs < 60) return `${secs} 秒`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

/** 收款回执（1.4.40）：钱到账之后，由**收款方**发出的那张卡（见 types/chat.ts 的 receipt）。
    微信里他点收了你的转账，聊天里除了你那张变淡的转账卡，还会多出**他发的**一张
    「已收款 ¥520.00／已存入零钱」；他转给你、你点收，就多出你发的一张。
    money＝那条转账消息（金额从它身上取）；role＝收款方是谁。
    text＝卡上那行字（退还那张写「已退还」，见 1.4.41）。
    落库的时机一律是「先把钱那条标成已收下、再发这张」：万一这一步没成，宁可少一张回执，
    也不要出现「回执有了、钱还停在等他收下」这种前后对不上的场面。
    ⚠️ 1.4.42 起**红包不再走这张卡**（改走下面那条系统提示）——恩熙要的红包是微信那样
    一条居中提示，不是一张卡；这条只留给转账与退还。 */
function buildReceiptMsg(
  money: ChatMessage,
  role: "user" | "assistant",
  text?: string,
): ChatMessage {
  return {
    id: uuid(),
    role,
    type: "receipt",
    content: text ?? "已收款",
    amount: money.amount,
    createdAt: new Date().toISOString(),
    /* 1.4.84：把原转账那条的时间戳抄一份（payAt）。两联的短编号都从时间戳末四位取，
       回执要是取自己出生的时间，跟转账那联就不是一个号——恩熙：「收取跟退还，它
       右上角那个数字应该是编号，是一样的呀。」同一笔钱＝同一个票号。 */
    payAt: money.createdAt,
    isRead: true,
  };
}

/** 钱被领走之后该往聊天里落的那一条（1.4.42 恩熙把红包与转账分开）：
    恩熙原话——「微信的红包是什么呀？我领取之后，它会显示一条系统消息说，你已领取叉叉叉的
    红包，它应该是这样的。然后一样会变暗。」
    ⇒ **红包**：一条居中的系统提示（红包卡自己变淡是 1.4.38 就做好的）；
    ⇒ **转账**：仍是收款回执卡（1.4.40，她已验收「OK，现在对了」，不动它）。
    role＝领钱的人（我／他）：我领他的 → 「你已领取 XX 的红包」；他领我发的 → 「XX 已领取你的红包」。
    只用 role／type／content 三个已有字段，**不新增字段**（同 1.4.40 回执卡的道理：
    settings/chat.ts 那套逐字段白名单一个字都不用改）。系统提示也不会回喂模型
    （buildApiMessages 把 role === "system" 整条滤掉），钱那条本身在历史里，模型照旧知道这笔钱。 */
function buildMoneyEcho(
  money: ChatMessage,
  role: "user" | "assistant",
  charName: string,
): ChatMessage {
  if (money.type !== "redpacket") return buildReceiptMsg(money, role);
  return {
    id: uuid(),
    role: "system",
    type: "system",
    content: role === "user" ? `你已领取 ${charName} 的红包` : `${charName} 已领取你的红包`,
    createdAt: new Date().toISOString(),
    isRead: true,
  };
}

/* ---------- 我发出去的钱：到期没人表态就作废 ---------- */
/* 这套逻辑是**纯函数＋落库**（不挂 hook），因为两个地方都要用：一是进会话那一段
   （在 hook 定义之前的加载流程里），二是每一轮求回复之前。 */

/** 「过期」的界线：挂在那笔钱后面又走过多少条消息上。取设置里那个「上下文条数」
 *  （memory.contextLimit，默认 50）——她的口径就是「上下文 50 条以内他还能回头收，
 *  超过就过期」。数的是非系统消息：系统提示压根不回喂模型，走过多少条它不算数。
 *  记忆没读出来（null）时返回 0＝先不判，别拿一个瞎猜的数把钱作废了。 */
function moneyExpiryLimitOf(memory: CharacterMemory | null): number {
  return memory && memory.contextLimit > 0 ? memory.contextLimit : 0;
}

/** 我发出去、还悬在「等他表态」的那些钱（没落定的；落定＝收下／退还／已过期）。 */
function pendingMineMoney(list: ChatMessage[]): ChatMessage[] {
  return list.filter(
    (m) =>
      m.role === "user" &&
      (m.type === "redpacket" || m.type === "transfer") &&
      m.moneyClaimed !== true &&
      m.moneyRefunded !== true &&
      m.moneyExpired !== true,
  );
}

/**
 * 一笔我发出去的钱到点作废：他既没收下、也没退还，聊天往下又走过那么多条，
 * 他再也想不起这笔钱。钱**原路**回我出的那个口袋（跟退还走同一手 takeBackToPocket），
 * 卡片落 `moneyExpired`，再补一条系统句。钱回不来就整笔不落定（返回 null，下次再算）。
 */
async function settleMoneyExpired(
  m: ChatMessage,
  ctx: {
    characterId: string;
    maskId: string;
    charName: string;
    showToast: (t: string) => void;
  },
): Promise<{ msg: ChatMessage; echo: ChatMessage | null } | null> {
  const cents = Math.round((m.amount ?? 0) * 100);
  const isRp = m.type === "redpacket";
  const label = isRp ? "红包" : "转账";
  /* 老消息（1.4.63 之前发出的）没有 `payFrom`：那种发出去时就一次划走了（钱早在他账上），
     这里再往回搬一遍就是同一笔钱算两回——只补卡片上「已过期」那个字，账不动。 */
  if (cents > 0 && m.payFrom !== undefined) {
    const back = await takeBackToPocket({
      ownerId: ctx.maskId,
      from: m.payFrom ?? "balance",
      cents,
      title: isRp ? `收回给${ctx.charName}的红包` : `收回给${ctx.charName}的转账`,
      detail: m.content,
    });
    if (!back.ok) {
      /* 钱没回来就不动卡片：这条还悬着，下次再算。
         绝不能让卡片写着「已过期」、钱却还少在我账上。 */
      ctx.showToast(`这笔${label}过期了，可钱没退回来：${back.error ?? "稍后再试"}`);
      return null;
    }
  }
  const msg: ChatMessage = { ...m, moneyExpired: true };
  try {
    await updateMessage(ctx.characterId, ctx.maskId, msg);
  } catch {
    /* 标记没写进库：钱已经回来了，但这条气泡重进会话还会显示「等他收下」。如实说一声。 */
    ctx.showToast(`钱收回来了，但这条没标上「已过期」`);
  }
  const echo: ChatMessage = {
    id: uuid(),
    role: "system",
    type: "system",
    content: `${label}过期了，钱已原路退回`,
    createdAt: new Date().toISOString(),
    isRead: true,
  };
  try {
    await appendMessage(ctx.characterId, ctx.maskId, echo);
  } catch {
    /* 系统句没写上就先算了：钱回来了、卡片也落定了，少的只是这一条。不返回它，
       免得界面上冒出一条库里没有的话。 */
    return { msg, echo: null };
  }
  return { msg, echo };
}

/**
 * 扫一遍我发出去、还没落定的钱：凡是后面又走过 limit 条（他始终没表态）就按过期落定。
 * 返回**替换好落定态**的那份列表——调用方拿它去喂这一轮模型（setMessages 是异步的，
 * 这一轮不能让模型还看见「等他表态」），同时把落定态同步上屏、把新补的系统句接在末尾。
 */
async function expireStaleMoney(
  list: ChatMessage[],
  limit: number,
  ctx: {
    characterId: string;
    maskId: string;
    charName: string;
    showToast: (t: string) => void;
  },
): Promise<{ list: ChatMessage[]; echoes: ChatMessage[] }> {
  const echoes: ChatMessage[] = [];
  if (!(limit > 0)) return { list, echoes };
  let out = list;
  for (let i = 0; i < list.length; i++) {
    if (pendingMineMoney([list[i]]).length === 0) continue;
    const passed = list
      .slice(i + 1)
      .filter((x) => x.role !== "system" && x.type !== "system").length;
    if (passed < limit) continue;
    const r = await settleMoneyExpired(list[i], ctx);
    if (!r) continue;
    out = out.map((x) => (x.id === r.msg.id ? r.msg : x));
    if (r.echo) echoes.push(r.echo);
  }
  return { list: out, echoes };
}

/**
 * 「查看本轮请求」留档（1.7.49）。
 * 请求只在发送那一刻存在、发完就没了，所以每轮发出去之前整条留一份：她对着中转商
 * 那边的账单，一眼能看出这一轮到底带了什么、哪些没带（尤其世界书带了几条）。
 * 线上、线下两条线都记（都从 ChatWindow 发出去）。
 */
interface LastRequest {
  /** 发出时刻（毫秒）。 */
  at: number;
  mode: "online" | "offline";
  /** 实际用的模型名。 */
  model: string;
  /** 这一趟走没走流式。 */
  stream: boolean;
  /** 组装出来的分段（带段名）：世界书各段、人设、记忆、对话…一览。 */
  sections: PromptSection[];
  /** 本轮被激活的世界书条目（书名／条目标题／常驻还是关键词）。 */
  activated: { book: string; title: string; by: string }[];
  /** 与上一轮逐字比前缀的结果（前缀缓存看得连不连得上）。 */
  diff: string;
  /** 完整正文：与网关收到的逐字一致。 */
  full: string;
}

export default function ChatWindow({
  character,
  apiSettings,
  userName = "",
  mask = null,
  maskId,
  userSignature = "",
  visible = true,
  onBack,
  onDismiss,
  onDataChange,
  showToast,
}: {
  character: ArchiveEntry;
  apiSettings: ChatApiSettings;
  /** 名字（对话绑定的面具决定）；空串以「我」兜底。 */
  userName?: string;
  /** 对话绑定的面具对象（面具可能已被删除；null 时仅缺人设注入）。 */
  mask?: Mask | null;
  /** 对话绑定的面具 id（会话归属键，与 mask 对象是否存在无关）。 */
  maskId: string;
  /** 用户的当前签名（「我」页面那句；随时可改，只注入易变区一行）。 */
  userSignature?: string;
  /** 这一间是不是正露在眼前。返回上一页时外面只是把它藏起来（display:none），
      组件不卸，所以这一轮回复照跑；藏变露时要重新贴底。 */
  visible?: boolean;
  onBack: () => void;
  /** 这间屋子彻底不要了（删好友）：让外面把挂载也一起撤掉，不是藏起来。 */
  onDismiss?: () => void;
  onDataChange: () => void;
  showToast: (msg: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loaded, setLoaded] = useState(false);
  /* 历史分页（1.7.36）：消息流**默认只上屏最近 CHAT_PAGE_SIZE 条**，再往前的要她点
     消息区最顶上那颗「加载更早的」才一次推上来——与线下页同一套（见 OfflineScenePage）。
     **只切屏幕这一路**：喂模型的 history 一直是全量 messages（见 send 里那段），
     所以翻页不动上下文、不动记忆。换会话即归零（不记上次翻到哪儿）。 */
  const [visibleCount, setVisibleCount] = useState(CHAT_PAGE_SIZE);
  /* 输入框是否聚焦：键盘跟随的 rAF 只在这期间跑（性能优化，见下方键盘效应）。 */
  const [inputFocused, setInputFocused] = useState(false);
  const [showPlus, setShowPlus] = useState(false);
  /* 「发送图片」的二级面板：先问「这张图从哪来」——手机相册，还是小手机自己的相册。
     小手机相册（共同相册）还没做，先留入口，见 pickImageSource。 */
  const [showImageSource, setShowImageSource] = useState(false);
  /* 选好、还没发出去的那张图：先把图摆出来问一句「要发这张吗」，
     等「发送」这一下才真发（见 confirmPendingImage）。previewUrl 是临时地址。 */
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [quoteText, setQuoteText] = useState("");
  /* 外语聊天：发出前那一刻正在把这句翻成外语（小飞机暂时歇一下，免得连点两下发两条）。 */
  const [translatingMy, setTranslatingMy] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  /* 长按菜单 */
  const [curMsg, setCurMsg] = useState<ChatMessage | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [showSheet, setShowSheet] = useState(false);
  /* 语音／转文字 */
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [showTrans, setShowTrans] = useState<string | null>(null);
  /* 语音播放诊断：**只在播失败时**在气泡下露一行小字（原因 + App 版本 + iOS 版本），
     成功时绝不显。临时用来把她那边到底卡在哪一步带回来，排掉就删。 */
  const [voiceDiag, setVoiceDiag] = useState<{ id: string; text: string } | null>(null);
  /* 弹窗 */
  const [showViewer, setShowViewer] = useState(false);
  const [viewerCap, setViewerCap] = useState("");
  /* 生图诊断：长按图片 → 诊断，看这张图**实际**走了哪条通道、
     参考图有没有真的送出去、提示词原文是什么。只在排查时用，平时不露头。 */
  const [diagView, setDiagView] = useState<ImageDiag | null>(null);
  /* 大图查看：存的是消息里的原始地址（新图＝媒体仓库引用串，老图＝data URL／
     链接）；空则回落到旧的插画样式。真正拿去显示／保存的地址在下面解析。 */
  const [viewerImg, setViewerImg] = useState("");
  const viewerSrc = useMediaSrc(viewerImg || undefined);
  /* 点开的那条红包／转账（null＝没开）：金额与留言都取这条消息自己的，不再写死。 */
  const [openMoney, setOpenMoney] = useState<ChatMessage | null>(null);
  /* 正在写的那个红包／转账（null＝面板没开）＋面板里现填的金额与留言。 */
  const [paySend, setPaySend] = useState<null | { kind: "redpacket" | "transfer" }>(null);
  const [payAmountText, setPayAmountText] = useState("");
  const [payNoteText, setPayNoteText] = useState("");
  /* 红包封面：发红包那页挑的那张（预设 id 或自定义图的引用串）。**它是全局的**——
     她选定一张之后就一直是它，换到哪个对话框、重开 App 都是它，除非再换；
     落库见 red-cover-store 的 `DEFAULT_KEY`，面板一开就把库里那张读回来。随消息落库。 */
  const [payCover, setPayCover] = useState("classic");
  /** 她这一趟是不是已经自己挑过封面了：挑过就不让「读库」那条异步回来的旧值盖回去
   *  （读是面板一开就发出去的，落在她换封面之前）。 */
  const coverPickedRef = useRef(false);
  /** 她在封面那几页换了封面（挑一张／换照片／挪完位置／恢复默认）：这一张**从此就是
   *  各处通用的默认**——先记在手里，再落库，下次进哪个对话框发红包都是它。 */
  const changePayCover = (v: string) => {
    coverPickedRef.current = true;
    setPayCover(v);
    void setDefaultRedCover(v).catch(() => {});
  };
  const [payBusy, setPayBusy] = useState(false);
  /* 支付密码那道闸（1.4.51）：把这一笔递给了密码键盘（null＝没这道闸）；
     账本里现在那份密码也先读出来，交给键盘比对；金额是给面板顶上那行看的。 */
  const [payPwdKind, setPayPwdKind] = useState<null | "redpacket" | "transfer">(null);
  const [payPwdCurrent, setPayPwdCurrent] = useState("");
  const [payPwdAmount, setPayPwdAmount] = useState("");
  /* 这一笔从哪儿出（1.4.55）：`"balance"`＝零钱，别的当卡的 id；
     她名下的卡也在这一页打开时读一遍，支付方式那张列表就用它。 */
  const [payMethod, setPayMethod] = useState("balance");
  const [payCards, setPayCards] = useState<WalletCard[]>([]);
  /** 递给密码键盘看的支付方式（「零钱」「招商银行储蓄卡 1234」）。 */
  const [payPwdMethod, setPayPwdMethod] = useState("");
  /** 我的零钱（分）；面板一开就读一次，用来判「够不够」。 */
  const [myBalance, setMyBalance] = useState<number | null>(null);
  const [showReModal, setShowReModal] = useState(false);
  const [reInput, setReInput] = useState("");
  const [showChatSettings, setShowChatSettings] = useState(false);
  /* 1.5.65 心声档案：点 TA 的头像进来的整页（盖住聊天窗口那一层，跟聊天设置一个做法）。 */
  const [showInnerPage, setShowInnerPage] = useState(false);
  /* 签名那一行此刻显不显中文（1.9.50）：点一下中日来回切，各自记住此刻的样子。 */
  const [sigCn, setSigCn] = useState(false);
  /* 1.7.5 线下场合：加号面板的「去见他」翻过去的一整页（见面，不再是发消息）。 */
  const [showOffline, setShowOffline] = useState(false);
  /* 收藏（会话内状态，跟随旧档案） */
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  /* 图文／语音 API（TA 发图发语音用；加载后按启用状态决定是否告知能力）。 */
  const [imageApi, setImageApi] = useState<ChatApiSettings | null>(null);
  const [imageExtras, setImageExtras] = useState<ImageApiExtras | null>(null);
  const [voiceApi, setVoiceApi] = useState<ChatApiSettings | null>(null);
  const [voiceExtras, setVoiceExtras] = useState<VoiceApiExtras | null>(null);
  /* 副接口（1.9.48）：外语聊天的翻译默认走它——翻一句话不需要文采，越便宜越好。 */
  const [subApi, setSubApi] = useState<ChatApiSettings | null>(null);
  /* 类人记忆（注入 prompt＋总结触发；随会话加载）。 */
  const [memory, setMemory] = useState<CharacterMemory | null>(null);
  /* 流式预览：TA 的回复边生成边长。纯临时态，落库后清空换成真消息。 */
  const [streamPreview, setStreamPreview] = useState<{ settled: string[]; tail: string } | null>(
    null,
  );
  /* 已经「放出来」的定型气泡数。模型一口气写完好几段时，靠它按节拍一条条显示。 */
  const [streamShown, setStreamShown] = useState(0);
  /* 尾巴被「冻」在屏幕上的状态：节拍器还没追上生成进度时，把上一帧那段尾巴原地留着
     （at＝冻结时已放出的条数），等它转正成的定型气泡被逐条接棒完毕再撤。
     否则一个空行到来、尾巴刚转正的瞬间，屏幕上会整段消失再重画，闪得很明显。 */
  const [frozenTail, setFrozenTail] = useState<{ at: number; text: string } | null>(null);
  /* 预览气泡各自的「上屏时刻」（下标＝气泡序号）：气泡一露面就带着发送时间，
     落库转正时原样沿用，预览与真消息下面的时间一模一样，不会等全部说完才一起冒出来。 */
  const [streamStamps, setStreamStamps] = useState<string[]>([]);

  /* ---------- 「查看本轮请求」：每轮真发出去的东西留一份 ---------- */
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);
  const [showReq, setShowReq] = useState(false);
  /** 上一轮那份正文：只用来算「与上一轮第一个不一样的字」在哪儿（前缀缓存诊断）。 */
  const lastFullRef = useRef("");
  /**
   * 记下这一轮发出去的东西（线上、线下共用）。
   * `full` 必须走 chatApi 的 outgoingContents（与真请求同一份逻辑），否则回喂历史用的是
   * `m.apiText`、记成 `m.content` 就对不上账了。
   */
  const recordRequest = useCallback(
    (r: {
      mode: "online" | "offline";
      model: string;
      stream: boolean;
      sections: PromptSection[];
      activated: { book: string; title: string; by: string }[];
      full: string;
    }) => {
      /* 与上一轮逐字比前缀：健康的样子＝上一轮那条请求原样接在本轮前面（前缀缓存连读）。 */
      const prev = lastFullRef.current;
      let at = 0;
      if (prev) {
        const n = Math.min(prev.length, r.full.length);
        while (at < n && prev[at] === r.full[at]) at += 1;
      }
      lastFullRef.current = r.full;
      const diff = !prev
        ? "（这是你在本窗口发的第一笔，没有上一轮可比）"
        : at >= prev.length
          ? `✅ 上一轮（${prev.length} 字）原样接在本轮前面，本轮只多出尾部 ${r.full.length - prev.length} 字。`
          : `❌ 与上一轮在第 ${at} 个字处就不一样了（上一轮共 ${prev.length} 字）——从这儿往后每轮都要重写。`;
      setLastReq({ ...r, at: Date.now(), diff });
    },
    [],
  );

  /* ---------- 改自己／他发出去的话（1.7.50）：长按气泡 →「编辑」 ---------- */
  /** 正在改的那条（null＝没在改）。 */
  const [editMsg, setEditMsg] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");

  /* ---------- 生效 API：角色个别配置（角色设置页）优先，未配置跟随全局 ---------- */
  /** 某类覆盖已填好地址＋模型才视为有效（空壳覆盖回落全局）。 */
  const overrideOf = (s?: ChatApiSettings): ChatApiSettings | null =>
    s && s.baseUrl.trim() !== "" && s.model.trim() !== "" ? s : null;
  const effTextApi = useMemo(() => {
    const override = overrideOf(conv?.apiOverrides?.text);
    if (!override) return apiSettings;
    /* 角色覆盖只存地址／Key／模型，不含流式开关：覆盖生效时继承全局，
       否则「全局关掉流式」会被角色的独立配置悄悄绕过去。 */
    return override.stream === undefined
      ? { ...override, stream: apiSettings.stream }
      : override;
  }, [conv, apiSettings]);
  const effImageApi = useMemo(
    () => overrideOf(conv?.apiOverrides?.image) ?? imageApi,
    [conv, imageApi],
  );
  const effVoiceApi = useMemo(
    () => overrideOf(conv?.apiOverrides?.voice) ?? voiceApi,
    [conv, voiceApi],
  );
  const effVoiceExtras = useMemo(
    () => conv?.voiceOverride ?? voiceExtras,
    [conv, voiceExtras],
  );
  /* 翻译交给哪套接口（1.9.48）：设定里挑了副接口、且副接口**真配齐了**（启用＋地址＋模型）
     才用它；只要有一项没填就退回主文本接口——挑了个空的副接口却静默不翻，最难查。 */
  const translateApi = useMemo(() => {
    const s = subApi;
    const subReady = !!s && s.enabled && s.baseUrl.trim() !== "" && s.model.trim() !== "";
    /* 老会话还没存过 translate 这一格时，取跟设置页显示的**同一个出厂值**（副接口）——
       否则设置页写着「副接口」、实际却悄悄走主接口，账单上就对不上了（恩熙查账没看见副接口扣费）。 */
    const choice = conv?.translate?.api ?? "sub";
    if (choice === "sub" && subReady && s) return s;
    return effTextApi;
  }, [conv, subApi, effTextApi]);

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /* 选图用的隐藏输入（加号面板里的「发送图片」点它，见 sendPickedImage）。 */
  const imageInputRef = useRef<HTMLInputElement>(null);
  /* 待发那张图底下配的话（非受控，跟主输入框一个道理：字存 DOM 里，发的时候才读）。 */
  const pendingTextRef = useRef<HTMLTextAreaElement>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* 本轮流式请求的中断源（停止按钮）与最新全文（停止时保留已说出口的话）。 */
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef<string>("");
  /* 已放出气泡数的镜像：收流结束后要它配合节拍器把尾巴排空，才不至于落库时整批跳出来。 */
  const streamShownRef = useRef(0);
  /* 已定型气泡总数的镜像（节拍器放到这个数才算追平生成进度）。 */
  const streamSettledRef = useRef(0);
  /* 上一帧尾巴的文本：它定型时要把已经显示的字「转正」，不能让节拍器收回去。 */
  const streamTailRef = useRef("");
  /* 上屏时刻的镜像（预览渲染与落库都读它，避免在渲染期读 ref）。 */
  const streamStampsRef = useRef<string[]>([]);
  /* 1.4.9 思维链：本轮思考过程的累积缓冲——onReasoning 一行行往里写，落库时挂到
     本轮第一条 TA 气泡上（一轮只挂一条，思考只有一个）。 */
  const reasoningRef = useRef<string>("");
  /* 1.4.9 思维链两件套：①showReasoning＝全局开关（设置里的「显示思维链」，进场读一次）；
     ②openReasoningIds＝哪几条消息的思考面板点开了（默认全收着）。 */
  const [showReasoning, setShowReasoning] = useState(true);
  /* 1.4.12 正则规则缓存：挂载时读一遍（旧消息的「仅显示」规则进页就生效），
     每轮发送前再刷一次（刚建的规则下一轮就用上）。 */
  const [regexRules, setRegexRules] = useState<RegexRule[]>([]);
  const [openReasoningIds, setOpenReasoningIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    void getChatPrefs().then((p) => setShowReasoning(p.showReasoning));
    void loadRegexRules().then(setRegexRules);
  }, []);
  const toggleReasoningOpen = useCallback((id: string) => {
    setOpenReasoningIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /* 1.5.60 那套「心声默认收着、点开才展开」的 state 已随 1.5.72 摘掉聊天里的心声入口
     一起删掉——现在没有可开合的心声块了（心声全在那页档案里，那边自带历史抽屉）。 */
  /* visible 的镜像：requestReply 是个长跑的闭包，开跑那一刻就把 visible 的值抄住了——
     中途退回列表，闭包里那个 true 还是 true，判断不出「人已经不在这一间」。
     落库要不要记未读，得读「此刻」的值，所以用 ref 跟着走。 */
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  /* messages 的镜像（1.8.4）：generateOfflineReply 是个长跑的闭包，deps 里没有 messages
     （它若跟着 messages 变，整条线下回调每轮重建）。进线下时要拿「线上刚聊过的那一段」
     拼在见面请求最前，闭包里读不到最新的 messages，就用 ref 跟着走——同 visibleRef 一个道理。 */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  /** 给第 i 条气泡补上上屏时刻：已经有就不动，保证它「首次露面」的那一刻不会再变。 */
  const stampBubble = useCallback((i: number) => {
    if (streamStampsRef.current[i]) return;
    streamStampsRef.current[i] = new Date().toISOString();
    setStreamStamps(streamStampsRef.current.slice());
  }, []);

  /* 流式预览的合批箱（性能优化）：最新一帧先存进 ref，计时器到点才 setState。
     收流回调只往里塞，不再一次分片一次重渲染。 */
  const streamPendingRef = useRef<{ settled: string[]; tail: string } | null>(null);
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushStreamPreview = useCallback(() => {
    streamFlushTimerRef.current = null;
    const pending = streamPendingRef.current;
    if (pending) setStreamPreview(pending);
  }, []);

  /** 塞一帧预览；已有计时器在跑就不再排新的（节流，不是防抖——首帧也照样按时放）。 */
  const queueStreamPreview = useCallback(
    (next: { settled: string[]; tail: string }) => {
      streamPendingRef.current = next;
      if (streamFlushTimerRef.current !== null) return;
      streamFlushTimerRef.current = setTimeout(flushStreamPreview, STREAM_PREVIEW_FLUSH_MS);
    },
    [flushStreamPreview],
  );

  /** 撤预览：先把还没放出去的那一帧和计时器一起丢掉，否则它会在清空之后又把预览挂回来。 */
  const clearStreamPreview = useCallback(() => {
    streamPendingRef.current = null;
    if (streamFlushTimerRef.current !== null) {
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    setStreamPreview(null);
  }, []);

  /* 正在跑的每一次生图：取消手柄＋起算时刻，按消息 id 存。
     生图按次计费，所以「放弃」的权力归用户——这里只负责把用户那一下点取消传给请求，
     绝不自动挂断、更不自动重发（见 chatApi 的 generateImage）。 */
  const imageJobsRef = useRef(new Map<string, { controller: AbortController; startedAt: number }>());
  /** 占位气泡的「已等 X 分 Y 秒」，只用于显示。 */
  const [imageElapsed, setImageElapsed] = useState<Record<string, number>>({});
  /** 失败气泡里正在手改的画面描述（草稿，按消息 id 存）。改完重发才写回消息本体。 */
  const [imageDraft, setImageDraft] = useState<{ id: string; text: string } | null>(null);

  /** 用户点了「不等了」：中断这一次请求（对方可能照旧画完并计费，文案里会说清）。 */
  const cancelImageGen = useCallback((id: string) => {
    imageJobsRef.current.get(id)?.controller.abort();
  }, []);

  /* 「已经在画」的占位才算跑秒：等点「生成」的那种（awaitGen）没在花钱，
     不该把秒表转起来（见下面的计时器）。 */
  const hasPendingImage = messages.some((m) => m.type === "image" && m.pending && !m.awaitGen);
  useEffect(() => {
    if (!hasPendingImage) return;
    const tick = () => {
      const next: Record<string, number> = {};
      for (const [id, job] of imageJobsRef.current) {
        next[id] = Math.floor((Date.now() - job.startedAt) / 1000);
      }
      setImageElapsed(next);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hasPendingImage]);

  /* 名字全部动态：档案本名 → 昵称 → 兜底「TA」。 */
  const charName = character.data.name || character.data.nickname || "TA";
  const myName = userName.trim() || "我";
  /* 1.4.12 正则宏上下文：{{user}}＝我、{{char}}＝TA（发送与气泡显示共用一份）。
     useMemo 稳住引用：sendReply 的 useCallback 依赖它，不包一层每渲染都重建回调。 */
  const regexCtx = useMemo(() => ({ userName: myName, charName }), [myName, charName]);
  const signature = conv?.signature?.trim() || defaultSignature(character.data);
  /* 签名译文（1.9.50）：外语聊天开着时，缓存里那句中译（见 transCache）——有了它，
     名字下方那一行才可以「点一下」切中文；没翻好／没开外语，就只显示原文、点不动。 */
  const sigTrans =
    conv?.translate?.out.on === true ? conv?.transCache?.[(conv?.signature ?? "").trim()] ?? "" : "";
  /* 1.7.20：默认字号 13 → 13.5。气泡正文这一版换了宋体（见 assistantBubbleStyle 的注），
     宋体笔画比黑体细、同一字号看着更小更薄，提小半号补回来；她自己调过字号的仍以
     conv.fontSize 为准，这里只动默认那一档。 */
  const fontSize = conv?.fontSize ?? 13.5;
  const actualCharAvatar = conv?.charAvatar || character.data.photo || "";
  /* 我的头像：会话里单独设过就用那个，没设过**跟随「我的」里正在用的那张面具**。
     不跟随的话会直接落空、退回粉渐变＋首字，跟「我的」页换头像脱钩。 */
  const actualMyAvatar = conv?.myAvatar || mask?.avatar || "";

  /* ---------- 载入会话（会话／记忆／图文语音设定齐了才放行界面） ---------- */
  /* 图文／语音设定必须和会话一起读完，再让界面可用：它决定 canImage／canVoice，
     进而决定风格提示词走「能发图」的完整版还是「发不了图」的短版。第一轮若在设定
     读出来之前发出去，会被当成「发不了图」、这份短版被写进缓存；下一轮设定到位换成
     完整版，请求前缀从那段起就对不上，缓存整段白建。参考项目是全局先把本地数据读完
     才渲染界面，这里把同一条原则落到聊天窗：设置没到齐，发送键不生效。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /* 换会话／换面具＝从头来过：分页翻回最近那一页，不记上次翻到哪儿（与线下页同口径）。 */
      setVisibleCount(CHAT_PAGE_SIZE);
      const [created, bundle] = await Promise.all([
        getOrCreateConversation(character.id, maskId),
        getApiBundle(),
      ]);
      /* 上次刷新／重载会把正在跑的生成任务一起杀掉，库里残留的「生成中」占位就成了孤儿：
         归位成「失败可重试」，否则它会永远转圈（不超时也不报错）。 */
      const c = (await healStalePendingMedia(character.id, maskId)) ?? created;
      const mem = await getMemory(character.id, maskId);
      if (cancelled) return;
      setConv(c);
      setMessages(c.messages);
      /* 线下那一场还开着吗（1.7.39）：开着就直接又摆出线下那一页——App 被杀掉／退到后台
         再进来照样认（恩熙：「我下一次点击这个聊天框，依旧还是会停留在线下的结果」）。
         换会话时也按这条新会话自己的值走，不把上一间屋子的「见着面」带过来。 */
      setShowOffline(!!c.offlineOpen);
      setMemory(mem);
      setImageApi(bundle.image);
      setImageExtras(bundle.imageExtras);
      setVoiceApi(bundle.voice);
      setVoiceExtras(bundle.voiceExtras);
      setSubApi(bundle.sub);
      setLoaded(true);
      await markConversationRead(character.id, maskId);
      onDataChange();
      /* 我发出去、卡片还停在「等他表态」的那些钱，一进会话先按**过期**判一遍：
         他始终没表态（也没退还）而聊天又往下走过「上下文条数」那么多条，这笔就作废、
         钱原路退回我出的那个口袋（见 expireStaleMoney）。
         没走过线的一律**留着**——他随时能回头补一个〔收下〕把它领走。
         1.4.63 之前发出的老消息没有 `payFrom`：那种当时就一次划走了（钱早进他账上），
         这里只补卡片上那一句；1.5.12 起**不再替他收下**（老口径「没写＝他收下」已废），
         补的也是「已过期」——钱早给出去了，退不回来就不再动账。 */
      const swept = await expireStaleMoney(c.messages, moneyExpiryLimitOf(mem), {
        characterId: character.id,
        maskId,
        charName,
        showToast,
      });
      if (cancelled) return;
      if (swept.list !== c.messages || swept.echoes.length > 0) {
        /* 补的那条系统句接在最末（跟落库顺序一致）：下次重进这个会话读到的也是这个次序。 */
        setMessages([...swept.list, ...swept.echoes]);
      }
      /* 贴底已挪到下面的 useLayoutEffect（在消息铺出来那一帧、上屏之前定住位置），
         这里不再延后 60ms 补跳一次——那一下正是要消掉的「跳转」。 */
    })().catch(() => {
      setLoaded(true);
      showToast("读取消息失败");
    });
    return () => {
      cancelled = true;
    };
  }, [character.id, maskId, charName, myName, onDataChange, showToast]);

  /* 进聊天框即贴底：消息一铺出来就**在上屏之前**把滚动位置钉在最底下。
     useLayoutEffect 跑在「DOM 已经落地、浏览器还没画」的中间，这里改掉 scrollTop，
     第一帧画出来就已经在底部——从头到尾没有可被看见的跳转。
     不能 setLoaded(true) 之后等 60ms 再跳：那 60ms 里屏幕停在消息最上面，
     然后「哐」一下弹到底，就是一次可见的跳转。
     loaded 翻 true 是「消息第一次铺出来」那一帧；visible 转 true 是「从上一页翻回来」
     那一帧——藏起来那段时间浏览器会把 scrollTop 归零，所以回来必须再钉一次底。 */
  useLayoutEffect(() => {
    if (!loaded || !visible) return;
    const el = bodyRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    /* 第一下：消息铺出来的那一帧、上屏之前定住位置——第一帧画出来就在底部，没有可见的跳转。 */
    pin();
    /* 再补两拍（下一帧 ＋ 再下一帧）：这间屋子是常挂着的（返回只是 display:none），
       元素**刚被重新激活**的那一帧里赋的 scrollTop，iOS 会吃掉——容器这一刻才重新有
       滚动高度，赋值被当成 0 丢掉；另外图片、「正在输入」这类东西是进门之后才把内容
       撑高的，也得跟着重新贴底。补的这两拍都在上屏之前发生（rAF 在绘制前跑），
       所以不会看见跳动。 */
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      pin();
      raf2 = requestAnimationFrame(pin);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [loaded, visible]);

  /* 加载更早的消息（1.7.36）：只把**上屏条数**往上推一格，消息本身一条都没动。
     推完要把视口钉住：新增的那些全在上头，不钉的话内容整体下坠，她正看着的那行会跑掉。
     做法＝记下推之前的 scrollHeight／scrollTop，推完（useLayoutEffect，还在上屏之前）
     把多出来的那段高度补回 scrollTop，屏幕上那行字一动不动。 */
  const loadMoreRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const loadMore = useCallback(() => {
    const el = bodyRef.current;
    if (el) {
      loadMoreRestoreRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    setVisibleCount((c) => Math.min(c + CHAT_PAGE_SIZE, messages.length));
  }, [messages.length]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    const restore = loadMoreRestoreRef.current;
    if (!el || !restore) return;
    loadMoreRestoreRef.current = null;
    el.scrollTop = restore.scrollTop + (el.scrollHeight - restore.scrollHeight);
  }, [visibleCount]);

  /* 从列表翻回这一间屋子＝「看见了」，把红点抹掉。
     这间屋子是常挂着的（返回只是 display:none，组件不卸），所以载入时那一次清零
     不会再跑——红点是退出去之后又攒上的，只有盯住 visible 由假转真才清得干净。 */
  useEffect(() => {
    if (!loaded || !visible) return;
    void markConversationRead(character.id, maskId).then(() => onDataChange());
  }, [loaded, visible, character.id, maskId, onDataChange]);

  useEffect(
    () => () => {
      if (longTimer.current) clearTimeout(longTimer.current);
      /* 合批箱的计时器也不能漏在卸载之后。 */
      if (streamFlushTimerRef.current) clearTimeout(streamFlushTimerRef.current);
    },
    [],
  );

  /* 卸载时把正在响的语音掐掉，不然离开聊天还在说话。 */
  useEffect(() => () => {
    stopVoiceEl();
  }, []);

  /* 待确认那张图的临时地址，随它来去：换一张、取消、发出去、连组件卸载都收掉，
     不留 blob 占着内存。 */
  useEffect(() => {
    const url = pendingImage?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pendingImage]);

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, 40);
  }, []);

  /* 键盘弹出／收起时列表贴底：壳子高度随键盘伸缩，若列表滚动位置不动，
     最新消息会被「裁」出可视区（旧消息还在、新的反而看不见，观感奇怪）。
     原本就在底部附近的，跟随贴底——最新消息始终贴着输入条，像原生 App 的整体上推。
     这条 rAF 若**页面活着就一直跑**，哪怕没在打字也每帧醒一次（手机上一直不让 CPU
     闲下来，就是持续发热的来源之一）。键盘只可能在输入框聚焦时弹出，所以只在
     聚焦期间跑，失焦即停。 */
  useEffect(() => {
    if (!inputFocused) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let prevH = vv.height;
    let raf = 0;
    const tick = () => {
      const el = bodyRef.current;
      if (Math.abs(vv.height - prevH) > 120 && el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        el.scrollTop = el.scrollHeight;
      }
      prevH = vv.height;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inputFocused]);

  const pushLocal = useCallback(
    (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      scrollBottom();
    },
    [scrollBottom],
  );

  /* 流式预览每长一段就贴底：跟真人打字一样，视线不用自己追。 */
  useEffect(() => {
    if (streamPreview && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [streamPreview, streamShown]);

  /* 出场节拍：模型往往一口气吐完好段（尤其快模型或中转站攒批下发），
     若来一段就亮一段，会「哗」地蹦出好几条。这里是自续期的节拍链：
     预览在，就每 450ms 放一条，直到追平生成进度为止。
     目标条数走 ref、依赖只有「有没有预览」——绝不依赖会频繁变化的量，
     否则每来一小段增量、每过一个空行都把计时重置，攒下的气泡永远放不出来。 */
  const hasPreview = streamPreview !== null;
  useEffect(() => {
    if (!hasPreview) return;
    /** 放一条（若确实攒着）后自动续下一拍。 */
    const tick = () => {
      if (streamShownRef.current < streamSettledRef.current) {
        /* 这条气泡连同它的上屏时刻一起露面。 */
        stampBubble(streamShownRef.current);
        streamShownRef.current += 1;
        setStreamShown(streamShownRef.current);
      }
      /* 追平生成进度时，尾巴紧接在第 shown 条上露面：它的时刻也得同时补上。 */
      if (streamShownRef.current === streamSettledRef.current && streamTailRef.current) {
        stampBubble(streamShownRef.current);
      }
      timer = setTimeout(tick, STREAM_REVEAL_INTERVAL_MS);
    };
    let timer = setTimeout(tick, STREAM_REVEAL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [hasPreview, stampBubble]);

  /* ---------- TA 照片的提示词兜底（代码层保险，不依赖 AI 听话） ---------- */
  /* 角色档案切片（性别原文 ＋ looks 外貌）：生图提示词里固定拼一段人设外貌，参考图
     只负责定脸。拼法（栏位清洗／顺序／截 600 字／刻意不收血型与标签）统一收在
     `buildImageSubject` 里——**动态配图那条路也用它**，两处必须同一套，
     别再各自抄一份。 */
  const imageSubject = useMemo(() => buildImageSubject(character.data), [character.data]);

  /* ---------- 图片／语音生成与重试（占位保留；失败可点击或长按重新生成） ---------- */
  const regenerateMedia = useCallback(
    async (m: ChatMessage) => {
      if (m.type === "image") {
        if (!effImageApi || !imageExtras) {
          showToast("图文 API 未配置，无法生成");
          return;
        }
        /* 旧图马上就被顶掉（working 里 imageUrl 已置空），仓库那份先回收掉，
           不然每重生成一次就往仓库里多留一张没人要的图。失败时旧图也已在消息里没了，
           回收不影响结果。 */
        releaseImageAsset(m.imageUrl);
        const working: ChatMessage = {
          ...m,
          pending: true,
          /* 真的开画了：把「等你点生成」的记号摘掉，占位框切回「图片生成中…」。 */
          awaitGen: false,
          error: false,
          errorText: undefined,
          imageUrl: undefined,
        };
        /* 连「生成中」都写不进库（多半是存储满了）就直接说清楚、到此为止，
           别再花钱去打生成接口。 */
        try {
          await updateMessage(character.id, maskId, working);
        } catch (err) {
          showToast(`保存不了：${err instanceof Error ? err.message : "存储写入失败"}`);
          return;
        }
        setMessages((prev) => prev.map((x) => (x.id === m.id ? working : x)));
        /* 这一次生图的取消手柄：只有用户自己点「不等了」才会 abort。 */
        const controller = new AbortController();
        imageJobsRef.current.set(m.id, { controller, startedAt: Date.now() });
        try {
          /* 锁不锁脸由 TA 在标记里声明（〔图片:使用参考图〕／〔图片:不使用参考图〕）；
             旧消息没有开关时按描述内容兜底判断。
             「文字锁脸」模式下不送参考图：长相全靠人设文字，表情角度完全自由。
             外貌文字不再由这里拼：性别标签与人设切片统一交给 generateImage 拼
             （miya 式），参考图只是定脸的一份材料。 */
          /* 带不带参考图：TA 在标记里**写明**的照它写（use／none）；没写（absent，或老数据）
             再按画面描述兜底认人——认人时把**角色名**一起算进去，否则「砂金半侧过身靠着扶手」
             这种（提示词要求它用角色名、不许写「自己」）会被判成「画面里没人」。 */
          const useCharRef =
            m.refMark === "none"
              ? false
              : m.refMark === "use"
                ? true
                : guessUseCharRef(m.content, charName);
          const textFaceLock = imageExtras.faceLockMode === "text";
          /* 参考图已经搬进图片仓库（会话里只剩一句引用串），而生图接口只认 data URL，
             所以这里得把原图读回来再送出去；老数据本来就是 data URL，原样传回。
             读不回来就当「这次没传参考图」继续画——生图是按次扣钱的，
             绝不为省一张脸把这一趟的钱烧在这儿。 */
          const refImage =
            useCharRef && !textFaceLock ? await mediaRefToDataUrl(conv?.charRefImage) : undefined;
          /* 参考图为什么没跟上（诊断面板用：refsSent 是 0 时光看提示词层查不出是哪一种）。
             这一层比生图层清楚：它看得见开关、标记与仓库里有没有那张图，
             四种断法在这里就能分开。 */
          const refMissed = refImage
            ? undefined
            : textFaceLock
              ? "设置里的锁脸方式是「文字锁脸」，本来就不送参考图"
              : !useCharRef
                ? m.refMark === "none"
                  ? "TA 在标记里写明的是「不使用参考图」（它自己判的画面里没有它本人）"
                  : m.refMark === "use"
                    ? "标记写了「使用参考图」，但这次没带上（参考图那一段没读出来）"
                    : "标记里**没写**「使用／不使用」，是按画面描述判断的——描述里没认出它本人"
                : !conv?.charRefImage
                  ? "这个角色还没传参考图"
                  : "参考图存在本机，但读不出数据（仓库那份丢了或被清过）";
          /* 提示词就是 TA 写的画面描述原文（一条回复只画这一张，不再有「同轮第二张」）。 */
          const res = await generateImage(
            effImageApi,
            m.content,
            imageExtras,
            effTextApi,
            refImage,
            imageSubject,
            controller.signal,
          );
          /* 压缩后存进独立媒体仓库，消息里只留引用串 media-store://mc_xxx——
             消息表从此不再扛着整张图的 base64。
             注意**不能**在图没落库时退回 res.image：那多半是几 MB 的 base64，
             而会话记录是「每次读列表都整份读出」的那一份，图住进去＝整个聊天
             都可能再也存不进去。仓库写不进去时 persistImageAsset 给的是「只活在
             内存里」的引用串——这一趟照样上屏、照样能存相册，刷新后如实显示图已失。 */
          const stored = await persistImageAsset(res.image);
          const imageUrl = stored?.ref ?? (res.image.startsWith("data:") ? undefined : res.image);
          /* 连字节都读不出来、又是个几 MB 的 data URL 时，宁可报错也不能塞进会话记录。 */
          if (!imageUrl) {
            throw new Error(
              "这张图没能存进本机（图片数据读不出来），也没把原图硬塞进聊天记录——点一下可以重新生成",
            );
          }
          if (stored && !stored.persisted) {
            showToast("这张图存不进本机（存储写不进去），现在能看、刷新后会丢；想留就长按存相册");
          }
          /* 先解码再上屏：大图直接挂 <img> 会从上往下渐进解码，看起来像
             「生成完又重新刷一遍」；等解码完成才替换占位，挂载即整图出现。 */
          await new Promise<void>((resolve) => {
            const pre = new Image();
            const done = () => {
              void pre.decode().catch(() => {}).finally(() => resolve());
              if (pre.complete) resolve();
            };
            pre.onload = done;
            pre.onerror = () => resolve(); // 预解码失败也不卡消息，交给 <img> 自己处理
            pre.src = stored?.previewUrl ?? res.image;
          });
          const done: ChatMessage = {
            ...working,
            pending: false,
            imageUrl,
            /* 生图诊断：把「实际发生了什么」落到消息上——
               走的是哪条通道、参考图真的送了几张、实发提示词原文、翻译有没有失败。
               排查「带了参考图却不像」时，第一眼看 refsSent：若是 0，说明这一趟
               是纯文生图（站点不认图片编辑接口，代码退回了），提示词再严也没用。 */
            diag: {
              via: res.via,
              refsSent: res.refsSent,
              refsPrepared: res.refsPrepared,
              /* 生图层说得清就用它的（带图那趟被站点拒的原话），说不上来再问调用侧
                 ——那边知道是开关、标记还是仓库没图。 */
              refSkipReason: res.refSkipReason ?? refMissed,
              prompt: res.finalPrompt,
              translateFailed: res.translateFailed,
            },
          };
          await updateMessage(character.id, maskId, done);
          setMessages((prev) => prev.map((x) => (x.id === m.id ? done : x)));
        } catch (err) {
          const reason = err instanceof Error ? err.message : "生成失败";
          /* 原因原文一并落库：提示条会被截断、几秒就消失，只有留在消息上才查得动。
             图片是按次扣费的，失败原因看不全＝每次都白花钱试。 */
          const bad: ChatMessage = { ...working, pending: false, error: true, errorText: reason };
          try {
            await updateMessage(character.id, maskId, bad);
          } catch {
            /* 存储写不进去，留给下一次重试 */
          }
          setMessages((prev) => prev.map((x) => (x.id === m.id ? bad : x)));
          showToast(`图片没发出来：${reason}`);
        } finally {
          imageJobsRef.current.delete(m.id);
        }
        return;
      }
      if (m.type === "voice") {
        if (!effVoiceApi || !effVoiceExtras) {
          showToast("语音 API 未配置，无法合成");
          return;
        }
        const working: ChatMessage = { ...m, pending: true, error: false, audioUrl: undefined };
        /* 同上：写不进库就别去打接口了（语音是按次收费的）。 */
        try {
          await updateMessage(character.id, maskId, working);
        } catch (err) {
          showToast(`保存不了：${err instanceof Error ? err.message : "存储写入失败"}`);
          return;
        }
        setMessages((prev) => prev.map((x) => (x.id === m.id ? working : x)));
        try {
          const res = await synthesizeSpeech(effVoiceApi, voiceSpokenText(m.content), effVoiceExtras);
          const done: ChatMessage = { ...working, pending: false, audioUrl: res.audio };
          await updateMessage(character.id, maskId, done);
          setMessages((prev) => prev.map((x) => (x.id === m.id ? done : x)));
        } catch (err) {
          const bad: ChatMessage = { ...working, pending: false, error: true };
          /* 兜底写库失败也不能把气泡卡死在「合成中」：先上屏再说。
             （写不进去＝刷新后会退回占位，但至少当场看得到、点得动重试。） */
          try {
            await updateMessage(character.id, maskId, bad);
          } catch {
            /* 存储写不进去，留给下一次重试 */
          }
          setMessages((prev) => prev.map((x) => (x.id === m.id ? bad : x)));
          showToast(`语音没发出来：${err instanceof Error ? err.message : "合成失败"}`);
        }
      }
    },
    [character.id, maskId, effImageApi, imageExtras, effVoiceApi, effVoiceExtras, effTextApi, imageSubject, conv, charName, showToast],
  );

  /* ---------- 我发出去的钱：等他回头表态（收下／退还） ---------- */
  /* 钱在发出那一刻**只从我账上扣掉**（见 sendMoneyNow 里的 payOutToContact），
     还没进他的账——卡片就停在「等他收下／等他领取」。他之后哪一轮写了〔收下〕
     （红包写〔领取〕）才真收下（`markContactReceived`：这一刻钱才进他的零钱）；
     转账写了〔退还〕就原路回我出的那个口袋（`settleContactRefund`）。
     **什么都没写＝他没表态**，钱既不在他那儿、也没退回来，一直悬着——
     这条钱后面又走过上下文那么多条还没表态，才按过期退回我这儿
     （进会话时／每一轮求回复前扫一遍，见 expireStaleMoney）。 */

  const markContactReceived = useCallback(
    async (m: ChatMessage) => {
      /* 先把他那份加上（1.4.63）：钱在发出那一刻只从我这扣了、还没给他，
         收下这一刻才落进他的零钱。老消息（1.4.63 之前发出的）没有 `payFrom`——
         那种当时就一次划走了（钱已在他账上），这里只补卡片上那一句，不能再加一遍。
         加不成就先不动卡片：留着下次进会话再补（宁可晚一点，也不能卡片写着「他已收下」、
         钱却没进他的账）。 */
      if (m.payFrom !== undefined) {
        const cents = Math.round((m.amount ?? 0) * 100);
        if (cents > 0) {
          const label = m.type === "redpacket" ? "红包" : "转账";
          try {
            await adjustBalance(character.id, "contact", cents, `收到${myName}的${label}`, m.content);
          } catch {
            return;
          }
        }
      }
      const done: ChatMessage = { ...m, moneyClaimed: true };
      try {
        await updateMessage(character.id, maskId, done);
      } catch {
        /* 没写进库就先算了：下次进这个会话时统一补（见载入会话那段的补账）。 */
        return;
      }
      /* 就地替换（不是 append）：同一条钱不能显示成两条。 */
      setMessages((prev) => prev.map((x) => (x.id === done.id ? done : x)));
      /* 弹窗此刻正开着这一条的话，文案也要跟着变——不然卡片已经「他已收下」，
         弹窗里还写着「等他收下」，两处对不上。 */
      setOpenMoney((cur) => (cur && cur.id === done.id ? done : cur));
      /* 光把原来那张卡变淡还不算完（恩熙 1.4.40）：「他接受转账了，我的卡片变暗，
         并且他会发出一个他接受转账的卡片」——所以再以**他的名义**落一条：
         转账是收款回执卡（挂在他那侧、跟他的消息一样带头像），红包是一条系统提示
         「XX 已领取你的红包」（1.4.42，恩熙要的微信那个样子）。 */
      const echo = buildMoneyEcho(m, "assistant", charName);
      try {
        await appendMessage(character.id, maskId, echo);
        pushLocal(echo);
        onDataChange();
      } catch {
        /* 没写上就先算了：卡片已经是「他已收下」，钱也进了他的账，少的只是这一条。 */
      }
    },
    [character.id, maskId, charName, myName, pushLocal, onDataChange],
  );

  /* 他不要这笔钱（转账写了〔退还〕）：钱**原路**回我出的那个口袋。
     跟「收下」是一对：收下是把钱给他，这里是把钱收回我这儿——他那本账一分没动过，
     因为钱压根还没给出去（见 payOutToContact 的注释）。
     红包不走这儿：红包没有「退还」这回事（跟微信一致：只能开、不能退），
     他不领就是没表态、钱照旧挂着（调用方拦着，见 requestReply 里按类型分流那段）。 */
  const settleContactRefund = useCallback(
    async (m: ChatMessage) => {
      const cents = Math.round((m.amount ?? 0) * 100);
      /* 老消息（1.4.63 之前发出的）没有 `payFrom`：那种发出去时就一次划走了
         （钱已经进了他的账），这里再往回搬一遍就是同一笔钱算两回——只补卡片上那个字。 */
      if (cents > 0 && m.payFrom !== undefined) {
        const back = await takeBackToPocket({
          ownerId: maskId,
          from: m.payFrom ?? "balance",
          cents,
          title: `收回给${charName}的转账`,
          detail: m.content,
        });
        if (!back.ok) {
          /* 钱没回来就不动卡片：这条还停在「等他收下」，下次进会话再补。
             绝不能让卡片写着「已退还」、钱却还在我账上少着。 */
          showToast(`他没要这笔钱，可钱没退回来：${back.error ?? "稍后再试"}`);
          return;
        }
      }
      const done: ChatMessage = { ...m, moneyRefunded: true };
      try {
        await updateMessage(character.id, maskId, done);
      } catch {
        /* 标记没写进库：钱已经回来了，但这条气泡没带上落定那个字——
           重进会话还会显示「等他收下」。如实说一声，别让她蒙在鼓里。 */
        showToast("钱退回来了，但这条没标上「已退还」");
      }
      /* 就地替换那条气泡（不是 append）：同一条钱不能显示成两条。 */
      setMessages((prev) => prev.map((x) => (x.id === done.id ? done : x)));
      setOpenMoney((cur) => (cur && cur.id === done.id ? done : cur));
      /* 他退了也得在聊天里留一句（跟「他收下」那条对称）：以他的名义发一张「已退还」的回执卡。 */
      const echo: ChatMessage = buildReceiptMsg(m, "assistant", "已退还");
      try {
        await appendMessage(character.id, maskId, echo);
        pushLocal(echo);
      } catch {
        /* 回执没写上就先算了：钱已经回来了、标记也落了库，少的只是这一条。 */
      }
      onDataChange();
    },
    [character.id, maskId, charName, showToast, pushLocal, onDataChange],
  );

  /* ---------- 请求一轮回复（未配置 API 时系统提示，不造假回复） ---------- */
  const requestReply = useCallback(
    async (
      userText: string,
      opts?: {
        extraHint?: string;
        quote?: string;
        historyBase?: ChatMessage[];
        mediaOnly?: boolean;
        mediaText?: string;
        /* 本轮附图（data URL）：调用方直接从别处取好的图。
           眼下只有发红包带自定义封面时用（那张图挂在红包消息的 redCover 上，
           不是 image 消息，下面那圈「回溯末尾图片消息」找不到它）。 */
        visionImage?: string;
      },
    ) => {
      let history = opts?.historyBase ?? messages;
      // API 未启用或地址／模型没填全：老实说没配置，不发占位假回复。
      if (!effTextApi.enabled || !effTextApi.baseUrl.trim() || !effTextApi.model.trim()) {
        /* 走系统提示而非 TA 气泡（见下面失败提示处的说明）；填好之后点提示下的
           「重新生成」就能把这条话接着说完，不用把刚才打的字重打一遍。 */
        const notice: ChatMessage = {
          id: uuid(),
          role: "system",
          type: "system",
          content: "API 尚未配置，TA 无法回应。请到主屏幕「设置」App 的「API 设定」里填好并启用。",
          createdAt: new Date().toISOString(),
          isRead: true,
          retryable: true,
        };
        await appendMessage(character.id, maskId, notice);
        pushLocal(notice);
        onDataChange();
        return;
      }
      /* 线下那一场也进上下文（1.7.7）：把最近的线下经过拼成**一条**挂在历史最前——
         他才知道你们刚见过面、在一处都发生了些什么（不然回到手机还当没见过）。
         挂最前、不贴在本轮前面：前缀在这一整段里才恒定，站的自动前缀缓存能连读。
         只给他读：不落库、不上屏、不进未读数。 */
      const offline = await getOfflineScene(character.id, maskId);
      const offlineMsg = offlineTranscript(offline.entries, charName, myName);
      if (offlineMsg) history = [offlineMsg, ...history];
      /* 这一轮开打之前，先把悬太久的钱按过期扫一遍（见 expireStaleMoney）：
         递给模型的旁白才会写着「已经过期」——不然他对着一条早该作废的钱
         还能回一句「我这就收下」，落不了账就成了嘴上说收、账上没动。
         新补的系统句一并落库、上屏。 */
      const swept = await expireStaleMoney(history, moneyExpiryLimitOf(memory), {
        characterId: character.id,
        maskId,
        charName,
        showToast,
      });
      const settledIds = new Set(
        swept.list.filter((y, i) => y !== history[i]).map((y) => y.id),
      );
      if (settledIds.size > 0 || swept.echoes.length > 0) {
        if (settledIds.size > 0) history = swept.list;
        setMessages((prev) => [
          ...prev.map((x) => {
            if (!settledIds.has(x.id)) return x;
            return swept.list.find((y) => y.id === x.id) ?? x;
          }),
          ...swept.echoes,
        ]);
      }
      setIsTyping(true);
      /* 提示出现即滚到底：别让「正在输入」藏在屏幕外，等回复时像没反应。 */
      scrollBottom();
      /* 停止按钮的中断源与全文缓冲：从「正在输入」出现那一刻起就能中断。 */
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamTextRef.current = "";
      /* 思考缓冲也归零：上一轮的思考绝不能串进这一轮（1.4.9）。 */
      reasoningRef.current = "";
      streamShownRef.current = 0;
      streamSettledRef.current = 0;
      streamTailRef.current = "";
      streamStampsRef.current = [];
      /* 上一轮若还留着没放出去的预览帧（异常中断），先丢掉再开局。 */
      streamPendingRef.current = null;
      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      setStreamShown(0);
      setStreamStamps([]);
      setFrozenTail(null);
      try {
        /* TA 手头有多少零钱（1.4.36）也一起取：他要在读人设之外知道「本钱」有多少，
           发红包／转账才不至于凭空乱写。只挂易变区一行（见 promptBuilder 的零钱行）。
           这里顺带保证他那本账**开过**——第一次跟他说话就按人设开户（她已经翻过他手机的话，
           这一步什么也不做、只是把余额读出来）。开户本身出岔子（写库失败）不该连累聊天：
           出错就当读不到余额，照常往下聊。 */
        const [books, prefs, taWallet] = await Promise.all([
          getWorldBooks(),
          getChatPrefs(),
          openContactAccountIfEmpty({ ownerId: character.id, profile: character.data })
            .then((r) => r.balance)
            .catch(() => getBalance(character.id, "contact")),
        ]);
        /* 气泡条数上限：**每聊天设定**（这个角色归这个角色，别的角色不受影响），
           没设过＝默认开、5 条。关了就是 0＝不限，提示词那句也不加，与从前逐字一致；
           流式预览与落库两趟都拿它收口，传的必须是同一个值。 */
        const bubbleCap = bubbleCapOf(conv);
        const built = buildPrompt({
          characterId: character.id,
          /* 他住的「世界」（档案分类）：世界书绑了世界时按它判命中
             （角色在档案里挪进挪出世界，下一轮自然跟着变，不用回来改绑定）。 */
          characterCategoryId: character.categoryId,
          profile: character.data,
          books,
          mode: "online",
          history,
          userInput: userText,
          userName: myName,
          userMask: mask,
          currentSignature: conv?.signature,
          /* 用户签名（「我」页面）：只挂易变区一行，TA 改不了它、只是看得见。 */
          userSignature,
          /* TA 的零钱：他自己发红包／转账的花销从这本账出（1.4.36）。 */
          walletBalance: taWallet,
          memoryBlock: memory ? await buildMemoryBlock(memory, myName) : "",
          /* 他自己记下的东西（1.9.0）：细处清单＋写过的那篇日记，随本轮递回去——
             他才知道自己记过什么，「记过的别再写」「并成一整篇」才落得下来。
             每轮都可能变，走易变区；没有账时整块不注入（见 chatApi 的 innerLedgerBlock）。 */
          ledgerBlock: innerLedgerBlock(history),
          excludeDialogue: true,
          /* 会话标识：概率条目的骰子结果按它固定，同一场对话里不每轮重掷。 */
          sessionKey: `${character.id}::${maskId}`,
          /* 时间感知：设置里的开关（见 getChatPrefs）。打开时把「此刻」挂在本轮尾巴上，
             分钟级、每轮都变，所以走易变区；关掉就整段不注入。 */
          timeAware: prefs.timeAware,
        });
        /* 能力标记：图文／语音 API 配好并启用，TA 才知道自己能发图／发语音。 */
        const canImage =
          !!effImageApi &&
          effImageApi.enabled &&
          effImageApi.baseUrl.trim() !== "" &&
          effImageApi.model.trim() !== "";
        const canVoice =
          !!effVoiceApi &&
          effVoiceApi.enabled &&
          effVoiceApi.baseUrl.trim() !== "" &&
          effVoiceApi.model.trim() !== "";
        /* 社交状态注入：拉黑期间 TA 知道自己被拉黑（看得见你、话却发不出去），
           说什么先看最近聊到哪；解除后改成被拉黑过的记忆。 */
        const socialPrompt = conv
          ? conv.blocked
            ? blockedNowPrompt()
            : (conv.blockCount ?? 0) > 0
              ? blockedMemoryPrompt(conv.blockCount ?? 1)
              : ""
          : "";
        /* AI 助手模式的联系人：正文与人设跟普通角色一样，只在末尾多一条
           【测试模式 · 绝对服从】（测试时指令绝对服从、不推脱）。 */
        /* 1.6.5：buildStylePrompt 拆成两段收（见 chatApi 那段说明）——
           head＝【心声】（输出格式）＋沉浸指令，摆在整个 system 最前；
           tail＝消息格式／富媒体／【行为守则】／测试模式，摆到稳定段末尾。
           从前它们是糊成一整段全摆最前，把「角色前」世界书挤到了后面。
           1.7.0 照参考项目 wechat.js 的 buildChatSystem 重排：【心声】提到第一块
           （它那边是【输出格式（最高优先级）】）、新开的【行为守则】压在末尾。 */
        /* 语音提示词生效值（1.9.58）：角色单独配了一份就用角色的（存在＝用角色的，
           不回落全局）；没配＝跟随全局设置（开关＋正文）。取到的正文非空才注入，
           空着传 null 保持稳定段逐字不变。 */
        const vpText =
          conv?.voicePromptOverride?.text ??
          (prefs.voicePromptOn ? prefs.voicePromptText : "");
        const voicePromptRule = vpText.trim() ? vpText : null;
        /* 外语聊天（1.9.81）：语音的双语格式要「用户提示词压不掉」，所以在 buildStylePrompt
           里就带上目标语言（见那边的 voiceLang 参数）。取在调用之前，下面两处都要用。 */
        const trOut = conv?.translate?.out;
        const trInnerOn = conv?.translate?.inner === true;
        const { head: stylePrompt, tail: styleRules } = buildStylePrompt(
          charName,
          myName,
          opts?.extraHint,
          canImage,
          canVoice,
          character.data.isAssistant === true,
          /* 气泡条数：**每聊天设定**（见 bubbleCapOf）。0＝不限，连提示词那句都不加，
             保持逐字不变；开了才告诉 TA 这一轮最多几条。 */
          bubbleCap > 0 ? bubbleCap : null,
          /* 人设原文（1.9.9）：【心声】里那句「你的人设：……」填的就是档案这一栏，
             让 TA 在最开头就被点名、照着人设走。空着时那一句自动只剩前半句。 */
          character.data.persona,
          /* 语音提示词（1.9.58；1.9.60 校准定位）：角色单独配了就用角色的，没配就跟随全局
             （设置里的开关＋正文）。管的是〔语音〕里那句台词怎么写，不是发语音的机制。
             开关开着且正文非空才注入；否则传 null，稳定区逐字不变（不吃缓存重建）。 */
          voicePromptRule,
          /* 语音的目标外语（1.9.81）：开着「他说的外语」＝传该语言，语音固定写成「原文|中文」，
             压过用户自定义的语音规矩，语音永远自带中文。 */
          trOut?.on ? trOut.lang : null,
        );
        /* system 只放稳定段（最前：【心声】＋沉浸指令 → 对方档案／常驻世界书／人设／
           记忆碎片 → 末尾：消息格式／富媒体／【行为守则】／测试模式）
           ——全部跨轮逐字不变，站子的前缀缓存才能连读。
           会变的一律排在断点之后：易变尾巴挂在**本轮 user 消息末尾**（见下面的 input），
           不进 system。前缀缓存是整条链的哈希——会变的东西留在断点之前，整块缓存每轮作废。
           记忆碎片从 user 尾部挪进稳定段：挂在尾部时，那条 user 下一轮
           回喂历史只剩光原话、字面对不上，站子从那条起整段作废（记忆块每轮白写两遍）。 */
        /* 外语聊天（1.9.48；1.9.50 扩到「他写下的字」）：他说话换一门语言——气泡正文、语音，
           连签名／心声／日记／环境／心情／欲望／怯念／细处都用这门语言写（这些她**点一下**看中文，
           见 transCache；不必自己附中文）。**中文标签与〔〕标记一律原样**——它们是解析的锚，
           动了就解析不出来；思考过程与动态（朋友圈）这一版仍写中文。
           钉在稳定段：它只在设置改动那一下才变，跟别的稳定内容一起吃前缀缓存。 */
        /* 1.9.80：不再事后发第二次翻译请求，改成让模型**一次就写两半**——
           每条消息写成「外文原文|简体中文」，解析层按竖线劈开（见 splitBilingual）。
           1.9.81：语音那半的固定格式移到 buildStylePrompt 的【发语音】一节（用户提示词
           压不掉），这里只管正文与 <think>。 */
        const langRule = trOut?.on
          ? `\n\n【说话的语言】你用${trOut.lang}说话。**你发出的每一条消息都写成两半：外文原文「|」简体中文**——先写这句话的${trOut.lang}原文，紧跟一根竖线「|」，再写这句话的简体中文；一条消息一行、成对出现，例如：こんにちは|你好。竖线两边都要写全，**缺了中文她会看不懂意思**。气泡正文照这个格式；〔语音〕里的话按【发语音】那节的固定格式写（一样是「原文|中文」，用户自定义的语音规矩也改不掉）。` +
            (trInnerOn
              ? `回复最前面那段 <think>…</think> 里也一样：**每一行都写成「原文|简体中文」两半**——心声、环境、心情、欲望、怯念、细处、日记，一行一对。`
              : `回复最前面那段 <think>…</think> 里的每一行（心声、环境、心情、欲望、怯念、细处、日记）仍只用${trOut.lang}写，不必附中文。`) +
            `\n但**中文标签**一律保持中文、一个字都不许翻：方括号里的标记（〔签名〕〔动态〕〔语音〕〔图片〕〔红包〕〔转账〕〔引用〕），以及 <think> 里那几行的冒号前缀（「环境：」「心情：」「欲望：」「怯念：」「细处：」「日记：」「角色心声：」）——它们是机器的锚，翻了整块就解析不出来；标签后面的**内容**照旧写成「${trOut.lang}|中文」两半。引用的原话是她说的中文，原样照抄、不要翻、也不要加竖线。动态（朋友圈）这一版仍写中文。`
          : "";
        const systemStable = stylePrompt + "\n\n" + built.stable + "\n\n" + styleRules + langRule;
        /* 拉黑状态是「会变的状态」（拉／解除各换一份），所以不占稳定段——走 system 的
           第二段 tail（缓存断点之后）：稳定段照旧逐字不变、缓存不受影响，
           状态说明又落在整条 system 的最末尾、离本轮对话最近，TA 更听得进去。 */
        const systemTail = socialPrompt;
        /* 易变尾巴（签名取值／当前状态／关键词世界书／对话后世界书）挂在本轮 user 消息末尾，
           不进 system——它每轮都会变，一进 system 就把断点之后的整段作废。
           1.5.95 校正：这里原写着「『当前状态』（分钟级时间）不再注入」，与代码不符——
           buildPrompt 的易变区一直带着它（`input.timeAware` 为真时，见 promptBuilder
           末尾那段）；ChatWindow 传的是设置里的「时间感知」开关，默认开。所以 TA 是看得见
           「现在是几点」的，1.5.95 起还看得见「距上一条消息已经过了多久」（见 idleGapLine）。 */
        /* 1.4.12：本轮要用的正则规则（每轮发送现取——设置里刚建／刚改的规则立刻生效）；
           顺手刷一遍显示缓存，旧消息的「仅显示」气泡也跟着换新规则。 */
        const rules = await loadRegexRules();
        setRegexRules(rules);
        /* 1.4.12 userInput 正则：我说的原话先过一遍规则再送模型（屏幕上与存档里
           仍是原文——apiText 记的就是改后的这份，回喂历史字面一致，缓存不断）。
           引用与易变尾巴不参与：规则只管「我说的话」。
           mediaOnly（发图片这类：消息本身就是内容、这一轮没有文字）时，本轮给模型的
           就是那句既定的回喂说明——跟回喂历史给图片消息的写法逐字一致（见 chatApi
           的 buildApiMessages），别让同一张图在两种场合被描述成两种样子。
           mediaText 是给收款码开的口子：码里装的东西（编号、收款人）模型光看图解不出来，
           就把「这张图里是什么」写成同一副括号里的话一起递过去——她看见的是图片气泡，
           TA 读到的仍是「（发来一张图片…）」，格式不变。 */
        const userTextForModel = opts?.mediaOnly
          ? (opts.mediaText ?? "（发来一张图片）")
          : applyRegexRules(userText, "userInput", regexCtx, rules);
        /* 刚在线下见过面（1.7.5）：离开线下场合后的**下一轮**要带一句说明——不然 TA
           回来还当隔着手机，会问「你怎么突然找我」这种话。挂在本轮 user 消息末尾（易变区，
           不进 system），用掉即清：只带这一轮，之后不再提。
           写下来的这一句会跟着 input 记进这条 user 的 apiText，回喂历史字面一致，缓存不断。 */
        const offlineNote = conv?.offlineReturnNote
          ? "【你们刚刚在线下见过面，就在她面前；这一轮回到手机上说话，别当作没见过、别问「你怎么突然找我」。】"
          : "";
        const input =
          (opts?.quote ? `【引用】${opts.quote}\n${userTextForModel}` : userTextForModel) +
          (offlineNote ? `\n\n${offlineNote}` : "") +
          (built.volatile ? `\n\n${built.volatile}` : "");
        /* 用掉即清：这一轮带上了，就把它落回 false——下一轮不再重复。
           （这里不走 applyPatch——它在下面才定义，deps 里引用会踩 TDZ；
           清一个布尔也不必惊动列表，直接落库改 conv 就够。） */
        if (conv?.offlineReturnNote) {
          void updateConversation(character.id, maskId, { offlineReturnNote: false })
            .then(setConv)
            .catch(() => {});
        }
        /* 三版本统一（发出去＝存下来＝回喂）：把「这一轮真正发出去的完整原文」记回
           那条 user 消息上。回喂历史时原样送回，站子逐字比对才不会从那条起整段作废
           重写（1.25×）——这就是「♻几乎不动、✎一直在涨」的成因。
           没带尾巴（input 与原文一致）时不写：那种消息走原有的回喂逻辑就字面一致。 */
        const curUser = [...history].reverse().find((m) => m.role === "user");
        if (curUser && input !== curUser.content && curUser.apiText !== input) {
          const patched = { ...curUser, apiText: input };
          void updateMessage(character.id, maskId, patched)
            .then(() => setMessages((prev) => prev.map((m) => (m.id === patched.id ? patched : m))))
            .catch(() => {
              /* 写不进去不影响本轮发送：下一轮这条对不上，最多多写一次缓存。 */
            });
        }
        /* 历史裁剪（「丙方案」，接替每轮滑窗）：平时一条不裁，
           攒到「浓缩门槛 ×2」才裁一次（裁到最近「浓缩门槛」条）——规则与理由
           见 memory.ts 的 trimHistory。记忆关闭时不裁：没有浓缩兜底，裁掉就是真丢。 */
        const baseHistory = trimHistory(history, memory);
        // 请求会把本轮 userInput 单独追加进 messages；传入的历史须不含它，
        // 否则同一条用户消息会在 messages 里重复出现（历史尾条即刚发的 user）。
        const apiHistory =
          baseHistory.length > 0 && baseHistory[baseHistory.length - 1].role === "user"
            ? baseHistory.slice(0, -1)
            : baseHistory;
        /* 流式开关在「文本 API」里配置：关掉就直接走非流式，
           省掉一次注定白跑的流式请求（中转站按次计费时尤其值得）。 */
        const useStream = effTextApi.stream !== false;
        /* 本轮附图（1.4.23）：只在「我这一轮刚发了图」时带，取**末尾连着的一串我发的
           消息**里最后一张。为什么只认这一串：图上配字时是「图 + 字」两条一起发出去的
           （见 sendPickedImage），两条都算这一轮；再往前就是上一轮的图了——图是按尺寸
           算 token 的，一路带着等于每轮把钱重烧一遍，绝不能带。
           压成给模型看的小图（768／0.7，见 media-asset）：压不出来／读不回来＝undefined，
           照旧走「（发来一张图片）」那条老路，这一轮 TA 看不见图而已，聊天不断。
           另一条来源：调用方递进来的那张（opts.visionImage，见发红包带自定义封面那处），
           它已经在外头取好，直接就用，不再回溯。 */
        let visionImage = opts?.visionImage;
        if (!visionImage) {
          for (let i = history.length - 1; i >= 0 && history[i].role === "user"; i--) {
            if (history[i].type !== "image") continue;
            visionImage = await mediaRefToVisionDataUrl(history[i].imageUrl);
            break;
          }
        }
        /* 第三条来源：自定义封面的红包。那张图挂在红包消息的 redCover 上、**不是一条
           image 消息**，上面那圈回溯永远找不到它——发红包那一轮是靠调用方递进来的
           （opts.visionImage），发完接着往下聊就没有了。可回喂历史里那句只说「封面是
           一张自己换的图」，他答不上图里是什么（刚看见、一转头就不知道，她也觉得怪）。
           所以那条红包还在最近这几条里时，把封面图继续带上；滑出这段距离就不再带
           （图按尺寸算 token，绝不能一路重烧，见 COVER_VISION_RECENT）。 */
        if (!visionImage) {
          const recent = history.slice(-COVER_VISION_RECENT);
          for (let i = recent.length - 1; i >= 0; i--) {
            const m = recent[i];
            const cover = m.redCover ?? "";
            if (m.role !== "user" || !isCustomRedCover(cover)) continue;
            /* 递过去的是那张**图**：挪过位置的封面尾巴上带着取景后缀，读仓库前先剥掉。 */
            visionImage = await mediaRefToVisionDataUrl(redCoverRefOf(cover));
            break;
          }
        }
        /* 「查看本轮请求」留档（1.7.49）：把这一轮真发出去的东西记一份。
           full 走 chatApi 的 outgoingContents——与真请求同一份组装逻辑，逐字一致。 */
        recordRequest({
          mode: "online",
          model: effTextApi.model,
          stream: useStream,
          sections: built.sections,
          activated: built.activatedEntries.map((a) => ({
            book: a.book,
            title: a.entry.title,
            by: a.by,
          })),
          full: outgoingContents({ stable: systemStable, tail: systemTail }, apiHistory, input),
        });
        let reply = "";
        let stopped = false;
        let streamed = false;
        /* 双语模式总闸（1.9.80）：他说的外语这一侧开着＝回复按「原文|译文」成对解析；
           innerBilingual 再叠加「心声页双语」那一格（<think> 各行也成对写）。 */
        const pairMode = conv?.translate?.out.on === true;
        const innerBilingual = pairMode && conv?.translate?.inner === true;
        /* 流式增量回调抽成具名函数：站点回绝带图时我们要**摘图重发一次**，
           重发必须走同一份回调，否则第二次的内容不会上屏。 */
        const onStreamDelta = (full: string) => {
          /* 边收边把「到目前为止的全文」拆成已定型气泡＋尾巴，直接贴着输入区显示。 */
          streamTextRef.current = full;
          /* 先把〔图片〕〔语音〕这类标记剥掉再拆条：不然它们会以纯文本先长在
             屏幕上，等落库时整段消失换成真图片，看着像「先发一堆文字再重整」。 */
          const preview = stripMetaMarkersForPreview(full, pairMode);
          if (full) {
            streamed = true;
          }
          const prevSettled = streamSettledRef.current;
          const next = splitReplyStream(preview, bubbleCap, pairMode);
          streamSettledRef.current = next.settled.length;
          if (streamShownRef.current >= next.settled.length) {
            /* 节拍器追平了：尾巴正长在屏幕上，记下它；冻住的旧尾巴可以撤了。 */
            streamTailRef.current = next.tail;
            /* 尾巴也是屏幕上的一条气泡：它一露面就得带上自己的时刻。 */
            if (next.tail) stampBubble(next.settled.length);
            setFrozenTail(null);
          } else if (next.settled.length > prevSettled) {
            /* 空行刚把尾巴转正成定型气泡，节拍器还没把它放出来：
               先把上一帧那段字冻在原地顶上，免得屏幕上整段消失再重画。 */
            setFrozenTail(
              (prev) => prev ?? { at: streamShownRef.current, text: streamTailRef.current },
            );
          }
          /* 分片只塞进合批箱，不再一帧一帧地重渲染整棵组件。 */
          queueStreamPreview(next);
        };
        /* 发一轮请求（带图／不带图共用这一份）。 */
        const runFetch = (image: string | undefined) =>
          useStream
            ? fetchAIStreamReply(
                effTextApi,
                { stable: systemStable, tail: systemTail },
                apiHistory,
                input,
                onStreamDelta,
                {
                  signal: controller.signal,
                  /* 思考过程边到边记（1.4.9）：思考型模型先吐思考后吐正文，这段照收照存。 */
                  onReasoning: (r) => {
                    reasoningRef.current = r;
                  },
                  userImage: image,
                },
              )
            : /* 中间三个 undefined 走默认值（历史不限条数／maxTokens／temperature），
                 只为把 signal 递进去；再往后把思考过程接住（1.4.9，非流式一次整段到）。 */
              fetchAIReply(
                effTextApi,
                { stable: systemStable, tail: systemTail },
                apiHistory,
                input,
                undefined,
                undefined,
                undefined,
                controller.signal,
                (r) => {
                  reasoningRef.current = r;
                },
                image,
              );
        try {
          try {
            reply = await runFetch(visionImage);
          } catch (err) {
            /* 站点不吃「带图」这种写法时给的是 4xx 回绝：这一笔连活都没干、没花钱，
               所以允许摘掉图重发一次，退回「（发来一张图片）」那条老路，聊天不断。
               其余失败（超时／断线／5xx／用户按了停止）一律不重发——那些可能已经计费了。 */
            const detail = err instanceof Error ? err.message : String(err);
            if (!visionImage || !isRejectedBeforeWork(detail)) throw err;
            reply = await runFetch(undefined);
          }
        } catch (err) {
          /* 用户按了停止：不算失败——已经说出口的话照样落库，配图／动态／记忆一律不做。 */
          if (err instanceof Error && err.message === "已停止生成") {
            stopped = true;
            reply = streamTextRef.current;
          } else {
            throw err;
          }
        }
        /* 拒答兜底（1.7.4，恩熙选的 A 方案）：模型没报错，但张嘴就是「抱歉，我不能…」——
           这不是 TA 说的话，是生成失败的另一种长相。**绝不能当成 TA 的消息落库**：
           一旦落进去，下一轮回喂就带着「我刚拒绝过」，此后不论怎么重发、怎么删最后一条，
           送上去的都是同一段历史、同一个结果（雪球越滚越死）。
           所以当本轮失败处理，走下面那条可重试的系统提示。
           判之前先剥掉最前面的 <think> 心声——心声挡在开头就判不出来；
           半途停止的那一轮不判：截断的半句话不是拒答。 */
        if (!stopped) {
          const forJudge = reply.replace(
            /^\s*<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/i,
            "",
          );
          if (isChatRefusal(forJudge)) {
            const refused = new Error("模型拒答");
            refused.name = "RefusalError";
            throw refused;
          }
        }
        /* 1.4.9 思维链把关：挂不挂在这判——「正文空、思考兜底当正文」的那一轮
           （chatApi 的兜底路径），reasoningRef 和 reply 一模一样，那是正文不是思考，
           挂上去就是同一段字两头重复。其余情况（正文非空＋独立思考）照挂；
           半途停止也保留已收到的思考（能看到它当时想到哪）。 */
        const reasoningClean = reasoningRef.current.trim();
        const reasoningFinal =
          reasoningClean && reasoningClean !== reply.trim() ? reasoningRef.current : undefined;
        /* 1.4.12 aiOutput 正则：TA 的回复在剥标记、落库之前过一遍规则——存下来的
           就是干净的，翻旧记录也干净。流式期间屏幕上可能先闪过原文、落库那刻换成
           替换后的，属预期（正则在半截文字上跑不可靠，只能整段收完再改）。 */
        reply = applyRegexRules(reply, "aiOutput", regexCtx, rules);
        /* 1.5.60 心声：TA 每轮最前面那段 <think>…</think> 在这儿先摘下来（摘在
           末尾标记之前：心声里的字不该被当成〔图片〕那类标记顺走），
           摘完的正文再往下走标记与拆条，一个字都不受影响。
           1.7.92：八根拆掉后这份底只为一件东西——**穿着**（人不会一条消息换一套衣服，
           这一轮没写就沿用上一次，见 parseInnerSnapshot／lastInnerSnapshot）。 */
        const voice = extractInnerVoice(reply, lastInnerSnapshot(messages)?.snapshot, innerBilingual);
        // 先剥掉末尾的〔签名〕／〔动态〕／〔图片〕／〔语音〕标记（气泡里永远看不到），再拆条连发。
        const extracted = extractMetaMarkers(voice.clean, charName);
        /* 与上面的流式预览传同一个上限：预览转正时条数一致，不会突然合并或裂开。 */
        /* 1.5.47 TA 引用回复：拆完条再摘〔引用:原话〕——标记跟着某一条走，摘到谁头上
           就贴到谁的气泡上方。库里存「我：原话」（跟 quoteMsg 一个写法），
           气泡那侧照旧按「对面那个名字」把前缀摘掉显示。 */
        const rawParts = splitReply(extracted.clean, bubbleCap, pairMode);
        const { parts: pairedParts, quotes } = extractBubbleQuotes(rawParts);
        /* 双语劈分（1.9.80）：一条「原文|译文」里，左半边进气泡（content／TTS 都读它），
           右半边进译文行。漏写竖线的那条 inlineTrans 为 undefined，交给副接口兜底。 */
        const parts = pairMode ? pairedParts.map((p) => splitBilingual(p).src) : pairedParts;
        const inlineTrans = pairMode ? pairedParts.map((p) => splitBilingual(p).zh) : [];
        /* 半途停止只留正文；标记类内容（签名／动态／配图／语音）不处理。 */
        const signature = stopped ? undefined : extracted.signature;
        const moments = stopped ? [] : extracted.moments;
        const images = stopped ? [] : extracted.images;
        const imageRefs = stopped ? [] : extracted.imageRefs;
        const imageRefMarks = stopped ? [] : extracted.imageRefMarks;
        const voices = stopped ? [] : extracted.voices;
        /* TA 自己发的红包／转账（1.4.36）：跟签名／图片一样，半途停止就不作数——
           他那句话都没说完，钱当然也不该划出去。 */
        const moneys = stopped ? [] : extracted.moneys;
        /* 1.7.96：原来这儿还多一步 settleWish——给快照补上「最想做的事做成没有」，
           供念头池判断。账里「最想做的事」这一栏撤掉之后（恩熙：我们没有这个栏目），
           这一步与念头池一并删掉，解析出来的快照直接用。 */
        const snapshotNow = voice.snapshot;
        /* TA 这一轮要落的每一条都从这儿走，落一条就办两件事：
           ① 「人不在这一间屋子」时把列表未读 +1——退到列表去干别的事，TA 说话了，
              那一行得亮起红点。**一条算一条**：TA 一口气说三段，红点就是 3——
              跟微信一样数的是「没读到的消息有几条」。
              未读跟着消息写在同一笔里，不会跟别的写入互相覆盖。
           ② **落一条就刷一遍列表**——TA 说到第几句，列表那一行的预览／时间就跟到第几句，
              不是等一整轮说完才「啪」地跳到最末一句。 */
        const persistFromChar = async (m: ChatMessage) => {
          const conv = await appendMessage(character.id, maskId, m, {
            bumpUnread: !visibleRef.current,
          });
          onDataChange();
          return conv;
        };
        /* 外语聊天（1.9.48；1.9.80 改双主打）：他说的外语 → 中文，逐条翻好挂到译文行上。
           译文**优先用模型自己写的那半**（inlineTrans，随回复一次到齐）；只有哪一条漏写了
           竖线，才用（副）翻译接口兜底补翻那一条——接口抽风最多让那一条没译文，不再全场空白。
           只翻**说出口的话**（气泡正文），签名／心声／思考／动态一概不碰；半途停止不翻。 */
        const trSetNow = conv?.translate;
        const wantTrans = trSetNow?.out.on === true && !stopped && parts.length > 0;
        const partTrans: (string | undefined)[] = wantTrans
          ? await Promise.all(
              parts.map(
                async (p, i) => inlineTrans[i] ?? (await translateWithRetry(translateApi, p, "中文")),
              ),
            )
          : [];
        if (streamed && !stopped) {
          /* 等节拍器把攒下的气泡放完再落库：预览一撤、真消息整批冒出来，反而跳得更狠。
             停止时不等待——用户要的是立刻停手。 */
          const backlog = streamSettledRef.current - streamShownRef.current;
          if (backlog > 0) await delay(backlog * STREAM_REVEAL_INTERVAL_MS + 120);
        }
        if (streamed && parts.length > 0) {
          /* 流式已经逐条长在屏幕上了：一次性落库并撤掉预览——同一帧内完成，
             且真气泡与预览气泡同款，视觉上没有任何跳变，只是「转正」。 */
          const fresh: ChatMessage[] = parts.map((text, i) => ({
            id: uuid(),
            role: "assistant",
            type: "text",
            content: text,
            /* 沿用该条气泡上屏时就显示的时刻：转正前后时间一模一样，不会突然跳出来。 */
            createdAt: streamStampsRef.current[i] ?? new Date().toISOString(),
            isRead: true,
            ...(quotes[i] ? { quote: `${myName}：${quotes[i]}` } : {}),
            ...(partTrans[i] ? { translated: partTrans[i] } : {}),
            /* 心声与内心快照都只在第一条上挂（1.5.60／1.5.65），理由同思考：一轮只有一个。
               1.5.98 起挂的是 settleWish 收过口的那份（1.7.92 起只有「这件事做成没有」这一格）。 */
            ...(i === 0 && voice.innerVoice ? { innerVoice: voice.innerVoice } : {}),
            ...(i === 0 && snapshotNow ? { innerSnapshot: snapshotNow } : {}),
          }));
          /* 思考挂在本轮第一条 TA 气泡上（1.4.9）：一轮回复拆成几条气泡，思考只有一个。 */
          if (reasoningFinal && fresh.length > 0) fresh[0].reasoningText = reasoningFinal;
          for (const msg of fresh) await persistFromChar(msg);
          setMessages((prev) => [...prev, ...fresh]);
          clearStreamPreview();
        } else {
          clearStreamPreview();
          // 「正在输入」保持到文字＋图片＋语音全部发完才消失：
          // 语音／图片生成耗时数秒，提前关掉会让画面陷入「什么都没有」的死空气。
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) await delay(STREAM_REVEAL_INTERVAL_MS);
            const msg: ChatMessage = {
              id: uuid(),
              role: "assistant",
              type: "text",
              content: parts[i],
              createdAt: new Date().toISOString(),
              isRead: true,
              ...(quotes[i] ? { quote: `${myName}：${quotes[i]}` } : {}),
              ...(partTrans[i] ? { translated: partTrans[i] } : {}),
              /* 心声与思考都只在第一条上挂（1.5.60／1.4.9），理由同流式那条分支。
                 1.5.98 起快照挂的是 settleWish 收过口的那份（1.7.92 起只有「这件事做成没有」这一格）。 */
              ...(i === 0 && voice.innerVoice ? { innerVoice: voice.innerVoice } : {}),
              ...(i === 0 && snapshotNow ? { innerSnapshot: snapshotNow } : {}),
              /* 思考只在第一条上挂（1.4.9），理由同流式那条分支。 */
              ...(i === 0 && reasoningFinal ? { reasoningText: reasoningFinal } : {}),
            };
            await persistFromChar(msg);
            pushLocal(msg);
          }
        }
        /* 心声页双语（1.9.80）：这一轮模型把 <think> 各行也写成了「原文|中文」，右半边
           收进会话的译文缓存——心声页里 useTrans(源文) 直接命中，**点开即显中文、零等待**。
           键＝解析时洗净的源文（与 InnerVoicePage 取键同一份写法），保证对得上。
           这里用 conv.transCache 作底、不用 transCacheRef：后者定义在本函数之后（TDZ）。 */
        if (innerBilingual && !stopped && Object.keys(voice.pairs).length > 0) {
          const mergedCache = { ...(conv?.transCache ?? {}), ...voice.pairs };
          void updateConversation(character.id, maskId, { transCache: mergedCache })
            .then(setConv)
            .catch(() => {
              /* 写不进去不影响这一轮聊天：下一次点心声页再走 translateCached 补翻。 */
            });
        }
        /* TA 附带的签名更新／新动态落库（资料页展示）。接住这一趟新落的动态：
           配图要按它们的内部 id 回写，而 id 只有 appendMetaUpdates 知道。 */
        let freshMoments: ChatMoment[] = [];
        if (signature || moments.length > 0) {
          freshMoments = await appendMetaUpdates(character.id, maskId, {
            signature: signature ?? undefined,
            moments,
          });
          /* 落库了就立刻让上层重读。整轮只在一头一尾刷（见下面自动生图之后的
             onDataChange）时：动态是写进库了，可 ChatApp 手上那份 conversations 还是
             旧的，这段时间切进朋友圈**连这条动态都没有**——「正在生成配图」当然无从显示，
             看着就像生成停住了。刷这一下，动态立刻上墙，配图那格该转圈就转圈。 */
          onDataChange();
          setConv((prev) =>
            prev
              ? {
                  ...prev,
                  ...(signature ? { signature } : {}),
                  ...(moments.length > 0
                    ? {
                        moments: [
                          ...(prev.moments ?? []),
                          ...moments.map((m) => ({
                            id: uuid(),
                            content: m.content,
                            createdAt: new Date().toISOString(),
                            ...(m.imagePrompt ? { imagePrompt: m.imagePrompt } : {}),
                          })),
                        ],
                      }
                    : {}),
                }
              : prev,
          );
        }
        /* TA 发了标记但对应 API 没启用：给出系统提示，绝不无声吞掉（「发了却看不到」）。 */
        if (images.length > 0 && !canImage) {
          const notice: ChatMessage = {
            id: uuid(),
            role: "system",
            type: "system",
            content: "TA 想给你发图片，但图文 API 未启用，图片没有发出来",
            createdAt: new Date().toISOString(),
            isRead: true,
          };
          await appendMessage(character.id, maskId, notice);
          pushLocal(notice);
        }
        if (voices.length > 0 && !canVoice) {
          const notice: ChatMessage = {
            id: uuid(),
            role: "system",
            type: "system",
            content: "TA 想给你发语音，但语音 API 未启用，语音没有发出来",
            createdAt: new Date().toISOString(),
            isRead: true,
          };
          await appendMessage(character.id, maskId, notice);
          pushLocal(notice);
        }
        /* TA 要发的图片：先弹占位框（带画面描述），生成完成后原位填入真图（失败可点击重试）。
           **条数不设上限**——恩熙 2026-09-22 定：TA 心情好可以一次发两张，
           发几张由它按人设自己判断；提示词侧（chatApi 的 buildStylePrompt）同步放开了
           数量限制，所以这里按标记逐条建占位，写了几条就画几张（顺序执行，
           一条失败不拖累后面的）。 */
        const imagePlaceholders: ChatMessage[] = [];
        if (images.length > 0 && effImageApi && imageExtras && canImage) {
          for (let i = 0; i < images.length; i++) {
            const desc = images[i];
            /* 「自动生成」关着（设置 → API 设定 → 图文）：这一轮不碰生图接口、不花钱，
               占位框只留一颗「生成」等你点（见 renderBody）。开着就照常自动生成。 */
            const waitForMe = !prefs.autoGenerateImage;
            const placeholder: ChatMessage = {
              id: uuid(),
              role: "assistant",
              type: "image",
              content: desc,
              /* 记下 TA 声明的锁脸开关：生成与重试都按它决定带不带参考图。
                 `refMark` 另存它**到底写没写**——诊断面板要说得出「是它写的」还是「我们猜的」。 */
              useCharRef: imageRefs[i] ?? guessUseCharRef(desc, charName),
              refMark: imageRefMarks[i],
              pending: true,
              awaitGen: waitForMe || undefined,
              createdAt: new Date().toISOString(),
              isRead: true,
            };
            await persistFromChar(placeholder);
            pushLocal(placeholder);
            imagePlaceholders.push(placeholder);
          }
        }
        /* TA 要发的语音：先弹占位气泡，合成完成后填充（失败可点击重试）。
           条数**不设上限**（同上面图片那条）：它想连着发三条就发三条。 */
        const voicePlaceholders: ChatMessage[] = [];
        if (voices.length > 0 && effVoiceApi && effVoiceExtras && canVoice) {
          /* 外语聊天（1.9.48；1.9.80 改双主打）：语音跟气泡正文同一门语言，照样挂一行中文译文。
             台词本身也是「原文|中文」：**TTS 只念左半边原文**，右半边进译文行；
             漏写竖线的那条才用（副）接口兜底补翻。 */
          const voicePairs = pairMode ? voices.map((v) => splitBilingual(v)) : [];
          const voiceTrans =
            trSetNow?.out.on === true && !stopped
              ? await Promise.all(
                  voices.map(
                    async (v, i) =>
                      voicePairs[i]?.zh ?? (await translateWithRetry(translateApi, v, "中文")),
                  ),
                )
              : [];
          for (let vi = 0; vi < voices.length; vi++) {
            const text = voicePairs[vi]?.src || voices[vi];
            const placeholder: ChatMessage = {
              id: uuid(),
              role: "assistant",
              type: "voice",
              content: text,
              pending: true,
              duration: Math.max(1, Math.round(text.length / 3.5)),
              ...(voiceTrans[vi] ? { translated: voiceTrans[vi] } : {}),
              createdAt: new Date().toISOString(),
              isRead: true,
            };
            await persistFromChar(placeholder);
            pushLocal(placeholder);
            voicePlaceholders.push(placeholder);
          }
        }
        /* TA 自己发的红包／转账（1.4.36）：他手上那本账是真的，掏钱也得是真的。
           够，就落一条真的红包／转账气泡（金额与留言都在气泡上，我点开能收下）；
           不够，就落一条系统提示——**绝不落假气泡**：气泡里写着 520、他账上一分没少，
           恩熙翻他手机一对就穿帮，比没发还糟。一轮可能写了好几笔，逐笔串行：
           后一笔看的是前一笔扣完之后的余额。 */
        if (moneys.length > 0) {
          for (const m of moneys) {
            const label = m.type === "redpacket" ? "红包" : "转账";
            /* 红包封顶跟「我发红包」那一页是**同一个数**（RED_PACKET_MAX_CENTS）。
               上游那套解析只认一条「20 万」的通用上限、不分红包还是转账，所以这一侧
               原先能冒出四位数的大红包——上限得在这儿按类型补判。
               判在「够不够」之前：他兜里钱本来就不够时，该先报「红包最多 1000」这句
               真正的原因。超了就**不落气泡、只落一句系统提示**，跟「零钱不够」同款
               ——绝不把金额改小了偷偷发出去（气泡里的数得跟他嘴里说的一致）。 */
            if (m.type === "redpacket" && m.cents > RED_PACKET_MAX_CENTS) {
              const notice: ChatMessage = {
                id: uuid(),
                role: "system",
                type: "system",
                content: `TA 想给你发红包，可红包最多 ${(RED_PACKET_MAX_CENTS / 100).toFixed(2)}，这笔没有发出来`,
                createdAt: new Date().toISOString(),
                isRead: true,
              };
              await persistFromChar(notice);
              pushLocal(notice);
              continue;
            }
            /* 余额现读（不拿开局那份）：一轮里连着发两笔时，第二笔得按扣完的账判。 */
            const left = await getBalance(character.id, "contact");
            if (left < m.cents) {
              const notice: ChatMessage = {
                id: uuid(),
                role: "system",
                type: "system",
                content: `TA 想给你发${label}，可他零钱不够，这笔钱没有发出来`,
                createdAt: new Date().toISOString(),
                isRead: true,
              };
              await persistFromChar(notice);
              pushLocal(notice);
              continue;
            }
            try {
              await adjustBalance(
                character.id,
                "contact",
                -m.cents,
                `发${label}给${myName}`,
                m.note,
              );
            } catch {
              /* 钱没扣成，这条气泡就不能落：落了就是他凭空变出来的钱。 */
              const notice: ChatMessage = {
                id: uuid(),
                role: "system",
                type: "system",
                content: `TA 想给你发${label}，钱没划出来，这笔没有发成`,
                createdAt: new Date().toISOString(),
                isRead: true,
              };
              await persistFromChar(notice);
              pushLocal(notice);
              continue;
            }
            const msg: ChatMessage = {
              id: uuid(),
              role: "assistant",
              type: m.type,
              content: m.note,
              /* 气泡里显示的是**元**（跟 doSendMoney 一个口径）。 */
              amount: Number((m.cents / 100).toFixed(2)),
              createdAt: new Date().toISOString(),
              isRead: true,
            };
            await persistFromChar(msg);
            pushLocal(msg);
          }
        }
        /* 我发出去、还悬着等他表态的钱，按**类型**各找各的最近一笔：〔收下〕＝收转账、
           〔领取〕＝领红包（1.5.14 拆开——原先两种标记在系统眼里是同一个信号，
           多笔悬着时谁排最后就落到谁头上，出现过「他嘴上说收转账、标记落到红包上」的错位）。
           转账写了〔退还〕就原路退回；**什么都没写＝没表态**，钱继续悬着，直到走过
           上下文那么多条才过期（见 expireStaleMoney）。`stopped`（我按了停）不算表态——留给下一轮。
           同类型多笔悬着时认最近那一笔；对应类型没有悬着的就**不动账**——他多半是在
           说嘴（那笔可能早收过了），不能替他把没指到的钱收了。 */
        const pendingOf = (kind: "transfer" | "redpacket") =>
          [...history]
            .reverse()
            .find(
              (x) =>
                x.role === "user" &&
                x.type === kind &&
                x.moneyClaimed !== true &&
                x.moneyRefunded !== true &&
                x.moneyExpired !== true,
            );
        let settledAny = false;
        if (!stopped) {
          /* 两个词都写了就各落各的（想两笔都收＝一轮一个词，见提示词）。 */
          if (extracted.claimedRedpacket) {
            const p = pendingOf("redpacket");
            if (p) {
              await markContactReceived(p);
              settledAny = true;
            }
          }
          if (extracted.claimedTransfer) {
            const p = pendingOf("transfer");
            if (p) {
              await markContactReceived(p);
              settledAny = true;
            }
          }
          if (extracted.refunded && !extracted.claimedTransfer) {
            /* 〔收下〕优先于〔退还〕：两样都写了时以「要」为准（钱进了他账才是他真收下）；
               红包没有「退还」这一说——他万一写了也不当落定，钱照旧挂着等〔领取〕或者过期。 */
            const p = pendingOf("transfer");
            if (p) {
              await settleContactRefund(p);
              settledAny = true;
            }
          }
        }
        /* 整轮什么都没产出（模型只发了标记／空回复）：兜底一条省略号，别让画面干等。 */
        if (
          parts.length === 0 &&
          images.length === 0 &&
          voices.length === 0 &&
          moneys.length === 0 &&
          !settledAny &&
          !stopped
        ) {
          const msg: ChatMessage = {
            id: uuid(),
            role: "assistant",
            type: "text",
            content: "……",
            createdAt: new Date().toISOString(),
            isRead: true,
          };
          await persistFromChar(msg);
          pushLocal(msg);
        }
        /* 占位气泡一出现就结束「正在输入」：生成在后台继续，占位框自己表达等待。 */
        setIsTyping(false);
        /* 媒体生成（顺序执行；占位已上屏，慢慢来不挡聊天）。
           一条失败不能拖累后面的：每条各自 try/catch，任一条抛错也不中断整轮。 */
        for (const p of imagePlaceholders) {
          /* 等用户自己点「生成」的那张：跳过，别替用户花这笔钱。 */
          if (p.awaitGen) continue;
          try {
            await regenerateMedia(p);
          } catch {
            /* 内部已经给过提示 */
          }
        }
        for (const p of voicePlaceholders) {
          try {
            await regenerateMedia(p);
          } catch {
            /* 内部已经给过提示 */
          }
        }
        /* 动态配图：「自动生图」开着时，TA 刚发的那几条带画面描述的动态顺手画掉，
           用户进朋友圈看到的已经是图、没有按钮；关着就一个接口都不碰，留着描述等
           用户在朋友圈页面点「生成配图」（点了先摊描述卡，见 MomentsPage）。
           画失败不弹系统提示：那条动态还挂着「生成配图」按钮，在动态页能再点一次，
           跟聊天里那张图的失败处理一样不吵。 */
        if (prefs.autoGenerateImage && canImage && freshMoments.length > 0) {
          for (const m of freshMoments) {
            if (!m.imagePrompt) continue;
            try {
              await generateMomentImage(convId(character.id, maskId), m.id, m.imagePrompt);
              window.dispatchEvent(new CustomEvent("moments-updated"));
            } catch {
              /* 留着按钮，在朋友圈页面自己重试 */
            }
          }
        }
        /* 类人记忆：本轮 user＋assistant 消息计数（连续发送可能一次补好几条用户消息）；
           达标后台总结（不挡聊天）。
           线下那一场**不再并进这一趟**（1.7.46）：见面自有一条记忆线，由线下那趟按「几轮」
           自己归总（见 maybeRunOfflineCondense）——两边各数各的账，同一段见面不会被归总两遍。 */
        let sentByMe = 0;
        for (let i = history.length - 1; i >= 0 && history[i].role === "user"; i--) sentByMe++;
        const addedMsgs = Math.max(1, sentByMe) + parts.length;
        void (async () => {
          try {
            await bumpMemoryCount(character.id, maskId, addedMsgs);
            const latest = await getOrCreateConversation(character.id, maskId);
            const result = await maybeRunMemoryPipeline(
              {
                characterId: character.id,
                maskId,
                messages: latest.messages,
              },
              charName,
              myName,
              effTextApi,
            );
            if (result.ran) setMemory(await getMemory(character.id, maskId));
          } catch (err) {
            console.warn("[Memory] 后台总结异常：", err);
          }
        })();
      } catch (err) {
        setIsTyping(false);
        clearStreamPreview();
        /* 本机没写进去（IndexedDB 事务被中止）跟接口调不通是两回事，提示不能长一样——
           一律报「API调用失败，去检查 API 设定」会把存储故障也赖到接口头上。 */
        const detail = err instanceof Error ? err.message : String(err);
        const localDbFailed = err instanceof Error && err.name === "LocalDatabaseError";
        /* 拒答（见上面「拒答兜底」那段）走的是失败这条路，但文案不能说「API 调用失败」——
           接口是通的，是它不肯说。 */
        const refused = err instanceof Error && err.name === "RefusalError";
        /* 真实原因连同「这一轮究竟走的哪个地址／哪个模型」一起记下：角色单独配过 API 覆盖时，
           聊天走的路和「设置」里点测试的那条**不是同一条**——只报一句「API 调用失败」，
           永远看不出是哪条路出的事（测试通过但聊天发不出去）。 */
        const via = `${effTextApi.baseUrl.trim() || "（地址空）"} · ${effTextApi.model.trim() || "（模型空）"}`;
        const viaNote = conv?.apiOverrides?.text ? "角色单独配置" : "全局配置";
        /* 走系统提示（居中的细线字）而**不是 TA 的气泡**：项目里对模型的五个出口
           （回喂历史／对话记录块／记忆浓缩／滑窗计数／社交取近文本）清一色只挡住
           role !== "system"，失败提示挂在 assistant 上就一路漏进上下文，最后还会被
           浓缩成长期记忆——TA 会真的「记得」自己调用失败过。
           retryable＝提示下多一个「重新生成」，点它先把这条提示抹掉再重跑一轮。 */
        const msg: ChatMessage = {
          id: uuid(),
          role: "system",
          type: "system",
          content: refused
            ? "这一轮 TA 没回话——内容被挡下了，没有存进聊天记录。点下面的「重新生成」再试一次；还不行就：把上一条说得含蓄些，或者删掉最近几条、发句日常的重新起势。"
            : localDbFailed
              ? "本机存储出错：这一轮没能写进本机数据库，再试一次通常就好。"
              : "API 调用失败：请到主屏幕「设置」App 的「API 设定」里检查接口配置，或稍后再试。",
          createdAt: new Date().toISOString(),
          isRead: true,
          retryable: true,
          /* 原文留在资料里备查：上面那句是缩过的，出错细节（超时／CORS／401）还得看原文。
             后面那行补上「走的是哪条路」，用来分辨是角色覆盖还是全局设定出的事。 */
          errorText: localDbFailed ? detail : `${detail}\n（${viaNote}：${via}）`,
        };
        await appendMessage(character.id, maskId, msg);
        pushLocal(msg);
      } finally {
        /* 本轮结束：丢掉中断源（停止按钮随即变回发送键）。 */
        streamAbortRef.current = null;
      }
      onDataChange();
    },
    [messages, effTextApi, translateApi, character, myName, charName, mask, maskId, conv, pushLocal, scrollBottom, regenerateMedia, onDataChange, effImageApi, imageExtras, effVoiceApi, effVoiceExtras, memory, stampBubble, userSignature, queueStreamPreview, clearStreamPreview, regexCtx, markContactReceived, settleContactRefund, showToast, recordRequest],
  );

  /* ---------- 发送 ---------- */
  const sendMsg = useCallback(() => {
    /* 草稿是**非受控**的（性能优化）：字就存在 DOM 里，不再每按一个键 setState。
       受控写法下打字每一下都重渲染整棵 ChatWindow（含整段消息列表重建），会话越长越卡——
       而这个值只有这里读、只有这里清，直接读 DOM 最省，行为一模一样。 */
    const el = inputRef.current;
    const text = (el?.value ?? "").trim();
    /* 设定没读完不发（见上面「载入会话」）：第一轮必须带着正确的发图／发语音能力走，
       否则短版提示词会被写进缓存，之后每一轮的前缀都对不上。 */
    if (!text || isTyping || !loaded) return;
    /* 外语聊天（1.9.48）：我打中文，**发出去之前**先翻成他那边的话——
       气泡里显示外语、下面挂回我这句中文本意，两边对得上。
       翻不过去就照中文发：他本来就懂中文，宁可按原话说，也别把这条卡死。 */
    const trSet = conv?.translate;
    const needIn = trSet?.in.on === true;
    const apiReady =
      translateApi.enabled && translateApi.baseUrl.trim() !== "" && translateApi.model.trim() !== "";
    void (async () => {
      let outText = text;
      let translated: string | undefined;
      if (needIn && apiReady) {
        setTranslatingMy(true);
        try {
          const t = await translateText(translateApi, text, trSet!.in.lang);
          if (t) {
            outText = t;
            translated = text;
          }
        } catch {
          showToast("这句没能翻过去，先按中文发了");
        } finally {
          setTranslatingMy(false);
        }
      }
      const msg: ChatMessage = {
        id: uuid(),
        role: "user",
        type: "text",
        content: outText,
        createdAt: new Date().toISOString(),
        isRead: true,
        ...(translated ? { translated } : {}),
        ...(quoteText ? { quote: quoteText } : {}),
      };
      /* 连续发送：只把消息挂上去，攒够了再按爱心让 TA 一次回完。 */
      const holdReply = conv?.manualReply === true;
      try {
        await appendMessage(character.id, maskId, msg);
      } catch {
        showToast("发送失败，请重试");
        return;
      }
      pushLocal(msg);
      if (el) {
        el.value = "";
        el.style.height = "auto";
      }
      const q = quoteText;
      setQuoteText("");
      setShowPlus(false);
      setShowImageSource(false);
      if (holdReply) return;
      await requestReply(outText, { quote: q || undefined, historyBase: [...messages, msg] });
    })().catch(() => showToast("发送失败，请重试"));
  }, [
    isTyping,
    loaded,
    quoteText,
    character.id,
    maskId,
    pushLocal,
    requestReply,
    messages,
    showToast,
    conv,
    translateApi,
  ]);

  /* ---------- 待回复队列：末尾连着的一串用户消息（连续发送攒下的） ---------- */
  const pendingMsgs = useMemo(() => {
    let i = messages.length - 1;
    while (i >= 0 && messages[i].role === "user") i--;
    return messages.slice(i + 1);
  }, [messages]);
  /* 可以让他回：连续发送模式 + 有攒着没回的话 + TA 没在回。 */
  const canForceReply =
    conv?.manualReply === true && pendingMsgs.length > 0 && !isTyping;

  /* ---------- 让他回复（让 TA 把攒下的几条一次回完） ---------- */
  const forceReply = useCallback(() => {
    if (!canForceReply) return;
    const last = pendingMsgs[pendingMsgs.length - 1];
    void requestReply(last.content, {
      quote: last.quote,
      historyBase: messages,
    });
  }, [canForceReply, pendingMsgs, requestReply, messages]);

  /* ---------- 小飞机只管发送，爱心只管让他回 ---------- */
  /* 口径：小飞机不论连续发送开不开，都只是发送、不会回复；
     爱心是唯一能让他开口的键，只在连续发送攒着话时才亮、才进得来。 */

  /* ---------- 停止生成（硬中断；已经长出来的字保留落库） ---------- */
  const stopReply = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  /* ---------- 长按菜单 ---------- */
  const onLongStart = (e: React.MouseEvent | React.TouchEvent, msg: ChatMessage) => {
    if (longTimer.current) clearTimeout(longTimer.current);
    longTimer.current = setTimeout(() => {
      let clientX = 0;
      let clientY = 0;
      if ("touches" in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("clientX" in e) {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }
      const rect = rootRef.current?.getBoundingClientRect();
      const rootWidth = rect?.width ?? 390;
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      // 换算成相对 App 根的坐标并夹在可视范围内（事件里读取 ref，符合规则）。
      /* 夹取用的菜单宽度是**最宽那一档**：图片消息且带 diag 时是 7 个按钮
         （删除／引用／复制／收藏／翻译／诊断／重新生成，其中最长的标签「重新生成」
         约 56px，其余各约 36px，加上分隔线与内边距 ≈ 290px）。写小了菜单会从
         右边溢出屏幕、最后一个按钮点不到。**往菜单里加按钮时这个数要跟着加。** */
      setMenuPos({
        x: Math.min(Math.max(x - 110, 10), Math.max(10, rootWidth - MENU_MAX_W)),
        y: Math.max(y - 64, 76),
      });
      setCurMsg(msg);
      setShowSheet(true);
    }, 520);
  };

  const onLongCancel = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const delMsg = useCallback(async () => {
    if (!curMsg) return;
    await deleteMessage(character.id, maskId, curMsg.id);
    /* 消息没了，仓库里对应的图也就没人引用了，一并收回。 */
    releaseImageAsset(curMsg.imageUrl);
    setMessages((prev) => prev.filter((m) => m.id !== curMsg.id));
    setShowSheet(false);
    showToast("已删除");
    onDataChange();
  }, [curMsg, character.id, maskId, showToast, onDataChange]);

  const quoteMsg = useCallback(() => {
    if (!curMsg) return;
    const who = curMsg.role === "user" ? myName : charName;
    const sum = (curMsg.type ?? "text") === "text" ? curMsg.content : TYPE_CN[curMsg.type ?? "text"] ?? "消息";
    setQuoteText(`${who}：${sum}`);
    setShowSheet(false);
    const keptScroll = bodyRef.current?.scrollTop ?? 0;
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      if (bodyRef.current) bodyRef.current.scrollTop = keptScroll;
    }, 50);
  }, [curMsg, myName, charName]);

  const copyMsg = useCallback(() => {
    if (!curMsg) return;
    const txt =
      (curMsg.type ?? "text") === "text" ? curMsg.content : `[${TYPE_CN[curMsg.type ?? "text"] ?? "消息"}]`;
    /* 手机在局域网 IP 下是「不安全页面」（http://192.168.x.x），navigator.clipboard
       直接不存在——原来那两个分支不管成没成都报「已复制」，等于假报成功。
       现在：能用 Clipboard API 就用；用不了／写失败，退回 textarea + execCommand 老办法
       （点击手势里同步执行，iOS 认这个）。两条都失败才如实说。 */
    const fallback = () => {
      const ok = legacyCopy(txt);
      showToast(ok ? "已复制" : "复制失败，可以长按气泡手动复制");
      return ok;
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => showToast("已复制"),
        () => void fallback(),
      );
    } else {
      fallback();
    }
    setShowSheet(false);
  }, [curMsg, showToast]);

  /* 打开编辑器：把这条的原文摆进输入框，先把长按菜单收掉。 */
  const startEdit = useCallback(() => {
    if (!curMsg) return;
    setEditMsg(curMsg);
    setEditDraft(curMsg.content);
    setShowSheet(false);
  }, [curMsg]);

  /* 存下改后的这一条。
     `apiText` 一并抹掉：那格记的是「当初发给模型的原话」，改完就过期了——留着它，
     回喂历史时模型看到的还是改前的错字（`buildApiMessages` 认 apiText 优先）。
     抹掉后回喂改认 content，模型从这一轮起看到的才是改后的话；代价是这条往后的
     前缀缓存作废一次（改了历史本来就得重写，这个钱省不掉）。 */
  const saveEdit = useCallback(async () => {
    if (!editMsg) return;
    const text = editDraft.trim();
    if (!text) return;
    const target = messages.find((m) => m.id === editMsg.id) ?? editMsg;
    const next: ChatMessage = { ...target, content: text };
    delete next.apiText;
    await updateMessage(character.id, maskId, next);
    setMessages((prev) => prev.map((m) => (m.id === next.id ? next : m)));
    setEditMsg(null);
    showToast("已改好");
    onDataChange();
  }, [editMsg, editDraft, messages, character.id, maskId, showToast, onDataChange]);

  /* 把照片存到本地。整套手感（系统分享面板优先、下载兜底、保住用户手势）都在
     `saveImageToDevice` 里——朋友圈配图的「保存图片」共用同一支，两边不会走偏。 */
  const saveImage = useCallback(
    (url: string, knownBlob?: Blob) => {
      saveImageToDevice(url, knownBlob, showToast);
    },
    [showToast],
  );

  const toggleFavorite = useCallback(() => {
    if (!curMsg) return;
    setFavoritedIds((prev) => {
      const next = new Set(prev);
      if (next.has(curMsg.id)) {
        next.delete(curMsg.id);
        showToast("已取消收藏");
      } else {
        next.add(curMsg.id);
        showToast("已收藏");
      }
      return next;
    });
    setShowSheet(false);
  }, [curMsg, showToast]);

  /* ---------- 发送图片：从相册选一张，压好落库，当图片消息发出去 ---------- */
  /* 为什么非要绕一趟媒体仓库：图若以 data URL 直接住进消息，而会话记录是「每次读列表
     都整份读出」的那个键——几张手机照片就能把它撑到几 MB，之后整份都存不进去。
     所以图进独立仓库、消息里只留一句 media-store:// 引用串（跟 TA 生图那条路同一套）；
     仓库万一写不进去也不把原图硬塞回来，宁可如实说发不出去。
     caption：图上配的那句话（可空）。有它就先图后字落两条、一次动作发出去；
     这一轮给模型的「一来」就是那句话本身，不再走 mediaOnly。 */
  const sendPickedImage = useCallback(
    async (file: File, caption?: string) => {
      if (!file.type.startsWith("image/")) {
        showToast("只能发图片");
        return;
      }
      showToast("正在处理图片…");
      const objectUrl = URL.createObjectURL(file);
      let ref: string | undefined;
      let qrNote: string | undefined;
      try {
        /* 顺手看看图里有没有二维码（相册里存的收款码就靠这一手才认得出来，见 qr-read.ts）：
           解出来就写成一句话挂在这条消息上，往后每一轮回喂都带着；解不出就是普通照片。
           读码与压缩互不依赖，并排跑，别让读码把「正在处理图片…」拖长。 */
        const [note, stored] = await Promise.all([
          readQrNote(objectUrl),
          persistImageAsset(objectUrl),
        ]);
        qrNote = note;
        ref = stored?.ref;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      if (!ref) {
        showToast("这张图读不出来，换一张试试");
        return;
      }
      const msg: ChatMessage = {
        id: uuid(),
        role: "user",
        type: "image",
        content: "照片",
        imageUrl: ref,
        /* 图里读出二维码才写这一格（见 types/chat.ts 的 mediaNote）。 */
        ...(qrNote ? { mediaNote: qrNote } : {}),
        createdAt: new Date().toISOString(),
        isRead: true,
      };
      try {
        await appendMessage(character.id, maskId, msg);
        pushLocal(msg);
        onDataChange();
      } catch {
        releaseImageAsset(ref);
        showToast("发送失败，请重试");
        return;
      }
      /* 配了话就紧跟一条文字（图在上、话在下，跟平常发出去的一样）。
         文字没写进去不牵连已经落好的图——只如实说一声，图留着。 */
      const text = (caption ?? "").trim();
      let textMsg: ChatMessage | null = null;
      if (text) {
        textMsg = {
          id: uuid(),
          role: "user",
          type: "text",
          content: text,
          createdAt: new Date().toISOString(),
          isRead: true,
        };
        try {
          await appendMessage(character.id, maskId, textMsg);
          pushLocal(textMsg);
          onDataChange();
        } catch {
          textMsg = null;
          showToast("图发出去了，配的那句话没跟上");
        }
      }
      /* 发完图让 TA 接一句——不然照片挂在那儿没人应，跟打字发出去的感觉不一样。
         不请求回复的三种情况：连续发送模式（攒着按爱心一起回）、TA 正在回、
         设定还没读完（第一轮必须带着正确的发图能力走，见「载入会话」）。
         配了话：这一轮的「一来」就是那句话，走正常那条路（引用／易变尾巴照旧）；
         没配话：mediaOnly——这一轮没有文字，图片消息本身就是那条「一来」。
         historyBase 收在最后一条用户消息上（有配话就是文字那条），requestReply
         会把尾条摘掉、免得同一句在请求里出现两次（见那里 apiHistory 的说明）。 */
      if (conv?.manualReply === true || isTyping || !loaded) return;
      if (textMsg) {
        void requestReply(text, { historyBase: [...messages, msg, textMsg] });
      } else {
        void requestReply("", {
          mediaOnly: true,
          /* 这一轮顺手把「图里是张码」也递过去，别等下一轮（往后各轮由 mediaNote 负责）。 */
          ...(qrNote ? { mediaText: `（发来一张图片：${qrNote}）` } : {}),
          historyBase: [...messages, msg],
        });
      }
    },
    [
      character.id,
      maskId,
      pushLocal,
      onDataChange,
      showToast,
      conv,
      isTyping,
      loaded,
      requestReply,
      messages,
    ],
  );

  /* ---------- 发收款码：把钱包里那张码当图片消息发给 TA ---------- */
  /* 走的是跟发相册图同一条路（现画 → 压好落库 → 落一条 image 消息 → 让 TA 接一句）。
     码里印的是钱包账本上「我这个面具」的收款编号（`getPayCode`：没有就当场生成）；
     码图不落仓库，每次现画（见 `lib/settings/paycode.ts`）——存进消息里的还是普通图片。
     画不出来或压不进去就如实说一声，不硬发一条空消息。 */
  const sendPayCode = useCallback(async () => {
    showToast("正在画收款码…");
    const code = await getPayCode(maskId);
    const dataUrl = await renderPayCodeDataUrl(myName, code);
    if (!dataUrl) {
      showToast("收款码没画出来，稍后再试");
      return;
    }
    const ref = (await persistImageAsset(dataUrl))?.ref;
    if (!ref) {
      showToast("收款码发不出去，稍后再试");
      return;
    }
    /* 「这张图是什么」写成一句话，同时落进消息（mediaNote）与这一轮（mediaText）：
       模型不是扫码器，光看图读不出码里的编号；落了库以后，往后每一轮回喂也都带着
       它，TA 不会聊几句就把这张码忘成「（发来一张图片）」。 */
    const payNote = `我的收款码，码里装着：收款编号 ${code}、收款人「${myName}」`;
    const msg: ChatMessage = {
      id: uuid(),
      role: "user",
      type: "image",
      content: "收款码",
      imageUrl: ref,
      mediaNote: payNote,
      createdAt: new Date().toISOString(),
      isRead: true,
    };
    try {
      await appendMessage(character.id, maskId, msg);
      pushLocal(msg);
      onDataChange();
    } catch {
      releaseImageAsset(ref);
      showToast("发送失败，请重试");
      return;
    }
    /* 跟发图一样：连续发送模式／TA 正在回／设定没读完，这三种都不当场求回复。
       mediaText：跟落在消息上的 mediaNote 同一句（见上），这一轮先把「码里是什么」
       递给 TA；往后各轮由 mediaNote 负责（1.4.30）。 */
    if (conv?.manualReply === true || isTyping || !loaded) return;
    void requestReply("", {
      mediaOnly: true,
      mediaText: `（发来一张图片：${payNote}）`,
      historyBase: [...messages, msg],
    });
  }, [
    character.id,
    maskId,
    myName,
    pushLocal,
    onDataChange,
    showToast,
    conv,
    isTyping,
    loaded,
    requestReply,
    messages,
  ]);

  /* ---------- 支付方式：这一笔从零钱出还是从某张卡出（1.4.55） ---------- */
  /* 恩熙：「跳出一个页面……以及你要支付的方式，零钱或者是银行卡这种。」
     `payMethod` 是 `"balance"` 就走零钱，否则当成卡的 id。
     1.4.64 起这儿的判断**拆成两半**（恩熙：「我想转 5200，我虽然零钱是没有 5200 的，
     但是我银行卡有啊，他就不应该判定说我的零钱只有多少钱、转不了，而是应该是到支付界面，
     然后就是到输入密码的界面，然后选择零钱跟银行卡。如果说你选择零钱，他没有 5200，
     这时候他才会判定转账不了。」）：
       · `checkPacketLimit`＝红包天花板，跟出的哪个口袋无关，**填完钱那一步就拦**；
       · `checkPaySource`＝只判「选中的这个口袋够不够」，**只在支付方式定了之后**判
         （就是真动手那半 `sendMoneyNow`：密码过了、方式选好了）。 */

  /* 红包天花板（1.4.62）：恩熙要红包有限额、超过就只准转账
     （`RED_PACKET_MAX_CENTS`，1000 元）。跟口袋无关，所以不塞进「够不够」那半里。 */
  const checkPacketLimit = useCallback(
    (cents: number, kind: "redpacket" | "transfer"): boolean => {
      if (kind === "redpacket" && cents > RED_PACKET_MAX_CENTS) {
        showToast(`红包最多 ${formatYuan(RED_PACKET_MAX_CENTS)}，再多请改用转账`);
        return false;
      }
      return true;
    },
    [showToast],
  );

  /* 「这个口袋够不够」只在这儿判一次，免得同一套判断抄成两份、哪天改歪一份。
     它认的是**当下选中的 payMethod**——所以调它的时机必须是方式已经定了。 */
  const checkPaySource = useCallback(
    async (cents: number, kind: "redpacket" | "transfer"): Promise<boolean> => {
      if (!checkPacketLimit(cents, kind)) return false;
      if (payMethod === "balance") {
        const balance = await getBalance(maskId, "mask");
        if (cents > balance) {
          showToast(`零钱不够，还差 ${formatYuan(cents - balance)}`);
          return false;
        }
        return true;
      }
      const card = payCards.find((c) => c.id === payMethod);
      if (!card) {
        showToast("没找到这张卡");
        return false;
      }
      if (cents > card.balance) {
        showToast(`这张卡里的钱不够，还差 ${formatYuan(cents - card.balance)}`);
        return false;
      }
      return true;
    },
    [checkPacketLimit, payMethod, payCards, maskId, showToast],
  );

  /** 支付方式怎么念（「零钱」「招商银行储蓄卡 1234」）——密码钥匙串上那行字要用。 */
  const payMethodLabel = useCallback(
    (method: string): string => {
      if (method === "balance") return "零钱";
      const card = payCards.find((c) => c.id === method);
      return card ? `${card.title} ${card.tailNumber}`.trim() : "银行卡";
    },
    [payCards],
  );

  /** 密码键盘上那张支付方式列表的几项（1.4.56）：零钱排最前，后面是她名下的卡
   *  （跟钱包页搬运面板一个排法）；每行右边写那个口袋里还剩多少。 */
  const payMethods = useMemo(
    () => [
      { id: "balance", name: "零钱", note: "钱包里的余额", cents: myBalance },
      ...payCards.map((c) => ({
        id: c.id,
        name: c.title,
        note: `尾号 ${c.tailNumber}`,
        cents: c.balance,
      })),
    ],
    [myBalance, payCards],
  );

  /** 她在密码那一屏换了支付方式（1.4.56）：记下来，顶上那行字跟着换。 */
  const pickPayMethod = useCallback(
    (id: string) => {
      setPayMethod(id);
      setPayPwdMethod(payMethodLabel(id));
    },
    [payMethodLabel],
  );

  /* ---------- 发红包／转账：钱先只从我的零钱（或某张卡）扣掉 ---------- */
  /* 以前这里是写死 66／520 的假动作——气泡上写着发出去两百块，钱包一分没动。
     现在两件事都做：落一条带金额的气泡消息（给聊天记录看），
     再让钱包账本把这一笔从我选的那个口袋扣掉（零钱／那张卡都走 `payOutToContact`）。
     1.4.63 起**只扣我、先不给他**（恩熙：「他可以自己判断要收下还是退回」）：
     钱悬在中间，他表态才落定——收下才进他的零钱（见 markContactReceived），
     退还／红包不领就原路回我出的这个口袋（见 settleContactRefund）。
     所以这条消息要带上出钱的口袋（`payFrom`），退的时候才知道回零钱还是回那张卡。
     顺序是**先落消息、再扣钱**：反过来的话，钱扣了却没有那条气泡，
     账上凭空少一笔、聊天里还看不出是发给谁的。
     金额单位换算：输入框是「元」，账本是「分」（parseYuan 直接给分）。
     `sendMoneyNow` 是**真动手**的那半；外头还有一道 `doSendMoney` 的闸（1.4.51）：
     设过支付密码就先弹六个格子，输对了才走到这儿。 */
  const sendMoneyNow = useCallback(
    async (kind: "redpacket" | "transfer") => {
      const cents = parseYuan(payAmountText);
      if (cents === null || cents <= 0) {
        showToast("先填一个金额");
        return;
      }
      if (!(await checkPaySource(cents, kind))) return;
      setPayBusy(true);
      const label = kind === "redpacket" ? "红包" : "转账";
      const note = payNoteText.trim();
      /* 气泡里显示的是**元**（ChatMessage.amount 一直是元，见气泡里那个 toFixed(2)）。 */
      const yuan = Number((cents / 100).toFixed(2));
      const msg: ChatMessage = {
        id: uuid(),
        role: "user",
        type: kind,
        content: note,
        amount: yuan,
        /* 这一笔从哪个口袋出的（1.4.63）：`"balance"`＝零钱，否则是那张卡的 id。
           他要是退还，就照这个**原路**退回（见 settleContactRefund）。 */
        payFrom: payMethod,
        /* 红包封面（1.4.89）：发红包那页挑的那张；转账不带这格。 */
        ...(kind === "redpacket" ? { redCover: payCover } : {}),
        createdAt: new Date().toISOString(),
        isRead: true,
      };
      try {
        await appendMessage(character.id, maskId, msg);
        pushLocal(msg);
        onDataChange();
      } catch {
        showToast("发送失败，请重试");
        setPayBusy(false);
        return;
      }
      /* 这张封面顺手收进「我的封面」（1.5.5）：她挑过的封面下次在画廊里直接能挑。
         收不进就算了——封面早跟着消息存下了，不为一条收藏打断发钱。 */
      if (kind === "redpacket" && isCustomRedCover(payCover)) {
        void putRedCoverToLibrary(payCover).catch(() => {});
      }
      try {
        /* 只扣我这一步：钱先出我的口袋，他那本账这时一分不动。 */
        const res = await payOutToContact({
          ownerId: maskId,
          from: payMethod,
          cents,
          title: `发${label}给${charName}`,
          detail: note,
        });
        if (!res.ok) {
          /* 消息已经发出去了，钱没扣成也如实说一句，别装成发出去了
             （从卡出时最常见：卡被删了、钱刚被她搬走）。 */
          showToast(`消息发出去了，但钱没划成：${res.error ?? "这个口袋付不了"}`);
          setPayBusy(false);
          setPaySend(null);
          return;
        }
      } catch {
        /* 消息已经发出去了，就别说「发送失败」——丢的是钱那一半，实话实说。 */
        showToast("消息发出去了，但钱没划成，稍后再试");
        setPayBusy(false);
        setPaySend(null);
        return;
      }
      setPayBusy(false);
      setPaySend(null);
      showToast(`已发出 ${formatYuan(cents)}`);
      /* 跟发图／发码同一条口径：连续发送模式、TA 正在回、设定没读完，这三种都不当场求回复。
         这三场合也就没人在替他表态——钱就**悬着等他回头收**（不再像以前那样隔两三秒自动算他收下）：
         卡片停在「等他收下／等他领取」，他之后哪一轮补一个标记就落定；
         这条钱后面又走过上下文那么多条还没表态，才按过期退回我出的口袋（见 expireStaleMoney）。 */
      if (conv?.manualReply === true || isTyping || !loaded) {
        return;
      }
      /* 这一轮先把「发来多少、留言是什么、封面是什么」递给 TA（跟回喂历史用同一句话，
         见 moneyNoteOf）。信封上换的那张照片里画的是什么，一句话说不出来——顺手把那张图
         也随这一轮递过去（跟发图同一条路，用完即弃、不落库），它就能真看见封面。
         预设封面是纯 CSS 渐层、没有图可取，那句「一张淡粉色的卡片」就是全部。
         转账没有封面这回事：不取图，moneyNoteOf 那边也对转账忽略封面。 */
      const coverImage =
        kind === "redpacket" && isCustomRedCover(payCover)
          ? await mediaRefToVisionDataUrl(redCoverRefOf(payCover))
          : undefined;
      void requestReply("", {
        mediaOnly: true,
        /* 状态半句跟回喂历史用同一个函数（moneyStateNoteOf）：钱刚发出去自然是「还没领」，
           两种场合逐字一致，TA 才不会把同一笔钱读成两种样子。 */
        mediaText: moneyNoteOf("user", kind, yuan, note, payCover, moneyStateNoteOf(kind, "pending")),
        historyBase: [...messages, msg],
        ...(coverImage ? { visionImage: coverImage } : {}),
      });
    },
    [
      payAmountText,
      payNoteText,
      payCover,
      payMethod,
      checkPaySource,
      maskId,
      character.id,
      charName,
      pushLocal,
      onDataChange,
      showToast,
      conv,
      isTyping,
      loaded,
      requestReply,
      messages,
    ],
  );

  /* ---------- 发钱之前先过支付密码（1.4.51，恩熙要「输入密码那一种」） ---------- */
  /* 这一步只拦**跟口袋无关**的两件：金额没填、红包超了天花板（1.4.62）。
     **「够不够」不在这儿拦**（1.4.64）：她零钱可能不够、卡里够，得先进密码那一页
     把支付方式选出来，选了才判（判在 `sendMoneyNow` 调的 `checkPaySource` 里；
     那一页的方式列表右边也印着每个口袋剩多少，她挑的时候就看得到）。
     没设过密码（账本里那份是空串）就直接走，不拿一个她没设过的密码拦她自己。
     设了就弹六个格子，顶上顺带印一行「支付方式 · …」，输对了才进 `sendMoneyNow`。 */
  const doSendMoney = useCallback(
    async (kind: "redpacket" | "transfer") => {
      const cents = parseYuan(payAmountText);
      if (cents === null || cents <= 0) {
        showToast("先填一个金额");
        return;
      }
      if (!checkPacketLimit(cents, kind)) return;
      const pwd = await getPayPassword(maskId);
      if (!pwd) {
        await sendMoneyNow(kind);
        return;
      }
      setPayPwdCurrent(pwd);
      setPayPwdAmount(formatYuan(cents));
      setPayPwdMethod(payMethodLabel(payMethod));
      setPayPwdKind(kind);
    },
    [payAmountText, checkPacketLimit, payMethodLabel, payMethod, maskId, showToast, sendMoneyNow],
  );

  /* ---------- 收下 TA 发来的红包／转账：钱真进我的零钱 ---------- */
  /* 1.4.36 起 TA 的钱在他发出来那一刻就已经从他账上扣过了（见上面落库那段，
     `adjustBalance(character.id, "contact", -cents, …)`），所以这里**只往我这边加**，
     绝不能再动他那本账——再扣一次就是同一笔钱扣两遍。
     「点击领取」拦的是我这一半：没点之前钱还没到我手上，点了才进我的零钱，
     同时把这条消息标成已领，免得关掉弹窗再点一次、同一笔钱领两遍
     （moneyClaimed 落库，见 chat.ts 白名单）。
     1.4.89 起回一个 boolean：开红包页要拿它决定动画放完之后是「揭晓金额」
     还是退回「还没开」的样子（钱没到账时那页不能装作领到了）。 */
  const claimMoney = useCallback(
    async (m: ChatMessage): Promise<boolean> => {
      const cents = Math.round((m.amount ?? 0) * 100);
      if (cents <= 0) {
        showToast("这条没有金额");
        return false;
      }
      const label = m.type === "redpacket" ? "红包" : "转账";
      try {
        await adjustBalance(maskId, "mask", cents, `收到${charName}的${label}`, m.content);
      } catch {
        showToast("钱没到账，稍后再试");
        return false;
      }
      const done: ChatMessage = { ...m, moneyClaimed: true };
      try {
        await updateMessage(character.id, maskId, done);
      } catch {
        /* 标记没写进库：钱已经到她手上了，但这条气泡没带上「已领」——
           重进会话再点一次还能再领一遍。如实说一声，别让她蒙在鼓里。 */
        showToast("钱收到了，但这条没标上「已领」");
      }
      /* 就地替换那条气泡（不是 append）：pushLocal 是「往后加一条」，
         用在这里会把同一条钱显示成两条。 */
      setMessages((prev) => prev.map((x) => (x.id === done.id ? done : x)));
      /* 从我这边落一条（恩熙：「他转给我，我收取也会有卡片」）：转账是我发的收款回执卡
         ——它跟左边那张变淡的卡不是同一件事，那张是他的转账、原样留在那儿，这一张挂右侧、
         带着我的头像；红包则是一条居中的系统提示「你已领取 XX 的红包」（1.4.42，微信那样）。 */
      const echo = buildMoneyEcho(m, "user", charName);
      try {
        await appendMessage(character.id, maskId, echo);
        pushLocal(echo);
      } catch {
        /* 没写上就先算了：钱已经进了我的零钱、标记也落了库，少的只是这一条。 */
      }
      onDataChange();
      /* 1.4.87 恩熙：「不论我退还了还是收下了，他应该都是能够收到消息的，并且回复我
         ——比如我收下了，他就说『还知道收下就好』这种话」。把这件事当一句**括号旁白**
         递给 TA（跟发钱那条路同一个机制，见 moneyNoteOf：user 侧就是括号说明），
         他就知道我收下了、该接一句话。连续发送模式／他正在回／设定没读完这三种
         不当场求回复——跟发钱同一条口径；这边卡片已经落定，跳过就跳过。 */
      if (conv?.manualReply !== true && !isTyping && loaded) {
        void requestReply("", {
          mediaOnly: true,
          mediaText: `（收下了${charName}发来的${label}：${(cents / 100).toFixed(2)} 元）`,
          historyBase: [...messages.map((x) => (x.id === done.id ? done : x)), echo],
        });
      }
      /* 收下之后**不再弹任何东西**（1.4.39 恩熙点名去掉：「我收下他的钱之后，
         我的消息对话框也会冒出了一个已收下」）。原来这里会把弹窗重新开一次
         （上面写着「已收下」）、再飘一句 toast——两样都是重话：
         卡片自己从「点击领取」变淡成「已领取」就是回执，钱也真进了零钱。
         所以这里既不 setOpenMoney 也不 showToast（**只限成功这条路**；上面「没金额／钱没到账／
         没标上已领」那几句失败提示仍要留着，showToast 还在依赖里）。
         弹窗是上面那个按钮先关掉的，不管这里就保持关着；往后她再点开卡片，
         标题上仍看得见「· 已收下」。 */
      /* 钱到了、标记也落了（或至少钱到了）——告诉开红包页可以揭晓金额了。 */
      return true;
    },
    [
      maskId,
      character.id,
      charName,
      onDataChange,
      showToast,
      pushLocal,
      conv,
      isTyping,
      loaded,
      requestReply,
      messages,
    ],
  );

  /* ---------- 把 TA 转来的钱退回去：钱原路回到他的零钱 ---------- */
  /* 1.4.41 恩熙：「应该要在转账上面做一个退还的功能」。跟微信一样：他转来的转账，
     我点开卡片有「收下」也有「退还」；不想要这笔就退回去。
     钱的走法——他发钱时已经从他账上扣过了（见上面落库那段），所以退还就是**把那一笔
     加回他的账**；我这边一分没多过，也就没有可扣的。
     红包没有退还（跟微信一致：红包只能开、不能退），弹窗里那个按钮只给转账。
     次序同 claimMoney：先把钱退回去、再落标记、最后发回执——反过来的话，万一退款没成，
     卡片已经是「已退还」、聊天里也挂着回执，钱却还在他账上被扣着，那就成了对不上的账。
     moneyRefunded 落库见 settings/chat.ts 的逐字段白名单。 */
  const refundMoney = useCallback(
    async (m: ChatMessage) => {
      const cents = Math.round((m.amount ?? 0) * 100);
      if (cents <= 0) {
        showToast("这条没有金额");
        return;
      }
      try {
        await adjustBalance(
          character.id,
          "contact",
          cents,
          `收到${myName}退还的转账`,
          m.content,
        );
      } catch {
        showToast("没退成，稍后再试");
        return;
      }
      const done: ChatMessage = { ...m, moneyRefunded: true };
      try {
        await updateMessage(character.id, maskId, done);
      } catch {
        /* 标记没写进库：钱已经回他账上了，但这条气泡没带上「已退还」——
           重进会话再点开，那个「收下」按钮还会冒出来。如实说一声，别让她蒙在鼓里。 */
        showToast("钱退回去了，但这条没标上「已退还」");
      }
      /* 就地替换那条气泡（不是 append）：同一条钱不能显示成两条。 */
      setMessages((prev) => prev.map((x) => (x.id === done.id ? done : x)));
      /* 从我这边发一张「已退还」的回执（跟收下那张一样挂在我这侧、带我的头像）：
         微信里退还之后，聊天里就是会多出这一张。 */
      const receipt = buildReceiptMsg(m, "user", "已退还");
      try {
        await appendMessage(character.id, maskId, receipt);
        pushLocal(receipt);
      } catch {
        /* 回执没写上就先算了：钱已经回他账上、标记也落了库，少的只是这张回执。 */
      }
      onDataChange();
      /* 1.4.87（同 claimMoney 那边）：退还这件事也要让 TA 知道并回一句——
         当一句括号旁白递过去，他就知道这笔被退回了、该接一句话（怎么接随他的人设）。 */
      if (conv?.manualReply !== true && !isTyping && loaded) {
        void requestReply("", {
          mediaOnly: true,
          mediaText: `（退还了${charName}发来的转账：${(cents / 100).toFixed(2)} 元）`,
          historyBase: [...messages.map((x) => (x.id === done.id ? done : x)), receipt],
        });
      }
    },
    [
      character.id,
      maskId,
      myName,
      charName,
      onDataChange,
      showToast,
      pushLocal,
      conv,
      isTyping,
      loaded,
      requestReply,
      messages,
    ],
  );

  /* 线下总闸（1.7.39）：把「这一场正开着」写进会话（落库）。开着时线上发不了消息；
     只有线下页那颗「结束这一场」把它放平（「返回」只收起这一页，不算结束）。 */
  const markOfflineOpen = useCallback(
    (open: boolean) => {
      void updateConversation(character.id, maskId, { offlineOpen: open }).then((next) => {
        setConv(next);
        onDataChange();
      });
    },
    [character.id, maskId, onDataChange],
  );

  /* ---------- 加号面板 ---------- */
  const onPlusClick = useCallback(
    (name: string) => {
      setShowPlus(false);
      const base = {
        createdAt: new Date().toISOString(),
        isRead: true,
      };
      const send = (partial: Omit<ChatMessage, "id" | "role" | "createdAt" | "isRead">) => {
        const msg: ChatMessage = {
          id: uuid(),
          role: "user",
          createdAt: base.createdAt,
          isRead: true,
          ...partial,
        };
        void appendMessage(character.id, maskId, msg)
          .then(() => {
            pushLocal(msg);
            onDataChange();
          })
          .catch(() => showToast("发送失败，请重试"));
      };
      if (name === "重新回复") {
        setShowReModal(true);
        return;
      }
      if (name === "去见他") {
        /* 线下场合（1.7.5）：不落任何消息、不发请求，只是把这一页翻过去见面。
           1.7.39 起把「这一场开着」写进会话（落库）：App 重开／切后台再进来照样停在线下，
           而且这一场没结束之前，线上发不了消息（防线上线下打架）。 */
        setShowOffline(true);
        markOfflineOpen(true);
        return;
      }
      if (name === "图片") {
        /* 不直接弹相册了——先问一句「这张图从哪来」（手机相册／小手机相册），
           见下面那块的二级面板与 pickImageSource。拍照不给单独一格了：
           手机相册那一路弹出来的系统选图里本来就有相机。 */
        setShowImageSource(true);
        return;
      }
      if (name === "语音消息") {
        send({ type: "voice", content: "语音消息", duration: 8 });
        return;
      }
      if (name === "红包" || name === "转账") {
        /* 不再写死金额、也不在这里落消息：钱要从我的零钱真划出去（1.4.33），
           所以先开那一页把「多少钱、写什么留言」问清楚，落消息与过账都交给 doSendMoney。
           金额默认空着、留言给一句惯用语（跟以前一样，改不改随她）。 */
        const kind = name === "红包" ? "redpacket" : "transfer";
        setPayAmountText("");
        setPayNoteText(kind === "redpacket" ? "收下我的心意" : "请查收");
        setMyBalance(null);
        /* 每一次都从零钱起手（1.4.55）：顺带把她名下的卡读一遍，支付方式那张列表要用。 */
        setPayMethod("balance");
        setPayCards([]);
        setPaySend({ kind });
        /* 封面是全局的：面板一开就把库里「眼下用的那张」读回来（换过就是它）。
           这趟还没挑过封面才认这条回来的值，免得盖掉她刚点的。 */
        coverPickedRef.current = false;
        void getDefaultRedCover().then((v) => {
          if (v && !coverPickedRef.current) setPayCover(v);
        });
        void Promise.all([getBalance(maskId, "mask"), listCards(maskId)]).then(([b, cs]) => {
          setMyBalance(b);
          setPayCards(cs);
        });
        return;
      }
      if (name === "位置") {
        send({ type: "location", content: "约定好的地方 · 老码头" });
        return;
      }
      if (name === "收款码") {
        /* 不是当场落消息：得先现画一张码（异步），交给 sendPayCode 那条路。 */
        void sendPayCode();
        return;
      }
      showToast(`${name} · 预览`);
    },
    [character.id, maskId, pushLocal, onDataChange, showToast, sendPayCode, markOfflineOpen],
  );

  /* ---------- 图片来源：手机相册／拍照／小手机相册 ---------- */
  /* 「手机相册」走系统选图（照片图库／拍照／浏览都在里面）。
     **点它先不收面板**——她在系统选图里进进出出、最后取消，回来时面板还该在原处；
     真选到图了才由 onChange 收掉、换出预览（见 pendingImage）。
     「拍照」跟它共用同一个隐藏输入，只是在点之前临时挂上 capture="environment"，
     让手机直接开后置镜头——比另摆一个 input 省一层，也不会两处逻辑走偏。
     「小手机相册」是以后的共同相册（我把照片放里头，角色也能看、也能拿来发），
     **现在只留入口、逻辑先不写**——点它先如实说一句「还在做」，别让它像坏了。 */
  const pickImageSource = useCallback(
    (source: "device" | "camera" | "stellasei") => {
      if (source === "stellasei") {
        setShowImageSource(false);
        showToast("小手机相册还在做，先留个位置");
        return;
      }
      const el = imageInputRef.current;
      if (!el) return;
      /* 走系统相册时必须把 capture 摘掉：留着它 iOS 会直接开相机、
         把「照片图库」那一路砍掉。 */
      if (source === "camera") el.setAttribute("capture", "environment");
      else el.removeAttribute("capture");
      el.click();
    },
    [showToast],
  );

  /* ---------- 待发的那张图：取消，或真发出去 ---------- */
  const cancelPendingImage = useCallback(() => {
    setPendingImage(null);
  }, []);

  const confirmPendingImage = useCallback(() => {
    if (!pendingImage) return;
    const { file } = pendingImage;
    /* 配的话现读 DOM（非受控）；面板一关那个框就没了，下次开出来是空的。 */
    const caption = pendingTextRef.current?.value ?? "";
    setPendingImage(null);
    void sendPickedImage(file, caption);
  }, [pendingImage, sendPickedImage]);

  /* ---------- 重新回复（真重发：裁掉最后一条用户消息之后的回复） ---------- */
  /* 放开空输入：不填也能点确认——那一种就是单纯让它重新生成
     （换个说法）；填了才是按提示词改语气／长短／态度。不要「请输入关键词」的拦截，
     空串时改用兜底提示，免得原样重跑、结果和上一条几乎一样。 */
  const confirmRetell = useCallback(async () => {
    const hint = reInput.trim() || RETELL_FALLBACK_HINT;
    setReInput("");
    setShowReModal(false);
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) {
      showToast("还没有可重新回复的消息");
      return;
    }
    const after = messages.slice(lastUserIdx + 1);
    for (const m of after) {
      await deleteMessage(character.id, maskId, m.id);
      releaseImageAsset(m.imageUrl);
    }
    const kept = messages.slice(0, lastUserIdx + 1);
    setMessages(kept);
    const lastUser = kept[kept.length - 1];
    await requestReply(lastUser.content, {
      extraHint: hint,
      quote: lastUser.quote,
      historyBase: kept,
    });
  }, [reInput, messages, character.id, maskId, requestReply, showToast]);

  /* ---------- 重新生成（失败提示下的一键重来） ---------- */
  const retryFailed = useCallback(
    async (noticeId: string) => {
      /* 先把那条失败提示从聊天记录里抹掉：它不是聊天内容，不该留在聊天记录上。 */
      await deleteMessage(character.id, maskId, noticeId);
      const kept = messages.filter((m) => m.id !== noticeId);
      setMessages(kept);
      let lastUser: ChatMessage | undefined;
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].role === "user") {
          lastUser = kept[i];
          break;
        }
      }
      if (!lastUser) {
        showToast("还没有可重新回复的消息");
        return;
      }
      /* 拿最后一条用户消息原样重跑（引用一并带上）：提示已经不在 kept 里，
         这一轮回喂给模型的历史干干净净。 */
      await requestReply(lastUser.content, {
        quote: lastUser.quote,
        historyBase: kept,
      });
      onDataChange();
    },
    [messages, character.id, maskId, requestReply, showToast, onDataChange],
  );

  /* ---------- 线下场合：写一段（1.7.5） ---------- */
  /* 线下**不复用 requestReply**：那条路绑着气泡／富媒体标记／心声账／记忆与未读数一整片假设，
     而这一场要的是小说体正文、不挂账、不进 messages。
     所以这里另走一份**单段 system**（chatApi 的 system 参数收字符串，就是一整段、不切
     前缀缓存断点）：
       system = 线下写法提示词 + buildPrompt 的 stable（世界书／人设／记忆，mode: "offline"）
     —— mode 传 "offline"，世界书只吃 global＋offline，线上那套【消息格式】一条不带。
     历史用线下记录本身（滤掉 role:"system" 的失败提示——那是给屏幕看的，不是戏里的经过），
     excludeDialogue 照旧：历史走 messages，不进易变尾巴。 */
  const generateOfflineReply = useCallback<OfflineGenerate>(
    async ({ history, input, onDelta, signal, onSent }) => {
      if (
        !effTextApi ||
        effTextApi.baseUrl.trim() === "" ||
        effTextApi.model.trim() === ""
      ) {
        throw new Error("还没配文本 API——先到设置里把地址和模型填上。");
      }
      const words = offlineWordsOf(conv);
      const [books, prefs] = await Promise.all([getWorldBooks(), getChatPrefs()]);
      /* 「结束」划的那道分界线（1.7.9／1.7.10）：从**最后一条分界线之后**起算——
         上一场已经收场（内容已归总进记忆），这一场不再整段重放；没划过线就全带。
         这是「这一场」的全部记录，进度单（beats）与归总都按它算。 */
      const sceneEntries = sceneEntriesOf(history);
      /* 只带最近 N 轮原文（1.7.46）：第 N 轮以前那几轮已经归总进记忆，不再整段摆给他——
         记忆里有；重放一遍既白费上下文，又容易让他照着旧台词往下说。
         轮数就是线下设置里那个「记忆 · 带最近 __ 轮」（默认 10，可调 2–30）。
         零头（不到 N 轮）全带；这一场就是从零算起的。 */
      const rounds = offlineMemoryRoundsOf(conv);
      /* 刀必须钉在整倍线上（1.7.52，规矩同 memory.ts 的 trimHistory）：
         起点只认「第几块」，不认「最后几轮」。旧写法从末尾往前数 N 轮，
         于是每进一轮窗口就往前滑一格、messages 的第一条跟着换人——站子一看开头
         就对不上，整段从头重算，而且每轮都作废、永不自愈（面板上「第 N 个字处就不一样」
         且 N 很小＝就是这个）。钉成整倍后，同一块内起点恒定、前缀只往尾巴上加，
         只有跨块那一轮断一次——与归总（第 10、20…轮）同轮，回到「每 N 轮亏一轮」。

         **门槛是两批、不是一批（1.7.59，恩熙 2026-09-28 定的「跟线上一样」）**：
         旧写法一到第 N+1 轮就把窗口塌成**只剩当前这一轮**——前面刚归总完的那 N 轮
         全被砍掉、只靠记忆带，线上不这么干：memory.ts 的 trimHistory 里总条数不满
         2×门槛就一刀不切，归总过的那一批原文**照样在上下文里摆着**，攒够两批才切一刀
         （窗口永远在「门槛」到「2×门槛-1」之间晃）。线下照抄同一条：不满 2N 轮全带，
         满了才切掉最老那一批、留最近 N 轮——这才叫「跟线上同一个窗口口径」。 */
      const userIdx: number[] = [];
      sceneEntries.forEach((e, i) => {
        if (e.role === "user") userIdx.push(i);
      });
      let from = 0;
      if (userIdx.length >= rounds * 2) {
        from = userIdx[(Math.floor(userIdx.length / rounds) - 1) * rounds];
      }
      const sceneHistory = offlineAsMessages(sceneEntries.slice(from));
      /* 回喂那一份要的是「上一轮真发出去的原样」（1.7.51）：她那条话后头还挂着【场景】／
         【已经演过的】／此刻那一串易变尾巴，回喂时只剩光原话的话，站子逐字比对到这条就断，
         其后整段每轮作废重写（面板上那个「第 N 个字处就不一样」＝这段尾巴的长度）。
         线上早有这一格（见 requestReply 里那段 apiText），线下一直漏着，补上。
         组装（buildPrompt）照旧用光原文——那份是给她看的现场，不外溢到别处。 */
      const sceneHistorySent = offlineAsMessages(sceneEntries.slice(from), true);
      /* 去重（1.7.36）：她这一轮的话由下面当**单独一轮**交给请求（见 fetch* 的 userInput 形参），
         sceneHistory 的尾条就是同一条——不去掉的话，同一句话会在 messages 里连着出现两遍，
         他把它当成「她说了两遍」，下一段就照着复读。线上早有这一步（见 requestReply 那段
         的 apiHistory），线下一直漏着，补上。
         她连发攒下的那一串（1.8.4）：末尾连着的好几条 user 一并摘出来、合成**一轮**发出去。
         一条一条当独立轮次摆进去，模型常只应最后一条——她报的「打三行字，他只读一两条」。
         合成的那一轮由**最后一条承接**（把合并原文记在它身上），前几条落 `foldedInto`
         ——回喂历史时不单独出现。发出去的是合并稿、回喂的也是合并稿（同一份），
         前缀缓存才一路对得上；屏幕上照旧一格一句话，不并、不删。 */
      const runIds: string[] = [];
      const runLines: string[] = [];
      for (let i = sceneHistory.length - 1; i >= 0 && sceneHistory[i].role === "user"; i -= 1) {
        runIds.unshift(sceneHistory[i].id);
        runLines.unshift(sceneHistory[i].content);
      }
      const carryId = runIds[runIds.length - 1] ?? "";
      const foldedIds = runIds.slice(0, -1);
      /* 她这一轮真正被当成「一句话」的那份：连发时是几条接起来，单发时就是这一句。 */
      const spoken = runLines.length > 1 ? runLines.join("\n") : input;
      const sceneApi = sceneHistorySent.slice(0, sceneHistorySent.length - runIds.length);
      /* 线上那一截（1.8.4）：进见面之前在手机上说的话，拼成**一条**挂在最前——
         他才知道她为什么来、这趟见面接着哪句话往下（此前只带线下记录与记忆，线上一个字没带，
         他张口就是「你怎么突然来了」）。见面期间线上是冻着的，这一条逐字不变，
         前缀缓存能一路连读；按条混进历史会把微信体的短句喂成见面小说的写法（格式串味）。
         新会话直接见面、线上还没聊过时为空，整条不挂。只给他读：不落库、不上屏、不进记忆。 */
      const onlinePrefix = onlineTranscript(messagesRef.current, charName, myName);
      const apiHistory = onlinePrefix ? [onlinePrefix, ...sceneApi] : sceneApi;
      const built = buildPrompt({
        characterId: character.id,
        characterCategoryId: character.categoryId,
        profile: character.data,
        books,
        mode: "offline",
        history: sceneHistory,
        userInput: spoken,
        userName: myName,
        userMask: mask,
        currentSignature: conv?.signature,
        userSignature,
        memoryBlock: memory ? await buildMemoryBlock(memory, myName) : "",
        excludeDialogue: true,
        sessionKey: `${character.id}::${maskId}`,
        timeAware: prefs.timeAware,
      });
      /* 1.7.53：风格提示词从此只吐固定文字（字数那句已挪到 sceneInput 最末，见下）。 */
      const system = buildOfflineStylePrompt(charName, myName) + "\n\n" + built.stable;
      /* 场景签（1.7.32）：她手标的地点挂在她这一轮的话**最前头**——「【场景】××」。
         取的是记录里最后一条场景签（倒扫，先撞分界线就归零，与线下页同一条口径，见 currentSceneOf）。
         场景签本身是 system（只给屏幕看、offlineAsMessages 已滤掉、不进 sceneHistory），
         所以地点只能从这儿补给他。 */
      const scene = currentSceneOf(history);
      /* 进度单（1.7.45 加 → 1.7.60 改挂历史，恩熙 2026-09-28 点头「跟线上一样」）：
         原先把每一轮 TA 结尾那句「【本轮】××」（见提示词第 12 条、OfflineScenePage 的
         takeBeats）攒成一份「【已经演过的】」塞在**她这一轮的话里**。它在内容上是对的
         （1.7.45 就是要治「看不见演到哪了 ⇒ 每轮重答第一轮那句、旧台词原句又搬回来」），
         但位置错了：她那句话每轮全新，整份进度于是每轮重掏一次钱、场子越久越厚
         （实测这一格从几百一路涨到 1.4 万）。
         现在进度改由**历史里各段自己带**（见 offlineAsMessages 的 withBeat），
         这里只留一句**固定长度**的硬命令，指着那些标记说话——
         缓存断点之后那一截从此与线上同构：只随「她这句话」长，不随场次长。
         取法与切分口径同一套（分界线之后起算，已收场的上一场不重复带）。 */
      const beats = sceneEntries.filter((e) => e.role === "assistant" && e.beat);
      const beatsHint =
        beats.length > 0
          ? `【进度】上面历史里，每段末尾那行「【本轮】××」就是那一轮已经演过的：不要再回到上面任何一件事上，不要重复那些台词，也不要把同一个态度换着法儿再表一遍。接着往下写新的一件。\n\n`
          : "";
      /* 易变尾巴（此刻时间／签名取值／关键词世界书）照线上那个口径挂在**她这一轮的话后面**：
         它每轮都变，进 system 会把整段作废；挂着不动的那半截才站得住。 */
      /* 字数上限（1.7.53）：这一句原先插在**风格提示词第 10 条行尾**——也就是整条请求的第
         942 个字上。它是那 942 个字里唯一一个她随时能改的东西（线下设置里的字数 ±），
         一改，后面三万多字全部作废、站子整篇重算（账单「读≈0、写满 33K」就是这么来的，
         面板也一直报「在第 942 个字处就不一样」）。挪到整条请求的最末、与易变尾巴做伴：
         它再怎么变，前面一个字都不动。病根与实测见施工日志第 670 条。 */
      const wordsRule =
        words && words.max > 0
          ? `\n\n【字数】这一轮写下来的正文，最多 ${words.max} 字。她这一轮没给你新事，写短些就行——几句话也够，不必凑满。`
          : "";
      const sceneInput =
        (scene ? `【场景】${scene}\n\n` : "") +
        beatsHint +
        spoken +
        (built.volatile ? `\n\n${built.volatile}` : "") +
        wordsRule;
      /* 发出去＝存下来＝回喂（1.7.51）：把这一轮**真发出去的那一整份**（她那句话＋【场景】／
         【进度】那句命令／此刻那串易变尾巴）交回线下页，记在她这条记录上（见 OfflineEntry.apiText）。
         下一轮回喂原样送回，站子逐字比对才一路对得上，前缀缓存才连读；线上早有这一格
         （见 requestReply 那段），线下一直漏着，所以线下面板上那个断点永远落在此处。
         连发合并的那几条也一并交代（1.8.4）：`carryId` 承接正文、`foldedIds` 并进它。 */
      if (carryId) {
        onSent?.({ carryId, foldedIds, text: sceneInput, merged: spoken });
      }
      /* 字数上限换算成输出额度：一段 600 字中文留三倍余量，别让写到一半被截断。
         非流式那趟的 maxTokens 是形参（默认 800），这里显式给它。 */
      const maxTokens = Math.max(1200, words.max * 3);
      /* 「查看本轮请求」留档（1.7.49）：线下这一轮也记一份（与线上同一套面板）。 */
      recordRequest({
        mode: "offline",
        model: effTextApi.model,
        stream: effTextApi.stream !== false,
        sections: built.sections,
        activated: built.activatedEntries.map((a) => ({
          book: a.book,
          title: a.entry.title,
          by: a.by,
        })),
        full: outgoingContents(system, apiHistory, sceneInput),
      });
      /* 线下这一段比线上一条长得多，流式开关照文本 API 的配置走（跟线上同一个口径）。 */
      if (effTextApi.stream !== false) {
        return fetchAIStreamReply(
          effTextApi,
          system,
          apiHistory,
          sceneInput,
          onDelta,
          { signal, maxTokens },
        );
      }
      return fetchAIReply(
        effTextApi,
        system,
        apiHistory,
        sceneInput,
        undefined,
        maxTokens,
        undefined,
        signal,
      );
    },
    [
      effTextApi,
      conv,
      character.id,
      character.categoryId,
      character.data,
      maskId,
      mask,
      myName,
      charName,
      userSignature,
      memory,
      recordRequest,
    ],
  );

  /* ---------- 每聊天设定 ---------- */
  const applyPatch = useCallback(
    async (patch: ConversationPatch) => {
      const next = await updateConversation(character.id, maskId, patch);
      setConv(next);
      onDataChange();
    },
    [character.id, maskId, onDataChange],
  );

  /* 外语聊天（1.9.50）：「点一下才翻」的那几处（名字下方的签名、心声页）共用的翻译入口。
     先查会话上的译文缓存 → 没有就翻一次 → 写回缓存。翻过的那句以后再点就是瞬间切，
     既不等待也不再花钱（恩熙：「会不会有延迟」——只有第一次点要等零点几秒）。
     并发合并：两处几乎同时翻时，各自手里的旧缓存会互相盖；用一支 ref 兜住最新的那份。 */
  const transCacheRef = useRef<Record<string, string>>({});
  useEffect(() => {
    transCacheRef.current = conv?.transCache ?? {};
  }, [conv?.transCache]);
  const translateCached = useCallback(
    async (src: string): Promise<string | undefined> => {
      const key = src.trim();
      if (!key) return undefined;
      const hit = conv?.transCache?.[key];
      if (hit) return hit;
      if (!translateApi.enabled || translateApi.baseUrl.trim() === "" || translateApi.model.trim() === "") {
        return undefined;
      }
      try {
        const t = await translateText(translateApi, key, "中文");
        if (!t || t === key) return undefined;
        const merged = { ...transCacheRef.current, [key]: t };
        transCacheRef.current = merged;
        await applyPatch({ transCache: merged });
        return t;
      } catch {
        return undefined;
      }
    },
    [conv, translateApi, applyPatch],
  );

  /* 签名（1.9.50）：他现在是日本人，签名也用外语写；名字下方那一行**点一下切中文**。
     提前翻好存着——就一行、很少变，翻一次几乎不花钱，点的时候却零等待。 */
  useEffect(() => {
    if (!conv?.translate?.out.on) return;
    const sig = conv.signature?.trim();
    if (!sig || conv.transCache?.[sig]) return;
    void translateCached(sig);
  }, [conv?.translate?.out.on, conv?.signature, conv?.transCache, translateCached]);

  const clearMessages = useCallback(async () => {
    /* 1.7.39：这个函数代劳的比名字多——`clearConversation` 里顺手把**线下那一场记录**
       也倒掉了，并把「这一场开着」的总闸放平（恩熙：清记忆要「线上线下的一块清」）。
       所以下面还得把会话读回来、把线下那一页收掉，不然手上这份 conv 还留着
       `offlineOpen: true`，线上那格会一直锁着。 */
    await clearConversation(character.id, maskId);
    /* 聊天记录清空＝这些图再没人引用，仓库里的一并收回（否则仓库只进不出）。 */
    for (const m of messages) releaseImageAsset(m.imageUrl);
    /* 清空聊天＝从头来过：记忆（长期＋核心＋计数）一并清掉。 */
    await deleteMemory(character.id, maskId);
    /* 再兜一遍全体：历年断链的孤儿图（真删好友、换掉的参考图与卡面、老版本漏收的）
       也一并收走，储存体检里那个数字才真的会掉下来（见 media-sweep）。 */
    const swept = await sweepOrphanMedia();
    const next = await getOrCreateConversation(character.id, maskId);
    setConv(next);
    setShowOffline(false);
    setMemory(null);
    setMessages([]);
    onDataChange();
    showToast(
      swept.removed > 0 ? `已清空聊天记录，另收走 ${swept.removed} 张没人用的图` : "已清空聊天记录",
    );
  }, [character.id, maskId, messages, onDataChange, showToast]);

  /* ---------- 拉黑／删除好友（聊天设置危险区） ---------- */

  /** 重新拉取会话（社交动作会追加系统消息与 TA 的反应，本地要跟上）。 */
  const refreshConv = useCallback(async () => {
    const c = await getOrCreateConversation(character.id, maskId);
    setConv(c);
    setMessages(c.messages);
    scrollBottom();
    onDataChange();
  }, [character.id, maskId, scrollBottom, onDataChange]);

  /* 拉黑／解除要像正常开关：点了立刻生效（状态＋系统提示先落库、先刷屏），
     TA 的第一反应走一次文本 API、在后台慢慢写，落库完再刷一屏把话冒出来——开关不等它。 */
  const toggleBlocked = useCallback(
    async (next: boolean) => {
      if (!conv) return;
      if (next) {
        showToast("已加入黑名单");
        await blockFriend(character, conv);
        await refreshConv();
        void blockedFirstReaction(character, conv, myName).finally(() => {
          void refreshConv();
        });
      } else {
        showToast("已解除黑名单");
        await unblockFriend(character, conv);
        await refreshConv();
        void unblockedFirstReaction(character, conv, myName).finally(() => {
          void refreshConv();
        });
      }
    },
    [character, conv, myName, refreshConv, showToast],
  );

  const deleteFriendFromChat = useCallback(async () => {
    await removeFriend(character.id, maskId);
    onDataChange();
    /* 删了好友这间屋子就彻底不要了：让外面把挂载撤掉（不是藏起来）。 */
    (onDismiss ?? onBack)();
  }, [character.id, maskId, onDataChange, onDismiss, onBack]);

  /** 彻底删除：记录与记忆一并清掉，跟「暂时删除」同一个收尾（整间卸载）。 */
  const hardDeleteFriendFromChat = useCallback(async () => {
    await hardDeleteFriend(character.id, maskId);
    onDataChange();
    (onDismiss ?? onBack)();
  }, [character.id, maskId, onDataChange, onDismiss, onBack]);

  /* ---------- 输入框自动增高 ---------- */
  /* 只量高度，不写 state（草稿非受控，见 sendMsg）——打字不再引起重渲染。
     1.7.40：`scrollHeight` 含上下 padding（CSSOM 口径），要减掉才不多算——
     输入框 padding 是「6px 4px」，不减就凭空多 12px，刚打一个字框就想长成两行。
     改法与线下页那套（OfflineScenePage 的 autoGrow）一致。 */
  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const t = e.target;
    t.style.height = "auto";
    const pad = t.offsetHeight - t.clientHeight;
    t.style.height = `${Math.min(t.scrollHeight - pad, 106)}px`;
  };

  /* ---------- 消息体渲染 ---------- */
  const renderBody = (m: ChatMessage): ReactNode => {
    switch (m.type) {
      case "image":
        /* 真图（图文 API 生成）：点开看大图；加载失败（旧图链接过期等）在气泡里给出重新生成的出路。 */
        if (m.imageUrl) {
          return (
            <ImageBubble
              src={m.imageUrl}
              alt={m.content || "图片"}
              onOpen={() => {
                setViewerCap(m.content);
                setViewerImg(m.imageUrl!);
                setShowViewer(true);
              }}
              onRegen={m.role === "user" ? undefined : () => void regenerateMedia(m)}
            />
          );
        }
        /* 生成中：占位框（画面描述 + 呼吸动画），生成完成原位填入真图。
           生图按次计费，等多久该由用户定：「已等 X 分 Y 秒」写在框里，
           等够了点「不等了」自己中断（只有用户点才算断，见 chatApi）。 */
        if (m.pending) {
          /* 「自动生成」关着时的样子：画面描述已经到了，但还没开画。
             只给一颗「生成」——想发就点，不想发就搁着，本来也不需要「不发」这颗按钮。
             不点＝不花钱。 */
          if (m.awaitGen) {
            return (
              <div style={{ width: FILM_CELL_W }}>
                {/* 画面描述印在胶片画格里：没出图之前，这条消息就先长这样；
                    生成完这一格整个换成图。 */}
                <PhotoPaper
                  footer={
                    /* 「生成」落在画格下面那条片基上：画格是描述自己的地盘，
                       按钮横在里头占一行、浮在角上又压字，索性放到画面外面这条深色片基上。
                       片基是暗的，所以这颗按钮走浅底深字。 */
                    <button
                      type="button"
                      onClick={() => void regenerateMedia(m)}
                      style={{
                        padding: "2px 12px",
                        borderRadius: 999,
                        border: "none",
                        background: "rgba(255,255,255,.92)",
                        fontSize: 10.5,
                        lineHeight: 1.5,
                        color: "#8E4867",
                        cursor: "pointer",
                      }}
                    >
                      生成
                    </button>
                  }
                >
                  {m.content ? (
                    <PaperCaption
                      text={m.content}
                      /* 描述前面那枚小引号，意思是「这儿写的是一段被说出来的画面」——
                         现在它跟着字走、落在版心左下，不再是浮在画格正中一个孤零零的标点。 */
                      lead={
                        <Quote
                          size={15}
                          strokeWidth={1.5}
                          color={T.pink}
                          style={{ opacity: 0.38, marginBottom: 4, flexShrink: 0 }}
                        />
                      }
                    />
                  ) : null}
                </PhotoPaper>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 10,
                    lineHeight: 1.6,
                    color: T.ink3,
                  }}
                >
                  生图一张算一次钱。点「生成」才画；不点就不发。
                </div>
              </div>
            );
          }
          const waited = imageElapsed[m.id] ?? 0;
          return (
            <div style={{ width: FILM_CELL_W }}>
              <PhotoPaper shimmer>
                {/* 还在画：描述仍是主角（压暗一点、只留三行当背景），下面挂秒表与「不等了」。 */}
                {m.content ? <PaperCaption text={m.content} dim maxLines={3} /> : null}
                <span style={{ flexShrink: 0, fontSize: 10.5, color: T.ink3, letterSpacing: ".12em" }}>
                  图片生成中…
                </span>
                <span style={{ flexShrink: 0, fontSize: 10.5, color: T.ink3, letterSpacing: ".08em" }}>
                  已等 {formatWait(waited)}
                </span>
                <button
                  type="button"
                  onClick={() => cancelImageGen(m.id)}
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    padding: "3px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(232,106,155,.55)",
                    background: T.card,
                    fontSize: 10.5,
                    color: T.ink2,
                    cursor: "pointer",
                  }}
                >
                  不等了
                </button>
              </PhotoPaper>
              <div
                style={{
                marginTop: 5,
                fontSize: 10,
                lineHeight: 1.6,
                color: T.ink3,
              }}
            >
              {/* 等久了得说清「这不是你卡了，是站点没回音」——否则等三分多钟只剩一句
                  「生成中…」，谁也看不出到底在等什么、钱花了没有。 */}
              {waited >= 120
                ? "已经等了两分多钟：多半是站点那边没回音了（它也可能仍在画）。想收场就点「不等了」——这一单到底计没计费，只有它回话才知道。"
                : "生图一张算一次钱。等太久了可以点「不等了」；再发一次＝新的一单。"}
              </div>
            </div>
          );
        }
        /* 生成失败：占位保留，点击重新生成；失败原因留在下面。
           原因单独放在可点区域之外，且可选中——生图按次扣费，看不全原因就只能反复白试。 */
        if (m.error) {
          const editing = imageDraft?.id === m.id;
          return (
            <div style={{ width: FILM_CELL_W }}>
              {/* 出错也是同一格胶片，只是画格换成淡红提示。
                  正在改描述就别让画面也触发重发，免得把刚敲的字丢了。 */}
              <PhotoPaper
                tone="error"
                onClick={editing ? undefined : () => void regenerateMedia(m)}
              >
                {/* 描述是这张纸的主角，出错也得留在纸面上：
                    失败态只画「图片没发出来」时，描述一藏，看着就像这条消息把内容丢了
                    ——对着一张空纸根本想不起让它画的是哪一版。 */}
                {m.content ? <PaperCaption text={m.content} /> : null}
                <span
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    color: T.danger,
                  }}
                >
                  <ImageIcon size={13} strokeWidth={1.4} color={T.danger} />
                  图片没发出来
                </span>
                <span style={{ flexShrink: 0, fontSize: 10.5, color: T.ink3, letterSpacing: ".08em" }}>
                  {editing ? "改完再生成" : "点击重新生成"}
                </span>
              </PhotoPaper>
              {/* 失败原因多半是描述本身不合规（同一个描述反复撞墙），所以给一个改口子的地方：
                  改完的文字写回这条消息——气泡、重试、历史回喂从此都用新的那一版。 */}
              {editing ? (
                <div style={{ marginTop: 6 }}>
                  <textarea
                    value={imageDraft.text}
                    onChange={(e) => setImageDraft({ id: m.id, text: e.target.value })}
                    placeholder="画面描述"
                    rows={6}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "6px 8px",
                      fontSize: 11,
                      lineHeight: 1.65,
                      fontFamily: "inherit",
                      color: T.ink,
                      // 底色统一走粉白底（T.bg）
                      background: T.bg,
                      border: `1px solid ${T.line}`,
                      borderRadius: 4,
                      resize: "vertical",
                      outline: "none",
                      userSelect: "text",
                      WebkitUserSelect: "text",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const text = imageDraft.text.trim();
                        if (!text) {
                          showToast("描述不能空着");
                          return;
                        }
                        setImageDraft(null);
                        void regenerateMedia({ ...m, content: text });
                      }}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        borderRadius: 12,
                        border: "1px solid rgba(232,106,155,.55)",
                        background: "rgba(232,106,155,.12)",
                        fontSize: 11,
                        color: T.ink,
                        cursor: "pointer",
                      }}
                    >
                      重新生成
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageDraft(null)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 12,
                        border: "1px solid rgba(232,106,155,.45)",
                        background: T.card,
                        fontSize: 11,
                        color: T.ink2,
                        cursor: "pointer",
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setImageDraft({ id: m.id, text: m.content })}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    padding: "5px 0",
                    borderRadius: 12,
                    border: "1px solid rgba(232,106,155,.55)",
                    background: T.card,
                    fontSize: 10.5,
                    color: T.ink2,
                    cursor: "pointer",
                  }}
                >
                  改描述再生成
                </button>
              )}
              {/* 请求已经发出去了（超时／断连／自己取消）：对方可能已经在画甚至已经扣费，
                  这里必须点明——重发一次就是又一单，别让用户以为是白点。 */}
              {m.errorText?.includes("对方可能") ? (
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 10,
                    lineHeight: 1.6,
                    color: T.danger,
                    opacity: 0.85,
                  }}
                >
                  这次请求已经发出去了，对方可能已经画好并计费——重发算新的一单。
                </div>
              ) : null}
              {m.errorText ? (
                <div
                  style={{
                    marginTop: 6,
                    maxHeight: 108,
                    overflowY: "auto",
                    fontSize: 10.5,
                    lineHeight: 1.65,
                    color: T.ink3,
                    wordBreak: "break-all",
                    userSelect: "text",
                    WebkitUserSelect: "text",
                  }}
                >
                  {m.errorText}
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <PhotoPaper
            onClick={() => {
              setViewerCap(m.content);
              setViewerImg("");
              setShowViewer(true);
            }}
          >
            <PaperCaption text={m.content || "图片生成中…"} />
          </PhotoPaper>
        );
      case "voice": {
        /* 合成中：占位小气泡（跳动的声波）。 */
        if (m.pending) {
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(232,106,155,.07)",
                border: "1px dashed rgba(232,106,155,.35)",
              }}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    background: "rgba(232,106,155,.55)",
                    animation: `vp 1s ${i * 0.12}s infinite`,
                  }}
                />
              ))}
              <span style={{ fontSize: 11, color: T.ink3, letterSpacing: ".08em" }}>
                语音合成中…
              </span>
            </div>
          );
        }
        /* 合成失败：点击重新生成。 */
        if (m.error) {
          return (
            <div
              onClick={() => void regenerateMedia(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(229,72,77,.05)",
                border: `1px solid rgba(229,72,77,.45)`,
                cursor: "pointer",
              }}
            >
              <Mic size={16} strokeWidth={1.6} color={T.danger} />
              <span style={{ fontSize: 11.5, color: T.danger }}>语音没发出来</span>
              <span style={{ fontSize: 10.5, color: T.ink3, letterSpacing: ".08em" }}>
                点击重试
              </span>
            </div>
          );
        }
        /* 旧版语音（音频本体没存下来）：点一下重新合成。 */
        if (!m.audioUrl) {
          return (
            <div
              onClick={() => void regenerateMedia(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(232,106,155,.06)",
                border: "1px dashed rgba(232,106,155,.45)",
                cursor: "pointer",
              }}
            >
              <Mic size={16} strokeWidth={1.6} color={T.pink} />
              <span style={{ fontSize: 11.5, color: T.ink2 }}>语音已失效</span>
              <span style={{ fontSize: 10.5, color: T.ink3, letterSpacing: ".08em" }}>
                点击重新生成
              </span>
            </div>
          );
        }
        const durSec = m.duration || 5;
        const barCount = Math.min(40, Math.max(12, Math.round(durSec * 2.5)));
        const bars = Array.from({ length: barCount }, (_, i) => {
          const base = 8 + Math.sin(i * 0.6) * 6 + Math.cos(i * 1.1) * 4;
          return Math.max(4, Math.min(22, Math.round(base)));
        });
        const voiceWidth = Math.min(230, 90 + Math.min(60, durSec) * 2.5);
        const isPlaying = playingVoice === m.id;
        /* 真语音（语音 API 合成）：点播放键放真音频，播完自动回弹。 */
        const togglePlay = () => {
          if (!m.audioUrl) return;
          const audioUrl = m.audioUrl;
          /* 点同一条＝停。 */
          if (playingVoice === m.id && isVoiceElPlaying()) {
            stopVoiceEl();
            setPlayingVoice(null);
            return;
          }
          setPlayingVoice(m.id);
          setVoiceDiag(null);
          const end = () => setPlayingVoice(null);
          /* 只有媒体元素这一条路：用常驻复用的宿主 <audio> 直接放。 */
          void playVoiceViaElement(audioUrl, end).then((why) => {
            if (why) setVoiceDiag({ id: m.id, text: `${why} · v${APP_VERSION} · iOS ${iosVersion()}` });
          });
        };
        return (
          <div>
            <div
              onClick={togglePlay}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: voiceWidth,
                cursor: "pointer",
              }}
            >
              <button
                type="button"
                style={{
                  flex: "none",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: isPlaying ? "rgba(232,106,155,.2)" : "rgba(232,106,155,.1)",
                  color: T.pink,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  transition: "all .15s",
                }}
              >
                {isPlaying ? <Pause size={12} strokeWidth={1.8} /> : <Play size={12} strokeWidth={1.8} />}
              </button>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  height: 24,
                  overflow: "hidden",
                }}
              >
                {bars.map((h, i) => (
                  <i
                    key={i}
                    style={{
                      flex: 1,
                      maxWidth: 5,
                      minWidth: 2,
                      height: h,
                      background: isPlaying ? T.pink : T.ink3,
                      borderRadius: 1.5,
                      opacity: isPlaying ? 1 - i * 0.03 : 0.55,
                      animation: isPlaying ? `vp .85s ease-in-out ${i * 0.08}s infinite` : "none",
                      transformOrigin: "bottom",
                    }}
                  />
                ))}
              </div>
              <span style={{ flex: "none", fontSize: 11, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
                {durSec}″
              </span>
            </div>
            {voiceDiag && voiceDiag.id === m.id ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: T.ink3,
                  letterSpacing: ".02em",
                  wordBreak: "break-all",
                }}
              >
                {voiceDiag.text}
              </div>
            ) : null}
            {showTrans === m.id ? (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(232,106,155,.06)",
                  fontSize: 12,
                  color: T.ink2,
                  lineHeight: 1.6,
                  borderLeft: "2px solid rgba(232,106,155,.55)",
                }}
              >
                {m.audioUrl ? (
                  <>
                    {/* 1.9.56：「转文字」给的是**原文**——他说出口的那句话（外语聊天里就是外语），
                        中文译文这时先让开（气泡下方那行暂时不露），收起原文又恢复。
                        1.9.55 曾把这里改成默认给中文，方向反了，恩熙 2026-10-03 纠正回原文。 */}
                    <div style={{ fontSize: 10, letterSpacing: ".14em", color: T.ink3, marginBottom: 3 }}>
                      原文
                    </div>
                    <div>{m.content}</div>
                  </>
                ) : (
                  "转文字内容将在生成后显示。"
                )}
              </div>
            ) : null}
          </div>
        );
      }
      case "redpacket": {
        /* 1.4.89 整张换成微信那种「红纸封」（恩熙：「改红包的卡片样式以及详情界面，
           不能跟转账是同样的模式，就是参考微信红包的样式那种感觉」）——转账是纸票据、
           红包是红纸封，两个世界。卡＝一张带封面的红包：封面底（预设渐层或自定义图）
           ＋左上一枚圆章「開」＋祝福语＋状态小字；领过（他没领也一样）整张洗成淡色
           （一层 filter，封面是图也照洗——微信领过的红包也是这么整张发灰的）。
           状态字沿用 1.4.38／1.4.63 那套口径（点击领取／已领取／他没领…）。
           点开照旧走 setOpenMoney——点开的是开红包页（RedPacketModal），不再是白弹窗。
           卡面渲染挪去模块级的 RedPacketCard：自定义封面要用 useMediaSrc 读仓库，
           renderBody 的 switch 里不能挂 hook。 */
        return (
          <RedPacketCard
            m={m}
            charName={charName}
            myName={myName}
            onOpen={() => setOpenMoney(m)}
          />
        );
      }
      case "transfer": {
        /* 1.4.38 跟红包同一套口径（恩熙：「我转给他，他收取也会有卡片，然后颜色会变淡」）：
           没收下＝白纸卡粉边、金额粉；收下之后整张转灰白、字和边一起淡。
           1.4.41 起多一种落定法：「已退还」（他转给我、我退回去了）——它跟「已收下」
           一样是落定，所以底、字、边一起转灰白。
           1.4.51 起跟红包一起换成账册的料：方角、硬影、书写体标题、等宽金额。
           1.4.66 照她给的汇款单参考图一比一搬了一张票根（洋文对照标签、票号、通体虚线、
           铺满整条的状态带）；1.4.67 她说「你做的太像了，你做的一模一样，你不可以照抄呀」。
           ⇒ 抄了「形」就丢了自己的话。这一版把抄来的记号**全撤掉**，只留「一层一层铺开」
           这个方向，改用账册自己的话讲：顶上横头一道粉条、抬头一枚菱记＋书写体「转账」
           ＋角上一枚方向箭号；当事人一行写「谁 ──→ 谁」；金额居中大字，下面压一道短粉线；
           附言写成「附言 「…」」；状态落成右下角一枚方印。
           撤掉的：`自 / FROM`、`至 / TO`、`转账金额 / TOTAL AMOUNT`、`备注附言 / MEMO`
           四组中英对照，票号 `#xxxxx`，通体打孔虚线外框，整条铺满底色的状态带，
           印旁边那串洋文落款。
           1.4.69 她说「整体的框架是好的吧，但感觉不好看耶」——框架（横头／抬头／谁给谁／
           金额／附言／落款这五块和顺序）一字不动，只重铺一层料：纸面改暖白渐层；
           顶上那道横头改成自左向右淡下去的宽条；抬头「转账」加大加字距，右端箭号坐进
           一块淡粉方底；「谁给谁」那一行撤掉两条撑开的细线、整行居中；金额整块坐进一条
           淡粉色带（上缘以细线分栏）、数目加大；附言左缘加一道引注短线；落款方印加重。
           颜色与落定四态一字未动。
           1.4.71 她放开手：「你忘掉所有…你就做你喜欢的，你的审美…不一定颜色都要一样…
           也不用跟背景符合。」⇒ 第一版**由我定**：跳出账册那套，做成一张**墨底卡**
           （深墨渐层底／大圆角／柔和深影／左上一点极淡高光／暖金点缀／全左对齐）。
           她回「确实不好看，你能再给我第二版吗？可以跳脱这些设计。」⇒ 1.4.72 第二版
           整版翻过来（浅奶油便签／居中／青绿／轻影，详见下方变量那段注释）。
           她再回「太素了…主次关系没有分清楚…谁转给谁…以及备注…都很重要…希望他们都能
           结构上都有非常好的位置跟排版」⇒ 1.4.73 第三版：把五块东西**各自分栏**——
           淡青绿横头／双方圆徽名牌／上下带线的金额栏／淡底带竖线的留言格／上缘收尾的
           状态栏（详见下方变量那段注释）。
           她再回「这看着像机票。」⇒ 1.4.74 第四版：通栏横条＋两端对称的圆徽＋正中一枚箭，
           凑出来正是机票那条「起点 → 终点」的航段；这一版**把这些全撤掉**，只留一道左缘
           竖带、内容全左对齐、谁给谁写成一句话（详见下方变量那段注释）。
           她再回「请去掉竖带，改用更柔和的卡片风格」⇒ 1.4.75 第五版：那道 4px 竖带太硬太直，
           像夹了根书脊；这一版**撤掉竖带**，整张改回一张**柔软的纸卡**——圆角再放大、边线更淡、
           影子又大又轻、底色是一层斜向的极淡渐层（详见下方变量那段注释）。
           1.4.76 我停了手：连着五版她都说「不好看」，而「不好看」这三个字不含信息 ⇒ 做了一页
           临时样式台 `/card-lab`，把**四个大方向**摆出来让她指一个（详见施工日志第 476 条）。
           她指了「**更倾向于 A，但是觉得 A 太简陋了**」⇒ 1.4.77 第六版：**方向归 A（账册风），
           要解决的是「简陋」**——账册的料（方角、细边、硬影、书写体、等宽数字）她认，
           嫌的是里面**太薄**：一列小灰字平铺，没有头、没有签、没有栏。⇒ 照账册的写法把结构做厚
           （详见下方变量那段注释）。
           1.4.78 她看过重写的样式台，第一次给出明确的方向词「**票据**」（之前只说「不好看」）；
           1.4.79 顺手修了那页在手机上滚不动的问题（跟本卡无关，见施工日志 479）。
           ⇒ 1.4.80 第七版：她指了那四个品种里的 **B（存根票根）**，并附三条——**编号不要这么长**、
           **要像转账凭证一样有付款方跟收款人**、**可以大张一点**。这一版就照 B 做
           （详见下方变量那段注释）。
           （红包卡、receipt 卡都没动。） */
        const isFromMe = m.role === "user";
        const trRefunded = m.moneyRefunded === true;
        /* 过期（1.5.12）：我发出去、他一直没表态，聊天又往下走过上下文那么多条——
           这一笔作废、钱原路回我口袋（见 expireStaleMoney）。跟退还一样是「落定」，
           卡片一起转灰；只是记号跟话不一样。 */
        const trExpired = m.moneyExpired === true;
        const trDone = m.moneyClaimed === true || trRefunded || trExpired;
        const trFoot = trRefunded
          ? isFromMe
            ? "他已退还"
            : "已退还"
          : trExpired
            ? "已过期"
            : m.moneyClaimed === true
              ? isFromMe
                ? "他已经收下"
                : "已收下"
              : isFromMe
                ? "等他收下"
                : "点击收取";
        /* 票面上的「付款方／收款人」：我发的就是「我 → TA」，TA 发的反过来。 */
        const trFrom = isFromMe ? myName : charName;
        const trTo = isFromMe ? charName : myName;
        /* 1.4.71（第一版，她回「确实不好看」）——墨底卡：深墨渐层底／大圆角／柔和深影／
           左上一点极淡高光／暖金点缀／全左对齐（大号金额、一道淡下去的金线、右下角状态）。
           1.4.72（第二版，她回「太素了」）——整版翻过来：浅奶油便签、全部居中、重音青绿、
           影改轻、顶沿一枚青绿小签。
           1.4.73（第三版）——**给每一块东西自己的栏位**（她说「主次关系没有分清楚、
           谁转给谁跟备注也很重要、结构上要有非常好的位置跟排版」）。卡不再是一列居中
           小字，改成**一张分栏的便签**，从上到下五栏，栏与栏之间有细线／底色分开：
             ① 横头栏——通栏一条，淡青绿渐层底、下缘一道青绿细线，中间「转账」＋方向小箭；
             ② 名牌栏——**谁给谁升成一格**：两侧各一枚圆徽（浅青绿底、里头是名字第一个
                字），名字写在徽下、用实色（不再是淡灰小字），中间一枚青绿箭；
             ③ 金额栏——通栏一格，**上下各一条细线**把它框出来，金额仍是整张最重的一件；
             ④ 留言栏——有留言才有，**淡青绿底＋左缘一道青绿竖线**的一小块，像便签上贴的；
             ⑤ 状态栏——最底一栏，上缘一条细线收尾 ＋ 极淡底，未落定时一枚青绿小圆点。
           1.4.74（第四版，这一版）——她一句「这看着像机票」。病根不在颜色，在**结构**：
           通栏横条 ＋ 两端对称的圆徽 ＋ 正中一枚箭，这正好就是机票上「起点 → 终点」那条
           航段，再由道道横线把人切成几行，整张就成了登机牌。⇒ **把票味那几件全撤掉**：
           一条横线不留、一条通栏底色带不留、不要两端对称、不要正中的箭。
             ① 左缘一道通高 4px 青绿竖带（书脊）——全卡唯一的大块记号，落定转灰；
             ② 内容全左对齐：抬头行「转账」小字 ＋ 方向小箭（这一枚表示进／出，不是航段）；
             ③ 谁给谁写成一句话——「恩熙 转给 老公」：两头名字实色 13px/600、中间「转给」
                淡下去，像说话不像航段；
             ④ 金额 34px 左对齐坐在下面，整张最重，上下用留白呼吸（不再用线框）；
             ⑤ 留言一小块淡青绿底、圆角 8（撤掉那道左竖线，免得跟书脊重复）；
             ⑥ 状态最底一行：一枚小点／✓／↺ ＋ 小字，左对齐（撤掉上缘线与底色带）。
           落定口径一字未动：青绿转灰、字全淡、影撤掉。
           1.4.75（第五版，这一版）——她一句「请去掉竖带，改用更柔和的卡片风格」。那道 4px
           竖带虽然替全卡定了「里外」，但**又直又硬、贴死在左缘，像夹进去一根书脊**，跟「柔和」
           正相反。⇒ **撤掉竖带**，改回一张**软软的纸卡**，靠整张的软来托内容：
             ① 底色从「一块平色」换成**一层很斜很淡的渐层**（上白下奶），像纸受光，不是色块；
             ② 圆角 18 → 20，边线降到 `rgba(20,19,24,.05)`（几乎看不见，只留一点纸边）；
             ③ 影子改成**大而轻**的一层（`0 10px 26px -18px rgba(20,19,24,.30)`），
                不再贴着卡边、也不发黑——软的关键在影子散得开；
             ④ 内容仍全左对齐，但不再需要给竖带让位，内边距四边放匀（`15px 16px 14px`）；
             ⑤ 留言那块圆角 8 → 10、底色再淡一点（`rgba(46,139,117,.06)`），
                整张里就没有一处硬直的东西。
           落定口径仍一字未动：青绿转灰、字全淡、影撤掉（这张软卡落定后也收成一块平的灰纸）。
           1.4.77（第六版，这一版）——她看过 `/card-lab` 那四张，指了「**更倾向于 A，
           但是觉得 A 太简陋了**」。信息两条：**方向收在 A（账册风）**；**要治的是「简陋」**。
           前五版我一直在换「料」（换色、换角、换影），可她说 A「简陋」时 A 用的就是账册的料
           ——**可见她认这个料，嫌的是里面太薄**。⇒ 这一版**把料全换成账册那套**，力气全花在
           **「砌厚」**上，照着红包卡那张同门账页的骨架来（它从没被她嫌弃过）：
             ① 料回账册：白纸底、方角（`borderRadius: 0`）、1px 细边、`WALLET_PAPER_SHADOW`
                那层硬边错位影；落定后底转灰白 `#FAF8F9`、边淡、影撤（跟红包卡同一套口径）；
             ② **加了头**：左上**一枚 32×32 方签**（淡青绿底里兜着那枚进出方向箭），右边两行
                ——书写体「转账」＋下面一行「谁 转给 谁」（名字实色 600）——**有签有题**，
                不再是一行干灰字开头；
             ③ **金额自己占一栏**：从「跟人挤在同一列里」升出来，上下留足呼吸，28px 等宽
                数字、`¥` 青绿，整张最重；
             ④ **附言有自己的格子**：一小块极淡青绿底（方角），左上角一枚「附言」小标签
                （等宽 9px 加字距），下面才是话——**归属**（1.4.73 她说的那个词）；
             ⑤ **落款栏**：上缘一条细线收尾，左端等宽小字写状态，右端一枚记号——还在等
                是一枚**方角**小点（账册不做圆的），收下变 ✓、退还变 ↺。
           宽度 228 → 204（比红包卡那张 196 略宽，好放更大的金额，但仍是同一家人的方角账页）。
           落定口径仍一字未动：青绿转灰、字全淡、影撤掉。
           1.4.80（第七版，这一版）——她看完 `/card-lab` 那一页，指了 **B（存根票根）**，
           并提三条：① 右上角编号不要这么长；② 要像转账凭证那样**有付款方跟收款人**；
           ③ 可以**大张一点**，不必这么小张。⇒ 整张**照 B 重做**，三条逐条落：
             ① 纸：偏暖的米白 `#FCFAF6`（不再用账册那张纯白纸）；右缘不封边——那道边交给
                右侧一排 **7px 的撕口齿**（透明底 ＋ 一枚枚纸色的半圆，像从存根上撕下来的）；
                宽度 204 → **240**（大张一点）；
             ② 抬头：左端书写体「**转账存根**」（B 的名字就写在这儿），右端一枚**短编号**
                ——原先一串「NO. 年月日-金额」她嫌长，改成从这条消息的时间戳取**末四位**；
             ③ 中段改成**付款方／收款人各占一行**（等宽小字名目 ＋ 实色名字，左边对齐成一栏），
                这正是她要的「像转账凭证」；上下各一道**虚线**分段（B 的分段法），
                不再用账册的细实线；
             ④ 金额仍是整张最重（大号等宽数字），附言仍是金额下一行小字；
             ⑤ 落款仍在最底一道虚线之下（左端等宽小字写状态、右端一枚记号）。
           撤掉的：那枚兜在方签里的进出方向箭（`TrArrow`）——方向这件事现在由「付款方／
           收款人」两行说清楚，不再需要一枚箭；连带 `ArrowUpRight／ArrowDownLeft` 两个图标
           也从这个文件里撤了。
           落定口径仍一字未动：青绿转灰、字全淡、影撤掉（这张票根落定后收成一块平的暖灰纸，
           撕口齿也跟着换色——那排齿的颜色是从纸色算出来的）。
           1.4.82（第八版，这一版）——她一次提了四条：
             「整体再缩小一点」／「转账方跟收款方应该都会有这个卡片的」／「收付款方的名字
             再往前一点、两行名字统一一下（太跳脱）」／「整体颜色不要绿要粉，名字可以用蓝，
             名字跟金额用不同颜色区分一下」。逐条落：
             ① 宽 240 → **218**、内边距 12/14/11 → 11/13/10，全卡字号各降一档
                （金额 28 → 25、抬头 15 → 14、名字 12.5 → 11.5、状态 10.5 → 10）；
             ② **收款方那一联**（下面 `case "receipt"`）照这张票根的形制重做——同一张纸、
                同一条撕口齿、同一套「付款方／收款方」两行、同一处金额栏。从此一笔钱是
                「双方各持一联」，不再是「我一张票、他一张小灰卡」（那一联的注释写在它自己那儿）；
             ③ 名目那一栏 42 → 34、字距 .14em → .1em、同行间距 8 → 6：名字整体**往左挪**约 9px；
                两行的名字用同一个字号／字重／同一个色，不再一深一浅地跳；
             ④ 配色换过：青绿 `#2E8B75` 整条撤掉，改成——**金额与 ¥、落款的状态字与那枚记号
                全是粉**（`T.pink`）；**名字改蓝**（`#3A6FD8`），跟金额的粉分开，一眼分得清
                「谁」与「多少钱」；名目／编号／附言仍是灰。
               ⇒ 连带改了那条沿用六轮的落定口径：从前落定是**转灰**，这一版改成**褪色**
                （粉褪成淡粉、蓝褪成淡蓝，纸仍是那块平的暖灰纸）——她说不要绿要粉，落定后
                再收成一整块灰就跟这句话正拧着；褪色仍是「安静下来」，只是安静下来还是粉的。
           1.4.83（第九版，这一版）——她又提三条，全是「两行名字＋附言」这一带的微调：
             ① 「名字可以单独改个字体」⇒ 名字换成**宋体**（`SERIF`）——凭证上的人名就该是
                印刷宋体，跟等宽的名目、等宽的金额、无衬线的附言四种字摆在一起，名字自成
                一路；字重 600 → 500（思源宋体只装到 500，写 600 会被浏览器合成描边、糊）；
             ② 「再稍微贴近一点，付款方跟收款人」⇒ 名字跟前面的名目再贴近：名目那一栏
                34 → 30、行内间距 6 → 4（名字整列又往左挪了约 6px）；
             ③ 「备注那一栏底部有一层淡淡的阴影，稍微有一点区分」⇒ 附言那一行底下垫一层
                **极淡的粉底**（`trNoteBg`），跟纸面分开——票据上「备注」本来就是一格垫了
                底的栏；落定后那层底褪成极淡的灰。 */
        /* 1.4.82 起颜色三分工（她：「名字或者是金额可以有不同的颜色区分一下」）：
             · 金额与 ¥、落款的状态字与那枚记号＝**粉**（`trPink`）——钱这件事最亮；
             · 名字＝**蓝**（`trBlue`）——「谁」跟「多少钱」靠颜色分开，不用靠字重去挤；
             · 名目／编号／附言＝灰（`trSub`）。
           落定那一档：粉褪成淡粉、蓝褪成淡蓝（旧口径是整块转灰）。
           （原先那个 `trFg`（名字与金额共用的深墨）这一版用不上了，删掉。） */
        const trPink = trDone ? "#D9B3C0" : T.pink;
        const trBlue = trDone ? "#A9B2C4" : "#3A6FD8";
        const trSub = trDone ? "#C3BDB5" : "#8E8880";
        /* 1.4.83 附言底下垫的那层淡底：未落定是极淡的粉（跟金额那支粉同一族，只是淡到
           只是「一层底」），落定褪成极淡的灰（跟着整张一起安静下来）。 */
        const trNoteBg = trDone ? "rgba(20,19,24,.04)" : "rgba(232,106,155,.07)";
        /* 票根那张暖纸：落定后收成一块平的暖灰（跟其余两色一起退下去）。 */
        const trPaper = trDone ? "#F6F4F1" : "#FCFAF6";
        /* 票根的分段法：虚线。落定后虚线也跟着淡下去。 */
        const trDash = trDone ? "1px dashed rgba(20,19,24,.12)" : "1px dashed rgba(20,19,24,.22)";
        /* 票根右上角那枚编号（1.4.80）：她嫌原先「NO. 年月日-金额」太长。改成从这条消息的
           时间戳里取**末四位**——四位数字、短、每条不重样，仍是它自己的号。 */
        const trNoMs = Date.parse(m.createdAt);
        const trNo = `NO. ${Number.isFinite(trNoMs) ? String(trNoMs % 10000).padStart(4, "0") : "0000"}`;
        return (
          <div
            onClick={() => setOpenMoney(m)}
            style={{
              /* 1.4.80＝一张**存根票根**（她指的 B）：暖纸、方角、细边、硬边错位影。
                 右缘**不封边**——那道边交给右侧那排撕口齿（见本元素末尾那个绝对定位的齿）；
                 落定后整张转暖灰、影撤掉。1.4.82 起宽 240 → 218（她「整体再缩小一点」）。 */
              position: "relative",
              width: 218,
              background: trPaper,
              /* 边框全用具体属性、不用 border 简写：简写跟下面的 borderRight 混用
                 会触发 React 的样式冲突警告（rerender 时简写会把右边的 none 冲掉）。 */
              borderTop: `1px solid ${trDone ? "rgba(20,19,24,.07)" : T.line}`,
              borderRight: "none",
              borderBottom: `1px solid ${trDone ? "rgba(20,19,24,.07)" : T.line}`,
              borderLeft: `1px solid ${trDone ? "rgba(20,19,24,.07)" : T.line}`,
              borderRadius: 0,
              padding: "11px 13px 10px",
              cursor: "pointer",
              transition: "all .18s",
              boxShadow: trDone ? "none" : WALLET_PAPER_SHADOW,
            }}
          >
            {/* ① 抬头：左端「转账」二字＋右上角一枚短编号（四位数，见 trNo）。
                字体走宋体（SERIF）不走书写体——1.4.81 她说「希望还是看起来不要这么幼稚的字体」，
                宋体端正、像印刷的凭证抬头；书写体那一路只留给红包卡了
                （1.4.82 起收款回执也换成宋体——见下面 `case "receipt"`）。 */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: SERIF,
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: ".1em",
                  color: trDone ? T.ink3 : T.ink,
                  transition: "all .18s",
                }}
              >
                转账
              </span>
              <span
                style={{
                  flex: "none",
                  fontFamily: WALLET_MONO,
                  fontSize: 8.5,
                  letterSpacing: ".08em",
                  color: trSub,
                  whiteSpace: "nowrap",
                  transition: "all .18s",
                }}
              >
                {trNo}
              </span>
            </div>
            <div style={{ marginTop: 8, borderTop: trDash }} />
            {/* ② 付款方／收款方各占一行（1.4.80 她说「应该要像转账凭证一样，有个付款方跟
                收款人」）——名目用等宽小字、名字用实色，两行左边对齐成一栏；谁进谁出看
                这两行就明白，所以 1.4.80 把原先那枚方向箭撤了。
                1.4.82 她再说「名字再往前一点、两行名字统一一下，感觉太跳脱」：名目那一栏
                42 → 34、字距 .14em → .1em、同行间距 8 → 6，名字整列往左挪；两行的名字
                同一个字号／字重／同一个蓝，不再一深一浅。名目也从「付款方／收款人」改成
                **「付款方／收款方」**——她自己两次都说「收付款方」，一对一并排才不跳。
                1.4.83 她又说「名字单独改个字体、再稍微贴近一点付款方跟收款人」：
                名字换成**宋体**（`SERIF`，字重 500）——凭证上的人名就是印刷宋体，跟等宽
                名目、等宽金额、无衬线附言摆在一起自成一路；名目栏 34 → 30、行内间距
                6 → 4，名字又往左贴了一点。 */}
            <div style={{ marginTop: 9, display: "grid", gap: 6 }}>
              {[
                { k: "付款方", v: trFrom },
                { k: "收款方", v: trTo },
              ].map((row) => (
                <div key={row.k} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span
                    style={{
                      flex: "none",
                      width: 30,
                      fontFamily: WALLET_MONO,
                      fontSize: 9,
                      letterSpacing: ".1em",
                      color: trSub,
                      transition: "all .18s",
                    }}
                  >
                    {row.k}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: SERIF,
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: trBlue,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      transition: "all .18s",
                    }}
                  >
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 9, borderTop: trDash }} />
            {/* ③ 金额：整张最重的一件东西，自己占一栏、上下留足呼吸。
                1.4.82 起这一栏整条走粉（她「不要是绿色的，还是要粉色的」）——站在蓝名字
                对面，一眼分得清「谁」与「多少钱」。 */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 3,
                marginTop: 10,
              }}
            >
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 13,
                  fontWeight: 500,
                  color: trPink,
                  transition: "all .18s",
                }}
              >
                ¥
              </span>
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 25,
                  fontWeight: 700,
                  color: trPink,
                  lineHeight: 1,
                  letterSpacing: "-.01em",
                  transition: "all .18s",
                }}
              >
                {m.amount?.toFixed(2) || "0.00"}
              </span>
            </div>
            {/* ④ 附言：有留言才有——票根上就是金额下面一行小字（B 的写法，不再给它一块底色格）。
                1.4.83 她说「备注那一栏底部有一层淡淡的阴影，稍微有一点区分」⇒ 给它垫一层
                极淡的粉底（`trNoteBg`）＋ 上下左右一点内衬，跟纸面分开——票据上的「备注」
                本来就是一格垫了底的栏；方角跟整张一致，落定后那层底褪成极淡的灰。 */}
            {m.content.trim() ? (
              <div
                style={{
                  marginTop: 8,
                  background: trNoteBg,
                  padding: "4px 7px",
                  fontFamily: SANS,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: trSub,
                  transition: "all .18s",
                }}
              >
                {m.content}
              </div>
            ) : null}
            {/* ⑤ 落款：最底一道虚线之下（票根的分段法），左端等宽小字写状态，
                右端一枚记号——还在等的时候是一枚小点，收下变 ✓、退还变 ↺。
                1.4.82 起这一栏跟金额同一支粉（不再用青绿）。 */}
            <div
              style={{
                marginTop: 9,
                paddingTop: 6,
                borderTop: trDash,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "all .18s",
              }}
            >
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 10,
                  color: trPink,
                  letterSpacing: ".06em",
                  transition: "all .18s",
                }}
              >
                {trFoot}
              </span>
              {trRefunded ? (
                <RotateCcw size={11} strokeWidth={2} color={trPink} />
              ) : trExpired ? (
                <Clock size={11} strokeWidth={2} color={trPink} />
              ) : trDone ? (
                <Check size={11} strokeWidth={2.2} color={trPink} />
              ) : (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    background: trPink,
                    transition: "all .18s",
                  }}
                />
              )}
            </div>
            {/* 右沿那排撕口齿（B 的那道撕口）：透明底 ＋ 一枚枚**纸色**的半圆，看着像从存根上
                撕下来的边。它压在纸的右缘之外 7px（所以纸宽 218、整张看到 225），
                颜色从 `trPaper` 算出来——落定后纸转暖灰，这排齿跟着一起转。 */}
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: -7,
                width: 7,
                backgroundImage: `radial-gradient(circle at 0 7px, ${trPaper} 0 6px, transparent 6.5px)`,
                backgroundSize: "7px 14px",
                backgroundRepeat: "repeat-y",
              }}
            />
          </div>
        );
      }
      case "receipt": {
        /* 收款回执（1.4.40）：钱到账之后，收款方发出的那一联（恩熙：「他接受转账了，
           我的卡片变暗，并且他会发出一个他接受转账的卡片」）。
           1.4.82 她看着聊天里「一张票 ＋ 一张小灰卡」说「转账方跟收款方应该都会有这个
           卡片的」⇒ 这一联**照转账那张票根的形制重做**：同一张暖纸、同一条右沿撕口齿、
           同一套「付款方／收款方」两行、同一处金额栏、同一种宋体抬头、同一个宽 218——
           一笔钱从此是「**双方各持一联**」，摆在一串里是一家人。
           两联的分工只靠**抬头那两个字**（「转账」／「收款」／「退还」）和落款那行字分。
           这一联说的永远是「钱已经到这儿了」，所以它不挂那层硬影（影是「还在等」的紧张感，
           回执不紧张）。
           1.4.85 恩熙：「不论是转账方还是收款方还是退回方，都要明显的变暗，不是只有
           单一方会变暗」——⇒ 这一联**整张取转账卡的落定档**：它一出生这笔钱就定了
           （收下／退这个动作已经发生），没有「还在等」的那一档，所以纸是那块平的暖灰、
           粉是淡粉、蓝是淡蓝，跟落定后的转账那联**一样暗**。1.4.82 那句「回执不褪色」
           的旧口径就此作废——两联一张暗一张亮，摆在一起不像同一笔钱。
           内容全靠 m 自己身上那两个字段推：role＝**收款方是谁**（见 buildReceiptMsg 的注释），
           所以付款方就是另一侧；退还那张同理（退还方＝role、付款方＝另一侧，见 1.4.41）。
           旧形制（灰白底、左缘 4px 编目条、斜体小英文 RECEIVED）这一版整条撤掉。 */
        const recRefunded = (m.content || "已收款") === "已退还";
        /* 抬头跟转账那张一样是两个字的宋体名词（1.4.81 那次换宋体的道理：凭证抬头要端正，
           书写体那一路只留给红包卡）。 */
        const recTitle = recRefunded ? "退还" : "收款";
        const recTo = m.role === "user" ? myName : charName;
        const recFrom = m.role === "user" ? charName : myName;
        /* 编号跟转账那一联是**同一个号**（1.4.84 恩熙：「收取跟退还，它右上角那个数字
           应该是编号，是一样的呀」）——取的是 `payAt`（原转账那条的时间戳，buildReceiptMsg
           落库时抄的）；1.4.84 之前的老回执没这格，兜底用它自己的时间（老回执两联对不上
           属正常，新出的转账起就都是同一个号了）。 */
        const recNoMs = Date.parse(m.payAt ?? m.createdAt);
        const recNo = `NO. ${Number.isFinite(recNoMs) ? String(recNoMs % 10000).padStart(4, "0") : "0000"}`;
        /* 1.4.85 起，回执永远是「落定那一档」（值与转账卡的 trDone 档一字不差，改那边的
           落定色时这里要跟着一起改）：纸＝平暖灰、粉＝淡粉、蓝＝淡蓝、灰＝更淡的灰、
           虚线也更淡。两联落定后摆在一起一样暗。 */
        const recPaper = "#F6F4F1";
        const recPink = "#D9B3C0";
        const recBlue = "#A9B2C4";
        const recSub = "#C3BDB5";
        const recDash = "1px dashed rgba(20,19,24,.12)";
        return (
          <div
            /* 1.4.86 恩熙：「不论我点的是收款方的记录，还是转账方的记录，我都可以点进去
               看详情」——回执这一联也挂上点开（面板那边给它单开了一套回执版的详情，
               不会再把回执当「他发来的转账」、也不会冒出收下／退还的按钮）。 */
            onClick={() => setOpenMoney(m)}
            style={{
              position: "relative",
              width: 218,
              background: recPaper,
              /* 同上：border 简写＋borderRight 混用会触发 React 样式冲突警告，拆成具体的。 */
              borderTop: "1px solid rgba(20,19,24,.07)",
              borderRight: "none",
              borderBottom: "1px solid rgba(20,19,24,.07)",
              borderLeft: "1px solid rgba(20,19,24,.07)",
              borderRadius: 0,
              padding: "11px 13px 10px",
              cursor: "pointer",
            }}
          >
            {/* ① 抬头：与转账那张同一处格式——左端两个字的宋体名词、右上一枚短编号。 */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: SERIF,
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: ".1em",
                  color: T.ink3,
                }}
              >
                {recTitle}
              </span>
              <span
                style={{
                  flex: "none",
                  fontFamily: WALLET_MONO,
                  fontSize: 8.5,
                  letterSpacing: ".08em",
                  color: recSub,
                  whiteSpace: "nowrap",
                }}
              >
                {recNo}
              </span>
            </div>
            <div style={{ marginTop: 8, borderTop: recDash }} />
            {/* ② 付款方／收款方：跟转账那张一个字都不差的两行（名目那一栏、间距、字号全同，
                1.4.83 起名字同样换宋体 500、名目栏 30、行内间距 4——两联改就得一起改，
                不然「一家人」就散了）。 */}
            <div style={{ marginTop: 9, display: "grid", gap: 6 }}>
              {[
                { k: "付款方", v: recFrom },
                { k: "收款方", v: recTo },
              ].map((row) => (
                <div key={row.k} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span
                    style={{
                      flex: "none",
                      width: 30,
                      fontFamily: WALLET_MONO,
                      fontSize: 9,
                      letterSpacing: ".1em",
                      color: recSub,
                    }}
                  >
                    {row.k}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: SERIF,
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: recBlue,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 9, borderTop: recDash }} />
            {/* ③ 金额：与转账那张同一个号、同一处栏（1.4.85 起也是同一个「落定档」的淡粉）。 */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 10 }}>
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 13,
                  fontWeight: 500,
                  color: recPink,
                }}
              >
                ¥
              </span>
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 25,
                  fontWeight: 700,
                  color: recPink,
                  lineHeight: 1,
                  letterSpacing: "-.01em",
                }}
              >
                {m.amount?.toFixed(2) || "0.00"}
              </span>
            </div>
            {/* ④ 落款：这张票根上**没有附言那一行**（m.content 那两个字已经当了抬头），
                所以一道虚线之后直接就是落款——左端写这笔钱落到了哪儿，右端一枚记号
                （退还那张是 ↺，跟转账卡的退还一个记号）。 */}
            <div
              style={{
                marginTop: 9,
                paddingTop: 6,
                borderTop: recDash,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 10,
                  color: recPink,
                  letterSpacing: ".06em",
                }}
              >
                {recRefunded ? "已退回对方" : "已存入零钱"}
              </span>
              {recRefunded ? (
                <RotateCcw size={11} strokeWidth={2} color={recPink} />
              ) : (
                <Check size={11} strokeWidth={2.2} color={recPink} />
              )}
            </div>
            {/* 右沿那排撕口齿：与转账那张同一条（颜色从纸色算出来的那道边；
                1.4.85 起纸是落定那块暖灰，齿也跟着是暖灰的）。 */}
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: -7,
                width: 7,
                backgroundImage: `radial-gradient(circle at 0 7px, ${recPaper} 0 6px, transparent 6.5px)`,
                backgroundSize: "7px 14px",
                backgroundRepeat: "repeat-y",
              }}
            />
          </div>
        );
      }
      case "file":
        return (
          <div
            onClick={() => showToast("打开文件 · 预览")}
            style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 206, cursor: "pointer" }}
          >
            <span
              style={{
                flex: "none",
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "rgba(232,106,155,.12)",
                color: T.pink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <File size={22} strokeWidth={1.5} />
            </span>
            <span style={{ flex: 1, minWidth: 0, position: "relative", height: 32 }}>
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 12.5,
                  letterSpacing: ".02em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                  lineHeight: "16px",
                }}
              >
                {m.fileName || m.content}
              </span>
              <span
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  fontSize: 9,
                  color: T.ink3,
                  letterSpacing: ".08em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: "12px",
                }}
              >
                {m.fileSize ? `${(m.fileSize / 1024 / 1024).toFixed(1)} MB · ` : ""}
                {msgTime(m.createdAt)}
              </span>
            </span>
          </div>
        );
      case "location":
        return (
          <div
            onClick={() => showToast("查看位置 · 预览")}
            style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 190, cursor: "pointer" }}
          >
            <span
              style={{
                flex: "none",
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "rgba(232,106,155,.1)",
                color: T.pink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MapPin size={22} strokeWidth={1.5} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12.5,
                  letterSpacing: ".03em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.content}
              </span>
              <span style={{ fontSize: 9.5, color: T.ink3, marginTop: 2, letterSpacing: ".16em", display: "block" }}>
                位置 · location
              </span>
            </span>
          </div>
        );
      default:
        /* 1.4.12 aiOutputDisplay 正则：只改 TA 文字气泡在屏幕上的样子，存档一字
           不动——关掉规则，旧消息立刻还原。我的气泡不走这里（userInput 只改
           送出去的，屏幕永远显示原文）。 */
        return (
          <span>
            {m.role === "assistant"
              ? applyRegexRules(m.content, "aiOutputDisplay", regexCtx, regexRules)
              : m.content}
          </span>
        );
    }
  };

  /* TA 气泡样式：真消息与流式预览共用同一份，保证「预览转正」零跳变。
     pre-wrap 只为清单消息（splitReply 保留了换行的「一、二、三」那种条目）
     服务——普通消息在拆条时换行就被当条边界切掉了，身上不带 \n，
     所以这条对它没有任何影响。
     边与影两处：
     ①边用粉调的 .22，不用 T.line（中性灰）——灰边压在白里发脏，跟整页的粉对不上；
       底改半透（1.5.52）之后这枚边还得把气泡的轮廓交代住，所以由 .13 提到 .22——
       不然白气泡坐到浅色壁纸上就没了边界。
     ②影用两层粉——贴身的 1px 定边界，
       底下 14px 的晕往后收（-8px 让它只落在气泡下缘外），气泡才像搁在纸上，
       而不是用笔在白底上画了个框。
     ⚠️ 半透是 1.5.52（恩熙说「角色的也可以变成这种半透明的感觉吗」）加的：
       底换成 alpha .72 的白——跟她自己那侧（第 553 条的 .70 粉）同一套口径，
       传了照片壁纸时壁纸从气泡里淡淡透上来。
       ①**不许上毛玻璃（backdrop-filter）**：一屏十几二十条，一屏多枚模糊在 iPhone 上会掉帧
         （globals.css 那条玻璃材质的警告：开销与面积成正比，别铺到一屏多枚）——只用 alpha。
       ②**alpha 不许再往下调**：这里坐的是深色字（T.ink），透太多就把壁纸的深浅直接拉到字底下，
         字跟照片的花纹打架。1.5.53：恩熙说「角色的有点太透」，由 .72 收到 .86——
         白底坐深色字本来就比粉底坐白字更吃透，不再跟她那侧的 .70 强行对齐。
       ③两处顺带：影收一档（.07→.05、.30→.22，半透的底再压重影就又透出暗斑），
         补一道极淡的白文字影帮深色字从照片里浮出来；渐变幅度保留（幅度一小整块就塌成一张平纸）。
       ④字体（1.7.20）：正文换**宋体**（`SERIF`＝站内自托管的思源宋，零新增加载）——
         气泡里「说出口的话」读起来像写下来的，跟黑体的界面（按钮、列表、设置）拉开一层；
         **只动气泡这一层、UI 一律不动**。行距同时由 1.55 提到 1.65：
         宋体比黑体紧、笔画又细，不提会显挤显薄。字号在 fontSize（默认那档已同步提到 13.5）。 */
  const assistantBubbleStyle: CSSProperties = {
    position: "relative",
    background: "#FFFFFF",
    borderRadius: 8,
    padding: "5px 8px",
    fontFamily: SERIF,
    fontSize,
    lineHeight: 1.75,
    letterSpacing: ".02em",
    color: T.ink,
    boxShadow: "2px 2px 0 rgba(20,19,24,.10)",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  };

  /* 分组判定：同一个人的连发算作一组；系统提示、跨天都要断开。
     组首挂头像、组尾挂时间／已读，组内其余行留空位对齐，不按每条各挂头像、
     各缀一行时间的老骨架排。 */
  const isSysMsg = (x?: ChatMessage) => !!x && (x.role === "system" || x.type === "system");
  const sameGroup = (a?: ChatMessage, b?: ChatMessage) =>
    !!a && !!b && !isSysMsg(a) && !isSysMsg(b) && a.role === b.role && sameDay(a.createdAt, b.createdAt);

  /* 组内不再重复挂头像，留一个与头像等宽的空位，保证气泡边线仍然对齐。
     消息行与流式预览共用这一枚空位——两边的间距判据必须是一套，
     流式那边若另排一套，第一条跟第二条气泡之间的间距就会不一致。 */
  const avatarSpacerEl = <div style={{ width: 38, flex: "none" }} />;

  /* 组首那枚头像**不许撑高它所在这一行**。气泡通常比头像矮，两者顶对齐时
     行高就被 38px 的头像顶住，气泡底下白白空出 3～5px——于是「组首→第二条」永远比组内
     其余几处松。把头像改成绝对定位脱流，行高只由气泡说了算，组内每一处就都是同一个间距。 */
  const avatarSlotEl = (el: React.ReactNode) => (
    <div style={{ position: "relative", width: 38, flex: "none" }}>
      <div style={{ position: "absolute", top: 0, left: 0 }}>{el}</div>
    </div>
  );

  /* 拉黑期间 TA 冒出来的话，在 TA 那头一律显示「发送失败」——可我这边内容照样看得见，
     只在气泡旁边多挂一枚红感叹号。哪几条算「拉黑期间」，让聊天记录自己切：
     读到「加入黑名单」那条系统提示起、读到「已解除」那条止，中间的 TA 消息都算。
     这样不必往消息上另存字段，解除之后再翻回去，当时那几条红叹号也还在原处。 */
  const failedIds = new Set<string>();
  let inBlockedPeriod = false;
  for (const x of messages) {
    if (x.role === "system" || x.type === "system") {
      if (x.content.includes("加入黑名单")) inBlockedPeriod = true;
      else if (x.content.includes("已解除对")) inBlockedPeriod = false;
      continue;
    }
    if (inBlockedPeriod && x.role === "assistant") failedIds.add(x.id);
  }
  /* 流式预览那几条还没落库、不在 messages 里，只能用「此刻是不是还在拉黑期间」判。 */
  const blockedNowActive = inBlockedPeriod;

  /* 那枚红感叹号：红底白叹号的正圆，横挂在气泡右边、卡在**气泡自己**的竖直中线上。
     它记的是「TA 那边发送失败」，不是我这边的失败——所以不许挪到气泡左边，
     也不许跟时间／已读那些小字排在一行里。

     ⚠️ 叹号必须跟**气泡**一起装进同一条 flex 行（见 failMarkRowStyle），靠这一行居中；
     不许挂在整列上让它 alignSelf: "center"（2026-09-24 恩熙：「它应该是在每个气泡的正中间，
     不会偏下的」）。整列里除了气泡，上头还有「思考 ▾」那行、底下还有时间小字这一行，
     按整列算中线的结果就是被这两样往下拽——看着永远偏下，且气泡一高一低偏多少还不一样。 */
  const failMarkRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  };
  const failMarkEl = (
    <span
      style={{
        flex: "none",
        width: 17,
        height: 17,
        borderRadius: "50%",
        background: "#E64340",
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: "17px",
        textAlign: "center",
      }}
    >
      !
    </span>
  );

  /* ---------- 单条消息渲染 ---------- */
  const renderMsg = (m: ChatMessage, i?: number, arr: ChatMessage[] = messages) => {
    const groupedWithPrev = i !== undefined && i > 0 && sameGroup(arr[i - 1], m);
    const lastOfGroup = !(i !== undefined && sameGroup(m, arr[i + 1]));
    /* 组内行收紧一点：连发的几条贴成一叠，跟组间留白拉开层次。
       上下必须分开给——**组首只在「上方」撑开组间距、下沿跟组内一样收**，组尾反过来。
       组首行若上下同给 6px，于是「第一条→第二条」是 8px、「第二条→第三条」只有 4px，
       组内头一处永远比后面松一倍。
       数值：组内每一处 7px（上下各 3.5），组间 12px。组内收得太紧（如 4px）会显得跟组间
       没差别——层次要有，但别糊成一坨。 */
    const rowPadding = `${groupedWithPrev ? 3.5 : 6}px 14px ${lastOfGroup ? 6 : 3.5}px`;

    if (m.role === "system" || m.type === "system") {
      return (
        <div
          key={m.id}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "14px 16px 8px",
          }}
        >
          {/* 系统消息要一眼看清，不能跟背景融在一起：原来是一行 11.5px 的灰字（T.ink2）
              直接躺在壁纸上，底色是白时勉强认得出，一挂上照片壁纸就整条化进照片里——
              「已将某某加入黑名单」这种话，恰恰是最该让人一眼看清的。
              不要做成「一个框」——居中提示条、窄胶囊都一样，都是把话关起来。
              这里是一条**两端化开的浅粉墨带**——中间是一段实色的淡粉
              （#F9DFE9），往左右各化开一线宽就没了，没有边、没有圆角、没有阴影。
              它读起来是「印在照片上的一段色带」，不是「一个装东西的盒子」；话是躺在色带上
              的，不是被关在框里。
              精致的几处细节：①字距放到 .12em（中文小字拉开才有气口），再用 textIndent
              同值补一下——不然末尾那个字距会把整行往左带偏，居中就歪了；②字色不能直接用
              T.pink（#E86A9B 压在 #F9DFE9 上对比度不够、小字发飘），压深到 #B33E70；
              ③字号 10.5、行距 1.75、上下内边距 5。 */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              width: "100%",
              maxWidth: 320,
            }}
          >
            <span
              style={{
                padding: "5px 20px",
                background:
                  "linear-gradient(90deg, rgba(249,223,233,0) 0%, rgba(249,223,233,.95) 16%, rgba(249,223,233,.95) 84%, rgba(249,223,233,0) 100%)",
                fontSize: 10.5,
                lineHeight: 1.75,
                color: "#B33E70",
                letterSpacing: ".12em",
                textIndent: ".12em",
                textAlign: "center",
              }}
            >
              {m.content}
            </span>
          </div>
          {/* 真实原因单独一行小字露出来：界面上只给一句「请去检查接口配置」时，看不出到底
              是超时、被拦还是写错了哪一项。上面那句是给人看的套话，这一行才是能判案的原话：
              超时／CORS／401／HTTP 400 都会原文摆在这儿，截图这一行就够了。
              可长按选中复制。上面那条粉墨带是「一句话」的量级，兜不住这么长的原文，
              所以它单独占一块更淡的底，不跟色带挤在一起。 */}
          {m.errorText ? (
            <span
              style={{
                maxWidth: 280,
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(255,255,255,.82)",
                fontSize: 9.5,
                lineHeight: 1.6,
                color: T.ink2,
                letterSpacing: 0,
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                userSelect: "text",
                WebkitUserSelect: "text",
              }}
            >
              {m.errorText}
            </span>
          ) : null}
          {/* 这一轮没成（调用失败／API 没配）：给个一键重来，不用把刚才打的字重打一遍。
              点下去先把这条提示抹掉再重跑——记录上不留痕（见 retryFailed）。
              按钮跟着这套纸感走：白底＋金细边＋玫瑰红字，圆角做到全圆（它是居中独立
              的一枚，不是并排的工具条），前头一个小回转图标点明「重来」的意思。 */}
          {m.retryable ? (
            <button
              type="button"
              disabled={isTyping}
              onClick={() => void retryFailed(m.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 14px",
                borderRadius: 999,
                border: `1px solid ${T.line}`,
                background: T.card,
                fontSize: 11,
                lineHeight: 1,
                letterSpacing: ".1em",
                color: T.pink,
                cursor: isTyping ? "default" : "pointer",
                opacity: isTyping ? 0.5 : 1,
              }}
            >
              <RotateCcw size={11} strokeWidth={1.6} />
              重新生成
            </button>
          ) : null}
        </div>
      );
    }

    const isMe = m.role === "user";
    const body = renderBody(m);
    /* 时间／已读只在组尾露一次；组内其余行不挂，免得一串消息底下缀一排一样的时间。 */
    const meta = !lastOfGroup ? null : (
      <div
        style={{
          marginTop: 3,
          fontSize: 9.5,
          color: T.ink3,
          letterSpacing: ".06em",
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          alignItems: "center",
          gap: 5,
          alignSelf: "flex-end",
        }}
      >
        <span>{msgTime(m.createdAt)}</span>
        {m.isRead && isMe ? (
          <span style={{ color: T.pink, letterSpacing: ".14em" }}>已读</span>
        ) : null}
      </div>
    );
    /* 外语聊天的译文行（1.9.48）：贴着气泡**正下方**的一行小字，靠哪一侧跟那条气泡一致。
       他那一侧显示的是「他说的外语 → 中文」，我这一侧显示的是「我原本打的那句中文」；
       各自那个「显示翻译」关掉就不露（译文照旧存在消息里，随时开回来）。
       走 alignSelf＋maxWidth（同引用块那招）：它自己按文字长短收，绝不把上头的气泡撑宽。 */
    const trSet = conv?.translate;
    /* 1.9.56：语音点开「转文字」时，原文（他说出口的那句）顶上来，中文译文行先让开；
       收起原文，中文译文行自动恢复。所以这里多挂一个 `showTrans !== m.id`。 */
    const showTransLine =
      (m.role === "user" ? trSet?.in.show === true : trSet?.out.show === true) &&
      !!m.translated &&
      showTrans !== m.id;
    const transLine = showTransLine ? (
      <div
        style={{
          alignSelf: isMe ? "flex-end" : "flex-start",
          maxWidth: "100%",
          marginTop: 5,
          paddingLeft: isMe ? 0 : 9,
          paddingRight: isMe ? 9 : 0,
          textAlign: isMe ? "right" : "left",
          borderLeft: isMe ? "none" : "2px solid rgba(20,19,24,.14)",
          borderRight: isMe ? "2px solid rgba(232,106,155,.55)" : "none",
          fontFamily: SERIF,
          fontSize: 11,
          lineHeight: 1.65,
          letterSpacing: ".02em",
          color: T.ink3,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {m.translated}
      </div>
    ) : null;
    /* 引用块（1.5.49 改脸）：1.5.47 那版是「一整块淡粉底 ＋ 顶上一行小字『引用』」，
       恩熙看着说「有点丑」⇒ 改成左边一根细竖线那种（微信/Telegram 一个路数）：
       ①去掉「引用」那两个字：单聊里引用的一定是对方（TA 的气泡引用我、我的气泡引用 TA），
         一根竖线 ＋ 原话自带引号，已经把「这是引来的话」说清楚了，再顶一行小标签纯属多余装饰。
       ②去掉整块底色：气泡自己已经是一块色，再压一层淡粉就是「补丁感」的来源；
         一根竖线既能划分区域、又不糊。
       ③原话在库里存的是「发信人：原话」（那是给模型看的写法，见 quoteMsg），
         这里把前缀摘掉。只认气泡对面那个名字、摘不掉就原样显示——免得把原话里
         本来就有的冒号当分隔符剪坏。
       ④字色比正文浅一档（我侧白半透、对方侧 T.ink2）：引文是次要信息，不该跟正文抢。 */
    const quoteSender = isMe ? charName : myName;
    const quoteBody = m.quote
      ? m.quote.startsWith(`${quoteSender}：`)
        ? m.quote.slice(quoteSender.length + 1)
        : m.quote
      : "";
    const quoteBlock = m.quote ? (
      <div
        style={{
          alignSelf: isMe ? "flex-end" : "flex-start",
          marginBottom: 7,
          padding: "6px 13px",
          borderRadius: 16,
          background: "rgba(255,253,248,.44)",
          borderLeft: isMe ? "none" : "3px solid rgba(20,19,24,.44)",
          borderRight: isMe ? "3px solid rgba(232,106,155,.74)" : "none",
        }}
      >
        <div
          style={{
            fontSize: Math.max(9.5, fontSize - 3.5),
            lineHeight: 1.45,
            letterSpacing: ".02em",
            color: isMe ? "rgba(232,106,155,.66)" : "rgba(20,19,24,.46)",
          }}
        >
          {quoteSender}
        </div>
        <div
          style={{
            fontSize: Math.max(10.5, fontSize - 2),
            lineHeight: 1.5,
            letterSpacing: ".02em",
            color: isMe ? "rgba(160,52,98,.85)" : "rgba(20,19,24,.62)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {quoteBody}
        </div>
      </div>
    ) : null;

    const noBubble =
      m.type === "image" || m.type === "redpacket" || m.type === "transfer" || m.type === "receipt";

    const longHandlers = {
      onMouseDown: (e: React.MouseEvent) => onLongStart(e, m),
      onTouchStart: (e: React.TouchEvent) => onLongStart(e, m),
      onMouseMove: onLongCancel,
      onTouchMove: onLongCancel,
      onMouseUp: onLongCancel,
      onTouchEnd: onLongCancel,
    };

    /* 媒体消息（图片／语音等）：屏蔽浏览器原生长按菜单（存储图像等），长按只走自家菜单。 */
    const mediaBlockers =
      m.type === "image" || m.type === "voice" || m.type === "file" || m.type === "location"
        ? {
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            onDragStart: (e: React.DragEvent) => e.preventDefault(),
          }
        : {};

    if (isMe) {
      return (
        <div
          key={m.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            padding: rowPadding,
            justifyContent: "flex-end",
          }}
          {...longHandlers}
          {...mediaBlockers}
        >
          <div
            style={{
              maxWidth: 300,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              alignItems: "flex-end",
            }}
          >
            {quoteBlock}
            {noBubble ? (
              body
            ) : (
              /* 我这侧的气泡（1.5.51 改半透）：恩熙说「这颜色太深了，能不能做有点透明感」⇒
                 粉底整档提亮，并换成**半透明的粉**（alpha .70）——上传了照片壁纸时，
                 壁纸会从气泡里淡淡透上来，气泡不再是糊在照片上的一块实心色，
                 读起来是一层浮着的薄粉玻璃。
                 ①为什么不用毛玻璃（backdrop-filter）：聊天一屏就是十几二十条气泡，
                   一屏多枚模糊在 iPhone 上是真会掉帧的（globals.css 那条玻璃材质的警告写着
                   「开销与面积成正比，小件随便用，别铺到一屏多枚」）⇒ **只用 alpha 透明，不加模糊**；
                   她若想要更「雾」的，再单独给气泡上小半径模糊（记得配 translateZ(0)）。
                 ②底线：**alpha 不许再往下调**——白字坐在粉上本来就不宽裕，再透一档就发花；
                   .70 是白字还压得住的最透处。另补一道极淡的文字影，帮白字从照片里浮出来。
                 ③渐变幅度保留（顶 rgba(241,146,185) → 底 rgba(225,108,150)）：幅度一小，
                   整块就塌成一张平纸。
                 ④影从深粉收了一档（.22→.14、.36→.28）：气泡本身就是半透的，
                   影再重就又把它压回实心。内高光同理收到 .38。
                 ⑤字体（1.7.20）：正文与对面那一侧（TA 气泡）一同换**宋体**（`SERIF`）、
                   行距 1.55 → 1.65——两侧口径必须对齐，别一侧宋体一侧黑体。
                 主色 T.pink 没动，顶栏、按钮那些还用它。 */
              <div
                style={{
                  position: "relative",
                  background: T.ink,
                  color: "#FFFDF8",
                  borderRadius: 8,
                  padding: "5px 8px",
                  fontFamily: SERIF,
                  fontSize,
                  lineHeight: 1.75,
                  letterSpacing: ".02em",
                  boxShadow: "-2px 2px 0 rgba(232,106,155,.40)",
                  wordBreak: "break-word",
                }}
              >
                {body}
              </div>
            )}
            {transLine}
            {meta}
          </div>
          {groupedWithPrev
            ? avatarSpacerEl
            : avatarSlotEl(
                avatarBox({
                  avatar: actualMyAvatar,
                  fallbackChar: myName.charAt(0),
                  gradient: "linear-gradient(135deg,#F49BBE,#E86A9B)",
                  ring: "me",
                })
              )}
        </div>
      );
    }

    return (
      <div
        key={m.id}
        style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: rowPadding }}
        {...longHandlers}
        {...mediaBlockers}
      >
        {groupedWithPrev
          ? avatarSpacerEl
          : avatarSlotEl(
              avatarBox({
                avatar: actualCharAvatar,
                fallbackChar: charName.charAt(0),
                gradient: AVATAR_GRADIENT,
                /* 1.5.65：点 TA 的头像进「心声档案」。只挂 TA 这一侧，
                   我自己的头像不接（那一页讲的是他心里的事）。
                   1.5.72 起这是心声**唯一的入口**（聊天里那截「心声 ▾」已摘掉）。 */
                onClick: () => setShowInnerPage(true),
                ring: "char",
              })
            )}
        <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* 心声（1.5.60 建）**1.5.72 从聊天里摘掉**：恩熙说「聊天页面就可以把这个心声
              去掉，就让它直接变成头像里面有就可以了」——聊天流里那条「心声 ▾」整个删掉，
              心声只从 TA 头像那一页看（心声档案，1.5.65，含历史抽屉，每一轮都在）。
              数据侧一个字没动：`innerVoice`／`innerSnapshot` 照旧挂在那一轮的第一条 TA
              气泡上、照旧落库，InnerVoicePage 直接读；extractInnerVoice 也照旧在摘。
              所以别把这段渲染加回来——有那页在，这里是重复的入口。 */}
          {/* 思考过程入口（1.4.9 建，1.4.14 改淡）：带 reasoningText 的是思考型模型
              那一轮的第一条气泡，全局开关「显示思维链」关掉时整个不露（思考照收照存，不丢）。
              样式走「不明显的」：一行淡灰小字贴在气泡上方，无底无边框，
              混在背景里不抢眼，点字才展开全文——长文限高滚动、可长按选中复制
              （chat-body 全局禁选中，这里内联样式压回去，同 errorText 的做法）。 */}
          {m.reasoningText && showReasoning ? (
            <div style={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: 3 }}>
              <button
                type="button"
                onClick={() => toggleReasoningOpen(m.id)}
                style={{
                  alignSelf: "flex-start",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "1px 2px",
                  fontSize: 9.5,
                  lineHeight: 1.4,
                  letterSpacing: ".08em",
                  color: T.ink2,
                  opacity: 0.66,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                思考 {openReasoningIds.has(m.id) ? "▴" : "▾"}
              </button>
              {openReasoningIds.has(m.id) ? (
                <div
                  style={{
                    background: "rgba(255,255,255,.6)",
                    border: `1px solid ${T.line}`,
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 10,
                    lineHeight: 1.7,
                    color: T.ink2,
                    letterSpacing: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 180,
                    overflowY: "auto",
                    userSelect: "text",
                    WebkitUserSelect: "text",
                  }}
                >
                  {m.reasoningText}
                </div>
              ) : null}
            </div>
          ) : null}
          {quoteBlock}
          {noBubble ? (
            <div style={failMarkRowStyle}>
              {body}
              {failedIds.has(m.id) ? failMarkEl : null}
            </div>
          ) : (
            <div style={failMarkRowStyle}>
              <div style={assistantBubbleStyle}>
                {body}
              </div>
              {failedIds.has(m.id) ? failMarkEl : null}
            </div>
          )}
          {transLine}
          {meta}
        </div>
      </div>
    );
  };

  /* ---------- 背景 ---------- */
  /* 自传壁纸优先，否则用默认底色。不再有彩色预设可选（只保留
     可以上传壁纸背景的），底色将来由全局样式统一决定，这里就一个值。 */
  const actualBg = conv?.chatBgUrl ? `url(${conv.chatBgUrl}) center/cover` : CHAT_BG_DEFAULT;

  const menuLeft = menuPos.x;
  const menuTop = menuPos.y;

  /* 流式预览待显示的气泡：节拍器放出来的定型气泡＋还在长的尾巴（尾巴带打字光标）。 */
  const streamSettledShown = streamPreview ? streamPreview.settled.slice(0, streamShown) : [];
  /* 追平生成进度后尾巴才显示：否则后写的内容会先冒出来插在队首，文字来回跳。
     没追平时改用冻结的旧尾巴顶上——那正是即将转正的那段，接棒前后一模一样，看不出缝。 */
  const streamLiveTail =
    streamPreview && streamShown >= streamPreview.settled.length ? streamPreview.tail : "";
  /* 冻住的旧尾巴只在「还没追平」时顶班，且只在它冻结的那一档（at）显示一次：
     节拍器一旦放出第一条接棒的气泡，它就功成身退，改由真气泡续上。
     （落库后预览已清空，冻住的字不能再冒出来，否则会留下一只幽灵气泡。） */
  const streamFrozenText =
    streamPreview && !streamLiveTail && frozenTail && streamShown === frozenTail.at
      ? frozenTail.text
      : "";
  const streamTailText = streamLiveTail || streamFrozenText;
  const streamBubbles = streamTailText ? [...streamSettledShown, streamTailText] : streamSettledShown;
  /* 光标只挂在真在长的尾巴上：冻住的旧尾巴已经是说定的话，再闪光标就穿越了。 */
  const streamTailIndex = streamLiveTail ? streamBubbles.length - 1 : -1;

  /* 输入框上方那条引用栏显示的原话：库里存的是「发信人：原话」（给模型看的写法），
     栏里不写是谁说的、把前缀摘掉——对不上名字就原样显示（别把原话里本来就有的
     冒号当分隔符剪坏）。气泡里的引用块走同一套摘法（见上面 quoteBlock 那段）。 */
  const quoteBarBody = quoteText
    ? quoteText.startsWith(`${myName}：`)
      ? quoteText.slice(myName.length + 1)
      : quoteText.startsWith(`${charName}：`)
        ? quoteText.slice(charName.length + 1)
        : quoteText
    : "";

  /* 线下那一场还开着吗（1.7.39）：落库的「总闸」。开着的时候线上发不了消息——
     免得她在这一头打字、他又在那头演着，线上线下打架。只由线下页的「结束这一场」放平。 */
  const offlineOpen = !!conv?.offlineOpen;

  /* 分页切片（1.7.36）：只把最近 visibleCount 条摆上屏，再往前的还没上来——
     顶上那颗「加载更早的」露不露、露几条，都由这两个数说了算。 */
  const shownMessages =
    messages.length > visibleCount ? messages.slice(-visibleCount) : messages;
  const olderCount = messages.length - visibleCount;

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: actualBg,
        overflow: "hidden",
        fontFamily: SANS,
        color: T.ink,
      }}
    >
      <style>{`
        @keyframes vp { 0%,100% { transform: scaleY(.45); } 50% { transform: scaleY(1.3); } }
        @keyframes caretBlink { 0%,45% { opacity: 1; } 50%,100% { opacity: 0; } }
        /* 顶栏那对头像中间的小粉心会轻轻跳一下，做出「传信」的感觉：
           只动 transform，幅度压得小、
           周期拉得慢——是「在看的人才会发现它在动」的那种分量。
           ⚠️ 别写 infinite（1.9.7）：无限动画会让合成器永远醒着、每 16ms 硬出一帧，
           手机上聊久了就是发烫＋掉帧。改成只跳三下（约 5.7s）就歇——进聊天页那一下
           「传信」的读还在，之后静静停着，代价归零。 */
        @keyframes heartBeat { 0%,100% { transform: scale(1); } 45% { transform: scale(1.14); } }
        .chat-heart { animation: heartBeat 1.9s ease-in-out 3; }
        @media (prefers-reduced-motion: reduce) {
          .chat-heart { animation: none; }
        }
        @keyframes imgShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        .chat-body::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .chat-body { scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; }
        /* 聊天区内长按一律归自家菜单（520ms 弹操作栏）：连文字也禁掉 iOS 原生的
           「拷贝／查询／翻译」浮层——不然长按气泡会跳出系统菜单，跟自家操作栏打架。
           这条同款已经升到 globals.css 的 body 上
           （全 App 生效，输入框除外）；这里留着，是因为它多写了一条 .chat-body *，
           比全局那条靠继承更硬，老 WebView 上更稳。 */
        .chat-body, .chat-body * { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
        /* 加号面板里那一枚枚章。
           ⚠️ 章的底与边**必须写在样式表里、不能写内联**：内联样式永远压过样式表，
           写内联的话下面这条「按下」规则一辈子不生效（恩熙 2026-10-02 报过一次：
           「点击之后只有文字会变，图标没变色」——就是这个原因）。 */
        .plus-seal .seal-face {
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1.5px solid rgba(255,253,248,.7);
          color: #E86A9B;
          background-image:
            radial-gradient(circle, rgba(255,253,248,.10) 1px, transparent 1.2px),
            linear-gradient(180deg, #272130 0%, #17141C 100%);
          background-size: 11px 11px, 100% 100%;
          background-position: 50% 50%, 0 0;
        }
        /* 按下去那一瞬：整枚翻成粉底、边收掉、图标转纸白（图标走 currentColor，跟着变）。 */
        .plus-seal:active .seal-face {
          border-color: transparent;
          color: #FFFDF8;
          background-image: linear-gradient(180deg, #E8709C 0%, #C9346A 100%);
        }
        /* 输入框占位字：墨底上压纸白（淡一档），别用深色——深色落在墨条上就没了。 */
        .chat-input::placeholder { color: rgba(255,253,248,.42); }
      `}</style>

      {/* 顶栏：外头这条 header 不铺发丝线，正中浮起一颗白胶囊，两枚头像退到它最左最右，
          名字和签名朝里长、在正中碰面，接缝夹那颗会跳的粉心。布局细节写在气泡那段注释里。
          留白：桌面预览之所以高，是顶上那条模拟状态栏
          （时间／信号／电量）自己占了 44px，--sim-status-h 为它让位 46px；在它基础上
          再回撤 10px，真机则保底只留 6px（别让气泡钻进系统状态栏底下）。
          上移后上沿：桌面预览 36px、真机 6px，下沿 8px。
          calc 结构与安全区一字未动，键盘避让照旧。
          顶栏必须有一层底：底色是白的时候看不出问题，一挂上照片壁纸，
          顶栏连它那圈 padding 就整条被照片穿透——顶栏没了，跟下面的消息糊成一片。
          这里用的是**一层均匀的薄纱**：`rgba(255,247,249,.45)`。
          纱必须**上下同浓度、没有渐变、也没有过渡带**——否则看着像「顶栏被切了一半」，
          照片上淡下实、中间却是切开的。照片整张都在，只是在顶栏这一条上被压淡了一层，
          读起来是「一块压着照片的磨砂条」，不是「半截化开的雾」。
          但纯均匀的纱在底沿是「啪」一刀，所以底下再挂一段 22px 的收尾把这刀化开
          （见 `</header>` 前那个 span）：注意**纱本身仍然是均匀的、没有渐变**，
          渐变只活在顶栏外面那 22px 里——顶栏那一条始终是同一浓度的一块。
          顶栏里的东西不必担心被照片吃掉：大气泡是实白渐变胶囊、返回钮和更多钮都是
          .78 的白底、两枚头像自带白圈，各人都有各人的底。
          调浓淡就改这一个数：越接近 1 照片越看不见，越接近 0 照片越完整、顶栏越没影。 */}
      <header
        style={{
          position: "relative",
          flex: "none",
          zIndex: 20,
          background: T.ink,
          padding:
            "calc(var(--safe-area-top, 0px) + max(var(--sim-status-h, 0px) - 10px, 6px)) 14px 12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 26,
          }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            style={{ ...headerBtnStyle, width: "auto", height: "auto", color: "#FFFDF8", padding: 0 }}
          >
            <ChevronLeft size={27} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setShowChatSettings(true)}
            aria-label="聊天设置"
            style={{ ...headerBtnStyle, width: "auto", height: "auto", color: "#FFFDF8", padding: 0 }}
          >
            <MoreHorizontal size={26} strokeWidth={2.6} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
          <div style={{ flex: 1, minWidth: 0, textAlign: "right", paddingRight: 13 }}>
            <span
              style={{
                display: "block",
                fontFamily: SERIF,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: ".03em",
                color: "#FFFDF8",
                lineHeight: 1.05,
                textShadow: "2px 2px 0 rgba(224,65,122,.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {charName}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 5,
                fontSize: 10,
                color: "rgba(255,253,248,.55)",
                letterSpacing: ".05em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                /* 外语聊天（1.9.50）：签名也用日语写；下面那行**点一下切中文**、再点切回来。
                   可点时才显示虚线与小手指（没开外语／还没翻好就照旧纯文本）。 */
                cursor: sigTrans ? "pointer" : "default",
                textDecoration: sigTrans ? "underline dashed rgba(255,253,248,.28)" : "none",
                textUnderlineOffset: 3,
              }}
              onClick={sigTrans ? () => setSigCn((v) => !v) : undefined}
              title={sigTrans ? (sigCn ? "点一下看原文" : "点一下看中文") : undefined}
            >
              {sigCn && sigTrans ? sigTrans : signature}
            </span>
          </div>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                flex: "none",
                width: 44,
                height: 44,
                background: actualCharAvatar ? `url(${actualCharAvatar}) center/cover` : "transparent",
                border: "3px solid rgba(255,253,248,.85)",
                color: "#FFFDF8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 19,
                fontWeight: 700,
                fontFamily: SERIF,
                boxShadow: "-4px 4px 0 rgba(255,253,248,.20)",
                overflow: "hidden",
              }}
            >
              {!actualCharAvatar ? charName.charAt(0) : null}
            </span>
            <span
              style={{
                flex: "none",
                width: 44,
                height: 44,
                background: actualMyAvatar ? `url(${actualMyAvatar}) center/cover` : "transparent",
                border: `3px solid ${T.pink}`,
                color: T.pink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 19,
                fontWeight: 700,
                fontFamily: SERIF,
                boxShadow: "4px 4px 0 rgba(224,65,122,.55)",
                overflow: "hidden",
              }}
            >
              {!actualMyAvatar ? myName.charAt(0) : null}
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left", paddingLeft: 13 }}>
            <span
              style={{
                display: "block",
                fontFamily: SERIF,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: ".03em",
                color: "#FFFDF8",
                lineHeight: 1.05,
                textShadow: "2px 2px 0 rgba(224,65,122,.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {myName}
            </span>
            {userSignature.trim() ? (
              <span
                style={{
                  display: "block",
                  marginTop: 5,
                  fontSize: 10,
                  color: "rgba(255,253,248,.55)",
                  letterSpacing: ".05em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {userSignature}
              </span>
            ) : (
              <span aria-hidden style={{ display: "block", height: 15, marginTop: 5 }} />
            )}
          </div>
        </div>
      </header>

      {/* 消息区 */}
      <main
        ref={bodyRef}
        className="chat-body"
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "10px 0 16px",
        }}
        onClick={() => {
          setShowPlus(false);
          setShowImageSource(false);
          setShowSheet(false);
        }}
      >
        {loaded && messages.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 20px",
              fontSize: 12,
              color: T.ink3,
              letterSpacing: ".1em",
            }}
          >
            还没有消息，发一条吧
          </div>
        ) : null}
        {/* 历史分页（1.7.36）：上头还有没上屏的，就在消息区最前面摆一颗「加载更早的」。
            报的是**这个会话一共多少条**（不是这一页多少条）——她要知道的是总量；
            点一下再推一页上来，视口由上面那个 loadMoreRestoreRef 钉住、不动。 */}
        {loaded && olderCount > 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 2px" }}>
            <button
              type="button"
              onClick={loadMore}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid rgba(232,106,155,.22)",
                background: "rgba(255,255,255,.86)",
                color: T.ink2,
                fontSize: 11.5,
                letterSpacing: ".06em",
                cursor: "pointer",
              }}
            >
              <ChevronUp size={13} strokeWidth={2} />
              加载更早的 {Math.min(CHAT_PAGE_SIZE, olderCount)} 条 · 共 {messages.length} 条
            </button>
          </div>
        ) : null}
        {loaded
          ? shownMessages.map((m, i) => (
              /* 按天分段：一天的开头压一段居中日期粉墨带（今天／昨天／X月X日）。
                 时间的去处只有一处：小字只在组尾，日期交给这条带子。
                 分页后按**上屏这一份**判（shownMessages），否则最上头那条不补日期。 */
              <Fragment key={m.id}>
                {i === 0 || !sameDay(shownMessages[i - 1].createdAt, m.createdAt) ? (
                  /* 时间线（恩熙 2026-10-02 定的脸）：一段**粉墨带**，两端化开就没了——
                     没有边、没有圆角、也没有影，读起来是「印在纸上的一段色带」，
                     不是「一个装东西的盒子」。字压深到 #B33E70，小字才不飘。
                     跟系统提示（「已加入黑名单」那种）是同一套材质。 */
                  <div style={{ display: "flex", justifyContent: "center", padding: "14px 16px 2px" }}>
                    <span
                      style={{
                        padding: "3px 18px",
                        color: "#B33E70",
                        fontSize: 10.5,
                        letterSpacing: ".16em",
                        textIndent: ".16em",
                        background:
                          "linear-gradient(90deg, rgba(249,223,233,0) 0%, rgba(249,223,233,.92) 20%, rgba(249,223,233,.92) 80%, rgba(249,223,233,0) 100%)",
                      }}
                    >
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                ) : null}
                {renderMsg(m, i, shownMessages)}
              </Fragment>
            ))
          : null}
        {/* 流式预览：已定型的气泡按真气泡同款先上屏，尾巴挂一根打字光标。
            这里必须与 renderMsg 的分组排法共用同一套判据
            （组首 6px／组内 2px、组首才挂头像、组尾才挂时间），否则两处间距不是一套，
            看过去忽大忽小，转正那一刻还会当场跳一下；共用后转正前后纹丝不动。 */}
        {streamBubbles.map((text, i) => {
          const firstOfGroup = i === 0;
          const lastOfGroup = i === streamBubbles.length - 1;
          return (
            <div
              key={`stream-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                /* 与 renderMsg 的 rowPadding 同一算式：上＝组首 6／组内 3.5，下＝组尾 6／组内 3.5。 */
                padding: `${firstOfGroup ? 6 : 3.5}px 14px ${lastOfGroup ? 6 : 3.5}px`,
              }}
            >
              {firstOfGroup
                ? avatarSlotEl(
                    avatarBox({
                      avatar: actualCharAvatar,
                      fallbackChar: charName.charAt(0),
                      gradient: AVATAR_GRADIENT,
                      ring: "char",
                    })
                  )
                : avatarSpacerEl}
              <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", minWidth: 0 }}>
                {/* 气泡与红叹号同一行、按行居中——跟落库后的 renderMsg 一个排法（见 failMarkRowStyle）。 */}
                <div style={failMarkRowStyle}>
                  <div style={assistantBubbleStyle}>
                    {text}
                    {i === streamTailIndex ? (
                      <span
                        style={{
                          display: "inline-block",
                          width: 1.5,
                          height: "1em",
                          marginLeft: 2,
                          verticalAlign: "-0.15em",
                          background: T.ink2,
                          animation: "caretBlink 1s steps(1) infinite",
                        }}
                      />
                    ) : null}
                  </div>
                  {blockedNowActive ? failMarkEl : null}
                </div>
                {/* 发送时间只在组尾露一次：和真气泡的 meta 同款（含 marginTop 3），转正时纹丝不动。 */}
                {lastOfGroup && streamStamps[i] ? (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 9.5,
                      color: T.ink3,
                      letterSpacing: ".06em",
                      fontVariantNumeric: "tabular-nums",
                      alignSelf: "flex-end",
                    }}
                  >
                    {msgTime(streamStamps[i])}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {/* 「TA 正在输入…」：只要这一轮还在跑就挂着，**不再要求「一条预览气泡都还没有」**。
           不能拿 `streamBubbles.length === 0` 当条件：返回再进来时模型多半已经吐了字、
           预览气泡早就在长了，这行就被那条规则藏了（页面切走再回来就看不见「正在输入」）。
           流式气泡说的是「已经说出口的话」，不代表「说完了」——两件事，可以同时在。
           所以气泡归气泡、这行归这行，翻回来一眼就能看见 TA 还在写。 */}
        {isTyping ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px 4px",
              color: T.ink3,
              fontSize: 11,
              letterSpacing: ".1em",
            }}
          >
            {avatarBox({
              avatar: actualCharAvatar,
              fallbackChar: charName.charAt(0),
              gradient: AVATAR_GRADIENT,
              ring: "char",
            })}
            <span>
              {/* 一律只写「正在输入…」（恩熙 2026-10-02）：原本按阶段分「思考中／在写心里话／
                  正在输入」三种说法，她要求不分阶段、统一一句，跟着的秒数也一并去掉。 */}
              <b style={{ color: T.pink, fontWeight: 500 }}>{charName}</b> 正在输入…
            </span>
          </div>
        ) : null}
      </main>

      {/* 底部输入条：实底**墨色**，跟顶栏一头一尾、中间留浅（恩熙 2026-10-02 定的新脸）。
          原来是一根压住照片的白横杆，改版后整条是墨的，压在它上头的控件才立得住。
          墨底必须实心：不能做成顶栏那种薄纱——照片从一堆控件底下透上来，读起来是脏的。 */}
      <div
        style={{
          position: "relative",
          flex: "none",
          background: T.ink,
          zIndex: 30,
          paddingBottom: "calc(var(--safe-area-bottom, 0px) + 6px)",
        }}
      >
        {offlineOpen ? (
          /* 1.7.39：线下那一场开着的时候，线上这一格换成一条「回到这一场」——
             不是一句提示语，是颗按钮：点它就把线下那一页再摆出来。恩熙：
             「如果我已经在线下的情况下，线上是不可以做同时输入的」，也是防线上线下打架。 */
          <div style={{ padding: "8px 12px 2px" }}>
            <button
              type="button"
              onClick={() => setShowOffline(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "linear-gradient(180deg,#FFFFFF 0%,#FFF1F6 100%)",
                border: "1px solid rgba(232,106,155,.28)",
                borderRadius: 20,
                padding: "12px 14px",
                fontSize: 14.5,
                color: T.pink,
                boxShadow:
                  "0 4px 14px rgba(232,106,155,.10), inset 0 0 0 1px rgba(232,106,155,.06)",
              }}
            >
              <Heart size={17} strokeWidth={1.8} />
              你正见着他 · 回到这一场
            </button>
            <div
              style={{
                marginTop: 7,
                textAlign: "center",
                fontSize: 12,
                letterSpacing: ".02em",
                color: T.ink3,
              }}
            >
              见面还没结束，这会儿在线上发不了消息。
            </div>
          </div>
        ) : (
          <>
        {/* 引用栏（1.5.49 跟气泡里那个一起改脸）：竖细线 ＋ 淡字，长得跟气泡里的
            引用块一模一样——发出去之后接在一起才像同一样东西。以前是贴边通栏＋单行
            省略号，跟气泡里那个是两张脸；1.5.47 先统一成淡粉块，恩熙说丑，这版把
            底块和「引用」小标签都去掉，只留一根竖线。 */}
        {quoteText ? (
          <div style={{ padding: "10px 14px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 10,
                borderLeft: "2px solid rgba(232,106,155,.6)",
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.5,
                  letterSpacing: ".02em",
                  color: "rgba(255,253,248,.66)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                “{quoteBarBody}”
              </div>
              <button
                type="button"
                onClick={() => setQuoteText("")}
                aria-label="取消引用"
                style={{ ...smallBtnStyle, marginTop: 1, color: "rgba(255,253,248,.72)" }}
              >
                <X size={13} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ) : null}
        {/* 输入区：一行四样：＋、书写框、爱心、小飞机，各自只干一件事：
            · 小飞机＝发送，不论连续发送开不开都只是发出去，它不会让他回；
            · 爱心＝强制回复，常驻在发送键左边，只在开了连续发送、又攒着话没回时才亮
              （见 canForceReply）；没开连续发送时 TA 本来就每条都回，它就淡着待命。 */}
        <div style={{ padding: "10px 14px 4px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 9,
          }}
        >
          {/* 加号：黑底 ＋ 一圈白边 ＋ 底下一层灰白的影（跟旁边那颗爱心一张脸）。
              点开面板时整颗换成粉渐层，一眼看得出面板是开着的。 */}
          <button
            type="button"
            onClick={() => {
              setShowPlus((v) => !v);
              setShowImageSource(false);
            }}
            aria-label="更多功能"
            style={{
              ...inputBtnStyle,
              width: 32,
              height: 32,
              borderRadius: 8,
              background: showPlus
                ? "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)"
                : "#0F0D13",
              border: "1.5px solid #FFFDF8",
              color: "#FFFDF8",
              boxShadow: showPlus
                ? "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)"
                : "0 3px 0 rgba(255,253,248,.30)",
              transition: "all .18s",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                transition: "transform .25s cubic-bezier(.22,1,.36,1)",
                transform: showPlus ? "rotate(45deg)" : "none",
              }}
            >
              <Plus size={20} strokeWidth={2} />
            </span>
          </button>
          {/* 选图输入：藏起来，靠加号面板里那颗「发送图片」点开。
              不设 capture —— accept="image/*" 本身就会弹「照片图库／拍照／浏览」，
              加了 capture 反而把图库那一路砍掉、只能当场拍。 */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              /* 选完就清空：不然同一张图连着选第二次不触发 change。 */
              e.target.value = "";
              if (!file) return;
              /* 选好先不发——换成一张预览问一句「要发这张吗」（见 pendingImage）。
                 面板到这一步才收：选的路上（含在系统选图里又退出来）它一直开着。 */
              if (!file.type.startsWith("image/")) {
                showToast("只能发图片");
                return;
              }
              setShowImageSource(false);
              setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
            }}
          />
          <textarea
            ref={inputRef}
            onChange={autoGrow}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              /* 回车直接发出去（手机键盘上的发送键走的也是回车），不必再点小飞机。
                 中文输入法选字时的回车不算（isComposing）；换行改用 Shift＋回车。 */
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendMsg();
              }
            }}
            rows={1}
            placeholder="发消息…"
            className="chat-input"
            style={{
              flex: 1,
              minWidth: 0,
              maxHeight: 106,
              border: "none",
              outline: "none",
              resize: "none",
              /* 书写框：深墨里压出的一道**墨槽**——内阴影 ＋ 一圈极淡的纸白内描边，
                 所以它是「凹进去的一块」，不是浮在上头的白框。
                 光标颜色交给 caretColor：用系统原生那根，只是把它染成粉色，
                 零成本（自绘一根会闪的光标会让合成器一直醒着，见上面那条约定的注）。 */
              background: "rgba(255,253,248,.10)",
              borderRadius: 8,
              padding: "8px 13px",
              fontSize: 15,
              fontFamily: SANS,
              color: "#FFFDF8",
              caretColor: T.pink,
              lineHeight: 1.45,
              letterSpacing: ".02em",
              boxShadow: "inset 0 3px 8px rgba(0,0,0,.42), inset 0 0 0 1px rgba(255,253,248,.09)",
            }}
          />
          {/* 爱心：强制回复，常驻在小飞机左边，一张脸跟加号一样——黑底 ＋ 白边 ＋ 底下
              那层灰白影；只在「连续发送、又攒着话没回」时才亮（见 canForceReply），
              亮起来才换成粉渐层，一眼看得出点得动。 */}
          <button
            type="button"
            onClick={forceReply}
            disabled={!canForceReply}
            aria-label="强制回复"
            style={{
              ...inputBtnStyle,
              width: 36,
              height: 36,
              borderRadius: 8,
              background: canForceReply
                ? "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)"
                : "#0F0D13",
              border: "1.5px solid #FFFDF8",
              color: "#FFFDF8",
              cursor: canForceReply ? "pointer" : "default",
              boxShadow: canForceReply
                ? "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)"
                : "0 3px 0 rgba(255,253,248,.30)",
              transition: "background .18s, box-shadow .18s",
            }}
          >
            <Heart size={18} strokeWidth={1.8} fill="currentColor" />
          </button>
          {isTyping ? (
            <button
              type="button"
              onClick={stopReply}
              aria-label="停止生成"
              style={{
                ...inputBtnStyle,
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)",
                color: "#FFFDF8",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)",
              }}
            >
              <SquareStop size={20} strokeWidth={1.6} />
            </button>
          ) : (
            <button
              type="button"
              onClick={sendMsg}
              disabled={!loaded || translatingMy}
              aria-label="发送"
              style={{
                ...inputBtnStyle,
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "linear-gradient(180deg,#E8709C 0%,#C9346A 100%)",
                color: "#FFFDF8",
                opacity: loaded && !translatingMy ? 1 : 0.45,
                cursor: loaded && !translatingMy ? "pointer" : "default",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,.26), 0 3px 0 rgba(224,65,122,.45)",
              }}
            >
              {/* 正把那句话翻成外语：小飞机先歇成省略号，免得连点两下发两条。 */}
              {translatingMy ? "…" : <Send size={19} strokeWidth={1.8} />}
            </button>
          )}
        </div>
        </div>
          </>
        )}
        {/* 加号面板：形是「一面印章墙」（恩熙 2026-10-02 定的脸）：
            · 整块跟输入条同一个墨底，从底下一体长出来——不再是「飘在上头的一张白纸」；
            · 板面压两层极淡的东西：11px 点阵（跟章面同一套，纸的肌理）＋
              顶上一道径向光（顶亮底沉，像一片被灯照到的墨）；
            · 九枚方章摆成 3×3：外框 1.5px 纸白、章面是浅墨竖直渐变 ＋ 居中铺的同一层点阵、
              章心一枚线描图标（桃粉，跟小飞机／引用弧线同一个粉），标签在章下；
            · 底下一条两端化开的粉带断开，压两条并排的「套印墨条」
              （去见他／重新回复）：墨底 ＋ 纸白细边，主的那条字后压一层粉色错影，
              跟顶栏那两个字是同一个套印做法。
            点下去那一枚会整枚翻成粉底白图标，规则在下面 <style> 的 .plus-seal。 */}
        {showPlus && !offlineOpen ? (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              background: T.ink,
              backgroundImage:
                "radial-gradient(circle, rgba(255,253,248,.06) 1px, transparent 1.2px), " +
                "radial-gradient(130% 85% at 50% 0%, rgba(255,253,248,.10) 0%, transparent 65%)",
              backgroundSize: "11px 11px, 100% 100%",
              backgroundPosition: "50% 50%, 0 0",
              padding: "16px 16px 12px",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", rowGap: 15 }}>
              {PLUS_ITEMS.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onPlusClick(item.name)}
                  className="plus-seal"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: SERIF,
                    fontSize: 10.5,
                    letterSpacing: ".08em",
                    color: "rgba(255,253,248,.62)",
                  }}
                >
                  <span className="seal-face">
                    <item.icon size={21} strokeWidth={1.5} />
                  </span>
                  {item.name}
                </button>
              ))}
            </div>
            {/* 两端化开的粉带：把「发内容」和「做一件事」在视觉上断开。 */}
            <div
              style={{
                height: 2,
                margin: "12px 0",
                background:
                  "linear-gradient(90deg, rgba(249,223,233,0) 0%, rgba(249,223,233,.85) 22%, rgba(249,223,233,.85) 78%, rgba(249,223,233,0) 100%)",
              }}
            />
            {/* 两条并排的套印墨条：去见他（主，字后压粉错影）／重新回复（次）。 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <button
                type="button"
                onClick={() => onPlusClick(PLUS_OFFLINE_ACTION.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  height: 44,
                  borderRadius: 8,
                  border: "1.5px solid rgba(255,253,248,.42)",
                  background: "rgba(255,253,248,.06)",
                  color: "#FFFDF8",
                  fontFamily: SERIF,
                  fontSize: 13,
                  letterSpacing: ".08em",
                  textShadow: "2px 2px 0 rgba(224,65,122,.55)",
                  cursor: "pointer",
                }}
              >
                <PLUS_OFFLINE_ACTION.icon size={18} strokeWidth={1.5} />
                {PLUS_OFFLINE_ACTION.name}
              </button>
              <button
                type="button"
                onClick={() => onPlusClick(PLUS_ACTION.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  height: 44,
                  borderRadius: 8,
                  border: "1.5px solid rgba(255,253,248,.42)",
                  background: "transparent",
                  color: "rgba(255,253,248,.72)",
                  fontFamily: SERIF,
                  fontSize: 13,
                  letterSpacing: ".08em",
                  cursor: "pointer",
                }}
              >
                <PLUS_ACTION.icon size={18} strokeWidth={1.5} />
                {PLUS_ACTION.name}
              </button>
            </div>
          </div>
        ) : null}

        {/* 「图片」的二级面板：先问「这张图从哪来」。
            形跟加号面板同一面墙：同一个墨底、同一套点阵与顶上压光，
            这次只摆一排三枚章（相册／拍照／小手机相册）——像从那面墙上摘下来的一排。
            点下去跟墙上一样整枚翻粉。 */}
        {showImageSource && !offlineOpen ? (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              background: T.ink,
              backgroundImage:
                "radial-gradient(circle, rgba(255,253,248,.06) 1px, transparent 1.2px), " +
                "radial-gradient(130% 85% at 50% 0%, rgba(255,253,248,.10) 0%, transparent 65%)",
              backgroundSize: "11px 11px, 100% 100%",
              backgroundPosition: "50% 50%, 0 0",
              padding: "16px 16px 14px",
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontFamily: SERIF,
                fontSize: 10.5,
                letterSpacing: ".1em",
                color: "rgba(255,253,248,.5)",
                marginBottom: 15,
              }}
            >
              这张图从哪来
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
              {(
                [
                  { key: "device" as const, icon: ImageIcon, title: "相册", note: "你存的照片" },
                  { key: "camera" as const, icon: Camera, title: "拍照", note: "现在就拍一张" },
                  {
                    key: "stellasei" as const,
                    icon: Smartphone,
                    title: "小手机相册",
                    note: "星绥里的 · 还在做",
                  },
                ]
              ).map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => pickImageSource(row.key)}
                  className="plus-seal"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="seal-face">
                    <row.icon size={21} strokeWidth={1.5} />
                  </span>
                  <span
                    style={{
                      marginTop: 8,
                      fontFamily: SERIF,
                      fontSize: 10.5,
                      letterSpacing: ".08em",
                      color: "rgba(255,253,248,.62)",
                    }}
                  >
                    {row.title}
                  </span>
                  <span
                    style={{
                      marginTop: 3,
                      fontFamily: SERIF,
                      fontSize: 9,
                      letterSpacing: ".04em",
                      color: "rgba(255,253,248,.38)",
                    }}
                  >
                    {row.note}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 选好了、还没发出去：把图摆在这儿问一句「要发这张吗」。
            取消 ≒ 什么也没发生；发送才真落库发出去。二次确认，免得手一滑就发错。
            加号面板开着时先让位（同一块地方，别叠成两层）——图还留着，等面板收了自己回来。 */}
        {pendingImage && !showPlus && !offlineOpen ? (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              backgroundImage:
                "radial-gradient(circle, rgba(232,106,155,.05) 1px, transparent 1.2px), " +
                "linear-gradient(180deg,#FFFFFF 0%,#FFF8FB 55%,#FFF1F6 100%)",
              backgroundSize: "7px 7px, 100% 100%",
              borderRadius: "22px 22px 0 0",
              boxShadow:
                "0 -14px 38px rgba(190,72,112,.14), inset 0 1px 0 rgba(255,255,255,.9), " +
                "inset 0 0 0 1px rgba(232,106,155,.10)",
              padding: "9px 12px 14px",
              borderTop: "1px solid rgba(232,106,155,.18)",
            }}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 999,
                background: "rgba(232,106,155,.22)",
                margin: "0 auto 10px",
              }}
            />
            <div
              style={{
                fontSize: 12,
                letterSpacing: ".08em",
                color: T.ink2,
                opacity: 0.75,
                fontFamily: SERIF,
                padding: "0 4px 9px",
              }}
            >
              要发这张吗
            </div>
            {/* 相纸里的一张小样：图本身按比例缩，最多占屏幕一小截，别把输入条顶没。 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 10,
                padding: "8px",
                borderRadius: 16,
                background: "rgba(20,19,24,.035)",
                border: "1px solid rgba(232,106,155,.10)",
              }}
            >
              <img
                src={pendingImage.previewUrl}
                alt="待发送的图片"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 180,
                  objectFit: "contain",
                  borderRadius: 10,
                  background: "#FFFFFF",
                }}
              />
            </div>
            {/* 想配一句话就写在这儿（可留空）：它跟这张图一并发出去，图在上、话在下。
                整句直接就是这一轮的「一来」，所以 TA 回的就是这句话。 */}
            <textarea
              ref={pendingTextRef}
              onChange={autoGrow}
              rows={1}
              placeholder="配一句话（可留空）"
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                minHeight: 40,
                maxHeight: 106,
                resize: "none",
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(232,106,155,.20)",
                background: "#FFFFFF",
                color: T.ink,
                fontSize: 13.5,
                lineHeight: 1.5,
                fontFamily: SERIF,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 9 }}>
              <button
                type="button"
                onClick={cancelPendingImage}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 14,
                  border: "1px solid rgba(232,106,155,.24)",
                  background: "#FFFFFF",
                  color: T.ink2,
                  fontSize: 14,
                  fontFamily: SERIF,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmPendingImage}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(180deg,#F09CBE 0%,#E06E90 100%)",
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontFamily: SERIF,
                  boxShadow: "0 3px 10px rgba(232,106,155,.30), inset 0 1px 0 rgba(255,255,255,.45)",
                  cursor: "pointer",
                }}
              >
                发送
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 长按操作浮动菜单 */}
      {showSheet && curMsg ? (
        <>
          <div
            style={{ position: "absolute", inset: 0, zIndex: 55 }}
            onClick={() => setShowSheet(false)}
          />
          <div
            style={{
              position: "absolute",
              left: menuLeft,
              top: menuTop,
              background: T.card,
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(20,19,24,.15)",
              padding: "6px 4px",
              zIndex: 56,
              display: "flex",
              alignItems: "center",
              border: `1px solid ${T.line}`,
            }}
          >
            <SheetBtn icon={<Trash2 size={19} strokeWidth={1.5} />} label="删除" color={T.danger} onClick={delMsg} />
            <SheetDivider />
            <SheetBtn
              icon={<Quote size={19} strokeWidth={1.5} />}
              label="引用"
              color={T.pink}
              onClick={quoteMsg}
            />
            <SheetDivider />
            <SheetBtn
              icon={<Copy size={19} strokeWidth={1.5} />}
              label="复制"
              color={T.pink}
              onClick={copyMsg}
            />
            <SheetDivider />
            {/* 只给「话」改：图片／语音／红包这些的正文是代码写死的说明文字，
                改了也不是改那张图，放出来只会误导。 */}
            {(curMsg.type ?? "text") === "text" && curMsg.role !== "system" ? (
              <>
                <SheetBtn
                  icon={<PenLine size={19} strokeWidth={1.5} />}
                  label="编辑"
                  color={T.pink}
                  onClick={startEdit}
                />
                <SheetDivider />
              </>
            ) : null}
            <SheetBtn
              icon={
                favoritedIds.has(curMsg.id) ? (
                  <Star size={19} strokeWidth={1.5} fill="currentColor" />
                ) : (
                  <Star size={19} strokeWidth={1.5} />
                )
              }
              label={favoritedIds.has(curMsg.id) ? "已收藏" : "收藏"}
              color={T.pink}
              onClick={toggleFavorite}
            />
            <SheetDivider />
            <SheetBtn
              icon={<Languages size={19} strokeWidth={1.5} />}
              label="翻译"
              color={T.pink}
              onClick={() => {
                setShowSheet(false);
                showToast("翻译 · 预览");
              }}
            />
            {curMsg.type === "voice" ? (
              <>
                <SheetDivider />
                <SheetBtn
                  icon={<FileText size={19} strokeWidth={1.5} />}
                  label={showTrans === curMsg.id ? "收起原文" : "转文字"}
                  color={T.pink}
                  onClick={() => {
                    /* 1.9.56：可开可关。开着再点＝收起，中文译文行随之恢复。 */
                    setShowTrans(showTrans === curMsg.id ? null : curMsg.id);
                    setShowSheet(false);
                  }}
                />
              </>
            ) : null}
            {curMsg.type === "image" && curMsg.diag ? (
              <>
                <SheetDivider />
                <SheetBtn
                  icon={<Stethoscope size={19} strokeWidth={1.5} />}
                  label="诊断"
                  color={T.pink}
                  onClick={() => {
                    setDiagView(curMsg.diag ?? null);
                    setShowSheet(false);
                  }}
                />
              </>
            ) : null}
            {curMsg.type === "image" || curMsg.type === "voice" ? (
              <>
                <SheetDivider />
                <SheetBtn
                  icon={<RotateCcw size={19} strokeWidth={1.5} />}
                  label="重新生成"
                  color={T.pink}
                  onClick={() => {
                    setShowSheet(false);
                    void regenerateMedia(curMsg);
                  }}
                />
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 改话（1.7.50）：长按气泡 →「编辑」调出来。照线下「此刻在哪儿」那张底单做——
          同一副白纸底、同一颗实心粉按钮。改的是**存档里的原话**，不是只改屏幕：
          改完他往后就按改后的记（见 saveEdit 为什么要把 apiText 一并抹掉）。 */}
      {editMsg ? (
        <div
          onClick={() => setEditMsg(null)}
          style={{
            position: "absolute",
            inset: 0,
            /* 60：压住长按菜单（55）与输入栏（30），但在生图诊断（75）之下。 */
            zIndex: 60,
            background: "rgba(20,19,24,.28)",
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#FFFFFF",
              borderRadius: "22px 22px 0 0",
              padding: `18px 18px calc(var(--safe-area-bottom, 0px) + 18px)`,
              boxShadow: "0 -12px 30px -14px rgba(20,19,24,.25)",
            }}
          >
            <div style={{ fontFamily: KAI, fontSize: 16, letterSpacing: ".06em" }}>
              {editMsg.role === "user" ? "改你说的话" : "改他说的话"}
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.8, color: T.ink3 }}>
              改完存档也跟着换——他往后记的就是改后的这句。
            </div>
            <textarea
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              className="chat-input"
              style={{
                marginTop: 14,
                width: "100%",
                height: 116,
                padding: "12px 14px",
                borderRadius: 14,
                border: `1px solid ${T.line}`,
                background: "#FFFFFF",
                fontFamily: SANS,
                fontSize: 14,
                lineHeight: 1.75,
                color: T.ink,
                outline: "none",
                resize: "none",
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="of-soft"
                style={{
                  flex: "none",
                  width: 88,
                  height: 44,
                  borderRadius: 14,
                  border: `1px solid ${T.line}`,
                  background: "#FFFFFF",
                  color: T.ink2,
                  fontSize: 13.5,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                }}
              >
                算了
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={editDraft.trim() === ""}
                className="of-soft"
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 14,
                  border: "none",
                  background: T.pink,
                  color: "#FFFFFF",
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  cursor: editDraft.trim() === "" ? "default" : "pointer",
                  opacity: editDraft.trim() === "" ? 0.4 : 1,
                  boxShadow: "0 3px 10px rgba(232,106,155,.30)",
                }}
              >
                就改这样
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 生图诊断：长按图片 →「诊断」调出来。
          把「提示词写得再严也得参考图真的送到才算数」这件事摊开看——
          第一行就是参考图送出张数，0 就是没送进去（站点不认图片编辑接口，代码
          退回了纯文生图），那时提示词层怎么改都没用。 */}
      {diagView ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(30,26,23,.9)",
            zIndex: 75,
            display: "flex",
            flexDirection: "column",
            padding: "calc(var(--safe-area-top, 0px) + 14px) 14px 14px",
            gap: 10,
          }}
          onClick={() => setDiagView(null)}
        >
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "#FFF",
            }}
          >
            <span style={{ fontSize: 13, letterSpacing: ".06em" }}>这张图的生图诊断</span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setDiagView(null)}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "rgba(255,255,255,.14)",
                border: "none",
                color: "#FFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          {/* 关键三格：通道／参考图／翻译。卡片不跟着点击关闭，否则一划就没了。 */}
          <div
            style={{
              flex: "none",
              background: "#FFF",
              borderRadius: 12,
              padding: "11px 13px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: T.ink2 }}>走哪条通道</span>
              <span style={{ color: T.ink, fontWeight: 600 }}>
                {DIAG_VIA_CN[diagView.via]}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: T.ink2 }}>参考图真的送出</span>
              <span
                style={{
                  fontWeight: 600,
                  color: diagView.refsSent > 0 ? T.pink : T.danger,
                }}
              >
                {diagView.refsSent > 0 ? `${diagView.refsSent} 张` : "0 张（没送进去）"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: T.ink2 }}>提示词翻译</span>
              <span style={{ color: T.ink }}>
                {diagView.translateFailed ? "失败，已用中文原文" : "未失败"}
              </span>
            </div>
            {diagView.refsSent === 0 ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 11, color: T.ink2 }}>为什么没送出去</span>
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.6,
                      color: T.danger,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {diagView.refSkipReason ?? "这一版还没记下原因（1.0.59 那批旧记录）"}
                  </span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.6, color: T.ink2 }}>
                  这一趟是纯文生图：参考图压根没进请求，脸只能靠人设文字碰运气——
                  提示词写得再严也不起作用。
                </div>
              </>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,.75)",
              letterSpacing: ".04em",
              flex: "none",
            }}
          >
            实际发出去的提示词全文
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              background: "#FFF",
              borderRadius: 12,
              padding: "11px 13px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <pre
              style={{
                margin: 0,
                fontFamily: "monospace",
                fontSize: 10,
                lineHeight: 1.7,
                color: T.ink,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {diagView.prompt}
            </pre>
          </div>
        </div>
      ) : null}

      {/* 图片查看器 */}
      {showViewer ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(30,26,23,.9)",
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 14,
          }}
          onClick={() => setShowViewer(false)}
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setShowViewer(false)}
            style={{
              position: "absolute",
              top: "calc(var(--safe-area-top, 0px) + 56px)",
              right: 18,
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "rgba(255,255,255,.14)",
              border: "none",
              color: "#FFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
          <div
            style={{ width: "78%", borderRadius: 14, overflow: "hidden", boxShadow: "0 18px 60px rgba(0,0,0,.4)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {viewerImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewerSrc || undefined}
                alt={viewerCap || "图片"}
                decoding="sync"
                /* 大图放开原生长按：手机端要存到相册，靠的就是系统菜单里的「存储图像／存储到照片」。 */
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  WebkitTouchCallout: "default",
                  WebkitUserSelect: "auto",
                  userSelect: "auto",
                }}
              />
            ) : (
              <SeaIllustration />
            )}
          </div>
          {viewerSrc ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                /* 地址 + 已经解好的 Blob 一起给：blob 直接用（分享路径要保持同步，
                   await 一次就把用户手势等没了），缓存没命中时走原来的兜底逻辑。 */
                void saveImage(viewerSrc, getCachedMediaBlob(viewerImg));
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 18px",
                borderRadius: 999,
                background: "rgba(255,255,255,.14)",
                border: "1px solid rgba(255,255,255,.18)",
                color: "#FFF",
                fontSize: 12.5,
                letterSpacing: ".06em",
                fontFamily: SANS,
              }}
            >
              <Download size={15} strokeWidth={1.8} />
              保存图片
            </button>
          ) : null}
          {viewerCap ? (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "72%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                paddingTop: 2,
              }}
            >
              <div style={{ width: 34, height: 1, background: "rgba(232,106,155,.55)" }} />
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,.78)",
                  letterSpacing: ".04em",
                  lineHeight: 1.9,
                  textAlign: "center",
                  fontFamily: SANS,
                }}
              >
                {viewerCap}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 红包／转账：看这一条的金额与留言；TA 发来的还没收，就能在这里收下。
          1.4.86 起回执（receipt）也能点开（单开一套回执版的详情，绝不冒出收下／退还
          的按钮——回执的 role 是「收款方是谁」，跟钱那条的 role＝「谁发的」语义拧着）。
          1.4.88 起**转账／回执的详情整张换成票**（TicketMoneyModal，文件底部）。
          1.4.89 起**红包点开换成开红包页**（RedPacketModal，文件底部）——恩熙：
          「参考微信红包的样式，有封面、封面可自定义，按下开之后有开红包的动画」。
          没领的（TA 发给我的）先看到大红包，点「開」放动画、动画里真领钱（claimMoney），
          金额才揭晓；我发的／已落定的直接是揭晓后的样子。
          1.4.93 起揭晓那一屏多一个「查看领取详情」，点进 RedPacketDetailPage——
          恩熙：「点进去之后会有一个开与不开嘛，开了之后会有个详情页」。 */}
      {openMoney ? (
        openMoney.type === "redpacket" ? (
          <RedPacketModal
            m={openMoney}
            charName={charName}
            myName={myName}
            charAvatar={actualCharAvatar}
            myAvatar={actualMyAvatar}
            onClose={() => setOpenMoney(null)}
            onClaim={(x) => claimMoney(x)}
          />
        ) : (
          <TicketMoneyModal
            m={openMoney}
            charName={charName}
            myName={myName}
            onClose={() => setOpenMoney(null)}
            onClaim={(x) => void claimMoney(x)}
            onRefund={(x) => void refundMoney(x)}
          />
        )
      ) : null}

      {/* 转账／红包：整页填金额与说明（1.4.54 恩熙要「像微信那样一整页」），
          钱真从我的零钱划到 TA 那本账 */}
      {paySend ? (
        <MoneySendView
          kind={paySend.kind}
          name={charName}
          avatar={actualCharAvatar}
          amount={payAmountText}
          note={payNoteText}
          cover={payCover}
          busy={payBusy}
          onAmountChange={setPayAmountText}
          onNoteChange={setPayNoteText}
          onCoverChange={changePayCover}
          onClose={() => {
            if (!payBusy) setPaySend(null);
          }}
          onSubmit={() => void doSendMoney(paySend.kind)}
          showToast={showToast}
        />
      ) : null}

      {/* 支付密码：排在发送面板**后面**画，所以它压在上面（同一个 z-index） */}
      {payPwdKind ? (
        <PayPasswordSheet
          ownerId={maskId}
          mode="verify"
          current={payPwdCurrent}
          amount={payPwdAmount}
          method={payPwdMethod}
          methodId={payMethod}
          methods={payMethods}
          onMethodPick={pickPayMethod}
          onClose={() => setPayPwdKind(null)}
          onPassed={() => {
            const kind = payPwdKind;
            setPayPwdKind(null);
            void sendMoneyNow(kind);
          }}
          showToast={showToast}
        />
      ) : null}

      {/* 重新回复弹窗 */}
      {showReModal ? (
        <ModalShell onClose={() => setShowReModal(false)}>
          <div style={modalTitleStyle}>重新回复</div>
          <div style={modalEnStyle}>reply with intent</div>
          <div style={modalDescStyle}>不填就直接重新生成；填了就按你说的改</div>
          <textarea
            value={reInput}
            onChange={(e) => setReInput(e.target.value)}
            rows={2}
            placeholder="想改语气就写在这里，例如：撒娇一点、简短一点、带上一点担心…（留空＝直接重新生成）"
            style={{
              width: "100%",
              marginTop: 14,
              border: `1px solid ${T.line}`,
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 14,
              fontFamily: SANS,
              color: T.ink,
              outline: "none",
              background: T.bg,
              letterSpacing: ".03em",
              resize: "none",
              lineHeight: 1.6,
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => setShowReModal(false)}
              style={modalCancelBtnStyle}
            >
              取消
            </button>
            <button type="button" onClick={() => void confirmRetell()} style={modalConfirmBtnStyle}>
              {reInput.trim() ? "按你说的改" : "重新生成"}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {/* 聊天设置页 */}
      {showChatSettings && conv ? (
        <div style={{ position: "absolute", inset: 0, zIndex: 90, background: T.bg }}>
          <ChatSettingsPanel
            character={character}
            conv={conv}
            myName={myName}
            maskAvatar={mask?.avatar ?? ""}
            blocked={conv.blocked === true}
            subReady={
              !!subApi &&
              subApi.enabled &&
              subApi.baseUrl.trim() !== "" &&
              subApi.model.trim() !== ""
            }
            onBack={() => setShowChatSettings(false)}
            onUpdate={applyPatch}
            onClearMessages={clearMessages}
            onToggleBlocked={(next) => void toggleBlocked(next)}
            onDeleteFriend={() => void deleteFriendFromChat()}
            onHardDeleteFriend={() => void hardDeleteFriendFromChat()}
            showToast={showToast}
          />
        </div>
      ) : null}

      {/* 心声档案（1.5.65）：点 TA 的头像进来。zIndex 比聊天设置高一点——
          将来从设置里也留个入口时，它盖在上面才对。 */}
      {showInnerPage ? (
        <InnerVoicePage
          charName={charName}
          charAvatar={actualCharAvatar}
          messages={messages}
          /* 外语聊天（1.9.50）：他心里那些字也用外语写——各栏**点一下**看中文、再点切回。
             没开外语就传空，页里照旧纯中文，什么都不多。 */
          transLang={conv?.translate?.out.on ? conv.translate.out.lang : undefined}
          transCache={conv?.transCache}
          onTranslate={translateCached}
          onBack={() => setShowInnerPage(false)}
        />
      ) : null}

      {/* 线下场合（1.7.5）：加号面板的「去见他」进来。与心声档案同一层做法——
          整页盖住聊天窗口。收场由页里那枚「结束」触发（不点就一直在线下）：
          落一句「你们刚见过」给线上一轮，并把这一场并进记忆。 */}
      {showOffline ? (
        <OfflineScenePage
          charName={charName}
          charAvatar={actualCharAvatar}
          charSignature={signature}
          myName={myName}
          myAvatar={actualMyAvatar}
          mySignature={userSignature}
          bg={actualBg}
          characterId={character.id}
          maskId={maskId}
          words={offlineWordsOf(conv)}
          onWordsChange={(n) =>
            void applyPatch({ offlineWordsMin: n.min, offlineWordsMax: n.max })
          }
          rounds={offlineMemoryRoundsOf(conv)}
          onRoundsChange={(n) => void applyPatch({ offlineMemoryRounds: n })}
          /* 连续发送那颗开关（1.7.11 从这儿传进去的）在 1.7.33 撤了：线下锁死连发，
             不再从这儿读 `conv.manualReply`（线上那颗照旧不动）。 */
          onGenerate={generateOfflineReply}
          /* 每演完一轮（她写一句、TA 回一段）后台看一眼：这一场攒够「带最近 __ 轮」那么多轮了吗？
             攒够就把这段归总进记忆（见面那条线），水位线推过去——下一轮起这段不再整段重放，
             记忆里已经有了（1.7.46）。零头先攒着，收场时（onEnd）一并归总。
             素材取全部记录：已归总过的那些由水位线（offlineSummarizedTo）自己滤掉，不会重算。 */
          onRoundEnd={(entries) => {
            void (async () => {
              try {
                const source = offlineAsMessages(entries);
                if (source.length < 4) return;
                const result = await maybeRunOfflineCondense(
                  { characterId: character.id, maskId, messages: source },
                  charName,
                  myName,
                  effTextApi,
                  offlineMemoryRoundsOf(conv),
                );
                if (result.ran) setMemory(await getMemory(character.id, maskId));
              } catch (err) {
                console.warn("[Memory] 线下归总失败：", err);
              }
            })();
          }}
          onEnd={(wrote, ended) => {
            setShowOffline(false);
            /* 1.7.39：左上角那颗「返回」**只是把这一页收起来**（回线上看记录），这一场还开着：
               总闸不动，线上那一格仍旧是「回到这一场」，发不了消息。只有「结束这一场」
               才算收场，把总闸放平、线上解锁。 */
            if (!ended) return;
            markOfflineOpen(false);
            /* 这一场真写过东西（有 TA 写下的段）才作数：点开又原样退出来，
               线上不该冒出「你们刚见过」。下一轮 requestReply 用掉即清。 */
            if (!wrote) return;
            void applyPatch({ offlineReturnNote: true });
            /* 收场把这场的零头一并归总（1.7.46）：rounds 传 0＝不看轮数、手里有多少归多少，
               下一场从零算起。见面这条线自己记账（水位线），不碰线上那本账。
               后台跑，不挡她回线上；失败只进 console。 */
            void (async () => {
              try {
                const scene = await getOfflineScene(character.id, maskId);
                const source = offlineAsMessages(scene.entries);
                if (source.length < 4) return;
                const result = await maybeRunOfflineCondense(
                  { characterId: character.id, maskId, messages: source },
                  charName,
                  myName,
                  effTextApi,
                  0,
                );
                if (result.ran) setMemory(await getMemory(character.id, maskId));
              } catch (err) {
                console.warn("[Memory] 线下归总失败：", err);
              }
            })();
          }}
        />
      ) : null}

      {/* 「查看本轮请求」（1.7.49）：这一轮真发出去的东西，摆出来给她对着看。 */}
      <button
        type="button"
        onClick={() => setShowReq(true)}
        style={{
          position: "absolute",
          right: 10,
          bottom: 104,
          zIndex: 95,
          padding: "5px 9px",
          borderRadius: 999,
          border: `1px solid ${T.line}`,
          background: T.bg,
          color: T.ink,
          fontSize: 10,
          letterSpacing: ".08em",
          opacity: 0.75,
        }}
      >
        本轮请求
      </button>
      {showReq ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            flexDirection: "column",
            padding: "calc(var(--safe-area-top, 0px) + 12px) 10px 12px",
          }}
        >
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "#fff",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            <span>本轮请求 · 这一轮真发出去的东西</span>
            <button
              type="button"
              onClick={() => setShowReq(false)}
              style={{ background: "transparent", border: 0, color: "#fff", fontSize: 12 }}
            >
              关闭
            </button>
          </div>
          <div
            style={{
              flex: "none",
              maxHeight: "48%",
              overflow: "auto",
              background: T.bg,
              borderRadius: 10,
              padding: "9px 11px",
              marginBottom: 8,
            }}
          >
            {lastReq ? (
              <>
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.7,
                    color: T.ink,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {`${lastReq.mode === "online" ? "线上" : "线下"} · ${new Date(lastReq.at).toLocaleTimeString()} · ${lastReq.model || "（模型空）"} · ${lastReq.stream ? "流式" : "非流式"} · 全文 ${lastReq.full.length} 字\n${lastReq.diff}`}
                </div>
                <div style={{ height: 1, background: T.lineSoft, margin: "8px 0" }} />
                <div style={{ fontSize: 11, lineHeight: 1.8, color: T.ink, fontWeight: 600 }}>
                  {lastReq.activated.length > 0
                    ? `本轮带进去的世界书（${lastReq.activated.length} 条）：`
                    : "本轮没有世界书条目被带进去。"}
                </div>
                {lastReq.activated.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      lineHeight: 1.8,
                      color: T.ink,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {`· 《${a.book}》 ${a.title}（${a.by}）`}
                  </div>
                ))}
                <div style={{ height: 1, background: T.lineSoft, margin: "8px 0" }} />
                <div style={{ fontSize: 11, lineHeight: 1.8, color: T.ink, fontWeight: 600 }}>
                  {`组装分段（${lastReq.sections.length} 段）：`}
                </div>
                {lastReq.sections.map((s, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, lineHeight: 1.7, color: T.ink, fontWeight: 600 }}>
                      {`${i + 1}. ${s.label} · ${s.content.length} 字`}
                    </div>
                    <pre
                      style={{
                        margin: "2px 0 0",
                        fontFamily: "monospace",
                        fontSize: 10,
                        lineHeight: 1.6,
                        color: T.ink,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {s.content}
                    </pre>
                  </div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.ink, lineHeight: 1.7 }}>
                还没有发过消息。先发一条，再点这个按钮。
              </div>
            )}
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              background: T.bg,
              borderRadius: 10,
              padding: "9px 11px",
            }}
          >
            <div style={{ fontSize: 11, lineHeight: 1.8, color: T.ink, fontWeight: 600 }}>
              原样全文（与真正发出去的一字不差）：
            </div>
            <pre
              style={{
                margin: "2px 0 0",
                fontFamily: "monospace",
                fontSize: 10,
                lineHeight: 1.6,
                color: T.ink,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {lastReq?.full ?? "（暂无）"}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* =======================================================================
 * 局部小组件与样式
 * ===================================================================== */

function avatarBox({
  avatar,
  fallbackChar,
  gradient,
  onClick,
  ring,
}: {
  avatar: string;
  fallbackChar: string;
  gradient: string;
  /* 1.5.65：只有聊天里 TA 那枚头像传它（点进「心声档案」）。
     其余各处（我自己的、流式预览、别的页面）都不传，行为一个字节没变。 */
  onClick?: () => void;
  /* 聊天页消息区才传：角色黑框、我粉框（乙版头像）。不传保持旧粉环。 */
  ring?: "char" | "me";
}) {
  return (
    <div
      onClick={onClick}
      /* 头像自己要接点击时，把「按下」拦在这一层：不然在头像上长按会同时弹出
         「删除／引用…」菜单、又进位这一页（手指抬起那一下仍会补一个 click）。
         拦下之后头像上长按＝什么都不发生；长按菜单照旧可以在气泡上按出来。 */
      {...(onClick
        ? {
            onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
            onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
          }
        : {})}
      style={{
        cursor: onClick ? "pointer" : undefined,
        WebkitTapHighlightColor: onClick ? "transparent" : undefined,
        flex: "none",
        width: 38,
        height: 38,
        borderRadius: ring ? 8 : "50%",
        background: avatar ? "#fff" : gradient,
        color: "#FFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 600,
        overflow: "hidden",
        boxShadow:
          ring === "me"
            ? "0 0 0 1.5px #E86A9B, 0 1px 2px rgba(232,106,155,.14), 0 4px 10px rgba(232,106,155,.16)"
            : ring === "char"
              ? "0 0 0 1.5px #141318, 0 1px 2px rgba(20,19,24,.10), 0 4px 10px rgba(20,19,24,.10)"
              : "0 0 0 1px rgba(232,106,155,.5),0 0 0 3px rgba(232,106,155,.13),inset 0 1px 2px rgba(255,255,255,.35)",
      }}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        fallbackChar || "TA"
      )}
    </div>
  );
}

const headerBtnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: T.ink,
  background: "transparent",
  transition: "all .18s",
  border: "none",
  cursor: "pointer",
  flex: "none",
};

const inputBtnStyle: CSSProperties = {
  flex: "none",
  width: 30,
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: T.ink2,
  background: "transparent",
  border: "none",
  transition: "all .15s",
  cursor: "pointer",
};

const smallBtnStyle: CSSProperties = {
  flex: "none",
  width: 24,
  height: 24,
  border: "none",
  background: "transparent",
  color: T.ink3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function SheetBtn({
  icon,
  label,
  color,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: "8px 8px",
        borderRadius: 7,
        border: "none",
        background: "transparent",
        fontSize: 10,
        color: T.ink,
        letterSpacing: ".04em",
        cursor: "pointer",
      }}
    >
      <span style={{ color, display: "flex" }}>{icon}</span>
      {label}
    </button>
  );
}

const SheetDivider = () => <span style={{ width: 1, height: 22, background: "rgba(20,19,24,.08)" }} />;

/* 文字图片卡的色卡：它不是一张卡片，是**一段胶卷里的一格**：深暖的片基、上下各排一道齿孔、
   中间那一格就是画面——图还没显影的时候，画面描述先印在画面上。
   胶片认得出的三样全在：片基、齿孔、画格。出图后这一格整个让位给真图（见 ImageBubble）。 */
const FILM_BASE = "#33262C"; // 片基：暖粉褐，比纯黑柔，跟这个 App 的粉调亲
const FILM_PERF = "rgba(255,247,249,.9)"; // 齿孔：露出来的就是 App 的背景色，像孔真的透过去
const FILM_PERF_H = 11; // 齿孔带高度
const FILM_PERF_GAP = 12; // 齿孔间距
const FILM_SHADOW = "0 8px 18px -10px rgba(60,20,40,.45)";
/* 画格：这一格就是「照片的画面」。还没显影，先铺一层柔粉雾，描述印在上面。 */
const FILM_CELL_FILL = "linear-gradient(165deg,#FDEBF3 0%,#FADCEA 55%,#F5CEDF 100%)";
const FILM_CELL_FILL_BAD = "linear-gradient(165deg,#FFF3F3 0%,#FDEAEA 100%)";
const FILM_CELL_EDGE = "inset 0 0 0 1px rgba(255,255,255,.14)";
const FILM_FOOT_H = 28; // 下齿孔上面那条片基（「生成」按钮落脚的地方）——留够上下呼吸，别贴着画格和齿孔
/* 画格：**2:3 竖版**——一张照片本来就该是这个样子。
   高度钉死：一格胶片就一个画面那么大，画面描述再长也不许把格撑长——字多了就把字缩小（见 PaperCaption）。 */
const FILM_CELL_W = 200;
const FILM_CELL_H = 300;
const PAPER_FONT_MAX = 13;
const PAPER_FONT_MIN = 8.5;

/**
 * 相纸上的画面描述。容器高度是定的，所以文案长了不能靠「长高」消化，
 * 只能把字号一档档往下调，直到整段话塞得下；缩到下限仍塞不下就由容器裁掉尾部
 * （能走到这一步的描述已经长得离谱了）。
 * 字号直接写 DOM 不走 state：这步要在同一帧里量完，中间态不让它上屏。
 */
function PaperCaption({
  text,
  dim = false,
  maxLines,
  lead,
}: {
  text: string;
  dim?: boolean;
  maxLines?: number;
  /** 描述前面那位小东西（那枚引号跟着字走，当这段描述的起首符）。 */
  lead?: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const span = textRef.current;
    if (!box || !span) return;
    if (maxLines) {
      /* 只当背景的那几处（生成中）不用缩字，截几行就够。 */
      span.style.fontSize = `${PAPER_FONT_MAX}px`;
      return;
    }
    let size = PAPER_FONT_MAX;
    span.style.fontSize = `${size}px`;
    /* 量 box 而不是量 span：引号也在版心里占一行，量 box 才把它的高度算进去。 */
    while (size > PAPER_FONT_MIN && box.scrollHeight > box.clientHeight) {
      size -= 0.5;
      span.style.fontSize = `${size}px`;
    }
  }, [text, maxLines]);

  return (
    <div
      ref={boxRef}
      style={{
        width: "100%",
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        /* 描述落到版心底部——留白全留在上方，不摊在正中。 */
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      {lead}
      <span
        ref={textRef}
        style={{
          display: maxLines ? "-webkit-box" : "block",
          width: "100%",
          fontSize: PAPER_FONT_MAX,
          /* 描述是印在胶片画格里的说明文，不是聊天正文：
             衬线（宋）、行距 1.8、字距 .02em，**左对齐**——一段被认真写下的画面，
             而不是一段居中摊开的对话。生成中（dim）再退一档到 ink3。 */
          color: dim ? T.ink3 : T.ink2,
          lineHeight: 1.8,
          letterSpacing: ".02em",
          fontFamily: SERIF,
          textAlign: "left",
          opacity: dim ? 0.6 : 1,
          ...(maxLines
            ? { WebkitLineClamp: maxLines, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }
            : null),
        }}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * 待显影的一格胶片：图还没画出来的时候，这条消息就是一段胶卷里还没出画面的那一格。
 * 长相：深暖的片基 ＋ 上下各一道齿孔 ＋ 中间 2:3 竖版的画格（画面描述印在画格里），
 * 胶片认得出的三样一个不少；不要英文抬头／TXT 角标／虚线框／英文落款。
 * 出图后这一格整个换成图（见 ImageBubble），描述退场。
 */
function PhotoPaper({
  children,
  footer,
  onClick,
  tone = "normal",
  shimmer = false,
}: {
  children?: ReactNode;
  /** 画格下面那条片基：「生成」归到照片最下方去，别跟描述挤在画格里。
   *  没给就是一条空的片基——胶卷下沿本来就该有这么一截。 */
  footer?: ReactNode;
  onClick?: () => void;
  tone?: "normal" | "error";
  shimmer?: boolean;
}) {
  const bad = tone === "error";
  /* 齿孔：一排等距小圆点，用 radial-gradient 平铺出来（不是真去排一串 div）。 */
  const perfRow = (
    <div
      style={{
        height: FILM_PERF_H,
        flex: "none",
        backgroundImage: `radial-gradient(circle, ${FILM_PERF} 1.7px, transparent 1.8px)`,
        backgroundSize: `${FILM_PERF_GAP}px ${FILM_PERF_H}px`,
        backgroundPosition: `${FILM_PERF_GAP / 2}px 50%`,
        backgroundRepeat: "repeat-x",
      }}
    />
  );
  return (
    <div
      onClick={onClick}
      style={{
        width: FILM_CELL_W,
        boxSizing: "border-box",
        background: FILM_BASE,
        borderRadius: 10,
        boxShadow: FILM_SHADOW,
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {perfRow}
      {/* 画格：这一格里真正成像的那块。未生成时装描述、生成中走微光、失败装淡红提示。
          高度定死（2:3 竖版），长文案由字号让路（见 PaperCaption）。 */}
      <div
        style={{
          position: "relative",
          height: FILM_CELL_H,
          boxSizing: "border-box",
          padding: "18px 16px 14px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          boxShadow: FILM_CELL_EDGE,
          background: shimmer
            ? "linear-gradient(110deg,#FFF0F5 30%,#FFD7E5 50%,#FFF0F5 70%)"
            : bad
              ? FILM_CELL_FILL_BAD
              : FILM_CELL_FILL,
          ...(shimmer
            ? { backgroundSize: "200% 100%", animation: "imgShimmer 1.6s linear infinite" }
            : null),
        }}
      >
        {/* 画格的内容不摊在正中——描述贴着画格下沿、左对齐排，像照片下沿那行说明：
            版心明确、留白全在上头，一进来先看见画面，再顺着往下读到字。 */}
        {children}
      </div>
      {/* 画格下沿那条片基：「生成」按钮落在右下角，没有就留一片片基本色。 */}
      <div
        style={{
          height: FILM_FOOT_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "0 14px",
          gap: 8,
        }}
      >
        {footer}
      </div>
      {perfRow}
    </div>
  );
}

/** 图片气泡：同步解码（decoding="sync"）保证挂载即整图出现、不从上往下渐进刷出；
    加载失败（旧图的远程链接已过期等）换成「重新生成」的出路，不留破图。 */
function ImageBubble({
  src,
  alt,
  onOpen,
  onRegen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
  /** 图丢了点一下重新生成——**只有 TA 发的图有这一手**（用户自己发的图不给：
   *  那条路会拿消息正文当画面描述去打生图接口，既不是原图、还白花一次钱）。 */
  onRegen?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  /* src 可能是媒体仓库的引用串（新图）或 data URL／http 链接（历史图），
     统一在这里换成能直接喂 <img> 的地址。刚生成完的图已在缓存里，同步命中不会闪；
     解析完却是空串＝仓库里没这笔（图确实没了），按「已丢失」呈现。 */
  const resolved = useMediaSrc(src);
  const missing = resolved === "";
  if (broken || missing) {
    return (
      <PhotoPaper tone="error" onClick={onRegen}>
        <ImageIcon size={22} strokeWidth={1.3} color={T.danger} />
        <span style={{ fontSize: 11.5, color: T.danger, fontFamily: SANS }}>图片已过期或丢失</span>
        {onRegen ? (
          <span style={{ fontSize: 10.5, color: "rgba(232,106,155,.85)", letterSpacing: ".04em" }}>
            点此重新生成
          </span>
        ) : null}
      </PhotoPaper>
    );
  }
  /* 正在从仓库取图（冷启动首屏才可能看到）：撑住高度，别让相纸从 0 塌一下再弹开。 */
  if (!resolved) {
    return <PhotoPaper />;
  }
  /* 真图不套「相纸」那层壳（照片发出来不要边框、不要气泡）——白底 + 1px 灰边 +
     5px 白衬边 + 纸阴影会看着像一张被框住的相片；
     现在就是干净一张圆角图，只在底下留一层极淡的影托住它，不至于跟背景贴成一片。
     纸感只留给「还没画出来」的那几种状态（见上面 PhotoPaper）。 */
  return (
    <div
      onClick={onOpen}
      style={{
        width: 200,
        boxSizing: "border-box",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        boxShadow: "0 2px 10px -5px rgba(20,19,24,.22)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={alt}
        decoding="sync"
        onError={() => setBroken(true)}
        style={{ display: "block", width: "100%", height: "auto" }}
      />
    </div>
  );
}

/* ── 语音播放：常驻复用、挂进 DOM 的宿主 <audio> ───────────────────────────────
   参考项目 ai-virtual-phone 的语音条（components/chat/message-bubble.tsx 的
   VoiceMessageBubble.playSrc）只用媒体元素播、不碰 Web Audio——其注释原话：iOS 静音
   拨键会掐掉 Web Audio 的输出（表现为全线无声），媒体元素不受影响。
   我们和它的差别在前端框架：React 一重渲染，临时 new 出来的元素就没人管了。所以这里
   用一个模块级、挂进 DOM、全程复用的元素，播前重设 src、回零再 play。
   1.9.67 正是这套写法，当时实测能出声；1.9.69～1.9.71 换成「每次 new + 手势解锁」，
   反倒变成时响时哑——故退回这套。 */

/* 真正播语音的元素：常驻、复用，全程只此一个。 */
let voiceEl: HTMLAudioElement | null = null;

/** 建宿主 <audio>：挂进 DOM、隐藏。游离（不在 DOM 里）的元素在 iOS 上不可靠。 */
function mountHiddenAudio(el: HTMLAudioElement): void {
  el.setAttribute("playsinline", "");
  el.preload = "auto";
  el.style.display = "none";
  if (typeof document !== "undefined") document.body.appendChild(el);
}

/** 播语音就用它：常驻复用，不每次新建。 */
function getVoiceEl(): HTMLAudioElement {
  if (!voiceEl) {
    voiceEl = new Audio();
    mountHiddenAudio(voiceEl);
  }
  return voiceEl;
}

/** 停掉正在响的语音（不清 src：元素常驻复用，留着下次直接换源）。 */
function stopVoiceEl(): void {
  const el = voiceEl;
  if (!el) return;
  try { el.pause(); } catch { /* 已经没了 */ }
}

/** 语音此刻在响吗——不看界面上的标记，那玩意会卡住骗人。 */
function isVoiceElPlaying(): boolean {
  return !!voiceEl && !voiceEl.paused && !voiceEl.ended;
}

/** 朗读前洗掉「演给人看、不该念出来」的部分：（）／() 里的动作、心理、场景描写。
    恩熙那套提示词把「带括号＝不可发声／不带括号＝台词」定死了，可送 TTS 的一直是这条
    原文，括号里的动作也就被一起念了（她的原话：「他现在会读括号内的动作」）。
    只洗圆括号——十一 ElevenLabs 的英文方括号标签（[gasp] 之类）是给 TTS 的指令，留着。
    洗空了（整条都是动作）就退回原文，宁可照念也别把语音合成成空的。 */
function voiceSpokenText(content: string): string {
  const cleaned = content
    .replace(/（[^）]*）|\([^)]*\)/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return cleaned || content.trim();
}

/** 系统版本，只给诊断行报数用。 */
function iosVersion(): string {
  if (typeof navigator === "undefined") return "?";
  const m = /OS (\d+)[._](\d+)/.exec(navigator.userAgent);
  return m ? `${m[1]}.${m[2]}` : "?";
}

/** 播一条语音（dataUrl）。用常驻复用的宿主 <audio>，播前重设源、回零再 play。
    返回 play() 被拒的原因（好让界面给一行诊断）；成功（含静默失败）返回 null。 */
function playVoiceViaElement(dataUrl: string, onEnded: () => void): Promise<string | null> {
  stopVoiceEl(); /* 先停掉上一条 */
  const el = getVoiceEl();
  let settled = false;
  const finalize = () => {
    if (settled) return;
    settled = true;
    onEnded();
  };
  el.onended = finalize;
  el.onerror = finalize;
  el.muted = false;
  el.volume = 1;
  el.src = dataUrl;
  try { el.currentTime = 0; } catch { /* 还没加载完就设不了，无所谓 */ }
  return el.play().then(
    () => null,
    (err) => {
      const e = err as { name?: string; message?: string } | null;
      finalize();
      return `play() 被拒绝（${e?.name ?? "?"} ${e?.message ?? ""}）`;
    },
  );
}

/* 复制兜底：不安全的 http 页面（局域网 IP）里 navigator.clipboard 是 undefined，
   只能靠这个老办法——临时塞个隐藏 textarea 选中，再 execCommand("copy")。
   必须在用户的点击手势里同步跑完，iOS 才认；所以不能 await 任何东西。
   注意 textarea 挂在 document.body 上，不在被禁选的 .chat-body 里，不受影响。 */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function ModalShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, zIndex: 63, background: "rgba(20,19,24,.34)" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 30,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 320,
            background: "#FFF",
            borderRadius: 18,
            padding: "26px 22px",
            textAlign: "center",
            boxShadow: "0 20px 60px rgba(20,19,24,.2)",
            pointerEvents: "auto",
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

const modalTitleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  letterSpacing: ".1em",
  color: T.ink,
};

const modalEnStyle: CSSProperties = {
  fontFamily: SANS,
  fontStyle: "italic",
  fontSize: 9.5,
  color: T.ink3,
  letterSpacing: ".3em",
  marginTop: 4,
  textTransform: "lowercase",
};

const modalDescStyle: CSSProperties = {
  fontSize: 12.5,
  color: T.ink2,
  marginTop: 12,
  lineHeight: 1.7,
  letterSpacing: ".03em",
};

const modalCancelBtnStyle: CSSProperties = {
  flex: 1,
  padding: "11px 0",
  borderRadius: 11,
  border: "none",
  fontSize: 14,
  letterSpacing: ".14em",
  background: "rgba(20,19,24,.05)",
  color: T.ink2,
  fontFamily: SANS,
  cursor: "pointer",
};

const modalConfirmBtnStyle: CSSProperties = {
  flex: 1,
  padding: "11px 0",
  borderRadius: 11,
  border: "none",
  fontSize: 14,
  letterSpacing: ".14em",
  background: "linear-gradient(135deg,#F49BBE,#E86A9B)",
  color: "#FFF",
  fontFamily: SANS,
  cursor: "pointer",
};

/* 1.4.88 转账详情那张票里的按钮：方角（跟票一个脾气，不跟外面圆角弹窗走）。
   灰的那枚＝「退还／好」——次要动作与收尾，落在纸上不抢；粉的那枚＝「收下」，
   整张票里唯一还能动的动作（落定＝褪色、安静下来，粉只留给还没落定的钱）。 */
const ticketQuietBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  borderRadius: 2,
  border: "none",
  fontSize: 14,
  letterSpacing: ".14em",
  background: "rgba(20,19,24,.05)",
  color: T.ink2,
  fontFamily: SANS,
  cursor: "pointer",
};

const ticketMainBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  borderRadius: 2,
  border: "none",
  fontSize: 14,
  letterSpacing: ".14em",
  background: "linear-gradient(135deg,#F49BBE,#E86A9B)",
  color: "#FFF",
  fontFamily: SANS,
  cursor: "pointer",
};

/* 1.4.88：转账／回执点开看的详情——**那张票的放大版**（组件由 ChatWindow 里的
   openMoney 分支调用：红包 1.4.89 起走 RedPacketModal，不走这套）。卡片从 1.4.80 起是一张
   存根票根，点开却还是一枚白圆角小弹窗，两张东西不像一家人 ⇒ 详情整张换成票：
   同一张暖纸、同一排右沿撕口齿、同一套五段（宋体抬头＋右上同一个号／付款方
   收款方／金额／附言／落款），字号各放大一档；比卡片多给的一行是「时间」——
   转账＝转账那一刻，回执＝原转账那一刻（payAt，跟两联同一个号是同一条时间）。
   落定／回执档的颜色跟 renderBody 里 transfer／receipt 两个 case 的配方一字
   不差（改那边时这里要跟着一起改）。按钮收进票里、方角：只有「TA 发给我、
   还没落定的转账」有「收下（粉）／退还（灰）」；其余只有一枚灰的「好」。 */
function TicketMoneyModal({
  m,
  charName,
  myName,
  onClose,
  onClaim,
  onRefund,
}: {
  m: ChatMessage;
  charName: string;
  myName: string;
  onClose: () => void;
  onClaim: (m: ChatMessage) => void;
  onRefund: (m: ChatMessage) => void;
}) {
  /* 回执一出生就是落定的（1.4.85）；转账看收下／退还。 */
  const isRec = m.type === "receipt";
  const refunded = m.moneyRefunded === true;
  /* 过期（1.5.12）：我发出去、他一直没表态，走过上下文那么多条就作废退回（见 expireStaleMoney）。 */
  const expired = m.moneyExpired === true;
  const recRefunded = isRec && (m.content || "已收款") === "已退还";
  const done = isRec || m.moneyClaimed === true || refunded || expired;
  /* 颜色三档跟票根那张同一个配方。 */
  const pink = done ? "#D9B3C0" : T.pink;
  const blue = done ? "#A9B2C4" : "#3A6FD8";
  const sub = done ? "#C3BDB5" : "#8E8880";
  const noteBg = done ? "rgba(20,19,24,.04)" : "rgba(232,106,155,.07)";
  const paper = done ? "#F6F4F1" : "#FCFAF6";
  const dash = done ? "1px dashed rgba(20,19,24,.12)" : "1px dashed rgba(20,19,24,.22)";
  /* 抬头是两个字的宋体名词（跟卡片两联同一个写法）；付款方／收款方的推法也跟
     renderBody 那两个 case 一字不差——回执的 role＝收款方是谁，转账的 role＝谁发的。 */
  const title = isRec ? (recRefunded ? "退还" : "收款") : "转账";
  const from = isRec
    ? m.role === "user"
      ? charName
      : myName
    : m.role === "user"
      ? myName
      : charName;
  const to = isRec
    ? m.role === "user"
      ? myName
      : charName
    : m.role === "user"
      ? charName
      : myName;
  /* 编号跟卡片上那个是同一个号：回执取 payAt（原转账那条的时间戳，1.4.84），
     转账取自己的时间戳——都是末四位。 */
  const timeIso = isRec ? (m.payAt ?? m.createdAt) : m.createdAt;
  const noMs = Date.parse(timeIso);
  const no = `NO. ${Number.isFinite(noMs) ? String(noMs % 10000).padStart(4, "0") : "0000"}`;
  const time = `${dayLabel(timeIso)} ${msgTime(timeIso)}`;
  /* 落款那行字：转账跟卡片的 trFoot 同一套话（点开看的那张不再说「点击收取」，
     说「待收取」——收下的按钮就躺在底下）；回执说的是钱落到了哪儿。 */
  const foot = isRec
    ? recRefunded
      ? "钱已原路退回"
      : m.role === "user"
        ? "已存入我的零钱"
        : `已存入 ${charName} 的零钱`
    : refunded
      ? m.role === "user"
        ? "他已退还"
        : "已退还"
      : expired
        ? "已过期，钱已退回"
        : m.moneyClaimed === true
          ? m.role === "user"
            ? "他已经收下"
            : "已收下"
          : m.role === "user"
            ? "等他收下"
            : "待收取";
  /* 只有「TA 发给我的、还没落定的」有动作（收下／退还）。 */
  const needAction =
    !isRec && m.role === "assistant" && !m.moneyClaimed && !refunded && !expired;
  return (
    <>
      <div
        style={{ position: "absolute", inset: 0, zIndex: 63, background: "rgba(20,19,24,.34)" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
          pointerEvents: "none",
        }}
      >
        {/* 那张放大的票：暖纸、方角、细边；还没落定的钱压着那层硬影（跟卡片
            一样，影是「还在等」的紧张感），落定就收成一块平的暖灰。 */}
        <div
          style={{
            position: "relative",
            width: 272,
            maxWidth: "100%",
            background: paper,
            /* 同上：border 简写＋borderRight 混用会触发 React 样式冲突警告，拆成具体的。 */
            borderTop: `1px solid ${done ? "rgba(20,19,24,.07)" : T.line}`,
            borderRight: "none",
            borderBottom: `1px solid ${done ? "rgba(20,19,24,.07)" : T.line}`,
            borderLeft: `1px solid ${done ? "rgba(20,19,24,.07)" : T.line}`,
            borderRadius: 0,
            padding: "16px 17px 15px",
            pointerEvents: "auto",
            boxShadow: done ? "none" : WALLET_PAPER_SHADOW,
          }}
        >
          {/* ① 抬头＋右上同一个号 */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: ".14em",
                color: done ? T.ink3 : T.ink,
              }}
            >
              {title}
            </span>
            <span
              style={{
                flex: "none",
                fontFamily: WALLET_MONO,
                fontSize: 9.5,
                letterSpacing: ".08em",
                color: sub,
                whiteSpace: "nowrap",
              }}
            >
              {no}
            </span>
          </div>
          <div style={{ marginTop: 10, borderTop: dash }} />
          {/* ② 付款方／收款方：字号比卡片大一级，名目那一栏也放宽一点 */}
          <div style={{ marginTop: 11, display: "grid", gap: 7 }}>
            {[
              { k: "付款方", v: from },
              { k: "收款方", v: to },
            ].map((row) => (
              <div key={row.k} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span
                  style={{
                    flex: "none",
                    width: 36,
                    fontFamily: WALLET_MONO,
                    fontSize: 10,
                    letterSpacing: ".1em",
                    color: sub,
                  }}
                >
                  {row.k}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: SERIF,
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: blue,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.v}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 11, borderTop: dash }} />
          {/* ③ 金额：整张票最重的一件 */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 13 }}>
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 16,
                fontWeight: 500,
                color: pink,
              }}
            >
              ¥
            </span>
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 33,
                fontWeight: 700,
                color: pink,
                lineHeight: 1,
                letterSpacing: "-.01em",
              }}
            >
              {m.amount?.toFixed(2) || "0.00"}
            </span>
          </div>
          {/* ④ 附言（转账才有；回执那两个字已经当了抬头） */}
          {!isRec && m.content.trim() ? (
            <div
              style={{
                marginTop: 11,
                background: noteBg,
                padding: "5px 8px",
                fontFamily: SANS,
                fontSize: 12,
                lineHeight: 1.6,
                color: sub,
              }}
            >
              {m.content}
            </div>
          ) : null}
          {/* 时间：详情比卡片多给的一行（名目＋值，跟付款方那两行同一个款式）。 */}
          <div style={{ marginTop: 11, display: "flex", alignItems: "baseline", gap: 5 }}>
            <span
              style={{
                flex: "none",
                width: 36,
                fontFamily: WALLET_MONO,
                fontSize: 10,
                letterSpacing: ".1em",
                color: sub,
              }}
            >
              时间
            </span>
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 11,
                letterSpacing: ".04em",
                color: sub,
              }}
            >
              {time}
            </span>
          </div>
          {/* ⑤ 落款：左端状态、右端一枚记号（还在等是小点、收下 ✓、退还 ↺）。 */}
          <div
            style={{
              marginTop: 11,
              paddingTop: 8,
              borderTop: dash,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 11,
                color: pink,
                letterSpacing: ".06em",
              }}
            >
              {foot}
            </span>
            {refunded || recRefunded ? (
              <RotateCcw size={13} strokeWidth={2} color={pink} />
            ) : done ? (
              <Check size={13} strokeWidth={2.2} color={pink} />
            ) : (
              <span style={{ width: 6, height: 6, background: pink }} />
            )}
          </div>
          {/* 按钮收进票里：粉的只有「收下」，其余（退还／好）都是灰的。 */}
          <div style={{ display: "flex", gap: 10, marginTop: 15 }}>
            {needAction && m.type === "transfer" ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRefund(m);
                }}
                style={ticketQuietBtnStyle}
              >
                退还
              </button>
            ) : null}
            {needAction ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onClaim(m);
                }}
                style={ticketMainBtnStyle}
              >
                收下
              </button>
            ) : (
              <button type="button" onClick={onClose} style={ticketQuietBtnStyle}>
                好
              </button>
            )}
          </div>
          {/* 右沿那排撕口齿：跟卡片那两联同一条（颜色从纸色算出来）。 */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: -7,
              width: 7,
              backgroundImage: `radial-gradient(circle at 0 7px, ${paper} 0 6px, transparent 6.5px)`,
              backgroundSize: "7px 14px",
              backgroundRepeat: "repeat-y",
            }}
          />
        </div>
      </div>
    </>
  );
}

/* ── 红包那套（1.4.89）：聊天里的卡＋点开的开红包页 ─────────────────────
   恩熙：「红包不能跟转账是同样的模式，参考微信红包的样式那种感觉——有封面、
   封面可以自定义，按下开之后有开红包的动画。」转账是纸票据、红包是红纸封，两个世界：
   预设封面是纯 CSS 渐层（redpacket.ts），自定义封面是媒体仓库里的图（useMediaSrc
   解地址，消息里只存引用串）；领过（他没领也一样）整张洗成淡色。动画的 keyframes
   （rp-burst-a/b/c）在 globals.css；封套与开完那两张脸的形状在 RedPacketCards.tsx。 */

/** 开红包时迸出来的那把金屑：三组方向（rp-burst-a/b/c）＋大小／颜色／延迟错开，
 *  看着像一把，不必每颗一条 keyframes。 */
const RP_BURST: { n: string; s: number; c: string; r: string; d: number }[] = [
  { n: "rp-burst-a", s: 7, c: "#FFE3A8", r: "50%", d: 0 },
  { n: "rp-burst-a", s: 5, c: "#FFF6E3", r: "2px", d: 0.06 },
  { n: "rp-burst-b", s: 6, c: "#FFD27E", r: "50%", d: 0.02 },
  { n: "rp-burst-b", s: 5, c: "#F6B26B", r: "2px", d: 0.08 },
  { n: "rp-burst-c", s: 8, c: "#FFE3A8", r: "50%", d: 0 },
  { n: "rp-burst-c", s: 5, c: "#F49CB8", r: "50%", d: 0.1 },
  { n: "rp-burst-a", s: 4, c: "#FFF6E3", r: "2px", d: 0.12 },
  { n: "rp-burst-b", s: 4, c: "#FFD27E", r: "50%", d: 0.14 },
];

/** 聊天里那张红包卡：横条一封——左边一枚圆底图标（lucide 的礼盒，白细线），
 *  右边两行字：上面留言、下面「星绥红包」。这就是微信聊天里那张卡的摆法。
 *  必须是独立组件（不在 renderBody 里写）：自定义封面要挂 useMediaSrc 读仓库，
 *  switch 里挂 hook 就乱了。
 *  【1.4.92：换摆法】1.4.89～1.4.91 一直是竖着的红纸封套（正中「福」、下面祝福语、
 *  底沿状态字）。恩熙连否几轮，最后点明两件事：一是**排版**不对、二是「不要用这个
 *  红包图标了」——那枚信封是我自己拿几根线描的，线条又硬又呆。这一版不再雕封套：
 *  卡压成横条、图标换成现成图标库里已画好的礼盒，状态不再另占一行（没落定的第二行
 *  就是「星绥红包」，落定了才换成状态字，状态不丢）。
 *  【1.4.94：领完之后不再洗灰】1.4.91～1.4.93 是给整张卡挂 `filter: grayscale(.72)`
 *  ——恩熙：「点击领取之后，它不会是整个变黑的，而是一个渐变的感觉……不会让整张图
 *  都变成灰掉了那种感觉」。这一版红封套**原样不动**，done 之后上面淡进一层浅色
 *  渐层（`RED_COVER_CLAIMED_VEIL`），字与图标跟着翻成深色，过渡走 opacity/color
 *  的 transition——红退成微信那种「已领取」的浅卡，而不是一张灰纸。
 *  【1.9.78：换成「柔和野兽派」】恩熙从四套里挑了第四套，卡面整个翻新：平灰底
 *  ＋2px 近黑描边＋4px 平推硬投影；纹样（顶边一道粉、右几颗柔色圆点、左下一条羽化
 *  紫斜条）挂 `RED_COVER_TONE.glow`，排在 veil 之前（领过之后被遮罩压淡）；圆标粉底
 *  黑边，里头换成红包图标；字走衬线斜体，第二行改报来头「From 角色名／我的名字」
 *  （落定才换回状态字）。照片封面不压纹样，改用一道深色 scrim 压底、字翻白加暗投影；
 *  领过之后压同色系浅灰 veil、整块字降一档透明度，不洗灰。 */
function RedPacketCard({
  m,
  charName,
  myName,
  onOpen,
}: {
  m: ChatMessage;
  /** 发红包那位（TA）的名字——第二行「From …」用。 */
  charName: string;
  /** 我自己的名字——我发的红包第二行「From …」用。 */
  myName: string;
  onOpen: () => void;
}) {
  const atMe = m.role === "assistant";
  const refunded = m.moneyRefunded === true;
  /* 过期（1.5.12）：我发出去、他一直没领，走过上下文那么多条就作废、钱退回我口袋
     （见 expireStaleMoney）。旧数据里我发的红包可能带着 moneyRefunded（1.5.12 之前
     「不领＝退还」那套口径）：那种钱其实也回了口袋，照「已过期」展示——
     界面上不再出现「未领取」这个词。 */
  const expired = m.moneyExpired === true || (!atMe && refunded);
  const done = m.moneyClaimed === true || refunded || expired;
  /* 状态字：我发的只有 等他领取／他已领取／已过期 三种；他发的只有 点击领取／已领取。 */
  const foot = atMe
    ? m.moneyClaimed === true
      ? "已领取"
      : "点击领取"
    : expired
      ? "已过期"
      : m.moneyClaimed === true
        ? "他已领取"
        : "等他领取";
  /* 第二行平时报来头（微信那种 From ＋ 名字），落定了才换成状态字——状态照旧看得见。 */
  const sub = done ? foot : `From ${atMe ? charName : myName}`;
  /* 封面：自定义图（引用串／data URL）优先；没选过就是那张默认封套。
     挪过位置的封面尾巴上带取景后缀——读图前先剥掉（redCoverSrcRefOf 一并管了），
     铺的时候再照**这一处**的位置铺（卡面上的取景跟开红包那页、详情页各归各挪）。 */
  const customSrc = useMediaSrc(redCoverSrcRefOf(m.redCover));
  const preset = redCoverPresetOf();
  const coverBg = redCoverBgOf(customSrc, redCoverPosOf(m.redCover, "card"), preset.bg);
  /* 字色分两路：预设灰底走深墨字；照片上翻白字＋一道暗投影。领过之后（done）
     上面压了浅灰 veil，两路一律翻回深墨、暗投影收掉。 */
  const onPhoto = Boolean(customSrc) && !done;
  const noteColor = onPhoto ? "#FFFFFF" : RED_COVER_TONE.ink;
  const subColor = onPhoto ? "rgba(255,255,255,.9)" : RED_COVER_TONE.inkSoft;
  const noteShadow = onPhoto ? "0 1px 4px rgba(0,0,0,.55)" : "none";
  return (
    <div
      onClick={onOpen}
      style={{
        position: "relative",
        width: 228,
        height: 76,
        borderRadius: 11,
        boxSizing: "border-box",
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        background: coverBg,
        border: `2px solid ${RED_COVER_TONE.chipBorder}`,
        boxShadow: RED_COVER_TONE.shadow,
      }}
    >
      {/* 照片封面：压一道深色 scrim 让白字读得清（领过之后收掉）。
          预设封面有自己的纹样，不压它。 */}
      {customSrc ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "#1A1A1A",
            opacity: done ? 0 : 0.34,
            transition: "opacity .4s ease",
          }}
        />
      ) : null}
      {/* 纹样（1.9.78）：顶边一条粉＋右下三颗柔色圆点＋左下一条羽化紫斜条。
          排在 veil 之前，领过之后被那层浅灰遮罩压淡；照片封面不压。 */}
      {!customSrc ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: RED_COVER_TONE.glow,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {/* 领过之后淡上来的浅灰遮罩（1.4.94）：卡退成「已领取」的浅样子。
          自定义图不压满——低一档，图还看得见，且**不走去色**。 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: RED_COVER_CLAIMED_VEIL,
          opacity: done ? (customSrc ? 0.72 : 1) : 0,
          transition: "opacity .4s ease",
        }}
      />
      {/* 左边那枚圆标：粉底黑边，里头是红包图标（1.9.78 起不再是礼盒）。 */}
      <span
        style={{
          position: "relative",
          flex: "none",
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: RED_COVER_TONE.chipBg,
          border: `2px solid ${RED_COVER_TONE.chipBorder}`,
          color: RED_COVER_TONE.chipInk,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RedPacketGlyph size={20} strokeWidth={1.6} />
      </span>
      {/* 右边两行：上面留言（大字），下面报来头／状态（小字）。领过之后整块淡一档。 */}
      <span
        style={{
          position: "relative",
          marginLeft: 12,
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          opacity: done ? 0.52 : 1,
          transition: "opacity .4s ease",
        }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.35,
            color: noteColor,
            letterSpacing: ".03em",
            textShadow: noteShadow,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color .4s ease, text-shadow .4s ease",
          }}
        >
          {m.content.trim() || "恭喜发财"}
        </span>
        <span
          style={{
            marginTop: 3,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1.3,
            color: subColor,
            letterSpacing: ".07em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color .4s ease",
          }}
        >
          {sub}
        </span>
      </span>
    </div>
  );
}

/** 点开红包那一页：干净的深底＋一张竖封套＋「開」的那一下。
 *  只有「TA 发给我、还没领」的红包有开的过程（点「開」→金圆印淡出去、金屑迸出，
 *  动画里 claimMoney 真领钱——领成了金额才揭晓，没领成退回没开的样子）；
 *  我发的／已落定的一进来就是揭晓后的样子（同一块封面接着白纸上的金额）。
 *  两张脸的形状都在 `RedPacketCards.tsx`（跟聊天里那张卡、试衣间的预览同一张）。 */
function RedPacketModal({
  m,
  charName,
  myName,
  charAvatar,
  myAvatar,
  onClose,
  onClaim,
}: {
  m: ChatMessage;
  charName: string;
  myName: string;
  charAvatar: string;
  myAvatar: string;
  onClose: () => void;
  onClaim: (m: ChatMessage) => Promise<boolean>;
}) {
  const atMe = m.role === "assistant";
  const refunded = m.moneyRefunded === true;
  const claimed = m.moneyClaimed === true;
  /* 过期（1.5.12，跟红包卡 RedPacketCard 同一套口径）：我发的、他一直没领，
     走过上下文那么多条就作废退回。旧数据里我发的红包带 moneyRefunded 的也照过期说。 */
  const expired = m.moneyExpired === true || (!atMe && refunded);
  const canOpen = atMe && !claimed && !refunded && !expired;
  const [phase, setPhase] = useState<"cover" | "opening" | "revealed" | "detail">(
    canOpen ? "cover" : "revealed",
  );
  /* 封面：跟聊天里那条卡同一份铺法（先剥取景后缀去读图，再照**这一处**的位置铺）。
     开红包这一页（还没开那张封套、开完之后那张纸）是同一块封面、同一档取景；
     领取详情页顶上那条通栏另算一档——两处各挪各的。 */
  const customSrc = useMediaSrc(redCoverSrcRefOf(m.redCover));
  const preset = redCoverPresetOf();
  const coverBgOpen = redCoverBgOf(customSrc, redCoverPosOf(m.redCover, "open"), preset.bg);
  const coverBgDetail = redCoverBgOf(customSrc, redCoverPosOf(m.redCover, "detail"), preset.bg);
  const sender = atMe ? charName : myName;
  const note = m.content.trim() || "恭喜发财";
  const time = `${dayLabel(m.createdAt)} ${msgTime(m.createdAt)}`;
  /* 揭晓后那行状态：我发的只有 已进他零钱／已过期 两种（过期＝钱退回我这儿），
     他发的就是 到没到我的零钱。不再出现「未领取」这个词。 */
  const statusLine = atMe
    ? claimed
      ? "已存入我的零钱"
      : "领取后存入我的零钱"
    : expired
      ? "已过期，钱已退回"
      : claimed
        ? `已进 ${charName} 的零钱`
        : "还没进他的零钱，等他领取";
  /* 点「開」：先放动画，动画里真去领钱；claimMoney 回没回本，决定动画放完是揭晓
     还是退回「还没开」（钱没到账时这页不能装作领到了——toast 已替它说了实话）。 */
  const tapOpen = () => {
    if (phase !== "cover") return;
    setPhase("opening");
    void onClaim(m).then((ok) => {
      window.setTimeout(() => setPhase(ok ? "revealed" : "cover"), ok ? 850 : 400);
    });
  };
  /* 详情页（1.4.93）：从揭晓那一屏点「查看领取详情」进来。微信的「领取详情」
     是一整页浅底的清单，不是盖在聊天上的一块弹层——所以这里整页换掉，
     不是再叠一层。钱早在点「開」那一下就已经动过了，这一页只读。 */
  if (phase === "detail") {
    return (
      <RedPacketDetailPage
        m={m}
        sender={sender}
        senderAvatar={atMe ? charAvatar : myAvatar}
        recipient={atMe ? myName : charName}
        recipientAvatar={atMe ? myAvatar : charAvatar}
        note={note}
        coverBg={coverBgDetail}
        customSrc={customSrc}
        time={time}
        statusLine={statusLine}
        onBack={() => setPhase("revealed")}
      />
    );
  }
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 63,
          /* 夜底：近黑里掺一点暖、不透明度压在半透——封套边缘不至于糊进黑里。 */
          background:
            "radial-gradient(120% 92% at 50% 34%, rgba(78,44,38,.72), rgba(22,17,16,.86))",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 30,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 300,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            pointerEvents: "auto",
          }}
        >
          {/* 还没开：一张封套——上半是封面、压着两行字（谁发的、那句祝福），
              照片底边在中间往下探出一条弧，红带从两侧包上来，弧的最低点上坐着「開」。
              （形状见 RedPacketCards.tsx：聊天里那张卡、试衣间里的预览同一张脸。） */}
          {phase !== "revealed" ? (
            <RedEnvelopeCard
              coverBg={coverBgOpen}
              customSrc={customSrc}
              senderLine={`${sender} 的红包`}
              note={note}
              onOpen={tapOpen}
              opening={phase === "opening"}
              burst={
                phase === "opening"
                  ? RP_BURST.map((b, i) => (
                      <span
                        key={i}
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          width: b.s,
                          height: b.s,
                          marginLeft: -b.s / 2,
                          marginTop: -b.s / 2,
                          borderRadius: b.r,
                          background: b.c,
                          opacity: 0,
                          animation: `${b.n} .75s ease-out ${b.d}s forwards`,
                        }}
                      />
                    ))
                  : null
              }
            />
          ) : (
            /* 揭晓：同一块封面，下面接一张白纸（金额＋状态＋落款），
               纸上一道细线收着「查看领取详情」。
               揭晓这一屏的卡比没开那张再大一点点——卡里每一处尺寸都是定死的像素，
               放大只能靠整体缩放（形状一点不动），所以在这儿套一层。 */
            <div style={{ transform: "scale(1.08)" }}>
              <RedOpenedCard
                coverBg={coverBgOpen}
                customSrc={customSrc}
                amount={(m.amount ?? 0).toFixed(2)}
                statusLine={statusLine}
                footLine={`${time} · ${sender} 的红包`}
                onDetail={() => setPhase("detail")}
              />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 26,
              padding: "10px 34px",
              borderRadius: 999,
              background: "rgba(255,255,255,.18)",
              border: "1px solid rgba(255,255,255,.24)",
              color: "#FFF",
              fontSize: 13.5,
              letterSpacing: ".1em",
              fontFamily: SANS,
              cursor: "pointer",
            }}
          >
            {phase === "revealed" || !canOpen ? "收好" : "下次再开"}
          </button>
        </div>
      </div>
    </>
  );
}

/** 红包详情页（1.4.93）：恩熙要「开了之后有一个详情页」，照微信那张「领取详情」
 *  的次序摆——整页浅底（跟聊天一个底色，不是盖在聊天上的弹层），最上面是这块
 *  红包的封面（自定义图原样铺；预设就在封面上压一枚圆底礼盒和一句「谁发出的
 *  红包」），封面下来一行头像＋「{sender} 发出的红包」和祝福语，再一条
 *  「1 个红包共 ¥xx」＋发出来的时间，然后一列领取记录（谁、领没领、多少钱），
 *  底沿一枚小字。左上角一枚返回，退回揭晓那一屏。
 *  只读：钱在点「開」那一下就已经动过了（claimMoney），这一页不碰任何数据。
 *  记录里那行小字写的是状态而不是「领取时间」——消息上压根没存领取时间
 *  （钱一动只落一个 moneyClaimed），不编一个时间出来。 */
function RedPacketDetailPage({
  m,
  sender,
  senderAvatar,
  recipient,
  recipientAvatar,
  note,
  coverBg,
  customSrc,
  time,
  statusLine,
  onBack,
}: {
  m: ChatMessage;
  sender: string;
  senderAvatar: string;
  recipient: string;
  recipientAvatar: string;
  note: string;
  coverBg: string;
  customSrc?: string;
  time: string;
  statusLine: string;
  onBack: () => void;
}) {
  const claimed = m.moneyClaimed === true;
  const refunded = m.moneyRefunded === true;
  /* 过期／旧退款都照「已过期」说（跟红包卡同一套口径，见 RedPacketCard）。 */
  const expired = m.moneyExpired === true || (m.role === "user" && refunded);
  const amount = (m.amount ?? 0).toFixed(2);
  const rowState = claimed
    ? "已领取"
    : m.role === "user"
      ? expired
        ? "已过期"
        : "等他领取"
      : "待领取";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 65,
        background: T.bg,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* 封面这一块：自定义图原样铺（不压字，免得盖住人家的画）；预设就在封面上
          压一枚圆底礼盒＋谁发出的红包——跟聊天里那张卡、开红包那页同一枚。
          ⚠️ 高度必须带上「安全区 ＋ 模拟状态栏」那一段（同 MomentsPage 的封面）：
          否则封面顶到 0，左上角那枚返回会落进真机状态栏／刘海，点击被系统吃掉。 */}
      <div
        style={{
          position: "relative",
          flex: "none",
          width: "100%",
          height: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 280px)",
          background: coverBg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 12px 28px -20px rgba(20,19,24,.34)",
        }}
      >
        {!customSrc ? (
          <>
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: RED_COVER_TONE.chipBg,
                border: `2px solid ${RED_COVER_TONE.chipBorder}`,
                color: RED_COVER_TONE.chipInk,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <RedPacketGlyph size={26} strokeWidth={1.5} />
            </span>
            <div
              style={{
                marginTop: 12,
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: 13,
                fontWeight: 500,
                color: RED_COVER_TONE.inkSoft,
                letterSpacing: ".14em",
              }}
            >
              {sender} 发出的红包
            </div>
          </>
        ) : null}
        {/* 底影：自定义封面深浅不一，左上角那枚返回在任何图上都得看得清 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, rgba(0,0,0,.16) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 72%, rgba(0,0,0,.11) 100%)",
          }}
        />
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          style={{
            position: "absolute",
            left: 14,
            top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 14px)",
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "rgba(20,19,24,.26)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronLeft size={19} strokeWidth={2} color="#FFFFFF" />
        </button>
      </div>

      {/* 封面以下：谁发的＋祝福语 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "18px 22px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {senderAvatar ? (
            <span
              style={{
                flex: "none",
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: `url(${senderAvatar}) center/cover`,
              }}
            />
          ) : null}
          <span
            style={{
              fontFamily: KAI,
              fontSize: 15,
              fontWeight: 500,
              color: T.ink,
              letterSpacing: ".02em",
            }}
          >
            {sender} 发出的红包
          </span>
        </div>
        <div
          style={{
            marginTop: 9,
            textAlign: "center",
            fontFamily: KAI,
            fontSize: 14.5,
            lineHeight: 1.6,
            color: T.ink2,
            letterSpacing: ".04em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {note}
        </div>
      </div>

      {/* 汇总一条：一个红包共多少钱，右边是发出来的时间 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginTop: 22,
          padding: "0 18px 12px",
          borderBottom: `1px solid ${T.line}`,
        }}
      >
        <span style={{ fontFamily: KAI, fontSize: 13, color: T.ink2 }}>
          1 个红包共
          {/* 金额走主粉（红包这一族就是粉的），跟满页的黑字分开，一眼先看见钱 */}
          <span
            style={{
              marginLeft: 6,
              fontFamily: WALLET_MONO,
              fontSize: 15,
              fontWeight: 600,
              color: T.pink,
            }}
          >
            ¥{amount}
          </span>
        </span>
        <span style={{ fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>{time}</span>
      </div>

      {/* 领取记录：就两个人，一条足够 */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "14px 18px" }}>
        <span
          style={{
            flex: "none",
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: recipientAvatar ? `url(${recipientAvatar}) center/cover` : T.pinkSoft,
            border: `1px solid ${T.line}`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: KAI,
              fontSize: 15,
              color: T.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {recipient}
          </div>
          <div
            style={{ marginTop: 3, fontFamily: KAI, fontSize: 12, color: T.ink3, letterSpacing: ".03em" }}
          >
            {rowState}
          </div>
        </div>
        <span
          style={{
            flex: "none",
            fontFamily: WALLET_MONO,
            fontSize: 15,
            fontWeight: 600,
            /* 领到了才是粉的（跟上面那条汇总一个色）；没领到留灰的，别把「没进钱」也画成喜色 */
            color: claimed ? T.pink : T.ink3,
          }}
        >
          ¥{amount}
        </span>
      </div>
      <div
        style={{
          flex: "none",
          padding: "0 18px",
          fontFamily: KAI,
          fontSize: 12,
          lineHeight: 1.6,
          color: T.ink3,
          letterSpacing: ".03em",
        }}
      >
        {statusLine}
      </div>

      <div style={{ flex: 1 }} />
      <div
        style={{
          flex: "none",
          textAlign: "center",
          padding: "26px 0 30px",
          fontFamily: KAI,
          fontSize: 10,
          color: T.ink3,
          letterSpacing: ".3em",
        }}
      >
        星绥红包
      </div>
    </div>
  );
}

/** 图片查看器里的海景占位插画（跟随旧档案）。 */
function SeaIllustration() {
  return (
    <svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: 300, display: "block" }}>
      {/* 不要用旧板的暖沙色（#E9DFC9 那一族），摊在粉白底上会透出一股旧纸味。
          跟着黑粉蓝板走：海面走粉、太阳用那一点黄，鸟用次级灰。 */}
      <rect width="240" height="150" fill="#FFF0F5" />
      <circle cx="172" cy="60" r="17" fill="#FFD84D" opacity=".9" />
      <path d="M0 82Q30 74 60 82T120 82T180 82T240 82" stroke="#F7C4D9" strokeWidth="2.4" fill="none" />
      <path d="M0 92Q30 85 60 92T120 92T180 92T240 92" stroke="#F49BBE" strokeWidth="2.4" fill="none" />
      <path d="M0 150Q50 100 100 104T200 102T240 106V150Z" fill="#EFA9C6" opacity=".75" />
      <path d="M64 36q9-9 18 0M108 30q8-8 16 0" stroke="#7A7178" strokeWidth="1.7" fill="none" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
