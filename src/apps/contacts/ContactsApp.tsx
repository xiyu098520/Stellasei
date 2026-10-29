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
 * 角色档案配色：**乙游（女性向游戏）挑角色的那一屏**——一屏一个角色，中间一幅大画，
 * 名字与资料落在画下面，底下一排小头像左右挑人，手感像抽卡的卡库。
 * 不做「一本叫 STELLASEI 的刊物」（刊徽、刊头、卷期号、档案袋凸标签、书口刻线、
 * 纸纹、相纸封条、封底条码一律不要），只留三样：
 *   ① **一幅大画**（角色的立绘位）：一屏里唯一的重色，面积最大；
 *   ② **名字与几行资料槽**：做成乙游的数值槽——左边标签、右边值、中间一道细线引过去；
 *   ③ **底下一排小头像**（选择器）：当前那一格**不放头像**（空着就是「你在这里」），
 *      左右邻座就是滑动方向。总数 ≤5 全部铺开；>5 用 5 格居中窗，当前固定正中、
 *      左右各两个，滑到头就空着，不补位。
 *
 * 刊物与乙游的差别不在装饰多寡，在**焦点**：
 *   · 刊物问「这一页写了什么」，所以满页都是可读的记号；
 *   · 乙游问「这是谁」，所以一屏只该有一个大件——角色的脸。
 *
 * 卡的做法：
 *   · **小头像要圆的**，不要方的（底下那一排全改 `rounded-full`）；
 *   · **角色那一屏得先是一张「卡」**：要有外框，卡面上也要有一点装饰。
 *     大画与名字收进**一张白卡纸**里——墨黑细框收边、卡内留一圈白（大画成了
 *     卡纸上的开窗，不再是整块黑直接贴在屏上）、右下压一枚硬阴影；卡头左一枚蓝星、
 *     右一枚卡号：**编号属于卡，不属于名字**。
 *   · 卡**不能做得像员工证、工作牌**：白卡纸 ＋ 白边开窗的照片 ＋ 右上角工号 ＋
 *     四行「标签—细线—值」，这四件凑齐就是一张工牌的物理形态。
 *     所以卡是**乙游的卡面**：**一幅画铺满整张卡（出血到边），文字全部压在图上**，
 *     资料是一行连排（「·」隔开、不写字段名），卡面自带光影、闪点、内描边、
 *     四角小角花、一圈柔影。细节见 `ArchiveCard` 段顶上的注释。
 *   · 卡上不写 `aspectRatio: "3 / 4"`：高矮只由宽度算出来，底下会空出一片。
 *     布局是世界条／卡册／小头像串成一根竖轴，**卡册吃满屏幕剩下的高度**，一屏正好一张画。
 *   · 卡是**一张卡纸 ＋ 贴在它上面的一幅**：画四周让出卡纸、整体略往下、略歪一点点；
 *     让出来的卡头、卡尾两条带做装饰（蓝短线／英文小标／卡号／细线／小粉点），
 *     卡自己补上一圈边框。
 *
 * 世界条＝**一排横跨全屏的小胶片**（墨黑片基 ＋ 上下两道齿孔 ＋ 格内世界名与人数）：
 *   必须是**一整条**连续的黑片基横跨全屏、两道齿孔由头到尾贯穿着走；
 *   格是**一扇一扇各自的窗**（每格自己一圈细框），格与格之间留 6px 黑缝，
 *   孔是**3px 方齿**且**不贴着片边**（从片边往里缩 3px）；当前那格套一圈亮蓝细边、
 *   底色也提亮一档。胶片上方有一行刊头式目录行，卡与小头像之间有一行「当前是第几个」
 *   的计数线——两条都是细线配小字。
 *
 * 卡上的名字与资料不裸着，排成三件——名字左边一道**亮蓝竖杠**、名字底下另起一行
 *   **斜体花体小字**、资料是**一排带底色的小方牌**（牌里字段名、牌外值，自动换行成
 *   一条标签串，不是有行线的登记表）。
 *
 * 尺寸纪律：卡上那一幅在 3 倍屏上要 846×1350 真实像素。档案照片的压缩**只在这一处**
 *   （`handlePhotoChange`），与聊天那边的头像/图片互不相干：上限最宽 **1080px**、
 *   JPEG 质量 0.8。**画只要宽过原图宽就是在放大插值，就会糊**——所以卡册让边要小于
 *   格间空（**px-2**，左右各 8px），左右那 8px 全落在格与格之间的白上，邻卡整张被
 *   推出屏外，边不露、卡面也宽一圈。**这一条只对以后新传的照片生效**，已存进去的
 *   老照片仍是 300px，要清楚就得重新传一张。
 *
 * 底部一排：不是当前的那几个调小、当前那个放大（38px ＋ 一圈蓝细边）；
 *   当前那格是**头像 ＋ 蓝圈 ＋ 右上角一枚小粉点**，粉点在**头像正下方、圆的外面**——不压脸。
 *
 * 颜色纪律：整页只有四样东西在说话——
 *   **白**（纸：整页底，面积最大）
 *   **黑**（大画 ＋ 名字与资料的主字）
 *   **蓝**（编号、几道装饰线、底排里「你在这里」那一格）
 *   **粉**（只做小点：当前项那一枚，全页面积最小）
 * 黑用墨黑 #1B1918 不用纯黑：与记忆页同一块墨，两页之间不至于断层。
 * ===================================================================== */
