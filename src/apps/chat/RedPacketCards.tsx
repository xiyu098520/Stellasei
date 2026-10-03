"use client";

/**
 * 星绥通讯：红包封套的两张正脸。
 *
 * 【为什么单独一个文件】同一张脸要在两处摆：聊天里点开的红包那一页（ChatWindow）
 * 和发红包那页的「制作封面」试衣间（MoneySendView）。两边各描一遍迟早会走形，
 * 所以形状放这儿，两边都引它。
 *
 * 【两张脸】
 *  - `RedEnvelopeCard`：还没开的样子。上半是封面（自定义图原样铺，预设就是那张淡粉），
 *    封面底边在中间往下探出一条弧，底下那条带从弧的两侧包上来，弧的最低点上坐着金圆印「開」。
 *  - `RedOpenedCard`：开完的样子。同一块封面、同一条弧，弧下接一张白纸，纸上落金额。
 *
 * 【弧怎么画的】弧是**封面那块（照片）的底边**，不是底下那条带的上沿：
 * 它底边两角给 `borderBottomLeftRadius: "50% 44px"` 那种双半径，两个半椭圆把两角削圆、
 * 只剩中间往下探——看着就是一条**往下圆**的弧。
 * 它底下那块（带／白纸）是纯矩形，往上伸过弧，中间那截被照片盖住，于是只剩两侧露出来。
 * 两张卡共用同一条弧，换状态时形状不跳。
 *
 * 【卡根为什么垫白】预设封面自己带一点透明度（见 `redpacket.ts` 的预设表），
 * 垫一层白才不会透出夜底变脏——淡粉那层「透」是透给这层白的。
 *
 * 【封面留多高】`CUT_Y` 就是封面（自定义照片也一样）能占的高度，也是弧的最低点。
 * 自定义图是主角，宁肯它多露一点——往下压弧、把 `CARD_H` 跟着加高，别去削纸面。
 *
 * 【卡面上的字】两张脸的文字统一走 `SERIF`（1.9.78 起——「柔和野兽派」是衬线斜体）：
 *  封面那两行、「開」、弧下纸面的状态与落款，连「查看领取详情」；只有金额那串数字留等宽
 *  （数位对齐才齐整）。
 *  凡走 SERIF 的地方字重可以到 600。
 *
 * 【不许改】卡宽固定 250：聊天里开红包那一页按这个宽摆的，改宽要连那边一起看。
 */

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SERIF, T } from "./shared";
import { WALLET_MONO } from "./WalletSheet";
import { RED_COVER_TONE } from "./redpacket";

/** 红包图标（1.9.78）：一只竖封套，两弧交在正中一枚小圆上（那是封口）。
 *  聊天卡与发红包那页的小标共用这一枚，别再各画各的——此前是 lucide 的礼盒，
 *  恩熙：「那个红包的图标啊，你现在是个礼物啊，应该改成一个红包」。
 *  `color` 不传就随外面那层的 `color`（currentColor）。 */
export function RedPacketGlyph({
  size = 20,
  strokeWidth = 1.6,
  color,
}: {
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={color ? { color } : undefined}
    >
      <rect x="5" y="3" width="14" height="18" rx="4" />
      <path d="M5 8.6c1.5 3.1 3.2 5.4 5.1 5.4" />
      <path d="M19 8.6c-1.5 3.1-3.2 5.4-5.1 5.4" />
      <circle cx="12" cy="14" r="1.9" />
    </svg>
  );
}

/** 卡宽：两处都按这个宽摆。 */
export const RED_CARD_W = 250;
/** 卡高：两张脸一样高，换状态时不跳。 */
const CARD_H = 372;
/** 弧的深度：照片底边在中间比两边低这么多。浅了在淡粉封面上看不出是弧。 */
const ARC = 44;
/** 照片底边（＝那条弧的最低点）离卡顶多高。下面那块（带／白纸）都从它上面 ARC 处起。
 *  它同时也是封面能占的高度——自定义照片是主角，宁肯多露一点。 */
