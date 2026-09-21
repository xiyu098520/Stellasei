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
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  File,
  FileText,
  Gift,
  Heart,
  Image as ImageIcon,
  Languages,
  MapPin,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Quote,
  RotateCcw,
  Send,
  SquareStop,
  Star,
  Stethoscope,
  Trash2,
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
  getOrCreateConversation,
  healStalePendingMedia,
  markConversationRead,
  updateConversation,
  updateMessage,
  type ConversationPatch,
} from "@/lib/settings/chat";
import { getWorldBooks } from "@/lib/settings/worldbook";
import type { Mask } from "@/lib/settings/mask";
import { buildImageSubject, buildPrompt } from "@/lib/chat/promptBuilder";
import {
  buildStylePrompt,
  extractMetaMarkers,
  fetchAIReply,
  fetchAIStreamReply,
  generateImage,
  guessUseCharRef,
  outgoingContents,
  splitReply,
  splitReplyStream,
  stripMetaMarkersForPreview,
  synthesizeSpeech,
} from "@/lib/chat/chatApi";
import { getApiBundle } from "@/lib/settings/chat";
import { generateMomentImage } from "@/lib/chat/moment-image";
import {
  BLOCKED_PROMPT,
  blockFriend,
  blockedMemoryPrompt,
  hardDeleteFriend,
  removeFriend,
  unblockFriend,
} from "@/lib/chat/social";
import {
  bumpMemoryCount,
  buildMemoryBlock,
  deleteMemory,
  getMemory,
  maybeRunMemoryPipeline,
  trimHistory,
} from "@/lib/chat/memory";
import { uuid } from "@/lib/uuid";
import {
  getCachedMediaBlob,
  mediaRefToDataUrl,
  persistImageAsset,
  releaseImageAsset,
  saveImageToDevice,
  useMediaSrc,
} from "@/lib/chat/media-asset";
import {
  AVATAR_GRADIENT,
  CHAT_BG_DEFAULT,
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
 * 顶栏／气泡／长按菜单／引用／加号面板／红包转账弹窗／每聊天设定
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

/* 加号面板里那九项——
   本来就分两等：八项是「发什么内容」，剩下一项「重新回复」是「让对面做一件事」。
   九项塞同一个 4 列格子会余出孤零零的第九格，所以拆开：八项走格子（走纸），
   「重新回复」单独落一条通栏（走糖），排布和主次一起理顺。 */
const PLUS_ITEMS = [
  { name: "发送图片", icon: ImageIcon },
  { name: "拍照", icon: Camera },
  { name: "语音消息", icon: Mic },
  { name: "视频", icon: Video },
  { name: "红包", icon: Gift },
  { name: "转账", icon: CircleDollarSign },
  { name: "文件", icon: File },
  { name: "位置", icon: MapPin },
] as const;

/* 「重新回复」不是发内容，是让对面重答一遍——单独一条通栏动作，走糖。 */
const PLUS_ACTION = { name: "重新回复", icon: RotateCcw } as const;

/* 「重新回复」不填提示词时的兜底（放开空输入）：空着点确认
   就是「让它自己重新生成」。原样重跑结果往往和上一条几乎一样，所以补一句换说法的
   要求——不填是重生成，填了才是按提示词改语气。 */
const RETELL_FALLBACK_HINT = "换个说法，把这一句重新回一遍，别和上次一个样。";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* 每条气泡的出场间隔（流式预览的节拍，与非流式逐条落库共用同一档）。 */
const STREAM_REVEAL_INTERVAL_MS = 700;

/* 流式预览的合批间隔（性能优化）。
   收流回调若「来一个 SSE 分片就 setStreamPreview 一次」，而 ChatWindow 里一次
   setState 就是整棵组件重渲染（含整段消息列表重建）。分片密集时每秒几十次，
   会话越长每次越贵，主线程一直被占满——「聊得比较久就发烫、迟钝」就是这个原因。
   攒起来每 80ms 放一帧：观感上还是「字在往外长」，重渲染频率从「分片数／秒」
   压到约 12 次／秒。 */
const STREAM_PREVIEW_FLUSH_MS = 80;

/** 已等待时长的人话（秒 → 「12 秒」／「1 分 12 秒」）。 */
function formatWait(secs: number): string {
  if (secs < 60) return `${secs} 秒`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
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
  /* 输入框是否聚焦：键盘跟随的 rAF 只在这期间跑（性能优化，见下方键盘效应）。 */
  const [inputFocused, setInputFocused] = useState(false);
  const [showPlus, setShowPlus] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  /* 长按菜单 */
  const [curMsg, setCurMsg] = useState<ChatMessage | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [showSheet, setShowSheet] = useState(false);
  /* 语音／转文字 */
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [showTrans, setShowTrans] = useState<string | null>(null);
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
  const [showRpModal, setShowRpModal] = useState(false);
  const [showTrModal, setShowTrModal] = useState(false);
  const [showReModal, setShowReModal] = useState(false);
  const [reInput, setReInput] = useState("");
  const [showChatSettings, setShowChatSettings] = useState(false);
  /* 收藏（会话内状态，跟随旧档案） */
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  /* 图文／语音 API（TA 发图发语音用；加载后按启用状态决定是否告知能力）。 */
  const [imageApi, setImageApi] = useState<ChatApiSettings | null>(null);
  const [imageExtras, setImageExtras] = useState<ImageApiExtras | null>(null);
  const [voiceApi, setVoiceApi] = useState<ChatApiSettings | null>(null);
  const [voiceExtras, setVoiceExtras] = useState<VoiceApiExtras | null>(null);
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

  /* ---------- 【临时诊断·缓存】把每轮真正发出去的请求留一份（用完删） ---------- */
  /* 查「每笔都重建 13000、读回几乎为 0」。请求只在发送那一刻存在，
     发完就没了，所以把它整条留一份，并算出「与上一轮第一个不一样的字」在哪儿。
     定位完：这段 state、requestReply 里那段 dump、以及界面上右下角那个「请求」
     小按钮，一起整块删除。 */
  const [debugReq, setDebugReq] = useState<{
    full: string;
    flags: string;
    around: string;
  } | null>(null);
  const [showDebugReq, setShowDebugReq] = useState(false);
  const debugPrevRef = useRef<string>("");

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

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  /* visible 的镜像：requestReply 是个长跑的闭包，开跑那一刻就把 visible 的值抄住了——
     中途退回列表，闭包里那个 true 还是 true，判断不出「人已经不在这一间」。
     落库要不要记未读，得读「此刻」的值，所以用 ref 跟着走。 */
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
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
  const signature = conv?.signature?.trim() || defaultSignature(character.data);
  const fontSize = conv?.fontSize ?? 13;
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
      setMemory(mem);
      setImageApi(bundle.image);
      setImageExtras(bundle.imageExtras);
      setVoiceApi(bundle.voice);
      setVoiceExtras(bundle.voiceExtras);
      setLoaded(true);
      await markConversationRead(character.id, maskId);
      onDataChange();
      /* 贴底已挪到下面的 useLayoutEffect（在消息铺出来那一帧、上屏之前定住位置），
         这里不再延后 60ms 补跳一次——那一下正是要消掉的「跳转」。 */
    })().catch(() => {
      setLoaded(true);
      showToast("读取消息失败");
    });
    return () => {
      cancelled = true;
    };
  }, [character.id, maskId, onDataChange, showToast]);

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
    stopVoiceCtx();
  }, []);

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
          const useCharRef = m.useCharRef ?? guessUseCharRef(m.content);
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
                ? "这条消息的标记写的是「不使用参考图」"
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
          const res = await synthesizeSpeech(effVoiceApi, m.content, effVoiceExtras);
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
    [character.id, maskId, effImageApi, imageExtras, effVoiceApi, effVoiceExtras, effTextApi, imageSubject, conv, showToast],
  );

  /* ---------- 请求一轮回复（未配置 API 时系统提示，不造假回复） ---------- */
  const requestReply = useCallback(
    async (userText: string, opts?: { extraHint?: string; quote?: string; historyBase?: ChatMessage[] }) => {
      const history = opts?.historyBase ?? messages;
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
      setIsTyping(true);
      /* 提示出现即滚到底：别让「正在输入」藏在屏幕外，等回复时像没反应。 */
      scrollBottom();
      /* 停止按钮的中断源与全文缓冲：从「正在输入」出现那一刻起就能中断。 */
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamTextRef.current = "";
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
        const [books, prefs] = await Promise.all([getWorldBooks(), getChatPrefs()]);
        /* 气泡条数上限：**每聊天设定**（这个角色归这个角色，别的角色不受影响），
           没设过＝默认开、5 条。关了就是 0＝不限，提示词那句也不加，与从前逐字一致；
           流式预览与落库两趟都拿它收口，传的必须是同一个值。 */
        const bubbleCap = bubbleCapOf(conv);
        const built = buildPrompt({
          characterId: character.id,
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
          memoryBlock: memory ? await buildMemoryBlock(memory, charName, myName) : "",
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
        /* 拉黑状态注入：TA 以为自己被拉黑发不出消息；解除后记得被拉黑的经历。 */
        const socialPrompt = conv?.blocked
          ? BLOCKED_PROMPT
          : conv && (conv.blockCount ?? 0) > 0
            ? blockedMemoryPrompt(conv.blockCount ?? 1)
            : "";
        /* AI 助手模式的联系人：走「服从指令」的助手提示词（不扮演角色、要求发图就发）。 */
        const stylePrompt = buildStylePrompt(
          charName,
          myName,
          opts?.extraHint,
          canImage,
          canVoice,
          character.data.isAssistant === true,
          /* 气泡条数：**每聊天设定**（见 bubbleCapOf）。0＝不限，连提示词那句都不加，
             保持逐字不变；开了才告诉 TA 这一轮最多几条。 */
          bubbleCap > 0 ? bubbleCap : null,
        );
        /* system 只放稳定段（风格指令＋人设／规则／常驻世界书／记忆碎片／签名说明／
           拉黑状态）——全部跨轮逐字不变，站子的前缀缓存才能连读。
           会变的一律排在断点之后：易变尾巴挂在**本轮 user 消息末尾**（见下面的 input），
           不进 system。前缀缓存是整条链的哈希——会变的东西留在断点之前，整块缓存每轮作废。
           记忆碎片从 user 尾部挪进稳定段：挂在尾部时，那条 user 下一轮
           回喂历史只剩光原话、字面对不上，站子从那条起整段作废（记忆块每轮白写两遍）。 */
        const systemStable =
          stylePrompt + "\n\n" + built.stable + (socialPrompt ? `\n\n${socialPrompt}` : "");
        /* 易变尾巴（签名取值／关键词世界书／对话后世界书）挂在本轮 user 消息末尾，
           不进 system——它每轮都会变，一进 system 就把断点之后的整段作废。
           「当前状态」（分钟级时间）不再注入：它每轮必变、永远读不到
           缓存，只会把整条链的最末尾钉成「每轮都不一样」（buildStatusBlock 保留备用）。 */
        const input =
          (opts?.quote ? `【引用】${opts.quote}\n${userText}` : userText) +
          (built.volatile ? `\n\n${built.volatile}` : "");
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
        /* 【临时诊断·缓存】判案用：拿「本轮真发出去的正文」与上一轮逐字比前缀（用完删）。
           健康的样子＝上一轮那条请求原样接在本轮前面（本轮＝上一轮＋新的一来一回），
           此时前缀缓存该连读、账单见大额「读取」；若在更早处就断了，断点处即元凶。
           必须走 outgoingContents（真发出去的那份）：回喂历史用的是 m.apiText，
           用 m.content 拼出来的「历史」是假的，判不了案。 */
        {
          const memorySection = built.stableSections.find((s) => s.label === "记忆碎片");
          const dump = outgoingContents({ stable: systemStable, tail: "" }, apiHistory, input);
          const prev = debugPrevRef.current;
          let at = 0;
          if (prev) {
            const n = Math.min(prev.length, dump.length);
            while (at < n && prev[at] === dump[at]) at += 1;
          }
          debugPrevRef.current = dump;
          const around = !prev
            ? "（这是你在本窗口发的第一笔，没有上一轮可比）"
            : at >= prev.length
              ? `✅ 上一轮那条请求（${prev.length} 字）原样接在本轮前面，\n` +
                `   本轮只多出尾部 ${dump.length - prev.length} 字（新的一来一回）。\n` +
                `   → 前缀缓存该连读，账单应见大额「读取」。`
              : `❌ 上一轮在第 ${at} 个字处就断了（共 ${prev.length} 字）——\n` +
                `   从这往后每轮都要重写缓存，就是「读取几乎为 0、创建一直涨」的元凶。\n\n` +
                `上一轮：\n…${prev.slice(Math.max(0, at - 60), at + 60)}…\n\n` +
                `本轮：\n…${dump.slice(Math.max(0, at - 60), at + 60)}…`;
          setDebugReq({
            full: dump,
            around,
            flags:
              `角色名「${charName}」｜我「${myName}」\n` +
              `能不能发图:${canImage ? "能" : "不能"}｜能不能发语音:${canVoice ? "能" : "不能"}｜AI助手:${character.data.isAssistant === true ? "是" : "否"}\n` +
              `重发提示:${opts?.extraHint ? opts.extraHint : "无"}｜引用:${opts?.quote ? "有" : "无"}｜拉黑:${conv?.blocked ? "是" : (conv?.blockCount ?? 0) > 0 ? `曾拉黑${conv?.blockCount}次` : "否"}\n` +
              `system 全长:${systemStable.length} 字｜稳定段:${built.stable.length} 字｜易变尾巴:${built.volatile.length} 字｜面具块:${mask ? "有" : "无"}｜记忆块:${memorySection ? `${memorySection.content.length} 字` : "无"}`,
          });
        }
        /* 流式开关在「文本 API」里配置：关掉就直接走非流式，
           省掉一次注定白跑的流式请求（中转站按次计费时尤其值得）。 */
        const useStream = effTextApi.stream !== false;
        let reply = "";
        let stopped = false;
        let streamed = false;
        try {
          if (useStream) {
            reply = await fetchAIStreamReply(
              effTextApi,
              { stable: systemStable, tail: "" },
              apiHistory,
              input,
              (full) => {
                /* 边收边把「到目前为止的全文」拆成已定型气泡＋尾巴，直接贴着输入区显示。 */
                streamTextRef.current = full;
                if (full) streamed = true;
                const prevSettled = streamSettledRef.current;
                /* 先把〔图片〕〔语音〕这类标记剥掉再拆条：不然它们会以纯文本先长在
                   屏幕上，等落库时整段消失换成真图片，看着像「先发一堆文字再重整」。 */
                const next = splitReplyStream(stripMetaMarkersForPreview(full), bubbleCap);
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
              },
              { signal: controller.signal },
            );
          } else {
            /* 中间三个 undefined 走默认值（历史不限条数／maxTokens／temperature），
               只为把 signal 递进去。 */
            reply = await fetchAIReply(
              effTextApi,
              { stable: systemStable, tail: "" },
              apiHistory,
              input,
              undefined,
              undefined,
              undefined,
              controller.signal,
            );
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
        // 先剥掉末尾的〔签名〕／〔动态〕／〔图片〕／〔语音〕标记（气泡里永远看不到），再拆条连发。
        const extracted = extractMetaMarkers(reply);
        /* 与上面的流式预览传同一个上限：预览转正时条数一致，不会突然合并或裂开。 */
        const parts = splitReply(extracted.clean, bubbleCap);
        /* 半途停止只留正文；标记类内容（签名／动态／配图／语音）不处理。 */
        const signature = stopped ? undefined : extracted.signature;
        const moments = stopped ? [] : extracted.moments;
        const images = stopped ? [] : extracted.images;
        const imageRefs = stopped ? [] : extracted.imageRefs;
        const voices = stopped ? [] : extracted.voices;
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
          }));
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
            };
            await persistFromChar(msg);
            pushLocal(msg);
          }
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
           **每轮至多一张**——提示词侧（chatApi 的 buildStylePrompt）写的就是
           「每轮至多一图」，这里只取第一条标记，闸门跟着提示词走。不能写成
           `Math.min(images.length, 2)`：模型偶尔一轮吐两个〔图片〕标记，就会连买两张，
           账单上看着就像同一张图被生成两遍/重复扣费。 */
        const imagePlaceholders: ChatMessage[] = [];
        if (images.length > 0 && effImageApi && imageExtras && canImage) {
          const desc = images[0];
          /* 「自动生成」关着（设置 → API 设定 → 图文）：这一轮不碰生图接口、不花钱，
             占位框只留一颗「生成」等你点（见 renderBody）。开着就照常自动生成。 */
          const waitForMe = !prefs.autoGenerateImage;
          const placeholder: ChatMessage = {
            id: uuid(),
            role: "assistant",
            type: "image",
            content: desc,
            /* 记下 TA 声明的锁脸开关：生成与重试都按它决定带不带参考图。 */
            useCharRef: imageRefs[0] ?? guessUseCharRef(desc),
            pending: true,
            awaitGen: waitForMe || undefined,
            createdAt: new Date().toISOString(),
            isRead: true,
          };
          await persistFromChar(placeholder);
          pushLocal(placeholder);
          imagePlaceholders.push(placeholder);
        }
        /* TA 要发的语音：先弹占位气泡，合成完成后填充（失败可点击重试）。 */
        const voicePlaceholders: ChatMessage[] = [];
        if (voices.length > 0 && effVoiceApi && effVoiceExtras && canVoice) {
          for (const text of voices.slice(0, 2)) {
            const placeholder: ChatMessage = {
              id: uuid(),
              role: "assistant",
              type: "voice",
              content: text,
              pending: true,
              duration: Math.max(1, Math.round(text.length / 3.5)),
              createdAt: new Date().toISOString(),
              isRead: true,
            };
            await persistFromChar(placeholder);
            pushLocal(placeholder);
            voicePlaceholders.push(placeholder);
          }
        }
        /* 整轮什么都没产出（模型只发了标记／空回复）：兜底一条省略号，别让画面干等。 */
        if (parts.length === 0 && images.length === 0 && voices.length === 0 && !stopped) {
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
           达标后台总结（不挡聊天）。 */
        let sentByMe = 0;
        for (let i = history.length - 1; i >= 0 && history[i].role === "user"; i--) sentByMe++;
        const addedMsgs = Math.max(1, sentByMe) + parts.length;
        void (async () => {
          try {
            await bumpMemoryCount(character.id, maskId, addedMsgs);
            const latest = await getOrCreateConversation(character.id, maskId);
            const result = await maybeRunMemoryPipeline(
              { characterId: character.id, maskId, messages: latest.messages },
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
          content: localDbFailed
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
    [messages, effTextApi, character, myName, charName, mask, maskId, conv, pushLocal, scrollBottom, regenerateMedia, onDataChange, effImageApi, imageExtras, effVoiceApi, effVoiceExtras, memory, stampBubble, userSignature, queueStreamPreview, clearStreamPreview],
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
    const msg: ChatMessage = {
      id: uuid(),
      role: "user",
      type: "text",
      content: text,
      createdAt: new Date().toISOString(),
      isRead: true,
      ...(quoteText ? { quote: quoteText } : {}),
    };
    /* 连续发送：只把消息挂上去，攒够了再按爱心让 TA 一次回完。 */
    const holdReply = conv?.manualReply === true;
    void appendMessage(character.id, maskId, msg)
      .then(() => {
        pushLocal(msg);
        if (el) {
          el.value = "";
          el.style.height = "auto";
        }
        const q = quoteText;
        setQuoteText("");
        setShowPlus(false);
        if (holdReply) return;
        return requestReply(text, { quote: q || undefined, historyBase: [...messages, msg] });
      })
      .catch(() => showToast("发送失败，请重试"));
  }, [isTyping, loaded, quoteText, character.id, maskId, pushLocal, requestReply, messages, showToast, conv]);

  /* ---------- 待回复队列：末尾连着的一串用户消息（连续发送攒下的） ---------- */
  const pendingMsgs = useMemo(() => {
    let i = messages.length - 1;
    while (i >= 0 && messages[i].role === "user") i--;
    return messages.slice(i + 1);
  }, [messages]);
  /* 可以让他回：连续发送模式 + 有攒着没回的话 + TA 没在回。 */
  const canForceReply = conv?.manualReply === true && pendingMsgs.length > 0 && !isTyping;

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
      if (name === "发送图片") {
        send({ type: "image", content: "照片" });
        return;
      }
      if (name === "语音消息") {
        send({ type: "voice", content: "语音消息", duration: 8 });
        return;
      }
      if (name === "红包") {
        send({ type: "redpacket", content: "收下我的心意", amount: 66 });
        return;
      }
      if (name === "转账") {
        send({ type: "transfer", content: "请查收", amount: 520 });
        return;
      }
      if (name === "位置") {
        send({ type: "location", content: "约定好的地方 · 老码头" });
        return;
      }
      showToast(`${name} · 预览`);
    },
    [character.id, maskId, pushLocal, onDataChange, showToast],
  );

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

  /* ---------- 每聊天设定 ---------- */
  const applyPatch = useCallback(
    async (patch: ConversationPatch) => {
      const next = await updateConversation(character.id, maskId, patch);
      setConv(next);
      onDataChange();
    },
    [character.id, maskId, onDataChange],
  );

  const clearMessages = useCallback(async () => {
    await clearConversation(character.id, maskId);
    /* 聊天记录清空＝这些图再没人引用，仓库里的一并收回（否则仓库只进不出）。 */
    for (const m of messages) releaseImageAsset(m.imageUrl);
    /* 清空聊天＝从头来过：记忆（长期＋核心＋计数）一并清掉。 */
    await deleteMemory(character.id, maskId);
    setMemory(null);
    setMessages([]);
    onDataChange();
    showToast("已清空聊天记录");
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

  const toggleBlocked = useCallback(
    async (next: boolean) => {
      if (next) {
        await blockFriend(character.id, maskId, charName);
        showToast("已加入黑名单");
      } else {
        if (!conv) return;
        showToast("解除中，TA 正在说话……");
        await unblockFriend(character, conv, myName);
      }
      await refreshConv();
    },
    [character, conv, maskId, charName, myName, refreshConv, showToast],
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
  /* 只量高度，不写 state（草稿非受控，见 sendMsg）——打字不再引起重渲染。 */
  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const t = e.target;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 106)}px`;
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
              onRegen={() => void regenerateMedia(m)}
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
              生图一张算一次钱。等太久了可以点「不等了」；再发一次＝新的一单。
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
          if (playingVoice === m.id && (isVoiceElPlaying() || isVoiceCtxPlaying())) {
            stopVoiceEl();
            stopVoiceCtx();
            setPlayingVoice(null);
            return;
          }
          setPlayingVoice(m.id);
          const end = () => setPlayingVoice(null);
          /* 主路：媒体元素（参考项目验证过的做法）。走不通再退到 Web Audio。 */
          void playVoiceViaElement(audioUrl, end)
            .then((res) => {
              if (res.ok) return;
              return playVoiceViaWebAudio(m.id, audioUrl, end).then((res2) => {
                if (res2.ok) {
                  /* 上面 play() 失败时可能已经把「在播」标记清了，这里补回来。 */
                  setPlayingVoice(m.id);
                  return;
                }
                setPlayingVoice(null);
              });
            })
            .catch(() => setPlayingVoice(null));
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
                {m.audioUrl ? m.content : "转文字内容将在生成后显示。"}
              </div>
            ) : null}
          </div>
        );
      }
      case "redpacket": {
        return (
          <div
            onClick={() => setShowRpModal(true)}
            style={{
              position: "relative",
              width: 172,
              textAlign: "center",
              background: T.card,
              border: "1px solid rgba(232,106,155,.42)",
              borderRadius: 12,
              padding: "16px 12px 12px",
              cursor: "pointer",
              transition: "all .15s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: -1,
                left: "50%",
                transform: "translate(-50%,-50%)",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: T.card,
                border: "1px solid rgba(232,106,155,.42)",
                color: T.pink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 3px rgba(232,106,155,.18)",
              }}
            >
              <Heart size={11} strokeWidth={1.4} />
            </span>
            <div style={{ fontSize: 9.5, color: T.pink, letterSpacing: ".3em" }}>{m.content}</div>
            <div
              style={{
                marginTop: 12,
                marginBottom: 8,
                color: T.pink,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Heart size={26} strokeWidth={1.5} fill="currentColor" />
            </div>
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid rgba(232,106,155,.22)",
                fontSize: 8.5,
                color: T.ink3,
                fontStyle: "italic",
                fontFamily: SANS,
                letterSpacing: ".16em",
              }}
            >
              点击领取 · open
            </div>
          </div>
        );
      }
      case "transfer": {
        const isFromMe = m.role === "user";
        const tagCn = isFromMe ? "转账给对方" : "转账给你";
        const footTxt = isFromMe ? "等待收取" : "点击收取";
        return (
          <div
            onClick={() => setShowTrModal(true)}
            style={{
              position: "relative",
              width: 188,
              background: T.card,
              border: "1px solid rgba(232,106,155,.42)",
              borderRadius: 11,
              padding: "9px 12px 8px",
              cursor: "pointer",
              transition: "all .15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span
                style={{
                  fontFamily: SANS,
                  fontStyle: "italic",
                  fontSize: 7.5,
                  letterSpacing: ".28em",
                  color: T.pink,
                  textTransform: "uppercase",
                }}
              >
                TRANSFER
              </span>
              <span style={{ fontSize: 10, color: T.pink, letterSpacing: ".14em" }}>{tagCn}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 7,
              }}
            >
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 19,
                  fontWeight: 500,
                  color: T.pink,
                  letterSpacing: ".01em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                <i style={{ fontStyle: "normal", fontSize: 10.5, marginRight: 1 }}>¥</i>
                {m.amount?.toFixed(2) || "0.00"}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: T.ink3,
                  letterSpacing: ".05em",
                  maxWidth: 80,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingBottom: 1,
                }}
              >
                {m.content}
              </span>
            </div>
            <div
              style={{
                marginTop: 7,
                paddingTop: 6,
                borderTop: "1px solid rgba(232,106,155,.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 7.5,
                  color: T.ink3,
                  letterSpacing: ".12em",
                  fontStyle: "italic",
                  fontFamily: SANS,
                }}
              >
                {footTxt}
              </span>
              <ChevronLeft
                size={11}
                strokeWidth={1.7}
                style={{ transform: "rotate(180deg)", color: "rgba(232,106,155,.75)" }}
              />
            </div>
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
        return <span>{m.content}</span>;
    }
  };

  /* TA 气泡样式：真消息与流式预览共用同一份，保证「预览转正」零跳变。
     pre-wrap 只为清单消息（splitReply 保留了换行的「一、二、三」那种条目）
     服务——普通消息在拆条时换行就被当条边界切掉了，身上不带 \n，
     所以这条对它没有任何影响。
     边与影两处：
     ①边用粉调的 .13，不用 T.line（中性灰）——灰边压在白里发脏，跟整页的粉对不上；
     ②影用两层粉——贴身的 1px 定边界，
       底下 14px 的晕往后收（-8px 让它只落在气泡下缘外），气泡才像搁在纸上，
       而不是用笔在白底上画了个框。 */
  const assistantBubbleStyle: CSSProperties = {
    position: "relative",
    background: "linear-gradient(180deg, #FFFFFF 0%, #FFFCFD 100%)",
    border: "1px solid rgba(232,106,155,.13)",
    borderRadius: "18px 18px 18px 6px",
    padding: "6px 12px",
    fontSize,
    lineHeight: 1.55,
    letterSpacing: ".02em",
    color: T.ink,
    boxShadow: "0 1px 2px rgba(232,106,155,.07), 0 5px 14px -8px rgba(232,106,155,.30)",
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

  /* ---------- 单条消息渲染 ---------- */
  const renderMsg = (m: ChatMessage, i?: number) => {
    const groupedWithPrev = i !== undefined && i > 0 && sameGroup(messages[i - 1], m);
    const lastOfGroup = !(i !== undefined && sameGroup(m, messages[i + 1]));
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
    /* 引用块两套样式：TA 侧是白卡面上的淡粉块；我这边气泡已经
       整块铺了主粉，同一套淡粉压上去就糊成一片，所以换成白半透底 + 白左边框 + 白字。 */
    const quoteBlockStyle: CSSProperties = isMe
      ? {
          marginBottom: 5,
          padding: "4px 8px",
          borderLeft: "2px solid rgba(255,255,255,.7)",
          background: "rgba(255,255,255,.22)",
          borderRadius: "0 8px 8px 0",
          fontSize: Math.max(10, fontSize - 3),
          color: "#FFFFFF",
          letterSpacing: ".02em",
          lineHeight: 1.5,
          maxHeight: 40,
          overflow: "hidden",
        }
      : {
          marginBottom: 5,
          padding: "4px 8px",
          borderLeft: `2px solid ${T.pink}`,
          background: T.pinkSoft,
          borderRadius: "0 8px 8px 0",
          fontSize: Math.max(10, fontSize - 3),
          color: T.ink2,
          letterSpacing: ".02em",
          lineHeight: 1.5,
          maxHeight: 40,
          overflow: "hidden",
        };
    const quoteBlock = m.quote ? <div style={quoteBlockStyle}>{m.quote}</div> : null;

    const noBubble = m.type === "image" || m.type === "redpacket" || m.type === "transfer";

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
            {noBubble ? (
              body
            ) : (
              /* 我这侧的气泡，跟 TA 那侧同批做的精致化：
                 粉底是自上而下一点点渐变，顶沿再压一道极淡的内高光，
                 整块就有了鼓起来的那点弧，不是一张粉纸；
                 影是两层（贴身 1px 定边界 + 下缘 16px 的晕），跟 TA 那侧对称着来。
                 底色整档降饱和、明度抬一格；
                 刻意不再往淡里走——白字坐在粉上本来就不宽裕，
                 再淡一档字就发花，到这儿是能保住可读性的最淡处。
                 主色 T.pink 没动，顶栏、按钮那些还用它。
                 粉底色不能再淡（上面那条线卡着），精致只能从光影里来：
                 ①渐变幅度拉到眼睛刚好看得出的程度（顶 #F09CBE → 底 #E06E90），块面才立得起来；
                   幅度太小看着就是一张平粉纸；
                 ②顶沿内高光 .45，再补一圈 1px 极淡内描边（白 .14）——像蒙了层薄糖壳，
                   正是 TA 那侧「1px 粉边定边界」在粉底上的对应物；
                 ③外影用深粉：亮粉影糊在粉底上分不出边，深粉才收得住边界，
                   一层 1px 贴边定形、一层 14px 收在下缘，跟 TA 那侧的两层影对称。 */
              <div
                style={{
                  position: "relative",
                  background: "linear-gradient(180deg, #F09CBE 0%, #E06E90 100%)",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "18px 18px 6px 18px",
                  padding: "6px 12px",
                  fontSize,
                  lineHeight: 1.55,
                  letterSpacing: ".02em",
                  boxShadow:
                    "0 1px 2px rgba(190,72,112,.22), 0 6px 14px -8px rgba(190,72,112,.36), inset 0 1px 0 rgba(255,255,255,.45), inset 0 0 0 1px rgba(255,255,255,.14)",
                  wordBreak: "break-word",
                }}
              >
                {quoteBlock}
                {body}
              </div>
            )}
            {meta}
          </div>
          {groupedWithPrev
            ? avatarSpacerEl
            : avatarSlotEl(
                avatarBox({
                  avatar: actualMyAvatar,
                  fallbackChar: myName.charAt(0),
                  gradient: "linear-gradient(135deg,#F49BBE,#E86A9B)",
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
              })
            )}
        <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {noBubble ? (
            body
          ) : (
            <div style={assistantBubbleStyle}>
              {quoteBlock}
              {body}
            </div>
          )}
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
           周期拉得慢——是「在看的人才会发现它在动」的那种分量。 */
        @keyframes heartBeat { 0%,100% { transform: scale(1); } 45% { transform: scale(1.14); } }
        .chat-heart { animation: heartBeat 1.9s ease-in-out infinite; }
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
        /* 输入框占位字：淡墨（粉白胶囊上压深色偏重）。 */
        .chat-input::placeholder { color: ${T.ink3}; }
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
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding:
            "calc(var(--safe-area-top, 0px) + max(var(--sim-status-h, 0px) - 10px, 6px)) 10px 8px",
          /* 均匀薄纱：照片整张都在，只在顶栏这一条上压淡一层。偏粉的白（跟 T.bg 同调），
             不要用纯白纱——纯白纱会把照片顶部洗成灰的。 */
          background: "rgba(255,247,249,.45)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          style={{
            ...headerBtnStyle,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(232,106,155,.35)",
            color: T.pink,
            background: "rgba(255,255,255,.78)",
            boxShadow: "0 2px 6px rgba(232,106,155,.10)",
          }}
        >
          <ChevronLeft size={19} strokeWidth={2.2} />
        </button>
        {/* 大气泡（顶栏容器）：顶栏不自己铺底、不画发丝线，正中浮起一颗白胶囊，皮的活儿全交给它。
            两枚头像退到最左最右、各坐一头；名字和签名朝里长、
            在气泡正中碰面，接缝那儿夹着会跳的粉心——头像在两头、名字在中线，
            像两个人各自从外头探身过来凑到一起。
            气泡要「浮」不要「贴」：白底 + .18 的粉发丝边 + 一层很淡的粉晕，
            没用实投影（实投影是卡片浮起那股廉价味）。
            层次加厚成三层：
            ①体积——从顶白 (#FFFFFF) 到底淡粉 (#FFF6FA) 的竖直渐变，不是一块平白；
            ②外阴影两层——贴身的 1px 定边界、8px 的扩散晕起浮，让人一眼看出它压在上头；
            ③底沿一道内阴影收边，下沿才有厚度、不像纸片。
            全是低透明度的粉调，不是那种灰黑色的卡片投影。
            左右两颗功能钮（返回／更多）留在气泡外头——气泡里只装我们俩，
            它是信物，不是工具条；这两颗也给一点白底和淡影，好跟气泡说同一种语言。 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 9px",
            borderRadius: 999,
            background: "linear-gradient(180deg, #FFFFFF 0%, #FFF6FA 100%)",
            border: "1px solid rgba(232,106,155,.18)",
            boxShadow:
              "0 1px 2px rgba(232,106,155,.10), 0 8px 22px rgba(232,106,155,.16), inset 0 -1px 0 rgba(232,106,155,.05)",
          }}
        >
          {/* TA 那枚：退到气泡最左。32px 正圆。不挂在线状态那粒右下角粉点——
              它压在白圈边上显脏，而这页本来就是只有我们俩的小天地，他当然在。 */}
          <span
            style={{
              position: "relative",
              flex: "none",
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: actualCharAvatar
                ? `url(${actualCharAvatar}) center/cover`
                : AVATAR_GRADIENT,
              color: "#FFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "0 0 0 2px #FFF, 0 3px 9px rgba(232,106,155,.22)",
            }}
          >
            {!actualCharAvatar ? charName.charAt(0) : null}
          </span>
          {/* 他的名字＋签名：紧挨着 TA 那枚、朝里长，文字右对齐、末端抵住正中的心 */}
          <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <span
            style={{
              display: "block",
              fontFamily: SERIF,
              fontSize: 17,
              lineHeight: 1.15,
              fontWeight: 600,
              color: T.ink,
              letterSpacing: ".06em",
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
              marginTop: 2,
              fontSize: 10.5,
              color: "rgba(232,106,155,.78)",
              letterSpacing: ".06em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {signature}
          </span>
        </div>
        {/* 正中的粉心：气泡里唯一会动的东西，也是「传信」那口气的落点。
            它只动 transform（心跳），身上没有任何定位 transform，所以不用套壳；
            它站在两个名字中间，不挡头像。
            外面垫一层柔粉圆晕，让它从气泡底上浮起来，
            不然一颗纯色小心直挺挺贴在白底上，是「印上去」不是「挂着」。 */}
          <span
            style={{
              flex: "none",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(232,106,155,.16) 0%, rgba(232,106,155,0) 72%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Heart
              className="chat-heart"
              size={15}
              strokeWidth={0}
              fill={T.pink}
              color={T.pink}
              style={{ display: "block" }}
            />
          </span>
        {/* 我的名字＋签名：跟 TA 那边镜像着来，也朝里长、也抵住正中的心；名字用粉。
            签名是「我」页面那句真签名（userSignature，ChatApp 传下来的），
            不是以前拿来顶替的面具 uid——那是对外短编号，挂在名字底下像工号。 */}
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span
            style={{
              display: "block",
              fontFamily: SERIF,
              fontSize: 17,
              lineHeight: 1.15,
              fontWeight: 600,
              color: T.pink,
              letterSpacing: ".06em",
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
                marginTop: 2,
                fontSize: 10.5,
                color: "rgba(232,106,155,.78)",
                letterSpacing: ".06em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {userSignature}
            </span>
          ) : (
            /* 没设签名时留一行等高占位：两侧才平、两个名字才在同一条水平线上 */
            <span aria-hidden style={{ display: "block", height: 12.5, marginTop: 2 }} />
          )}
        </div>
          {/* 我那枚：待在气泡最右，跟 TA 那枚头尾呼应（同 32px 正圆、同款白圈） */}
          <span
            style={{
              flex: "none",
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: actualMyAvatar
                ? `url(${actualMyAvatar}) center/cover`
                : "linear-gradient(135deg,#F49BBE,#E86A9B)",
              color: "#FFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "0 0 0 2px #FFF, 0 3px 9px rgba(232,106,155,.22)",
            }}
          >
            {!actualMyAvatar ? myName.charAt(0) : null}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowChatSettings(true)}
          aria-label="聊天设置"
          style={{
            ...headerBtnStyle,
            width: 34,
            height: 34,
            borderRadius: 999,
            background: "rgba(255,255,255,.78)",
            boxShadow: "0 2px 6px rgba(232,106,155,.10)",
          }}
        >
          <MoreHorizontal size={20} strokeWidth={1.8} />
        </button>
        {/* 纱的底沿不能是一条硬边：上一层均匀的薄纱，到底下「啪」一下就交还给完整的照片，
            眼睛能看见那道台阶——同一片照片、上面淡下面实，中间却是切开的，看着就不自然。
            跟输入框没关系（见下面那条注）：底下那条实心白是「一条横杆」，挂壁纸之前
            它跟背景同色所以看不见，挂上以后它变成一个白条——那是常规做法，
            不是「过渡没做」。不自然的只有顶栏这一道。
            所以这里把硬边化开：从 header 底沿的 .45 接着往下退，22px 内退到全透明
            （0 段留 .45，35% 退到 .30、68% 退到 .12、100% 归零——一条先快后慢的曲线，
            匀速退会看着像一截发灰的带子）。
            浓度起点必须低：顶栏若近乎实白，底下再化开，看着就是「一条白杠拖着一团雾」；
            整条纱本来只有 .45，化开的时候只是在「把淡淡的纱收掉」，
            眼睛几乎捉不到那道渐变——这才叫过渡。
            挂 header 里是因为 header 的 z 序在消息区之上，能压住滚上来的内容。 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            height: 22,
            background:
              "linear-gradient(180deg, rgba(255,247,249,.45) 0%, rgba(255,247,249,.30) 35%, rgba(255,247,249,.12) 68%, rgba(255,247,249,0) 100%)",
            pointerEvents: "none",
          }}
        />
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
        {loaded
          ? messages.map((m, i) => (
              /* 按天分段：一天的开头插一枚居中日期胶囊（今天／昨天／X月X日）。
                 时间的去处只有一处：小字只在组尾，日期交给这枚胶囊。 */
              <Fragment key={m.id}>
                {i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt) ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 4px" }}>
                    <span
                      style={{
                        padding: "3px 11px",
                        borderRadius: 999,
                        background: "rgba(20,19,24,.05)",
                        color: T.ink3,
                        fontSize: 10.5,
                        letterSpacing: ".16em",
                        textIndent: ".16em",
                      }}
                    >
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                ) : null}
                {renderMsg(m, i)}
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
                    })
                  )
                : avatarSpacerEl}
              <div style={{ maxWidth: 300, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: actualCharAvatar
                  ? `url(${actualCharAvatar}) center/cover`
                  : AVATAR_GRADIENT,
                color: "#FFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                flex: "none",
                overflow: "hidden",
              }}
            >
              {!actualCharAvatar ? charName.charAt(0) : null}
            </span>
            <span>
              <b style={{ color: T.pink, fontWeight: 500 }}>{charName}</b> 正在输入…
            </span>
          </div>
        ) : null}
      </main>

      {/* 底部输入区：实底 T.card ＋ 上沿一根 1px T.lineSoft。
          不要跟顶栏那层薄纱一样做成半透：顶栏那层纱是**在照片上压一层**（照片还在，只是淡了），
          输入条这层实白是**一根压住照片的横杆**——两者作用不同，不该强行对称。
          底下的白横杆不丑，丑的是让照片从输入条底下一路透上来（那半截照片既不是背景、
          也不成控件，读起来是脏的）。顶栏能透，是因为它就那么薄薄一条、底下紧接着就是内容；
          输入条这边压着一堆控件，透上来只会让它们浮在花花的照片上。 */}
      <div
        style={{
          position: "relative",
          flex: "none",
          background: T.card,
          zIndex: 30,
          paddingBottom: "calc(var(--safe-area-bottom, 0px) + 6px)",
        }}
      >
        <div style={{ height: 1, background: T.lineSoft }} />
        {/* 引用栏 */}
        {quoteText ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 14px",
              borderTop: `1px solid ${T.lineSoft}`,
              background: "rgba(232,106,155,.06)",
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: T.ink2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: ".02em",
              }}
            >
              <b style={{ fontWeight: 500, color: T.pink, marginRight: 6 }}>引用</b>
              {quoteText}
            </div>
            <button
              type="button"
              onClick={() => setQuoteText("")}
              aria-label="取消引用"
              style={smallBtnStyle}
            >
              <X size={13} strokeWidth={1.8} />
            </button>
          </div>
        ) : null}
        {/* 输入区：一行四样：＋、书写框、爱心、小飞机，各自只干一件事：
            · 小飞机＝发送，不论连续发送开不开都只是发出去，它不会让他回；
            · 爱心＝强制回复，常驻在发送键左边，只在开了连续发送、又攒着话没回时才亮
              （见 canForceReply）；没开连续发送时 TA 本来就每条都回，它就淡着待命。 */}
        <div style={{ padding: "8px 12px 2px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: T.card,
            border: "1px solid rgba(232,106,155,.16)",
            borderRadius: 20,
            padding: "8px 10px",
            boxShadow: "0 4px 14px rgba(232,106,155,.07)",
          }}
        >
          {/* 加号按同一族的**纸**做，跟右边那两颗实心粉圆（爱心／小飞机）统一：
              白到淡粉的渐变底、内描一圈粉边、外浮一层淡粉影，尺寸对齐 36。
              点开时整颗「上糖」——换成实心粉渐变＋白图标，跟爱心／小飞机同一个脸，
              一眼看得出面板是开着的。 */}
          <button
            type="button"
            onClick={() => setShowPlus((v) => !v)}
            aria-label="更多功能"
            style={{
              ...inputBtnStyle,
              width: 36,
              height: 36,
              borderRadius: 999,
              background: showPlus
                ? "linear-gradient(180deg,#F09CBE 0%,#E06E90 100%)"
                : "linear-gradient(180deg,#FFFFFF 0%,#FFF1F6 100%)",
              color: showPlus ? "#FFFFFF" : T.pink,
              boxShadow: showPlus
                ? "0 3px 10px rgba(232,106,155,.30), inset 0 1px 0 rgba(255,255,255,.45)"
                : "0 2px 8px rgba(232,106,155,.14), inset 0 0 0 1px rgba(232,106,155,.20)",
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
              background: "transparent",
              borderRadius: 0,
              padding: "6px 4px",
              fontSize: 15,
              fontFamily: SANS,
              color: T.ink,
              lineHeight: 1.55,
              letterSpacing: ".02em",
            }}
          />
          {/* 爱心：强制回复，常驻、样式与小飞机完全一致。点得动时是实心粉底白心；
              点不动时整颗淡下去待命（同小飞机未载入那档透明度），既不碍眼、也不抢小飞机的戏。 */}
          <button
            type="button"
            onClick={forceReply}
            disabled={!canForceReply}
            aria-label="强制回复"
            style={{
              ...inputBtnStyle,
              width: 36,
              height: 36,
              background: T.pink,
              color: "#FFFFFF",
              borderRadius: 999,
              opacity: canForceReply ? 1 : 0.35,
              cursor: canForceReply ? "pointer" : "default",
              boxShadow: "0 3px 10px rgba(232,106,155,.30)",
              transition: "opacity .18s",
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
                background: T.pink,
                color: "#FFFFFF",
                borderRadius: 999,
              }}
            >
              <SquareStop size={20} strokeWidth={1.6} />
            </button>
          ) : (
            <button
              type="button"
              onClick={sendMsg}
              disabled={!loaded}
              aria-label="发送"
              style={{
                ...inputBtnStyle,
                width: 36,
                height: 36,
                background: T.pink,
                color: "#FFFFFF",
                borderRadius: 999,
                opacity: loaded ? 1 : 0.35,
                cursor: loaded ? "pointer" : "default",
                boxShadow: "0 3px 10px rgba(232,106,155,.30)",
              }}
            >
              <Send size={19} strokeWidth={1.8} />
            </button>
          )}
        </div>
        </div>
        {/* 加号面板：形是「一张信笺上的清单」（不摆九宫格棋子）：
            · 笺面铺一层极淡的网点纹——纸得有肌理，才不是一块纯色塑料板；
            · 笺纸内描一圈粉发丝，跟外沿的粉边凑成「纸有厚度」；
            · 八项两列，中间一道竖发丝当栏线（账目／清单的样子），
              每项一枚 26 的淡粉圆晕托着线描图标，配一行衬线字（衬线是这 App「纸」那族的用字）；
            · 底下一条发丝断开，压一条通栏的糖（「重新回复」），右端一枚箭头指出去。
            整块笺自己是纸：白到淡粉的渐变、圆角 22，顶上压一根抽屉把手。 */}
        {showPlus ? (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              /* 网点纹压在最上层，底下才是那层白到淡粉的渐变。 */
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
            {/* 把手：抽屉顶上那根小杠，纯装饰（开合还是走那颗加号）。 */}
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 999,
                background: "rgba(232,106,155,.22)",
                margin: "0 auto 10px",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              {PLUS_ITEMS.map((item, i) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onPlusClick(item.name)}
                  /* 左栏每一项挂一道右描边——两栏之间那道竖发丝就是这么拼出来的：
                     行与行零间距，四条右描边首尾相接，成一条不断的栏线。 */
                  style={{
                    ...plusItemStyle,
                    ...(i % 2 === 0 ? { borderRight: "1px solid rgba(232,106,155,.12)" } : null),
                  }}
                >
                  {/* 图标托在一枚淡粉圆晕上：比裸图标有分量，又不至于退回「方块棋子」。 */}
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      flex: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(232,106,155,.09)",
                      color: T.pink,
                    }}
                  >
                    <item.icon size={15} strokeWidth={1.6} />
                  </span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            {/* 发丝：把「发内容」和「做一件事」在视觉上断开。 */}
            <div style={{ height: 1, background: "rgba(232,106,155,.14)", margin: "11px 0 12px" }} />
            {/* 通栏动作：这一条是糖——跟点开时的加号同一档，一眼知道它不是「内容」。 */}
            <button
              type="button"
              onClick={() => onPlusClick(PLUS_ACTION.name)}
              style={{
                position: "relative",
                width: "100%",
                height: 42,
                borderRadius: 14,
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "linear-gradient(180deg,#F09CBE 0%,#E06E90 100%)",
                boxShadow:
                  "0 4px 12px rgba(232,106,155,.28), inset 0 1px 0 rgba(255,255,255,.45), " +
                  "inset 0 -1px 0 rgba(160,50,90,.18)",
                color: "#FFFFFF",
                fontSize: 13,
                letterSpacing: ".06em",
                fontFamily: SERIF,
                cursor: "pointer",
              }}
            >
              <PLUS_ACTION.icon size={17} strokeWidth={1.9} />
              {PLUS_ACTION.name}
              {/* 右端一枚箭头：这一条点下去还有下一步（弹窗），不是直接发出去。 */}
              <span
                style={{
                  position: "absolute",
                  right: 13,
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  opacity: 0.8,
                }}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </span>
            </button>
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
                  label="转文字"
                  color={T.pink}
                  onClick={() => {
                    setShowTrans(curMsg.id);
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

      {/* 红包弹窗 */}
      {showRpModal ? (
        <ModalShell onClose={() => setShowRpModal(false)}>
          <div style={modalIconStyle}>¥</div>
          <div style={modalTitleStyle}>领取成功</div>
          <div style={modalEnStyle}>lucky money</div>
          <div style={modalAmountStyle}>¥ 5.20</div>
          <div style={modalDescStyle}>
            来自 {charName} 的红包
            <br />
            恭喜发财，大吉大利
          </div>
          <ModalBtn onClose={() => setShowRpModal(false)} text="收下" />
        </ModalShell>
      ) : null}

      {/* 转账弹窗 */}
      {showTrModal ? (
        <ModalShell onClose={() => setShowTrModal(false)}>
          <div style={modalIconStyle}>¥</div>
          <div style={modalTitleStyle}>已收下转账</div>
          <div style={modalEnStyle}>transfer received</div>
          <div style={modalAmountStyle}>¥ 200.00</div>
          <div style={modalDescStyle}>备注：给你买外套的</div>
          <ModalBtn onClose={() => setShowTrModal(false)} text="完成" />
        </ModalShell>
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

      {/* 【临时诊断·缓存】本轮真正发出去的请求（定位完连这个按钮一起删） */}
      <button
        type="button"
        onClick={() => setShowDebugReq(true)}
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
        请求
      </button>
      {showDebugReq ? (
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
            <span>本轮发出去的东西</span>
            <button
              type="button"
              onClick={() => setShowDebugReq(false)}
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
            {debugReq ? (
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
                  {debugReq.flags}
                </div>
                <div style={{ height: 1, background: T.lineSoft, margin: "8px 0" }} />
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.8,
                    color: T.ink,
                    fontWeight: 600,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {debugReq.around}
                </div>
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
            <pre
              style={{
                margin: 0,
                fontFamily: "monospace",
                fontSize: 10,
                lineHeight: 1.6,
                color: T.ink,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {debugReq?.full ?? "（暂无）"}
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
}: {
  avatar: string;
  fallbackChar: string;
  gradient: string;
}) {
  return (
    <div
      style={{
        flex: "none",
        width: 38,
        height: 38,
        borderRadius: "50%",
        background: avatar ? "#fff" : gradient,
        color: "#FFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 600,
        overflow: "hidden",
        boxShadow:
          "0 0 0 1px rgba(232,106,155,.5),0 0 0 3px rgba(232,106,155,.13),inset 0 1px 2px rgba(255,255,255,.35)",
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

/* 加号面板里每一项：不做等大的方块棋子、图标各自装底托（九枚一铺就是最常规的工具栏）。
   这里是一张信笺上的清单：一枚线描图标配一行衬线字，左对齐、两列排开。
   衬线是这 App「纸」的那一族用字（气泡里的描述也是它），摆在这儿才是一家人。 */
const plusItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  height: 40,
  padding: "0 10px",
  borderRadius: 11,
  border: "none",
  background: "transparent",
  fontSize: 13,
  color: T.ink2,
  letterSpacing: ".03em",
  textAlign: "left",
  transition: "all .15s",
  cursor: "pointer",
  fontFamily: SERIF,
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
  onRegen: () => void;
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
        <span style={{ fontSize: 10.5, color: "rgba(232,106,155,.85)", letterSpacing: ".04em" }}>
          点此重新生成
        </span>
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

/* ── 语音播放：照参考项目抄 ──────────────────────────────────────────────────
   参考项目（stellasei/components/chat/message-bubble.tsx 的 playSrc）播聊天语音
   只有三件事：`new Audio(src)` → `play()` → 播完 `pause() + removeAttribute("src")
   + load()` 把元素整个丢掉。它没有共用播放器、不做保活静音、不设 audioSession、
   也不把音频转成 blob——src 就是消息里存的那串 data URL，直接塞给新建的 <audio>。

   前几版自作聪明加了「全页共用一个播放器 + 一直挂一条循环静音保活」，结果照样是
   「第一次响、之后全哑」。WebKit 的 bug 单（295518）对这种症状的原话是：存着的
   <audio> 元素会 stuck / unreleased by the system——被系统扣着不放。那就反过来做：
   每次点当场新建，播完立刻释放，页面上不留任何一个活着的音频元素。 */
let voiceEl: HTMLAudioElement | null = null; /* 此刻在响的那个，播完即弃 */

/** 丢掉一个媒体元素：暂停、摘掉 src、再 load() 一次，让系统彻底松手。 */
function disposeVoiceEl(audio: HTMLAudioElement): void {
  if (voiceEl === audio) voiceEl = null;
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
    /* 已经没了 */
  }
}

/** 停掉正在响的媒体元素语音（没在响就什么都不做）。元素直接丢掉，不留着。 */
function stopVoiceEl(): void {
  const el = voiceEl;
  if (!el) return;
  el.onended = null;
  el.onerror = null;
  disposeVoiceEl(el);
}

/** 媒体元素此刻在响吗——不看界面上的标记，那玩意会卡住骗人。 */
function isVoiceElPlaying(): boolean {
  return !!voiceEl && !voiceEl.paused && !voiceEl.ended;
}

/** Web Audio 这条路此刻有声音在响吗。 */
function isVoiceCtxPlaying(): boolean {
  return !!voiceNode;
}

/**
 * 用媒体元素播一条语音——照参考项目：当场 new 一个 <audio>，src 直接给 data URL，
 * 播完就 pause + removeAttribute("src") + load() 把它丢掉，页面上不留活元素。
 * ok:false ＝ 这条路没走通（play() 被拒／加载失败），调用方可以再试 Web Audio。
 */
async function playVoiceViaElement(
  dataUrl: string,
  onEnded: () => void,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const audio = new Audio(dataUrl);
  voiceEl = audio;
  audio.onended = () => {
    disposeVoiceEl(audio);
    onEnded();
  };
  audio.onerror = () => {
    disposeVoiceEl(audio);
    onEnded();
  };
  try {
    await audio.play();
  } catch (err) {
    const e = err as { name?: string; message?: string } | null;
    disposeVoiceEl(audio);
    return { ok: false, why: `play() 被拒绝（${e?.name ?? "?"} ${e?.message ?? ""}）` };
  }
  return { ok: true };
}

/* ── 语音播放备用路：Web Audio ──────────────────────────────────────────────
   不碰媒体元素，把音频解码成样本直接喂扬声器。参考项目警告过它在 iOS 上会被
   静音拨键掐掉，所以只当备胎。全局只留一个 AudioContext（iOS 对它的数量管得紧），
   同一时刻只响一条。 */

/** 把本页的音频会话设成「媒体播放」类别：iOS 上 Web Audio 才不会跟着静音拨键走。
    参考项目的聊天气泡不设这个（它只用媒体元素，媒体元素本来就不受拨键影响），
    这里只给 Web Audio 这条备胎路用。只有 Safari 16.4+ 认这个属性，认不出就跳过。 */
function applyPlaybackAudioSession(): void {
  const sess = (navigator as Navigator & { audioSession?: { type?: string } }).audioSession;
  if (!sess) return;
  try {
    sess.type = "playback";
  } catch {
    /* 老系统不认这个类别 */
  }
}

type VoiceAudioHost = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
let voiceCtx: AudioContext | null = null;
let voiceNode: AudioBufferSourceNode | null = null;
let voiceBuf: { key: string; buf: AudioBuffer } | null = null;

/** 停掉正在响的 Web Audio 语音（没在响就什么都不做）。 */
function stopVoiceCtx(): void {
  if (!voiceNode) return;
  const node = voiceNode;
  voiceNode = null;
  /* 先摘掉回调：stop() 也会触发 ended，不摘会被当成「自然播完」。 */
  node.onended = null;
  try {
    node.stop();
  } catch {
    /* 已经停过了 */
  }
  node.disconnect();
}

/** 懒建那唯一一个 AudioContext。必须在用户手势里调用，iOS 才给声。 */
function getVoiceCtx(): AudioContext | null {
  if (voiceCtx) return voiceCtx;
  const host = window as unknown as VoiceAudioHost;
  const Ctor = host.AudioContext ?? host.webkitAudioContext;
  if (!Ctor) return null;
  try {
    voiceCtx = new Ctor();
  } catch {
    return null;
  }
  /* iOS 上 Web Audio 默认跟着「静音开关」走（媒体元素不跟），能设就设成媒体播放。 */
  applyPlaybackAudioSession();
  return voiceCtx;
}

/** data URL 的 base64 段还原成 ArrayBuffer——decodeAudioData 只吃二进制。 */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | null {
  const head = /^data:([^;,]*)(;base64)?,/.exec(dataUrl);
  if (!head) return null;
  try {
    const body = dataUrl.slice(head[0].length);
    const bytes = head[2]
      ? Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** 解码音频。老 Safari 只认回调写法、新浏览器认 Promise，两种都兜住。 */
function decodeVoice(ctx: AudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const pending = ctx.decodeAudioData(raw, resolve, reject) as unknown as Promise<AudioBuffer> | undefined;
    if (pending && typeof pending.then === "function") pending.then(resolve, reject);
  });
}

/**
 * 用 Web Audio 播一条语音。返回 ok:false 表示这条路走不通（浏览器不支持／音频解不出来），
 * 调用方可以退回去用 <audio>。key 用消息 id：同一条重复点，解码结果直接复用。
 */
async function playVoiceViaWebAudio(
  key: string,
  dataUrl: string,
  onEnded: () => void,
): Promise<{ ok: true; seconds: number; state: string } | { ok: false; why: string }> {
  const ctx = getVoiceCtx();
  if (!ctx) return { ok: false, why: "浏览器没有 Web Audio" };
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      /* iOS 26 装到主屏幕后有个已知 bug：音频设备根本点不着，报
         InvalidStateError「Failed to start the audio device」。社区实测的偏方是
         「先挂起再喊醒」——能把音频设备重新点火。多试这一下不亏。 */
      try {
        await ctx.suspend();
        await ctx.resume();
      } catch (err) {
        return { ok: false, why: `唤醒音频引擎失败（${err instanceof Error ? err.message : String(err)}）` };
      }
    }
  }
  let buf = voiceBuf?.key === key ? voiceBuf.buf : null;
  if (!buf) {
    const raw = dataUrlToArrayBuffer(dataUrl);
    if (!raw) return { ok: false, why: "音频文本解不出二进制" };
    try {
      buf = await decodeVoice(ctx, raw);
    } catch (err) {
      return { ok: false, why: `解码失败（${err instanceof Error ? err.message : String(err)}）` };
    }
    voiceBuf = { key, buf };
  }
  /* 同一时刻只响一条：先把上一条掐掉，再开新的。 */
  stopVoiceCtx();
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.connect(ctx.destination);
  node.onended = () => {
    if (voiceNode === node) voiceNode = null;
    onEnded();
  };
  voiceNode = node;
  node.start(0);
  return { ok: true, seconds: buf.duration, state: ctx.state };
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

const modalIconStyle: CSSProperties = {
  width: 52,
  height: 52,
  margin: "0 auto 14px",
  borderRadius: "50%",
  border: "1.5px solid rgba(232,106,155,.7)",
  color: T.pink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 20,
  fontWeight: 600,
  background: "rgba(232,106,155,.07)",
};

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

const modalAmountStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 500,
  fontFamily: SANS,
  color: T.ink,
  marginTop: 10,
  fontVariantNumeric: "tabular-nums",
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

function ModalBtn({ onClose, text }: { onClose: () => void; text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
      <button
        type="button"
        onClick={onClose}
        style={{
          ...modalConfirmBtnStyle,
          width: "100%",
        }}
      >
        {text}
      </button>
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
