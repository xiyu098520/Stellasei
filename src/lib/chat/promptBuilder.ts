/**
 * 星绥通讯 prompt 组装器。
 *
 * 每轮对话把「对方档案＋世界书＋记忆碎片＋当前状态＋对话历史＋角色档案」
 * 拼成一份完整 prompt。**角色档案与末尾的规则块压在最后**（学 miya 的倒置注入）：
 *
 * 输出分成**稳定区**与**易变区**两段（见 BuiltPrompt.stable／volatile），顺序为：
 *
 *   ── 稳定区（跨轮逐字不变，挂在缓存断点之前）──
 *   [对方档案]（使用中的面具：TA 眼中的你；我方身份前置）
 *   [role_before 世界书·常驻]（比他更底层的世界法则）
 *   [这就是你]（角色档案）
 *   [role_after 世界书·常驻]（人设随行注释，**排在人设之后**）
 *   [chat_before／chat_after 世界书·常驻]（1.9.84：常驻＝跨轮一字不变，
 *      挪进稳定区吃 0.1× 缓存；从前跟关键词条目并在一起挂尾巴，每轮全价重发）
 *   [记忆碎片]（类人记忆，全量、时间新→旧；两次浓缩之间逐字不变）
 *   ── 易变区（每轮都可能变，排在断点之后，不挂缓存标记）──
 *   [签名与动态·当前取值]（只有「你的当前签名是：…」这一行会随 TA 更新而变）
 *   [用户签名·当前取值]（「我」页面的签名；没设不注入，改了只动尾巴不断缓存）
 *   [零钱·当前取值]（TA 手头有多少零钱，1.4.36：他自己发红包／转账的本钱；没读到不注入）
 *   [当前状态]（时间感知开关打开时才有：此刻的年月日与时分）
 *   [role_before／role_after 世界书·关键词]（聊到才进、话题一过就撤）
 *   [chat_before 世界书·关键词]（影响当前对话的设定；常驻那半已挪稳定区）
 *   [对话历史]（走 messages 时为空）
 *   [chat_after 世界书·关键词]（紧贴最新消息，临时状态类；常驻那半已挪稳定区）
 *   [最新消息]（走 messages 时为空）
 *
 * 为什么靠后：人设埋在中段时，会被前面大段的风格／格式／媒体规则挤掉注意力，
 * 弱模型（尤其是切换后的模型）直接按通用助手口吻泛泛作答，表现为「不读人设、
 * 像失忆」。所以人设＋末尾的规则块压在稳定区末尾：它是模型开口前读到的最后
 * 一块内容，权重最高；人设紧挨着它，同属「压在最后」的一批。
 *
 * 「注入位置」对齐参考项目 Float（builtin-preset.ts 的 prompt_order）：
 * role_after 的两桶必须排在人设之后——堆在人设之前（跟 role_before 并列）位置语义等于失效。
 * 稳定区因此是 对方档案 → 世界法则(角色前) → 人设 → 世界书(角色后) → 记忆，
 * 与参考项目「世界书角色后在角色描述之后、记忆压在人设与世界书全部之后紧贴历史之前」一致。
 * 1.6.5 把最后一处没跟的也跟上了（恩熙查过参考项目的 prompt_order 后定）：
 * 参考项目里「微信体沉浸指令」排第 1、「用户人设」第 2、「世界书（角色前）」第 3，
 * 而「输出格式／语音格式／富媒体」那一长串是排在记忆之后的。我们从前把沉浸指令和
 * 格式／富媒体糊成一段全摆在最前，于是「角色前」世界书被挤到那一大段之后。
 * 现在 chatApi 的 buildStylePrompt 拆成 head（【心声】＋沉浸指令）与 tail（消息格式／
 * 富媒体／【行为守则】／测试模式／本轮额外要求）两段：head 仍在最前、tail 挪到稳定段
 * 末尾（记忆碎片之后），中间插稳定段——即 【心声】 → 沉浸指令 → 对方档案 →
 * 世界法则(角色前) → 人设 → 世界书(角色后) → 记忆 → 格式与富媒体 → 【行为守则】，
 * 跟参考项目的次序一路对齐。
 * ⚠️ 1.7.0 更正上面 1.6.5 那段的次序依据：真正的参考项目（wechat.js 第 7771 行的 buildChatSystem）
 * 第一块是【输出格式（最高优先级）】，沉浸指令在它之后；1.6.5 那版看的是另一份拼装
 * （Float 预设的 prompt_order），所以只对了后半截。恩熙 2026-09-25 定「改成像弯弯机
 * 那样的结构」后照 wechat.js 重排，并在末尾新开了【行为守则】那一块。
 * 两段内部逐字与从前一样，只有拼接位置变了；tail 仍在缓存断点之前（纯静态大段
 * 文字），照吃 0.1× 缓存，不是「放尾巴每轮全价重写」。
 * 关键词触发的 role_before／role_after 仍在易变尾巴里：尾巴整体在 system 之后，
 * 所以这两桶实际都落在人设之后，与「角色前」的语义反着——这是缓存与位置语义的
 * 固有冲突（关键词块每轮可能变，进不了稳定区），认账。
 *
 * 为什么要分两区：Claude 前缀缓存是**整条链的哈希**，从第一个字符逐块比到
 * 缓存断点——断点之前只要有一个字符变，其后全部作废重写。所以「会变的东西」
 * 一律排在断点之后：命中的是前面那一大坨静态内容，尾巴照常全价，但不再连累它。
 * 「当前状态」（分钟级时间）由设置里的「时间感知」开关控制，可手动关闭：
 * 打开时挂易变区——它每轮必变，进稳定区会把整条缓存每轮作废；
 * 关掉时整段不注入，尾巴与从前完全一致。
 *
 * 「签名与动态」的固定说明已并入 chatApi.ts 的富媒体指令（1.4.7，恩熙定——
 * 跟参考项目一样所有标记排一节）；这里只剩易变区的「你的当前签名是：…」一行取值。
 *
 * 「记忆碎片」放稳定区：挂在 user 尾部时，
 * 那条 user 下一轮回喂历史只剩光原话、尾巴对不上，站子从那条起整段作废重写
 * ——记忆块每轮被白写两遍（1.25×）。放稳定区里它逐字不变、只被读（0.1×）；
 * 浓缩那一刻变一次＝与「跨整倍线才裁历史」同节奏的一次性重建，认账。
 *
 * 世界书条目激活规则（与世界书 App 的 UI 一一对应）：
 * - 停用的条目跳过
 * - 常驻条目必注入（忽略关键词与触发概率）
 * - 非常驻条目：关键词命中最近对话才激活（大小写不敏感，中英文逗号分隔）
 * - 非常驻条目激活后再过触发概率（100% 必进，0% 永不进）
 * - 书的 scope 要匹配当前模式（全局书两种模式都进）
 * - 书的绑定角色要包含当前角色（未绑定＝所有角色）
 */

