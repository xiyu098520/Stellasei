"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { RegexManager } from "@/components/phone/apps/RegexManager";
import {
  clampProactiveBaseMin,
  DEFAULT_CHAT_PREFS,
  getChatPrefs,
  saveChatPrefs,
  type ChatPrefs,
} from "@/lib/settings/chat";
import { EN, SANS, T } from "./shared";

/* =======================================================================
 * 聊天全局设定（从聊天通讯侧边栏进入）。
 *
 * 这里收的是**全局默认**——管所有角色、所有面具的那一层：
 *   · TA 主动找我：会不会来、多久来一次、深夜安不安静；
 *   · 对话：流畅模式、时间感知、显示思维链、正则规则、语音提示词。
 *
 * 三层关系：全局默认（本页）＜ 角色设置 ＜ 单个聊天。越细越优先，
 * **下面没单独设过的，就跟着上面走**。所以本页改的值会覆盖到所有
 * 「没单独设过」的聊天上。
 *
 * 整页沿用聊天板的 T 语言（透粉白底／纯白卡／亮粉／无衬线／大圆角＋浮影），
 * 页头＝「一行英文小字＋26/800 近黑大标题＋近黑圆返回钮」，跟单聊天设置同一套。
 * ===================================================================== */

/** 主动基础时间的显示文案：不足 1 小时说分钟，整点说小时，否则「X 小时 Y 分」。 */
function fmtGapMin(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 页头：一行英文小字起头，下面压一条 26/800 近黑大标题（跟单聊天设置同款）。 */
function PageHeader({ en, title, onBack }: { en: string; title: string; onBack: () => void }) {
  return (
    <header
      style={{
        position: "relative",
        flex: "none",
        padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="返回" className="cgs-soft" style={headerBtnStyle}>
          <ChevronLeft size={19} strokeWidth={2.2} />
        </button>
        <span
          style={{
            fontFamily: EN,
            fontSize: 9,
            letterSpacing: ".26em",
            color: T.ink3,
            textTransform: "uppercase",
          }}
        >
          {en}
        </span>
      </div>
      <h1
        style={{
          margin: "14px 0 0",
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "-.01em",
          lineHeight: 1,
          color: T.ink,
        }}
      >
        {title}
      </h1>
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          background:
            "linear-gradient(90deg, rgba(20,19,24,.04) 0%, rgba(232,106,155,.34) 50%, rgba(20,19,24,.04) 100%)",
          pointerEvents: "none",
        }}
      />
    </header>
  );
}

export default function ChatGlobalSettingsPanel({
  onBack,
  showToast,
}: {
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  const [prefs, setPrefs] = useState<ChatPrefs>(DEFAULT_CHAT_PREFS);
  const [sub, setSub] = useState<"main" | "regex" | "voice-prompt">("main");

  useEffect(() => {
    void getChatPrefs().then(setPrefs);
  }, []);

  /* 先动界面再落库：写失败也只是下次进来回到旧值，不至于点不动。 */
  const patch = (next: Partial<ChatPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...next }));
    void saveChatPrefs(next);
  };

  const toggleProactive = (next: boolean) => {
    patch({ proactiveOn: next });
    if (!next) showToast("已关掉主动找我（单个聊天可单独开回来）");
  };

  /* 流畅模式：当场给 <html> 挂／摘 `.smooth-mode`（样式见 globals.css），再落库。 */
  const toggleSmooth = (next: boolean) => {
    document.documentElement.classList.toggle("smooth-mode", next);
    patch({ smoothMode: next });
  };

  const stepProactiveBase = (delta: number) => {
    const step = prefs.proactiveBaseMin < 60 ? 15 : prefs.proactiveBaseMin < 240 ? 30 : 60;
    const next = clampProactiveBaseMin(prefs.proactiveBaseMin + delta * step);
    if (next === prefs.proactiveBaseMin) return;
    patch({ proactiveBaseMin: next });
  };

  /* 语音提示词正文：打字只更新界面，离开输入框（失焦）时才落库，免得每敲一下写一次库。 */
  const editVoiceText = (text: string) => setPrefs((p) => ({ ...p, voicePromptText: text }));
  const commitVoiceText = () => void saveChatPrefs({ voicePromptText: prefs.voicePromptText });

  /* 正则规则：组件自带页头与返回，直接挂壳。 */
  if (sub === "regex") {
    return <RegexManager onExit={() => setSub("main")} />;
  }

  if (sub === "voice-prompt") {
    return (
      <div style={pageStyle}>
        <style>{ANIM_CSS}</style>
        <PageHeader en="voice prompt" title="语音提示词" onBack={() => setSub("main")} />
        <div style={scrollStyle}>
          <p style={hintStyle}>
            这段话会跟着每次发给聊天模型的提示词一起送过去（关闭开关则不发送）。它只管〔语音〕里说的那些话怎么写，
            不改 TA 发不发语音、怎么标〔语音〕。离开输入框即自动保存。
          </p>
          <SettingRow
            title="启用语音提示词"
            desc="让 TA 按下面的规矩写〔语音〕里的话"
            right={<Switch on={prefs.voicePromptOn} onClick={() => patch({ voicePromptOn: !prefs.voicePromptOn })} />}
          />
          <textarea
            value={prefs.voicePromptText}
            onChange={(e) => editVoiceText(e.target.value)}
            onBlur={commitVoiceText}
            placeholder="写下你希望 TA 在〔语音〕里说的话照什么规矩写……"
            style={textareaStyle}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{ANIM_CSS}</style>
      <PageHeader en="global settings" title="聊天全局设定" onBack={onBack} />

      <div style={scrollStyle}>
        <GroupTitle title="TA 主动找我" en="proactive" />
        <p style={hintStyle}>
          全局默认。单个聊天里单独设过的那几项，以那一处为准；没设过的都跟着这里走。
        </p>
        <SettingRow
          title="主动找我"
          desc="TA 会自己来消息、发动态"
          right={<Switch on={prefs.proactiveOn} onClick={() => toggleProactive(!prefs.proactiveOn)} />}
        />
        {/* 主动是总闸：关着时下面这两行整行收起（只是不显示，调好的数还留着）。 */}
        {prefs.proactiveOn ? (
          <>
            <SettingRow
              title="基础时间"
              desc="大约每隔这么久来找你一次"
              right={<StepCount value={fmtGapMin(prefs.proactiveBaseMin)} onStep={stepProactiveBase} />}
            />
            <SettingRow
              title="深夜模式"
              desc="23:00 – 08:00 不打扰"
              right={<Switch on={prefs.proactiveQuiet} onClick={() => patch({ proactiveQuiet: !prefs.proactiveQuiet })} />}
            />
          </>
        ) : null}

        <GroupTitle title="对话" en="dialogue" />
        <SettingRow
          title="流畅模式"
          desc="手机发烫、点不动时打开，停掉动效与毛玻璃"
          right={<Switch on={prefs.smoothMode} onClick={() => toggleSmooth(!prefs.smoothMode)} />}
        />
        <SettingRow
          title="时间感知"
          desc="TA 知道此刻的真实时间"
          right={<Switch on={prefs.timeAware} onClick={() => patch({ timeAware: !prefs.timeAware })} />}
        />
        <SettingRow
          title="显示思维链"
          desc="思考型模型的思考过程可点开看"
          right={<Switch on={prefs.showReasoning} onClick={() => patch({ showReasoning: !prefs.showReasoning })} />}
        />
        <SettingRow title="正则规则" desc="自动查找替换，自己建" onClick={() => setSub("regex")} />
        <SettingRow title="语音提示词" desc="让 TA 按你的规矩写〔语音〕里的话" onClick={() => setSub("voice-prompt")} />
      </div>
    </div>
  );
}

