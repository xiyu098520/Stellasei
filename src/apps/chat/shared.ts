/**
 * 星绥通讯共享配色与工具。
 *
 * C ＝ 旧板（米白复古纸质风），档案／记忆／我的／两个设置面板还在用，先留住。
 * T ＝ 聊天主界面专用板。
 */

import type { ChatMessage } from "@/types/chat";

export const C = {
  bg: "#FDFCFB",
  paper: "#FFFFFF",
  ink: "#2E2A27",
  ink2: "#8A837C",
  ink3: "#B7B0A8",
  rose: "#B0776A",
  roseDeep: "#9A6255",
  gold: "#B9965F",
  red: "#D9534F",
  line: "rgba(46,42,39,.07)",
  lineSoft: "rgba(46,42,39,.045)",
} as const;

/**
 * 聊天主界面配色。
 * 底色是透粉的白，主色是一支亮粉，蓝只做小面积点睛，黄只落在极小的一处；
 * 出彩全靠字号对比、留白、圆角和按钮的分量，不靠比喻。
 * 避开「安全色」与硬套主题两条路；红色只做功能性的报错，不参与装饰配色。
 */
export const T = {
  bg: "#FFF7F9", // 页面底：白里透粉（不是米白、不是灰）
  card: "#FFFFFF", // 卡面／浮起来的零件
  ink: "#141318", // 墨：主文字、侧边栏底
  ink2: "#7A7178", // 次级：预览、签名
  ink3: "#B4A9B0", // 淡：时间、注脚、占位
  pink: "#E86A9B", // 主粉：主按钮、未读、当前项；保持低饱和、别调亮（柔玫瑰，橘调已褪）
  pinkSoft: "#F9DFE9", // 淡粉：图标底、按下底（跟着主粉一起降饱和）
  blue: "#8FBCEC", // 蓝：对话里的第二色（马卡龙蓝：青蓝调、粉质感、明度高）
  //                 这个蓝浅，**别再拿它当底配白字**
  blueDeep: "#2C5A9E", // 深蓝：只在「浅蓝底上要写字」的地方用（如置顶小牌的字），保证看得清
  blueSoft: "#E9F2FD", // 淡蓝：浅底（跟着马卡龙蓝一起偏奶）
  yellow: "#FFD84D", // 黄：只在极小零件上跳一下
  danger: "#E5484D", // 危险/报错：删除、发送失败、连接失败
  line: "rgba(20,19,24,.09)", // 细边
  lineSoft: "rgba(20,19,24,.05)", // 更淡的分隔
} as const;

/**
 * 消息页「雾蓝白灰」板（简约大气定稿）。
 * 与 T 并存 —— T 是聊天窗等旧板，这份只管消息列表页与底部 tab；
 * 只是**新增**一套取值，T 一点没动。
 */
export const HZ = {
  paper: "#FAF9F6", // 页面底
  paper2: "#F2F3F1", // 气泡组的面
  ink: "#3A4149", // 主文字
  ink2: "#7A8A9E", // 次级（预览）
  ink3: "#B3B8BE", // 淡（时间、小标）
  line: "rgba(58,65,73,.13)", // 细边
  line2: "rgba(58,65,73,.07)", // 更淡的分隔
  accent: "#5A7391", // 雾蓝主色
  accentSoft: "#E7ECF2", // 淡雾蓝
} as const;

/** 界面无衬线。新配色是干净现代的路子，主文字不用宋体。 */
export const SANS =
  "var(--font-sans), -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

/** 小字拉丁（分区小标、时间、未读数字、tab 英文）：等宽，冷静克制。 */
export const LAT = 'ui-monospace, "SFMono-Regular", Consolas, monospace';

/** 中文宋体：全 App 统一用它。
    不下载字体——直接吃系统宋体（iOS/macOS 的「Songti SC」是与思源宋体最接近的
    那一支），零请求、零换装闪。 */
export const SERIF =
  "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun', Georgia, serif";
/** 中文楷体（系统楷体，零下载、零闪）。自带笔锋，用在红封套这种中式卡面上。 */
export const KAI =
  "'Kaiti SC', 'STKaiti', 'KaiTi', 'Songti SC', Georgia, serif";

/** 英文装饰衬线（斜体小字：messages / pinned / lucky money…）。 */
export const EN = "var(--font-serif)";

