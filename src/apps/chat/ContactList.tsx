"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  BellOff,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Menu,
  Plus,
  Search,
  Send,
  Settings2,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { appendMessage, updateCharChatSettings, updateConversation } from "@/lib/settings/chat";
import {
  acceptFriendRequest,
  blockFriend,
  blockedFirstReaction,
  hardDeleteFriend,
  rejectFriendRequest,
  removeFriend,
  restoreFriend,
  sendFriendRequest,
  unblockFriend,
  unblockedFirstReaction,
} from "@/lib/chat/social";
import { formatUid } from "@/lib/settings/contact";
import { copyText } from "@/lib/clipboard";
import { GroupTitle, Switch } from "./widgets";
import CharacterSettingsPanel from "./CharacterSettingsPanel";
import { AVATAR_GRADIENT, EN, SANS, T, defaultSignature, momentTime } from "./shared";
import type { ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";

/* =======================================================================
 * 通讯人页（独立视图，形态参考旧档案 ContactList）
 * 通讯人＝当前面具的朋友圈：只显示当前面具添加过（绑定）的角色。
 * 「添加朋友」＝从已唤醒档案里选角色，为当前面具建立绑定。
 * 「新的朋友」＝被假删的角色发来的好友申请（同意后恢复聊天）。
 *
 * 皮整页换 T 板（黑粉蓝），左右两边（消息列表 `MessageList`、聊天窗口、设置面板）也是这套：
 * ① 结构／骨把页内四个滑页与两个弹窗同步换成 T 板，返回钮用近黑圆＋白图标（设置面板那枚）；
 * ② 空态改成「一小撮粉线＋两行字」。
 * 黑的用法守旧例：只落在大标题与返回钮上，**不整页翻黑**。
 * 零件（GroupLabel／ContactRow／AddFriendProfile／ContactProfile／ProfileRow）在文件末尾本地重写。
 * 本页的「章节头」直接引 `widgets.tsx` 那枚 `GroupTitle`，两页同一套零件；其余零件仍旧本地。
 *
 * 名册——通讯人要有自己的样子，不照搬消息列表那套。定成**一本名册**：
 *   ① 册头：大标题「通讯人」右边挂一枚粉色条数小牌，下面一行 `the roster`；
 *      标题底下压**一条通栏册页线**（粉→透明渐变）——消息列表没有这条，一眼分得开。
 *   ② 索引带：「新的朋友」是一条带子，没人申请是淡粉底粉字、
 *      有人申请整条变实粉白字，右端一枚半透明小胶囊写条数。
 *   ③ 索引签：分组小标＝一根小竖色条＋名字＋英文小字，再一条细线**拉到右端**，最右是条数。
 *   ④ 名单：**不再是「一条人一张卡」**，改成**一整张白纸**（圆角 22 的卡），
 *      人和人之间用一条**从名字起头处（left 56）划到右端**的极淡书写线分隔；
 *      行高比会话卡矮、头像 44，星标的人头像外环换成亮粉。
 * 一句话对照：消息列表是「一条一张卡」，通讯人是「一整张纸上的名单」。
 *
 * 骨架三处：
 *   ① 工具条：搜索胶囊与「新的朋友」**并成一行**——
 *      搜索占满，右边一枚 56×46 的竖排小钮（图标＋9px 小字），有申请时整枚变实粉、
 *      右上角挂一枚白底粉字的小角标写条数。
 *   ② 星标联系人：**一条横向头像带**（头像 58＋粉外环＋名字／昵称），
 *      整条通栏横滑、不打滚动条——通讯人页独有的一道横结构。
 *   ③ 通讯人：**双列方格墙**（白板上直接排名片格，
 *      格内不再垫卡片，头像 40＋名字＋昵称），两列并排，一眼就不是「一条一张卡」。
 * 骨架对照：消息列表＝一列竖排行；通讯人＝工具条＋横条＋方格墙。
 * ===================================================================== */

export default function ContactList({
  archives,
  conversations,
  maskId,
  maskName,
  onOpenChat,
  onOpenSidebar,
  onDataChange,
  showToast,
}: {
  archives: ArchiveEntry[];
  /** 当前面具的会话（＝当前面具的朋友列表）。 */
  conversations: Conversation[];
  /** 当前使用中的面具 id。 */
  maskId: string;
  /** 当前面具的名字（添加朋友页展示）。 */
  maskName: string;
  onOpenChat: (characterId: string) => void;
  onOpenSidebar: () => void;
  onDataChange: () => void;
  showToast: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /* 新的朋友页：被假删角色的好友申请（同意恢复／拒绝等 TA 再来）。 */
  const [newFriendsOpen, setNewFriendsOpen] = useState(false);
  /* 角色设置页（资料页进入）。 */
  const [charSettingsOpen, setCharSettingsOpen] = useState(false);
  /* 申请生成中（角色 id 集合，页面里显示「正在申请…」）。 */
  const [reqBusy, setReqBusy] = useState<Set<string>>(new Set());
  /* 拉黑／解除等社交动作进行中（资料页按钮防抖）。 */
  const [socialBusy, setSocialBusy] = useState(false);
  /* 添加朋友页：搜索 + 角色资料滑页 + 好友申请（验证消息／关闭问候）。 */
  const [addQuery, setAddQuery] = useState("");
  const [addDetail, setAddDetail] = useState<ArchiveEntry | null>(null);
  const [requestTo, setRequestTo] = useState<ArchiveEntry | null>(null);
  const [greetText, setGreetText] = useState("");
  const [noGreet, setNoGreet] = useState(false);

  /* 行数据：当前面具的朋友（绑定）＋档案；被删除（等申请）的暂时隐藏。 */
  const rows = useMemo(() => {
    return conversations
      .filter((conv) => conv.friendStatus !== "removed" && conv.friendStatus !== "requested")
      .flatMap((conv) => {
        const archive = archives.find((a) => a.id === conv.characterId);
        return archive ? [{ archive, conv }] : [];
      });
  }, [archives, conversations]);

  /* 新的朋友：待处理的申请＋被删掉的角色（TA 会来求加回）。 */
  const requestedConvs = useMemo(
    () => conversations.filter((c) => c.friendStatus === "requested"),
    [conversations],
  );
  const removedConvs = useMemo(
    () => conversations.filter((c) => c.friendStatus === "removed"),
    [conversations],
  );

  /* 打开「新的朋友」时：让每个被删的角色发来好友申请（生成一次即可）。 */
  const reqFiredFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!newFriendsOpen) return;
    const pending = conversations.filter((c) => {
      const key = `${c.characterId}::${c.maskId ?? ""}`;
      return c.friendStatus === "removed" && !reqFiredFor.current.has(key);
    });
    if (pending.length === 0) return;
    for (const c of pending) reqFiredFor.current.add(`${c.characterId}::${c.maskId ?? ""}`);
    setReqBusy((prev) => {
      const next = new Set(prev);
      for (const c of pending) next.add(c.characterId);
      return next;
    });
    void (async () => {
      for (const c of pending) {
        const archive = archives.find((a) => a.id === c.characterId);
        if (!archive) continue;
        try {
          await sendFriendRequest(archive, c, maskName);
        } catch {
          // 生成失败留在 removed，下次打开页面 TA 再试
        }
        setReqBusy((prev) => {
          const next = new Set(prev);
          next.delete(c.characterId);
          return next;
        });
        onDataChange();
      }
    })();
  }, [newFriendsOpen, conversations, archives, maskName, onDataChange]);

  /* 可添加的角色：已唤醒但当前面具还没绑定过的（支持 ID／姓名／昵称搜索）。 */
  const available = useMemo(() => {
    const notAdded = archives.filter((a) => !conversations.some((c) => c.characterId === a.id));
    const q = addQuery.trim().toLowerCase().replace(/\s/g, "");
    if (!q) return notAdded;
    return notAdded.filter((a) => {
      const d = a.data;
      return (
        a.uid.replace(/\s/g, "").includes(q) ||
        (d.name || "").toLowerCase().includes(q) ||
        (d.nickname || "").toLowerCase().includes(q)
      );
    });
  }, [archives, conversations, addQuery]);

  /** 打开好友申请弹窗（验证消息 + 关闭问候）。 */
  const openRequest = (arch: ArchiveEntry) => {
    const nm = maskName.trim();
    setGreetText(nm && nm !== "我" ? `我是${nm}，很高兴认识你。` : "很高兴认识你。");
    setNoGreet(false);
    setRequestTo(arch);
  };

  /** 发送申请＝立即成为好友；未关闭问候时，问候语成为对话的第一条消息。 */
  const sendRequest = useCallback(
    async (arch: ArchiveEntry, greet: string, silent: boolean) => {
      await updateConversation(arch.id, maskId, {});
      if (!silent && greet.trim()) {
        await appendMessage(arch.id, maskId, {
          role: "user",
          content: greet.trim(),
          isRead: true,
        });
      }
      setRequestTo(null);
      setAddDetail(null);
      setAddOpen(false);
      setAddQuery("");
      onDataChange();
      showToast("已发送申请，你们现在是好友了");
    },
    [maskId, onDataChange, showToast],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.archive.data.name}\n${r.archive.data.nickname}\n${r.archive.id}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  /* 分组：星标联系人优先，其余按最近联系排序。 */
  const starred = useMemo(() => filtered.filter((r) => r.conv?.isPinned === true), [filtered]);
  const normal = useMemo(
    () =>
      filtered
        .filter((r) => r.conv?.isPinned !== true)
        .sort((a, b) => (b.conv?.updatedAt ?? "").localeCompare(a.conv?.updatedAt ?? "")),
    [filtered],
  );

  const selected = archives.find((a) => a.id === profileId) ?? null;
  const selectedConv = conversations.find((c) => c.characterId === profileId);

  /** 有没有待处理的好友申请：决定「新的朋友」那条索引带是实粉还是淡粉。 */
  const hasRequest = requestedConvs.length > 0;

  /** 星标／免打扰写回当前面具的会话，并刷新上层数据。 */
  const toggleConv = async (patch: { isPinned?: boolean; isMuted?: boolean }) => {
    if (!profileId) return;
    await updateConversation(profileId, maskId, patch);
    onDataChange();
  };

  /** 假删好友：好友列表暂时消失，记录与记忆保留，等 TA 发来申请加回。 */
  const deleteFriend = async () => {
    if (!profileId) return;
    await removeFriend(profileId, maskId);
    setProfileId(null);
    onDataChange();
    showToast("已删除好友，TA 也许会来请求加回");
  };

  /** 真删好友：会话与记忆一并清掉，不留 removed 状态 —— TA 不会再来请求加回。
   *  角色档案本身不动，以后想聊可以自己去「添加朋友」把他加回来。 */
  const hardDeleteFriendNow = async () => {
    if (!profileId) return;
    await hardDeleteFriend(profileId, maskId);
    setProfileId(null);
    onDataChange();
    showToast("已彻底删除，聊天记录与记忆都清掉了");
  };

  /** 拉黑：开关点了立刻生效（状态＋系统提示先落库）；TA 的第一反应在后台慢慢写，落库完再刷一次列表。 */
  const doBlock = useCallback(
    async (archive: ArchiveEntry, conv: Conversation | undefined) => {
      if (!conv) return;
      setSocialBusy(true);
      try {
        showToast("已加入黑名单");
        await blockFriend(archive, conv);
        onDataChange();
      } finally {
        setSocialBusy(false);
      }
      void blockedFirstReaction(archive, conv, maskName).finally(() => onDataChange());
    },
    [maskName, onDataChange, showToast],
  );

  /** 解除拉黑：同上——开关立刻生效，TA 的那句回应后台慢慢来。 */
  const doUnblock = useCallback(
    async (archive: ArchiveEntry, conv: Conversation | undefined) => {
      if (!conv) return;
      setSocialBusy(true);
      try {
        await unblockFriend(archive, conv);
        onDataChange();
        showToast("已解除拉黑");
      } finally {
        setSocialBusy(false);
      }
      void unblockedFirstReaction(archive, conv, maskName).finally(() => onDataChange());
    },
    [maskName, onDataChange, showToast],
  );

  /** 同意好友申请：恢复好友，附言成为 TA 回到聊天的第一句话。 */
  const doAccept = useCallback(
    async (conv: Conversation) => {
      await acceptFriendRequest(conv);
      onDataChange();
      showToast("已同意，你们重新成为了好友");
    },
    [onDataChange, showToast],
  );

  /** 拒绝申请：TA 消失在申请列表里，下次打开页面还会再来求。 */
  const doReject = useCallback(
    async (conv: Conversation) => {
      await rejectFriendRequest(conv);
      onDataChange();
      showToast("已拒绝");
    },
    [onDataChange, showToast],
  );

  /** 反悔了：不走申请流程，直接恢复好友。 */
  const doRestore = useCallback(
    async (conv: Conversation) => {
      await restoreFriend(conv);
      onDataChange();
      showToast("已恢复好友");
    },
    [onDataChange, showToast],
  );

  /** 打开添加朋友页（加号菜单入口）。 */
  const openAddFriend = () => {
    setPlusOpen(false);
    setAddOpen(true);
  };

  const openProfile = (archive: ArchiveEntry) => {
    setProfileId(archive.id);
    setPlusOpen(false);
  };

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
      {/* 交互：按下整行／整卡往里收一档，菜单小片错开落下（同消息列表） */}
      <style>{`
        .cl-card { transition: transform .16s ease, filter .16s ease; }
        .cl-card:active { transform: scale(.982); filter: brightness(.96); }
        .cl-hbtn { transition: opacity .15s ease, transform .15s ease; }
        .cl-hbtn:active { opacity: .6; transform: scale(.94); }
        .cl-tile { transition: transform .16s ease, background-color .16s ease; }
        /* 按住时「整格」都要有反馈 —— 底色换成看得见的马卡龙蓝软色；
           按下要立刻变色，所以 :active 单独把过渡压短，松手再慢慢化开 */
        .cl-tile:active { transform: scale(.968); background-color: ${T.blueSoft}; transition-duration: .06s; }
        .cl-face { transition: transform .18s ease; }
        .cl-face:active { transform: scale(.93); }
        .cl-soft { transition: transform .16s ease, filter .16s ease; }
        .cl-soft:active { transform: scale(.94); }
        .cl-fill { transition: transform .16s ease, filter .16s ease; }
        .cl-fill:active { filter: brightness(.94); }
        /* 资料页里能点的整行（角色设置／动态／拉黑）也要有按住反馈 */
        .cl-row { transition: transform .16s ease, background-color .16s ease; }
        .cl-row:active { background-color: ${T.pinkSoft}; transition-duration: .06s; }
        .cl-search::placeholder { color: ${T.ink3}; }
        /* 星标头像带：横滑不要滚动条，靠渐隐提示还有货 */
        .cl-strip { scrollbar-width: none; -ms-overflow-style: none; }
        .cl-strip::-webkit-scrollbar { display: none; }
        .cl-sheet { transition: transform .26s cubic-bezier(.34,1.4,.64,1), opacity .18s ease; }
        @media (prefers-reduced-motion: reduce) {
          .cl-card, .cl-hbtn, .cl-tile, .cl-face, .cl-soft, .cl-fill, .cl-row, .cl-sheet { transition: none; }
        }
      `}</style>

      {/* 册头：菜单钮＋刊号小字 → 大标题「通讯人」＋粉色条数小牌；底下压一条通栏册页线 */}
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
            className="cl-hbtn"
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
            Stellasei · Contacts
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                通讯人
              </h1>
              {/* 名册条数：一枚粉色小牌 */}
              <span
                style={{
                  flex: "none",
                  minWidth: 24,
                  height: 22,
                  padding: "0 8px",
                  borderRadius: 999,
                  background: T.pink,
                  color: "#FFFFFF",
                  fontFamily: EN,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontVariantNumeric: "tabular-nums",
                  boxShadow: "0 8px 16px -10px rgba(232,106,155,.95)",
                }}
              >
                {rows.length}
              </span>
            </div>
            <div
              style={{
                marginTop: 9,
                fontFamily: EN,
                fontSize: 9.5,
                letterSpacing: ".26em",
                color: T.ink3,
                textTransform: "uppercase",
              }}
            >
              the roster
            </div>
          </div>

          {/* 粉圆按钮：按一下，两张卡从它底下错开摊出来 */}
          <div style={{ position: "relative", flex: "none" }}>
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              aria-label="更多"
              className="cl-hbtn"
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
                // 收起时容器不接点击，否则这块 176 宽的空盒子会挡住底下最上面那张卡
                pointerEvents: plusOpen ? "auto" : "none",
              }}
            >
              {[
                { name: "发起群聊", icon: Users },
                { name: "添加朋友", icon: UserPlus },
              ].map((item, i) => (
                <div
                  key={item.name}
                  className="cl-sheet"
                  onClick={() => {
                    if (item.name === "添加朋友") {
                      setPlusOpen(false);
                      openAddFriend();
                      return;
                    }
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
                  <item.icon size={17} strokeWidth={2} color={T.pink} style={{ flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 13.5, letterSpacing: ".04em", color: T.ink }}>
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 册页线：通栏一条细线，从粉线淡到透明——通讯人自己的页眉，消息列表没有这条 */}
      <div
        style={{
          flex: "none",
          height: 1,
          marginTop: 16,
          background: `linear-gradient(90deg, ${T.pink} 0%, ${T.pinkSoft} 24%, ${T.lineSoft} 56%, rgba(20,19,24,0) 100%)`,
        }}
      />

      {/* 工具条：搜索胶囊占满，右边一枚竖排小钮收着「新的朋友」 */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "stretch",
          gap: 10,
          padding: "14px 20px 0",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 46,
            padding: "0 16px",
            background: T.card,
            border: `1px solid ${T.line}`,
            borderRadius: 999,
          }}
        >
          <Search size={16} strokeWidth={2} color={T.ink3} style={{ flex: "none" }} />
          <input
            type="text"
            className="cl-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索姓名、昵称或 ID"
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

        {/* 新的朋友：一枚竖排小钮（图标＋小字），有申请整枚变实粉＋右上角角标 */}
        <button
          type="button"
          onClick={() => {
            setPlusOpen(false);
            setNewFriendsOpen(true);
          }}
          aria-label="新的朋友"
          className="cl-soft"
          style={{
            position: "relative",
            flex: "none",
            width: 56,
            height: 46,
            borderRadius: 16,
            border: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            background: hasRequest ? T.pink : T.pinkSoft,
            color: hasRequest ? "#FFFFFF" : T.pink,
            transition: "background .2s, color .2s",
            boxShadow: hasRequest ? "0 14px 26px -16px rgba(232,106,155,.9)" : "none",
            cursor: "pointer",
          }}
        >
          <UserPlus size={17} strokeWidth={2.1} />
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".08em", lineHeight: 1 }}>
            新的朋友
          </span>
          {hasRequest ? (
            <span
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "#FFFFFF",
                color: T.pink,
                fontFamily: EN,
                fontSize: 9.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {requestedConvs.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* 通讯人名单：整页一整张白纸，一行行的条目，不是一人一张卡 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "14px 20px calc(var(--safe-area-bottom, 0px) + 18px)",
        }}
      >
        {archives.length === 0 ? (
          <EmptyState cn="还没有通讯人" en="no contacts yet" hint="去「档案」唤醒一个角色，TA 就会出现在这里" />
        ) : rows.length === 0 ? (
          <EmptyState cn="还没有朋友" en="no friends yet" hint="点右上角「＋」，选择「添加朋友」开始聊天" />
        ) : (
          <>
            {starred.length > 0 || normal.length > 0 ? (
              <>
                {/* 星标：一条横向头像带——通栏横滑，不打滚动条（通讯人页独有的横结构） */}
                {starred.length > 0 ? (
                  <div style={{ flex: "none" }}>
                    <GroupLabel cn="星标联系人" en="starred" count={starred.length} dot={T.pink} />
                    <div
                      className="cl-strip"
                      style={{
                        display: "flex",
                        gap: 12,
                        margin: "2px -20px 0",
                        padding: "2px 20px 4px",
                        overflowX: "auto",
                        overscrollBehaviorX: "contain",
                      }}
                    >
                      {starred.map((row) => (
                        <ContactFace
                          key={row.archive.id}
                          archive={row.archive}
                          onClick={() => openProfile(row.archive)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 通讯人：双列方格墙——白板上直接排名片格，两列并排（不是一条一条的行） */}
                {normal.length > 0 ? (
                  <div
                    style={{
                      marginTop: starred.length > 0 ? 18 : 0,
                      background: T.card,
                      borderRadius: 22,
                      boxShadow: "0 16px 34px -26px rgba(20,19,24,.75)",
                      padding: "2px 12px 14px",
                    }}
                  >
                    <GroupLabel cn="通讯人" en="contacts" count={normal.length} dot={T.blue} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {normal.map((row, i) => (
                        <ContactTile
                          key={row.archive.id}
                          archive={row.archive}
                          conv={row.conv}
                          /* 落单的那一格铺满整行 —— 否则右边半格是死区，点右边没反应 */
                          wide={normal.length % 2 === 1 && i === normal.length - 1}
                          onClick={() => openProfile(row.archive)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState cn="这里空着" en="nothing here" hint={`没有找到「${query.trim()}」`} />
            )}
          </>
        )}
      </div>

      {/* 加号菜单遮罩（盖住列表区域用于点空白收起；须低于顶栏 20，否则会压住菜单点不了） */}
      {plusOpen ? (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 19 }}
          onClick={() => setPlusOpen(false)}
        />
      ) : null}

      {/* 添加朋友页：为当前面具挑角色建绑定 */}
      {addOpen ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 60,
            background: T.bg,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 页头：近黑圆返回钮＋一行英文小字 → 26/800 大标题（同设置面板） */}
          <div
            style={{
              flex: "none",
              padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddDetail(null);
                  setAddQuery("");
                }}
                aria-label="返回"
                className="cl-soft"
                style={headerBtnStyle}
              >
                <ChevronLeft size={19} strokeWidth={2.2} />
              </button>
              <span
                style={{
                  fontFamily: EN,
                  fontSize: 9,
                  letterSpacing: ".26em",
                  color: T.ink3,
                  textTransform: "uppercase",
                }}
              >
                add friends
              </span>
            </div>
            <h1
              style={{
                margin: "14px 0 0",
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-.01em",
                lineHeight: 1,
                color: T.ink,
              }}
            >
              添加朋友
            </h1>
          </div>

          {/* 搜索：一颗白胶囊 */}
          <div style={{ flex: "none", padding: "0 16px" }}>
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
                className="cl-search"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="输入 ID、姓名或昵称"
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

          <div
            style={{
              flex: "none",
              margin: "10px 18px 0",
              fontSize: 10.5,
              color: T.ink3,
              letterSpacing: ".06em",
            }}
          >
            以「{maskName}」的身份添加
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              overscrollBehavior: "none",
              padding: "0 16px calc(var(--safe-area-bottom, 0px) + 18px)",
            }}
          >
            {available.length === 0 ? (
              <EmptyState
                cn={
                  archives.length === 0
                    ? "没有可添加的角色"
                    : addQuery.trim()
                      ? "这里空着"
                      : "都加过了"
                }
                en="add friends"
                hint={
                  archives.length === 0
                    ? "先去「档案」唤醒角色，再来添加朋友"
                    : addQuery.trim()
                      ? "试试输入完整的 ID、姓名或昵称"
                      : "这个面具已经加过所有角色了"
                }
              />
            ) : (
              <>
                {/* 分组小标：浏览＝未添加的角色；搜索＝搜索词＋结果数 */}
                <div style={addSectionTitleStyle}>
                  {addQuery.trim()
                    ? `搜索「${addQuery.trim()}」 · ${available.length} 个结果`
                    : "未添加的角色"}
                </div>
                {available.map((archive) => {
                  const d = archive.data;
                  const name = d.name || d.nickname || "未命名";
                  const nickname = d.nickname && d.nickname !== d.name ? d.nickname : "";
                  return (
                    <div
                      key={archive.id}
                      onClick={() => setAddDetail(archive)}
                      data-tap="true"
                      className="cl-card"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 13,
                        padding: "12px 14px",
                        marginBottom: 10,
                        borderRadius: 20,
                        background: T.card,
                        boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
                        cursor: "pointer",
                      }}
                    >
                      {/* 头像：48 的圆＋一道淡粉细环 */}
                      <div
                        style={{
                          flex: "none",
                          width: 48,
                          height: 48,
                          borderRadius: 999,
                          padding: 2,
                          background: T.pinkSoft,
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            borderRadius: 999,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#FFF",
                            fontSize: 17,
                            fontWeight: 600,
                            letterSpacing: ".05em",
                            background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
                            overflow: "hidden",
                          }}
                        >
                          {!d.photo ? name.charAt(0) : null}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span
                            style={{
                              fontSize: 15.5,
                              fontWeight: 700,
                              letterSpacing: ".01em",
                              color: T.ink,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {name}
                          </span>
                          {nickname ? (
                            <em
                              style={{
                                fontStyle: "normal",
                                fontSize: 11,
                                color: T.pink,
                                letterSpacing: ".06em",
                                fontWeight: 500,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {nickname}
                            </em>
                          ) : null}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: T.ink3,
                            marginTop: 4,
                            letterSpacing: ".06em",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ID · {formatUid(archive.uid)}
                        </div>
                      </div>
                      <ChevronRight size={16} strokeWidth={2.2} color={T.ink3} style={{ flex: "none" }} />
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* 新的朋友页：被假删角色的好友申请（打开时 TA 逐个发来） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 50,
          background: T.bg,
          display: "flex",
          flexDirection: "column",
          transform: newFriendsOpen ? "none" : "translateX(100%)",
          transition: "transform .32s cubic-bezier(.22,1,.36,1)",
          pointerEvents: newFriendsOpen ? "auto" : "none",
        }}
      >
        {/* 页头：近黑圆返回钮＋一行英文小字 → 26/800 大标题（同添加朋友页） */}
        <div
          style={{
            flex: "none",
            padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setNewFriendsOpen(false)}
              aria-label="返回"
              className="cl-soft"
              style={headerBtnStyle}
            >
              <ChevronLeft size={19} strokeWidth={2.2} />
            </button>
            <span
              style={{
                fontFamily: EN,
                fontSize: 9,
                letterSpacing: ".26em",
                color: T.ink3,
                textTransform: "uppercase",
              }}
            >
              new friends
            </span>
          </div>
          <h1
            style={{
              margin: "14px 0 0",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-.01em",
              lineHeight: 1,
              color: T.ink,
            }}
          >
            新的朋友
          </h1>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overscrollBehavior: "none",
            padding: "0 16px calc(var(--safe-area-bottom, 0px) + 18px)",
          }}
        >
          {requestedConvs.length === 0 && removedConvs.length === 0 ? (
            <EmptyState
              cn="还没有好友申请"
              en="new friends"
              hint="删除的好友想加回你时，申请会出现在这里"
            />
          ) : null}

          {/* TA 发来的申请 */}
          {requestedConvs.length > 0 ? (
            <div>
              <div style={addSectionTitleStyle}>好友申请</div>
              {requestedConvs.map((conv) => {
                const archive = archives.find((a) => a.id === conv.characterId);
                if (!archive) return null;
                const name = archive.data.name || archive.data.nickname || "未命名";
                return (
                  <div
                    key={conv.id}
                    className="cl-card"
                    style={{
                      padding: "13px 15px",
                      marginBottom: 10,
                      borderRadius: 20,
                      background: T.card,
                      boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                      {/* 头像：48 的圆＋一道淡粉细环 */}
                      <div
                        style={{
                          flex: "none",
                          width: 48,
                          height: 48,
                          borderRadius: 999,
                          padding: 2,
                          background: T.pinkSoft,
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            borderRadius: 999,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#FFF",
                            fontSize: 17,
                            fontWeight: 600,
                            background: archive.data.photo
                              ? `url(${archive.data.photo}) center/cover`
                              : AVATAR_GRADIENT,
                            overflow: "hidden",
                          }}
                        >
                          {!archive.data.photo ? name.charAt(0) : null}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15.5, fontWeight: 700, color: T.ink, letterSpacing: ".01em" }}>{name}</div>
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: T.ink2,
                            lineHeight: 1.6,
                            letterSpacing: ".03em",
                          }}
                        >
                          <i
                            style={{
                              fontStyle: "normal",
                              fontFamily: EN,
                              fontSize: 12,
                              color: "rgba(232,106,155,.55)",
                            }}
                          >
                            “
                          </i>
                          {conv.friendRequestMsg || "请求添加你为好友"}
                          <i
                            style={{
                              fontStyle: "normal",
                              fontFamily: EN,
                              fontSize: 12,
                              color: "rgba(232,106,155,.55)",
                            }}
                          >
                            ”
                          </i>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 12, paddingLeft: 61 }}>
                      <button
                        type="button"
                        onClick={() => void doReject(conv)}
                        style={reqGhostBtnStyle}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        onClick={() => void doAccept(conv)}
                        style={reqSolidBtnStyle}
                      >
                        同意
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* 已删除的好友（TA 正在申请／被拒绝后等 TA 再来；可直接恢复） */}
          {removedConvs.length > 0 ? (
            <div>
              <div style={addSectionTitleStyle}>已删除的好友</div>
              {removedConvs.map((conv) => {
                const archive = archives.find((a) => a.id === conv.characterId);
                if (!archive) return null;
                const name = archive.data.name || archive.data.nickname || "未命名";
                const busy = reqBusy.has(conv.characterId);
                return (
                  <div
                    key={conv.id}
                    className="cl-card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      padding: "13px 15px",
                      marginBottom: 10,
                      borderRadius: 20,
                      background: T.card,
                      boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
                    }}
                  >
                    <div
                      style={{
                        flex: "none",
                        width: 48,
                        height: 48,
                        borderRadius: 999,
                        padding: 2,
                        background: T.lineSoft,
                        opacity: 0.9,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: 999,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#FFF",
                          fontSize: 17,
                          fontWeight: 600,
                          background: archive.data.photo
                            ? `url(${archive.data.photo}) center/cover`
                            : AVATAR_GRADIENT,
                          overflow: "hidden",
                        }}
                      >
                        {!archive.data.photo ? name.charAt(0) : null}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 700, color: T.ink, letterSpacing: ".01em" }}>{name}</div>
                      <div style={{ marginTop: 4, fontSize: 11.5, color: T.ink3, letterSpacing: ".04em" }}>
                        {busy ? "正在向你申请……" : "TA 还会再来求你的"}
                      </div>
                    </div>
                    {!busy ? (
                      <button
                        type="button"
                        onClick={() => void doRestore(conv)}
                        style={reqRestoreBtnStyle}
                      >
                        恢复好友
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* 角色设置页（资料页进入）：个别 API／语音参数／参考图 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 50,
          background: T.bg,
          display: "flex",
          flexDirection: "column",
          transform: charSettingsOpen ? "none" : "translateX(100%)",
          transition: "transform .32s cubic-bezier(.22,1,.36,1)",
          pointerEvents: charSettingsOpen ? "auto" : "none",
        }}
      >
        {selected && selectedConv ? (
          <CharacterSettingsPanel
            character={selected}
            conv={selectedConv}
            onBack={() => setCharSettingsOpen(false)}
            onUpdate={async (patch) => {
              /* 个别 API／语音参数／生图参考图是**角色级**的：
                 写角色身上，不写「角色 × 面具」那条会话（换面具照样是这套）。 */
              await updateCharChatSettings(selected.id, patch);
              onDataChange();
            }}
            showToast={showToast}
          />
        ) : null}
      </div>

      {/* 添加朋友 · 角色资料滑页（点头像进，底部「新增通讯人」） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: T.bg,
          zIndex: 65,
          display: "flex",
          flexDirection: "column",
          transform: addDetail ? "none" : "translateX(100%)",
          transition: "transform .32s cubic-bezier(.22,1,.36,1)",
          pointerEvents: addDetail ? "auto" : "none",
        }}
      >
        {addDetail ? (
          <AddFriendProfile
            archive={addDetail}
            onBack={() => setAddDetail(null)}
            onAdd={() => openRequest(addDetail)}
            showToast={showToast}
          />
        ) : null}
      </div>

      {/* 好友申请弹窗（验证消息＋关闭问候） */}
      {requestTo ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 80,
            background: "rgba(20,19,24,.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 26,
          }}
          onClick={() => setRequestTo(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 288,
              borderRadius: 22,
              background: T.card,
              padding: "20px 18px 16px",
              boxShadow: "0 24px 60px -20px rgba(20,19,24,.5)",
            }}
          >
            {/* 对方信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  flex: "none",
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  padding: 2,
                  background: T.pinkSoft,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFF",
                    fontSize: 19,
                    fontWeight: 600,
                    background: requestTo.data.photo
                      ? `url(${requestTo.data.photo}) center/cover`
                      : AVATAR_GRADIENT,
                    overflow: "hidden",
                  }}
                >
                  {!requestTo.data.photo ? (requestTo.data.name || "未").charAt(0) : null}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: T.ink,
                    letterSpacing: ".02em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {requestTo.data.name || requestTo.data.nickname || "未命名"}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: T.ink3,
                    marginTop: 3,
                    letterSpacing: ".06em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ID · {formatUid(requestTo.uid)}
                </div>
              </div>
            </div>

            {/* 验证消息 */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".16em",
                color: T.ink2,
                margin: "16px 0 7px",
              }}
            >
              验证消息
            </div>
            <textarea
              value={greetText}
              onChange={(e) => setGreetText(e.target.value)}
              maxLength={60}
              style={{
                width: "100%",
                border: `1px solid ${T.line}`,
                background: T.bg,
                borderRadius: 14,
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: SANS,
                color: T.ink,
                outline: "none",
                letterSpacing: ".03em",
                lineHeight: 1.7,
                resize: "none",
                minHeight: 64,
              }}
            />

            {/* 关闭问候 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 14,
                background: T.lineSoft,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, letterSpacing: ".04em" }}>
                  关闭问候
                </div>
                <div
                  style={{
                    fontSize: 9.5,
                    color: T.ink3,
                    marginTop: 3,
                    lineHeight: 1.6,
                    letterSpacing: ".03em",
                  }}
                >
                  你们早已相识时开启：TA 不会收到新好友的提示
                </div>
              </div>
              <Switch on={noGreet} onClick={() => setNoGreet((v) => !v)} />
            </div>

            {/* 操作 */}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setRequestTo(null)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 999,
                  border: `1px solid ${T.line}`,
                  background: "transparent",
                  color: T.ink2,
                  fontSize: 13.5,
                  fontFamily: SANS,
                  letterSpacing: ".14em",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void sendRequest(requestTo, greetText, noGreet)}
                className="cl-fill"
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 999,
                  border: "none",
                  background: T.pink,
                  color: "#FFFFFF",
                  fontSize: 13.5,
                  fontWeight: 600,
                  fontFamily: SANS,
                  letterSpacing: ".14em",
                  cursor: "pointer",
                  boxShadow: "0 12px 22px -14px rgba(232,106,155,.95)",
                }}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 个人资料滑页（参考旧档案 profile） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: T.bg,
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          transform: profileId ? "none" : "translateX(100%)",
          transition: "transform .32s cubic-bezier(.22,1,.36,1)",
          pointerEvents: profileId ? "auto" : "none",
        }}
      >
        {selected ? (
          <ContactProfile
            archive={selected}
            conv={selectedConv}
            socialBusy={socialBusy}
            onBack={() => setProfileId(null)}
            onSendMessage={() => {
              setProfileId(null);
              onOpenChat(selected.id);
            }}
            onToggleStar={() => toggleConv({ isPinned: !(selectedConv?.isPinned ?? false) })}
            onToggleMute={() => toggleConv({ isMuted: !(selectedConv?.isMuted ?? false) })}
            onOpenCharSettings={() => setCharSettingsOpen(true)}
            onBlock={() => void doBlock(selected, selectedConv)}
            onUnblock={() => void doUnblock(selected, selectedConv)}
            onDeleteFriend={() => void deleteFriend()}
            onHardDeleteFriend={() => void hardDeleteFriendNow()}
            showToast={showToast}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 页内滑页的返回钮：近黑小圆＋白图标（同聊天设置面板）。 */
const headerBtnStyle = {
  width: 36,
  height: 36,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#FFFFFF",
  background: T.ink,
  transition: "all .18s",
  border: "none",
  boxShadow: "0 4px 12px -4px rgba(20,19,24,.5)",
  cursor: "pointer",
  flex: "none",
} as const;

/** 添加朋友页分组标题（浏览＝未添加的角色／搜索＝搜索词＋结果数）。 */
const addSectionTitleStyle = {
  flex: "none",
  padding: "10px 2px 10px",
  fontSize: 12,
  color: T.ink2,
  letterSpacing: ".16em",
  fontWeight: 700,
} as const;

/** 新的朋友页：拒绝（幽灵钮）。 */
const reqGhostBtnStyle = {
  flex: 1,
  padding: "8px 0",
  borderRadius: 999,
  border: `1px solid ${T.line}`,
  background: "transparent",
  color: T.ink2,
  fontSize: 12.5,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
} as const;

/** 新的朋友页：同意（实心粉钮）。 */
const reqSolidBtnStyle = {
  flex: 1,
  padding: "8px 0",
  borderRadius: 999,
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
  boxShadow: "0 10px 20px -14px rgba(232,106,155,.95)",
} as const;

/** 新的朋友页：恢复好友（淡粉小胶囊）。 */
const reqRestoreBtnStyle = {
  flex: "none",
  padding: "7px 14px",
  borderRadius: 999,
  border: "none",
  background: T.pinkSoft,
  color: T.pink,
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: SANS,
  letterSpacing: ".08em",
  cursor: "pointer",
} as const;

/** 空状态：一小撮粉线起头，下面中文＋英文小字＋提示——纯排版，不放图标。 */
function EmptyState({ cn, en, hint }: { cn: string; en: string; hint: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "80px 30px 40px",
        textAlign: "center",
      }}
    >
      <span style={{ width: 32, height: 4, borderRadius: 999, background: T.pink, marginBottom: 20 }} />
      <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, letterSpacing: ".06em" }}>{cn}</div>
      <div
        style={{
          marginTop: 8,
          fontFamily: EN,
          fontSize: 9.5,
          letterSpacing: ".26em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </div>
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

/** 分组索引签：一根小竖色条＋名字＋英文，再一条细线拉到右端，最右是条数。 */
function GroupLabel({ cn, en, count, dot }: { cn: string; en: string; count: number; dot?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 2px 7px" }}>
      <i
        style={{
          flex: "none",
          width: 4,
          height: 14,
          borderRadius: 2,
          background: dot ?? T.ink,
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".18em", color: T.ink, whiteSpace: "nowrap" }}>
        {cn}
      </span>
      <span
        style={{
          fontFamily: EN,
          fontSize: 9,
          letterSpacing: ".18em",
          color: T.ink3,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {en}
      </span>
      {/* 索引线：从名字后面一直拉到右端 */}
      <i style={{ flex: 1, height: 1, background: T.lineSoft, minWidth: 12 }} />
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

/** 星标头像带的一项：58 的大圆＋一圈亮粉外环，底下一行名字、一行昵称（横带专属）。 */
function ContactFace({ archive, onClick }: { archive: ArchiveEntry; onClick: () => void }) {
  const d = archive.data;
  const name = d.name || d.nickname || "未命名";
  const nickname = d.nickname && d.nickname !== d.name ? d.nickname : "";

  return (
    <div
      onClick={onClick}
      data-tap="true"
      className="cl-face"
      style={{
        flex: "none",
        width: 66,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          flex: "none",
          width: 58,
          height: 58,
          borderRadius: 999,
          padding: 2.5,
          background: T.pink,
          boxShadow: "0 12px 22px -14px rgba(232,106,155,.95)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF",
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: ".05em",
            background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
            overflow: "hidden",
          }}
        >
          {!d.photo ? name.charAt(0) : null}
        </div>
      </div>
      <span
        style={{
          maxWidth: 66,
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".02em",
          color: T.ink,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          pointerEvents: "none",
        }}
      >
        {name}
      </span>
      {nickname ? (
        <span
          style={{
            maxWidth: 66,
            fontSize: 9.5,
            color: T.pink,
            letterSpacing: ".04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            pointerEvents: "none",
          }}
        >
          {nickname}
        </span>
      ) : null}
    </div>
  );
}

/** 通讯人方格墙的一格：头像 40＋名字／昵称，两列并排的一枚名片格（不是一整行）。 */
function ContactTile({
  archive,
  conv,
  wide,
  onClick,
}: {
  archive: ArchiveEntry;
  conv?: Conversation;
  /** 奇数个时落单的那一格：铺满整行，别在右边留半格死区。 */
  wide?: boolean;
  onClick: () => void;
}) {
  const d = archive.data;
  const name = d.name || d.nickname || "未命名";
  const nickname = d.nickname && d.nickname !== d.name ? d.nickname : "";
  const hasStatus = conv?.isMuted === true || conv?.blocked === true;

  return (
    <div
      onClick={onClick}
      data-tap="true"
      className="cl-tile"
      style={{
        minWidth: 0,
        /* 整格从头到尾都要能点 —— 显式铺满格子，别只指望 grid 的 stretch */
        width: "100%",
        gridColumn: wide ? "span 2" : undefined,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 8px",
        borderRadius: 14,
        cursor: "pointer",
      }}
    >
      {/* 头像：40 的圆＋一道淡粉细环（子元素一律不吃指针，保证整格就是一块点击区） */}
      <div
        style={{
          flex: "none",
          width: 40,
          height: 40,
          borderRadius: 999,
          padding: 2,
          background: T.pinkSoft,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: ".05em",
            background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
            overflow: "hidden",
          }}
        >
          {!d.photo ? name.charAt(0) : null}
        </div>
      </div>

      {/* 名字一行，昵称与小状态图标并一行（同样不吃指针，点到字上也算点这张卡） */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, pointerEvents: "none" }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: ".02em",
            color: T.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        {nickname || hasStatus ? (
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            {nickname ? (
              <em
                style={{
                  fontStyle: "normal",
                  fontSize: 10,
                  color: T.pink,
                  letterSpacing: ".04em",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {nickname}
              </em>
            ) : null}
            {conv?.isMuted ? (
              <BellOff size={11} strokeWidth={1.9} color={T.ink3} style={{ flex: "none" }} />
            ) : null}
            {conv?.blocked ? (
              <Ban size={11} strokeWidth={1.9} color={T.danger} style={{ flex: "none", opacity: 0.85 }} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 添加朋友的角色资料页（非好友态）：展示信息＋底部「新增通讯人」。 */
function AddFriendProfile({
  archive,
  onBack,
  onAdd,
  showToast,
}: {
  archive: ArchiveEntry;
  onBack: () => void;
  onAdd: () => void;
  showToast: (msg: string) => void;
}) {
  const d = archive.data;
  const name = d.name || d.nickname || "未命名";
  const nickname = d.nickname && d.nickname !== d.name ? d.nickname : "";
  const signature = defaultSignature(d);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 顶栏：近黑圆返回钮＋一行英文小字 → 26/800 大标题（同添加朋友页） */}
      <div
        style={{
          flex: "none",
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="cl-soft"
            style={headerBtnStyle}
          >
            <ChevronLeft size={19} strokeWidth={2.2} />
          </button>
          <span
            style={{
              fontFamily: EN,
              fontSize: 9,
              letterSpacing: ".26em",
              color: T.ink3,
              textTransform: "uppercase",
            }}
          >
            profile
          </span>
        </div>
        <h1
          style={{
            margin: "14px 0 0",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-.01em",
            lineHeight: 1,
            color: T.ink,
          }}
        >
          个人资料
        </h1>
      </div>

      {/* 内容 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "26px 26px calc(var(--safe-area-bottom, 0px) + 26px)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 92,
            height: 92,
            margin: "0 auto",
            borderRadius: 999,
            padding: 2,
            background: T.pinkSoft,
            boxShadow: "0 18px 30px -16px rgba(20,19,24,.45)",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFF",
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: ".04em",
              overflow: "hidden",
              background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
            }}
          >
            {!d.photo ? name.charAt(0) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 }}>
          <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: ".02em" }}>{name}</span>
          {nickname ? (
            <em style={{ fontStyle: "normal", fontSize: 12, color: T.pink, letterSpacing: ".08em", fontWeight: 600, marginTop: 3 }}>
              {nickname}
            </em>
          ) : null}
        </div>
        <div
          onClick={() => {
            void copyText(archive.uid).then((ok) =>
              showToast(ok ? "ID 已复制" : "复制失败，请手动记下"),
            );
          }}
          style={{
            marginTop: 7,
            fontSize: 11.5,
            color: T.ink3,
            letterSpacing: ".1em",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
          }}
        >
          ID · {formatUid(archive.uid)}
        </div>
        {signature ? (
          <div style={{ margin: "14px auto 0", maxWidth: 290, fontSize: 12.5, color: T.ink2, lineHeight: 1.7, letterSpacing: ".05em" }}>
            <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(232,106,155,.55)" }}>“</i>
            {signature}
            <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(232,106,155,.55)" }}>”</i>
          </div>
        ) : null}

        {/* 新增通讯人 */}
        <div style={{ margin: "34px 0 0" }}>
          <button
            type="button"
            onClick={onAdd}
            className="cl-fill"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: 14,
              borderRadius: 999,
              fontSize: 14.5,
              fontWeight: 600,
              letterSpacing: ".14em",
              background: T.pink,
              color: "#FFFFFF",
              border: "none",
              boxShadow: "0 14px 26px -14px rgba(232,106,155,.95)",
              cursor: "pointer",
              fontFamily: SANS,
            }}
          >
            <UserPlus size={15} strokeWidth={2} />
            新增通讯人
          </button>
        </div>
      </div>
    </div>
  );
}

/** 个人资料页（滑入）。 */
function ContactProfile({
  archive,
  conv,
  socialBusy = false,
  onBack,
  onSendMessage,
  onToggleStar,
  onToggleMute,
  onOpenCharSettings,
  onBlock,
  onUnblock,
  onDeleteFriend,
  onHardDeleteFriend,
  showToast,
}: {
  archive: ArchiveEntry;
  conv?: Conversation;
  /** 拉黑／解除等社交动作进行中（按钮防抖）。 */
  socialBusy?: boolean;
  onBack: () => void;
  onSendMessage: () => void;
  onToggleStar: () => void;
  onToggleMute: () => void;
  /** 打开角色设置（个别 API／语音参数／参考图）。 */
  onOpenCharSettings: () => void;
  /** 加入黑名单（内部有确认弹窗）。 */
  onBlock: () => void;
  /** 解除拉黑（直接执行，TA 会立刻说点什么）。 */
  onUnblock: () => void;
  /** 假删（记录与记忆保留，TA 可能请求加回）。 */
  onDeleteFriend: () => void;
  /** 真删（会话与记忆一并清掉，TA 不会再来求）。 */
  onHardDeleteFriend: () => void;
  showToast: (msg: string) => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [momentsOpen, setMomentsOpen] = useState(false);
  const d = archive.data;
  const name = d.name || d.nickname || "未命名";
  const nickname = d.nickname && d.nickname !== d.name ? d.nickname : "";
  const blocked = conv?.blocked === true;
  /* 签名动态：TA 聊天中自己更新过就用新的，否则显示档案默认。 */
  const signature = conv?.signature?.trim() || defaultSignature(d);
  /* 动态时间倒序（新发的在前）。 */
  const moments = [...(conv?.moments ?? [])].reverse();
  const addedAt = archive.createdAt.slice(0, 10).replaceAll("-", ".");

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 整页唯一的滚动容器会把「返回钮那一行」也包进去，内容一滚它就跟着走。
          照 AppChrome 的分层把顶栏提出来：顶栏 flex:none 落在滚动区外（zIndex 2），
          滚动容器只留身份牌及以下内容。
          顶栏不铺底色——滚动容器自己带 `overflow-y:auto`，内容在它上边界就被裁掉，
          永远进不到顶栏底下来，所以不需要拿色块去挡。
          装饰①粉晕同样从滚动区里提出来，脱离流钉在屏幕顶（zIndex 0）；
          静止时位置与原来一致，只是不再跟着内容往上跑。 */}
      {/* 装饰①：头顶一团淡粉晕柔下来——页头算是有「底」了，但不是黑块 */}
      <i
        style={{
          position: "absolute",
          top: -92,
          left: "50%",
          transform: "translateX(-50%)",
          width: 320,
          height: 250,
          borderRadius: 999,
          background:
            "radial-gradient(circle at 50% 42%, rgba(232,106,155,.20) 0%, rgba(232,106,155,.07) 46%, rgba(232,106,155,0) 72%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* 固定顶栏：返回钮＋极小英文（同别的页） */}
      <div
        style={{
          flex: "none",
          position: "relative",
          zIndex: 2,
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 22px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="cl-soft"
            style={headerBtnStyle}
          >
            <ChevronLeft size={19} strokeWidth={2.4} />
          </button>
          <span
            style={{
              fontFamily: EN,
              fontSize: 9,
              letterSpacing: ".26em",
              color: T.ink3,
              textTransform: "uppercase",
            }}
          >
            profile
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          position: "relative",
          zIndex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          paddingBottom: "calc(var(--safe-area-bottom, 0px) + 26px)",
          textAlign: "center",
        }}
      >
        {/* 页头：只剩居中身份牌＋两样装饰（顶行已经提到上面的固定顶栏里），整块不铺底色。
            近黑块不铺，**排版居中**（头像居中、名字居中），页头顶部做出点东西：
            头像外一圈细粉环（跟描边分层）、名字底下一道短粉线。
            重的东西交给头像，不交给色块。 */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "0 22px",
          }}
        >
          {/* 身份牌：**居中**。头像 70 带外环（装饰②），名字 26/800 居中，名字底下短粉线（装饰③），
              副行（昵称胶囊＋添加于）居中一句读完。头像是这页独有的东西，页头有它撑着就不用色块。 */}
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 12,
            }}
          >
            {/* 头像块：外一圈细粉环，离头像 7px，跟白描边分层 */}
            <div
              style={{
                position: "relative",
                width: 84,
                height: 84,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <i
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  border: "1px solid rgba(232,106,155,.30)",
                }}
              />
              <div
                style={{
                  position: "relative",
                  width: 70,
                  height: 70,
                  borderRadius: 999,
                  padding: 2.5,
                  background: "linear-gradient(150deg, #FFFFFF 0%, #FBD3E6 100%)",
                  boxShadow: "0 16px 28px -16px rgba(20,19,24,.5)",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFF",
                    fontSize: 25,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    overflow: "hidden",
                    background: d.photo ? `url(${d.photo}) center/cover` : AVATAR_GRADIENT,
                  }}
                >
                  {!d.photo ? name.charAt(0) : null}
                </div>
              </div>
            </div>

            {/* 名字：居中，星标跟在名字右肩 */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 13, maxWidth: "100%" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: "-.01em",
                  lineHeight: 1,
                  color: T.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {name}
              </h1>
              {conv?.isPinned ? (
                <Star size={14} strokeWidth={1.6} color={T.pink} fill={T.pink} style={{ flex: "none" }} />
              ) : null}
            </div>

            {/* 装饰③：名字底下一道短粉线（中间亮两头淡，跟页头收边那条一个做法） */}
            <i
              style={{
                display: "block",
                width: 28,
                height: 2,
                borderRadius: 2,
                marginTop: 10,
                background: "linear-gradient(90deg, rgba(232,106,155,0), #E86A9B, rgba(232,106,155,0))",
              }}
            />

            {/* 副行：昵称胶囊（粉底粉字，跟角色设置页那枚徽记一个色）＋「添加于」，居中一句读完 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 11,
                maxWidth: "100%",
              }}
            >
              {nickname ? (
                <span
                  style={{
                    flex: "none",
                    fontSize: 10.5,
                    letterSpacing: ".1em",
                    fontWeight: 700,
                    color: T.pink,
                    background: T.pinkSoft,
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {nickname}
                </span>
              ) : null}
              <span
                style={{
                  fontSize: 10.5,
                  color: T.ink2,
                  letterSpacing: ".05em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                添加于 · {addedAt}
              </span>
            </div>
          </div>

          {/* 页头收边：一条粉→透明的细线（跟角色设置页页头底下那条同一个做法） */}
          <i
            style={{
              display: "block",
              height: 1,
              marginTop: 18,
              background: "linear-gradient(90deg, transparent, rgba(232,106,155,.42), transparent)",
            }}
          />
        </div>

        <div style={{ padding: "0 22px" }}>
          {/* ID：**淡墨底＋墨字**的胶囊（跟卡片一个语言），点一下复制。
              跟头像、名字一条中线。
              「添加于」已挪到页头副行，这里不再重复。 */}
          <div style={{ marginTop: 16 }}>
            <div
              onClick={() => {
                void copyText(archive.uid).then((ok) =>
                  showToast(ok ? "ID 已复制" : "复制失败，请手动记下"),
                );
              }}
              data-tap="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 13px",
                borderRadius: 999,
                background: "rgba(20,19,24,.055)",
                border: `1px solid ${T.line}`,
                fontSize: 12,
                color: T.ink,
                letterSpacing: ".08em",
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
              }}
            >
              ID · {formatUid(archive.uid)}
              <Copy size={12} strokeWidth={1.8} style={{ opacity: 0.45 }} />
            </div>
          </div>
          {signature ? (
            <div style={{ margin: "14px 0 0", fontSize: 12.5, color: T.ink2, lineHeight: 1.7, letterSpacing: ".04em" }}>
              <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(232,106,155,.55)" }}>“</i>
              {signature}
              <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(232,106,155,.55)" }}>”</i>
            </div>
          ) : null}

          {/* 动态：卡内章节头＋白卡里的可点行。
              换成同一套零件（`GroupTitle`）：
              编号方块 01／02 ＋ 标题 ＋ 英文索引 ＋ 淡线；编号块在「有内容／有配置」时亮粉。 */}
          <div
            className="cl-card"
            style={{
              marginTop: 22,
              textAlign: "left",
              borderRadius: 20,
              background: T.card,
              boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
              overflow: "hidden",
            }}
          >
            <GroupTitle title="动态" en="moments" num="01" on={moments.length > 0} />
            <div style={{ padding: "4px 4px 6px" }}>
              <ProfileRow
                icon={<BookOpen size={16} strokeWidth={1.8} color={T.pink} />}
                label="动态"
                value={String(moments.length)}
                onClick={() =>
                  moments.length > 0 ? setMomentsOpen(true) : showToast("TA 还没有发过动态，聊聊天吧")
                }
              />
            </div>
          </div>

          {/* 设置：卡内章节头＋白卡里的四行（同上，跟角色设置页对齐）。
              编号块亮粉的判定：星标或免打扰任一开着＝「这块有配置」。 */}
          <div
            className="cl-card"
            style={{
              marginTop: 18,
              textAlign: "left",
              borderRadius: 20,
              background: T.card,
              boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
              overflow: "hidden",
            }}
          >
            <GroupTitle
              title="设置"
              en="settings"
              num="02"
              on={conv?.isPinned === true || conv?.isMuted === true}
            />
            <div style={{ padding: "4px 4px 6px" }}>
              <ProfileRow
                icon={<Settings2 size={16} strokeWidth={1.8} color={T.pink} />}
                label="角色设置"
                value="个别 API · 参考图"
                onClick={onOpenCharSettings}
              />
              <ProfileRow
                icon={<Star size={16} strokeWidth={1.8} color={T.pink} fill={conv?.isPinned ? T.pink : "none"} />}
                label="星标联系人"
                right={<Switch on={conv?.isPinned === true} onClick={onToggleStar} />}
              />
              <ProfileRow
                icon={<BellOff size={16} strokeWidth={1.8} color={T.pink} />}
                label="消息免打扰"
                right={<Switch on={conv?.isMuted === true} onClick={onToggleMute} />}
              />
              <ProfileRow
                icon={<Ban size={16} strokeWidth={1.8} color={T.danger} />}
                label={blocked ? (socialBusy ? "解除中…" : "解除拉黑") : "加入黑名单"}
                danger
                onClick={() => {
                  if (socialBusy) return;
                  if (blocked) onUnblock();
                  else setConfirmBlock(true);
                }}
              />
            </div>
          </div>

          {/* 发消息：页头撤黑之后，这页不再走「黑当主色」那条骨架（那是编辑风的排法），
              主按钮跟着回到粉——跟角色设置页底部那颗粉按钮是同一颗。 */}
          <div style={{ margin: "30px 0 0" }}>
            <button
              type="button"
              onClick={onSendMessage}
              className="cl-fill"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: 14,
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: ".14em",
                background: T.pink,
                color: "#FFFFFF",
                border: "none",
                boxShadow: "0 14px 26px -16px rgba(232,106,155,.95)",
                cursor: "pointer",
                fontFamily: SANS,
              }}
            >
              <Send size={15} strokeWidth={1.8} />
              发消息
            </button>
          </div>
          {/* 删除好友：次要的危险动作，给一层很淡的红底＋淡红边，
              不再是一圈灰线（灰边在粉白底上看着像没配过色） */}
          <div style={{ margin: "12px 0 0" }}>
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: 13,
                borderRadius: 999,
                fontSize: 13.5,
                letterSpacing: ".14em",
                background: "rgba(229,72,77,.07)",
                color: T.danger,
                border: "1px solid rgba(229,72,77,.22)",
                cursor: "pointer",
                fontFamily: SANS,
              }}
            >
              <Trash2 size={14} strokeWidth={1.8} />
              删除好友
            </button>
          </div>
        </div>
      </div>

      {/* 动态滑页：TA 发过的动态时间轴（新→旧） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: T.bg,
          zIndex: 75,
          display: "flex",
          flexDirection: "column",
          transform: momentsOpen ? "none" : "translateX(100%)",
          transition: "transform .32s cubic-bezier(.22,1,.36,1)",
          pointerEvents: momentsOpen ? "auto" : "none",
        }}
      >
        {/* 顶栏：近黑圆返回钮＋一行英文小字 → 26/800 大标题（同个人资料页） */}
        <div
          style={{
            flex: "none",
            padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setMomentsOpen(false)}
              aria-label="返回"
              className="cl-soft"
              style={headerBtnStyle}
            >
              <ChevronLeft size={19} strokeWidth={2.2} />
            </button>
            <span
              style={{
                fontFamily: EN,
                fontSize: 9,
                letterSpacing: ".26em",
                color: T.ink3,
                textTransform: "uppercase",
              }}
            >
              moments
            </span>
          </div>
          <h1
            style={{
              margin: "14px 0 0",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-.01em",
              lineHeight: 1,
              color: T.ink,
            }}
          >
            动态
          </h1>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overscrollBehavior: "none",
            padding: "0 16px calc(var(--safe-area-bottom, 0px) + 24px)",
          }}
        >
          {moments.map((m) => (
            <div
              key={m.id}
              className="cl-card"
              style={{
                padding: "15px 16px",
                marginBottom: 10,
                borderRadius: 20,
                background: T.card,
                boxShadow: "0 12px 26px -22px rgba(20,19,24,.7)",
              }}
            >
              <div style={{ fontSize: 13.5, lineHeight: 1.9, letterSpacing: ".03em", color: T.ink }}>
                {m.content}
              </div>
              <div
                style={{
                  marginTop: 9,
                  fontFamily: EN,
                  fontSize: 10,
                  color: T.ink3,
                  letterSpacing: ".16em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {momentTime(m.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {confirmDel ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 70,
            background: "rgba(20,19,24,.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
          onClick={() => setConfirmDel(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 300,
              borderRadius: 22,
              background: T.card,
              padding: "22px 20px 16px",
              boxShadow: "0 24px 60px -20px rgba(20,19,24,.5)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, letterSpacing: ".06em", color: T.ink, fontWeight: 700 }}>
              删除好友
            </div>
            {/* 这一层给两个档：彻底删除（真删，默认）与暂时删除
                （假删，留着给剧情用：TA 会来求加回）。 */}
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: T.ink2,
                lineHeight: 1.85,
                letterSpacing: ".04em",
              }}
            >
              彻底删除：聊天记录与记忆一并清掉，
              <br />
              TA 不会再出现在好友列表，也不会来请求加回。
              <br />
              暂时删除：记录留着，TA 可能会来求加回。
            </div>
            <div style={{ height: 1, background: T.lineSoft, margin: "16px 0 12px" }} />
            <button
              type="button"
              onClick={onHardDeleteFriend}
              className="cl-fill"
              style={{
                width: "100%",
                padding: "12px 0",
                border: "none",
                borderRadius: 999,
                background: T.danger,
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: ".18em",
                fontFamily: SANS,
                boxShadow: "0 12px 22px -14px rgba(229,72,77,.95)",
                cursor: "pointer",
              }}
            >
              彻底删除
            </button>
            <button
              type="button"
              onClick={onDeleteFriend}
              style={{
                width: "100%",
                padding: "11px 0",
                marginTop: 8,
                border: "1px solid rgba(229,72,77,.22)",
                borderRadius: 999,
                background: "rgba(229,72,77,.07)",
                color: T.danger,
                fontSize: 13.5,
                letterSpacing: ".18em",
                fontFamily: SANS,
                cursor: "pointer",
              }}
            >
              暂时删除
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              style={{
                width: "100%",
                padding: "11px 0",
                marginTop: 8,
                border: `1px solid ${T.line}`,
                borderRadius: 999,
                background: "transparent",
                color: T.ink2,
                fontSize: 13.5,
                letterSpacing: ".18em",
                fontFamily: SANS,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {/* 拉黑确认弹窗 */}
      {confirmBlock ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 70,
            background: "rgba(20,19,24,.44)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
          onClick={() => setConfirmBlock(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 300,
              borderRadius: 22,
              background: T.card,
              padding: "22px 20px 16px",
              boxShadow: "0 24px 60px -20px rgba(20,19,24,.5)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, letterSpacing: ".06em", color: T.ink, fontWeight: 700 }}>
              加入黑名单
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: T.ink2,
                lineHeight: 1.8,
                letterSpacing: ".04em",
              }}
            >
              「{name}」还在好友列表里。你给 TA 发的消息
              <br />
              TA 都看得到；TA 发的消息 TA 那边一直显示发送失败，你照样看得见。
            </div>
            <div style={{ height: 1, background: T.lineSoft, margin: "16px 0 12px" }} />
            <button
              type="button"
              onClick={() => {
                setConfirmBlock(false);
                onBlock();
              }}
              className="cl-fill"
              style={{
                width: "100%",
                padding: "12px 0",
                border: "none",
                borderRadius: 999,
                background: T.danger,
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: ".18em",
                fontFamily: SANS,
                boxShadow: "0 12px 22px -14px rgba(229,72,77,.95)",
                cursor: "pointer",
              }}
            >
              拉黑
            </button>
            <button
              type="button"
              onClick={() => setConfirmBlock(false)}
              style={{
                width: "100%",
                padding: "11px 0",
                marginTop: 8,
                border: `1px solid ${T.line}`,
                borderRadius: 999,
                background: "transparent",
                color: T.ink2,
                fontSize: 13.5,
                letterSpacing: ".18em",
                fontFamily: SANS,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  right,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  right?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      data-tap={onClick ? "true" : undefined}
      className={onClick ? "cl-row" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 10px",
        borderRadius: 999,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {icon}
      <span style={{ fontSize: 13.5, letterSpacing: ".06em", color: danger ? T.danger : T.ink }}>{label}</span>
      {/* right 用 marginLeft:auto 顶到行尾，不贴在 label 后面 */}
      {right ? (
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", flex: "none" }}>{right}</span>
      ) : value ? (
        <span
          style={{
            marginLeft: "auto",
            fontSize: value.startsWith("ID") ? 12 : 13,
            color: T.ink2,
            letterSpacing: ".04em",
            maxWidth: 160,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </span>
      ) : (
        <ChevronRight size={15} strokeWidth={2.2} color={T.ink3} style={{ marginLeft: "auto", flex: "none" }} />
      )}
    </div>
  );
}