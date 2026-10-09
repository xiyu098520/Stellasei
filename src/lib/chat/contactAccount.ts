/**
 * TA 那本账的「开户」（1.4.36）。
 *
 * 【要解决什么】在这以前，TA 的账是一本**空账**：起手 0，只有我发过去的钱才记一笔。
 * 翻他手机看到「余额 0.00、还没有收支记录」，一眼假——真人手上不会一分钱没有，
 * 也不会没有过去。恩熙要的是：**第一次翻他手机时，按他的人设给他开一本有来历的账**
 * （一份起手余额 ＋ 过去两三个月的流水），之后再翻只往后长、旧的一条不动。
 *
 * 【为什么交给 AI 编】金额不能拍脑袋定死。同一个「学生」，家里给零花钱的和自己打工的
 * 差着量级；人设里写没写「家里有钱」，账就该是两个样子。这种事只有读了人设才知道，
 * 所以**让模型读人设写一份**，写不出来／写得不像话，再走本地那一档兜底（按职业、
 * 年龄、人设里的关键词分档随机）——绝不让她翻进去看见一本空账。
 *
 * 【账本永远是平的】模型算错数很常见，所以这里只信它编的「内容」，
 * 余额直接取流水一笔笔加出来的合计（算不平就不理它报的余额），
 * 校验合计不在合理区间就整份作废、走本地兜底。
 *
 * 【只开一次】本模块在动手前先问一句「这本账还是白纸吗」，是白纸才往下走
 * （既省下一次模型调用，也保证第二遍翻进去时旧流水一条不动）。
 *
 * 【走哪条 API（1.9.4）】开户是幕后的活，跟记忆归总归在一路：**配了副 API 就走副 API**
 * （便宜、快，也不抢聊天那条道），没配就退回主文本接口——跟改动前一模一样。
 * 回退：把 `openContactAccountIfEmpty` 里那段 `getApiBundle()` 换回 `getApiSettings()`。
 */

import { fetchAIReply } from "@/lib/chat/chatApi";
import { getApiBundle } from "@/lib/settings/chat";
import {
  getBalance,
  isContactAccountBlank,
  seedContactAccount,
  type ContactSeedEntry,
} from "@/lib/settings/wallet";
import type { ChatApiSettings } from "@/types/chat";
import type { ContactProfile } from "@/types/contact";

/** 一天（毫秒）：把「距今多少天」换成流水上的时间。 */
const DAY_MS = 86_400_000;

/**
 * 一条流水的时间：**距今 N 天**的某个像样的钟点（1.12.1）。
 *
 * 为什么不再直接用 `Date.now() - N*DAY_MS`：那样每条流水都抄「打开手机这一刻」
 * 的钟点——上次那张截图里六条全落在 **03:50**（外卖、工资都在凌晨三点五十），
 * 一眼假。真人一天的花销散在早中晚，所以每条各给一个 7:00～22:59 的随机钟点。
 */
function stampDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  d.setHours(
    7 + Math.floor(Math.random() * 16),
    Math.floor(Math.random() * 60),
    Math.floor(Math.random() * 60),
    0,
  );
  return d.toISOString();
}

/** 起手余额的上下限（分）：1 元 ~ 10 万亿元。
 *  **1.11.95（恩熙：「你没见过有钱人，是吗？」）：上限由 1 亿元抬到 10 万亿元——不再替人设定天花板。**
 *  1.11.93 把闸抬到 1 亿，还是把「有钱」限死在一个我自以为很大的数上；
 *  现在这道闸**只防程序算炸**（金额 ×100 折成分后要落在 JS 的精确整数范围内，
 *  约 9×10^15 分），不再当财力的判官——人设要多有钱就多有钱。
 *  单笔流水与合计都按它校验，故一并放宽。 */
const MIN_BALANCE_CENTS = 100;
const MAX_BALANCE_CENTS = 1_000_000_000_000_000;

/** 允许的流水笔数（含头尾）。
 *  **1.11.98（恩熙：「改成过去一个月，账单要稍微详细一点」）：上限由 12 抬到 24。**
 *  提示词已改成要 10～14 笔，12 会把多出来的直接切掉（`parseSeedReply` 的 slice）。 */
