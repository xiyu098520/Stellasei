"use client";

import { useEffect, useState } from "react";
import { AppChrome } from "@/components/phone/apps/AppChrome";
import { usePhone } from "@/context/PhoneContext";
import type { HomeLayoutMode } from "@/types/app";

/** HUD 那几行小字用的等宽字体（与记忆 App 同一条字体棧）。 */
const MONO = "var(--font-mono), ui-monospace, Menlo, monospace";

interface LayoutOption {
  mode: HomeLayoutMode;
  name: string;
  nameEn: string;
  description: string;
  /** 尚未实现的选项显示为打造中，不可选。 */
  disabled?: boolean;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  {
    mode: "grid",
    name: "经典网格",
    nameEn: "GRID",
    description: "iOS 经典图标排列，整齐清晰",
  },
  {
    mode: "magazine",
    name: "杂志排版",
    nameEn: "MAGAZINE",
    description: "你亲手设计的那张艺术主画面",
    disabled: true,
  },
];

/* ===== 以下是样板屋的假数据，只演给眼睛看，不落库 ===== */

interface SkinOption {
  id: string;
  name: string;
  nameEn: string;
  /** 迷你屏的两端底色——屏够深，主色才亮得起来。 */
  screen: [string, string];
  /** 这一身皮的主色：图标、圆点、进度条都由它上色。 */
  accent: string;
  /** 一行性格注脚。 */
  note: string;
}

const SKINS: SkinOption[] = [
  {
    id: "neon",
    name: "霓虹夜色",
    nameEn: "NEON",
    screen: ["#0b0918", "#221a49"],
    accent: "#8b76ff",
    note: "赛博 HUD 那一挂：冷光、描边、夜里发亮。",
  },
  {
    id: "dusk",
    name: "雾紫黄昏",
    nameEn: "DUSK",
    screen: ["#1b1430", "#3d2c63"],
    accent: "#c9a0d4",
    note: "柔光的紫，收得很轻，白天看也不刺眼。",
  },
  {
    id: "mist",
    name: "晨雾白",
    nameEn: "MIST",
    screen: ["#2b2b3a", "#5b5b72"],
    accent: "#e6e3f5",
    note: "素屏一身：不靠颜色，靠字与线说话。",
  },
  {
    id: "forest",
    name: "深林",
    nameEn: "FOREST",
    screen: ["#0c1a16", "#1d3b32"],
    accent: "#63c9a0",
    note: "青绿，安静，像窗外那片树影。",
  },
  {
    id: "rose",
    name: "落日锦",
    nameEn: "ROSE",
    screen: ["#2a1220", "#5c2340"],
    accent: "#ff9d7a",
    note: "暖橙，把黄昏留在屏幕上。",
  },
];

/** 迷你屏上的图标亮度（三列四行）：槽位固定、只换色，不做布局动画。 */
const SCREEN_GRID = [0.95, 0.45, 0.7, 0.35, 0.6, 0.9, 0.75, 0.3, 0.85, 0.5, 0.65, 0.4];

/** 迷你屏底部那排 dock 的亮度。 */
const SCREEN_DOCK = [0.9, 0.4, 0.65, 0.5];

interface DecorItem {
  name: string;
  done: boolean;
}

/** 妆点清单：前两项已经落地、后两项还在打造中——那排进度就是照着它算的。 */
const DECOR_ITEMS: DecorItem[] = [
  { name: "主题皮肤", done: true },
  { name: "主屏布局", done: true },
  { name: "桌布", done: false },
  { name: "字体", done: false },
];

/**
 * 美化 · 样板屋（「游戏感」样品）。
 *
 * 「游戏感」不是花纹，是三件小事，这一页三件都摆上：
 *   ① 按下去有反应——凡是能点的都挂 .pressable，手指按住它真的缩一下；
 *   ② 出来的东西有重量——换一身皮，迷你屏是「弹」出来的（beautify-pop 带一点过冲）；
 *   ③ 状态会动——底下那排妆点进度是一格格涨上去的（纯 transform: scaleX）。
 * 动的东西只有位移／缩放／透明度（合成器动画）：模糊、阴影动画、满屏粒子一个都没有，
 * 这是手机上唯一不烧电的一类动效（不能太烫）。
 *
 * 样板屋：皮肤与妆点清单都是假数据，选中只停在这一页的 useState 里，不会真的换掉手机
 * （具体功能先不做）。这一页唯一接真数据的，还是主屏幕布局那一项。
 */
