"use client";

/**
 * 他手机里的「星绥通讯」（1.12.15 起）——跟我们自己那一套**长一个样**，
 * 只把颜色收成黑白灰（恩熙：「跟我们的样式一样，只是改成黑白灰」）。
 *
 * 【是什么】查手机 → 点一台手机 → 桌面上的「星绥通讯」。恩熙定的结构：
 * 底下排一排 tab（聊天／朋友圈／联系人／我的），零钱在「我的」里。
 *
 * 【聊天这一格装什么】先列会话、点进去才是记录。记录就是我跟他的那条会话本身
 * （`Conversation.messages`），不另存、不重生成，所以点进来接着上次、一直延续。
 *
 * 【照搬自己的规格】这一次把气泡、引用、时间、图片、语音、红包卡、转账存根、输入条
 * 一律照主聊天页（`ChatWindow` / `RedPacketCards`）的形制来——圆角 8、内边距 5×8、
 * 正文宋体、行距 1.75、硬边小影、连发成组、头像只挂组首……只是把粉与蓝一并收成黑白灰。
 *
 * 【只读】翻他的手机是看，不是拿他的手机聊天：输入条摆样子，没有真输入。
 * （「两扇门」——要密码／骇入——恩熙说最后再做。）
 *
 * 【视角反过来】这是**他的**手机：他说的靠右（墨），我说的靠左（白）。
 * 顶栏写的是**我**的名字——他打开这条会话，对面站的是我。
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronLeft,
  MessageCircleMore,
  Aperture,
  User,
  MoreHorizontal,
  Plus,
  Send,
  Play,
  Pause,
  Check,
  Clock,
  RotateCcw,
} from "lucide-react";
import { getBalance, formatYuan } from "@/lib/settings/wallet";
import { mediaRefToDataUrl } from "@/lib/chat/media-asset";
import { SERIF } from "@/apps/chat/shared";
import { RedEnvelopeCard, RedOpenedCard } from "@/apps/chat/RedPacketCards";
import { WALLET_MONO } from "@/apps/chat/WalletSheet";
import type { ChatMessage } from "@/types/chat";
import type { ArchiveEntry } from "@/types/contact";

/* ── 他那台手机的配色：**只用黑白灰**（恩熙定的），一处彩色都不上 ── */
const IOS_BG = "#F2F2F3";
const IOS_NAV = "#F9F9F9";
const IOS_LINE = "rgba(17,17,17,.12)";
const IOS_INK = "#17171A";
const IOS_SUB = "#8A8A8E";
/** 墨：主聊天页 `T.ink` 那一支，顶栏／输入条／他那一侧的气泡都用它。 */
const IOS_DARK = "#141318";
/** 纸白：主聊天页的字白（`#FFFDF8`），压在墨上。 */
const IOS_PAPER = "#FFFDF8";
const IOS_FONT =
  "'KingHwa OldSong', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', -apple-system, 'PingFang SC', 'Microsoft YaHei', serif";

type Tab = "chat" | "moments" | "contacts" | "me";

/** 非文字消息在会话列表那行摘要里显示成什么。 */
function bubbleText(m: ChatMessage): string {
  switch (m.type) {
    case "image":
      return "[图片]";
    case "voice":
      return m.duration ? `[语音 ${m.duration}"]` : "[语音]";
    case "redpacket":
      return m.amount != null ? `[红包 ¥${m.amount.toFixed(2)}]` : "[红包]";
    case "transfer":
      return m.amount != null ? `[转账 ¥${m.amount.toFixed(2)}]` : "[转账]";
    case "receipt":
      return "[收款]";
    case "file":
      return `[文件${m.fileName ? ` ${m.fileName}` : ""}]`;
    case "location":
      return "[位置]";
    default:
      return m.content;
  }
}

/** 气泡上的小时间（时:分）。 */
function stampOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 落款里那条短日期（月.日）。 */
function dateStampOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return false;
  return x.toDateString() === y.toDateString();
}

/** 会话列表里那行摘要（取最后一条说得出口的话）。 */
function lastLine(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "system" || m.type === "system" || m.pending || m.error) continue;
    return bubbleText(m);
  }
  return "";
}

