import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许手机通过局域网 IP 访问开发服务器（Next 16 默认拦截非 localhost 的开发资源）。
  // 电脑 IP 由路由器分配，若日后变化需同步更新。
  allowedDevOrigins: ["192.168.1.2", "localhost:3000"],
  // 页面文档禁存副本：iOS 主屏幕 Web App 的缓存很顽固，no-cache 仍会留副本，
  // 改成 no-store 强制每次拿全新页面（否则改版后 PWA 可能一直跑旧代码）。
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        // 本地 CA 证书（手机装描述文件用）。必须是这个 MIME，iOS 才会弹「安装描述文件」，
        // 给成 octet-stream 只会下到「文件」App 里、装不了。
        source: "/stellasei-ca.crt",
        headers: [
          { key: "Content-Type", value: "application/x-x509-ca-cert" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