const MIN_ROWS = 3;
const MAX_ROWS = 24;

/**
 * 第一次翻到他的手机时给他开户。
 * 已经开过的账直接返回现状（不调模型、不写一个字）。
 */
export async function openContactAccountIfEmpty(input: {
  /** 账本主人：角色的档案 id。 */
  ownerId: string;
  /** 他的人设档案（账要贴着这个人写）。 */
  profile: ContactProfile;
}): Promise<{ opened: boolean; balance: number }> {
  const blank = await isContactAccountBlank(input.ownerId);
  if (!blank) {
    return { opened: false, balance: await getBalance(input.ownerId, "contact") };
  }
  /* 一切「问模型」的意外都吞在这里，统一落到下面的本地兜底——
     翻进去看见一本空账，比一份不那么贴身份的账糟得多。 */
  try {
    /* 幕后活优先走副 API（1.9.4）：与记忆归总同一路——配了就用它，没配退回主文本接口。 */
    const bundle = await getApiBundle();
    const sub = bundle.sub;
    const api =
      sub.enabled && sub.baseUrl.trim() && sub.apiKey.trim() && sub.model.trim()
        ? sub
        : bundle.text;
    if (api.enabled && api.baseUrl.trim() && api.model.trim()) {
      const seed = await askAiForSeed(api, input.profile);
      if (seed) {
        return await seedContactAccount({
          ownerId: input.ownerId,
          balance: seed.balance,
          history: seed.history,
        });
      }
    }
  } catch {
    /* 模型没回话／回的不像一份账：往下走本地兜底。 */
  }
  const local = buildLocalSeed(input.profile);
  return seedContactAccount({
    ownerId: input.ownerId,
    balance: local.balance,
    history: local.history,
  });
}

/* ------------------------------ 让模型编一份 ------------------------------ */

const SEED_SYSTEM = `写一份零钱账本：一份此刻的零钱余额，加上**最近一周**（到今天为止）真实的收支流水。按真实账目写，不要按小说写——钱从何处来、用往何处，都要贴合他的身份。

只输出一段 JSON。第一个字符就是 {，不要解释、不要开场白、不要 markdown 代码块。

JSON 结构：
{"balance": 余额数字, "history": [{"title": "名目", "amount": 金额数字, "days_ago": 距今多少天, "detail": "补充说明"}]}

【规则】
1. 金额单位是**元**，最多两位小数，不要写「¥」也不要写「元」这个字。amount 正数＝进账、负数＝出账。days_ago 是 1 到 7 之间的整数（1＝昨天，7＝一周前），越早的事情天数越大。
2. history 写 5 到 8 笔，把这一周里的日常花销摊出来（吃喝、出行、买东西各有着落），按时间**从早到晚**排（也就是 days_ago 从大到小）。
3. 这几笔加起来必须**正好等于** balance。输出前自行依序核算一遍；对不上就调整 balance。
4. balance 是这个人物**手头留着的零钱**，不是他的身家。按他的人设与家境定这个数，不必收敛：学生也可能手头相当宽裕，家底厚的可以是很大的数目——只要与这个人对得上就行。
5. 资料几乎空白时（职业、人际关系与家境、人设这些一概没填，只有姓名、年龄这一类），**不要写夸张的数目**，一律按一个正常的普通小康家庭来算。
6. 每一笔都要贴合这个人：收入要能看出他靠什么生活，开销要符合他的身份。**名目写得像真实账单上的商家名**——「美团外卖」「瑞幸咖啡」「优衣库」「屈臣氏」这样，同一类花销换着牌子写，别整周都是同一个词。房租这类一个月才交一次的固定支出，一周里最多出现一笔，且金额写固定一个数。
7. detail 补一句这笔账的来由：买了什么、在哪、跟谁，或这笔钱是做什么用的；没有可写的就写空字符串。
8. 每一笔都按现实里的真实物价去写：是什么名目，就写那个东西在现实里值多少钱，别硬凑大小。日常小开销不要安上跟它不相称的大数字（一单外卖不可能三千，话费不可能几千）；只有这笔本身就写着是贵的（整间公司的水电、买家电、买奢侈品之类），才跟着贵。名目不要重复。`;