export default function ContactPhoneApp({
  ownerId,
  ownerName,
  ownerAvatar,
  myName,
  myAvatar,
  friends,
  messages,
  onOpenWallet,
  onBack,
}: {
  /** 手机主人（角色的档案 id）：读他那本账的余额用。 */
  ownerId: string;
  /** 手机主人（他的头像与名字：头像挂在"他"那一侧的气泡旁）。 */
  ownerName: string;
  /** 手机主人的头像（dataURL）：聊天页里他那条气泡旁边挂着。 */
  ownerAvatar: string;
  /** 「我」（当前面具）的名字——联系人里要有我，聊天列表里那一条也是我。 */
  myName: string;
  /** 「我」的头像（dataURL）；空串用灰底＋名字首字。 */
  myAvatar: string;
  /** 他的联系人（＝当前面具的朋友）。 */
  friends: ArchiveEntry[];
  /** 我跟他的那条会话的全部消息。 */
  messages: ChatMessage[];
  /** 进他手机里的钱包（「我的」那一格）。 */
  onOpenWallet: () => void;
  /** 关掉这台手机。 */
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  /** 聊天那一格里点开了哪条会话（null＝停在列表上）。1.12.16：先列表、后记录。 */
  const [openChat, setOpenChat] = useState(false);
  /** 右上角那三个点摊开没有（1.12.18）。 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 「我的」那一格要看的零钱（分）；null＝还没读出来。 */
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void getBalance(ownerId, "contact").then((b) => {
      if (alive) setBalance(b);
    });
    return () => {
      alive = false;
    };
  }, [ownerId]);

  const titleOf: Record<Tab, string> = {
    chat: "星绥通讯",
    moments: "朋友圈",
    contacts: "联系人",
    me: "我的",
  };

  /** 点进某条会话＝照主聊天页那身皮：顶栏转墨、标题写我的名字（1.12.20）。 */
  const inChat = tab === "chat" && openChat;

  return (
    <div style={rootStyle}>
      {/* 顶栏：居中标题 ＋ 右上角**关闭**（这一台手机是"被翻开"的，合上就走）。
          点进某条会话时，左边补一个返回，退回聊天列表；整条顶栏转墨——
          跟我们自己那页聊天一样（一头一尾深、中间浅）。 */}
      <div style={inChat ? navDarkStyle : navStyle}>
        {inChat ? (
          <button
            type="button"
            aria-label="返回"
            onClick={() => setOpenChat(false)}
            style={inChat ? navBackDarkStyle : navBackStyle}
          >
            <ChevronLeft size={22} strokeWidth={2.2} />
          </button>
        ) : null}
        <span style={inChat ? navTitleDarkStyle : navTitleStyle}>
          {/* 1.12.19：这是**他的**手机，他打开的这条会话，"对方"是**我**——
              所以顶栏该写我的名字，不是他自己的（恩熙：「上面这个名字应该是我的名字」）。 */}
          {inChat ? myName || "我" : titleOf[tab]}
        </span>
        {/* 右上角**三个点**（1.12.18，恩熙：「以及右上角的三个点，这些都要有的」）——
            点开一小片菜单，出口「关闭这台手机」放在里面。 */}
        <button
          type="button"
          aria-label="更多"
          onClick={() => setMenuOpen((v) => !v)}
          style={inChat ? navMoreDarkStyle : navMoreStyle}
        >
          <MoreHorizontal size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* 三个点摊开的那片菜单（点空白处收起） */}
      {menuOpen ? (
        <div style={menuMaskStyle} onClick={() => setMenuOpen(false)}>
          <div style={menuCardStyle} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onBack();
              }}
              style={menuItemStyle}
            >
              关闭这台手机
            </button>
          </div>
        </div>
      ) : null}

      {/* 内容区：按底下那排 tab 换 */}
      <div style={bodyStyle}>
        {tab === "chat" ? (
          openChat ? (
            <ChatDetailPane
              ownerName={ownerName}
              ownerAvatar={ownerAvatar}
              myName={myName}
              myAvatar={myAvatar}
              messages={messages}
            />
          ) : (
            /* 聊天**列表**（微信首页那个样子）：先列会话，点进去才是记录。
               他手机里眼下只有一条——「我」。他跟别人的对话以后往这儿加。 */
            <div style={listScrollStyle}>
              <div style={cardStyle}>
                <button
                  type="button"
                  onClick={() => setOpenChat(true)}
                  style={chatRowStyle}
                >
                  <span style={avatarStyle(myAvatar)}>
                    {myAvatar ? null : (myName || "我").slice(0, 1)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={chatRowNameStyle}>{myName || "我"}</span>
                    <span style={chatRowSubStyle}>{lastLine(messages) || "还没有聊过"}</span>
                  </span>
                </button>
              </div>
            </div>
          )
        ) : tab === "contacts" ? (
          <ContactsPane ownerName={ownerName} myName={myName} myAvatar={myAvatar} friends={friends} />
        ) : tab === "me" ? (
          <MePane ownerName={ownerName} balance={balance} onOpenWallet={onOpenWallet} />
        ) : (
          <div style={emptyStyle}>朋友圈还是空的，以后再做</div>
        )}
      </div>

      {/* 底下那排 tab（微信那个样子：图标 ＋ 名字，选中的走墨黑）。
          **点进某条会话就收起**——跟我们自己那页聊天一样，进了对话只有顶栏与输入条。 */}
      {inChat ? null : (
        <div style={tabBarStyle}>
          <TabButton
            icon={<MessageCircleMore size={21} strokeWidth={1.8} />}
            label="聊天"
            on={tab === "chat"}
            onClick={() => setTab("chat")}
          />
          <TabButton
            icon={<Aperture size={21} strokeWidth={1.8} />}
            label="朋友圈"
            on={tab === "moments"}
            onClick={() => setTab("moments")}
          />
          <TabButton
            icon={<User size={21} strokeWidth={1.8} />}
            label="联系人"
            on={tab === "contacts"}
            onClick={() => setTab("contacts")}
          />
          <TabButton
            icon={<User size={21} strokeWidth={1.8} />}
            label="我的"
            on={tab === "me"}
            onClick={() => setTab("me")}
          />
        </div>
      )}
    </div>
  );
}

