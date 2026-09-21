"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  BookOpen,
  Edit3,
  FileText,
  Heart,
  MessageCircle,
  Move,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppChrome } from "@/components/phone/apps/AppChrome";
import {
  addCategory,
  createArchive,
  DEFAULT_CATEGORY_ID,
  deleteArchive,
  deleteCategory,
  getArchives,
  getCategories,
  moveArchive,
  moveArchiveNear,
  saveArchive,
  setArchiveHome,
} from "@/lib/settings/contact";
import type { ArchiveCategory, ArchiveEntry, ContactProfile } from "@/types/contact";

/* =======================================================================
 * 角色档案配色（2026-09-19 五审：推倒重来——从「角色刊物」改成「乙游角色选择页」）
 *
 * 一～四审做的都是「一本叫 STELLASEI 的刊物」：刊徽、刊头、卷期号、档案袋凸标签、
 * 书口刻线、纸纹、相纸封条、封底条码……做到四审，恩熙说：不要了。
 * 她要的是**乙游（女性向游戏）挑角色的那一屏**——一屏一个角色，中间一幅大画，
 * 名字与资料落在画下面，底下一排小头像左右挑人，手感像抽卡的卡库。
 *
 * 刊物与乙游的差别不在装饰多寡，在**焦点**：
 *   · 刊物问「这一页写了什么」，所以满页都是可读的记号；
 *   · 乙游问「这是谁」，所以一屏只该有一个大件——角色的脸。
 * 于是这版删光刊物零件，只留三样：
 *   ① **一幅大画**（角色的立绘位）：一屏里唯一的重色，面积最大；
 *   ② **名字与几行资料槽**：做成乙游的数值槽——左边标签、右边值、中间一道细线引过去；
 *   ③ **底下一排小头像**（选择器）：当前那一格**不放头像**（空着就是「你在这里」），
 *      左右邻座就是滑动方向。总数 ≤5 全部铺开；>5 用 5 格居中窗，当前固定正中、
 *      左右各两个，滑到头就空着，不补位。
 *
 * 六审（同日，恩熙看了真机之后）：**「大致上是对的」**，但两个地方要补——
 *   · **小头像要圆的**，不要方的（底下那一排全改 `rounded-full`）；
 *   · **角色那一屏得先是一张「卡」**：要有外框，卡面上也要有一点装饰。
 *     于是大画与名字收进**一张白卡纸**里——墨黑细框收边、卡内留一圈白（大画成了
 *     卡纸上的开窗，不再是整块黑直接贴在屏上）、右下压一枚硬阴影；卡头左一枚蓝星、
 *     右一枚卡号。编号从名字前搬到卡头了：**编号属于卡，不属于名字**。
 *
 * 七审（同日，恩熙再看了真机）：六审那版**「有点太像员工证、工作牌了」**。
 *   病根不在装饰多少，在**信息怎么站**：白卡纸 ＋ 白边开窗的照片 ＋ 右上角工号 ＋
 *   四行「标签—细线—值」——这四件凑齐就是一张工牌的物理形态。
 *   于是七审把「卡」翻成**乙游的卡面**：**一幅画铺满整张卡（出血到边），文字全部压在
 *   图上**，资料从表格改回一行连排（「·」隔开、不写字段名），卡面自带光影、闪点、
 *   内描边、四角小角花、一圈柔影。细节见 `ArchiveCard` 段顶上的注释。
 *
 * 八审（同日，恩熙看了真机）：**「那你不觉得整个画面很空吗？」**——七审的卡写了
 *   `aspectRatio: "3 / 4"`，高矮只由宽度算出来，底下空出一片。八审把比例拿掉：
 *   世界条／卡册／小头像串成一根竖轴，**卡册吃满屏幕剩下的高度**，一屏正好一张画。
 *   装饰、配色、底排小头像一律不动。
 *
 * 九审（同日，恩熙看了真机）：八审把卡撑满之后，画也跟着撑到 338×518，恩熙当场指出
 *   **「不能把图片放这么大，放这么大就会看得出来被压缩过，非常的模糊」**。
 *   于是九审把卡退回**一张卡纸 ＋ 贴在它上面的一幅**：画四周让出卡纸、整体略往下、
 *   略歪一点点；让出来的卡头、卡尾两条带正好做装饰（蓝短线／英文小标／卡号／细线／
 *   小粉点），卡自己补上一圈边框。图回到七审那个「不会糊」的尺寸，一屏还是一张卡。
 *
 * 十审（同日，恩熙看了真机）：九审把画缩到 314 宽**还是糊**——恩熙说「**图片还是很糊，
 *   所以我觉得应该是不能放这么大的**」，并给了三条改法。真正的病根这一审才挖到：上传
 *   照片时被压到最宽 **300px**（见下面存照片那一段），画只要宽过 300 就是在放大插值。
 *   （十三审把 300 提到了 1080，十审这一让也跟着退回去了——见十三审②。）
 *   于是：① **卡册自己再让出左右各 16px**，卡面 338→306、画跟着 314→282，压回 300 以内；
 *   ② 世界条从「一排细字」重做成**一排横跨全屏的小胶片**（墨黑片基 ＋ 上下两道齿孔 ＋
 *   格内世界名与人数，当前那格套一圈亮蓝细边）；
 *   ③ 底部当前那一格从「空位＋粉点」改成**头像 ＋ 蓝圈 ＋ 右上角一枚小粉点**。
 *
 * 十一审（同日，恩熙看了真机）：四条——
 *   ① 「**我说这个胶片，你没有做到呀，我要的是一整条的全屏**」：十审做成了「一格一片」
 *      各自独立的小片子，那不是胶片。**一整条**是一条连续的黑片基横跨全屏，两道齿孔
 *      由头到尾贯穿着走，格与格之间只拿一道竖线切开——现在就是了；
 *   ② 「**要把图片缩小，整个卡片缩小**」：卡册这一层再让一圈（左右各 32px），卡面
 *      306→274；同时新加的两行小字把竖着的地方也占掉一段，画因此**两个方向都缩了**；
 *   ③ 「**在档案跟胶片之中、头像跟卡片之中穿插一些文字装饰，你不用这么死板**」：
 *      胶片上方加一行刊头式的目录行，卡与小头像之间加一行「当前是第几个」的计数线——
 *      两条都是细线配小字，不喧哗，只把两处空隙说成话；
 *   ④ 「**这个头像不要被遮挡……你不如点击到那个头像放大，有更明显的边框、装饰**」：
 *      底排改成**不是当前的那几个调小、当前那个放大**（38px ＋ 一圈蓝细边）；
 *      那枚粉点从**头像上**搬到**头像正下方、圆的外面**——再也不压脸。
 *
 * 十二审（同日，恩熙拿了两张**官方乙游卡**来比）：两条——
 *   ① 「**像這個下面的圖片膠片一樣，只是把它改成裡面是文字而已**」：十一审那条胶片
 *      ——一条黑片基铺满屏、齿孔贯到底、格与格之间一道竖线——方向对了，但格还是
 *      「字浮在一条黑带上」。参考图那条胶片上，格是**一扇一扇各自的窗**（每格自己
 *      一圈细框），格与格之间留出来的是片基本来的黑，孔是**方齿**且**不贴着片边**。
 *      于是：竖线撤掉、每格自描一圈细框当窗、格间留 6px 黑缝、齿孔改 3px 方孔并
 *      从片边往里缩 3px；当前那格仍是亮蓝框，但底色也提亮一档（窗被点亮了）。
 *   ② 「**我希望介紹應該是像圖2一樣有明顯的裝飾物去呈現的呀，現在這樣哪裡有「乙遊」
 *      的感覺呢？不就只是一張普通的照片資料嗎？**」：卡上的名字与资料是裸着的。
 *      照官方那张卡重排成三件——名字左边一道**亮蓝竖杠**、名字底下另起一行**斜体
 *      花体小字**、资料改成**一排带底色的小方牌**（牌里字段名、牌外值，自动换行成
 *      一条标签串，不是六审那张有行线的登记表）。
 *
 * 十三审（同日，恩熙）：两条——
 *   ① 「**我感觉图片大小还是要改回刚刚原本的样子，然后其他不用去变动**」：十一审为
 *      「缩小了就不那么糊」把卡册再让一圈（px-8，卡面 274）。十三审把这一让退回去了
 *      ——病根要回源头治（见②），源头治好，「缩小」这条理由就没了：卡册让边回到十审
 *      的 **px-4**（卡面 274→306、画 250→282）。其余一律不动，十一审那两行小字照留。
 *   ② 「**那能不能做到，就是只有档案的图？图片不去做太多的压缩呢？**」：能——档案照片
 *      的压缩**只在这一处**（`handlePhotoChange`），与聊天那边的头像/图片互不相干。
 *      上限从最宽 **300px 提到 1080px**、JPEG 质量 0.7→0.8：卡上那一幅在 3 倍屏上要
 *      846×1350 真实像素，1080 宽的竖图（约 1080×1620）正好盖住它还有余量——从此是
 *      **缩下来**，不是放大插值，「图糊」才算真治了。**这一条只对以后新传的照片生效**，
 *      已经存进去的老照片仍是 300px，要清楚就得重新传一张。
 *
 * 十四审（同日，恩熙）：「**它會露出左右兩邊的下一個照片，你可能要再放大一點點**」。
 *   卡册左右各让 16px、格间空 14px，于是两边各漏出 **2px** 邻卡的边（16−14）。十四审把
 *   让边收到 **px-2**（左右各 8px）：让边小于格间的空，左右那 8px 全落在格与格之间的白
 *   上，邻卡整张被推出屏外——边不再露，卡面也顺势宽了一圈。其余一律不动。
 *
 * 颜色纪律（五审版，六、七、八、九、十、十一、十二、十三、十四审照旧）：整页只有四样东西在说话——
 *   **白**（纸：整页底，面积最大）
 *   **黑**（大画 ＋ 名字与资料的主字）
 *   **蓝**（编号、几道装饰线、底排里「你在这里」那一格）
 *   **粉**（只做小点：当前项那一枚，全页面积最小）
 * 黑用墨黑 #1B1918 不用纯黑：与记忆页同一块墨，两页之间不至于断层。
 * ===================================================================== */
const A = {
  /* 纸：白（五审从四审的近白 #F7F6F3 推到纯白——乙游的底是一块干净的屏，不是一张旧纸。
     壳子底（AppChrome 的 file 主题）必须跟着同一个白，不然两边接缝处会裂出一道线）。 */
  bg: "#FFFFFF",
  paper: "#FFFFFF",
  /* 墨：大画、名字、资料 */
  ink: "#1B1918",
  ink2: "#6E6663",
  ink3: "#A79D98",
  /* 蓝：编号、装饰线、底排里「你在这里」那一格（四审压沉的那支靛，继续用） */
  blue: "#2B4295",
  blueDeep: "#1E2F6E",
  blueWash: "rgba(43,66,149,.12)",
  /* 黑底上的蓝：靛蓝压在墨上太沉，抬亮一档（大画里的编号、黑上一层细线） */
  blueLit: "#8DA2E6",
  /* 粉：只做小点（「你在这里」那一枚）——与记忆同一枚粉，两页还是同一个家族。 */
  pink: "#E7A3B1",
  /* 黑标签贴（与记忆同一枚，刊物之间的暗号） */
  label: "#1B1918",
  /* 印章红（全册唯一例外：只盖在不可复原的动作上） */
  seal: "#A3372C",
  /* 线 */
  line: "rgba(27,25,24,.12)",
  lineSoft: "rgba(27,25,24,.06)",
  dash: "rgba(27,25,24,.22)",
} as const;

/** 编号与数值字：仍是这套等宽字——乙游那一屏的编号、数值槽、页码都用它（数字要一样宽）。 */
const A_MONO = "var(--font-geist-mono), monospace";
/** 英文小标：印刷体大写衬线（五审的列表页已经不用它了，详情页与弹窗还在用）。 */
const A_EN = "var(--font-playfair), Georgia, serif";
/** 名字与资料：宋体。乙游立绘屏上的名字用宋体最稳（游戏里也是这类衬线大字）。 */
const A_SERIF = "'Songti SC', Georgia, serif";
/** 卡面上的中文：霞鹜文楷（十七审换）。
 *  恩熙说「**要换稍微比较艺术感的字体**」——宋体是方块骨架（一横一竖、笔画等粗），
 *  端正但不「艺术」；霞鹜文楷是书写体，横画微仰、笔画有起有收，多一点手写的温度，
 *  又不至于像书法体那样只认得几个字。**这支字体是本项目自托管的**
 *  （`src/app/lxgw-wenkai.css`，见施工日志第 103 条），全站早就加载着——
 *  这里只是换一个引用，**没有新增任何字体文件**。系统楷体降级兜底。 */
const A_ART = "'LXGW WenKai GB', 'Kaiti SC', 'STKaiti', 'KaiTi', Georgia, serif";

/** 纸纹：极淡的斜纹，像刊物内页的底。 */
const A_GRAIN: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(27,25,24,.028) 0 1px, transparent 1px 9px)",
};
/** 硬边错位投影：与记忆同一枚，剪贴拼贴感。 */
const A_SHADOW = "4px 4px 0 rgba(27,25,24,.06)";
/** 卡影（七审）：一整张立绘是深色的一大块，压在白屏上得自己投出一圈柔影才「浮」得起来。
 *  硬边错位影（A_SHADOW）是纸片的感觉，撑不住这么大一块画，所以单开一枚。 */
const A_CARD_SHADOW = "0 16px 34px -12px rgba(27,25,24,.44)";

/* -----------------------------------------------------------------------
 * 刊物的零件（与记忆同一套，只换颜色——参考图只用来定方向，版式不照搬）
 * --------------------------------------------------------------------- */

/** 黑标签贴：与记忆同一枚（记忆是粉底），只因是贴上去的，略歪一点。 */
const A_CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flex: "none",
  fontSize: 9,
  color: "#FFFFFF",
  background: A.label,
  borderRadius: 2,
  padding: "2.5px 7px",
  letterSpacing: ".14em",
  transform: "rotate(-1.8deg)",
};

/** 标签旁边那行外国字小标：与记忆同一枚（大写、疏字距、灰）。 */
const A_EN_SMALL: CSSProperties = {
  fontFamily: A_EN,
  fontSize: 8.5,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: ".32em",
  color: A.ink3,
};

/** 目录点线：把左边的标签引到右边的数字上（与记忆同一道）。 */
const A_LEADER: CSSProperties = {
  flex: 1,
  minWidth: 12,
  borderBottom: `1px dotted ${A.dash}`,
  transform: "translateY(-3px)",
  margin: "0 4px",
};

/* 档案里的多行输入框：**底下垫三行，写多了自己长高。**
   2026-09-18 恩熙说「固定一样高吧，这样看起来像便签那种感觉」，于是 1.0.99 起全部钉死
   三行、写不下的在框里自己滚。可那样写长人设时只留一扇三行的窗，看不见自己写了多少；
   她现在要的是「**我希望这个输入框会随着我的空格长大，就是不会局限只有三行**」。
   ⇒ 空着仍旧是一张三行的便签，超出的部分**逐行撑开**，不再在框里滚。 */
const FIELD_BOX_LINES = 3;

function FixedTextarea({ style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /* 跟着内容长高：每次渲染都把高度重算一遍。**先复位成 `auto` 再读 `scrollHeight`**
     ——不复位的话它只会越撑越高，删字也缩不回来。矮于三行的那截由 `minHeight` 兜着。 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });
  return (
    <textarea
      {...rest}
      ref={ref}
      style={{
        /* 1.8 对应各调用处的 leading-[1.8]：底下垫三行，多写的自己往上长。 */
        minHeight: `${FIELD_BOX_LINES * 1.8}em`,
        overflowY: "hidden",
        ...style,
      }}
    />
  );
}

/* =======================================================================
 * 详情页零件（刊物的「内页」——列表页是封面，点进来是内页）
 *
 * 2026-09-18（1.0.99 恩熙：「元素跟装饰还是少了点，胆子可以再大一点」）：详情页原本
 * 是另一套语言——暗底、暗红、装订孔、戳记、终端命令行，跟列表页的冷白纸摆在一起
 * 像两本册子。现在并回同一本刊物的内页：纸面、墨线、蓝编号，装饰全换成**印厂的
 * 记号**——裁切角标、登记表格线、骑缝线、页码水印、署名条。
 *
 * 颜色纪律在这里再收一次：整页只有三样东西在说话——墨（线与字）、蓝（编号与页码）、
 * 红（印章，全册仅此一处，只给不可复原的事）。
 * ===================================================================== */

/** 详情页左边那条**墨黑窄带**（三十一审）：一列竖排的菜单项压在上面。
 *  恩熙要的「**透透的**」有个前提——白底上白色半透明是看不见的，得先有一块深色可透；
 *  而黑正是全册既有的墨色，于是这块底不用另开颜色，直接把 `A.label` 的黑拿来当底。
 *  只在左上留一点内边距，不贴死屏幕边；右下投一枚极轻的硬边错位影（与纸片同一枚语法）。 */
const A_MENU_BAND: CSSProperties = {
  background: A.label,
  borderRadius: 6,
  padding: "5px 4px",
  boxShadow: "4px 4px 0 rgba(27,25,24,.10)",
};

/** 菜单项：**没选中**是白色半透明的字与图标（像隔着深色底透出来），
 *  **选中**抬到纯白并给一小块更亮的底——同一列里只有一枚是亮的。 */
const A_MENU_OFF = "rgba(255,255,255,.55)";
const A_MENU_ON = "#FFFFFF";

/** 分区标题底下那道细线（二十八审）。现在只剩 07「补充」那一栏在用——02–05 的栏头
 *  连同这道线在三十一审撤了（左边菜单上已经报过栏目名）。 */
const A_HEAD_LINE: CSSProperties = {
  borderBottom: `1px solid ${A.line}`,
};

