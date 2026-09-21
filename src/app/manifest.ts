import type { MetadataRoute } from "next";
import { APP_VERSION } from "@/lib/version";

/**
 * PWA 资讯清单。一期先让「加到主画面」可用；
 * 二期接 Web Push 时，这里的 display/name 等设定会直接复用。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "星绥 · 星空传讯",
    short_name: "星绥",
    description: "跨越时空，与真实的他保持联系。",
    /* iOS 主屏幕 App 冷启动从快照复活、不重新加载页面，旧地址会被缓存钉死。
       v 直接取版本号（src/lib/version.ts）：那边一 +1，地址就变，缓存必然击穿——
       改版时不必再记得单独动这里。 */
    start_url: `/?v=${APP_VERSION}`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0a14",
    theme_color: "#0b0a14",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
