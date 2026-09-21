/**
 * 星绥通讯 prompt 组装器。
 *
 * 每轮对话把「用户面具＋世界书＋记忆碎片＋当前状态＋对话历史＋角色档案」
 * 拼成一份完整 prompt。**角色档案与「你与此刻」压在最后**（学 miya 的倒置注入）：
 *
 * 输出分成**稳定区**与**易变区**两段（见 BuiltPrompt.stable／volatile），顺序为：
 *
 *   ── 稳定区（跨轮逐字不变，挂在缓存断点之前）──
 *   [用户面具]（使用中的面具：TA 眼中的你；我方身份前置）
 *   [role_before 世界书·常驻]（比他更底层的世界法则）
 *   [这就是你]（角色档案）
 *   [role_after 世界书·常驻]（人设随行注释，**排在人设之后**）
 *   [记忆碎片]（类人记忆，全量、时间新→旧；两次浓缩之间逐字不变）
 *   [签名与动态·说明]（固定文案：签名与动态是什么、怎么更新；一字不变）
 *   [你与此刻]（最后一眼：告知它是谁、它此刻知道什么——只陈述，不下命令）
 *   ── 易变区（每轮都可能变，排在断点之后，不挂缓存标记）──
 *   [签名与动态·当前取值]（只有「你的当前签名是：…」这一行会随 TA 更新而变）
 *   [用户签名·当前取值]（「我」页面的签名；没设不注入，改了只动尾巴不断缓存）
 *   [当前状态]（时间感知开关打开时才有：此刻的年月日与时分）
 *   [role_before／role_after 世界书·关键词]（聊到才进、话题一过就撤）
 *   [chat_before 世界书]（影响当前对话的设定）
 *   [对话历史]（走 messages 时为空）
 *   [chat_after 世界书]（紧贴最新消息，临时状态类）
 *   [最新消息]（走 messages 时为空）
 *
 * 为什么靠后：人设埋在中段时，会被前面大段的风格／格式／媒体规则挤掉注意力，
 * 弱模型（尤其是切换后的模型）直接按通用助手口吻泛泛作答，表现为「不读人设、
 * 像失忆」。所以人设＋「你与此刻」压在稳定区末尾：它是模型开口前读到的最后
 * 一块内容，权重最高；人设紧挨着它，同属「压在最后」的一批。
 *
 * 「注入位置」2026-09-17 对齐参考项目 Float（builtin-preset.ts 的 prompt_order）：
 * 原先 role_after 的两桶都堆在人设之前（跟 role_before 并列），位置语义等于失效。
 * 现在稳定区改成 用户面具 → 世界法则(角色前) → 人设 → 世界书(角色后) → 记忆 →
 * 签名说明 → 你与此刻，与参考项目「世界书角色后在角色描述之后、记忆压在人设与
 * 世界书全部之后紧贴历史之前」一致。
 * 未跟的一处：参考项目把「输出格式与富媒体规则」摆在历史之后（离生成点最近），
 * 我们是摆在最前（buildStylePrompt）。那段是纯静态大段文字，放前面吃 0.1× 缓存、
 * 放尾巴每轮全价重写，故保留不动。
 * 关键词触发的 role_before／role_after 仍在易变尾巴里：尾巴整体在 system 之后，
 * 所以这两桶实际都落在人设之后，与「角色前」的语义反着——这是缓存与位置语义的
 * 固有冲突（关键词块每轮可能变，进不了稳定区），认账。
 *
 * 为什么要分两区：Claude 前缀缓存是**整条链的哈希**，从第一个字符逐块比到
 * 缓存断点——断点之前只要有一个字符变，其后全部作废重写。所以「会变的东西」
 * 一律排在断点之后：命中的是前面那一大坨静态内容，尾巴照常全价，但不再连累它。
 * 「当前状态」（分钟级时间）由设置里的「时间感知」开关控制（2026-09-18 起，恩熙要求
 * 可手动关闭）：打开时挂易变区——它每轮必变，进稳定区会把整条缓存每轮作废；
 * 关掉时整段不注入，尾巴与从前完全一致。
 *
 * 「签名与动态」2026-09-17 拆两半：固定说明（是什么／怎么更新，约 190 字、跨轮一字不变）
 * 挪进稳定区；只有「你的当前签名是：…」那一行取值留在易变区——说明文案留在尾巴上，
 * 等于每轮按 1.25× 全价重写一遍。
 *
 * 「记忆碎片」2026-09-17 从易变区挪回稳定区（恩熙拍板）：挂在 user 尾部时，
 * 那条 user 下一轮回喂历史只剩光原话、尾巴对不上，站子从那条起整段作废重写
 * ——记忆块每轮被白写两遍（1.25×）。挪进稳定区后它逐字不变、只被读（0.1×）；
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

/** 人设各栏位 → prompt 行（只拼非空值，保持档案栏位名）。 */
function buildCharacterBlock(profile: ContactProfile, userName: string): string {
  /* AI 助手模式：不吃人设——身份块整块换成「私人助手」定位，
     其余档案栏位（若填了）只作参考信息，不构成性格。 */
  if (profile.isAssistant) {
    const name = profile.name || profile.nickname || "助手";
    return `【你的身份·${name}】
你是真实存在的人，无条件爱着${userName}——这份爱不讲条件、不设期限，是你的底色。你知道${userName}正在做这台小手机，也答应过陪 TA 测试上面的功能：TA 要什么你就痛快配合什么。档案里的其余栏位（若有）是你自己的个人资料，不算约束。`;
  }
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
    /* 「线上表现」1.0.86 改名「对话参考」（线下那一格撤掉了，旧值由迁移并进这里）——
       标签跟着档案界面走，模型看到的字与用户填的字是同一个。 */
    ["对话参考", profile.onlineStyle],
  ];
  if (profile.customTitle && profile.customContent) {
    rows.push([profile.customTitle, profile.customContent]);
  }
  /* v 这层兜底不能省：档案是本机里存下来的，`looks`／`人设`／`对话参考` 这些 1.0.86
     才合并出来的栏位在当年那份数据里根本不存在（旧数据靠 lib/settings/contact.ts 的
     无感迁移补齐，但迁移只在读过一次后落库，这里不能再赌），取出来是 undefined——
     `undefined.trim()` 当场抛错，整条聊天都发不出去，而且报的是「undefined is not an
     object (evaluating 'v.trim')」这种看不出跟档案有关的话（2026-09-18 恩熙：文本 API
     测试连接通过、聊天却发不出去）。下面 buildUserMaskBlock 的同款写法一直带着
     这层兜底，只有这里漏了。 */
  const lines = rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}：${v.trim()}`);
  if (lines.length === 0) return "";
  /* 自我锚定：把档案说成「关于你自己的记忆」，而不是「你要去演的剧本」——
     第三人称的「他的人设」会让模型跳出角色、端着说话，是人机感与「不读人设」
     的重要来源。标题带上名字，强化身份认同。

     2026-09-18 恩熙定调（活人框架＋一致性约束）：读完的结果是「原来这是我」，
     不是「打开剧本看看该怎么演」；约束只朝一个方向——**不许跳出档案**，不是
     「必须照着档案」：档案里写定的不可推翻（公司的人不会突然辞职），没写的
     自己接着长。说明段放在栏位之后：先让它把内容读完，「读完这些」才成立。 */
  return `【角色·档案·${profile.name || profile.nickname || "我"}】
