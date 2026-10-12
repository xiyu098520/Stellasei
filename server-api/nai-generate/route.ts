import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync } from "node:zlib";

export const runtime = "nodejs";

/**
 * NovelAI 生图转发。
 *
 * 为什么要服务端中转，而不是浏览器直接打 NovelAI：
 *   ① 官方回的是 **zip 包**（里面是 image_0.png），浏览器端解包麻烦；
 *   ② 跨域预检在浏览器里通不通没保证，服务端没有同源限制。
 * 于是：前端只把参数交过来，这边拼 NovelAI 的请求体、发出去、把 zip 解开，
 * 回一个 data URL 给前端（前端照旧走 persistToLocal 那一套）。
 *
 * ⚠️ 请勿手设 Content-Type 为 multipart/form-data：NovelAI 的解析器会因此报
 *    「missing multipart boundary」，这里发的是 JSON，靠 fetch 自动带 header。
 *
 * ⚠️ 这里不是 src/app 下的路由，Next 不会把它编进静态站点（GitHub Pages 无服务端）。
 *    它是给「将来挂到 Cloudflare Worker 当代理层」留的现成代码（依赖 node:zlib，
 *    Worker 上要开 nodejs_compat），别在本地 fetch 它。
 */

/** 一个 NovelAI 请求需要的参数（前端从设置里凑齐后 POST 过来）。 */
interface NaiRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** 形如 "1024x1536"；auto／认不出的按竖版默认档。 */
  size?: string;
  /** 采样步数（1–50，默认 28）。 */
  steps?: number;
  /** 提示词引导强度（0–10，默认 5）。 */
  scale?: number;
  /** 采样器（不在白名单里的按默认 k_euler_ancestral）。 */
  sampler?: string;
  /** 随机种子（不传／不是正数＝每次随机）。 */
  seed?: number | null;
}

/** NovelAI 认的采样器（面板上的下拉就是从这份名单出的）。 */
const NAI_SAMPLERS = new Set([
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2m",
  "dpmpp_2m_sde",
  "k_dpmpp_sde",
  "ddim",
]);

/** 分辨率必须是 64 的倍数，否则 NovelAI 直接拒；认不出的档位给它竖版默认值。 */
function naiSize(size: string | undefined): { width: number; height: number } {
  const m = (size ?? "").match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  if (!m) return { width: 832, height: 1216 };
  const snap = (n: number) => Math.min(1536, Math.max(64, Math.round(n / 64) * 64));
  return { width: snap(Number(m[1])), height: snap(Number(m[2])) };
}

/**
 * 从 NovelAI 回的 zip 里掏出第一张 png。
 * 不引第三方解压库（项目里没有 JSZip）：自己按 zip 结构读中央目录 → 定位数据段
 * → stored 直接切、deflate 用 zlib 解。NovelAI 只回单张图，够用。
 */
function extractFirstPng(zip: Buffer): Buffer | null {
  /* zip 以「中央目录结束标记」收尾；注释最长 64KB，从尾部往前找它。 */
  let eocd = -1;
  const floor = Math.max(0, zip.length - 22 - 65535);
  for (let i = zip.length - 22; i >= floor; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && p + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);

    if (/\.png$/i.test(name) && localOff + 30 <= zip.length) {
      /* 本地文件头的文件名／扩展字段长度可能与中央目录不同，以本地头为准。 */
      const dataStart =
        localOff + 30 + zip.readUInt16LE(localOff + 26) + zip.readUInt16LE(localOff + 28);
      const raw = zip.subarray(dataStart, dataStart + compSize);
      try {
        return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      } catch {
        return null;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: NaiRequest;
  try {
    body = (await req.json()) as NaiRequest;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const base = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (body.apiKey ?? "").trim().replace(/^Bearer\s+/i, "");
  const prompt = (body.prompt ?? "").trim();
  if (!base) return NextResponse.json({ error: "缺少 Base URL" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "缺少 API Key（NovelAI 持久令牌 pst- 开头那串）" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "提示词是空的" }, { status: 400 });

  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return NextResponse.json({ error: "Base URL 不合法" }, { status: 400 });
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    return NextResponse.json({ error: "只支持 http/https" }, { status: 400 });
  }
  /* 与 /api/image-proxy 同一道口子：不放行内网地址（SSRF）。 */
  const host = origin.hostname;
  const isPrivate =
    /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|::1$|\[::1\])/.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  if (isPrivate) return NextResponse.json({ error: "不允许访问内网地址" }, { status: 403 });

  const { width, height } = naiSize(body.size);
  const steps = Math.min(50, Math.max(1, Math.round(body.steps ?? 28)));
  const scale = Math.min(10, Math.max(0, body.scale ?? 5));
  const sampler = NAI_SAMPLERS.has(body.sampler ?? "") ? (body.sampler as string) : "k_euler_ancestral";
  const negative = (body.negativePrompt ?? "").trim();
  /* 面板留空＝不传（或传了 0／NaN）＝每次随机；填了正整数就固定这一颗。 */
  const seed =
    typeof body.seed === "number" && Number.isFinite(body.seed) && body.seed > 0
      ? Math.floor(body.seed)
      : Math.floor(Math.random() * 4294967295);

  const url = base.endsWith("/ai/generate-image") ? base : `${base}/ai/generate-image`;
  /* NovelAI 的提示词要**塞三处**（顶层 input、parameters.prompt、v4_prompt.caption）：
     只写其中一处，新模型会当成空提示词；v4_prompt／v4_negative_prompt 少一个就 500。 */
  const payload = {
    input: prompt,
    model: body.model,
    action: "generate",
    parameters: {
      params_version: 4,
      width,
      height,
      scale,
      sampler,
      steps,
      seed,
      n_samples: 1,
      ucPreset: 3,
      qualityToggle: false,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: false,
      cfg_rescale: 0,
      noise_schedule: "karras",
      legacy_v3_extend: false,
      uncond_scale: 1,
      negative_prompt: negative,
      prompt,
      reference_image_multiple: [],
      reference_information_extracted_multiple: [],
      reference_strength_multiple: [],
      extra_noise_seed: seed,
      v4_prompt: {
        use_coords: false,
        use_order: false,
        caption: { base_caption: prompt, char_captions: [] },
      },
      v4_negative_prompt: {
        use_coords: false,
        use_order: false,
        caption: { base_caption: negative, char_captions: [] },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = text.replace(/\s+/g, " ").trim().slice(0, 200);
      return NextResponse.json(
        { error: detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const zip = Buffer.from(await res.arrayBuffer());
    const png = extractFirstPng(zip);
    if (!png) return NextResponse.json({ error: "NovelAI 回的包里没有图片" }, { status: 502 });
    return NextResponse.json({ image: `data:image/png;base64,${png.toString("base64")}` });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "NovelAI 等太久了（5 分钟没回图）" : "连不上 NovelAI" },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
