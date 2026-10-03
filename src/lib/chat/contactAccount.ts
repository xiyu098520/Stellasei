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

/** 起手余额的上下限（分）：1 元 ~ 100 万元。之外的数一律当模型在胡说，退回本地兜底。 */
const MIN_BALANCE_CENTS = 100;
const MAX_BALANCE_CENTS = 100_000_000;

/** 允许的流水笔数（含头尾）。 */
const MIN_ROWS = 3;
const MAX_ROWS = 12;

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

const SEED_SYSTEM = `你在为一部虚构手机里的某个人编写他的「零钱账本」：一份此刻的零钱余额，加上过去两三个月里真实的收支流水。这不是在写小说，而是在还原一个普通人的手机账目——钱从何处来、用往何处，都要贴合他的身份。

只输出一段 JSON。第一个字符就是 {，不要解释、不要开场白、不要 markdown 代码块。

JSON 结构：
{"balance": 余额数字, "history": [{"title": "名目", "amount": 金额数字, "days_ago": 距今多少天, "detail": "补充说明"}]}

【规则】
1. 金额单位是**元**，最多两位小数，不要写「¥」也不要写「元」这个字。amount 正数＝进账、负数＝出账。days_ago 是 1 到 90 之间的整数，越早的事情天数越大。
2. history 写 6 到 7 笔，按时间**从早到晚**排（也就是 days_ago 从大到小）。
3. 这几笔加起来必须**正好等于** balance。输出前自行依序核算一遍；对不上就调整 balance。
4. balance 是这个人物**手头留着的零钱**，不是他的身家：学生几百到几千，普通上班族几千到几万，家底厚或者收入高的可以更多——但不要夸张到不合常理。
5. 每一笔都要贴合这个人：收入要能看出他靠什么生活，开销要符合他的身份。名目字数短一些，像账单条目。
6. detail 写一句这笔钱的来由与相关的人；没有可写的就写空字符串。`;

/** 让人设读起来像一张简况表（模型拿这个判断这人的钱味）。 */
function profileBrief(p: ContactProfile): string {
  const lines = [
    `姓名：${p.name || "（没写）"}`,
    p.nickname ? `我平时叫他：${p.nickname}` : "",
    p.gender ? `性别：${p.gender}` : "",
    p.age ? `年龄：${p.age}` : "",
    p.occupation ? `职业／身份：${p.occupation}` : "",
    p.tag ? `种族：${p.tag}` : "",
    p.labels ? `关键词：${p.labels}` : "",
    p.relOther ? `人际关系与家境：${p.relOther.slice(0, 400)}` : "",
    p.persona ? `人设：${p.persona.slice(0, 1200)}` : "",
    p.customContent ? `${p.customTitle || "补充"}：${p.customContent.slice(0, 400)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** 问模型要一份账；回的话不像账就回 null（交给本地兜底）。 */
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
    1200,
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
        createdAt: new Date(Date.now() - days * DAY_MS).toISOString(),
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
  /** 日常开销的名目。 */
  spends: string[];
  /** 起手余额区间（元）。 */
  min: number;
  max: number;
  /** 单笔开销区间（元）。 */
  spendMin: number;
  spendMax: number;
}

/** 分档只看一件事：这个人过的是哪种日子。命中不了就按普通上班族算。 */
const TIERS: Tier[] = [
  {
    match: /总裁|董事|老板|集团|豪门|少爷|千金|世家|继承|投资|CEO|ceo|富二代|家里有钱/,
    incomes: ["这个月的家用", "家里转的", "分红到账"],
    spends: ["餐厅", "买衣服", "机票", "朋友聚会", "健身"],
    min: 60_000,
    max: 400_000,
    spendMin: 300,
    spendMax: 8_000,
  },
  {
    match: /明星|演员|歌手|偶像|网红|主播|模特|艺人/,
    incomes: ["广告结算", "通告费", "直播分成"],
    spends: ["衣服", "护肤", "打车", "请客", "健身"],
    min: 20_000,
    max: 200_000,
    spendMin: 200,
    spendMax: 6_000,
  },
  {
    match: /学生|高中|大学|研究生|大一|大二|大三|大四|在读|读书/,
    incomes: ["家里给的零花钱", "生活费"],
    spends: ["食堂", "奶茶", "外卖", "买书", "电影票", "话费", "快递"],
    min: 200,
    max: 3_000,
    spendMin: 20,
    spendMax: 300,
  },
  {
    match: /无业|失业|待业|流浪|负债|欠债|破产|打零工/,
    incomes: ["打零工", "朋友还的钱"],
    spends: ["泡面", "地铁", "话费", "房租"],
    min: 30,
    max: 600,
    spendMin: 10,
    spendMax: 200,
  },
];

const DEFAULT_TIER: Tier = {
  match: /./,
  incomes: ["工资", "这个月的工资", "项目结算"],
  spends: ["房租", "外卖", "地铁", "买菜", "聚餐", "水电", "话费", "快递"],
  min: 1_000,
  max: 30_000,
  spendMin: 50,
  spendMax: 2_500,
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
  const spendCount = randInt(3, 5);
  const spends = Array.from({ length: spendCount }, () =>
    randInt(tier.spendMin * 100, tier.spendMax * 100),
  );
  const incomeCents = balance + spends.reduce((sum, c) => sum + c, 0);

  /* 时间从早到晚铺开：收入在最前面（两个月前），开销一笔一笔往后挪。 */
  let days = randInt(55, 70);
  const history: ContactSeedEntry[] = [
    {
      title: pick(tier.incomes),
      amount: incomeCents,
      detail: "",
      createdAt: new Date(Date.now() - days * DAY_MS).toISOString(),
    },
  ];
  for (const cents of spends) {
    days -= randInt(3, 14);
    if (days < 1) days = 1;
    history.push({
      title: pick(tier.spends),
      amount: -cents,
      detail: "",
      createdAt: new Date(Date.now() - days * DAY_MS).toISOString(),
    });
  }
  return { balance, history };
}
