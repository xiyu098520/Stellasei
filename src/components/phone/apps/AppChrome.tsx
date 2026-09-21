"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePhone } from "@/context/PhoneContext";

/**
 * App 内页通用框架：返回列＋标题＋滚动内容，自动避开安全区。
 * 支持 light（预设）／dark／paper（厚纸白）／cream（米白琥珀）／
 * file（档案冷白纸：#F2F3F5 底、墨色标题，档案 App 专用）／
 * arcana（世界书列表·塔罗桌：#0B0810 暗底、月白细线）／
 * pop（设置·撞色贴纸：#F6F4F1 浅底、无衬线粗字、黑描边返回钮）七种主题。
 */
export function AppChrome({
  title,
  titleEn,
  headerRight,
  onBack,
  theme = "light",
  children,
}: {
  title: string;
  titleEn?: string;
  headerRight?: ReactNode;
  /** 自订返回行为（如详情页返回列表）；未提供则关闭 App 回主屏幕。 */
  onBack?: () => void;
  theme?: "light" | "dark" | "paper" | "cream" | "file" | "arcana" | "pop";
  children: ReactNode;
}) {
  const { closeApp } = usePhone();

  const handleBack = onBack ?? closeApp;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /* 键盘避让（真机）：真凶不是「看不见」，是**位置在动**——键盘弹起时 iOS 会把整页
     往上顶（系统原生避让）；手指一按画面外，系统先让输入框失焦、这个上顶立刻被撤销，
     整页往下弹回，按钮就从手指底下滑走，那一下点击被判成滑动丢掉（只有已聚焦的输入框
     还「能用」，它不需要再点一次）。
     做法＝**垫内边距**：这一层照旧满高、底色铺满整页，只在内容底下垫出与键盘等高的
     一段空白——内容躲到键盘上方，垫出来那段露的是本页自己的底色，主屏透不出来。
     不用「按键盘高度压短内容区」：压短后底下空出一条，而 App 覆盖层自己没底色
     （主屏幕就在它下面），那条空白会把主页面透出来。桌面预览、安卓键盘
     （innerHeight 跟着缩）两种情况下差值≈0，什么都不做。
     **不许**用 `window.scrollTo(0, 0)` 与 `scrollIntoView`：键盘弹起时 iOS 原生把整页
     往上顶（`vv.offsetTop > 0`），我们每帧按回 0，iOS 再顶、我们再按，两边拉锯就是
     「疯狂弹跳」；`scrollIntoView` 还会连文档一起滚，再添一路拉锯。也**不挂** `scroll`
     监听（内边距只跟 `vv.height` 有关，scroll 触发全是无用功），值没变就不写 style。
     **不挂** `focusin`／`focusout`：键盘收起本来就会来一次 `visualViewport.resize`，
     `covered` 自己回到 0，不必再开第二个信号源。
     「键盘在」的唯一可信判据＝**本层里有输入框正在编辑**（`document.activeElement`）；
     没有输入框在编辑，内边距一律归零，几何值不可信时以焦点为准。
     不把「归零」押在任何事件上，**逐帧核对**：每帧读一次几何，**值没变就直接 return**
     （不写 style、不做任何测量）。内边距写在 `root` 节点的内联 style 上，而设置 App
     四个页面返回的都是同一个 `<AppChrome>`，React 复用**同一个 DOM 节点**、这个 `[]`
     依赖的 effect 不会重跑——逐帧核对会在换页后（焦点早已不在输入框上）把上一页垫起来
     的内边距自动抹平，不必另挂 `[title]` 补丁。
     省电：rAF 只在两种时刻跑——本层有输入框在编辑、或内边距还没归零；两者都不成立就
     **睡过去**，一个回调都不再排，叫醒只用 `vv.resize`。
     铁律不动：**不碰壳子高度、不加文档滚动归零、不用 transform 手动上移**；输入框落到
     可视区外时**只滚内层那条 overflow-y-auto**，绝不碰文档；量差额、只补差额。 */
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;

    /* 「键盘是否为我们而弹着」的唯一可信判据：这一层里有没有输入框正在编辑。 */
    const editingHere = () => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const field =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      return field && root.contains(el);
    };

    const apply = () => {
      const covered = Math.round(window.innerHeight - vv.height);
      const next = covered > 60 && editingHere() ? `${covered}px` : "";
      /* 没变就到此为止：不写 style，也不做下面那两处测量。 */
      if (root.style.paddingBottom === next) return;
      root.style.paddingBottom = next;
      if (!next) return;
      /* 垫高之后内容区底部抬到键盘之上，正在编辑的输入框可能落到可视区外：
         只滚这一层内容区（不碰文档、不碰壳子）。已经在视野里就什么都不做。 */
      const box = contentRef.current;
      const focused = document.activeElement;
      if (!box || !(focused instanceof HTMLElement) || !box.contains(focused)) return;
      const r = focused.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const margin = 16;
      if (r.bottom > br.bottom - margin) box.scrollTop += r.bottom - (br.bottom - margin);
      else if (r.top < br.top + margin) box.scrollTop -= br.top + margin - r.top;
    };

    /* rAF 不能「页面活着就一直跑」——每个 App 内页都按 60fps 醒着，屏幕不休眠、
     CPU 不空闲，手机就是从这里开始热的。真需要逐帧盯着的只有两种时刻：
       · 本层里有输入框在编辑（键盘可能正在动）；
       · 内边距还挂着没归零（键盘刚收、几何值不可信的那一瞬）。
     两者都不成立就**睡过去**，一个回调都不再排。叫醒它只用 `vv.resize`（键盘弹起／
     收起、视口尺寸变都会来），不新增 focusin／focusout 那类监听。
     只垫内边距、不碰壳子高度、不碰文档、值没变不写 style。 */
    let raf = 0;
    let alive = true;
    const tick = () => {
      raf = 0;
      if (!alive) return;
      apply();
      if (editingHere() || root.style.paddingBottom) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    const wake = () => {
      if (!alive || raf) return;
      raf = window.requestAnimationFrame(tick);
    };
    vv.addEventListener("resize", wake);
    wake();
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      vv.removeEventListener("resize", wake);
      root.style.paddingBottom = "";
    };
  }, []);

  const isDark = theme === "dark";
  const isPaper = theme === "paper";
  const isCream = theme === "cream";
  /* 档案屏：**纯白**底——乙游的底是一块干净的屏，
     不是一张旧纸（与 ContactsApp 的 A.bg 必须是同一个色：壳子底与内容底是同一张屏，
     不然中间那幅大画的墨会浮在两块底之间）。纹理由档案页自己铺，这里只管底色与字色。 */
  const isFile = theme === "file";
  /* 塔罗桌：深色底，占卜塔罗牌的感觉。底不是纯黑，
     是一间只点一盏灯的房间——顶上一点微光，往下沉进墨紫里。静态渐变，
     不动、不模糊（手机省电铁律）。 */
  const isArcana = theme === "arcana";
  /* 撞色贴纸：颜色跳脱、排版不呆。
     底是一层浅暖灰（不是白）——白卡压在上面才浮得起来；字一律无衬线粗体，
     贴纸的边与厚度由各页自己的黑描边＋硬阴影给，这里只管底色、字色与返回钮。 */
  const isPop = theme === "pop";

  return (
    <div
      ref={rootRef}
      className={`flex h-full flex-col ${
        isDark
          ? "bg-[#0a0a0a]"
          : isPaper
            ? "bg-[#EDEBE5]"
            : isCream
              ? "bg-[#fdfcfb]"
              : isFile
                ? "bg-[#FFFFFF]"
                : isArcana
                  ? "bg-[#0B0810]"
                  : isPop
                    ? "bg-[#F6F4F1]"
                    : "bg-[#fbf9ff]"
      }`}
      style={
        isDark
          ? {
              backgroundImage:
                "radial-gradient(circle, #1a1a1a 1px, transparent 1px)",
              backgroundSize: "12px 12px",
              fontFamily: "var(--font-serif-sc), Georgia, serif",
            }
          : isPaper
            ? {
                /* 请柬的底是**一张暖灰的桌**，不是白墙——白纸只有压在比它暗的
                   桌面上才浮得起来（同白即为「简陋」的根源）。桌上不铺点阵、
                   不泛黄，纸的质感交给世界书页自己。 */
                fontFamily: "var(--font-serif-sc), Georgia, serif",
              }
            : isCream
              ? {
                  backgroundImage:
                    "radial-gradient(circle, rgba(139,115,85,0.05) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                  fontFamily: "var(--font-serif-sc), Georgia, serif",
                }
              : isFile
                ? { fontFamily: "var(--font-serif-sc), Georgia, serif" }
                : isArcana
                  ? {
                      /* 灯在正中上方，往下散开就没了——牌桌只被这一盏灯照着。
                         三档取自**牌面自己那支渐变**（ARCANA_FACE 的
                         #261B38 / #1C1230 / #110B1F），每档各沉 2 格：
                         #241936 / #1A102E / #0F091D。
                         桌走牌面同一支紫：牌摆上去不能像贴在黑板上，桌和牌才是一套
                         东西；牌靠「亮两格」浮起来，不靠「底比它黑」（桌别比牌更黑更冷）。
                         牌面提一档，桌跟着一起提——牌比桌亮两格这条关系不动。 */
                      backgroundImage:
                        "radial-gradient(118% 76% at 50% 2%, #241936 0%, #1A102E 46%, #0F091D 100%)",
                      fontFamily: "var(--font-serif-sc), Georgia, serif",
                    }
                  : isPop
                    ? { fontFamily: "var(--font-sans)" }
                    : undefined
      }
    >
      <header
        className="flex items-center gap-3 px-4"
        style={{
          paddingTop: "calc(var(--safe-area-top) + var(--sim-status-h))",
          paddingBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="返回"
          className={`pressable flex h-9 w-9 items-center justify-center rounded-full ${
            isDark
              ? "bg-transparent text-[#aaa]"
              : isPaper
                ? "bg-transparent text-[#5E5A52]"
                : isCream
                  ? "bg-transparent text-[#78716c]"
                  : isFile
                      ? "bg-white text-[#1b1918]"
                      : isArcana
                        ? "bg-transparent text-[#B7AD9A]"
                        : isPop
                          ? "border-2 border-[#141414] bg-white text-[#141414] shadow-[2px_2px_0_#141414]"
                          : "bg-[#efeaf8] text-[#5b4f86]"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex-1 leading-tight">
          <h2
            className={`text-[16px] font-medium ${
              isDark
                ? "text-[#e5e5e5] tracking-[2px]"
                : isPaper
                  ? "text-[#141210] tracking-[2px]"
                  : isCream
                    ? "text-[#44403c] font-light tracking-[2px]"
                    : isFile
                      ? "text-[#1b1918] tracking-[2px]"
                      : isArcana
                        ? "text-[#EFE8DA] tracking-[2px]"
                        : isPop
                          ? "font-extrabold tracking-[1px] text-[#141414]"
                          : "text-[#2c2742]"
            }`}
          >
            {title}
          </h2>
          {titleEn ? (
            <p
              className={`text-[9px] tracking-[0.28em] ${
                isDark
                  ? "text-[#555]"
                  : isPaper
                    ? "font-serif text-[#9C978D]"
                    : isCream
                      ? "font-serif text-[#b45309]/60"
                      : isFile
                        ? "font-serif text-[#a79d98]"
                        : isArcana
                          ? "font-serif text-[#6D6353]"
                          : isPop
                            ? "font-extrabold text-[#B0AEA8]"
                            : "font-serif text-[#9a92b5]"
              }`}
            >
              {titleEn}
            </p>
          ) : null}
        </div>
        {headerRight}
      </header>
      <div
        ref={contentRef}
        className={`flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-area-bottom)+24px)] ${
          isDark ? "" : "pt-2"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
