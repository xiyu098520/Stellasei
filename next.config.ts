import type { NextConfig } from "next";

/**
 * GitHub Pages 是「子路径」站点（https://<用户名>.github.io/Stellasei/），
 * 由 Actions 构建时注入 NEXT_PUBLIC_BASE_PATH="/Stellasei"；
 * 本地开发不设该变量，basePath 为空 → 依旧走 localhost:3000/，两边互不干扰。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // 纯静态导出：产物落在 out/，交给 GitHub Pages（无服务端）。
  output: "export",
  basePath,
  // 静态站没有服务端图片优化器，关掉（否则构建报错）。
  images: { unoptimized: true },
  // 每个路由导出成「目录/index.html」，子路径下刷新不会 404。
  trailingSlash: true,
  // 允许手机通过局域网 IP 访问开发服务器（Next 16 默认拦截非 localhost 的开发资源）。
  // ⚠️ 这里漏了当前 IP 的症状很容易误判成「页面能打开但点不动」：
  // HTML 是服务端渲染的，照样显示；真正被拦的是 JS 分片，于是永远不 hydrate，
  // 整页看着正常、却一个都点不动。电脑 IP 由路由器分配，变了就同步加进来。
  allowedDevOrigins: ["192.168.31.87", "192.168.1.2", "localhost:3000"],
  // headers() 与 output: "export"（GitHub Pages 构建）不兼容，只在本地保留：
  // 本地跑 HTTPS 时给 CA 证书发对 MIME，iOS 才会弹「安装描述文件」。
  ...(basePath
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/",
              headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
            },
            {
              source: "/stellasei-ca.crt",
              headers: [
                { key: "Content-Type", value: "application/x-x509-ca-cert" },
                { key: "Cache-Control", value: "no-store" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
