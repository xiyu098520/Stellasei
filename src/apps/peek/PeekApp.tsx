"use client";

/**
 * 查手机（1.4.35）——TA 的钱包**唯一的门**。
 *
 * 【为什么另起一个 App】1.4.34 把 TA 那本账露在了「通讯人 → 点 TA → 资料页」的一张卡上，
 * 恩熙说这不妥：**他的钱包不该让我随手看见**，得是我主动去「查手机」才翻得到的东西。
 * 于是那张卡撤掉，改成这台手机上的第八枚图标：点「查手机」→ 选一台手机 → 进他的微信 → 钱包。
 * 走一层门，是这个动作本身的分量。
 *
 * 【这台手机里有什么】这一版只有他的「星绥通讯」和他的**钱包／零钱**（复用
 * `ContactWalletView`，那本账的余额与收支明细）。他的聊天记录、朋友圈以后可以挂到
 * 同一台手机上——页脚那句话是如实告诉看的人：现在能翻的就这一样。
 *
 * 【进来第一件事是给他开户（1.4.36）】他那本账原来是空的，第一次翻他手机时才按人设
 * 生成起手资金与历史流水（`lib/chat/contactAccount`）；开过的账不再重开，之后每次翻
 * 只往后长。开户得等一次模型调用，那几秒余额行写「正在对账…」。
 *
 * 【只在「我的面具」视角下】能查的是**当前面具的朋友**（与星绥通讯的消息列表同一份口径：
 * 被假删、待同意的角色不出现）。
 *
 * 【样式】跟星绥通讯那套同一张皮（`@/apps/chat/shared` 的 T 板：透粉白底、纯白卡、
 * 近黑圆返回钮），不另起一套。
 */

import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { usePhone } from "@/context/PhoneContext";
import { getArchives } from "@/lib/settings/contact";
import { getConversations, getConversationMessages } from "@/lib/settings/chat";
import { DEFAULT_MASK_ID, ensureMasks, getCurrentMask, type Mask } from "@/lib/settings/mask";
import { openContactAccountIfEmpty } from "@/lib/chat/contactAccount";
import ContactWalletView from "@/apps/chat/ContactWalletView";
import ContactPhoneApp from "@/apps/peek/ContactPhoneApp";
import { ChatIcon } from "@/apps/icons";
import { AVATAR_GRADIENT, EN, SANS, T } from "@/apps/chat/shared";
import type { ArchiveEntry } from "@/types/contact";
import type { ChatMessage } from "@/types/chat";