const A = {
  /* 纸：白（从近白 #F7F6F3 推到纯白——乙游的底是一块干净的屏，不是一张旧纸。
     壳子底（AppChrome 的 file 主题）必须跟着同一个白，不然两边接缝处会裂出一道线）。 */
  bg: "#FFFFFF",
  paper: "#FFFFFF",
  /* 墨：大画、名字、资料 */
  ink: "#1B1918",
  ink2: "#6E6663",
  ink3: "#A79D98",
  /* 蓝：编号、装饰线、底排里「你在这里」那一格 */
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
const A_MONO = "var(--font-mono), monospace";
/** 英文小标：印刷体大写衬线（详情页与弹窗还在用）。 */
const A_EN = "var(--font-serif)";
/** 名字与资料：宋体。乙游立绘屏上的名字用宋体最稳（游戏里也是这类衬线大字）。 */
const A_SERIF =
  "'KingHwa OldSong', 'Noto Serif SC', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', Georgia, serif";
/** 卡面上的中文：楷体。
 *  宋体是方块骨架（一横一竖、笔画等粗），端正但不「艺术」；楷体是书写体，
 *  横画微仰、笔画有起有收，多一点手写的温度，又不至于像书法体那样只认得几个字。
 *  走系统楷体（iOS 自带，零下载、零闪）。 */
const A_ART = "'Kaiti SC', 'STKaiti', 'KaiTi', Georgia, serif";

/** 纸纹：极淡的斜纹，像刊物内页的底。 */
const A_GRAIN: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(27,25,24,.028) 0 1px, transparent 1px 9px)",
};
/** 硬边错位投影：与记忆同一枚，剪贴拼贴感。 */
const A_SHADOW = "4px 4px 0 rgba(27,25,24,.06)";
/** 卡影：一整张立绘是深色的一大块，压在白屏上得自己投出一圈柔影才「浮」得起来。
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
   空着仍旧是一张三行的便签，超出的部分**逐行撑开**，不在框里滚
   ——写长人设时不能只留一扇三行的窗、看不见自己写了多少。 */
const FIELD_BOX_LINES = 3;

