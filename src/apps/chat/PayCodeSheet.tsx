"use client";

/**
 * 我的收款码（1.4.24）。
 *
 * 面板里就一张码：顶上是谁的码（头像＋名字），中间一张白底 QR，
 * 码下面印那串收款编号（`SEI-482139`），底下两颗按钮：存图、换个码。
 *
 * 【码是怎么来的】账本里只存编号（`wallet.ts` 的 `getPayCode`），
 * 码图每次打开这个面板现画（`lib/settings/paycode.ts`）——所以换了编号，
 * 码自然就跟着变，不用去清旧图。
 * 【换个码＝换编号】旧编号当场作废（以前发出去的那张扫不出东西了），
 * 所以这里跟「销卡」一样要再点一下确认，别手滑。
 * 【存图】走 `saveImageToDevice`（跟聊天里点图保存同一条路）：点一下直接弹系统面板
 * （「存储图像」在里面）→ 存相册。码图这里另外放开长按，当作第二只手，
 * 面板万一没出来也还有得存。
 * 【扫码扫出什么】一串 `stellasei://pay?...`——本 App 还没有真实支付，
 * 扫开不接任何流程；这码现在是给角色看、给自己存着玩的。
 */

import { useEffect, useState, type CSSProperties } from "react";
import { Check, Download, RefreshCw } from "lucide-react";
import { getPayCode, regeneratePayCode } from "@/lib/settings/wallet";
import { renderPayCodeDataUrl } from "@/lib/settings/paycode";
import { saveImageToDevice } from "@/lib/chat/media-asset";
import WalletSheet, {
  WALLET_MONO,
  WALLET_PAPER_BAR,
  WALLET_PAPER_SHADOW,
  WALLET_PRIMARY_BTN,
} from "./WalletSheet";
import { AVATAR_GRADIENT, SANS, T } from "./shared";

export default function PayCodeSheet({
  ownerId,
  ownerName,
  ownerAvatar,
  onClose,
  showToast,
}: {
  /** 谁的码：当前使用中面具的 id（一本账一张码）。 */
  ownerId: string;
  /** 码上面那个名字（也是扫出来那串里的 name）。 */
  ownerName: string;
  /** 头像；空串＝还没设过，用渐变底＋名字首字兜底。 */
  ownerAvatar?: string;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  /** 现在的收款编号（null＝还在读）。 */
  const [code, setCode] = useState<string | null>(null);
  /** 画好的码图（data URL）；null＝还在画。 */
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 换码要再点一下确认。 */
  const [confirmSwap, setConfirmSwap] = useState(false);

  /** 拿编号 → 画码图。第一次打开这个面具的码时顺手生成，之后每次都是读回来那张。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await getPayCode(ownerId);
      if (!alive) return;
      setCode(next);
      const url = await renderPayCodeDataUrl(ownerName, next);
      if (!alive) return;
      setImgUrl(url);
      if (!url) showToast("码画不出来，稍后再试");
    })();
    return () => {
      alive = false;
    };
  }, [ownerId, ownerName, showToast]);

  /** 换个码：编号一换，旧码就作废了。 */
  const doSwap = async () => {
    setBusy(true);
    setImgUrl(null);
    try {
      const next = await regeneratePayCode(ownerId);
      setCode(next);
      const url = await renderPayCodeDataUrl(ownerName, next);
      setImgUrl(url);
      setConfirmSwap(false);
      showToast("换了张新码，以前那张作废了");
    } finally {
      setBusy(false);
    }
  };

  /** 存图：手机弹分享面板存相册，桌面直接下载。 */
  const doSave = () => {
    if (!imgUrl) return;
    saveImageToDevice(imgUrl, undefined, showToast);
  };

  return (
    <WalletSheet title="我的收款码" hint="把钱转给我，扫这张码" onClose={onClose}>
      {/* ── 谁的码 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PayCodeAvatar name={ownerName} avatar={ownerAvatar ?? ""} size={38} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{ownerName}</div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: T.ink3, letterSpacing: ".04em" }}>
            我的收款码
          </div>
        </div>
      </div>

      {/* ── 码 ── */}
      <div style={codeBoxStyle}>
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgUrl}
            alt="收款码"
            /* 放开原生长按：多一条路，系统菜单里的「存储到照片」直接可用，
               不依赖「保存图片」那个按钮（见 saveImageToDevice）。 */
            style={{
              width: "100%",
              display: "block",
              WebkitTouchCallout: "default",
              WebkitUserSelect: "auto",
              userSelect: "auto",
            }}
          />
        ) : (
          <div style={{ paddingTop: "100%", position: "relative" }}>
            <span style={codeLoadingStyle}>正在画码…</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, textAlign: "center" }}>
        <span style={{ fontFamily: WALLET_MONO, fontSize: 15, letterSpacing: ".16em", fontWeight: 700 }}>
          {code ?? "SEI-······"}
        </span>
        <div style={{ marginTop: 5, fontSize: 10.5, color: T.ink3, letterSpacing: ".04em" }}>
          编号只认现在这一张，换码后旧码就扫不出来了
        </div>
      </div>

      {/* ── 存图 ＋ 换个码 ── */}
      {confirmSwap ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.7, letterSpacing: ".04em" }}>
            换一张？现在这个编号立刻作废——之前把码发出去的地方，扫旧码就认不出来了。
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" onClick={() => setConfirmSwap(false)} style={ghostBtnStyle}>
              再想想
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doSwap()}
              style={{ ...WALLET_PRIMARY_BTN, flex: 1, marginTop: 0, opacity: busy ? 0.6 : 1 }}
            >
              确认换码
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            disabled={!imgUrl}
            onClick={doSave}
            style={{ ...ghostBtnStyle, opacity: imgUrl ? 1 : 0.5 }}
          >
            <Download size={14} strokeWidth={2.2} />
            保存图片
          </button>
          <button
            type="button"
            disabled={!imgUrl}
            onClick={() => setConfirmSwap(true)}
            style={{ ...ghostBtnStyle, opacity: imgUrl ? 1 : 0.5 }}
          >
            <RefreshCw size={14} strokeWidth={2.2} />
            换个码
          </button>
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <Check size={12} strokeWidth={2.4} color={T.ink3} />
        <span style={{ fontSize: 10.5, color: T.ink3, letterSpacing: ".04em" }}>
          这码用手机相机能扫出来；本 App 还没有真实支付，扫开只是这串编号
        </span>
      </div>
    </WalletSheet>
  );
}

