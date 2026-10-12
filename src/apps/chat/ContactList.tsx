"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  BellOff,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
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
  appendFriendAcceptedNotice,
  blockFriend,
  blockedFirstReaction,
  hardDeleteFriend,
  newFriendGreetingReaction,
  unblockFriend,
  unblockedFirstReaction,
} from "@/lib/chat/social";
import { formatUid, getCategories } from "@/lib/settings/contact";
import { copyText } from "@/lib/clipboard";
import { Switch } from "./widgets";
import CharacterSettingsPanel from "./CharacterSettingsPanel";
import { AVATAR_GRADIENT, EN, HZ, LAT, SANS, SERIF, defaultSignature, momentTime } from "./shared";
import type { ArchiveCategory, ArchiveEntry } from "@/types/contact";
import type { Conversation } from "@/types/chat";

/** 通讯人页统一皮：雾蓝（跟消息页同一支主色，只这一页用）。
 *  字段名沿用旧板 T 的形状，取值全部换成 HZ —— 只换色，不动骨架；
 *  页内的子页（资料／动态／添加朋友…）一起跟着变。 */
const T = {
  bg: HZ.paper,
  card: "#FFFFFF",
  ink: HZ.ink,
  ink2: HZ.ink2,
  ink3: HZ.ink3,
  pink: HZ.accent,
  pinkSoft: HZ.accentSoft,
  blue: HZ.accent,
  blueSoft: HZ.accentSoft,
  danger: "#C0563F",
  line: HZ.line,
  lineSoft: HZ.line2,
} as const;

/* =======================================================================
 * 通讯人页（独立视图）
 * 通讯人＝当前面具的朋友圈：只显示当前面具添加过（绑定）的角色。
 * 「添加朋友」＝从已唤醒档案里选角色，为当前面具建立绑定。
 * 「新的朋友」＝被假删的角色发来的好友申请（同意后恢复聊天）。
 *
 * 皮：雾蓝（HZ 那一支），全 App 只有这一页用——所以不引 shared 的 T 板，
 * 就地起一份同形状的雾蓝取值（见文件头）。只换色，不动骨架。
 *
 * 观感——**同一本书的两页**：外壳（顶栏 G1／搜索条／分组小标／空态／加号菜单）
 * 跟消息页**一套零件照搬**，翻过去不脱节；只有名录本体是这一页自己的样子：
 *   ① 顶栏：跟消息页同一枚 G1——宋体「通讯人」压斜体「Contacts」居中，
 *      左上返回主屏幕键、右上加号（跟消息页同一套位置）。
 *   ② 名录条目：跟消息页的会话行同一套骨架——圆角方头像 42＋宋体名字＋一行副文；
 *      副文这里放 TA 的签名，备注在前当大名、本名以弱化小字缀在其后（不再是胶囊）。
 *   ③ 星标：名字**正体、字号不变**，只走雾蓝（人与群共用这一条区分规矩，不用五角星）。
 *   ④ 条目之间只压一条**从名字起头处划开的细线**（名录自己的横向节奏）。
 * ===================================================================== */

