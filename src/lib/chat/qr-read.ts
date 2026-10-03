"use client";

import jsQR from "jsqr";

/* =======================================================================
 * 图里那张码「装着什么」——本地读出来，不指望模型去扫（1.4.32）。
 *
 * 为什么非自己做不可：模型不是扫码器。它看图只能说出「黑白方块、三个角有定位框」，
 * 念不出码里的字。发给它的图要是不带一句「这是什么」，它要么答「我解不了码」，
 * 要么干脆现编一个——两种都难受。
 *
 * 加号面板里的「收款码」那条路知道码里是什么（现写现发），可**从相册挑图发出去的**
 * 什么都不带：那张图进了聊天就是一坨像素，没人知道里头是张收款码。
 * 所以这里替它把码读出来——解出来就写成一句话挂进 mediaNote（见 types/chat.ts），
 * 往后每一轮回喂都带着，TA 就一直记得这张图里装着什么。
 *
 * 纯本地、无网络：读不出来（没码、糊了）就回 undefined，当普通照片走，绝不挡发送。
 * ===================================================================== */

/** 解码前把图缩到的最长边。码本身信息量小，缩一缩又快又不吃内存；
 *  留 1600 是给「整张截图里那个小码」留余地——缩太狠，小码就糊成一片了。 */
const DECODE_MAX_EDGE = 1600;

/** 写进说明的文字上限，免得一条长链接把整句话撑成一大段。 */
const NOTE_TEXT_LIMIT = 120;

/** 把码里那段原文，翻成一句人话（TA 读的就是这一句）。 */
function toNote(payload: string): string | undefined {
  const text = payload.trim();
  if (!text) return undefined;

  /* 咱们自己的收款码（lib/settings/paycode.ts 生成的那种，装着 stellasei://pay?…）。
     拆成她和她 TA 都认得的那句话——跟加号面板发码时挂的说明是同一句。 */
  if (text.startsWith("stellasei://pay")) {
    const query = text.slice(text.indexOf("?") + 1);
    const params = new URLSearchParams(query);
    const code = params.get("code") ?? "";
    const name = params.get("name") ?? "";
    if (code || name) {
      return `我的收款码，码里装着：收款编号 ${code}、收款人「${name}」`;
    }
  }

  const clipped = text.length > NOTE_TEXT_LIMIT ? `${text.slice(0, NOTE_TEXT_LIMIT)}…` : text;
  if (/^https?:\/\//i.test(clipped)) return `这张图是个二维码，里面是一条链接：${clipped}`;
  return `这张图是个二维码，里面写着：${clipped}`;
}

/**
 * 把一张图里有没有二维码读出来，读到了就回一句「这颗码装着什么」；没有／读不出回 undefined。
 *
 * source 传得进 <img src> 的都行（objectURL、data URL）。整件事全在本地做：
 * 画进 canvas → 取像素 → jsQR 解 → 翻成人话。
 */
export async function readQrNote(source: string): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = source;
    });
    if (!img || !img.width || !img.height) return undefined;

    const longest = Math.max(img.width, img.height);
    const scale = longest > DECODE_MAX_EDGE ? DECODE_MAX_EDGE / longest : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    /* 先铺白底：透明区域在 canvas 里是黑的，黑底上的码解不出来。 */
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const pixels = ctx.getImageData(0, 0, w, h);
    /* attemptBoth：深色码／浅色码都试一遍（有人会把码做成反色的）。 */
    const found = jsQR(pixels.data, w, h, { inversionAttempts: "attemptBoth" });
    if (!found || !found.data) return undefined;
    return toNote(found.data);
  } catch {
    return undefined;
  }
}
