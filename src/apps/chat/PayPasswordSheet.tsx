"use client";

/**
 * 支付密码键盘（1.4.51，恩熙要「转账也得输密码」那一种）。
 *
 * 一个面板管三件事，靠 `mode` 分：
 * - `verify`：输一遍，跟账本里那份对一下（转账、发红包、清密码都走这个）。
 * - `set`：设／改。**没设过**＝输两遍定下来；**已经设过**＝先输旧的、再输两遍新的。
 *
 * 【摆在哪】用的还是 `WalletSheet` 那层壳（方角纸面、顶上粉线、书写体标题），
 * 所以它跟钱包那本册子是一个长相。在聊天页调用时**排在支付面板后面渲染**，
 * 同一层 z-index 下后画的压在上面——不用另开一层。
 * 【为什么是自绘键盘】不要系统键盘：她按的是 6 位数字，自绘的才有那套
 * 「六个格子一格格点亮」的样子，也不会把手机键盘顶上来把面板挤歪。
 * 【密码存在哪】`wallet.ts` 的 `payPasswords`（一个面具一份，明文）。
 * 那本来就只是本机的门闩——整本账明文躺在 IndexedDB 里，这里不做假的加密。
 * 【输错了怎么办】六个格子转红、清空重来，不锁死（锁死的是真银行，不是我们小手机）。
 * 【支付方式摆这儿】（1.4.56，恩熙：「这个支付方式能不能到我输入密码那个页面呢？」）
 * 金额底下那一行写着她这笔从哪儿出（零钱／某张卡），**点它可以换**——一换整张面板
 * 就翻到那张列表上（不是再叠一层半屏：叠层会在小屏幕上把键盘挤歪），选一个又翻回来。
 * 翻回来时已经按下的数字还在，她输一半想换张卡不用重按。
 * 设置页那支（`WalletSettingsView`）不传 `methods`，那行就还是原来那行只读小字。
 *
 * 【套哪张纸】（1.9.90，恩熙：「红包里的输入密码、转账的输入密码，要跟现在的样式对齐」）
 * 从前它一律套 `WalletSheet`（白纸册子）。可聊天里转账／红包这一路——填钱（`MoneySendView`）
 * 到做封面（`CoverSheet`）——全是**墨底纸**（#1B161B＋网点＋顶上柔光、顶上两角圆、抓手）；
 * 钱填完一按，输密码那屏忽然翻成白册子，跟上下两屏不是一族，气就断了。
 * 现在按 `variant` 分：`chat`＝套聊天钱那一族的墨纸（聊天里调用时传），
 * `wallet`＝还是白册子（默认，钱包设置页照旧）。里头的格、键盘、支付方式那行都跟着纸色走。
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronRight, Delete, X } from "lucide-react";
import { formatYuan, setPayPassword } from "@/lib/settings/wallet";
import WalletSheet, { WALLET_MONO, WALLET_ROW, WALLET_TITLE } from "./WalletSheet";
import { SANS, T } from "./shared";

/** 键盘上的键：空串＝左下角那个空格（凑格子用的）。 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

const ERR_RED = "#D9534F";

/** 一格一格的等待感：让第 6 个点先画出来，再去比对。 */
const settle = () => new Promise<void>((r) => setTimeout(r, 150));

