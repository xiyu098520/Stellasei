"use client";

import { useEffect, useState } from "react";
import {
  disposeMediaBlob,
  getCachedMediaBlob,
  getCachedMediaUrl,
  getMediaBlob,
  isMediaRef,
  primeEphemeralMedia,
  primeMediaCache,
  putMediaBlob,
  resolveMediaSrc,
} from "@/lib/db/media-store";

/* =======================================================================
 * 聊天图片的落库资产层：生成结果 → 压缩 → 进独立仓库 → 消息里只留引用串。
 *
 * 三条不能破的规矩：
 * 1. 绝不因为这一步出问题就把**几 MB 的原图**退回给会话记录——那份记录是「每次读列表
 *    都要整份读出」的，图住进去＝整个聊天都可能再也存不进去。仓库写不进去时退到
 *    「只活在内存里」的引用串（图这一趟照样看得见），宁可刷新后如实显示图已失。
 * 2. 远程链接必须当场抓下来存好：生图接口给的多半是带时效的 URL，过期就裂图。
 * 3. 压缩前先铺白底：带透明通道的图直接转 JPEG 会变黑块。
 * ===================================================================== */

/** 压到最长边 2048 / JPEG 0.9。
 *  为什么从 1280/0.82 放宽（1.12.36）：恩熙反馈「保存到本地之后有一点点模糊」。
 *  生图接口最高出到 2K（最长边 2048），旧参数先把图缩到 1280、再按 0.82 压，
 *  等于先掉一层分辨率、又掉一层细节；现在 2048 与原图 1:1 不缩，0.9 只做必要瘦身。
 *  「会话记录会膨胀」的顾虑够不着这一层——图住独立仓库，会话里只留一句引用串。 */
const IMAGE_MAX_EDGE = 2048;
const IMAGE_JPEG_QUALITY = 0.9;

/** 给模型「看」的那张小图：最长边 768 / JPEG 0.7。
    为什么另压一份、压得更狠：这一份只在「我发图的那一轮」随请求发出去，用完就丢；
    图是按**尺寸**算 token 的（不按字节），768 是折中——再小球就看不清截图里的字，
    再大纯属白花。 */
const VISION_MAX_EDGE = 768;
const VISION_JPEG_QUALITY = 0.7;

/** 把任意来源（data URL／http 链接／blob 地址）读成 Blob；读不到回 null。 */
async function sourceToBlob(source: string): Promise<Blob | null> {
  const res = await fetch(source);
  if (!res.ok) return null;
  return res.blob();
}

/** 缩到最长边上限并转成 JPEG；失败回 null（由调用方拿原图兜底）。 */
async function compressToJpeg(blob: Blob, maxEdge: number, quality: number): Promise<Blob | null> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = src;
    });
    if (!img) return null;
    const longest = Math.max(img.width, img.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    /* 先铺白底：透明区域转 JPEG 会变黑块。生成图白底完全可接受。 */
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((out) => resolve(out), "image/jpeg", quality),
    );
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** 落库结果。`persisted: false` ＝没写进仓库，这个引用只活在这一次会话的内存里。 */
export interface StoredImage {
  ref: string;
  previewUrl: string;
  persisted: boolean;
}

/**
 * 把生成结果落进独立仓库：压缩 → 存库 → 回传引用串，并把压好的图预热进缓存，
 * 让上屏那一刻直接命中、不闪。
 *
 * 仓库写不进去时**不退回原图**，改回一个只活在内存里的引用串（图这一趟照样看得见）：
 * 生成结果是几 MB 的 base64，退回原图＝把这几 MB 塞进「每次读列表都整份读出」的会话记录。
 * 连字节都读不出来（远程链接跨域等）时回 null，由调用方决定——但绝不往会话记录里塞大串。
 */
export async function persistImageAsset(source: string): Promise<StoredImage | null> {
  try {
    const raw = await sourceToBlob(source);
    if (!raw) return null;
    const compressed = (await compressToJpeg(raw, IMAGE_MAX_EDGE, IMAGE_JPEG_QUALITY)) ?? raw;
    try {
      const ref = await putMediaBlob(compressed, "image");
      return { ref, previewUrl: primeMediaCache(ref, compressed), persisted: true };
    } catch {
      return { ...primeEphemeralMedia(compressed), persisted: false };
    }
  } catch {
    return null;
  }
}

/**
 * 把**已经压好的**参考图存进仓库（这里不再压一次——参考图那边已经按 2200／JPEG 压过，
 * 再压一遍就是二次有损），会话里只留一句引用串。
 *
 * 为什么非搬不可：base64 长串若直接躺在会话记录里（charRefImage 字段），
 * 而会话记录是「每次读列表都整份读出」的那个键——一张截图级别的图就能让它膨胀几 MB。
 *
 * 任何失败都回 null，调用方退回原来的 data URL，图绝不会因为仓库的事而丢。
 */
