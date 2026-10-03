/**
 * 钱包账本（1.4.17 建，1.4.18 加银行卡，1.4.24 加收款码，1.4.36 加开户）。
 *
 * 一本账一个主人，分两种：
 * - **我的账**：一个面具一本（面具 id 当 ownerId）——你有几个面具，就有几本独立的账；
 * - **TA 的账**：一个角色一本（档案 id 当 ownerId）——往后红包／转账时，
 *   钱是真的从这本划到那本，不是嘴上说说。
 *
 * 我的账里又分两个口袋（1.4.18）：
 * - **零钱**（钱包余额）：日常花销、收发红包的那个口袋；
 * - **银行卡**：钱的源头。卡 ↔ 零钱可以互相转，卡里有多少钱由你设定。
 *   每张卡自己有一本流水（开卡、改钱、转账都留痕），零钱流水则记在钱包页的「收支明细」。
 *
 * **零钱的来路只有两条（1.4.44 恩熙定）**：① 银行卡转进来——钱包页那颗「充值」走的就是
 * `transferCardToBalance`；② 角色给的（红包／转账，见 `ChatWindow` 的 `claimMoney`）。
 * **没有第三条「凭空填个数就多一笔钱」的路**：原先钱包页那颗充值是把金额直接记进零钱，
 * 1.4.44 撤了。想给钱包里加钱，先去银行卡那边放钱（开卡／改卡内金额），再转进来。
 *
 * 收款码（1.4.24）：一个面具一张（`payCodes`），码上印的是那串收款编号。
 * 编号只认「现在这一张」——换了码，旧编号就作废。账本里只存编号本身，
 * 码图每次现画（见 `lib/settings/paycode.ts`），不占仓库。
 *
 * 金额一律以**分**存整数（5.20 元 ＝ 520），避免浮点误差；只在展示时才转成「元」。
 * 每条流水都记下发生后的余额（balanceAfter）——这样对账不必回头重算，
 * 将来就算改了规则，也不会把旧记录的账算歪。
 *
 * 账按需生成：第一次给谁加减钱，才给谁开这本账（起始 0），不为从没来往的人空建。
 * 唯一的例外是 TA 那本账（1.4.36 起）：第一次翻他的手机时按人设「开户」，
 * 补一份起手余额与历史流水，见 seedContactAccount。
 * 每次改动都串在一条队列上排队落库——转账要连着扣一本、加一本，
 * 两笔并发读同一份旧数据会互相覆盖（俗称丢账）。
 * 仅在客户端读写 IndexedDB。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";

const WALLET_KEY = "wallet";

/** 账的主人是谁：面具（我）／角色档案（TA）。 */
export type WalletOwnerKind = "mask" | "contact";

/** 这笔流水动的是哪个口袋：零钱（钱包余额）／某张银行卡。 */
export type WalletScope = "balance" | "card";

/** 卡面三色（跟参考项目对齐：曜黑／石墨／银灰）。 */
export type WalletCardStyle = "obsidian" | "graphite" | "silver";

