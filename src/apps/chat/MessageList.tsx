"use client";

import { useMemo, useState } from "react";
import {
  BellOff,
  ChevronLeft,
  CreditCard,
  Plus,
  ScanLine,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { HZ, LAT, SANS, SERIF, listTime, previewOf } from "./shared";
import { hexToRgba } from "@/lib/colors";
import { DEFAULT_MASK_ID, type Mask } from "@/lib/settings/mask";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";

/* =======================================================================
 * 消息列表页（简约大气 · 戊「秩序 × 气泡 × 雾面」定稿）。
 * 底是白灰纸面，主色一支雾蓝；标题「消息」进顶栏居中，底下跟一行斜体
 * Messages；分区小标 PINNED · 置顶 / ALL · 全部；气泡按「区」聚成整块
 * 哑光薄雾面片（静态颗粒，不吃性能），块内只留极细分隔线、头像一圈柔白边光。
 * 消息列表是全局的：显示所有面具的所有绑定对话（同一角色可多行）。
 * ===================================================================== */

/** 加号底下摊开的四张卡（顺序即摊开顺序）。 */
const ACTIONS = [
  { name: "发起群聊", icon: Users },
  { name: "添加朋友", icon: UserPlus },
  { name: "扫一扫", icon: ScanLine },
  { name: "收付款", icon: CreditCard },
];

/** 同名撞行时那枚面具标签的配色：要非常淡，不要很明显。
 *  按面具在面具册里的次序取色 —— **不是**按 id 算哈希：哈希会撞（两张面具算出同一个
 *  颜色，等于没区分），按次序取色则保证同一屏里任意两张面具的颜色一定不同。
 *  真正的区分主力是**编号**（跟面具册里那张的编号一一对上），颜色只当一层极淡的底色。 */
const MASK_TAG_COLORS = ["#E0669A", "#4E7FC4", "#8A6FD0", "#2F9E8F", "#B8712E", "#B05074"];

/** 静态颗粒纹理（内联 SVG 噪点，平铺），做面片的哑光手感。 */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='130' height='130'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function MessageList({
  archives,
  conversations,
  masks,
  onOpenChat,
  onExit,
  showToast,
}: {
  archives: ArchiveEntry[];
  /** 全部会话（跨面具）。 */
  conversations: Conversation[];
  masks: Mask[];
  onOpenChat: (characterId: string, maskId: string) => void;
  /** 回小手机主屏幕（顶栏左上那枚返回键）。 */
  onExit: () => void;
  showToast: (msg: string) => void;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [query, setQuery] = useState("");

  /** 组装行数据：每个绑定一行（角色 × 面具）。
   *  那枚面具标签不能只要「有两个面具」就**每行都挂**，那看着像多余装饰；
   *  它真正要解决的只有一件事：**同一个角色被两张面具都加了**，名字会撞成两行、得一眼
   *  分清哪行是哪张面具。所以改成**只给这一屏里重复出现的角色**挂。 */
  const rows = useMemo(() => {
    /* 新增面具、即便没有把某位角色加成好友，它也不该出现在聊天列表里。
       「星绥」助手是**每张面具一建好就自动预绑**的（chat.ts 的 ensureAssistant），
       预绑时是条**空会话**：没聊过就没有任何消息。空着的助手绑定不算「有会话」，
       别占消息列表的一行；真去聊了、有消息了自然浮上来。
       自己亲手加的好友不在此列 —— 那是主动加的，还空着也该看得见。
       ⚠️ 判据是 `chatStarted`（真发过消息才盖上），**不是**「消息条数为 0」——
       按条数遮的话，记忆一清、消息归零，聊过的会话会被当成预绑空会话一起遮掉。 */
    const visible = conversations.filter((conv) => {
      const archive = archives.find((a) => a.id === conv.characterId);
      if (!archive) return false; // 档案已删除的绑定不展示
      // 被假删（等 TA 申请）／申请待同意的绑定暂时隐藏
      if (conv.friendStatus === "removed" || conv.friendStatus === "requested") return false;
      return !(archive.data.isAssistant === true && conv.chatStarted !== true);
    });
    /* 每个角色这一屏占了几行；>1 才需要面具标签去区分 */
    const boundCount = new Map<string, number>();
    for (const c of visible) boundCount.set(c.characterId, (boundCount.get(c.characterId) ?? 0) + 1);
    return visible.flatMap((conv) => {
      const archive = archives.find((a) => a.id === conv.characterId);
      if (!archive) return [];
      const mid = conv.maskId ?? DEFAULT_MASK_ID;
      const lastMsg = conv.messages[conv.messages.length - 1];
      const maskIdx = masks.findIndex((m) => m.id === mid);
      /* 面具册里已经没有这张面具了（删掉面具留下的旧会话）→ 这行不显示：
         人都不在了，这行点开也没地方去，白占一屏。 */
      if (maskIdx < 0) return [];
      const mask = masks[maskIdx];
      return [
        {
          archive,
          conv,
          maskId: mid,
          lastMsg,
          timeIso: lastMsg?.createdAt ?? conv.updatedAt,
          maskName: mask.name.trim() || "我",
          /* 面具编号＝它在面具册里的位次（两位补零），跟「我的」页面具册里那枚号对得上，
             同名时靠它区分。 */
          maskNo: String(maskIdx + 1).padStart(2, "0"),
          showBadge: (boundCount.get(conv.characterId) ?? 0) > 1,
          /* 这枚标签的颜色跟着面具走：同名撞行时，两张面具就算名字一模一样，
             颜色也不同，一眼分得清哪行是哪张。 */
          maskColor: MASK_TAG_COLORS[maskIdx % MASK_TAG_COLORS.length],
        },
      ];
    });
  }, [archives, conversations, masks]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.archive.data.name}\n${r.archive.data.nickname}`.toLowerCase().includes(q),
    );
  }, [rows, query]);

  /* 置顶的也要按最近排（2026-09-24 恩熙：「有新消息的应该会被弹到最上面」）：
     置顶只是「钉在最上面那一摞」，摞里头谁最近说话谁在前——跟微信一个样。
     ⚠️ 原来这里只 filter 不 sort，置顶的几条按底册入库顺序摆死，
     新消息来了也不挪窝，看着就是「有新消息没被顶上去」。 */
  const pinned = useMemo(
    () =>
      searched
        .filter((r) => r.conv?.isPinned === true)
        .sort((a, b) => b.timeIso.localeCompare(a.timeIso)),
    [searched],
  );
  const normal = useMemo(
    () =>
      searched
        .filter((r) => r.conv?.isPinned !== true)
        .sort((a, b) => b.timeIso.localeCompare(a.timeIso)),
    [searched],
  );

  return (
    <div
      className="ml-root"
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: HZ.paper,
        fontFamily: SANS,
        color: HZ.ink,
        overflow: "hidden",
      }}
    >
      {/* 互动：按下收一档、颜色压暗一点（不跑动画，只动 transform／filter）。
          加号摊开是错开落下的位移＋缩放。 */}
      <style>{`
        .ml-root { --grain: ${GRAIN}; }
        .ml-hbtn { transition: opacity .15s ease, transform .15s ease; }
        .ml-hbtn:active { opacity: .55; transform: scale(.92); }
        .ml-row { position: relative; transition: filter .16s ease; }
        .ml-row:active { filter: brightness(.97); }
        /* 块内行与行之间只留一条**两端缩进**的极细分隔线 */
        .ml-row + .ml-row::before {
          content: ''; position: absolute; top: 0; left: 16px; right: 16px;
          height: 1px; background: ${HZ.line2};
        }
        /* 气泡组＝一块哑光薄雾面片；颗粒是静态纹理，mix-blend 压在上层 */
        .ml-group {
          position: relative; overflow: hidden; border-radius: 22px;
          background: linear-gradient(180deg, #F2F3F1, #EDEFEC);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(58,65,73,.05);
        }
        .ml-group > * { position: relative; z-index: 1; }
        .ml-group::after {
          content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
          background-image: var(--grain); background-size: 130px 130px;
          mix-blend-mode: multiply; opacity: .04;
        }
        /* 头像一圈柔白边光，整个人像从面片里浮起来一点 */
        .ml-av {
          box-shadow: 0 1px 2px rgba(58,65,73,.07), inset 0 1px 0 rgba(255,255,255,.95);
          border: 1px solid rgba(255,255,255,.75);
        }
        .ml-search::placeholder { color: ${HZ.ink3}; }
        .ml-sheet {
          transition: transform .26s cubic-bezier(.34,1.4,.64,1), opacity .18s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .ml-hbtn, .ml-row, .ml-sheet { transition: none; }
        }
      `}</style>

      {/* 顶栏 G1：左右两键钉在两侧同一条中线，「消息／Messages」一体两行的标题块
          垂直居中卡在中间——组的中心正对箭头和加号的中心。 */}
      <div
        style={{
          flex: "none",
          zIndex: 20,
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 2px) 26px 0",
        }}
      >
        <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
          {/* 中心标题块：宋体刊头压着一行宽字距小写拉丁，两行一体（整组中心＝两键中线） */}
          <div style={{ textAlign: "center" }}>
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 23,
                /* 宋体只有 Regular／Bold 两档可用，600 会被落到 Bold、笔画糊成一片；
                   500 落在 Regular 上，刊头要的是「细而挺」，不是「粗而稳」。 */
                fontWeight: 500,
                letterSpacing: ".24em",
                paddingLeft: ".24em",
                color: HZ.accent,
                lineHeight: 1,
              }}
            >
              消息
            </span>
            <div
              style={{
                /* 改成**大写＋宽字距的等宽小字**，跟下面的分区小标同一套，
                   整页的拉丁字面才是一家人。 */
                fontFamily: LAT,
                fontSize: 9.5,
                letterSpacing: ".34em",
                textIndent: ".34em",
                textTransform: "uppercase",
                color: HZ.ink3,
                padding: "5px 0 0",
              }}
            >
              Messages
            </div>
          </div>

          {/* 返回主屏幕：钉在左侧中线上，接原来「菜单钮→侧栏→退出」的位置 */}
          <button
            type="button"
            onClick={onExit}
            aria-label="返回主屏幕"
            className="ml-hbtn"
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              padding: 0,
              color: HZ.ink,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>

          {/* 加号：钉在右侧中线上；按一下，四张卡从它底下错开摊出来 */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 24,
              height: 24,
            }}
          >
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              aria-label="更多"
              className="ml-hbtn"
              style={{
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "none",
                padding: 0,
                color: HZ.ink,
                cursor: "pointer",
              }}
            >
              <Plus
                size={22}
                strokeWidth={1.5}
                style={{
                  transition: "transform .25s cubic-bezier(.22,1,.36,1)",
                  transform: plusOpen ? "rotate(45deg)" : "none",
                }}
              />
            </button>

            <div
              style={{
                position: "absolute",
                top: 40,
                right: 0,
                width: 176,
                zIndex: 30,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                // 摊开卡片的容器浮在列表右上角。收起时若不放行点击，它这块 176 宽的
                // 空盒子会挡住底下最上面那几条——置顶就在那儿，于是「置顶点不进去」。
                // 卡片各自已设 pointerEvents，这里只管容器。
                pointerEvents: plusOpen ? "auto" : "none",
              }}
            >
              {ACTIONS.map((item, i) => (
                <div
                  key={item.name}
                  className="ml-sheet"
                  onClick={() => {
                    setPlusOpen(false);
                    showToast(`${item.name} · 预览`);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "10px 12px",
                    background: "#FFFFFF",
                    borderRadius: 16,
                    boxShadow: "0 18px 30px -18px rgba(58,65,73,.45)",
                    cursor: "pointer",
                    transform: plusOpen ? "none" : "translateY(-12px) scale(.94)",
                    opacity: plusOpen ? 1 : 0,
                    pointerEvents: plusOpen ? "auto" : "none",
                    transitionDelay: plusOpen ? `${i * 45}ms` : "0ms",
                  }}
                >
                  <span
                    style={{
                      flex: "none",
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: HZ.accentSoft,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <item.icon size={15} strokeWidth={1.9} color={HZ.accent} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5, letterSpacing: ".04em", color: HZ.ink }}>
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 标题下的搜索条：圆角浅底 ＋ 放大镜 ＋ 占位字（上距随标题块收紧，别让英文行掉进空谷） */}
      <div style={{ flex: "none", padding: "12px 26px 2px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            height: 38,
            padding: "0 14px",
            borderRadius: 12,
            background: "linear-gradient(180deg,#F1F2F0,#EBEDEA)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(58,65,73,.05)",
          }}
        >
          <Search size={16} strokeWidth={1.7} color={HZ.ink3} style={{ flex: "none" }} />
          <input
            type="text"
            className="ml-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              letterSpacing: ".16em",
              fontFamily: SANS,
              color: HZ.ink,
            }}
          />
        </div>
      </div>

      {/* 条目：气泡按区聚成整块 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "13px 20px 18px",
        }}
      >
        {archives.length === 0 ? (
          <EmptyState cn="还没有消息" hint="去「档案」唤醒一个角色，聊第一句吧" />
        ) : rows.length === 0 ? (
          <EmptyState cn="还没有对话" hint="去「通讯人」添加朋友，开始第一场对话" />
        ) : searched.length === 0 ? (
          <EmptyState cn="这里空着" hint={`没有找到「${query.trim()}」`} />
        ) : (
          <>
            {pinned.length > 0 ? (
              <div>
                <Sect en="Pinned" cn="置顶" />
                <div className="ml-group">
                  {pinned.map((row) => (
                    <ConversationRow
                      key={`${row.conv.characterId}::${row.maskId}`}
                      row={row}
                      onOpen={() => onOpenChat(row.conv.characterId, row.maskId)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {normal.length > 0 ? (
              <div style={{ marginTop: pinned.length > 0 ? 16 : 0 }}>
                <Sect en="All" cn="全部" />
                <div className="ml-group">
                  {normal.map((row) => (
                    <ConversationRow
                      key={`${row.conv.characterId}::${row.maskId}`}
                      row={row}
                      onOpen={() => onOpenChat(row.conv.characterId, row.maskId)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 摊卡片的遮罩（点空白收回去；须低于头部 20，否则压住按钮点不了） */}
      {plusOpen ? (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 19 }}
          onClick={() => setPlusOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** 空状态：一小撮雾蓝线起头，下面两行字——纯排版，不放图标。 */
function EmptyState({ cn, hint }: { cn: string; hint: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "90px 34px 40px",
        textAlign: "center",
      }}
    >
      <span
        style={{ width: 32, height: 4, borderRadius: 999, background: HZ.accent, opacity: 0.7, marginBottom: 20 }}
      />
      <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: HZ.ink, letterSpacing: ".1em" }}>
        {cn}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 12.5,
          fontWeight: 300,
          color: HZ.ink2,
          letterSpacing: ".04em",
          lineHeight: 1.6,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

/** 分区小标：等宽英文 ＋ 中点 ＋ 中文，字距放开、颜色极淡。 */
function Sect({ en, cn }: { en: string; cn: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 7, padding: "11px 4px 9px" }}>
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".32em",
          color: HZ.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
      <span style={{ fontFamily: LAT, fontSize: 9.5, color: HZ.ink3 }}>·</span>
      {/* 中文那格加重一档、字距收一点：拉丁是「线」，中文是「点」，
          两者分量拉开，这一行才有层次，不会读成一条同样粗的灰线。 */}
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".2em", color: HZ.ink2 }}>
        {cn}
      </span>
    </div>
  );
}

/** 单条会话行（一个绑定一行）。
 *  圆角方头像 ＋ 衬线名字（置顶走雾蓝）＋ 预览 ＋ 右侧时间与未读；
 *  有未读：预览走近黑、未读是一枚雾蓝小药丸。
 *  面具标签只在同名撞行时挂，贴着名字右侧，非常淡。 */
function ConversationRow({
  row,
  onOpen,
}: {
  row: {
    archive: ArchiveEntry;
    conv?: Conversation;
    maskId: string;
    timeIso: string;
    maskName: string;
    /** 面具编号（按面具册位次，两位补零）。 */
    maskNo: string;
    showBadge: boolean;
    maskColor: string;
  };
  onOpen: () => void;
}) {
  const { archive, conv } = row;
  const d = archive.data;
  const name = d.name || d.nickname || "未命名";
  const unread = conv?.unreadCount ?? 0;
  const hot = unread > 0;
  const pinned = conv?.isPinned === true;
  const last = conv ? conv.messages[conv.messages.length - 1] : undefined;

  return (
    <div
      className="ml-row"
      onClick={onOpen}
      data-tap="true"
      style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", cursor: "pointer" }}
    >
      {/* 头像：42 的圆角方（有照片铺照片，没有就白底衬线首字） */}
      <div
        className="ml-av"
        style={{
          flex: "none",
          width: 42,
          height: 42,
          borderRadius: 13,
          background: d.photo ? `url(${d.photo}) center/cover` : "#FFFFFF",
          color: HZ.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: SERIF,
          fontSize: 15,
          fontWeight: 600,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {d.photo ? null : name.slice(0, 1)}
      </div>

      <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span
            style={{
              minWidth: 0,
              fontFamily: SERIF,
              fontSize: 16,
              /* 同上：宋体的 600 会落到 Bold，一行名字压得太黑；
                 500 走 Regular，靠字号与字距撑分量。 */
              fontWeight: 500,
              letterSpacing: ".06em",
              color: pinned ? HZ.accent : HZ.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </span>

          {conv?.isMuted ? (
            <BellOff size={12} strokeWidth={2} color={HZ.ink3} style={{ flex: "none" }} />
          ) : null}

          {/* 面具标签（只在同名撞行时挂）：贴着名字右侧，非常淡——
              底色只是那支面具色的 10%，字 72%，安静得几乎看不见。
              区分同名靠前面的**编号**：跟「我的」页面具册里的号一一对上。 */}
          {row.showBadge ? (
            <span
              style={{
                flex: "none",
                marginLeft: "auto",
                maxWidth: 96,
                fontFamily: SANS,
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: ".08em",
                padding: "2px 7px",
                borderRadius: 999,
                background: hexToRgba(row.maskColor, 0.1),
                color: hexToRgba(row.maskColor, 0.72),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.maskNo} {row.maskName}
            </span>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 5,
            fontSize: 12.5,
            /* 预览压到 300：它永远只是「陪跑」的一行，轻一档整个行就浮起来，
               名字那一行自然成了主位（参考图里正文也是极轻的一档灰）。 */
            fontWeight: 300,
            lineHeight: 1.4,
            letterSpacing: ".02em",
            color: hot ? HZ.ink : HZ.ink2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {previewOf(last)}
        </div>
      </div>

      {/* 右列：时间 ＋ 未读 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          minWidth: 40,
        }}
      >
        <span
          style={{
            fontFamily: LAT,
            fontSize: 9.5,
            letterSpacing: ".06em",
            color: HZ.ink3,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {listTime(row.timeIso)}
        </span>
        {hot ? (
          <span
            style={{
              minWidth: 17,
              height: 17,
              padding: "0 5px",
              borderRadius: 9,
              background: HZ.accent,
              color: "#FFFFFF",
              fontFamily: LAT,
              fontSize: 10,
              fontWeight: 600,
              lineHeight: "17px",
              textAlign: "center",
              flex: "none",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </div>
    </div>
  );
}