export default function ContactList({
  archives,
  conversations,
  maskId,
  maskName,
  onExit,
  onOpenGroups,
  onOpenChat,
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
  /** 回小手机主屏幕（顶栏左上那枚返回键）。 */
  onExit: () => void;
  /** 打开群聊页（名录头一条「群聊」入口）。 */
  onOpenGroups: () => void;
  onOpenChat: (characterId: string) => void;
  onDataChange: () => void;
  showToast: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /* 分组：档案分类（家人／朋友…）从库里读；「全部」是内建那一档。 */
  const [categories, setCategories] = useState<ArchiveCategory[]>([]);
  const [group, setGroup] = useState<string>("all");
  /* 角色设置页（资料页进入）。 */
  const [charSettingsOpen, setCharSettingsOpen] = useState(false);
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

  /* 读一次档案分类，给分组选择条用（家人／朋友…）；没有分类时只剩「全部」一枚。 */
  useEffect(() => {
    void getCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

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

  /** 发送申请＝立即成为好友；未关闭问候时，问候语成为对话的第一条消息，TA 随后主动开口。 */
  const sendRequest = useCallback(
    async (arch: ArchiveEntry, greet: string, silent: boolean) => {
      await updateConversation(arch.id, maskId, {});
      /* 未关闭问候：先把「TA 通过了申请」这条系统提示落进聊天页——我那句验证消息算申请附言，
         摆在这条之前；随后 TA 才在后台主动开口（见 newFriendGreetingReaction）。
         关闭问候则整段静默：附言、通过提示、TA 的第一句，一个都不落，等用户自己先说。 */
      if (!silent) {
        if (greet.trim()) {
          await appendMessage(arch.id, maskId, {
            role: "user",
            content: greet.trim(),
            isRead: true,
          });
        }
        await appendFriendAcceptedNotice(arch, maskId);
      }
      setRequestTo(null);
      setAddDetail(null);
      setAddOpen(false);
      setAddQuery("");
      onDataChange();
      showToast("已发送申请，你们现在是好友了");
      /* 未关闭问候＝TA 会收到新好友提示，通过后主动开口（后台生成，慢的那半段）。
         关闭问候则静默，等用户自己发第一句。 */
      if (!silent) {
        void newFriendGreetingReaction(arch, maskId, maskName, greet).finally(() => onDataChange());
      }
    },
    [maskId, maskName, onDataChange, showToast],
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
        /* 分组选择条：选中的分类只留归档在这一类的人；「全部」不过滤。 */
        .filter((r) => group === "all" || r.archive.categoryId === group)
        .sort((a, b) => (b.conv?.updatedAt ?? "").localeCompare(a.conv?.updatedAt ?? "")),
    [filtered, group],
  );

  const selected = archives.find((a) => a.id === profileId) ?? null;
  const selectedConv = conversations.find((c) => c.characterId === profileId);

  /* 分组选择条：跟着选中的分类换「所有联系人」那一节的标题与条数。 */
  const activeCategory = categories.find((c) => c.id === group) ?? null;
  const groupCn = activeCategory ? activeCategory.name : "所有联系人";
  const groupEn = activeCategory ? "Group" : "All";

  /** 星标／免打扰写回当前面具的会话，并刷新上层数据。 */
  const toggleConv = async (patch: { isPinned?: boolean; isMuted?: boolean }) => {
    if (!profileId) return;
    await updateConversation(profileId, maskId, patch);
    onDataChange();
  };

  /** 删除好友（真删）：会话与记忆一并清掉 —— TA 不会再出现在列表里，也回不来。
   *  角色档案本身不动，以后想聊可以自己去「添加朋友」把他加回来。 */
  const hardDeleteFriendNow = async () => {
    if (!profileId) return;
    await hardDeleteFriend(profileId, maskId);
    setProfileId(null);
    onDataChange();
    showToast("已删除好友，聊天记录与记忆都清掉了");
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
        .cl-hbtn:active { opacity: .55; transform: scale(.94); }
        .cl-soft { transition: transform .16s ease, filter .16s ease; }
        .cl-soft:active { transform: scale(.94); }
        .cl-fill { transition: transform .16s ease, filter .16s ease; }
        .cl-fill:active { filter: brightness(.94); }
        /* 资料页里能点的整行（角色设置／动态／拉黑）也要有按住反馈 */
        .cl-row { transition: transform .16s ease, background-color .16s ease; }
        .cl-row:active { background-color: ${T.pinkSoft}; transition-duration: .06s; }
        .cl-search::placeholder { color: ${T.ink3}; }
        /* 分组选择条：横滑但不露滚动条（触屏一样能滑） */
        .cl-gsel { -ms-overflow-style: none; scrollbar-width: none; }
        .cl-gsel::-webkit-scrollbar { display: none; }
        /* 备注反转后的本名小字：前面缀一枚淡淡的间隔点 */
        .cl-aka::before { content: '·'; margin-right: 6px; opacity: .55; }
        /* 名录条目：按住整行压暗一档；条目之间压一条**从名字起头处划开**的细线 */
        .cl-entry { position: relative; transition: filter .16s ease; }
        .cl-entry:active { filter: brightness(.96); }
        .cl-entry + .cl-entry::before {
          content: ''; position: absolute; top: 0; left: 58px; right: 2px;
          height: 1px; background: ${T.lineSoft};
        }
        .cl-sheet { transition: transform .26s cubic-bezier(.34,1.4,.64,1), opacity .18s ease; }
        @media (prefers-reduced-motion: reduce) {
          .cl-card, .cl-hbtn, .cl-soft, .cl-fill, .cl-row, .cl-entry, .cl-sheet { transition: none; }
        }
      `}</style>

      {/* 顶栏 G1（跟消息页同一套）：左右两键钉在两侧同一条中线，
          「通讯人／Contacts」一体两行的标题块垂直居中卡在中间。 */}
      <div
        style={{
          flex: "none",
          zIndex: 20,
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 2px) 26px 0",
        }}
      >
        <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
          {/* 返回主屏幕：钉在左侧中线上（跟消息页同一枚） */}
          <button
            type="button"
            onClick={onExit}
            aria-label="返回主屏幕"
            className="cl-hbtn"
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
              color: T.ink,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>

          {/* 中心标题块：中文压着斜体英文，两行一体（整组中心＝右键中线） */}
          <div style={{ textAlign: "center" }}>
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: ".2em",
                paddingLeft: ".2em",
                color: T.pink,
                lineHeight: 1,
              }}
            >
              通讯人
            </span>
            <div
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: 12.5,
                letterSpacing: ".12em",
                textIndent: ".12em",
                color: T.ink3,
                padding: "1px 0 0",
              }}
            >
              Contacts
            </div>
          </div>

          {/* 加号：钉在右侧中线上；按一下，两张卡从它底下错开摊出来 */}
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
              className="cl-hbtn"
              style={{
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "none",
                padding: 0,
                color: T.ink,
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

            {/* 加号菜单：两张浮起来的小卡（发起群聊／添加朋友），跟消息页同一套 */}
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
                // 收起时容器不接点击，否则这块 176 宽的空盒子会挡住底下的条目
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

      {/* 搜索条：跟消息页同一枚（圆角浅底＋放大镜＋占位字） */}
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
          <Search size={16} strokeWidth={1.7} color={T.ink3} style={{ flex: "none" }} />
          <input
            type="text"
            className="cl-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索姓名、昵称"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              letterSpacing: ".16em",
              fontFamily: SANS,
              color: T.ink,
            }}
          />
        </div>
      </div>

      {/* 名录：一整张纸上的名录——条目之间只压一条从名字起头处划开的细线 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "13px 20px 18px",
        }}
      >
        {archives.length === 0 ? (
          <EmptyState cn="还没有通讯人" en="no contacts yet" hint="去「档案」唤醒一个角色，TA 就会出现在这里" />
        ) : rows.length === 0 ? (
          <EmptyState cn="还没有朋友" en="no friends yet" hint="点右上角「＋」，选择「添加朋友」开始聊天" />
        ) : (
          <>
            {/* 群聊入口：名录里的头一条——跟下面的人同一套骨架，但不加卡、不留额外分隔线 */}
            <div
              onClick={() => {
                setPlusOpen(false);
                onOpenGroups();
              }}
              data-tap="true"
              className="cl-entry"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "13px 2px",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 42,
                  display: "flex",
                  justifyContent: "center",
                  color: T.ink3,
                  pointerEvents: "none",
                }}
              >
                <Users size={19} strokeWidth={1.7} />
              </span>
              <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 15.5,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    color: T.ink,
                  }}
                >
                  群聊
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: T.ink2, letterSpacing: ".02em" }}>
                  还没有群聊
                </div>
              </div>
              <ChevronRight size={15} strokeWidth={1.9} color={T.ink3} style={{ flex: "none" }} />
            </div>

            {/* 分组选择条：全部＋各分类，点了筛下面「所有联系人」那一节 */}
            <div
              className="cl-gsel"
              style={{ display: "flex", gap: 22, overflowX: "auto", padding: "14px 4px 4px" }}
            >
              {[{ id: "all", name: "全部" }, ...categories].map((c) => {
                const on = group === c.id;
                return (
                  <span
                    key={c.id}
                    onClick={() => setGroup(c.id)}
                    data-tap="true"
                    style={{
                      position: "relative",
                      flex: "none",
                      fontSize: 12.5,
                      letterSpacing: ".16em",
                      color: on ? T.pink : T.ink2,
                      paddingBottom: 7,
                      cursor: "pointer",
                      transition: "color .16s ease",
                    }}
                  >
                    {c.name}
                    {on ? (
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: 1.5,
                          borderRadius: 2,
                          background: T.pink,
                        }}
                      />
                    ) : null}
                  </span>
                );
              })}
            </div>

            {starred.length > 0 || normal.length > 0 ? (
              <>
                {/* 星标：名字正体、字号不变，只走雾蓝（不用五角星、不用横滑带） */}
                {starred.length > 0 ? (
                  <div>
                    <GroupLabel en="Starred" cn="星标" count={starred.length} />
                    {starred.map((row) => (
                      <ContactRow
                        key={row.archive.id}
                        archive={row.archive}
                        conv={row.conv}
                        starred
                        onClick={() => openProfile(row.archive)}
                      />
                    ))}
                  </div>
                ) : null}

                {/* 所有联系人：名字正体、字号收小，条目之间一条细线；标题跟分组选择条走 */}
                {normal.length > 0 ? (
                  <div>
                    <GroupLabel en={groupEn} cn={groupCn} count={normal.length} />
                    {normal.map((row) => (
                      <ContactRow
                        key={row.archive.id}
                        archive={row.archive}
                        conv={row.conv}
                        onClick={() => openProfile(row.archive)}
                      />
                    ))}
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
                        boxShadow: "0 12px 26px -22px rgba(58,65,73,.7)",
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
            background: "rgba(58,65,73,.44)",
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
              boxShadow: "0 24px 60px -20px rgba(58,65,73,.5)",
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
                  boxShadow: "0 12px 22px -14px rgba(90,115,145,.95)",
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
  boxShadow: "0 4px 12px -4px rgba(58,65,73,.5)",
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

/** 空状态：跟消息页同一枚（一小撮雾蓝线起头＋宋体一行＋提示），中间多一行英文小标。 */
function EmptyState({ cn, en, hint }: { cn: string; en: string; hint: string }) {
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
        style={{ width: 32, height: 4, borderRadius: 999, background: T.pink, opacity: 0.7, marginBottom: 20 }}
      />
      <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, color: T.ink, letterSpacing: ".08em" }}>
        {cn}
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: LAT,
          fontSize: 9,
          letterSpacing: ".26em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: T.ink2, letterSpacing: ".04em", lineHeight: 1.6 }}>
        {hint}
      </div>
    </div>
  );
}

/** 分组小标：跟消息页同一枚（等宽英文＋中点＋中文），右端补一枚淡条数。 */
function GroupLabel({ en, cn, count }: { en: string; cn: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 7, padding: "11px 4px 9px" }}>
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".3em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
      <span style={{ fontFamily: LAT, fontSize: 9.5, color: T.ink3 }}>·</span>
      <span style={{ fontSize: 11, letterSpacing: ".26em", color: T.ink2 }}>{cn}</span>
      <i style={{ flex: 1 }} />
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".1em",
          color: T.ink3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(count).padStart(2, "0")}
      </span>
    </div>
  );
}

/** 名录的一条：跟消息页的会话行同一套骨架（圆角方头像 42＋宋体名字＋一行副文）。
 *  副文这里放的是 TA 的签名；备注在前当大名、本名以弱化小字缀在其后（不再是胶囊）；
 *  星标那一节名字**正体、字号不变**，只走雾蓝（人与群共用这一条区分规矩，不用五角星）。 */
function ContactRow({
  archive,
  conv,
  starred,
  onClick,
}: {
  archive: ArchiveEntry;
  conv?: Conversation;
  /** 星标那一节：名字走雾蓝（正体、字号不变）。 */
  starred?: boolean;
  onClick: () => void;
}) {
  const d = archive.data;
  /* 备注反转：有备注（且与本名不同）就拿它当大名，本名退成后面那行小字；
     没备注就还是本名当大名、不重复显示。头像首字依旧取本名。 */
  const realName = d.name || d.nickname || "未命名";
  const remark = d.nickname && d.nickname !== d.name ? d.nickname : "";
  const primary = remark || realName;
  const secondary = remark ? realName : "";
  const signature = conv?.signature?.trim() || defaultSignature(d);

  return (
    <div
      onClick={onClick}
      data-tap="true"
      className="cl-entry"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 2px",
        cursor: "pointer",
      }}
    >
      {/* 头像：跟消息页同一枚 42 的圆角方（有照片铺照片，没有就白底衬线首字） */}
      <div
        style={{
          flex: "none",
          width: 42,
          height: 42,
          borderRadius: 13,
          background: d.photo ? `url(${d.photo}) center/cover` : "#FFFFFF",
          color: T.pink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: SERIF,
          fontSize: 15,
          fontWeight: 600,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,.75)",
          boxShadow: "0 1px 2px rgba(58,65,73,.07), inset 0 1px 0 rgba(255,255,255,.95)",
          pointerEvents: "none",
        }}
      >
        {d.photo ? null : realName.slice(0, 1)}
      </div>

      {/* 大名（有备注时是备注；星标走雾蓝）＋本名弱化小字缀其后；下面一行签名 */}
      <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 15.5,
              fontWeight: 600,
              letterSpacing: ".08em",
              color: starred ? T.pink : T.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {primary}
          </span>
          {secondary ? (
            <span
              className="cl-aka"
              style={{
                flex: "none",
                fontSize: 11.5,
                letterSpacing: ".09em",
                color: T.ink3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {secondary}
            </span>
          ) : null}
          {conv?.isMuted ? (
            <BellOff size={12} strokeWidth={2} color={T.ink3} style={{ flex: "none" }} />
          ) : null}
          {conv?.blocked ? (
            <Ban size={12} strokeWidth={2} color={T.danger} style={{ flex: "none" }} />
          ) : null}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            letterSpacing: ".02em",
            color: T.ink2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {signature}
        </div>
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
            boxShadow: "0 18px 30px -16px rgba(58,65,73,.45)",
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
            <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(90,115,145,.55)" }}>“</i>
            {signature}
            <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(90,115,145,.55)" }}>”</i>
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
              boxShadow: "0 14px 26px -14px rgba(90,115,145,.95)",
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
  /** 删除好友（真删：会话与记忆一并清掉，TA 不会再来）。 */
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
            "radial-gradient(circle at 50% 42%, rgba(90,115,145,.20) 0%, rgba(90,115,145,.07) 46%, rgba(90,115,145,0) 72%)",
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
                  border: "1px solid rgba(90,115,145,.30)",
                }}
              />
              <div
                style={{
                  position: "relative",
                  width: 70,
                  height: 70,
                  borderRadius: 999,
                  padding: 2.5,
                  background: "linear-gradient(150deg, #FFFFFF 0%, #DCE3EC 100%)",
                  boxShadow: "0 16px 28px -16px rgba(58,65,73,.5)",
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
                background: "linear-gradient(90deg, rgba(90,115,145,0), #5A7391, rgba(90,115,145,0))",
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
              background: "linear-gradient(90deg, transparent, rgba(90,115,145,.42), transparent)",
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
                background: "rgba(58,65,73,.055)",
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
              <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(90,115,145,.55)" }}>“</i>
              {signature}
              <i style={{ fontStyle: "normal", fontFamily: EN, fontSize: 14, color: "rgba(90,115,145,.55)" }}>”</i>
            </div>
          ) : null}

          {/* 动态：小节标＋白卡里的可点行（`SectionHead`：宋体小字＋英文＋细线，不带编号方块）。 */}
          <div
            className="cl-card"
            style={{
              marginTop: 22,
              textAlign: "left",
              borderRadius: 20,
              background: T.card,
              boxShadow: "0 12px 26px -22px rgba(58,65,73,.7)",
              overflow: "hidden",
            }}
          >
            <SectionHead title="动态" en="moments" on={moments.length > 0} />
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

          {/* 设置：小节标＋白卡里的四行（同上，跟角色设置页对齐）。
              小节标亮雾蓝的判定：星标或免打扰任一开着＝「这块有配置」。 */}
          <div
            className="cl-card"
            style={{
              marginTop: 18,
              textAlign: "left",
              borderRadius: 20,
              background: T.card,
              boxShadow: "0 12px 26px -22px rgba(58,65,73,.7)",
              overflow: "hidden",
            }}
          >
            <SectionHead
              title="设置"
              en="settings"
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
                boxShadow: "0 14px 26px -16px rgba(90,115,145,.95)",
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
                boxShadow: "0 12px 26px -22px rgba(58,65,73,.7)",
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
            background: "rgba(58,65,73,.44)",
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
              boxShadow: "0 24px 60px -20px rgba(58,65,73,.5)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 16, letterSpacing: ".06em", color: T.ink, fontWeight: 700 }}>
              删除好友
            </div>
            {/* 只有一种删法：真删（会话与记忆一并清掉，TA 不会再来） */}
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: T.ink2,
                lineHeight: 1.85,
                letterSpacing: ".04em",
              }}
            >
              删除后，TA 会从好友列表消失，
              <br />
              你们的聊天记录与记忆也会一并清掉，无法恢复。
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
              删除好友
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
            background: "rgba(58,65,73,.44)",
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
              boxShadow: "0 24px 60px -20px rgba(58,65,73,.5)",
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

/** 资料页里的一个小节标：宋体小字＋英文小标＋一条细线（去掉编号方块；on＝这块已配过）。 */
function SectionHead({ title, en, on }: { title: string; en: string; on?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "14px 14px 11px",
        borderBottom: `1px solid ${T.lineSoft}`,
      }}
    >
      <span
        style={{
          fontFamily: SERIF,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: ".16em",
          color: on ? T.pink : T.ink,
          transition: "color .18s",
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: LAT,
          fontSize: 8.5,
          letterSpacing: ".2em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
      <i style={{ flex: 1, height: 1, background: T.lineSoft, minWidth: 10 }} />
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