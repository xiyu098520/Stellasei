import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
// 霞鹜文楷（自托管、按码点分块）：记忆 App 的标题字体，见文件内注释。
import "./lxgw-wenkai.css";
// 志莽行（同样自托管、按码点分块）：世界书牌面上书名那一版手写行书，见文件内注释。
import "./zhi-mang-xing.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 杂志刊头与英文小字用的高级感衬线。
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// 中文宋体（思源宋体）：档案深色保密页与杂志页的中文正文／标题。
const notoSerifSC = Noto_Serif_SC({
  variable: "--font-serif-sc",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "星绥 · 星空传讯",
  description: "跨越时空，与真实的他保持联系。",
  manifest: "/manifest.webmanifest",
  // iOS 添加到主屏幕后的行为：全屏无浏览器 UI；
  // black-translucent = 状态栏透明、页面延伸到整屏（顶部显示页面背景，系统时间电池白字叠加）。
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "星绥",
  },
};

export const viewport: Viewport = {
  // 与参考项目 ai-virtual-phone 完全一致（真机验证过能全屏）。
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fcfaff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${notoSerifSC.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
