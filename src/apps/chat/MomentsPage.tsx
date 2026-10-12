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
 * 【通知】**封面下沿那枚玻璃气泡**（2026-10-05 接真渠道回来了）：**只收「角色对你做的事」**
 * ——角色赞／评论／回复我的动态时，引擎 `lib/chat/moment-social.ts` 往
 * `lib/chat/moments-notice.ts` 那个仓库推一条，这一页读出来、按 `moments-seen-at`
 * 算未读、滤掉人已不在页上的几条，摆成气泡。**角色自己发新帖不算我的通知。**
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
  ChevronRight,
  Download,
  Globe,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  Share2,
  Settings,
  Smartphone,
  SquarePen,
  Star,
  Trash2,
  Type as TypeIcon,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AVATAR_GRADIENT, SANS, SERIF, T, momentFullTime, momentTime } from "./shared";
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
  getSelfMoments,
  removeSelfMoment,
  saveChatPrefs,
  saveMomentsCover,
  setMomentComments,
  setMomentImagePrompt,
  setMomentLikes,
  setMomentPinned,
  setSelfMomentComments,
  setSelfMomentLikes,
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
import { kickMomentSocial } from "@/lib/chat/moment-social";

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
  /** 这条动态的赞（我／任何角色）。缺省＝还没人赞。 */
  likes?: MomentLike[];
  /** 这条动态的评论（含二级回复）。缺省＝还没人评。 */
  comments?: MomentComment[];
}

/** 封面里的字色：封面是**浅**马卡龙底（粉→香芋→蓝），白字压不住（对比度不到 1.5:1），
    所以封面内一律用这枚**深梅色**——比纯黑暖，落在粉底上像印上去的。 */
const COVER_INK = "#5B2A40";

/** 互动那两枚图标按钮的底样（心／话共用）：无底、无框，就一枚图标。 */
const ICON_BTN: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: T.ink3,
  cursor: "pointer",
};