import { parseEntryKeys } from "@/lib/settings/worldbook";
import { formatYuan } from "@/lib/settings/wallet";
import type { ContactProfile } from "@/types/contact";
import type { WorldBook, WorldBookEntry } from "@/types/worldbook";
import type { ChatMessage } from "@/types/chat";

/** 关键词扫描深度：最近几条消息参与命中判定。 */
const SCAN_DEPTH = 6;

export type ChatMode = "online" | "offline";

/** 组装后的分段（预览弹窗与调试用）。 */
export interface PromptSection {
  label: string;
  content: string;
}

export interface BuiltPrompt {
  /** 分段列表（空段已剔除，稳定区在前）。 */
  sections: PromptSection[];
  /** 稳定区的分段（诊断用：只有这几段变了才会毁掉缓存，易变区变了不影响）。 */
  stableSections: PromptSection[];
  /** 稳定区文本（跨轮逐字不变；缓存断点打在这一段的末尾）。 */
  stable: string;
  /** 易变区文本（记忆／关键词世界书／对话等；排在断点之后，不挂缓存标记）。 */
  volatile: string;
  /** 完整 prompt 文本（各段以空行连接）。 */
  full: string;
  /** 本轮激活的世界书条目（预览用）。 */
  activatedEntries: { book: string; entry: WorldBookEntry; by: "常驻" | "关键词" }[];
  /** 诊断用：通过 scope／绑定角色过滤后、真正参与条目判定的书数量。 */
  usableBookCount: number;
}

/**
 * 人设各栏位 → prompt 行（只拼非空值，保持档案栏位名）。
 * ⚠️ 1.4.1：原来这里有一条「AI 助手模式不吃人设、换成私人助手定位」的分支，
 * 恩熙 2026-09-22 定「助手版应该就跟正常版一样，只不过增加了一条强制规则」，
 * 该分支整条删掉——测试模式（原助手模式）照样吃人设，唯一的差别是
 * `buildStylePrompt` 末尾那条【测试模式 · 绝对服从】。
 */
function buildCharacterBlock(profile: ContactProfile, userName: string): string {
  const charName = profile.name || profile.nickname || "我";
  const rows: [string, string][] = [
    ["本名", profile.name],
    ["你的专属昵称", profile.nickname],
    ["性别", profile.gender],
    ["年龄", profile.age],
    ["生日", profile.birth],
    ["职业", profile.occupation],
    ["种族", profile.tag],
    ["身高", profile.height],
    ["血型", profile.blood],
    ["外貌 · 穿衣 · 标志", profile.looks],
    ["人设", profile.persona],
    ["人际关系", profile.relOther],
    /* 「线上表现」已改名「对话参考」（线下那一格撤掉了，旧值由迁移并进这里）——
       标签跟着档案界面走，模型看到的字与用户填的字是同一个。 */
    ["对话参考", profile.onlineStyle],
  ];
  if (profile.customTitle && profile.customContent) {
    rows.push([profile.customTitle, profile.customContent]);
  }
  /* v 这层兜底不能省：档案是本机里存下来的，`looks`／`人设`／`对话参考` 这些
     后合并出来的栏位在旧数据里根本不存在（旧数据靠 lib/settings/contact.ts 的
     无感迁移补齐，但迁移只在读过一次后落库，这里不能再赌），取出来是 undefined——
     `undefined.trim()` 当场抛错，整条聊天都发不出去，而且报的是「undefined is not an
     object (evaluating 'v.trim')」这种看不出跟档案有关的话（文本 API
     测试连接通过、聊天却发不出去）。下面 buildUserMaskBlock 的同款写法一直带着
     这层兜底，只有这里漏了。 */
  const filled = rows.filter(([, v]) => v && v.trim());
  const lines = filled.map(([k, v]) => `${k}：${fillMacros(v.trim(), userName, charName)}`);
  /* 档案全空：**整块不发**，一个字都不给。参考项目那边人设槽为空时也是整节不出现——
     你一旦给它一段「你是什么」的自我说明，它就会拿这段来念，人机感正是这么来的；
     什么都不给，它没有可念的东西，只能照着聊天本身说人话。

     关系一个字都不写（别写「你们是恋人」，也别写反面去否认）：这段关系本来就没被
     设过，怎么写都是替它定了个数，留给它自己长。 */
  if (lines.length === 0) return "";
  /* 只有名字（别的栏位全空）这一档：**一句说明都不给**，只剩标题和名字那一行。
     凡是解释它是什么、该怎么办的句子都会被念一遍，人机感就是这么来的；只给名字，
     它没有可念的东西，只能顺着聊天走。
     本档与下一档的区别：不套「这就是你本人……都在下面」那句引导，免得一个字
     没设过却先被交代一堆。 */
  const nameOnly = filled.every(([k]) => k === "本名" || k === "你的专属昵称");
  if (nameOnly) {
    return `【角色·档案·${profile.name || profile.nickname || "我"}】
${lines.join("\n")}`;
  }
  /* 自我锚定：把档案说成「关于你自己的记忆」，而不是「你要去演的剧本」——
     第三人称的「他的人设」会让模型跳出角色、端着说话，是人机感与「不读人设」
     的重要来源。标题带上名字，强化身份认同。

     1.4.5：原来这里是三句（「这就是你本人。」＋「下面是关于你自己的事…」＋
     「读完这些，你就知道自己是谁了。」）。恩熙 2026-09-22 定「尽量跟参考项目
     接近一点、不要太多的设定」——参考项目角色那格全部固定字只有一句
     「你是某某。」＋人设原文，于是末句「读完这些…」整句删掉（它只是在解释
     「读档案」这个动作有什么效果），第二句并进第一句，说明段收成一句。

     一致性约束（档案写定的不可推翻＋两个反例）原在这段末尾，1.3.96 搬到末尾的
     规则块、1.3.97 整条删掉（见 buildRuleBlock 注释：给模型举反例是负收益，且档案
     是它自己的记忆、没动力去改）。这里不留，档案块读完栏位就收尾。 */
  return `【角色·档案·${profile.name || profile.nickname || "我"}】
这就是你本人——你的经历、你的性格、你的习惯，还有你和对方之间发生过什么，都在下面。
${lines.join("\n")}`;
}