/** 收款码面板上的小头像：有图显图，无图渐变底＋名字首字（跟别处同一套兜底）。 */
function PayCodeAvatar({ name, avatar, size }: { name: string; avatar: string; size: number }) {
  if (avatar) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flex: "none",
          boxShadow: "0 8px 18px -10px rgba(232,106,155,.7)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: AVATAR_GRADIENT,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: ".05em",
        boxShadow: "0 8px 18px -10px rgba(232,106,155,.85)",
      }}
    >
      {(name.trim() || "我").slice(0, 1)}
    </div>
  );
}

/* ── 样式 ── */

/** 码外面那圈白纸：留一圈白边，扫码更稳（相机要能看到码外的静默区）。
 *  1.4.48 起方角 ＋ 左缘粉条 ＋ 硬影，跟钱包那一族的纸块同料。 */
const codeBoxStyle: CSSProperties = {
  marginTop: 16,
  background: "#FFFFFF",
  borderRadius: 0,
  /* 不用 border 简写：跟 borderLeft 混用会触发 React 的样式冲突警告。 */
  borderTop: `1px solid ${T.line}`,
  borderRight: `1px solid ${T.line}`,
  borderBottom: `1px solid ${T.line}`,
  borderLeft: WALLET_PAPER_BAR,
  padding: 14,
  boxShadow: WALLET_PAPER_SHADOW,
  maxWidth: 280,
  marginLeft: "auto",
  marginRight: "auto",
};

const codeLoadingStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  color: T.ink3,
  letterSpacing: ".06em",
};

/** 「保存图片」「换个码」「再想想」——白底粉字方签，次要动作（跟卡详情那两颗一组）。 */
const ghostBtnStyle: CSSProperties = {
  flex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "12px 0",
  borderRadius: 0,
  border: `1px solid ${T.pink}`,
  background: "#FFFFFF",
  color: T.pink,
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 700,
  letterSpacing: ".14em",
  textIndent: ".14em",
  cursor: "pointer",
};
