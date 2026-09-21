/**
 * 星绥通讯共享配色与工具。
 *
 * C ＝ 旧板（米白复古纸质风），档案／记忆／我的／两个设置面板还在用，先留住。
 * T ＝ 聊天主界面专用板（2026-09-20 第三版设计）。
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
 * 聊天主界面配色（2026-09-20 第三版设计）。
 * 恩熙这一版的原话：「我喜欢的是特别一点的感觉…色彩跳脱」「它的配色非常的舒服，
 * 非常顺眼，但是不要在安全色里打转」「重点是排版跟设计」「为什么一定要有一个主题呢」。
 * 前面几版都死在两点上：一是米白／暖白／雾灰这类「安全色」，天生带公文感；二是硬套
 * 一个主题（星轨、刊物），拿概念遮住了设计本身。这一版两样都不要——
 * 底色是透粉的白，主色是一支亮粉，蓝只做小面积点睛，黄只落在极小的一处；
 * 出彩全靠字号对比、留白、圆角和按钮的分量，不靠比喻。
 * 红色只做功能性的报错，不参与装饰配色。（恩熙 2026-09-20）
 */
export const T = {
  bg: "#FFF7F9", // 页面底：白里透粉（不是米白、不是灰）
  card: "#FFFFFF", // 卡面／浮起来的零件
  ink: "#141318", // 墨：主文字、侧边栏底
  ink2: "#7A7178", // 次级：预览、签名
  ink3: "#B4A9B0", // 淡：时间、注脚、占位
  pink: "#E86A9B", // 主粉：主按钮、未读、当前项（2026-09-20 恩熙要「不要那么亮、那么高饱和」，
  //                 从原来的亮玫粉 #FF4D8D 降了一档饱和度与明度，橘调褪掉，成柔玫瑰）
  pinkSoft: "#F9DFE9", // 淡粉：图标底、按下底（跟着主粉一起降饱和）
  blue: "#8FBCEC", // 蓝：对话里的第二色（2026-09-20 恩熙要「加一点蓝，但不要高饱和的」，
  //                  从亮蓝 #3D5AFE 换成雾靛蓝；2026-09-21 恩熙先说「更蓝一点」→ #4472E0，
  //                  又说「应该是有点马卡龙的那种蓝」——正蓝再往浅、往奶挪一档，
  //                  成马卡龙蓝（青蓝调、粉质感、明度高）。这个蓝浅，**别再拿它当底配白字**）
  blueDeep: "#2C5A9E", // 深蓝：只在「浅蓝底上要写字」的地方用（如置顶小牌的字），保证看得清
  blueSoft: "#E9F2FD", // 淡蓝：浅底（跟着马卡龙蓝一起偏奶）
  yellow: "#FFD84D", // 黄：只在极小零件上跳一下
  danger: "#E5484D", // 危险/报错：删除、发送失败、连接失败
  line: "rgba(20,19,24,.09)", // 细边
  lineSoft: "rgba(20,19,24,.05)", // 更淡的分隔
} as const;

/** 界面无衬线。新配色是干净现代的路子，主文字不用宋体。 */
export const SANS =
  "var(--font-sans), -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

/** 中文宋体（旧板 C 那一套还在用，留住）。 */
export const SERIF = "var(--font-serif-sc), 'Songti SC', Georgia, serif";
/** 英文装饰衬线（斜体小字：messages / pinned / lucky money…）。 */
export const EN = "var(--font-playfair), Georgia, serif";

/** 头像渐变兜底（**没照片**时画首字用的底）。
    恩熙 2026-09-21：「如果没有照片的话，一律用首字母的地方啊。你不要做成那个棕色，
    你应该也是要跟随的主题的，对不对？然后以及这个参考图也是，没有参考图之前，它也是
    棕色的，你要改掉。」
    ——原来是旧板的暖棕 `#C9A876 → #B0776A`，全 App 换板时是漏网之鱼：换个颜色头像
    就「不跟随」了。现在落到新板主粉上（`T.pink` 起、深一档收尾，白首字能看清）。
    这一处改了，兜底头像与参考图占位**全 App 一起跟随**（消息列表／通讯人／聊天窗口／
    我的页／记忆／角色设置／聊天设置都引它）。 */
export const AVATAR_GRADIENT = "linear-gradient(135deg,#E5769F,#B93F72)";


/** 聊天背景的默认底色（没上传壁纸时用它）。
    2026-09-20 换新板（黑粉蓝）：起手纯白、收尾一点透粉——不再是米黄／暖白那套。
    恩熙这一版要的是「透粉的白」，所以最深的一角也只是淡粉，压在输入框上方不发黄。
    同一天恩熙又定：**彩色预设（淡玫瑰／雾蓝／浅青／香芋／奶咖）全部拿掉**，聊天背景
    只留「默认底色 ＋ 自传壁纸」两态——底色将来归全局样式统管，这里就只留这一个值。 */
export const CHAT_BG_DEFAULT = "linear-gradient(160deg,#FFFFFF,#FFF0F5)";

/** 消息类型中文标签（列表预览与复制用）。 */
export const TYPE_CN: Record<string, string> = {
  image: "图片",
  voice: "语音",
  redpacket: "红包",
  transfer: "转账",
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
 * 1.0.86 起签名在档案里单开一格，不再从人设里截第一句当签名——恩熙：「他是一个
 * 沉稳冷静的人」顶在资料页上很怪。TA 在聊天里自己改过的话以 Conversation.signature
 * 为准（调用处先取 conv.signature，空才落到这里），改签名的机制一行没动。
 */
export function defaultSignature(d: { signature?: string }): string {
  const s = (d.signature ?? "").trim();
  return s || "TA 一直都在";
}

/** 聊天流里的日期分隔条文案：今天／昨天／X月X日（跨年再加年份）。
    2026-09-20 恩熙：消息流改成「按天分段落」，一天的开头插一枚居中的日期胶囊，
    不再是每条消息各自挂一行小字时间。 */
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

/** 动态时间轴显示：同一天显示时:分，否则 月/日 时:分。 */
export function momentTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
