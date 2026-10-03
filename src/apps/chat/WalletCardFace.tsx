"use client";

/**
 * 银行卡卡面（1.4.18）。列表里用小号、卡详情里用大号，同一套配色。
 *
 * 三种内置卡面（玄夜／砚灰／月白）自己定色：页面是透粉白，卡就得是深色才立得住，
 * 银灰那张反过来用近黑字。卡面上那句英文是固定招牌（STELLASEI PAY），
 * 不跟用户填的卡名打架。卡面自带金额与尾号——列表里一眼就能看清哪张卡还有多少钱。
 *
 * 【皮】1.4.48 起跟着钱包全族走账册风：方角、硬边错位影、金额走等宽。
 * 【皮】1.4.49 起两件事：
 *  ① **可以用自己的图片当卡面**（`card.cardImage` 存的是图片仓库引用串）：
 *     有图就铺图＋压一层墨色渐层（不压字就看不清了），字一律转白并带一点投影；
 *     没图才走内置三档。
 *  ② 内置三档把细节做足——细斜纹底（质料感）、一道内框细线（账册里那种「框住」的收边）、
 *     右下角一枚金片（芯片）。装饰都压在内容层下面（zIndex 1），不挡字。
 *
 * 【2026-09-22 恩熙定】卡面**不带自家的印**——「星绥只是我们小手机的应用名称，
 * 不是每个都需要带标记的，因为有些人不喜欢这种带标记的」。原来右上角那枚
 * 粉墨小章「绥」已撤，**别再往卡面上盖任何带「绥」的字**。
 */

import type { CSSProperties } from "react";
import { useMediaSrc } from "@/lib/chat/media-asset";
import { formatYuan, type WalletCard, type WalletCardStyle } from "@/lib/settings/wallet";
import { WALLET_MONO, WALLET_PAPER_SHADOW, WALLET_TITLE } from "./WalletSheet";
import { EN, SANS } from "./shared";

interface FaceColors {
  bg: string;
  /** 主字（卡名、金额）。 */
  ink: string;
  /** 次字（尾号、招牌）。 */
  sub: string;
  /** 卡面自带的一圈描边，深色卡防止和页面糊在一起。 */
  border: string;
  /** 底纹与内框那道线的颜色（很淡，只在近处看得出）。 */
  hair: string;
}

const FACES: Record<WalletCardStyle, FaceColors> = {
  obsidian: {
    bg: "linear-gradient(135deg,#2B2831 0%,#16141A 58%,#241F2A 100%)",
    ink: "#F8F6F4",
    sub: "rgba(248,246,244,.6)",
    border: "rgba(255,255,255,.09)",
    hair: "rgba(255,255,255,.07)",
  },
  graphite: {
    bg: "linear-gradient(135deg,#575560 0%,#33313B 58%,#494751 100%)",
    ink: "#F8F6F4",
    sub: "rgba(248,246,244,.62)",
    border: "rgba(255,255,255,.12)",
    hair: "rgba(255,255,255,.1)",
  },
  silver: {
    bg: "linear-gradient(135deg,#F4F2EF 0%,#DAD6D1 56%,#EDEAE6 100%)",
    ink: "#26242B",
    sub: "rgba(38,36,43,.55)",
    border: "rgba(20,19,24,.08)",
    hair: "rgba(20,19,24,.07)",
  },
};

/** 三种卡面的中文小名 ＋ 挑卡面时用的小圆点色（编辑器里给恩熙挑的时候用）。
 *  ⚠️ 2026-09-22 恩熙定：原来那套「曜黑／石墨／银灰」**跟参考项目撞名了**，
 *  已换成自家这三个。改这里只改**显示名**，`WalletCardStyle` 的 key 不动
 *  （key 是落库的标识，改了等于要迁数据）。 */
export const CARD_STYLE_LABELS: { key: WalletCardStyle; label: string; dot: string }[] = [
  { key: "obsidian", label: "玄夜", dot: "#1D1A22" },
  { key: "graphite", label: "砚灰", dot: "#3E3C46" },
  { key: "silver", label: "月白", dot: "#E2DFDA" },
];