/* ----------------------------- 样式 ----------------------------- */

const pageStyle: CSSProperties = {
  position: "relative",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: T.bg,
  fontFamily: SANS,
  color: T.ink,
  overflow: "hidden",
};

const scrollStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "6px 16px calc(var(--safe-area-bottom, 0px) + 28px)",
};

const headerBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#FFFFFF",
  background: T.ink,
  border: "none",
  boxShadow: "0 4px 12px -4px rgba(20,19,24,.5)",
  cursor: "pointer",
  flex: "none",
};

const hintStyle: CSSProperties = {
  margin: "0 10px 6px",
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".04em",
  lineHeight: 1.6,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 260,
  marginTop: 10,
  padding: 14,
  borderRadius: 16,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.ink,
  fontFamily: SANS,
  fontSize: 13,
  lineHeight: 1.7,
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
};

const stepBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: "1px solid rgba(232,106,155,.22)",
  background: "rgba(232,106,155,.08)",
  color: T.pink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flex: "none",
};

const ANIM_CSS = `
  .cgs-soft { transition: transform .16s ease, opacity .16s ease; }
  .cgs-soft:active { transform: scale(.93); opacity: .7; }
  .cgs-row { transition: background-color .16s ease; }
  .cgs-row:active { background: rgba(232,106,155,.1); }
  @media (prefers-reduced-motion: reduce) { .cgs-soft, .cgs-row { transition: none; } }
`;