/* ── 聊天那一格：点进某条会话之后的记录（他右我左、双方都挂头像；只读） ──
   规格照主聊天页 `ChatWindow.renderMsg`：连发成组、头像只挂组首、每条气泡下挂自己的
   时间；正文走宋体、圆角 8、内边距 5×8。颜色一律黑白灰。 */

function ChatDetailPane({
  ownerName,
  ownerAvatar,
  myName,
  myAvatar,
  messages,
}: {
  ownerName: string;
  ownerAvatar: string;
  myName: string;
  myAvatar: string;
  messages: ChatMessage[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 图片与语音的**本体**（消息里存的是仓库引用串，得读回来才显示／播放）。 */
  const [media, setMedia] = useState<Record<string, { img?: string; audio?: string }>>({});
  /** 正响着的那条（用来点亮／回弹）。 */
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 点开看大图的那张（跟主聊天页一样，图能点开放大）。 */
  const [preview, setPreview] = useState<string | null>(null);

  /* 从他那一头看，系统提示、没成的占位本来就不存在；收款回执照旧挂出来（它也是一联票根）。 */
  const shown = messages.filter(
    (m) => m.role !== "system" && m.type !== "system" && !m.pending && !m.error,
  );

  /* 把图片与语音读成本体（图片显示原图、语音能播就播；读不出来就只剩气泡的样子）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, { img?: string; audio?: string }> = {};
      for (const m of messages) {
        if (m.type === "image" && m.imageUrl) {
          const url = await mediaRefToDataUrl(m.imageUrl);
          if (url) next[m.id] = { ...(next[m.id] ?? {}), img: url };
        } else if (m.type === "voice" && m.audioUrl) {
          const url = await mediaRefToDataUrl(m.audioUrl);
          if (url) next[m.id] = { ...(next[m.id] ?? {}), audio: url };
        }
      }
      if (alive) setMedia(next);
    })();
    return () => {
      alive = false;
    };
  }, [messages]);

  /* 离开这一页把正响的掐掉，不然合上手机还在说话。 */
  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  /** 点语音气泡：能播就播（走 <audio>，播放路径里绝不建 AudioContext）。 */
  const playVoice = (id: string, url?: string) => {
    if (!url) return;
    audioRef.current?.pause();
    const el = new Audio(url);
    audioRef.current = el;
    setPlaying(id);
    const stop = () => setPlaying((p) => (p === id ? null : p));
    el.onended = stop;
    el.onerror = stop;
    void el.play().catch(stop);
  };

  /** 会话里连发的同一个人的消息算一组（跨天断开）——跟主聊天页同一套判据。 */
  const sameGroup = (a?: ChatMessage, b?: ChatMessage) =>
    !!a && !!b && a.role === b.role && sameDay(a.createdAt, b.createdAt);

  /** 头像那一格：组首挂头像，组内其余留一个等宽空位，气泡边线才对得齐。
      头像**绝对定位脱流**（同主聊天页）：气泡比头像矮时，行高只由气泡说了算，
      组内每一处的间距才一致。 */
  const avatarSlot = (avatar: string, who: string, ring: "char" | "me") => (
    <div style={avatarSlotStyle}>
      <div style={{ position: "absolute", top: 0, left: 0 }}>
        <div style={avatarBoxStyle(avatar, ring)}>
          {avatar ? null : (who || "我").slice(0, 1)}
        </div>
      </div>
    </div>
  );

  /** 一条消息的「身子」（不含气泡壳的那几样：图片／红包／转账／收款）。 */
  const renderBody = (m: ChatMessage, got: { img?: string; audio?: string }, mine: boolean) => {
    switch (m.type) {
      case "image":
        /* 图片：**原图**、圆角一张、底下垫一层极淡的影；点一下能放大看
           （跟主聊天页的 `ImageBubble` 一个量级）。 */
        if (got.img) {
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={got.img}
              alt="图片"
              style={imgBubbleStyle}
              onClick={() => setPreview(got.img ?? null)}
            />
          );
        }
        return <div style={{ ...BUBBLE_BASE, background: "#FFFFFF", color: IOS_SUB }}>[图片]</div>;

      case "voice": {
        /* 语音：**做成语音气泡的样子**（播放键 ＋ 跳动的几根小竖线 ＋ 时长）；
           点一下能播就播，播不了也只是不出声。 */
        const durSec = m.duration || 5;
        const barCount = Math.min(40, Math.max(12, Math.round(durSec * 2.5)));
        const bars = Array.from({ length: barCount }, (_, i) => {
          const base = 8 + Math.sin(i * 0.6) * 6 + Math.cos(i * 1.1) * 4;
          return Math.max(4, Math.min(22, Math.round(base)));
        });
        const voiceWidth = Math.min(230, 90 + Math.min(60, durSec) * 2.5);
        const isPlaying = playing === m.id;
        const hasAudio = !!got.audio;
        /* 语音条装在气泡里，所以这里只管摆件：播放键 ＋ 波形 ＋ 时长。
           颜色全跟气泡那支走（`currentColor`）——墨底上浅、白底上墨，不另配一套。 */
        const onDark = !mine;
        return (
          <button
            type="button"
            onClick={() => playVoice(m.id, got.audio)}
            style={{
              display: "block",
              width: voiceWidth,
              border: "none",
              background: "transparent",
              padding: 0,
              font: "inherit",
              color: "inherit",
              cursor: hasAudio ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  flex: "none",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: onDark
                    ? isPlaying
                      ? "rgba(255,253,248,.24)"
                      : "rgba(255,253,248,.13)"
                    : isPlaying
                      ? "rgba(20,19,24,.16)"
                      : "rgba(20,19,24,.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isPlaying ? (
                  <Pause size={12} strokeWidth={1.8} />
                ) : (
                  <Play size={12} strokeWidth={1.8} />
                )}
              </span>
              <span
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
                      background: "currentColor",
                      borderRadius: 1.5,
                      opacity: isPlaying ? 1 - i * 0.03 : 0.55,
                      transformOrigin: "bottom",
                    }}
                  />
                ))}
              </span>
              <span style={{ flex: "none", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                {durSec}″
              </span>
            </span>
          </button>
        );
      }

      case "redpacket": {
        /* 红包卡：**照我们自己项目那张封套来**（`RedEnvelopeCard`）——同一块封面、
           同一条往下圆的弧、弧最低点上那枚「開」。黑白灰一档传 `mono`。
           领过／退过就换成开完那张脸（`RedOpenedCard`），纸上落金额。 */
        const claimed = m.moneyClaimed === true;
        const refunded = m.moneyRefunded === true;
        const expired = m.moneyExpired === true;
        const settled = claimed || refunded || expired;
        const sender = m.role === "user" ? myName || "我" : ownerName;
        if (settled) {
          return (
            <RedOpenedCard
              mono
              coverBg={RED_COVER}
              amount={(m.amount ?? 0).toFixed(2)}
              statusLine={refunded ? "已退还" : expired ? "已过期" : "已存入我的零钱"}
              footLine={`${dateStampOf(m.createdAt)} · ${sender}的红包`}
            />
          );
        }
        return (
          <RedEnvelopeCard
            mono
            coverBg={RED_COVER}
            senderLine={`${sender}的红包`}
            note={m.content || "恭喜发财，大吉大利"}
          />
        );
      }

      case "transfer": {
        /* 转账：一张**存根票根**（照主聊天页那张的形状，只是把粉与蓝收成灰）。 */
        const iSent = m.role === "user";
        return (
          <MoneyTicket
            title="转账"
            from={iSent ? myName || "我" : ownerName}
            to={iSent ? ownerName : myName || "我"}
            amount={m.amount ?? 0}
            note={m.content}
            createdAt={m.createdAt}
            state={
              m.moneyRefunded
                ? "refunded"
                : m.moneyExpired
                  ? "expired"
                  : m.moneyClaimed
                    ? "done"
                    : "wait"
            }
            foot={
              m.moneyRefunded
                ? iSent
                  ? "他已退还"
                  : "已退还"
                : m.moneyExpired
                  ? "已过期"
                  : m.moneyClaimed
                    ? iSent
                      ? "他已经收下"
                      : "已收下"
                    : iSent
                      ? "等他收下"
                      : "点击收取"
            }
          />
        );
      }

      case "receipt": {
        /* 收款回执：跟转账同一张票根、同一处形制，只是取「落定」那一档，
           抬头那两个字节自己说（收款／退还）。 */
        const recRefunded = (m.content || "已收款") === "已退还";
        const iRecv = m.role === "user";
        return (
          <MoneyTicket
            title={recRefunded ? "退还" : "收款"}
            from={iRecv ? ownerName : myName || "我"}
            to={iRecv ? myName || "我" : ownerName}
            amount={m.amount ?? 0}
            note=""
            createdAt={m.payAt ?? m.createdAt}
            state="settled"
            foot={recRefunded ? "已退还" : "已收下"}
          />
        );
      }

      default:
        return bubbleText(m);
    }
  };

  return (
    <>
      <div ref={scrollRef} style={chatScrollStyle}>
        {shown.length === 0 ? (
          <div style={emptyStyle}>这里还是一片空白</div>
        ) : (
          shown.map((m, i) => {
            const prev = shown[i - 1];
            const next = shown[i + 1];
            const groupedWithPrev = i > 0 && sameGroup(prev, m);
            const lastOfGroup = !sameGroup(m, next);
            /* mine＝我（左），他（右）。**双方都挂头像**（组首一枚）——头像在各自那一侧的外沿。 */
            const mine = m.role === "user";
            const who = mine ? myName : ownerName;
            const avatar = mine ? myAvatar : ownerAvatar;
            const got = media[m.id] ?? {};
            const isImage = m.type === "image";
            const isMoney =
              m.type === "redpacket" || m.type === "transfer" || m.type === "receipt";
            const noBubble = isImage || isMoney;
            /* 组内行收紧一点：连发的贴成一叠，组间留白拉开层次（同主聊天页）。 */
            const rowPadding = `${groupedWithPrev ? 3.5 : 6}px 12px ${lastOfGroup ? 6 : 3.5}px`;

            /* 引用块：左边一根细竖线那种（跟主聊天页同一张脸）——摘掉「发信人：」前缀，
               两行封顶。落在我这侧引的是他、落在他那侧引的是我。 */
            const quoteSender = mine ? ownerName : myName || "我";
            const quoteBody = m.quote
              ? m.quote.startsWith(`${quoteSender}：`)
                ? m.quote.slice(quoteSender.length + 1)
                : m.quote
              : "";
            const quoteBlock = m.quote ? (
              <div
                style={{
                  alignSelf: mine ? "flex-start" : "flex-end",
                  marginBottom: 7,
                  padding: "6px 13px",
                  borderRadius: 16,
                  background: "rgba(255,255,255,.62)",
                  borderLeft: mine ? "3px solid rgba(20,19,24,.42)" : "none",
                  borderRight: mine ? "none" : "3px solid rgba(20,19,24,.42)",
                }}
              >
                <div style={{ fontSize: 10.5, lineHeight: 1.45, letterSpacing: ".02em", color: "rgba(20,19,24,.46)" }}>
                  {quoteSender}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    letterSpacing: ".02em",
                    color: "rgba(20,19,24,.62)",
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

            const body = renderBody(m, got, mine);

            /* 时间：每条气泡都挂自己那条的（同主聊天页的口径），靠哪一侧跟气泡一致。 */
            const meta = (
              <div
                style={{
                  marginTop: 3,
                  fontSize: 9.5,
                  color: IOS_SUB,
                  letterSpacing: ".06em",
                  fontVariantNumeric: "tabular-nums",
                  alignSelf: mine ? "flex-start" : "flex-end",
                }}
              >
                {stampOf(m.createdAt)}
              </div>
            );

            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: rowPadding,
                  justifyContent: mine ? "flex-start" : "flex-end",
                }}
              >
                {mine
                  ? groupedWithPrev
                    ? <div style={avatarSpacerStyle} />
                    : avatarSlot(avatar, who, "me")
                  : null}

                <div
                  style={{
                    maxWidth: 300,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                    alignItems: mine ? "flex-start" : "flex-end",
                  }}
                >
                  {quoteBlock}
                  {noBubble ? (
                    body
                  ) : (
                    <div style={mine ? myBubbleStyle : hisBubbleStyle}>{body}</div>
                  )}
                  {meta}
                </div>

                {mine
                  ? null
                  : groupedWithPrev
                    ? <div style={avatarSpacerStyle} />
                    : avatarSlot(avatar, who, "char")}
              </div>
            );
          })
        )}
      </div>

      {/* 输入条：**照主聊天页那一格**（墨底 ＋ 黑加号 ＋ 书写框 ＋ 白色发送钮）——
          这一条是只读的，翻他的手机是看，不是拿他的手机聊天。 */}
      <div style={composerStyle}>
        <span style={plusBtnStyle} aria-hidden>
          <Plus size={20} strokeWidth={2} />
        </span>
        <span style={fakeInputStyle}>发消息…</span>
        <span style={sendBtnStyle} aria-hidden>
          <Send size={19} strokeWidth={1.8} />
        </span>
      </div>

      {/* 点开的**大图**（跟主聊天页一样，点一下图能看全）：点哪儿都收起。 */}
      {preview ? (
        <div style={previewMaskStyle} onClick={() => setPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="图片" style={previewImgStyle} />
        </div>
      ) : null}
    </>
  );
}

