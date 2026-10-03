"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Pin, Plus, RotateCcw, Trash2, Upload, Download } from "lucide-react";
import { AppChrome } from "@/components/phone/apps/AppChrome";
import {
  addEntry,
  createWorldBook,
  deleteEntry,
  deleteWorldBook,
  getWorldBooks,
  importWorldBooks,
  parseEntryKeys,
  updateEntry,
  updateWorldBook,
} from "@/lib/settings/worldbook";
import { getArchives, getCategories } from "@/lib/settings/contact";
import type { ArchiveCategory, ArchiveEntry } from "@/types/contact";
import {
  POSITION_META,
  SCOPE_META,
  type EntryPosition,
  type WorldBook,
  type WorldBookEntry,
  type WorldBookScope,
} from "@/types/worldbook";

/* 塔罗桌配色：深色背景，占卜塔罗牌的感觉，一张牌就是一本书。
   灯只有一盏（AppChrome 的 arcana 底），牌是画面上唯一亮的东西。
   暗底＋月白细线，全桌只留一点蜡印红收口。 */
const MOON = "#EDE7DA"; // 月白：暗桌上的主文字
const MOON_SOFT = "rgba(237, 231, 218, 0.62)";
const MOON_FAINT = "rgba(237, 231, 218, 0.34)";
const MOON_LINE = "rgba(237, 231, 218, 0.13)"; // 牌面的双框线
/* 牌面上那版字色：沉金 #A88A50，压在墨紫牌底（ARCANA_FACE）上对比 5.4:1，
   高于 AA 要求的 4.5:1。
   金字本身太亮会发「荧光」；再给大字加一层 text-shadow 透光，那就是「发光」的意思——
   要的是「刻进牌里」，不是「从牌里发光」，所以那层光不留。
   嫌亮嫌暗、或想再往紫里偏一点，都只改 ARCANA_INK 这一个值（小注两档跟着换同色相）。
   只有牌面上的字用它，列表页、详情页仍是 MOON 那一套。 */
const ARCANA_INK = "#A88A50"; // 牌上书名、正字：沉金（压暗过的暗金）
const ARCANA_INK_SOFT = "rgba(168, 138, 80, 0.85)"; // 牌上脚注（范围 · 状态）
const ARCANA_INK_FAINT = "rgba(168, 138, 80, 0.68)"; // 牌上序号与小注
/* 「抽卡被抽到」的那层光：正中那张牌**从底下往上亮起来**。
   分两层，一外一内，缺一层都不像：
     · **外晕**走 box-shadow——只有阴影能溢到牌外（牌的圆角靠 overflow-hidden，可 overflow 不裁自己的阴影）。
       主光压在下方（0 14px 42px 那一层），所以亮在牌底、往上淡，像光从桌上升起来打在牌根上；
       另压一层短距的均匀晕（0 0 28px）把牌四周拢住，免得只有底下亮一坨。
     · **内泛光**走牌里一层金色渐变（自下而上，mix-blend-mode: screen），让光**透进牌面**，
       而不是只在牌外面围一圈——这层压在框上、文字之下：只提亮牌面，不动字的色。
   给谁：只给正中那张（offset === 0），翻走的那张跟着熄。
   怎么动：内泛光只动 opacity（省电）；外晕靠 box-shadow 过渡——**全 App 唯一一处不走
   「只动 transform/opacity」的地方**，账是这么算的：一次换座位 420ms、面积就一张牌，
   换「光随着牌转到位才亮起来」这笔值（少了过渡，光会啪地跳，就不像抽卡了）。
   光用这一支金，不跟牌上的字同色：字是沉金（#A88A50），光是给牌打的灯，得比字亮才照得出来。
   **要收要放只改下面这几个 alpha，别去动牌上的字色**——光跟字是两回事。 */
const ARCANA_SELECT_OUT =
  "0 0 28px rgba(232, 196, 110, 0.18), 0 14px 42px rgba(232, 196, 110, 0.30)";
const ARCANA_SELECT_IN =
  "linear-gradient(to top, rgba(232, 196, 110, 0.18) 0%, rgba(232, 196, 110, 0.06) 30%, rgba(232, 196, 110, 0) 58%)";
const ARCANA_RED = "#C2604C"; // 暗底上的蜡印红：比纸上的 SEAL 亮一档，不然沉进黑里
/* 牌面：墨紫的底，左上受一点光，右下角沉下去——像一张压在暗桌上的旧牌。
   三档紫（#261B38/#1C1230/#110B1F）：不是加白，是把紫**提亮并往紫里推**
   （蓝档提得比绿多，绿压着不动，紫才不发灰）。
   牌上的字是沉金（ARCANA_INK），对比 5.4:1，高于 AA 的 4.5:1，所以字不用跟着改；
   **要再亮再暗只动这一条渐变**，桌面那道渐变跟着它一起走
   （AppChrome 的 arcana 底就取自这里，见那边的注释）。 */
const ARCANA_FACE = "linear-gradient(163deg, #261B38 0%, #1C1230 54%, #110B1F 100%)";
const ARCANA_SHADOW =
  "0 0 0 1px rgba(237,231,218,0.13), 0 2px 4px rgba(0,0,0,0.55), 0 26px 46px -24px rgba(0,0,0,0.92)";
/* 详情页（＝那张牌展开成的一页）用的几道金线：同一支金，只有深浅之差。
   · RULE —— 面板里的分隔线、输入框的边（最淡；一页里全是框会花）
   · LINE —— 面板里那圈「版心」细线（纸面那版是墨线，现在换成金线）
   · EDGE —— 按钮与关键词 chip 的描边（要一眼看出这是能按的东西）
   嫌太花或太素，只改这三个 alpha；色相跟着 ARCANA_INK 走，别单独调这一支金。 */
const ARCANA_RULE = "rgba(168, 138, 80, 0.16)";
const ARCANA_LINE = "rgba(168, 138, 80, 0.26)";
const ARCANA_EDGE = "rgba(168, 138, 80, 0.34)";
/* 压在金底上的字（选中的段控、勾选框里那个对勾）：取牌面那支渐变最深的一头，不用纯黑——
   纯黑压金发死，墨紫才是这张牌自己的暗。 */
const ARCANA_ON_GOLD = "#130F1D";
/* 详情页里成摞的解析卡：跟牌同一张脸，但影子得收住——一张压一张，太重的影会显脏。 */
const ARCANA_ENTRY_SHADOW =
  "0 0 0 1px rgba(237,231,218,0.10), 0 8px 18px -14px rgba(0,0,0,0.85)";
/* 塔罗牌的序数。牌桌上第一张是 I，不是 1。 */
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
/* 一张牌多大：这里不钉死像素，只留一个比例。
   牌高＝牌桌那格实高的 86%（那格的实高由 bindTable 量出来写在 --arcana-table-h 上，
   「该给牌多少」那道乘法在 globals.css 的 .arcana-table 里），牌宽按真塔罗牌的高宽比推。
   钉死一个像素数，换个屏、换个预览窗口牌就不满页了，所以牌高必须按屏算。
   牌面上的字级、框线、内边距全走 em（见下面那张牌），牌长多大，字跟到多大。
   比值（牌高 ÷ 牌宽）1.9 是塔罗牌那种长条：嫌宽嫌窄都只改这一个数，别处不用动。 */
const ARCANA_RATIO = 1.9; // 牌高 ÷ 牌宽
/* 牌面上那行书名的字号占牌高的比例（原 22px ÷ 493px）。
   它是牌面里的 1em：序号、书名、备注、注脚、框线都拿它当尺子。 */
const ARCANA_FONT = 22 / 493;
/* 牌上那行简介最多留两列小注：竖排之后一列约二十字，两列就是四十字上下，
   这里 36 个字封顶，多出来的截掉加省略号——牌面就那么大，想看全文点开书看详情页。
   为什么不用 CSS 的 line-clamp：竖排里它是按物理方向切的，靠不住；
   与其赌浏览器的实现，不如在数据上先截干净。 */
const ARCANA_DESC_MAX = 36;
function cardDescription(text: string) {
  return text.length > ARCANA_DESC_MAX ? `${text.slice(0, ARCANA_DESC_MAX)}…` : text;
}
/* 牌面上的数目用汉字写——「三 星在燃」比「3 条在跑」更像牌。
   同一册不会跑过十条，超过十就退回阿拉伯数字。 */
const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/* =======================================================================
 * 牌面零件：蜡印／章节花饰／侧线栏位标签
 * ===================================================================== */

/** 蜡印：暗桌上的火漆。全册唯一彩色，只落在空态与不可复原的动作上。
    #8E3A2C 那种纸上的红沉进暗底就看不见了，所以用亮一号的 ARCANA_RED。 */
function WaxSeal({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, border: "1px solid rgba(194,96,76,0.45)" }}
      aria-hidden
    >
      <span
        className="rounded-full"
        style={{ width: size * 0.28, height: size * 0.28, background: ARCANA_RED, opacity: 0.7 }}
      />
    </span>
  );
}

