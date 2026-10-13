"use client";

/**
 * 星绥通讯：动态页 —— **朋友圈**形态的聚合时间轴。
 *
 * 【形态】顶上封面通铺整宽、从屏幕最顶端压下来；我的头像骑在封面下沿（里 38／外 22），
 * 名字与签名落在封面外、右对齐一列。底下是「连成一片」的信息流：每条左边圆头像（白圈），
 * 右边名字＋正文＋相纸图（可选）＋时间＋互动行。整页跟着滚动，左上角菜单钮浮着不滚。
 * 【数据】只看**当前面具**那份（`conversations` 传进来的就是）；动态照旧存在
 * `Conversation.moments` 里，这里只是摊平了读（读路径保留；TA 主动发动态那条生产链路已撤）。
 * 【生图】动态配图在条目上手动点生成——描述卡里看得见、改得动，确认了才花钱；
 * 点图 → 放大预览 ＋ 保存图片。
 * 【只读】点条目不进聊天；
 * 赞／评从 2026-10-05 起接真数据（我赞／取消赞、平铺评论 ＋ 二级回复、@ 点名）；
 * 转发那枚仍是占位（点了报「还在做」），角色侧的赞/评由后续步骤接。
 * 【通知】**封面下沿那枚玻璃气泡**：**只收「角色对你做的事」**
 * ——角色赞／评论／回复我的动态时，往 `lib/chat/moments-notice.ts` 那个仓库推一条，
 * 这一页读出来、按 `moments-seen-at` 算未读、滤掉人已不在页上的几条，摆成气泡。
 * **角色自己发新帖不算我的通知。**
 * 点气泡＝认下这几条（记「看过了」、随手收起）；真正的「全部通知栏」入口
 * 与点击跳转留到后面那步再开。
 *
 * ── 设计判据（动这一页之前先读这几条）──
 * · 参考图只借**骨架**，零件必须是我们自己的：
 *   形状是参考图的、颜色是自己的，那还是照抄。
 * · **封面是雾**（无边界、通铺整宽、从 y=0 压下来），**动态是纸**（有边界）；
 *   「卡片」≠「方角＋细线」，而是「摆在页面上的一块」——有边距、圆角、投影就还是卡片。
 * · **大面守本分，细节上出手**：底色守星绥本来的粉，那支蓝只落在卡内侧底沿 3px 的「芯」上。
 * · **一支色不会脏，两支才会**（粉＋香芋叠出灰紫）；立体感做在「纸的厚度」里，不在外面垫色。
 * · 要的是**层级**，不是「更少零件」；**主次清楚 ≠ 不普通**，
 *   别再拿「减法」当答案。
 * · **加的一层不如不加**；但凡是从星绥自己身上长出来的（气泡＝聊天的母语），就该长。
 * · 一页只有一个「最大」：正文最大；名字是标签，不许跟正文抢。
 *
 * 逐版来龙去脉全部记在 `docs/施工日志.md`，这里不再复述。
 */

import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  Globe,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  SlidersVertical,
  Smartphone,
  Star,
  Trash2,
  Type as TypeIcon,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LAT, SANS, SERIF, T, momentFullTime, momentTime } from "./shared";
import type { ArchiveCategory, ArchiveEntry } from "@/types/contact";
import type {
  ApiPresetEntry,
  Conversation,
  MomentComment,
  MomentLike,
  MomentVisibility,
  SelfMoment,
} from "@/types/chat";
import { MOMENT_SELF_ID } from "@/types/chat";
import { uuid } from "@/lib/uuid";
import { getCategories } from "@/lib/settings/contact";
import {
  generateMomentImage,
  isMomentImageGenerating,
  subscribeMomentImage,
} from "@/lib/chat/moment-image";
import { describeSelfMomentImage } from "@/lib/chat/moment-vision";
import { generateImage } from "@/lib/chat/chatApi";
import {
  addSelfMoment,
  getApiBundle,
  getApiPresets,
  getChatPrefs,
  getMomentsCover,
  getMomentsCoverPos,
  getSelfMoments,
  removeSelfMoment,
  saveChatPrefs,
  saveMomentsCover,
  saveMomentsCoverPos,
  setMomentComments,
  setMomentImagePrompt,
  setMomentLikes,
  setMomentPinned,
  setSelfMomentComments,
  setSelfMomentLikes,
  updateSelfMoment,
} from "@/lib/settings/chat";
import {
  getCachedMediaBlob,
  persistImageAsset,
  releaseImageAsset,
  saveImageToDevice,
  useMediaSrc,
} from "@/lib/chat/media-asset";
import {
  getMomentNotices,
  getMomentsSeenAt,
  setMomentsSeenAt,
  type MomentNotice,
} from "@/lib/chat/moments-notice";

/** 摊平后的一条动态（正文＋作者信息＋配图状态）。 */
interface FeedItem {
  /** 全局唯一 id = conversationId::momentId */
  uid: string;
  content: string;
  createdAt: string;
  name: string;
  avatar: string;
  /** TA 用〔动态图〕写的画面描述（可选）；还没点生成时就有。 */
  imagePrompt?: string;
  /** 点生成后回写的 media-store:// 引用串。 */
  imageRef?: string;
  /** 我发的：多张配图引用串（2026-10-13 起，最多 9 张）。 */
  images?: string[];
  /** 我发的：「文字描述当图」——没画真图，拿这段文字当这张配图（可选）。 */
  imageText?: string;
  /** 用来回写 imageRef（conversationId 唯一确定角色×面具，momentId 指向某条动态）。 */
  conversationId: string;
  momentId: string;
  /** 标了「重要」的那条：永远原文留在 TA 的记忆里（记忆页也会星标出来）。 */
  pinnedByUser?: boolean;
  /** 这一条是**我自己**发的（作者＝当前面具；右上角小书签／标重要对我不适用）。 */
  isSelf?: boolean;
  /** 我发的：自定义标签（存纯词，展示时前面带 #）。 */
  tags?: string[];
  /** 我发的：可见范围。 */
  visibility?: MomentVisibility;
  /** 我发的：部分可见时，可见的人名（展示用；由 visibleTo 的角色 id 换算）。 */
  visibleNames?: string[];
  /** 我发的：改范围要用回原始名单（FeedItem 只带人名带不了 id）。 */
  visibleTo?: string[];
  visibleWorlds?: string[];
  excludeTo?: string[];
  excludeWorlds?: string[];
  /** 这条动态的赞（我／任何角色）。缺省＝还没人赞。 */
  likes?: MomentLike[];
  /** 这条动态的评论（含二级回复）。缺省＝还没人评。 */
  comments?: MomentComment[];
}

/** 一条动态的全部配图引用串：多图走 `images`，老的单图 `imageRef` 并进来。 */
function momentImages(m: { images?: string[]; imageRef?: string }): string[] {
  const list = (m.images ?? []).filter(Boolean);
  if (list.length > 0) return list;
  return m.imageRef ? [m.imageRef] : [];
}

/** 系统／星绥自己是否要求「少动效」：省电总闸（html.smooth-mode）或系统「减少动态效果」。
    真命中时退场就不等了——全局本来就把动画掐掉了，干等只会更卡，直接硬切最顺。 */
function calmMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains("smooth-mode")) return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 浮层「进退场」的小钩子：`value` 非空＝开着、空＝关了。
    关的那一下**不立刻把节点摘掉**：先把 `closing` 亮起来（外面据此跑退场动画），
    等 `ms` 毫秒跑完才真卸。返回的 `shown` 是**最近一次非空的值**——退场那几十毫秒里
    浮层还得靠它撑着内容，直接拿已经变 null 的原状态去渲染会当场炸。
    ⚠️ 为什么用 ref 存「上一次非空」而不是另开一份 state：state 副本会让受控输入晚一帧、
    打字跳光标；这里平时直接用 `value` 自身（它永远是最新的），只在它变空的退场窗口里
    才回落到上次那份——打字路径一帧都不多。 */
