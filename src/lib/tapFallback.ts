/**
 * iOS 选字「点得动、不干活」的兜底（WebKit Bug 288461）。
 *
 * 真机上在输入框里全选／拖选／粘贴之后，整页会假死：
 * 手指按下去 pointerdown / pointerup 照旧发，:active 也照旧点亮（恩熙说的「看得到按键显示」），
 * 但 click 事件不再派发 —— 于是每个按钮都「点得动、没反应」，只有已经聚焦的输入框还能用。
 * 这是 iOS Safari / WebKit 自己的 bug（288461，iOS 18.4 / 18.4.1 仍在复现，官方未修），
 * 不是我们代码的问题，也没法从根上治。
 *
 * 绕行思路：既然 pointer 事件没被冻住，就在 document 上盯 pointerup。
 * 手指抬起后若迟迟等不到 click，就自己给最近的可点元素补一次 click()。
 * 正常情况下真 click 会先到，pending 立刻作废，这层绝不插手（不会双触发）；
 * 万一真 click 比宽限慢（老 WebKit 的 300ms 点按延迟），合成完那一下会把紧随的 click 吞掉，同样不会双触发。
 */

/** 手指位移超过它就算滑动，不认作点按。 */
const TAP_MOVE = 10;
/** pointerup 之后等 click 的宽限，超时就认为被冻住了。 */
const CLICK_GRACE = 300;
/** 合成过 click 之后，这段时间内到达的真 click 一律吞掉。 */
const SWALLOW_WINDOW = 700;

/** 只给这些东西补点击；输入框自己不受影响，别去碰。 */
const TAPPABLE = 'button, a, [role="button"], [data-tap]';

export function installTapFallback(): () => void {
  if (typeof document === "undefined") return () => {};

  let startX = 0;
  let startY = 0;
  let moved = false;
  let timer = 0;
  let pending: HTMLElement | null = null;
  let swallowUntil = 0;
  /** 正在派发我们自己补的那一下——此刻的 click 就是它本人，必须放行。 */
  let synthesizing = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    pending = null;
  };

  const onDown = (e: PointerEvent) => {
    clear();
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
  };

  const onMove = (e: PointerEvent) => {
    if (moved || !e.isPrimary) return;
    if (Math.abs(e.clientX - startX) > TAP_MOVE || Math.abs(e.clientY - startY) > TAP_MOVE) {
      moved = true;
    }
  };

  const onUp = (e: PointerEvent) => {
    if (moved || !e.isPrimary || e.button > 0) return;
    const raw = e.target;
    if (!(raw instanceof Element)) return;
    if (raw.closest("input, textarea, select, [contenteditable]")) return;
    const hit = raw.closest(TAPPABLE);
    if (!(hit instanceof HTMLElement)) return;

    pending = hit;
    timer = window.setTimeout(() => {
      const el = pending;
      pending = null;
      timer = 0;
      if (!el || !el.isConnected) return;
      /* ★ 先标记「在放行」再补。旧版是先设 swallowUntil 再 el.click()，结果下面那句
         document 捕获监听第一个看到这记 click、把它**当成迟到的真 click 吞掉**：
         stopPropagation 一出，事件连 React 的根都到不了，按钮照旧没反应
         （恩熙 2026-09-20：「看得到按住、就是不干活」）。兜底一直是死代码。
         宽限窗口改到合成之后再起算，它要拦的才是真正的迟到 click。 */
      synthesizing = true;
      el.click();
      synthesizing = false;
      swallowUntil = Date.now() + SWALLOW_WINDOW;
    }, CLICK_GRACE);
  };

  /* click 正常到达 → 这次兜底作废；合成之后迟到的真 click 则吞掉，免得做两遍。 */
  const onClick = (e: MouseEvent) => {
    /* 我们自己补的那一下：放行，让它一路走到 React 的 onClick。 */
    if (synthesizing) return;
    if (Date.now() < swallowUntil) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    clear();
  };

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", clear, true);
  document.addEventListener("click", onClick, true);

  return () => {
    clear();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", clear, true);
    document.removeEventListener("click", onClick, true);
  };
}
