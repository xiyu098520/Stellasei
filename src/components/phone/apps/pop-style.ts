/**
 * 设置 App 的「撞色贴纸」底料（设置主页、API 设定、存储体检三个文件共用）。
 *
 * 恩熙 2026-09-20 定的方向：**每个 App 各自成一格，不必互相解释**。
 * 设置不必有主题，它可以只是「排版很好、按钮很可爱、颜色很跳脱」——
 * 于是在聊天（米白纸质）与世界书（暗紫沉金）之外，另起这一块贴纸：
 *   白卡 ＋ 2px 黑描边 ＋ 无模糊硬阴影 ＋ 荧光撞色 ＋ 大圆角 ＋ 无衬线粗字。
 *
 * 配色全部挑「亮到压得住黑字」的档位（最低的蓝也有 6.6:1），
 * 所以色块上一律黑字，不必再备一套深色。
 *
 * 拼装方式：
 *   · 一张卡：`bg-white` ＋ POP_EDGE ＋ `rounded-[20px]` ＋ POP_LIFT
 *   · 一个色块（图标座／标签）：POP_TONE.x 打底，字色 POP_INK
 *   · 一个可点的东西：再叠 POP_PRESS（按下去往阴影里沉 3px）
 * 省电铁律照旧（AGENTS.md）：只动 transform／opacity，硬阴影不做动画。
 */

/** 无衬线（Geist ＋ 苹方）：贴纸不用宋体——宋体的味是「旧书」，不是「贴纸」。 */
export const POP_FONT = "var(--font-sans)";

/** 描边黑，同时就是正文黑。 */
export const POP_INK = "#141414";

/** 撞色盘。 */
export const POP_TONE = {
  blue: "#4C8DFF",
  orange: "#FF8A3D",
  purple: "#A78BFA",
  mint: "#6BE3B8",
  lemon: "#D9F24D",
  pink: "#FF7AB8",
  yellow: "#FFD84D",
  red: "#FF5A4D",
} as const;

export type PopTone = keyof typeof POP_TONE;

/** 2px 黑描边（贴纸的边）。 */
export const POP_EDGE = "border-2 border-[#141414]";
/** 无模糊硬阴影（贴纸的厚度）。 */
export const POP_LIFT = "shadow-[3px_3px_0_#141414]";
/** 一张白卡：圆角 ＋ 描边 ＋ 阴影（阴影比小色块厚一档，卡才压得住）。 */
export const POP_CARD =
  "rounded-[20px] border-2 border-[#141414] bg-white shadow-[4px_4px_0_#141414]";
/** 按下：整体往阴影里沉 3px、阴影同时收没（只动 transform）。 */
export const POP_PRESS =
  "transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none";