function usePresence<T>(value: T | null, ms: number): { shown: T | null; closing: boolean } {
  const lastRef = useRef<T | null>(value);
  const [closing, setClosing] = useState(false);
  /* 本段的 setState 都是「跟着 value 变」的同步收敛（开→关、关→开各一次），
     不是那种会自我触发的级联渲染；hook 规则会把 effect 里的同步 setState 一刀切
     报出来，这里定向放行。 */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (value !== null) {
      lastRef.current = value;
      setClosing(false);
      return;
    }
    /* value 变空：本来就没开过就什么都不做（没有节点要退场）。 */
    if (lastRef.current === null) return;
    if (calmMotion()) {
      lastRef.current = null;
      setClosing(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => {
      lastRef.current = null;
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* 读 ref 只为拿「退场窗口里那份上次的值」：它由上面的 effect 同步写入，
     读取与写入成对发生，不会出现读到半截的中间态；渲染期读 ref 的通用禁令在此豁免。 */
  // eslint-disable-next-line react-hooks/refs
  const shown = value !== null ? value : lastRef.current;
  return { shown, closing };
}

/** 动态页自己的色板（2026-10-13 换皮「雾蓝纸墨」，与消息列表「戊」同一套；
    T 是聊天共享的粉系，不能动它——这页改用自己的 C）。 */
const C = {
  paper: "#FAF9F6", // 页底：暖白纸
  card: "#FFFFFF", // 弹层底
  ink: "#3A4149", // 墨
  ink2: "#7A8A9E", // 次级
  ink3: "#B3B8BE", // 淡
  line: "rgba(58,65,73,.13)", // 细边
  line2: "rgba(58,65,73,.07)", // 发丝线
  accent: "#5A7391", // 雾蓝：主按钮、选中、点睛
  accentSoft: "#E7ECF2", // 淡蓝底
};

/** 封面里的字色：封面默认是蓝紫天空底，白字压不住，一律用**墨色**（跟纸上的字同一支）。 */
const COVER_INK = "#3A4149";

/** 纯图标按钮的底样（@ 那枚等）：无底、无框，就一枚图标。 */
const ICON_BTN: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: C.ink3,
  cursor: "pointer",
};

/** 条目底部那两枚**带字**的互动键（`LIKE` / `COMMENT`，草稿 `.m-a` 同款）：
    等宽小字、全大写、字距拉开，图标 15px，靠左站一排。`on` ＝ 选中／展开态走主雾蓝。 */
const ACT_BTN = (on: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  fontFamily: LAT,
  fontSize: 9.5,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: on ? C.accent : C.ink2,
});

/** 条目右上角那枚「⋯」的底样（草稿 `.m-more`，20×20 只装三颗点）。 */
const MORE_BTN: CSSProperties = {
  flex: "none",
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  padding: 0,
  color: C.ink3,
  cursor: "pointer",
  fontFamily: LAT,
  fontSize: 15,
  lineHeight: 1,
};

/** 评论输入框（评论区里内联那一只）：一枚药丸，跟聊天输入框同一口气。 */
const COMMENT_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${C.line}`,
  background: "#fff",
  borderRadius: 999,
  padding: "6px 12px",
  fontFamily: SANS,
  fontSize: 12.5,
  letterSpacing: ".01em",
  color: C.ink,
  outline: "none",
};

/** 评论「发送」按钮：有内容才亮（粉底白字），空着就是一枚灰。 */
const COMMENT_SEND = (on: boolean): CSSProperties => ({
  border: "none",
  background: on ? C.accent : "rgba(20,19,24,.10)",
  color: on ? "#fff" : C.ink3,
  borderRadius: 999,
  padding: "6px 14px",
  fontFamily: SANS,
  fontSize: 12,
  letterSpacing: ".05em",
  cursor: on ? "pointer" : "default",
});

/** 评论区里那枚小小的「回复」。 */
const COMMENT_REPLY_BTN: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  marginLeft: 6,
  color: C.ink3,
  fontFamily: SANS,
  fontSize: 11,
  letterSpacing: ".03em",
  cursor: "pointer",
};

/** 封面左下那两枚小药丸（「换封面」「还原」）的底样——
    它是个**按钮**，圆角是按钮自己的事，封面通铺不通铺都不管它。 */
const COVER_PILL: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px 6px 10px",
  borderRadius: 999,
  border: "none",
  background: "rgba(255,255,255,.62)",
  color: COVER_INK,
  fontFamily: SANS,
  fontSize: 10.5,
  letterSpacing: ".08em",
  cursor: "pointer",
};

/* ── 底单（草稿 `.m-sheet`）：从屏幕底上浮的一张选择单，用来装「换封面」「这条动态」那几组动作。
      2026-10-13 起「⋯」和封面都走这套，不再用小下拉（小下拉会被动态流滚动的框裁掉）。
      项与项之间的发丝线在样式块里用 `.mp-sh-item + .mp-sh-item::before` 补。 ── */
const SHEET_ITEM: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 14,
  width: "100%",
  textAlign: "left",
  background: "none",
  border: 0,
  padding: "14px 2px",
  fontFamily: SANS,
  cursor: "pointer",
};

/** 底单里每项左端那枚 42×42 的淡蓝圆角图标底。 */
const SHEET_ICO: CSSProperties = {
  flex: "none",
  width: 42,
  height: 42,
  borderRadius: 13,
  background: C.accentSoft,
  color: C.accent,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** 底单每项的主标题（宋体小白）。 */
const SHEET_B: CSSProperties = {
  display: "block",
  fontFamily: SERIF,
  fontSize: 15.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  color: C.ink,
};

/** 底单每项的副标题（灰字一行）。 */
const SHEET_I: CSSProperties = {
  display: "block",
  marginTop: 3,
  fontStyle: "normal",
  fontSize: 12.5,
  color: C.ink2,
};

/** 底单最底下那枚「取消」。 */
const SHEET_CANCEL: CSSProperties = {
  marginTop: 8,
  width: "100%",
  height: 44,
  border: 0,
  borderRadius: 13,
  background: "#F2F3F1",
  color: C.ink,
  fontFamily: SANS,
  fontSize: 14,
  letterSpacing: ".14em",
  cursor: "pointer",
};

/** 「谁可以看」四档（图标 ＋ 文案）。 */
const VISIBILITY_OPTIONS: { key: MomentVisibility; label: string; icon: typeof Globe }[] = [
  { key: "public", label: "公开", icon: Globe },
  { key: "private", label: "仅自己可见", icon: Lock },
  { key: "partial", label: "部分可见", icon: Users },
  { key: "exclude", label: "不给谁看", icon: EyeOff },
];

/** 四档的中文名（动态上那枚范围记号、发布页那行当前值都要用）。 */
const VISIBILITY_LABEL: Record<MomentVisibility, string> = {
  public: "公开",
  private: "仅自己可见",
  partial: "部分可见",
  exclude: "不给谁看",
};

/** 「部分可见」里「世界／角色」那种勾选 chip 的底样（选中＝粉底粉字）。 */
const pickChip = (on: boolean): CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 999,
  border: `1px solid ${on ? "rgba(90,115,145,.5)" : C.line}`,
  background: on ? C.accentSoft : "rgba(20,19,24,.04)",
  color: on ? C.accent : C.ink2,
  fontFamily: SANS,
  fontSize: 12,
  letterSpacing: ".04em",
  cursor: "pointer",
});

/** 「谁可以看」底单顶行的标题。 */
const SHEET_TITLE: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: ".1em",
  color: C.ink,
  paddingBottom: 6,
};

/** 「谁可以看」底单里那行灰字小提示。 */
const SHEET_HINT: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.7,
  color: C.ink3,
  padding: "0 2px 4px",
};

/** 「部分可见／不给谁看」里面「世界」「角色」那两节的标题。 */
const VIS_SECTION: CSSProperties = {
  fontSize: 11,
  letterSpacing: ".08em",
  color: C.ink3,
  padding: "12px 2px 8px",
};

/** 勾选 chip 的排布容器。 */
const VIS_CHIPS: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

/* ⚠︎ 这里原本有个 `paperTilt(uid)`——按 uid 算死一个 ±0.5° 的微斜角，专给相纸用。
   2026-09-22 恩熙说「**照片不要有倾斜，就是正常的照片就好**」，那一处用法已撤，
   函数本身没有第二个调用者，于是**一并删掉**（留着只会变成没人认领的死代码）。 */

/** 发布页九宫格里的一格配图：自己解引用串 → 铺满一张方形格；右上角一枚叉能拿掉这一张。
    多图必须拆成子组件逐格渲染——`useMediaSrc` 一次只解一个引用串（见 media-asset.ts）。 */
function ComposerThumb({
  refStr,
  onRemove,
}: {
  refStr: string;
  onRemove: () => void;
}) {
  const src = useMediaSrc(refStr);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        paddingTop: "100%",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgba(20,19,24,.04)",
        border: `1px solid ${C.line}`,
      }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt="配图"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.ink3,
          }}
        >
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}
      <button
        type="button"
        className="mp-act"
        aria-label="拿掉这张配图"
        onClick={onRemove}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 20,
          height: 20,
          padding: 0,
          borderRadius: "50%",
          border: "none",
          background: "rgba(20,19,24,.72)",
          color: "#FFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <X size={11} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** 动态卡片九宫格里的一格配图：自己解引用串 → 铺满一张方形格；点开＝看大图。
    非我发的还能长按重画（`pressHandlers` 由条目那层给）。多图必须拆成子组件逐格渲染——
    `useMediaSrc` 一次只解一个引用串（见 media-asset.ts）。 */
function MomentThumb({
  refStr,
  onOpen,
  pressHandlers,
  generating,
}: {
  refStr: string;
  /** 点开这一格：把**这一格自己解出来的**地址与引用串交上去（放大层要地址，保存要引用串）。 */
  onOpen: (src: string, ref: string) => void;
  pressHandlers?: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onPointerLeave: (e: ReactPointerEvent) => void;
  };
  /** 这一格正在重画（盖一层遮罩）。 */
  generating?: boolean;
}) {
  const src = useMediaSrc(refStr);
  return (
    <button
      type="button"
      className="mp-act no-callout"
      aria-label={pressHandlers ? "查看配图，长按重新生成" : "查看配图"}
      {...(pressHandlers ?? {})}
      onClick={() => {
        if (src) onOpen(src, refStr);
      }}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        paddingTop: "100%",
        padding: 0,
        border: "none",
        borderRadius: 8,
        background: "rgba(20,19,24,.03)",
        overflow: "hidden",
        cursor: "zoom-in",
      }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt="配图"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.ink3,
          }}
        >
          <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
        </span>
      )}
      {generating ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: "#FFFFFF",
            fontSize: 11.5,
            letterSpacing: ".04em",
          }}
        >
          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
          重新生成中…
        </span>
      ) : null}
    </button>
  );
}

export default function MomentsPage({
  archives,
  conversations,
  maskId,
  maskName,
  maskAvatar,
  signature,
  onOverlayChange,
  showToast,
}: {
  /** 全部角色档案（用来把动态的作者名／头像补上）。 */
  archives: ArchiveEntry[];
  /** 当前面具下的会话（动态就是从这里摊出来的）。 */
  conversations: Conversation[];
  /** 当前使用中的面具 id（我发的动态按面具存，一册一份）。 */
  maskId: string;
  /** 我：当前使用中面具的名字（压在封面左下那格名片上）。 */
  maskName: string;
  /** 我：当前使用中面具的头像（那格名片上的圆头像）。 */
  maskAvatar: string;
  /** 我：个性签名（名片上那行小字）。 */
  signature: string;
  /** 整页浮层（发布／编辑／看图／换封面单…）开合上报：上一层据此把底部四个 tab 按钮收起来。 */
  onOverlayChange: (open: boolean) => void;
  showToast: (msg: string) => void;
}) {
  /* 我发过的动态：按面具读一册（跟 TA 的动态分开存，见 settings/chat.ts 的 self。）。
     存进来之后跟 TA 的一起摊进同一条信息流。 */
  const [selfMoments, setSelfMoments] = useState<SelfMoment[]>([]);
  useEffect(() => {
    let alive = true;
    /* 我这一册动态会被好几处改：我发／删、我在别处手动赞评。所以不能只读一次——
       跟着 `moments-updated` 事件重读，页面上的赞名单才跟得上。 */
    const reload = () => {
      void getSelfMoments(maskId).then((list) => {
        if (alive) setSelfMoments(list);
      });
    };
    reload();
    window.addEventListener("moments-updated", reload);
    return () => {
      alive = false;
      window.removeEventListener("moments-updated", reload);
    };
  }, [maskId]);

  /* 「部分可见」里能整批勾的「世界」（通讯人页那条世界条里的分类）——存世界 id，
     世界里的角色跟着名单走。空＝还没建过世界，那一节就不露。 */
  const [worlds, setWorlds] = useState<ArchiveCategory[]>([]);
  useEffect(() => {
    let alive = true;
    void getCategories().then((list) => {
      if (alive) setWorlds(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 摊平：每条动态挂上作者（名字／头像）。头像与会话列表同一条兜底链——
     会话里单独设过就用单独设的，没设过用档案照片。

     这里跟消息列表（MessageList）同一套过滤，谁来不了就是来不了：
     ① 假删／待同意的朋友不显示（跟列表一致）；
     ② 角色档案已经找不到的会话不显示（否则只能挂个「未命名」）；
     ③ 档案连名字都没填的也不显示——动态页上绝不冒出没头没脸的人。 */
  const shown = conversations.flatMap((conv) => {
    if (conv.friendStatus === "removed" || conv.friendStatus === "requested") return [];
    const archive = archives.find((a) => a.id === conv.characterId);
    if (!archive) return [];
    const d = archive.data;
    const name = (d?.name || d?.nickname || "").trim();
    if (!name) return [];
    return [{ conv, name, avatar: conv.charAvatar || d?.photo || "" }];
  });

  /* 「部分可见」勾人用：就是上面这些人（同一条过滤口径）。 */
  const friends = shown.map((s) => ({ id: s.conv.characterId, name: s.name }));

  /* 我那条动态的「可见人」名单：勾的角色 ＋ 勾的世界里的角色（世界按当前名册展开，
     角色进出世界就跟着变）。只用来在条尾报个「· N 人」。 */
  const visibleNamesOf = (m: SelfMoment): string[] => {
    const ids = new Set<string>(m.visibleTo ?? []);
    const worldIds = m.visibleWorlds ?? [];
    if (worldIds.length > 0) {
      shown.forEach((s) => {
        const arch = archives.find((a) => a.id === s.conv.characterId);
        if (arch && worldIds.includes(arch.categoryId)) ids.add(s.conv.characterId);
      });
    }
    return [...ids]
      .map((id) => (archives.find((a) => a.id === id)?.data?.name || "").trim())
      .filter(Boolean);
  };

  /* 信息流＝TA 的动态（摊平）＋我自己的动态（作者＝当前面具）。 */
  const feed: FeedItem[] = [
    ...shown.flatMap(({ conv, name, avatar }) =>
      (conv.moments ?? [])
        /* 我视角：这条角色动态给不给我看？public 全见／private 谁都看不见／partial
           只看名单里有没有我（「我」不属于任何世界，`visibleWorlds` 对我不生效——
           跟 `my-moments.ts` 里「角色看我动态」那套互为镜像，同一口径）。 */
        .filter((m) => {
          const v = m.visibility ?? "public";
          if (v === "public") return true;
          if (v === "private") return false;
          return (m.visibleTo ?? []).includes(MOMENT_SELF_ID);
        })
        .map((m) => ({
          uid: `${conv.id}::${m.id}`,
          content: m.content,
          createdAt: m.createdAt,
          name,
          avatar,
          imagePrompt: m.imagePrompt,
          imageRef: m.imageRef,
          pinnedByUser: m.pinnedByUser,
          conversationId: conv.id,
          momentId: m.id,
          likes: m.likes,
          comments: m.comments,
        })),
    ),
    ...selfMoments.map((m) => ({
      uid: `self::${m.id}`,
      content: m.content,
      createdAt: m.createdAt,
      name: maskName,
      avatar: maskAvatar,
      isSelf: true,
      images: momentImages(m),
      imageText: m.imageText,
      tags: m.tags,
      visibility: m.visibility ?? "public",
      visibleNames: visibleNamesOf(m),
      visibleTo: m.visibleTo ?? [],
      visibleWorlds: m.visibleWorlds ?? [],
      excludeTo: m.excludeTo ?? [],
      excludeWorlds: m.excludeWorlds ?? [],
      conversationId: "",
      momentId: m.id,
      likes: m.likes,
      comments: m.comments,
    })),
  ];
  // 新→旧：各会话自己的动态本来是有序的，混到一页得重新排。
  feed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  /* 点开的那张配图（放大预览＋保存）。存引用串而不是只存地址——保存时要拿仓库里
     已经解好的 Blob，转成 data URL 再解一遍会把用户手势耗掉（见 saveImageToDevice）。 */
  const [viewerState, setViewer] = useState<{ src: string; ref?: string } | null>(null);
  /* 退场时节点先留着跑完动画再卸——`shown` 是渲染用的值（关的那几十毫秒里仍是旧值）。 */
  const viewerAlive = usePresence(viewerState, 240);
  const viewer = viewerAlive.shown;

  /* 「生成配图」先弹的描述卡（看得见、改得动，确认了才花钱）。
     生成这件事抬到这一层：弹层是卡片流的兄弟节点，不会被那个滚动容器裁掉。 */
  const [editorState, setEditor] = useState<{ item: FeedItem; text: string } | null>(null);
  const editorAlive = usePresence(editorState, 240);
  const editor = editorAlive.shown;
  /* 生图进度登记在 `moment-image` 的登记表里：状态挂在页面里，页面一卸就丢，
     画图那趟请求其实还在跑。这里订阅它，登记表一变就重渲染，
     下面逐条去问「这一条在不在画」。 */
  const [, setGenTick] = useState(0);
  useEffect(() => subscribeMomentImage(() => setGenTick((n) => n + 1)), []);

  /* ── 通知气泡。**只收「角色对我做的事」**：
        往 `moments-notice.ts` 那个仓库推一条后，这里读出来，只留**上次看动态页之后**的
        （`moments-seen-at`），再滤掉人已经不在这一页上的（换面具／朋友被假删之后
        不该再冒出来）。角色自己发新帖不算我的通知。 */
  const [notices, setNotices] = useState<MomentNotice[]>([]);
  const [seenAt, setSeenAt] = useState("");
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void Promise.all([getMomentNotices(), getMomentsSeenAt()]).then(([list, seen]) => {
        if (!alive) return;
        setNotices(list);
        setSeenAt(seen);
      });
    };
    reload();
    window.addEventListener("moments-updated", reload);
    return () => {
      alive = false;
      window.removeEventListener("moments-updated", reload);
    };
  }, []);

  /* 未读那几条（新→旧，最多摆 3 条的量）：来的人得还在这页上，头像／名字才对得上。 */
  const shownConvIds = new Set(shown.map((s) => s.conv.id));
  const unseenNotices = notices
    .filter((n) => (!seenAt || n.createdAt > seenAt) && shownConvIds.has(n.convId))
    .slice(0, 3);

  /* 「自动生图」开着的时候，这一页不摆中间那一步：点「生成配图」直接跑。TA 发动态那一刻
     聊天那边通常已经画好了（见 ChatWindow），所以这里多半是「生成失败后重试」那条路。
     读盘之前先按预设值 true 走，跟 `DEFAULT_CHAT_PREFS` 一致。 */
  const [autoGen, setAutoGen] = useState(true);
  useEffect(() => {
    let alive = true;
    void getChatPrefs().then((p) => {
      if (alive) setAutoGen(p.autoGenerateImage);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 真花钱的那一下：跑图文接口 → 压图进仓库 → 引用串写回动态 → 广播让上层重读。
     四步都在 `generateMomentImage` 里（「自动生图」开着时聊天那边走的是同一支）；
     「正在画」的登记也归它管，所以这里不再自己记状态——离开页面再回来照样看得见。 */
  const runGenerate = async (item: FeedItem, prompt: string) => {
    /* 已经在画的（含 TA 在聊天那边顺手画的那趟）不给重复点，这钱不重复花。 */
    if (isMomentImageGenerating(item.conversationId, item.momentId)) return;
    try {
      await generateMomentImage(item.conversationId, item.momentId, prompt);
      window.dispatchEvent(new CustomEvent("moments-updated"));
    } catch {
      /* 生成失败不清空任何东西：那条动态的文字还在，按钮还在，可以再点一次。 */
      showToast("生成失败了，再试一次");
    }
  };

  /* 描述卡上点「生成配图」：改过就先写回那条动态，再花钱。 */
  const confirmEdit = async () => {
    if (!editor) return;
    const text = editor.text.trim();
    if (!text) {
      showToast("画面描述不能是空的");
      return;
    }
    const { item } = editor;
    setEditor(null);
    if (text !== (item.imagePrompt ?? "")) {
      await setMomentImagePrompt(item.conversationId, item.momentId, text);
      window.dispatchEvent(new CustomEvent("moments-updated"));
    }
    await runGenerate(item, text);
  };

  /* 标／取消标「重要」：写库 → 广播让上层重读（记忆页那边也跟着变星标）。 */
  const togglePin = async (item: FeedItem) => {
    const next = !item.pinnedByUser;
    await setMomentPinned(item.conversationId, item.momentId, next);
    window.dispatchEvent(new CustomEvent("moments-updated"));
    showToast(next ? "标为重要了，TA 会一直记着这条" : "已取消重要");
  };

  /* ── 互动（2026-10-05）：我手动点赞／评论／回复。
       写库之后要重读：TA 的动态发给上层重读会话（广播 `moments-updated`）；
       我自己的动态是本页一册，直接重读本册。 ── */
  const refreshAfterSocial = async (isSelf: boolean) => {
    if (isSelf) setSelfMoments(await getSelfMoments(maskId));
    else window.dispatchEvent(new CustomEvent("moments-updated"));
  };

  /* 删「我」的动态（2026-10-05）：先弹一句确认（见下面的 confirmDelete 弹层），
     确认后从这一册滤掉、重读——它的赞／评挂在这条上，跟着一起消失。 */
  const deleteMoment = async (item: FeedItem) => {
    await removeSelfMoment(maskId, item.momentId);
    setSelfMoments(await getSelfMoments(maskId));
    setConfirmDelete(null);
    showToast("已删除这条动态");
  };

  /* 点赞＝在这份「赞名单」里有我／没我：我在就撤掉，不在就顺手加上。
     角色自己赞的那一份将来也落在同一格，我这一下不碰它们。 */
  const toggleLike = async (item: FeedItem) => {
    const likes = item.likes ?? [];
    const mine = likes.some((l) => l.byId === MOMENT_SELF_ID);
    const next: MomentLike[] = mine
      ? likes.filter((l) => l.byId !== MOMENT_SELF_ID)
      : [
          ...likes,
          {
            byId: MOMENT_SELF_ID,
            byName: maskName,
            byAvatar: maskAvatar,
            at: new Date().toISOString(),
          },
        ];
    if (item.isSelf) await setSelfMomentLikes(maskId, item.momentId, next);
    else await setMomentLikes(item.conversationId, item.momentId, next);
    await refreshAfterSocial(!!item.isSelf);
  };

  /* 发一条评论：平铺（没有 replyToId）＋点名（mentions，嘴里照常写着 @名字）。
     `replyToId` 有值＝挂在那条评论底下，即「艾特出来的那一层」。 */
  const submitComment = async (
    item: FeedItem,
    content: string,
    mentions: string[],
    replyToId?: string,
  ) => {
    const text = content.trim();
    if (!text) return;
    const comment: MomentComment = {
      id: uuid(),
      byId: MOMENT_SELF_ID,
      byName: maskName,
      byAvatar: maskAvatar,
      content: text,
      at: new Date().toISOString(),
      ...(replyToId ? { replyToId } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    };
    const next = [...(item.comments ?? []), comment];
    if (item.isSelf) await setSelfMomentComments(maskId, item.momentId, next);
    else await setMomentComments(item.conversationId, item.momentId, next);
    await refreshAfterSocial(!!item.isSelf);
  };

  /* ── 发动态（2026-10-04）：**整页**的那份草稿（正文／配图／可见范围／提醒谁看）。null＝没开着。
        `images` 是相册选来的图的仓库引用串（2026-10-05 单图；2026-10-13 起最多 9 张）。
        `editId`（2026-10-13）：非空＝这是在**编辑**已发的那条（只改正文＋可见范围，
        标题「编辑动态」、按钮「保存」；配图那块编辑时不摊出来）。 ── */
  const [composerState, setComposer] = useState<{
    text: string;
    images: string[];
    imageText?: string;
    tags: string[];
    tagDraft: string;
    visibility: MomentVisibility;
    visibleTo: string[];
    visibleWorlds: string[];
    excludeTo: string[];
    excludeWorlds: string[];
    /** 「@ 提醒谁看」：发布时提醒看的角色 id（跟微信的「提醒谁看」一个意思）。 */
    remindTo: string[];
    editId?: string;
  } | null>(null);
  /* 整页发布／编辑：退场多留一会儿（.26s），让它缩下去的动效跑完再卸。 */
  const composerAlive = usePresence(composerState, 260);
  const composer = composerAlive.shown;

  /* 「配图」那枚按钮点开之后：先问图从哪来——`seals`＝四枚章的那面墙（相册／拍照／
     小手机相册／文字描述）；`text`＝写文字描述的子面板。null＝没开着。
     跟草稿同生共死：关弹层、发布完都收回。 */
  const [imgPick, setImgPick] = useState<null | "seals" | "text">(null);
  /* 文字描述的那份草稿（子面板里写的那段话）——确认了才落进 composer.imageText。 */
  const [textDraft, setTextDraft] = useState("");
  /* 发布中（开关开着时「文字描述」要先画真图、画完才落库）——挡住重复点。 */
  const [publishing, setPublishing] = useState(false);

  /* 选图那个藏起来的 `<input type="file">`（iOS 只认用户手势触发的 `.click()`）；
     `multiple` 可多选，一次最多 9 张。 */
  const composerInput = useRef<HTMLInputElement | null>(null);

  /** 还能再选几张：九宫格上限 9，扣掉已经选好的。 */
  const composerSlots = 9 - (composer?.images.length ?? 0);

  /* 选好图（可多张）：逐张压图进仓库 → 引用串并进草稿；选真图就把「文字当图」那份清掉。
     单张读不出来就跳过，不打断其余的。 */
  const addComposerImages = async (files: FileList | File[]) => {
    const room = Math.max(0, composerSlots);
    if (room === 0) {
      showToast("最多 9 张哦");
      return;
    }
    const list = Array.from(files).slice(0, room);
    if (list.length === 0) return;
    const added: string[] = [];
    for (const file of list) {
      const url = URL.createObjectURL(file);
      try {
        const stored = await persistImageAsset(url);
        if (stored) added.push(stored.ref);
      } catch {
        /* 单张失败就跳过 */
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (added.length === 0) {
      showToast("图没读进来，再试一次");
      return;
    }
    setComposer((c) =>
      c
        ? { ...c, images: [...c.images, ...added].slice(0, 9), imageText: undefined }
        : c,
    );
    setImgPick(null);
    setTextDraft("");
  };

  /* 「配图」→ 四枚章里挑来源。相册／拍照共用那个藏起来的 input（拍照临时挂 `capture`，
     走系统相册必须摘掉，不然 iOS 直接开相机把图库那一路砍掉）；小手机相册还没做，
     如实说一句；文字描述开子面板写。 */
  const pickComposerSource = (source: "device" | "camera" | "stellasei") => {
    if (source === "stellasei") {
      showToast("小手机相册还在做，先留个位置");
      return;
    }
    const el = composerInput.current;
    if (!el) return;
    if (source === "camera") el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  };

  /* 文字描述确认落成「这张图」：把已选的真图全回收掉（两边只能留一边）。 */
  const applyComposerText = () => {
    const t = textDraft.trim();
    if (!t) {
      showToast("写点画面描述再确认");
      return;
    }
    composer?.images.forEach((ref) => releaseImageAsset(ref));
    setComposer((c) => (c ? { ...c, images: [], imageText: t } : c));
    setImgPick(null);
    setTextDraft("");
  };

  /* 拿掉某一张配图（那张没人引用了就回收）。 */
  const removeComposerImageAt = (ref: string) => {
    releaseImageAsset(ref);
    setComposer((c) => (c ? { ...c, images: c.images.filter((x) => x !== ref) } : c));
  };

  /* 清空全部配图（文字当图也一并清）。 */
  const removeComposerImage = () => {
    composer?.images.forEach((ref) => releaseImageAsset(ref));
    setComposer((c) => (c ? { ...c, images: [], imageText: undefined } : c));
    setImgPick(null);
    setTextDraft("");
  };

  /* 关掉弹层：草稿里若选过图、又没发布，那些图没人引用——顺手回收掉。 */
  const closeComposer = () => {
    composer?.images.forEach((ref) => releaseImageAsset(ref));
    setComposer(null);
    setImgPick(null);
    setTextDraft("");
    setVisSheet(null);
  };

  /* 发布：正文与配图至少有一个才发（纯图、纯文字、图文都行）；落库之后重读这一册。
     带着「文字描述」时看动态设置里那枚「配图自动生成」——
     关着（默认）＝这段描述**就当这张图**（落 imageText，TA 认为它是一张图片）；
     开着＝先把描述交给生图接口画成真图（落 imageRef），画不成再退回文字当图。 */
  const publishSelf = async () => {
    if (!composer || publishing) return;
    const text = composer.text.trim();
    /* 手选的配图（可多张）；一张都没有时，才轮到「文字当图」那条路。 */
    const imageText0 = composer.images.length === 0 ? composer.imageText?.trim() : undefined;
    if (!text && composer.images.length === 0 && !imageText0) {
      showToast("写点什么或配张图再发");
      return;
    }
    const draft = composer;
    let finalImages = [...draft.images];
    let finalText = imageText0;
    setPublishing(true);
    try {
      if (finalImages.length === 0 && finalText) {
        const prefs = await getChatPrefs();
        if (prefs.autoGenerateMyMomentImage) {
          showToast("正在把这段描述画成图…");
          try {
            const bundle = await getApiBundle();
            /* 生图接口：动态设置里「配图接口」填了自定义就走它，没填就跟随主图文 API。
               自定义那套**只换地址／密钥／模型**，生图参数仍沿用主图文 API 的 extras
               （省得这一处再养一份画风／尺寸，恩熙定的：简单点）。 */
            const custom = prefs.myMomentImageApi;
            const api = custom?.baseUrl?.trim()
              ? {
                  ...bundle.image,
                  baseUrl: custom.baseUrl.trim(),
                  apiKey: custom.apiKey.trim(),
                  model: custom.model.trim(),
                  enabled: true,
                }
              : bundle.image;
            /* 我自己的配图不带参考图／人设（那不是角色锁脸那条路），只把描述当提示词。 */
            const res = await generateImage(api, finalText, bundle.imageExtras, bundle.text);
            const stored = await persistImageAsset(res.image);
            if (stored) {
              finalImages = [stored.ref];
              finalText = undefined;
            }
          } catch {
            /* 画不成：退回文字当图，别把发布打断。 */
            showToast("图没画成，先把这段描述当图带上");
          }
        }
      }
      const saved = await addSelfMoment(maskId, {
        content: text,
        images: finalImages,
        imageText: finalText,
        tags: draft.tags,
        visibility: draft.visibility,
        visibleTo: draft.visibleTo,
        visibleWorlds: draft.visibleWorlds,
        excludeTo: draft.excludeTo,
        excludeWorlds: draft.excludeWorlds,
        remindTo: draft.remindTo,
      });
      setSelfMoments(await getSelfMoments(maskId));
      setComposer(null);
      setImgPick(null);
      setTextDraft("");
      showToast("发出去了");
      /* 带真图：发布后异步让 TA 看一眼、写下「图里是什么」——失败静默，不影响这条动态。
         文字当图那条不用看图：那段描述本身就已经是 TA 眼里这张图的内容。 */
      if (finalImages.length > 0) void describeSelfMomentImage(maskId, saved.id, finalImages[0]);
    } catch {
      /* 落库没成：这趟新画的图没人引用，回收掉，不然仓库只进不出。 */
      if (draft.images.length === 0) finalImages.forEach((r) => releaseImageAsset(r));
      showToast("没发出去，再试一次");
    } finally {
      setPublishing(false);
    }
  };

  /** 待删的那条动态：非空＝删除确认弹层开着（只有「我发的」才可能被放进来）。 */
  const [confirmDeleteState, setConfirmDelete] = useState<FeedItem | null>(null);
  const confirmDeleteAlive = usePresence(confirmDeleteState, 240);
  const confirmDelete = confirmDeleteAlive.shown;

  /** 点了「⋯」的那条动态：非空＝「这条动态」底单开着（我发的→编辑／删除；别人的→标重要）。 */
  const [moreItemState, setMoreItem] = useState<FeedItem | null>(null);
  const moreItemAlive = usePresence(moreItemState, 240);
  const moreItem = moreItemAlive.shown;

  /* 点「⋯」底单里的「编辑」：把那条**已发**的动态摊进整页编辑器。
     正文取摊平后的 content；可见范围要回到原始那条 SelfMoment 取 id（FeedItem 只带人名，
     带不了 visibleTo／visibleWorlds）。配图／标签不进来——编辑页只改这两样。 */
  const openEditMoment = (item: FeedItem) => {
    const src = selfMoments.find((m) => m.id === item.momentId);
    setMoreItem(null);
    setComposer({
      text: item.content,
      images: [],
      tags: [],
      tagDraft: "",
      visibility: src?.visibility ?? "public",
      visibleTo: src?.visibleTo ?? [],
      visibleWorlds: src?.visibleWorlds ?? [],
      excludeTo: src?.excludeTo ?? [],
      excludeWorlds: src?.excludeWorlds ?? [],
      remindTo: [],
      editId: item.momentId,
    });
  };

  /* 编辑页点「保存」：写回正文＋可见范围 → 重读这一册 → 收页。 */
  const saveEditMoment = async () => {
    if (!composer?.editId) return;
    const text = composer.text.trim();
    const src = selfMoments.find((m) => m.id === composer.editId);
    if (!text && !src?.imageRef && !src?.imageText) {
      showToast("写点什么再保存");
      return;
    }
    await updateSelfMoment(maskId, composer.editId, {
      content: text,
      visibility: composer.visibility,
      visibleTo: composer.visibleTo,
      visibleWorlds: composer.visibleWorlds,
      excludeTo: composer.excludeTo,
      excludeWorlds: composer.excludeWorlds,
    });
    setSelfMoments(await getSelfMoments(maskId));
    setComposer(null);
    setImgPick(null);
    setTextDraft("");
    showToast("改好了");
  };

  /* ── 动态设置（2026-10-05）：动态页聚合了所有人，动态页里只留「我」发动态相关的配图设置。
        null＝弹层没开着。 ── */
  const [momentSetState, setMomentSet] = useState<{
    autoImg: boolean;
    /** 「配图自动生成」用的生图接口：null＝跟随主图文 API（这一处自己填的那套）。 */
    imgApi: { baseUrl: string; apiKey: string; model: string } | null;
  } | null>(null);
  const momentSetAlive = usePresence(momentSetState, 240);
  const momentSet = momentSetAlive.shown;

  /* 「配图接口」编辑态：只在弹层里活着，不入库。 */
  const [imgApiEdit, setImgApiEdit] = useState(false);
  const [imgApiDraft, setImgApiDraft] = useState({ baseUrl: "", apiKey: "", model: "" });
  /* 设置里已经建好的「图文预设」，开弹层时读一次给「配图接口」挑用（只读，不往回写）。 */
  const [imgPresets, setImgPresets] = useState<ApiPresetEntry[]>([]);

  const openMomentSet = async () => {
    const p = await getChatPrefs();
    setMomentSet({
      autoImg: p.autoGenerateMyMomentImage,
      imgApi: p.myMomentImageApi ?? null,
    });
    setImgApiEdit(false);
    setImgPresets(await getApiPresets("image"));
  };

  /* 「配图自动生成」：**我**发动态时用「文字描述」当配图，要不要交给生图接口真画一张。
     关（默认）＝不画不花钱，这段描述就当这张图；开＝自动画成真图再发。 */
  const toggleAutoMyMomentImage = () => {
    if (!momentSet) return;
    const autoImg = !momentSet.autoImg;
    setMomentSet({ ...momentSet, autoImg });
    void saveChatPrefs({ autoGenerateMyMomentImage: autoImg });
  };

  /* 存下「配图接口」自己那套（只换地址／密钥／模型；生图参数仍沿用主图文 API）。 */
  const saveImgApi = () => {
    if (!momentSet) return;
    const baseUrl = imgApiDraft.baseUrl.trim();
    if (!baseUrl) {
      showToast("填一下接口地址");
      return;
    }
    const next = {
      baseUrl,
      apiKey: imgApiDraft.apiKey.trim(),
      model: imgApiDraft.model.trim(),
    };
    setMomentSet({ ...momentSet, imgApi: next });
    void saveChatPrefs({ myMomentImageApi: next });
    setImgApiEdit(false);
    showToast("配图接口存下了");
  };

  /* 改回跟随主图文 API：把这一处自己那套清掉（清空即回落）。 */
  const resetImgApi = () => {
    if (!momentSet) return;
    setMomentSet({ ...momentSet, imgApi: null });
    void saveChatPrefs({ myMomentImageApi: undefined });
    setImgApiEdit(false);
    showToast("已改回跟随主图文 API");
  };

  /* 顶栏压在封面里时不显形（全透明、深梅色字），滚过封面下沿才落成实底墨字——见文件头 ②。
     只存一个布尔量：只在跨过那条线的那一帧重渲染一次，滚动途中不跟着抖。 */
  const [stuck, setStuck] = useState(false);
  const coverRef = useRef<HTMLDivElement | null>(null);

  /* ── 手势闸（只在动态页挂着）。
     iOS 会把**整个文档**当橡皮筋拖：手一往下拉，Safari 原生滚动 body——这条通路是
     留给键盘避让的（见 `globals.css` 里 `html/body` 那段，明令不许堵），而 `.phone-shell`
     在触屏下是 `position: static`、跟着 body 走 ⇒ **整个壳子平移**，页面上所有东西
     （封面、卡片、通知气泡）一起位移 = 她说的「通知跟着滑动跑」。
     ⚠︎ **第一版只掐了「起手落在滚动格外面」的手势，没用**——她滑的是信息流，手指
     就在滚动格里起手，那条手势被整条放行了；滚动格**滚到头**之后，iOS 会把这一手
     接着往上传（scroll chaining），文档照样被拖 = 气泡照样跟着走。
     所以第二版按**方向**判：滚动格**能往这个方向滚**才放行，**到头了就把手势掐掉**
     （到顶还往下拉／到底还往上推）。到头那一下本来也滚不动，掐掉不损失任何滚动，
     只是不让它去拖文档。这不是「越界拉回」的归零守卫（那条明令不许加，
     会跟 iOS 拉锯＝整页抬起＋闪烁），是**从头就不让这个手势生效**。
     ⚠︎ 必须 `passive: false`——React 的 `onTouchMove` 是被动监听，里面 `preventDefault` 无效。
     ⚠︎ 只在动态页挂载期间挂：聊天页有输入框，键盘避让那条通路一个字都不许碰。 */
  useEffect(() => {
    /* 起手点的纵坐标：拿它跟当前手指位置比，才知这一手是往下拉还是往上推。 */
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches.length > 0 ? e.touches[0].clientY : 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.target as Element | null;
      const box =
        t && typeof t.closest === "function"
          ? (t.closest("[data-mp-scroll]") as HTMLElement | null)
          : null;
      /* 起手落在滚动格外面的（顶栏、通知气泡本身）一律掐掉：那个手势没别的去处，
         只能去拖文档。 */
      if (!box) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      const y = e.touches.length > 0 ? e.touches[0].clientY : startY;
      const dy = y - startY; /* > 0＝手指往下拉 */
      const atTop = box.scrollTop <= 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      /* 到头那一手交出去＝整页橡皮筋；掐在手里才是「钉住」。 */
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        if (e.cancelable) e.preventDefault();
      }
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  /* ── 封面图。
        存的是 `media-store://` 引用串而不是图：图进独立仓库、设定里只留一句串，
        跟聊天图片同一条规矩（见 media-asset.ts 顶上那三条）。
        ⚠︎ 名字别跟上面那个 `coverRef` 撞——那个是封面这个 div 的 DOM 引用。 ── */
  const [coverAsset, setCoverAsset] = useState("");
  /* 引用串 → 能直接喂 `<img>` 的地址（老数据／缓存命中的同步就有，不会闪）。 */
  const coverSrc = useMediaSrc(coverAsset || undefined);
  /* 封面图在框里的**纵向位置**：0–100，50＝居中（`object-position` 的那个 Y%）。 */
  const [coverPos, setCoverPos] = useState(50);
  /* 选完图、还没按「就用这张」的**试穿态**（草稿 `.m-prev`）：`src` 是临时 object URL，
     还没落库；`pos` 是这一趟拖出来的纵向位置。一确认才压进仓库、写进设定。 */
  const [coverDraft, setCoverDraft] = useState<null | { src: string; pos: number }>(null);
  /* 试穿态那张图的原文件——确认时才真的落库。 */
  const coverDraftFile = useRef<File | null>(null);
  /* 拖动封面时记下的落点（按下时的 Y、起始 pos，以及这一趟拖出来的当前 pos）。 */
  const coverDrag = useRef<{ y: number; startPos: number; cur: number } | null>(null);
  /* 试穿态那张 `<img>`——拖动时不 setState，直接改它自己的 `object-position`。 */
  const coverImgRef = useRef<HTMLImageElement | null>(null);
  /* 选图那个 `<input type="file">`：iOS 上必须由用户手势触发 `.click()`，
     所以做成藏起来的 input ＋ 按钮去点它，而不是自己造选图界面。 */
  const coverInput = useRef<HTMLInputElement | null>(null);

  /* 点封面浮出来的那张选择单（手机相册／小手机的相册／取消）开没开。
     2026-10-13 恩熙：「点这个动态希望是有弹窗的，像浏览页面一样」——
     不再点一下直接开系统选图，先摊这张单子。 */
  const [coverSheetState, setCoverSheet] = useState(false);
  const coverSheetAlive = usePresence<true>(coverSheetState || null, 240);
  const coverSheetOpen = coverSheetAlive.shown !== null;

  /* 「谁可以看」那张底单（2026-10-13）：发布页那行「谁可以看」跟动态上那枚小爱心，
     点开都是这一张。`scope` 记是从哪儿开的——发布页里改的是草稿、改完就写回 composer；
     动态上改的是已发的那条、改一下立刻落库（跟微信一样）。
     `pane` 是这张单当前停在哪一页：`top`＝四档；`partial`／`exclude`＝进去勾世界／角色。
     ⚠︎ 工作副本（visibility 与四个名单）都摆在这儿，改动即时生效、即时回写。 */
  const [visSheetState, setVisSheet] = useState<null | {
    scope: "composer" | "moment";
    momentId: string;
    pane: "top" | "partial" | "exclude";
    visibility: MomentVisibility;
    visibleTo: string[];
    visibleWorlds: string[];
    excludeTo: string[];
    excludeWorlds: string[];
  }>(null);
  const visSheetAlive = usePresence(visSheetState, 240);
  const visSheet = visSheetAlive.shown;

  /* 「提醒谁看」那张底单（2026-10-13）：发布时勾几个角色，发出去就提醒他们来看
     （微信「提醒谁看」那个意思）。只做「记下来」，不硬造通知后端。 */
  const [remindSheetState, setRemindSheet] = useState(false);
  const remindSheetAlive = usePresence<true>(remindSheetState || null, 240);
  const remindSheetOpen = remindSheetAlive.shown !== null;

  /* 把这张单里的一处改动**落下去**：发布页写回草稿、动态上写回库；单子自己也跟着更新。 */
  const applyVis = (next: {
    visibility: MomentVisibility;
    visibleTo: string[];
    visibleWorlds: string[];
    excludeTo: string[];
    excludeWorlds: string[];
  }) => {
    setVisSheet((s) => (s ? { ...s, ...next } : s));
    if (visSheet?.scope === "composer") {
      setComposer((c) =>
        c
          ? {
              ...c,
              visibility: next.visibility,
              visibleTo: next.visibleTo,
              visibleWorlds: next.visibleWorlds,
              excludeTo: next.excludeTo,
              excludeWorlds: next.excludeWorlds,
            }
          : c,
      );
    } else if (visSheet?.scope === "moment") {
      void updateSelfMoment(maskId, visSheet.momentId, next).then(async () => {
        setSelfMoments(await getSelfMoments(maskId));
      });
    }
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([getMomentsCover(), getMomentsCoverPos()]).then(([ref, pos]) => {
      if (!alive) return;
      if (ref) setCoverAsset(ref);
      if (typeof pos === "number") setCoverPos(Math.max(0, Math.min(100, pos)));
    });
    return () => {
      alive = false;
    };
  }, []);

  /* **整页／居中浮层**开合上报给上一层：底部的四个 tab 按钮是 ChatApp 的兄弟节点，
     这一页里的浮层够不着它们——浮层一开就让上一层把 tab 收起来（视觉上就跟「盖住」一样）。
     组件卸载时也要收回，免得换页后 tab 还躲着。
     ⚠︎ 2026-10-13 恩熙：**从底部冒出来的单子一律不再收 tab**——底单就贴在 tab 栏
     上沿往外浮（这页 `overflow:hidden`、底边正好是 tab 顶边，天然裁得干净），
     取消时单子滑走、tab 自始至终没动过，不再「收掉又长回来」闪一下。
     所以这里只留**真·整页**（发布页）与**居中弹／看图**（它们要盖住整条屏幕、含 tab）：
     editor／moreItem／momentSet／visSheet／coverSheet／coverDraft／remindSheet 这些
     底单统统不在此列。
     ⚠︎ 发布页用 `composerState`（**原始开合**）而不是 `composer`（退场保留的那个）：
     整页往外滑的那 220ms 里 tab 就该回来了，滑开时底下正好接上，不再「滑完猛地补一下」。 */
  const anyOverlay =
    composerState !== null ||
    imgPick !== null ||
    viewer !== null ||
    confirmDelete !== null;
  /* 用 `useLayoutEffect` 而不是 `useEffect`：上报必须赶在**这一帧画出去之前**完成，
     让上一层在同一个提交里就把底 tab 收掉。否则晚一帧——第一帧先按「tab 还在、
     页面矮一截」画出去，第二帧页面才长高，贴着页底的那些浮层（尤是上滑的底单）
     会被带着整体往下顶一截，看着就是「弹窗先矮后高、闪一下」（1.12.83 修）。 */
  useLayoutEffect(() => {
    onOverlayChange(anyOverlay);
  }, [anyOverlay, onOverlayChange]);
  useEffect(() => () => onOverlayChange(false), [onOverlayChange]);

  /* 选好图那一下：**先试穿、不落库**——摊一条「重选／就用这张」的浮条，图上按住上下拖
     调位置（草稿 `.m-prev`）。按「就用这张」才压进仓库＋写进设定；「重选」再开系统选图。
     一来就落库的话，用户还没看清位置就把旧封面回收了，反悔都来不及。 */
  const startCoverDraft = (file: File) => {
    if (coverDraft) URL.revokeObjectURL(coverDraft.src);
    const url = URL.createObjectURL(file);
    coverDraftFile.current = file;
    setCoverDraft({ src: url, pos: coverPos });
  };

  /* 「就用这张」：压图进仓库 → 引用串＋位置写进设定 → **把旧封面回收掉**
     （旧图没人引用了，不回收仓库就成了只进不出）。整段都可能失败，
     失败就说实话，旧封面原样留着——绝不因为换封面把原来的弄丢。 */
  const confirmCoverDraft = async () => {
    const file = coverDraftFile.current;
    const draft = coverDraft;
    if (!file || !draft) return;
    const pos = draft.pos;
    try {
      const stored = await persistImageAsset(draft.src);
      if (!stored) {
        showToast("这张图读不出来，换一张试试");
        return;
      }
      const previous = coverAsset;
      setCoverAsset(stored.ref);
      setCoverPos(pos);
      await saveMomentsCover(stored.ref);
      await saveMomentsCoverPos(pos);
      if (previous && previous !== stored.ref) releaseImageAsset(previous);
      showToast("封面换好了");
    } catch {
      showToast("封面没存进去，再试一次");
    } finally {
      URL.revokeObjectURL(draft.src);
      coverDraftFile.current = null;
      setCoverDraft(null);
    }
  };

  /* 试穿态里按住封面上下拖＝挪图在框里的位置：手指往下走＝图往下走
     （`object-position` 的 Y% 要**减**才让画面跟着手往下）。
     ⚠️ 拖动中**不 setState**——每帧 setState 会把整页重渲染一遍，手机端就卡了。
     拖的时候只直接改那张图自己的 `object-position`（一次 style 写入，极便宜），
     松手那一刻才把最终值落回 state。 */
  const onCoverPointerDown = (e: ReactPointerEvent) => {
    if (!coverDraft) return;
    coverDrag.current = { y: e.clientY, startPos: coverDraft.pos, cur: coverDraft.pos };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onCoverPointerMove = (e: ReactPointerEvent) => {
    const d = coverDrag.current;
    if (!coverDraft || !d) return;
    const h = coverRef.current?.offsetHeight || 272;
    const dy = e.clientY - d.y;
    const next = Math.max(0, Math.min(100, d.startPos - (dy / h) * 100));
    d.cur = next;
    if (coverImgRef.current) coverImgRef.current.style.objectPosition = `center ${next}%`;
  };
  const endCoverDrag = () => {
    const d = coverDrag.current;
    coverDrag.current = null;
    if (!d) return;
    /* 只在真拖出变化时才落值——纯点一下（没动）不进 state，免得白重渲染一次。 */
    if (d.cur !== d.startPos) setCoverDraft((c) => (c ? { ...c, pos: d.cur } : c));
  };

  /* 还原成默认那面马卡龙渐变。一旦能换就得能换回来，不然封面是条单行道。 */
  const clearCover = async () => {
    const previous = coverAsset;
    setCoverAsset("");
    setCoverPos(50);
    await saveMomentsCover("");
    await saveMomentsCoverPos(50);
    releaseImageAsset(previous);
    showToast("封面还原了");
  };

  /* 选择单里点「手机相册」：**单子不收**，直接开系统选图（iOS 要用户手势那一下）。
     2026-10-13 恩熙：单子要一直留着，等真选好、按确定回来才收——中途取消回来，
     单子还在原地，不用重新点一次封面。回收单子挪进 input 的 onChange（拿到图才收）。
     「重选」按钮也走这条：那会儿单子本就没开，点了只当「再开一次系统选图」。 */
  const pickCoverFromDevice = () => {
    coverInput.current?.click();
  };

  /* 气泡上那一行字：多条用一个**罩得住「赞了／评论了」两种事**的泛词
     （中文里最不别扭的就是「新消息」），单条才说具体的事。 */
  const noticeLead = unseenNotices[0];
  const noticeLine = !noticeLead
    ? ""
    : unseenNotices.length > 1
      ? `${noticeLead.fromName} 等 ${unseenNotices.length} 条新消息`
      : noticeLead.kind === "like"
        ? `${noticeLead.fromName} 赞了你`
        : `${noticeLead.fromName} 评论了你`;

  /* 发布／编辑页顶栏那枚主按钮亮不亮（草稿 `.m-post-ok` / `.off`）：
     编辑时总能存（可能只改可见范围）；新发时正文与配图至少有一个。 */
  const canSubmitComposer = composer
    ? composer.editId
      ? true
      : Boolean(composer.text.trim() || composer.images.length > 0 || composer.imageText?.trim())
    : false;

  const coverShownSrc = coverDraft ? coverDraft.src : coverSrc;
  const coverShownPos = coverDraft ? coverDraft.pos : coverPos;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        /* 页底是「透粉的白」（跟聊天同一块板）：卡片浮在它上面 */
        background: C.paper,
        overflow: "hidden",
        fontFamily: SANS,
        color: C.ink,
      }}
    >
      <style>{`
        .mp-act { transition: opacity .16s ease; }
        .mp-act:active { opacity: .45; }
        /* 名录式的条目分隔（2026-10-13 换皮）：条与条之间只压一条
           **两端缩进的发丝线**——内联样式写不了伪元素，落在样式块里。 */
        .mp-feed > article + article::before {
          content: ''; position: absolute; top: 0; left: 4px; right: 4px;
          height: 1px; background: ${C.line2};
        }
        /* 底单（换封面 / 这条动态）里项与项之间一条**从图标右侧起**的发丝线
           （草稿 .m-sh-item + .m-sh-item::before）。内联样式写不了伪元素，落这儿。 */
        .mp-sh-item + .mp-sh-item::before {
          content: ''; position: absolute; top: 0; left: 56px; right: 2px;
          height: 1px; background: ${C.line2};
        }
        /* 「配图」那四枚章（相册／拍照／小手机相册／文字描述）。
           ⚠️ 章的底与边**必须写在样式表里、不能写内联**：内联样式永远压过样式表，
           写内联的话下面「按下」那条规则一辈子不生效（聊天加号面板踩过同一个坑）。
           蓝纸墨的语言：白面／雾蓝图标；按下整枚翻蓝、图标转纸白。 */
        .mp-seal .mp-seal-face {
          width: 46px;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid rgba(90,115,145,.24);
          color: #5A7391;
          background: #FFF;
          box-shadow: 0 6px 14px -10px rgba(20,19,24,.4);
          transition: background .16s ease, border-color .16s ease, color .16s ease;
        }
        /* 枚本身不再走 .mp-act 那层淡出——它翻蓝，不需要再叠一层透明度。 */
        .mp-seal:active { opacity: 1; }
        /* 按下去那一瞬：整枚翻成蓝底、边收掉、图标转纸白（图标走 currentColor，跟着变）。 */
        .mp-seal:active .mp-seal-face {
          border-color: transparent;
          color: #FFFDF8;
          background: linear-gradient(180deg, #6B84A3 0%, #46617F 100%);
        }
        /* ── 浮层「进退场」（2026-10-13）：只走 opacity 与 transform（GPU 合成，不碰
           布局），曲线照草稿的背板与底单。进场用 backwards 让首帧就落在起点、
           不闪一下；退场用 forwards 停在末帧，等节点真卸掉再收。
           本段是模板字符串，注释里不能出现反引号。 ── */
        @keyframes mpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mpFadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes mpSheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes mpSheetDown { from { transform: translateY(0) } to { transform: translateY(100%) } }
        @keyframes mpPopIn { from { opacity: 0; transform: scale(.94) } to { opacity: 1; transform: scale(1) } }
        @keyframes mpPopOut { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(.96) } }
        /* 整页发布页（草稿 .m-post 同款）：**整面从屏幕底升上来／再整面落回去**
           （2026-10-13 恩熙：要像微信那样「从下面长出来、取消时往下收走」，
           不再只是往上飘 16px + 淡入）。只走位移、**不带 opacity**——免得半透明时
           透出底下的动态页。全局只有发布页用这一对。 */
        @keyframes mpPageIn { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes mpPageOut { from { transform: translateY(0) } to { transform: translateY(100%) } }
        .mp-bd-in { animation: mpFadeIn .22s ease backwards; }
        .mp-bd-out { animation: mpFadeOut .18s ease forwards; }
        .mp-sh-in { animation: mpSheetUp .32s cubic-bezier(.2,.85,.25,1) backwards; }
        .mp-sh-out { animation: mpSheetDown .22s cubic-bezier(.4,0,1,1) forwards; }
        .mp-pop-in { animation: mpPopIn .22s cubic-bezier(.2,.85,.25,1) backwards; }
        .mp-pop-out { animation: mpPopOut .16s ease forwards; }
        .mp-page-in { animation: mpPageIn .32s cubic-bezier(.2,.85,.25,1) backwards; }
        .mp-page-out { animation: mpPageOut .22s cubic-bezier(.4,0,1,1) forwards; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .mp-act { transition: none }
          .mp-seal .mp-seal-face { transition: none }
          .mp-bd-in, .mp-bd-out, .mp-sh-in, .mp-sh-out,
          .mp-pop-in, .mp-pop-out, .mp-page-in, .mp-page-out { animation: none }
        }
      `}</style>

      {/* 整页一起滚：封面 → 一条条动态。
          `data-mp-scroll` 是给上面那枚「手势闸」认的标记：**从这一格里起手、且这一格
          还滚得动的手势照放**（页内滚动全靠它）；**到头那一手（到顶还往下拉／到底还往上推）
          与起手落在它外面的（顶栏、通知气泡）一律掐掉**——那两种手势 iOS 都会拿去拖文档
          （橡皮筋／scroll chaining），壳子跟着走、页面上所有东西一起位移。 */}
      <div
        data-mp-scroll="1"
        onScroll={(e) => {
          /* 滚过封面下沿（减掉顶栏那点高度）→ 顶栏落成实底。同一个值重复塞进去
             不会重渲染，所以滚动途中不会跟着抖。 */
          const coverH = coverRef.current?.offsetHeight ?? 0;
          setStuck(e.currentTarget.scrollTop > Math.max(0, coverH - 64));
        }}
        style={{
          /* `relative` 是**气泡的锚**：气泡挂在滚动格里面，才能跟着封面一起滚
             （见下面「动态通知气泡」那段注释）。 */
          position: "relative",
          width: "100%",
          height: "100%",
          overflowY: "auto",
          overscrollBehavior: "none",
          /* 2026-10-13 恩熙：「照草稿」——草稿的滚动格是**干净一张暖白纸**：
             `.m-scroll` 不铺任何底色，整片露出页底 `--paper(#FAF9F6)`。
             原先我在这儿铺了一层「整页蓝雾」（0→640px 的淡蓝渐变），它把封面
             以下整片都染成了蓝——名册、名字、留言区全发蓝，看着就不像纸。
             **撤掉这层雾**：封面下沿仍靠封面**自己**那段化白渐变化进纸色，不留硬边。 */
          backgroundColor: C.paper,
        }}
      >
        {/* ── 封面＝**通铺整宽的真封面**。
               **「卡片」不是指「方角＋细线」，是指「摆在页面上的一块」**。
               只要它有左右边距、四个圆角、一圈投影，它就是「浮在页上的一张卡」——
               圆角气泡也是卡。封面要的是「封面**的样子**」：**通铺整宽、从屏幕最顶端压下来的
               一整面**。
               所以：左右边距 12px 全撤、四角归零、三道白内边与那道深投影全撤
               （不浮了，它就是从顶上压下来的一整面），高度把安全区＋状态栏一并吃进来，
               从 y=0 起，连状态栏那块也是封面。
               底边**不留缝**：最底一截**化满成一整片纸色** `rgba(250,249,246,1)`——
              封面下面就是滚动格的 `C.paper`，两边颜色**一模一样**才是「化开」，
              不是「切一刀」。
              ⚠️ 2026-10-13 修：这里原先是 `rgba(250,249,246,.94)`，94% 没化满，
              于是封面下沿那道边**没化干净**，真机上留了一条淡淡的横线（恩熙：
              「自然一点」）。页底那层蓝雾早撤了，下沿外一像素就是纯纸色，
              所以这里必须给到 `1`。 ── */}
        <div
          ref={coverRef}
          style={{
            position: "relative",
            /* 从**屏幕最顶端**起（`0`），安全区与状态栏的高度改由 `height` 吃进来——
               封面的样子就是「顶到天上去」。 */
            margin: 0,
            /* 封面高度 `232px` → `272px`（+40）：一步给足 40px。 */
            height: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 272px)",
            /* 通铺＝没有圆角（颗粒 svg 同步 0）。 */
            borderRadius: 0,
            background:
              /* 草稿封面同款叠法（**上深下浅**）：
                 ① 顶上压暗 `rgba(20,19,24,.52)→.10@20%→0@38%`——顶上那两行白字与两枚白描线图标
                    要靠这层暗才浮得住（照片/底色一旦偏亮，白字就没了）；
                 ② 底下化进页底：到 70% 起往纸色 `rgba(250,249,246,.94)` 化，
                    「封面到哪儿为止」是**化开**的，不是切一刀；
                 ③ 一抹柔光把暮蓝底子撑出层次。
                 底子从**暮蓝深色**调浅成**清晨天光**那种浅蓝灰（2026-10-13 恩熙：
                 「封面这个颜色调浅一点，自然一点」）：底色一浅，顶上白字就靠①那层
                 压暗＋字上的投影一起托住（压暗因此从 .52 收到 .40）。 */
              "linear-gradient(180deg, rgba(20,19,24,.40) 0%, rgba(20,19,24,.08) 20%, rgba(20,19,24,0) 40%)," +
              "linear-gradient(to bottom, rgba(250,249,246,0) 70%, rgba(250,249,246,1) 100%)," +
              "radial-gradient(150% 110% at 82% 4%, rgba(255,255,255,.45) 0%, rgba(255,255,255,0) 58%)," +
              "linear-gradient(162deg,#AABECF 0%,#C3D0DC 48%,#DFE6EC 100%)",
            /* 通铺的一整面**不再「浮起来」**：三道白内边与那道深投影全撤。 */
            boxShadow: "none",
            /* 注意：**不能** `overflow: hidden`——下面那块身份区要**跨出封面下沿**去
               （头像一半在封面里、一半在封面外）。颗粒 svg 是 `inset: 0` 正正好一块，
               本来也不溢出，剪不剪都一样。 */
            overflow: "visible",
            /* 试穿态里封面要接住上下拖（拖动不该把页面带着一起滚）。 */
            touchAction: coverDraft ? "none" : undefined,
          }}
          /* 2026-10-13：**整面封面就是那枚「换封面」按钮**——点封面上任意一处，
             先浮出那张选择单（手机相册／小手机的相册／取消，草稿 `.m-sheet` 同款）。
             真挑图那一下挪进选择单里（选「手机相册」才开系统选图）。
             ⚠️ 试穿态（`coverDraft`）里这一下不弹单——那会儿整面是拖图的手感区。 */
          onClick={() => {
            if (coverDraft) return;
            setCoverSheet(true);
          }}
          onPointerDown={onCoverPointerDown}
          onPointerMove={onCoverPointerMove}
          onPointerUp={endCoverDrag}
          onPointerCancel={endCoverDrag}
          onPointerLeave={endCoverDrag}
        >
          {/* 换过封面就走真照片：图**铺满整面**（`object-fit: cover`），
              上面压两层（跟默认底同一套「上深下浅」）——
              ① 顶上压暗 `rgba(20,19,24,.52)→.10@20%→0@38%`：封面里的两行白字与白描线图标
                 全靠这层暗浮住，照片再亮也读得清；
              ② 底下化进页底：用的是跟默认渐变**同一枚**纸色，
                 「封面到哪儿为止」是**化开**的，不会忽然切一刀。 ── */}
          {coverShownSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={coverImgRef}
                src={coverShownSrc}
                alt=""
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  /* 上下拖调的就是这一句：0＝露图顶、50＝居中、100＝露图底。 */
                  objectPosition: `center ${coverShownPos}%`,
                }}
              />
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(20,19,24,.52) 0%, rgba(20,19,24,.10) 20%, rgba(20,19,24,0) 38%)," +
                    "linear-gradient(to bottom, rgba(250,249,246,0) 70%, rgba(250,249,246,1) 100%)",
                }}
              />
            </>
          ) : null}

          {/* 颗粒：一层 feTurbulence 噪点铺满整面（中性灰、soft-light 混色、很淡）。
              比撒一百颗星都有用。圆角跟着封面走
              （通铺＝0），不然噪点会从四个角漏出去。 */}
          <svg
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              borderRadius: 0,
              opacity: 0.22,
              mixBlendMode: "soft-light",
            }}
          >
            <filter id="mp-cover-grain">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#mp-cover-grain)" />
          </svg>

          {/* 试穿态的**虚线框**（草稿 `.scr.previewing`）：提示「这一块就是你正在摆的封面」。
              纯视觉，`pointer-events: none` 免得挡了拖图那一下。 */}
          {coverDraft ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 4,
                pointerEvents: "none",
                border: `1.5px dashed ${C.accent}`,
                opacity: 0.5,
              }}
            />
          ) : null}

          {/* ── 我是谁：草稿身份块同款——**名字在左、头像在右，并作一行**。
                 整块贴封面右下、骑在封面下沿上：`top: calc(100% - 28px)` 让 56px 的头像
                 **嵌进封面 28px、露在外面 28px**（一半里一半外的那枚印）。
                 ⚠︎ 头像往上坐，下面的签名也跟着上移，信息流顶部留白由 `.mp-feed` 的
                 `64px` 补回来（2026-10-13 照草稿，原 `108`）。
                 名字与签名落在封面**外**的雾白页底上，墨色压得住。 ── */}
          <div
            style={{
              position: "absolute",
              top: "calc(100% - 28px)",
              right: 24,
              zIndex: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
            }}
            /* 身份块骑在封面上：点它别冒泡到封面那枚「换封面」手势上去。 */
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 14,
              }}
            >
              <div
                style={{
                  maxWidth: 200,
                  fontSize: 18,
                  fontWeight: 600,
                  fontFamily: SERIF,
                  letterSpacing: ".1em",
                  color: C.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {maskName}
              </div>
              <div
                style={{
                  flex: "none",
                  width: 56,
                  height: 56,
                  /* 草稿同款：白底、圆角 16，无描边，用一圈极淡的影子把头像从雾里托出来。
                     无头像时首字宋体雾蓝。 */
                  borderRadius: 16,
                  background: "#FFF",
                  color: C.accent,
                  fontFamily: SERIF,
                  boxShadow:
                    "0 10px 26px -12px rgba(58,65,73,.55), 0 0 0 1px rgba(58,65,73,.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 600,
                  overflow: "hidden",
                }}
              >
                {maskAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={maskAvatar}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  maskName.charAt(0)
                )}
              </div>
            </div>

            {signature.trim() ? (
              <div
                style={{
                  marginTop: 8,
                  maxWidth: 220,
                  maxHeight: 18,
                  overflow: "hidden",
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  letterSpacing: ".02em",
                  color: C.ink2,
                  textAlign: "right",
                }}
              >
                {signature.trim()}
              </div>
            ) : null}
          </div>

        </div>

        {/* 藏起来的 `<input type="file">`（iOS 只认用户手势触发的 `.click()`）：
            点封面 → 选择单 → 选「手机相册」才去点它。选完压图进仓库、引用串写进设定。
            「还原」（＝恢复默认）已挪进选择单标题行右端（2026-10-13）。
            ⚠️ 必须**挂在封面容器之外**（兄弟节点）：它 `.click()` 那一下会沿 DOM 冒泡，
            若仍留在封面里面，会再次触发封面 onClick→又弹出选择单，
            用户得再点一次「取消」才能拖图；挪到外面，选完图立刻就能挪。 */}
        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            /* 选完立刻清空：同一张图连选两次也得能触发 onChange。 */
            e.target.value = "";
            /* 2026-10-13 恩熙：**「手机相册」那张单一直留着**，直到这里真拿到图
               ——才发现图、才收单、才进试穿。取消回来（file 为空）什么都不做，
               单子原样开着。 */
            if (file) {
              setCoverSheet(false);
              startCoverDraft(file);
            }
          }}
        />

        {/* ── 信息流：**一条一张方卡**（每一条＝**一张白纸方卡**，深色细线框住）。
               ① 「第一则跟第二则怎么分清」靠**卡自己那条边**——不用页上的栏线；
               ② 一页扫下去是**一个一个**，不是一片——就是那种「游戏选择页面」的
                  「每块都被安排过」的排法；
               ③ 形状变了，逻辑没变。
               条目间距 22px：卡自带边界，不用再靠大留白硬撑。
               顶部留白固定 `108／112`：只让开封面下沿那枚骑边头像
               与它下面那列名字／签名。上面那枚通知气泡已经**钉在视口上、
               不在流里**，不占高度，所以这里**不再给它另留**——
               第一张卡永远落在封面下 `108／112`，位置不随有没有通知变。 ── */}
        {feed.length === 0 ? (
          <div
            style={{
              padding: "64px 24px 64px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 500, fontFamily: SERIF,
                           color: C.ink2, letterSpacing: ".1em" }}>
              暂时没有动态
            </span>
            <span style={{ fontSize: 11.5, color: C.ink3, letterSpacing: ".04em" }}>
              TA 发动态了会出现在这儿
            </span>
          </div>
        ) : (
          <div
            className="mp-feed"
            style={{
              /* 2026-10-13 照草稿：顶部留白 `108 → 64`（草稿 `.m-top` 下沿留 58 ＋
                 `.c-body` 上留 6），正好让开封面下沿那枚骑边头像与它下面的名字／签名；
                 左右 20px 交给条目自己的 `4px` 内边，条目内容线落在离屏 24px 处。 */
              padding: "64px 20px calc(var(--safe-area-bottom, 0px) + 34px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {feed.map((item) => (
              <MomentItem
                key={item.uid}
                item={item}
                generating={isMomentImageGenerating(item.conversationId, item.momentId)}
                onOpenImage={(src, ref) => setViewer({ src, ref })}
                onEditPrompt={(target) => {
                  /* 自动生图开着 → 直接画；关着 → 先摊描述卡看／改（看得见、改得动，确认了才花钱）。
                     长按已有的那张图走的是同一条路。 */
                  if (autoGen) void runGenerate(target, target.imagePrompt ?? "");
                  else setEditor({ item: target, text: target.imagePrompt ?? "" });
                }}
                friends={friends}
                onMore={(target) => setMoreItem(target)}
                onOpenVis={(target) =>
                  setVisSheet({
                    scope: "moment",
                    momentId: target.momentId,
                    pane: "top",
                    visibility: target.visibility ?? "public",
                    visibleTo: [...(target.visibleTo ?? [])],
                    visibleWorlds: [...(target.visibleWorlds ?? [])],
                    excludeTo: [...(target.excludeTo ?? [])],
                    excludeWorlds: [...(target.excludeWorlds ?? [])],
                  })
                }
                onToggleLike={(target) => void toggleLike(target)}
                onSubmitComment={(target, text, mentions, replyToId) =>
                  void submitComment(target, text, mentions, replyToId)
                }
              />
            ))}
          </div>
        )}

      {/* ── 动态通知气泡：头像 ＋ 一行字 ＋ `›` 的玻璃胶囊。
             **只收「角色对我做的事」**——角色赞／评论／回复我的动态时，往
             `moments-notice.ts` 推一条，这里读出来（见上面那段注释）。
             位置的口径：**它属于封面那一块**——挂在滚动格里面、`top` 钉死在封面下沿
             （封面高 `272`）再往下一点，往下滑就跟封面一起滚走。
             ⚠️ **别改 `fixed`**（1.3.75 试过，更糟）：真机上 iOS 会把整个壳子连文档一起拖
             （键盘避让那条通路 ＋ 顶页橡皮筋），`fixed` 相对**视口**、壳子一挪它就脱开页面
             ⇒ 相对页面看反而更飘。治「整页被拖走」的是滚动格那枚**手势闸**。
             ⚠️ 它在流外、**不占高度**：信息流顶部留白仍按 `108／112` 给，第一张卡一开始
             就落在它斜下方。
             ⚠️ 靠**左**摆（`left: 18`）：封面下沿右侧是右对齐的那一列名字／签名，气泡贴左
             才跟骑边头像同一行、谁也不压谁。
             材质：玻璃的**薄纱档**——薄雾白底 ＋ 中小半径模糊（**别照抄底栏那 20px**，
             会把上方紧邻的封面化白吸进来）；`WebkitBackdropFilter` 必须同值。 */}
      {unseenNotices.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 18,
            top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 272px + 6px)",
            zIndex: 2,
            maxWidth: "calc(100% - 36px)",
          }}
        >
          <button
            type="button"
            className="mp-act"
            onClick={() => {
              /* 点开＝认下这几条：记下「看过了」，气泡随即收起。
                 真正的「全部通知栏」与点击跳转留到后面那步再开入口。 */
              const now = new Date().toISOString();
              setSeenAt(now);
              void setMomentsSeenAt(now);
              showToast("通知详情还在做");
            }}
            style={{
              ...COVER_PILL,
              maxWidth: "100%",
              gap: 8,
              padding: "7px 12px 7px 7px",
              background:
                "linear-gradient(152deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,.14) 26%, rgba(255,255,255,.08) 48%, rgba(255,255,255,.34) 76%, rgba(255,255,255,.18) 100%)",
              backdropFilter: "blur(16px) saturate(2) brightness(1.04)",
              WebkitBackdropFilter: "blur(16px) saturate(2) brightness(1.04)",
              border: "1px solid rgba(255,255,255,.85)",
              color: COVER_INK,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.35), 0 0 0 .5px rgba(255,255,255,.6), 0 0 0 1px rgba(58,65,73,.04), 0 14px 26px -18px rgba(58,65,73,.4), 0 0 22px rgba(255,255,255,.55)",
            }}
          >
            {noticeLead.fromAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={noticeLead.fromAvatar}
                alt=""
                style={{ flex: "none", width: 26, height: 26, borderRadius: 999, objectFit: "cover" }}
              />
            ) : (
              <span
                style={{
                  flex: "none",
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: "#FFF",
                  color: C.accent,
                  fontFamily: SERIF,
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {noticeLead.fromName.slice(0, 1)}
              </span>
            )}
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: SERIF,
                fontWeight: 500,
                fontSize: 13,
                letterSpacing: ".01em",
              }}
            >
              {noticeLine}
            </span>
            <ChevronRight size={15} strokeWidth={1.9} style={{ flex: "none", opacity: 0.45 }} />
          </button>
        </div>
      ) : null}
      </div>

      {/* ── 顶栏：草稿同款「**居中刊头**」——中文大字居中、斜体英文小字在下；
             右上一枚**纯白描线**设置图标（无边框无底色，压在封面上，靠一层投影浮住）。
             压在封面里时全透明、字与图标走白；滚过封面下沿才落成一层纸色实底＋墨字墨图标
             ＋一条发丝线（草稿「雾蓝纸墨」同一套）。只有 `stuck` 翻面那一帧才重画，
             滚动途中不跟着抖。 ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 7,
          height: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 58px)",
          paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px))",
          paddingLeft: 26,
          paddingRight: 26,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: stuck ? "rgba(250,249,246,.9)" : "transparent",
          backdropFilter: stuck ? "blur(14px)" : "none",
          WebkitBackdropFilter: stuck ? "blur(14px)" : "none",
          borderBottom: `1px solid ${stuck ? C.line : "transparent"}`,
          /* 吸顶过渡放缓：纸底先落稳托住字，底下那两行标题与钮的颜色慢半拍（.08s）
             再缓缓转墨——两拍走，不像开关。 */
          transition:
            "background .32s cubic-bezier(.4,.2,.2,1), border-color .32s cubic-bezier(.4,.2,.2,1)",
        }}
      >
        {/* ── 刊头：中文在上、斜体英文小字在下，两行**居中**（草稿 `.c-title` 排法）。
              压在封面上时两行走白＋一层暗投影顶住（封面顶上已经压暗，白字浮得住）；
              吸顶后转墨、投影撤掉。 ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              fontFamily: SERIF,
              letterSpacing: ".2em",
              paddingLeft: ".2em",
              lineHeight: 1,
              color: stuck ? C.ink : "#fff",
              textShadow: stuck ? "none" : "0 1px 10px rgba(20,19,24,.55)",
              transition: "color .5s ease .08s",
              whiteSpace: "nowrap",
            }}
          >
            动态
          </div>
          <div
            style={{
              paddingTop: 2,
              fontSize: 12.5,
              fontFamily: SERIF,
              fontStyle: "italic",
              letterSpacing: ".12em",
              textIndent: ".12em",
              lineHeight: 1.2,
              color: stuck ? C.ink3 : "rgba(255,255,255,.72)",
              transition: "color .5s ease .08s",
              whiteSpace: "nowrap",
            }}
          >
            Moments
          </div>
        </div>

        {/* 发动态的入口在右下角那枚浮圆钮，顶栏只留动态设置一枚。
            形制照草稿：**26px 纯描线滑杆图标**（无框无底），压封面时走白＋一层 drop-shadow，
            吸顶后转墨、阴影撤掉。垂直对齐到刊头那一行（内容区 58px 的正中）。 */}
        <button
          type="button"
          className="mp-act"
          onClick={() => void openMomentSet()}
          aria-label="动态设置"
          style={{
            position: "absolute",
            right: 24,
            top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 29px)",
            transform: "translateY(-50%)",
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            border: "none",
            background: "transparent",
            color: stuck ? C.ink : "#fff",
            filter: stuck ? "none" : "drop-shadow(0 1px 5px rgba(20,19,24,.55))",
            transition: "color .5s ease .08s, filter .5s ease .08s",
            cursor: "pointer",
          }}
        >
          <SlidersVertical size={21} strokeWidth={1.6} />
        </button>
      </div>

      {/* 发动态：右下角浮一枚圆钮（2026-10-13 从顶栏胶囊挪来，草稿上定稿的形制）——
          正圆 44、磨砂玻璃底（淡粉半透 ＋ blur，透得出背后的纸）、一圈白描边加顶棱白光、
          粉描线「＋」。架在安全区上方，拇指一伸就到；发布弹层（z 80）与看图（z 70）
          都盖得住它，浮钮自己只压内容（z 5）。
          `translateZ(0)`：iOS 上 backdrop-filter 要元素进了独立合成层才执行。
          ⚠️ 试穿封面时不露面：那会儿整面封面在等你拖，右下这枚「＋」该让位。 */}
      {coverDraft ? null : (
      <button
        type="button"
        className="mp-act"
        onClick={() =>
          setComposer({ text: "", images: [], tags: [], tagDraft: "", visibility: "public", visibleTo: [], visibleWorlds: [], excludeTo: [], excludeWorlds: [], remindTo: [] })
        }
        aria-label="发动态"
        style={{
          position: "absolute",
          right: 20,
          bottom: "calc(var(--safe-area-bottom, 0px) + 22px)",
          zIndex: 5,
          width: 44,
          height: 44,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(214,226,240,.5)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,.7)",
          boxShadow:
            "0 10px 22px -12px rgba(58,65,73,.55), inset 0 1px 0 rgba(255,255,255,.9)",
          color: C.accent,
          transform: "translateZ(0)",
          cursor: "pointer",
        }}
      >
        <Plus size={19} strokeWidth={1.9} />
      </button>
      )}

      {/* ── 封面试穿浮条（草稿 `.m-prev`）：选完图先试穿——一行提示 ＋ 「重选／就用这张」。 */}
      {coverDraft ? (
        <div
          className="mp-sh-in"
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: "calc(var(--safe-area-bottom, 0px) + 20px)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px 10px 14px",
            borderRadius: 16,
            background: "rgba(250,249,246,.96)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 14px 34px -16px rgba(20,19,24,.6)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, letterSpacing: ".04em", color: C.ink2 }}>
            封面预览 · 按住封面上下拖，调位置
          </span>
          <button
            type="button"
            className="mp-act"
            onClick={pickCoverFromDevice}
            style={{
              flex: "none", height: 34, padding: "0 15px", borderRadius: 999,
              border: "none", background: C.accentSoft, color: C.accent,
              fontFamily: SANS, fontSize: 12.5, letterSpacing: ".1em", cursor: "pointer",
            }}
          >
            重选
          </button>
          <button
            type="button"
            className="mp-act"
            onClick={() => void confirmCoverDraft()}
            style={{
              flex: "none", height: 34, padding: "0 15px", borderRadius: 999,
              border: "none", background: C.accent, color: "#FFFFFF",
              fontFamily: SANS, fontSize: 12.5, letterSpacing: ".1em", cursor: "pointer",
            }}
          >
            就用这张
          </button>
        </div>
      ) : null}

      {/* ── 换封面选择单（2026-10-13）：点封面 → 从屏幕底浮出这张单
             （草稿 `.m-sheet`）。不再点一下直接开系统选图，「手机相册」才去开；
             「小手机的相册」先留位置（灰着 ＋ 一枚「预留」小药丸）。
             标题行右端那枚「恢复默认」（RotateCcw）只在**换过封面**时才露面——
             恩熙：别把「恢复默认」浮在封面图片上，收进单子里、摆在标题右边。 ── */}
      {coverSheetOpen ? (
        <>
          <div
            onClick={() => setCoverSheet(false)}
            className={coverSheetAlive.closing ? "mp-bd-out" : "mp-bd-in"}
            style={{
              position: "absolute",
              /* 2026-10-13 恩熙更正：遮罩要**全屏**，连顶上那条「动态设置」一起罩住。 */
              inset: 0,
              zIndex: 88,
              background: "rgba(20,19,24,.36)",
              pointerEvents: coverSheetAlive.closing ? "none" : undefined,
            }}
          />
          <div
            className={coverSheetAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 89,
              background: C.paper,
              borderRadius: "20px 20px 0 0",
              padding: "18px 18px calc(var(--safe-area-bottom, 0px) + 16px)",
              boxShadow: "0 -12px 40px -18px rgba(20,19,24,.5)",
              pointerEvents: coverSheetAlive.closing ? "none" : undefined,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 6,
              }}
            >
              <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600,
                             letterSpacing: ".1em", color: C.ink }}>
                换一张封面
              </span>
              {coverAsset ? (
                <button
                  type="button"
                  className="mp-act"
                  onClick={() => {
                    setCoverSheet(false);
                    void clearCover();
                  }}
                  aria-label="恢复默认封面"
                  style={{ ...ICON_BTN, gap: 5, fontFamily: SANS, fontSize: 12.5,
                           letterSpacing: ".06em", color: C.ink2 }}
                >
                  <RotateCcw size={15} strokeWidth={1.7} />
                  恢复默认
                </button>
              ) : null}
            </div>

            <button type="button" className="mp-sh-item" style={SHEET_ITEM}
                    onClick={pickCoverFromDevice}>
              <span style={SHEET_ICO}><Smartphone size={20} strokeWidth={1.6} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={SHEET_B}>手机相册</b>
                <i style={SHEET_I}>从你这台手机里挑一张</i>
              </span>
            </button>

            <button
              type="button"
              className="mp-sh-item"
              style={{ ...SHEET_ITEM, opacity: 0.5 }}
              onClick={() => showToast("小手机的相册还在路上，先等等它")}
            >
              <span style={SHEET_ICO}><ImageIcon size={20} strokeWidth={1.6} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={SHEET_B}>小手机的相册</b>
                <i style={SHEET_I}>从星绥的相册里挑</i>
              </span>
              <span style={{ flex: "none", fontSize: 9.5, letterSpacing: ".16em",
                             color: C.ink3, border: `1px solid ${C.line}`,
                             borderRadius: 999, padding: "3px 8px" }}>
                预留
              </span>
            </button>

            <button type="button" style={SHEET_CANCEL} onClick={() => setCoverSheet(false)}>
              取消
            </button>
          </div>
        </>
      ) : null}

      {/* ── 「这条动态」底单（2026-10-13）：点条目右上角「⋯」浮出来。
             **自己的**：编辑（跳编辑页）／删除（走原来那张二次确认）；
             **别人的**：只有「标为重要」这一枚（不能改别人的动态）。
             ⚠️ 底单挂在**页面级**、不在滚动格里——放条目内部会被信息流的滚动框裁掉。 ── */}
      {moreItem ? (
        <>
          <div
            onClick={() => setMoreItem(null)}
            className={moreItemAlive.closing ? "mp-bd-out" : "mp-bd-in"}
            style={{
              position: "absolute",
              /* 2026-10-13：遮罩**全屏**，连顶上那条一起罩住。 */
              inset: 0,
              zIndex: 88,
              background: "rgba(20,19,24,.36)",
              pointerEvents: moreItemAlive.closing ? "none" : undefined,
            }}
          />
          <div
            className={moreItemAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 89,
              background: C.paper,
              borderRadius: "20px 20px 0 0",
              padding: "18px 18px calc(var(--safe-area-bottom, 0px) + 16px)",
              boxShadow: "0 -12px 40px -18px rgba(20,19,24,.5)",
              pointerEvents: moreItemAlive.closing ? "none" : undefined,
            }}
          >
            <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600,
                          letterSpacing: ".1em", color: C.ink, paddingBottom: 6 }}>
              这条动态
            </div>

            {moreItem.isSelf ? (
              <>
                <button type="button" className="mp-sh-item" style={SHEET_ITEM}
                        onClick={() => openEditMoment(moreItem)}>
                  <span style={SHEET_ICO}><Pencil size={19} strokeWidth={1.6} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={SHEET_B}>编辑</b>
                    <i style={SHEET_I}>改正文，或改谁可以看</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="mp-sh-item"
                  style={SHEET_ITEM}
                  onClick={() => {
                    const target = moreItem;
                    setMoreItem(null);
                    setConfirmDelete(target);
                  }}
                >
                  <span style={SHEET_ICO}><Trash2 size={19} strokeWidth={1.6} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={SHEET_B}>删除</b>
                    <i style={SHEET_I}>删掉这条动态</i>
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="mp-sh-item"
                style={SHEET_ITEM}
                onClick={() => {
                  const target = moreItem;
                  setMoreItem(null);
                  void togglePin(target);
                }}
              >
                <span style={SHEET_ICO}><Star size={19} strokeWidth={1.6} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={SHEET_B}>{moreItem.pinnedByUser ? "取消重要" : "标为重要"}</b>
                  <i style={SHEET_I}>
                    {moreItem.pinnedByUser ? "不再把它拎到最上面" : "把它拎到我动态的最上面"}
                  </i>
                </span>
              </button>
            )}

            <button type="button" style={SHEET_CANCEL} onClick={() => setMoreItem(null)}>
              取消
            </button>
          </div>
        </>
      ) : null}

      {/* ── 「谁可以看」底单（2026-10-13）：发布页那行「谁可以看」、动态上那枚小爱心，
             点开都是这一张。四档：公开／仅自己可见／部分可见／不给谁看。
             「部分可见」「不给谁看」进去还能勾「世界」整批、或一个个勾角色；
             两边各存各的，能并存（例：部分可见勾一整个世界，再在不给谁看里挡掉里头某人）。
             ⚠︎ 遮罩从顶栏下沿起——照换封面单一样，不盖顶上那条「动态设置」。 ── */}
      {visSheet ? (
        <>
          <div
            onClick={() => setVisSheet(null)}
            className={visSheetAlive.closing ? "mp-bd-out" : "mp-bd-in"}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 96,
              background: "rgba(20,19,24,.36)",
              pointerEvents: visSheetAlive.closing ? "none" : undefined,
            }}
          />
          <div
            className={visSheetAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 97,
              background: C.paper,
              borderRadius: "20px 20px 0 0",
              padding: "18px 18px calc(var(--safe-area-bottom, 0px) + 16px)",
              boxShadow: "0 -12px 40px -18px rgba(20,19,24,.5)",
              maxHeight: "74%",
              overflowY: "auto",
              pointerEvents: visSheetAlive.closing ? "none" : undefined,
            }}
          >
            {visSheet.pane === "top" ? (
              <>
                <div style={SHEET_TITLE}>谁可以看</div>
                {VISIBILITY_OPTIONS.map((opt) => {
                  const on = visSheet.visibility === opt.key;
                  const sub =
                    opt.key === "partial"
                      ? visSheet.visibleTo.length > 0 || visSheet.visibleWorlds.length > 0
                        ? [
                            visSheet.visibleTo.length > 0 ? `${visSheet.visibleTo.length} 人` : "",
                            visSheet.visibleWorlds.length > 0
                              ? `${visSheet.visibleWorlds.length} 个世界`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "挑几个世界或角色"
                      : opt.key === "exclude"
                        ? visSheet.excludeTo.length > 0 || visSheet.excludeWorlds.length > 0
                          ? [
                              visSheet.excludeTo.length > 0 ? `${visSheet.excludeTo.length} 人` : "",
                              visSheet.excludeWorlds.length > 0
                                ? `${visSheet.excludeWorlds.length} 个世界`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "挡掉几个世界或角色"
                        : opt.key === "private"
                          ? "只有我看得见"
                          : "所有人可见";
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className="mp-sh-item"
                      style={SHEET_ITEM}
                      onClick={() => {
                        if (opt.key === "partial" || opt.key === "exclude") {
                          applyVis({
                            visibility: opt.key,
                            visibleTo: visSheet.visibleTo,
                            visibleWorlds: visSheet.visibleWorlds,
                            excludeTo: visSheet.excludeTo,
                            excludeWorlds: visSheet.excludeWorlds,
                          });
                          setVisSheet((s) =>
                            s ? { ...s, pane: opt.key === "partial" ? "partial" : "exclude" } : s,
                          );
                        } else {
                          applyVis({
                            visibility: opt.key,
                            visibleTo: visSheet.visibleTo,
                            visibleWorlds: visSheet.visibleWorlds,
                            excludeTo: visSheet.excludeTo,
                            excludeWorlds: visSheet.excludeWorlds,
                          });
                          setVisSheet(null);
                        }
                      }}
                    >
                      <span style={SHEET_ICO}>
                        <opt.icon size={19} strokeWidth={1.6} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={SHEET_B}>{opt.label}</b>
                        <i style={SHEET_I}>{sub}</i>
                      </span>
                      {on ? (
                        <Check size={18} strokeWidth={2} style={{ color: C.accent, flex: "none" }} />
                      ) : null}
                    </button>
                  );
                })}
                <button type="button" style={SHEET_CANCEL} onClick={() => setVisSheet(null)}>
                  完成
                </button>
              </>
            ) : (
              (() => {
                const isPartial = visSheet.pane === "partial";
                const selWorlds = isPartial ? visSheet.visibleWorlds : visSheet.excludeWorlds;
                const selTo = isPartial ? visSheet.visibleTo : visSheet.excludeTo;
                const commit = (w: string[], t: string[]) =>
                  applyVis({
                    visibility: visSheet.visibility,
                    visibleTo: isPartial ? t : visSheet.visibleTo,
                    visibleWorlds: isPartial ? w : visSheet.visibleWorlds,
                    excludeTo: isPartial ? visSheet.excludeTo : t,
                    excludeWorlds: isPartial ? visSheet.excludeWorlds : w,
                  });
                const toggleWorld = (id: string) =>
                  commit(
                    selWorlds.includes(id) ? selWorlds.filter((x) => x !== id) : [...selWorlds, id],
                    selTo,
                  );
                const toggleTo = (id: string) =>
                  commit(
                    selWorlds,
                    selTo.includes(id) ? selTo.filter((x) => x !== id) : [...selTo, id],
                  );
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
                      <button
                        type="button"
                        className="mp-act"
                        aria-label="返回"
                        onClick={() => setVisSheet((s) => (s ? { ...s, pane: "top" } : s))}
                        style={{ ...ICON_BTN, color: C.ink2 }}
                      >
                        <ChevronLeft size={20} strokeWidth={1.8} />
                      </button>
                      <span
                        style={{
                          fontFamily: SERIF,
                          fontSize: 15,
                          fontWeight: 600,
                          letterSpacing: ".1em",
                          color: C.ink,
                        }}
                      >
                        {isPartial ? "部分可见" : "不给谁看"}
                      </span>
                    </div>
                    <div style={SHEET_HINT}>
                      {isPartial
                        ? "选中的世界与角色看得到这条动态。"
                        : "选中的世界与角色看不到这条动态。"}
                    </div>

                    {worlds.length > 0 ? (
                      <>
                        <div style={VIS_SECTION}>世界</div>
                        <div style={VIS_CHIPS}>
                          {worlds.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              className="mp-act"
                              style={pickChip(selWorlds.includes(w.id))}
                              onClick={() => toggleWorld(w.id)}
                            >
                              {w.name}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}

                    <div style={VIS_SECTION}>角色</div>
                    {friends.length > 0 ? (
                      <div style={VIS_CHIPS}>
                        {friends.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className="mp-act"
                            style={pickChip(selTo.includes(f.id))}
                            onClick={() => toggleTo(f.id)}
                          >
                            {f.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: C.ink3, padding: "4px 2px" }}>
                        还没有可挑的角色。
                      </div>
                    )}

                    <button
                      type="button"
                      style={SHEET_CANCEL}
                      onClick={() => setVisSheet((s) => (s ? { ...s, pane: "top" } : s))}
                    >
                      完成
                    </button>
                  </>
                );
              })()
            )}
          </div>
        </>
      ) : null}

      {/* ── 「提醒谁看」底单（2026-10-13）：发布时勾几个角色，发出去就提醒他们来看
             （微信「提醒谁看」那个意思）。只做「记下来」，勾完写回草稿。 ── */}
      {remindSheetOpen ? (
        <>
          <div
            onClick={() => setRemindSheet(false)}
            className={remindSheetAlive.closing ? "mp-bd-out" : "mp-bd-in"}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 96,
              background: "rgba(20,19,24,.36)",
              pointerEvents: remindSheetAlive.closing ? "none" : undefined,
            }}
          />
          <div
            className={remindSheetAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 97,
              background: C.paper,
              borderRadius: "20px 20px 0 0",
              padding: "18px 18px calc(var(--safe-area-bottom, 0px) + 16px)",
              boxShadow: "0 -12px 40px -18px rgba(20,19,24,.5)",
              maxHeight: "74%",
              overflowY: "auto",
              pointerEvents: remindSheetAlive.closing ? "none" : undefined,
            }}
          >
            <div style={SHEET_TITLE}>提醒谁看</div>
            <div style={SHEET_HINT}>发出去时提醒这几个角色来看——不会漏掉。</div>
            {friends.length > 0 ? (
              <div style={VIS_CHIPS}>
                {friends.map((f) => {
                  const on = composer?.remindTo.includes(f.id) ?? false;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="mp-act"
                      style={pickChip(on)}
                      onClick={() =>
                        setComposer((c) =>
                          c
                            ? {
                                ...c,
                                remindTo: on
                                  ? c.remindTo.filter((x) => x !== f.id)
                                  : [...c.remindTo, f.id],
                              }
                            : c,
                        )
                      }
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.ink3, padding: "4px 2px" }}>还没有可挑的角色。</div>
            )}
            <button type="button" style={SHEET_CANCEL} onClick={() => setRemindSheet(false)}>
              完成
            </button>
          </div>
        </>
      ) : null}

      {/* 配图放大层：点动态里那张图弹出来——大图 + 底下「保存图片」，点背景或右上角 X 关掉。
          大图特意放开原生长按（全局是禁掉的，见 globals.css）：手机端还能用系统菜单里的
          「存储图像／存储到照片」，跟聊天里点大图同一套手感。 */}
      {viewer ? (
        <div
          onClick={() => setViewer(null)}
          className={viewerAlive.closing ? "mp-bd-out" : "mp-bd-in"}
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
            pointerEvents: viewerAlive.closing ? "none" : undefined,
          }}
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setViewer(null)}
            style={{
              position: "absolute",
              top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 14px)",
              right: 16,
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "rgba(255,255,255,.14)",
              border: "none",
              color: "#FFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
          <div
            style={{
              width: "78%",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 18px 60px rgba(0,0,0,.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewer.src}
              alt="配图"
              decoding="sync"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                WebkitTouchCallout: "default",
                WebkitUserSelect: "auto",
                userSelect: "auto",
              }}
            />
          </div>
          <button
            type="button"
            className="mp-act"
            onClick={(e) => {
              e.stopPropagation();
              /* 地址 + 已经解好的 Blob 一起给：blob 直接用（分享路径要保持同步，
                 await 一次就把用户手势等没了），缓存没命中时走兜底逻辑。 */
              saveImageToDevice(
                viewer.src,
                viewer.ref ? getCachedMediaBlob(viewer.ref) : undefined,
                showToast,
              );
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
              cursor: "pointer",
            }}
          >
            <Download size={15} strokeWidth={1.8} />
            保存图片
          </button>
        </div>
      ) : null}

      {/* 画面描述卡：点「生成配图」先把 TA 写的画面描述摊开来看，改得动；
          点「生成配图」才真跑接口——不白花钱。点背景或「取消」就走人。 */}
      {editor ? (
        <div
          onClick={() => setEditor(null)}
          className={editorAlive.closing ? "mp-bd-out" : "mp-bd-in"}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 78,
            display: "flex",
            alignItems: "flex-end",
            pointerEvents: editorAlive.closing ? "none" : undefined,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={editorAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              width: "100%",
              background: C.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "20px 18px calc(var(--safe-area-bottom, 0px) + 18px)",
              boxShadow: "0 -14px 44px -20px rgba(20,19,24,.5)",
            }}
          >
            <div style={{ fontSize: 15.5, fontWeight: 500, fontFamily: SERIF,
                          letterSpacing: ".1em", color: C.ink }}>
              画面描述
            </div>
            <div style={{ marginTop: 5, fontSize: 11.5, lineHeight: 1.7, color: C.ink3 }}>
              图按这段话生成，不对就先改——确认了才跑接口。
            </div>
            <textarea
              aria-label="画面描述"
              value={editor.text}
              onChange={(e) => setEditor({ item: editor.item, text: e.target.value })}
              rows={4}
              style={{
                marginTop: 12,
                width: "100%",
                minHeight: 104,
                maxHeight: 180,
                resize: "none",
                padding: "11px 12px",
                borderRadius: 12,
                border: `1px solid ${C.line}`,
                background: "rgba(20,19,24,.04)",
                color: C.ink,
                fontFamily: SANS,
                fontSize: 13.5,
                lineHeight: 1.7,
                letterSpacing: ".02em",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button
                type="button"
                className="mp-act"
                onClick={() => setEditor(null)}
                style={{
                  flex: 1,
                  height: 44,
                  border: "none",
                  borderRadius: 12,
                  background: "rgba(20,19,24,.06)",
                  color: C.ink2,
                  fontFamily: SANS,
                  fontSize: 13.5,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="mp-act"
                onClick={() => void confirmEdit()}
                style={{
                  flex: "1.6",
                  height: 44,
                  border: "none",
                  borderRadius: 12,
                  background: C.accent,
                  color: "#FFF",
                  fontFamily: SANS,
                  fontSize: 13.5,
                  fontWeight: 600,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <ImageIcon size={14} />
                生成配图
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 发动态／编辑动态：整页（2026-10-13 由底部弹层升成满屏，对齐草稿 `.m-post`）——
          正文 ＋（新发时）配图 ＋ 可见范围，点了「发表／保存」才落库。
          `data-mp-scroll`：给上面那枚手势闸认，这一层自己滚得动、到头不拖整页。 */}
      {composer ? (
        <div
          className={composerAlive.closing ? "mp-page-out" : "mp-page-in"}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 80,
            background: C.paper,
            display: "flex",
            flexDirection: "column",
            pointerEvents: composerAlive.closing ? "none" : undefined,
          }}
        >
          {/* 顶栏（草稿 `.m-post-h`）：左「取消」、中标题、右一枚主按钮（发表／保存）。
              2026-10-13 从底部弹层改成**整页**——恩熙要的是一张正经的发布页，
              像微信「发表」那样满屏写。编辑时标题换「编辑动态」、按钮换「保存」。 */}
          <div
            style={{
              flex: "none",
              position: "relative",
              padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 14px) 22px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: `1px solid ${C.line2}`,
            }}
          >
            <button
              type="button"
              className="mp-act"
              onClick={closeComposer}
              style={{ border: 0, background: "none", padding: 0, fontFamily: SANS,
                       fontSize: 13.5, letterSpacing: ".08em", color: C.ink2, cursor: "pointer" }}
            >
              取消
            </button>
            {/* 标题**绝对居中**在整条顶栏正中——不受右边那颗「发表」宽窄影响
                （恩熙：右边按钮偏大，把标题挤偏了）。 */}
            <span
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                fontFamily: SERIF,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: ".16em",
                color: C.ink,
              }}
            >
              {composer.editId ? "编辑动态" : "发布动态"}
            </span>
            <button
              type="button"
              className="mp-act"
              onClick={() => (composer.editId ? void saveEditMoment() : void publishSelf())}
              disabled={!canSubmitComposer || publishing}
              style={{
                border: 0,
                borderRadius: 999,
                marginRight: -6,
                padding: "6px 14px",
                fontFamily: SANS,
                fontSize: 12.5,
                letterSpacing: ".1em",
                color: "#fff",
                background: !canSubmitComposer || publishing ? "#DCDFE3" : C.accent,
                cursor: !canSubmitComposer || publishing ? "default" : "pointer",
              }}
            >
              {publishing ? "…" : composer.editId ? "保存" : "发表"}
            </button>
          </div>

          {/* 可写区（草稿 `.m-post-b`）：整页滚动，正文一只**无框** textarea。 */}
          <div
            data-mp-scroll="1"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overscrollBehavior: "none",
              padding: "18px 22px calc(var(--safe-area-bottom, 0px) + 26px)",
              boxSizing: "border-box",
            }}
          >

            <textarea
              aria-label="动态正文"
              data-mp-scroll="1"
              value={composer.text}
              onChange={(e) => setComposer({ ...composer, text: e.target.value })}
              placeholder="这一刻的想法…"
              rows={4}
              style={{
                width: "100%",
                minHeight: 112,
                maxHeight: 320,
                resize: "none",
                padding: 0,
                border: 0,
                background: "none",
                color: C.ink,
                /* 打字时就用思源宋体（2026-10-13，恩熙：「发布的动态文字要统一」）——
                   发出去的正文卡片是宋体，输入时也是宋体，写时＝发后，不再「写黑体、
                   发出去变宋体」跳一次。字号行距对齐正文卡（14.5/1.85 收半档）。 */
                fontFamily: SERIF,
                fontSize: 14,
                lineHeight: 1.85,
                letterSpacing: ".02em",
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            {/* 配图这块**编辑时不摊开**（编辑只管正文＋谁可以看，跟草稿一致）。
                只有新发动态才给。 */}
            {!composer.editId ? (
              <>
            {/* 配图（2026-10-05；2026-10-05 二次改：先问图从哪来）：
                点「配图」先摊四枚章——相册／拍照（共用藏起来的 input，拍照临时挂 `capture`）／
                小手机相册（还没做，如实说一句）／文字描述（写段画面当图）。
                选好摊一张小图（真图）或一张印着描述的相纸（文字当图），右上角一枚叉可拿掉。
                带图时正文可留空。 */}
            <div style={{ marginTop: 12 }}>
              <input
                ref={composerInput}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = e.target.files;
                  /* 选完立刻清空：同一张图连选两次也得能触发 onChange。 */
                  e.target.value = "";
                  if (files && files.length > 0) void addComposerImages(files);
                }}
              />
              {imgPick === "text" ? (
                /* 文字描述子面板：写一段画面。发布时看「配图自动生成」——
                   关着＝这段描述就当这张图；开着＝先画成真图再发。 */
                <div>
                  <textarea
                    aria-label="画面描述"
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    placeholder="写下这张图的样子。它就当这张图；开了「配图自动生成」就会照它画一张。"
                    rows={3}
                    style={{
                      width: "100%",
                      minHeight: 76,
                      maxHeight: 160,
                      resize: "none",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid rgba(90,115,145,.35)`,
                      background: "rgba(231,236,242,.5)",
                      color: C.ink,
                      /* 同正文：文字描述也是「发布的字」，一并思源宋体。 */
                      fontFamily: SERIF,
                      fontSize: 13,
                      lineHeight: 1.8,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      className="mp-act"
                      onClick={() => {
                        setImgPick(null);
                        setTextDraft("");
                      }}
                      style={{
                        height: 34,
                        padding: "0 14px",
                        border: "none",
                        borderRadius: 10,
                        background: "rgba(20,19,24,.06)",
                        color: C.ink2,
                        fontFamily: SANS,
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="mp-act"
                      onClick={applyComposerText}
                      style={{
                        height: 34,
                        padding: "0 16px",
                        border: "none",
                        borderRadius: 10,
                        background: C.accent,
                        color: "#FFF",
                        fontFamily: SANS,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      就这张
                    </button>
                    <span style={{ flex: 1, fontSize: 10.5, lineHeight: 1.6, color: C.ink3,
                                   letterSpacing: ".03em" }}>
                      发布时按「配图自动生成」定：关着＝描述当图，开着＝先画真图。
                    </span>
                  </div>
                </div>
              ) : imgPick === "seals" ? (
                /* 四枚章：这张图从哪来。 */
                <div>
                  <div style={{ fontSize: 11, letterSpacing: ".08em", color: C.ink3 }}>
                    这张图从哪来
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 20, alignItems: "flex-start" }}>
                    {(
                      [
                        { key: "device", icon: ImageIcon, title: "相册" },
                        { key: "camera", icon: Camera, title: "拍照" },
                        { key: "stellasei", icon: Smartphone, title: "小手机相册" },
                        { key: "text", icon: TypeIcon, title: "文字描述" },
                      ] as const
                    ).map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        className="mp-act mp-seal"
                        onClick={() =>
                          row.key === "text" ? setImgPick("text") : pickComposerSource(row.key)
                        }
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 6,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <span className="mp-seal-face">
                          <row.icon size={20} strokeWidth={1.6} />
                        </span>
                        <span style={{ fontFamily: SANS, fontSize: 10.5, color: C.ink2,
                                       letterSpacing: ".03em" }}>
                          {row.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : composer.images.length > 0 ? (
                /* 九宫格：1 张＝一个大方格；2 张＝两个小方格；3 张＝一排三个；
                   4 张＝四宫格 2×2；5 张往上＝一排三个接着往下排。没满 9 张时末尾挂一格「＋」。 */
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: composer.images.length === 4 ? "1fr 1fr" : "1fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  {composer.images.map((r) => (
                    <div
                      key={r}
                      style={composer.images.length === 1 ? { gridColumn: "span 2" } : undefined}
                    >
                      <ComposerThumb refStr={r} onRemove={() => removeComposerImageAt(r)} />
                    </div>
                  ))}
                  {composerSlots > 0 ? (
                    <button
                      type="button"
                      className="mp-act"
                      aria-label="再加一张"
                      onClick={() => setImgPick("seals")}
                      style={{
                        position: "relative",
                        width: "100%",
                        paddingTop: "100%",
                        border: "1px dashed rgba(20,19,24,.18)",
                        borderRadius: 14,
                        background: "rgba(20,19,24,.03)",
                        cursor: "pointer",
                      }}
                    >
                      <Plus
                        size={20}
                        strokeWidth={1.7}
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%,-50%)",
                          color: C.ink3,
                        }}
                      />
                    </button>
                  ) : null}
                </div>
              ) : composer.imageText ? (
                /* 文字当图：摊一张相纸，里头印着这段描述（跟发布后卡片上那张同一副样子）。 */
                <div style={{ position: "relative", display: "inline-block" }}>
                  <div
                    style={{
                      width: 128,
                      minHeight: 108,
                      padding: 7,
                      borderRadius: 10,
                      background: "#FFF",
                      boxShadow:
                        "0 0 0 1px rgba(20,19,24,.06), 0 8px 18px -12px rgba(20,19,24,.35)",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        padding: "9px 8px",
                        maxHeight: 94,
                        overflow: "hidden",
                        background: "rgba(231,236,242,.5)",
                        border: "1px dashed rgba(20,19,24,.14)",
                        borderRadius: 8,
                        fontSize: 10.5,
                        lineHeight: 1.6,
                        color: C.ink2,
                        fontFamily: SANS,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {composer.imageText}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mp-act"
                    aria-label="拿掉配图"
                    onClick={removeComposerImage}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(20,19,24,.72)",
                      color: "#FFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <X size={12} strokeWidth={2.4} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="mp-act"
                  onClick={() => setImgPick("seals")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 36,
                    padding: "0 14px",
                    borderRadius: 10,
                    border: "1px dashed rgba(20,19,24,.18)",
                    background: "rgba(20,19,24,.03)",
                    color: C.ink2,
                    fontFamily: SANS,
                    fontSize: 12.5,
                    letterSpacing: ".04em",
                    cursor: "pointer",
                  }}
                >
                  <ImageIcon size={14} strokeWidth={1.9} />
                  配图
                </button>
              )}
            </div>

              </>
            ) : null}

            {/* 「谁可以看」「提醒谁看」两行——照草稿 `.m-post-row`：一行字＋当前值＋箭头，
                点进去弹底部单（谁可以看＝四档；提醒谁看＝勾人）。 */}
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="mp-act"
                onClick={() =>
                  setVisSheet({
                    scope: "composer",
                    momentId: "",
                    pane: "top",
                    visibility: composer.visibility,
                    visibleTo: [...composer.visibleTo],
                    visibleWorlds: [...composer.visibleWorlds],
                    excludeTo: [...composer.excludeTo],
                    excludeWorlds: [...composer.excludeWorlds],
                  })
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 2px",
                  border: "none",
                  borderTop: `1px solid ${C.line2}`,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontFamily: SANS, fontSize: 13, letterSpacing: ".06em", color: C.ink }}>
                  谁可以看
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2 }}>
                  {VISIBILITY_LABEL[composer.visibility]}
                </span>
                <ChevronRight size={15} strokeWidth={1.8} style={{ color: C.ink3 }} />
              </button>

              {!composer.editId ? (
                <button
                  type="button"
                  className="mp-act"
                  onClick={() => setRemindSheet(true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 2px",
                    border: "none",
                    borderTop: `1px solid ${C.line2}`,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: SANS, fontSize: 13, letterSpacing: ".06em", color: C.ink }}>
                    提醒谁看
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink2 }}>
                    {composer.remindTo.length > 0 ? `已选 ${composer.remindTo.length} 人` : ""}
                  </span>
                  <ChevronRight size={15} strokeWidth={1.8} style={{ color: C.ink3 }} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除动态：二次确认（2026-10-05）。就一枚居中卡片、两枚按钮——删掉连它的赞评
          一起从这一册消失（见 removeSelfMoment），所以先问一句，别点错。 */}
      {confirmDelete ? (
        <div
          onClick={() => setConfirmDelete(null)}
          className={confirmDeleteAlive.closing ? "mp-bd-out" : "mp-bd-in"}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 84,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 40px",
            pointerEvents: confirmDeleteAlive.closing ? "none" : undefined,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={confirmDeleteAlive.closing ? "mp-pop-out" : "mp-pop-in"}
            style={{
              width: "100%",
              maxWidth: 300,
              background: C.card,
              borderRadius: 18,
              padding: "20px 18px 16px",
              boxShadow: "0 18px 50px -20px rgba(20,19,24,.5)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 500, fontFamily: SERIF,
                          letterSpacing: ".08em", color: C.ink, textAlign: "center" }}>
              删除这条动态？
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, color: C.ink3,
                          textAlign: "center" }}>
              删掉就没了，它底下的赞和评论也一起走。
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="mp-act"
                onClick={() => setConfirmDelete(null)}
                style={{ flex: 1, height: 38, border: "none", borderRadius: 12,
                         background: "rgba(20,19,24,.06)", color: C.ink2, fontSize: 13,
                         fontFamily: SANS, cursor: "pointer" }}
              >
                取消
              </button>
              <button
                type="button"
                className="mp-act"
                onClick={() => void deleteMoment(confirmDelete)}
                style={{ flex: 1, height: 38, border: "none", borderRadius: 12,
                         background: T.danger, color: "#fff", fontSize: 13,
                         fontFamily: SANS, cursor: "pointer" }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 动态设置：底部弹层——只留「我」发动态相关的配图设置（配图自动生成／配图接口），
          拨一下即存即生效（2026-10-05 恩熙定位置：动态页右上角）。`data-mp-scroll` 同上，自己滚得动。 */}
      {momentSet ? (
        <div
          onClick={() => setMomentSet(null)}
          className={momentSetAlive.closing ? "mp-bd-out" : "mp-bd-in"}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 82,
            display: "flex",
            alignItems: "flex-end",
            pointerEvents: momentSetAlive.closing ? "none" : undefined,
          }}
        >
          <div
            data-mp-scroll="1"
            onClick={(e) => e.stopPropagation()}
            className={momentSetAlive.closing ? "mp-sh-out" : "mp-sh-in"}
            style={{
              width: "100%",
              maxHeight: "calc(100% - 40px)",
              overflowY: "auto",
              overscrollBehavior: "none",
              background: C.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "20px 18px calc(var(--safe-area-bottom, 0px) + 18px)",
              boxShadow: "0 -14px 44px -20px rgba(20,19,24,.5)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15.5, fontWeight: 500, fontFamily: SERIF,
                            letterSpacing: ".1em", color: C.ink }}>
                动态设置
              </div>
              <button
                type="button"
                className="mp-act"
                onClick={() => setMomentSet(null)}
                aria-label="关闭"
                style={{ width: 30, height: 30, border: "none", borderRadius: 10,
                         background: "rgba(20,19,24,.05)", color: C.ink2, display: "flex",
                         alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            {/* 「配图自动生成」：**我**发动态用「文字描述」当配图时，要不要交给生图接口真画一张。
                关（默认）＝不画不花钱，这段描述就当这张图；开＝自动画成真图再发。 */}
            <div
              style={{ marginTop: 16, display: "flex", alignItems: "center",
                       justifyContent: "space-between" }}
            >
              <span style={{ fontFamily: SANS, fontSize: 13.5, color: C.ink }}>配图自动生成</span>
              <div
                role="switch"
                aria-checked={momentSet.autoImg}
                aria-label="配图自动生成"
                className="mp-act"
                onClick={toggleAutoMyMomentImage}
                style={{ width: 46, height: 27, borderRadius: 999,
                         background: momentSet.autoImg ? C.accent : "rgba(20,19,24,.12)",
                         position: "relative", transition: "background .2s", flex: "none",
                         cursor: "pointer" }}
              >
                <div
                  style={{ position: "absolute", top: 2, left: momentSet.autoImg ? 21 : 2,
                           width: 23, height: 23, borderRadius: "50%", background: "#fff",
                           boxShadow: "0 2px 5px rgba(20,19,24,.22)", transition: "left .2s" }}
                />
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.75, color: C.ink3,
                          letterSpacing: ".04em" }}>
              你发动态用「文字描述」当配图时：关着＝这段描述就当这张图；开着＝先交给生图接口画成真图再发。
            </div>

            {/* 「配图接口」：只在上面那枚「配图自动生成」开着时才露面。
                不填＝跟随主「图文 API」；填了＝这一处自己一套（可以点设置里的图文预设带过来，
                但只当一份快照存着，之后设置那边怎么改都跟这里不相干）。 */}
            {momentSet.autoImg ? (
              <>
                <div style={{ marginTop: 14, display: "flex", alignItems: "center",
                              justifyContent: "space-between" }}>
                  <span style={{ fontFamily: SANS, fontSize: 13.5, color: C.ink }}>配图接口</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: C.ink3, letterSpacing: ".04em",
                                   maxWidth: 148, overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap" }}>
                      {momentSet.imgApi?.baseUrl?.trim()
                        ? `自定义 · ${momentSet.imgApi.model || "未设模型"}`
                        : "跟随主图文 API"}
                    </span>
                    <button
                      type="button"
                      className="mp-act"
                      onClick={() => {
                        if (!imgApiEdit) {
                          setImgApiDraft(momentSet.imgApi ?? { baseUrl: "", apiKey: "", model: "" });
                        }
                        setImgApiEdit(!imgApiEdit);
                      }}
                      style={{ fontFamily: SANS, fontSize: 12, color: C.accent,
                               background: "none", border: "none", padding: "2px",
                               cursor: "pointer" }}
                    >
                      {imgApiEdit ? "收起" : "更改"}
                    </button>
                  </div>
                </div>

                {imgApiEdit ? (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 12,
                                background: "rgba(231,236,242,.5)",
                                border: "1px solid rgba(90,115,145,.16)" }}>
                    {imgPresets.length ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: C.ink3, marginBottom: 6,
                                      letterSpacing: ".04em" }}>
                          设置里的图文预设
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {imgPresets.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="mp-act"
                              onClick={() =>
                                setImgApiDraft({
                                  baseUrl: p.baseUrl,
                                  apiKey: p.apiKey,
                                  model: p.model,
                                })
                              }
                              style={{ maxWidth: 150, fontFamily: SANS, fontSize: 12,
                                       color: C.accent, background: "#fff",
                                       border: "1px solid rgba(90,115,145,.35)",
                                       borderRadius: 999, padding: "5px 11px",
                                       overflow: "hidden", textOverflow: "ellipsis",
                                       whiteSpace: "nowrap", cursor: "pointer" }}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.6,
                                      color: C.ink3, letterSpacing: ".04em" }}>
                          点一下把它的地址／密钥／模型填进来，再点「存下」。
                        </div>
                      </div>
                    ) : null}
                    {([
                      ["baseUrl", "接口地址", "https://…/v1"],
                      ["apiKey", "密钥", "sk-…"],
                      ["model", "模型", "如 gpt-image-1"],
                    ] as const).map(([key, label, ph]) => (
                      <div key={key} style={{ marginBottom: key === "model" ? 0 : 8 }}>
                        <div style={{ fontSize: 11, color: C.ink3, marginBottom: 4,
                                      letterSpacing: ".04em" }}>
                          {label}
                        </div>
                        <input
                          value={imgApiDraft[key]}
                          onChange={(e) =>
                            setImgApiDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                          placeholder={ph}
                          spellCheck={false}
                          autoComplete="off"
                          style={{ width: "100%", boxSizing: "border-box", fontFamily: SANS,
                                   fontSize: 13, color: C.ink, background: "#fff",
                                   border: "1px solid rgba(20,19,24,.12)", borderRadius: 9,
                                   padding: "9px 11px", outline: "none" }}
                        />
                      </div>
                    ))}
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        type="button"
                        className="mp-act"
                        onClick={saveImgApi}
                        style={{ flex: 1, fontFamily: SANS, fontSize: 13, color: "#FFFDF8",
                                 background: "linear-gradient(180deg, #E8709C 0%, #C9346A 100%)",
                                 border: "none", borderRadius: 10, padding: "10px 0",
                                 cursor: "pointer" }}
                      >
                        存下
                      </button>
                      {momentSet.imgApi?.baseUrl?.trim() ? (
                        <button
                          type="button"
                          className="mp-act"
                          onClick={resetImgApi}
                          style={{ fontFamily: SANS, fontSize: 12.5, color: C.ink3,
                                   background: "#fff", border: "1px solid rgba(20,19,24,.12)",
                                   borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
                        >
                          改回跟随主
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.7, color: C.ink3,
                              letterSpacing: ".04em" }}>
                  不填就跟随主「图文 API」；想单独用一套，可以点上面的预设带过来，或自己填，
                  只在这一处生效——存下的是一份快照，设置那边再改也影响不到这里。
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 动态条目组件（抽出来是因为生成配图涉及 async state，不适合放在 map 里面）。
   配图生成由朋友圈页面手动点击触发，点一次跑一次图文接口，失败按钮还在、可重试。
   点按钮先弹描述卡（能看能改），确认了才跑接口——所以生成状态与弹层都抬到了
   `MomentsPage`，这里只管画和把点击报上去。

   已经有图的那条，**长按那张图**就是重新生成（短按照旧弹大图看／存）。
   画的过程中图上盖一层「重新生成中…」，不然长按完屏幕纹丝不动，像没点上。

   骨架只留「一条动态一张卡」，换回星绥自己的语言——圆头像、相纸、粉点缀、中文文字框：
   左边一枚 42px 圆头像（白圈＋淡影，标了「重要」的多一环主粉），右边一列——名字用
   **中文衬线**、正文、相纸／描述框、互动行；条目之间不是实线，是**两端渐隐的中性发丝线**。
   相纸、中文文字框照旧——那些是星绥自己的东西，不用动。

   骨架以外只做**减法**：降饱和、撤装饰、把字重调细、把阴影减淡、把时间从互动行的
   定宽列**撤回名字后面**（那截空白像表格，就是「怪」的来源）。高级不是加上去的，
   是减出来的。
   -------------------------------------------------------------------------- */
/* 动态的那枚时间戳（微信那一套，2026-09-22 恩熙定的）：
   默认说相对话——「刚刚／5分钟前／3小时前／昨天／前天」；**点一下**换成确切时间
   （`M月D日 时:分`），再点一下换回去。
   为什么是个组件：它自带一枚「展开了没有」的开关，静态函数给不了。
   为什么只有相对档可点：更早的那些本来就写着确切日期，点了没有第二个样子可给。
   时间口径（哪档说相对、哪档说日期）在 `shared.ts` 的 `momentTime`。 */
function MomentStamp({ iso }: { iso: string }) {
  const [full, setFull] = useState(false);
  const rel = momentTime(iso);
  const abs = momentFullTime(iso);
  const toggleable = rel !== abs;
  const base: CSSProperties = {
    /* ── 2026-10-13 换皮（草稿 `.m-etime` 同款）：等宽小字、9.5、字距 .1em。
       ⚠︎ **必须写死 `textAlign: "left"`**：相对时间那一档会渲染成 `<button>`，
       而按钮的默认文字对齐是 `center`——它又是竖列里的 flex 子项、会被拉满整列宽，
       于是「刚刚」就跑到列中间去了（2026-10-13 真机截图抓到的就是这个）。
       这一行是给按钮兜底的，`<span>` 那一档本来就在左边。 ── */
    fontFamily: LAT,
    fontSize: 9.5,
    letterSpacing: ".1em",
    textAlign: "left",
    color: C.ink3,
    fontVariantNumeric: "tabular-nums",
  };
  if (!toggleable) return <span style={base}>{rel}</span>;
  return (
    <button
      type="button"
      onClick={() => setFull((v) => !v)}
      style={{ ...base, background: "none", border: 0, padding: 0, cursor: "pointer" }}
    >
      {full ? abs : rel}
    </button>
  );
}

/** 评论正文里把 `@名字` 挑出来染成粉——只是好认，名字本身就写在正文里（不进数据另存）。 */
function CommentBody({ content }: { content: string }) {
  const parts = content.split(/(@[^\s@，。！？、,.!?]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} style={{ color: C.accent }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function MomentItem({
  item,
  generating,
  onOpenImage,
  onEditPrompt,
  friends,
  onMore,
  onOpenVis,
  onToggleLike,
  onSubmitComment,
}: {
  item: FeedItem;
  /** 这条的配图正在画（按钮转圈／图上盖一层；不给重复点）。 */
  generating: boolean;
  /** 点配图 → 放大预览（保存图片在那一层里）。 */
  onOpenImage: (src: string, ref?: string) => void;
  /** 要（重新）画这张配图 → 由上层分流（自动生图开＝直接跑；关＝先摊描述卡看／改）。 */
  onEditPrompt: (item: FeedItem) => void;
  /** @ 选人用的名单（跟信息流同一条过滤口径）。 */
  friends: { id: string; name: string }[];
  /** 点「⋯」→ 把这条交给上层弹「这条动态」底单（编辑／删除／标重要都归上层）。 */
  onMore: (item: FeedItem) => void;
  /** 点那枚小爱心（可见范围）→ 上层弹「谁可以看」底单，改完立刻落库。 */
  onOpenVis: (item: FeedItem) => void;
  /** 点赞／取消赞（我自己那一下）。 */
  onToggleLike: (item: FeedItem) => void;
  /** 发评论：`replyToId` 有值＝挂在某条评论底下（艾特出来的那一层）。 */
  onSubmitComment: (
    item: FeedItem,
    content: string,
    mentions: string[],
    replyToId?: string,
  ) => void;
}) {
  /* 这条动态要摊的配图（引用串）：新数据在 `images`（可多张），老数据兜底读 `imageRef`。 */
  const momentImgs = (
    item.images && item.images.length > 0 ? item.images : item.imageRef ? [item.imageRef] : []
  ).filter(Boolean);

  /* 那枚小爱心旁边的字：把四档说成一句人话（有勾名单的，把人数也带上；没有就只说档位）。 */
  const visLabel =
    item.visibility === "private"
      ? "仅自己可见"
      : item.visibility === "partial"
        ? item.visibleNames?.length
          ? `部分可见 · ${item.visibleNames.length} 人`
          : "部分可见"
        : item.visibility === "exclude"
          ? item.excludeTo?.length
            ? `不给谁看 · ${item.excludeTo.length} 人`
            : "不给谁看"
          : "公开";

  const likes = item.likes ?? [];
  const comments = item.comments ?? [];
  const likedByMe = likes.some((l) => l.byId === MOMENT_SELF_ID);
  const hasSocial = likes.length > 0 || comments.length > 0;
  /* 二级回复要挂在它回复的那条底下；万一父评论没了（被删等），当平铺处理，别让它凭空消失。 */
  const commentIds = new Set(comments.map((c) => c.id));
  const rootComments = comments.filter((c) => !c.replyToId || !commentIds.has(c.replyToId));

  /* 评论框：开着／草稿／点了谁／@ 名单（点了谁＝挂在谁底下）。 */
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<MomentComment | null>(null);
  const [atOpen, setAtOpen] = useState(false);

  const startReply = (c: MomentComment) => {
    setComposing(true);
    setReplyTo(c);
    setMentionIds(c.byId === MOMENT_SELF_ID ? [] : [c.byId]);
    setDraft((d) => (d.includes(`@${c.byName}`) ? d : `@${c.byName} `));
  };

  const addMention = (f: { id: string; name: string }) => {
    setMentionIds((ids) => (ids.includes(f.id) ? ids : [...ids, f.id]));
    setDraft((d) => (d.includes(`@${f.name}`) ? d : d ? `${d}@${f.name} ` : `@${f.name} `));
  };

  const sendComment = () => {
    const text = draft.trim();
    if (!text) return;
    onSubmitComment(item, text, mentionIds, replyTo?.id);
    setDraft("");
    setMentionIds([]);
    setReplyTo(null);
    setComposing(false);
    setAtOpen(false);
  };

  /* 长按配图＝重新生成（手感照通讯人那排分类卡，见 ContactsApp）：按住 500ms 触发，
     滑出 10px 当滚动取消，触发过的那一下松手浏览器会补发一发 click——用 `longFired`
     拦掉，不然长按完顺手就把大图弹出来了。 */
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const pressAt = useRef({ x: 0, y: 0 });

  const cancelLong = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };
  useEffect(
    () => () => {
      if (longTimer.current) clearTimeout(longTimer.current);
    },
    [],
  );

  const imagePressHandlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      longFired.current = false;
      pressAt.current = { x: e.clientX, y: e.clientY };
      cancelLong();
      longTimer.current = setTimeout(() => {
        longTimer.current = null;
        longFired.current = true;
        onEditPrompt(item);
      }, 500);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!longTimer.current) return;
      if (
        Math.abs(e.clientX - pressAt.current.x) > 10 ||
        Math.abs(e.clientY - pressAt.current.y) > 10
      ) {
        cancelLong();
      }
    },
    onPointerUp: cancelLong,
    onPointerCancel: cancelLong,
    onPointerLeave: cancelLong,
  };

  return (
    /* ── 一条动态的排法（2026-10-13 换皮「雾蓝纸墨」，草稿定稿的**名录式**）：
           撤掉「一张方卡」的框、顶晕、纸芯蓝边、柔影——条目直接站在纸上，
           条与条之间只压一条**两端缩进的发丝线**（`.mp-feed > article + article::before`，
           见页首样式块）。左列头像、右列名字 →（时间）→ 正文 → 相纸，
           跟消息列表「戊」同一个骨架：**排的是名录，不是卡片**。
           逻辑一行没动：生图、长按重生成、存图、标「重要」、描述卡、放大层全照旧。 ── */
    <article
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "38px minmax(0, 1fr)",
        columnGap: 12,
        alignItems: "start",
        /* ── 2026-10-13 对齐草稿 `.m-ent`：条目**不吃左右外边距**（`margin: 0`），
           左右那点边由外层 `.mp-feed` 的 `padding` 统一给；条目自己只在
           里侧各让 4px（`15px 4px 16px`），好让两端缩进的发丝线与正文、配图对齐。 ── */
        margin: 0,
        padding: "15px 4px 16px",
      }}
    >
      {/* ── 2026-10-13 换皮：原卡右上角那枚**小书签**（标重要）已撤。
             草稿 `minimal-style-samples.html` 的条目右上角只有一枚「⋯」，
             「标重要／取消重要」收进「⋯」点开的小菜单里（见右列那枚 `MORE_BTN`），
             同一件事不再说两遍。 ── */}
      {/* ── 左列＝**头像自己一列**（这一格只装头像这一件事）。
             ⚠︎ 2026-09-22 恩熙定的版：头像**自成左列**，名字、时间、正文、配图
             **全在它右边的下方**——不再有东西落在头像**底下**，头像也不再跟名字挤一行。
             头像 42px 正圆：一圈白边把它从卡上托起来，再垫一点点淡影；标了「重要」的
             那条，白圈外再补一环主粉——比挂个「★ 重要」的字样更打眼，也不占地方。
             （层级：名字 `13` 宋体 ＋ 主粉，时间 `10` 退到 ink3，字号差拉开。） ── */}
      {/* 44 的槽：头像 42 正圆坐在里面，四周各留 1px 给那圈框线。
          **槽里只有头像这一样东西**——曾经在右上角点过一颗 5px 小粉珠，
          恩熙读成了「**在线状态**」，已撤（见日志第 376 条）。
          层次**全靠那一叠「环 ＋ 影」**，不靠任何小圆点。

          ⚠︎ **故意不给这个槽写 `height`**（2026-09-22，恩熙：「**正文是不是变得很下面……
          应该稍微贴齐名字，留出一点点的空位就好**」）：
          槽和名字同在第 1 行，**写死 `height: 44` 就等于把这一行的行高定成 44**——
          名字本身才十几像素，于是从第 2 行起头的正文只能从 44 底下才开口，
          **看着就像跟名字隔了一整个头像**。
          头像自己是 `position: absolute`（不占布局），槽多高都不影响它 ⇒ **把高度摘掉**，
          第 1 行的行高交给名字决定，正文自然贴到名字底下，只余它自己那点 `marginTop`。 */}
      <div style={{ position: "relative", width: 38 }}>
        <div
          style={{
            position: "absolute",
            /* 槽不写高度（见上注）。头像**写死 38×38、贴槽左上角**（草稿 `.av` 同款），
               不再内缩 1px——那一圈白边本身就画在 38 里，不必再让位。 */
            top: 0,
            left: 0,
            width: 38,
            height: 38,
            /* 草稿 .av 同款：白底、圆角 12（方圆角，不是正圆）、一圈细白边＋淡影，
               首字（无头像时）用宋体雾蓝。 */
            borderRadius: 12,
            background: "#FFF",
            color: C.accent,
            border: "1px solid rgba(255,255,255,.75)",
            boxShadow:
              (item.pinnedByUser
                ? `0 0 0 2px ${C.accent}, `
                : "") +
              "0 1px 2px rgba(58,65,73,.07), inset 0 1px 0 rgba(255,255,255,.95)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: SERIF,
            overflow: "hidden",
          }}
        >
          {item.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.avatar}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            item.name.charAt(0)
          )}
        </div>
      </div>
      {/* ── 右列（`gridColumn: 2`）：照草稿 `.m-eh` 那一行排法——
             左边一摞是 **名字 ＋ 时间**（`.ehx`：名字宋体 15/600 字距 .08em，
             时间等宽 9.5 垫在名字底下），
             右端依次是 **可见范围**（`.m-vis`，只有我发的才有）与 **「⋯」**（`.m-more`）。
             「⋯」点开＝小菜单：我发的 → 删除；TA 的 → 标重要／取消重要。 ── */}
      <div
        style={{
          gridColumn: 2,
          display: "flex",
          /* 草稿 `.m-eh{align-items:center;gap:12}`：这一行里头像、名字、范围、`⋯`
             按**中线**对齐，右边那两枚不再顶在名字字首那条线上。 */
          alignItems: "center",
          gap: 12,
          minWidth: 0,
        }}
      >
        {/* `.ehx`：名字 ＋ 时间竖成一摞，占满中间、能省略号收尾。 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              /* ── **名录式的名号**（草稿 .m-enm 同款）：宋体、15/600、字距 .08em、
                     **墨色**——名录里名字的分量靠字号与字重，颜色跟正文同一支墨。 ── */
              fontFamily: SERIF,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: ".08em",
              color: C.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.name}
          </span>
          {/* 时间回到名字底下（草稿 `.m-etime` 的位子）。 */}
          <MomentStamp iso={item.createdAt} />
        </div>

        {/* `.m-vis`：可见范围（只有我发的才有）。2026-10-13 起这枚记号**自己就是开关**——
            一颗细描线小爱心（照草稿），点它开「谁可以看」底单，改完立刻落库（跟微信一样）。 */}
        {item.isSelf ? (
          <button
            type="button"
            className="mp-act no-callout"
            aria-label={`谁可以看：${visLabel}`}
            onClick={() => onOpenVis(item)}
            style={{
              flex: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 10.5,
              letterSpacing: ".06em",
              color: C.ink2,
            }}
          >
            <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true"
              style={{ color: C.accent, stroke: "currentColor", fill: "none", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <path d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6c0 5-7 9.4-7 9.4z" />
            </svg>
            {visLabel}
          </button>
        ) : null}

        {/* `.m-more`：一枚「⋯」——2026-10-13 起点它**只把这条交给上层**，
            由上层弹页面级的「这条动态」底单（我发的 → 编辑／删除；TA 的 → 标重要）。
            原来的小下拉放这儿会被信息流的滚动框裁掉，故不再自己渲菜单。 */}
        <button
          type="button"
          aria-label="更多"
          aria-haspopup="menu"
          onClick={() => onMore(item)}
          style={{ ...MORE_BTN, flex: "none" }}
        >
          ⋯
        </button>
      </div>

      {/* ── 2026-10-13 对齐草稿（`.m-etxt`）：正文**跨两列**（`1 / -1`），
           **左沿跟头像对齐**——不再缩进到名字那条线（真机截图里「测试」缩着就是这个）。
           字号收到 `14`、行距 `1.82`、字距 `.02em`，`marginTop` 给 `11`：
           正文跨列后要跟上面那行头像拉开一点空，不然贴着头像下沿发挤。 ── */}
      {item.content.trim() ? (
      <div
        style={{
          gridColumn: "1 / -1",
          marginTop: 11,
          fontSize: 14,
          fontFamily: SERIF,
          lineHeight: 1.82,
          letterSpacing: ".02em",
          color: C.ink,
          whiteSpace: "pre-line",
        }}
      >
        {item.content}
      </div>
      ) : null}

      {/* 我发的：正文底下摊自定义标签（`#词` 小 chip，2026-10-04）。
          2026-10-13 对齐草稿：标签跟正文同一条左沿——**跨两列**。 */}
      {item.isSelf && item.tags && item.tags.length > 0 ? (
        <div style={{ gridColumn: "1 / -1", marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {item.tags.map((t) => (
            <span
              key={t}
              style={{ padding: "2px 9px", borderRadius: 999, background: C.accentSoft,
                       color: C.accent, fontSize: 11, letterSpacing: ".02em" }}
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      {/* 配图区（2026-10-13 改九宫格）：有图 → 方格子网格（1 张＝一个大方格；2／3 张＝
          一排三个；4 张＝四宫格 2×2；5 张往上＝一排三个接着往下排），点开＝全屏看大图；
          TA 的还能长按重画。没图但写了画面描述 → 摊一个「文字框」，点一下才去画。 */}
      {momentImgs.length > 0 ? (
        <div
          style={{
            /* 跟原先那张相纸一个宽度口径：右缘离右列 20px，左缘跟名字、正文同一条竖线。 */
            gridColumn: "1 / -1",
            marginTop: 16,
            width: "calc(100% - 20px)",
            display: "grid",
            gridTemplateColumns: momentImgs.length === 4 ? "1fr 1fr" : "1fr 1fr 1fr",
            gap: 8,
          }}
        >
          {momentImgs.map((ref) => (
            <div key={ref} style={momentImgs.length === 1 ? { gridColumn: "span 2" } : undefined}>
              <MomentThumb
                refStr={ref}
                pressHandlers={item.isSelf ? undefined : imagePressHandlers}
                generating={generating && !item.isSelf}
                onOpen={(src, r) => {
                  /* 长按那一下松手会补一发 click，吃掉它，别把大图顺手弹出来。 */
                  if (longFired.current) {
                    longFired.current = false;
                    return;
                  }
                  onOpenImage(src, r);
                }}
              />
            </div>
          ))}
        </div>
      ) : item.imageText ? (
        /* ── 「文字描述当图」：我没画真图，这段描述**就当这张图**。
             摊一张跟相纸同一副样子的白纸，里头印着这段话（跟发布前那张预览卡一个样）。
             它**不是**一张能被点开／长按重画的图——它就是「这张图」本身，静态摆着。 ─ */
        <div
          style={{
            gridColumn: "1 / -1",
            marginTop: 16,
            width: "calc(100% - 20px)",
            padding: 7,
            borderRadius: 10,
            background: "#FFF",
            boxShadow:
              "0 0 0 1px rgba(20,19,24,.06), 0 1px 0 rgba(20,19,24,.045), 0 14px 28px -16px rgba(20,19,24,.38)",
          }}
        >
          <div
            style={{
              padding: "13px 12px",
              minHeight: 96,
              background: "rgba(231,236,242,.5)",
              border: "1px dashed rgba(20,19,24,.14)",
              borderRadius: 8,
              fontSize: 13.5,
              lineHeight: 1.85,
              letterSpacing: ".01em",
              color: C.ink2,
              fontFamily: SANS,
              whiteSpace: "pre-line",
              boxSizing: "border-box",
            }}
          >
            {item.imageText}
          </div>
        </div>
      ) : item.imagePrompt ? (
        /* ── 画面描述框：没图的时候不摆一枚灰扑扑的按钮，把 TA 写的那段原话
              **摊成一个框**——看得见、改得动，点了才去画（跟「确认了才花钱」同一个头）。

              不要参考图那两个零件：骑在框边上的 `SCENE · 画面描述` 药丸、
              居中拉字距的破折号注脚——那是人家的零件。
              只留一手全世界排版都在用的**公用件**：框里那段字左边压一条粉竖线、字整体
              右移——横排中文里，一条竖线就把一段话从「一段字」变成「一句被引的话」。
              虚线仍是**中性**的（粉虚线压在透粉的页底上会发脏）。
              圆角 3（跟卡同一套），底仍是那支**粉白**——卡本身已经是纯白，
              粉白压白，框还是框。 ── */
        <div style={{ gridColumn: "1 / -1", marginTop: 16 }}>
          <button
            type="button"
            className="mp-act"
            disabled={generating}
            aria-label="按这段画面描述生成配图"
            onClick={() => onEditPrompt(item)}
            style={{
              display: "block",
              width: "100%",
              padding: "14px 13px 12px",
              textAlign: "left",
              border: "1px dashed rgba(20,19,24,.14)",
              borderRadius: 10,
              background: "rgba(231,236,242,.5)",
              cursor: generating ? "not-allowed" : "pointer",
              fontFamily: SANS,
            }}
          >
            <span
              style={{
                display: "block",
                paddingLeft: 10,
                borderLeft: "2px solid rgba(90,115,145,.35)",
                fontSize: 13.5,
                lineHeight: 1.85,
                letterSpacing: ".01em",
                color: C.ink2,
                whiteSpace: "pre-line",
              }}
            >
              {item.imagePrompt}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 9,
                fontSize: 10,
                letterSpacing: ".06em",
                color: C.ink3,
              }}
            >
              {generating ? (
                <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
              ) : null}
              {generating ? "正在画…" : "点一下 · 按这段画配图"}
            </span>
          </button>
        </div>
      ) : null}

      {/* ── 2026-10-13 换皮：原「时间戳落在内容末尾」那枚已撤——
             草稿 `minimal-style-samples.html` 把时间摆在**名字底下**（`.m-etime`），
             见右列 `.ehx` 里那枚 `MomentStamp`。 ── */}

      {/* ── 名录式的条目不另压条目内的署名线（2026-10-13 换皮）：
            条与条之间的那条发丝线由样式块 `.mp-feed > article + article::before` 给，
            条目内部「内容」与「互动行」之间就不再多一条线——留白自己会说。 ── */}

      {/* ── 互动行＝这张卡的**署名行**：照草稿 `.m-acts`——只有两枚**带字**的键：
             `Like`（心 ＋ 字）与 `Comment`（话 ＋ 字）。
             转发那枚（草稿里没有），以及右端旧有的「可见范围 ＋ 删除」，都收走了：
             可见范围挪进右列名字行（`.m-vis`），删除收进「⋯」菜单（`.m-more`）。 ── */}
      <div
        style={{
          /* **跨两列**（`1 / -1`）：署名行是**卡宽**的，不跟正文一起缩进。 */
          gridColumn: "1 / -1",
          marginTop: 13,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <button
          type="button"
          className="mp-act"
          aria-label={likedByMe ? "取消赞" : "点赞"}
          aria-pressed={likedByMe ? true : false}
          onClick={() => onToggleLike(item)}
          style={ACT_BTN(likedByMe)}
        >
          <Heart size={15} strokeWidth={1.6} fill={likedByMe ? "currentColor" : "none"} />
          {likedByMe ? "Liked" : "Like"}
        </button>
        <button
          type="button"
          className="mp-act"
          aria-label="评论"
          aria-pressed={composing ? true : false}
          onClick={() => {
            setComposing((v) => !v);
            setAtOpen(false);
          }}
          style={ACT_BTN(composing)}
        >
          <MessageCircle size={15} strokeWidth={1.6} />
          Comment
        </button>
      </div>

      {/* ── 评论框（点了话那枚才摊开）：回复提示 ＋ @ 选人 ＋ 一枚输入药丸 ＋ 发送。
             平铺评论直接发；点了某条评论的「回复」会在输入框上方报一声「正在回复 X」，
             发出去就挂在 X 底下（艾特出来的那一层）。 ── */}
      {composing ? (
        <div style={{ gridColumn: "1 / -1", marginTop: 10 }}>
          {replyTo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7,
                          fontSize: 11, color: C.ink3, letterSpacing: ".03em" }}>
              <span>
                正在回复 <span style={{ color: C.ink2 }}>{replyTo.byName}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setReplyTo(null);
                  setMentionIds([]);
                }}
                style={COMMENT_REPLY_BTN}
              >
                取消
              </button>
            </div>
          ) : null}
          {atOpen ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {friends.length === 0 ? (
                <span style={{ fontSize: 11.5, color: C.ink3 }}>还没有能 @ 的人</span>
              ) : (
                friends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => addMention(f)}
                    style={pickChip(mentionIds.includes(f.id))}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              aria-label="提到某人"
              onClick={() => setAtOpen((v) => !v)}
              style={{ ...ICON_BTN, color: atOpen ? C.accent : C.ink3 }}
            >
              <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600 }}>@</span>
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendComment();
              }}
              placeholder="说点什么…"
              style={COMMENT_INPUT}
            />
            <button
              type="button"
              onClick={sendComment}
              disabled={!draft.trim()}
              style={COMMENT_SEND(!!draft.trim())}
            >
              发送
            </button>
          </div>
        </div>
      ) : null}

      {/* ── 赞行 ＋ 评论区（2026-10-05）：微信那种「一块浅底」摊在署名行下面——
             赞在上、评论在下，中间一条极淡的分隔；二级回复缩进一层。
             只有真有人赞／评了才摊这块底，空着就什么都不加。 ── */}
      {hasSocial ? (
        <div
          style={{
            gridColumn: "1 / -1",
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(20,19,24,.033)",
          }}
        >
          {likes.length > 0 ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Heart
                size={12}
                strokeWidth={1.8}
                fill={C.accent}
                color={C.accent}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <span style={{ fontSize: 12.5, lineHeight: 1.7, color: C.ink2,
                             letterSpacing: ".01em", minWidth: 0, wordBreak: "break-word" }}>
                {likes.map((l) => l.byName).join("，")}
              </span>
            </div>
          ) : null}

          {likes.length > 0 && comments.length > 0 ? (
            <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
          ) : null}

          {rootComments.map((c) => {
            const replies = comments.filter((r) => r.replyToId === c.id);
            return (
              <div key={c.id} style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.75, color: C.ink2,
                              letterSpacing: ".01em", wordBreak: "break-word" }}>
                  <span style={{ color: C.ink, fontWeight: 500 }}>{c.byName}</span>
                  <span style={{ color: C.ink3 }}>：</span>
                  <CommentBody content={c.content} />
                  <button type="button" onClick={() => startReply(c)} style={COMMENT_REPLY_BTN}>
                    回复
                  </button>
                </div>
                {replies.map((r) => (
                  <div key={r.id} style={{ marginLeft: 14, marginTop: 3, fontSize: 12.5,
                                           lineHeight: 1.75, color: C.ink2,
                                           letterSpacing: ".01em", wordBreak: "break-word" }}>
                    <span style={{ color: C.ink, fontWeight: 500 }}>{r.byName}</span>
                    <span style={{ color: C.ink3 }}>：</span>
                    <CommentBody content={r.content} />
                    <button type="button" onClick={() => startReply(r)} style={COMMENT_REPLY_BTN}>
                      回复
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
