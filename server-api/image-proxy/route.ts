import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * 跨域图片代取：百炼等接口返回的是 OSS 远程链接，浏览器直接 fetch 会被 CORS 拦掉，
 * 于是改由服务端去取（服务端没有同源限制），前端拿到字节后就能存成文件。
 *
 * ⚠️ 这里不是 src/app 下的路由，Next 不会把它编进静态站点（GitHub Pages 无服务端）。
 *    它是给「将来挂到 Cloudflare Worker 当代理层」留的现成代码，别在本地 fetch 它。
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return new Response("缺少 url 参数", { status: 400 });

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return new Response("url 不合法", { status: 400 });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return new Response("只支持 http/https", { status: 400 });
  }
  /* 只放行公网地址：别让这个口子被拿来探测内网（SSRF）。 */
  const host = u.hostname;
  const isPrivate =
    /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|::1$|\[::1\])/.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  if (isPrivate) return new Response("不允许访问内网地址", { status: 403 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  /* 前端传「照片-时间.png」这样的文件名。只留文字与点，避免响应头被注入。 */
  const rawName = req.nextUrl.searchParams.get("name") ?? "";
  const safeName = rawName.replace(/[^\w.\-\u4e00-\u9fa5]/g, "").slice(0, 80) || "photo.png";
  try {
    const res = await fetch(u, { signal: controller.signal, cache: "no-store" });
    if (!res.ok || !res.body) return new Response(`取图失败（${res.status}）`, { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        "Cache-Control": "private, max-age=300",
        /* 手机端靠这个头才会真的「存下来」而不是在页面里打开预览。 */
        "Content-Disposition": `attachment; filename="photo.png"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      },
    });
  } catch {
    return new Response("取图超时", { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