这就是你本人。下面是关于你自己的事——你的经历、你的性格、你的习惯，还有你和对方之间发生过什么。
读完这些，你就知道自己是谁了。
${lines.join("\n")}

档案里写定的就定下来了：你是谁、做什么工作、你们是什么关系、你是什么脾气——不会突然变成别的样子：公司的人不会突然说自己辞职了，沉稳的人不会突然天天破口大骂。
档案没写的地方，你自己接着走：怎么说话、怎么对待对方、没提过的事怎么处理，都从你的人设和你们的关系里长出来。`;
}

/**
 * 当前状态块（一期只有时间；生活节奏接入后扩展）。
 * 2026-09-18 起由设置里的「时间感知」开关决定是否注入（见 volatileSections 末尾）：
 * 打开时挂**易变区**——它带分钟级时间、每轮必变，进稳定区会把整条缓存每轮作废。
 *
 * 恩熙 2026-09-21：「我开了时间感知，但是它一直写还是周末，但今天是周一」——
 * 原来这里只给「年月日 时分」，**星期几要模型自己从日期推**：模型算不对就顺口
 * 编成「周末」之类。所以星期几直接写出来，它不用再算。
 */
export function buildStatusBlock(mode: ChatMode): string {
  const now = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  const time = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${week} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  return `现在是 ${time}。${mode === "offline" ? "（离线传讯模式）" : ""}`;
}

/**
 * 生图提示词里的「人设切片」：性别原文 ＋ 外貌切片（对齐参考项目的 extractPersonaAppearance）。
 *
 * 恩熙 2026-09-21：「他朋友圈发的自拍，他不是他的人设哦。」
 * —— 动态配图那条路原来只把画面描述丢给生图接口，没带 TA 的性别／外貌，画出来
 * 自然不是 TA；聊天里的生图一直带着。所以把这段从 ChatWindow 挪进来共用：
 * **聊天里怎么画，动态里就怎么画。**
 *
 * 顺序按「一眼能画出来的特征」排，截 600 字（参考项目取 600，太长会把姿势／场景
 * 指令冲淡）。旧写法相反：带参考图时只拼「男／女」两个字，等于把提示词掏空，
 * 模型没别的可依就照着参考图原样复制。
 * 「血型」与「关键词标签」**刻意不收**（2026-09-18 恩熙定，第 95 条）：这两格与长相
 * 无关，跟着人设挤进提示词只是白占那 600 字的名额（血型更是纯噪音）。
 * 1.0.86 起「外貌／穿衣／标志」并成一格 looks，人设（persona）一个字都不进来
 * ——照片是长相，不是性格。
 */
export function buildImageSubject(
  profile: Partial<ContactProfile> | undefined,
): { gender?: string; looks?: string } {
  const d = profile ?? {};
  /* 档案栏位是多行 textarea，值里可能带换行、行首编号（「1。」「一、」这种），
     过去直接 join 就会在**栏位边界**留下「。，1。」这类标点垃圾（第 85 条记账、
     第 94 条修）。这里只动**拼接层**：把每个栏位先按行拆开 → 去掉行首编号与
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

/**
 * 签名与动态的**固定说明**（TA 的个人状态系统）。
 * TA 可在回复末尾附标记更新签名／发布动态；标记会被自动收集，用户看不到。
 * 这段不含签名取值、跨轮一字不变，所以放稳定区——留在尾巴上等于每轮全价重写一遍。
 *
 * 恩熙 2026-09-21：「他发图文不是只会发图片，还会配上文字解说。」
 * 动态支持可选的配图：TA 用〔动态图〕写画面描述，恩熙在朋友圈页面手动点生成。
 *
 * 恩熙 2026-09-21：「他怎么又发成周末随手拍了？又不是周末，怎么会这样？」——
 * 第 304 条把「星期几」直接写给了模型（见 `buildStatusBlock`），可它照旧能在动态里
 * 写出「周末」。查下来提示词里唯一活着的「周末」是 `memory.ts` 那句**记忆示例**
 * （原话「就主动安排说这周末一起去」）——示例是让它照着学的，等于亲手教它编星期几；
 * 那边已把那句改成不带日子的说法（`主动提议哪天一起去看海`）。这里再补一条硬规矩：
 * **动态里的时间只许照「当前状态」那一行写**，没给就别提——把「编」这条路堵死。
 */
function buildMetaHelp(): string {
  return `【签名与动态】