/* ── 转账／收款那张存根票根（照主聊天页的形制，颜色收成灰） ── */

function MoneyTicket({
  title,
  from,
  to,
  amount,
  note,
  createdAt,
  state,
  foot,
}: {
  title: string;
  from: string;
  to: string;
  amount: number;
  note: string;
  createdAt: string;
  /** wait＝还在等；done／refunded／expired／settled＝已落定（转暖灰、影撤掉）。 */
  state: "wait" | "done" | "refunded" | "expired" | "settled";
  foot: string;
}) {
  const done = state !== "wait";
  const paper = done ? "#F6F4F1" : "#FCFAF6";
  const dash = done ? "1px dashed rgba(20,19,24,.12)" : "1px dashed rgba(20,19,24,.22)";
  const main = done ? "#B4A9B0" : IOS_DARK;
  const name = done ? "#B4A9B0" : "#4A4A50";
  const sub = done ? "#C3BDB5" : IOS_SUB;
  const noMs = Date.parse(createdAt);
  const no = `NO. ${Number.isFinite(noMs) ? String(noMs % 10000).padStart(4, "0") : "0000"}`;
  return (
    <div style={moneyTicketStyle(paper, done)}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500, letterSpacing: ".1em", color: done ? IOS_SUB : IOS_DARK }}>
          {title}
        </span>
        <span style={{ flex: "none", fontFamily: WALLET_MONO, fontSize: 8.5, letterSpacing: ".08em", color: sub, whiteSpace: "nowrap" }}>
          {no}
        </span>
      </div>
      <div style={{ marginTop: 8, borderTop: dash }} />
      <div style={{ marginTop: 9, display: "grid", gap: 6 }}>
        {[
          { k: "付款方", v: from },
          { k: "收款方", v: to },
        ].map((row) => (
          <div key={row.k} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ flex: "none", width: 30, fontFamily: WALLET_MONO, fontSize: 9, letterSpacing: ".1em", color: sub }}>
              {row.k}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontFamily: SERIF, fontSize: 11.5, fontWeight: 500, color: name, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.v}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 9, borderTop: dash }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 10 }}>
        <span style={{ fontFamily: WALLET_MONO, fontSize: 13, fontWeight: 500, color: main }}>¥</span>
        <span style={{ fontFamily: WALLET_MONO, fontSize: 25, fontWeight: 700, color: main, lineHeight: 1, letterSpacing: "-.01em" }}>
          {amount.toFixed(2)}
        </span>
      </div>
      {note.trim() ? (
        <div style={{ marginTop: 8, background: done ? "rgba(20,19,24,.04)" : "#EFEDEA", padding: "4px 7px", fontSize: 11, lineHeight: 1.6, color: sub }}>
          {note}
        </div>
      ) : null}
      <div style={{ marginTop: 9, paddingTop: 6, borderTop: dash, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: WALLET_MONO, fontSize: 10, color: main, letterSpacing: ".06em" }}>{foot}</span>
        {state === "refunded" ? (
          <RotateCcw size={11} strokeWidth={2} color={main} />
        ) : state === "expired" ? (
          <Clock size={11} strokeWidth={2} color={main} />
        ) : state === "wait" ? (
          <span style={{ width: 5, height: 5, background: main }} />
        ) : (
          <Check size={11} strokeWidth={2.2} color={main} />
        )}
      </div>
      {/* 右沿那排撕口齿：一枚枚**纸色**的半圆，看着像从存根上撕下来的边。 */}
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
  );
}