const CUT_Y = 236;
/** 「開」那枚金圆印的直径。 */
const SEAL = 84;
/** 「開」再往下挪一点：印心落在弧的最低点下方这么多，下半枚压得更实。 */
const SEAL_DROP = 8;
/** 「開」那枚印用的字（1.9.78 起跟封套正脸同一支衬线）。 */
const SEAL_FONT = SERIF;
/** 弧下那条带：**接住封面下段那个灰**（1.9.78 起预设有变，带也跟着走），
 *  往下走只稍微深一点。
 *  【为什么不再深一档】它跟封面是同一张纸的上下两半，颜色差多了看着就像两张纸拼的
 *  ——弧那儿会横出一道接缝。弧要显形另有办法：封面那块自己往下投一道柔影（见下面的 `COVER_LIP`）。 */
const BAND_BG =
  "linear-gradient(180deg, rgba(243,243,243,.96) 0%, rgba(240,240,240,.97) 60%, rgba(235,235,235,.98) 100%)";
/** 封面那块沿底边（＝那条弧）往下投的一道柔影：颜色拉平之后，全靠它把弧交代出来。
 *  跟着封面底边的双半径走，所以影子的形状就是那条弧；浅了弧就没了，重了像一道脏边。 */
const COVER_LIP = "0 7px 13px -8px rgba(0,0,0,.22)";
/** 白纸上的金额色（1.9.78 起跟「柔和野兽派」走墨色，不再是暖金）。 */
const AMOUNT_INK = RED_COVER_TONE.ink;

/** 预设封套上那道纸柔光（自定义照片不压——照片自己就有光影，再压一道只会脏）。 */
function SoftLight() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: RED_COVER_TONE.glow,
      }}
    />
  );
}

/** 还没开的红包：上面封面压两行字（谁发的、那句祝福），底下那条带从两侧包上来，
 *  弧的最低点上坐着一枚「開」。
 *  `onOpen` 不传就是一枚只看不动的印（试衣间里那些预览这样用）。
 *  `burst` 是开的那一下迸出来的金屑，挂在「開」的正中。 */
export function RedEnvelopeCard({
  coverBg,
  customSrc,
  senderLine,
  note,
  onOpen,
  opening = false,
  burst,
}: {
  /** 封面的底（渐层或 `url(...)`）。 */
  coverBg: string;
  /** 封面是自定义照片——是的话不压柔光。 */
  customSrc?: string;
  /** 封面上那行小字（「谁的红包」）。 */
  senderLine: string;
  /** 封面上那句祝福。 */
  note: string;
  onOpen?: () => void;
  /** 正在开：金圆印缩一档淡出去。 */
  opening?: boolean;
  burst?: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: RED_CARD_W,
        height: CARD_H,
        boxSizing: "border-box",
        borderRadius: 16,
        overflow: "hidden",
        background: "#FFFFFF",
        border: `2px solid ${RED_COVER_TONE.chipBorder}`,
        boxShadow: RED_COVER_TONE.shadow,
      }}
    >
      {/* 底下那条带：一条纯矩形，从弧的两侧一直包到底；中间那一截一会儿被照片盖掉 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: CUT_Y - ARC,
          bottom: 0,
          background: BAND_BG,
          boxShadow: "0 -8px 16px -10px rgba(0,0,0,.14)",
        }}
      />
      {/* 封面那块：底边两角被双半径削圆，只剩中间往下探——那条往下圆的弧就是它。
          它跟底下那条带颜色一样了，弧靠它自己底边的 `COVER_LIP` 那道柔影交代*/}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: CUT_Y,
          background: coverBg,
          borderBottomLeftRadius: `50% ${ARC}px`,
          borderBottomRightRadius: `50% ${ARC}px`,
          overflow: "hidden",
          boxShadow: COVER_LIP,
        }}
      >
        {!customSrc ? <SoftLight /> : null}
      </div>
      {/* 封面上那两行：上轻下重，跟封套上的压印一个口气 */}
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 0,
          right: 0,
          padding: "0 30px",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 11.5,
            fontWeight: 500,
            color: RED_COVER_TONE.inkSoft,
            letterSpacing: ".1em",
          }}
        >
          {senderLine}
        </div>
        <div
          style={{
            marginTop: 8,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1.5,
            color: RED_COVER_TONE.ink,
            letterSpacing: ".08em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {note}
        </div>
      </div>
      {/* 「開」：骑在那条弧的最低点上——上半落在照片里，下半落在底下的带上 */}
      <button
        type="button"
        onClick={onOpen}
        aria-label="拆开红包"
        style={{
          position: "absolute",
          left: "50%",
          top: CUT_Y - SEAL / 2 + SEAL_DROP,
          marginLeft: -SEAL / 2,
          zIndex: 3,
          width: SEAL,
          height: SEAL,
          padding: 0,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: RED_COVER_TONE.chipBg,
          border: `2px solid ${RED_COVER_TONE.chipBorder}`,
          color: RED_COVER_TONE.chipInk,
          fontFamily: SEAL_FONT,
          fontSize: 34,
          fontWeight: 600,
          lineHeight: 1,
          cursor: onOpen ? "pointer" : "default",
          boxShadow: RED_COVER_TONE.shadow,
          opacity: opening ? 0 : 1,
          transform: opening ? "scale(.72)" : "scale(1)",
          transition: "opacity .3s, transform .3s",
        }}
      >
        開
      </button>
      {burst ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: CUT_Y,
            width: 0,
            height: 0,
            zIndex: 4,
          }}
        >
          {burst}
        </div>
      ) : null}
    </div>
  );
}