export default function PeekApp() {
  const { closeApp } = usePhone();
  /** 能查的手机（＝当前面具的朋友）；null＝还在读。 */
  const [phones, setPhones] = useState<ArchiveEntry[] | null>(null);
  /** 打开的那台手机的主人；null＝停在名单上。 */
  const [target, setTarget] = useState<ArchiveEntry | null>(null);
  /** 他手机屏幕里正开着哪一屏（1.12.15）：桌面／星绥通讯。钱包另起一层。 */
  const [view, setView] = useState<"home" | "app">("home");
  /** 他钱包那本账开着。 */
  const [walletOpen, setWalletOpen] = useState(false);
  /** 当前面具（「我」）：联系人里要有我、聊天列表里那一条也是我，所以名字与头像都带上。 */
  const [mask, setMask] = useState<Mask | null>(null);
  /** 当前面具 id（挑出「我跟这个角色」的那一条会话要用）。 */
  const [maskId, setMaskId] = useState(DEFAULT_MASK_ID);
  /** 打开的那台手机里「我跟他的聊天」的**完整消息**（连同它属于哪个角色）。convs 来自
   *  会话列表、每条只挂了最近一条，不够翻——进手机时按需把这一条会话的全量读出来
   *  （只读这一个会话）。带上 characterId 是为了换手机时能一眼认出「这份还是上一台的」。 */
  const [targetChat, setTargetChat] = useState<{ characterId: string; messages: ChatMessage[] }>({
    characterId: "",
    messages: [],
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [archives, conversations, masks] = await Promise.all([
        getArchives(),
        getConversations(),
        ensureMasks(),
      ]);
      if (!alive) return;
      const currentMaskId = getCurrentMask(masks)?.id ?? DEFAULT_MASK_ID;
      setMask(getCurrentMask(masks) ?? null);
      setMaskId(currentMaskId);
      setPhones(
        conversations
          .filter(
            (c) =>
              c.maskId === currentMaskId &&
              c.friendStatus !== "removed" &&
              c.friendStatus !== "requested",
          )
          .flatMap((c) => {
            const archive = archives.find((a) => a.id === c.characterId);
            return archive ? [archive] : [];
          }),
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* 进谁的手机就先给他「开户」（1.4.36）——第一次翻才有活干（AI 读人设编一份起手资金
     与最近一周的流水），开过的账什么都不做。开户要走一次模型、得等几秒；摆在**桌面**
     这一层就做掉，免得点进钱包时还是一本空账。 */
  useEffect(() => {
    if (!target) return;
    void openContactAccountIfEmpty({ ownerId: target.id, profile: target.data });
  }, [target]);

  const nameOf = (a: ArchiveEntry) => a.data.name || a.data.nickname || "TA";

  /** 他手机里那个「星绥通讯」＝我跟他的这条会话（同一份数据，所以天然是延续的）。
   *  会话列表只挂了最近一条，这里按需把这一条会话的完整消息读出来给他翻。 */
  useEffect(() => {
    if (!target) return;
    let alive = true;
    void getConversationMessages(target.id, maskId).then((messages) => {
      if (alive) setTargetChat({ characterId: target.id, messages });
    });
    return () => {
      alive = false;
    };
  }, [target, maskId]);

  return (
    <div style={rootStyle}>
      {/* ── 第一层：查谁的手机（这台手机上有几台手机）── */}
      <div style={layerStyle}>
        <div style={headerStyle}>
          <button type="button" aria-label="返回" onClick={closeApp} style={backBtnStyle}>
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <div style={titleBoxStyle}>
            <span style={titleStyle}>查手机</span>
            <span style={titleEnStyle}>phone peek</span>
          </div>
        </div>

        <div style={scrollStyle}>
          {phones === null ? (
            <div style={emptyHintStyle}>正在翻……</div>
          ) : phones.length === 0 ? (
            <div style={emptyHintStyle}>
              还没有谁的手机可查，先去星绥通讯加一个朋友
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {phones.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    /* 换一台手机：先把他那台手机的屏推回桌面、钱包关掉，免得闪在新手机上。 */
                    setView("home");
                    setWalletOpen(false);
                    setTarget(a);
                  }}
                  style={phoneCardStyle}
                >
                  {/* 刘海：一眼认出这是一台手机，不是一张资料卡 */}
                  <span style={notchStyle} />
                  <span style={avatarStyle(a.data.photo)}>
                    {a.data.photo ? null : nameOf(a).slice(0, 1)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={phoneNameStyle}>{nameOf(a)}</span>
                    <span style={phoneHintStyle}>
                      {a.data.nickname && a.data.nickname !== nameOf(a)
                        ? `${a.data.nickname} 的手机`
                        : "TA 的手机"}
                    </span>
                  </span>
                  <ChevronRight size={17} strokeWidth={1.9} color={T.ink3} />
                </button>
              ))}
            </div>
          )}

          <div style={footNoteStyle}>
            这里的每一台手机，都是你能翻的。点一台进去，看他的星绥通讯。
          </div>
        </div>
      </div>

      {/* ── 第二层：他的手机（1.12.6）——**占满整屏**，外面不套机身 ── */}
      <div style={slideStyle(target !== null)}>
        {target ? (
          view === "home" ? (
            <div style={homeScreenStyle}>
              {/* 壁纸 ＋ 极淡网点（跟我们主屏同一手：一层底色、一层几乎感觉不到的纹理） */}
              <div style={homeWallpaperStyle} aria-hidden />
              <div style={homeTextureStyle} aria-hidden />

              {/* 顶上不摆任何标题行（主屏也没有）；只在右上角留一颗**关闭**的叉叉
                  ——这一台手机是"被翻开"的，划下来就当关掉了。 */}
              <button
                type="button"
                aria-label="关闭"
                onClick={() => {
                  setTarget(null);
                  setView("home");
                  setWalletOpen(false);
                }}
                style={homeCloseStyle}
              >
                <X size={17} strokeWidth={2.2} />
              </button>

              {/* 应用网格：跟主屏同一套格位（4 栏 × 6 排、格位 66px、横 20 竖 3、行高均分）。
                  他眼下只有一枚应用，而且属于 Dock 那一类（主屏也把 Dock 应用从网格里排除），
                  所以这里空着——以后装的应用从这儿排。 */}
              <div style={homeGridStyle} />

              {/* 翻页小点（主屏 Dock 上方那道；他只有一页，就一枚） */}
              <div style={homeDotsStyle}>
                <span style={homeDotStyle} />
              </div>

              {/* 底部 Dock：跟主屏同一块（宽度公式：格位×4 ＋ 间距×3 ＋ 余量 30）。
                  **格位留 4 个**（恩熙：其他按钮还没做进去而已）——眼下只停着「星绥通讯」
                  一枚，其余三格空着占位，以后往里装。图标**不挂名字**（主屏 Dock 的规矩）。 */}
              <div style={homeDockStyle}>
                <button
                  type="button"
                  aria-label="星绥通讯"
                  onClick={() => setView("app")}
                  style={appTileStyle}
                >
                  <span style={appGlossStyle} aria-hidden />
                  <ChatIcon size={26} strokeWidth={1.75} />
                </button>
                <span aria-hidden />
                <span aria-hidden />
                <span aria-hidden />
              </div>
            </div>
          ) : (
            <ContactPhoneApp
              ownerId={target.id}
              ownerName={nameOf(target)}
              ownerAvatar={target.data.photo ?? ""}
              myName={mask?.name ?? ""}
              myAvatar={mask?.avatar ?? ""}
              friends={phones ?? []}
              messages={targetChat.characterId === target.id ? targetChat.messages : []}
              onOpenWallet={() => setWalletOpen(true)}
              onBack={() => setView("home")}
            />
          )
        ) : null}
      </div>

      {/* ── 第三层：他那本账（零钱 ＋ 收支明细）── */}
      <div style={slideStyle(walletOpen)}>
        {target ? (
          <ContactWalletView
            ownerId={target.id}
            ownerName={nameOf(target)}
            profile={target.data}
            onBack={() => setWalletOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── 样式 ── */

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: T.bg,
  overflow: "hidden",
  fontFamily: SANS,
  color: T.ink,
};

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: T.bg,
  display: "flex",
  flexDirection: "column",
};

/** 滑页：关着的时候整体推到屏幕右边外（同星绥通讯各滑页那套）。 */
function slideStyle(open: boolean): CSSProperties {
  return {
    ...layerStyle,
    zIndex: open ? 2 : 1,
    transform: open ? "none" : "translateX(100%)",
    transition: "transform .32s cubic-bezier(.22,1,.36,1)",
    pointerEvents: open ? "auto" : "none",
  };
}

const headerStyle: CSSProperties = {
  flexShrink: 0,
  paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px)",
  paddingLeft: 16,
  paddingRight: 16,
  paddingBottom: 10,
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const backBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 999,
  border: "none",
  background: T.ink,
  color: "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const titleBoxStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

const titleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: ".02em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const titleEnStyle: CSSProperties = {
  fontFamily: EN,
  fontSize: 9.5,
  color: T.ink3,
  letterSpacing: ".3em",
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "4px 16px 30px",
};

const emptyHintStyle: CSSProperties = {
  padding: "60px 0 8px",
  textAlign: "center",
  fontSize: 12,
  color: T.ink3,
  letterSpacing: ".06em",
};

/* 名单上的一台手机：白卡上压一条刘海，圆角跟真机一个量级。 */
const phoneCardStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "18px 16px 16px",
  borderRadius: 26,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  boxShadow: "0 12px 30px -24px rgba(20,19,24,.5)",
  cursor: "pointer",
  fontFamily: SANS,
  color: T.ink,
};

const notchStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  left: "50%",
  transform: "translateX(-50%)",
  width: 42,
  height: 4,
  borderRadius: 999,
  background: T.line,
};