export default function PayPasswordSheet({
  ownerId,
  mode,
  current,
  amount,
  method,
  methodId,
  methods,
  onMethodPick,
  onClose,
  onPassed,
  showToast,
  variant = "wallet",
}: {
  /** 谁的钱包：当前使用中面具的 id。 */
  ownerId: string;
  mode: "verify" | "set";
  /** 账本里现在那份密码；空串＝还没设过。 */
  current: string;
  /** 面板顶上那个金额（`88.00`）。不传就不显示——单纯改密码时不需要它。 */
  amount?: string;
  /** 这笔钱从哪儿出，念出来的样子（「零钱」「招商银行储蓄卡 1234」）。1.4.55 加；不传就不显示。 */
  method?: string;
  /** 现在选中的是哪个（`"balance"` 或卡 id）——列表上那枚勾认它。1.4.56 加。 */
  methodId?: string;
  /** 能选的支付方式（零钱＋各张卡）；传了这一行就点得开。1.4.56 加。 */
  methods?: { id: string; name: string; note: string; cents: number | null }[];
  /** 换了支付方式：把选中的 id 交回去。1.4.56 加。 */
  onMethodPick?: (id: string) => void;
  onClose: () => void;
  /** `verify` 输对了／`set` 设好了，把定下来的密码交出去。 */
  onPassed: (pwd: string) => void;
  showToast: (msg: string) => void;
  /** 套哪张纸（1.9.90）：`wallet`＝钱包那本白册子（默认）；`chat`＝聊天钱那一族的墨底纸。 */
  variant?: "wallet" | "chat";
}) {
  /** 走到哪一步了。 */
  const [step, setStep] = useState<"verify" | "old" | "new" | "again">(
    mode === "verify" ? "verify" : current ? "old" : "new",
  );
  /** 已经按下的数字。 */
  const [digits, setDigits] = useState("");
  /** set 流程里第一遍输的那 6 位。 */
  const [first, setFirst] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 支付方式那张列表是不是翻开了（1.4.56）。 */
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 支付方式那一行点不点得开：给了能选的几项才点得开。 */
  const canPick = Boolean(methods?.length && onMethodPick);

  /* 套哪张纸（1.9.90）：聊天里那一路跟着墨底族走，钱包设置页还是白册子。 */
  const dark = variant === "chat";
  const Shell = dark ? ChatSheet : WalletSheet;
  const rowStyle = dark ? chatRowStyle : WALLET_ROW;
  const labelStyle = dark ? chatMethodLabelStyle : methodLabelStyle;
  const noteStyle = dark ? chatMethodNoteStyle : methodNoteStyle;
  const chevronColor = dark ? "rgba(255,253,248,.5)" : T.ink3;
  const faint = dark ? "rgba(255,253,248,.45)" : T.ink3;

  const fail = async (msg: string, reset?: () => void) => {
    await settle();
    setErr(true);
    setDigits("");
    showToast(msg);
    reset?.();
    /* 红一下就够了，别一直红着 */
    setTimeout(() => setErr(false), 620);
    setBusy(false);
  };

  /** 满 6 位就往这儿走。 */
  const submit = async (pwd: string) => {
    setBusy(true);
    if (step === "verify") {
      if (pwd === current) {
        onPassed(pwd);
        return;
      }
      await fail("密码不对，再试一次");
      return;
    }
    if (step === "old") {
      if (pwd === current) {
        await settle();
        setStep("new");
        setDigits("");
        setBusy(false);
        return;
      }
      await fail("现在的密码不对");
      return;
    }
    if (step === "new") {
      await settle();
      setFirst(pwd);
      setStep("again");
      setDigits("");
      setBusy(false);
      return;
    }
    /* again：两遍对上了才落库 */
    if (pwd === first) {
      try {
        await setPayPassword(ownerId, pwd);
      } catch {
        await fail("没存进去，再试一次");
        return;
      }
      onPassed(pwd);
      return;
    }
    await fail("两次不一样，重新设一遍", () => {
      setFirst("");
      setStep("new");
    });
  };

  const press = (key: string) => {
    if (busy || digits.length >= 6) return;
    const next = digits + key;
    setDigits(next);
    if (next.length === 6) void submit(next);
  };

  const back = () => {
    if (busy) return;
    setDigits((d) => d.slice(0, -1));
  };

  const title =
    step === "verify" || step === "old" ? "支付密码" : step === "new" ? "设置支付密码" : "再输一遍";
  const hint =
    step === "verify"
      ? "钱出去之前，先对上这六位"
      : step === "old"
        ? "先输你现在用的那六位"
        : step === "new"
          ? "定六位数字，往后转账、发红包都要输它"
          : "刚输的那六位，再对一遍";

  /* 翻到支付方式那张列表上（1.4.56）：同一个面板换个身子，不是再叠一层。
     挑完／按 × 都翻回键盘这面，`digits` 一路留着。 */
  if (pickerOpen && methods && methods.length > 0) {
    return (
      <Shell title="支付方式" hint="这笔钱从哪儿出去" onClose={() => setPickerOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              className="pressable"
              onClick={() => {
                onMethodPick?.(m.id);
                setPickerOpen(false);
              }}
              style={{ ...rowStyle, ...(m.id === methodId ? { borderColor: T.pink } : null) }}
            >
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                <span style={noteStyle}>{m.note}</span>
              </span>
              <span
                style={{
                  fontFamily: WALLET_MONO,
                  fontSize: 12.5,
                  color: dark ? "rgba(255,253,248,.45)" : T.ink2,
                }}
              >
                {m.cents === null ? "…" : `¥${formatYuan(m.cents)}`}
              </span>
              {m.id === methodId ? <Check size={16} strokeWidth={2.4} color={T.pink} /> : null}
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={title} hint={hint} onClose={onClose}>
      {amount ? (
        <div style={{ textAlign: "center", marginBottom: method ? 7 : 18 }}>
          <span style={{ fontFamily: WALLET_MONO, fontSize: 26, fontWeight: 700, letterSpacing: ".02em" }}>
            ¥ {amount}
          </span>
        </div>
      ) : null}

      {/* 这笔钱从哪儿出（1.4.55，1.4.56 起可点）：零钱还是哪张卡，输密码前先说清楚、也能当场换 */}
      {method ? (
        canPick ? (
          <button
            type="button"
            className="pressable"
            onClick={() => setPickerOpen(true)}
            style={dark ? chatMethodRowStyle : methodRowStyle}
          >
            <span style={labelStyle}>支付方式</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <span style={methodValueStyle}>{method}</span>
              <ChevronRight size={15} strokeWidth={2} color={chevronColor} />
            </span>
          </button>
        ) : (
          <div
            style={{
              textAlign: "center",
              marginBottom: 18,
              fontSize: 11,
              color: faint,
              letterSpacing: ".08em",
            }}
          >
            支付方式 · {method}
          </div>
        )
      ) : null}

      {/* ── 六个格子：按一位亮一个点 ── */}
      <div style={{ display: "flex", gap: 9, justifyContent: "center" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={cellStyle(err, dark)}>
            {i < digits.length ? <span style={dotStyle(err, dark)} /> : null}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 13,
          textAlign: "center",
          fontFamily: WALLET_TITLE,
          fontSize: 12.5,
          color: err ? ERR_RED : faint,
          letterSpacing: ".06em",
        }}
      >
        {err ? "不对，重新输" : "六位数字"}
      </div>

      {/* ── 自绘数字键盘：细格线拼出来的一张表，跟账册同一个笔调 ── */}
      <div style={dark ? chatPadStyle : padStyle}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <div key={i} style={dark ? chatPadBlankStyle : padBlankStyle} />
          ) : (
            <button
              key={i}
              type="button"
              className="pressable"
              disabled={busy}
              onClick={() => (k === "del" ? back() : press(k))}
              style={dark ? chatKeyStyle : keyStyle}
              aria-label={k === "del" ? "删一位" : k}
            >
              {k === "del" ? (
                <Delete size={19} strokeWidth={2} color={dark ? "rgba(255,253,248,.65)" : T.ink2} />
              ) : (
                k
              )}
            </button>
          ),
        )}
      </div>
    </Shell>
  );
}

