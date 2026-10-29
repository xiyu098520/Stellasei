import type { Metadata, Viewport } from "next";
import "./globals.css";

/* 1.12.98：字体一个都不下载。
   原先是 next/font 自托管 Geist／Geist Mono／Playfair，Next 会把它们作为
   `<link rel="preload" as="font">` 写进 <head>——冷启动那几条与 JS 分片抢带宽，
   开屏就得多等；中文早已全走系统宋体。现在连这三个拉丁字体也交给系统栈
   （见 globals.css 的 @theme），首屏零字体请求。 */

/**
 * 启动看门狗（1.12.98）：一段**不依赖任何 JS 分片**的内联脚本。
 *
 * 要解决的病：手机上卡在开屏、点也没反应。根子是整页只有静态 HTML 落了地，
 * 应用包没起来（旧 HTML 缓存把分片地址指到已经不存在的文件是最常见的一种），
 * 于是 React 从未接管——开屏的「点击任意处进入」与 2.8 秒自动走全都不存在。
 *
 * 它做三件事：
 * 1. 逮住脚本加载失败（分片 404）与首个运行时错误；
 * 2. 4 秒后应用还没标记就绪 → 分片加载失败就**静默换地址重载一次**
 *    （`?r=时间戳` 绕过 HTML 缓存；30 秒内只试一次，防坏环境里无限刷）；
 * 3. 否则在底部浮一张小卡片：一句人话 + 错误原文 + 「刷新」按钮。
 */
const BOOT_WATCHDOG = `
(function () {
  var err = "";
  var scriptFailed = false;
  function ready() { return window.__stellaseiReady === true; }

  /* 捕获期监听：分片 404／加载失败也走 error，只是 target 是 <script> 元素。 */
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "SCRIPT") { scriptFailed = true; return; }
    if (e && e.message) { err = String(e.message); }
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    err = String((r && r.message) || r || "Promise 被拒绝");
  });

  function reload() { location.replace(location.pathname + "?r=" + Date.now()); }

  function paint() {
    if (document.getElementById("stellasei-boot-tip")) return;
    var box = document.createElement("div");
    box.id = "stellasei-boot-tip";
    box.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:86vw;padding:14px 16px;border-radius:16px;background:rgba(18,16,28,.96);color:#fff;font:13px/1.65 -apple-system,'PingFang SC',sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.5);";
    var p = document.createElement("div");
    p.textContent = scriptFailed
      ? "页面文件过期了（新版本换掉了一部分），所以界面起不来。点「刷新」一次就好。"
      : "界面没有启动完成。点「刷新」一次就好。";
    box.appendChild(p);
    if (err) {
      var d = document.createElement("div");
      d.style.cssText = "margin-top:6px;opacity:.55;font-size:11px;word-break:break-all;";
      d.textContent = err.slice(0, 160);
      box.appendChild(d);
    }
    var b = document.createElement("button");
    b.textContent = "刷新";
    b.style.cssText = "margin-top:10px;padding:8px 20px;border:0;border-radius:999px;background:#cbbfff;color:#1b1630;font:600 13px -apple-system,'PingFang SC',sans-serif;";
    b.onclick = reload;
    box.appendChild(b);
    document.body.appendChild(box);
  }

  function watch() {
    if (ready()) return;
    if (scriptFailed) {
      var last = 0;
      try { last = Number(sessionStorage.getItem("stellasei:boot-reload") || 0); } catch (e) {}
      if (Date.now() - last > 30000) {
        try { sessionStorage.setItem("stellasei:boot-reload", String(Date.now())); } catch (e) {}
        reload();
        return;
      }
    }
    paint();
    /* 卡片只是兜底：应用稍后自己起来了就把它收走，别挡着。 */
    var iv = setInterval(function () {
      if (!ready()) return;
      clearInterval(iv);
      var el = document.getElementById("stellasei-boot-tip");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 500);
  }

  setTimeout(watch, 4000);
})();
`;

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
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full overflow-hidden">
        {/* 中文衬线（霞鹜文楷）：一枚单独的样式表，里面是 982 条 @font-face 分片，
            每条自带 unicode-range——浏览器**只下当前这屏用到的字**（十几片、几百 KB），
            不是 22MB 整包。放 public 下、用相对 url()，dev 与 GitHub Pages 的子路径
            都能自己解析对，不必在 CSS 里拼 basePath。 */}
        <link
          rel="stylesheet"
          precedence="default"
          href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fonts/fonts.css`}
        />
        {/* 必须排在 children 之前：整页一旦卡住，靠它给出人话和刷新。 */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
        {children}
      </body>
    </html>
  );
}
