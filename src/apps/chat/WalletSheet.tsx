"use client";

/**
 * 钱包用的小面板壳（1.4.18）：底部滑出的白面板 ＋ 半透明遮罩。
 *
 * 钱包页里的「充值／转入钱包／提现到卡」「新增卡／编辑卡」「卡详情」
 * 都是这个壳——同一套纸面、同一套标题行，恩熙在哪儿操作都长一个样。
 * 面板挂在钱包页那一层（position:absolute），所以这里不写 fixed。
 *
 * 【纸】1.4.48 起钱这一族整体改成「账册」：方角纸面、顶上压一道粉线、
 * 标题用书写体、主按钮是墨色方签；页面底仍是聊天家族的透粉白，从聊天
 * 侧边栏进来不突兀。下面这几个导出的常量是全族的公用料（钱包页、卡面、
 * 收款码面板都引它们），以后要调只动这一处。
 */

import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import { SANS, T } from "./shared";

/** 标题书写体：京华老宋体（自托管，见 layout.tsx），系统宋体兜底。 */
export const WALLET_TITLE =
  "'KingHwa OldSong', 'Noto Serif SC', 'Kaiti SC', 'STKaiti', 'KaiTi', 'Songti SC', Georgia, serif";

/** 账目上的数字一律等宽（金额、尾号），像打上去的。 */
export const WALLET_MONO = "var(--font-mono), ui-monospace, Menlo, monospace";

/** 纸块的硬边错位投影：剪贴拼贴感，比柔和 shadow 更像印刷品。 */
export const WALLET_PAPER_SHADOW = "3px 3px 0 rgba(20,19,24,.06)";

/** 纸块左缘那道粉编目条：钱这一族每个白块都挂它，一眼认得出是同一本册子。 */
export const WALLET_PAPER_BAR = `4px solid ${T.pink}`;

export default function WalletSheet({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  /** 标题下一行小字（说明这个面板干什么）。 */
  hint?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div onClick={onClose} style={maskStyle} />
      <div style={sheetStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: WALLET_TITLE, fontSize: 17, fontWeight: 500, letterSpacing: ".02em" }}>
            {title}
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              color: T.ink3,
              cursor: "pointer",
              display: "flex",
            }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {hint ? (
          <div style={{ marginTop: 5, fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>{hint}</div>
        ) : null}
        <div style={{ marginTop: 16, overflowY: "auto", overscrollBehavior: "none" }}>{children}</div>
      </div>
    </>
  );
}

/** 面板里的主按钮（确认充值／保存）：墨色方签——全族唯一的实心钮。 */
export const WALLET_PRIMARY_BTN: CSSProperties = {
  width: "100%",
  marginTop: 20,
  padding: "14px 0",
  borderRadius: 0,
  border: "none",
  background: T.ink,
  color: "#FFFFFF",
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 600,
  letterSpacing: ".2em",
  /* 字距会在尾巴上多留一格，靠这点缩进把字重新摆回正中 */
  textIndent: ".2em",
  cursor: "pointer",
};

/** 面板里的金额输入（大号、只有一条下划线）。 */
export const WALLET_AMOUNT_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  borderBottom: `1.5px solid ${T.line}`,
  outline: "none",
  background: "transparent",
  fontFamily: WALLET_MONO,
  fontSize: 30,
  fontWeight: 700,
  color: T.ink,
  padding: "2px 0 6px",
};

/** 面板里的文字／数字输入（方角纸格，一格一线）。 */
export const WALLET_FIELD_INPUT: CSSProperties = {
  width: "100%",
  border: `1px solid ${T.line}`,
  outline: "none",
  background: "#FFFFFF",
  borderRadius: 0,
  padding: "11px 13px",
  fontFamily: SANS,
  fontSize: 14,
  fontWeight: 500,
  color: T.ink,
};

/** 面板里每个字段上方的小标签。 */
export const WALLET_FIELD_LABEL: CSSProperties = {
  display: "block",
  marginBottom: 7,
  fontSize: 11,
  color: T.ink3,
  letterSpacing: ".14em",
};

/** 页面上「白纸一行」的方签（收款码那一行、设置页里的条目都挂它）：
 *  方角、一圈细线、左缘一道粉编目条、底下压个硬影——跟余额卡同一页纸。
 *  1.4.53 从 `WalletView` 里提出来，钱包页与钱包设置页共用一块料。 */
export const WALLET_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  padding: "13px 14px",
  borderRadius: 0,
  /* 不用 border 简写：跟 borderLeft 混用会触发 React 的样式冲突警告。 */
  borderTop: `1px solid ${T.line}`,
  borderRight: `1px solid ${T.line}`,
  borderBottom: `1px solid ${T.line}`,
  borderLeft: WALLET_PAPER_BAR,
  background: "#FFFFFF",
  color: T.ink,
  fontFamily: SANS,
  boxShadow: WALLET_PAPER_SHADOW,
  cursor: "pointer",
};

/** 白纸一行左边那颗方角图标（淡粉底、粉笔画），跟全族的方角一路。 */
export const WALLET_ROW_ICON: CSSProperties = {
  flex: "none",
  width: 32,
  height: 32,
  borderRadius: 0,
  background: T.pinkSoft,
  color: T.pink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const maskStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20,19,24,.42)",
  zIndex: 120,
};

const sheetStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 130,
  maxHeight: "84%",
  display: "flex",
  flexDirection: "column",
  background: "#FFFFFF",
  /* 顶上那道粉线：面板像从下面抽上来的一页纸，不是一块圆角浮岛 */
  borderTop: `2px solid ${T.pink}`,
  padding: "18px 20px calc(var(--safe-area-bottom, 0px) + 22px)",
  boxShadow: "0 -16px 38px -30px rgba(20,19,24,.55)",
  fontFamily: SANS,
  color: T.ink,
};