/* ── 聊天里那一路的墨纸壳（1.9.90）：跟 `MoneySendView`／`CoverSheet` 同一张纸
   （#1B161B＋极淡网点＋顶上柔光、顶上两角圆、一根抓手、页头左题右「×」）——
   转账／红包从填钱一路到输密码，是一个长相。 ── */

const chatRootStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 130,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  fontFamily: SANS,
  color: "#FFFDF8",
  overflow: "hidden",
};

const chatScrimStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20,19,24,.44)",
};

const chatPaperStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxHeight: "94%",
  display: "flex",
  flexDirection: "column",
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  padding: "0 20px calc(var(--safe-area-bottom, 0px) + 20px)",
  boxShadow: "0 -18px 44px rgba(0,0,0,.5)",
  backgroundColor: "#1B161B",
  backgroundImage:
    "radial-gradient(circle, rgba(255,253,248,.05) 1px, transparent 1.2px), " +
    "radial-gradient(130% 90% at 50% 0%, rgba(255,253,248,.07) 0%, transparent 62%)",
  backgroundSize: "10px 10px, 100% 100%",
  backgroundPosition: "50% 50%, 0 0",
};

const chatGripStyle: CSSProperties = {
  width: 34,
  height: 3,
  borderRadius: 999,
  background: "rgba(255,253,248,.20)",
  margin: "8px auto 0",
};

const chatHeaderStyle: CSSProperties = {
  flexShrink: 0,
  paddingTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const chatHeaderTitleStyle: CSSProperties = {
  fontFamily: WALLET_TITLE,
  fontSize: 18,
  fontWeight: 500,
  letterSpacing: ".08em",
  color: "rgba(255,253,248,.88)",
};

const chatCloseBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: 0,
  border: "1.5px solid rgba(255,253,248,.5)",
  background: "transparent",
  color: "#FFFDF8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const chatHintStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: "rgba(255,253,248,.45)",
  letterSpacing: ".04em",
};

const chatScrollStyle: CSSProperties = {
  marginTop: 16,
  overflowY: "auto",
  overscrollBehavior: "none",
};