/** 让人设读起来像一张简况表（模型拿这个判断这人的钱味）。
 *  **1.11.91（恩熙定）：档案里有字的栏目整段带进去、一个字不截。**
 *  先前「人设」截到 1200 字、「家境」和「补充区」截到 400 字，落在这之后的字
 *  模型根本看不见——她的原话「跟穿衣风格也会有关系」，钱本来就是跟家境、职业、
 *  住处、穿戴讲究挂钩的，编辑时看不全，编出来的账自然跟人设对不上。
 *  只三样不带：**照片**（data URL，几万字符，塞不进提示词）、**卡面裁切位置**
 *  （纯界面参数）、**是否测试助手**（内部开关）——这三样不是「他的情况」。
 *  只开户这一次调用，多带这点字不心疼。 */
function profileBrief(p: ContactProfile): string {
  const lines = [
    `姓名：${p.name || "（没写）"}`,
    p.nickname ? `我平时叫他：${p.nickname}` : "",
    p.signature ? `签名：${p.signature}` : "",
    p.gender ? `性别：${p.gender}` : "",
    p.age ? `年龄：${p.age}` : "",
    p.birth ? `生日：${p.birth}` : "",
    p.occupation ? `职业／身份：${p.occupation}` : "",
    p.tag ? `种族：${p.tag}` : "",
    p.labels ? `关键词：${p.labels}` : "",
    p.height ? `身高／体重：${p.height}` : "",
    p.blood ? `血型：${p.blood}` : "",
    p.looks ? `外貌特征／穿衣风格：${p.looks}` : "",
    p.persona ? `人设：${p.persona}` : "",
    p.relOther ? `人际关系与家境：${p.relOther}` : "",
    p.onlineStyle ? `对话参考（说话风格）：${p.onlineStyle}` : "",
    p.customContent ? `${p.customTitle || "补充"}：${p.customContent}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * 问模型要一份账；回的话不像账就回 null（交给本地兜底）。
 *
 * **1.12.2 查出模型这条路一直失败**（恩熙那两份账全是本地兜底掷出来的：名目恰好
 * 是代码词表里的原词、时间全卡同一钟点）。**1.12.3 把输出上限整个撤掉**——恩熙的
 * 原话「你不要去限制它的输出空间」：先前给 1200、后来给 4000，都是在拦它；
 * 现在传 **0＝不设上限**（见 `buildChatRequest` 里那一段），让服务商按它自己的默认
 * 额度来。限长一旦掐断，`parseSeedReply` 抠不出完整 JSON、判「不像账」，
 * 于是**静默退回本地兜底**——这才是「不真实」的总根。
 */
async function askAiForSeed(
  api: ChatApiSettings,
  profile: ContactProfile,
): Promise<{ balance: number; history: ContactSeedEntry[] } | null> {
  const reply = await fetchAIReply(
    api,
    SEED_SYSTEM,
    [],
    `【人设】\n${profileBrief(profile)}`,
    undefined,
    0,
    0.4,
  );
  return parseSeedReply(reply);
}

interface RawSeed {
  balance?: unknown;
  history?: unknown;
}

/** 从回复里抠出 JSON（容忍代码块包裹与前后废话），再逐格校验成能落库的形状。 */
function parseSeedReply(reply: string): { balance: number; history: ContactSeedEntry[] } | null {
  const text = reply.replace(/```[a-zA-Z]*/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: RawSeed;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as RawSeed;
  } catch {
    return null;
  }
  const balance = Math.round(Number(raw.balance) * 100);
  if (!Number.isFinite(balance) || balance < MIN_BALANCE_CENTS || balance > MAX_BALANCE_CENTS) {
    return null;
  }
  if (!Array.isArray(raw.history)) return null;
  const rows = raw.history.slice(0, MAX_ROWS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as { title?: unknown; amount?: unknown; days_ago?: unknown; detail?: unknown };
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 20) : "";
    const cents = Math.round(Number(r.amount) * 100);
    const days = Math.round(Number(r.days_ago));
    if (!title || !Number.isFinite(cents) || cents === 0) return [];
    if (Math.abs(cents) > MAX_BALANCE_CENTS) return [];
    if (!Number.isFinite(days) || days < 1 || days > 365) return [];
    const detail = typeof r.detail === "string" ? r.detail.trim().slice(0, 40) : "";
    return [
      {
        title,
        amount: cents,
        detail,
        createdAt: stampDaysAgo(days),
      },
    ];
  });
  if (rows.length < MIN_ROWS) return null;
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  /* 余额取流水合计，不取模型报的那个数——它算不平是常态，替它算平就行。
     合计也得落在合理区间（同起手余额的上下限），否则整份当胡说，退本地兜底。 */
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  if (total < MIN_BALANCE_CENTS || total > MAX_BALANCE_CENTS) return null;
  return { balance: total, history: rows };
}