/* ── 联系人那一格：他的联系人名单（**头一位是我**，其余是他别的朋友；只读） ── */

function ContactsPane({
  ownerName,
  myName,
  myAvatar,
  friends,
}: {
  ownerName: string;
  myName: string;
  myAvatar: string;
  friends: ArchiveEntry[];
}) {
  /* 名单要去掉手机主人本人——他的联系人是他以外的人。 */
  const list = friends.filter((a) => (a.data.name || a.data.nickname) !== ownerName);
  return (
    <div style={listScrollStyle}>
      <div style={listHeadStyle}>共 {list.length + 1} 位</div>
      <div style={cardStyle}>
        {/* **我**排在最前——他也把我存在手机里（恩熙：「通讯人的部分应该是要有我」） */}
        <div style={rowStyle}>
          <span style={avatarStyle(myAvatar)}>
            {myAvatar ? null : (myName || "我").slice(0, 1)}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{myName || "我"}</span>
        </div>
        {list.map((a) => {
          const name = a.data.name || a.data.nickname || "TA";
          return (
            <div key={a.id} style={rowStyle}>
              <span style={avatarStyle(a.data.photo)}>
                {a.data.photo ? null : name.slice(0, 1)}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 我的那一格：头像 ＋ 零钱（进去是他那本账） ── */

function MePane({
  ownerName,
  balance,
  onOpenWallet,
}: {
  ownerName: string;
  balance: number | null;
  onOpenWallet: () => void;
}) {
  return (
    <div style={listScrollStyle}>
      <div style={meCardStyle}>
        <span style={meAvatarStyle}>{ownerName.slice(0, 1)}</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{ownerName}</span>
      </div>
      <div style={cardStyle}>
        <button type="button" onClick={onOpenWallet} style={rowButtonStyle}>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 14 }}>零钱</span>
          <span style={{ fontSize: 13, color: IOS_SUB }}>
            {balance === null ? "对账中…" : `¥${formatYuan(balance)}`}
          </span>
          <ChevronLeft size={15} strokeWidth={2} color={IOS_SUB} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>
    </div>
  );
}

/* ── 底下那排 tab 的一颗 ── */

function TabButton({
  icon,
  label,
  on,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...tabBtnStyle, color: on ? IOS_INK : "rgba(17,17,17,.38)" }}
    >
      {icon}
      <span style={{ fontSize: 10, letterSpacing: ".02em" }}>{label}</span>
    </button>
  );
}

/* ── 样式 ── */

/** 红包卡封面那块灰纸（跟项目里预设封套同一个底色）。 */
const RED_COVER = "#F5F5F5";

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: IOS_BG,
  display: "flex",
  flexDirection: "column",
  fontFamily: IOS_FONT,
  color: IOS_INK,
  overflow: "hidden",
};

const navBase: CSSProperties = {
  flexShrink: 0,
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  /* 这一页是整屏，顶栏得自己让开系统状态栏。 */
  paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 6px)",
  paddingBottom: 8,
  paddingLeft: 10,
  paddingRight: 10,
  background: IOS_NAV,
  borderBottom: `1px solid ${IOS_LINE}`,
  transition: "background .2s",
};

