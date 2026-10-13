"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type { ChatMessage, InnerSnapshot } from "@/types/chat";

/* =======================================================================
 * 私密心声（暗夜杂志版）。
 *
 * 点聊天里 TA 的头像进来，从底下抽上来一张深色纸：
 * 上半截是一整块封面（深紫渐变，出血），返回与「历史」嵌在封面题头那一行；
 * 竖排大标题立在封面右侧，三行简介压在封面左下；
 * 封面下方居中两个页签（私密心声／私藏），当前项用一枚小粉点标记。
 * 底下按栏目排：左边一条 3px 色边、中文竖签用这一格自己的色，右边英文小标＋正文。
 * 一深一浅一个重音——深紫封面＋深底 #0E0D11＋浅字 #FCF7F0，重音只有一支亮粉。
 *
 * 数据不编：账里只剩「心情」（snapshot.mood）、「欲望」（snapshot.desire）、
 * 「怯念」（snapshot.fear）三格，加上他自己的「心声」（innerVoice）；空着就写「还没记下」。
 * ===================================================================== */

/** 这一页的色板（局部常量，不动 shared.ts 的 T／C）。 */
const IV = {
  paper: "#0E0D11", // 纸：整页的深底
  paper2: "#151318", // 抽屉底：比纸再抬一档
  ink: "#FCF7F0", // 主文字
  ink2: "rgba(252,247,240,.62)", // 次级正文
  ink3: "rgba(252,247,240,.34)", // 淡：注脚、空态
  line: "rgba(252,247,240,.14)", // 细线、格线
  line2: "rgba(252,247,240,.26)", // 稍重的细边
  pink: "#E0417A", // 重音（亮粉）：小粉点、选中的那条竖杠
  bar: "rgba(252,247,240,.17)", // 封件上那三道涂黑条
} as const;

/** 一格一支色：竖签的字与那条 3px 色边都用它。色相往灰里收过一道，四支并排也不吵。 */
const TONE = {
  mood: "#E38BA6",
  inner: "#F07AA2",
  psyche: "#D4837A",
  fear: "#86AEC0",
} as const;

/** 宋体（自托管思源宋体）：这一页的骨——标题、页签、竖签、英文小标、脚注。 */
const FP = "'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', Georgia, serif";

/** 正文那一支（仿宋）：成句要读的字全归它。系统仿宋（iOS 自带，零下载、零闪）。 */
const FK = "'FangSong', 'STFangsong', 'Songti SC', Georgia, serif";

/** 英文衬线（Playfair）：数字、小标、时间与序号用它，自带真斜体面。 */
const FE = "var(--font-playfair), Georgia, 'Noto Serif SC', 'Songti SC', serif";

/** 虚文字（空态）：跟正文同一支仿宋，靠淡色跟实文字分开。 */
const VAGUE: React.CSSProperties = {
  fontFamily: FK,
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.9,
  color: IV.ink3,
};

/** 时间戳走系统格式，再按原来的样子拼（09.16 10:59）。 */
const STAMP_FMT = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 历史里的一条（＝聊天里某一轮 TA 留下的心声／快照）。 */
interface VoiceEntry {
  /** 就是那条消息的 id：历史里选中一条，看的是这一轮。 */
  id: string;
  createdAt: string;
  voice: string;
  snapshot: InnerSnapshot | undefined;
}

type TabKey = "now" | "box";

/** 两格页签，连封面那三行也钉在这儿——封面是跟着格走的，不另写一遍。 */
const TABS: {
  key: TabKey;
  label: string;
  kicker: string;
  title: string;
  sub: string[];
}[] = [
  {
    key: "now",
    label: "私密心声",
    kicker: "Private · Side",
    title: "私密心声",
    sub: ["此刻的他，", "和他没说出口的话。"],
  },
  {
    key: "box",
    label: "私藏",
    kicker: "Locked",
    title: "私藏",
    sub: ["他藏在心里", "最深处的秘密。"],
  },
];

const pad2 = (n: number) => n.toString().padStart(2, "0");