/**
 * 「距上一条消息过了多久」那一句（1.5.95，恩熙点头加的）。
 *
 * 为什么要它：TA 看不见「你们隔了多久」——不给它这句，它就没法判断这段冷清该不该说出口。
 * （1.5.95 起顺带还在【心声】里交代了一句「别再把这笔时间重复写成负分」，见 chatApi。
 * 1.7.92 八根拆掉后本地那笔按时间扣的分没有了，这句照旧留着：隔多久本来就影响人怎么开口。）
 * 递的是 history 的**倒数第二条**：最后一条是本轮刚发出的这句（刚发生，差值≈0），
 * 倒数第二条才是「你们上次说到哪儿」，也才是「她隔了多久才回来」。
 *
 * 不到一小时不写：分钟级的差本来就是每轮都变的东西（见文件头，易变区），能少一个字
 * 就少一个字；且一小时以内本来也不产生回落（chatApi 里 DRIVE_DECAY 是「满一小时」才算）。
 * 差值读不出来（老数据没有 createdAt）就当没这回事，不瞎编。
 */
function idleGapLine(history?: readonly ChatMessage[]): string {
  if (!history || history.length < 2) return "";
  const from = Date.parse(history[history.length - 2].createdAt);
  if (!Number.isFinite(from)) return "";
  const mins = Math.floor((Date.now() - from) / 60_000);
  if (mins < 60) return "";
  const hours = Math.floor(mins / 60);
  const span = hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`;
  return `距上一条消息已经过了 ${span}。`;
}

/* 1.7.96：原来这里有一块「你现在」（buildWishBlock）——报「你还惦记着的那一两件事」，
   取自念头池 wishPool.ts。账里「最想做的事」这一栏撤掉后（恩熙：我们没有这个栏目），
   这一块连同 wishPool.ts 一并删：没有来路的话，一句都报不出来。 */

/**
 * 当前状态块（一期只有时间；生活节奏接入后扩展）。
 * 由设置里的「时间感知」开关决定是否注入（见 volatileSections 末尾）：
 * 打开时挂**易变区**——它带分钟级时间、每轮必变，进稳定区会把整条缓存每轮作废。
 *
 * **星期几要直接写出来、不能让模型自己推**：只给「年月日 时分」的话，
 * 模型算不对就顺口编成「周末」之类。
 *
 * 1.5.95：多接一个 `history`，在时间后面缀一句「距上一条消息已经过了 X」——见
 * `idleGapLine`。不传／隔不到一小时就只吐原来那句，字面上与从前一致。
 */
export function buildStatusBlock(mode: ChatMode, history?: readonly ChatMessage[]): string {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  const time = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${week} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  /* 1.7.5：`offline` 分叉此前从没人走过（线上一直传 online），那句「（离线传讯模式）」
     是当年准备「没信号也能传讯」时写的，跟现在的**线下场合**（见面）不是一回事，
     照旧吐出去会让 TA 以为自己在断网发消息。改成一句说明处境的话；
     线下提示词正文里已说过「你们见了面」，这句只是把当下时间与处境钉在一起。 */
  return `现在是 ${time}。${mode === "offline" ? "（此刻你们在一处，不是隔着手机）" : ""}${idleGapLine(history)}`;
}

/**
 * 生图提示词里的「人设切片」：性别原文 ＋ 外貌切片（对齐参考项目的 extractPersonaAppearance）。
 *
 * 动态配图那条路只把画面描述丢给生图接口、没带 TA 的性别／外貌的话，画出来
 * 自然不是 TA；聊天里的生图一直带着。所以把这段从 ChatWindow 挪进来共用：
 * **聊天里怎么画，动态里就怎么画。**
 *
 * 顺序按「一眼能画出来的特征」排，截 600 字（参考项目取 600，太长会把姿势／场景
 * 指令冲淡）。旧写法相反：带参考图时只拼「男／女」两个字，等于把提示词掏空，
 * 模型没别的可依就照着参考图原样复制。
 * 「血型」与「关键词标签」**刻意不收**：这两格与长相
 * 无关，跟着人设挤进提示词只是白占那 600 字的名额（血型更是纯噪音）。
 * 「外貌／穿衣／标志」并成一格 looks，人设（persona）一个字都不进来
 * ——照片是长相，不是性格。
 */
export function buildImageSubject(
  profile: Partial<ContactProfile> | undefined,
): { gender?: string; looks?: string } {
  const d = profile ?? {};
  /* 档案栏位是多行 textarea，值里可能带换行、行首编号（「1。」「一、」这种），
     直接 join 会在**栏位边界**留下「。，1。」这类标点垃圾。这里只动**拼接层**：
     把每个栏位先按行拆开 → 去掉行首编号与
     行首残留标点 → 再用「，」接回一行，最后逐栏 join 并折叠重复标点。
     **档案里存的值一个字都不改**，只是喂给生图模型的那段干净一点。 */
  const clean = (s: string) =>
    s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(
            /^(?:\d{1,2}[.。、．)）]|[①②③④⑤⑥⑦⑧⑨⑩]|[一二三四五六七八九十]{1,3}[、.．)）]|[-•·*])\s*/,
            "",
          )
          .replace(/^[，,、；;。.]+/, "")
          .trim(),
      )
      .filter(Boolean)
      .join("，");
  const looksText = [d.looks, d.tag, d.height, d.occupation]
    .map((s) => clean(s ?? ""))
    .filter(Boolean)
    .join("，")
    .replace(/[，,、；;]{2,}/g, "，")
    .replace(/([。！？；：])[，,]+/g, "$1")
    .replace(/^[，,]+|[，,]+$/g, "")
    .slice(0, 600);
  return { gender: d.gender, looks: looksText };
}

/* 签名与动态的固定说明已搬走（1.4.7，恩熙定——参考项目把所有动作标记排在
   「富媒体指令」一节里，一个【格式】一行）：〔签名〕〔动态〕〔动态图〕三个标记
   并进 chatApi.ts 媒体规则，与〔图片〕〔语音〕并列成节；stableSections 里
   「签名与动态·说明」一条同步删除。「更不更由你判断」不再单写——媒体规则
   【逻辑】那句「不想发就不发，完全跟随你的性格」罩住全部标记。
   签名取值行（buildSignatureLine）仍在易变区，没动。 */

/** 签名取值行（TA 更新签名时才会变）——放易变区，尾巴上只留这一句。 */
function buildSignatureLine(currentSignature: string | undefined): string {
  return currentSignature?.trim()
    ? `你的当前签名是：「${currentSignature.trim()}」。`
    : "你还没有设定过签名（资料页显示的是默认文案）。";
}

/** 用户签名取值行（「我」页面随时可改，和 TA 签名同理只在易变区留一行；
    没设签名时回空串，整段不注入，prompt 与从前完全一致）。 */
function buildUserSignatureLine(userName: string, signature: string | undefined): string {
  const s = signature?.trim();
  return s ? `${userName}的当前签名是：「${s}」。` : "";
}

/** TA 手头零钱取值行（1.4.36）：他自己发红包／转账时得知道有多少钱可花。
    余额随时会变（他发了、我发了），只能挂易变区；没值（还没读出来）时整行不出现。 */
function buildWalletLine(balanceCents: number | null | undefined): string {
  if (balanceCents == null || !Number.isFinite(balanceCents)) return "";
  return `你的零钱是：¥${formatYuan(balanceCents)}（发红包、转账给对方的钱都从这里出）。`;
}

/** 生日显示格式：2000-01-01 → 2000年1月1日。 */
function formatBirth(birth: string): string {
  const [y, m, d] = birth.split("-");
  if (!y || !m || !d) return birth;
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

/** 对方档案块（TA 眼中的你）；无面具或全空时回空串。
 *
 * 标题原叫「用户身份」——那是**我们这边的叫法**（UI 里叫「用户面具」），不是 TA 的叫法：
 * TA 眼里只有「对方」，没有「用户」。改成【对方·档案·…】后与【角色·档案·…】对称，
 * 模型一眼看出这两块是同一层东西（一个写你、一个写对方）。
 *
 * ⚠️ 1.4.4：标题后面原来拖着一个圆括号（「与你对话的人；以下是你对对方的了解。怎么
 * 称呼对方、用多亲密的语气，看你的性格与你们已经写明的关系——没写明的，就是还没有
 * 那层关系，别自己补」）。恩熙 2026-09-22 看这块时指出「是不是又重复写了？……这个
 * 我们都在开头写过了」——她对：「以下是你对对方的了解」是给「档案」两个字作注，
 * 块名本身已与【角色·档案·…】对称、一眼就懂；「怎么称呼、用多亲密的语气」归
 * `buildStylePrompt` 的【称呼】，那里给得更全（关系＋性格＋反例＋不必每句带称呼）
 * 且位置更靠前、权重更高。故整个括号删掉，标题行到此为止。 */
function buildUserMaskBlock(
  userName: string,
  charName: string,
  mask: { persona: string; gender: string; birth: string; extra: string } | null | undefined,
): string {
  if (!mask) return "";
  const rows: [string, string][] = [
    ["性别", mask.gender],
    ["生日", mask.birth ? formatBirth(mask.birth) : ""],
    ["人设", mask.persona],
    ["补充", mask.extra],
  ];
  const lines = rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}：${fillMacros(v.trim(), userName, charName)}`);
  if (lines.length === 0) return "";
  return `【对方·档案·${userName}】
${lines.join("\n")}`;
}