const navStyle: CSSProperties = { ...navBase };

/** 点进会话时的顶栏（1.12.20）：转墨色，跟我们自己那页聊天一头一尾深。 */
const navDarkStyle: CSSProperties = {
  ...navBase,
  background: IOS_DARK,
  borderBottom: "1px solid rgba(255,253,248,.10)",
};

const navTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: ".02em",
};

const navTitleDarkStyle: CSSProperties = {
  ...navTitleStyle,
  color: IOS_PAPER,
};

/** 右上角那三个点（1.12.18）：点开一小片菜单，出口放在里面。 */
const navMoreStyle: CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 6,
  width: 32,
  height: 30,
  border: "none",
  background: "transparent",
  color: IOS_INK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const navMoreDarkStyle: CSSProperties = {
  ...navMoreStyle,
  color: IOS_PAPER,
};

/** 三个点摊开时压住的透明层（点空白处收起）。 */
const menuMaskStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 5,
};

/** 那片小菜单：白卡、圆角、浅影、贴在右上角底下。 */
const menuCardStyle: CSSProperties = {
  position: "absolute",
  top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 46px)",
  right: 10,
  minWidth: 132,
  background: "#FFFFFF",
  borderRadius: 12,
  boxShadow: "0 10px 30px -12px rgba(17,17,17,.35)",
  padding: 4,
};

const menuItemStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  padding: "10px 12px",
  fontSize: 13.5,
  fontFamily: IOS_FONT,
  color: IOS_INK,
  cursor: "pointer",
  borderRadius: 8,
};

/** 点进某条会话时顶栏左边那个返回（退回聊天列表）。 */
const navBackStyle: CSSProperties = {
  position: "absolute",
  left: 8,
  bottom: 6,
  width: 30,
  height: 30,
  border: "none",
  background: "transparent",
  color: IOS_INK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const navBackDarkStyle: CSSProperties = {
  ...navBackStyle,
  color: IOS_PAPER,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

/** 消息区：浅底（我们那页是透粉的白，这里收成透灰的白）。 */
const chatScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  background: "linear-gradient(160deg,#FFFFFF,#EDEDEF)",
  padding: "10px 0 14px",
};

/** 气泡的身板（跟主聊天页 `assistantBubbleStyle` 同一套尺寸，颜色另说）。 */
const BUBBLE_BASE: CSSProperties = {
  position: "relative",
  borderRadius: 8,
  padding: "5px 8px",
  fontFamily: SERIF,
  fontSize: 13.5,
  lineHeight: 1.75,
  letterSpacing: ".02em",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
};

/** 他说的：靠右、墨底纸白字（跟主聊天页「我」那一侧同一支墨，影收成灰）。 */
const hisBubbleStyle: CSSProperties = {
  ...BUBBLE_BASE,
  background: IOS_DARK,
  color: IOS_PAPER,
  boxShadow: "-2px 2px 0 rgba(20,19,24,.20)",
};

/** 我说的：靠左、白底墨字（跟主聊天页对面那一侧同一张白脸）。 */
const myBubbleStyle: CSSProperties = {
  ...BUBBLE_BASE,
  background: "#FFFFFF",
  color: IOS_DARK,
  boxShadow: "2px 2px 0 rgba(20,19,24,.10)",
};

const avatarSlotStyle: CSSProperties = {
  position: "relative",
  width: 38,
  flex: "none",
};

const avatarSpacerStyle: CSSProperties = {
  width: 38,
  flex: "none",
};

/** 气泡旁那枚头像（38 方角、圆角 8、黑框／灰框各一；同主聊天页的 `avatarBox`）。 */
function avatarBoxStyle(photo: string, ring: "char" | "me"): CSSProperties {
  return {
    flex: "none",
    width: 38,
    height: 38,
    borderRadius: 8,
    background: photo ? `#fff url(${photo}) center/cover` : "linear-gradient(135deg,#8A8A8E,#3A3A40)",
    color: "#FFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    boxShadow:
      ring === "me"
        ? "0 0 0 1.5px #9A9A9E, 0 1px 2px rgba(20,19,24,.10), 0 4px 10px rgba(20,19,24,.10)"
        : "0 0 0 1.5px #141318, 0 1px 2px rgba(20,19,24,.10), 0 4px 10px rgba(20,19,24,.10)",
  };
}

/** 图片气泡：圆角一张、底下垫一层极淡的影；点开能看大图（同主聊天页 `ImageBubble`）。 */
const imgBubbleStyle: CSSProperties = {
  width: 200,
  boxSizing: "border-box",
  borderRadius: 12,
  display: "block",
  cursor: "pointer",
  boxShadow: "0 2px 10px -5px rgba(20,19,24,.22)",
};

/** 存根票根那股方角、暖纸、硬边错位影（落定后影撤掉）。 */
function moneyTicketStyle(paper: string, done: boolean): CSSProperties {
  return {
    position: "relative",
    width: 218,
    background: paper,
    /* border 简写＋borderRight 混用会触发 React 的样式冲突警告，拆成具体属性。 */
    borderTop: `1px solid ${done ? "rgba(20,19,24,.07)" : "rgba(20,19,24,.12)"}`,
    borderRight: "none",
    borderBottom: `1px solid ${done ? "rgba(20,19,24,.07)" : "rgba(20,19,24,.12)"}`,
    borderLeft: `1px solid ${done ? "rgba(20,19,24,.07)" : "rgba(20,19,24,.12)"}`,
    borderRadius: 0,
    padding: "11px 13px 10px",
    boxShadow: done ? "none" : "0 2px 10px -5px rgba(20,19,24,.22)",
  };
}

/** 点开的大图：压一层暗底，图居中、按屏幕收边。 */
const previewMaskStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 20,
  background: "rgba(0,0,0,.82)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  cursor: "pointer",
};