export default function WalletCardFace({
  card,
  size = "row",
}: {
  card: WalletCard;
  /** row＝列表小卡，large＝卡详情大卡。 */
  size?: "row" | "large";
}) {
  const large = size === "large";
  /* 自定义卡面图：引用串读成可用地址；没图（或还没读出来）就当内置卡面画 */
  const imageSrc = useMediaSrc(card.cardImage || undefined);
  const hasImage = !!card.cardImage && !!imageSrc;
  const face = FACES[card.cardStyle];
  const ink = hasImage ? "#F8F6F4" : face.ink;
  const sub = hasImage ? "rgba(248,246,244,.78)" : face.sub;
  /* 压在图上时字要一点投影，不然浅色照片上白字会飘 */
  const shade = hasImage ? "0 1px 6px rgba(10,9,12,.55)" : undefined;

  const wrap: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    borderRadius: 0,
    border: `1px solid ${hasImage ? "rgba(255,255,255,.18)" : face.border}`,
    background: hasImage ? "#141318" : face.bg,
    boxShadow: WALLET_PAPER_SHADOW,
    padding: large ? "16px 20px 18px" : "12px 14px 13px",
    minHeight: large ? 168 : undefined,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: large ? 18 : 8,
    fontFamily: SANS,
    color: ink,
  };
  /* 内容层：装饰全在它下面 */
  const layer: CSSProperties = { position: "relative", zIndex: 1 };
  /* 右下角那枚金片（芯片）：方角，两道细沟 */
  const chip: CSSProperties = {
    width: large ? 34 : 22,
    height: large ? 25 : 16,
    padding: "0 3px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-evenly",
    background: "linear-gradient(135deg,#F5E3B6 0%,#C9A455 52%,#F0DCA9 100%)",
    border: "1px solid rgba(20,19,24,.22)",
  };
  const chipLine: CSSProperties = { height: 1, background: "rgba(88,62,10,.4)" };

  return (
    <div style={wrap}>
      {hasImage ? (
        <>
          {/* 卡面图是存在本地图片仓库里的 blob 地址，next/image 接不了，就用 img */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          {/* 墨色渐层：上淡下重，字才压得住照片 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to top, rgba(10,9,12,.84) 0%, rgba(10,9,12,.34) 48%, rgba(10,9,12,.5) 100%)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        <>
          {/* 一道斜光，让深色卡面不至于像一块黑板 */}
          <div
            style={{
              position: "absolute",
              top: -46,
              right: -34,
              width: 170,
              height: 170,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,255,255,.17), transparent 68%)",
              pointerEvents: "none",
            }}
          />
          {/* 细斜纹：给卡面一点纸／布的质料感 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `repeating-linear-gradient(52deg, ${face.hair} 0 1px, transparent 1px 9px)`,
              pointerEvents: "none",
            }}
          />
          {/* 内框一道细线：账册里那种「框住」的收边 */}
          <div
            style={{
              position: "absolute",
              inset: large ? 6 : 5,
              border: `1px solid ${face.hair}`,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* 招牌那行：卡面上只留这一行英文（真卡上这个位置是发卡行／卡组织），
          **不带自家的印**——见文件头 2026-09-22 那条。 */}
      <span
        style={{
          ...layer,
          fontFamily: EN,
          fontSize: large ? 11 : 9,
          letterSpacing: ".26em",
          color: sub,
          textShadow: shade,
        }}
      >
        STELLASEI PAY
      </span>

      <div style={layer}>
        <div
          style={{
            fontFamily: WALLET_TITLE,
            fontSize: large ? 13.5 : 12,
            fontWeight: 500,
            letterSpacing: ".04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textShadow: shade,
          }}
        >
          {card.title}
        </div>
        <div
          style={{
            marginTop: large ? 10 : 5,
            fontFamily: WALLET_MONO,
            fontSize: large ? 32 : 19,
            fontWeight: 700,
            letterSpacing: "-.01em",
            fontVariantNumeric: "tabular-nums",
            textShadow: shade,
          }}
        >
          ¥{formatYuan(card.balance)}
        </div>
      </div>

      <div
        style={{
          ...layer,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: WALLET_MONO,
            fontSize: large ? 13 : 10.5,
            letterSpacing: ".16em",
            color: sub,
            fontVariantNumeric: "tabular-nums",
            textShadow: shade,
          }}
        >
          **** **** **** {card.tailNumber || "0000"}
        </span>
        {/* 铺了自家图的卡面就不挂金片了，别抢图 */}
        {hasImage ? null : (
          <div style={chip}>
            <div style={chipLine} />
            <div style={chipLine} />
          </div>
        )}
      </div>
    </div>
  );
}