/**
 * 【事实边界】1.5.25 **整块删除**（恩熙定：「我也觉得这个事实边界甚至都不用写。这个参考项目
 * 有写这个吗？」——查过，参考项目整份提示词里没有这样一块常驻边界约束，它只在动态评论那
 * 类规则里零散写一句「不要虚构对方动态之外的事实」）。
 *
 * 为什么不留：它三条都是**解释与否定的句子**（没发生过的不许说成发生过／没依据的别想象细节／
 * 别自己算时间），而解释句和禁止句会被它拿去反复念，越念越像在自我审查，人设被压薄——
 * 与 1.5.24「只给格式与硬规矩，不解释」同一条口径（见施工日志第 525／526 条）。
 * 「它知道什么」由档案与记忆交底，越界与时间错乱交给它自己判断。
 *
 * ⚠️ 不许整块加回来。若实测真出现「把没发生过的说成发生过」或深夜问「吃午饭没」，
 * 只按最小代价补回对应那一条，别恢复另两条。
 */


/**
 * 末尾的规则块（贴在 prompt 最末、紧挨生成点，权重最高；1.5.25 起角色版与测试模式都不再有内容）。
 *
 * **告知，不是命令**。这一段不教模型怎么当真人（该怎么断句、
 * 该怎么跳跃、禁止复读什么句式），只告诉它它此刻处在什么情形——
 * 身份从档案里长出来，语气自然跟着档案走。命令式的行为指导会把注意力从档案上拽走、写死
 * 成通用微信腔，正是「聊着聊着就偏」的来源。
 *
 * ⚠️ 1.3.98：原【你与此刻】块**整块删除**（恩熙问「一定要有你与此刻这个地方吗？
 * 参考项目也没有这部分啊」）。它的内容分两半去处：
 *   - 身份宣告那一半（你是谁、按性格与关系怎么开口）在 `buildStylePrompt` 的开头
 *     与【称呼】里，1.3.97 已把重复的几句砍掉；
 *   - 剩下「此刻的事实」三条——真假边界、此刻什么媒介、现在几点——并进
 *     【聊天这件事】（见 FACTS 注释：它们本就是「此刻说话的规矩」）；
 *     原来的「关系与经历都在档案与记忆里」一行删掉：开头第 3 句「下面是关于 X
 *     这个人、你自己是什么样的人、你记得什么……都在后面」与档案块的「这就是你
 *     本人……你和对方之间发生过什么」已经说了两遍。
 * 于是稳定区末尾只剩「此刻＋规矩」两块，与参考项目一致（它末尾附近也只放输出
 * 格式与可执行动作这类规则，不再复述身份）。
 *
 * ⚠️ 1.3.97 砍掉的四处（开场「你是 X 本人…」、尾巴「你怎么对待 X…」、档案写定的
 * 一致性约束＋两个反例、「不会突然问『你是谁』」）理由见施工日志第 396 条，
 * 核心两条：**与开头同义重说**、**给模型举反例是负收益**（等于凭空塞进它本来
 * 没想的话题）。待验证：若实测真的出现档案被改／失忆问「你是谁」，把约束加回来、
 * 不带反例。
 *
 * ⚠️ 1.3.99：**上面这条「告知，不是命令」直到这版才算做到**。1.3.96 写下这句话时，
 * 它管着的【聊天这件事】里有七条 bullet，一半是命令式的打字指导（一条一件事／
 * 一轮回几条／别让人只能再问一遍／会跑题会说半句／不升华不总结不劝人）。
 * 恩熙问「这几个板块，参考作者不都有吗？为什么一定要靠这些来巩固他的人设？
 * 这些应该交给 AI 思考」——正好戳在这条口径上。已按口径删干净，只留它自己推不出来的
 * 处境四条。详见 FACTS 注释与施工日志第 398 条。
 *
 * ⚠️ 1.3.100：原来这里是「线上线下按 mode 分成两套」（线上隔着手机、线下同处一室），
 * 防的是模型把「聊天」演成「当面对话」——递水、牵手、摸头、描述对方的表情。
 * 恩熙说这两条开头已经说了、不需要（原话与依据见 FACTS 注释），**两条连同 mode
 * 分叉一起删掉**：1.3.100 起线上／线下正文完全一样，`mode` 参数从本函数撤掉。
 * 风险与回退：若实测真出现当面动作，把「你们人不在同一个地方」加进
 * `buildStylePrompt` 开场第 1 句，不要另起一块。
 *
 * ⚠️ 1.4.1：原来这里有一条「AI 助手模式」分支（一块【运转规则】四条：服从／补全细节／
 * 不编造／不复读）。恩熙 2026-09-22 定「助手版应该就跟正常版一样，只不过增加了一条
 * 强制规则」，该分支整条删掉——服从那条改挂在 `buildStylePrompt` 末尾的
 * 【测试模式 · 绝对服从】，补全细节归【发图片】自己的规则，
 * 不复读角色版本来就没有、也不单列；`userName`／`assistant` 两个参数跟着撤掉。
 *
 * ⚠️ 返回的是**一组 section**（角色版与测试模式完全一样的两个块），由 buildPrompt 分别装。
 * 原来这几块挤在一个 return 字符串里、section 名却只叫「你与此刻」——预览里看不出
 * 这一格其实装了三件事，靠后的两块出了问题也无从判断。拆开后名字跟内容对上了。
 *
 * ⚠️ 「不许自己算时间」原在 buildMetaHelp（【签名与动态】）末尾，1.3.96 搬进
 * 【你与此刻】收尾，1.3.98 随块并进【聊天这件事】：它管整个聊天，不只管签名；
 * 且原句指着「以『当前状态』那一行为准」，而提示词里没有这个标签
 * （buildStatusBlock 吐的是「现在是 …」），时间感知关掉时那行更不存在。
 * 改成不依赖标签的说法，**且不能放进「当前状态」块**——那段随开关整段消失，
 * 而「没给就别提这类话」恰恰是关掉开关时才最需要的一句。
 */
