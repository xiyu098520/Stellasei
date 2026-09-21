"use client";

/**
 * 星绥通讯：动态页 —— **朋友圈**形态的聚合时间轴。
 *
 * 【形态】顶上封面通铺整宽、从屏幕最顶端压下来；我的头像骑在封面下沿（里 38／外 22），
 * 名字与签名落在封面外、右对齐一列。底下是「连成一片」的信息流：每条左边圆头像（白圈），
 * 右边名字＋正文＋相纸图（可选）＋时间＋互动行。整页跟着滚动，左上角菜单钮浮着不滚。
 * 【数据】只看**当前面具**那份（`conversations` 传进来的就是）；动态照旧存在
 * `Conversation.moments` 里（TA 用〔动态〕标记发、由 `appendMetaUpdates` 追加），这里只是摊平了读。
 * 【生图】TA 用〔动态图〕写画面描述；开「自动生图」就直接跑接口，关着就先摆一张描述卡——
 * 她的原话看得见、改得动，确认了才花钱，改过的描述顺手写回那条动态。点图 → 放大预览 ＋ 保存图片。
 * 【只读】点条目不进聊天（恩熙：「点进这个动态……它不会跳转到聊天页面的。」）；
 * 赞／评／转三枚按钮现在是占位（点了报「还在做」），互动数据还没有存储。
 * 【通知】封面下沿挂一枚玻璃气泡，`marginTop` 28px；列表留白 40／空态 44
 * （28＋40＋40＝108，＋44＝112）。第一张卡的位置**永不动**。
 *
 * ── 设计判据（历版教训的结论，动这一页之前先读这几条）──
 * · 参考图只借**骨架**（「一条动态一张卡」是她自己挑的），零件必须是我们自己的：
 *   形状是参考图的、颜色是自己的，那还是照抄（第九／十四／十八／十九版四次栽在这儿）。
 * · **封面是雾**（无边界、通铺整宽、从 y=0 压下来），**动态是纸**（有边界）；
 *   「卡片」≠「方角＋细线」，而是「摆在页面上的一块」——有边距、圆角、投影就还是卡片。
 * · **大面守本分，细节上出手**：底色守星绥本来的粉，那支蓝只落在卡内侧底沿 3px 的「芯」上。
 * · **一支色不会脏，两支才会**（粉＋香芋叠出灰紫）；立体感做在「纸的厚度」里，不在外面垫色。
 * · 她要的是**层级**，不是「更少零件」（「跟加多少零件没有关系」）；**主次清楚 ≠ 不普通**，
 *   别再拿「减法」当答案。
 * · **加的一层不如不加**；但凡是从星绥自己身上长出来的（气泡＝聊天的母语），就该长。
 * · 一页只有一个「最大」：正文最大；名字是标签，不许跟正文抢。
 *
 * 逐版来龙去脉（第一版～第三十九版、含她每一句原话）全部记在 `docs/施工日志.md`，这里不再复述。
 */

import {
  ChevronRight,
  Download,
  Heart,
  Image as ImageIcon,
  Loader2,
  Menu,
  MessageCircle,
  Share2,
  Star,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AVATAR_GRADIENT, SANS, SERIF, T, momentTime } from "./shared";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";
import {
  generateMomentImage,
  isMomentImageGenerating,
  subscribeMomentImage,
} from "@/lib/chat/moment-image";
import {
  getChatPrefs,
  getMomentsCover,
  saveMomentsCover,
  setMomentImagePrompt,
  setMomentPinned,
} from "@/lib/settings/chat";
import {
  getMomentNotices,
  getMomentsSeenAt,
  pushMomentNotices,
  setMomentsSeenAt,
  type MomentNotice,
} from "@/lib/chat/moments-notice";
import {
  getCachedMediaBlob,
  persistImageAsset,
  releaseImageAsset,
  saveImageToDevice,
  useMediaSrc,
} from "@/lib/chat/media-asset";

