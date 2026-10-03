"use client";

/**
 * 收款码的「画」（1.4.24；1.4.49 起换成自绘款）。
 *
 * 账本里只存那串收款编号（见 `wallet.ts` 的 `getPayCode`），码图**每次现画**——
 * 图不进仓库、不进消息记录，改编号就等于改码，不用去清旧图。
 *
 * 画的是**真 QR**（qrcode 库只借它算格子，像素自己铺），手机相机扫得出来：
 * 扫开是一串 `stellasei://pay?...`。本 App 还没有真实支付，扫开不接任何流程，
 * 这串码的用处是：① 她存进相册、发给角色看；② 将来接「扫我的码付钱」时有据可依。
 *
 * 为什么不用库自带的 toDataURL：那样只能出「黑方块码」，太素。自绘这套是——
 * 码点＝**圆角方块**，一眼就认出是自家钱包的码。三条硬规矩都是实测出来的，别动：
 * 1. **三个定位图形（7×7 角）与所有校正图形（5×5）必须画实心方。**
 *    圆角会把它们碎掉，手机一歪就扫不出来——全圆角款实测直接解不出。
 * 2. **纠错要开到 H（不是 M）。** 这码在聊天里发出去时会过一道 JPEG 压缩，
 *    留满纠错才有余量（1024 ＋ JPEG 0.82 实测过）。
 * 校正图形按**结构**认（5×5 里「外圈黑、次圈白、中心黑」），不查版本表——
 * 免得为一张 ISO 坐标表做维护。
 *
 * ⚠️ **2026-09-22 恩熙定：正中央不许再画任何东西**——「我觉得中间有这个
 * 一个圆点不好看」。原来那枚白盘＋墨环＋粉芯的小章已撤，**别再加回来**。
 *
 * 宽度给到 1024：聊天里发出去时那张图会过一遍 1280／0.82 的压缩，
 * 码本来就比照片「怕糊」——画大一点，压完仍能扫（1024 ＋ JPEG 0.82 实测过）。
 */

import { create } from "qrcode";

/** 画多大（正方形边长，像素）。 */
const CODE_SIZE = 1024;
/** 静区（码外留白，单位＝格）。留 3 格，四周那圈白不能省。 */
const QUIET = 3;
/** 圆角方块的圆角半径 ÷ 一格边长。0.5 就是正圆，0.38 方中带圆。 */
const CORNER = 0.38;
/** 墨色（跟账册风同一个墨：#141318）。 */
const INK = "#141318";

/** 码里装的那串地址（自家协议；扫码只为读出编号与名字）。 */
export function payCodePayload(name: string, code: string): string {
  return `stellasei://pay?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`;
}

/**
 * 把收款码画成一张 PNG data URL；画不出来回 null（调用方照实说一声，不硬发一条空消息）。
 */
export async function renderPayCodeDataUrl(name: string, code: string): Promise<string | null> {
  try {
    const qr = create(payCodePayload(name, code), { errorCorrectionLevel: "H" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const scale = Math.floor(CODE_SIZE / (size + QUIET * 2));
    const px = scale * (size + QUIET * 2);

    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, px, px);

    const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && !!data[r * size + c];
    /** 定位图形：三个 7×7 角。 */
    const inFinder = (r: number, c: number) =>
      (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
    /** 校正图形：5×5 里「外圈全黑、次圈全白、中心黑」就是它（不查版本表）。 */
    const isAlignCenter = (r: number, c: number) => {
      if (r < 9 || c < 9) return false;
      if (r >= size - 9 && c < 9) return false;
      if (r < 9 && c >= size - 9) return false;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          if (dark(r + dr, c + dc) !== (ring !== 1)) return false;
        }
      }
      return true;
    };
    /* 把校正图形罩住的那 5×5 格先记下来，画的时候整片走实心。 */
    const solid = new Set<string>();
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (inFinder(r, c) || !isAlignCenter(r, c)) continue;
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) solid.add(`${r + dr},${c + dc}`);
        }
      }
    }

    const radius = scale * CORNER;
    ctx.fillStyle = INK;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!dark(r, c)) continue;
        const x = (c + QUIET) * scale;
        const y = (r + QUIET) * scale;
        /* 定位图形与校正图形一律实心方——圆角会把它们碎掉，扫不出来。 */
        if (inFinder(r, c) || solid.has(`${r},${c}`)) {
          ctx.fillRect(x, y, scale, scale);
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + scale, y, x + scale, y + scale, radius);
        ctx.arcTo(x + scale, y + scale, x, y + scale, radius);
        ctx.arcTo(x, y + scale, x, y, radius);
        ctx.arcTo(x, y, x + scale, y, radius);
        ctx.closePath();
        ctx.fill();
      }
    }

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
