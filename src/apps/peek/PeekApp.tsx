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

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { usePhone } from "@/context/PhoneContext";
import { getArchives } from "@/lib/settings/contact";
import { getConversations } from "@/lib/settings/chat";
import { DEFAULT_MASK_ID, ensureMasks, getCurrentMask } from "@/lib/settings/mask";
import { openContactAccountIfEmpty } from "@/lib/chat/contactAccount";
import { formatYuan } from "@/lib/settings/wallet";
import ContactWalletView from "@/apps/chat/ContactWalletView";
import { AVATAR_GRADIENT, EN, SANS, T } from "@/apps/chat/shared";
import type { ArchiveEntry } from "@/types/contact";

export default function PeekApp() {
  const { closeApp } = usePhone();
  /** 能查的手机（＝当前面具的朋友）；null＝还在读。 */
  const [phones, setPhones] = useState<ArchiveEntry[] | null>(null);
  /** 打开的那台手机的主人；null＝停在名单上。 */
  const [target, setTarget] = useState<ArchiveEntry | null>(null);
  /** 他钱包那本账开着（第三层）。 */
  const [walletOpen, setWalletOpen] = useState(false);
  /** 他那本账的零钱（分）；null＝还没读出来，不写假数。 */
  const [cents, setCents] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [archives, conversations, masks] = await Promise.all([
        getArchives(),
        getConversations(),
        ensureMasks(),
      ]);
      if (!alive) return;
      const maskId = getCurrentMask(masks)?.id ?? DEFAULT_MASK_ID;
      setPhones(
        conversations
          .filter(
            (c) =>
              c.maskId === maskId &&
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

  /* 进谁的手机就先给他「开户」——第一次翻才有活干（AI 读人设编一份起手资金与
     过去两三个月的流水），开过的账只把余额读出来。开户要走一次模型、得等几秒，
     期间余额行写「正在对账」。 */
  useEffect(() => {
    if (!target) return;
    let alive = true;
    void openContactAccountIfEmpty({ ownerId: target.id, profile: target.data }).then(
      ({ balance }) => {
        if (alive) setCents(balance);
      },
    );
    return () => {
      alive = false;
    };
  }, [target]);

  const nameOf = (a: ArchiveEntry) => a.data.name || a.data.nickname || "TA";

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
                    setCents(null); // 换一台手机，先把上一台的数清掉，免得闪在新页上
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

      {/* ── 第二层：他的手机 → 他的星绥通讯 ── */}
      <div style={slideStyle(target !== null)}>
        <div style={headerStyle}>
          <button
            type="button"
            aria-label="返回"
            onClick={() => setTarget(null)}
            style={backBtnStyle}
          >
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <div style={titleBoxStyle}>
            <span style={titleStyle}>{target ? `${nameOf(target)}的手机` : "TA的手机"}</span>
            <span style={titleEnStyle}>his phone</span>
          </div>
        </div>

        {target ? (
          <div style={scrollStyle}>
            {/* 机身：他的身份牌 */}
            <div style={bodyCardStyle}>
              <span style={avatarStyle(target.data.photo)}>
                {target.data.photo ? null : nameOf(target).slice(0, 1)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{nameOf(target)}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>
                  这台手机用的是星绥通讯
                </div>
              </div>
            </div>

            {/* 他的星绥通讯：这一版只摆得出钱包 */}
            <div style={sectionHeadStyle}>
              <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>
                星绥通讯
              </span>
              <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
                stellasei
              </span>
            </div>
            <div style={boxCardStyle}>
              <PeekRow
                icon={<Wallet size={16} strokeWidth={1.8} color={T.pink} />}
                label="钱包"
                value={cents === null ? "正在对账…" : `¥${formatYuan(cents)}`}
                onClick={() => setWalletOpen(true)}
              />
            </div>

            <div style={footNoteStyle}>
              他的零钱和收支明细都在这里。他的聊天记录、朋友圈，以后也挂到这台手机上。
            </div>
          </div>
        ) : null}
      </div>

      {/* ── 第三层：他那本账（零钱 ＋ 收支明细）── */}
      <div style={slideStyle(walletOpen)}>
        {target ? (
          <ContactWalletView
            ownerId={target.id}
            ownerName={nameOf(target)}
            onBack={() => setWalletOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 手机里的一行（图标 ＋ 名字 ＋ 右侧值 ＋ 箭头）。 */
function PeekRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={rowStyle}>
      <span style={rowIconStyle}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 14, fontWeight: 500 }}>
        {label}
      </span>
      {value ? <span style={{ fontSize: 13, color: T.ink2 }}>{value}</span> : null}
      <ChevronRight size={16} strokeWidth={1.9} color={T.ink3} />
    </button>
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

/** 机身里的身份牌（头像 ＋ 名字）。 */
const bodyCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 18px",
  borderRadius: 22,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  boxShadow: "0 12px 30px -22px rgba(20,19,24,.5)",
};

/** 他的星绥通讯里的一格（白卡，圆角同钱包页）。 */
const boxCardStyle: CSSProperties = {
  borderRadius: 20,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  boxShadow: "0 12px 30px -24px rgba(20,19,24,.5)",
  overflow: "hidden",
  padding: "4px 4px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "12px 10px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: SANS,
  color: T.ink,
};

const rowIconStyle: CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: 10,
  background: T.pinkSoft,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  margin: "22px 0 8px",
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
