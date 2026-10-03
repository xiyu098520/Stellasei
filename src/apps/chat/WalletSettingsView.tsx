"use client";

/**
 * 星绥通讯：钱包设置（1.4.53 建，从「我的钱包」右上角那一颗「设置」进来）。
 *
 * 【为什么是一整页，不是弹窗】恩熙说设置别做成从底下滑上来的面板——以后要往里塞
 * 「亲属卡管理」「支付顺序」这些，弹窗那点地方不够用。所以这一页**跟钱包页平级**：
 * 页头也一个长相（近黑圆返回钮 ＋ 书写体标题 ＋ 底下一道粉横），正文是**分组列表**，
 * 分好组、一组里排若干「白纸一行」。往后加东西：找一组，往组里加一行即可。
 *
 * 【眼下里面只有一组一条】「支付」→「支付密码」：设／改六位数字，键盘面板见
 * `PayPasswordSheet`（设完是「旧的 → 新的 → 再输一遍」；没设过就直接输两遍新的）。
 * 设过之后聊天里转账、发红包前会先弹那个键盘；**没设过就不拦**。
 * 密码明文存在账本里（`wallet.ts` 的 `payPasswords`），**只是本机的一道门闩**，
 * 不做假的加密——这一点在页面上也照实写了一行给她看。
 *
 * 【皮】跟钱包页同一块料：公用的纸行、图标底、书写体、等宽都在 `WalletSheet` 里导出。
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { getPayPassword } from "@/lib/settings/wallet";
import PayPasswordSheet from "./PayPasswordSheet";
import { WALLET_ROW, WALLET_ROW_ICON, WALLET_TITLE } from "./WalletSheet";
import { EN, SANS, T } from "./shared";

export default function WalletSettingsView({
  ownerId,
  onBack,
  showToast,
}: {
  /** 谁的钱包：当前使用中面具的 id。 */
  ownerId: string;
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  /** 账本里现在那份支付密码：`null`＝还没读回来，空串＝没设过。 */
  const [payPwd, setPayPwd] = useState<string | null>(null);
  /** 支付密码面板开着没有。 */
  const [pwdOpen, setPwdOpen] = useState(false);

  const readPwd = useCallback(async () => {
    const pwd = await getPayPassword(ownerId);
    return pwd;
  }, [ownerId]);

  useEffect(() => {
    let alive = true;
    void readPwd().then((pwd) => {
      if (!alive) return;
      setPayPwd(pwd);
    });
    return () => {
      alive = false;
    };
  }, [readPwd]);

  const pwdNote =
    payPwd === null
      ? "转账、发红包前要输的六位"
      : payPwd
        ? "已经设好了，点这里改"
        : "还没设过；设了它，转账发红包前要输六位";

  return (
    <div style={rootStyle}>
      {/* ── 页头：跟钱包页一个长相，只是标题换成「钱包设置」 ── */}
      <div style={headerStyle}>
        <button type="button" aria-label="返回" onClick={onBack} style={backBtnStyle}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontFamily: WALLET_TITLE, fontSize: 20, fontWeight: 500 }}>
            钱包设置
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 30, height: 2, background: T.pink }} />
            <span style={{ fontFamily: EN, fontSize: 9.5, color: T.ink3, letterSpacing: ".3em" }}>
              settings
            </span>
          </span>
        </div>
      </div>

      <div style={scrollStyle}>
        {/* ── 组一：支付——「钱怎么花出去」有关的开关都归这一组 ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>支付</span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            payment
          </span>
        </div>

        <button
          type="button"
          className="pressable"
          onClick={() => setPwdOpen(true)}
          style={WALLET_ROW}
        >
          <span style={WALLET_ROW_ICON}>
            <Lock size={17} strokeWidth={2} />
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>支付密码</span>
            <span style={rowNoteStyle}>{pwdNote}</span>
          </span>
          <ChevronRight size={16} strokeWidth={2} color={T.ink3} />
        </button>

        {/* 实话实说：这六位挡的是什么、不挡什么，写在它自己那行下面 */}
        <div style={noteStyle}>
          这六位就存在这台手机上，管的是别手滑点错；真要防别人翻你手机，还得再单独做一层。
        </div>
      </div>

      {/* ── 支付密码（设／改）：键盘仍是弹的那张，摆在整页之上 ── */}
      {pwdOpen ? (
        <PayPasswordSheet
          ownerId={ownerId}
          mode="set"
          current={payPwd ?? ""}
          onClose={() => setPwdOpen(false)}
          onPassed={(pwd) => {
            setPwdOpen(false);
            setPayPwd(pwd);
            showToast(payPwd ? "支付密码改好了" : "支付密码设好了");
          }}
          showToast={showToast}
        />
      ) : null}
    </div>
  );
}

/* ── 样式（页头／页面底跟钱包页同一套，只是那边写在自己的文件里） ── */

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

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  margin: "24px 0 10px",
};

const rowNoteStyle: CSSProperties = {
  display: "block",
  marginTop: 3,
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".04em",
};

const noteStyle: CSSProperties = {
  marginTop: 10,
  paddingLeft: 2,
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".04em",
  lineHeight: 1.7,
};