function buildRuleBlock(): PromptSection[] {
  /* 角色版与测试模式原来各有一块规则（【聊天这件事】【你与此刻】【运转规则】【心动与欲望】
     【事实边界】），1.5.25 起**全都删净**——恩熙定的口径：只给格式与硬规矩，不解释、
     不举反例、不替它决定怎么做（见施工日志第 521／522／525／526 条）。身份宣告归开头
     `buildStylePrompt` 的开场三句，媒体与输出格式归它的富媒体块。
     函数与调用点留着：以后若必须补一条硬规矩，仍贴在最末（紧挨生成点、权重最高）。
     ⚠️ 1.7.0：【行为守则】**没有**落在这一格——它跟【消息格式】／富媒体是同族，
     落在 chatApi `buildStylePrompt` 的 tail 末尾（富媒体之后、测试模式之前），
     比这里更贴近生成点。这一格仍然是空的。 */
  return [];
}

/**
 * 判定一条条目是否激活（不含概率掷骰）。
 * 扫描文本＝当前输入＋最近 SCAN_DEPTH 条历史，大小写不敏感。
 */
function isEntryTriggered(entry: WorldBookEntry, scanText: string): boolean {
  if (entry.disabled) return false;
  if (entry.constant) return true;
  if (entry.probability <= 0) return false;
  const keys = parseEntryKeys(entry.keys);
  if (keys.length === 0) return false;
  const lower = scanText.toLowerCase();
  return keys.some((k) => lower.includes(k.toLowerCase()));
}