const previewImgStyle: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  borderRadius: 10,
  objectFit: "contain",
};

/** 输入条：**照主聊天页那一格**（墨底一横条，是我们那页的一头）。 */
const composerStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 12px",
  paddingBottom: "calc(var(--safe-area-bottom, 0px) + 9px)",
  background: IOS_DARK,
};

/** 加号：黑底 ＋ 一圈纸白边（跟主聊天页那颗一张脸）。这一条是摆样子，不是真按钮。 */
const plusBtnStyle: CSSProperties = {
  flex: "none",
  width: 32,
  height: 32,
  borderRadius: 8,
  background: "#0F0D13",
  border: `1.5px solid ${IOS_PAPER}`,
  color: IOS_PAPER,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 3px 0 rgba(255,253,248,.30)",
};

/** 书写框：墨里压出的一道墨槽（同主聊天页的输写框，只是不可输入）。 */
const fakeInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 36,
  borderRadius: 8,
  background: "rgba(255,253,248,.10)",
  color: "rgba(255,253,248,.42)",
  fontSize: 15,
  fontFamily: IOS_FONT,
  letterSpacing: ".02em",
  display: "flex",
  alignItems: "center",
  padding: "0 13px",
  boxShadow: "inset 0 3px 8px rgba(0,0,0,.42), inset 0 0 0 1px rgba(255,253,248,.09)",
};

/** 右下那颗**发送**钮（1.12.19：不是语音键）：墨底上压一枚纸白方钮，是整条最亮的一处。 */
const sendBtnStyle: CSSProperties = {
  flex: "none",
  width: 36,
  height: 36,
  borderRadius: 8,
  background: IOS_PAPER,
  color: IOS_DARK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 3px 0 rgba(255,253,248,.22)",
};

const emptyStyle: CSSProperties = {
  padding: "60px 0 0",
  textAlign: "center",
  fontSize: 12.5,
  color: IOS_SUB,
};

const listScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "14px 12px 20px",
};

const listHeadStyle: CSSProperties = {
  fontSize: 11,
  color: IOS_SUB,
  padding: "0 4px 8px",
  letterSpacing: ".04em",
};

const cardStyle: CSSProperties = {
  background: "#FFFFFF",
  borderRadius: 14,
  overflow: "hidden",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  padding: "11px 12px",
  borderBottom: `1px solid ${IOS_LINE}`,
};

const rowButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "13px 12px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: IOS_FONT,
  color: IOS_INK,
};

/** 聊天列表里的一行（微信首页那个样子：头像 ＋ 名字 ＋ 最后一句摘要）。 */
const chatRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  padding: "11px 12px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: IOS_FONT,
  color: IOS_INK,
  textAlign: "left",
};

const chatRowNameStyle: CSSProperties = {
  display: "block",
  fontSize: 14.5,
  fontWeight: 500,
  marginBottom: 3,
};

const chatRowSubStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  color: IOS_SUB,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function avatarStyle(photo?: string): CSSProperties {
  return {
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: 8,
    background: photo ? `url(${photo}) center/cover` : "#D9D9DC",
    color: "rgba(23,23,26,.55)",
    fontSize: 15,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

const meCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 14px",
  marginBottom: 14,
  background: "#FFFFFF",
  borderRadius: 14,
};

const meAvatarStyle: CSSProperties = {
  width: 52,
  height: 52,
  flexShrink: 0,
  borderRadius: 10,
  background: "#D9D9DC",
  color: "rgba(23,23,26,.55)",
  fontSize: 20,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const tabBarStyle: CSSProperties = {
  flexShrink: 0,
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  background: IOS_NAV,
  borderTop: `1px solid ${IOS_LINE}`,
  paddingTop: 7,
  paddingBottom: "calc(var(--safe-area-bottom, 0px) + 7px)",
};

const tabBtnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  fontFamily: IOS_FONT,
};