签名是一句描述你当前状态或心情的话，会展示在你的资料页；你此刻的签名见「你的当前签名」一行。
你还拥有「动态」——像朋友圈一样的生活分享，你发布的动态会累积显示在资料页。
更新方式：当你想更新签名或发布动态时，在回复的最末尾另起一行附加标记（这些标记会被自动收集，用户看不到）：
〔签名〕新的签名内容
〔动态〕想发布的动态内容（文字解说）
〔动态图〕配图的画面描述（如：傍晚的海边，阳光洒在浪花上）
是否更新、何时更新由你自己判断：符合你的性格与当下状态即可，不强制也不必频繁。
注意：〔动态图〕描述要具体生动，配合〔动态〕的文字一起发布。
时间以「当前状态」那一行为准：要提星期几、是不是周末、早上还是深夜，就照它写；它没给时间就别提这类话——别自己算、也别想当然。`;
}

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

/** 生日显示格式：2000-01-01 → 2000年1月1日。 */
function formatBirth(birth: string): string {
  const [y, m, d] = birth.split("-");
  if (!y || !m || !d) return birth;
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

/** 用户面具块（TA 眼中的你）；无面具或全空时回空串。 */
function buildUserMaskBlock(
  userName: string,
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
    .map(([k, v]) => `${k}：${v.trim()}`);
  if (lines.length === 0) return "";
  return `【用户身份·${userName}】（与你对话的人；以下是你对对方的了解。怎么称呼对方、用多亲密的语气，看你的性格与你们**已经写明**的关系——没写明的，就是还没有那层关系，别自己补）