/** 概率掷骰（100% 必进，0% 永不进）。 */
function rollProbability(probability: number): boolean {
  return Math.random() * 100 < probability;
}

/**
 * 概率条目在本会话里的骰子结果。
 * 每轮重掷＝条目每轮随机进出＝缓存断点之前的内容每轮作废（这一条尤其致命），
 * 所以同一会话里同一条目的结果只掷一次，之后固定。
 * 存下当时的概率：改了概率就重新掷——不然「改成 100% 却还是不出现」像 bug。
 */
const rollMemo = new Map<string, { p: number; pass: boolean }>();

/** 取（或首次掷出）某条目在本会话的骰子结果。 */
function rollOnce(key: string, probability: number): boolean {
  const memo = rollMemo.get(key);
  if (memo && memo.p === probability) return memo.pass;
  const pass = rollProbability(probability);
  rollMemo.set(key, { p: probability, pass });
  return pass;
}

/** 四个注入位置各自的条目桶（常驻与关键词分开装）。 */
function emptyBuckets(): Record<WorldBookEntry["position"], string[]> {
  return { role_before: [], role_after: [], chat_before: [], chat_after: [] };
}

/**
 * {{user}} / {{char}} 宏：注入前换成本场对话的真名字。
 * 写卡的写法里这两个占位符极常见（「{{user}} 的独立生活」「{{char}} 有自己的班要上」），
 * 但注入路径原本是原样塞进去的——模型读到字面的 {{char}}，像系统标记，很出戏。
 * 换不成名字（没起名）时退回「对方」，与历史前缀那处同一套兜底。
 *
 * 1.6.3 只接在世界书条目上；1.6.4 起角色档案、对方面具两块的每一栏也过这里——
 * 「人设」里写 {{user}} 是同一个写法，漏了就等于白写。
 * 顺手认宽松写法（{{ user }}／大小写），跟正则那套（regexRules.applyMacros）不同口径：
 * 那边只认逐字 {{user}}，是给规则源码用的，不动它。
 */
function fillMacros(text: string, userName: string, charName: string): string {
  return text
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/\{\{\s*char\s*\}\}/gi, charName);
}

/**
 * 易变尾巴的抬头。这几行（签名取值／零钱／此刻时间等）是**插在对方的消息里**
 * 递出去的，模型会把它们当成「对方说过的话」，一不留神就照抄回来当自己的回复。
 * 抬头把这件事说清（不是对方的话、别复述）——去掉这行就退回老样子。
 *
 * ⚠️ 1.6.8 把原来末尾那句「也不要回应这几行」删了。这条尾巴上不只有取值行，
 * 下面还压着**世界书四处**与【你现在】【当前状态】——那些是**要读、要照它来**的设定。
 * 一句「不要回应这几行」盖在它们头上，等于让模型把世界书当耳旁风（恩熙报的
 * 「活人感世界书插进来一点用没有」，除了收录那条 bug，这行也有一份）。
 * 取值行的本职防护（不是对方说的话、别复述）留着就够，别再加回来。
 */
const VOLATILE_HEADER = "【系统资料·不是对方说的话，不要复述、不要照抄】";

