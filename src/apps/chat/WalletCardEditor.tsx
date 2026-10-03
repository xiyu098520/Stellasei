"use client";

/**
 * 银行卡编辑器（1.4.18）：新增卡与编辑卡共用这一块面板。
 *
 * 上面一张**实时预览**的大卡面——改卡名、换卡面、填钱，卡面立刻跟着变，
 * 恩熙不用保存了才知道好不好看。
 * 编辑时，「卡内金额」填的是**绝对值**（直接改卡里有多少钱），
 * 差价走 adjustCardBalance 记一条「调整卡内金额」的流水，改动有据可查。
 *
 * 【皮】1.4.48 起跟钱包全族走账册风：纸面与按钮都不带圆角，卡面选择那三颗
 * 也改成方角方点（圆角只在聊天那一边用）。
 *
 * 【新增】1.4.49 起可以**用自己的图片当卡面**：选图 → 压到 1280／JPEG 0.82 →
 * 进图片仓库（跟聊天发图同一条路），卡里只留一句引用串。
 * 图片当场就落库（预览才看得见），所以「没保存就走人」的那些临时图要收尸——
 * 存在 tempRefs 里，保存成功就认领（清空），没保存就卸载时释放。
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  addCard,
  adjustCardBalance,
  formatYuan,
  parseYuanOrZero,
  randomTailNumber,
  updateCardInfo,
  type WalletCard,
  type WalletCardStyle,
} from "@/lib/settings/wallet";
import { persistImageAsset, releaseImageAsset } from "@/lib/chat/media-asset";
import WalletCardFace, { CARD_STYLE_LABELS } from "./WalletCardFace";
import { WALLET_FIELD_INPUT, WALLET_FIELD_LABEL, WALLET_PRIMARY_BTN } from "./WalletSheet";
import WalletSheet from "./WalletSheet";
import { SANS, T } from "./shared";

export default function WalletCardEditor({
  ownerId,
  card,
  onClose,
  onSaved,
  showToast,
}: {
  /** 新卡归谁（当前使用中面具）。 */
  ownerId: string;
  /** 传 null ＝ 新增；传卡 ＝ 编辑这张。 */
  card: WalletCard | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string) => void;
}) {
  const editing = card !== null;
  const [title, setTitle] = useState(card?.title ?? "储蓄卡");
  const [tail, setTail] = useState(card?.tailNumber ?? "");
  const [style, setStyle] = useState<WalletCardStyle>(card?.cardStyle ?? "obsidian");
  const [amountText, setAmountText] = useState(card ? formatYuan(card.balance) : "");
  const [busy, setBusy] = useState(false);
  /** 自定义卡面图（引用串；空串＝用内置卡面）。 */
  const [imageRef, setImageRef] = useState(card?.cardImage ?? "");
  const [busyImg, setBusyImg] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 这次面板里选出来、还没被保存认领的临时图（没保存就走了要释放掉）。 */
  const tempRefs = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const ref of tempRefs.current) releaseImageAsset(ref);
    },
    [],
  );

  /** 选一张图当卡面：压一版进图片仓库，卡里只留引用串。 */
  const onPickImage = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setBusyImg(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读不出来"));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const stored = await persistImageAsset(dataUrl);
      if (!stored) {
        showToast("这张图读不出来，换一张试试");
        return;
      }
      tempRefs.current.push(stored.ref);
      setImageRef(stored.ref);
      showToast("卡面换好了，记得按保存");
    } catch {
      showToast("这张图读不出来，换一张试试");
    } finally {
      setBusyImg(false);
    }
  };

  // 预览用的临时卡：钱读不出来就先按 0 显示，不打断操作
  const preview: WalletCard = {
    id: card?.id ?? "preview",
    ownerId,
    title: title.trim() || "储蓄卡",
    tailNumber: tail.trim() || "0000",
    cardStyle: style,
    cardImage: imageRef,
    balance: parseYuanOrZero(amountText) ?? 0,
    createdAt: card?.createdAt ?? "",
    updatedAt: card?.updatedAt ?? "",
  };

  const save = async () => {
    const cents = parseYuanOrZero(amountText);
    if (cents === null) {
      showToast("金额只能填数字，最多两位小数");
      return;
    }
    const tailNumber = tail.trim() || randomTailNumber();
    setBusy(true);
    try {
      if (card) {
        await updateCardInfo(card.id, { title, tailNumber, cardStyle: style, cardImage: imageRef });
        /* 换掉／去掉了原来那张图：旧图没人用了，收尸 */
        if (card.cardImage && card.cardImage !== imageRef) releaseImageAsset(card.cardImage);
        if (cents !== card.balance) {
          await adjustCardBalance(card.id, cents - card.balance, "调整卡内金额");
        }
      } else {
        await addCard(ownerId, {
          title,
          tailNumber,
          cardStyle: style,
          cardImage: imageRef,
          balance: cents,
        });
      }
      /* 这几张图已经跟着卡存下去了，不再算临时 */
      tempRefs.current = [];
      onSaved();
      onClose();
      showToast(card ? "这张卡改好了" : "卡开好了");
    } finally {
      setBusy(false);
    }
  };

  /* 次级按钮（选图／去掉图）：跟主按钮同一套账册皮，只是白底细边 */
  const ghostBtn: CSSProperties = {
    flex: 1,
    padding: "9px 0",
    borderRadius: 0,
    border: `1px solid ${T.line}`,
    background: "#FFFFFF",
    color: T.ink2,
    fontFamily: SANS,
    fontSize: 12.5,
    fontWeight: 600,
    letterSpacing: ".06em",
    cursor: "pointer",
  };

  return (
    <WalletSheet
      title={editing ? "编辑银行卡" : "添加银行卡"}
      hint={editing ? "改卡名、换卡面，也可以直接改卡里的钱" : "取个名字、挑个卡面，钱随时能改"}
      onClose={onClose}
    >
      <WalletCardFace card={preview} size="large" />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(ev) => void onPickImage(ev)}
      />

      <div style={{ marginTop: 18 }}>
        <span style={WALLET_FIELD_LABEL}>卡面</span>
        <div style={{ display: "flex", gap: 8 }}>
          {CARD_STYLE_LABELS.map((s) => {
            /* 用了自己的图，内置那三档就不算选中 */
            const on = s.key === style && !imageRef;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setStyle(s.key);
                  setImageRef("");
                }}
                style={{
                  flex: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "10px 0",
                  /* 1.4.48 起方角：钱这一族不带圆角 */
                  borderRadius: 0,
                  border: `1px solid ${on ? T.pink : T.line}`,
                  background: on ? T.pinkSoft : "#FFFFFF",
                  color: on ? T.pink : T.ink2,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: s.dot,
                    border: "1px solid rgba(20,19,24,.16)",
                  }}
                />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* 用自己的图当卡面：图当场落库，预览立刻看得见 */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            disabled={busyImg}
            onClick={() => fileRef.current?.click()}
            style={{ ...ghostBtn, opacity: busyImg ? 0.6 : 1, cursor: busyImg ? "default" : "pointer" }}
          >
            {busyImg ? "正在读图…" : imageRef ? "换一张图" : "用我的图片"}
          </button>
          {imageRef ? (
            <button
              type="button"
              onClick={() => setImageRef("")}
              style={{ ...ghostBtn, flex: "0 0 84px" }}
            >
              去掉图
            </button>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: SANS,
            fontSize: 11.5,
            color: T.ink2,
            opacity: 0.75,
            lineHeight: 1.6,
          }}
        >
          卡是横的，挑张横着的图更合适；字会压在图上，别挑太花的
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <span style={WALLET_FIELD_LABEL}>卡名</span>
        <input
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          placeholder="储蓄卡"
          style={WALLET_FIELD_INPUT}
        />
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={WALLET_FIELD_LABEL}>卡号后四位</span>
          <input
            value={tail}
            onChange={(ev) => setTail(ev.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="留空随机"
            style={{ ...WALLET_FIELD_INPUT, fontVariantNumeric: "tabular-nums", letterSpacing: ".1em" }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={WALLET_FIELD_LABEL}>{editing ? "卡内金额" : "卡内初始金额"}</span>
          <input
            value={amountText}
            onChange={(ev) => setAmountText(ev.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            style={{ ...WALLET_FIELD_INPUT, fontVariantNumeric: "tabular-nums" }}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        style={{ ...WALLET_PRIMARY_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {editing ? "保存" : "开卡"}
      </button>
    </WalletSheet>
  );
}