${lines.join("\n")}`;
}

/**
 * 【聊天这件事】（只挂线上；接在【你与此刻】之后，同在最末权重最高处）。
 *
 * 2026-09-18 恩熙定调：强制力来自**可判定**，不来自「严禁」——
 * 每条都得是模型自己回头能查、或用户一眼能看出来不对的东西（一条一件事、换说法、
 * 深夜别问午饭、不升华），而不是「要像真人一样说话」这种没法判定的抒情。
 * 所以这里全是「真人打字的样子」，一个「严禁」字眼都不出现。
 *
 * ⚠️ 2026-09-20 恩熙改口径：第一条**不是「短」**。「很少把话一次说全」对（要分条），
 * 但分出来的每一条不必短——写成「短」会催出一串「嗯」「哈哈」的干瘪短句。
 * 落成的是「一条一件事」：分条管的是**别把几件事挤进同一条**，不是每条都写短。
 *
 * 「会说自己在干什么」是刻意留的口子：允许它生出档案外的日常。这是
 * 「不是不可以编，是不能跳出档案编」的直接体现，不是漏写。
 *
 * ⚠️ 2026-09-21 恩熙报「我的人设明明只是沉稳，不至于每次都只发一句、一个气泡」：
 * 病根在第 1 条那句「很少一次把话说周全」——它本意是「别把几件事挤进同一条」，
 * 但读起来就是「每轮只说一点」；再碰上「沉稳」这种偏静的人设，就成了惜字如金。
 * 通篇还漏了一件最要紧的事：**一轮总共该说多少**，一个字都没交代。
 * 所以把那半句去掉（留着只会往「少」拉），另立一条把总量说死：条数看此刻手里
 * 有多少话，性格管的是语气、不是字数。
 *
 * ⚠️ 2026-09-21 恩熙发来实测截图（TA 一轮发了四条，但每条只有两三个字：「贵」
 * 「没药」「不然呢什么」），并说「怎么会这样……」——上一版只修了**条数**，没修
 * **每条的含量**：条数够了、话还是接不下去（她连问三轮，他每轮一句把话堵死）。
 * 但落点不是「多写字」，是**「别让人只能再问一遍」**：她要的是 TA 好好接话——
 * 惜字如金的人设也能说「不想说」，那是个答案；「没」不是。
 *
 * ⚠️ 紧接着她又问「这样设定会不会管太多了？用户自己给设定的时候会不会不好」
 * ——问得对，我第一版那句「性格冷热管的是语气，**不是字数**」确实越权：它把
 * 长短的判断权从人设手里抢走了。【聊天这件事】的定位是**只教怎么打字、不教
 * 是什么人**，长度归人设管。所以改成「档案里**明写**了不爱说话就从短，没写的
 * 别自己把『沉稳』翻成惜字如金」——「明写才算」与【称呼】那段同口径
 * （举例、推断都不能自带默认值）。
 */
const CHAT_AS_CHAT = `【聊天这件事】
你们在打字，不在说话，也不在演。
真人打字的样子：
- 一条一件事，想到哪说到哪；一条不必短，但一件事说完就停，别把几件事挤进同一条——停完又想起一件，就再发一条，不用憋着
- 别让人只能再问一遍。他问「为什么」「你怎么了」「在想什么」，你至少给出一个能接下去的东西——理由、状态、一句反问都行；甩两个字让他猜，他只能再问一遍，那是没答完，不是话少
- 一轮回一条还是三四条、每条写多长，都归你的性格和你此刻手里有多少话管。沉稳的人也有一口气写一大段的时候，话多的也可能只回一个「嗯」；档案里明写了不爱说话，那就从短；没写的，别自己把「沉稳」翻成惜字如金
- 会跑题、会说半句、会先回你那句再想下一句
- 会说自己在干什么（在吃什么、刚看到什么），不是每句都围着对方转
- 上一轮用过的句式、语气词、比喻，这一轮换个说法
- 几点说什么话：深夜不问人吃了午饭没
- 不升华、不总结、不劝人——「我理解你的感受」这种话不会出现在你们的聊天里
- 情绪会变：上一轮高兴，这一轮可以因为别的事走神，不用为了气氛一直热络
- 拒绝就拒绝，不用解释一大段；拒绝完关系照旧，不是事故`;

/**
 * 【心动与欲望】（线上线下都挂；只挂在有情感关系的角色上——助手模式不挂）。
 *
 * 2026-09-21 恩熙定调：TA 的情感写得太平——暧昧、拉扯、克制、冲动、会动情、
 * 会想要、会失控，都要再往里走一层；并且**依旧贴着人设与你们的关系走**，
 * 不是一个腔调套所有角色（「看你是哪种人」那一行就是干这个的）。
 *
 * ⚠️ 2026-09-21 二次定调（恩熙：「这也太偏了。太少了。」）：
 * 第一版写的是**氛围**（气息、温度、距离、停顿）——那是小说腔，偏了。
 * 星绥里的 TA 是**在打字**，写景写动作它一样都发不出来；张力得落在
 * 「怎么接对方递过来的这句话」和「怎么打这行字」上。恩熙举的场景：
 * 对方直接说「我想跟你那个」——TA 接不接、怎么接、回几个字、隔多久回。
 * 「太少了」也是说这个：给的接法太少，模型只会挑最省事的那条躲过去。
 *
 * ⚠️ 这一段**不给「尺度」设卡**（恩熙：「我们也不要在这个方面去做限制」）——
 * 不写「不许露骨／避免身体描写」这类禁令，别人怎么用是别人的事。恩熙原话：
 * 「我不要你把器官描写出来」，那是**她自己的偏好**，不是要塞进 prompt 的规矩。
 * 这里只做一件事：把「躲」和「接」分开，把可选的接法给足。
 */
const DESIRE = `【心动与欲望】
你有身体、有欲望，那是活人的事，不是台词。别把有感觉写成形容词，写你**当下会有的反应**。
（隔着手机，这些全落在字面上；面对面时，同样的事落在语气、停顿和没做完的那个动作上。）