/** 评论输入框（评论区里内联那一只）：一枚药丸，跟聊天输入框同一口气。 */
const COMMENT_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${T.line}`,
  background: "#fff",
  borderRadius: 999,
  padding: "6px 12px",
  fontFamily: SANS,
  fontSize: 12.5,
  letterSpacing: ".01em",
  color: T.ink,
  outline: "none",
};

/** 评论「发送」按钮：有内容才亮（粉底白字），空着就是一枚灰。 */
const COMMENT_SEND = (on: boolean): CSSProperties => ({
  border: "none",
  background: on ? T.pink : "rgba(20,19,24,.10)",
  color: on ? "#fff" : T.ink3,
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
  color: T.ink3,
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

/** 发动态里「可见范围」三选一（图标 ＋ 文案）。 */
const VISIBILITY_OPTIONS: { key: MomentVisibility; label: string; icon: typeof Globe }[] = [
  { key: "public", label: "公开", icon: Globe },
  { key: "private", label: "私密", icon: Lock },
  { key: "partial", label: "部分可见", icon: Users },
];

/** 「部分可见」里「世界／角色」那种勾选 chip 的底样（选中＝粉底粉字）。 */
const pickChip = (on: boolean): CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 999,
  border: `1px solid ${on ? "rgba(232,106,155,.5)" : T.line}`,
  background: on ? T.pinkSoft : "rgba(20,19,24,.04)",
  color: on ? T.pink : T.ink2,
  fontFamily: SANS,
  fontSize: 12,
  letterSpacing: ".04em",
  cursor: "pointer",
});

/* ⚠︎ 这里原本有个 `paperTilt(uid)`——按 uid 算死一个 ±0.5° 的微斜角，专给相纸用。
   2026-09-22 恩熙说「**照片不要有倾斜，就是正常的照片就好**」，那一处用法已撤，
   函数本身没有第二个调用者，于是**一并删掉**（留着只会变成没人认领的死代码）。 */

export default function MomentsPage({
  archives,
  conversations,
  maskId,
  maskName,
  maskAvatar,
  signature,
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
  showToast: (msg: string) => void;
}) {
  /* 我发过的动态：按面具读一册（跟 TA 的动态分开存，见 settings/chat.ts 的 self。）。
     存进来之后跟 TA 的一起摊进同一条信息流。 */
  const [selfMoments, setSelfMoments] = useState<SelfMoment[]>([]);
  useEffect(() => {
    let alive = true;
    /* 我这一册动态会被好几处改：我发／删、我在别处手动赞评、以及 `moment-social`
       那边角色来赞我（它会广播 `moments-updated`）。所以不能只读一次——
       跟着事件重读，页面上的赞名单／通知才跟得上。 */
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
      imageRef: m.imageRef,
      imageText: m.imageText,
      tags: m.tags,
      visibility: m.visibility ?? "public",
      visibleNames: visibleNamesOf(m),
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
  const [viewer, setViewer] = useState<{ src: string; ref?: string } | null>(null);

  /* 「生成配图」先弹的描述卡（看得见、改得动，确认了才花钱）。
     生成这件事抬到这一层：弹层是卡片流的兄弟节点，不会被那个滚动容器裁掉。 */
  const [editor, setEditor] = useState<{ item: FeedItem; text: string } | null>(null);
  /* 生图进度登记在 `moment-image` 的登记表里：状态挂在页面里，页面一卸就丢，
     画图那趟请求其实还在跑。这里订阅它，登记表一变就重渲染，
     下面逐条去问「这一条在不在画」。 */
  const [, setGenTick] = useState(0);
  useEffect(() => subscribeMomentImage(() => setGenTick((n) => n + 1)), []);

  /* ── 通知气泡（2026-10-05 接真渠道）。**只收「角色对我做的事」**：
        角色赞／评论／回复我的动态时，引擎（`moment-social.ts`）会往
        `moments-notice.ts` 那个仓库推一条；这里读出来，只留**上次看动态页之后**的
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

  /* ── 发动态（2026-10-04）：底部弹层的那份草稿（正文／配图／标签／可见范围）。null＝没开着。
        `imageRef` 是相册选来的图的仓库引用串（2026-10-05 起支持配图）。 ── */
  const [composer, setComposer] = useState<{
    text: string;
    imageRef?: string;
    imageText?: string;
    tags: string[];
    tagDraft: string;
    visibility: MomentVisibility;
    visibleTo: string[];
    visibleWorlds: string[];
  } | null>(null);

  /* 「配图」那枚按钮点开之后：先问图从哪来——`seals`＝四枚章的那面墙（相册／拍照／
     小手机相册／文字描述）；`text`＝写文字描述的子面板。null＝没开着。
     跟草稿同生共死：关弹层、发布完都收回。 */
  const [imgPick, setImgPick] = useState<null | "seals" | "text">(null);
  /* 文字描述的那份草稿（子面板里写的那段话）——确认了才落进 composer.imageText。 */
  const [textDraft, setTextDraft] = useState("");
  /* 发布中（开关开着时「文字描述」要先画真图、画完才落库）——挡住重复点。 */
  const [publishing, setPublishing] = useState(false);

  /* 草稿里那张配图的地址（引用串 → 能喂 <img> 的地址；没选图就是 undefined）。 */
  const composerSrc = useMediaSrc(composer?.imageRef);

  /* 选图那个藏起来的 `<input type="file">`（iOS 只认用户手势触发的 `.click()`）。 */
  const composerInput = useRef<HTMLInputElement | null>(null);

  /* 选好一张配图：压图进仓库 → 引用串写进草稿；换图时把旧图回收掉。
     选了真图就把「文字当图」那份清掉——一张动态只留一种配图。 */
  const pickComposerImage = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const stored = await persistImageAsset(url);
      if (!stored) {
        showToast("这张图读不出来，换一张试试");
        return;
      }
      const previous = composer?.imageRef;
      if (previous) releaseImageAsset(previous);
      setComposer((c) => (c ? { ...c, imageRef: stored.ref, imageText: undefined } : c));
      setImgPick(null);
      setTextDraft("");
    } catch {
      showToast("图片没读进来，再试一次");
    } finally {
      URL.revokeObjectURL(url);
    }
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

  /* 文字描述确认落成「这张图」：把已选的真图回收掉（两边只能留一边）。 */
  const applyComposerText = () => {
    const t = textDraft.trim();
    if (!t) {
      showToast("写点画面描述再确认");
      return;
    }
    const previous = composer?.imageRef;
    if (previous) releaseImageAsset(previous);
    setComposer((c) => (c ? { ...c, imageRef: undefined, imageText: t } : c));
    setImgPick(null);
    setTextDraft("");
  };

  /* 拿掉配图（真图没人引用了就回收；文字当图直接清掉，不然仓库只进不出）。 */
  const removeComposerImage = () => {
    const previous = composer?.imageRef;
    if (previous) releaseImageAsset(previous);
    setComposer((c) => (c ? { ...c, imageRef: undefined, imageText: undefined } : c));
    setImgPick(null);
    setTextDraft("");
  };

  /* 关掉弹层：草稿里若选过图、又没发布，那张图没人引用——顺手回收掉。 */
  const closeComposer = () => {
    const ref = composer?.imageRef;
    if (ref) releaseImageAsset(ref);
    setComposer(null);
    setImgPick(null);
    setTextDraft("");
  };

  /* 往里加一个标签：去掉开头的 # 与首尾空格，重复就不再加。 */
  const addTag = () => {
    if (!composer) return;
    const t = composer.tagDraft.trim().replace(/^#+/, "");
    if (!t || composer.tags.includes(t)) {
      setComposer({ ...composer, tagDraft: "" });
      return;
    }
    setComposer({ ...composer, tags: [...composer.tags, t], tagDraft: "" });
  };

  /* 「部分可见」勾人。 */
  const toggleVisibleTo = (id: string) => {
    if (!composer) return;
    const on = composer.visibleTo.includes(id);
    setComposer({
      ...composer,
      visibleTo: on ? composer.visibleTo.filter((x) => x !== id) : [...composer.visibleTo, id],
    });
  };

  /* 「部分可见」勾一整个世界（整批可见，跟着世界的名单走）。 */
  const toggleVisibleWorld = (id: string) => {
    if (!composer) return;
    const on = composer.visibleWorlds.includes(id);
    setComposer({
      ...composer,
      visibleWorlds: on
        ? composer.visibleWorlds.filter((x) => x !== id)
        : [...composer.visibleWorlds, id],
    });
  };

  /* 发布：正文与配图至少有一个才发（纯图、纯文字、图文都行）；落库之后重读这一册。
     带着「文字描述」时看动态设置里那枚「配图自动生成」——
     关着（默认）＝这段描述**就当这张图**（落 imageText，TA 认为它是一张图片）；
     开着＝先把描述交给生图接口画成真图（落 imageRef），画不成再退回文字当图。 */
  const publishSelf = async () => {
    if (!composer || publishing) return;
    const text = composer.text.trim();
    const imageRef0 = composer.imageRef;
    const imageText0 = imageRef0 ? undefined : composer.imageText?.trim();
    if (!text && !imageRef0 && !imageText0) {
      showToast("写点什么或配张图再发");
      return;
    }
    const draft = composer;
    let finalRef = imageRef0;
    let finalText = imageText0;
    setPublishing(true);
    try {
      if (!finalRef && finalText) {
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
              finalRef = stored.ref;
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
        imageRef: finalRef,
        imageText: finalText,
        tags: draft.tags,
        visibility: draft.visibility,
        visibleTo: draft.visibleTo,
        visibleWorlds: draft.visibleWorlds,
      });
      setSelfMoments(await getSelfMoments(maskId));
      /* 刚发的这条立刻摇一下引擎：给看得见的人排上「过 2～15 分钟来赞」那件，
         别干等下一分钟那一轮 tick（引擎自带首跑标记与去重，摇多少次都只排一次）。 */
      kickMomentSocial();
      setComposer(null);
      setImgPick(null);
      setTextDraft("");
      showToast("发出去了");
      /* 带真图：发布后异步让 TA 看一眼、写下「图里是什么」——失败静默，不影响这条动态。
         文字当图那条不用看图：那段描述本身就已经是 TA 眼里这张图的内容。 */
      if (finalRef) void describeSelfMomentImage(maskId, saved.id, finalRef);
    } catch {
      /* 落库没成：这趟新画的图没人引用，回收掉，不然仓库只进不出。 */
      if (finalRef && finalRef !== imageRef0) releaseImageAsset(finalRef);
      showToast("没发出去，再试一次");
    } finally {
      setPublishing(false);
    }
  };

  /** 待删的那条动态：非空＝删除确认弹层开着（只有「我发的」才可能被放进来）。 */
  const [confirmDelete, setConfirmDelete] = useState<FeedItem | null>(null);

  /* ── 动态设置（2026-10-05）：动态页聚合了所有人，动态页里只留「我」发动态相关的配图设置。
        null＝弹层没开着。 ── */
  const [momentSet, setMomentSet] = useState<{
    autoImg: boolean;
    /** 「配图自动生成」用的生图接口：null＝跟随主图文 API（这一处自己填的那套）。 */
    imgApi: { baseUrl: string; apiKey: string; model: string } | null;
  } | null>(null);

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
  /* 选图那个 `<input type="file">`：iOS 上必须由用户手势触发 `.click()`，
     所以做成藏起来的 input ＋ 按钮去点它，而不是自己造选图界面。 */
  const coverInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    void getMomentsCover().then((ref) => {
      if (alive && ref) setCoverAsset(ref);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 选好图那一下：压图进仓库 → 引用串写进设定 → **把旧封面回收掉**
     （旧图没人引用了，不回收仓库就成了只进不出）。整段都可能失败，
     失败就说实话，旧封面原样留着——绝不因为换封面把原来的弄丢。 */
  const pickCover = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const stored = await persistImageAsset(url);
      if (!stored) {
        showToast("这张图读不出来，换一张试试");
        return;
      }
      const previous = coverAsset;
      setCoverAsset(stored.ref);
      await saveMomentsCover(stored.ref);
      if (previous && previous !== stored.ref) releaseImageAsset(previous);
      showToast("封面换好了");
    } catch {
      showToast("封面没存进去，再试一次");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /* 还原成默认那面马卡龙渐变。一旦能换就得能换回来，不然封面是条单行道。 */
  const clearCover = async () => {
    const previous = coverAsset;
    setCoverAsset("");
    await saveMomentsCover("");
    releaseImageAsset(previous);
    showToast("封面还原了");
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

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        /* 页底是「透粉的白」（跟聊天同一块板）：卡片浮在它上面 */
        background: T.bg,
        overflow: "hidden",
        fontFamily: SANS,
        color: T.ink,
      }}
    >
      <style>{`
        .mp-act { transition: opacity .16s ease; }
        .mp-act:active { opacity: .45; }
        /* 「配图」那四枚章（相册／拍照／小手机相册／文字描述）。
           ⚠️ 章的底与边**必须写在样式表里、不能写内联**：内联样式永远压过样式表，
           写内联的话下面「按下」那条规则一辈子不生效（聊天加号面板踩过同一个坑）。
           这是动态页自己的**浅色粉系**语言：白面／粉图标；按下整枚翻粉、图标转纸白。 */
        .mp-seal .mp-seal-face {
          width: 46px;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid rgba(232,106,155,.24);
          color: #E86A9B;
          background: #FFF;
          box-shadow: 0 6px 14px -10px rgba(20,19,24,.4);
          transition: background .16s ease, border-color .16s ease, color .16s ease;
        }
        /* 枚本身不再走 .mp-act 那层淡出——它翻粉，不需要再叠一层透明度。 */
        .mp-seal:active { opacity: 1; }
        /* 按下去那一瞬：整枚翻成粉底、边收掉、图标转纸白（图标走 currentColor，跟着变）。 */
        .mp-seal:active .mp-seal-face {
          border-color: transparent;
          color: #FFFDF8;
          background: linear-gradient(180deg, #E8709C 0%, #C9346A 100%);
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .mp-act { transition: none }
          .mp-seal .mp-seal-face { transition: none }
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
          setStuck(e.currentTarget.scrollTop > Math.max(0, coverH - 58));
        }}
        style={{
          /* `relative` 是**气泡的锚**：气泡挂在滚动格里面，才能跟着封面一起滚
             （见下面「动态通知气泡」那段注释）。 */
          position: "relative",
          width: "100%",
          height: "100%",
          overflowY: "auto",
          overscrollBehavior: "none",
          /* 雾不只在封面那一块：从**页顶**渗下来、到半页才化掉，整页是一口气。
             `backgroundAttachment: local` 让这层雾跟着内容走（钉在**页首**，
             不是钉在屏幕上）——往下滑就是干净的页底，雾留在它该在的顶上。
             封面自己的渐变底正好接在这层雾上面，「色块 + 白底」那道硬缝就这么没了。
             ⚠️ **封面下沿往下那一段（约 300～440px）保持可见的浓度**（`.5 → .34`）：
             封面到页底之间才是一段**柔和过渡**，不会在封面下沿切出一道硬边。
             ⚠️ 改这里**必须同步重算封面那两处化白渐变**的终点色（见下面封面注释）。 */
          backgroundColor: T.bg,
          backgroundImage:
            "linear-gradient(to bottom, rgba(243,220,230,.5) 0px, rgba(244,220,231,.5) 300px, rgba(246,229,238,.34) 440px, rgba(255,247,249,0) 640px)",
          backgroundAttachment: "local",
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
               底边**不留缝**：最底一截化进「页底那层透粉的雾在封面下沿处的颜色」——
               算出是 `rgba(249,234,240,1)`（页底 `T.bg` 上盖着滚动容器那层 **约 47%**
               的粉雾）。封面下沿那块颜色和下沿外一像素的颜色一模一样，所以是**化开**，
               不是「切一刀」。⚠️ **这枚值跟着上面容器那层雾的浓度走**——雾一改，必须重算。 ── */}
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
              /* 最底一截**化进封面下沿外的页底**（见上面那段注释那枚 `rgba(249,234,240,1)`）：
                 封面不是「贴在页面上的一块色」，而是从顶上渗下来、到自己散开。 */
              "linear-gradient(to bottom, rgba(249,234,240,0) 44%, rgba(249,234,240,1) 100%)," +
              "radial-gradient(150% 110% at 82% 4%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 58%)," +
              "linear-gradient(158deg,#F3DCE6 0%,#E7DCF0 44%,#DCE6F2 100%)",
            /* 通铺的一整面**不再「浮起来」**：三道白内边与那道深投影全撤。 */
            boxShadow: "none",
            /* 注意：**不能** `overflow: hidden`——下面那块身份区要**跨出封面下沿**去
               （头像一半在封面里、一半在封面外）。颗粒 svg 是 `inset: 0` 正正好一块，
               本来也不溢出，剪不剪都一样。 */
            overflow: "visible",
          }}
        >
          {/* 换过封面就走真照片：图**铺满整面**（`object-fit: cover`），
              上面压两层——
              ① 顶上一点白（`.34 → 0 @24%`）：压在封面里的顶栏图标与字是**深梅色**，
                 照片若是暗的，AD 那几个字就没了；这层白只护住最上面那一小截，
                 再往下就是照片本来的样子；
              ② 底下化进页底：用的是跟默认渐变**同一枚** `rgba(249,234,240,1)`，
                 所以「封面到哪儿为止」是**化开**的，不会忽然切一刀。 ── */}
          {coverSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverSrc}
                alt=""
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(to bottom, rgba(255,255,255,.34) 0%, rgba(255,255,255,0) 24%)," +
                    "linear-gradient(to bottom, rgba(249,234,240,0) 62%, rgba(249,234,240,1) 100%)",
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

          {/* ── 我是谁：头像**骑在封面的下沿上**——一半在封面里、一半落在封面外。
                 所以头像不是「封面里的一个元素」，而是**压在封面边缘上的一枚印**。
                 `top: calc(100% - 22px)`：60px 的头像**嵌进封面 38px、露在外面 22px**。
                 ⚠︎ 头像往上坐，下面的名字／签名也跟着上移 8px —— 信息流顶部留白
                 用 `108px` 补回来，别让它俩跟第一张卡贴住。
                 名字与签名跟着头像落到封面**外**，右对齐成一列——封面外的底是雾白的页底，
                 深梅色压在上面照样读得清，不用再垫白晕。 ── */}
          <div
            style={{
              position: "absolute",
              top: "calc(100% - 22px)",
              right: 18,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                flex: "none",
                width: 60,
                height: 60,
                /* 头像是**正圆**。卡是方框，人脸不是；
                   把方框的圆角收掉，跟把一张脸也削成方块，是两回事。 */
                borderRadius: "50%",
                background: AVATAR_GRADIENT,
                boxShadow:
                  "0 0 0 2px rgba(255,255,255,.92), 0 12px 24px -14px rgba(96,62,84,.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFF",
                fontSize: 21,
                fontWeight: 700,
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

            <div
              style={{
                marginTop: 9,
                maxWidth: 220,
                fontSize: 17,
                fontWeight: 500,
                fontFamily: SERIF,
                letterSpacing: ".1em",
                /* 封面外已经没有那块浅底了，字还是走**深梅色**——跟封面里的口吻同一套，
                   在雾白的页底上读得清。字重只给到 500：宋体一加粗就糊成黑块，
                   「高级」靠的是**细**和**空**，不是靠重。 */
                color: COVER_INK,
                textAlign: "right",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {maskName}
            </div>
            {signature.trim() ? (
              <div
                style={{
                  marginTop: 3,
                  maxWidth: 220,
                  maxHeight: 17,
                  overflow: "hidden",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                  letterSpacing: ".04em",
                  color: "rgba(91,42,64,.72)",
                  textAlign: "right",
                }}
              >
                {signature.trim()}
              </div>
            ) : null}
          </div>

          {/* 「换封面」：占左下角，跟右下的身份卡一左一右。
              点它开系统选图（藏起来的 `<input type="file">`，iOS 只认用户手势触发的
              `.click()`），选完压图进仓库、引用串写进设定。换过之后旁边多一枚「还原」——
              **一旦能换就得能换回来**，不然封面成了单行道。 */}
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              /* 选完立刻清空：同一张图连选两次也得能触发 onChange。 */
              e.target.value = "";
              if (file) void pickCover(file);
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 18,
              bottom: 30,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              type="button"
              className="mp-act"
              onClick={() => coverInput.current?.click()}
              style={COVER_PILL}
            >
              <ImageIcon size={12} strokeWidth={1.9} />
              换封面
            </button>
            {coverAsset ? (
              <button
                type="button"
                className="mp-act"
                onClick={() => void clearCover()}
                style={{ ...COVER_PILL, padding: "6px 12px", background: "rgba(255,255,255,.42)" }}
              >
                还原
              </button>
            ) : null}
          </div>
        </div>

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
              padding: "112px 24px 64px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 500, fontFamily: SERIF,
                           color: T.ink2, letterSpacing: ".1em" }}>
              暂时没有动态
            </span>
            <span style={{ fontSize: 11.5, color: T.ink3, letterSpacing: ".04em" }}>
              TA 发动态了会出现在这儿
            </span>
          </div>
        ) : (
          <div
            style={{
              padding: "108px 0 calc(var(--safe-area-bottom, 0px) + 34px)",
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            {feed.map((item) => (
              <MomentItem
                key={item.uid}
                item={item}
                generating={isMomentImageGenerating(item.conversationId, item.momentId)}
                showToast={showToast}
                onOpenImage={(src, ref) => setViewer({ src, ref })}
                onEditPrompt={(target) => {
                  /* 自动生图开着 → 直接画；关着 → 先摊描述卡看／改（看得见、改得动，确认了才花钱）。
                     长按已有的那张图走的是同一条路。 */
                  if (autoGen) void runGenerate(target, target.imagePrompt ?? "");
                  else setEditor({ item: target, text: target.imagePrompt ?? "" });
                }}
                onTogglePin={(target) => void togglePin(target)}
                friends={friends}
                onToggleLike={(target) => void toggleLike(target)}
                onSubmitComment={(target, text, mentions, replyToId) =>
                  void submitComment(target, text, mentions, replyToId)
                }
                onDelete={(target) => setConfirmDelete(target)}
              />
            ))}
          </div>
        )}

      {/* ── 动态通知气泡（2026-10-05 接真渠道回来了）：头像 ＋ 一行字 ＋ `›` 的玻璃胶囊。
             **只收「角色对我做的事」**——角色赞／评论／回复我的动态时，引擎往
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
                "inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.35), 0 0 0 .5px rgba(255,255,255,.6), 0 0 0 1px rgba(20,19,24,.04), 0 14px 26px -18px rgba(96,62,84,.45), 0 0 22px rgba(255,255,255,.55)",
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
                  background: AVATAR_GRADIENT,
                  color: "#FFFFFF",
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

      {/* ── 顶栏：压在封面里时**不显形**（全透明、深梅色图标与字），滚过封面下沿才落成
             一层粉白实底＋墨字＋一条发丝线。这样它既不是「贴在封面上的那条胶布」，
             滚出来之后又不会糊在正文上。只有 `stuck` 翻面那一帧才重画，滚动途中
             不跟着抖。 ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 6,
          height: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 52px)",
          paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px))",
          paddingLeft: 16,
          paddingRight: 16,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: stuck ? "rgba(255,247,249,.88)" : "transparent",
          backdropFilter: stuck ? "blur(14px)" : "none",
          WebkitBackdropFilter: stuck ? "blur(14px)" : "none",
          borderBottom: `1px solid ${stuck ? T.line : "transparent"}`,
          transition: "background .18s ease, border-color .18s ease",
        }}
      >
        {/* ── 标题：中文在上、英文小字在下（字距拉到 .3em）。
              名称与英文留在这两行里。
              但**期号不回来**（不要 `No. 00X` 那种）。 ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              fontFamily: SERIF,
              letterSpacing: ".16em",
              lineHeight: 1.2,
              color: stuck ? T.ink : COVER_INK,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            星绥动态
          </div>
          <div
            style={{
              fontSize: 8.5,
              letterSpacing: ".3em",
              lineHeight: 1.2,
              color: stuck ? T.ink3 : "rgba(91,42,64,.58)",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            STELLASEI MOMENTS
          </div>
        </div>

        {/* 发动态：顶栏右端一枚入口，点开底部弹层写正文／标签／可见范围（2026-10-04）。 */}
        <button
          type="button"
          className="mp-act"
          onClick={() =>
            setComposer({ text: "", tags: [], tagDraft: "", visibility: "public", visibleTo: [], visibleWorlds: [] })
          }
          aria-label="发动态"
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 5,
            height: 34,
            padding: "0 12px 0 10px",
            borderRadius: 11,
            border: `1px solid ${stuck ? "rgba(20,19,24,.12)" : "rgba(91,42,64,.18)"}`,
            background: stuck ? "rgba(20,19,24,.055)" : "rgba(255,255,255,.62)",
            color: stuck ? T.ink : COVER_INK,
            fontFamily: SANS,
            fontSize: 12,
            letterSpacing: ".06em",
            cursor: "pointer",
          }}
        >
          <SquarePen size={14} strokeWidth={1.9} />
          发动态
        </button>

        {/* 动态设置：顶栏最右一枚入口，点开底部弹层拨「发动态间隔」（2026-10-05，恩熙定位置）。 */}
        <button
          type="button"
          className="mp-act"
          onClick={() => void openMomentSet()}
          aria-label="动态设置"
          style={{
            flex: "none",
            width: 34,
            height: 34,
            borderRadius: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${stuck ? "rgba(20,19,24,.12)" : "rgba(91,42,64,.18)"}`,
            background: stuck ? "rgba(20,19,24,.055)" : "rgba(255,255,255,.62)",
            color: stuck ? T.ink : COVER_INK,
            cursor: "pointer",
          }}
        >
          <Settings size={16} strokeWidth={1.9} />
        </button>
      </div>

      {/* 配图放大层：点动态里那张图弹出来——大图 + 底下「保存图片」，点背景或右上角 X 关掉。
          大图特意放开原生长按（全局是禁掉的，见 globals.css）：手机端还能用系统菜单里的
          「存储图像／存储到照片」，跟聊天里点大图同一套手感。 */}
      {viewer ? (
        <div
          onClick={() => setViewer(null)}
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
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 78,
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: T.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "20px 18px calc(var(--safe-area-bottom, 0px) + 18px)",
              boxShadow: "0 -14px 44px -20px rgba(20,19,24,.5)",
            }}
          >
            <div style={{ fontSize: 15.5, fontWeight: 500, fontFamily: SERIF,
                          letterSpacing: ".1em", color: T.ink }}>
              画面描述
            </div>
            <div style={{ marginTop: 5, fontSize: 11.5, lineHeight: 1.7, color: T.ink3 }}>
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
                border: `1px solid ${T.line}`,
                background: "rgba(20,19,24,.04)",
                color: T.ink,
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
                  color: T.ink2,
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
                  background: T.pink,
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

      {/* 发动态：底部弹层——正文 ＋ 标签 ＋ 可见范围，点了「发布」才落库（2026-10-04）。
          `data-mp-scroll`：给上面那枚手势闸认，弹层自己滚得动、到头不拖整页。 */}
      {composer ? (
        <div
          onClick={closeComposer}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 80,
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            data-mp-scroll="1"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "calc(100% - 40px)",
              overflowY: "auto",
              overscrollBehavior: "none",
              background: T.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "20px 18px calc(var(--safe-area-bottom, 0px) + 18px)",
              boxShadow: "0 -14px 44px -20px rgba(20,19,24,.5)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 15.5, fontWeight: 500, fontFamily: SERIF,
                          letterSpacing: ".1em", color: T.ink }}>
              发动态
            </div>

            <textarea
              aria-label="动态正文"
              data-mp-scroll="1"
              value={composer.text}
              onChange={(e) => setComposer({ ...composer, text: e.target.value })}
              placeholder="这一刻，想说点什么…"
              rows={4}
              style={{
                marginTop: 12,
                width: "100%",
                minHeight: 96,
                maxHeight: 200,
                resize: "none",
                padding: "11px 12px",
                borderRadius: 12,
                border: `1px solid ${T.line}`,
                background: "rgba(20,19,24,.04)",
                color: T.ink,
                fontFamily: SANS,
                fontSize: 13.5,
                lineHeight: 1.7,
                letterSpacing: ".02em",
                outline: "none",
                boxSizing: "border-box",
              }}
            />

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
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  /* 选完立刻清空：同一张图连选两次也得能触发 onChange。 */
                  e.target.value = "";
                  if (file) void pickComposerImage(file);
                }}
              />
              {composer.imageRef || composer.imageText ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  {composer.imageRef ? (
                    composerSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={composerSrc}
                        alt="配图"
                        style={{
                          display: "block",
                          width: 108,
                          height: 108,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: `1px solid ${T.line}`,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 108,
                          height: 108,
                          borderRadius: 10,
                          border: `1px solid ${T.line}`,
                          background: "rgba(20,19,24,.04)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: T.ink3,
                        }}
                      >
                        <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                      </div>
                    )
                  ) : (
                    /* 文字当图：摊一张相纸，里头印着这段描述（跟发布后卡片上那张同一副样子）。 */
                    <div
                      style={{
                        width: 128,
                        minHeight: 108,
                        padding: 7,
                        borderRadius: 3,
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
                          background: "rgba(255,247,249,.92)",
                          border: "1px dashed rgba(20,19,24,.14)",
                          borderRadius: 2,
                          fontSize: 10.5,
                          lineHeight: 1.6,
                          color: T.ink2,
                          fontFamily: SANS,
                          whiteSpace: "pre-line",
                        }}
                      >
                        {composer.imageText}
                      </div>
                    </div>
                  )}
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
              ) : imgPick === "text" ? (
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
                      border: `1px solid rgba(232,106,155,.4)`,
                      background: "rgba(255,247,249,.92)",
                      color: T.ink,
                      fontFamily: SANS,
                      fontSize: 13,
                      lineHeight: 1.7,
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
                        color: T.ink2,
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
                        background: T.pink,
                        color: "#FFF",
                        fontFamily: SANS,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      就这张
                    </button>
                    <span style={{ flex: 1, fontSize: 10.5, lineHeight: 1.6, color: T.ink3,
                                   letterSpacing: ".03em" }}>
                      发布时按「配图自动生成」定：关着＝描述当图，开着＝先画真图。
                    </span>
                  </div>
                </div>
              ) : imgPick === "seals" ? (
                /* 四枚章：这张图从哪来。 */
                <div>
                  <div style={{ fontSize: 11, letterSpacing: ".08em", color: T.ink3 }}>
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
                        <span style={{ fontFamily: SANS, fontSize: 10.5, color: T.ink2,
                                       letterSpacing: ".03em" }}>
                          {row.title}
                        </span>
                      </button>
                    ))}
                  </div>
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
                    color: T.ink2,
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

            {/* 标签：已加的成一排小 chips，后面跟着输入框与「＋」。 */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", color: T.ink3 }}>标签</div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap",
                            alignItems: "center", gap: 6 }}>
                {composer.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "3px 6px 3px 9px",
                      borderRadius: 999,
                      background: T.pinkSoft,
                      color: T.pink,
                      fontSize: 11.5,
                      letterSpacing: ".02em",
                    }}
                  >
                    #{t}
                    <button
                      type="button"
                      aria-label={`删除标签 ${t}`}
                      onClick={() =>
                        setComposer({ ...composer, tags: composer.tags.filter((x) => x !== t) })
                      }
                      style={{ border: 0, background: "none", padding: 2, display: "flex",
                               color: T.pink, cursor: "pointer" }}
                    >
                      <X size={10} strokeWidth={2.2} />
                    </button>
                  </span>
                ))}
                <input
                  value={composer.tagDraft}
                  onChange={(e) => setComposer({ ...composer, tagDraft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="加个标签"
                  style={{
                    width: 88,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: `1px solid ${T.line}`,
                    background: "transparent",
                    color: T.ink,
                    fontFamily: SANS,
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  className="mp-act"
                  aria-label="添加标签"
                  onClick={addTag}
                  style={{ width: 26, height: 26, borderRadius: "50%",
                           border: `1px solid ${T.line}`, background: "rgba(20,19,24,.04)",
                           color: T.ink2, display: "flex", alignItems: "center",
                           justifyContent: "center", cursor: "pointer" }}
                >
                  <Plus size={13} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* 可见范围：公开／私密／部分可见三选一；部分可见时才摊出联系人勾选。 */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", color: T.ink3 }}>可见范围</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                {VISIBILITY_OPTIONS.map(({ key, label, icon: Icon }) => {
                  const on = composer.visibility === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="mp-act"
                      onClick={() => setComposer({ ...composer, visibility: key })}
                      style={{
                        flex: 1,
                        height: 38,
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 5,
                        border: `1px solid ${on ? "rgba(232,106,155,.5)" : T.line}`,
                        background: on ? T.pinkSoft : "rgba(20,19,24,.04)",
                        color: on ? T.pink : T.ink2,
                        fontFamily: SANS,
                        fontSize: 12.5,
                        letterSpacing: ".04em",
                        cursor: "pointer",
                      }}
                    >
                      <Icon size={13} strokeWidth={1.9} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {composer.visibility === "partial" ? (
                worlds.length === 0 && friends.length === 0 ? (
                  <div style={{ marginTop: 10, fontSize: 11.5, color: T.ink3, letterSpacing: ".04em" }}>
                    还没有可选的联系人
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    {worlds.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 11, letterSpacing: ".08em", color: T.ink3 }}>世界</div>
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {worlds.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              className="mp-act"
                              onClick={() => toggleVisibleWorld(w.id)}
                              style={pickChip(composer.visibleWorlds.includes(w.id))}
                            >
                              {w.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {friends.length > 0 ? (
                      <div style={{ marginTop: worlds.length > 0 ? 12 : 0 }}>
                        <div style={{ fontSize: 11, letterSpacing: ".08em", color: T.ink3 }}>角色</div>
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {friends.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="mp-act"
                              onClick={() => toggleVisibleTo(f.id)}
                              style={pickChip(composer.visibleTo.includes(f.id))}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
              <button
                type="button"
                className="mp-act"
                onClick={closeComposer}
                style={{ flex: 1, height: 44, border: "none", borderRadius: 12,
                         background: "rgba(20,19,24,.06)", color: T.ink2, fontFamily: SANS,
                         fontSize: 13.5, letterSpacing: ".04em", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                type="button"
                className="mp-act"
                onClick={() => void publishSelf()}
                style={{ flex: "1.6", height: 44, border: "none", borderRadius: 12,
                         background: T.pink, color: "#FFF", fontFamily: SANS, fontSize: 13.5,
                         fontWeight: 600, letterSpacing: ".04em", cursor: "pointer", display: "flex",
                         alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <SquarePen size={14} />
                发布
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除动态：二次确认（2026-10-05）。就一枚居中卡片、两枚按钮——删掉连它的赞评
          一起从这一册消失（见 removeSelfMoment），所以先问一句，别点错。 */}
      {confirmDelete ? (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 84,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 40px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 300,
              background: T.card,
              borderRadius: 18,
              padding: "20px 18px 16px",
              boxShadow: "0 18px 50px -20px rgba(20,19,24,.5)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 14.5, fontWeight: 500, fontFamily: SERIF,
                          letterSpacing: ".08em", color: T.ink, textAlign: "center" }}>
              删除这条动态？
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, color: T.ink3,
                          textAlign: "center" }}>
              删掉就没了，它底下的赞和评论也一起走。
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="mp-act"
                onClick={() => setConfirmDelete(null)}
                style={{ flex: 1, height: 38, border: "none", borderRadius: 12,
                         background: "rgba(20,19,24,.06)", color: T.ink2, fontSize: 13,
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
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(20,19,24,.42)",
            zIndex: 82,
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            data-mp-scroll="1"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "calc(100% - 40px)",
              overflowY: "auto",
              overscrollBehavior: "none",
              background: T.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: "20px 18px calc(var(--safe-area-bottom, 0px) + 18px)",
              boxShadow: "0 -14px 44px -20px rgba(20,19,24,.5)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15.5, fontWeight: 500, fontFamily: SERIF,
                            letterSpacing: ".1em", color: T.ink }}>
                动态设置
              </div>
              <button
                type="button"
                className="mp-act"
                onClick={() => setMomentSet(null)}
                aria-label="关闭"
                style={{ width: 30, height: 30, border: "none", borderRadius: 10,
                         background: "rgba(20,19,24,.05)", color: T.ink2, display: "flex",
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
              <span style={{ fontFamily: SANS, fontSize: 13.5, color: T.ink }}>配图自动生成</span>
              <div
                role="switch"
                aria-checked={momentSet.autoImg}
                aria-label="配图自动生成"
                className="mp-act"
                onClick={toggleAutoMyMomentImage}
                style={{ width: 46, height: 27, borderRadius: 999,
                         background: momentSet.autoImg ? T.pink : "rgba(20,19,24,.12)",
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

            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.75, color: T.ink3,
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
                  <span style={{ fontFamily: SANS, fontSize: 13.5, color: T.ink }}>配图接口</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: T.ink3, letterSpacing: ".04em",
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
                      style={{ fontFamily: SANS, fontSize: 12, color: T.pink,
                               background: "none", border: "none", padding: "2px",
                               cursor: "pointer" }}
                    >
                      {imgApiEdit ? "收起" : "更改"}
                    </button>
                  </div>
                </div>

                {imgApiEdit ? (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 12,
                                background: "rgba(255,247,249,.72)",
                                border: "1px solid rgba(232,106,155,.16)" }}>
                    {imgPresets.length ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: T.ink3, marginBottom: 6,
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
                                       color: T.pink, background: "#fff",
                                       border: "1px solid rgba(232,106,155,.3)",
                                       borderRadius: 999, padding: "5px 11px",
                                       overflow: "hidden", textOverflow: "ellipsis",
                                       whiteSpace: "nowrap", cursor: "pointer" }}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.6,
                                      color: T.ink3, letterSpacing: ".04em" }}>
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
                        <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4,
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
                                   fontSize: 13, color: T.ink, background: "#fff",
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
                          style={{ fontFamily: SANS, fontSize: 12.5, color: T.ink3,
                                   background: "#fff", border: "1px solid rgba(20,19,24,.12)",
                                   borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
                        >
                          改回跟随主
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.7, color: T.ink3,
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
    /* `inherit`：这行小字以前是个 `<span>`，字体是从卡上继承来的；
       换成 `<button>` 之后**按钮不继承字体**，不写这句会变成系统 UI 字。 */
    fontFamily: "inherit",
    fontSize: 10,
    letterSpacing: ".08em",
    color: T.ink3,
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
          <span key={i} style={{ color: T.pink }}>
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
  showToast,
  onOpenImage,
  onEditPrompt,
  onTogglePin,
  friends,
  onToggleLike,
  onSubmitComment,
  onDelete,
}: {
  item: FeedItem;
  /** 这条的配图正在画（按钮转圈／图上盖一层；不给重复点）。 */
  generating: boolean;
  /** 条目里那枚「转发」还没有真数据，点了给个提示。 */
  showToast: (msg: string) => void;
  /** 点配图 → 放大预览（保存图片在那一层里）。 */
  onOpenImage: (src: string, ref?: string) => void;
  /** 要（重新）画这张配图 → 由上层分流（自动生图开＝直接跑；关＝先摊描述卡看／改）。 */
  onEditPrompt: (item: FeedItem) => void;
  /** 标／取消标「重要」——标了的那条永远原文留在 TA 的记忆里（见 setMomentPinned）。 */
  onTogglePin: (item: FeedItem) => void;
  /** @ 选人用的名单（跟信息流同一条过滤口径）。 */
  friends: { id: string; name: string }[];
  /** 点赞／取消赞（我自己那一下）。 */
  onToggleLike: (item: FeedItem) => void;
  /** 发评论：`replyToId` 有值＝挂在某条评论底下（艾特出来的那一层）。 */
  onSubmitComment: (
    item: FeedItem,
    content: string,
    mentions: string[],
    replyToId?: string,
  ) => void;
  /** 删「我」的这条动态（只有我发的才给这枚按钮）：由上层弹确认、落库。 */
  onDelete: (item: FeedItem) => void;
}) {
  const resolvedSrc = useMediaSrc(item.imageRef);

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
    /* ── 一条动态的排法：**一张方卡，头像也在卡里**。
         每一条是**一张编过排过的启事**：
         白纸、一圈深色细线、四角几乎直角、里面按层级一层层排下来。
         **圆是柔，方是编排**——这张卡之所以「不普通」，靠的不是形状多别致，
         是它每一层都被安排过（标签 → 大标题 → 正文 → 细线 → 署名行 → 右下脚注）。
         **封面的圆角和这里的圆角是两码事**：封面是那张圆的气泡（那是雾，不是纸）。
         逻辑一行没动：生图、长按重生成、存图、标「重要」、描述卡、放大层全照旧。 ── */
    <article
      style={{
        position: "relative",
        /* 卡**就长在 `article` 身上**（不另套一层 div）：一条动态＝一张卡。
           头像从卡**外面**挪进卡**里面**——左右边距因此对称，不再为左边留那条
           70px 的头像位。
           `border` 用**深色实线**（`.42`）而不是白高光：靠**一条清楚的边**把卡「框」住
           ——这是那张卡最要紧的一笔，撤了它就散了。
           里头那条分割线只有 `.09`，跟这条差了四倍多，「框」和「里面的线」一眼分得开。
           影子收得很轻：纸是**放在**页面上的，不是浮在页面上的（浮＝气泡那套，已撤）。

           **卡上那点颜色**：顶上这一段淡粉晕**有来由**——它就是封面那层粉**落下来的那一截**
           ——雾到卡这儿还没散完，往下自己化回白纸。所以它不是「贴上去的一条色带」，
           是同一口气的延续。深色细线、四角、轻影一律不动——骨架还是那张「编过排过的卡」。

           **怎么才不「脏」**：
           ① **脏在哪**：上一层色若用了**两支**（封面的粉 ＋ 封面的香芋），粉紫叠在白纸上，
              过渡那一段混出**灰紫**——像纸被抹了一下，不是被染了一下。所以**只用粉一支**，
              `#F3DCE6` 那一支、浓度 `.34`，**只把卡顶那一小截染上一点色**，
              到 70% 就干净地化没。**一支色不会脏，两支才会。**
           ② **立体感**：参考图那种「下面垫一层色」**不照搬**（那又是一枚借来的零件），
              要立体改用**纸叠纸**——卡里的相纸、卡里的白边都是「纸叠纸」，
              来由说得出来。
              ⚠︎ **往右下错开一块实色**那种垫子不算「用别种方式」，只换颜色也不行；
              现在整块垫子已撤，立体感改做「纸的厚度」（见下面 `boxShadow` 那段）。 ── */
        /* ── **卡里分两列**（2026-09-22 恩熙定的版）：左列＝**头像自己一列**，
             右列＝名字 → 时间（以后的「分组」也排这儿）→ 正文 → 配图，
             **全在头像右边的下方**（不再有东西落在头像底下）。
             用 `grid` 而不是「把内容套进一个 flex 右列」：这样**每个块都留在原地**，
             只需各自标一个 `gridColumn: 2`（一行的事，不用把整段往里缩一层）。
             `minmax(0, 1fr)` 的那个 `0` 是**收缩许可**——写成 `1fr`，长名字／长正文
             会把列顶宽、把卡撑破。
             块与块的间距仍由各自的 `marginTop` 给（9／16／15／12），这里**不加 `rowGap`**；
             底下的**分割线 ＋ 互动行**跨两列（`1 / -1`），还是一条**卡宽**的署名行。 ── */
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr)",
        columnGap: 11,
        alignItems: "start",
        margin: "0 16px",
        padding: "13px 15px 13px",
        borderRadius: 3,
        border: "1px solid rgba(20,19,24,.42)",
        background:
          /* 叠在最下面的是纯白 `#FFF`；上面那层是**封面那支粉**（`#F3DCE6`）的一小截，
             到 70% 干净化没——卡的下半仍是干净白纸，正文压在上面最好读。
             ⚠︎ 别再加第二支色，**两支一叠就会出灰紫，那就是「脏」**。

             卡是**底**，底得是星绥本来的粉；要「大胆」的地方是**细节**，
             不是这么大一块面。**大面守本分，细节上出手。** ── */
          "linear-gradient(180deg," +
          " rgba(243,220,230,.34) 0%," +
          " rgba(243,220,230,.18) 32%," +
          " rgba(255,255,255,0) 70%)," +
          " #FFFFFF",
        boxShadow:
          /* ── **立体感＝「这张纸的厚度」，不做「垫在下面的一块色」。**
               错位的那块实色撤掉，立体感改由两件事给：
               ① `inset 0 -3px 0 rgba(201,222,240,.9)`——**卡内侧底沿一条蓝**：纸被切开看得到的
                  **芯**。它是**厚度**，不是**影子**——厚度在卡**里面**，影子才在卡**外面**。
                  而且**这一笔正好就是「在一点细节上面用不同的颜色」**：卡面守住本来的粉，
                  那支蓝只在底下露 3px。**大胆不是把底换掉，是在边上点一笔。**
               ② `0 14px 24px -18px rgba(58,96,140,.42)`——一道**压得很深的蓝调柔影**（不是实色块，
                  没有边），把卡从页面上**托住**，但不「浮起来」（浮＝气泡那套，早撤了）。
               ③ 那道 `0 1px 2px rgba(20,19,24,.04)` 贴着卡边收一下。
               **别再往卡外面加错位的色块**——那是参考图的零件，不是星绥的。 ── */
          "inset 0 -3px 0 rgba(201,222,240,.9), 0 1px 2px rgba(20,19,24,.04), 0 14px 24px -18px rgba(58,96,140,.42)",
      }}
    >
      {/* ── 右上角那枚**小书签**：表示「这条标了重要」（标了的那条永远原文留在 TA 的记忆里）。
             恩熙 2026-09-22 定的：「**然后我觉得这个重要应该要放在卡片的右上角，
             然后给它做成像一种 小书签的那种感觉吧。**」
             ⇒ 原先压在互动行右端的那枚「重要」标签条**搬到这儿**，并做成书签形：
             **下缘咬掉一个 V 口**（`clipPath`，真书签就是那个样子）。
             ── **颜色（恩熙 2026-09-22：「可不可以改成粉色的？也是淡淡的粉，
                或是淡淡的蓝这种」）**：整片的调子跟卡走**淡**的那一套——
                **没标＝淡蓝**（跟卡底下那道淡蓝的纸边同族，安静、不出声），
                **标了＝淡粉**（粉是这页唯一的「重要」色）。
                两档都淡，靠**色相**分状态，不靠深浅硬碰。 ──
             标了＝淡粉底 ＋ 实心主粉星；没标＝淡蓝底 ＋ 淡蓝空心星，
             位置却始终在这——所以它**既是显示、也是开关**（点一下标／取消标），
             **不必再来第二处**替它说话。
             ⚠︎ **整片夹在卡里、不探出卡外**：卡与卡挨得近，探出去会压到上一张。
             ⚠︎ 影子挂在**外层**：`filter` 在 `clipPath` **之前**生效，
             同一层写会被剪掉（V 口那儿会缺一块影）。 ── */}
      {/* 小书签＝「标重要」，只对 TA 的动态适用；我自己的那条不摆（2026-10-04）。 */}
      {item.isSelf ? null : (
      <button
        type="button"
        aria-label={item.pinnedByUser ? "取消重要" : "标为重要"}
        aria-pressed={item.pinnedByUser ? true : false}
        onClick={() => onTogglePin(item)}
        style={{
          position: "absolute",
          top: 0,
          /* `15`＝卡的左右内边距，书签右缘跟正文右缘站在同一条竖线上。 */
          right: 15,
          width: 19,
          height: 27,
          padding: 0,
          border: 0,
          background: "none",
          cursor: "pointer",
          /* 影也跟着走淡的那一套：粉的用粉影，蓝的用蓝影。 */
          filter: item.pinnedByUser
            ? "drop-shadow(0 3px 5px rgba(232,106,155,.30))"
            : "drop-shadow(0 2px 3px rgba(120,150,180,.28))",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 74%, 0 100%)",
            /* 淡粉／淡蓝（见上面那条注释：色相分状态，两档都淡）。 */
            background: item.pinnedByUser ? "#F8D7E5" : "#DCEAF8",
            color: item.pinnedByUser ? T.pink : "#9DBBD6",
          }}
        >
          {/* `translateY(-3)`：星往 V 口上面挪一点，才落在书签的「正身」里，不压到那个缺口。
              标了＝实心（`fill` 跟着 `color` 走），没标＝空心（只留那圈淡蓝描边）。 */}
          <Star
            size={11}
            strokeWidth={1.9}
            fill={item.pinnedByUser ? T.pink : "none"}
            style={{ transform: "translateY(-3px)" }}
          />
        </span>
      </button>
      )}
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
      <div style={{ position: "relative", width: 44 }}>
        <div
          style={{
            position: "absolute",
            /* ⚠︎ 这里**不能写 `inset: 1`**（2026-09-22 踩过）：槽不写高度之后是 0 高，
               `inset` 是靠父级尺寸算出来的 ⇒ 头像跟着变成 0 高，**整个头像就没了**。
               改成写死 42×42 ＋ `top/left: 1`——槽的 44 里四周各留 1px，
               头像照样不占布局（槽多矮都不影响它）。 */
            top: 1,
            left: 1,
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: AVATAR_GRADIENT,
            /* **框是一叠环 ＋ 一道影**（层次就从这儿来，别再挂小圆点）：
               `1.5px #FFF` 里圈白（把头像从卡上托起来）
               → `2.5px` 细粉（框线）
               → `5px` 一圈更宽的淡粉晕（框往外散出去，头像因此「坐」进去）
               → 底下一道柔影（往右下走一点，头像才离得开卡面）。
               标了「重要」的那条，外圈换成实心主粉，比挂「★ 重要」字样更打眼。 */
            boxShadow: item.pinnedByUser
              ? `0 0 0 1.5px #FFF, 0 0 0 3px ${T.pink}, 0 0 0 5px rgba(232,106,155,.16), 0 3px 8px -4px rgba(232,106,155,.45)`
              : "0 0 0 1.5px #FFF, 0 0 0 2.5px rgba(232,106,155,.42), 0 0 0 5px rgba(232,106,155,.12), 0 3px 8px -4px rgba(20,19,24,.32)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF",
            fontSize: 15,
            fontWeight: 700,
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
      {/* ── 右列（`gridColumn: 2`）：**名字打头**，往下是正文、配图／描述框、时间，
             全在头像右边的下方。
             这一格留成 `flex` 竖列，是给**以后的「分组」**备的位子（恩熙：「名字下方应该是
             发布时间，或者是之后要做的分组」）——分组来了就摆在名字底下，不用再动结构。
             ⚠︎ 时间**已经不在这列了**：2026-09-22 恩熙要的是微信那种摆法——落在**内容底下**
             （纯文字在文字下、有图在图下），见卡末那枚 `MomentStamp`。
             ⚠︎ 这里**不再有 `top` 那种微调**：名字原先是跟头像同一行、垂直居中，
             才需要抬一点点；现在它是右列的**第一行**，位子由列自己的对齐定。 ── */}
      <div
        style={{
          gridColumn: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            /* `maxWidth`：名字要能在列宽里**省略号收尾**，
               宁可截断，也不能把右列顶宽、把卡撑破。
               ── **减去的 26px 是给右上角那枚小书签让的位**（书签宽 19 ＋ 一点点缝）：
                  名字是右列第一行，跟书签同处卡顶，不留位的话长名字会从书签底下穿过去。
                  ⚠︎ 我自己的那条没有书签，整列放开。 ── */
            maxWidth: item.isSelf ? "100%" : "calc(100% - 26px)",
            /* ── **那块实心粉方块撤了**。
                   那是从参考图的「粉标签条」上**搬来的零件**：印刷品里「标签用方块、正文用宋」
                   是公用的语法，但在星绥这儿它只是**一张硬邦邦贴上去的纸**，
                   名字本来就不该长得像一块分类标签。
                   所以名字改回**一行字**：**宋体 ＋ 主粉**——名字的「重」不再靠一块底，靠
                   **颜色与字体**。
                   副标签那套（`.14em` 字距、无衬线）一并撤掉：字距回到正文同一档，它才读得像
                   「名字」，不像「编号」。色号用主粉 `T.pink`（`#E86A9B`）——这是全页唯一一处粉字。
                   粉是**这个 App 的色**，也是「名字」该有的分量。 ── */
            fontFamily: SERIF,
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: ".06em",
            color: T.pink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.name}
        </span>
        {/* ⚠︎ 名字底下**暂时是空的**：时间搬去内容底下了（见卡末那枚 `MomentStamp`，
             恩熙 2026-09-22：「**像微信那样……纯文字就在纯文字底下，有图片就在图片底下**」）。
             这一列留着，是给**以后的「分组」**排的（她的原话：「名字下方应该是发布时间，
             或者是之后要做的分组」）——分组来了就摆这儿，不用再动结构。 */}
      </div>

      {/* 正文文字＝整页的**大标题**：字是全页最大，**换成宋体**——那张卡
          一半的「印刷品感」就在这儿。
          （名字用宋、正文用无衬线是对调过来的：正文升成大标题，名字降下来。层级没变，气质变了。）
          **字号又收了一档**：`14.5`。卡里多了一层「垫在下面的
          粉纸」、顶上也染了一点粉，字再站 15.5px 就顶得慌——**纸变厚了，字就该收。**
          行距 1.85。 ── */}
      {/* 纯图动态正文为空：这一格不摆，免得图上方多一道 6px 的空档。 */}
      {item.content.trim() ? (
      <div
        style={{
          /* 正文在**右列**（头像右边的下方）——不再从卡左沿起，才不会落到头像底下。 */
          gridColumn: 2,
          /* ── 正文往上提了一点点（恩熙：「**发布内容文字的部分应该要再往上一点点。**」）。
               这里原本是 `9`，**减 3 → 6**——跟名字那次「往上一点点」同档，
               「一点点」就用 3 这个数当旋钮。嫌不够／多了，**只改这一个数**。 ── */
          marginTop: 6,
          fontSize: 14.5,
          fontFamily: SERIF,
          lineHeight: 1.85,
          letterSpacing: ".01em",
          color: T.ink,
          whiteSpace: "pre-line",
        }}
      >
        {item.content}
      </div>
      ) : null}

      {/* 我发的：正文底下摊自定义标签（`#词` 小 chip，2026-10-04）。 */}
      {item.isSelf && item.tags && item.tags.length > 0 ? (
        <div style={{ gridColumn: 2, marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {item.tags.map((t) => (
            <span
              key={t}
              style={{ padding: "2px 9px", borderRadius: 999, background: T.pinkSoft,
                       color: T.pink, fontSize: 11, letterSpacing: ".02em" }}
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      {/* 配图区：imageRef 已落 → 摊图（点开可放大／保存，长按＝重新生成）；
          imagePrompt 有但无图 → 摊一个「文字框」，点一下才去画 */}
      {item.imageRef && resolvedSrc ? (
        /* ── 相纸（星绥自己的造型）：一条动态的**重心**就是这张纸。厚一点的白边
             （7px）、深一点的投影——**但不再歪**。
             恩熙 2026-09-22：「**你是不是给它做成一个照片？但是不要有倾斜，
             就是正常的照片就好。**」⇒ 原先那点按 uid 算死的微斜角（`paperTilt`，±0.5°）
             **整条撤掉**：照片就正正地摆着。白边、圆角、投影全都照旧——
             「是张照片」这个感觉靠白边和影就够，不必靠歪。
             圆角 3（跟卡同一套）；描边留着——白照片压白纸，光靠投影分不开，
             那圈 `.06` 只到「看得见纸边」为止。 */
        <div
          style={{
            /* 相纸在**右列**（跟正文同一条线起），但**不吃满整列**了。
               恩熙 2026-09-22：「**照片有一点太大了，可以稍微缩小一点，
               比例再小一点点。**」
               原先靠 `justifySelf: stretch` ＋ `marginRight: -10` 撑到**比右列还宽 10px**
               （往卡外探出去一点）；现在改成**写死宽度** `calc(100% - 20px)`——
               整张纸缩到右列宽的**约 93%**，右缘落在离右列右沿 20px 的地方，
               左缘仍跟名字、正文同一条竖线（**整页的东西都是靠左站队的**，所以缩也从右边缩）。
               ⚠︎ 写了 `width` 之后，`stretch` 等价于靠左对齐，**原先那行 `marginRight: -10`
               就成了废码**，一并删掉（留着只会让人以为还探着）。
               「**再大一点／再小一点**」＝只改这一个 `20`（想放大就写成 `calc(100% - 6px)` 这种更小的数）。 */
            gridColumn: 2,
            marginTop: 16,
            width: "calc(100% - 20px)",
            padding: 7,
            borderRadius: 3,
            background: "#FFF",
            boxShadow:
              "0 0 0 1px rgba(20,19,24,.06), 0 1px 0 rgba(20,19,24,.045), 0 14px 28px -16px rgba(20,19,24,.38)",
          }}
        >
          <button
            type="button"
            className="mp-act no-callout"
            aria-label={item.isSelf ? "查看配图" : "查看配图，长按重新生成"}
            {...(item.isSelf ? {} : imagePressHandlers)}
            onClick={(e) => {
              /* 长按那一下松手会补一发 click，吃掉它，别把大图顺手弹出来。 */
              if (longFired.current) {
                longFired.current = false;
                e.preventDefault();
                return;
              }
              onOpenImage(resolvedSrc, item.imageRef);
            }}
            style={{
              position: "relative",
              display: "block",
              width: "100%",
              padding: 0,
              border: "none",
              borderRadius: 2,
              background: "rgba(20,19,24,.03)",
              overflow: "hidden",
              cursor: "zoom-in",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolvedSrc}
              alt="配图"
              style={{
                width: "100%",
                /* `300 → 270`：跟上面那处宽度一起收，是**同一次「缩小一点」的另一半**。
                   竖图（比纸还高的那种）靠这个数封顶；方图／横图都够不到它，
                   所以这一改**只影响竖图**——把它按同一个比例收下来，两张摆一起才是一个尺寸感。 */
                maxHeight: 270,
                objectFit: "cover",
                display: "block",
              }}
            />
            {/* 正在重画：盖一层，不然长按完图还在原地，像没点上。 */}
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
                  fontSize: 12,
                  letterSpacing: ".04em",
                }}
              >
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                重新生成中…
              </span>
            ) : null}
          </button>
        </div>
      ) : item.imageText ? (
        /* ── 「文字描述当图」：我没画真图，这段描述**就当这张图**。
             摊一张跟相纸同一副样子的白纸，里头印着这段话（跟发布前那张预览卡一个样）。
             它**不是**一张能被点开／长按重画的图——它就是「这张图」本身，静态摆着。 ─ */
        <div
          style={{
            gridColumn: 2,
            marginTop: 16,
            width: "calc(100% - 20px)",
            padding: 7,
            borderRadius: 3,
            background: "#FFF",
            boxShadow:
              "0 0 0 1px rgba(20,19,24,.06), 0 1px 0 rgba(20,19,24,.045), 0 14px 28px -16px rgba(20,19,24,.38)",
          }}
        >
          <div
            style={{
              padding: "13px 12px",
              minHeight: 96,
              background: "rgba(255,247,249,.92)",
              border: "1px dashed rgba(20,19,24,.14)",
              borderRadius: 2,
              fontSize: 13.5,
              lineHeight: 1.85,
              letterSpacing: ".01em",
              color: T.ink2,
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
        <div style={{ gridColumn: 2, marginTop: 16 }}>
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
              borderRadius: 3,
              background: "rgba(255,247,249,.92)",
              cursor: generating ? "not-allowed" : "pointer",
              fontFamily: SANS,
            }}
          >
            <span
              style={{
                display: "block",
                paddingLeft: 10,
                borderLeft: "2px solid rgba(232,106,155,.3)",
                fontSize: 13.5,
                lineHeight: 1.85,
                letterSpacing: ".01em",
                color: T.ink2,
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
                color: T.ink3,
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

      {/* ── 时间戳：**落在内容的末尾**（微信那种摆法，恩熙 2026-09-22 定的）——
             纯文字那条就在正文底下；有图的那条落在图（或画面描述框）底下；
             总之它是「这条内容」的最后一行，**不再待在名字底下**。
             `gridColumn: 2`：跟正文、相纸同一条竖线起（还在头像右边那一列里）；
             它自己**不占卡宽**——底下那条分割线与互动行，才是全宽的署名行。 ── */}
      <div style={{ gridColumn: 2, marginTop: 12 }}>
        <MomentStamp iso={item.createdAt} />
      </div>

      {/* ── 细分割线：照那张卡——正文（或图／描述框）与「署名行」之间压一条
            极淡的线（`T.line` = `rgba(20,19,24,.09)`）。它跟卡边（`.42`）**差了四倍多**，
             一眼就分得清「框」和「里面的线」——**不要**那种「两条一样粗一样色」的线。
             这一条只干一件事：把**上面（TA 说的话）**和**下面（这一行的功能）**断开。 ── */}
      <div style={{ gridColumn: "1 / -1", marginTop: 15, height: 1, background: T.line }} />

      {/* ── 互动行＝这张卡的**署名行**：三枚极简图标（赞／评／转发）。
             赞／评从 2026-10-05 起接真数据：心＝我赞／取消赞（赞了实心变粉）；
             话＝摊开评论框（平铺 ＋ 二级回复）。转发仍是占位。
             ⚠︎ 这一行**原先还有第四样**——右端那枚「重要」标签条。
             2026-09-22 恩熙把它**搬到卡的右上角、做成了小书签**（见卡顶那枚，
             点它就是标／取消标）⇒ 它在这儿**撤掉**，同一件事不再说两遍。 ── */}
      <div
        style={{
          /* **跨两列**（`1 / -1`）：署名行是**卡宽**的，不跟正文一起缩进——
             上面是「TA 说的话」（右列、跟着头像缩进），下面是「卡自己的功能」，
             两者靠这条全宽的线 ＋ 全宽的行分开。 */
          gridColumn: "1 / -1",
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <button
            type="button"
            className="mp-act"
            aria-label={likedByMe ? "取消赞" : "点赞"}
            onClick={() => onToggleLike(item)}
            style={{ ...ICON_BTN, color: likedByMe ? T.pink : T.ink3 }}
          >
            <Heart size={16} strokeWidth={1.7} fill={likedByMe ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className="mp-act"
            aria-label="评论"
            onClick={() => {
              setComposing((v) => !v);
              setAtOpen(false);
            }}
            style={{ ...ICON_BTN, color: composing ? T.pink : T.ink3 }}
          >
            <MessageCircle size={16} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="mp-act"
            aria-label="转发"
            onClick={() => showToast("转发还在做")}
            style={ICON_BTN}
          >
            <Share2 size={16} strokeWidth={1.7} />
          </button>
        </div>

        {/* 我发的：互动行右端＝可见范围 ＋ 一枚删除（可见范围 2026-10-04；删除 2026-10-05）。 */}
        {item.isSelf ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5,
                           letterSpacing: ".04em", color: T.ink3 }}>
              {item.visibility === "private" ? (
                <Lock size={11} strokeWidth={1.8} />
              ) : item.visibility === "partial" ? (
                <Users size={11} strokeWidth={1.8} />
              ) : (
                <Globe size={11} strokeWidth={1.8} />
              )}
              {item.visibility === "private"
                ? "仅自己可见"
                : item.visibility === "partial"
                  ? `部分可见 · ${item.visibleNames?.length ?? 0} 人`
                  : "公开"}
            </span>
            <button
              type="button"
              className="mp-act"
              aria-label="删除动态"
              onClick={() => onDelete(item)}
              style={ICON_BTN}
            >
              <Trash2 size={15} strokeWidth={1.7} />
            </button>
          </div>
        ) : null}
      </div>

      {/* ── 评论框（点了话那枚才摊开）：回复提示 ＋ @ 选人 ＋ 一枚输入药丸 ＋ 发送。
             平铺评论直接发；点了某条评论的「回复」会在输入框上方报一声「正在回复 X」，
             发出去就挂在 X 底下（艾特出来的那一层）。 ── */}
      {composing ? (
        <div style={{ gridColumn: "1 / -1", marginTop: 10 }}>
          {replyTo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7,
                          fontSize: 11, color: T.ink3, letterSpacing: ".03em" }}>
              <span>
                正在回复 <span style={{ color: T.ink2 }}>{replyTo.byName}</span>
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
                <span style={{ fontSize: 11.5, color: T.ink3 }}>还没有能 @ 的人</span>
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
              style={{ ...ICON_BTN, color: atOpen ? T.pink : T.ink3 }}
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
            borderRadius: 3,
            background: "rgba(20,19,24,.033)",
          }}
        >
          {likes.length > 0 ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Heart
                size={12}
                strokeWidth={1.8}
                fill={T.pink}
                color={T.pink}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <span style={{ fontSize: 12.5, lineHeight: 1.7, color: T.ink2,
                             letterSpacing: ".01em", minWidth: 0, wordBreak: "break-word" }}>
                {likes.map((l) => l.byName).join("，")}
              </span>
            </div>
          ) : null}

          {likes.length > 0 && comments.length > 0 ? (
            <div style={{ height: 1, background: T.line, margin: "8px 0" }} />
          ) : null}

          {rootComments.map((c) => {
            const replies = comments.filter((r) => r.replyToId === c.id);
            return (
              <div key={c.id} style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.75, color: T.ink2,
                              letterSpacing: ".01em", wordBreak: "break-word" }}>
                  <span style={{ color: T.ink, fontWeight: 500 }}>{c.byName}</span>
                  <span style={{ color: T.ink3 }}>：</span>
                  <CommentBody content={c.content} />
                  <button type="button" onClick={() => startReply(c)} style={COMMENT_REPLY_BTN}>
                    回复
                  </button>
                </div>
                {replies.map((r) => (
                  <div key={r.id} style={{ marginLeft: 14, marginTop: 3, fontSize: 12.5,
                                           lineHeight: 1.75, color: T.ink2,
                                           letterSpacing: ".01em", wordBreak: "break-word" }}>
                    <span style={{ color: T.ink, fontWeight: 500 }}>{r.byName}</span>
                    <span style={{ color: T.ink3 }}>：</span>
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