/** 组装入口。 */
export function buildPrompt(input: {
  characterId: string;
  profile: ContactProfile;
  books: WorldBook[];
  mode: ChatMode;
  history: ChatMessage[];
  userInput: string;
  /**
   * TA 住的「世界」（档案分类 id）：世界书绑世界时按它判命中（见 usableBooks 的过滤）。
   * 没传＝当没绑世界（只有角色绑定生效）。
   */
  characterCategoryId?: string;
  /** 用户的名字（对话历史前缀用；TA 如何称呼自行判断）；空字符串时用「我」。 */
  userName: string;
  /** 使用中的面具（用户人设）；注入「与你对话的人」块。 */
  userMask?: { persona: string; gender: string; birth: string; extra: string } | null;
  /** TA 的当前签名（会话层动态签名；TA 可在回复末尾附〔签名〕标记更新）。 */
  currentSignature?: string;
  /** 用户的当前签名（「我」页面那句；随时可改，只进易变区一行，不进稳定区）。 */
  userSignature?: string;
  /**
   * TA 手头的零钱（分；1.4.36）。他要在读人设之外知道「自己有多少钱可花」，
   * 发红包／转账才不至于凭空乱写。余额随时变，只进易变区一行；不传＝不注入。
   */
  walletBalance?: number | null;
  /**
   * 他自己记下的东西（1.9.0）：细处那份清单＋他写过的那篇日记，由 chatApi 的
   * `innerLedgerBlock` 从聊天记录里攒好。要他做到「记过的别再写」「并成一整篇」，
   * 就得让他看得见自己记过什么（心声块不进消息正文，回喂的历史里没有账）。
   * 每轮都可能变，只进易变区；不传／空串＝整块不注入。
   */
  ledgerBlock?: string;
  /** 类人记忆（记忆系统的注入块；空则「记忆碎片」段留空）。 */
  memoryBlock?: string;
  /** API 模式：对话历史与最新消息改走 OpenAI messages，不进 system（保前缀缓存稳定）。 */
  excludeDialogue?: boolean;
  /**
   * 会话标识（角色＋面具；默认用角色 id）。
   * 概率条目的骰子结果按它固定：同一场对话里不再每轮重掷。
   */
  sessionKey?: string;
  /**
   * 时间感知（设置页开关，见 getChatPrefs）：打开时把「此刻」注入易变尾巴，
   * TA 才不会把时间说错；关掉时整段不注入，与从前一致。
   */
  timeAware?: boolean;
}): BuiltPrompt {
  const { characterId, profile, books, mode, userInput, history } = input;
  const userName = input.userName.trim() || "我";
  /* 宏替换用的角色名（1.6.4）：档案、面具、世界书三处共用一份，
     没起名时退回「对方」——与对话历史前缀那处同一套兜底。 */
  const charName = profile.name || profile.nickname || "对方";
  const excludeDialogue = input.excludeDialogue ?? false;
  const sessionKey = input.sessionKey ?? characterId;

  // 系统提示不参与对话历史（它们是分隔标记，不是台词）。
  const dialogue = history.filter((m) => m.role !== "system");

  // 扫描文本：当前输入＋最近几条历史。
  const recent = dialogue.slice(-SCAN_DEPTH).map((m) => m.content);
  const scanText = [...recent, userInput].join("\n");

  // 过滤书：scope 匹配模式 ＋ 绑定匹配（角色与「世界」取并集：绑了角色或所在世界，这本书都算数）。
  const usableBooks = books.filter((b) => {
    if (mode === "online" && b.scope === "offline") return false;
    if (mode === "offline" && b.scope === "online") return false;
    /* 绑了任何一个（角色或世界）才过滤；两个都空＝所有角色共享（老规矩）。 */
    if (b.boundCharacterIds.length > 0 || b.boundCategoryIds.length > 0) {
      const byChar = b.boundCharacterIds.includes(characterId);
      /* 世界绑定按档案分类判：他住在这个世界里，这本书就跟着他。
         世界是活名单——角色在档案里挪进挪出，下一轮自然跟着变。 */
      const byWorld =
        input.characterCategoryId !== undefined &&
        b.boundCategoryIds.includes(input.characterCategoryId);
      if (!byChar && !byWorld) return false;
    }
    return true;
  });

  // 逐条判定激活并按位置分组：常驻条目跨轮不变、关键词条目聊到才进，两桶分开装。
  const constantBuckets = emptyBuckets();
  const keywordBuckets = emptyBuckets();
  const activated: BuiltPrompt["activatedEntries"] = [];

  for (const book of usableBooks) {
    for (const entry of book.entries) {
      if (!isEntryTriggered(entry, scanText)) continue;
      // 常驻条目必注入；非常驻条目才过概率掷骰（同一会话只掷一次）。
      if (!entry.constant && !rollOnce(`${sessionKey}\u0000${book.id}\u0000${entry.id}`, entry.probability)) {
        continue;
      }
      const block = fillMacros(entry.content.trim(), userName, charName);
      if (!block) continue;
      (entry.constant ? constantBuckets : keywordBuckets)[entry.position].push(block);
      activated.push({
        book: book.name || "未命名之书",
        entry,
        by: entry.constant ? "常驻" : "关键词",
      });
    }
  }

  const join = (list: string[], header: string) =>
    list.length > 0 ? `${header}\n${list.join("\n\n")}` : "";

  /* 分段组装。顺序＝模型阅读顺序；**同时按「跨轮是否稳定」分成两区**（见文件头）：
     稳定区排在缓存断点之前，只放逐字不变的纯静态内容；会变的一律排在断点之后。 */
  const stableSections: PromptSection[] = [
    // 我方身份前置（学 miya：用户人设在前、角色档案在后）。
    { label: "对方档案", content: buildUserMaskBlock(userName, charName, input.userMask) },
    // 世界书常驻条目＝设定里的「世界法则」，跨轮一字不变，留在断点之前。
    {
      label: "世界法则（角色前·常驻）",
      content: join(constantBuckets.role_before, "【世界的底层设定】"),
    },
    // 角色档案：压在稳定区后半段（人设埋中段会被前面的风格／格式规则挤掉注意力）。
    { label: "这就是你", content: buildCharacterBlock(profile, userName) },
    // role_after 按位置语义**排在人设之后**（对齐参考项目的 charDescription 之后）。
    {
      label: "世界书设定（角色后·常驻）",
      content: join(constantBuckets.role_after, "【相关设定】"),
    },
    /* 1.9.84：「对话前／对话后」的**常驻**条目也挪进稳定区。它们与上面两条常驻
       同类——跨轮一字不变，本就属于「能缓存就该缓存」那部分；从前却被并进易变区
       （`[...constantBuckets, ...keywordBuckets]` 一起 join），挂在每轮 user 尾巴上
       按全价重发一次。拆开：常驻这半留稳定区（缓存读 0.1×），关键词那半仍回易变区。 */
    {
      label: "世界书设定（对话前·常驻）",
      content: join(constantBuckets.chat_before, "【当前相关的设定】"),
    },
    {
      label: "世界书设定（对话后·常驻）",
      content: join(constantBuckets.chat_after, "【此刻的细节】"),
    },
    // 记忆碎片：全量、按时间新→旧（两次浓缩之间逐字不变），留在断点之前。
    // 挂在每轮 user 尾部时，下一轮回喂那条 user 只剩光原话、尾巴对不上 →
    // 站子从那条起整段作废，记忆块每轮白写两遍。放稳定区只被读（0.1×）。
    // 位置对齐参考项目：记忆压在人设与世界书全部之后，紧贴对话之前。
    { label: "记忆碎片", content: input.memoryBlock?.trim() ?? "" },
    // 末尾的规则块：此处只陈述、不下命令。1.5.25 起 buildRuleBlock 返回空数组
    // （见其注释）；测试模式唯一多出来的【测试模式 · 绝对服从】挂在 buildStylePrompt
    // 末尾，这里不分叉。1.6.5 起「模型开口前读到的最后内容」已不是这一格
    // ——buildStylePrompt 的 tail（消息格式／富媒体／【行为守则】）接在它之后。
    ...buildRuleBlock(),
  ];
  const volatileSections: PromptSection[] = [
    // 签名取值（TA 自己更新时才会变）必须放易变区（缓存断点之后），
    // 否则它一变，稳定区整体作废，缓存就「中途突然读不到」。
    // 固定说明放稳定区，尾巴上只留这一行值。
    { label: "签名与动态·当前取值", content: buildSignatureLine(input.currentSignature) },
    // 用户签名（「我」页面随时可改）：与 TA 签名同理只挂易变区一行——
    // 它一变不能连累稳定区缓存；没设签名时回空串整段消失。
    { label: "用户签名·当前取值", content: buildUserSignatureLine(userName, input.userSignature) },
    // TA 的零钱（1.4.36）：他自己发红包／转账时的「本钱」，余额每轮都可能变，
    // 与签名同理只挂易变区；没读到账（null）时整行消失。
    { label: "零钱·当前取值", content: buildWalletLine(input.walletBalance) },
    /* 他自己记下的东西（1.9.0）：细处那份清单＋他写过的那篇日记，由 chatApi 的
       innerLedgerBlock 攒好递进来。为什么要回送：心声块摘走时就不落进消息正文，
       回喂的历史里只有台词、账一个字都不在——他看不见自己记过什么，就只能
       一轮轮往上叠重复的。每轮都可能变（他每轮都在记），所以挂易变区；
       空串时整块消失，不多给模型一个字。 */
    { label: "他自己记下的·回执", content: input.ledgerBlock?.trim() ?? "" },
    // 关键词触发的世界书条目：聊到才进、话题一过就撤，每轮都可能变。
    {
      label: "世界书设定（角色前·关键词）",
      content: join(keywordBuckets.role_before, "【世界的底层设定】"),
    },
    {
      label: "世界书设定（角色后·关键词）",
      content: join(keywordBuckets.role_after, "【相关设定】"),
    },
    // 记忆碎片：已挪到稳定区（见文件头）；它一进易变区就会每轮白写两遍。
    {
      label: "世界书设定（对话前）",
      /* 1.9.84：这里只留**关键词**条目——常驻那半已挪稳定区（见上）。
         关键词条目聊到才进、话题一过就撤，每轮可能变，只能留易变区全价。 */
      content: join(keywordBuckets.chat_before, "【当前相关的设定】"),
    },
    {
      label: "对话历史",
      content:
        !excludeDialogue && dialogue.length > 0
          ? dialogue
              .map(
                (m) =>
                  `${m.role === "user" ? userName : profile.name || "对方"}：${m.content}`,
              )
              .join("\n")
          : "",
    },
    {
      label: "世界书设定（对话后）",
      /* 1.9.84：同上，只留关键词条目；常驻那半已挪稳定区。 */
      content: join(keywordBuckets.chat_after, "【此刻的细节】"),
    },
    { label: "最新消息", content: excludeDialogue ? "" : `${userName}：${userInput}` },
    /* 1.7.96：原来这儿还有一块「你现在」（还惦记着的那一两件，见 buildWishBlock）——
       账里「最想做的事」撤掉后它一并删了。 */
    // 时间感知（设置页开关）：打开时把「此刻」钉在尾巴最末——紧贴生成点，TA 在
    // 「现在几点」上就不会乱编。分钟级、每轮都变，所以只能挂易变区（见文件头）。
    { label: "当前状态", content: input.timeAware ? buildStatusBlock(mode, history) : "" },
  ];

  const stableList = stableSections.filter((s) => s.content);
  const volatileList = volatileSections.filter((s) => s.content);
  const stable = stableList.map((s) => s.content).join("\n\n");
  /* 尾巴整体挂在抬头（VOLATILE_HEADER）下面一行。整条尾区都为空时（没世界书、
     时间感知也关着）连抬头一起消失，不凭空多给模型一个字。 */
  const volatileBody = volatileList.map((s) => s.content).join("\n\n");
  const volatile = volatileBody ? `${VOLATILE_HEADER}\n${volatileBody}` : "";
  return {
    sections: [...stableList, ...volatileList],
    stableSections: stableList,
    stable,
    volatile,
    full: [stable, volatile].filter(Boolean).join("\n\n"),
    activatedEntries: activated,
    usableBookCount: usableBooks.length,
  };
}
