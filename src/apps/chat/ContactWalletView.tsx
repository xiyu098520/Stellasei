"use client";

/**
 * 星绥通讯：TA 的钱包（1.4.34 建；1.4.35 起由「查手机」App 进入——查手机 → 选一台手机
 * → 他的星绥通讯 → 钱包。**不再挂在通讯人的资料页上**：恩熙说他的钱包不该让我随手看见，
 * 得是我主动去查手机才翻得到的东西）。
 *
 * 【这一版做什么】把 TA 那本账**露出来**。账本早就有了（`WalletOwnerKind = "contact"`，
 * 一个角色一本），只是以前没有门——红包／转账那轮起，钱是真的从我这本划到 TA 那本，
 * 划过去了却看不见，那这本账就跟没有一样。
 *
 * 【为什么这一页比我那页短一截】TA 的钱包**只有零钱**：
 * 银行卡是「我的钱的源头」，一张卡跟着一个面具走（`WalletCard.ownerId` 是面具 id），
 * 收款码也一个面具一张（`payCodes`）——这两样对 TA 都没有意义。
 * 所以这里不给银行卡、不给收款码、也不给充值（我不能替 TA 凭空添钱），
 * 只有**余额 ＋ 收支明细**两样：钱从哪来、往哪去，一眼看清。
 * 样式跟「我的钱包」是同一套皮（透粉白底、账册方角纸块、墨色方返回钮，1.4.48 起），
 * 流水那一行直接借 `WalletView` 里的 `WalletEntryRow`——两页一个长相，不另起一套。
 *
 * 【这本账是谁在记】开户（1.4.36）之后，TA 那本账不再是只有我发钱才动：
 * 起手资金与历史流水是第一次翻他手机时按人设生成的（`lib/chat/contactAccount`），
 * 他自己也会在聊天里给我发红包／转账——钱是真从这本账划出去的。
 * 所以页脚反过来写：这本账是他的，里头是他自己的零钱与流水，不全是我的记录。
 */

import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";
import { formatYuan, getBalance, listEntries, type WalletEntry } from "@/lib/settings/wallet";
import { WalletEntryRow } from "./WalletView";
import { WALLET_MONO, WALLET_PAPER_BAR, WALLET_PAPER_SHADOW, WALLET_TITLE } from "./WalletSheet";
import { EN, SANS, T } from "./shared";

export default function ContactWalletView({
  ownerId,
  ownerName,
  onBack,
}: {
  /** 账本主人：角色的档案 id（TA 那本账）。 */
  ownerId: string;
  /** TA 的名字（余额卡上那句「谁的钱包」）。 */
  ownerName: string;
  onBack: () => void;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<WalletEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [list, bal] = await Promise.all([
        listEntries(ownerId, "contact"),
        getBalance(ownerId, "contact"),
      ]);
      if (!alive) return;
      setEntries(list);
      setBalance(bal);
    })();
    return () => {
      alive = false;
    };
  }, [ownerId]);

  const yuan = formatYuan(balance ?? 0);
  const [intPart, fracPart] = yuan.split(".");
  /** 还没把账读出来（第一次进来还在开户）：不写 0.00 冒充余额。 */
  const loading = balance === null;

  return (
    <div style={rootStyle}>
      {/* ── 页头：墨色方返回钮 ＋ 书写体标题（底下压一道粉横）＋ 右侧英文小字 ── */}
      <div style={headerStyle}>
        <button type="button" aria-label="返回" onClick={onBack} style={backBtnStyle}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              fontFamily: WALLET_TITLE,
              fontSize: 20,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {ownerName} 的钱包
          </span>
          <span style={{ width: 30, height: 2, background: T.pink }} />
        </div>
        <span style={{ fontFamily: EN, fontSize: 9.5, color: T.ink3, letterSpacing: ".3em" }}>
          wallet
        </span>
      </div>

      <div style={scrollStyle}>
        {/* ── 余额卡：跟我那页同一块，只是没有「充值」那颗 ── */}
        <div style={balanceCardStyle}>
          <span style={{ fontSize: 11, color: T.ink3, letterSpacing: ".18em" }}>余额</span>

          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 10 }}>
            <span style={{ fontSize: 17, color: T.ink2, fontWeight: 500 }}>¥</span>
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "-.01em",
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {loading ? "--" : intPart}
            </span>
            <span style={{ fontFamily: WALLET_MONO, fontSize: 22, fontWeight: 700, color: T.ink2 }}>
              .{loading ? "--" : fracPart}
            </span>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>
            {loading ? "正在对账……" : `${ownerName} 的零钱`}
          </div>
        </div>

        {/* ── 收支明细 ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>收支明细</span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            transactions
          </span>
        </div>

        {loading ? (
          <div style={emptyHintStyle}>正在对账……</div>
        ) : entries.length === 0 ? (
          <div style={emptyHintStyle}>还没有收支记录</div>
        ) : (
          <div>
            {entries.map((e) => (
              <WalletEntryRow key={e.id} entry={e} />
            ))}
          </div>
        )}

        {/* 页脚一句实话：这本账是他的——我发过去的钱只是其中几笔 */}
        <div style={footNoteStyle}>
          这是 TA 自己的零钱账：他每月的进项、日常的花销都在这里，我发给他的钱也记在这里。
        </div>
      </div>
    </div>
  );
}

/* ── 样式（跟「我的钱包」同一个调子）── */

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: T.bg,
  display: "flex",
  flexDirection: "column",
  fontFamily: SANS,
  color: T.ink,
  overflow: "hidden",
};

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
  /* 方角墨签：跟我那页同一块料 */
  borderRadius: 0,
  border: "none",
  background: T.ink,
  color: "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "4px 16px 30px",
};

const balanceCardStyle: CSSProperties = {
  background: "#FFFFFF",
  /* 不用 border 简写：跟 borderLeft 混用会触发 React 的样式冲突警告。 */
  borderTop: `1px solid ${T.line}`,
  borderRight: `1px solid ${T.line}`,
  borderBottom: `1px solid ${T.line}`,
  borderLeft: WALLET_PAPER_BAR,
  borderRadius: 0,
  boxShadow: WALLET_PAPER_SHADOW,
  padding: "18px 20px 16px",
};

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  margin: "24px 0 6px",
};

const emptyHintStyle: CSSProperties = {
  padding: "34px 0 8px",
  textAlign: "center",
  fontSize: 12,
  color: T.ink3,
  letterSpacing: ".06em",
};

const footNoteStyle: CSSProperties = {
  marginTop: 22,
  fontSize: 11,
  lineHeight: 1.8,
  color: T.ink3,
  letterSpacing: ".04em",
};
