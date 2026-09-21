"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock,
  HelpCircle,
  LogOut,
  MessageCircle,
  RefreshCw,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { usePhone } from "@/context/PhoneContext";
import { getArchives } from "@/lib/settings/contact";
import { getApiSettings, getConversations, ensureAssistant } from "@/lib/settings/chat";
import { getMyIdentity, saveMyIdentity } from "@/lib/settings/identity";
import { DEFAULT_MASK_ID, ensureMasks, migrateLegacySignature, saveMasks, type Mask } from "@/lib/settings/mask";
import { APP_VERSION } from "@/lib/version";
import MessageList from "./MessageList";
import ChatWindow from "./ChatWindow";
import ContactList from "./ContactList";
import MomentsPage from "./MomentsPage";
import MinePage, { SIGNATURE_FALLBACK } from "./MinePage";
import { AVATAR_GRADIENT, EN, SANS, T } from "./shared";
import type { ArchiveEntry } from "@/types/contact";
import type { ChatApiSettings, Conversation } from "@/types/chat";

/* =======================================================================
 * 星绥通讯 App：视图管理（列表 ⇄ 对话）＋侧边栏
 * （API 设定在主屏幕「设置」App 里，聊天内不再放入口）
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
  /** 应用内视图：消息列表 ⇄ 通讯人 ⇄ 动态 ⇄ 我的（侧边栏进入）。 */
  const [view, setView] = useState<"list" | "contacts" | "moments" | "mine">("list");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(() => {
    /* 先确保内置 AI 助手就位（建档＋各面具绑定），再拉数据——顺序反了的话，
       这次读到的通讯人列表里还没有它。助手挂了不阻塞主流程（catch 掉继续）。 */
    void (async () => {
      try {
        await ensureAssistant().catch(() => undefined);
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
        /* 签名并进面具（第 284 条）的一次性迁移：旧的全局签名填给「使用中」那张面具，
           填完就清掉旧字段，免得她以后故意清空签名、刷新又被搬回来。 */
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
            onOpenChat={(characterId) => openChatWith(characterId, scopeMaskId)}
            onOpenSidebar={() => setSidebarOpen(true)}
            onDataChange={reloadConversations}
            showToast={showToast}
          />
        ) : view === "moments" ? (
          <MomentsPage
            archives={archives}
            /* 动态跟通讯人同一口径：只看当前面具的朋友圈 */
            conversations={scopedConversations}
            maskName={effectiveName}
            maskAvatar={currentMask?.avatar ?? ""}
            /* 签名跟「我的」页同一口径：没写就用兜底那句 */
            signature={currentMask?.signature?.trim() || SIGNATURE_FALLBACK}
            onOpenSidebar={() => setSidebarOpen(true)}
            showToast={showToast}
          />
        ) : view === "mine" ? (
          <MinePage
            signature={currentMask?.signature ?? ""}
            masks={masks}
            /* 签名并进面具（第 284 条）：写的是「使用中」那张面具的签名，不再有全局字段。 */
            onSignatureChange={(next) => {
              if (!currentMask) return;
              const nextMasks = masks.map((m) =>
                m.id === currentMask.id ? { ...m, signature: next } : m,
              );
              setMasks(nextMasks);
              void saveMasks(nextMasks);
            }}
            onMasksChange={setMasks}
            onBack={() => setView("list")}
            showToast={showToast}
          />
        ) : (
          <MessageList
            archives={archives}
            conversations={conversations}
            masks={masks}
            onOpenChat={(characterId, maskId) => openChatWith(characterId, maskId)}
            onOpenSidebar={() => setSidebarOpen(true)}
            showToast={showToast}
          />
        )
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

      {/* 侧边栏遮罩：一层深色纱，黑底侧栏压在下面那片粉白上 */}
      {sidebarOpen ? (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "absolute", inset: 0, background: "rgba(20,19,24,.42)", zIndex: 90 }}
        />
      ) : null}

      <ChatSidebar
        open={sidebarOpen}
        activeView={view}
        mineName={effectiveName}
        mineAvatar={currentMask?.avatar ?? ""}
        mineSignature={currentMask?.signature ?? ""}
        onClose={() => setSidebarOpen(false)}
        onNavigate={(next) => {
          setSidebarOpen(false);
          setView(next);
          setOpenChat(null);
        }}
        onExit={closeApp}
        showToast={showToast}
      />

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
 * 侧边栏＝黑底菜单（2026-09-20 黑粉蓝版）。恩熙这一版要「色彩出彩但顺眼、
 * 重点是排版、不要主题」：整条侧栏底色直接压成近黑，字走粉白的大字号，
 * 当前那一项是一枚粉胶囊包住整行（一推开侧栏，黑＋粉＋白就全在眼前）。
 * 上面一块是你的头像＋名字＋签名，底下是菜单。按任一行的反馈见上面的 css。
 * ===================================================================== */

function ChatSidebar({
  open,
  activeView,
  mineName,
  mineAvatar,
  mineSignature,
  onClose,
  onNavigate,
  onExit,
  showToast,
}: {
  open: boolean;
  activeView: "list" | "contacts" | "moments" | "mine";
  /** 名字（使用中的面具决定）；空串以「我」展示。 */
  mineName: string;
  /** 头像（使用中的面具；空串用渐变底＋首字）。 */
  mineAvatar: string;
  /** 签名（「我的」页设定）；空串用预设文案。 */
  mineSignature: string;
  onClose: () => void;
  onNavigate: (view: "list" | "contacts" | "moments" | "mine") => void;
  onExit: () => void;
  showToast: (msg: string) => void;
}) {
  const name = mineName.trim() || "我";
  const signature = mineSignature.trim() || SIGNATURE_FALLBACK;
  const menuItems: { name: string; icon: typeof MessageCircle; action: () => void; active?: boolean }[] = [
    { name: "消息", icon: MessageCircle, action: () => onNavigate("list"), active: activeView === "list" },
    { name: "通讯人", icon: Users, action: () => onNavigate("contacts"), active: activeView === "contacts" },
    { name: "动态", icon: Clock, action: () => onNavigate("moments"), active: activeView === "moments" },
    { name: "我的收藏", icon: Bookmark, action: () => { onClose(); showToast("我的收藏 · 预览"); } },
    { name: "我的钱包", icon: Wallet, action: () => { onClose(); showToast("我的钱包 · 预览"); } },
    { name: "聊天全局设定", icon: Settings, action: () => { onClose(); showToast("聊天全局设定 · 打造中"); } },
    /* iOS 主屏幕 App 从快照复活、不重新加载页面，改版后可能一直跑旧代码；
       这里给一个手动重载入口兜底（2026-09-16 生图排查当天加）。 */
    { name: "检查更新", icon: RefreshCw, action: () => { onClose(); window.location.reload(); } },
    { name: "帮助与反馈", icon: HelpCircle, action: () => { onClose(); showToast("帮助与反馈 · 预览"); } },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100,
        width: "min(304px,80%)",
        background: T.ink,
        // 收起时（translateX(-102%)）不能留投影：偏移＋模糊会往右渗出约 56px，
        // 在消息列表左边压出一道常驻暗边。只在展开时给影（恩熙 2026-09-20 发现）。
        boxShadow: open ? "24px 0 60px -28px rgba(20,19,24,.7)" : "none",
        transform: open ? "translateX(0)" : "translateX(-102%)",
        transition: "transform .3s ease-out",
        display: "flex",
        flexDirection: "column",
        paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 14px)",
        fontFamily: SANS,
        color: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      {/* 交互：按下整行收一档；当前那一项是一枚粉胶囊（整行包住） */}
      <style>{`
        .csb-item { transition: transform .16s ease, background-color .16s ease, filter .16s ease; }
        .csb-item:active { transform: scale(.985); }
        .csb-item:not(.is-active):active { background: rgba(255,255,255,.1); }
        .csb-item.is-active:active { filter: brightness(.94); }
        @media (prefers-reduced-motion: reduce) {
          .csb-item { transition: none }
        }
      `}</style>
      {/* 头部：一行小字（刊号＋版本）压一条大标题 */}
      <div style={{ position: "relative", zIndex: 1, flex: "none", padding: "0 20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: EN,
            fontSize: 9,
            letterSpacing: ".26em",
            color: "rgba(255,255,255,.42)",
            textTransform: "uppercase",
          }}
        >
          <span>Stellasei</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>v{APP_VERSION}</span>
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-.01em",
            lineHeight: 1,
            color: "#FFFFFF",
          }}
        >
          星绥通讯
        </div>
      </div>

      {/* 你：头像（进「我的」）＋名字＋签名，紫粉环的黑底头像一方块 */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: "none",
          padding: "18px 20px 14px",
          marginTop: 18,
          borderTop: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", flex: "none" }}>
            <div
              onClick={() => onNavigate("mine")}
              style={{
                width: 54,
                height: 54,
                padding: 2,
                background: "rgba(255,255,255,.14)",
                borderRadius: 18,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 16,
                  background: AVATAR_GRADIENT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFF",
                  fontSize: 19,
                  fontWeight: 700,
                  overflow: "hidden",
                }}
              >
                {mineAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mineAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  name.charAt(0)
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => showToast("切换账号 · 预览")}
              aria-label="切换账号"
              style={{
                position: "absolute",
                right: -6,
                bottom: -6,
                width: 22,
                height: 22,
                padding: 0,
                borderRadius: 999,
                background: T.ink,
                border: "1px solid rgba(255,255,255,.24)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,.7)",
                cursor: "pointer",
              }}
            >
              <ChevronDown size={12} strokeWidth={2.2} />
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: ".01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "#FFFFFF",
              }}
            >
              {name}
            </div>
            <div
              style={{
                marginTop: 7,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,.55)",
                letterSpacing: ".02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {signature}
            </div>
            {/* 在线小签：粉点＋在线（粉在黑上就这一小处） */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 10,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,.1)",
                fontSize: 10.5,
                color: "rgba(255,255,255,.72)",
                letterSpacing: ".1em",
              }}
            >
              <i style={{ width: 6, height: 6, borderRadius: 999, background: T.pink }} />
              <span>在线</span>
            </div>
          </div>
        </div>
        <div
          className="csb-item"
          onClick={() => showToast("拍一拍设置 · 预览")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 14,
            background: "rgba(255,255,255,.07)",
            color: "rgba(255,255,255,.72)",
            fontSize: 13,
            letterSpacing: ".04em",
            cursor: "pointer",
          }}
        >
          <span>拍一拍设置</span>
          <ChevronRight size={15} strokeWidth={2} />
        </div>
      </div>

      {/* 菜单小标：一行极淡的英文起头 */}
      <div style={{ position: "relative", zIndex: 1, flex: "none", padding: "18px 22px 8px" }}>
        <span
          style={{
            fontFamily: EN,
            fontSize: 9,
            letterSpacing: ".26em",
            color: "rgba(255,255,255,.38)",
            textTransform: "uppercase",
          }}
        >
          Menu
        </span>
      </div>

      {/* 菜单：一行一项，当前那一项整行包成粉胶囊（黑字压在上面，最跳也最读得清） */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "4px 14px 0",
        }}
      >
        {menuItems.map((item) => (
          <div
            key={item.name}
            className={`csb-item${item.active ? " is-active" : ""}`}
            onClick={item.action}
            data-tap="true"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              marginBottom: 4,
              borderRadius: 999,
              background: item.active ? T.pink : "transparent",
              color: item.active ? T.ink : "rgba(255,255,255,.78)",
              fontSize: 16,
              fontWeight: item.active ? 700 : 500,
              letterSpacing: ".04em",
              cursor: "pointer",
            }}
          >
            <item.icon size={17} strokeWidth={2} style={{ flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0 }}>{item.name}</span>
            {item.active ? <ChevronRight size={15} strokeWidth={2.4} style={{ flex: "none" }} /> : null}
          </div>
        ))}

        {/* 退出：黑底上最轻的一条，只在按下去时浮一层淡粉 */}
        <button
          type="button"
          className="csb-item"
          onClick={onExit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            width: "100%",
            textAlign: "left",
            padding: "13px 16px",
            marginTop: 8,
            borderRadius: 999,
            color: "rgba(255,255,255,.55)",
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
            background: "transparent",
            border: "none",
            fontFamily: SANS,
          }}
        >
          <LogOut size={17} strokeWidth={1.8} style={{ flex: "none" }} />
          <span style={{ flex: 1 }}>退出</span>
        </button>
      </div>

      {/* 版权页脚注：版本号压在最底下那行小字里 */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: "none",
          padding: "12px 20px calc(var(--safe-area-bottom, 0px) + 14px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: EN,
          fontSize: 8,
          letterSpacing: ".2em",
          color: "rgba(255,255,255,.3)",
          textTransform: "uppercase",
        }}
      >
        <span>Stellasei — est. 2026</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>v{APP_VERSION}</span>
      </div>
    </div>
  );
}