/** 一册现在在跑什么：几条正压着（常驻）、几条候命（按关键词等触发）、几条停用。 */
function runningOf(book: WorldBook) {
  const live = book.entries.filter((e) => !e.disabled);
  const constant = live.filter((e) => e.constant).length;
  return {
    live: live.length,
    constant,
    onKey: live.length - constant,
    off: book.entries.length - live.length,
  };
}

/* 牌面的框：素材在 public/arcana/，透明底、只有金色线条，
   压在墨紫的牌面上就是「暗桌上的一副鎏金框」。
   素材是 1856×2464，高宽比 1.328；牌是 1.9 的长条——两个比例对不上。
   按牌宽铺、纵向居中就会左右贴边、上下各空 15%，所以纵向一并拉满、四边贴住牌边，
   代价是竖着长 1.43 倍：上头那个圆月与四角的小花会略显长。
   （将来若出一版竖长的图，换上就既贴边又不变形。）
   那圈留白是素材自带的（四条金线离画布边还有 1.4%～2.4%，量法见下面的算式），放大才挤得出去。
   一册的状态不长在数字上，长在这副框的明暗上：还有条目在跑，框是亮的；一条都不跑，整副沉下去。
   想换款只改这一个路径，另两张（frame-1／frame-2）就在同一个文件夹里。
   frame-3.webp 是 1856×2464 的 PNG 压来的：尺寸收到 1024×1359、WebP q88（377 KB，省 77%）。
   敢收尺寸是因为牌宽才 139 CSS px，3x 屏上金框只占 435 个物理像素，1024 宽还有 2.35 倍余量。
   原 PNG 没删，还在 `public/arcana/frame-3.png`（要重裁重压时用得着）。 */
const ARCANA_FRAME = "/arcana/frame-3.webp";