function FixedTextarea({ style, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /* 跟着内容长高：**先复位成 `auto` 再读 `scrollHeight`**
     ——不复位的话它只会越撑越高，删字也缩不回来。矮于三行的那截由 `minHeight` 兜着。
     只认**自己这格的字**（1.8.6）：原先这里没写依赖数组，于是**每次渲染都跑一遍**——
     档案页一屋子这样的输入框，改甲那格的字，乙丙丁跟着重渲染、每格都强制重排一次，
     一按键就是十几次强制重排；写长了更贵，越改越卡（她报的「档案里改久一点就卡」）。
     受控值 `value` 变了才需要重量，别的渲染一律跳过。 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      value={value}
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
 * 详情页与列表页同一本刊物的内页：纸面、墨线、蓝编号，装饰全换成**印厂的
 * 记号**——裁切角标、登记表格线、骑缝线、页码水印、署名条；不用暗底、暗红、
 * 装订孔、戳记、终端命令行那一套。
 *
 * 颜色纪律在这里再收一次：整页只有三样东西在说话——墨（线与字）、蓝（编号与页码）、
 * 红（印章，全册仅此一处，只给不可复原的事）。
 * ===================================================================== */

/** 详情页左边那条**墨黑窄带**：一列竖排的菜单项压在上面。
 *  要「透透的」有个前提——白底上白色半透明是看不见的，得先有一块深色可透；
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

/** 分区标题底下那道细线。现在只剩 07「补充」那一栏在用——02–05 的栏头
 *  连同这道线撤了（左边菜单上已经报过栏目名）。 */
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

/** 01 登记表里的一条资料：**居中**的「标签 · 值」。
 *  一条资料自己占一行、从中间往下排，不用「标签顶最左、值甩到最右、中间一串点线」
 *  的目录语法。值的样式各条不同（有的是输入框、有的是罗马体日期），
 *  所以这里只管**那一行的骨架**，值由调用处塞进来。 */
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

/** 详情页左边的菜单（竖排菜单）。
 *  按钮是：一枚线条小图标 ＋ 中文名 ＋ 一行小英文，白色半透明浮在深色底上，
 *  放在最左边、不贴齐左边、不用做得太大。
 *  ⇒ 每项＝**图标 ＋ 中文名 ＋ 拉丁小标**，按钮里不带编号。
 *  拉丁小标是栏头上那套（`particulars` 等），栏头撤了正好挪到这里当一行小字。 */
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
 * 不做的「一本叫 STELLASEI 的刊物」封面（刊徽、刊头、卷期号、档案袋凸标签、
 * 书口刻线、相纸封条、封底条码），要的是**乙游挑角色的那一屏**
 * （像抽卡的卡库，左右滑看自己不同的角色）。
 *
 * 这一页从上到下只有三段：
 *   · **世界条**：一排疏字距的细字，选中的压墨字、底下一道蓝线。分类在这页退回成一个
 *     开关（不是「档案袋的凸标签」那种刊物零件），长按删栏、末尾加号新建。
 *   · **角色卡**（乙游卡面——一整张画）：**画铺满整卡出血到边**，名字与资料全部
 *     **压在画上**（有照片就铺照片，没有就一层淡剪影），卡面自带光影、压暗、闪点、
 *     内描边、四角小角花、一圈柔影，右上角一枚小卡号。资料是**一行连排**（世界·身份·
 *     性别·年龄，用「·」隔开、不写字段名）——不能做成四行「标签—细线—值」的登记表，
 *     那正是这张卡像工牌的地方。八层结构见 `ArchiveCard`。
 *   · **底部小圆头像**：当前那一格留空（＝你在这里），左右邻座就是滑动方向。
 * 三段串成一根竖轴：世界条与小头像按自己的身高走，中间的卡册 `flex-1` **吃满剩下的
 * 高度**——所以一屏正好一张画，卡底不会空出一片台面（见 `ArchiveCard`）。
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

/** 长按列表卡弹出的小菜单里，排序那四件事：四个方向共用同一套动作，
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
  /** 设为主页：把某条档案挪到卡册第一位。 */
  onSetHome: (id: string) => Promise<void>;
  /** 手动排序：把某条档案挪到邻居的前／后一位（见 `moveArchiveNear`）。 */
  onReorder: (id: string, neighborId: string, place: "before" | "after") => Promise<void>;
  /** 取景落库：拖动松手时把 `coverPos` 存进那条档案。 */
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
  /* 长按一张卡弹出的小菜单：存的是那条档案的 id，不存下标——
     排序一动，下标就变了，存 id 才能一直指着同一个人（见下面的 `menuIndex`）。 */
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  /* 正在调整取景的那张卡：有值＝这一屏进了「拖动照片」的手感。
     它是**临时的一次编辑**，位置松手就落库（存进档案的 `coverPos`），不留在这一页上。 */
  const [coverEditId, setCoverEditId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  /* 长按刚触发过没有：松手后浏览器还会给按住的那一格补发一次 click，拿它拦掉，
     免得「弹出菜单」和「进详情／换栏目」一起发生。
     它**每次按下都会先清掉**（见 `startLongPress`）——所以哪怕那一发补发的 click 一直
     没来（iOS 上是常事），这个开关也不会卡在那儿、把下一次正常的点按吞掉。 */
  const longPressFired = useRef(false);

  /* 卡册：一页一个角色，左右滑动翻阅。 */
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

  /** 设为主页：按完不只挪位置，还要**真的翻到第一页**，让人看见它落在那儿。
   *  落库在上层（`onSetHome`），这里只管翻页。 */
  const setHome = async (id: string) => {
    await onSetHome(id);
    railRef.current?.scrollTo({ left: 0 });
    setPage(0);
  };

  /** 手动排序：挪完**跟着那个人走**——按「往后一位」时眼睛还盯着他，
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

  /** 长按 500ms 之后做一件事（世界条删栏与卡片小菜单共用这一支计时器）。
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

  /* 小菜单正对着的那张卡：按 id 现查——排序一动下标就变，按 id 查才不会
     指错人；那个人已经不在这一栏里了（换了分类／改了搜索词）就自动没有菜单，
     不留一个指向空处的浮层。 */
  const menuIndex = cardMenuId ? filtered.findIndex((a) => a.id === cardMenuId) : -1;
  const menuArchive = menuIndex >= 0 ? filtered[menuIndex] : null;

  /** 排序菜单里的四个方向：邻位取的是**这一栏里**的邻位（`filtered`），
   *  不是整本册子的邻位——眼睛盯着的是当前这一栏。
   *  挪完把卡册翻到他挪过去之后的那一格（见 `reorder`），视线跟着人走。 */
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

  /* 底部那一排小头像（规则，别改）：
     · 总数 ≤5：五格全铺，当前那一格也占着一个位子；
     · 总数 >5：切一个 5 格居中窗，当前固定在第 3 格、左右各两个；滑到头就空着，不补位。
       （共 7 张停在第 5 张：3 4 ● 6 7；停在第 6 张：4 5 ● 7 –）
     null 表示窗外（留一个空位撑住居中，不拿别的头像来填）。
     ● 那一格长什么样是另一回事（现在是头像＋蓝圈＋粉点，见下面渲染处）——
     这里只管**占位与居中**。 */
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
      {/* 一屏正好一张卡：把「世界条 ＋ 卡册 ＋ 小头像」串成一根竖轴，
          高度按屏幕**剩下多少**来分——卡不能自带固定比例（如 `aspectRatio: 3/4`，
          高矮只跟宽度有关），否则底下会空出一片。 */}
      <div className="relative flex h-full min-h-0 flex-col">

      {/* ===== 胶片上方的一行小字 =====
          在「档案」这个刊头与胶片之间加一行目录行：左边说这一册在说什么，
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

      {/* ===== 世界条：一整条横跨全屏的胶片 =====
          刊物那套报头整块撤掉：刊徽、刊名、卷期号、靛蓝数据带——乙游的挑人屏上
          不该有报名和目录统计，这页只留「哪个世界」这一个开关。
          这一条要的是**一整条的全屏**，不是「一格一片」各自独立的小片子：
            · **一条黑片基**从屏幕左沿铺到右沿（-mx-4 抵掉壳子的内边距），中间不切开；
            · **两道齿孔**（上下各一行小白点）沿整条由头贯到尾，这才是胶片的那两条边；
            · 格要做成**窗**：每格自描一圈细框（`border` ＋ `rounded-[2px]` ＋ 极淡的底），
              格与格之间留出 6px 片基的黑，竖线不画；
            · 齿孔是 **3px 方孔**、并从片边往里缩 3px（孔是方齿，且与片边之间留一条窄边）；
            · 当前那一格套一圈亮蓝细边（黑底上的蓝用 blueLit），一眼知道走在哪一格上。
          分类的另外两个动作照旧：长按 500ms 删栏，末尾一格是还没装画的空片（「＋」新建）。 */}
      <div className="relative -mx-4 mb-3.5 shrink-0" style={{ background: A.ink }}>
        {/* 上下两道齿孔：**整条**贯穿的那两行孔——不是一格一个。
            孔是**方孔**（3px 一块），并从片边往里缩 3px——孔是方齿，
            孔与片边之间还留着一条窄边。 */}
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
            格与格之间留 6px（gap-1.5）——那道缝就是片基的黑，用它替掉了竖线。
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
                {/* 格与格之间那道竖线撤了——胶片上的格是一扇一扇**各自的
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

          {/* 末尾那一格：一片还没装画的空片，点一下新建一个世界。给它也描上一圈
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
          分类现在是上面那条世界条（一个开关），不再是一排骑在卡片盒口上的凸标签——
          同一个逻辑只留一处。 */}
      {/* 这一列的**行间空**是 8px（`gap-2`）——三处一共省 6px，连同下面页码行、小头像
          行的上边距与小头像的槽，**一共让出 18px 给照片**。道理：卡册是 `flex-1`，底下
          的行都钉在屏幕底上，所以下面**每省 1px，照片就长 1px（1:1）**，且卡是
          **上缘不动、往下长**。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">

          {/* ===== 卡册：一屏一个角色，左右滑动挑人 =====
              乙游抽卡的那个卡库：一屏只有一个人，往左往右翻的是自己的角色。
              所以这里不是并排的一张张小卡，而是**一屏一人**——卡宽＝卡册宽，
              一次只停一张（snap-mandatory），手感是「翻人」，不是「逛册子」。
              卡册让出左右各 8px（`px-2`），卡面 306px、画 282px；左右那 8px 全落在格子
              之间的白上（让边小于格间空），邻卡整张被推出屏外，一点边都不露。8px 也刚好
              够卡影往左右化开（见 `A_CARD_SHADOW`：模糊 34、收 12，横向只溢 5px，
              正落在让边以内）。
              让边之后每一张仍居中停住：左右让得一样多（对称的让边在公式里正好抵消），
              `snap-center` 落点还是 n × 步长，翻页公式一行都不用改。
              这一条带 `pt-3`（12px）：多出的这 12px 是**卡自己让出来的**（卡册是
              `flex-1`，底下页码／小头像／页脚按钮都钉在屏幕底上，让不出别的空间），
              所以照片**上边往下落 12px、下边不动**，卡跟着矮 12px。翻页／对齐一律没碰。
              源图上限 1080（见 `handlePhotoChange`），卡册不必靠缩卡来治糊。
              加一条 `no-callout`——长按这排卡是自家的小菜单，按住时不许 iOS 原生的
              选字／存图浮层抢先冒出来（样式见 globals.css，卡上的名字、资料都是可选中的
              文字，光关 `touch-callout` 不够）。 */}
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
                    /* 长按弹小菜单；正在调整取景的那一张不挂长按，它挂拖动手势。 */
                    pressHandlers={
                      coverEditId ? undefined : pressHandlers(() => setCardMenuId(archive.id))
                    }
                    coverEditable={coverEditId === archive.id}
                    onCoverCommit={(pos) => onCoverPos(archive.id, pos)}
                  />
                ))}
              </div>

              {/* ===== 照片正下方那枚胶囊按钮 =====
                  一枚**胶囊**：左端一枚圆的徽记，右边是主字，主字底下一行疏字距的小英文。
                  它**整块搬出了卡片**，落在卡册（照片）正下方；这一屏于是从上到下成了：
                  **照片 → 按钮 → 页码行 → 小头像**。
                  为什么挪得通、又为什么一点代价都没有：这一整列本来就是父层那一条
                  `flex flex-col gap-2.5`（10px），四行东西**共用同一条行间空**，
                  所以换的只是先后次序，**卡的高度、照片的大小、底下几行的位置全都没动**。
                  按钮与照片之间那 10px 就是这条 `gap-2.5`，没有另加边距。
                  **它是这一页唯一不跟着谁走的东西**——上面是照片、下面是头像（那是「谁」），
                  它是**动作**，动作就贴在被它作用的那一张照片底下。
                  也因为它不在卡上，它才能是**一枚真的 `<button>`**：卡里面不能再套按钮
                  （React 19 会报「button 不能是 button 的后代」，见卡内那段注释），
                  出来之后这道约束就没了，连「拦住点击不冒到卡上」那套也不必再写。
                  颜色照本页四色（只借参考图的**版式**，不借它的金／奶油——与本页的
                  白黑蓝粉不合）：
                    · **双层描边**——外圈那道实（与资料牌子、卡框同一支笔），
                      内圈再浅一道（`inset-[3px]`）；
                    · **左端 28px 圆形徽记**，里头是那枚**朝上的箭头**——「往上排，
                      排到最前」；
                    · 主字「设置封面」用卡面同一支霞鹜文楷（`A_ART`），底下
                      「SET AS COVER」疏字距大写（`A_EN`）。**改的只是显示的那两行字**，
                      里面那支函数仍叫 `setHome`／`setArchiveHome`，行为一个字没动。
                  **它按的是「现在停在第几张」那一张**：这一屏的规矩是一屏一人，这枚按钮
                  当然也就是这一张的按钮（翻到别张，它跟着换对象，见 `shownPage`）。
                  **第一张上它按不动**——它已经在第一个了，再按是空动作；但按钮**不藏、
                  也不换位**，只压低一档亮度，翻卡时上下几行不会跳。
                  **尺寸**：高 38px、徽记 28px、主字 13px、小英文 6.5px、内圈 `inset-[3px]`。 */}
              <div className="flex shrink-0 items-center gap-3.5 px-2">
                {/* ===== 左端那道引线 =====
                    按钮贴右，左边就空出约 250px 的一条（按钮约 121px、卡册整条约 370px）——
                    给它接一道**极淡的蓝细线**，从照片左缘一直拉到按钮跟前：这一行于是读成
                    一条「**基线 ＋ 末端的动作**」，左端不再是空的。线用**蓝**（本页的规矩
                    是「蓝＝编号与细线」），比按钮那道描边再淡一档——它只当引线，不当主角。
                    `px-2` 是照卡册那层的让边（左右各 8px）：于是在这一行里，
                    **线的起点正对照片左缘、按钮的右缘正对照片右缘**。
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
                  {/* 内圈那道浅线：双层描边。 */}
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

                  {/* 主字 ＋ 小英文（版式：主字在上、疏字距英文在下）。 */}
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

              {/* ===== 按钮与小头像之间的那一行 =====
                  在卡与小头像之间压一行：一道细线、两枚小粉点，中间是**现在停在第几个**
                  （等宽字，与卡头的卡号同一套）。它同时又说了句真话：滑动时这行数字会跟着
                  变，比一条纯装饰的线有用。 */}
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
                  规则：≤5 全铺／>5 居中窗（见上面的 railSlots），这里只管**占位与居中**。
                  那一格长什么样：
                    · 不是当前的那几个：**调小**（24px）、只留一道极淡的边、往后站（压淡）；
                    · 当前那一个：**放大**（38px）再套一圈蓝细边——靠的是自己变大，
                      不是靠压住别人；
                    · 那枚粉点落在**头像正下方**（在圆的外面）：它仍是「你在这里」
                      那一枚记号，但不盖住脸。
                  所有格子共用同一条槽，槽底永远留出那 3px 记号的位子（不是当前的
                  就留白），所以一排头像的下沿始终齐平，放大那一枚只往上长。
                  这条槽 **44px**（`h-11`）：槽里的东西本来就只有 44px（当前那枚 38 头像
                  ＋ 3 间距 ＋ 3 粉点），上面那 4px 一直是死空。它让出的 4px 全给了照片。 */}
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

      {/* ===== 长按卡片弹出的小菜单 =====
          「取景」与「排序」收在同一处：长按一张卡 500ms 弹出它，一套手感办两件事。
          做成**从底下浮上来的一张纸**（不是画面正中一个方框）：手指本来就按在卡上，
          菜单落在手指够得着的下方，点一下就收，不挡卡面。
          页眉仍旧是那枚墨黑标签条（与删除分类、删除档案同一枚）：栏名「档案」、
          小英文 `arrange`、右边写着这个人**现在**在第几位、叫什么——
          按下「往后一位」时，眼睛得有个东西对得上。
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
                （`filtered`），不是整本册子的邻位——眼睛盯着的是当前这一栏。 */}
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
                    // 先收起菜单再挪：菜单一收，卡册整块露出来，才看得见它挪到哪去了。
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

      {/* ===== 取景中 =====
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
 * 乙游的卡面从来不是「一张卡片上摆了些什么」，而是**一幅图 + 压在图上的那几行字**。
 * 一张工牌的物理形态在这张卡上一件不留——白底细框、照片居中留白边、右上角工号、
 * 四行「标签—细线—值」的对齐表，正是「像员工证」的来由，所以这几件事都要翻掉：
 *   · 文字全部**压进画里**（名字、资料、卡号都在图上），卡面上不留纯白的信息区；
 *   · 资料从「表格」改成**一行连排**（「·」隔开，不写字段名）——信息一个不少，
 *     但它读起来像落款，不像登记。
 * 卡上一共八层（从下往上）：画 → 光影 → 压暗 → 闪点 → 内描边 → 四角 → 卡号 → 名字资料。
 *
 * 刊物那套零件在这张卡上一件不留：栏目页眉、相纸封条、书口页码水印、纸纹、套印蓝影。
 *
 * 结构：卡＝**一张卡纸 ＋ 贴在它上面的一幅**。画四周让出卡纸（上留 30px、下留 20px、
 * 左右各 12px），再整体**略往下、略歪一点点**（`rotate(1.1deg)`）。让出来的两条带
 * 正好做事——卡头（蓝短线＋英文小标＋卡号）、卡尾（一道渐隐细线＋小粉点），卡自己也
 * 补上边框（离边 7px 一圈蓝细线）。
 * 左右只让 12px 已是极限：画转过 1.1°，最外那点落在距卡缘 8.1px，卡框那道蓝线在
 * 7px，再收就压上去了。
 * 卡高由屏幕定，不由公式定：卡册是 `flex-1`，卡吃满中间那一段——列表页那根竖轴
 * （世界条／卡册／小头像）按屏幕**剩下多少**分。
 * 配色纪律：白＝底，黑＝画，蓝＝编号与细线，粉＝只做小点。
 *
 * 画上只剩光影（②）与压暗（③）两层，不再散点：② 里有一道 148° 斜光，曾试过的
 * 人物背光（radial-gradient）已撤掉。星尘（`CARD_SPARKS`）与角上的小菱形花饰
 * （`CARD_GEM`）也已整段撤回，角上只留四道直角线。
 * 细线有三处硬伤要盯（见 `CARD_EDGE`、旋转层与 ④ 的注）。
 * 卡面上的中文用**霞鹜文楷**（`A_ART`）。
 *
 * 卡面上第一件**能按的东西**是「设为主页」（此前整张卡只有「进详情」一个动作），
 * 所以多了一套拦截点击的写法。
 *
 * 那枚「设为主页」**整块搬出了卡片**，落到卡册（照片）正下方，这一屏的竖序成了
 * **照片 → 按钮 → 页码行 → 小头像**：做成**一枚胶囊**——双层描边、左端 28px 圆形徽记
 * 里一枚朝上的箭头、主字「设置封面」＋小英文「SET AS COVER」。搬出去之后卡尾那条线
 * **左右一样长**；卡内不能套按钮那道约束也没有了，「拦住点击不冒到卡上」那套写法一并删掉。
 * 它按的是**现在停在第几张**那一张（一屏一人，见 `shownPage`）；第一张上按不动，但
 * 不藏、不换位，只压淡。
 *
 * 卡册那一条带 `pt-3`（12px）：卡册是 `flex-1`、底下那几行（页码／小头像／页脚按钮）
 * 钉在屏幕底上，所以这 12px 只能是**卡自己让出来的**——照片的**上边往下落 12px**、
 * 下边不动，卡因此矮 12px。
 *
 * 「丙 画」上下两条让边是上 30px、下 20px；**左右只让 12px**，理由见上。
 *
 * 卡下方那一整条（照片↔按钮 10 ＋ 按钮 38 ＋ 按钮↔页码 10 ＋ 页码行 18 ＋ 页码↔头像 10
 * ＋ 头像行 44 ＋ 页脚留白 58）里，能省的只是「空气」：列的行间空 8px（`gap-2`）、页码行
 * 与小头像行的上边距各 6px（`pt-1.5`）、小头像的槽 44px（`h-11`）——一共让出 **18px**，
 * 全进了照片：卡册是 `flex-1`、底下几行钉在屏幕底上，所以下面**每省 1px，照片就长 1px
 * （1:1）**；而且卡是**上缘不动、底缘往下长**。
 * 按钮、当前那枚大头像、卡内部那 50px 让边、胶片上方的空间，一处没动。
 *
 * 无障碍标签：`aria-label`「设置封面，把这一张排到卡册第一个」。按钮的尺寸／颜色／描边／
 * 徽记与箭头／按谁／第一张压淡都是定好的，别动；里面那支函数仍叫 `setHome`／
 * `setArchiveHome`（内部名字，不面向界面，不跟着改）。
 * ===================================================================== */

/** 卡角：四枚小直角压在卡的内缘上（「四角」）。
 *  线宽 **1px**：3 倍屏下 1px 正好是 3 个物理像素（整数），而 1.2px 落在 3.6 个物理
 *  像素上，浏览器只能按 0.6／0.4 分摊到两列像素，于是同一条线在不同位置忽粗忽细。 */
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
  /** 正在调整这张的取景：换成拖动手势，卡面照片跟着手指挪。 */
  coverEditable?: boolean;
  /** 松手那一下把取景位置交出去（落库在上层）。 */
  onCoverCommit?: (pos: { x: number; y: number }) => void;
}) {
  const d = archive.data;
  const name = d.name || "未命名";

  /* ===== 调整取景 =====
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
     别做成四行「标签—细线—值」的对齐表（表格 ＋ 字段名 ＝ 员工登记表，卡就成了工作牌）。
     字段名要留着，但**别让资料裸着**：字段名是**一枚有底色的小方牌**，
     值跟在牌外，一串牌子自动换行、不画行线、不对齐成表——是标签串，不是登记表。 */
  const facts = [
    { k: "世界", v: worldName },
    { k: "身份", v: d.occupation || d.tag || "" },
    { k: "性别", v: d.gender || "" },
    { k: "年龄", v: d.age || "" },
  ].filter((f) => f.v);

  /* 标签：编辑页里填的那串关键词（`profile.labels`，逗号分隔）拿到卡面上来。
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
      /* 平时挂「长按弹菜单」，进了取景模式换成「拖着照片挪」（见上面那份状态机）。
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
      {/* ===== 卡从「就是那幅画」改回「一张卡纸 ＋ 贴在它上面的一幅」 =====
          卡让出上下的卡纸：画从「出血到边」退回「贴上去的一幅」——四周留边
          （上面留得最多、下面次之），再整体略往下、略歪一点点。让出来的两条带正好做事：
          上面是卡头（一道蓝短线 ＋ 英文小标 ＋ 卡号），下面是一道细线与一枚小粉点。
          框、阴影、四角、闪点、名字资料一律不动。尺寸也不再打架：卡高由屏幕给，
          画高＝卡高减去上下两条带，永远比整卡小一圈，图片不会被压缩到发糊。 */}

      {/* ===== 甲 卡框：离边 7px 的一圈蓝细线 ===== */}
      <span
        className="pointer-events-none absolute inset-[7px]"
        aria-hidden
        style={{ boxShadow: "inset 0 0 0 1px rgba(141,162,230,.30)" }}
      />

      {/* ===== 乙 卡头：左边一道蓝短线 ＋ 一行英文小标，右边卡号 =====
          卡号从画里搬来这里（那一角还给画自己），再加一道蓝短线跟一枚衬线大写小标，
          卡头就不空了。 */}
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

      {/* ===== 丙 画：贴在这张卡纸上的一幅 =====
          上下左右各让出一段卡纸（上 30px、下 20px、左右 12px），再整体 rotate 1.1°——
          「贴歪一点」既是手工感，也是要的那点倾斜。
          这一幅从上下两头一起长大：上 42→**30px**、下 26→**20px**，画高多出 18px（约 4.5%）。
          **左右那 12px 收不动**：画转过 1.1°，左边最外那一点（左下角）落在距卡缘约 8.1px，
          而卡框那道蓝细线在 7px——再往里 1px 就压上它了。**上下也已到底**：上边离卡头
          那道蓝短线与小标只剩约 3px，下边离卡尾那枚小粉点（距底 10.5~13.5px）只剩约 2.5px。
          铁律：**不能再撑到出血**——画永远比卡小一圈，图片才不会被压缩到发糊。 */}
      <div
        className="absolute inset-x-3 bottom-[20px] top-[30px]"
        style={{
          /* `translateZ(0)` ＋ `willChange` 是把这一幅**单独提成一层来画**。
             这一层里有好几道 1px 的细线（两道内描边、四角小直角、四角小菱形），
             一旦整层转过 1.1°，浏览器若还让它们跟底下一块光栅化，就会把这些细线
             按屏幕像素一列列地啃——边就变得坑坑巴巴。
             提层之后这一层自己按设备像素重新光栅化，斜过来的细线才平滑。 */
          transform: "rotate(1.1deg) translateZ(0)",
          willChange: "transform",
        }}
      >
        {/* ===== ① 画：铺满这一幅 =====
            那圈白边拆了；画仍是这块的主，只是不再出血到卡的边。
            有照片就铺照片；没有就是墨黑场 ＋ 一层很淡的剪影
            （空位也成立，不喊「待补照片」）。 */}
        {d.photo ? (
          <span
            className="absolute inset-0"
            aria-hidden
            style={{
              backgroundImage: `url(${d.photo})`,
              backgroundSize: "cover",
              /* 裁到哪一段由 `cover` 定（没调过取景就是 50／50 居中）。 */
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
            别在这里再叠**人物背光**（radial-gradient，圆心在 50% 30%）：那层同心圆
            压在人身上，照片会发灰发闷；画上有这一道斜光就够，
            光该是「从哪边来」，不是「一团在背后」。 */}
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
            那圈落影：画是「贴」在卡纸上的，得自己压一道影出来才浮得起来；
            亮的那道是压边的反光，暗的那道把画收住。
            亮的那道浓度 **.46**（与四角同浓度）。太淡的话，这条白线压在照片上时，
            **照片亮的地方看不见、暗的地方才看得见**，一条本该连续的边走到明暗交界处
            就断了、忽隐忽现，看着像被啃过。提到 .46 之后它在亮处也立得住，这条边才是一整条。 */}
        <span
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            boxShadow:
              "0 12px 26px -10px rgba(0,0,0,.62), inset 0 0 0 1px rgba(255,255,255,.46), inset 0 0 0 3px rgba(27,25,24,.22)",
          }}
        />

        {/* ===== ⑤ 四角：四枚小直角压在这一幅的内缘上 =====
            别在角上加小蓝菱形（`CARD_GEM`），不好看——角上只留这四道直角线。 */}
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

        {/* ===== ⑥ 名字与资料：全部压在画上（照官方乙游卡那一套） =====
            卡号搬去了卡头；名字与资料留在画里——乙游的卡面上，
            这两样从来是**压在图上**的（搬出去就又成工牌了）。
            名字与资料不能裸着压在画上，得有东西「装」它们。照官方卡补上三件：
              · 名字左边一道**亮蓝竖杠**（与卡头那道蓝短线同一支笔，把名字这块框起来）；
              · 名字底下另起一行**斜体花体小字**（官方卡上大名底下压着一行细花体罗马字），
                仍然是昵称，但不再并排挤在大名右边；
              · 资料改成**一排带底色的小方牌**（牌里是字段名、牌外是值），自动换行成一条
                标签串——不是有行线的登记表（见 `facts` 上那段注释）。
            名字与资料值用霞鹜文楷（`A_ART`），昵称那行是拉丁斜体不动。
            资料那排下面再接一行**标签签**（编辑页填的那串关键词，见 `tagList`）。 */}
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

          {/* 标签签：跟在资料下面一行。没填标签的档案这一行不存在，
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

      {/* ===== 丁 卡尾：一道细线 ＋ 一枚小粉点（最底下留白处塞点样式） =====
          线是白的、两头渐隐，卡尾因此不是一条硬边；中间那枚粉点仍是全页最小的那点粉。
          「设为主页」那枚按钮已搬出卡片（落到页面右下角的留白里，见下面那段），
          卡尾上再没有别的东西，线左右一样长，两头都在 19px 处渐隐。 */}
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
 * 细栏位并成三个大格——「一次就能填进去」：样貌并成「角色详情」、
 * 性格＋背景并成「角色人设」、关系不动、线上表现改名「对话参考」、
 * 线下表现先撤（线下还没有实际的东西，等做到了再加）。
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
        /* 这一格写的是「人际关系是什么」，不是事件——他有三个室友、父母是谁、
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
        /* 用「对话范例」当示例：拿几组真的对话喂给模型学腔调。范例里用「我」指角色自己
           （这一格整段是在告诉模型「你」是什么样的人），别写成「她／他」那种第三人称旁白。 */
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
 * 多个源栏位并进同一格（旧导出／旧项目里那些细栏位都能落进 looks／persona），
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
  /* 所属栏目（＝「世界」）。单独存一份本地值：换栏是立刻落库的，
     与下面那段 300ms 防抖的正文自动存盘不是一回事。 */
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [editMode, setEditMode] = useState(false);
  /* 一次只给一屏。选中的是哪一栏，下面就只出现那一栏（DETAIL_TABS）。 */
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
      档案照片的压缩**只有这一处**：聊天那边的头像与图片各有各的压缩
      （ChatSettingsPanel / media-asset / MinePage），动这里不会波及它们。
      1080 这个上限：卡上那一幅在 3 倍屏上要 846×1350 真实像素，
      源图低于它就只能是往上插值、发糊。一张 3:2 的竖图出来约 1080×1620，
      正把那一幅盖住还留余量——是**缩下来**，不是放上去。 */
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
        /* 多个源栏位并进同一格（外貌／穿衣／标志 → looks，描述／喜好／口头禅…… → persona），
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

  /** **六枚栏目按钮永远都在，缺的那一栏点进去写着「待解密」。**
   *  不要按「有值才排进页签」（`tabHasContent` ＋ `visibleTabs`）：
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

      {/* ===== 大照片：这一页的封面 =====
          别做成**固定 340px 高、铺满裁切的画框**（`center/cover`）：一是竖着拍的人像
          必然被裁掉大半张；二是「照片框成一条、名字压在照片上」正是**证件照／档案卡**的
          语法，看着像公文。这一块定成一张「**相纸**」：
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

      {/* 名字：照片下面一行——题头一道蓝短线 ＋ 一枚粉点，
          再是名字（文楷）与昵称；**标签小签挂到名字右边**。
          别把标签小签留在名字下面：它跟下面的页签条**两排小签上下贴着，分不清谁是谁**，
          根子是**两组长得一样**（都是白底细边小签）、又离得太近。标签挪到名字这一行后，
          页签条下面只剩页签自己。 */}
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
          {/* 标签小签：挂在名字右边。浏览态没填就不占地方；
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

      {/* ===== 从这一行起分成左右两栏：左＝菜单，右＝这一栏的内容 =====
          左边一条墨黑窄带竖排，右边的内容**在它自己那块地方里**居中（不是相对整屏）。
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
          {/* 栏头不重复：左边菜单上已经写着「资料 · particulars」，下面再报一遍
              「01 基本信息 · particulars」是同一句话说两遍，乙游里不这么啰嗦。
              登记表改成**居中排的「标签 · 值」**：标签顶最左、值甩到最右、中间一串点线
              引过去是**查目录**的语法；现在一条资料自己占一行、从中间往下排——
              读法从「翻目录」变成「一行一条资料」。 */}
          <div>
            {/* 姓名、昵称：各占一行、居中排 */}
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

            {/* 其余基本信息行：同一条骨架，居中排 */}
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

            {/* 栏目（＝「世界」）：一个分类就是一个世界 =====
                换栏要接上（`saveArchive` 不写 categoryId、`moveArchive` 没人调用的话，
                角色一建进某栏就再也出不来）：点一下立刻落库，不等上面那段正文防抖存盘。
                编辑态给整排栏目当选项、浏览态只报当前所属——名册可以改。 */}
            <RegLine label="栏目">
              <span className="min-w-0 truncate text-[11px]" style={{ color: A.ink, fontFamily: A_SERIF }}>
                {moveTargets.find((t) => t.id === categoryId)?.name ?? "已唤醒"}
              </span>
            </RegLine>

            {/* 更新：最后一次保存时间，从封底编目条收进登记表 */}
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

          {/* AI 助手模式（1.4.1 起＝正常版正文＋末尾一条【测试模式 · 绝对服从】） */}
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
          {/* 助手模式的说明**常驻**一行，开没开都挂着——只在启用时才冒出来的话，
              没开过的人不知道这开关干嘛。右边已经写着「已启用／关闭」，
              这里就不再重复状态，只说它是干什么的。 */}
          <div className="mt-1 text-[7.5px] leading-relaxed tracking-[0.5px]" style={{ color: A.ink2 }}>
            开启后聊天跟正常角色一样（人设、性格、微信体都照旧），只多一条：测试时你说什么 TA 就做什么——要照片就发、要语音就发、让你换语气就换，不许拒绝推脱。
          </div>
        </section>
      ) : null}

      {/* ===== 02–05：各自一栏，只有当前那一栏会被渲染出来 =====
          栏头不重复（与 01 同一条理由）——左边菜单上写着「详情 · appearance」，
          下面再报一遍「02 角色详情 · appearance」是同一句话说两遍。正文不按竖线、
          不用墨方点（表格格眼、公文味），换成粉点——四色纪律里「粉只做小点」，
          正好落在这里。小标题居中，正文仍左对齐。 */}
      {SECTIONS.filter((s) => s.no === activeTab).map((section) => (
        <section key={section.no}>
          <div
            className="border px-3 pb-2.5 pt-2"
            style={{ borderColor: A.line, background: A.paper, boxShadow: A_SHADOW, ...A_GRAIN }}
          >
            {section.fields.map((field, i) => {
              /* ?? "" 不能省：旧档案没有后来新增的栏位（如线上／线下表现），
                 取出来是 undefined，下面的 value.trim() 会当场抛错（同 BASIC_ROWS 那侧的写法）。 */
              const value = profile[field.key] ?? "";
              return (
                <div key={field.key} className={i < section.fields.length - 1 ? "mb-2.5" : ""}>
                  {/* 小标题**居中**；下面的正文仍旧左对齐——成段的字居中会
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
                      /* whitespace-pre-wrap：合并格（详情／人设）本来就是多行的，
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

      {/* ===== 07 自定义补充（六栏永远都在，这一栏没填也照样能点进来看） =====
          编号与拉丁小标撤了（左边菜单上写着「补充 · appendix」），但**标题本身留着**——
          编辑页里起的名字别处没有落脚点（`promptBuilder` 里还要用它把这段内容端给模型），
          所以只把重复的「07 · appendix」去掉。 */}
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
          不做成两个 `h-9` 的大方框并排（跟满页的细字比太重，像表单最后那排「提交／重置」）。
          收成一排小字，各带一枚小图标；删除仍是全册唯一一点印章红（只给不可复原的事）。 */}
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

  /** 设为主页：把这条档案挪到卡册第一位。翻回第一页的动作在 `ArchiveList`
   *  里做——那里才拿得到卡册那个滚动容器。 */
  const handleSetHome = async (id: string) => {
    setArchives(await setArchiveHome(id));
  };

  /** 手动排序：把这条档案挪到邻居的前／后一位，落库后把新次序递回列表。 */
  const handleReorder = async (id: string, neighborId: string, place: "before" | "after") => {
    setArchives(await moveArchiveNear(id, neighborId, place));
  };

  /** 取景落库：只动这一条的 `coverPos`，别的字段一个字不碰。
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