export async function persistRefImage(
  dataUrl: string,
): Promise<{ ref: string; previewUrl: string } | null> {
  try {
    const blob = await sourceToBlob(dataUrl);
    if (!blob) return null;
    const ref = await putMediaBlob(blob, "image");
    return { ref, previewUrl: primeMediaCache(ref, blob) };
  } catch {
    return null;
  }
}

/**
 * 把仓库引用读回 data URL——生图接口只认 data URL（chatApi 直接从串里切 base64 送出去）。
 *
 * 老数据（本身就是 data URL 的那些）原样回传，调用方不必分新旧。
 * 读不回来回 undefined：调用方当「这次没有参考图」继续画，绝不因为这一步让整次生图失败
 * ——生图是按次扣钱的，不能为了省一张脸把钱烧在那儿。
 */
export async function mediaRefToDataUrl(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (!isMediaRef(value)) return value;
  try {
    const blob = getCachedMediaBlob(value) ?? (await getMediaBlob(value));
    if (!blob) return undefined;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取参考图失败"));
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * 把消息里那张图取出来、压成「给模型看」的小图，回一份 data URL；任何一步不成都回 undefined。
 *
 * 为什么要单独来这一份：模型真看见图，靠的是把图本体随那一次请求发出去。可是
 * ① 图是按尺寸算 token 的，每轮都重带＝把钱一轮一轮重烧一遍；
 * ② base64 若落到消息字段里，会把「每次读列表都整份读出」的会话记录撑爆。
 * 所以这一份**只在「我发图的那一轮」那一次请求上用**，用完即弃、不落库——
 * 仓库里照旧只存一份（上屏用的那张）。
 *
 * 回 undefined 时调用方原样走「（发来一张图片）」那条老路：压不出来／读不回来
 * 都只是「这一轮 TA 看不见图」，聊天不会因此断掉。
 */
export async function mediaRefToVisionDataUrl(
  value: string | undefined,
): Promise<string | undefined> {
  const full = await mediaRefToDataUrl(value);
  if (!full) return undefined;
  try {
    const raw = await sourceToBlob(full);
    if (!raw) return undefined;
    const small = await compressToJpeg(raw, VISION_MAX_EDGE, VISION_JPEG_QUALITY);
    if (!small) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(undefined);
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.readAsDataURL(small);
    });
  } catch {
    return undefined;
  }
}

/**
 * 丢掉一笔已经没人引用的图（删消息、重新生成把旧图顶掉时调用）。
 * 仓库与消息是分开存的，消息一删引用链就断了，不主动回收就成了只进不出的垃圾——
 * 这正是「存储早晚撑满」的来源。
 *
 * 传老数据（data URL／http 链接）什么也不做；清理失败也不抛错，绝不挡当前操作。
 */
export function releaseImageAsset(value: string | undefined): void {
  if (!isMediaRef(value)) return;
  void disposeMediaBlob(value as string).catch(() => {});
}

/**
 * 把消息里存的图片地址解析成能直接给 <img> 的地址。
 * 引用串 → 读仓库换临时地址（已在缓存里的同步命中，不会闪）；
 * 老数据（data URL／http 链接）原样回传，所以历史图片不用搬家。
 *
 * 回传值有三种，调用方要分清：
 * - `undefined`：还在解析（或本来就没地址）；
 * - `""`：解析完了，但仓库里找不到这笔（图确实没了）——该告诉用户图已失；
 * - 其他：能直接用的地址。
 */