const phoneNameStyle: CSSProperties = {
  display: "block",
  fontSize: 15,
  fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const phoneHintStyle: CSSProperties = {
  display: "block",
  marginTop: 3,
  fontSize: 11,
  color: T.ink3,
  letterSpacing: ".04em",
};

/**
 * 他的手机（1.12.6 起**整屏铺满**，1.12.7 补齐桌面该有的东西）。不套机身边框
 * （恩熙：「不是要做成小手机的里头看一个小手机，而是一样做成全屏的样子」）：
 * 壁纸铺满整屏 → 让开状态栏的顶部行 → 一行日期 → 应用区 → 底部 Dock。
 */
const homeScreenStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "#F2F2F3",
};

/** 壁纸：铺满整屏（连状态栏底下一起）。**只用黑白灰**（恩熙定的），不上色。 */
const homeWallpaperStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, #FBFBFB 0%, #F0F0F1 46%, #E3E3E5 100%)",
};

/** 极淡网点纹理（跟我们主屏同一手）：几乎感觉不到，但桌面不至于是块光板。 */
const homeTextureStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage: "radial-gradient(circle, rgba(17,17,17,.055) 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};

/**
 * 右上角那颗**关闭**的叉叉（1.12.13）：浮在壁纸上，不占一行标题。
 * 这一台手机是「被翻开」的，关掉就走——所以是叉叉，不是返回箭头。
 */