/** 摊平后的一条动态（正文＋作者信息＋配图状态）。 */
interface FeedItem {
  /** 全局唯一 id = conversationId::momentId */
  uid: string;
  content: string;
  createdAt: string;
  name: string;
  avatar: string;
  /** TA 用〔动态图〕写的画面描述（可选）；恩熙还没点生成时就有。 */
  imagePrompt?: string;
  /** 恩熙点生成后回写的 media-store:// 引用串。 */
  imageRef?: string;
  /** 用来回写 imageRef（conversationId 唯一确定角色×面具，momentId 指向某条动态）。 */
  conversationId: string;
  momentId: string;
  /** 恩熙标了「重要」的那条：永远原文留在 TA 的记忆里（记忆页也会星标出来）。 */
  pinnedByUser?: boolean;
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

/** 相纸的微斜角：按 uid 算死（-0.5°~+0.5°）。同一条每次进来角度都一样、不会跳。
    **一条动态的重心就是这张纸**，它稍微歪一点才像「被人随手摆上去的」；
    幅度再大就只是歪，不是讲究。 */
function paperTilt(uid: string): number {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % 997;
  return ((h % 21) - 10) / 20;
}

export default function MomentsPage({
  archives,
  conversations,
  maskName,
  maskAvatar,
  signature,
  onOpenSidebar,
  showToast,
}: {
  /** 全部角色档案（用来把动态的作者名／头像补上）。 */
  archives: ArchiveEntry[];
  /** 当前面具下的会话（动态就是从这里摊出来的）。 */
  conversations: Conversation[];
  /** 我：当前使用中面具的名字（压在封面左下那格名片上）。 */
  maskName: string;
  /** 我：当前使用中面具的头像（那格名片上的圆头像）。 */
  maskAvatar: string;
  /** 我：个性签名（名片上那行小字）。 */
  signature: string;
  onOpenSidebar: () => void;
  showToast: (msg: string) => void;
}) {
  /* 摊平：每条动态挂上作者（名字／头像）。头像与会话列表同一条兜底链——
     会话里单独设过就用单独设的，没设过用档案照片。

     恩熙 2026-09-21：「我希望不会有未命名跟不知道的人出现。」
     所以这里跟消息列表（MessageList）同一套过滤，谁来不了就是来不了：
     ① 假删／待同意的朋友不显示（跟列表一致）；
     ② 角色档案已经找不到的会话不显示（否则只能挂个「未命名」）；
     ③ 档案连名字都没填的也不显示——动态页上绝不冒出没头没脸的人。 */
  const feed: FeedItem[] = conversations.flatMap((conv) => {
    if (conv.friendStatus === "removed" || conv.friendStatus === "requested") return [];
    const archive = archives.find((a) => a.id === conv.characterId);
    if (!archive) return [];
    const d = archive.data;
    const name = (d?.name || d?.nickname || "").trim();
    if (!name) return [];
    const avatar = conv.charAvatar || d?.photo || "";
    return (conv.moments ?? []).map((m) => ({
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
    }));
  });
  // 新→旧：各会话自己的动态本来是有序的，混到一页得重新排。
  feed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  /* 点开的那张配图（放大预览＋保存）。存引用串而不是只存地址——保存时要拿仓库里
     已经解好的 Blob，转成 data URL 再解一遍会把用户手势耗掉（见 saveImageToDevice）。 */
  const [viewer, setViewer] = useState<{ src: string; ref?: string } | null>(null);

  /* 「生成配图」先弹的描述卡（恩熙要「看得见、改得动，确认了再花钱」）。
     生成这件事抬到这一层：弹层是卡片流的兄弟节点，不会被那个滚动容器裁掉。 */
  const [editor, setEditor] = useState<{ item: FeedItem; text: string } | null>(null);
  /* 生图进度不再挂在这儿：挪进 `moment-image` 的登记表了（恩熙 2026-09-21
     「动态的话，我返回之后，我再重新进入，我看不见他正在生成」——状态挂在页面里，
     页面一卸就丢，画图那趟请求其实还在跑）。这里订阅它，登记表一变就重渲染，
     下面逐条去问「这一条在不在画」。 */
  const [, setGenTick] = useState(0);
  useEffect(() => subscribeMomentImage(() => setGenTick((n) => n + 1)), []);

  /* ── 通知（恩熙 2026-09-22：「别人点赞、评论……那个通知做在封面跟动态卡片
        之间的那个位置」）——数据在 `lib/chat/moments-notice`，这儿只负责「什么时候
        算一条新通知」＋摆在哪儿。
        进来的第一件事：拿上次看动态页的时刻，比它**新**的动态才算通知（不然每次进来
        都把老动态重新报一遍，清空之后还会自己长回来）。
        现在接上的真渠道只有「TA 发了新动态」这一种；赞／评论那两种等互动真做那轮
        往同一个仓库里推就行，形（kind）已经分好了。
        `feed` 每次渲染都是新数组，用 ref 取当下这份，不让这个 effect 跟着重跑
        （重跑＝把 seen-at 一直往后推，通知就永远长不出来）。 */
  const [notices, setNotices] = useState<MomentNotice[]>([]);
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seenAt = await getMomentsSeenAt();
      const here = feedRef.current;
      await pushMomentNotices(
        here
          .filter((f) => f.createdAt > seenAt)
          .slice(0, 3)
          .map((f) => ({
            id: `${f.uid}::post`,
            kind: "post" as const,
            fromName: f.name,
            fromAvatar: f.avatar,
            convId: f.conversationId,
            excerpt: f.content.replace(/\s+/g, " ").trim().slice(0, 24),
            createdAt: f.createdAt,
          })),
      );
      await setMomentsSeenAt(new Date().toISOString());
      const list = await getMomentNotices();
      /* 朋友被假删／档案没了（已经不在这一页的 feed 里了）→ 他那条通知也不摆
         （同「谁都不能没头没脸」那条规矩）。 */
      const convIds = new Set(here.map((f) => f.conversationId));
      if (alive) setNotices(list.filter((n) => convIds.has(n.convId)).slice(0, 3));
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* 「自动生图」开着的时候，这一页不摆中间那一步：点「生成配图」直接跑（恩熙
     2026-09-21：「如果我开启了自动生图，它就会直接去生成的哦」）。TA 发动态那一刻
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

  /* 标／取消标「重要」：写库 → 广播让上层重读（记忆页那边也跟着变星标）。
     恩熙 2026-09-21：「那朋友圈是不是也要有一个能够标记为重要 的功能呢？」 */
  const togglePin = async (item: FeedItem) => {
    const next = !item.pinnedByUser;
    await setMomentPinned(item.conversationId, item.momentId, next);
    window.dispatchEvent(new CustomEvent("moments-updated"));
    showToast(next ? "标为重要了，TA 会一直记着这条" : "已取消重要");
  };

  /* 顶栏压在封面里时不显形（全透明、深梅色字），滚过封面下沿才落成实底墨字——见文件头 ②。
     只存一个布尔量：只在跨过那条线的那一帧重渲染一次，滚动途中不跟着抖。 */
  const [stuck, setStuck] = useState(false);
  const coverRef = useRef<HTMLDivElement | null>(null);

  /* ── 封面图（第二十二版。恩熙 2026-09-21：「你先帮我把这个换封面的功能给做出来吧，
        因为我想看一下这个分界线在哪里。」——「换封面」从此不再是句提示）。
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

  /* 气泡上那一行字（**第三十四版**）——**多条用一个罩得住各种事的词，单条才说具体的事**。
     恩熙 2026-09-22：「**但是不对啊，他也有可能是发新动态，也有可能是新评论、新点赞。
     所以我在想要怎么样会比较好？**」
     —— 对：这一枚以后装的不止「新动态」，那个词得能罩住「发了动态／评论了／点赞了」
     三种。中文里最不别扭的就是「**新消息**」（谁做了什么，都算一条消息到你手上），
     所以多条改成「**{名字} 等 N 条新消息**」；只有一条时不必含糊，按 `kind` 说清是哪一种。
     现在真渠道只有 `post`（赞／评论接上真存储后，这里自动就对）。 */
  const noticeLead = notices[0];
  const noticeLine = !noticeLead
    ? ""
    : notices.length > 1
      ? `${noticeLead.fromName} 等 ${notices.length} 条新消息`
      : noticeLead.kind === "like"
        ? `${noticeLead.fromName} 赞了你`
        : noticeLead.kind === "comment"
          ? `${noticeLead.fromName} 评论了你`
          : `${noticeLead.fromName} 发了新动态`;

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
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .mp-act { transition: none }
        }
      `}</style>

      {/* 整页一起滚：封面 → 一条条动态。 */}
      <div
        onScroll={(e) => {
          /* 滚过封面下沿（减掉顶栏那点高度）→ 顶栏落成实底。同一个值重复塞进去
             不会重渲染，所以滚动途中不会跟着抖。 */
          const coverH = coverRef.current?.offsetHeight ?? 0;
          setStuck(e.currentTarget.scrollTop > Math.max(0, coverH - 58));
        }}
        style={{
          width: "100%",
          height: "100%",
          overflowY: "auto",
          overscrollBehavior: "none",
          /* 雾不只在封面那一块：从**页顶**渗下来、到半页才化掉，整页是一口气。
             `backgroundAttachment: local` 让这层雾跟着内容走（钉在**页首**，
             不是钉在屏幕上）——往下滑就是干净的页底，雾留在它该在的顶上。
             封面自己的渐变底正好接在这层雾上面，原来那条「色块 + 白底」的硬缝就这么没了。 */
          backgroundColor: T.bg,
          backgroundImage:
            "linear-gradient(to bottom, rgba(243,220,230,.5) 0px, rgba(246,231,238,.28) 210px, rgba(255,247,249,0) 540px)",
          backgroundAttachment: "local",
        }}
      >
        {/* ── 封面＝**通铺整宽的真封面**（第十六版）。恩熙 2026-09-21 连着说了两遍：
               「封面不要是卡片的样子，就跟之前一样」→ 我把它退回第十三版那个**圆角气泡**，
               她立刻又纠正：「**不是，我说的封面是封面不要有卡片的样子。**」
               —— 这两句话把我点醒了：**「卡片」不是指「方角＋细线」，是指「摆在页面上的一块」**。
               只要它有左右边距、四个圆角、一圈投影，它就是「浮在页上的一张卡」——
               圆角气泡也是卡。她要的是「封面**的样子**」：**通铺整宽、从屏幕最顶端压下来的
               一整面**（第七版就是这么写的，我绕了四版才回来）。
               所以这一版：左右边距 12px 全撤、四角归零、三道白内边与那道深投影全撤
               （不浮了，它就是从顶上压下来的一整面），高度把安全区＋状态栏一并吃进来，
               从 y=0 起，连状态栏那块也是封面。
               底边**不留缝**：最底一截化进「页底那层透粉的雾在封面下沿处的颜色」——
               算出是 `rgba(253,243,246,1)`（页底 `T.bg` 上盖着滚动容器那层 25% 左右的
               淡粉雾）。封面下沿那块颜色和下沿外一像素的颜色一模一样，所以是**化开**，
               不是「切一刀」。这行数字跟着容器那层雾改的话要重算。 ── */}
        <div
          ref={coverRef}
          style={{
            position: "relative",
            /* 从**屏幕最顶端**起（`0`），安全区与状态栏的高度改由 `height` 吃进来——
               封面的样子就是「顶到天上去」。 */
            margin: 0,
            /* 第二十五版：`232px` → `272px`（+40）。恩熙 2026-09-22 第三次要往下：
               「**再往下再往下**」——连着三轮都在加，说明我每轮给的步子都太小，
               这回一次给一大步（40px，差不多是前两轮之和）。 */
            height: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 272px)",
            /* 通铺＝没有圆角（颗粒 svg 同步 0）。 */
            borderRadius: 0,
            background:
              /* 最底一截**化进封面下沿外的页底**（见上面那段注释那枚 `rgba(253,243,246,1)`）：
                 封面不是「贴在页面上的一块色」，而是从顶上渗下来、到自己散开。 */
              "linear-gradient(to bottom, rgba(253,243,246,0) 44%, rgba(253,243,246,1) 100%)," +
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
          {/* 换过封面就走真照片（第二十二版）：图**铺满整面**（`object-fit: cover`），
              上面压两层——
              ① 顶上一点白（`.34 → 0 @24%`）：压在封面里的顶栏图标与字是**深梅色**，
                 照片若是暗的，AD 那几个字就没了；这层白只护住最上面那一小截，
                 再往下就是照片本来的样子；
              ② 底下化进页底：用的是跟默认渐变**同一枚** `rgba(253,243,246,1)`，
                 所以「封面到哪儿为止」跟以前一样是**化开**的，不会忽然切一刀。 ── */}
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
                    "linear-gradient(to bottom, rgba(253,243,246,0) 62%, rgba(253,243,246,1) 100%)",
                }}
              />
            </>
          ) : null}

          {/* 颗粒：一层 feTurbulence 噪点铺满整面（中性灰、soft-light 混色、很淡）。
              这是第九版以来「高级」的关键一手，比撒一百颗星都有用。圆角跟着封面走
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

          {/* ── 我是谁：头像**骑在封面的下沿上**——上半在封面里、下半落在封面外
                （恩熙 2026-09-21：「头像跟签名不要这么完全在封面上，可能就大概是头像的
                一半在封面里就可以了，其他应该要在封面外面」）。
                 所以头像不再是「封面里的一个元素」，而是**压在封面边缘上的一枚印**。
                 **第二十四版**恩熙又添了一句：「头像可以再嵌入封面一点点」——
                 于是 `top` 从 `calc(100% - 30px)`（正正一半）改成 **`calc(100% - 22px)`**：
                 60px 的头像**嵌进封面 38px、露在外面 22px**，比「一半」更往里坐一点。
                 ⚠︎ 头像往上坐，下面的名字／签名也跟着上移 8px —— 信息流顶部留白同步
                 `100px → 108px` 补回来，不让她俩跟第一张卡贴住。
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
                /* 第十四版回到**正圆**。恩熙否的是「卡片的圆角太多」——卡是方框，
                   人脸不是；把方框的圆角收掉，跟把一张脸也削成方块，是两回事。 */
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
              **第二十二版把这件事真做了**（恩熙 2026-09-21：「你先帮我把这个换封面的功能
              给做出来吧，因为我想看一下这个分界线在哪里。」）：点它开系统选图
              （藏起来的 `<input type="file">`，iOS 只认用户手势触发的 `.click()`），
              选完压图进仓库、引用串写进设定。换过之后旁边多一枚「还原」——
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

        {/* ── **动态通知气泡**（第二十六版立、第二十七版改形、第二十八版照微信的样、
               第二十九版做大＋挪到右下头像的左边、第三十版回到居中、
               第三十一～三十二版连着往下挪、第三十三～三十四版改那一行字、
               第三十五版改成磨砂玻璃／恩熙 2026-09-22）：
               「别人点赞、评论……不是会有那个通知吗？我就想把那个通知做在封面跟
               动态卡片之间的那个位置。」
               第一稿我做成**一整条白纸清单**（三行、一行一条），恩熙当场纠：
               「**啊，不是像这样的宝宝，他可能就是一个小胶囊，然后你点进去会有更多
               详情的这种。**」
               —— 对：**这一格只站一个小胶囊**（一眼扫过的东西），**一条一条摆开是
               「详情」的事，点开再说**（跟微信那个消息入口一个道理）。
               第二十七版我先做成一枚「铃铛＋动态通知＋数字」，恩熙把微信那张截图
               递过来：「**应该是这种感觉，你看一下。**」「**就跟微信一样。**」
               第二十八版照那张截图改成 **头像 ＋「{名字} 等 {N} 条互动」＋ `›`**。
               第二十九版她再定两句：「**我希望是大一点气泡，然后这个位置在头像
               同行的左边，但是是在封面之下的。**」
               —— 于是 ① 整枚做大一号（头像 26、字 13、约 40px 高）；
               ② 从「水平居中」挪到**右下那枚 60px 头像的左边**（同一行那带）：
               外边距 `4px 92px 0 18px` ＋ 靠右，纵向**只从封面下沿以下 4px 起**
               （整枚都在封面之外，不压封面）；③ 有它时信息流顶部留白 `18 → 64／68`
               （两处相加仍是原来的 108／112，第一张卡位置不变）。
               第三十版她又把横向落点收回居中：「**还是要在居中的位置呀。**」
               —— 只改这一处（`4px 18px 0` ＋ `center`），做大与「只在封面之下」全留。
               第三十一版再往下挪一点：「**稍微再往下一点。**」
               —— `4px` → `16px`（居中与大小不变），多占的 12px 从留白里等量扣回。
               第三十二版「**再往下一点点。**」——再给同样一步：`16px` → `28px`，
               留白同步 `52／56` → `40／44`。
               第三十三版改文案：「**我不想要是等 N 条互动，我想换一个，你觉得什么样会
               比较好？**」——多条那句的「条互动」换成「条新动态」。
               第三十四版她又点出「**也有可能是发新动态，也有可能是新评论、新点赞。**」
               ——「新动态」也罩不住，于是**多条改用一个泛词：`{名字} 等 N 条新消息`**；
               **单条按 `kind` 说具体的事**（赞了你／评论了你／发了新动态）。
               这一行字收到组件里一个 `noticeLine` 统管（见那段注释）。
               第三十五版她要「**有点那种透透的感觉**」——白底降到半透明 ＋ `backdropFilter`
               磨砂 ＋ 顶沿白内高光 ＋ 淡描边（见下面 style 里那段），形与位置不动。
               主题仍是那一枚：头像 ＋ 一行字 ＋ `›`。点它 → 详情还没做，先给提示。 ── */}
        {notices.length > 0 ? (
          <div
            style={{
              /* 第三十二版：**再往下一点点**（恩熙：「再往下一点点。」）——
                 再给同样一步 12px：`16px` → `28px`（居中不变）。
                 多占的仍从信息流留白里等量扣回（`52／56` → `40／44`），
                 两处相加仍是 108／112 —— **第一张卡的位置照旧不动**。 */
              margin: "28px 18px 0",
              position: "relative",
              zIndex: 1,
              display: "flex",
              justifyContent: "center",
            }}
          >
            {/* **第三十六版那片「垫在玻璃背后的粉晕」，第三十八版撤掉了。**
                （恩熙 2026-09-22：「感觉不对啊。」「就是应该是有那种玻璃的感觉。
                哎呀，我也不知道怎么说好。」）
                —— 那一手的出发点没错（毛玻璃要「透」，靠的是**背后真有东西**），但
                在这一枚上走不通：它占着文档流的位置，卡片永远滚不到它背后，能垫的
                只有「伪造的背景色」——而伪造出来的东西**必然露在玻璃外**，露出一点
                就是页底上一块脏斑。所以这一版换路：**玻璃感不再靠背后，靠它自己**
                （斜向高光 ＋ 粉蓝色散 ＋ 顶亮底淡的厚度，见下面 button 的 style）。 */}
            <button
              type="button"
              className="mp-act"
              onClick={() => showToast("通知详情还在做")}
              style={{
                ...COVER_PILL,
                /* **第三十五版：做出「透透的」感觉**（恩熙 2026-09-22：「有没有办法做
                   有点那种透透的感觉啊？」）——照 iOS 那片磨砂玻璃的那一手：
                   ① 白底**降到半透明**（`#FFFFFF` → `rgba(255,255,255,.58)`），
                      底下的粉白页底透一点上来；
                   ② `backdropFilter: blur(14px) saturate(1.5)`（＋`Webkit` 那份给 iOS），
                      背后真有东西（头像／卡片滚上来时）会化成一层雾；
                   ③ 描边从深色 `.14` 淡成 `.07`，**顶沿补一道白内高光**（`inset 0 1px 0`）
                      —— 玻璃的「边」靠光，不靠线；
                   ④ 底沿那道粉（纸的厚度）留下但减淡（`.4 → .26`），
                      外投影略加重一点，让它看着是「浮」在页底上而不是切开。