/** 头像渐变兜底（**没照片**时画首字用的底）。
    落在主粉上（`T.pink` 起、深一档收尾，白首字能看清），别用暖棕。
    兜底头像与参考图占位**全 App 一起跟随**（消息列表／通讯人／聊天窗口／
    我的页／记忆／角色设置／聊天设置都引它）。 */
export const AVATAR_GRADIENT = "linear-gradient(135deg,#E5769F,#B93F72)";


/** 聊天背景的默认底色（没上传壁纸时用它）。
    透粉的白：起手纯白、收尾一点透粉，最深的一角也只是淡粉，压在输入框上方不发黄。
    **不再有彩色预设**，聊天背景只留「默认底色 ＋ 自传壁纸」两态——
    底色将来归全局样式统管，这里就只留这一个值。 */
export const CHAT_BG_DEFAULT = "linear-gradient(160deg,#FFFFFF,#FFF0F5)";

/** 历史分页（1.7.36）：消息流／线下记录**默认只上屏最近这么多条**，
    往上翻靠最顶上那颗「加载更早的」一次再推这么多——线上线下一枚数、一套做法。
    **只管屏幕**：喂模型的历史一直是全量，与这个数一点关系都没有。 */
export const CHAT_PAGE_SIZE = 50;

/** 消息类型中文标签（列表预览与复制用）。 */
export const TYPE_CN: Record<string, string> = {
  image: "图片",
  voice: "语音",
  redpacket: "红包",
  transfer: "转账",
  /* 收款回执（1.4.40）：钱到账后收款方发出的那张卡。列表最后一条是它时，
     预览就显示「[收款回执]」——比裸一句「已收款」说得清是什么。 */
  receipt: "收款回执",
  file: "文件",
  location: "位置",
  system: "系统",
};

const pad = (n: number) => n.toString().padStart(2, "0");

/** 气泡内时间：一律时:分。 */
export function msgTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 会话列表时间：今天时:分，昨天显示「昨天」，更早显示月/日。 */
export function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 会话列表预览文案（非文字消息显示类型标签）。 */
export function previewOf(m: ChatMessage | undefined): string {
  if (!m) return "开始对话吧";
  const type = m.type ?? "text";
  if (type !== "text") return `[${TYPE_CN[type] ?? "消息"}]`;
  return m.role === "user" ? `我：${m.content}` : m.content;
}

/**
 * 签名默认值（TA 还没在聊天里自己改过签名时）：用户档案里替他填的那一格 → 兜底文案。
 * 签名在档案里单开一格，不从人设里截第一句当签名（那种句子顶在资料页上很怪）。
 * TA 在聊天里自己改过的话以 Conversation.signature 为准（调用处先取
 * conv.signature，空才落到这里）。
 */
export function defaultSignature(d: { signature?: string }): string {
  const s = (d.signature ?? "").trim();
  return s || "TA 一直都在";
}

/** 聊天流里的日期分隔条文案：今天／昨天／X月X日（跨年再加年份）。
    消息流按天分段落，一天的开头插一枚居中的日期胶囊，不再每条消息各挂一行小字时间。 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "昨天";
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 两条消息是否同一天（聊天流分组用）。 */
export function sameDay(a: string, b: string): boolean {
  return isSameDay(new Date(a), new Date(b));
}

/**
 * 动态时间戳（微信那一套，2026-09-22 恩熙定的）：
 * 「刚刚」→「N分钟前」→「N小时前」→「昨天」→「前天」→ 再往前直接给「日期＋时间」。
 *
 * 为什么不是「几点几分」：动态一眼要知道的是**多久以前**，不是钟点。
 * 确切时间不用丢——点一下这枚时间戳就换过来（见 `momentFullTime` 与 `MomentStamp`）。
 * 只有「今天／昨天／前天」这三档才说相对话；更早（哪怕只是上周）就说死日期，
 * 因为「11 天前」这种话反而要人自己换算。
 */
export function momentTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (isSameDay(d, now)) return `${Math.floor(diff / 3_600_000)}小时前`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "昨天";
  const before = new Date(now);
  before.setDate(now.getDate() - 2);
  if (isSameDay(d, before)) return "前天";
  return momentFullTime(iso);
}

/** 动态时间的「确切版」：`M月D日 时:分`（跨年再加上年份）。点一下那枚时间戳就换它。 */
export function momentFullTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear()
    ? `${md} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}年${md} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