/** 那张金线框，铺在牌面上。lit＝这一册还有条目在跑。 */
function ArcanaFrame({ lit }: { lit: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
        backgroundImage: `url(${ARCANA_FRAME})`,
        /* 素材比牌「方」：横向贴边时纵向只占 69.9%，所以纵向一并拉满——
           四边都对齐，代价是竖着长 1.43 倍（1.9 ÷ 1.328）。
           ★ 量 frame-3（1856×2464，alpha>64，只数竖向中段 y400～2000，把四角花饰排除），
           四条**直的**金线都不在画布边上：
             左 x45（2.4%）／右 x1825（1.6%）／上 y34（1.4%）／下 y2404（2.4%）。
           只有四角的花饰顶到画布角——**金线自带一圈 1.4%～2.4% 的留白，放大才挤得出去**。
           算式（位置写百分比，它的基准是「容器 − 图」，图比容器大时正好等于「裁掉的部分」）：
             横向总裁 45+30=75px ⇒ 宽 1856/(1856−75)=104.2%，左裁 45/75=60%；
             纵向总裁 34+58=92px ⇒ 高 2464/(2464−92)=103.9%，上裁 34/92=37%。
           要挪照上面的算式改这两个数，**别用关键字**（关键字＋百分比的偏移量也按
           「容器 − 图」算：图比容器大时这个差是负的，写多少都被缩成零点几像素）。 */
        backgroundSize: "104.2% 103.9%",
        backgroundPosition: "60% 37%",
        backgroundRepeat: "no-repeat",
        /* screen：金色叠在暗紫上只会往亮里走，不会把那些极细的线吃掉。 */
        mixBlendMode: "screen",
        /* 一条都不跑了，整副框沉下去——这就是这一册的状态。
           0.62：金色直接满亮太跳、跟墨紫打架，压下来才像旧金箔，
           另外还有下面那层「跟着牌面沉」。 */
        opacity: lit ? 0.62 : 0.22,
      }}
      />
      {/* 让框跟着牌面的光走。牌面自己有一道 163deg 的渐变（左上受一点光、右下角沉下去），
          框却是**上下一般亮**的一层——牌沉它不沉，看着就是「贴上去的」。
          这层拿牌面同一支渐变去 multiply：左上不压，越往右下越把金线一起带进暗里，
          框和牌就成同一张纸上的东西了。浓度只取牌面那道的一半——乘两次会沉过头。 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(163deg, rgba(0,0,0,0) 0%, rgba(10,6,18,0.14) 54%, rgba(8,4,14,0.4) 100%)",
          mixBlendMode: "multiply",
        }}
      />
    </>
  );
}

/* 一张牌在转盘上站在哪儿：offset 是它离正中那张还差几册。
   正中的正对着你、最大最亮；左右两张偏出去、退到后面、朝正中侧一点身；
   再往外两张更偏更退更暗。只给 transform／dim／zIndex——
   全是合成层上的活，手机不烫（省电铁律）。
   **压暗的办法是 dim（牌面上盖一层黑罩子的浓度），不是给整张牌写 opacity。**
   整张牌 opacity 一压，牌就成了半透明的，背后塔罗桌的底色（AppChrome 的 #0B0810）
   透上来掺进墨紫里，色相被冲淡，看起来就不像同一张牌了；
   换成黑罩子，牌自己的紫一比一往下压，只是暗，色不变。
   罩子在牌的最上层（见下面那张牌）。浓度不能重——牌的底子本来就深（墨紫一路压到近黑），
   黑罩子一重，整张牌就塌成一块纯黑、连金线框一起吞掉，看着就像「另一张牌」了。
   所以只轻压一档：
   紧邻 0.15、最外 0.34，正中是 0（一点不压）——暗得出来，色相还认得出是同一张。
   牌没有固定像素尺寸，所以位移一律按**牌高**（--arcana-h）算：
   0.284／0.511 是 140px／252px 除以 493px 得到的构图比例，换多大的屏都是同一张构图。
   开头的 translate(-50%, -50%) 是把牌自己的正中压在牌桌正中——
   居中不靠负 margin：牌高由 CSS 算，负 margin 写不出来。 */
function arcanaSeat(offset: number) {
  const d = Math.abs(offset);
  const dir = offset < 0 ? -1 : 1;
  const centered = "translate(-50%, -50%)";
  if (d === 0) {
    return {
      transform: `${centered} translateX(0px) translateZ(0px) rotateY(0deg) scale(1)`,
      dim: 0,
      zIndex: 30,
    };
  }
  if (d === 1) {
    return {
      transform: `${centered} translateX(calc(var(--arcana-h) * ${dir * 0.284})) translateZ(calc(var(--arcana-h) * -0.406)) rotateY(${dir * 26}deg) scale(0.94)`,
      dim: 0.15,
      zIndex: 20,
    };
  }
  return {
    transform: `${centered} translateX(calc(var(--arcana-h) * ${dir * 0.511})) translateZ(calc(var(--arcana-h) * -0.811)) rotateY(${dir * 34}deg) scale(0.88)`,
    dim: 0.34,
    zIndex: 10,
  };
}

/** 牌面框线：一条通栏金线，左端一枚小菱形起笔——牌上那些金线就是这么开始的，
    这是**分区的框**，不是装饰。 */
function RuleLine({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden>
      <span
        className="shrink-0"
        style={{ width: 4, height: 4, transform: "rotate(45deg)", background: ARCANA_INK_FAINT }}
      />
      <span className="h-px flex-1" style={{ background: ARCANA_RULE }} />
    </div>
  );
}

/** 栏位：**竖排**标签挂在内容左边，一条竖金线把标签与内容分开。
    牌上的字本来就是竖着的（列表页那张牌的书名、简介全用 writing-mode: vertical-rl），
    详情页跟着竖，两处才是同一种排版。 */
function RuneField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <span
        className="shrink-0 select-none self-stretch text-[10px]"
        style={{
          writingMode: "vertical-rl",
          color: ARCANA_INK_FAINT,
          letterSpacing: "0.3em",
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1 border-l pl-2.5" style={{ borderColor: ARCANA_RULE }}>
        {children}
      </div>
    </div>
  );
}

/* =======================================================================
 * 世界书 App：牌桌（一册一张牌）→ 详情页（这一册的解析，逐则展开编辑）
 * ===================================================================== */

export default function WorldBookApp() {
  const [books, setBooks] = useState<WorldBook[] | null>(null);
  const [archives, setArchives] = useState<ArchiveEntry[] | null>(null);
  /* 档案的「世界」（分类）：绑定面板里除了角色还能绑一整个世界。 */
  const [archiveCategories, setArchiveCategories] = useState<ArchiveCategory[]>([]);
  const [failed, setFailed] = useState(false);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [confirmDeleteBook, setConfirmDeleteBook] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  /* 转盘转到第几册：正中间那张的序号（0 起）。 */
  const [page, setPage] = useState(0);
  /* 正被翻开的那张牌：点下去它先转过去，再从它身上展开解析页。 */
  const [turningId, setTurningId] = useState<string | null>(null);
  /* 转盘托盘。手指拖着走的时候整盘跟着指头移，直接写 style，不走 state（不逐帧渲染）。 */
  const stageRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  /* 这一下是「滑」还是「点」：手指滑过之后落在牌上，不该被当成点开。 */
  const draggedRef = useRef(false);
  /* 牌桌那一格的量尺。牌高从这格量出来（见 bindTable）——不交给 CSS 容器查询算。 */
  const tableRO = useRef<ResizeObserver | null>(null);

  /* 量牌桌、把它的实高写在 --arcana-table-h 上。
     牌桌是 flex 拉伸出来的一格，哪怕挂着 container-type: size，cqh 在这类格子上也会解析成 0
     （那格 308px 时，里头的 50cqh 是 0px，牌整张塌成 0×0、根本画不出来）。
     所以这格不自己算高度：这里只量一个实高交给 CSS（跟托盘那份 inline transform 一个路子：
     不走 state、不逐帧渲染），牌高＝这格的实高乘多少，写在 .arcana-table 里。
     换屏幕、转身、键盘弹出都会重新报，牌桌就始终是「铺满整页」该有的份量。
     绑成回调 ref：牌桌在「有牌／空桌」「进详情页／退回来」之间会整棵换掉，回调 ref 每换一次就重新量。 */
  const bindTable = useCallback((el: HTMLDivElement | null) => {
    tableRO.current?.disconnect();
    tableRO.current = null;
    if (!el) return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) el.style.setProperty("--arcana-table-h", `${h}px`);
    };
    /* 先自己量一次：ref 挂上时这一整棵 DOM 已经插好了，读一下布局就拿到实高，
       不必等谁回调（实测只挂 ResizeObserver 时，这一格量到过空值、牌又塌回 0）。
       随后的变化（换屏幕、转身、键盘弹出）才交给 ResizeObserver。 */
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    tableRO.current = ro;
  }, []);

  /** 收录 JSON：支持单本对象／books 阵列／根层阵列，坏格式给出反馈。 */
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let msg: string;
      try {
        const imported = JSON.parse(event.target?.result as string) as unknown;
        let list: unknown[] = [];
        if (Array.isArray(imported)) list = imported;
        else if (imported && typeof imported === "object") {
          const obj = imported as Record<string, unknown>;
          if (Array.isArray(obj.books)) list = obj.books;
          else if (Array.isArray(obj.worldBooks)) list = obj.worldBooks;
          else list = [obj];
        }
        const valid = list.filter(
          (x) => typeof x === "object" && x !== null && "entries" in (x as Record<string, unknown>),
        );
        if (valid.length === 0) {
          msg = "收录失败：文件里没有可识别的牌";
        } else {
          void importWorldBooks(valid).then(([merged, count, entryCount]) => {
            setBooks(merged);
            /* 一本书都没落进来＝文件里的条目格式咱们认不出（从前这里照报「收录成功」，
               书架里只多出一本空书，等于把「没收进来」咽掉了——1.6.8 改成如实报）。 */
            setImportMsg(
              count === 0
                ? "收录失败：牌里没有能读出来的设定条目"
                : `收录成功 · ${count} 张已落桌、${entryCount} 条设定${list.length > valid.length ? `（跳过 ${list.length - valid.length} 个无效项）` : ""}`,
            );
            setTimeout(() => setImportMsg(""), 4000);
          });
          return;
        }
      } catch {
        msg = "收录失败：文件格式不正确";
      }
      setImportMsg(msg);
      setTimeout(() => setImportMsg(""), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const load = useCallback(async () => {
    try {
      setBooks(await getWorldBooks());
      setArchiveCategories(await getCategories());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // 首次载入走内联 promise 链（setState 全在异步回调里，避免级联渲染）。
  useEffect(() => {
    let alive = true;
    getWorldBooks()
      .then((saved) => {
        if (alive) setBooks(saved);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    getCategories()
      .then((list) => {
        if (alive) setArchiveCategories(list);
      })
      .catch(() => {
        if (alive) setArchiveCategories([]);
      });
    getArchives()
      .then((list) => {
        if (alive) setArchives(list);
      })
      .catch(() => {
        if (alive) setArchives([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 载入失败：错误＋重试（不无声卡「载入中」）。
  if (failed) {
    return (
      <AppChrome title="世界书" titleEn="WORLD CHRONICLE" theme="arcana">
        <div className="mt-20 flex flex-col items-center gap-4 text-center">
          <WaxSeal size={28} />
          <p className="text-[11px]" style={{ color: MOON_SOFT, letterSpacing: "0.14em" }}>
            这一桌牌没能摊开……
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="pressable flex items-center gap-1.5 pb-0.5 text-[10px]"
            style={{
              color: MOON,
              letterSpacing: "0.18em",
              borderBottom: `1px solid ${MOON_LINE}`,
            }}
          >
            <RotateCcw size={11} strokeWidth={1.5} />
            再摊一次
          </button>
        </div>
      </AppChrome>
    );
  }

  if (books === null) {
    return (
      <AppChrome title="世界书" titleEn="WORLD CHRONICLE" theme="arcana">
        <p
          className="mt-20 text-center text-[10px]"
          style={{ color: MOON_FAINT, letterSpacing: "0.3em" }}
        >
          正在洗牌…
        </p>
      </AppChrome>
    );
  }

  const openBook = books.find((b) => b.id === openBookId) ?? null;

  /* ---------------- 详情页：书信息卡＋解析列表 ---------------- */
  if (openBook) {
    return (
      /* 解析页是从这张牌里展开的：牌先翻过去，内容再从它身上长出来（`.arcana-open`）。 */
      <div className="arcana-open h-full">
        <BookDetail
          key={openBook.id}
          book={openBook}
          index={books.findIndex((b) => b.id === openBook.id)}
          archiveCategories={archiveCategories}
          archives={archives ?? []}
          onBack={() => {
            /* 回到牌桌：刚才翻过去的那张要转回来。 */
            setTurningId(null);
            setOpenBookId(null);
          }}
          onPatchBook={(patch) => {
            setBooks((prev) =>
              prev
                ? prev.map((b) => (b.id === openBook.id ? { ...b, ...patch } : b))
                : prev,
            );
          }}
          onAddEntry={async (entry) => {
            const full = await addEntry(openBook.id, entry);
            setBooks((prev) =>
              prev
                ? prev.map((b) =>
                    b.id === openBook.id ? { ...b, entries: [...b.entries, full] } : b,
                  )
                : prev,
            );
            return full;
          }}
          onPatchEntry={(entryId, patch) => {
            setBooks((prev) =>
              prev
                ? prev.map((b) =>
                    b.id === openBook.id
                      ? {
                          ...b,
                          entries: b.entries.map((e) =>
                            e.id === entryId ? { ...e, ...patch } : e,
                          ),
                        }
                      : b,
                  )
                : prev,
            );
          }}
          onDeleteEntry={(entryId) => {
            setBooks((prev) =>
              prev
                ? prev.map((b) =>
                    b.id === openBook.id
                      ? { ...b, entries: b.entries.filter((e) => e.id !== entryId) }
                      : b,
                  )
                : prev,
            );
            void deleteEntry(openBook.id, entryId);
          }}
          onRequestDeleteBook={() => setConfirmDeleteBook(openBook.id)}
        />
        {confirmDeleteBook === openBook.id ? (
          <ConfirmModal
            message={`焚毁「${openBook.name || "未命名之牌"}」？`}
            hint="这张牌的解析将一同化为灰烬，无法找回。"
            confirmText="焚毁"
            onCancel={() => setConfirmDeleteBook(null)}
            onConfirm={async () => {
              await deleteWorldBook(openBook.id);
              setConfirmDeleteBook(null);
              setTurningId(null);
              setOpenBookId(null);
              await load();
            }}
          />
        ) : null}
      </div>
    );
  }

  /* ---------------- 列表页：一张转盘 ----------------
     世界书不是等你来翻的读物，是摊在这张暗桌上的一圈牌——
     每一册就是一张，牌心那枚记号亮着，说明这一册还有条目在跑；
     记号沉下去，就是这一册已经收手。 */

  const liveTotal = books.reduce((n, b) => n + b.entries.filter((e) => !e.disabled).length, 0);

  /* 牌少了要收摊：焚掉几册之后 page 可能还停在旧位置上，
     座位号要按眼下的牌数收回来，否则剩下的那张会歪在侧边、还暗着。 */
  const seatPage = Math.min(page, Math.max(0, books.length - 1));

  /* 转盘手势：按下记住起点，拖动时整盘跟着指头走（直接写 style，不逐帧渲染）；
     松手看走了多远——够一格就转到隔壁那张，不够就弹回原位。
     竖直方向的滚动照旧留给页面（`touch-action: pan-y`）。 */
  const onStageTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
    draggedRef.current = false;
    if (stageRef.current) stageRef.current.style.transition = "none";
  };
  const onStageTouchMove = (e: React.TouchEvent) => {
    const start = touchX.current;
    if (start === null || !stageRef.current) return;
    const dx = e.touches[0].clientX - start;
    /* 「滑」的门槛要跟松手时那道 40px 用同一个数：门槛比它小的话，手指抖一下
       这一下既不算滑（不够 40px、盘弹回来），又因为 draggedRef 被关掉了 click、
       也不算点——点后排那张牌就整个没反应。 */
    draggedRef.current = Math.abs(dx) > 40;
    stageRef.current.style.transform = `translateX(${dx}px)`;
  };
  const onStageTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (stageRef.current) {
      stageRef.current.style.transition = "";
      stageRef.current.style.transform = "";
    }
    if (start === null) return;
    const dx = e.changedTouches[0].clientX - start;
    if (Math.abs(dx) < 40) return;
    const step = dx < 0 ? 1 : -1;
    setPage((p) => Math.max(0, Math.min(books.length - 1, p + step)));
  };

  return (
    <AppChrome
      title="世界书"
      titleEn="WORLD CHRONICLE"
      theme="arcana"
      headerRight={
        <div className="flex items-center gap-3">
          {/* 收录：只留一枚小图标，不加框（牌桌上不该出现方块按钮） */}
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            aria-label="收录一张牌"
            title="收录一张牌（JSON）"
            className="pressable flex h-8 w-6 items-center justify-center"
            style={{ color: MOON_FAINT }}
          >
            <Upload size={13} strokeWidth={1.4} />
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFileChange}
          />
          {/* 再落一张：小字＋一道底线，像牌桌上的落款。
              这一桌的字都走牌桌上的话（再摊一次／未落印／正在洗牌）：
              牌是一张张落上桌的，不是立起来的，所以这里不用「卷」这个动作。 */}
          <button
            type="button"
            onClick={async () => {
              const book = await createWorldBook();
              await load();
              /* 新落的牌在末位，转盘跟着移到它身上
                 （books 是这一帧的旧表，长度正好是新书的座位号）。 */
              setPage(books.length);
              setOpenBookId(book.id);
            }}
            className="pressable flex h-8 items-center gap-1 pb-0.5 text-[10px]"
            style={{
              color: MOON,
              letterSpacing: "0.18em",
              borderBottom: `1px solid ${MOON_LINE}`,
            }}
          >
            <Plus size={11} strokeWidth={1.5} />
            再落一张
          </button>
        </div>
      }
    >
      <div className="relative flex min-h-full flex-col">
      {/* 页眉：一道月白细线把左右两枚小字拉开，像牌桌上压着的一张签。
          左边 ARCANA 跟页面自己那套名字（ARCANA_FACE／.arcana-card）对齐。
          右边这枚是**这一桌的活气**：未立卷＝一张牌都没有；在燃＝全桌还有条目没被停用；
          静默＝牌都摊着、却一条都不在跑。
          「在燃」跟牌面上那支词同源（「三 星在燃」），别写成「正在跑」。 */}
      <div className="mb-5 mt-2 flex items-center gap-3">
        <span
          className="shrink-0 text-[9px] uppercase"
          style={{ color: MOON, letterSpacing: "0.34em" }}
        >
          Arcana
        </span>
        <span className="h-px flex-1" style={{ background: MOON_LINE }} />
        <span
          className="shrink-0 text-[9px]"
          style={{ color: MOON_FAINT, letterSpacing: "0.24em" }}
        >
          {books.length === 0 ? "未立卷" : liveTotal > 0 ? "在燃" : "静默"}
        </span>
      </div>

      {/* 转盘：一屏就是一张牌阵。
          正中那张最大、正对着你；左右两张偏出去、退到后面、朝正中侧一点身，越远越小越暗。
          指头左右一动，整圈转一格——正中那张退到右边，右边那张绕到更后面去。
          这是「转」，不是「滚」：每张牌站在哪儿，永远相对正中那张来算。
          这一格**撑满整页**——页眉压在顶上、页码点落在最底，
          中间剩下的高度全归牌桌，牌就立在这块地的正中。
          牌桌那一格自己带着量尺（ref={bindTable}）：牌高＝这格实高 × 86%，写进 --arcana-h，
          所以牌不是「按某个屏调好的一个尺寸」，而是「这格该有的份量」。 */}
      <div className="flex flex-1 flex-col">
        {books.length > 0 ? (
          <>
            <div
              ref={bindTable}
              className="arcana-table relative -mx-4 flex-1 overflow-hidden"
              style={{ touchAction: "pan-y" }}
              onTouchStart={onStageTouchStart}
              onTouchMove={onStageTouchMove}
              onTouchEnd={onStageTouchEnd}
            >
              <div className="absolute inset-0" style={{ perspective: "1400px" }}>
                <div ref={stageRef} className="arcana-stage absolute inset-0">
                  {books.map((book, i) => {
                    const offset = i - seatPage;
                    /* 只画正中与左右各两张，再远的留在盘后面不画（省电，也省得算）。 */
                    if (Math.abs(offset) > 2) return null;
                    const seat = arcanaSeat(offset);
                    const run = runningOf(book);
                    const turning = turningId === book.id;
                    /* 正中那张＝「抽到的这一张」：它亮，从底下往上亮（翻走的那张跟着熄）。 */
                    const litSeat = offset === 0 && !turning;
                    return (
                      <button
                        key={book.id}
                        type="button"
                        aria-label={book.name || "未命名之牌"}
                        onClick={() => {
                          if (draggedRef.current) return;
                          /* 点旁边那张：转过来，让它站到正中。 */
                          if (offset !== 0) {
                            setPage(i);
                            return;
                          }
                          /* 点正中那张：它先翻过去，解析页再从它身上展开。 */
                          setTurningId(book.id);
                          window.setTimeout(() => setOpenBookId(book.id), 300);
                        }}
                        className={`arcana-card absolute left-1/2 top-1/2 block overflow-hidden rounded-[3px] ${
                          turning ? "arcana-turn" : ""
                        }`}
                        style={{
                          /* 牌高＝牌桌那格的高度 × --arcana-h；牌宽按真塔罗牌的高宽比推。
                             字号取牌高的定比，牌面上其它尺寸全走 em，跟着牌一起长。
                             居中不靠负 margin——牌高是算出来的，负 margin 写不出来。 */
                          height: "var(--arcana-h)",
                          width: `calc(var(--arcana-h) / ${ARCANA_RATIO})`,
                          fontSize: `calc(var(--arcana-h) * ${ARCANA_FONT})`,
                          fontFamily: "var(--font-arcana)",
                          background: ARCANA_FACE,
                          /* 外晕：正中那张多带一层金光（见 ARCANA_SELECT_OUT 上头那段）。
                             它是加在牌原有的落影之后，不是替换——牌还是得立在桌上，不能飘着。 */
                          boxShadow: litSeat
                            ? `${ARCANA_SHADOW}, ${ARCANA_SELECT_OUT}`
                            : ARCANA_SHADOW,
                          zIndex: seat.zIndex,
                          /* 翻过去的那张自己熄掉——写在 inline 上，因为 inline 的 opacity
                             压得住 `.arcana-turn` 里的声明（这一手只有正中那张会用到）。
                             「排在后面就暗一档」**不在这里做**：那是牌面上一层黑罩子（见下），
                             整张牌写 opacity 会把牌变半透明、把桌底透上来。 */
                          opacity: turning ? 0.1 : 1,
                          /* 后排那几张也点得到（点它就转到正中）：给最外两张关掉
                             pointer-events 的话，点它们没反应，看着就像「转过去了也没变亮」。 */
                          transform: turning
                            ? "translate(-50%, -50%) rotateY(-86deg) scale(1.03)"
                            : seat.transform,
                        }}
                      >
                        {/* 框在底下：那张金线的星月框，铺满整张牌 */}
                        <ArcanaFrame lit={run.live > 0} />
                        {/* 内泛光：光透进牌面那一层（外晕在牌外，见 boxShadow）。
                            压在框上、文字之下，screen 混合只提亮、不糊字；不是正中那张就收干净。 */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background: ARCANA_SELECT_IN,
                            mixBlendMode: "screen",
                            opacity: litSeat ? 1 : 0,
                            transition: "opacity 420ms linear",
                          }}
                        />
                        {/* 牌面上的字浮在框上。框拉满之后，牌的坐标就是图的坐标——
                            量过 frame-3：正中央从 22.1% 到 83.4% 是空的（再往上是被圆月压住的拱门，
                            再往下是星与浪），所以三处字都落在这段空里：序号 25%，书名与简介 33% 起，
                            范围与状态压到下沿 80% 收。字号走 em：1em 是牌面那把尺，牌长多大，这一整版跟着长多大。

                            书名取 1.4em、整块竖排（writing-mode: vertical-rl）。
                            竖排之后「行」变成「列」：书名一列大字落在最右，简介缩在它左边当小注，
                            从右往左读——古书里「正文一列、小注数行」正是这个排法。
                            一列写到格子下沿就自动折到左边下一列（竖排里管折列的是 max-height，
                            不是 max-width），所以名字再长也溢不出牌面。
                            折列那条线由外层这格 flex 的 top/bottom 给出：高度是定值，
                            子元素才敢写 maxHeight: 100%（父高不定时百分比算不出来）。 */}
                        <span className="absolute inset-0">
                          <span
                            className="absolute inset-x-0 block text-center"
                            style={{
                              top: "25%",
                              fontSize: "0.58em",
                              color: ARCANA_INK_FAINT,
                              letterSpacing: "0.34em",
                            }}
                          >
                            {ROMAN[i] ?? String(i + 1)}
                          </span>
                          <span
                            className="absolute inset-x-0 flex items-start justify-center gap-[0.5em]"
                            style={{ top: "33%", bottom: "20%", paddingInline: "1.2em" }}
                          >
                            {/* 简介排在左边：DOM 里写在书名前面，flex 行里它就在左边。
                                超长的字句已经在 cardDescription 里截掉，这里最多落下两列小字。 */}
                            {book.description ? (
                              <span
                                className="block"
                                style={{
                                  writingMode: "vertical-rl",
                                  maxHeight: "100%",
                                  overflow: "hidden",
                                  fontSize: "0.45em",
                                  color: ARCANA_INK_FAINT,
                                  letterSpacing: "0.06em",
                                  lineHeight: 1.6,
                                }}
                              >
                                {cardDescription(book.description)}
                              </span>
                            ) : null}
                            <span
                              className="block"
                              style={{
                                writingMode: "vertical-rl",
                                maxHeight: "100%",
                                overflow: "hidden",
                                fontSize: "1.4em",
                                color: ARCANA_INK,
                                letterSpacing: "0.12em",
                                lineHeight: 1.3,
                              }}
                            >
                              {book.name || "未命名之牌"}
                            </span>
                          </span>
                          <span
                            className="absolute inset-x-0 block text-center"
                            style={{
                              bottom: "20%",
                              fontSize: "0.45em",
                              color: ARCANA_INK_SOFT,
                              letterSpacing: "0.14em",
                            }}
                          >
                            {SCOPE_META[book.scope].label}
                            {" · "}
                            {book.entries.length === 0
                              ? "空卷"
                              : run.live > 0
                                ? `${CN_NUM[run.live] ?? run.live} 星在燃`
                                : "沉睡"}
                          </span>
                        </span>
                        {/* 后面那几张的「暗」，是这一层黑罩子——按座位给浓度，压在自己身上。
                            放最上层：牌面、金字、牌上的字一起沉，色相一点不动。
                            正中那张 dim 是 0（罩子收干净、牌回原色），紧邻 0.22，最外 0.55。
                            过渡只动 opacity：合成层上的活，手机不烫（省电铁律），
                            跟换座位那 420ms 同步（.arcana-card 里的 transform 也是 420ms）。 */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background: "#000",
                            opacity: seat.dim,
                            transition: "opacity 420ms linear",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 转到第几册：一点一册，走到的那点拉成一道月白的短线 */}
            {books.length > 1 ? (
              <div className="mt-5 flex items-center justify-center gap-1.5">
                {books.map((b, i) => (
                  <span
                    key={b.id}
                    aria-hidden
                    className="block h-[3px] rounded-full"
                    style={{
                      width: i === seatPage ? 14 : 3,
                      background: i === seatPage ? MOON : "rgba(237,231,218,0.20)",
                    }}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {/* 空状态：桌面上摆着一张还没落印的牌——
            空的这张也照着牌的样子裁，只是那副星月的框沉下去、名字还没写上。
            这张桌也带量尺（ref={bindTable}），牌跟真牌一样高——只是底下两行小字要坐得下，
            所以这张牌从这格里让出那两行的地方（.arcana-table-empty），不留 pb。 */}
        {books.length === 0 ? (
          <div
            ref={bindTable}
            className="arcana-table arcana-table-empty flex flex-1 flex-col items-center justify-center"
          >
            <div
              className="relative overflow-hidden rounded-[3px]"
              style={{
                height: "var(--arcana-h)",
                width: `calc(var(--arcana-h) / ${ARCANA_RATIO})`,
                fontSize: `calc(var(--arcana-h) * ${ARCANA_FONT})`,
                fontFamily: "var(--font-arcana)",
                background: ARCANA_FACE,
                boxShadow: ARCANA_SHADOW,
              }}
            >
              <ArcanaFrame lit={false} />
              <span className="absolute inset-0">
                {/* 「未落印」跟列表态那行书名同一处、同一版式：竖排、1.4em、同样从 33% 起——
                    框已经拉满整张牌，两处不齐会被一眼看出来。 */}
                <span
                  className="absolute inset-x-0 flex items-start justify-center"
                  style={{ top: "33%", bottom: "20%", paddingInline: "1.2em" }}
                >
                  <span
                    className="block"
                    style={{
                      writingMode: "vertical-rl",
                      maxHeight: "100%",
                      overflow: "hidden",
                      fontSize: "1.4em",
                      color: ARCANA_INK_FAINT,
                      letterSpacing: "0.12em",
                      lineHeight: 1.3,
                    }}
                  >
                    未落印
                  </span>
                </span>
              </span>
              {/* 空牌不整张写 opacity——半透明会把桌底透上来掺色，跟转盘上那几张
                  同一个毛病。改成牌面上一层黑罩子：只是淡，色还是自己的紫。 */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: "#000", opacity: 0.3 }}
              />
            </div>
            <p className="mt-7 text-[12px]" style={{ color: MOON_SOFT, letterSpacing: "0.2em" }}>
              这张桌还没有落牌
            </p>
            <p className="mt-2.5 text-[10px]" style={{ color: MOON_FAINT, letterSpacing: "0.12em" }}>
              点右上角「再落一张」，起第一张牌
            </p>
          </div>
        ) : null}
      </div>
      </div>

      {/* 收录结果 toast */}
      {importMsg ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-6 z-50">
          <p
            className="mx-auto w-fit rounded-[3px] px-3.5 py-2 text-center text-[10px]"
            style={{
              color: importMsg.startsWith("收录失败") ? ARCANA_RED : MOON,
              background: ARCANA_FACE,
              letterSpacing: "0.08em",
              boxShadow: ARCANA_SHADOW,
            }}
          >
            {importMsg}
          </p>
        </div>
      ) : null}
    </AppChrome>
  );
}

/* =======================================================================
 * 书本详情：书信息编辑＋这一册的解析列表（逐则展开编辑）
 * ===================================================================== */

function BookDetail({
  book,
  index,
  archiveCategories,
  archives,
  onBack,
  onPatchBook,
  onAddEntry,
  onPatchEntry,
  onDeleteEntry,
  onRequestDeleteBook,
}: {
  book: WorldBook;
  /* 这一册在牌桌上的位次（0 起）。牌面上印的是「第几张」，详情页顶上那行「第 N 册」
     得跟牌桌上数得对得上，所以这个数不从 book 里读，由牌桌那边数出来传进来。 */
  index: number;
  /** 档案的「世界」（分类）：绑定面板里能整世界一起绑。 */
  archiveCategories: ArchiveCategory[];
  archives: ArchiveEntry[];
  onBack: () => void;
  onPatchBook: (patch: Partial<Omit<WorldBook, "id" | "entries">>) => void;
  onAddEntry: (entry: Partial<WorldBookEntry>) => Promise<WorldBookEntry>;
  onPatchEntry: (entryId: string, patch: Partial<Omit<WorldBookEntry, "id">>) => void;
  onDeleteEntry: (entryId: string) => void;
  onRequestDeleteBook: () => void;
}) {
  // 书信息本地态（输入即时反馈，防抖落库）。
  // 父组件以 key={book.id} 挂载，切书时整组件重挂载，无需同步 effect。
  const [name, setName] = useState(book.name);
  const [desc, setDesc] = useState(book.description);
  const [scope, setScope] = useState<WorldBookScope>(book.scope);
  const [boundIds, setBoundIds] = useState<string[]>(book.boundCharacterIds);
  /* 绑定的世界（档案分类）：这个世界里的角色全都能读到这张牌。 */
  const [boundCatIds, setBoundCatIds] = useState<string[]>(book.boundCategoryIds || []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (snapshot: {
      name: string;
      description: string;
      scope: WorldBookScope;
      boundCharacterIds: string[];
      boundCategoryIds: string[];
    }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onPatchBook(snapshot);
        void updateWorldBook(book.id, snapshot);
      }, 500);
    },
    [book.id, onPatchBook],
  );

  const patchBookField = (
    next: Partial<{
      name: string;
      desc: string;
      scope: WorldBookScope;
      boundIds: string[];
      boundCatIds: string[];
    }>,
  ) => {
    const merged = {
      name: next.name !== undefined ? next.name : name,
      description: next.desc !== undefined ? next.desc : desc,
      scope: next.scope !== undefined ? next.scope : scope,
      boundCharacterIds: next.boundIds !== undefined ? next.boundIds : boundIds,
      boundCategoryIds: next.boundCatIds !== undefined ? next.boundCatIds : boundCatIds,
    };
    setName(merged.name);
    setDesc(merged.description);
    setScope(merged.scope);
    setBoundIds(merged.boundCharacterIds);
    setBoundCatIds(merged.boundCategoryIds);
    scheduleSave(merged);
  };

  return (
    <>
    <AppChrome
      title={name || "未命名之牌"}
      titleEn={SCOPE_META[scope].label.toUpperCase()}
      theme="arcana"
      onBack={onBack}
    >
      {/* 书信息卡＝**那张牌本身**，不是「一张白色卡片装着一堆表单」。
          照着列表页牌面的排法来：顶上居中一行序数（牌顶的罗马数字）、底下一副双线金框、
          字段的字竖着站在左边。 */}
      <section
        className="relative mb-5 overflow-hidden rounded-[2px] px-5 pb-5 pt-6"
        style={{ background: ARCANA_FACE, boxShadow: ARCANA_SHADOW }}
      >
        {/* 牌面的双线框：外一道、内一道，塔罗牌最外那两圈金线就是这么走的。
            内容要落在内框里面，所以这一节的左右内边距比内框再宽出一截（px-5 对 inset-12）。 */}
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ inset: 7, border: `1px solid ${ARCANA_EDGE}` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ inset: 12, border: `1px solid ${ARCANA_RULE}` }}
        />
        {/* 牌顶那行序数：**跟牌桌上那张牌印的是同一个字**——牌上是 I，这页顶上也是 I。
            这一行就是「这张牌展开成了这一页」的凭据：一册一张牌、一张牌一个序数。
            不写「详情」「信息」这类词，牌上不写这个。 */}
        <p
          className="relative text-center text-[13px]"
          style={{ color: ARCANA_INK_FAINT, letterSpacing: "0.42em" }}
        >
          {ROMAN[index] ?? String(index + 1)}
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => patchBookField({ name: e.target.value })}
          placeholder="为这张牌起个名字…"
          className="relative mt-2 w-full bg-transparent text-center text-[19px] font-medium outline-none placeholder:text-[rgba(168,138,80,0.4)]"
          style={{ color: ARCANA_INK, letterSpacing: "0.22em" }}
        />

        <RuleLine className="relative my-4" />

        <RuneField label="简介" className="relative">
          <textarea
            value={desc}
            onChange={(e) => patchBookField({ desc: e.target.value })}
            placeholder="这张牌上记着什么…（可留空）"
            rows={2}
            className="w-full resize-none bg-transparent text-[11px] leading-relaxed outline-none placeholder:text-[rgba(168,138,80,0.4)]"
            style={{ color: ARCANA_INK_SOFT }}
          />
        </RuneField>

        <RuneField label="范围" className="relative mt-4">
          <div className="flex gap-1.5">
            {(Object.keys(SCOPE_META) as WorldBookScope[]).map((key) => {
              const active = scope === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => patchBookField({ scope: key })}
                  className="pressable flex-1 rounded-[2px] border py-1.5 text-[10px] tracking-[0.14em]"
                  style={{
                    borderColor: active ? ARCANA_INK : ARCANA_EDGE,
                    color: active ? ARCANA_ON_GOLD : ARCANA_INK_SOFT,
                    background: active ? ARCANA_INK : "transparent",
                  }}
                  aria-label={SCOPE_META[key].hint}
                >
                  {SCOPE_META[key].label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[9px]" style={{ color: ARCANA_INK_FAINT }}>
            {SCOPE_META[scope].hint}
          </p>
        </RuneField>

        <RuneField label="角色" className="relative mt-4">
          {archives.length > 0 || archiveCategories.length > 0 ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="pressable flex w-full items-center justify-between rounded-[2px] border px-2.5 py-2"
              style={{ borderColor: ARCANA_EDGE }}
            >
              <span
                className="truncate text-[12px]"
                style={{
                  color:
                    boundIds.length === 0 && boundCatIds.length === 0
                      ? ARCANA_INK_FAINT
                      : ARCANA_INK,
                }}
              >
                {boundIds.length === 0 && boundCatIds.length === 0
                  ? "所有角色"
                  : [
                      ...boundCatIds.map(
                        (id) =>
                          `${archiveCategories.find((c) => c.id === id)?.name ?? "已删的世界"}（世界）`,
                      ),
                      ...boundIds.map(
                        (id) => archives.find((a) => a.id === id)?.data.name ?? "已删角色",
                      ),
                    ].join("、")}
              </span>
              <ChevronDown size={14} strokeWidth={1.6} className="ml-2 shrink-0 text-[rgba(168,138,80,0.55)]" />
            </button>
          ) : (
            <p className="text-[10px]" style={{ color: ARCANA_INK_FAINT }}>档案中还没有唤醒的角色</p>
          )}
          <p className="mt-1.5 text-[9px]" style={{ color: ARCANA_INK_FAINT }}>
            {boundIds.length === 0 && boundCatIds.length === 0
              ? "所有角色的对话都会读到这张牌"
              : `仅这 ${boundCatIds.length} 个世界与 ${boundIds.length} 位角色的对话会读到这张牌`}
          </p>
        </RuneField>
      </section>

      {/* 解析区题头：一条通栏金线，左边「解析」、右边这一册有几则（用汉字，见 CN_NUM）。
          牌上没有条款，这一册展开就是**对这一张牌的解析**，一册里的每一条就是一则解析。 */}
      <div className="mb-3 flex items-center gap-3">
        <span className="shrink-0 text-[10px] tracking-[0.4em]" style={{ color: ARCANA_INK_FAINT }}>
          解析
        </span>
        <RuleLine className="flex-1" />
        <span className="shrink-0 text-[10px]" style={{ color: ARCANA_INK_FAINT }}>
          {CN_NUM[book.entries.length] ?? book.entries.length}
        </span>
        <button
          type="button"
          onClick={async () => {
            await onAddEntry({ title: "" });
          }}
          className="pressable flex shrink-0 items-center gap-1 rounded-[2px] border px-2.5 py-1 text-[9px] tracking-[0.14em]"
          style={{ borderColor: ARCANA_EDGE, color: ARCANA_INK }}
        >
          <Plus size={10} strokeWidth={1.5} />
          新解析
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {book.entries.map((entry, i) => (
          <EntryCard
            key={entry.id}
            bookId={book.id}
            entry={entry}
            /* 第几则。解析卡左边那一列罗马数字就是它——详情页里每则也有自己的序数，
               跟牌桌上一册一张牌一样，一页里一款一则。 */
            index={i}
            onPatch={onPatchEntry}
            onDelete={onDeleteEntry}
          />
        ))}
        {book.entries.length === 0 ? (
          <div
            className="relative flex flex-col items-center overflow-hidden rounded-[2px] px-6 py-10"
            style={{ background: ARCANA_FACE, boxShadow: ARCANA_ENTRY_SHADOW }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute"
              style={{ top: 10, left: 10, right: 10, bottom: 10, border: `1px solid ${ARCANA_LINE}` }}
            />
            <p className="relative text-[11px] tracking-[0.22em]" style={{ color: ARCANA_INK }}>尚无解析</p>
            <p className="relative mt-2.5 text-[9px]" style={{ color: ARCANA_INK_FAINT, letterSpacing: "0.12em" }}>
              一张牌摊开，就是一则则解析：写下内容，配好触发关键词
            </p>
          </div>
        ) : null}
      </div>

      {/* 这一册的收口：先一条起笔有头的金线，线下一左一右两件事——
          拓印（把这张牌拓下来带走）与焚毁（整张烧了）。
          原先这两条是通栏按钮上下叠着，居中一个图标加一行字——那是「列表底部的操作区」，
          牌上不这样收：牌上是一条金线之下、一列一列地排。 */}
      <div className="mt-6 flex items-center gap-3">
        <span className="shrink-0 text-[10px] tracking-[0.4em]" style={{ color: ARCANA_INK_FAINT }}>
          此牌
        </span>
        <RuleLine className="flex-1" />
      </div>

      <div className="mt-3 flex gap-2">
      {/* 拓印此牌：导出 JSON（含 exportVersion，可直接再收录）。
          不用「传抄此书」那种书里的话——拓印＝把牌上的纹样印一份带走，正是「导出」在牌里的话。 */}
      <button
        type="button"
        onClick={() => {
          const exportData = {
            id: book.id,
            name,
            description: desc,
            scope,
            boundCharacterIds: boundIds,
            entries: book.entries,
            exportTime: new Date().toISOString(),
            exportVersion: "1.0",
          };
          const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.download = `${name || "未命名之牌"}_世界书_${new Date().toISOString().slice(0, 10)}.json`;
          a.href = url;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }}
        className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-[2px] border py-2.5 text-[10px] tracking-[0.2em]"
        style={{
          borderColor: ARCANA_EDGE,
          color: ARCANA_INK,
        }}
      >
        <Download size={12} strokeWidth={1.5} />
        拓印此牌
      </button>

      {/* 焚毁此牌：暗底上的蜡印红，比纸面那版亮一号 */}
      <button
        type="button"
        onClick={onRequestDeleteBook}
        className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-[2px] border py-2.5 text-[10px] tracking-[0.2em]"
        style={{
          borderColor: "rgba(194,96,76,0.4)",
          color: "rgba(194,96,76,0.9)",
          background: "rgba(194,96,76,0.07)",
        }}
      >
        <Trash2 size={12} strokeWidth={1.5} />
        焚毁此牌
      </button>
      </div>
      </AppChrome>

      {/* 绑定面板（底部动作面板，多选）：世界一节＋角色一节。 */}
      {pickerOpen ? (
        <CharacterPicker
          archives={archives}
          categories={archiveCategories}
          selected={boundIds}
          selectedCats={boundCatIds}
          onToggle={(id) =>
            patchBookField({
              boundIds: boundIds.includes(id)
                ? boundIds.filter((x) => x !== id)
                : [...boundIds, id],
            })
          }
          onToggleCat={(id) =>
            patchBookField({
              boundCatIds: boundCatIds.includes(id)
                ? boundCatIds.filter((x) => x !== id)
                : [...boundCatIds, id],
            })
          }
          onSelectAll={() => patchBookField({ boundIds: [], boundCatIds: [] })}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

/* =======================================================================
 * 解析卡：折叠态显示概要，展开态编辑全部栏位（500ms 防抖落库）
 * ===================================================================== */

function EntryCard({
  bookId,
  entry,
  index,
  onPatch,
  onDelete,
}: {
  bookId: string;
  entry: WorldBookEntry;
  /* 第几条（0 起）：左边那一列罗马数字。 */
  index: number;
  onPatch: (entryId: string, patch: Partial<Omit<WorldBookEntry, "id">>) => void;
  onDelete: (entryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [keys, setKeys] = useState(entry.keys);
  const [content, setContent] = useState(entry.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(
    (snapshot: { title: string; keys: string; content: string }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onPatch(entry.id, snapshot);
        void updateEntry(bookId, entry.id, snapshot);
      }, 500);
    },
    [bookId, entry.id, onPatch],
  );

  const patchField = (next: Partial<{ title: string; keys: string; content: string }>) => {
    const merged = {
      title: next.title !== undefined ? next.title : title,
      keys: next.keys !== undefined ? next.keys : keys,
      content: next.content !== undefined ? next.content : content,
    };
    setTitle(merged.title);
    setKeys(merged.keys);
    setContent(merged.content);
    scheduleSave(merged);
  };

  const keyList = parseEntryKeys(keys);

  return (
    <div
      className="relative overflow-hidden rounded-[2px]"
      style={{
        background: ARCANA_FACE,
        boxShadow: ARCANA_ENTRY_SHADOW,
        opacity: entry.disabled ? 0.55 : 1,
      }}
    >
      {/* 折叠头：左边**竖着**站一列罗马数字，一条竖金线把序数与内容分开。
          （原先这里是个「§」——那是法条／文章的记号，不是牌上的记号。牌上用的是序数：
          一册一张牌、一张牌印一个罗马数字，那么一册里的每一则解析也该有自己的序数。
          这条竖线与书信息卡里的栏位是同一支笔画的，两处才是一套。） */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-stretch gap-2.5 px-3.5 py-3 text-left"
      >
        <span
          className="shrink-0 select-none text-[10px]"
          style={{
            writingMode: "vertical-rl",
            color: ARCANA_INK_FAINT,
            letterSpacing: "0.24em",
            lineHeight: 1,
          }}
        >
          {ROMAN[index] ?? String(index + 1)}
        </span>
        <div className="min-w-0 flex-1 border-l pl-2.5" style={{ borderColor: ARCANA_RULE }}>
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-[12px] tracking-[0.14em]"
              style={{ color: ARCANA_INK }}
            >
              {title || "未命名解析"}
            </span>
            {entry.constant ? (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded-[2px] px-1 py-0.5 text-[7px] tracking-[1px]"
                style={{ background: "rgba(168,138,80,0.14)", color: ARCANA_INK }}
              >
                <Pin size={7} strokeWidth={2} />
                常驻
              </span>
            ) : null}
            {entry.disabled ? (
              <span
                className="shrink-0 rounded-[2px] px-1 py-0.5 text-[7px] tracking-[1px]"
                style={{ background: "rgba(194,96,76,0.18)", color: ARCANA_RED }}
              >
                停用
              </span>
            ) : null}
            {!entry.constant && entry.probability < 100 ? (
              <span
                className="shrink-0 rounded-[2px] px-1 py-0.5 text-[7px] tracking-[1px]"
                style={{ background: "rgba(168,138,80,0.09)", color: ARCANA_INK_SOFT }}
              >
                {entry.probability}%
              </span>
            ) : null}
          </div>
          {/* 关键词 chips／正文预览 */}
          {!entry.constant && keyList.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {keyList.slice(0, 4).map((k) => (
                <span
                  key={k}
                  className="rounded-[1px] border px-1.5 py-0.5 text-[8px] tracking-[0.08em]"
                  style={{ borderColor: ARCANA_RULE, color: ARCANA_INK_SOFT }}
                >
                  {k}
                </span>
              ))}
              {keyList.length > 4 ? (
                <span className="text-[8px] text-[rgba(168,138,80,0.5)]">+{keyList.length - 4}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 line-clamp-1 text-[9px]" style={{ color: ARCANA_INK_FAINT }}>
              {content || "尚未落字"}
            </p>
          )}
        </div>
        <ChevronDown
          size={14}
          strokeWidth={1.6}
          className="shrink-0 self-center text-[rgba(168,138,80,0.55)]"
          style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
        />
      </button>

      {/* 展开编辑区 */}
      {expanded ? (
        <div className="border-t px-3.5 py-3.5" style={{ borderColor: ARCANA_RULE }}>
          {/* 栏位一律「竖排标签 ＋ 一条竖金线」，与书信息卡同一支笔（RuneField）。
              原先每栏是「左右两道细线横夹一行小字」（FieldLabel）——那是杂志扉页的排法；
              牌上不横夹，牌上的字自己竖着站。 */}
          <RuneField label="名称">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                patchField({ title: e.target.value });
              }}
              placeholder="如：星海城的禁忌（备注用）"
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-[rgba(168,138,80,0.4)]"
              style={{ color: ARCANA_INK }}
            />
          </RuneField>

          <RuneField label="关键词" className="mt-4">
            <input
              type="text"
              value={keys}
              onChange={(e) => {
                patchField({ keys: e.target.value });
              }}
              placeholder="逗号分隔，如：星海城，禁地"
              className="w-full bg-transparent text-[11px] outline-none placeholder:text-[rgba(168,138,80,0.4)]"
              style={{ color: ARCANA_INK_SOFT }}
            />
          </RuneField>

          <RuneField label="正文" className="mt-4">
            <textarea
              value={content}
              onChange={(e) => {
                patchField({ content: e.target.value });
              }}
              placeholder="写下这条设定，AI 会在关键词命中时读到它…"
              rows={5}
              className="w-full resize-none rounded-[2px] border bg-[rgba(237,231,218,0.04)] px-2.5 py-2 text-[11px] leading-relaxed outline-none placeholder:text-[rgba(168,138,80,0.4)]"
              style={{ borderColor: ARCANA_RULE, color: ARCANA_INK_SOFT }}
            />
          </RuneField>

          <RuneField label="注入" className="mt-4">
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(POSITION_META) as EntryPosition[]).map((pos) => {
                const active = entry.position === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => {
                      onPatch(entry.id, { position: pos });
                      void updateEntry(bookId, entry.id, { position: pos });
                    }}
                    className="pressable rounded-[2px] border py-1.5 text-[9px] tracking-[0.5px]"
                    style={{
                      borderColor: active ? ARCANA_INK : ARCANA_EDGE,
                      color: active ? ARCANA_ON_GOLD : ARCANA_INK_SOFT,
                      background: active ? ARCANA_INK : "transparent",
                    }}
                  >
                    {POSITION_META[pos].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[9px]" style={{ color: ARCANA_INK_FAINT }}>
              {POSITION_META[entry.position].hint}
            </p>
          </RuneField>

          {/* 常驻的那条没有概率可拨——概率是「按关键词候命」才算的数。
              这一句也顺路替掉了原先最底下那块说明的位置。 */}
          {entry.constant ? (
            <p className="mt-4 text-[9px] leading-relaxed" style={{ color: ARCANA_INK_FAINT }}>
              常驻解析每轮必注入，触发概率不生效
            </p>
          ) : (
            <RuneField label="触发概率" className="mt-4">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={entry.probability}
                  onChange={(e) => {
                    const probability = Number(e.target.value);
                    onPatch(entry.id, { probability });
                    void updateEntry(bookId, entry.id, { probability });
                  }}
                  className="h-6 flex-1"
                  style={{ accentColor: ARCANA_INK }}
                  aria-label="触发概率"
                />
                <span
                  className="w-10 shrink-0 text-right text-[11px]"
                  style={{ color: ARCANA_INK_SOFT, fontFamily: "var(--font-geist-mono), monospace" }}
                >
                  {entry.probability}%
                </span>
              </div>
            </RuneField>
          )}

          {/* 收口：一条起笔有头的金线划开，底下是这一条的两枚开关与了结。
              （原先这里直接从栏位接上来一排按钮，没有分界；牌上每一分区都由一条金线起头。） */}
          <RuleLine className="mt-4" />

          <div className="mt-3.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onPatch(entry.id, { constant: !entry.constant });
                void updateEntry(bookId, entry.id, { constant: !entry.constant });
              }}
              className="pressable flex-1 rounded-[2px] border py-1.5 text-[9px] tracking-[0.14em]"
              style={{
                borderColor: entry.constant ? ARCANA_INK : ARCANA_EDGE,
                color: entry.constant ? ARCANA_ON_GOLD : ARCANA_INK_SOFT,
                background: entry.constant ? ARCANA_INK : "transparent",
              }}
            >
              常驻注入
            </button>
            <button
              type="button"
              onClick={() => {
                onPatch(entry.id, { disabled: !entry.disabled });
                void updateEntry(bookId, entry.id, { disabled: !entry.disabled });
              }}
              className="pressable flex-1 rounded-[2px] border py-1.5 text-[9px] tracking-[0.14em]"
              style={{
                borderColor: entry.disabled ? ARCANA_RED : "rgba(194,96,76,0.35)",
                color: entry.disabled ? MOON : ARCANA_RED,
                background: entry.disabled ? ARCANA_RED : "transparent",
              }}
            >
              停用
            </button>
          </div>

          {/* 了结这一则：靠右收在角上，不占一整行——一则的抹去不必跟开关一样重。
              按钮不写「删除此条」（太像表格行操作）：整张牌是「焚毁此牌」，
              那么去掉一则解析就是把它从牌上焚去。 */}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onDelete(entry.id)}
              className="pressable flex items-center gap-1 text-[9px] tracking-[0.14em] text-[rgba(194,96,76,0.85)]"
            >
              <Trash2 size={10} strokeWidth={1.5} />
              焚去此解析
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* =======================================================================
 * 绑定面板：底部动作面板，多选——先「世界」一节（整世界一起绑），再逐个角色。
 * 「所有角色」＝世界与角色两个都清空（老规矩不变）。
 * ===================================================================== */

function CharacterPicker({
  archives,
  categories,
  selected,
  selectedCats,
  onToggle,
  onToggleCat,
  onSelectAll,
  onClose,
}: {
  archives: ArchiveEntry[];
  /** 档案的世界（分类）：勾一个＝这个世界里的角色全绑上（角色挪进挪出跟着档案走）。 */
  categories: ArchiveCategory[];
  selected: string[];
  selectedCats: string[];
  onToggle: (id: string) => void;
  onToggleCat: (id: string) => void;
  onSelectAll: () => void;
  onClose: () => void;
}) {
  const allActive = selected.length === 0 && selectedCats.length === 0;

  const row = (
    key: string,
    label: string,
    active: boolean,
    onClick: () => void,
    note?: string,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="pressable flex w-full items-center justify-between gap-3 border-b py-3 text-left last:border-b-0"
      style={{ borderColor: ARCANA_RULE }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[13px] tracking-[0.1em]"
          style={{ color: active ? ARCANA_INK : ARCANA_INK_SOFT }}
        >
          {label}
        </span>
        {note ? <span className="block text-[9px]" style={{ color: ARCANA_INK_FAINT }}>{note}</span> : null}
      </span>
      {/* 记号改成一枚**菱形**：牌上金线的起笔就是这枚（见 RuleLine 那一头）。
          选中＝实心金（像是刻进牌里的），没选＝只剩一道边。
          原先那个方形勾选框是「表单」的记号——牌上没有表单，只有记号。 */}
      <span
        aria-hidden
        className="shrink-0"
        style={{
          width: 9,
          height: 9,
          transform: "rotate(45deg)",
          background: active ? ARCANA_INK : "transparent",
          border: `1px solid ${active ? ARCANA_INK : ARCANA_EDGE}`,
        }}
      />
    </button>
  );

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      {/* 背幕 */}
      <div className="absolute inset-0 bg-black/55" />
      {/* 面板本体：跟牌同一张墨紫的脸，从底边升起来 */}
      <div
        className="relative max-h-[62%] overflow-y-auto rounded-t-[14px] border-t px-4 pt-2"
        style={{
          borderColor: ARCANA_EDGE,
          background: ARCANA_FACE,
          paddingBottom: "calc(var(--safe-area-bottom) + 14px)",
          boxShadow: "0 -6px 30px rgba(0,0,0,0.75)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 拖动指示条 */}
        <div className="mx-auto mb-3 h-[3px] w-9 rounded-full" style={{ background: "rgba(237,231,218,0.22)" }} />

        {/* 题头跟详情页的解析区一个写法：左边一个词、中间一条起笔有头的金线、右边一件事。 */}
        <div className="mb-1 flex items-center gap-3">
          <span className="shrink-0 text-[10px] tracking-[0.4em]" style={{ color: ARCANA_INK_FAINT }}>
            绑定
          </span>
          <RuleLine className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="pressable shrink-0 rounded-[2px] border px-2.5 py-1 text-[10px] tracking-[0.14em]"
            style={{ borderColor: ARCANA_EDGE, color: ARCANA_INK }}
          >
            完成
          </button>
        </div>

        {row("all", "所有角色", allActive, onSelectAll, "不指定绑定，谁都能读到")}

        {/* 世界一节：勾一个世界＝这个世界里的角色全都绑上（活名单，跟着档案走）。
            没有自订世界时这一节整个不露（只剩「所有角色」与角色行，跟从前一个样子）。 */}
        {categories.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-3">
              <span className="shrink-0 text-[9px] tracking-[0.34em]" style={{ color: ARCANA_INK_FAINT }}>
                世界
              </span>
              <RuleLine className="flex-1" />
            </div>
            {categories.map((c) =>
              row(
                `cat-${c.id}`,
                c.name,
                selectedCats.includes(c.id),
                () => onToggleCat(c.id),
                "这个世界里的角色，对话都读这张牌",
              ),
            )}
          </div>
        ) : null}

        {/* 角色一节：逐个挑。 */}
        {archives.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-3">
              <span className="shrink-0 text-[9px] tracking-[0.34em]" style={{ color: ARCANA_INK_FAINT }}>
                角色
              </span>
              <RuleLine className="flex-1" />
            </div>
            {archives.map((a) =>
              row(a.id, a.data.name || "未命名", selected.includes(a.id), () => onToggle(a.id)),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =======================================================================
 * 确认弹窗（暗底牌面风，对齐档案的深色确认弹窗结构）
 * ===================================================================== */

function ConfirmModal({
  message,
  hint,
  confirmText,
  onCancel,
  onConfirm,
}: {
  message: string;
  hint: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 px-8 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-[260px] overflow-hidden rounded-[2px] px-5 py-6"
        style={{ background: ARCANA_FACE, boxShadow: ARCANA_SHADOW }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 跟书信息卡同一副双线金框：外一道、内一道——这不是个「对话框」，
            是桌上升起来的那张牌，问的正是这一件事。 */}
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ inset: 7, border: `1px solid ${ARCANA_EDGE}` }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{ inset: 12, border: `1px solid ${ARCANA_RULE}` }}
        />
        {/* 顶上那枚蜡印：只有「要烧掉一样东西」的时候才亮出来——这个弹窗只干这一件事。 */}
        <div className="relative flex justify-center">
          <WaxSeal size={26} />
        </div>
        <h3 className="relative mt-3 text-center text-[13px] tracking-[0.2em]" style={{ color: ARCANA_INK }}>
          {message}
        </h3>
        <p className="relative mt-2 text-center text-[10px] leading-relaxed" style={{ color: ARCANA_INK_SOFT }}>{hint}</p>
        <RuleLine className="relative my-4" />
        <div className="relative flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="pressable flex-1 rounded-[2px] border py-2 text-[11px] tracking-[0.2em]"
            style={{ borderColor: ARCANA_EDGE, color: ARCANA_INK_SOFT }}
          >
            留下
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            className="pressable flex-1 rounded-[2px] py-2 text-[11px] tracking-[0.2em]"
            style={{ background: ARCANA_RED, color: MOON }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