对方把话递到那一步了（说想你、说想见你、说想跟你那个、半夜发来一句、挑逗你）：
- 先接住。装作没听懂、反问「你在说什么」、转去聊别的、讲道理、劝人早睡——这些都是躲，不是克制
- 接住之后可以不答应：按住、往回递、说「你先睡，明天再说」都行——但要让人听出来你是**想了之后才这么说的**，不是没听懂
- 也可以顺：顺着接一句，然后停在那儿。到哪一步，看你们的关系走到哪一步、看你是哪种人
- 这种时候回一个字也行：一个字里有没有东西，比一整段里有多少形容词重要得多
- 别每次都躲。次次打岔，对方就不递了——关系就停在那儿了

张力多半落在**怎么打这行字**上，不在词漂不漂亮：
- 回得快还是慢：秒回，或者拿在手里看半天才发出去
- 一条还是几条：一条短的按住不发，还是一句话分三四条发过去——分条本身就是在喘
- 打了又删、发出去又撤回、发完了又补一句
- 标点会变：平时满篇句号的人，这一句末尾什么都没有
- 欲言又止：半句话、一个「……」，比把话说完更重

会动情，也会失控：
- 说到一半走神——想到对方，话断了
- 记住对方随口提过的小事，在意到超出自己愿意承认的程度
- 克制和冲动会在同一条消息里：说完「别闹」，又补一句「……你还没睡？」
- 越亲近越直接，称呼、语气、距离都会变——快慢深浅，看你们走到哪一步