/** 快照头上的时间：09.16 10:59（数字交给系统格式化，不自己拼）。 */
function stampOf(iso: string): string {
  const p = STAMP_FMT.formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 从聊天记录里把带心声／快照的轮次挑出来，新的排前面。 */
function buildEntries(messages: ChatMessage[]): VoiceEntry[] {
  const out: VoiceEntry[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (!m.innerVoice && !m.innerSnapshot) continue;
    out.push({
      id: m.id,
      createdAt: m.createdAt,
      voice: m.innerVoice ?? "",
      snapshot: m.innerSnapshot,
    });
  }
  return out.reverse();
}

export default function InnerVoicePage({
  messages,
  onBack,
}: {
  charName: string;
  charAvatar: string;
  messages: ChatMessage[];
  onBack: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("now");
  /** 正在看的是哪一条。空＝看最新那条。 */
  const [pickedId, setPickedId] = useState<string | null>(null);

  /* Esc：抽屉开着先收抽屉，否则退回聊天（键盘用户的退路）。 */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (drawerOpen) setDrawerOpen(false);
      else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, onBack]);

  const entries = useMemo(() => buildEntries(messages), [messages]);
  const current = (pickedId ? entries.find((e) => e.id === pickedId) : undefined) ?? entries[0];
  const snap = current?.snapshot;
  /** 这一轮的心声（他心里的那句）。 */
  const voice = (current?.voice ?? "").trim();
  const meta = TABS.find((t) => t.key === tab) ?? TABS[0];
  const pageIndex = TABS.findIndex((t) => t.key === tab) + 1;

  const drawer = (
    <div style={{ position: "absolute", inset: 0, zIndex: 6 }}>
      <div
        onClick={() => setDrawerOpen(false)}
        style={{ position: "absolute", inset: 0, background: "rgba(6,5,8,.5)" }}
      />
      <aside
        className="iv2-slip"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "86%",
          maxWidth: 330,
          display: "flex",
          flexDirection: "column",
          background: IV.paper2,
          boxShadow: `-1px 0 0 ${IV.line2}`,
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "16px 18px 13px",
            borderBottom: `1px solid ${IV.line2}`,
          }}
        >
          <h2 style={{ margin: 0, fontFamily: FP, fontSize: 14.5, fontWeight: 500, letterSpacing: ".16em" }}>
            历史
          </h2>
          <span style={{ fontFamily: FP, fontSize: 10, fontWeight: 300, letterSpacing: ".14em", color: IV.ink3 }}>
            共 {pad2(entries.length)} 轮
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            style={{
              marginLeft: "auto",
              fontFamily: FP,
              fontSize: 10.5,
              letterSpacing: ".14em",
              color: IV.ink2,
              background: "transparent",
              border: `1px solid ${IV.line2}`,
              padding: "3px 8px 4px",
              cursor: "pointer",
            }}
          >
            收起
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 18px 22px" }}>
          <p className="iv2-txt" style={{ margin: 0, padding: "13px 0 11px", fontSize: 11, fontWeight: 400, lineHeight: 1.8, color: IV.ink3 }}>
            每一轮他留下的心声，都收在这一叠里。捡起哪一条，便回到哪一轮。
          </p>
          {entries.length === 0 ? (
            <div className="iv2-txt" style={{ padding: "18px 0", fontSize: 12, fontWeight: 400, color: IV.ink3 }}>
              还没有记下任何一轮。
            </div>
          ) : (
            entries.map((e, i) => {
              const on = e.id === current?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setPickedId(e.id);
                    setTab("now");
                    setDrawerOpen(false);
                  }}
                  className="iv2-hrow"
                  style={{
                    position: "relative",
                    display: "flex",
                    gap: 11,
                    width: "100%",
                    textAlign: "left",
                    fontFamily: FP,
                    border: 0,
                    borderTop: `1px dashed ${IV.line}`,
                    padding: "11px 0 11px 11px",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  {on ? (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 9,
                        bottom: 9,
                        width: 3,
                        background: IV.pink,
                      }}
                    />
                  ) : null}
                  <span
                    style={{
                      flex: "none",
                      fontFamily: FE,
                      fontStyle: "italic",
                      fontSize: 12,
                      fontWeight: 500,
                      paddingTop: 1,
                      color: on ? IV.pink : IV.ink3,
                    }}
                  >
                    {pad2(entries.length - i)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontFamily: FE,
                        fontStyle: "italic",
                        fontSize: 10.5,
                        letterSpacing: ".08em",
                        color: IV.ink3,
                        marginBottom: 4,
                      }}
                    >
                      {stampOf(e.createdAt)}
                    </span>
                    <span
                      className="iv2-txt"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        wordBreak: "break-word",
                        fontSize: 13,
                        lineHeight: 1.8,
                        color: on ? IV.ink : IV.ink2,
                      }}
                    >
                      {summaryOf(e)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );

  return (
    <>
      <style>{`
        /* 独立整页（1.9.56）：不再是「从底下抽上来的弹窗」——没有蒙层、没有拉手，
           从状态栏下缘一路铺到屏底，它是一页自己的界面（跟聊天设置页一个待遇）。
           上缘压到状态栏之下（钟点与电量照常看得见）；左右居中限宽，底边贴屏所以不描线。 */
        .iv2-card { position:absolute; z-index:93; left:0; right:0; bottom:0; max-width:430px; margin:0 auto;
          top:calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px));
          display:flex; flex-direction:column; overflow:hidden; background-color:${IV.paper};
          animation: iv2-page .34s cubic-bezier(.16,1,.3,1) backwards; }

        /* 封面：一整块出血的深紫渐变；返回与历史嵌在题头那一行。 */
        .iv2-cover { position:relative; height:330px; flex:none; overflow:hidden;
          background:linear-gradient(158deg,#2B2431 0%,#17151B 62%,#100F13 100%); border-bottom:1px solid ${IV.line2}; }
        .iv2-bignum { position:absolute; right:88px; top:-46px; font-family:${FE}; font-style:italic; font-weight:700;
          font-size:230px; line-height:1; letter-spacing:-.05em; color:rgba(252,247,240,.045); }
        .iv2-covbar { position:absolute; left:24px; right:24px; top:20px; display:flex; align-items:center; gap:13px; z-index:3; }
        .iv2-back { position:relative; width:28px; height:28px; margin-left:-6px; padding:0; flex:none;
          display:flex; align-items:center; justify-content:center; background:transparent; border:0;
          color:rgba(252,247,240,.62); cursor:pointer; }
        .iv2-back::after { content:""; position:absolute; inset:-8px; }
        .iv2-back:active { opacity:.5; }
        .iv2-kick { font-family:${FE}; font-size:10px; letter-spacing:.34em; color:rgba(252,247,240,.5);
          text-transform:uppercase; white-space:nowrap; }
        /* 「历史」是一枚空心小印（页签是字＋粉点，它是框），一眼看得出不是第四格页签。 */
        .iv2-hist { position:relative; font-family:${FP}; font-size:9.5px; letter-spacing:.16em;
          color:rgba(252,247,240,.5); background:transparent; border:1px solid rgba(252,247,240,.24);
          padding:3px 7px 4px; margin-left:auto; transform:rotate(-1.5deg); flex:none; cursor:pointer; }
        .iv2-hist::after { content:""; position:absolute; inset:-10px -8px; }
        .iv2-hist:active { background:rgba(252,247,240,.9); color:#141017; }
        .iv2-vtitle { position:absolute; right:32px; top:86px; margin:0; writing-mode:vertical-rl; text-orientation:upright;
          font-family:${FP}; font-weight:500; font-size:40px; letter-spacing:.32em; color:${IV.ink}; }
        .iv2-sub { position:absolute; left:28px; bottom:30px; margin:0; font-family:${FK}; font-size:14px;
          line-height:1.85; color:${IV.ink2}; letter-spacing:.08em; }
        .iv2-sub p { margin:0; }

        /* 三个页签：居中摆在封面下方，当前项用一枚小粉点标记。 */
        .iv2-tabs { flex:none; display:flex; align-items:center; justify-content:center; padding:22px 22px 0; }
        .iv2-tab { position:relative; font-family:${FP}; font-size:11.5px; letter-spacing:.2em;
          color:rgba(252,247,240,.3); background:transparent; border:0; padding:0 15px 0 13px;
          white-space:nowrap; cursor:pointer; }
        .iv2-tab::before { content:""; position:absolute; left:0; top:50%; width:3.5px; height:3.5px;
          margin-top:-2px; border-radius:50%; background:${IV.pink}; opacity:0; }
        .iv2-tab.on { color:rgba(252,247,240,.94); }
        .iv2-tab.on::before { opacity:.85; }
        .iv2-tab::after { content:""; position:absolute; inset:-10px -2px; }
        .iv2-tab:active { opacity:.6; }

        /* 纸身：栏目区可滚，纸脚钉在卡片底。 */
        .iv2-body { flex:1; min-height:0; display:flex; flex-direction:column; padding:0 26px 24px; }
        .iv2-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
        .iv2-bands { margin-top:28px; display:flex; flex-direction:column; gap:24px; }
        /* 一格：上一条细线收口，左边一条 3px 色边、中文竖签用这一格自己的色。 */
        .iv2-band { display:flex; gap:16px; padding-top:14px; border-top:1px solid ${IV.line}; }
        .iv2-rail { writing-mode:vertical-rl; text-orientation:upright; font-family:${FP}; font-size:12px;
          letter-spacing:.34em; color:var(--c); border-left:3px solid var(--c); padding-left:9px; line-height:1; flex:none; }
        .iv2-bt { flex:1; min-width:0; }
        .iv2-en { font-family:${FE}; font-size:9.5px; letter-spacing:.3em; color:${IV.ink3};
          text-transform:uppercase; display:block; margin-bottom:9px; }

        /* 纸脚：左边报一声这张纸是谁的，右边报这是第几页。 */
        .iv2-foot { margin-top:auto; padding-top:20px; display:flex; justify-content:space-between;
          align-items:flex-end; border-top:1px solid ${IV.line2}; }
        .iv2-sig { font-family:${FP}; font-size:9.5px; letter-spacing:.26em; color:${IV.ink3}; line-height:1.95; }
        .iv2-pg { font-family:${FE}; font-style:italic; font-size:48px; line-height:.82; color:${IV.ink}; }
        .iv2-pg i { font-style:italic; font-size:16px; color:${IV.ink3}; }
        .iv2-pg b { font-style:italic; font-weight:400; font-size:13px; color:${IV.ink3}; letter-spacing:.04em; }

        /* 正文那一支（朱雀仿宋）：成句要读的字全归它，并微微斜着。
           中文没有真斜体，oblique 6deg 是叫浏览器把字推歪；前一行的 italic 给老浏览器兜底。 */
        .iv2-sel { user-select:text; -webkit-user-select:text; }
        .iv2-txt { font-family:${FK}; font-style:italic; font-style:oblique 6deg; }

        /* 一格的正身：平时压成一行，点箭头摊开。（1.9.50 起那段字自己可点＝切中文，
           所以整行不再是一种指针——指针交给字与箭头各自管。） */
        .iv2-slot { display:flex; align-items:flex-start; gap:9px; width:100%; text-align:left;
          font-family:inherit; background:transparent; border:0; padding:0; color:inherit; }
        .iv2-slotchev { flex:none; margin-top:3px; padding:0; line-height:0; background:transparent;
          border:0; cursor:pointer; color:inherit; }
        .iv2-chev { flex:none; margin-top:3px; transition:transform .24s cubic-bezier(.16,1,.3,1); }
        .iv2-chev.on { transform:rotate(180deg); }

        .iv2-hrow { background:transparent; }
        .iv2-hrow:active { background:rgba(224,65,122,.08); }

        /* 封件：三道涂黑条盖住正文，底下一行小字提示按住解封。按住 620ms 才化开。 */
        .iv2-wax { display:flex; flex-direction:column; gap:10px; width:100%; background:transparent; border:0;
          padding:2px 0 4px; font-family:inherit; cursor:pointer; user-select:none; -webkit-user-select:none;
          touch-action:none; transition:opacity .16s ease; }
        .iv2-wax-bars { display:flex; flex-direction:column; gap:6px; }
        .iv2-wax-bars i { display:block; height:9px; background:${IV.bar}; }
        .iv2-wax-bars i:nth-child(1) { width:100%; }
        .iv2-wax-bars i:nth-child(2) { width:82%; }
        .iv2-wax-bars i:nth-child(3) { width:55%; }
        .iv2-wax-seal { display:flex; align-items:center; gap:8px; font-family:${FP}; font-size:9.5px;
          letter-spacing:.16em; color:${IV.ink3}; }
        .iv2-wax-seal i { width:5px; height:5px; border-radius:50%; background:${IV.pink}; opacity:.75; flex:none; }

        /* 独立页的入场：轻轻一浮（不是弹窗那种从底下抽上来）。 */
        @keyframes iv2-page { from { opacity:0; transform:translateY(14px) scale(.994); } to { opacity:1; transform:none; } }
        @keyframes iv2-rise { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }
        .iv2-rise { animation: iv2-rise .6s cubic-bezier(.16,1,.3,1) both; }
        @keyframes iv2-slip { from { transform:translateX(103%); } to { transform:none; } }
        .iv2-slip { animation: iv2-slip .44s cubic-bezier(.16,1,.3,1) both; }

        /* 键盘焦点：只在用键盘时描一圈粉边，点按不出现。 */
        .iv2-back:focus-visible, .iv2-tab:focus-visible, .iv2-hist:focus-visible,
        .iv2-hrow:focus-visible, .iv2-slotchev:focus-visible,
        .iv2-wax:focus-visible { outline:2px solid ${IV.pink}; outline-offset:2px; }
        @media (prefers-reduced-motion: reduce) { .iv2-rise, .iv2-slip, .iv2-page { animation:none; } .iv2-chev, .iv2-wax { transition:none; } }
      `}</style>

      <div className="iv2-card" style={{ fontFamily: FP, color: IV.ink }}>

        {/* 封面：返回在左、历史在右，都嵌在题头那一行；竖排大标题与三行简介压在封面上。 */}
        <div className="iv2-cover">
          <span className="iv2-bignum" aria-hidden>
            {pad2(pageIndex)}
          </span>
          <div className="iv2-covbar">
            <button type="button" onClick={onBack} aria-label="返回" className="iv2-back">
              <ChevronLeft size={19} strokeWidth={1.7} />
            </button>
            <span className="iv2-kick">{meta.kicker}</span>
            <button type="button" onClick={() => setDrawerOpen(true)} className="iv2-hist" aria-label="历史心声">
              历史
            </button>
          </div>
          <h1 className="iv2-vtitle">{meta.title}</h1>
          <div className="iv2-sub">
            {meta.sub.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>

        <nav className="iv2-tabs">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={on ? "iv2-tab on" : "iv2-tab"}
                aria-current={on ? "page" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="iv2-body">
          <div className="iv2-scroll">
            {/* key 跟着页签走：换一格时整块重挂一遍，各格的入场动画才会重新演一遍。 */}
            <div key={tab} className="iv2-bands">
              {tab === "now" ? (
                <>
                  <Band rail="心情" tone={TONE.mood} label="Mood">
                    <Slot text={snap?.mood} empty="这一轮还没记下他的心情。" />
                  </Band>

                  {/* 心声：最要紧的一块，但字号跟其余栏目一样——靠行高与缩进读成一封信，不靠字号压人。 */}
                  <Band rail="心声" tone={TONE.inner} label="Inner">
                    {voice ? (
                      <div
                        className="iv2-sel iv2-txt"
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          fontWeight: 400,
                          lineHeight: 1.95,
                          letterSpacing: ".03em",
                          textIndent: "2em",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: IV.ink2,
                        }}
                      >
                        {voice}
                      </div>
                    ) : (
                      <div className="iv2-txt" style={VAGUE}>
                        这一轮没留下心声。
                      </div>
                    )}
                  </Band>
                </>
              ) : (
                <>
                  <Band rail="欲望" tone={TONE.psyche} label="Psyche">
                    <Sealed text={snap?.desire} empty="他这一轮没说出口的那些念头，被他自己按住了，压在这一层底下。" />
                  </Band>

                  <Band rail="怯念" tone={TONE.fear} label="Fear">
                    <Sealed text={snap?.fear} empty="他还没肯承认自己在怕什么。" />
                  </Band>
                </>
              )}
            </div>
          </div>

          <Foot index={pageIndex} />
        </div>

        {drawerOpen ? drawer : null}
      </div>
    </>
  );
}