/** 裁切角标：页面四角的小直角，印厂对版用的记号。 */
const A_CROP: CSSProperties = {
  position: "absolute",
  width: 9,
  height: 9,
  pointerEvents: "none",
};

/** 页面四角的裁切角标（放进一个 relative 容器里即可）。 */
function CropMarks() {
  const ink = "1.2px solid rgba(27,25,24,.3)";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <span style={{ ...A_CROP, left: 6, top: -5, borderLeft: ink, borderTop: ink }} />
      <span style={{ ...A_CROP, right: 6, top: -5, borderRight: ink, borderTop: ink }} />
      <span style={{ ...A_CROP, left: 6, bottom: -5, borderLeft: ink, borderBottom: ink }} />
      <span style={{ ...A_CROP, right: 6, bottom: -5, borderRight: ink, borderBottom: ink }} />
    </span>
  );
}

/** 01 登记表里的一条资料：**居中**的「标签 · 值」（三十一审恩熙选定的样式一）。
 *  恩熙：「**就是如果让这些文字变成是居中的那种感觉呢？就是从中间一行一行往下。**」
 *  ——以前是「标签顶最左、值甩到最右、中间一串点线」的目录语法，一排排等高，才像公文；
 *  现在一条资料自己占一行、从中间往下排。值的样式各条不同（有的是输入框、有的是罗马体
 *  日期），所以这里只管**那一行的骨架**，值由调用处塞进来。 */
function RegLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-center gap-2 py-[5px]">
      <span className="shrink-0 text-[9px] tracking-[1px]" style={{ color: A.ink3 }}>
        {label}
      </span>
      <span aria-hidden className="shrink-0 text-[9px]" style={{ color: A.ink3 }}>
        ·
      </span>
      {children}
    </div>
  );
}

/** 详情页左边的菜单（二十八审立页签，三十一审改成竖排菜单）。
 *  恩熙：「**我觉得分类是不是可以在左边，然后做成像圆形按钮的感觉？**」「**就是像菜单
 *  的那种感觉…按钮放在最左边，然后可以稍微不要这么贴齐左边一点，就不用这么大。**」
 *  「**我希望的按钮是像这种感觉…并且呢是有点透透的呀**」（乙游截图：一枚线条小图标
 *  ＋ 中文名 ＋ 一行小英文，白色半透明浮在深色底上）。
 *  ⇒ 每项＝**图标 ＋ 中文名 ＋ 拉丁小标**，三十一审末恩熙又定：「**按钮里不要带编号了**」。
 *  拉丁小标是原先栏头上那套（`particulars` 等），栏头撤了正好挪到这里当一行小字。 */
const DETAIL_TABS: { id: string; label: string; en: string; Icon: LucideIcon }[] = [
  { id: "01", label: "资料", en: "particulars", Icon: User },
  { id: "02", label: "详情", en: "appearance", Icon: BookOpen },
  { id: "03", label: "人设", en: "persona", Icon: Sparkles },
  { id: "04", label: "关系", en: "relations", Icon: Heart },
  { id: "05", label: "对话", en: "dialogue", Icon: MessageCircle },
  { id: "07", label: "补充", en: "appendix", Icon: FileText },
];

/* =======================================================================
 * 列表页（＝乙游的挑人屏）
 *
 * 一～四审做的都是「一本叫 STELLASEI 的刊物」的封面：刊徽、刊头、卷期号、档案袋凸标签、
 * 书口刻线、相纸封条、封底条码。2026-09-19 五审，恩熙说不要了——她要的是**乙游挑角色
 * 的那一屏**（像抽卡的卡库，左右滑看自己不同的角色）。
 *
 * 所以这一页从「一册刊物」改成「一屏一个角色」，从上到下只有三段：
 *   · **世界条**：一排疏字距的细字，选中的压墨字、底下一道蓝线。分类在这页退回成一个
 *     开关（不再是「档案袋的凸标签」那种刊物零件），长按删栏、末尾加号新建。
 *   · **角色卡**（七审：乙游卡面——一整张画）：**画铺满整卡出血到边**，名字与资料全部
 *     **压在画上**（有照片就铺照片，没有就一层淡剪影），卡面自带光影、压暗、闪点、
 *     内描边、四角小角花、一圈柔影，右上角一枚小卡号。资料是**一行连排**（世界·身份·
 *     性别·年龄，用「·」隔开、不写字段名）——六审那种四行「标签—细线—值」的登记表
 *     正是这张卡像工牌的地方。八层结构见 `ArchiveCard`。
 *   · **底部小圆头像**：当前那一格留空（＝你在这里），左右邻座就是滑动方向。
 * 三段串成一根竖轴：世界条与小头像按自己的身高走，中间的卡册 `flex-1` **吃满剩下的
 * 高度**——所以一屏正好一张画，卡底不会空出一片台面（八审，见 `ArchiveCard`）。
 * 壳子上那行「档案」是 App 的名字，这块屏只负责「是谁」。
 * ===================================================================== */

/** 剪影：还没有照片时，大画里那层很淡的人形（头与肩）——空着就空着，不喊「待补」。
 *  肩线压在底边外一点，像一张没拍完的半身像。 */
function FigureSilhouette({ color = "rgba(255,255,255,.09)" }: { color?: string }) {
  return (
    <svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMax meet" className="block h-full w-full" aria-hidden>
      <circle cx="60" cy="42" r="25" fill={color} />
      <path d="M6 132c0-27 24-43 54-43s54 16 54 43Z" fill={color} />
    </svg>
  );
}

/** 世界条最前面那一格「已唤醒」＝所有已唤醒角色的总目录：不论住哪个世界都在。
 *  它同时也是「还没归入任何世界」的落点（新建档、分类被删，都退到这里）。 */

/** 长按列表卡弹出的小菜单里，排序那四件事（三十四审）：四个方向共用同一套动作，
 *  点一下就把这个人挪到那一格（边界由菜单里的 `menuIndex` 现算，见渲染处）。 */
const MENU_PLACES: { label: string; en: string; icon: LucideIcon; place: "front" | "preceding" | "following" | "back" }[] = [
  { label: "排到最前", en: "front", icon: ArrowUpToLine, place: "front" },
  { label: "往前一位", en: "preceding", icon: ArrowUp, place: "preceding" },
  { label: "往后一位", en: "following", icon: ArrowDown, place: "following" },
  { label: "排到最后", en: "back", icon: ArrowDownToLine, place: "back" },
];