export interface WalletAccount {
  ownerId: string;
  kind: WalletOwnerKind;
  /** 余额（分）。 */
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletCard {
  id: string;
  /** 这张卡属于谁（面具 id）——卡跟着面具走，跟钱包同一本账。 */
  ownerId: string;
  /** 卡名（「招商银行储蓄卡」）。 */
  title: string;
  /** 卡号后四位（展示用，不做校验）。 */
  tailNumber: string;
  cardStyle: WalletCardStyle;
  /** 自定义卡面图（图片仓库的引用串；空串＝用内置三档卡面）。1.4.49 加。 */
  cardImage: string;
  /** 卡内余额（分）。 */
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletEntry {
  id: string;
  ownerId: string;
  kind: WalletOwnerKind;
  /** 动的哪个口袋；老数据没有这一栏，按零钱算。 */
  scope: WalletScope;
  /** 银行卡流水才有：哪张卡。零钱流水是空串。 */
  cardId: string;
  /** 名目：「银行卡转入」「发红包给XX」…（流水第一行）。 */
  title: string;
  /** 变动（分）：正数进账、负数出账。 */
  amount: number;
  /** 这笔发生之后的余额（分）。 */
  balanceAfter: number;
  /** 补充说明（对方名字、留言之类）；空串表示没有。 */
  detail: string;
  createdAt: string;
}

export interface WalletState {
  accounts: WalletAccount[];
  cards: WalletCard[];
  entries: WalletEntry[];
  /** 收款码：一个面具一张。 */
  payCodes: WalletPayCode[];
  /** 支付密码：一个面具一份（1.4.51 加）。 */
  payPasswords: WalletPassword[];
  updatedAt: string;
}

/**
 * 支付密码（1.4.51 加，恩熙要「转账也得输密码」那一种）。
 * ⚠️ **这是本机的门闩，不是安全防线**——整本账本来就明文躺在 IndexedDB 里，
 * 存明文只是省事（也因此「清零」不会碰它：它是设置，不是钱）。
 */
export interface WalletPassword {
  ownerId: string;
  /** 6 位数字；空串＝没设（没设就不拦）。 */
  password: string;
  updatedAt: string;
}

/** 一个面具的收款码（只存编号；码图每次现画）。 */
export interface WalletPayCode {
  ownerId: string;
  /** 收款编号（印在码上、也印在码下面那行小字：「SEI-482139」）。 */
  code: string;
  createdAt: string;
}

const EMPTY_STATE: WalletState = {
  accounts: [],
  cards: [],
  entries: [],
  payCodes: [],
  payPasswords: [],
  updatedAt: "",
};

function normalizeStyle(raw: unknown): WalletCardStyle {
  return raw === "graphite" || raw === "silver" ? raw : "obsidian";
}

/** 补齐缺失栏位（旧资料／半截资料兼容）。 */
function normalizeState(raw: unknown): WalletState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const src = raw as Partial<WalletState>;
  const accounts = Array.isArray(src.accounts)
    ? src.accounts
        .filter((a) => a && typeof a.ownerId === "string")
        .map((a) => ({
          ownerId: a.ownerId,
          kind: a.kind === "contact" ? ("contact" as const) : ("mask" as const),
          balance: Number.isFinite(a.balance) ? Math.round(a.balance) : 0,
          createdAt: a.createdAt ?? new Date().toISOString(),
          updatedAt: a.updatedAt ?? new Date().toISOString(),
        }))
    : [];
  const cards = Array.isArray(src.cards)
    ? src.cards
        .filter((c) => c && typeof c.id === "string")
        .map((c) => ({
          id: c.id,
          ownerId: c.ownerId ?? "",
          title: c.title ?? "",
          tailNumber: c.tailNumber ?? "",
          cardStyle: normalizeStyle(c.cardStyle),
          cardImage: typeof c.cardImage === "string" ? c.cardImage : "",
          balance: Number.isFinite(c.balance) ? Math.round(c.balance) : 0,
          createdAt: c.createdAt ?? new Date().toISOString(),
          updatedAt: c.updatedAt ?? new Date().toISOString(),
        }))
    : [];
  const entries = Array.isArray(src.entries)
    ? src.entries
        .filter((e) => e && typeof e.id === "string")
        .map((e) => ({
          id: e.id,
          ownerId: e.ownerId ?? "",
          kind: e.kind === "contact" ? ("contact" as const) : ("mask" as const),
          scope: e.scope === "card" ? ("card" as const) : ("balance" as const),
          cardId: e.cardId ?? "",
          title: e.title ?? "",
          amount: Number.isFinite(e.amount) ? Math.round(e.amount) : 0,
          balanceAfter: Number.isFinite(e.balanceAfter) ? Math.round(e.balanceAfter) : 0,
          detail: e.detail ?? "",
          createdAt: e.createdAt ?? new Date().toISOString(),
        }))
    : [];
  const payCodes = Array.isArray(src.payCodes)
    ? src.payCodes
        .filter((p) => p && typeof p.ownerId === "string" && typeof p.code === "string")
        .map((p) => ({
          ownerId: p.ownerId,
          code: p.code,
          createdAt: p.createdAt ?? new Date().toISOString(),
        }))
    : [];
  const payPasswords = Array.isArray(src.payPasswords)
    ? src.payPasswords
        .filter((p) => p && typeof p.ownerId === "string" && typeof p.password === "string")
        .map((p) => ({
          ownerId: p.ownerId,
          password: p.password,
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        }))
    : [];
  return { accounts, cards, entries, payCodes, payPasswords, updatedAt: src.updatedAt ?? "" };
}

export async function loadWalletState(): Promise<WalletState> {
  return normalizeState(await kvGet<WalletState>(WALLET_KEY));
}

/* 落库队列：所有改动排成一列，后一笔一定读得到前一笔的结果。
   队列只保证顺序，不吞错误——某一笔挂了，后面的照跑，错的照抛给调用方。 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * 一次改动 ＝ 读一遍最新账 → 在内存里改（可多笔）→ 整体落库。
 * 转账这类「连着动两处」的操作必须整包进来做，中间才不会被别笔插队。
 */
function mutate<T>(job: (state: WalletState) => T): Promise<T> {
  const run = async () => {
    const state = await loadWalletState();
    const result = job(state);
    state.updatedAt = new Date().toISOString();
    await kvSet(WALLET_KEY, state);
    return result;
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 找一本账；没有再开（起始 0）。返回的是新状态里的那一本。 */
function ensureAccount(state: WalletState, ownerId: string, kind: WalletOwnerKind): WalletAccount {
  const found = state.accounts.find((a) => a.ownerId === ownerId && a.kind === kind);
  if (found) return found;
  const now = new Date().toISOString();
  const account: WalletAccount = { ownerId, kind, balance: 0, createdAt: now, updatedAt: now };
  state.accounts.push(account);
  return account;
}

/** 落一条流水（新的塞最前，读起来自然是新的在上）。 */
function pushEntry(
  state: WalletState,
  input: {
    ownerId: string;
    kind: WalletOwnerKind;
    scope: WalletScope;
    cardId?: string;
    title: string;
    amount: number;
    balanceAfter: number;
    detail?: string;
    /** 补记历史流水时指定发生时间；不传＝此刻（正常记账都走这个）。 */
    createdAt?: string;
  },
): WalletEntry {
  const entry: WalletEntry = {
    id: uuid(),
    ownerId: input.ownerId,
    kind: input.kind,
    scope: input.scope,
    cardId: input.cardId ?? "",
    title: input.title,
    amount: Math.round(input.amount),
    balanceAfter: Math.round(input.balanceAfter),
    detail: input.detail ?? "",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  state.entries.unshift(entry);
  return entry;
}

/** 读一本账的零钱余额（分）；还没有这本账就是 0。 */
export async function getBalance(ownerId: string, kind: WalletOwnerKind): Promise<number> {
  const state = await loadWalletState();
  return state.accounts.find((a) => a.ownerId === ownerId && a.kind === kind)?.balance ?? 0;
}

/**
 * 加减零钱，同时落一条流水。delta 正数进账、负数出账（单位：分）。
 *
 * **零钱不设下限**：本 App 是记账给故事用的，欠账也是账——
 * 手上不够却硬要发红包，那是用户自己的事，这里照记（流水会明明白白写着负数）；
 * 要不要拦，是红包界面上的决定，不该藏在账本里偷偷截断。
 * （但**卡↔零钱的转账会拦**——那是用户在操作自己的钱，不是故事，见 transfer* 两个函数。）
 */
export async function adjustBalance(
  ownerId: string,
  kind: WalletOwnerKind,
  delta: number,
  title: string,
  detail = "",
): Promise<{ balance: number; entry: WalletEntry }> {
  return mutate((state) => {
    const account = ensureAccount(state, ownerId, kind);
    account.balance += Math.round(delta);
    account.updatedAt = new Date().toISOString();
    const entry = pushEntry(state, {
      ownerId,
      kind,
      scope: "balance",
      title,
      amount: delta,
      balanceAfter: account.balance,
      detail,
    });
    return { balance: account.balance, entry };
  });
}

/**
 * 我发出去一笔红包／转账：**先只从我选的那个口袋扣掉**，TA 那本账这时一分不加（1.4.63）。
 *
 * 为什么不再一次记两笔（1.4.33 起用的 `sendToContact` 是一次落两本账）：恩熙 2026-09-23 定
 * ——他收到钱可以自己判断收下还是退还。钱得先**悬在中间**：我这边立刻出账（免得她看着
 * 余额没变、以为没发出去），他那本等他表态才动——他说收下才把钱加进他的零钱（见
 * ChatWindow 的 markContactReceived），他说退还就原路回我的口袋（见 takeBackToPocket）。
 * 这样「他退还／红包不领」才退得回来：钱压根还没给出去，不存在「已经花掉了」。
 *
 * `from` 是出钱的口袋：`"balance"`＝零钱（照旧不设下限，够不够由界面先判，
 * 见 adjustBalance 的注释），其余当卡的 id——那是她在动自己卡里的钱，卡不在／不够都
 * 整笔拦下（跟 transferCardToBalance 同一条口径），返回 { ok:false } 把原因交给界面说。
 */
export async function payOutToContact(input: {
  /** 出钱的那本（面具 id）。 */
  ownerId: string;
  /** 从哪个口袋出：`"balance"`＝零钱，否则是那张卡的 id。 */
  from: string;
  /** 金额（分），正数。 */
  cents: number;
  /** 流水名目（「发红包给XX」）。 */
  title: string;
  /** 补充说明（留言／备注）。 */
  detail?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return mutate((state) => {
    const amount = Math.round(input.cents);
    if (amount <= 0) return { ok: false, error: "金额要大于 0" };
    if (input.from === "balance") {
      const account = ensureAccount(state, input.ownerId, "mask");
      account.balance -= amount;
      account.updatedAt = new Date().toISOString();
      pushEntry(state, {
        ownerId: input.ownerId,
        kind: "mask",
        scope: "balance",
        title: input.title,
        amount: -amount,
        balanceAfter: account.balance,
        detail: input.detail ?? "",
      });
      return { ok: true };
    }
    const card = state.cards.find((c) => c.id === input.from);
    if (!card) return { ok: false, error: "没找到这张卡" };
    if (card.balance < amount) return { ok: false, error: "这张卡里的钱不够" };
    card.balance -= amount;
    card.updatedAt = new Date().toISOString();
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title: input.title,
      amount: -amount,
      balanceAfter: card.balance,
      detail: input.detail ?? "",
    });
    return { ok: true };
  });
}

/**
 * 我发出去、他不要的那笔钱**原路回到我出的那个口袋**（1.4.63）。
 *
 * 恩熙定的口径：他收到钱可以自己判断收下还是退还——所以说退还（红包说不领）就是
 * 把那一笔按原路收回来。`payOutToContact` 当时只从我这儿扣了、钱还没进他的账，
 * 所以这里**只管加回我这边**，他那本账一分不用动（他压根没收到过）。
 *
 * `from` 就是那条消息上的 `payFrom`：`"balance"`＝回零钱，其余是那张卡的 id——
 * 哪来的回哪去（零钱回零钱、那张卡回那张卡）。卡在这期间被销掉了就如实返回
 * `{ ok:false }`，让界面照实说一声，别悄悄把钱塞进零钱、账对不上。
 */
export async function takeBackToPocket(input: {
  /** 收钱的那本（面具 id）。 */
  ownerId: string;
  /** 回哪个口袋：`"balance"`＝零钱，否则是那张卡的 id。 */
  from: string;
  /** 金额（分），正数。 */
  cents: number;
  /** 流水名目（「收回给XX的转账」）。 */
  title: string;
  /** 补充说明（那份留言／备注）。 */
  detail?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return mutate((state) => {
    const amount = Math.round(input.cents);
    if (amount <= 0) return { ok: false, error: "金额要大于 0" };
    if (input.from === "balance") {
      const account = ensureAccount(state, input.ownerId, "mask");
      account.balance += amount;
      account.updatedAt = new Date().toISOString();
      pushEntry(state, {
        ownerId: input.ownerId,
        kind: "mask",
        scope: "balance",
        title: input.title,
        amount,
        balanceAfter: account.balance,
        detail: input.detail ?? "",
      });
      return { ok: true };
    }
    const card = state.cards.find((c) => c.id === input.from);
    if (!card) return { ok: false, error: "这张卡已经销了" };
    card.balance += amount;
    card.updatedAt = new Date().toISOString();
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title: input.title,
      amount,
      balanceAfter: card.balance,
      detail: input.detail ?? "",
    });
    return { ok: true };
  });
}

/** 零钱流水（新的在前）；「收支明细」用这个，不含银行卡的流水。 */
export async function listEntries(
  ownerId: string,
  kind: WalletOwnerKind,
): Promise<WalletEntry[]> {
  const state = await loadWalletState();
  return state.entries.filter(
    (e) => e.ownerId === ownerId && e.kind === kind && e.scope === "balance",
  );
}

/* ── 流水的门类（1.4.67） ── */

/**
 * 这笔钱算什么。恩熙 2026-09-23 要「收支记录能区分收入跟支出，还要有个简单的分类，
 * 像微信一样：转账一类、娱乐消费一类」——以后做出游、外卖，那些账也得有自己的门类。
 *
 * **归类是读的时候算的，账本里不存这一栏**：流水上的名目（title）本来就是事实，
 * 门类只是给名目归堆。存一份反而会跟名目对不上（以后改个文案，旧账的门类就飘了）。
 * 眼下名目全是我们自己写死的几句（「发红包给XX」「收回给XX的转账」「银行卡转入」…），
 * 照关键词归堆就够；等出游、外卖真的接进来，它们各自带一句自己的名目即可。
 *
 * 「其他」兜住没认出来的（比如 TA 开户时补的那些历史名目）。
 */
export type WalletEntryCategory = "transfer" | "redpacket" | "topup" | "withdraw" | "other";

/** 门类的中文名（页面上那一行大字）。 */
export const WALLET_CATEGORY_CN: Record<WalletEntryCategory, string> = {
  transfer: "转账",
  redpacket: "红包",
  topup: "充值",
  withdraw: "提现",
  other: "其他",
};

/** 门类的英文小字（跟中文配对，账册上的洋文落款）。 */
export const WALLET_CATEGORY_EN: Record<WalletEntryCategory, string> = {
  transfer: "transfer",
  redpacket: "lucky money",
  topup: "top up",
  withdraw: "withdraw",
  other: "misc",
};

/** 照名目给一条流水归堆。 */
export function entryCategory(entry: WalletEntry): WalletEntryCategory {
  const title = entry.title;
  /* 顺序有讲究：「收回给XX的转账」这类也含「转账」，先判大的那两类，不冲突。 */
  if (title.includes("红包")) return "redpacket";
  if (title.includes("转账")) return "transfer";
  if (title.includes("提现")) return "withdraw";
  if (title.includes("转入") || title.includes("开通银行卡")) return "topup";
  return "other";
}

/* ── TA 那本账的开户（1.4.36） ── */

/** 一条要补记的历史流水（金额：分，正数进账／负数出账）。 */
export interface ContactSeedEntry {
  title: string;
  amount: number;
  detail?: string;
  /** 发生时间（ISO）。历史流水必须给——账要按真实时间排队。 */
  createdAt: string;
}

/** 这本账还是不是白纸：没有这本账、或一条 contact 流水都没有。 */
export async function isContactAccountBlank(ownerId: string): Promise<boolean> {
  const state = await loadWalletState();
  return !state.entries.some((e) => e.ownerId === ownerId && e.kind === "contact");
}

/**
 * 给 TA 那本账「开户」（1.4.36）：第一次翻到他的手机时，把这本账填成有来历的样子
 * ——一份起手余额 ＋ 过去两三个月的流水，而不是从零开始的空账。
 *
 * **只在白纸上写**：这本账一条 contact 流水都没有时才动手。已经开过的账一个字都不改
 * （哪怕调用方递了新数据）——恩熙定的规矩是第一遍生成、之后每次翻只往后长，
 * 旧流水一条不动；顺带也挡住了重复开户。
 *
 * 传进来的流水按事情发生的先后给。**余额一律以流水合计为准**，`balance` 只在
 * 一笔流水都没有时兜底用：模型算不平合计与余额是常态，替它取合计就行；
 * **绝不能拿某一笔找平**——差额砸进最后一笔会把「收入」名目的流水改成出账，
 * 翻账的人一眼看出这本账是编的（曾经就这么砸出过一笔「兼职收入」扣费）。
 */
export async function seedContactAccount(input: {
  ownerId: string;
  /** 起手余额（分）；只在流水一条都没有时整笔使用。 */
  balance: number;
  /** 历史流水（早 → 晚）。 */
  history: ContactSeedEntry[];
}): Promise<{ opened: boolean; balance: number }> {
  return mutate((state) => {
    const painted = state.entries.some(
      (e) => e.ownerId === input.ownerId && e.kind === "contact",
    );
    const account = ensureAccount(state, input.ownerId, "contact");
    if (painted) return { opened: false, balance: account.balance };

    const rows = [...input.history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let running = 0;
    const written = rows.map((r) => {
      running += Math.round(r.amount);
      return { ...r, balanceAfter: running };
    });
    if (written.length === 0) {
      /* 一份流水都没有（不该发生）：至少留一条，别让余额悬空。 */
      running = input.balance;
      written.push({
        title: "余额",
        amount: input.balance,
        detail: "",
        createdAt: new Date().toISOString(),
        balanceAfter: input.balance,
      });
    }
    for (const r of written) {
      pushEntry(state, {
        ownerId: input.ownerId,
        kind: "contact",
        scope: "balance",
        title: r.title,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        detail: r.detail ?? "",
        createdAt: r.createdAt,
      });
    }
    account.balance = running;
    account.updatedAt = new Date().toISOString();
    return { opened: true, balance: account.balance };
  });
}

/**
 * 把 TA 那本账整个抹掉（1.4.37）：余额与流水一并清空，回白纸。
 *
 * 用在恩熙「重置记忆」那儿——记忆一重置，这段关系就算从头再来，他那本账也得
 * 跟着回白纸，下次翻他的手机再按人设重新开户（见 `seedContactAccount`）。
 * 只认 `kind === "contact"`：**我的零钱与银行卡一分不动**——那本账是我的，
 * 记着我和所有角色的来往，不该因为清掉某一个角色的记忆而连坐。
 * （TA 的账是一个角色一本、不分面具：几个面具共用同一本，清的就是这个角色。）
 */
export async function clearContactAccount(ownerId: string): Promise<void> {
  return mutate((state) => {
    state.accounts = state.accounts.filter(
      (a) => !(a.ownerId === ownerId && a.kind === "contact"),
    );
    state.entries = state.entries.filter(
      (e) => !(e.ownerId === ownerId && e.kind === "contact"),
    );
  });
}

/* ── 我的钱包清空（1.4.44 建，1.4.45 改成整个清空） ── */

/**
 * 把这个面具的**钱包整个清空**（1.4.45 恩熙定：就是清除所有钱包数据）：
 * 零钱归 0、零钱流水清光、名下银行卡连卡里的钱与卡内记录一起删。
 *
 * **收款码不动**：那是「我的码」不是一笔账，清掉会让她发出去的码无声失效；
 * 想换码有专门的 `regeneratePayCode`。**TA 那些账也不动**：清的是我的钱包，
 * TA 的账是单独一本，碰不到（他那边的余额读账户栏，不靠推流水）。
 *
 * 余额与流水必须一起清：流水每行都写着「这笔之后余额」，只清一样会留个说不通的账。
 * 返回清掉的零钱金额（分）；钱包本来就空的就一个字节都不写。
 */
export async function clearMaskWallet(ownerId: string): Promise<number> {
  return mutate((state) => {
    const account = ensureAccount(state, ownerId, "mask");
    const before = account.balance;
    const hasEntries = state.entries.some((e) => e.ownerId === ownerId && e.kind === "mask");
    const hasCards = state.cards.some((c) => c.ownerId === ownerId);
    if (before === 0 && !hasEntries && !hasCards) return 0;
    account.balance = 0;
    account.updatedAt = new Date().toISOString();
    /* 卡片流水也是 kind "mask"，一并进这个筛子 */
    state.entries = state.entries.filter((e) => !(e.ownerId === ownerId && e.kind === "mask"));
    state.cards = state.cards.filter((c) => c.ownerId !== ownerId);
    return before;
  });
}

/* ── 银行卡 ── */

export interface WalletCardInput {
  title: string;
  tailNumber: string;
  cardStyle: WalletCardStyle;
  /** 自定义卡面图（引用串）；不填＝空串，走内置卡面。 */
  cardImage?: string;
  /** 卡内初始金额（分）。 */
  balance: number;
}

/** 某个面具名下的卡（新的在前）。 */
export async function listCards(ownerId: string): Promise<WalletCard[]> {
  const state = await loadWalletState();
  return state.cards.filter((c) => c.ownerId === ownerId);
}

/** 开一张卡，并留一条「开通银行卡」的流水（卡里一开始就有钱也记进去）。 */
export async function addCard(ownerId: string, input: WalletCardInput): Promise<WalletCard> {
  return mutate((state) => {
    const now = new Date().toISOString();
    const card: WalletCard = {
      id: uuid(),
      ownerId,
      title: input.title.trim() || "储蓄卡",
      tailNumber: input.tailNumber,
      cardStyle: input.cardStyle,
      cardImage: input.cardImage ?? "",
      balance: Math.round(input.balance),
      createdAt: now,
      updatedAt: now,
    };
    state.cards.unshift(card);
    pushEntry(state, {
      ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title: "开通银行卡",
      amount: card.balance,
      balanceAfter: card.balance,
      detail: card.title,
    });
    return card;
  });
}

/** 改卡面信息（卡名／尾号／卡面／卡面图）——动的是名字，不是钱，所以不记流水。 */
export async function updateCardInfo(
  cardId: string,
  patch: Partial<Pick<WalletCard, "title" | "tailNumber" | "cardStyle" | "cardImage">>,
): Promise<void> {
  await mutate((state) => {
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (patch.title !== undefined) card.title = patch.title.trim() || "储蓄卡";
    if (patch.tailNumber !== undefined) card.tailNumber = patch.tailNumber;
    if (patch.cardStyle !== undefined) card.cardStyle = normalizeStyle(patch.cardStyle);
    if (patch.cardImage !== undefined) card.cardImage = patch.cardImage;
    card.updatedAt = new Date().toISOString();
  });
}

/** 直接改卡里的钱（用户在设定这张卡有多少），留一条流水。 */
export async function adjustCardBalance(
  cardId: string,
  delta: number,
  title: string,
  detail = "",
): Promise<void> {
  await mutate((state) => {
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return;
    card.balance += Math.round(delta);
    card.updatedAt = new Date().toISOString();
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title,
      amount: delta,
      balanceAfter: card.balance,
      detail,
    });
  });
}

/** 销卡：卡和它自己的流水一起删（钱包页的零钱流水不受影响）。 */
export async function deleteCard(cardId: string): Promise<void> {
  await mutate((state) => {
    state.cards = state.cards.filter((c) => c.id !== cardId);
    state.entries = state.entries.filter((e) => e.cardId !== cardId);
  });
}

/** 某张卡的流水（新的在前）。 */
export async function listCardEntries(cardId: string): Promise<WalletEntry[]> {
  const state = await loadWalletState();
  return state.entries.filter((e) => e.cardId === cardId);
}

/**
 * 银行卡 → 零钱（钱从卡里搬进钱包）。
 * 卡里不够就拦下来——这是用户自己搬钱，不是故事，不该记出负数。
 */
export async function transferCardToBalance(
  cardId: string,
  cents: number,
): Promise<{ ok: boolean; error?: string }> {
  return mutate((state) => {
    const amount = Math.round(cents);
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: "没找到这张卡" };
    if (amount <= 0) return { ok: false, error: "金额要大于 0" };
    if (card.balance < amount) return { ok: false, error: "这张卡里的钱不够" };
    const account = ensureAccount(state, card.ownerId, "mask");
    card.balance -= amount;
    card.updatedAt = new Date().toISOString();
    account.balance += amount;
    account.updatedAt = card.updatedAt;
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title: "转入钱包",
      amount: -amount,
      balanceAfter: card.balance,
      detail: card.title,
    });
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "balance",
      title: "银行卡转入",
      amount,
      balanceAfter: account.balance,
      detail: card.title,
    });
    return { ok: true };
  });
}