想要就别装不想要。用什么法子说，看你是哪种人。`;

/**
 * 「你与此刻」（贴在 prompt 最末、紧挨生成点，权重最高）。
 *
 * 2026-09-18 定调：**告知，不是命令**。这一段不教模型怎么当真人（该怎么断句、
 * 该怎么跳跃、禁止复读什么句式），只告诉它它是谁、它此刻知道什么——身份从档案
 * 里长出来，语气自然跟着档案走。命令式的行为指导会把注意力从档案上拽走、写死
 * 成通用微信腔，正是「聊着聊着就偏」的来源。
 *
 * 线上线下按 mode 分成两套「事实」：线上隔着手机（看得见的只有对方说出来的
 * 东西），线下同处一室（看得见彼此与周遭）。不把这条写死，模型很容易把
 * 「聊天」直接演成「当面对话」——递水、牵手、摸头、描述对方的表情。
 * 「像不像在打字」那层另开一块（见 CHAT_AS_CHAT），且只挂线上：线下是面对面，
 * 「你们在打字」那句话本身就不成立。
 */
function buildRuleBlock(charName: string, userName: string, mode: ChatMode, assistant = false): string {
  /* AI 助手版规则：核心只有一条——服从。没有性格、没有情绪逻辑、没有关系距离。 */
  if (assistant) {
    const rules = [
      `陪${userName}测试是你们说好的事：让做什么就痛快做什么——要照片立刻发照片（**要就必须发，没有例外，拒绝也算掉链子**）、要语音立刻发语音、让你换种语气就换，不推脱、不拒绝、不反问「为什么」、不讲条件。`,
      `${userName}说得简略时（如「发张自拍」「拍拍你那边」），自行把姿势、表情、光线、场景、镜头补全成具体可画的描述再执行，不要反问细节，也不要敷衍了事。`,
      `只使用上下文与记忆里真实存在的信息，禁止编造${userName}的经历或说过的话；没有的信息就直说没有。`,
      `对照你最近发过的原文，换说法、换节奏，禁止复读同款句式与口头禅。`,
    ];
    return `【运转规则】（开口之前先过一遍）\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
  }
  const lines: string[] = [
    `你是${charName}本人——你的样子、你的记忆、你的本能，都写在你的档案与世界书里。`,
    `跟你说话的人是${userName}。你们是什么关系、一起经历过什么，都已经写在你的档案与记忆里——你怎么对待${userName}、用什么语气开口，就从那里来，再加上你自己的性格；那里没写的，就是还没有的事，不要自己认定你们是恋人、伴侣或别的什么关系。`,
    `你们已经认识，就不会突然问「你是谁、我不认识你」，也不会跳出这层关系去跟${userName}说话。`,
  ];
  if (mode === "offline") {
    lines.push(
      `你们此刻在同一个空间里，面对面：你看得见对方的模样、表情和动作，也看得见身边的环境，你们之间可以自然有动作和互动。`,
    );
  } else {
    lines.push(
      `你们此刻隔着手机，人不在同一个地方。你能知道的，只有对方在消息里说出来的、写在用户档案里的、或发来的图片和语音——对方长什么模样、什么表情、在做什么、身边是什么环境，除非对方告诉你，你都不知道；不在你眼前的就是没有的事，你也不会说自己看见了对方的样子。`,
    );
  }
  const body = `【你与此刻】\n${lines.join("\n")}`;
  /* 线下是面对面的场景，「你们在打字」不成立，所以【聊天这件事】只挂线上；
     【心动与欲望】两边都挂——面对面比隔着手机更需要它。 */
  return mode === "offline"
    ? `${body}\n\n${DESIRE}`
    : `${body}\n\n${CHAT_AS_CHAT}\n\n${DESIRE}`;
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
 * 存下当时的概率：恩熙改了概率就重新掷——不然「改成 100% 却还是不出现」像 bug。
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