/** 开完的红包：同一块封面，弧下接一张白纸——纸上是金额、状态、落款和「查看领取详情」。
 *  弧与没开那张同一条：照片底边在中间往下探，纸从两侧包上来。 */
export function RedOpenedCard({
  coverBg,
  customSrc,
  amount,
  statusLine,
  footLine,
  onDetail,
}: {
  coverBg: string;
  customSrc?: string;
  /** 金额（已格式化的小数串）。 */
  amount: string;
  /** 金额底下那行状态（「已存入我的零钱」这类）。 */
  statusLine: string;
  /** 再底下那行落款（时间 · 谁的红包）。 */
  footLine: string;
  onDetail?: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: RED_CARD_W,
        boxSizing: "border-box",
        borderRadius: 16,
        overflow: "hidden",
        background: "#FFFFFF",
        border: `2px solid ${RED_COVER_TONE.chipBorder}`,
        boxShadow: RED_COVER_TONE.shadow,
      }}
    >
      {/* 封面那块：与没开那张同一块封面、同一条往下圆的弧。
          它底边两角削圆后露出来的是卡自己的白底，那就是「纸」。 */}
      <div
        style={{
          position: "relative",
          height: CUT_Y,
          background: coverBg,
          borderBottomLeftRadius: `50% ${ARC}px`,
          borderBottomRightRadius: `50% ${ARC}px`,
          overflow: "hidden",
        }}
      >
        {!customSrc ? <SoftLight /> : null}
      </div>
      {/* 纸上的内容 */}
      <div
        style={{
          position: "relative",
          padding: "36px 20px 18px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span
            style={{
              fontFamily: WALLET_MONO,
              fontSize: 15,
              fontWeight: 500,
              color: AMOUNT_INK,
            }}
          >
            ¥
          </span>
          <span
            style={{
              fontFamily: WALLET_MONO,
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1,
              color: AMOUNT_INK,
              letterSpacing: "-.01em",
            }}
          >
            {amount}
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 13,
            color: RED_COVER_TONE.inkSoft,
            letterSpacing: ".04em",
          }}
        >
          {statusLine}
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 10.5,
            color: RED_COVER_TONE.inkSoft,
            letterSpacing: ".06em",
            opacity: 0.8,
          }}
        >
          {footLine}
        </div>
        {/* 纸上一道细线，线下是「查看领取详情」——微信那张卡也是这么收的 */}
        <div
          style={{
            width: "100%",
            height: 1,
            marginTop: 15,
            background: T.line,
          }}
        />
        <button
          type="button"
          onClick={onDetail}
          style={{
            marginTop: 13,
            padding: 0,
            background: "none",
            border: "none",
            cursor: onDetail ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            gap: 2,
            color: T.pink,
            fontSize: 13,
            letterSpacing: ".06em",
            fontFamily: SERIF,
            fontStyle: "italic",
          }}
        >
          查看领取详情
          <ChevronRight size={14} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