/** 零钱 → 银行卡（提现）。钱包零钱不够就拦下来。 */
export async function transferBalanceToCard(
  cardId: string,
  cents: number,
): Promise<{ ok: boolean; error?: string }> {
  return mutate((state) => {
    const amount = Math.round(cents);
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: "没找到这张卡" };
    if (amount <= 0) return { ok: false, error: "金额要大于 0" };
    const account = ensureAccount(state, card.ownerId, "mask");
    if (account.balance < amount) return { ok: false, error: "钱包里的钱不够" };
    account.balance -= amount;
    account.updatedAt = new Date().toISOString();
    card.balance += amount;
    card.updatedAt = account.updatedAt;
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "balance",
      title: "提现到银行卡",
      amount: -amount,
      balanceAfter: account.balance,
      detail: card.title,
    });
    pushEntry(state, {
      ownerId: card.ownerId,
      kind: "mask",
      scope: "card",
      cardId: card.id,
      title: "提现到账",
      amount,
      balanceAfter: card.balance,
      detail: card.title,
    });
    return { ok: true };
  });
}

/* ── 收款码 ── */

/** 收款编号长这样：SEI-482139（六位数字，像账号又不是账号）。 */
function randomPayCode(): string {
  return `SEI-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;
}

/** 写一张新码（第一次生成与「换个码」是同一件事：把这一本账的编号换掉）。 */
function writeNewPayCode(ownerId: string): Promise<string> {
  return mutate((state) => {
    const code = randomPayCode();
    const now = new Date().toISOString();
    const idx = state.payCodes.findIndex((p) => p.ownerId === ownerId);
    if (idx >= 0) state.payCodes[idx] = { ownerId, code, createdAt: now };
    else state.payCodes.push({ ownerId, code, createdAt: now });
    return code;
  });
}

/** 读这个面具的收款编号；还没有就当场发一个（第一次用到才生成，不为没用过的人空建）。 */
export async function getPayCode(ownerId: string): Promise<string> {
  const found = (await loadWalletState()).payCodes.find((p) => p.ownerId === ownerId);
  return found ? found.code : writeNewPayCode(ownerId);
}

/** 换个码：编号一变，以前发出去的那张就作废了（扫旧码认不出来）。 */
export async function regeneratePayCode(ownerId: string): Promise<string> {
  return writeNewPayCode(ownerId);
}

/** 读这个面具的支付密码；没设过就回空串（空串＝不拦，转账照发）。 */
export async function getPayPassword(ownerId: string): Promise<string> {
  const found = (await loadWalletState()).payPasswords.find((p) => p.ownerId === ownerId);
  return found ? found.password : "";
}

/** 设／改／清支付密码（传空串＝清掉）。传进来的必须是 6 位数字，别的当场拦下。 */
export async function setPayPassword(ownerId: string, password: string): Promise<void> {
  if (password && !/^\d{6}$/.test(password)) throw new Error("支付密码要 6 位数字");
  await mutate((state) => {
    const at = state.payPasswords.findIndex((p) => p.ownerId === ownerId);
    if (!password) {
      if (at >= 0) state.payPasswords.splice(at, 1);
      return;
    }
    const now = new Date().toISOString();
    if (at >= 0) {
      state.payPasswords[at].password = password;
      state.payPasswords[at].updatedAt = now;
    } else {
      state.payPasswords.push({ ownerId, password, updatedAt: now });
    }
  });
}

/* ── 红包的天花板（1.4.62 恩熙定） ── */

/** 一个红包最多装多少（分）＝ 1000 元。恩熙：「红包是个金额上限，因为要跟转账做区别……
 *  或者是我们就设个 1000 门槛，就是超过 1000 你只能转账。」
 *  ⇒ 红包装的是「心意」那个量级，再往上不是心意、是钱，那种就该走转账。
 *  这一条就是红包与转账的分界，**填钱那一页与真划钱那半都问它**，别只拦一头。 */
export const RED_PACKET_MAX_CENTS = 1000 * 100;

/** 分 → 展示用的「元」（两位小数，千分位不加逗号，一眼读得顺）。 */
export function formatYuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** 用户输入的一段「元」文本 → 分；读不成数字就回 null（空串也回 null）。 */
export function parseYuan(text: string): number | null {
  const cents = parseYuanOrZero(text);
  return cents === null || cents <= 0 ? null : cents;
}

/** 跟 parseYuan 一样，但**允许 0**（卡里可以是空的）；空串当 0。 */
export function parseYuanOrZero(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/** 随机尾号（开卡时懒得想四位数字时用）。 */
export function randomTailNumber(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}