function ArchiveList({
  archives,
  categories,
  selectedCategoryId,
  onSelectCategory,
  onAddCategoryClick,
  onSelectArchive,
  onSetHome,
  onReorder,
  onCoverPos,
  onWake,
  onCategoryDeleted,
}: {
  archives: ArchiveEntry[];
  categories: ArchiveCategory[];
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
  onAddCategoryClick: () => void;
  onSelectArchive: (id: string) => void;
  /** 设为主页（十九审）：把某条档案挪到卡册第一位。 */
  onSetHome: (id: string) => Promise<void>;
  /** 手动排序（三十四审）：把某条档案挪到邻居的前／后一位（见 `moveArchiveNear`）。 */
  onReorder: (id: string, neighborId: string, place: "before" | "after") => Promise<void>;
  /** 取景落库（三十四审）：拖动松手时把 `coverPos` 存进那条档案。 */
  onCoverPos: (id: string, pos: { x: number; y: number }) => void;
  onWake: () => void;
  onCategoryDeleted: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  /* 检索撤出正文，收进壳子右上角：平时只是一枚放大镜，点开才在标题那一行展开。
     列表页正文因此只剩「世界条」与「一屏一个角色」两块，不再摞第三条带子。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [confirmDeleteTab, setConfirmDeleteTab] = useState<{ id: string; name: string } | null>(null);
  /* 长按一张卡弹出的小菜单（三十四审）：存的是那条档案的 id，不存下标——
     排序一动，下标就变了，存 id 才能一直指着同一个人（见下面的 `menuIndex`）。 */
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  /* 正在调整取景的那张卡（三十四审）：有值＝这一屏进了「拖动照片」的手感。
     它是**临时的一次编辑**，位置松手就落库（存进档案的 `coverPos`），不留在这一页上。 */
  const [coverEditId, setCoverEditId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /* 长按刚触发过没有：松手后浏览器还会给按住的那一格补发一次 click，拿它拦掉，
     免得「弹出菜单」和「进详情／换栏目」一起发生。
     它**每次按下都会先清掉**（见 `startLongPress`）——所以哪怕那一发补发的 click 一直
     没来（iOS 上是常事），这个开关也不会卡在那儿把她下一次正常的点按吞掉。 */
  const longPressFired = useRef(false);

  /* 卡册：一页一个角色，左右滑动翻阅（恩熙给的参考图）。 */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);

  /** 两张卡之间的间距（与下面 flex 的 gap-3.5 必须一致，翻页按它折算步长）。 */
  const CARD_GAP = 14;

  /** 一张卡的步长：卡宽 ＋ 间距。 */
  const railStep = () => {
    const el = railRef.current;
    if (!el) return 0;
    const first = el.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + CARD_GAP : el.clientWidth;
  };

  const goToPage = (i: number) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollTo({ left: i * railStep(), behavior: "smooth" });
  };

  /** 设为主页（十九审）：恩熙说「按设定，它就会跑到主页的第一页，就列表页第一个」——
   *  所以按完不只挪位置，还要**真的把她翻到第一页**，让她看见它落在那儿。
   *  落库在上层（`onSetHome`），这里只管翻页。 */
  const setHome = async (id: string) => {
    await onSetHome(id);
    railRef.current?.scrollTo({ left: 0 });
    setPage(0);
  };

  /** 手动排序（三十四审）：挪完**跟着那个人走**——她按「往后一位」，眼睛还盯着他，
   *  所以落库之后把卡册翻到他现在所在的那一页（`nextIndex` 是他在这一栏里的新位子）。
   *  步长只跟卡宽有关，与次序无关，所以这里立刻翻页也不会翻错格。 */
  const reorder = async (
    id: string,
    neighborId: string,
    place: "before" | "after",
    nextIndex: number,
  ) => {
    await onReorder(id, neighborId, place);
    goToPage(nextIndex);
    setPage(nextIndex);
  };

  // 卸载时清掉长按计时器。
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pressStart.current = null;
  };

  /** 长按 500ms 之后做一件事（三十四审：世界条删栏与卡片小菜单共用这一支计时器）。
   *  ⚠ 顺序有讲究：`cancelLongPress` 会把 `pressStart` 一起清掉，所以调用方必须
   *  **先起计时、再记起点**——反过来的话「滑动超过 10px 就取消」那条判据永远读不到
   *  起点（世界里横滑着挑栏目，手停 500ms 就会弹出删除确认）。 */
  const startLongPress = (fire: () => void) => {
    cancelLongPress();
    // 每次按下先清掉「刚长按过」——上一下的余波到此为止（见 `longPressFired`）。
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      fire();
    }, 500);
  };

  /** 这一发 click 是不是长按松手后**补发**的那一发。 */
  const longPressJustFired = () => longPressFired.current;

  /** 挂在卡片／世界条上的那套指针手势。不给 `fire` 就什么都不挂
   *  （内建「已唤醒」是总目录、删不得，本来就不该起计时）。 */
  const pressHandlers = (fire?: () => void) => {
    if (!fire) return {};
    return {
      onPointerDown: (e: ReactPointerEvent) => {
        startLongPress(fire);
        pressStart.current = { x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: ReactPointerEvent) => {
        // 手指滑动超过 10px 视为滚动，取消长按。
        if (!pressStart.current) return;
        const dx = e.clientX - pressStart.current.x;
        const dy = e.clientY - pressStart.current.y;
        if (dx * dx + dy * dy > 100) cancelLongPress();
      },
      onPointerUp: cancelLongPress,
      onPointerCancel: cancelLongPress,
      onPointerLeave: cancelLongPress,
    };
  };

  /** 某分类是否收录这条档案（内建「已唤醒」是总目录，不论住哪个世界都收；自订分类只收自己栏里的）。 */
  const inCategory = (a: ArchiveEntry, categoryId: string) =>
    categoryId === DEFAULT_CATEGORY_ID ? true : a.categoryId === categoryId;

  // 依分类＋搜索过滤。
  const filtered = archives.filter((a) => {
    if (!inCategory(a, selectedCategoryId)) return false;
    const kw = search.trim().toLowerCase();
    if (!kw) return true;
    return (
      a.data.name.toLowerCase().includes(kw) ||
      a.data.nickname.toLowerCase().includes(kw)
    );
  });

  // 分类栏每条名下的条目数（不受搜索影响：那是目录册数，不是查询结果）。
  const countIn = (categoryId: string) => archives.filter((a) => inCategory(a, categoryId)).length;

  /* 卡片数可能变少（删了档），页码先夹一下再拿去显示。 */
  const shownPage = Math.min(page, Math.max(0, filtered.length - 1));

  /* 小菜单正对着的那张卡（三十四审）：按 id 现查——排序一动下标就变，按 id 查才不会
     指错人；那个人已经不在这一栏里了（换了分类／改了搜索词）就自动没有菜单，
     不留一个指向空处的浮层。 */
  const menuIndex = cardMenuId ? filtered.findIndex((a) => a.id === cardMenuId) : -1;
  const menuArchive = menuIndex >= 0 ? filtered[menuIndex] : null;

  /** 排序菜单里的四个方向（三十四审）：邻位取的是**这一栏里**的邻位（`filtered`），
   *  不是整本册子的邻位——她眼睛盯着的是当前这一栏。
   *  挪完把卡册翻到他挪过去之后的那一格（见 `reorder`），她的视线跟着人走。 */
  const runPlace = (place: "front" | "preceding" | "following" | "back") => {
    if (!menuArchive) return;
    const id = menuArchive.id;
    if (place === "front") return setHome(id);
    if (place === "preceding")
      return reorder(id, filtered[menuIndex - 1].id, "before", menuIndex - 1);
    if (place === "following")
      return reorder(id, filtered[menuIndex + 1].id, "after", menuIndex + 1);
    return reorder(id, filtered[filtered.length - 1].id, "after", filtered.length - 1);
  };

  /* 换了分类或改了搜索词，卡册回到第一页（否则会停在上一次的滚动位置）。 */
  useEffect(() => {
    railRef.current?.scrollTo({ left: 0 });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(0);
  }, [selectedCategoryId, search]);

  /* 放大镜点开，光标直接落进输入框（省掉一次点击）。 */
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // 栏目条：第一格是内建「已唤醒」（所有角色的总目录），后面是自订的世界。
  const allTabs = [
    { id: DEFAULT_CATEGORY_ID, name: "已唤醒" },
    ...categories.map((c) => ({ id: c.id, name: c.name })),
  ];

  /* 当前栏目的名：要印进卡片的资料槽（这个角色属于哪个世界）。 */
  const activeTabName = allTabs.find((t) => t.id === selectedCategoryId)?.name ?? "";

  /* 底部那一排小头像（恩熙定的规则，别改）：
     · 总数 ≤5：五格全铺，当前那一格也占着一个位子；
     · 总数 >5：切一个 5 格居中窗，当前固定在第 3 格、左右各两个；滑到头就空着，不补位。
       （共 7 张停在第 5 张：3 4 ● 6 7；停在第 6 张：4 5 ● 7 –）
     null 表示窗外（留一个空位撑住居中，不拿别的头像来填）。
     ● 那一格长什么样是另一回事（十审之前它是空位＋粉点，十审改成头像＋蓝圈＋粉点，
     见下面渲染处）——这里只管**占位与居中**，一个字没动。 */
  const railSlots: ({ archive: ArchiveEntry; index: number } | null)[] =
    filtered.length <= 5
      ? filtered.map((a, i) => ({ archive: a, index: i }))
      : [-2, -1, 0, 1, 2].map((off) => {
          const i = shownPage + off;
          return i >= 0 && i < filtered.length ? { archive: filtered[i], index: i } : null;
        });

  return (
    <AppChrome
      title={searchOpen ? "" : "档案"}
      titleEn={searchOpen ? undefined : "CONTACTS"}
      theme="file"
      headerRight={
        searchOpen ? (
          /* 检索展开：占用标题那一行，做成一条登记表的填写行（底下一条墨线），
             左边放大镜、右边一个叉（有字就清字，没字就收起来）。 */
          <div
            className="flex h-8 items-center gap-2 border-b"
            style={{ width: 172, borderColor: A.label }}
          >
            <Search size={13} strokeWidth={1.6} className="shrink-0" style={{ color: A.ink3 }} />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="检索档案…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#A79D98]"
              style={{ color: A.ink, fontFamily: A_SERIF }}
            />
            <button
              type="button"
              aria-label={search ? "清除" : "收起检索"}
              onClick={() => {
                if (search) {
                  setSearch("");
                  searchRef.current?.focus();
                  return;
                }
                setSearchOpen(false);
              }}
              className="shrink-0"
            >
              <X size={13} style={{ color: A.ink3 }} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="检索"
              onClick={() => setSearchOpen(true)}
              className="pressable flex h-7 w-7 items-center justify-center"
              style={{ color: A.ink2 }}
            >
              <Search size={15} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={onWake}
              className="pressable flex h-7 items-center gap-1 rounded-[3px] px-3 text-[9px] tracking-[1px] text-white"
              style={{ background: A.label }}
            >
              <Plus size={11} strokeWidth={1.5} />
              唤醒
            </button>
          </div>
        )
      }
    >
      {/* 一屏正好一张卡（八审）：把「世界条 ＋ 卡册 ＋ 小头像」串成一根竖轴，
          高度按屏幕**剩下多少**来分——卡不再自带固定比例，底下就不会空出一片。
          七审的卡是 `aspectRatio: 3/4`，高矮只跟宽度有关，所以永远长不到底。 */}
      <div className="relative flex h-full min-h-0 flex-col">

      {/* ===== 胶片上方的一行小字（十一审） =====
          恩熙说「可以在档案跟胶片之中穿插一些文字介绍什么的，你不用这么死板」——
          于是在「档案」这个刊头与胶片之间加一行目录行：左边说这一册在说什么，
          右边说胶片上共有几格。细字、疏字距、不喧哗，只把这块空说成一句话。 */}
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <span
          className="text-[8px] uppercase"
          style={{ color: A.ink3, fontFamily: A_EN, letterSpacing: ".34em" }}
        >
          index of worlds
        </span>
        <span
          className="text-[8px]"
          style={{ color: A.ink3, fontFamily: A_MONO, letterSpacing: "1.5px" }}
        >
          {String(allTabs.length).padStart(2, "0")} 格
        </span>
      </div>

      {/* ===== 世界条：一整条横跨全屏的胶片（十一审） =====
          五审把刊物那套报头整块撤了：刊徽、刊名、卷期号、靛蓝数据带——乙游的挑人屏上
          不该有报名和目录统计，这页只留「哪个世界」这一个开关。
          十审做成了「一格一片」各自独立的小片子，恩熙看了说不对：**「我说这个胶片，你
          没有做到呀，我要的是一整条的全屏」**——十一审照她的话重做：
            · **一条黑片基**从屏幕左沿铺到右沿（-mx-4 抵掉壳子的内边距），中间不切开；
            · **两道齿孔**（上下各一行小白点）沿整条由头贯到尾，这才是胶片的那两条边；
            · 格与格之间只拿**一道竖细线**切开（当前那格被自己的蓝框包住，就不必再画线）；
            · 当前那一格套一圈亮蓝细边（黑底上的蓝用 blueLit），一眼知道走在哪一格上。
          十二审：恩熙拿官方乙游卡下面那条胶片来比——「**像這個下面的圖片膠片一樣，只是
          把它改成裡面是文字而已**」。于是把「格」真的做成**窗**：竖线撤掉，每格自描一圈
          细框（`border` ＋ `rounded-[2px]` ＋ 极淡的底），格与格之间留出 6px 片基的黑；
          齿孔从细点改成 **3px 方孔**、并从片边往里缩 3px（参考图上的孔是方齿，且与片边
          之间还留着一条窄边）。一格一窗、缝是黑的、孔是方的——这才是那条胶片。
          分类的另外两个动作照旧：长按 500ms 删栏，末尾一格是还没装画的空片（「＋」新建）。 */}
      <div className="relative -mx-4 mb-3.5 shrink-0" style={{ background: A.ink }}>
        {/* 上下两道齿孔：**整条**贯穿的那两行孔——不是一格一个（十审就是一格一个，
            恩熙说那样是「一格一格」，不是她要的一整条）。十二审把孔从「细点」改成
            **方孔**（3px 一块），并且从片边往里缩 3px——参考图上的孔是方齿，孔与片边
            之间还留着一条窄边。 */}
        <span
          className="pointer-events-none absolute inset-x-0 top-[3px] h-[4px]"
          style={{ backgroundImage: "repeating-linear-gradient(to right, rgba(255,255,255,.44) 0 3px, transparent 3px 7px)" }}
          aria-hidden
        />
        <span
          className="pointer-events-none absolute inset-x-0 bottom-[3px] h-[4px]"
          style={{ backgroundImage: "repeating-linear-gradient(to right, rgba(255,255,255,.44) 0 3px, transparent 3px 7px)" }}
          aria-hidden
        />

        {/* 这一层才是能横滑的：一格一格名字排在一整条片基上。上下各留 9px 让开齿孔，
            格与格之间留 6px（gap-1.5）——那道缝就是片基的黑，十二审用它替掉了竖线。
            `no-callout`：长按是自家「删这一栏」，按住时不许 iOS 原生的选字菜单插进来
            （样式见 globals.css）。 */}
        <div className="cat-scroll no-callout flex items-stretch gap-1.5 overflow-x-auto px-4 py-[9px]">
          {allTabs.map((tab) => {
            const active = selectedCategoryId === tab.id;
            /* 长按 500ms 删这一栏；内建「已唤醒」是总目录，不挂手势（删不得）。 */
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  // 长按刚触发过：跳过补发的那一发 click（见 `longPressJustFired`）。
                  if (longPressJustFired()) return;
                  onSelectCategory(tab.id);
                }}
                {...pressHandlers(
                  tab.id === DEFAULT_CATEGORY_ID ? undefined : () => setConfirmDeleteTab(tab),
                )}
                className="pressable relative flex shrink-0 items-center rounded-[2px] px-3.5 py-[7px]"
                style={{
                  opacity: active ? 1 : 0.66,
                  border: active ? `1.5px solid ${A.blueLit}` : "1px solid rgba(255,255,255,.17)",
                  background: active ? "rgba(141,162,230,.16)" : "rgba(255,255,255,.03)",
                  touchAction: "manipulation",
                }}
              >
                {/* 十二审：格与格之间那道竖线撤了——参考图胶片上的格是一扇一扇**各自的
                    窗**（每格自描一圈细框，见上面的 border），格与格之间留出来的是片基
                    本来的黑（见外层的 gap-1.5）。这道「窗」就是胶片的分格。 */}
                <span
                  className="block text-[11px] leading-none"
                  style={{ letterSpacing: "2px", color: active ? "#FFFFFF" : "rgba(255,255,255,.74)" }}
                >
                  {tab.name}
                  {/* 栏名旁边的小数：这一栏收着几个人（等宽字，与编号同一套）。 */}
                  <span
                    className="ml-1.5 text-[7.5px]"
                    style={{ letterSpacing: 0, fontFamily: A_MONO, color: A.blueLit, opacity: active ? 1 : 0.7 }}
                  >
                    {String(countIn(tab.id)).padStart(2, "0")}
                  </span>
                </span>
              </button>
            );
          })}

          {/* 末尾那一格：一片还没装画的空片，点一下新建一个世界。十二审给它也描上一圈
              **虚线**的窗——它是「空着的一格」，与前头那些实线窗并排，一眼看出这是胶片
              的下一格，而不是条尾巴上挂的一个符号。 */}
          <button
            type="button"
            onClick={onAddCategoryClick}
            aria-label="新增分类"
            className="pressable flex shrink-0 items-center rounded-[2px] px-3.5 py-[7px]"
            style={{ color: A.blueLit, border: "1px dashed rgba(141,162,230,.55)" }}
          >
            <Plus size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* 主体：卡册（一屏一个角色）＋ 底部小头像
          五审把刊物那套「栏目条」撤了：分类现在是上面那条世界条（一个开关），
          不再是一排骑在卡片盒口上的凸标签——同一个逻辑只留一处。 */}
      {/* 二十六审：这一列的**行间空**由 10px 收到 8px（`gap-2.5`→`gap-2`）——三处一共省
          6px，连同下面页码行、小头像行的上边距与小头像的槽，**一共让出 18px 给照片**。
          道理：卡册是 `flex-1`，底下的行都钉在屏幕底上，所以下面**每省 1px，照片就长 1px
          （1:1）**，且卡是**上缘不动、往下长**——不碰二十二审那次「整体下移」。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">

          {/* ===== 卡册：一屏一个角色，左右滑动挑人 =====
              恩熙要的是乙游抽卡的那个卡库：一屏只有一个人，往左往右翻的是自己的角色。
              所以这里不再是并排的一张张小卡，而是**一屏一人**——卡宽＝卡册宽，
              一次只停一张（snap-mandatory），手感是「翻人」，不是「逛册子」。
              十审：卡册自己让出左右各 16px（px-4），卡面 338→306、画 314→282。
              十一审：恩熙看了真机，说「**要把图片缩小，整个卡片缩小，缩小了就不会这么
              明显了**」——卡册这一层再让一圈（px-4→px-8，左右各 32px），卡面 306→274。
              十三审把这一让**退回去**了：恩熙说「**我感觉图片大小还是要改回刚刚原本的
              样子，然后其他不用去变动**」。补丁本来就该打在病根上——糊不是因为卡大，
              是因为源图只有 300px（见 `handlePhotoChange`，十三审把上限提到了 1080），
              源头治好之后，「缩小了就不糊」这条理由就没了，于是卡册这一层回到 px-4
              （卡面 274→**306**、画 250→**282**）。十一审新加的那两行小字照旧留着，
              所以竖着那一边仍比十审略短一点——恩熙说「其他不用去变动」。
              十四审（同日）：恩熙说「**它會露出左右兩邊的下一個照片，你可能要再放大一點
              點**」——她说得对，这不是错觉：卡册让边 16px、格间空 14px，于是左右各漏出
              **2px** 邻卡的边（16−14）。补法不是再多让边，而是**让让边小于格间的空**：
              px-4→**px-2**（左右各 8px）——卡面宽因此长一圈，而左右那 8px 全落在格子之间
              的白上，邻卡整张被推出屏外，一点边都不露。8px 也刚好够卡影往左右化开
              （见 `A_CARD_SHADOW`：模糊 34、收 12，横向只溢 5px，正落在让边以内）。
              让边之后每一张仍居中停住：左右让得一样多（对称的让边在公式里正好抵消），
              snap-center 落点还是 n × 步长，翻页公式一行都不用改。
              二十二审（同日）：恩熙说「**整体可以再往下一点点吗？就是 从照片开始，再往下
              放一点点。**」——胶片与它上面那行小字不动，**从照片起整体下移一点**。改法就
              是这一条加一个 `pt-3`（12px）：上面多出的这 12px 是**卡自己让出来的**（卡册
              是 `flex-1`，底下页码／小头像／页脚按钮都钉在屏幕底上，让不出别的空间），
              所以照片**上边往下落 12px、下边不动**，卡跟着矮 12px。翻页／对齐一律没碰。
              三十四审（同日）：加一条 `no-callout`——长按这排卡是自家的小菜单，按住时不许
              iOS 原生的选字／存图浮层抢先冒出来（样式见 globals.css，卡上的名字、资料
              都是可选中的文字，光关 `touch-callout` 不够）。 */}
          {filtered.length > 0 ? (
            <>
              <div
                ref={railRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const step = railStep() || 1;
                  setPage(
                    Math.max(0, Math.min(filtered.length - 1, Math.round(el.scrollLeft / step))),
                  );
                }}
                className="cat-scroll no-callout flex min-h-0 flex-1 snap-x snap-mandatory gap-3.5 overflow-x-auto px-2 pt-3"
              >
                {filtered.map((archive, idx) => (
                  <ArchiveCard
                    key={archive.id}
                    archive={archive}
                    displayNumber={String(idx + 1).padStart(2, "0")}
                    worldName={activeTabName}
                    onClick={() => {
                      /* 长按刚触发过：跳过补发的那一发 click——不拦的话，长按弹出的
                         小菜单会连同「进详情」一起被按走（见 `longPressJustFired`）。 */
                      if (longPressJustFired()) return;
                      /* 取景模式里那一下是「拖」的收尾，不是「选」——不跳详情。 */
                      if (coverEditId) return;
                      onSelectArchive(archive.id);
                    }}
                    /* 长按弹小菜单（三十四审）；正在调整取景的那一张不挂长按，它挂拖动手势。 */
                    pressHandlers={
                      coverEditId ? undefined : pressHandlers(() => setCardMenuId(archive.id))
                    }
                    coverEditable={coverEditId === archive.id}
                    onCoverCommit={(pos) => onCoverPos(archive.id, pos)}
                  />
                ))}
              </div>

              {/* ===== 照片正下方那枚胶囊按钮（二十一审立，二十四审搬到这儿） =====
                  恩熙的原话是两句：先说「**不要在这个卡片上面**」——十九、二十两审那枚
                  「设为主页」一直贴在卡的右下角；接着给了张参考图：「**做一种像这种感觉的
                  按钮**」，图上是一枚**胶囊**：左端一枚圆的徽记，右边是主字，主字底下一行
                  疏字距的小英文。
                  二十一审把它**整块搬出卡片**，那时它落在页面最底下（排在页码行、小头像
                  那一排的**下面**）。二十四审恩熙说「**感觉这个设置主页的按钮可以贴在照片
                  下方。**」——于是这一次只做一件事：**把它挪到卡册（照片）正下方**，
                  这一屏于是从上到下成了：**照片 → 按钮 → 页码行 → 小头像**。
                  为什么挪得通、又为什么一点代价都没有：这一整列本来就是父层那一条
                  `flex flex-col gap-2.5`（10px），四行东西**共用同一条行间空**，
                  所以换的只是先后次序，**卡的高度、照片的大小、底下几行的位置全都没动**。
                  按钮与照片之间那 10px 就是这条 `gap-2.5`，没有另加边距。
                  **它是这一页唯一不跟着谁走的东西**——上面是照片、下面是头像（那是「谁」），
                  它是**动作**，动作就贴在被它作用的那一张照片底下。
                  挪位之后**尺寸、颜色、按谁、什么时候按不动，一个字没动**。
                  也因为它不在卡上，它才能是**一枚真的 `<button>`**：卡里面不能再套按钮
                  （React 19 会报「button 不能是 button 的后代」，见卡内那段注释），
                  出来之后这道约束就没了，连「拦住点击不冒到卡上」那套也不必再写。
                  样子照参考图，颜色照本页四色（参考图是金／奶油，与本页的白黑蓝粉不合，
                  借的是它的**版式**，不是它的颜色）：
                    · **双层描边**——外圈那道实（与资料牌子、卡框同一支笔），
                      内圈再浅一道（`inset-[3px]`），参考图上那圈就是双线的；
                    · **左端 28px 圆形徽记**，里头是那枚**朝上的箭头**——「往上排，
                      排到最前」，与二十审那枚同一个意思；
                    · 主字「设置封面」用卡面同一支霞鹜文楷（`A_ART`），底下
                      「SET AS COVER」疏字距大写（`A_EN`）。（二十七审恩熙把这两个词由
                      「设为主页」／「SET AS HOME」改成了现在这样——在她心里这一页第一张
                      就是「封面」，说「主页」反而绕。**改的只是给她看的那两行字**，里面
                      那支函数仍叫 `setHome`／`setArchiveHome`，行为一个字没动。）
                  **它按的是「现在停在第几张」那一张**：这一屏的规矩是一屏一人，这枚按钮
                  当然也就是这一张的按钮（翻到别张，它跟着换对象，见 `shownPage`）。
                  **第一张上它按不动**——它已经在第一个了，再按是空动作；但按钮**不藏、
                  也不换位**，只压低一档亮度，翻卡时上下几行不会跳。
                  二十三审（同日）：她看了真机说「**我觉得有点小了一点，不太好，还是想要
                  再大一点点的**」——我头一回读成了**这枚胶囊太小**，把它等比放大了一档；
                  她一句话纠回来：「**哎呀，不是按钮放大，是照片放大，宝宝。**」
                  ⇒ **那一档已整个退回，这枚按钮与二十一审一模一样**（高 38px、徽记 28px、
                  主字 13px、小英文 6.5px、内圈 `inset-[3px]`）。真正要放大的是**卡上那幅
                  照片**，见下面「丙 画」那一段。 */}
              <div className="flex shrink-0 items-center gap-3.5 px-2">
                {/* ===== 左端那道引线（二十五审） =====
                    按钮贴右，左边就空出约 250px 的一条（按钮约 121px、卡册整条约 370px）——
                    恩熙看出「这样左下角会不会稍微有点空呢」。给它接一道**极淡的蓝细线**，
                    从照片左缘一直拉到按钮跟前：这一行于是读成一条「**基线 ＋ 末端的动作**」，
                    左端不再是空的。线用**蓝**（本页的规矩是「蓝＝编号与细线」），
                    比按钮那道描边再淡一档——它只当引线，不当主角。
                    `px-2` 是照卡册那层的让边（左右各 8px）：于是在这一行里，
                    **线的起点正对照片左缘、按钮的右缘正对照片右缘**（原先按钮会往右多出 8px）。
                    行间空 `gap-3.5`（14px）与卡册的 `CARD_GAP` 同一个数。 */}
                <span
                  className="h-px flex-1"
                  style={{ background: "rgba(141,162,230,.45)" }}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => {
                    const target = filtered[shownPage];
                    if (target) void setHome(target.id);
                  }}
                  disabled={shownPage === 0}
                  aria-label="设置封面，把这一张排到卡册第一个"
                  className="pressable relative flex h-[38px] items-center gap-2.5 rounded-full pl-[5px] pr-[18px]"
                  style={{
                    background: "linear-gradient(180deg, rgba(141,162,230,.16), rgba(141,162,230,.05))",
                    boxShadow:
                      "inset 0 0 0 1px rgba(141,162,230,.62), inset 0 1px 0 rgba(255,255,255,.85)",
                    opacity: shownPage === 0 ? 0.42 : 1,
                  }}
                >
                  {/* 内圈那道浅线：参考图是双层描边。 */}
                  <span
                    className="pointer-events-none absolute inset-[3px] rounded-full"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(141,162,230,.22)" }}
                    aria-hidden
                  />

                  {/* 左端圆形徽记：中心是那枚朝上的箭头。 */}
                  <span
                    className="relative flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(255,255,255,.9)",
                      boxShadow: "inset 0 0 0 1px rgba(141,162,230,.5)",
                      color: A.blue,
                    }}
                    aria-hidden
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {/* 朝上的箭头：一条竖线 ＋ 一个尖——「往上排，排到最前」 */}
                      <path d="M12 20V5" />
                      <path d="M5 12l7-7 7 7" />
                    </svg>
                  </span>

                  {/* 主字 ＋ 小英文（参考图的版式：主字在上、疏字距英文在下）。 */}
                  <span className="flex flex-col items-center leading-none">
                    <span
                      className="text-[13px]"
                      style={{ color: A.ink, fontFamily: A_ART, fontWeight: 500, letterSpacing: "2px" }}
                    >
                      设置封面
                    </span>
                    <span
                      className="mt-[3px] text-[6.5px]"
                      style={{ color: A.ink3, fontFamily: A_EN, letterSpacing: ".3em" }}
                    >
                      SET AS COVER
                    </span>
                  </span>
                </button>
              </div>

              {/* ===== 按钮与小头像之间的那一行（十一审） =====
                  恩熙说「头像这个跟卡片之中也可以穿插一些文字装饰，你不用这么死板」——
                  于是在卡与小头像之间也压一行：一道细线、两枚小粉点，中间是**现在停在第
                  几个**（等宽字，与卡头的卡号同一套）。它同时又说了句真话：滑动时这行数字
                  会跟着变，比一条纯装饰的线有用。 */}
              <div className="flex shrink-0 items-center justify-center gap-2 pt-1.5">
                <span className="h-px w-7" style={{ background: A.line }} aria-hidden />
                <span
                  className="h-[3px] w-[3px] shrink-0 rounded-full"
                  style={{ background: A.pink, opacity: 0.85 }}
                  aria-hidden
                />
                <span
                  className="text-[8px] leading-none"
                  style={{ color: A.ink3, fontFamily: A_MONO, letterSpacing: "1.5px" }}
                >
                  {String(shownPage + 1).padStart(2, "0")} / {String(filtered.length).padStart(2, "0")}
                </span>
                <span
                  className="h-[3px] w-[3px] shrink-0 rounded-full"
                  style={{ background: A.pink, opacity: 0.85 }}
                  aria-hidden
                />
                <span className="h-px w-7" style={{ background: A.line }} aria-hidden />
              </div>

              {/* ===== 底部小头像（挑人） =====
                  规则是恩熙定的（≤5 全铺／>5 居中窗，见上面的 railSlots），占位与居中
                  一个字没动。十一审改的是**那一格长什么样**：恩熙说「这个头像不要被遮挡
                  ……你不如点击到那个头像放大，又或者把整体的头像调小一点，然后点击到哪个
                  头像放大，有更明显的边框、装饰，不要遮挡在头像」——于是：
                    · 不是当前的那几个：**调小**（24px）、只留一道极淡的边、往后站（压淡）；
                    · 当前那一个：**放大**（38px）再套一圈蓝细边——这就是她要的「更明显的
                      边框」，靠的是自己变大，不是靠压住别人；
                    · 那枚粉点从**头像上**搬到**头像正下方**（在圆的外面）：它仍是「你在这里」
                      那一枚记号，但再也不盖住脸。
                  所有格子共用同一条槽，槽底永远留出那 3px 记号的位子（不是当前的
                  就留白），所以一排头像的下沿始终齐平，放大那一枚只往上长。
                  二十六审：这条槽由 48px 收到 **44px**（`h-12`→`h-11`）——**视觉上一点没变**，
                  因为槽里的东西本来就只有 44px（当前那枚 38 头像 ＋ 3 间距 ＋ 3 粉点），
                  上面那 4px 一直是死空。它让出的 4px 和上面那几处一样，全给了照片。 */}
              <div className="flex shrink-0 items-end justify-center gap-1 pt-1.5">
                {railSlots.map((slot, i) => {
                  /* 窗外那一格：留一个空位撑住居中，不拿别的头像来填。 */
                  if (!slot) {
                    return <span key={`out-${i}`} className="h-11 w-10 shrink-0" aria-hidden />;
                  }

                  const a = slot.archive;
                  const isCurrent = slot.index === shownPage;

                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        if (!isCurrent) goToPage(slot.index);
                      }}
                      aria-label={isCurrent ? `当前：第 ${slot.index + 1} 个` : `看第 ${slot.index + 1} 个`}
                      aria-current={isCurrent || undefined}
                      className={`flex h-11 w-10 shrink-0 flex-col items-center justify-end ${
                        isCurrent ? "" : "pressable"
                      }`}
                      style={{ WebkitTouchCallout: "none" }}
                    >
                      {/* 头像本身：没有照片就拿名字头一个字顶上（一样是个位子）。
                          大小、边框、明暗全由「是不是当前」决定。 */}
                      <span
                        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px]"
                        style={{
                          width: isCurrent ? 38 : 24,
                          height: isCurrent ? 38 : 24,
                          border: isCurrent ? `1.5px solid ${A.blue}` : `1px solid ${A.line}`,
                          backgroundColor: "#F4F3F1",
                          backgroundImage: a.data.photo ? `url(${a.data.photo})` : undefined,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          color: A.ink3,
                          fontFamily: A_SERIF,
                          opacity: isCurrent ? 1 : 0.55,
                        }}
                      >
                        {a.data.photo ? null : (a.data.name || "·").trim().charAt(0)}
                      </span>

                      {/* 记号：在圆的**外面**、正下方。只有当前那一枚点亮，别的留白
                          （留白也算占位——一排的下沿因此不会参差不齐）。 */}
                      <span
                        className="mt-[3px] h-[3px] w-[3px] shrink-0 rounded-full"
                        style={{ background: isCurrent ? A.pink : "transparent" }}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            /* 空态：这一屏还没有人——不是一张印废了的纸，只是画框空着。 */
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-[88px] w-[88px] opacity-[.08]">
                <FigureSilhouette color={A.ink} />
              </div>

              <p className="mt-6 text-[12px] tracking-[2px]" style={{ color: A.ink2 }}>
                {search ? "查无符合的档案" : "此分类尚无档案"}
              </p>
              <p className="mt-2 text-[9px] tracking-[1px]" style={{ color: A.ink3 }}>
                {search ? "换个关键词，或清除搜索" : "点击右上角「唤醒」建立新档案"}
              </p>

              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="pressable mt-4 border px-3 py-1.5 text-[9px] tracking-[1px]"
                  style={{ borderColor: A.line, background: A.bg, color: A.ink2 }}
                >
                  清除搜索
                </button>
              ) : null}
            </div>
          )}
      </div>

      </div>

      {/* 删除分类确认弹窗（长按分类 500ms 触发） */}
      {confirmDeleteTab ? (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center px-8"
          style={{ background: "rgba(27,25,24,.45)" }}
          onClick={() => setConfirmDeleteTab(null)}
        >
          <div
            className="w-full border p-4"
            style={{
              borderColor: A.ink,
              background: A.paper,
              boxShadow: A_SHADOW,
              fontFamily: A_SERIF,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="-mx-4 -mt-4 mb-3 flex items-baseline gap-2 px-4 py-1.5"
              style={{ background: A.label }}
            >
              <span className="text-[9px] tracking-[.14em] text-white">分类</span>
              <em
                className="text-[8.5px] uppercase"
                style={{ color: "rgba(255,255,255,.55)", fontFamily: A_EN, letterSpacing: ".32em" }}
              >
                catalog
              </em>
              <span
                className="flex-1"
                style={{
                  minWidth: 12,
                  margin: "0 4px",
                  transform: "translateY(-3px)",
                  borderBottom: "1px dotted rgba(255,255,255,.3)",
                }}
              />
              <span className="text-[8px] text-white/60" style={{ fontFamily: A_MONO }}>
                {confirmDeleteTab.name}
              </span>
            </div>
            <p className="mb-2 text-[12px] tracking-[2px]" style={{ color: A.ink }}>
              删除分类
            </p>
            <p className="mb-4 text-[10px] leading-relaxed" style={{ color: A.ink2 }}>
              确定要删除分类「{confirmDeleteTab.name}」吗？
              <br />
              分类内的档案会退回「已唤醒」。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTab(null)}
                className="pressable border px-3 py-1.5 text-[10px] tracking-[1px]"
                style={{ borderColor: A.line, background: A.bg, color: A.ink2 }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  onCategoryDeleted(confirmDeleteTab.id);
                  setConfirmDeleteTab(null);
                }}
                className="pressable border px-3 py-1.5 text-[10px] tracking-[1px] text-white"
                style={{ borderColor: A.seal, background: A.seal }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== 长按卡片弹出的小菜单（三十四审） =====
          恩熙：「**我觉得就可以是长按列表卡，弹出小菜单，选择调整取景，或者是调整顺序吧，
          对不对？以及编辑那个顺序，你也可以在这边一起做。**」
          于是「取景」与「排序」就收在同一处：长按一张卡 500ms 弹出它，一套手感办两件事。
          做成**从底下浮上来的一张纸**（不是画面正中一个方框）：手指本来就按在卡上，
          菜单落在手指够得着的下方，点一下就收，不挡卡面。
          页眉仍旧是那枚墨黑标签条（与删除分类、删除档案同一枚）：栏名「档案」、
          小英文 `arrange`、右边写着这个人**现在**在第几位、叫什么——
          她按下「往后一位」，眼睛得有个东西对得上。
          下面五条：第一条是取景，其余四条是排序的四个方向。
          排序那四条都靠 `menuIndex` 拿邻居（前面／后面一位是谁），位移方向不变时压淡、按不动。 */}
      {menuArchive ? (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end"
          style={{ background: "rgba(27,25,24,.45)" }}
          onClick={() => setCardMenuId(null)}
        >
          <div
            className="border-t"
            style={{
              borderColor: A.ink,
              background: A.paper,
              boxShadow: A_SHADOW,
              fontFamily: A_SERIF,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline gap-2 px-4 py-1.5" style={{ background: A.label }}>
              <span className="text-[9px] tracking-[.14em] text-white">档案</span>
              <em
                className="text-[8.5px] uppercase"
                style={{ color: "rgba(255,255,255,.55)", fontFamily: A_EN, letterSpacing: ".32em" }}
              >
                arrange
              </em>
              <span style={A_LEADER} aria-hidden />
              <span className="text-[8px] text-white/60" style={{ fontFamily: A_MONO }}>
                {String(menuIndex + 1).padStart(2, "0")} · {menuArchive.data.name || "未命名"}
              </span>
            </div>

            {/* 第一条：调整取景。点它就进「拖着照片挪」的手感——菜单自己收起来，
                把那块卡面整个让给手指。 */}
            <button
              type="button"
              onClick={() => {
                setCoverEditId(menuArchive.id);
                setCardMenuId(null);
              }}
              className="pressable flex w-full items-center gap-3 border-b px-4 py-3 text-left"
              style={{ borderColor: A.lineSoft }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ border: `1px solid ${A.line}`, color: A.blue }}
              >
                <Move size={13} strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block text-[12px] leading-none tracking-[2px]"
                  style={{ color: A.ink, fontFamily: A_ART }}
                >
                  调整取景
                </span>
                <span className="mt-1.5 block text-[8.5px] leading-none" style={{ color: A.ink3 }}>
                  横的照片，拖到合适的位置
                </span>
              </span>
            </button>

            {/* 排序四件事：一套动作的四个方向。邻位都是**这一栏里**的邻位
                （`filtered`），不是整本册子的邻位——她眼睛盯着的是当前这一栏。 */}
            {MENU_PLACES.map((item, i, arr) => {
              const Icon = item.icon;
              /* 「排到最前」「往前一位」在第一位上没处挪，「往后一位」「排到最后」
                 在最后一位上没处挪——四件事各有各的边界，各自灰掉。 */
              const disabled =
                item.place === "front" || item.place === "preceding"
                  ? menuIndex <= 0
                  : menuIndex >= filtered.length - 1;
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    // 先收起菜单再挪：菜单一收，卡册整块露出来，她才看得见它挪到哪去了。
                    setCardMenuId(null);
                    runPlace(item.place);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                    disabled ? "" : "pressable"
                  }`}
                  style={{
                    borderBottom: i < arr.length - 1 ? `1px solid ${A.lineSoft}` : undefined,
                    opacity: disabled ? 0.32 : 1,
                  }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: A.blue }}>
                    <Icon size={13} strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] tracking-[2px]" style={{ color: A.ink }}>
                    {item.label}
                  </span>
                  <em
                    className="text-[7.5px] uppercase not-italic"
                    style={{ color: A.ink3, fontFamily: A_EN, letterSpacing: ".3em" }}
                  >
                    {item.en}
                  </em>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ===== 取景中（三十四审） =====
          进了这个模式，卡上那幅照片就跟着手指走，松手那一下落库（见 `ArchiveCard` 里
          那份拖动状态机）。这一层只留一枚**浮动的小牌子**：一句话说清在干什么，
          右边一枚「完成」收工。
          为什么必须落在卡外：卡本身就是一枚 `<button>`，React 19 不让按钮套按钮。
          牌子整块挂 `pointer-events-none`、只把那枚「完成」放出来——
          中间那块卡面（正是手指要拖的地方）一点都没被挡住。 */}
      {coverEditId ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(var(--safe-area-bottom)+14px)]">
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-full border py-1.5 pl-4 pr-1.5"
            style={{
              borderColor: A.ink,
              background: A.paper,
              boxShadow: A_SHADOW,
              fontFamily: A_SERIF,
            }}
          >
            <span className="text-[9px] tracking-[1px]" style={{ color: A.ink2 }}>
              拖动照片，找到合适的取景
            </span>
            <button
              type="button"
              onClick={() => setCoverEditId(null)}
              className="pressable rounded-full px-3 py-1.5 text-[10px] tracking-[2px] text-white"
              style={{ background: A.label }}
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </AppChrome>
  );
}

/* =======================================================================
 * 角色卡：一屏一张（列表页唯一的卡）
 *
 * 七审（2026-09-19）：恩熙说六审那版**太像员工证、工作牌**，要的是乙游的卡面。
 * 病根不在装饰多少，在**信息怎么站**——六审那版是「白卡纸 ＋ 白边开窗的照片 ＋
 * 工号 ＋ 四行标签值对齐表」，这四件凑齐就是一张工牌的物理形态：
 *   ① 白底、细框、照片居中留白边 —— 证件照；
 *   ② 右上角「№ 01」—— 工号；
 *   ③ 世界／身份／性别／年龄 四行「标签—细线—值」—— 员工登记表的填写栏。
 * 所以七审把这几件事一次翻掉，只留**一幅画**：
 *   · 画**铺满整张卡**（出血到边），照片不再嵌在白卡纸里当开窗，**画就是卡**；
 *   · 文字全部**压进画里**（名字、资料、卡号都在图上），卡面上不再有一块纯白的信息区；
 *   · 资料从「表格」改成**一行连排**（「·」隔开，不写字段名）——信息一个不少，
 *     但它读起来像落款，不像登记；
 *   · 卡自己带**光影、闪点、内描边、四角小角花、一圈柔影**——恩熙点名的几样装饰。
 * 卡上一共八层（从下往上）：画 → 光影 → 压暗 → 闪点 → 内描边 → 四角 → 卡号 → 名字资料。
 * 乙游的卡面从来不是「一张卡片上摆了些什么」，而是**一幅图 + 压在图上的那几行字**。
 *
 * 刊物那套零件在这张卡上一件不留：栏目页眉、相纸封条、书口页码水印、纸纹、
 * 套印蓝影（2026-09-19 五审、六审、七审）。
 *
 * 八审（同日，恩熙看了真机）：「**那你不觉得整个画面很空吗？**」——七审把卡写成
 * `aspectRatio: "3 / 4"`，**高矮只跟宽度有关**（桌面预览实测 451px），而这一屏
 * 实际还剩约 527px，卡底到小头像之间就空出约 77px。八审把比例拿掉，高度交给楼层：
 * 列表页那根竖轴（世界条／卡册／小头像）按屏幕**剩下多少**分，卡吃满中间那一段。
 * 卡还是「一整幅画」，只是这幅度量由屏幕定，不由公式定。
 *
 * 九审（同日，恩熙看了真机）：八审让卡吃满这一屏（338×518），**画也跟着吃满**——
 * 恩熙当场看出病根：「**不能把图片放这么大，放这么大就会看得出来被压缩过，非常的
 * 模糊。**」一张竖构图被硬拉到五百多高，糊是必然的。
 * 于是九审把卡从「就是那幅画」退回**「一张卡纸 ＋ 贴在它上面的一幅」**：画四周让出
 * 卡纸（上留 42px 最多、下留 26px、左右各 12px），再整体**略往下、略歪一点点**
 * （`rotate(1.1deg)`）。让出来的两条带正好做事——卡头（蓝短线＋英文小标＋卡号）、
 * 卡尾（一道渐隐细线＋小粉点），卡自己也补上边框（离边 7px 一圈蓝细线）。
 * 画因此回到约 314×450，与七审那张「不糊」的画几乎同尺寸，而卡仍是一屏一张。
 * 恩熙定的配色纪律：白＝底，黑＝画，蓝＝编号与细线，粉＝只做小点。
 *
 * 十审（同日）：恩熙说「图片还是很糊」。卡本身**一行没改**——是卡册那一层自己让出了
 * 左右各 16px，卡面 338→306、画跟着 314→282，正好压回「照片被压过」的那个 300px 以内。
 *
 * 十五审（同日）：恩熙说「**这个星点不要**」——画上那六枚极小的星尘（`CARD_SPARKS`）
 * 整段拿掉。画上如今只剩光影（②）与压暗（③）两层，不再散点。
 *
 * 十六审（同日）：恩熙说「**感觉有些不够丰富**」＋「**照片的边框坑坑巴巴**」。
 * 前者照乙游来补：「丰富」在乙游卡上不是零件多，是**光、衬、框**三样（小星点不是光，
 * 是夜空那套，所以删得对）。这一轮先补两件——② 里那片**人物背光**、⑤ 角上那四枚
 * **小菱形花饰**（剩下的名字分隔线、稀有度标记留着，等这两件的反响）。
 * 后者是查出来的三处硬伤，都在细线上：见 `CARD_EDGE`、旋转层与 ④ 的注。
 *
 * 十七审（同日）：那一轮的两件，恩熙一看就否了后一件——「**哎呦，不好看不好看**」，
 * ⑤ 角上那四枚小菱形（`CARD_GEM`）整段撤回，角上只留四道直角线。
 * 她同时要「**换稍微比较艺术感的字体**」：卡面上的中文由宋体换成**霞鹜文楷**（`A_ART`）。
 *
 * 十八审（同日）：十六审那两件，最后一件也保不住——恩熙说「**不要这个光**」，
 * ② 里那层人物背光（radial-gradient）撤掉，② 回到只有一道 148° 斜光。
 * ⇒ **十六审补的两件至此全数撤回**；那一轮真正留下的只有三处细线硬伤（见 `CARD_EDGE`、
 * 旋转层、④ 的注）与「光／衬／框」这套判据本身。
 *
 * 十九审（同日）：恩熙要一个**功能**——「**我希望在右下角可以加一个设置为主页**……
 * **按设定，它就会跑到主页的第一页，就列表页第一个**」。于是卡右下角多了「设为主页」
 * （见 `ArchiveCard` 的 戊），按了就把这条档案挪到卡册第一位。这是这一版卡面上第一次
 * 出现**能按的东西**（此前整张卡只有「进详情」一个动作），所以多了一套拦截点击的写法。
 *
 * 二十审（同日）：那枚「设为主页」的第一版恩熙不满意，给了两条——「**不要在这个照片上，
 * 就在右下角留白的地方**」＋「**做得漂亮一点、大一点，像一个图标一样**」。于是把那块
 * 文字小牌子摘了，改成一枚**圆的图标按钮**（一枚朝上的箭头），落进画下面那条留白带里。
 * 顺便发现牌子那版还有个毛病：卡尾那条细线是**从牌子中间穿过去**的，这一版把线收短到
 * 圆的左边。数据层、翻页、拦点击的那套逻辑一律没动（十九审定的，见 戊）。
 *
 * 二十一审（同日）：恩熙看了那一枚，一句「**哎呀，我都说了不要在这个卡片上面。**」
 * ——原来她说的「留白的地方」是**页面（卡片以外）的留白**，不是卡内那条 26px 的带子。
 * 紧接着她给了一张参考图：「**然后就是做一种像这种感觉的按钮。**」（图上一枚**胶囊**：
 * 左端一枚圆形徽记，右边主字，主字底下一行疏字距的小英文）。
 * 于是这一审把「设为主页」**整块搬出卡片**，落到页面右下角的页脚里，做成那枚胶囊按钮：
 * 双层描边、左端 28px 圆形徽记里一枚朝上的箭头、主字「设为主页」＋小英文
 * 「SET AS HOME」。卡尾那条线随之**左右一样长**地收回来了。
 * 按钮既已不在卡上，它便又是**一枚真的 `<button>`**——卡内不能套按钮那道约束没有了，
 * 「拦住点击不冒到卡上」那套写法也一并删掉（十九、二十审那套拦截的注释至此销号）。
 * 它按的是**现在停在第几张**那一张（一屏一人，见 `shownPage`）；第一张上按不动，但
 * 不藏、不换位，只压淡。
 *
 * 二十二审（同日）：恩熙说「**整体可以再往下一点点吗？就是 从照片开始，再往下放一点点。**」
 * ——胶片与上面那行小字不动，**从照片起整体下移**。改法只有一处：给卡册那一条加 `pt-3`
 * （12px）。因为卡册是 `flex-1`、底下那几行（页码／小头像／页脚按钮）是钉在屏幕底上的，
 * 所以这 12px 只能是**卡自己让出来的**——照片的**上边往下落 12px**、下边不动，卡因此
 * 矮 12px（约 470px 里的 2.5%，肉眼几乎看不出）。一行改动，其余一律没动。
 *
 * 二十三审（同日）：她看了真机说「**我觉得有点小了一点，不太好，还是想要再大一点点的。**」
 * 我头一回读成了**右下角那枚胶囊太小**，把它等比放大了一档（1.1.23）——她一句话纠回来：
 * 「**哎呀，不是按钮放大，是照片放大，宝宝。**」于是**按钮整档原样退回**（高 38px、徽记
 * 28px、主字 13px、小英文 6.5px，一处不留），**真正放大的是卡上那幅照片**：把「丙 画」
 * 上下两条让边各收窄一截（上 42→30px、下 26→20px）——画的上边往上长 10px、下边往下放
 * 6px，画高多出 18px（约 4.5%）。**左右没让**：12px 已是极限（画转过 1.1°，最外那点落在
 * 距卡缘 8.1px，卡框那道蓝线在 7px，再收就压上去了）。**顺序上先退回、再放大**，
 * 所以这一版里那枚胶囊与二十一审长得一模一样。
 *
 * 二十四审（同日）：她说「**感觉这个设置主页的按钮可以贴在照片下方。**」——于是把二十一审
 * 那枚胶囊从页面最底下（小头像之下）**挪到卡册（照片）正下方**，这一屏的竖序成了
 * **照片 → 按钮 → 页码行 → 小头像**。挪得通又不付代价的道理：这一整列本就是父层那条
 * `flex flex-col gap-2.5`（10px），四行东西**共用同一条行间空**——换的只是先后次序，
 * **卡的高度、照片的大小、底下几行的位置一点没动**，按钮与照片之间那 10px 就是这条
 * `gap-2.5`，没有另加边距。为什么该贴在那儿：**它是这一页唯一不跟着谁走的东西**——
 * 上面是照片、下面是头像（那是「谁」），它是**动作**，动作就贴在被它作用的那张照片底下。
 * 尺寸、颜色、按谁、第一张压淡，一个字没改。
 *
 * 二十五审（同日）：搬过来之后恩熙问「**那你觉得这样左下角会不会稍微有点空呢？是不是需要
 * 做一些装饰？**」——**她说得对**：按钮约 121px、卡册整条约 370px，它贴右之后左边空出
 * 约 250px 的一条，而这一行又是整页**唯一不居中**的一行（上下都是中轴），看着确实缺东西。
 * 于是给它接一道**极淡的蓝细线**（`rgba(141,162,230,.45)`，比按钮那道描边再淡一档）：
 * 从照片左缘一直拉到按钮跟前，**这一行就读成「基线 ＋ 末端的动作」**，左端不再空。
 * 顺带把这行的左右让边对齐卡册那层（`px-2`，8px）——**线的起点正对照片左缘、按钮的右缘
 * 正对照片右缘**（原先按钮会往右多出 8px）。按钮本体仍是一个字没改。
 *
 * 二十六审（同日）：恩熙问「**有没有办法把下面的空间再压缩呢？就是等于说让图片的上下再大
 * 一点点**」。查了一遍卡下方那一整条，从上到下是：照片↔按钮 10 ＋ 按钮 38 ＋ 按钮↔页码
 * 10 ＋ 页码行 18 ＋ 页码↔头像 10 ＋ 头像行 58 ＋ 页脚留白 58 ＝ **约 202px**。这一审做的
 * 是**只收紧「空气」**、一点不碰她已经定过的东西，一共让出 **18px**：
 *   · 这一列的**行间空** `gap-2.5`(10)→`gap-2`(8)：三处，省 6；
 *   · 页码行的上边距 `pt-2.5`(10)→`pt-1.5`(6)：省 4；
 *   · 小头像行的上边距 `pt-2.5`(10)→`pt-1.5`(6)：省 4；
 *   · 小头像的槽 `h-12`(48)→`h-11`(44)：省 4，**视觉上完全看不出**（槽里本来就只有 44，
 *     上面那 4px 一直是死空）。
 * **这 18px 全进了照片**：卡册是 `flex-1`、底下几行钉在屏幕底上，所以下面**每省 1px，
 * 照片就长 1px（1:1）**；而且卡是**上缘不动、底缘往下长**——二十二审那次「整体往下」没被
 * 抵消。按钮、当前那枚大头像、卡内部那 50px 让边、胶片上方的空间，一处没动。
 *
 * 二十七审（同日）：二十六审她看过真机说「**感觉可以了，也没有感觉底下很空了突然。**」
 * （＝那 18px 收对了），随即又说「**然后那个设置主页改成设置封面吧。**」——**只改给她看的
 * 那两行字**：主字「设为主页」→「**设置封面**」、小英文「SET AS HOME」→「**SET AS COVER**」，
 * 无障碍标签同步（`aria-label`「设置封面，把这一张排到卡册第一个」）。**她的用词更准**：
 * 这一页是乙游式卡册，第一张就是这本册子的**封面**，「主页」这个词在这页里根本没出现过、
 * 听着像指主屏幕。**按钮的尺寸／颜色／描边／徽记与箭头／按谁／第一张压淡一个字没动**，
 * 里面那支函数仍叫 `setHome`／`setArchiveHome`（内部名字，不面向她，**不跟着改**）。
 * ===================================================================== */

/** 卡角：四枚小直角压在卡的内缘上（恩熙要的「四角」）。
 *  十六审：线宽由 **1.2px 收到 1px**——3 倍屏下 1px 正好是 3 个物理像素（整数），
 *  而 1.2px 落在 3.6 个物理像素上，浏览器只能按 0.6／0.4 分摊到两列像素，
 *  于是同一条线在不同位置忽粗忽细（恩熙说的「坑坑巴巴」里，这一条占一份）。 */
const CARD_EDGE = "1px solid rgba(255,255,255,.46)";

function ArchiveCard({
  archive,
  displayNumber,
  worldName,
  onClick,
  pressHandlers,
  coverEditable,
  onCoverCommit,
}: {
  archive: ArchiveEntry;
  displayNumber: string;
  worldName: string;
  onClick: () => void;
  /** 长按那套指针手势（与世界条共用同一支计时器）；不传＝这张卡不长按。 */
  pressHandlers?: {
    onPointerDown?: (e: ReactPointerEvent) => void;
    onPointerMove?: (e: ReactPointerEvent) => void;
    onPointerUp?: () => void;
    onPointerCancel?: () => void;
    onPointerLeave?: () => void;
  };
  /** 正在调整这张的取景（三十四审）：换成拖动手势，卡面照片跟着手指挪。 */
  coverEditable?: boolean;
  /** 松手那一下把取景位置交出去（落库在上层）。 */
  onCoverCommit?: (pos: { x: number; y: number }) => void;
}) {
  const d = archive.data;
  const name = d.name || "未命名";

  /* ===== 调整取景（三十四审）=====
     恩熙：「**有些人的照片可能是横的，他就需要去挪动，去找到好的位置。**」
     卡面那幅照片是按 `cover` 裁的，裁到哪一段由 `coverPos` 定（直接喂给 `background-position`）。
     拖动时先只存在下面这份本地状态里——每一帧都写一次库太重，也没必要；**松手那一下才落库**。
     比例尺用的是**卡自己的宽高**（不是画框的）：两者只差几十像素，手感上分不出来，
     换来的是这里一句 `getBoundingClientRect` 就够，不必再给画框挂一支 ref。
     手指往右拖＝把照片往右带＝看到的是照片更左边的一段，所以 x 取的是**减号**。 */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const cover = dragPos ?? d.coverPos ?? { x: 50, y: 50 };

  /** 手指现在的位置换算成取景百分数（各自夹在 0–100：越界了就贴住边，不让照片被拉出画框）。 */
  const readDrag = (e: ReactPointerEvent) => {
    const s = dragFrom.current;
    if (!s || !s.w || !s.h) return null;
    const pct = (v: number) => Math.max(0, Math.min(100, v));
    return {
      x: pct(s.x - ((e.clientX - s.px) / s.w) * 100),
      y: pct(s.y - ((e.clientY - s.py) / s.h) * 100),
    };
  };

  const dragHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      dragFrom.current = {
        px: e.clientX,
        py: e.clientY,
        x: cover.x,
        y: cover.y,
        w: box.width,
        h: box.height,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const next = readDrag(e);
      if (next) setDragPos(next);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const next = readDrag(e);
      dragFrom.current = null;
      setDragPos(null);
      if (next) onCoverCommit?.(next);
    },
    /* 手势被打断（来电、系统手势……）：位置**不落库**，画面退回原来那一段。 */
    onPointerCancel: () => {
      dragFrom.current = null;
      setDragPos(null);
    },
  };

  /* 资料：世界／身份／性别／年龄——压在画上，空的那格不出现。
     六审时它们是四行「标签—细线—值」的对齐表，那正是这张卡像工作牌的地方（表格 ＋
     字段名 ＝ 员工登记表），所以七审把字段名去掉、改成一条连排的值。
     十二审恩熙拿了张官方乙游卡来比（「**我希望介紹應該是像圖2一樣有明顯的裝飾物去呈現
     的呀……現在這樣哪裡有「乙遊」的感覺呢？不就只是一張普通的照片資料嗎？**」）——她要
     的不是「把字段名去掉」，而是**别让资料裸着**：官方卡上字段名是**一枚有底色的小方牌**
     （性別／身份／身高／體重），值跟在牌外。于是恢复字段名，但换成一串牌子（自动换行、
     不画行线、不对齐成表）——是标签串，不是登记表。 */
  const facts = [
    { k: "世界", v: worldName },
    { k: "身份", v: d.occupation || d.tag || "" },
    { k: "性别", v: d.gender || "" },
    { k: "年龄", v: d.age || "" },
  ].filter((f) => f.v);

  /* 标签：编辑页里填的那串关键词（`profile.labels`，逗号分隔）拿到卡面上来（三十三审）。
     恩熙：「**我想加上标签的，就是如果我在编辑页面，我有写上标签，我希望可以在这个
     列表页上面看见的。**」
     为什么不做成又一条 `facts`：资料那排是**字段牌**（蓝底方牌里写着「身份」「性别」），
     标签是**没有字段名的自由词**——所以换一枚圆的签，同一条语言里两种牌分得开。
     卡面位置有限，多了就收进「+n」（悬停/长按能看到全部，与详情页那串标签同一套规矩）。 */
  const tagList = d.labels
    ? d.labels.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <button
      type="button"
      onClick={onClick}
      /* 三十四审：平时挂「长按弹菜单」，进了取景模式换成「拖着照片挪」（见上面那份状态机）。
         iOS 原生的「拷贝／存图」浮层由卡册那一条 `no-callout` 关掉——卡片整块都落在它
         的范围里（样式见 globals.css）。`touchAction` 只在拖动那一刻改成 `none`：
         不这样写，浏览器会把这一下当滚动吞掉，照片跟着不动。 */
      {...(coverEditable ? dragHandlers : pressHandlers)}
      className="relative h-full w-full shrink-0 snap-center overflow-hidden text-left"
      style={{
        background: A.ink,
        boxShadow: A_CARD_SHADOW,
        touchAction: coverEditable ? "none" : "manipulation",
      }}
    >
      {/* ===== 九审（2026-09-19）：卡从「就是那幅画」改回「一张卡纸 ＋ 贴在它上面的一幅」 =====
          八审把卡吃满这一屏（338×518），画也跟着撑满——恩熙当场看出病根：
          **「不能把图片放这么大，放这么大就会看得出来被压缩过，非常的模糊。」**
          一张竖构图被硬拉到五百多高，糊是必然的。
          九审于是给卡**让出上下的卡纸**：画从「出血到边」退回「贴上去的一幅」——四周留边
          （上面留得最多、下面次之），再**整体略往下、略歪一点点**。让出来的两条带正好做事：
          上面是卡头（一道蓝短线 ＋ 英文小标 ＋ 卡号），下面是一道细线与一枚小粉点。
          框、阴影、四角、闪点、名字资料一律不动。尺寸也不再打架：卡高由屏幕给，
          画高＝卡高减去上下两条带，永远比整卡小一圈，图片回到七审那个「不会糊」的大小。 */}

      {/* ===== 甲 卡框：离边 7px 的一圈蓝细线（恩熙要的「边框」） ===== */}
      <span
        className="pointer-events-none absolute inset-[7px]"
        aria-hidden
        style={{ boxShadow: "inset 0 0 0 1px rgba(141,162,230,.30)" }}
      />

      {/* ===== 乙 卡头：左边一道蓝短线 ＋ 一行英文小标，右边卡号 =====
          九审把卡号从画里搬来这里（那一角要还给画自己），顺手补上恩熙说的
          「上面再做一点文字的修饰」——一道蓝短线跟一枚衬线大写小标，卡头就不空了。 */}
      <span
        className="pointer-events-none absolute left-[19px] top-[16px] flex items-center gap-2"
        aria-hidden
      >
        <span className="h-[7px] w-[1.5px]" style={{ background: A.blueLit, opacity: 0.8 }} />
        <em
          className="text-[8.5px] uppercase not-italic"
          style={{ color: "rgba(255,255,255,.5)", fontFamily: A_EN, letterSpacing: ".32em" }}
        >
          archive
        </em>
      </span>
      <span
        className="absolute right-[19px] top-[16px] leading-none tracking-[2px]"
        style={{ color: "rgba(255,255,255,.66)", fontFamily: A_MONO, fontSize: 10 }}
      >
        {displayNumber}
      </span>

      {/* ===== 丙 画：贴在这张卡纸上的一幅（九审的核心改动） =====
          上下左右各让出一段卡纸（上 30px、下 20px、左右 12px），再整体 rotate 1.1°——
          「贴歪一点」既是手工感，也是恩熙点名的那点倾斜。
          二十三审恩熙说「**哎呀，不是按钮放大，是照片放大，宝宝。**」——这一幅于是
          **从上下两头一起长大**：上 42→**30px**、下 26→**20px**，画高多出 18px（约 4.5%）。
          **左右那 12px 收不动**：画转过 1.1°，左边最外那一点（左下角）落在距卡缘约 8.1px，
          而卡框那道蓝细线在 7px——再往里 1px 就压上它了。**上下也已到底**：上边离卡头
          那道蓝短线与小标只剩约 3px，下边离卡尾那枚小粉点（距底 10.5~13.5px）只剩约 2.5px。
          九审那条铁律仍在：**不能再撑到出血**——画永远比卡小一圈，图片才不会被压缩到发糊。 */}
      <div
        className="absolute inset-x-3 bottom-[20px] top-[30px]"
        style={{
          /* 十六审：`translateZ(0)` ＋ `willChange` 是把这一幅**单独提成一层来画**。
             这一层里有好几道 1px 的细线（两道内描边、四角小直角、四角小菱形），
             一旦整层转过 1.1°，浏览器若还让它们跟底下一块光栅化，就会把这些细线
              按屏幕像素一列列地啃——恩熙看到的「坑坑巴巴」正是这么来的。
              提层之后这一层自己按设备像素重新光栅化，斜过来的细线才平滑。 */
          transform: "rotate(1.1deg) translateZ(0)",
          willChange: "transform",
        }}
      >
        {/* ===== ① 画：铺满这一幅 =====
            七审把那圈白边拆了；九审把「整张卡」换成「这一幅」——画仍是这块的主，
            只是不再出血到卡的边。有照片就铺照片；没有就是墨黑场 ＋ 一层很淡的剪影
            （空位也成立，不喊「待补照片」）。 */}
        {d.photo ? (
          <span
            className="absolute inset-0"
            aria-hidden
            style={{
              backgroundImage: `url(${d.photo})`,
              backgroundSize: "cover",
              /* 三十四审：裁到哪一段由 `cover` 定（没调过取景就是 50／50 居中，与从前一样）。 */
              backgroundPosition: `${cover.x}% ${cover.y}%`,
            }}
          />
        ) : (
          <span className="absolute inset-x-[15%] bottom-0 top-[19%]" aria-hidden>
            <FigureSilhouette />
          </span>
        )}

        {/* ===== ② 光影：一道从左上斜下来的柔光 =====
            画因此有「被打到光」的层次，不是平平贴上去的一块色。
            十六审曾在此处叠过一层**人物背光**（radial-gradient，圆心在 50% 30%），
            十七审（后）恩熙一句「**不要这个光**」把它拿掉了——那层同心圆压在人身上，
            照片会发灰发闷；画上有这一道斜光就够，光该是「从哪边来」，不是「一团在背后」。 */}
        <span
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "linear-gradient(148deg, rgba(255,255,255,.17) 0%, rgba(255,255,255,.05) 27%, transparent 54%)",
          }}
        />

        {/* ===== ③ 压暗：底下一层墨往上化开 =====
            名字与资料就压在这上面——有照片时全靠它把字托出来。 */}
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[64%]"
          aria-hidden
          style={{
            background:
              "linear-gradient(to top, rgba(27,25,24,.95) 0%, rgba(27,25,24,.84) 25%, rgba(27,25,24,.46) 58%, transparent 100%)",
          }}
        />

        {/* ===== ④ 这一幅的边：一亮一暗两道内描边 ＋ 一圈落影 =====
            九审多了那圈落影：画是「贴」在卡纸上的，得自己压一道影出来才浮得起来；
            一亮一暗两道仍是七审的——亮的那道是压边的反光，暗的那道把画收住。
            十六审：亮的那道由 .32 提到 **.46**（与四角同浓度）。原因就是恩熙说的
            「坑坑巴巴」——那道白线太淡，压在照片上时，**照片亮的地方看不见、暗的地方
            才看得见**，于是一条本该连续的边走到明暗交界处就断了、忽隐忽现，看着像被啃过。
            提到 .46 之后它在亮处也立得住，这条边才是一整条。 */}
        <span
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            boxShadow:
              "0 12px 26px -10px rgba(0,0,0,.62), inset 0 0 0 1px rgba(255,255,255,.46), inset 0 0 0 3px rgba(27,25,24,.22)",
          }}
        />

        {/* ===== ⑤ 四角：四枚小直角压在这一幅的内缘上（恩熙要的四角） =====
            十六审曾在每只角上加过一枚 6px 的小蓝菱形（`CARD_GEM`），恩熙一看就否了
            （「**不好看不好看**」）——十七审把那四枚整段撤回，角上只留这四道直角线。 */}
        <span className="pointer-events-none absolute inset-[7px]" aria-hidden>
          <span
            style={{ position: "absolute", left: 0, top: 0, width: 13, height: 13, borderLeft: CARD_EDGE, borderTop: CARD_EDGE }}
          />
          <span
            style={{ position: "absolute", right: 0, top: 0, width: 13, height: 13, borderRight: CARD_EDGE, borderTop: CARD_EDGE }}
          />
          <span
            style={{ position: "absolute", left: 0, bottom: 0, width: 13, height: 13, borderLeft: CARD_EDGE, borderBottom: CARD_EDGE }}
          />
          <span
            style={{ position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRight: CARD_EDGE, borderBottom: CARD_EDGE }}
          />
        </span>

        {/* ===== ⑥ 名字与资料：全部压在画上（十二审重排，照官方乙游卡那一套） =====
            九审只把卡号从这里搬去了卡头；名字与资料留在画里——乙游的卡面上，
            这两样从来是**压在图上**的（搬出去就又成工牌了）。
            十二审的动因是恩熙那句「**不就只是一張普通的照片資料嗎？**」——名字与资料
            原先是裸着压在画上的，没有一样东西「装」它们。照她给的官方卡补上三件：
              · 名字左边一道**亮蓝竖杠**（与卡头那道蓝短线同一支笔，把名字这块框起来）；
              · 名字底下另起一行**斜体花体小字**（官方卡上大名底下压着一行细花体罗马字），
                仍然是昵称，但不再并排挤在大名右边；
              · 资料改成**一排带底色的小方牌**（牌里是字段名、牌外是值），自动换行成一条
                标签串——不是六审那张有行线的登记表（见 `facts` 上那段注释）。
            十七审换字：名字与资料值由宋体改霞鹜文楷（`A_ART`），昵称那行是拉丁斜体不动。
            三十三审：资料那排下面再接一行**标签签**（编辑页填的那串关键词，见 `tagList`）。 */}
        <div className="absolute inset-x-0 bottom-0 p-[17px]">
          <div className="flex items-stretch gap-2.5">
            <span
              className="w-[2px] shrink-0"
              style={{ background: A.blueLit, opacity: 0.9 }}
              aria-hidden
            />
            <div className="min-w-0">
              <div
                className="truncate text-[26px] leading-none"
                style={{ color: "#FFFFFF", fontFamily: A_ART, fontWeight: 500, letterSpacing: "2px" }}
              >
                {name}
              </div>
              {d.nickname ? (
                <div
                  className="mt-[5px] truncate text-[9px]"
                  style={{
                    color: "rgba(255,255,255,.5)",
                    fontFamily: A_EN,
                    fontStyle: "italic",
                    letterSpacing: ".24em",
                  }}
                >
                  {d.nickname}
                </div>
              ) : null}
            </div>
          </div>

          {facts.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {facts.map((f) => (
                <span key={f.k} className="flex items-center gap-1.5">
                  <span
                    className="rounded-[1.5px] px-[5px] py-[2px] text-[8px] leading-none"
                    style={{
                      background: "rgba(141,162,230,.22)",
                      color: A.blueLit,
                      letterSpacing: ".14em",
                    }}
                  >
                    {f.k}
                  </span>
                  <span
                    className="text-[10.5px] leading-none"
                    style={{ color: "rgba(255,255,255,.88)", fontFamily: A_ART, letterSpacing: ".5px" }}
                  >
                    {f.v}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          {/* 标签签：跟在资料下面一行（三十三审）。没填标签的档案这一行不存在，
              卡面不会多出一条空行。 */}
          {tagList.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-[5px]">
              {tagList.slice(0, 4).map((tag, i) => (
                <span
                  key={i}
                  className="max-w-[92px] truncate rounded-full border px-[7px] py-[2px] text-[8px] leading-none"
                  style={{
                    borderColor: "rgba(255,255,255,.30)",
                    color: "rgba(255,255,255,.80)",
                    letterSpacing: ".12em",
                  }}
                >
                  {tag}
                </span>
              ))}
              {tagList.length > 4 ? (
                <span
                  className="rounded-full px-[7px] py-[2px] text-[8px] leading-none"
                  style={{ background: "rgba(255,255,255,.88)", color: A.ink }}
                  title={tagList.slice(4).join("、")}
                >
                  +{tagList.length - 4}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ===== 丁 卡尾：一道细线 ＋ 一枚小粉点（恩熙说的「最底下留白的地方塞点样式」） =====
          线是白的、两头渐隐，卡尾因此不是一条硬边；中间那枚粉点仍是全页最小的那点粉。
          十九、二十两审，这条线的右端都缩过一截，把那一角让给卡上的「设为主页」——
          缩的是渐隐的那一头（本来就是化到透明的），所以看不出线「断」了。
          二十一审那枚按钮**搬出了卡片**（落到页面右下角的留白里，见下面那段），
          卡尾上再没有别的东西，线于是**左右一样长**地收回来，两头都在 19px 处渐隐。 */}
      <span
        className="pointer-events-none absolute bottom-[12px] left-[19px] right-[19px] h-px"
        aria-hidden
        style={{
          background:
            "linear-gradient(to right, transparent, rgba(255,255,255,.2) 16%, rgba(255,255,255,.2) 84%, transparent)",
        }}
      />
      <span
        className="pointer-events-none absolute bottom-[10.5px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full"
        aria-hidden
        style={{ background: A.pink, opacity: 0.85 }}
      />

    </button>
  );
}

/* =======================================================================
 * 新增分类弹窗
 * ===================================================================== */

function AddCategoryDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center px-8"
      style={{ background: "rgba(27,25,24,.45)" }}
      onClick={onCancel}
    >
      <div
        className="relative w-full border p-4"
        style={{ borderColor: A.ink, background: A.paper, boxShadow: A_SHADOW, fontFamily: A_SERIF }}
        onClick={(e) => e.stopPropagation()}
      >
        <CropMarks />
        {/* 黑标签页眉：与列表页栏目条同一枚，写「新的一栏」 */}
        <div className="-mx-4 -mt-4 mb-3 flex items-baseline gap-2 px-4 py-1.5" style={{ background: A.label }}>
          <span className="text-[9px] tracking-[.14em] text-white">分类</span>
          <em
            className="text-[8.5px] uppercase"
            style={{ color: "rgba(255,255,255,.55)", fontFamily: A_EN, letterSpacing: ".32em" }}
          >
            new catalog
          </em>
          <span style={A_LEADER} aria-hidden />
        </div>

        <p className="mb-3 text-[12px] tracking-[2px]" style={{ color: A.ink }}>
          新分类
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
            if (e.key === "Escape") onCancel();
          }}
          placeholder="输入分类名称（建议 2–4 字）"
          maxLength={6}
          className="w-full border-b bg-transparent px-1 py-2 text-[13px] outline-none placeholder:text-[#A79D98]"
          style={{ borderColor: A.dash, color: A.ink, writingMode: "horizontal-tb" }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="pressable border px-3 py-1.5 text-[10px] tracking-[1px]"
            style={{ borderColor: A.line, background: A.bg, color: A.ink2 }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => onConfirm(name.trim())}
            className="pressable border px-3 py-1.5 text-[10px] tracking-[1px] text-white disabled:opacity-30"
            style={{ borderColor: A.ink, background: A.label }}
          >
            建立
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================================================================
 * 详情页（排版对齐旧项目：拍立得＋基本信息表＋分区字段＋底部装饰）
 * ===================================================================== */

/** 表单里的**文本**栏位：布尔开关（isAssistant）与取景坐标（coverPos）都不是文本，
 *  不进输入框、也不参与导入匹配，所以一并排除在外。 */
type TextFieldKey = keyof Omit<ContactProfile, "isAssistant" | "coverPos">;

interface FieldDef {
  /* 字段定义只收字符串栏位（理由见上）。 */
  key: TextFieldKey;
  label: string;
  placeholder: string;
}

/** 01 基本信息表（姓名＋昵称同行，其余逐行）。 */
const BASIC_ROWS: FieldDef[] = [
  {
    key: "signature",
    label: "签名",
    /* 用户第一次替他写的签名（之后他在聊天里可以自己改）。留空就显示兜底文案
       「TA 一直都在」——见 apps/chat/shared.ts 的 defaultSignature。 */
    placeholder: "如：今天也在想你",
  },
  { key: "gender", label: "性别", placeholder: "男 / 女 / 未知" },
  { key: "age", label: "年龄", placeholder: "XX岁" },
  { key: "birth", label: "生日", placeholder: "3月15日（年份可省）" },
  { key: "occupation", label: "职业", placeholder: "角色职业" },
  { key: "tag", label: "种族", placeholder: "角色种族" },
  { key: "height", label: "身/重", placeholder: "身高 / 体重" },
  { key: "blood", label: "血型", placeholder: "A / B / O / AB" },
];

/**
 * 02–05 分区（全宽多行字段）。
 *
 * 2026-09-18（1.0.86 恩熙定）：格太多，用户没法精准判断该往哪格填、填不出来那格就
 * 空着，所以细栏位并成三个大格——「一次就能填进去」。原来的 12 格是：
 * 02 角色样貌（外貌／穿衣／标志）＋ 03 性格特点（描述／喜好／厌恶／口头禅／习惯）
 * ＋ 04 背景故事（背景／事件）＋ 05 关系信息（人际关系）＋ 06 互动表现（线上／线下）。
 * 现在：样貌并成「角色详情」、性格＋背景并成「角色人设」、关系不动、线上表现改名
 * 「对话参考」、线下表现先撤（线下还没有实际的东西，等做到了再加）。
 */
const SECTIONS: { no: string; title: string; fields: FieldDef[] }[] = [
  {
    no: "02",
    title: "角色详情",
    fields: [
      {
        key: "looks",
        label: "外貌 · 穿衣 · 标志",
        placeholder:
          "他的外貌、穿衣风格、标志性的特征，都写在这一格，分行写更清楚。\n例：黑发金瞳，身形修长，气质清冷。\n常穿黑色风衣，内搭白衬衫，戴一条银色项链。\n左眼角有一颗小痣，右手戴黑色手环。",
      },
    ],
  },
  {
    no: "03",
    title: "角色人设",
    fields: [
      {
        key: "persona",
        label: "性格 · 喜好 · 经历 · 习惯",
        placeholder:
          "他是什么样的人、这一生经历过什么、喜欢和讨厌什么、有什么口头禅和小习惯——除了外貌，都写在这一格。\n例：性格温和内敛，不擅长跟人打交道，但对熟悉的人很温柔。出身书香门第，父母都是老师，毕业后一个人留在大城市工作。喜欢看书、喝茶，讨厌嘈杂的地方和虚伪的人。口头禅是「真是有趣啊」。思考时喜欢摸下巴。",
      },
    ],
  },
  {
    no: "04",
    title: "角色关系",
    fields: [
      {
        key: "relOther",
        label: "人际关系",
        /* 恩熙定：这一格写的是「人际关系是什么」，不是事件——他有三个室友、父母是谁、
           跟我是什么关系。事件归 03 的角色人设。 */
        placeholder:
          "他和谁是什么关系（家人、朋友、室友……），以及你和他是什么关系。\n例：父母健在，关系有点疏远。有三个室友，和其中一个最亲近。我是他大学时认识的朋友，他一直叫我「小朋友」。",
      },
    ],
  },
  {
    no: "05",
    title: "对话参考",
    fields: [
      {
        key: "onlineStyle",
        label: "对话范例（可留空）",
        /* 用「对话范例」当示例（2026-09-18 恩熙：「我给他看用户跟他的对话范例这种」）——
           她要的就是拿几组真的对话喂给模型学腔调。范例里用「我」指角色自己（这一格
           整段是在告诉模型「你」是什么样的人），别写成「她／他」那种第三人称旁白。 */
        placeholder:
          "对话范例（可照这个格式接着写）：\n用户：在干嘛\n我：写报告呢……别吵\n我：（三分钟后）其实也没很忙，你要说什么\n\n用户：想你了\n我：……嗯\n我：我也是",
      },
    ],
  },
];

/** 旧项目同款日期戳（YYYY.MM.DD）。 */
function formatDate(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

/**
 * 导入 JSON 的栏位别名映射（中英都认，对齐旧项目）。
 * 1.0.86 起多个源栏位并进同一格（旧导出／旧项目里那些细栏位都能落进 looks／persona），
 * 同一格被命中多次就在导入时按行拼起来，不覆盖——见 handleImportFileChange。
 */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["姓名", "名字", "角色名", "name", "characterName", "角色姓名", "名称", "角色名称"],
  nickname: ["昵称", "外号", "别名", "nickname", "alias", "小名", "别称"],
  signature: ["签名", "个性签名", "签名档", "状态签名", "signature", "status"],
  gender: ["性别", "gender", "sex"],
  age: ["年龄", "age"],
  birth: ["生日", "出生日期", "出生年月", "诞生日", "birth", "birthday", "birthDate"],
  occupation: ["职业", "工作", "occupation", "job", "career", "身份", "职位"],
  tag: ["种族", "种族标签", "tag", "race", "species", "族裔"],
  labels: ["标签", "标签串", "labels", "关键词", "keywords"],
  height: ["身高", "身高/体重", "height", "heightWeight", "身高体重", "身材"],
  blood: ["血型", "blood", "bloodType"],
  looks: [
    "外貌特征", "外貌", "特征", "feature", "appearance", "looks", "外形", "长相",
    "穿衣风格", "穿着", "服饰", "clothes", "clothing", "outfit", "style", "穿搭", "衣着",
    "标志性特征", "标志", "特征标记", "mark", "distinguishingFeature", "特殊标记", "印记",
    "角色详情",
  ],
  persona: [
    "性格详细描述", "性格", "描述", "desc", "description", "personality", "character", "性格描述", "人物性格",
    "喜好", "喜欢", "爱好", "likes", "hobbies", "favorite", "兴趣", "喜好爱好",
    "厌恶", "讨厌", "不喜欢", "hates", "dislikes", "hate", "雷点", "讨厌的东西",
    "口头禅", "口癖", "phrase", "catchphrase", "petPhrase", "经典台词", "常用语",
    "习惯", "习性", "habit", "habits", "小习惯", "行为习惯",
    "角色背景", "背景", "背景故事", "storyBg", "background", "backstory", "storyBackground", "人物背景", "出身",
    "重要事件", "经历", "事件", "storyEvent", "events", "importantEvents", "experience", "人生经历", "过往",
    "人设", "角色人设",
  ],
  relOther: ["人际关系", "关系", "人脉", "relOther", "relationships", "relations", "otherRelationships", "社会关系", "人物关系"],
  onlineStyle: [
    "线上表现", "线上风格", "线上互动", "线上", "onlineStyle", "online", "打字风格", "聊天风格",
    "线下表现", "线下风格", "线下互动", "线下", "offlineStyle", "offline", "见面风格", "相处方式",
    "对话参考", "对话范例", "范例",
  ],
  customTitle: ["自定义标题", "补充标题", "customTitle", "自定义名称", "补充名称", "其他标题"],
  customContent: ["自定义内容", "补充内容", "customContent", "自定义补充", "补充信息", "其他内容"],
  photo: ["照片", "头像", "图片", "photo", "avatar", "image", "picture", "角色照片", "立绘"],
};

function ArchiveDetail({
  entry,
  displayNumber,
  categories,
  onMove,
  onBack,
  onDelete,
}: {
  entry: ArchiveEntry;
  displayNumber: string;
  categories: ArchiveCategory[];
  onMove: (categoryId: string) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const [profile, setProfile] = useState<ContactProfile>(entry.data);
  /* 所属栏目（＝恩熙说的「世界」）。单独存一份本地值：换栏是立刻落库的，
     与下面那段 300ms 防抖的正文自动存盘不是一回事。 */
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [editMode, setEditMode] = useState(false);
  /* 二十八审：一次只给一屏。选中的是哪一栏，下面就只出现那一栏（DETAIL_TABS）。 */
  const [tab, setTab] = useState("01");
  const [importMsg, setImportMsg] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const savingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editMode) return;
    const timer = setTimeout(async () => {
      savingRef.current = true;
      try {
        await saveArchive(entry.id, profile);
      } finally {
        savingRef.current = false;
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editMode, profile, entry.id]);

  const updateField = useCallback(
    (key: TextFieldKey, value: string) => {
      setProfile((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /** 照片上传：FileReader → canvas 压缩（最宽 1080px，JPEG 0.8）→ data URL。
      十三审：恩熙问「**那能不能做到，就是只有档案的图？图片不去做太多的压缩呢？**」
      ——能。档案照片的压缩**只有这一处**：聊天那边的头像与图片各有各的压缩
      （ChatSettingsPanel / media-asset / MinePage），动这里不会波及它们。
      原先的最宽 300px 就是「图糊」的病根：卡上那一幅在 3 倍屏上要 846×1350 真实
      像素，300 宽的源图只能往上插值。提到 1080 之后，一张 3:2 的竖图出来约
      1080×1620，正把那一幅盖住还留余量——从此是**缩下来**，不是放上去。 */
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = 1080;
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            updateField("photo", canvas.toDataURL("image/jpeg", 0.8));
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  /** 导入 JSON：智能栏位匹配后填入当前编辑数据（对齐旧项目逻辑）。 */
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let msg: string;
      try {
        const imported = JSON.parse(event.target?.result as string) as Record<string, unknown>;

        // 找到真正的数据对象（支持 data／character／archive／profile 巢状或根层）。
        let dataObj: Record<string, unknown> = {};
        if (imported.data && typeof imported.data === "object") dataObj = imported.data as Record<string, unknown>;
        else if (imported.character && typeof imported.character === "object") dataObj = imported.character as Record<string, unknown>;
        else if (imported.archive && typeof imported.archive === "object") dataObj = imported.archive as Record<string, unknown>;
        else if (imported.profile && typeof imported.profile === "object") dataObj = imported.profile as Record<string, unknown>;
        else dataObj = imported;

        // 栏位智能匹配（直接命中 → 别名命中），未匹配的收集起来。
        /* 只匹配字符串栏位（isAssistant 布尔开关在导入时跳过，不会被覆盖成字符串）。 */
        const matched: Partial<Record<TextFieldKey, string>> = {};
        const unmatched: string[] = [];
        /* 1.0.86：多个源栏位并进同一格（外貌／穿衣／标志 → looks，描述／喜好／口头禅…… → persona），
           同一格被命中多次就按行拼起来，不能后一个盖掉前一个——旧导出里的细栏目才不会丢。 */
        const push = (key: string, value: string) => {
          const cur = (matched as Record<string, string>)[key];
          (matched as Record<string, string>)[key] = cur ? `${cur}\n${value}` : value;
        };
        Object.entries(dataObj).forEach(([key, value]) => {
          if (typeof value !== "string" && typeof value !== "number") return;
          const strValue = String(value);
          if (key in FIELD_ALIASES) {
            push(key, strValue);
          } else {
            const aliasTarget = Object.entries(FIELD_ALIASES).find(([, aliases]) =>
              aliases.some((a) => a.toLowerCase() === key.toLowerCase()),
            )?.[0];
            if (aliasTarget) {
              push(aliasTarget, strValue);
            } else {
              unmatched.push(`${key}：${strValue}`);
            }
          }
        });

        if (Object.keys(matched).length === 0 && unmatched.length === 0) {
          msg = "导入失败：文件中没有可识别的栏位";
        } else {
          // 未匹配栏位自动汇入自订补充区（保留原 key，不丢数据）。
          if (unmatched.length > 0) {
            const existing = matched.customContent ?? profile.customContent;
            const existingLines = existing
              ? existing.split("\n").filter((l) => l.trim())
              : [];
            matched.customContent = [...existingLines, ...unmatched].join("\n");
            if (!matched.customTitle && !profile.customTitle) {
              matched.customTitle = "导入补充";
            }
          }
          setProfile((prev) => ({ ...prev, ...matched }));
          setEditMode(true);
          const matchedCount = Object.keys(matched).length;
          msg =
            unmatched.length > 0
              ? `记忆导入成功 · 匹配 ${matchedCount} 栏位，${unmatched.length} 项已存入自订补充`
              : `记忆导入成功 · 匹配 ${matchedCount} 个栏位`;
        }
      } catch {
        msg = "导入失败：文件格式不正确";
      }
      setImportMsg(msg);
      setTimeout(() => setImportMsg(""), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleBack = () => {
    if (editMode) {
      saveArchive(entry.id, profile).then(onBack);
    } else {
      onBack();
    }
  };

  /** 导出记忆：与旧项目同格式（含 exportVersion），可直接再导入。 */
  const handleExport = () => {
    const exportData = {
      id: entry.id,
      name: profile.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      categoryId: entry.categoryId,
      data: profile,
      exportTime: new Date().toISOString(),
      exportVersion: "1.0",
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = `${profile.name || "未命名角色"}_档案_${new Date().toISOString().slice(0, 10)}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** 删除：弹窗确认。 */
  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const headerRight = (
    <div className="flex items-center gap-1.5">
      {/* 导入记忆（JSON） */}
      <button
        type="button"
        onClick={() => importInputRef.current?.click()}
        aria-label="导入记忆"
        title="导入记忆（JSON）"
        className="pressable flex h-7 w-7 items-center justify-center rounded-[3px] border"
        style={{ borderColor: A.line, background: A.paper, color: A.ink2 }}
      >
        <Upload size={11} strokeWidth={2} />
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFileChange}
      />

      {editMode ? (
        <button
          type="button"
          onClick={() => setEditMode(false)}
          className="pressable flex h-7 items-center gap-1 rounded-[3px] px-3 text-[9px] tracking-[1px] text-white"
          style={{ background: A.label }}
        >
          <Save size={11} strokeWidth={2} />
          完成
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditMode(true)}
          className="pressable flex h-7 items-center gap-1 rounded-[3px] px-3 text-[9px] tracking-[1px] text-white"
          style={{ background: A.label }}
        >
          <Edit3 size={11} strokeWidth={2} />
          编辑
        </button>
      )}
    </div>
  );

  const labelList = profile.labels
    ? profile.labels.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : [];

  /** 可以换到的栏目：内建「已唤醒」＋ 自订分类（「全部」是视图，不是归宿，故不在列）。 */
  const moveTargets = [{ id: DEFAULT_CATEGORY_ID, name: "已唤醒" }, ...categories];

  /** 三十四审（续）恩熙定案：**六枚栏目按钮永远都在，缺的那一栏点进去写着「待解密」。**
   *  她说「**我希望我点进去这个档案里面，即便是我没有填写的地方，但它依旧会显示出来，
   *  只是它会显示我没有填写，你懂吧？就是左边的按钮，它是不会消失的。**」
   *  ⇒ 二十八审那套「有值才排进页签」（`tabHasContent` ＋ `visibleTabs`）整段退场：
   *  栏目是这本档案的**目录**，目录就该齐全；缺的那一栏是「还没填」，不是「不存在」。 */
  const activeTab = DETAIL_TABS.some((t) => t.id === tab) ? tab : "01";

  return (
    <AppChrome
      title="档案"
      titleEn="CONTACTS"
      theme="file"
      headerRight={headerRight}
      onBack={handleBack}
    >
      {/* 导入结果提示（4 秒后自动消失）：像刊物上贴的一张校样便条 */}
      {importMsg ? (
        <div
          className="mb-3 flex items-center gap-2 border-l-2 px-2.5 py-1.5 text-[9px] tracking-[1px]"
          style={{
            borderLeftColor: importMsg.includes("成功") ? A.blue : A.ink,
            background: importMsg.includes("成功") ? A.blueWash : "rgba(27,25,24,.05)",
            color: importMsg.includes("成功") ? A.blueDeep : A.ink2,
            fontFamily: A_SERIF,
          }}
        >
          <span style={A_EN_SMALL}>{importMsg.includes("成功") ? "imported" : "notice"}</span>
          <span className="min-w-0 flex-1">{importMsg}</span>
        </div>
      ) : null}

      {/* ===== 大照片：这一页的封面（二十八审立，二十九审改「不裁切」，三十审加框）=====
          恩熙看过 1.1.29 后说：「**照片，主要是这个格式不好，因为这个照片都会被去裁切掉**，
          你懂吧？这样还是好像公文啊。」——她说得准，原来这里是**固定 340px 高、
          铺满裁切的画框**（`center/cover`）：一是竖着拍的人像必然被裁掉大半张；
          二是「照片框成一条、名字压在照片上」正是**证件照／档案卡**的语法，所以才像公文。
          接着她又说：「**这个照片的边框啊也可以设计一下啊，对不对？既然是乙游，
          就可以大胆一点的设计 UI 啊。**」于是这一块定成一张「**相纸**」：
          ① 照片**按自己的比例完整显示**（`<img>` 配 `maxHeight`），一张都不裁——只有
             特别长的那种才整张缩进框里，空出来的边用纸色补，像贴在册页上的照片；
          ② **名字在照片下面**——照片归照片、字归字，这是乙游立绘页的读法；
          ③ 框用**相纸的语法，不用户籍卡的语法**：米白相纸留一圈边（`p-[10px]`）、
             整块**极轻地歪一点**（`rotate(-0.6deg)`，像随手贴上去的）、照片上压
             **一道靛蓝细线**（与列表卡同一套「蓝细线卡框」）、`NO.xx` 做成**黑标签贴**
             压在右下角（与页签选中那枚同是 `A_CHIP`）。
             ⇒ 四色照旧：白是相纸、黑是标签、蓝是那道细线、粉只点一枚小点。 */}
      <div className="relative mt-1" style={{ transform: "rotate(-0.6deg)" }}>
        <div
          onClick={() => {
            if (editMode) fileInputRef.current?.click();
          }}
          className="p-[10px]"
          style={{
            background: A.paper,
            boxShadow: A_SHADOW,
            cursor: editMode ? "pointer" : "default",
          }}
        >
          <div
            className="relative flex w-full items-center justify-center text-[22px]"
            style={{ background: "rgba(27,25,24,.05)", color: A.ink3 }}
          >
            {profile.photo ? (
              /* 不裁切：宽占满，高由照片自己定，最高不超过大半屏（58vh） */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photo}
                alt=""
                className="block h-auto w-full"
                style={{ maxHeight: "58vh", objectFit: "contain" }}
              />
            ) : (
              <div className="flex h-[220px] w-full items-center justify-center">◈</div>
            )}

            {/* 蓝细线卡框：与列表卡同一道，贴着照片内沿走一圈 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ border: `1px solid ${A.blue}` }}
            />

            {/* NO.xx：黑标签贴，压在照片右下角（一半在画上、一半在相纸上） */}
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-[8px] right-3"
              style={A_CHIP}
            >
              NO.{displayNumber}
            </span>

            {editMode ? (
              <div
                className="absolute bottom-1.5 left-2 text-[7px] tracking-[1px]"
                style={{
                  background: "rgba(255,255,255,.78)",
                  color: A.ink2,
                  padding: "1px 4px",
                  borderRadius: 2,
                }}
              >
                {profile.photo ? "点击更换" : "点击上传"}
              </div>
            ) : null}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />
      </div>

      {/* 名字：照片下面一行（二十九审从画上挪下来）——题头一道蓝短线 ＋ 一枚粉点，
          再是名字（文楷）与昵称；**标签小签挂到名字右边**（三十一审）。
          恩熙说：「**下面的地方我感觉也得需要重新设计跟排版。**」她点出的第一处是
          「名字下面紧贴一排标签小签、再下面又是页签条——**两排小签上下贴着，分不清谁是谁**」。
          根子是**两组长得一样**（都是白底细边小签）、又离得太近。所以标签挪到名字这一行，
          页签条下面从此只剩页签自己。 */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-[2px] w-6" style={{ background: A.blue }} />
          <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: A.pink }} />
        </div>
        <div className="mt-1.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[26px] leading-tight" style={{ color: A.ink, fontFamily: A_ART }}>
              {profile.name || "待解密"}
            </div>
            {profile.nickname ? (
              <div
                className="mt-0.5 truncate text-[10px] tracking-[1px]"
                style={{ color: A.ink2, fontFamily: A_SERIF }}
              >
                {profile.nickname}
              </div>
            ) : null}
          </div>
          {/* 标签小签：挂在名字右边（三十一审从名字下面挪上来）。浏览态没填就不占地方；
              编辑态的输入框在下面单独一行（够宽好填），这里只给浏览态。 */}
          {!editMode && labelList.length > 0 ? (
            <div className="flex max-w-[46%] shrink-0 flex-wrap justify-end gap-[4px] pt-1.5">
              {labelList.slice(0, 6).map((tag, i) => (
                <span
                  key={i}
                  className="inline-block max-w-full truncate border px-1.5 py-[2px] text-[8px] tracking-[1px]"
                  style={{ borderColor: A.line, background: A.paper, color: A.ink2 }}
                >
                  {tag}
                </span>
              ))}
              {labelList.length > 6 ? (
                <span
                  className="inline-block px-1.5 py-[2px] text-[8px] tracking-[1px]"
                  style={{ background: A.label, color: "#FFFFFF" }}
                  title={labelList.slice(6).join("、")}
                >
                  +{labelList.length - 6}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* 标签输入框（编辑态）：留在名字块下面单独一行 */}
      {editMode ? (
        <input
          type="text"
          value={profile.labels}
          onChange={(e) => updateField("labels", e.target.value)}
          placeholder="标签，逗号分隔"
          className="mt-2 w-full border-b bg-transparent px-0.5 py-[3px] text-[8px] tracking-[1px] outline-none placeholder:text-[#A79D98]"
          style={{ borderColor: A.dash, color: A.ink, fontFamily: A_SERIF }}
        />
      ) : null}

      {/* ===== 从这一行起分成左右两栏：左＝菜单，右＝这一栏的内容（三十一审）=====
          恩熙：「**我觉得分类是不是可以在左边，然后做成像圆形按钮的感觉？**」又说
          「**右边内容区的部分。它依旧是居中，但我的居中是指它单独内容区的居中**」
          ⇒ 左边一条墨黑窄带竖排，右边的内容**在它自己那块地方里**居中（不是相对整屏）。
          菜单照旧按 `DETAIL_TABS` 排（六栏永远都在，缺的那一栏点进去写「待解密」）。 */}
      <div className="mt-5 flex items-start gap-3">
        <nav
          className="flex w-[66px] shrink-0 flex-col gap-[2px]"
          style={A_MENU_BAND}
          aria-label="档案栏目"
        >
          {DETAIL_TABS.map((t) => {
            const on = t.id === activeTab;
            const Icon = t.Icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="pressable flex w-full flex-col items-center gap-[3px] rounded-[4px] px-1 py-[7px]"
                style={{ background: on ? "rgba(255,255,255,.14)" : "transparent" }}
                aria-pressed={on}
              >
                <Icon size={15} strokeWidth={1.5} color={on ? A_MENU_ON : A_MENU_OFF} />
                <span className="text-[9px] tracking-[2px]" style={{ color: on ? A_MENU_ON : A_MENU_OFF }}>
                  {t.label}
                </span>
                <em
                  className="text-[6px] not-italic uppercase"
                  style={{
                    fontFamily: A_EN,
                    letterSpacing: ".14em",
                    color: on ? A_MENU_ON : A_MENU_OFF,
                    opacity: on ? 0.7 : 0.55,
                  }}
                >
                  {t.en}
                </em>
              </button>
            );
          })}
        </nav>

        {/* 右边：这一栏的内容。`min-w-0` 是给里面那些 truncate 的字段留退路的。 */}
        <div className="min-w-0 flex-1">

      {/* ===== 这一栏（一次只给一屏：选中哪一栏，下面就只出现那一栏）===== */}
      {activeTab === "01" ? (
        <section>
          {/* 三十一审：**栏头撤了**。左边菜单上已经写着「资料 · particulars」，下面再报一遍
              「01 基本信息 · particulars」是同一句话说两遍，乙游里不这么啰嗦。
              登记表则从「目录」改成**居中排的「标签 · 值」**（恩熙选定的样式一）：原来
              标签顶最左、值甩到最右、中间一串点线引过去，那是**查目录**的语法；现在一条
              资料自己占一行、从中间往下排——读法从「翻目录」变成「一行一条资料」。 */}
          <div>
            {/* 姓名、昵称（三十一审：从「一行两栏」改成各占一行、居中排） */}
            <RegLine label="姓名">
              {editMode ? (
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="角色姓名"
                  className="w-[52%] min-w-0 bg-transparent text-center text-[11px] outline-none placeholder:text-[#A79D98]"
                  style={{ color: A.ink, fontFamily: A_SERIF }}
                />
              ) : (
                <span
                  className="min-w-0 truncate text-[11px]"
                  style={{ color: profile.name ? A.ink : A.ink3, fontFamily: A_SERIF }}
                >
                  {profile.name || "待解密"}
                </span>
              )}
            </RegLine>
            <RegLine label="昵称">
              {editMode ? (
                <input
                  type="text"
                  value={profile.nickname}
                  onChange={(e) => updateField("nickname", e.target.value)}
                  placeholder="角色昵称"
                  className="w-[52%] min-w-0 bg-transparent text-center text-[11px] outline-none placeholder:text-[#A79D98]"
                  style={{ color: A.ink, fontFamily: A_SERIF }}
                />
              ) : (
                <span
                  className="min-w-0 truncate text-[11px]"
                  style={{ color: profile.nickname ? A.ink : A.ink3, fontFamily: A_SERIF }}
                >
                  {profile.nickname || "待解密"}
                </span>
              )}
            </RegLine>

            {/* 其余基本信息行（三十一审：同一条骨架，居中排） */}
            {BASIC_ROWS.map((row) => {
              const value = profile[row.key];
              return (
                <RegLine key={row.key} label={row.label}>
                  {editMode ? (
                    <input
                      type="text"
                      value={value ?? ""}
                      onChange={(e) => updateField(row.key, e.target.value)}
                      placeholder={row.placeholder}
                      className="w-[52%] min-w-0 bg-transparent text-center text-[11px] outline-none placeholder:text-[#A79D98]"
                      style={{ color: A.ink, fontFamily: A_SERIF }}
                    />
                  ) : (
                    <span
                      className="min-w-0 truncate text-[11px]"
                      style={{ color: value ? A.ink : A.ink3, fontFamily: A_SERIF }}
                    >
                      {value || "待解密"}
                    </span>
                  )}
                </RegLine>
              );
            })}

            {/* 栏目（恩熙说的「世界」）：一个分类就是一个世界 =====
                以前角色一建进某栏就再也出不来（saveArchive 不写 categoryId、moveArchive
                全项目没人调用）。这里把换栏接上：点一下立刻落库，不等上面那段正文防抖存盘。
                编辑态给整排栏目当选项、浏览态只报当前所属——「我的名册」从此可以改。 */}
            <RegLine label="栏目">
              <span className="min-w-0 truncate text-[11px]" style={{ color: A.ink, fontFamily: A_SERIF }}>
                {moveTargets.find((t) => t.id === categoryId)?.name ?? "已唤醒"}
              </span>
            </RegLine>

            {/* 更新（原来是封底编目条上的那句「最后更新」，编目条退场后收进登记表） */}
            <RegLine label="更新">
              <span className="min-w-0 truncate text-[10px]" style={{ color: A.ink3, fontFamily: A_MONO }}>
                {formatDate(entry.updatedAt)}
              </span>
            </RegLine>
          </div>

          {editMode ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {moveTargets.map((t) => {
                const on = t.id === categoryId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (on) return;
                      setCategoryId(t.id);
                      onMove(t.id);
                    }}
                    className="pressable border px-2 py-1 text-[9px] tracking-[1px]"
                    style={{
                      borderColor: on ? A.label : A.line,
                      background: on ? A.label : A.paper,
                      color: on ? "#FFFFFF" : A.ink2,
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* AI 助手模式（聊天时不扮演角色：服从指令、要求发图就发） */}
          <div
            className="mt-2 flex items-center justify-between border px-2 py-1.5"
            style={{
              borderColor: profile.isAssistant ? A.label : A.line,
              background: profile.isAssistant ? "rgba(27,25,24,.045)" : A.paper,
            }}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] tracking-[1px]" style={{ color: A.ink2 }}>
                AI 助手模式
              </span>
              <em style={A_EN_SMALL}>assistant</em>
            </div>
            {editMode ? (
              <button
                type="button"
                onClick={() => setProfile((prev) => ({ ...prev, isAssistant: !prev.isAssistant }))}
                className="pressable flex items-center gap-1.5"
                aria-label="切换 AI 助手模式"
              >
                <span
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{
                    background: profile.isAssistant ? A.label : "transparent",
                    border: `1px solid ${profile.isAssistant ? A.label : A.dash}`,
                  }}
                />
                <span
                  className="text-[8px] tracking-[1px]"
                  style={{ color: profile.isAssistant ? A.ink : A.ink3 }}
                >
                  {profile.isAssistant ? "已启用" : "关闭"}
                </span>
              </button>
            ) : (
              <span
                className="text-[8px] tracking-[1px]"
                style={{ color: profile.isAssistant ? A.ink : A.ink3 }}
              >
                {profile.isAssistant ? "已启用" : "关闭"}
              </span>
            )}
          </div>
          {/* 助手模式的说明（三十二审恩熙：「**就是要让人家知道这个 AI 助手是什么意思**」）
              ——以前只在**启用时**才冒出来，没开过的人根本不知道这开关干嘛。现在**常驻**一行，
              开没开都挂着；右边已经写着「已启用／关闭」，这里就不再重复状态，只说它是干什么的。 */}
          <div className="mt-1 text-[7.5px] leading-relaxed tracking-[0.5px]" style={{ color: A.ink2 }}>
            开启后，与 TA 聊天时不扮演角色：服从指令、要发照片就发；其余档案栏位仅供参考。
          </div>
        </section>
      ) : null}

      {/* ===== 02–05：各自一栏，只有当前那一栏会被渲染出来 =====
          三十一审：**栏头撤了**（与 01 同一条理由）——左边菜单上写着「详情 · appearance」，
          下面再报一遍「02 角色详情 · appearance」是同一句话说两遍。正文也跟着松开：原来
          每段左边按一道竖线、段前点一枚墨方点（表格格眼、公文味），现在去掉竖线、方点换成
          粉点——四色纪律里「粉只做小点」，正好落在这里。小标题居中，正文仍左对齐。 */}
      {SECTIONS.filter((s) => s.no === activeTab).map((section) => (
        <section key={section.no}>
          <div
            className="border px-3 pb-2.5 pt-2"
            style={{ borderColor: A.line, background: A.paper, boxShadow: A_SHADOW, ...A_GRAIN }}
          >
            {section.fields.map((field, i) => {
              /* ?? "" 不能省：旧档案没有后来新增的栏位（如 1.0.69 才有的线上／线下表现），
                 取出来是 undefined，下面的 value.trim() 会当场抛错（同 BASIC_ROWS 那侧的写法）。 */
              const value = profile[field.key] ?? "";
              return (
                <div key={field.key} className={i < section.fields.length - 1 ? "mb-2.5" : ""}>
                  {/* 小标题**居中**（三十一审）；下面的正文仍旧左对齐——成段的字居中会
                      一行行忽长忽短，读不成句。 */}
                  <div className="mb-1 flex items-center justify-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: A.pink }}
                    />
                    <span className="text-[9px] tracking-[1px]" style={{ color: A.ink2 }}>
                      {field.label}
                    </span>
                  </div>
                  {editMode ? (
                    <FixedTextarea
                      value={value ?? ""}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full resize-none bg-transparent text-[12px] leading-[1.8] outline-none placeholder:text-[#A79D98]"
                      style={{ color: A.ink, fontFamily: A_SERIF }}
                    />
                  ) : (
                    <div
                      /* whitespace-pre-wrap：1.0.86 的合并格（详情／人设）本来就是多行的，
                         浏览态不保留换行会挤成一整坨（编辑态是 textarea，不受影响）。 */
                      className="inline-block whitespace-pre-wrap pb-0.5 text-[12px] leading-[1.8]"
                      style={{
                        color: value ? A.ink : A.ink3,
                        fontFamily: A_SERIF,
                      }}
                    >
                      {value || "待解密"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* ===== 07 自定义补充（三十四审续：六栏永远都在，这一栏没填也照样能点进来看） =====
          三十一审：编号与拉丁小标撤了（左边菜单上写着「补充 · appendix」），但**标题本身
          留着**——那是恩熙自己起的名字，别处没有落脚点（`promptBuilder` 里还要用它把这段
          内容端给模型），所以只把重复的「07 · appendix」去掉。 */}
      {activeTab === "07" ? (
        <section>
          <div className="mb-2 flex items-baseline justify-center gap-1.5 pb-1" style={A_HEAD_LINE}>
            <span
              aria-hidden
              className="inline-block h-[5px] w-[5px] shrink-0 self-center rounded-full"
              style={{ background: A.pink }}
            />
            {editMode ? (
              <input
                type="text"
                value={profile.customTitle}
                onChange={(e) => updateField("customTitle", e.target.value)}
                placeholder="自定义标题"
                className="min-w-12 flex-1 bg-transparent text-[10px] tracking-[1px] outline-none placeholder:text-[#A79D98]"
                style={{ color: A.ink }}
              />
            ) : (
              <span className="truncate text-[10px] tracking-[1px]" style={{ color: A.ink }}>
                {profile.customTitle || "待补充"}
              </span>
            )}
          </div>
          <div
            className="border px-3 pb-2.5 pt-2"
            style={{ borderColor: A.line, background: A.paper, boxShadow: A_SHADOW, ...A_GRAIN }}
          >
            {editMode ? (
              <FixedTextarea
                value={profile.customContent}
                onChange={(e) => updateField("customContent", e.target.value)}
                placeholder="输入自定义内容..."
                className="w-full resize-none bg-transparent text-[12px] leading-[1.8] outline-none placeholder:text-[#A79D98]"
                style={{ color: A.ink, fontFamily: A_SERIF }}
              />
            ) : (
              <div
                className="whitespace-pre-wrap text-[12px] leading-[1.8]"
                style={{
                  color: profile.customContent ? A.ink : A.ink3,
                  fontFamily: A_SERIF,
                }}
              >
                {profile.customContent || "待解密"}
              </div>
            )}
          </div>
        </section>
      ) : null}
        </div>
      </div>

      {/* ===== 底部操作：两句话，中间隔一道短竖线 =====
          三十一审：原来这里是两个 `h-9` 的大方框并排，跟上面满页的细字比，太重了
          ——像表单最后那排「提交／重置」。现在收成一排小字，各带一枚小图标；
          删除仍是全册唯一一点印章红（只给不可复原的事）。 */}
      <div
        className="mt-6 flex items-center justify-center gap-4 border-t pt-3.5"
        style={{ borderColor: A.lineSoft }}
      >
        <button
          type="button"
          onClick={handleExport}
          className="pressable flex items-center gap-1.5 text-[9px] tracking-[2px]"
          style={{ color: A.ink2 }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出记忆
        </button>
        <span aria-hidden className="h-3 w-px" style={{ background: A.line }} />
        {/* 删除是唯一盖红章的事：纸白底 ＋ 印章红的字。 */}
        <button
          type="button"
          onClick={handleDeleteClick}
          className="pressable flex items-center gap-1.5 text-[9px] tracking-[2px]"
          style={{ color: A.seal }}
        >
          <Trash2 size={10} strokeWidth={2} />
          删除档案
        </button>
      </div>

      {/* 删除确认弹窗：纸面 ＝ 与删除分类同一枚，且这是全册唯一敢盖红章的地方 */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center px-8"
          style={{ background: "rgba(27,25,24,.45)" }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="relative w-full border p-4"
            style={{ borderColor: A.ink, background: A.paper, boxShadow: A_SHADOW, fontFamily: A_SERIF }}
            onClick={(e) => e.stopPropagation()}
          >
            <CropMarks />
            <div className="-mx-4 -mt-4 mb-3 flex items-baseline gap-2 px-4 py-1.5" style={{ background: A.label }}>
              <span className="text-[9px] tracking-[.14em] text-white">档案</span>
              <em
                className="text-[8.5px] uppercase"
                style={{ color: "rgba(255,255,255,.55)", fontFamily: A_EN, letterSpacing: ".32em" }}
              >
                dispose
              </em>
              <span style={A_LEADER} aria-hidden />
              <span className="text-[8px] text-white/60" style={{ fontFamily: A_MONO }}>
                {profile.name || "未命名"}
              </span>
            </div>

            <p className="mb-2 text-[12px] tracking-[2px]" style={{ color: A.ink }}>
              删除档案
            </p>
            <p className="mb-4 text-[10px] leading-relaxed" style={{ color: A.ink2 }}>
              确定要删除「{profile.name || "未命名"}」吗？
              <br />
              此操作无法复原，建议先导出记忆备份。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="pressable border px-3 py-1.5 text-[10px] tracking-[1px]"
                style={{ borderColor: A.line, background: A.bg, color: A.ink2 }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="pressable border px-3 py-1.5 text-[10px] tracking-[1px]"
                style={{ borderColor: A.seal, background: A.paper, color: A.seal }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editMode ? (
        <div className="flex justify-center text-[8px] tracking-[1px]" style={{ color: A.ink3 }}>
          编辑中 · 离开本页前请先点「完成」
        </div>
      ) : null}
    </AppChrome>
  );
}

/* =======================================================================
 * 顶层：列表／详情／弹窗状态切换
 * ===================================================================== */

export function ContactsApp() {
  const [archives, setArchives] = useState<ArchiveEntry[] | null>(null);
  const [categories, setCategories] = useState<ArchiveCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(DEFAULT_CATEGORY_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([getArchives(), getCategories()]);
      setArchives(list);
      setCategories(cats);
      setLoadError(null);
    } catch (err) {
      // 静默失败会永远卡「载入中」，报出原因才好排查（如手机非安全上下文缺 API）。
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // 挂载时从 IndexedDB（外部系统）载入，属於 effect 的正当用途。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (!archives) {
    return (
      <AppChrome title="档案" titleEn="CONTACTS" theme="file">
        <div className="mt-20 text-center text-[12px]" style={{ color: A.ink3 }}>
          {loadError ? (
            <>
              <div style={{ color: A.seal }}>载入失败</div>
              <div className="mt-2 break-all text-[9px] tracking-[0.5px]">{loadError}</div>
              <button
                type="button"
                onClick={() => refresh()}
                className="pressable mt-4 border px-3 py-1.5 text-[9px] tracking-[1px]"
                style={{ borderColor: A.line, background: A.paper, color: A.ink2 }}
              >
                重试
              </button>
            </>
          ) : (
            <span style={A_EN_SMALL}>opening the file…</span>
          )}
        </div>
      </AppChrome>
    );
  }

  // 唤醒一份新档案，直接进详情编辑。
  const handleWake = async () => {
    // 新档案落进当前这一栏（停在「已唤醒」时就是"还没归世界"，之后再在详情页换）。
    const entry = await createArchive(selectedCategoryId);
    await refresh();
    setSelectedId(entry.id);
  };

  const handleAddCategory = async (name: string) => {
    const updated = await addCategory(name);
    setCategories(updated);
    setShowAddCategory(false);
  };

  const handleCategoryDeleted = async (id: string) => {
    await deleteCategory(id);
    if (selectedCategoryId === id) setSelectedCategoryId(DEFAULT_CATEGORY_ID);
    await refresh();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    await deleteArchive(selectedId);
    setSelectedId(null);
    await refresh();
  };

  /** 设为主页（十九审）：把这条档案挪到卡册第一位。翻回第一页的动作在 `ArchiveList`
   *  里做——那里才拿得到卡册那个滚动容器。 */
  const handleSetHome = async (id: string) => {
    setArchives(await setArchiveHome(id));
  };

  /** 手动排序（三十四审）：把这条档案挪到邻居的前／后一位，落库后把新次序递回列表。
   *  恩熙：「**这样子我可以自己去编辑我想要的角色顺序。**」 */
  const handleReorder = async (id: string, neighborId: string, place: "before" | "after") => {
    setArchives(await moveArchiveNear(id, neighborId, place));
  };

  /** 取景落库（三十四审）：只动这一条的 `coverPos`，别的字段一个字不碰。
   *  先写进本地那份再落库——手指刚松开的那一瞬卡面还是新位置，若等库回来才更新，
   *  中间那一下会**闪回旧取景**再跳过去。取景是一次很小的编辑，不值得为它重读整库。
   *  走 `saveArchive` 是因为取景本来就长在 `profile` 上，没有第二条写库的路。 */
  const handleCoverPos = async (id: string, pos: { x: number; y: number }) => {
    const target = archives.find((a) => a.id === id);
    if (!target) return;
    setArchives((prev) =>
      prev
        ? prev.map((a) => (a.id === id ? { ...a, data: { ...a.data, coverPos: pos } } : a))
        : prev,
    );
    await saveArchive(id, { ...target.data, coverPos: pos });
  };

  if (selectedId) {
    const entry = archives.find((a) => a.id === selectedId);
    if (entry) {
      return (
        <ArchiveDetail
          key={entry.id}
          entry={entry}
          displayNumber={String(archives.indexOf(entry) + 1).padStart(2, "0")}
          categories={categories}
          onMove={(categoryId) => {
            moveArchive(entry.id, categoryId).then(refresh);
          }}
          onBack={() => {
            refresh();
            setSelectedId(null);
          }}
          onDelete={handleDelete}
        />
      );
    }
  }

  return (
    <>
      <ArchiveList
        archives={archives}
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        onAddCategoryClick={() => setShowAddCategory(true)}
        onSelectArchive={(id) => setSelectedId(id)}
        onSetHome={handleSetHome}
        onReorder={handleReorder}
        onCoverPos={handleCoverPos}
        onWake={handleWake}
        onCategoryDeleted={handleCategoryDeleted}
      />
      {showAddCategory ? (
        <AddCategoryDialog
          onCancel={() => setShowAddCategory(false)}
          onConfirm={handleAddCategory}
        />
      ) : null}
    </>
  );
}