const homeCloseStyle: CSSProperties = {
  position: "absolute",
  top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 8px)",
  right: 14,
  width: 32,
  height: 32,
  zIndex: 3,
  borderRadius: 999,
  border: "none",
  background: "rgba(17,17,17,.06)",
  color: "rgba(23,23,26,.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

/**
 * 应用网格：**照主屏 `GridLayout` 的真值**（1.12.12）——4 栏 × 6 排、格位 66px、
 * 横 gap 20、竖 gap 3、行高 `minmax(0,1fr)` 均分铺满，图标在格子里居中。
 * 网格里只放「不属于 Dock」的应用；他眼下那一枚属于 Dock，所以这里是空的。
 */
const homeGridStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  /* 顶上那条标题行撤了（1.12.13），所以让开系统状态栏这件事挪到网格自己身上
     ——与主屏那层容器的 `pt-[calc(safe-area-top + sim-status-h + 6px)]` 同值。 */
  paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 6px)",
  display: "grid",
  gridTemplateColumns: "repeat(4, 66px)",
  gridTemplateRows: "repeat(6, minmax(0, 1fr))",
  columnGap: 20,
  rowGap: 3,
  justifyContent: "center",
};

/** 翻页小点那一条（主屏在 Dock 上方留的那道）。他只有一页，就一枚。 */
const homeDotsStyle: CSSProperties = {
  flexShrink: 0,
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  marginBottom: 12,
};

const homeDotStyle: CSSProperties = {
  width: 16,
  height: 6,
  borderRadius: 999,
  background: "rgba(23,23,26,.45)",
};

/**
 * 底部 Dock：**照主屏 `Dock` 的真值**（1.12.12）——宽度公式 格位×数量 ＋ 间距×(数量−1) ＋ 30、
 * 高 92、圆角 32、格位 66／间距 20、居中悬浮。
 * **格位留 4 个**（1.12.14，恩熙：「下面的格子依旧要让它是 4 个，只不过其他按钮还没做进去」）
 * ＝66×4 ＋ 20×3 ＋ 30 ＝ 354px，跟主屏一样宽；眼下只第一格停着应用，其余空着占位。
 * 材质用主屏那块玻璃同值；配色按恩熙定的走黑白灰。
 */
const homeDockStyle: CSSProperties = {
  flexShrink: 0,
  alignSelf: "center",
  width: "min(354px, calc(100% - 8px))",
  minHeight: 92,
  borderRadius: 32,
  display: "grid",
  gridTemplateColumns: "repeat(4, 66px)",
  columnGap: 20,
  justifyContent: "center",
  alignItems: "center",
  marginBottom: "calc(var(--safe-area-bottom, 0px) + 10px)",
  background: "rgba(255,255,255,.35)",
  border: "1px solid rgba(255,255,255,.4)",
  boxShadow: "0 8px 30px rgba(23,23,26,.10), inset 0 1px 0 rgba(255,255,255,.55)",
  transform: "translateZ(0)",
  WebkitBackdropFilter: "blur(24px) saturate(160%)",
  backdropFilter: "blur(24px) saturate(160%)",
};

/**
 * 应用图标方块：**照主屏那颗**（58×58、圆角 16、淡底 ＋ 内描边 1px ＋ 一道斜高光、
 * 线描图标 26／1.75）——只是把主屏那支紫换成中性灰黑（黑白灰）。
 * Dock 里的图标**不挂名字**，跟主屏 Dock 一个规矩。
 */
const appTileStyle: CSSProperties = {
  position: "relative",
  width: 58,
  height: 58,
  borderRadius: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  border: "none",
  padding: 0,
  cursor: "pointer",
  background: "rgba(17,17,17,.05)",
  boxShadow: "inset 0 0 0 1px rgba(17,17,17,.14), 0 1px 4px rgba(17,17,17,.03)",
  color: "#2B2B2F",
};

/** 图标上那道斜高光（主屏同款：从左上角淡下去）。 */
const appGlossStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: 16,
  background: "linear-gradient(160deg, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 55%)",
  pointerEvents: "none",
};

const footNoteStyle: CSSProperties = {
  marginTop: 22,
  fontSize: 11,
  lineHeight: 1.8,
  color: T.ink3,
  letterSpacing: ".04em",
};

function avatarStyle(photo?: string): CSSProperties {
  return {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 14,
    background: photo ? `url(${photo}) center/cover` : AVATAR_GRADIENT,
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
