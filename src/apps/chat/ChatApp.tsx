"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePhone } from "@/context/PhoneContext";
import { getArchives } from "@/lib/settings/contact";
import { getApiSettings, getChatPrefs, getConversations, ensureAssistant } from "@/lib/settings/chat";
import { getMyIdentity, saveMyIdentity } from "@/lib/settings/identity";
import { DEFAULT_MASK_ID, ensureMasks, migrateLegacySignature, saveMasks, type Mask } from "@/lib/settings/mask";
import MessageList from "./MessageList";
import ChatWindow from "./ChatWindow";
import ContactList from "./ContactList";
import GroupList from "./GroupList";
import MomentsPage from "./MomentsPage";
import MinePage, { SIGNATURE_FALLBACK } from "./MinePage";
import WalletView from "./WalletView";
import ChatGlobalSettingsPanel from "./ChatGlobalSettingsPanel";
import { EN, HZ, LAT, SANS, T } from "./shared";
import type { ArchiveEntry } from "@/types/contact";
import type { ChatApiSettings, Conversation } from "@/types/chat";

/* =======================================================================
 * 星绥通讯 App：视图管理（列表 ⇄ 对话）
 * （API 设定在主屏幕「设置」App 里，聊天内不再放入口；
 *   导航走底部 tab，次级入口（钱包／聊天全局设定／退出等）收进「我的」页）
 * ===================================================================== */