                   **第三十八版（本版）：把「玻璃」做在玻璃自己身上。**
                   （恩熙：「就是应该是有那种玻璃的感觉。哎呀，我也不知道怎么说好。」）
                   —— 「背后垫东西」那条路撤了（见前一段注释：它必然露馅，露出来就是脏）。
                   改成**靠自身的光学**，三样加起来才是「一片玻璃」而不是「一块白」：
                   ① **斜向高光**：左上角一团 `radial-gradient` ＋ 一路 `linear-gradient(155deg)`
                      的明暗——这就是玻璃面上的**反光**，玻璃最好认的特征，**它自己发光，
                      不依赖背后有没有东西**；
                   ② **色散**：叠一层极淡的粉／蓝斜渐变（`rgba(232,106,155,.12)` →
                      `rgba(201,222,240,.14)`）——玻璃压着光会泛出一点点色边，顺带把这一枚
                      拉回页面的粉紫调；
                   ③ **厚度**：顶沿一道**纯白**内高光（`inset 0 1px 0` 到 `1`）＝上棱在接光，
                      底沿淡白 ＋ 一点粉（`inset 0 -1px / -2px`）＝下棱有厚度；外面兜
                      `0 .5px` 白边 ＋ `1px` 极淡暗线把轮廓勾回来，两道柔投影让它浮着。
                   `backdropFilter` 留着（`blur(14px) saturate(1.8)`）：平时背后是平页底、
                   看不出什么，一旦有东西到它后面（往下滚时卡片经过）立刻就雾起来。 */
                /* **第三十九版（本版）：把它做成「一层膜」，不是「一块白」。**
                   （恩熙 2026-09-22：「**这样没有透的感觉，没有那种空气感。**」）
                   —— 上一版那三层里白得太重（`.62/.3/.44/.68`，还有一团 `.9` 的高光），
                   合起来就是**一块白瓷片**：形是立住了，可它把底下那点颜色全压死了，
                   于是「不透」。这一版把白**撤到几乎没有**，改让**底下的东西自己说话**：
                   ① `background` 只剩一路很薄的斜向白（`.5 → .14 → .08 → .34 → .18`，
                      多半在 `.1~.3` 之间）＝一层**膜的厚度**，不再是白底；
                   ② `backdropFilter` 里补上 **`saturate(2)` ＋ `brightness(1.04)`**：
                      背后那层粉白页底（`T.bg` ＋ 顶上那层雾）被**提饱和、提亮**之后
                      从膜里透上来，玻璃因此是**粉粉的、比周围亮一丁点**——「透」和
                      「空气」都是这一下出来的（iOS 玻璃就是这个手感）；
                   ③ 边：顶沿一道**纯白细高光**（上棱接光）＋ 底沿一点淡白，外面
                      `0 .5px` 白边 ＋ `1px` 极淡暗线（`.04`）勾轮廓；
                   ④ **最外面兜一圈白光晕**（`0 0 22px rgba(255,255,255,.55)`）＋ 一道
                      **更散更淡**的投影（`0 14px 26px -18px .45`）——投影散、光晕亮，
                      它才像**浮在空气里**，而不是压在页上。
                   （物理上还是那句：这一格背后没有内容，所以「透」只能透到页底那层
                   粉白自己；将来真有卡片滚到它背后，`blur(16px)` 会让它真雾起来。） */
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
              {/* 谁在互动：第一个人的头像（没图就用名字首字兜住）。 */}
              {notices[0].fromAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={notices[0].fromAvatar}
                  alt=""
                  style={{
                    flex: "none",
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    objectFit: "cover",
                  }}
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
                    /* 第三十七版：跟着这一枚的字体一起换成宋体（原来是黑体）。 */
                    fontFamily: SERIF,
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {notices[0].fromName.slice(0, 1)}
                </span>
              )}
              {/* 这一行字由上面 `noticeLine` 一处统管（多条「等 N 条新消息」、
                  单条按 `kind` 说具体的事）——见第三十四版。
                  **第三十七版：字体跟下面那些动态正文一支**（恩熙 2026-09-22：
                  「**我希望字体可以换一个……跟下面文字的字体是一样的。我比较喜欢那种
                  字体，不喜欢这种方方正正的。**」）——原来吃的是 `COVER_PILL` 带来的
                  `SANS`（黑体，正是她说的「方方正正」），换成 `SERIF`（宋体，
                  与卡片正文／下面那行名字同一支）＋ `fontWeight: 500`
                  （正文那支是 400；**宋体在这个小字号上不加一点粗会发飘**，
                  气泡里字小、又压在玻璃上，需要这一点分量）。 */}
              <span
                style={{
                  fontFamily: SERIF,
                  fontWeight: 500,
                  fontSize: 13,
                  letterSpacing: ".01em",
                }}
              >
                {noticeLine}
              </span>
              <ChevronRight
                size={15}
                strokeWidth={1.9}
                style={{ flex: "none", opacity: 0.45 }}
              />
            </button>
          </div>
        ) : null}

        {/* ── 信息流：**一条一张方卡**（第十四版，从第十三版的「气泡」改回来）。
               恩熙看完气泡说「想要这种感觉 不要太多圆角不好看」，指的是那种「一张启事
               被编过排过」的感觉。于是每一条＝**一张白纸方卡**（深色细线框住）。
               ① 「第一则跟第二则怎么分清」靠**卡自己那条边**——不用页上的栏线；
               ② 一页扫下去是**一个一个**，不是一片——这就是她要的「游戏选择页面」那种
                  「每块都被安排过」的排法；
               ③ 形状变了，逻辑没变。
               条目间距 22px：卡自带边界，不用再靠大留白硬撑（原来 34＋栏线）。
               顶部留 108px 给封面下沿那枚骑边的头像与它下面那列名字／签名让位
               （第二十四版：头像多嵌进封面 8px，留白同步 `100 → 108` 补回来）。
               ⚠︎ 上面那段缝里站了**通知气泡**的时候，这几处留白跟着收
               （**胶囊占多少，就从这里扣多少，两处相加恒是 108／112**）：
               第二十六版 `18px`（那会儿胶囊靠 `marginTop: 98` 自己顶开整段）；
               第二十九～三十版 `64／68`（胶囊 `4` 起、约 40px 高）；
               第三十一版 `52／56`（胶囊往下挪到 `16` 起）；
               **第三十二版起 `40`（列表）／`44`（空态）**（胶囊再挪到 `28` 起）。
               两处（空态／列表）都得跟着改，不然有通知的时候会白撑一大段。 ── */}
        {feed.length === 0 ? (
          <div
            style={{
              padding: notices.length > 0 ? "44px 24px 64px" : "112px 24px 64px",
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
              padding: notices.length > 0
                ? "40px 0 calc(var(--safe-area-bottom, 0px) + 34px)"
                : "108px 0 calc(var(--safe-area-bottom, 0px) + 34px)",
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
                  /* 自动生图开着 → 直接画；关着 → 先摊描述卡让她看／改（她自己的钱她自己点头）。
                     长按已有的那张图走的是同一条路。 */
                  if (autoGen) void runGenerate(target, target.imagePrompt ?? "");
                  else setEditor({ item: target, text: target.imagePrompt ?? "" });
                }}
                onTogglePin={(target) => void togglePin(target)}
              />
            ))}
          </div>
        )}
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
        <button
          type="button"
          className="mp-act"
          onClick={onOpenSidebar}
          aria-label="打开侧边栏"
          style={{
            flex: "none",
            width: 34,
            height: 34,
            /* 第十五版：跟着封面回上一版的样子（它浮在封面上，不属于下面那条条方卡）。 */
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
          <Menu size={16} strokeWidth={1.9} />
        </button>

        {/* ── 标题：中文在上、英文小字在下（字距拉到 .3em）。
              第九版我自己把这两行从参考图上搬来过，被恩熙识破、第十版撤了；这一版她
              **点名要留下**（「我顶上栏还是可以留下名称跟英文的」）——那就留。
              但**期号不回来**（`No. 00X` 是那张图的东西，她没要）。 ── */}
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
      </div>

      {/* 配图放大层（恩熙 2026-09-21：「这个朋友圈生成的图片应该也是可以点击保存的哟」）：
          点动态里那张图弹出来——大图 + 底下「保存图片」，点背景或右上角 X 关掉。
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

      {/* 画面描述卡（恩熙 2026-09-21：「说不定这个描述它本身就是有错误的呢」「用户也可以
          去选择修改，修改完之后再去重新生成」）：点「生成配图」先把 TA 写的画面描述摊开给
          她看，改得动；点「生成配图」才真跑接口——不白花钱。点背景或「取消」就走人。 */}
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 动态条目组件（抽出来是因为生成配图涉及 async state，不适合放在 map 里面）。
   恩熙 2026-09-21：「他发图文不是只会发图片，还会配上文字解说。」——配图生成由
   恩熙在朋友圈页面手动点击触发，点一次跑一次图文接口，失败按钮还在、可重试。
   2026-09-21 又加一层：点按钮先弹描述卡（能看能改），确认了才跑接口——所以生成
   状态与弹层都抬到了 `MomentsPage`，这里只管画和把点击报上去。

   恩熙 2026-09-21：「那朋友圈应该也要有长按重新生成的功能。」
   → 已经有图的那条，**长按那张图**就是重新生成（短按照旧弹大图看／存）。
   画的过程中图上盖一层「重新生成中…」，不然长按完屏幕纹丝不动，像没点上。

   第五版（恩熙 2026-09-21 否掉「照抄」之后）：参考图的零件全拆，只留「一条动态一张卡」
   这个骨架，换回星绥自己的语言——圆头像、相纸、粉点缀、中文文字框。
   但恩熙还是说：「看着很一般。就是每个小手机都能完成的样子。」——于是**第六版把骨架
   换成了星轨**（整页夜空、一条竖线、头像当节点），恩熙看完又说：「真的不太好看，宝宝。」
   所以**第七版回到朋友圈那种骨架**，特别之处改从**排版**里出：左边一枚 42px 圆头像
   （白圈＋淡影，标了「重要」的多一环主粉），右边一列——名字用**中文衬线**、正文、
   相纸／描述框、互动行；条目之间不是实线，是**两端渐隐的中性发丝线**。
   相纸、中文文字框照旧——那些是星绥自己的东西，不用动。

   第八版（恩熙 2026-09-21：「哪里怪怪的，很不高级」）：第七版的问题是**太闹**——
   三色马卡龙＋星尘＋星芒全是加法，越加越像模板。这一版只做**减法**：降饱和、撤装饰、
   把字重调细、把阴影减淡、把时间从互动行的定宽列**撤回名字后面**（那截空白像表格，
   就是「怪」的来源）。高级不是加上去的，是减出来的。
   -------------------------------------------------------------------------- */
function MomentItem({
  item,
  generating,
  showToast,
  onOpenImage,
  onEditPrompt,
  onTogglePin,
}: {
  item: FeedItem;
  /** 这条的配图正在画（按钮转圈／图上盖一层；不给重复点）。 */
  generating: boolean;
  /** 条目里那两枚图标按钮（心／话）还没有真数据，点了给个提示。 */
  showToast: (msg: string) => void;
  /** 点配图 → 放大预览（保存图片在那一层里）。 */
  onOpenImage: (src: string, ref?: string) => void;
  /** 要（重新）画这张配图 → 由上层分流（自动生图开＝直接跑；关＝先摊描述卡看／改）。 */
  onEditPrompt: (item: FeedItem) => void;
  /** 标／取消标「重要」——标了的那条永远原文留在 TA 的记忆里（见 setMomentPinned）。 */
  onTogglePin: (item: FeedItem) => void;
}) {
  const resolvedSrc = useMediaSrc(item.imageRef);

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
    /* ── 一条动态的排法（第十四版起）：**一张方卡，头像也在卡里**。
         恩熙 2026-09-21 给了那张「公告亭 · 征集」的卡，一句「不要太多圆角不好看」，
         于是第十三版那套气泡（大圆角 ＋ 三道白）整个撤掉，换成**一张编过排过的启事**：
         白纸、一圈深色细线、四角几乎直角、里面按层级一层层排下来。
         **圆是柔，方是编排**——这张卡之所以「不普通」，靠的不是形状多别致，
         是它每一层都被安排过（标签 → 大标题 → 正文 → 细线 → 署名行 → 右下脚注）。
         **封面的圆角和这里的圆角是两码事**：她当天接着说「封面不要是卡片的样子，
         就跟之前一样」，封面于是回到那张圆的气泡（那是雾，不是纸）。
         逻辑一行没动：生图、长按重生成、存图、标「重要」、描述卡、放大层全照旧。 ── */
    <article
      style={{
        position: "relative",
        /* 卡**就长在 `article` 身上**（不另套一层 div）：一条动态＝一张卡。
           第十五版：头像从卡**外面**挪进卡**里面**（恩熙 2026-09-21：「底下动态的地方，
           你把头像给我放进卡片里头呀喂！」）——左右边距因此对称，不再为左边留那条
           70px 的头像位。
           `border` 用**深色实线**（`.42`）而不是白高光：上一版靠三道白把气泡「托」起来，
           这一版靠**一条清楚的边**把卡「框」住——这是那张卡最要紧的一笔，撤了它就散了。
           里头那条分割线只有 `.09`，跟这条差了四倍多，「框」和「里面的线」一眼分得开。
           影子收得很轻：纸是**放在**页面上的，不是浮在页面上的（浮＝气泡那套，已撤）。

           **第十六版给卡上了点颜色**。恩熙 2026-09-21：「**卡片可以做一点颜色的设计啊，
           对不对？**」——她说得对，一张死白纸是「素」，不是「讲究」。顶上这一段淡粉晕
           **有来由**：它就是封面那层粉**落下来的那一截**——雾到卡这儿还没散完，
           往下自己化回白纸。所以它不是「贴上去的一条色带」，是同一口气的延续（同第十版
           「雾铺满整页、整页一口气」那条）。深色细线、四角、轻影一律不动——骨架还是那张
           「编过排过的卡」。

           **第十八版：把「脏」洗掉 ＋ 把卡「垫起一层」**——恩熙 2026-09-21：
           「**卡片也可以做的更有立体感啊，就比如像那个参考，它是在下面有做一层颜色的设计，
           对不对？那我们也可以用别种方式，让它看起来更有层次感。……然后就是这个渐变啊，
           稍微有一点脏脏的感觉，你可能要调的再自然一点。**」
           ① **脏在哪**：上一层色我用了**两支**（封面的粉 ＋ 封面的香芋），粉紫叠在白纸上，
              过渡那一段混出**灰紫**——像纸被抹了一下，不是被染了一下。这一版**只用粉一支**，
              `#F3DCE6` 那一支、浓度从 `.5` 收到 `.34`，**只把卡顶那一小截染上一点色**，
              到 70% 就干净地化没。**一支色不会脏，两支才会。**
           ② **立体感**：参考图那种「下面垫一层色」我**不照搬**（那又是一枚借来的零件），
              换成**纸叠纸**——卡底下错开露出一层**同族的纸**（`4px 5px` 实色错位影）。
              来由说得出来：卡里的相纸、卡里的白边都是「纸叠纸」，卡自己当然也可以被压在
              另一张纸上。
              ⚠︎ **这一条我其实没做到**：垫子最初配粉（`rgba(240,210,223,.85)`），
              第十九版换成蓝（`rgba(198,220,239,.95)`）——**可「往右下错开一块实色」这个形状
              本身还是参考图那套**，只换颜色不算「用别种方式」。**第二十版把整块垫子撤了，
              立体感改做「纸的厚度」**（见下面第二十版那段），以第二十版为准。 ── */
        margin: "0 16px",
        padding: "13px 15px 13px",
        borderRadius: 3,
        border: "1px solid rgba(20,19,24,.42)",
        background:
          /* 叠在最下面的是纯白 `#FFF`；上面那层是**封面那支粉**（`#F3DCE6`）的一小截，
             到 70% 干净化没——卡的下半仍是干净白纸，正文压在上面最好读。
             ⚠︎ 别再加第二支色，**两支一叠就会出灰紫，那就是她说的「脏」**（第十八版的教训）。

             **第二十版**曾把这里换成封面那支**蓝**（走「蓝白」）——
             **第二十一版退回了**。恩熙 2026-09-21：「**卡片的颜色我还是希望是原本的颜色，
             我只是说在一点细节上面可以用不同的颜色。**」
             —— 我上一版把「跳出去」**读过成了「把卡换掉」**：卡是**底**，底得是星绥本来的粉；
             要「大胆」的地方是**细节**，不是这么大一块面。**大面守本分，细节上出手。** ── */
          "linear-gradient(180deg," +
          " rgba(243,220,230,.34) 0%," +
          " rgba(243,220,230,.18) 32%," +
          " rgba(255,255,255,0) 70%)," +
          " #FFFFFF",
        boxShadow:
          /* ── **第二十版：立体感换一种做法——不做「垫在下面的一块色」，改做「这张纸的厚度」。**
               恩熙 2026-09-21：「**就是这个垫子的这个东西，它只有这种呈现方式能够让它看起来
               立体吗？因为我刚对比了一下……跟参考图很像啊。**」——她这一问正中要害：
               参考图那个「下面垫一层色」的**形状**（往右下错开的一块实色）**我又照搬了**，
               只是把颜色换了。**换个颜色不算「用别种方式」。**
               所以错位的那块实色撤掉，立体感改由两件事给：
               ① `inset 0 -3px 0 rgba(201,222,240,.9)`——**卡内侧底沿一条蓝**：纸被切开看得到的
                  **芯**。它是**厚度**，不是**影子**——厚度在卡**里面**，影子才在卡**外面**。
                  **第二十一版留住了这条**：恩熙同一天说「**这样没错**」——做法换了，她认。
                  而且**这一笔正好就是她要的「在一点细节上面用不同的颜色」**：卡面守住本来的粉，
                  那支蓝只在底下露 3px。**大胆不是把底换掉，是在边上点一笔。**
               ② `0 14px 24px -18px rgba(58,96,140,.42)`——一道**压得很深的蓝调柔影**（不是实色块，
                  没有边），把卡从页面上**托住**，但不「浮起来」（浮＝气泡那套，早撤了）。
               ③ 原来那道 `0 1px 2px rgba(20,19,24,.04)` 留着，贴着卡边收一下。
               **别再往卡外面加错位的色块**——那是参考图的零件，不是星绥的。 ── */
          "inset 0 -3px 0 rgba(201,222,240,.9), 0 1px 2px rgba(20,19,24,.04), 0 14px 24px -18px rgba(58,96,140,.42)",
      }}
    >
      {/* ── 第一行＝**头像 ＋ 这一条的标签 ＋ 右下脚注**（第十五版把头像收进这一行）。
             恩熙 2026-09-21：「底下动态的地方，你把头像给我放进卡片里头呀喂！」——
             一页扫下去是一张一张**完整的卡**，不再是「左边一列头像 ＋ 右边一列内容」。
             头像 42px 正圆：一圈白边把它从卡上托起来，再垫一点点淡影；标了「重要」的
             那条，白圈外再补一环主粉——比挂个「★ 重要」的字样更打眼，也不占地方。
             名字（第十六版改回来）＝**一行宋体粉字**：第 344 条曾把它做成「实心粉标签条」，
             恩熙 2026-09-21 一句「**名字为什么非得是小方块呢？**」把那块方块撤了——
             名字的重靠**颜色与字体**（主粉 ＋ 宋体），不靠一块贴上去的底。
             时间贴在这一行的**最右**（参考图右下角那枚小字的位置）。

           ── 恩熙 2026-09-21 那一轮的 key（把她原话留在这儿，这是这几版的立命之处）：
              「每个地方都差不多重，我会有一种找不到重点的感觉」／「重点是每一个主次」。
              名字从 14.5 收到 13、时间退到 ink3，字号差拉开，层级才立得起来。 ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            flex: "none",
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: AVATAR_GRADIENT,
            boxShadow: item.pinnedByUser
              ? `0 0 0 1.5px #FFF, 0 0 0 3px ${T.pink}`
              : "0 0 0 1.5px #FFF, 0 2px 8px -5px rgba(20,19,24,.38)",
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
        <span
          style={{
            minWidth: 0,
            /* ── 第十六版：**那块实心粉方块撤了**。恩熙 2026-09-21：「**那你自己想，名字为什么
                   非得是小方块呢？对不对？**」——她说得对，我服。那块方块是第 344 条从参考图
                   的「粉标签条」上**搬来的零件**：印刷品里「标签用方块、正文用宋」是公用的语法，
                   但在星绥这儿它只是**一张硬邦邦贴上去的纸**，名字本来就不该长得像一块分类标签。
                   所以名字改回**一行字**：**宋体 ＋ 主粉**——名字的「重」不再靠一块底，靠
                   **颜色与字体**（第十二版那套「名字收小、用宋」本来就对，是第 344 条把它推翻了）。
                   副标签那套（`.14em` 字距、无衬线）一并撤掉：字距回到正文同一档，它才读得像「名字」，
                   不像「编号」。色号用主粉 `T.pink`（`#E86A9B`）——这是全页唯一一处粉字。
                   （第二十版曾把卡改走蓝白、名字成了「点」；**第二十一版卡退回原本的粉**，
                   名字照旧主粉——粉是**这个 App 的色**，也是「名字」该有的分量。） ── */
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
        <span
          style={{
            /* 时间顶到这一行的最右（第十五版把头像放进来之后，标签往右缩了，
               靠 `auto` 把时间重新推回右边，不跟头像一起挤在左边）。 */
            marginLeft: "auto",
            flex: "none",
            fontSize: 10,
            letterSpacing: ".08em",
            color: T.ink3,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {momentTime(item.createdAt)}
        </span>
      </div>

      {/* 正文文字＝整页的**大标题**（第十四版）：字是全页最大，**换成宋体**——那张卡
          一半的「印刷品感」就在这儿。
          （第十二版是名字用宋、正文用无衬线；这一版对调：正文升成大标题，名字降下来。
           层级没变，气质变了。）
           **第十八版把字号收了一档**（恩熙 2026-09-21：「**我觉得现在这个动态里面的文字
           有点大了，可能要改一下。**」）：`17 → 15.5`。这一版卡里多了一层「垫在下面的
           粉纸」、顶上也染了一点粉，字再站 17px 就顶得慌——**纸变厚了，字就该收。**
           行距 1.85 不动（跟第十二版同一档）。 ── */}
      <div
        style={{
          marginTop: 9,
          fontSize: 15.5,
          fontFamily: SERIF,
          lineHeight: 1.85,
          letterSpacing: ".01em",
          color: T.ink,
          whiteSpace: "pre-line",
        }}
      >
        {item.content}
      </div>

      {/* 配图区：imageRef 已落 → 摊图（点开可放大／保存，长按＝重新生成）；
          imagePrompt 有但无图 → 摊一个「文字框」，点一下才去画 */}
      {item.imageRef && resolvedSrc ? (
        /* ── 相纸（星绥自己的造型）：一条动态的**重心**就是这张纸。厚一点的白边
             （7px）、深一点的投影、**微微歪一点点**（`paperTilt`，±0.5°）——一页里
             只有这张小照片歪着，才像「被人随手摆上去的」。
             第十四版：卡从气泡改回**白纸方卡**，于是它的圆角也跟着收到 3（跟卡同一套）；
             描边留着——白照片压白纸，光靠投影分不开，那圈 `.06` 只到「看得见纸边」为止。 */
        <div
          style={{
            marginTop: 16,
            marginRight: -10,
            padding: 7,
            borderRadius: 3,
            background: "#FFF",
            boxShadow:
              "0 0 0 1px rgba(20,19,24,.06), 0 1px 0 rgba(20,19,24,.045), 0 14px 28px -16px rgba(20,19,24,.38)",
            transform: `rotate(${paperTilt(item.uid)}deg)`,
          }}
        >
          <button
            type="button"
            className="mp-act no-callout"
            aria-label="查看配图，长按重新生成"
            {...imagePressHandlers}
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
                maxHeight: 300,
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
      ) : item.imagePrompt ? (
        /* ── 画面描述框：没图的时候不摆一枚灰扑扑的按钮，把 TA 写的那段原话
              **摊成一个框**——看得见、改得动，点了才去画（跟「确认了才花钱」同一个头）。

              第九版在这儿借过参考图的两个零件：骑在框边上的 `SCENE · 画面描述` 药丸、
              居中拉字距的破折号注脚。**都撤了**——那是人家的零件。
              只留一手全世界排版都在用的**公用件**：框里那段字左边压一条粉竖线、字整体
              右移——横排中文里，一条竖线就把一段话从「一段字」变成「一句被引的话」。
              虚线仍是**中性**的（粉虚线压在透粉的页底上会发脏）。
              第十四版：圆角收到 3（跟卡同一套），底仍是那支**粉白**——卡本身已经是纯白，
              粉白压白，框还是框。 ── */
        <div style={{ marginTop: 16 }}>
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

      {/* ── 细分割线（第十四版）：照那张卡——正文（或图／描述框）与「署名行」之间压一条
            极淡的线（`T.line` = `rgba(20,19,24,.09)`）。它跟卡边（`.42`）**差了四倍多**，
             一眼就分得清「框」和「里面的线」——第 342 条撤线撤的是「两条一样粗一样色」
             那种，跟这条不冲突。
             这一条只干一件事：把**上面（TA 说的话）**和**下面（这一行的功能）**断开。 ── */}
      <div style={{ marginTop: 15, height: 1, background: T.line }} />

      {/* ── 互动行＝这张卡的**署名行**：左边三枚极简图标（赞／评／转发），右边一枚「重要」
             标签条（标了的那条变实心主粉——那条永远原文留在 TA 的记忆里）。
             恩熙 2026-09-21：「需要点赞的、评论的、转发的，跟重要的功能，这几个是必须的」
             ——四个都在了（前三个暂时还是占位，点了报「还在做」）。
             第十四版：「重要」从药丸改成**直角标签条**（跟名字那条同一个语法）——一页里
             「贴上去的东西」都该是方的，就它一个圆的，会显得没编排过。 ── */}
      <div
        style={{
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
            aria-label="点赞"
            onClick={() => showToast("点赞还在做")}
            style={ICON_BTN}
          >
            <Heart size={16} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="mp-act"
            aria-label="评论"
            onClick={() => showToast("评论还在做")}
            style={ICON_BTN}
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

        <button
          type="button"
          className="mp-act"
          aria-label={item.pinnedByUser ? "取消重要" : "标为重要"}
          aria-pressed={item.pinnedByUser ? true : false}
          onClick={() => onTogglePin(item)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px 5px 8px",
            borderRadius: 2,
            border: `1px solid ${item.pinnedByUser ? T.pink : T.line}`,
            background: item.pinnedByUser ? T.pinkSoft : "transparent",
            color: item.pinnedByUser ? T.pink : T.ink3,
            fontFamily: SANS,
            fontSize: 10.5,
            letterSpacing: ".08em",
            cursor: "pointer",
          }}
        >
          <Star size={12} strokeWidth={1.8} fill={item.pinnedByUser ? T.pink : "none"} />
          {item.pinnedByUser ? "已标记" : "重要"}
        </button>
      </div>
    </article>
  );
}