/* =======================================================================
 * 局部零件
 * ===================================================================== */

/** 历史一条的摘要：有心声就用心声，没有就直说。 */
function summaryOf(e: VoiceEntry): string {
  const voice = e.voice.trim();
  if (voice) return voice;
  return "（这一轮只留下几个数）";
}

/** 一格：上一条细线收口，左边一条 3px 色边、中文竖签用这一格自己的色，右边英文小标＋正文。 */
function Band({
  rail,
  tone,
  label,
  children,
  delay = 0,
}: {
  /** 竖签上那个中文词（英文小标是它的英文）。 */
  rail: string;
  /** 这一格的那支色。 */
  tone: string;
  label: string;
  children: React.ReactNode;
  /** 入场动画的先后（同一格里的第几块）。 */
  delay?: number;
}) {
  return (
    <section className="iv2-rise iv2-band" style={{ animationDelay: `${delay}ms`, ["--c"]: tone } as React.CSSProperties}>
      <span aria-hidden className="iv2-rail">
        {rail}
      </span>
      <div className="iv2-bt">
        <span className="iv2-en">{label}</span>
        {children}
      </div>
    </section>
  );
}

/** 一格的正身：平时只压成一行，右边一枚小箭头；点箭头整段摊开。
 *  外语聊天（1.9.50）起，那段字自己也可点——点字是**切中文／原文**，点箭头才是摊开／收起，
 *  两个触发区分开（原先整行一个按钮，两件事会打架）。 */