export function BeautifyApp() {
  const { prefs, changeLayoutMode } = usePhone();
  const currentMode = prefs?.layoutMode ?? "grid";

  const [skinId, setSkinId] = useState(SKINS[0].id);
  const skin = SKINS.find((item) => item.id === skinId) ?? SKINS[0];

  /* 进度条要「涨」就得先落在 0：挂载后翻一次牌子即可——
     只改一次 state，不挂监听、不跑逐帧动画。 */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 90);
    return () => window.clearTimeout(timer);
  }, []);

  const doneCount = DECOR_ITEMS.filter((item) => item.done).length;

  return (
    <AppChrome title="美化" titleEn="BEAUTIFY">
      {/* ===== 预览台：这一页的「显示屏」，深浅对比就是游戏味的一半 ===== */}
      <section
        className="rounded-[22px] p-3.5"
        style={{ background: "linear-gradient(180deg,#1a1630,#0e0c18)" }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[8.5px] tracking-[0.3em] text-white/45"
            style={{ fontFamily: MONO }}
          >
            PREVIEW
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-[5px] w-[5px] rounded-full"
              style={{
                background: skin.accent,
                animation: "chat-pulse 1.6s ease-in-out infinite",
              }}
            />
            <span className="font-serif text-[8.5px] tracking-[0.24em] text-white/60">
              {skin.nameEn}
            </span>
          </span>
        </div>

        <div className="mt-3 flex items-start gap-3.5">
          {/* 迷你屏：key 一换整块重弹一次，换装因此有重量。 */}
          <div
            key={skin.id}
            className="animate-beautify-pop w-[104px] shrink-0 rounded-[14px] p-2"
            style={{
              background: `linear-gradient(165deg, ${skin.screen[0]}, ${skin.screen[1]})`,
            }}
          >
            <div className="grid grid-cols-3 gap-1.5">
              {SCREEN_GRID.map((alpha, i) => (
                <span
                  key={i}
                  className="aspect-square rounded-[6px]"
                  style={{ background: skin.accent, opacity: alpha }}
                />
              ))}
            </div>
            <div
              className="mt-2.5 flex gap-1.5 rounded-[8px] p-1"
              style={{ background: "rgba(255,255,255,0.10)" }}
            >
              {SCREEN_DOCK.map((alpha, i) => (
                <span
                  key={i}
                  className="h-3 flex-1 rounded-[3px]"
                  style={{ background: skin.accent, opacity: alpha }}
                />
              ))}
            </div>
          </div>

          {/* 右栏：这一身皮的名字、性格，和它自己的主色 */}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[15px] font-medium tracking-[0.06em] text-white/90">
              {skin.name}
            </p>
            <p
              className="mt-1 font-serif text-[8.5px] tracking-[0.3em]"
              style={{ color: skin.accent }}
            >
              {skin.nameEn}
            </p>
            <span
              className="mt-2.5 block h-[1.5px] w-7 rounded-full"
              style={{ background: skin.accent }}
            />
            <p className="mt-2.5 text-[11px] leading-relaxed text-white/50">{skin.note}</p>
          </div>
        </div>

        {/* 妆点进度：一格格涨上来（纯 scaleX，最便宜的那种「会动」） */}
        <div className="mt-4 flex items-center gap-3">
          <span className="shrink-0 font-serif text-[9px] tracking-[0.18em] text-white/45">
            妆点 {armed ? doneCount : 0}/{DECOR_ITEMS.length}
          </span>
          <div className="flex flex-1 gap-1.5">
            {DECOR_ITEMS.map((item, i) => (
              <span
                key={item.name}
                className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10"
              >
                <span
                  className="block h-full w-full origin-left rounded-full transition-transform duration-700 ease-out"
                  style={{
                    background: item.done ? skin.accent : "transparent",
                    transform: armed && item.done ? "scaleX(1)" : "scaleX(0)",
                    transitionDelay: `${i * 90}ms`,
                  }}
                />
              </span>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[9px] tracking-[0.06em] text-white/30">
          {DECOR_ITEMS.map((item) => item.name).join(" · ")}
        </p>
      </section>

      {/* ===== 妆扮：横滑挑一身皮 ===== */}
      <p className="mt-6 mb-2 px-1 text-[12px] text-[#8d86a6]">妆扮</p>
      <div className="cat-scroll -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {SKINS.map((item) => {
          const selected = item.id === skin.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSkinId(item.id)}
              className={`pressable w-[104px] shrink-0 rounded-2xl border p-2 text-left transition-colors ${
                selected ? "border-[#8b76d8] bg-[#f1ecfd]" : "border-[#e7e1f3] bg-white"
              }`}
            >
              <span
                className={`block h-[58px] rounded-xl border ${
                  selected ? "border-[#8b76d8]/50" : "border-transparent"
                }`}
                style={{
                  background: `linear-gradient(160deg, ${item.screen[0]}, ${item.screen[1]})`,
                }}
              />
              <span className="mt-2 flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-[#35304e]">{item.name}</span>
                <span
                  className="h-[6px] w-[6px] rounded-full"
                  style={{ background: item.accent }}
                />
              </span>
              <span className="mt-1 flex items-center justify-between">
                <span className="font-serif text-[8px] tracking-[0.18em] text-[#c3bcd8]">
                  {item.nameEn}
                </span>
                <span
                  className="block h-[2px] w-4 origin-left rounded-full bg-[#8b76d8] transition-transform duration-300 ease-out"
                  style={{ transform: selected ? "scaleX(1)" : "scaleX(0)" }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* ===== 主屏布局：这一页唯一接真数据的部分 ===== */}
      <p className="mt-6 mb-2 px-1 text-[12px] text-[#8d86a6]">主屏布局</p>
      <div className="grid grid-cols-2 gap-2.5">
        {LAYOUT_OPTIONS.map((option) => {
          const selected = currentMode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                if (!option.disabled) void changeLayoutMode(option.mode);
              }}
              className={`pressable relative overflow-hidden rounded-2xl border p-3 text-left transition-colors ${
                selected ? "border-[#8b76d8] bg-[#f1ecfd]" : "border-[#e7e1f3] bg-white"
              } ${option.disabled ? "opacity-60" : ""}`}
            >
              {option.mode === "grid" ? (
                <GridGlyph active={selected} />
              ) : (
                <MagazineGlyph active={selected} />
              )}
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-[#35304e]">{option.name}</span>
                {option.disabled ? (
                  <span className="rounded-full bg-[#efeaf8] px-1.5 py-[1px] text-[9px] tracking-wide text-[#9a92b5]">
                    打造中
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-[#8d86a6]">
                {option.description}
              </p>
              {selected ? (
                <span className="absolute inset-x-0 bottom-0 h-[2.5px] bg-[#8b76d8]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="mt-7 px-1 text-[11px] leading-relaxed text-[#b0a8cc]">
        样板：皮肤与妆点清单还是假的，选中只停在这一页，不会真的换掉手机；桌布与字体仍在打造中。
      </p>
    </AppChrome>
  );
}

/** 网格布局的小样：一枚九宫格。 */
function GridGlyph({ active }: { active: boolean }) {
  const fill = active ? "rgba(139,118,216,0.75)" : "rgba(139,118,216,0.30)";
  return (
    <div className="grid h-[42px] grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="rounded-[5px]" style={{ background: fill }} />
      ))}
    </div>
  );
}

/** 杂志布局的小样：一张大画面 ＋ 两条小的。 */
function MagazineGlyph({ active }: { active: boolean }) {
  const fill = active ? "rgba(139,118,216,0.75)" : "rgba(139,118,216,0.30)";
  return (
    <div className="flex h-[42px] gap-1.5">
      <span className="w-1/2 rounded-[5px]" style={{ background: fill }} />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="flex-1 rounded-[5px]" style={{ background: fill }} />
        <span className="flex-1 rounded-[5px]" style={{ background: fill }} />
      </span>
    </div>
  );
}