/* --------------------- 本地零件 ---------------------
   跟 ChatSettingsPanel 末尾那几件同款（T 语言：亮粉、无衬线、大圆角）。
   不动 widgets.tsx 里那份（那份还带着「角色设置／通讯人」两个页面）。 */

/** 条数步进器（与单聊天设置同款手感）：− 数字 ＋。 */
function StepCount({ value, onStep }: { value: ReactNode; onStep: (delta: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button type="button" aria-label="减少" onClick={() => onStep(-1)} style={stepBtnStyle}>
        <Minus size={15} strokeWidth={2} />
      </button>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 13.5,
          color: T.ink,
          minWidth: 58,
          textAlign: "center",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <button type="button" aria-label="增加" onClick={() => onStep(1)} style={stepBtnStyle}>
        <Plus size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

/** 胶囊开关：开＝亮粉底，关＝近黑极淡底。 */
function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        width: 46,
        height: 27,
        borderRadius: 999,
        background: on ? T.pink : "rgba(20,19,24,.12)",
        position: "relative",
        transition: "background .2s",
        flex: "none",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: on ? 21 : 2,
          width: 23,
          height: 23,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 2px 5px rgba(20,19,24,.22)",
          transition: "left .2s",
        }}
      />
    </div>
  );
}

/** 分组名：英文小字起头、中文名压在下面。 */
function GroupTitle({ title, en }: { title: string; en: string }) {
  return (
    <div style={{ margin: "28px 0 8px" }}>
      <em
        style={{
          display: "block",
          fontFamily: EN,
          fontStyle: "normal",
          fontSize: 8.5,
          letterSpacing: ".26em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </em>
      <b
        style={{
          display: "block",
          marginTop: 6,
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: "-.01em",
          lineHeight: 1.1,
          color: T.ink,
        }}
      >
        {title}
      </b>
    </div>
  );
}

/** 设置行（标题＋描述＋右侧自定义／箭头）。 */
function SettingRow({
  title,
  desc,
  right,
  onClick,
}: {
  title: string;
  desc?: string;
  right?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={onClick ? "cgs-row" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 10px",
        borderRadius: 16,
        marginBottom: 2,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, letterSpacing: ".04em", fontWeight: 500, color: T.ink }}>{title}</div>
        {desc ? (
          <div
            style={{
              fontSize: 9.8,
              color: T.ink3,
              marginTop: 3,
              letterSpacing: ".04em",
              lineHeight: 1.45,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {desc}
          </div>
        ) : null}
      </div>
      {right ?? <ChevronRight size={15} strokeWidth={2} color={T.ink3} />}
    </div>
  );
}