function Slot({ text, empty }: { text: string | undefined; empty: string }) {
  const [open, setOpen] = useState(false);
  const s = (text ?? "").trim();
  const bodyStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    lineHeight: 1.9,
    color: IV.ink2,
    wordBreak: "break-word",
    display: "-webkit-box",
    WebkitLineClamp: open ? 99 : 1,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
  if (!s) {
    return (
      <div className="iv2-txt" style={VAGUE}>
        {empty}
      </div>
    );
  }
  return (
    <div className="iv2-slot">
      <span
        className="iv2-sel iv2-txt"
        style={{ ...bodyStyle, cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        {s}
      </span>
      <button
        type="button"
        className="iv2-slotchev"
        aria-expanded={open}
        aria-label={open ? "收起" : "摊开"}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={14} strokeWidth={1.8} className={open ? "iv2-chev on" : "iv2-chev"} color={IV.ink3} />
      </button>
    </div>
  );
}

/** 纸脚：一条细线收住整页，左边报一声这张纸是谁的，右边报这是第几页。 */
function Foot({ index }: { index: number }) {
  return (
    <footer className="iv2-foot">
      <span className="iv2-sig">星绥通讯 · 私密心声</span>
      <span className="iv2-pg">
        <i>no.</i>
        {pad2(index)}
        <b> / {pad2(TABS.length)}</b>
      </span>
    </footer>
  );
}

/** 封件：按住不放整整 620 毫秒，涂黑条散开、底下的真话露出来。
 *  锁不是加密，是那一层意思——点一下不给，得看着它慢慢化开。 */
function Sealed({ text, empty }: { text: string | undefined; empty: string }) {
  const [open, setOpen] = useState(false);
  const [hold, setHold] = useState(false);
  const timer = useRef<number | null>(null);
  const s = (text ?? "").trim();

  const stop = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setHold(false);
  };
  const start = () => {
    if (timer.current !== null) return;
    setHold(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHold(false);
      setOpen(true);
    }, 620);
  };

  if (open) {
    return s ? (
      <div
        className="iv2-sel iv2-txt"
        style={{
          display: "block",
          fontSize: 13.5,
          fontWeight: 400,
          lineHeight: 1.95,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: IV.ink2,
        }}
      >
        {s}
      </div>
    ) : (
      <div className="iv2-sel iv2-txt" style={{ ...VAGUE, margin: 0 }}>
        {empty}
      </div>
    );
  }

  return (
    <div
      className="iv2-wax"
      role="button"
      tabIndex={0}
      aria-label="按住解封"
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      style={{ opacity: hold ? 0.55 : 1 }}
    >
      <span aria-hidden className="iv2-wax-bars">
        <i />
        <i />
        <i />
      </span>
      <div className="iv2-wax-seal">
        <i aria-hidden />
        按住解封 · 整整按住不放，才看得见
      </div>
    </div>
  );
}