export default function ChatApp() {
  const { closeApp } = usePhone();
  const [archives, setArchives] = useState<ArchiveEntry[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [apiSettings, setApiSettings] = useState<ChatApiSettings | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  /** 打开的对话（角色＋绑定的面具；身份跟对话走，不跟当前戴的面具走）。 */
  const [openChat, setOpenChat] = useState<{ characterId: string; maskId: string } | null>(null);
  /* 进过的对话都留着挂载（照参考项目 ai-virtual-phone 的 phone-chat-app.tsx：
     返回只是把这间屋子藏起来，TA 那一轮回复／配图／记忆照跑，回来接着看）。
     彻底不要了（删好友）才从这张表里剔掉。 */
  const [visitedChats, setVisitedChats] = useState<{ characterId: string; maskId: string }[]>([]);
  /** 动态页有没有摊着整页浮层（发布／编辑／看图／换封面单…）。
   *  非空＝底下的四个 tab 按钮先收起来——`MomentsPage` 的浮层够不着它（那是兄弟节点），
   *  所以由这一层替它躲开（视觉上跟「盖住」一样）。 */
  const [momentsOverlay, setMomentsOverlay] = useState(false);
  /** 动态页底单／居中弹窗摊着时，底下那排 tab 要不要也罩进黑幕。
   *  存的是**遮罩浓度**（null＝没遮罩）：`MomentsPage` 那层黑遮罩盖不住这排 tab
   *  （兄弟节点），由这一层替它补压一层**同浓**的黑遮罩——2026-10-13 恩熙：
   *  底单开着时四个 tab 也要在这层黑色半透明之下。 */
  const [momentsDim, setMomentsDim] = useState<number | null>(null);
  /** 应用内视图：消息列表 ⇄ 通讯人 ⇄ 群聊 ⇄ 动态 ⇄ 我的 ⇄ 钱包 ⇄ 聊天全局设定
   *  （群聊从通讯人页进；钱包／设定从「我的」进）。 */
  const [view, setView] = useState<
    "list" | "contacts" | "groups" | "moments" | "mine" | "wallet" | "chat-global"
  >("list");
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(() => {
    /* 先确保内置 AI 助手就位（建档＋各面具绑定），再拉数据——顺序反了的话，
       这次读到的通讯人列表里还没有它。助手挂了不阻塞主流程（catch 掉继续）。 */
    void (async () => {
      try {
        await ensureAssistant().catch(() => undefined);
        /* 顺手把全局聊天偏好读一遍：触发一次性迁移（见 getChatPrefs）。 */
        await getChatPrefs().catch(() => undefined);
        const [a, c, s, legacy, ms] = await Promise.all([
          getArchives(),
          getConversations(),
          getApiSettings(),
          getMyIdentity(),
          ensureMasks(),
        ]);
        setArchives(a);
        setConversations(c);
        setApiSettings(s);
        /* 签名并进面具的一次性迁移：旧的全局签名填给「使用中」那张面具，
           填完就清掉旧字段，免得以后故意清空签名、刷新又被搬回来。 */
        const migrated = migrateLegacySignature(ms, legacy.signature);
        if (migrated) {
          await saveMasks(migrated);
          await saveMyIdentity({ signature: "" });
          setMasks(migrated);
        } else {
          setMasks(ms);
        }
        setFailed(false);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const reloadConversations = useCallback(async () => {
    setConversations(await getConversations());
  }, []);

  /** 开一个对话：进过的就复用那间还挂着的屋子，没进过的补进挂载表。 */
  const openChatWith = useCallback((characterId: string, maskId: string) => {
    setVisitedChats((prev) =>
      prev.some((v) => v.characterId === characterId && v.maskId === maskId)
        ? prev
        : [...prev, { characterId, maskId }],
    );
    setOpenChat({ characterId, maskId });
  }, []);

  /** 这间屋子彻底不要了（删好友）：从挂载表里剔掉，整间卸载，不是藏起来。 */
  const dropChat = useCallback((characterId: string, maskId: string) => {
    setVisitedChats((prev) =>
      prev.filter((v) => !(v.characterId === characterId && v.maskId === maskId)),
    );
    setOpenChat((cur) =>
      cur && cur.characterId === characterId && cur.maskId === maskId ? null : cur,
    );
  }, []);

  // 动态页生成配图后触发刷新（moments-updated 由 MomentsPage 广播）
  useEffect(() => {
    const handler = () => void reloadConversations();
    window.addEventListener("moments-updated", handler);
    return () => window.removeEventListener("moments-updated", handler);
  }, [reloadConversations]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  /* ---------- 失败／载入中 ---------- */
  if (failed) {
    return (
      <div
        style={{
          ...rootStyle,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <p style={{ fontSize: 12.5, color: T.ink2, letterSpacing: ".06em" }}>星海起雾了……读取失败</p>
        <button
          type="button"
          onClick={loadAll}
          style={{
            border: "none",
            background: T.pink,
            color: "#FFFFFF",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: ".08em",
            padding: "9px 20px",
            borderRadius: 999,
            fontFamily: SANS,
            cursor: "pointer",
          }}
        >
          再试一次
        </button>
      </div>
    );
  }

  if (archives === null || conversations === null || apiSettings === null) {
    return (
      <div
        style={{
          ...rootStyle,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12.5, color: T.ink2, letterSpacing: ".14em" }}>连接星海中</span>
        <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".34em" }}>
          connecting
        </span>
      </div>
    );
  }

  // 名字完全由使用中的面具决定；无面具或面具名空 →「我」。
  const currentMask =
    masks.find((m) => m.current) ?? masks.find((m) => m.id === DEFAULT_MASK_ID) ?? null;
  const effectiveName = currentMask?.name.trim() || "我";
  // 通讯人是「当前面具的朋友圈」：只看当前面具的绑定。
  const scopeMaskId = currentMask?.id ?? DEFAULT_MASK_ID;
  const scopedConversations = conversations.filter((c) => c.maskId === scopeMaskId);

  return (
    <div style={rootStyle}>
      {/* 背景页（消息／通讯人／动态／我的）：眼前没有露着的对话时才在台上 */}
      {!openChat ? (
        view === "contacts" ? (
          <ContactList
            archives={archives}
            conversations={scopedConversations}
            maskId={scopeMaskId}
            maskName={effectiveName}
            /* 顶栏左上返回键：离开聊天 App、回小手机主屏幕。 */
            onExit={closeApp}
            /* 名录头一条「群聊」入口：进群聊页。 */
            onOpenGroups={() => setView("groups")}
            onOpenChat={(characterId) => openChatWith(characterId, scopeMaskId)}
            onDataChange={reloadConversations}
            showToast={showToast}
          />
        ) : view === "groups" ? (
          /* 群聊页：还没有数据模型，先传空数组走空态。返回键回通讯人页。 */
          <GroupList groups={[]} onBack={() => setView("contacts")} showToast={showToast} />
        ) : view === "moments" ? (
          <MomentsPage
            archives={archives}
            /* 动态跟通讯人同一口径：只看当前面具的朋友圈 */
            conversations={scopedConversations}
            maskId={scopeMaskId}
            maskName={effectiveName}
            maskAvatar={currentMask?.avatar ?? ""}
            /* 签名跟「我的」页同一口径：没写就用兜底那句 */
            signature={currentMask?.signature?.trim() || SIGNATURE_FALLBACK}
            /* 整页浮层开合上报：用来把底下的四个 tab 按钮临时收起来。 */
            onOverlayChange={setMomentsOverlay}
            /* 底单／居中弹窗的遮罩浓度上报：用来在四个 tab 之上补压同浓黑遮罩。 */
            onSheetDimChange={setMomentsDim}
            showToast={showToast}
          />
        ) : view === "mine" ? (
          <MinePage
            signature={currentMask?.signature ?? ""}
            masks={masks}
            /* 签名并进面具：写的是「使用中」那张面具的签名，不再有全局字段。 */
            onSignatureChange={(next) => {
              if (!currentMask) return;
              const nextMasks = masks.map((m) =>
                m.id === currentMask.id ? { ...m, signature: next } : m,
              );
              setMasks(nextMasks);
              void saveMasks(nextMasks);
            }}
            onMasksChange={setMasks}
            /* 次级入口都从这页进：钱包／聊天全局设定（原侧边栏的活）。 */
            onOpenWallet={() => setView("wallet")}
            onOpenChatGlobal={() => setView("chat-global")}
            showToast={showToast}
          />
        ) : view === "wallet" ? (
          /* 钱包跟面具走：账本主人就是当前使用中面具（无面具则记在默认面具名下）。 */
          <WalletView
            ownerId={scopeMaskId}
            ownerName={effectiveName}
            ownerAvatar={currentMask?.avatar ?? ""}
            onBack={() => setView("mine")}
            showToast={showToast}
          />
        ) : view === "chat-global" ? (
          /* 聊天全局设定：全局默认那一层（对话偏好）。 */
          <ChatGlobalSettingsPanel onBack={() => setView("mine")} />
        ) : (
          <MessageList
            archives={archives}
            conversations={conversations}
            masks={masks}
            onOpenChat={(characterId, maskId) => openChatWith(characterId, maskId)}
            /* 顶栏左上返回键：离开聊天 App、回小手机主屏幕。 */
            onExit={closeApp}
            showToast={showToast}
          />
        )
      ) : null}

      {/* 底部 tab（第二档：新图标 ＋ 英文小标）：只在四个主视图露着、
          且没打开任何对话、动态页也没摊着整页浮层时出现；钱包／聊天全局设定这些次级页不挂它。 */}
      {!openChat &&
      !momentsOverlay &&
      (view === "list" || view === "contacts" || view === "moments" || view === "mine") ? (
        /* 外面这层只是给「补压的黑遮罩」当定位框：tab 高度随安全区浮动，
           用 `inset: 0` 盖住整条最省事。遮罩盖在按钮之上＝tab 也罩进黑幕里；
           点它就等同点别处的遮罩——让动态页把那单收掉。 */
        <div style={{ flex: "none", position: "relative" }}>
          <ChatTabBar
            active={view}
            onNavigate={(next) => {
              setView(next);
              setOpenChat(null);
            }}
          />
          <div
            aria-hidden
            onClick={() => window.dispatchEvent(new Event("moments-dismiss-sheet"))}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              background: `rgba(20,19,24,${momentsDim ?? 0})`,
              opacity: momentsDim !== null ? 1 : 0,
              transition: "opacity .22s ease",
              pointerEvents: momentsDim !== null ? "auto" : "none",
            }}
          />
        </div>
      ) : null}

      {/* 进过的对话全留着挂载，只有当前这一间露着：返回＝藏起来（display:none），
          不是拆掉——TA 正在跑的那一轮请求、配图、记忆全都照走。 */}
      {visitedChats.map((v) => {
        const ch = archives.find((a) => a.id === v.characterId);
        if (!ch) return null;
        const mk = masks.find((m) => m.id === v.maskId) ?? null;
        const active = openChat?.characterId === v.characterId && openChat?.maskId === v.maskId;
        return (
          <div
            key={`${v.characterId}::${v.maskId}`}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              display: active ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <ChatWindow
              character={ch}
              apiSettings={apiSettings}
              userName={mk?.name.trim() || "我"}
              mask={mk}
              maskId={v.maskId}
              userSignature={mk?.signature ?? ""}
              visible={active}
              onBack={() => setOpenChat(null)}
              onDismiss={() => dropChat(v.characterId, v.maskId)}
              onDataChange={reloadConversations}
              showToast={showToast}
            />
          </div>
        );
      })}

      {/* toast：一行小提示，落在输入区上方 */}
      {toast ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            background: T.ink,
            color: "#FFFFFF",
            letterSpacing: ".06em",
            zIndex: 300,
            bottom: 110,
            maxWidth: "80%",
            overflow: "hidden",
            pointerEvents: "none" as const,
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            whiteSpace: "nowrap" as const,
            textOverflow: "ellipsis",
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: T.bg,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  fontFamily: SANS,
  color: T.ink,
};

/* =======================================================================
 * 底部 tab（第二档：新图标 ＋ 英文小标）
 * 在「消息／通讯人／动态／我的」四个主视图之间横切（侧边栏已撤，导航全靠这一排）。
 * 图标是样张 I2 那套线稿：气泡／名片／微光／人像。
 * ===================================================================== */

/** 气泡：消息。 */
function TabMsgIcon() {
  return (
    <svg
      width={25}
      height={25}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.6 8A2.6 2.6 0 017.2 5.4h9.6A2.6 2.6 0 0119.4 8v6.2a2.6 2.6 0 01-2.6 2.6h-6.1L6.5 20v-3.2H7.2A2.6 2.6 0 014.6 14.2z" />
    </svg>
  );
}

/** 名片：通讯人（人像已在「我的」用掉，这里用名片，不重复）。 */
function TabPplIcon() {
  return (
    <svg
      width={25}
      height={25}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="5.8" width="17.6" height="12.4" rx="2.9" />
      <circle cx="9" cy="11" r="2.05" />
      <path d="M13.6 10.2h4.4M13.6 13.6h2.8" />
    </svg>
  );
}

/** 微光：动态（一大一小两颗四芒星）。 */
function TabStarIcon() {
  return (
    <svg
      width={25}
      height={25}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.4 6.2c.62 4.371 1.829 5.58 6.2 6.2-4.371.62-5.58 1.829-6.2 6.2-.62-4.371-1.829-5.58-6.2-6.2 4.371-.62 5.58-1.829 6.2-6.2z" />
      <path d="M17.4 5c.18 1.269.531 1.62 1.8 1.8-1.269.18-1.62.531-1.8 1.8-.18-1.269-.531-1.62-1.8-1.8 1.269-.18 1.62-.531 1.8-1.8z" />
    </svg>
  );
}

/** 人像：我的。 */
function TabMeIcon() {
  return (
    <svg
      width={25}
      height={25}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8.7" r="3.5" />
      <path d="M5 19.6c.85-3.75 3.6-5.8 7-5.8s6.15 2.05 7 5.8" />
    </svg>
  );
}

const TAB_ITEMS = [
  { view: "list", en: "Messages", Icon: TabMsgIcon },
  { view: "contacts", en: "Contacts", Icon: TabPplIcon },
  { view: "moments", en: "Moments", Icon: TabStarIcon },
  { view: "mine", en: "Me", Icon: TabMeIcon },
] as const;

function ChatTabBar({
  active,
  onNavigate,
}: {
  active: "list" | "contacts" | "moments" | "mine";
  onNavigate: (view: "list" | "contacts" | "moments" | "mine") => void;
}) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        borderTop: `1px solid ${HZ.line2}`,
        padding: "13px 14px calc(var(--safe-area-bottom, 0px) + 4px)",
        background: HZ.paper,
      }}
    >
      <style>{`
        .ctb-btn { transition: transform .16s ease, opacity .16s ease; }
        .ctb-btn:active { transform: scale(.94); opacity: .7; }
        @media (prefers-reduced-motion: reduce) { .ctb-btn { transition: none } }
      `}</style>
      {TAB_ITEMS.map(({ view, en, Icon }) => {
        const on = view === active;
        return (
          <button
            key={view}
            type="button"
            onClick={() => onNavigate(view)}
            className="ctb-btn"
            aria-label={en}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: "none",
              padding: 0,
              fontFamily: SANS,
              color: on ? HZ.accent : HZ.ink3,
              cursor: "pointer",
            }}
          >
            <Icon />
            <span
              style={{
                fontFamily: LAT,
                fontSize: 8.5,
                letterSpacing: ".12em",
                paddingLeft: ".12em",
                textTransform: "uppercase",
              }}
            >
              {en}
            </span>
          </button>
        );
      })}
    </div>
  );
}