export function useMediaSrc(value: string | undefined): string | undefined {
  /* 只有「要读仓库」才需要等，等回来的结果连它属于哪个地址一起记下来——
     地址换了就作废，免得旧图的地址串到新图上。 */
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null);

  /* 老数据原样用、缓存命中直接用：这两类在渲染时就能算出来，不必绕一圈 state。 */
  const sync = !value
    ? undefined
    : !isMediaRef(value)
      ? value
      : getCachedMediaUrl(value);

  useEffect(() => {
    if (!value || !isMediaRef(value) || getCachedMediaUrl(value)) return;
    let cancelled = false;
    void resolveMediaSrc(value)
      .then((url) => {
        if (!cancelled) setLoaded({ key: value, src: url });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: value, src: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (sync) return sync;
  return loaded && loaded.key === value ? loaded.src : undefined;
}

/**
 * data URL 同步转 Blob。必须同步——手机端保存要落在点击那一次手势里，
 * 不能走 fetch(dataUrl) 那种异步写法，否则手势过期，iOS 会拦掉。
 * 返回的 Blob 供两条路用：Web Share 的 File（系统分享面板）或 createObjectURL（下载兜底）。
 */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const head = /^data:([^;,]*)(;base64)?,/.exec(dataUrl);
  if (!head) return null;
  try {
    const body = dataUrl.slice(head[0].length);
    const bytes = head[2]
      ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    return new Blob([bytes], { type: head[1] || "image/png" });
  } catch {
    return null;
  }
}

/**
 * 把一张图交给系统去存（聊天里点大图的「保存图片」、朋友圈配图的「保存图片」共用这一支）。
 *
 * 手机上点「保存图片」要的就是**那个系统面板**（「存储图像」在里面）——一次到位，中间不再
 * 经过别的页面。这个面板只能靠 Web Share API 唤起，所以这里**不拿 `canShare` 先问一句**：
 * iOS 上有版本明明能分享文件，却把 canShare 答成「不行」，先问就把面板问没了，于是掉进下载兜底，
 * iOS 拿到 blob 不当下载、而是当文件打开一张「照片-xxx.png · 在"预览"中打开 · 更多…」的文件页
 * ——想存还得再按「更多」，她看到的就是这个。直接递上去最稳：成了就出面板，用户自己取消
 * （AbortError）就静默收场。
 *
 * 【1.4.28 找到的真根因】：`navigator.share` 是 Secure Context 特性（W3C 规范写死
 * `[SecureContext] share(...)`）——**只有 https／localhost 下这个属性才存在**。她走的是
 * http://192.168.1.2 的局域网地址，所以这个 API 根本不存在，代码必然掉进下载兜底＝那张文件页。
 * ⇒ 想一次到位出面板，就得让页面落在 https 上（部署到网上的 https 地址，或我这边给一个
 * https 入口）。在那之前先维持「至少能保存」：手机在 http 下也照旧走下载兜底那张文件页。
 *
 * 【1.4.25／1.4.26 两条弯路，都已撤】：1.4.25 改成「只提示长按图片」——按钮上写着保存、
 * 却让她换个手势，说不通；1.4.26 改成「另开一张全屏图」——她要的是面板，不是又一层页面。
 * 按钮上写着保存，就得在保存。
 *
 * 桌面（无触摸）不走面板：那儿 `share` 是分享给别的应用，不是「存到本机」，直接下载才对。
 *
 * 试过要回执、已撤：本想在面板关闭后用 await navigator.share 的结果
 * 提示「已保存到相册」，但 iOS 上 promise 不按规范 settle（点完存储图像既不 resolve 也不
 * reject），提示永不出现——只能维持静默。想要明确回执与「点一下就进相册」，只能等打包原生 App。
 *
 * knownBlob：媒体仓库那条路已经把图解好了，直接拿现成的（转成 data URL 再解一遍只会白白把
 * 用户手势耗掉）。没有才退回老办法自己解。notify 用来提示「已开始下载」。
 *
 * 故意做成同步函数：整个决定必须在用户点击的那一次手势里做完。
 */
export function saveImageToDevice(
  url: string,
  knownBlob?: Blob,
  notify?: (msg: string) => void,
): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const blob = knownBlob ?? (url.startsWith("data:") ? dataUrlToBlob(url) : null);
  /* 名字跟着实际类型走：过了仓库的图统一是 JPEG。 */
  const name = `照片-${stamp}.${blob?.type === "image/jpeg" ? "jpg" : "png"}`;

  /* 兜底：下载（桌面／安卓／不支持文件分享的浏览器／远程 URL）。data URL 就地转 blob 地址，
     远程图交给 /api/image-proxy 代取。 */
  const download = () => {
    const blobUrl = blob ? URL.createObjectURL(blob) : null;
    const a = document.createElement("a");
    a.href =
      blobUrl ??
      (url.startsWith("data:")
        ? url
        : `/api/image-proxy?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`);
    a.download = name;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    notify?.("已开始下载");
  };

  /* 触摸设备（手机／平板）＝要的是系统面板这条路。 */
  const touchDevice = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

  if (touchDevice && blob && typeof navigator.share === "function") {
    /* window.File：绕开类型环境的 File 构造签名冲突，运行时就是浏览器的 File。 */
    const file = new window.File([blob], name, { type: blob.type || "image/png" });
    void navigator.share({ files: [file] }).then(
      () => {},
      (err: unknown) => {
        /* 用户点了取消／划掉面板——这就是他的意思，别再自作主张去下载。 */
        if (err instanceof DOMException && err.name === "AbortError") return;
        notify?.("系统分享面板没起来，再点一次「保存图片」试试");
      },
    );
    return; // 面板自己就是反馈
  }

  /* 手机但拿不到 navigator.share＝页面不在安全上下文里（Web Share 是 [SecureContext] 特性，
     http:// 非 localhost 下压根不存在）。这里仍然走下载兜底：iOS 会把它当文件打开一张
     「照片-xxx.jpg · 在"预览"中打开」的文件页——虽然要多按一次「更多」，但至少存得下来。
     想要点一下就出系统面板，得把页面换成 https（部署或 https 入口）。 */
  download();
}

export { getCachedMediaBlob };