/* ------------------------------ 本地兜底 ------------------------------ */

interface Tier {
  /** 命中这串词就用这一档（按顺序第一个命中的算）。 */
  match: RegExp;
  /** 主收入的名目（随机取一个）。 */
  incomes: string[];
  /** 日常开销：名目 ＋ **这一档里它单笔的合理区间（元）**。
   *  1.11.90 前这里只有一个共用的「单笔开销区间」（普通上班族 50～2500），
   *  随机取数就会抽出「水电 1846」「话费 1504」这种数——每种花销的钱量级差得远
   *  （地铁两块、房租几千），必须一名目一段区间，才像真人的账。
   *  **1.12.2：账期缩到「最近一周」，所以这里只留一周里真会发生的花销**——
   *  房租、水电、话费这些一个月才交一次的整块支出全撤掉（她的原话：「一个月为什么
   *  会付那么多次的房租呢」）；原先撤掉的位置补上奶茶、打车、便利店这类周常项目。 */
  spends: { title: string; min: number; max: number }[];
  /** 起手余额区间（元）。 */
  min: number;
  max: number;
}

/** 分档只看一件事：这个人过的是哪种日子。命中不了就按普通上班族算。 */
const TIERS: Tier[] = [
  {
    match: /总裁|董事|老板|集团|豪门|少爷|千金|世家|继承|投资|CEO|ceo|富二代|家里有钱/,
    incomes: ["这个月的家用", "家里转的", "分红到账"],
    spends: [
      { title: "餐厅", min: 200, max: 3_000 },
      { title: "买衣服", min: 300, max: 8_000 },
      { title: "机票", min: 1_000, max: 8_000 },
      { title: "朋友聚会", min: 300, max: 3_000 },
      { title: "健身", min: 200, max: 2_000 },
      { title: "打车", min: 50, max: 400 },
    ],
    min: 300_000,
    max: 3_000_000,
  },
  {
    match: /明星|演员|歌手|偶像|网红|主播|模特|艺人/,
    incomes: ["广告结算", "通告费", "直播分成"],
    spends: [
      { title: "衣服", min: 200, max: 5_000 },
      { title: "护肤", min: 200, max: 3_000 },
      { title: "打车", min: 30, max: 300 },
      { title: "请客", min: 300, max: 3_000 },
      { title: "健身", min: 200, max: 2_000 },
      { title: "咖啡", min: 30, max: 120 },
    ],
    min: 20_000,
    max: 200_000,
  },
  {
    match: /学生|高中|大学|研究生|大一|大二|大三|大四|在读|读书/,
    incomes: ["家里给的零花钱", "生活费"],
    spends: [
      { title: "食堂", min: 10, max: 40 },
      { title: "奶茶", min: 8, max: 30 },
      { title: "外卖", min: 15, max: 60 },
      { title: "超市", min: 15, max: 80 },
      { title: "电影票", min: 20, max: 80 },
      { title: "买书", min: 20, max: 200 },
      { title: "快递", min: 10, max: 50 },
    ],
    min: 200,
    max: 3_000,
  },
  {
    match: /无业|失业|待业|流浪|负债|欠债|破产|打零工/,
    incomes: ["打零工", "朋友还的钱"],
    spends: [
      { title: "泡面", min: 5, max: 20 },
      { title: "盒饭", min: 10, max: 25 },
      { title: "地铁", min: 3, max: 20 },
      { title: "便利店", min: 5, max: 30 },
    ],
    min: 30,
    max: 600,
  },
];

