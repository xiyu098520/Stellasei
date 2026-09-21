"use client";

import { useMemo, useState } from "react";
import {
  BellOff,
  CreditCard,
  Menu,
  Plus,
  ScanLine,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { AVATAR_GRADIENT, EN, SANS, T, listTime, previewOf } from "./shared";
import { hexToRgba } from "@/lib/colors";
import { DEFAULT_MASK_ID, type Mask } from "@/lib/settings/mask";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";

/* =======================================================================
 * 消息列表页（黑粉蓝板）。
 * 不套主题、不起名：底是透粉的白，主色是一支亮粉（有未读的卡整张就是
 * 粉的，一眼分得清），蓝只做置顶那一小枚记号，黄只在未读计数上跳一下；出彩靠
 * 的是字号对比、留白、圆角和按钮的分量。头像留着，是圆的。
 * 消息列表是全局的：显示所有面具的所有绑定对话（同一角色可多行）
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

export default function MessageList({
  archives,
  conversations,
  masks,
  onOpenChat,
  onOpenSidebar,
  showToast,
}: {
  archives: ArchiveEntry[];
  /** 全部会话（跨面具）。 */
  conversations: Conversation[];
  masks: Mask[];
  onOpenChat: (characterId: string, maskId: string) => void;
  onOpenSidebar: () => void;
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

  const pinned = useMemo(() => searched.filter((r) => r.conv?.isPinned === true), [searched]);
  const normal = useMemo(
    () =>
      searched
        .filter((r) => r.conv?.isPinned !== true)
        .sort((a, b) => b.timeIso.localeCompare(a.timeIso)),
    [searched],
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        fontFamily: SANS,
        color: T.ink,
        overflow: "hidden",
      }}
    >
      {/* 互动：按下整张卡往里收一档、颜色压暗一点（不跑动画，只动 transform／filter）。
          加号摊开是错开落下的位移＋缩放。 */}
      <style>{`
        .ml-card { transition: transform .16s ease, filter .16s ease; }
        .ml-card:active { transform: scale(.982); filter: brightness(.95); }
        .ml-hbtn { transition: opacity .15s ease, transform .15s ease; }
        .ml-hbtn:active { opacity: .6; transform: scale(.94); }
        .ml-search::placeholder { color: ${T.ink3}; }
        .ml-sheet {
          transition: transform .26s cubic-bezier(.34,1.4,.64,1), opacity .18s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .ml-card, .ml-hbtn, .ml-sheet { transition: none; }
        }
      `}</style>

      {/* 头部：菜单圆钮＋刊号小字 → 大标题「消息」＋一颗粉圆按钮 */}
      <div
        style={{
          flex: "none",
          zIndex: 20,
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 4px) 20px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="打开侧边栏"
            className="ml-hbtn"
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${T.line}`,
              background: T.card,
              color: T.ink,
              cursor: "pointer",
              boxShadow: "0 6px 16px -12px rgba(20,19,24,.5)",
            }}
          >
            <Menu size={17} strokeWidth={1.9} />
          </button>
          <span
            style={{
              fontFamily: EN,
              fontSize: 9.5,
              letterSpacing: ".24em",
              color: T.ink3,
              textTransform: "uppercase",
            }}
          >
            Stellasei · Messages
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginTop: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-.01em",
                lineHeight: 1,
                color: T.ink,
              }}
            >
              消息
            </h1>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                letterSpacing: ".06em",
                color: T.ink3,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {searched.length} 条对话
            </div>
          </div>

          {/* 粉圆按钮：按一下，四张卡从它底下错开摊出来 */}
          <div style={{ position: "relative", flex: "none" }}>
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              aria-label="更多"
              className="ml-hbtn"
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                border: "none",
                background: T.pink,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 14px 26px -14px rgba(232,106,155,.9)",
              }}
            >
              <Plus
                size={22}
                strokeWidth={2.4}
                style={{
                  transition: "transform .25s cubic-bezier(.22,1,.36,1)",
                  transform: plusOpen ? "rotate(45deg)" : "none",
                }}
              />
            </button>

            <div
              style={{
                position: "absolute",
                top: 60,
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
                    background: T.card,
                    borderRadius: 16,
                    boxShadow: "0 18px 30px -18px rgba(20,19,24,.45)",
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
                      background: T.pinkSoft,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <item.icon size={15} strokeWidth={1.9} color={T.pink} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5, letterSpacing: ".04em", color: T.ink }}>
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 搜索：一颗白胶囊 */}
      <div style={{ flex: "none", padding: "12px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 44,
            padding: "0 16px",
            background: T.card,
            border: `1px solid ${T.line}`,
            borderRadius: 999,
          }}
        >
          <Search size={16} strokeWidth={2} color={T.ink3} style={{ flex: "none" }} />
          <input
            type="text"
            className="ml-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="找一个人"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              letterSpacing: ".03em",
              fontFamily: SANS,
              color: T.ink,
            }}
          />
        </div>
      </div>

      {/* 条目：一行一张卡 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "12px 16px calc(var(--safe-area-bottom, 0px) + 18px)",
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
                <SectionLabel cn="置顶" count={pinned.length} dot={T.blue} />
                {pinned.map((row) => (
                  <ConversationRow
                    key={`${row.conv.characterId}::${row.maskId}`}
                    row={row}
                    onOpen={() => onOpenChat(row.conv.characterId, row.maskId)}
                  />
                ))}
              </div>
            ) : null}
            {normal.length > 0 ? (
              <div>
                {pinned.length > 0 ? <SectionLabel cn="全部" count={normal.length} /> : null}
                {normal.map((row) => (
                  <ConversationRow
                    key={`${row.conv.characterId}::${row.maskId}`}
                    row={row}
                    onOpen={() => onOpenChat(row.conv.characterId, row.maskId)}
                  />
                ))}
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

/** 空状态：一小撮粉线起头，下面两行字——纯排版，不放图标。 */
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
      <span style={{ width: 32, height: 4, borderRadius: 999, background: T.pink, marginBottom: 20 }} />
      <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, letterSpacing: ".06em" }}>{cn}</div>
      <div
        style={{
          marginTop: 10,
          fontSize: 12.5,
          color: T.ink2,
          letterSpacing: ".04em",
          lineHeight: 1.6,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

/** 分组小标：一颗色点＋名字＋条数，不用横条，轻一点。 */
function SectionLabel({ cn, count, dot }: { cn: string; count: number; dot?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 8px 10px",
      }}
    >
      {dot ? <i style={{ width: 7, height: 7, borderRadius: 999, background: dot }} /> : null}
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".16em", color: T.ink2 }}>
        {cn}
      </span>
      <span
        style={{
          fontFamily: EN,
          fontSize: 9.5,
          letterSpacing: ".12em",
          color: T.ink3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(count).padStart(2, "0")}
      </span>
    </div>
  );
}

/** 单条会话卡（一个绑定一张）。
 *  有未读的卡整张铺粉、字走近黑（粉底黑字，对比够、又抢眼）；
 *  置顶是名字前一小枚蓝记号；头像留着，50 的圆，外圈一道细环。
 *  按下整张卡往里收一档、颜色压暗一点。 */
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

  const subColor = hot ? "rgba(20,19,24,.66)" : T.ink2;
  const metaColor = hot ? "rgba(20,19,24,.58)" : T.ink3;

  return (
    <div
      className="ml-card"
      onClick={onOpen}
      data-tap="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 15px",
        marginBottom: 10,
        borderRadius: 20,
        /* 整张卡从头到尾都要能点 —— 显式铺满，别只指望父级的拉伸 */
        width: "100%",
        boxSizing: "border-box",
        /* 有未读的卡：铺一层**很淡的粉**（不是主粉）。
           铺主粉 #E86A9B 的话，一片重色压下来，卡上的名字和预览反倒糊了、看不清。
           换成淡粉底，一眼认得出「这条没读」，字还是清清楚楚。 */
        background: hot ? T.pinkSoft : T.card,
        boxShadow: hot
          ? "0 14px 26px -20px rgba(232,106,155,.7)"
          : "0 12px 26px -22px rgba(20,19,24,.7)",
        cursor: "pointer",
      }}
    >
      {/* 头像：50 的圆＋一道细环（头像留着；不吃指针，点到哪儿都算点这张卡） */}
      <div
        style={{
          flex: "none",
          width: 50,
          height: 50,
          borderRadius: 999,
          padding: 2,
          background: hot ? "#FFFFFF" : T.pinkSoft,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
            color: "#FFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 600,
            overflow: "hidden",
          }}
        >
          {d.photo ? null : name.slice(0, 1)}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {/* 置顶：一小枚蓝记号（全界面蓝就用在这）。马卡龙蓝浅，字用深蓝才看得清 */}
          {pinned ? (
            <span
              style={{
                flex: "none",
                background: T.blue,
                color: T.blueDeep,
                fontFamily: SANS,
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: ".12em",
                padding: "2px 6px",
                borderRadius: 999,
                lineHeight: 1.3,
              }}
            >
              置顶
            </span>
          ) : null}
          <span
            style={{
              minWidth: 0,
              fontSize: 16,
              fontWeight: hot ? 800 : 700,
              letterSpacing: ".01em",
              color: T.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </span>

          {conv?.isMuted ? (
            <BellOff size={12} strokeWidth={2} color={metaColor} style={{ flex: "none" }} />
          ) : null}

          {/* 面具标签（只在同名撞行时挂）：要在行的右边一点，而且非常淡——
              所以它**贴着行的右端**待着（marginLeft auto），底色只是那支面具色的 10%，
              字 72%，安静得几乎看不见。
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

        <span
          style={{
            fontSize: 12.5,
            letterSpacing: ".02em",
            color: subColor,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {previewOf(last)}
        </span>
      </div>

      {/* 右列：时间 ＋ 未读 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 7,
          minWidth: 40,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: ".04em",
            color: metaColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {listTime(row.timeIso)}
        </span>
        {hot ? (
          <span
            style={{
              /* 白药丸＋粉字，在淡粉卡上自己浮起来（加一点粉影，不靠加深底色）。
                 数字不能小：字号 22／12.5。 */
              display: "block",
              minWidth: 22,
              height: 22,
              padding: "0 7px",
              borderRadius: 999,
              background: "#FFFFFF",
              color: T.pink,
              boxShadow: "0 2px 6px -2px rgba(232,106,155,.45)",
              /* 数字要落在圆心。行盒怎么摆都白搭：
                 上下留白之差 = (ascent − 数字高) − descent，**跟行高完全无关**，两种写法同一个位置。
                 原因在字体：EN 是 Playfair 衬线体，ascent 1082／descent 276／数字高 700（千分），
                 数字上方比下方多出 0.053em（12.5px 字号 ≈ 0.66px），天生下沉。
                 所以**字体留着**，让数字自己往上抬 0.7px（值就是上面算出来的那 0.053em）。
                 抬的是里层 span，圆底、白底、粉影都在外层，一点不动。 */
              textAlign: "center",
              lineHeight: "22px",
              fontFamily: EN,
              fontSize: 12.5,
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {/* 只把数字往上抬：inline 元素上的相对定位不改行盒布局，只挪它自己画在哪，
                所以圆的尺寸、数字在行里的位置都不受影响，抬的就是「看着偏下」那一点。
                抬到 -1px。 */}
            <span style={{ position: "relative", top: "-1px" }}>
              {unread > 99 ? "99+" : unread}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
