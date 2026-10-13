import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
// 中文「思源宋体」现自托管在 public/fonts/siyuan/（unicode-range 101 片 +
// font-display:block），并在此预载最常用的几片——开屏（SplashScreen）本就会等
// document.fonts.ready，故不再有换装闪。@font-face 由 siyuan-font.ts 按 basePath
// 拼好路径后内联进 <head>（Next 不会给 CSS 里 url() 的绝对路径补 basePath）。
// Playfair 只用于拉丁字母，体积小，仍由 next/font 自托管。
import "./globals.css";
import { siyuanFontCss } from "./siyuan-font";

/* GitHub Pages 是子路径站点（构建时注入 NEXT_PUBLIC_BASE_PATH="/Stellasei"），
   字体文件的绝对地址得带上 basePath；本地开发该变量为空。 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/* 预载首批「界面基础文字」子集三片（ui-0/1/2，family 'Noto Serif SC UI'）：
   开屏那 2.8s 内把它们抢下来，界面文案即可用思源宋体即刻上屏、不留空窗。
   其余整量分片（000–100）由后台预取模块在进 App 后静默补齐（见 lib/font-prefetch.ts），
   不在此预载，省首屏流量。 */
const FONT_PRELOAD = ["ui-0", "ui-1", "ui-2"];

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
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      {/* 思源宋体 @font-face：服务端按 basePath 生成后内联（见 siyuan-font.ts）。
          带 precedence 让 React 把它提进 <head>，随首屏样式一起就位，避免换装闪。 */}
      <style
        href="siyuan-font"
        precedence="siyuan-font"
        dangerouslySetInnerHTML={{ __html: siyuanFontCss(basePath) }}
      />
      <body className="h-full overflow-hidden">
        {/* 思源宋体常用分片预载（字体是同源，必须带 crossorigin）；React 会提到 <head>。 */}
        {FONT_PRELOAD.map((n) => (
          <link
            key={n}
            rel="preload"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
            href={`${basePath}/fonts/siyuan/${n}.woff2`}
          />
        ))}
        {children}
      </body>
    </html>
  );
}