const DEFAULT_TIER: Tier = {
  match: /./,
  /* **兜底档：正常普通小康家庭**（1.11.94，恩熙定）。
     两处会落到它：① 模型没回话／回的不像账；② 资料里看不出经济状况的
     （职业、家境、人设这些一概没写，只给了姓名、年龄之类）。这时就按一个
     普通小康人家来算，不往富或穷两头猜——与提示词第 4 条那句同源。 */
  incomes: ["工资", "这个月的工资", "项目结算"],
  spends: [
    { title: "外卖", min: 15, max: 80 },
    { title: "买菜", min: 20, max: 200 },
    { title: "聚餐", min: 50, max: 500 },
    { title: "地铁", min: 3, max: 30 },
    { title: "打车", min: 15, max: 60 },
    { title: "奶茶", min: 8, max: 35 },
    { title: "便利店", min: 5, max: 60 },
    { title: "快递", min: 10, max: 50 },
  ],
  min: 1_000,
  max: 30_000,
};

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** [min, max] 之间的整数（含两端）。 */
function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * 本地兜底的一份账：**先定期末余额，再往前倒推**。
 * 这么做账一定是平的——先随机一笔或几笔开销，主收入 ＝ 余额 ＋ 开销合计，
 * 无论随机到什么数都不会出现负数余额，也不用回头找平。
 */
function buildLocalSeed(profile: ContactProfile): {
  balance: number;
  history: ContactSeedEntry[];
} {
  const hint = [
    profile.occupation,
    profile.persona,
    profile.labels,
    profile.tag,
    profile.relOther,
    profile.age,
    profile.customContent,
  ].join(" ");
  const tier = TIERS.find((t) => t.match.test(hint)) ?? DEFAULT_TIER;

  const balance = randInt(tier.min * 100, tier.max * 100);
  /* 账期是**最近一周**（1.12.2，恩熙：「让他生成近一周到今日」），笔数收到 5～8
     ——一周的日常花销本来就这么几笔，摊到十来笔反倒假。 */
  const spendCount = randInt(5, 8);
  /* **每样名目最多出现一次**（1.12.2，恩熙：「买衣服」连着五条、房租一月付三次太假）：
     把这一档的名目洗一遍再抽，抽过的不再抽——一周里同一栏位反复出现本就不像账。 */
  const pool = [...tier.spends];
  const spends: { title: string; amount: number }[] = [];
  for (let i = 0; i < spendCount && pool.length > 0; i++) {
    const s = pool.splice(randInt(0, pool.length - 1), 1)[0];
    spends.push({ title: s.title, amount: randInt(s.min * 100, s.max * 100) });
  }
  const spendSum = spends.reduce((sum, s) => sum + s.amount, 0);
  /* 收入取整到百元（1.12.2）：真人工资／家用都是整数，不会有 199281.39 这种尾数——
     原先「收入＝余额＋开销合计」倒推出来的数一眼就假。取整后回填余额，账照样是平的
     （余额 ＝ 收入 − 开销）；万一取整把余额压到 1 元以下，补一百元回去。 */
  let incomeCents = Math.round((balance + spendSum) / 10_000) * 10_000;
  if (incomeCents - spendSum < 100) incomeCents += 10_000;
  const finalBalance = incomeCents - spendSum;

  /* 时间**在最近一周内**从早到晚铺开：收入在最前（约一周前），开销按笔数均分往后铺。 */
  const span = randInt(5, 7);
  const step = span / (spends.length + 1);
  const history: ContactSeedEntry[] = [
    {
      title: pick(tier.incomes),
      amount: incomeCents,
      detail: "",
      createdAt: stampDaysAgo(span),
    },
  ];
  spends.forEach((s, i) => {
    history.push({
      title: s.title,
      amount: -s.amount,
      detail: "",
      createdAt: stampDaysAgo(Math.max(1, Math.round(span - step * (i + 1)))),
    });
  });
  return { balance: finalBalance, history };
}