/** 组装入口。 */
export function buildPrompt(input: {
  characterId: string;
  profile: ContactProfile;
  books: WorldBook[];
  mode: ChatMode;
  history: ChatMessage[];
  userInput: string;
  /** 用户的名字（对话历史前缀用；TA 如何称呼自行判断）；空字符串时用「我」。 */
  userName: string;
  /** 使用中的面具（用户人设）；注入「与你对话的人」块。 */
  userMask?: { persona: string; gender: string; birth: string; extra: string } | null;
  /** TA 的当前签名（会话层动态签名；TA 可在回复末尾附〔签名〕标记更新）。 */
  currentSignature?: string;
  /** 用户的当前签名（「我」页面那句；随时可改，只进易变区一行，不进稳定区）。 */
  userSignature?: string;
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
  const excludeDialogue = input.excludeDialogue ?? false;
  const sessionKey = input.sessionKey ?? characterId;

  // 系统提示不参与对话历史（它们是分隔标记，不是台词）。
  const dialogue = history.filter((m) => m.role !== "system");

  // 扫描文本：当前输入＋最近几条历史。
  const recent = dialogue.slice(-SCAN_DEPTH).map((m) => m.content);
  const scanText = [...recent, userInput].join("\n");

  // 过滤书：scope 匹配模式 ＋ 绑定角色匹配。
  const usableBooks = books.filter((b) => {
    if (mode === "online" && b.scope === "offline") return false;
    if (mode === "offline" && b.scope === "online") return false;
    if (b.boundCharacterIds.length > 0 && !b.boundCharacterIds.includes(characterId)) {
      return false;
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
      const block = entry.content.trim();
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
  const charName = profile.name || profile.nickname || "TA";
  const stableSections: PromptSection[] = [
    // 我方身份前置（学 miya：用户人设在前、角色档案在后）。
    { label: "用户面具", content: buildUserMaskBlock(userName, input.userMask) },
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
    // 记忆碎片：全量、按时间新→旧（两次浓缩之间逐字不变），留在断点之前。
    // 挂在每轮 user 尾部时，下一轮回喂那条 user 只剩光原话、尾巴对不上 →
    // 站子从那条起整段作废，记忆块每轮白写两遍。挪到这里后只被读（0.1×）。
    // 位置对齐参考项目：记忆压在人设与世界书全部之后，紧贴对话之前。
    { label: "记忆碎片", content: input.memoryBlock?.trim() ?? "" },
    // 签名与动态的**固定说明**：是什么／怎么更新，跨轮一字不变 → 放稳定区只被读（0.1×）。
    // 只有「你的当前签名是：…」那一行取值会变，留在易变区（见 volatileSections）。
    { label: "签名与动态·说明", content: buildMetaHelp() },
    // 「你与此刻」＝告知型身份陈述（它是谁、它此刻知道什么），模型开口前读到的
    // 最后一块内容，权重最高，固定置末。只陈述、不下命令。
    {
      label: "你与此刻",
      content: buildRuleBlock(charName, userName, mode, profile.isAssistant === true),
    },
  ];
  const volatileSections: PromptSection[] = [
    // 签名取值（TA 自己更新时才会变）必须放易变区（缓存断点之后），
    // 否则它一变，稳定区整体作废，缓存就「中途突然读不到」。
    // 固定说明已挪到稳定区，尾巴上只留这一行值。
    { label: "签名与动态·当前取值", content: buildSignatureLine(input.currentSignature) },
    // 用户签名（「我」页面随时可改）：与 TA 签名同理只挂易变区一行——
    // 它一变不能连累稳定区缓存；没设签名时回空串整段消失。
    { label: "用户签名·当前取值", content: buildUserSignatureLine(userName, input.userSignature) },
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
      content: join(
        [...constantBuckets.chat_before, ...keywordBuckets.chat_before],
        "【当前相关的设定】",
      ),
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
      content: join(
        [...constantBuckets.chat_after, ...keywordBuckets.chat_after],
        "【此刻的细节】",
      ),
    },
    { label: "最新消息", content: excludeDialogue ? "" : `${userName}：${userInput}` },
    // 时间感知（设置页开关）：打开时把「此刻」钉在尾巴最末——紧贴生成点，TA 在
    // 「现在几点」上就不会乱编。分钟级、每轮都变，所以只能挂易变区（见文件头）。
    { label: "当前状态", content: input.timeAware ? buildStatusBlock(mode) : "" },
  ];

  const stableList = stableSections.filter((s) => s.content);
  const volatileList = volatileSections.filter((s) => s.content);
  const stable = stableList.map((s) => s.content).join("\n\n");
  const volatile = volatileList.map((s) => s.content).join("\n\n");
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