/** 墨纸壳：与聊天里钱这一族同一副页头页脚，只是里头装的是输密码那几样。 */
function ChatSheet({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={chatRootStyle}>
      <div style={chatScrimStyle} />
      <div style={chatPaperStyle}>
        <div style={chatGripStyle} />
        <div style={chatHeaderStyle}>
          <span style={chatHeaderTitleStyle}>{title}</span>
          <button type="button" aria-label="关闭" onClick={onClose} style={chatCloseBtnStyle}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        {hint ? <div style={chatHintStyle}>{hint}</div> : null}
        <div style={chatScrollStyle}>{children}</div>
      </div>
    </div>
  );
}

/* ── 样式 ── */

/** 支付方式那一行（1.4.56）：一张扁的白纸格，左边一个小标签、右边方式名＋箭头。 */
const methodRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  width: "100%",
  marginBottom: 18,
  padding: "10px 12px",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.ink,
  fontFamily: SANS,
  cursor: "pointer",
};

const methodLabelStyle: CSSProperties = {
  flex: "none",
  fontSize: 11,
  color: T.ink3,
  letterSpacing: ".14em",
};

const methodValueStyle: CSSProperties = {
  minWidth: 0,
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 列表里每行的小字（「尾号 1234」）。 */
const methodNoteStyle: CSSProperties = {
  display: "block",
  marginTop: 3,
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".04em",
};

const cellStyle = (err: boolean, dark = false): CSSProperties => ({
  width: 38,
  height: 46,
  borderRadius: 0,
  border: `1.5px solid ${err ? ERR_RED : dark ? "rgba(255,253,248,.16)" : T.line}`,
  background: dark ? "rgba(255,253,248,.05)" : "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "border-color .16s",
});

const dotStyle = (err: boolean, dark = false): CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: "50%",
  background: err ? ERR_RED : dark ? T.pink : T.ink,
  display: "block",
});

/** 键盘那张表：格子之间靠 1px 缝＋底色画出细格线（比给每格描边干净）。 */
const padStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 1,
  background: T.line,
  border: `1px solid ${T.line}`,
  borderRadius: 0,
  marginTop: 20,
  overflow: "hidden",
};

const keyStyle: CSSProperties = {
  height: 54,
  border: "none",
  borderRadius: 0,
  background: "#FFFFFF",
  color: T.ink,
  fontFamily: WALLET_MONO,
  fontSize: 21,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const padBlankStyle: CSSProperties = { background: "#FFFFFF", height: 54 };

/* ── 墨纸那一版的零件（1.9.90）：跟 `MoneySendView` 的暗槽／暗格一个笔调 ── */

/** 支付方式那一行（墨纸版）：一只陷进去的暗槽——浅边、微亮底。 */
const chatMethodRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  width: "100%",
  marginBottom: 18,
  padding: "10px 12px",
  borderRadius: 0,
  border: "1px solid rgba(255,253,248,.13)",
  background: "rgba(255,253,248,.06)",
  color: "#FFFDF8",
  fontFamily: SANS,
  cursor: "pointer",
};

const chatMethodLabelStyle: CSSProperties = {
  flex: "none",
  fontSize: 11,
  color: "rgba(255,253,248,.42)",
  letterSpacing: ".14em",
};

const chatMethodNoteStyle: CSSProperties = {
  display: "block",
  marginTop: 3,
  fontSize: 10.5,
  color: "rgba(255,253,248,.45)",
  letterSpacing: ".04em",
};

/** 支付方式列表里的一行（墨纸版）：暗格＋左缘粉条，跟白色那一版同构。 */
const chatRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  padding: "13px 14px",
  borderRadius: 0,
  borderTop: "1px solid rgba(255,253,248,.13)",
  borderRight: "1px solid rgba(255,253,248,.13)",
  borderBottom: "1px solid rgba(255,253,248,.13)",
  borderLeft: `4px solid ${T.pink}`,
  background: "rgba(255,253,248,.06)",
  color: "#FFFDF8",
  fontFamily: SANS,
  cursor: "pointer",
};

/** 墨纸上的键盘：细格线拼表，键面比纸略亮一档，白字。 */
const chatPadStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 1,
  background: "rgba(255,253,248,.14)",
  border: "1px solid rgba(255,253,248,.14)",
  borderRadius: 0,
  marginTop: 20,
  overflow: "hidden",
};

const chatKeyStyle: CSSProperties = {
  height: 54,
  border: "none",
  borderRadius: 0,
  background: "#211B21",
  color: "#FFFDF8",
  fontFamily: WALLET_MONO,
  fontSize: 21,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const chatPadBlankStyle: CSSProperties = { background: "#211B21", height: 54 };
