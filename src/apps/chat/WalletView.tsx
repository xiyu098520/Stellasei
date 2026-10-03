"use client";

/**
 * 星绥通讯：我的钱包（侧边栏「我的钱包」进入，1.4.17 建；1.4.18 加银行卡；1.4.24 加收款码）。
 *
 * 【这一版做什么】一个面具一本账，里面两个口袋：
 * - **银行卡**（1.4.18）：钱的源头。能加卡、改卡、销卡，卡里的钱自己设定；
 *   卡 ↔ 零钱可以互相转（不够就拦下）；每张卡自己有一本记录，都留痕。
 * - **零钱**：顶部余额卡（大数字 ＋ 充值 ＋ 清零），下面一列收支流水。
 *   1.4.67 起这一页**只摆最近几笔**，全本另开一整页「收支记录」（`WalletLedgerView`：
 *   按今天／昨天／本周／本月／今年／全部筛，分收支、分门类，带一条门类占比的图）。
 *   **充值只能从银行卡来**（1.4.44）：点开先选一张卡、填数，钱从那张卡划进零钱；
 *   卡里不够、或一张卡都还没有，就充不进来——**没有「凭空填个数就多一笔钱」这条路**。
 *   零钱的另一个来路是角色给的红包／转账（聊天里「收下」那一路），那是故事的账，不算充值。
 *   **清零**（1.4.44，1.4.45 改成清整本）：一按**整个钱包清空**——零钱归 0、收支明细
 *   清光、名下银行卡连卡里的钱与卡内记录一起删（恩熙要的是清除所有钱包数据）。
 *   收款码留着不动（那不是账，想换有「换个码」）；TA 的账是另外一本，清这边碰不到他。
 *   清零要再点一下确认——它不是能随手按的键，清掉回不来。
 * 【收款码】（1.4.24）：余额卡下面那一行，点开是我这个面具的收款码（面板见 `PayCodeSheet`），
 * 能存图、能换个码；聊天加号里也能把它当图片发给角色看。
 * 【钱包设置】（1.4.52 加、1.4.53 改成整页）：页头右上角一颗「设置」，点进去**换一整页**
 * （`WalletSettingsView`，跟这一页平级，页头一个长相）。恩熙说不要弹窗——以后要塞
 * 「亲属卡管理」「支付顺序」那些，弹窗不够用。**这一页上不再单列密码那一行**；
 * 密码的设／改都在设置页里，那个面板见 `PayPasswordSheet`。
 * 【账本是谁的】`ownerId` 传的是**当前使用中面具**的 id：换面具＝换钱包，
 * 名下的银行卡也跟着那本账走。TA 那边每个角色也各有一本账（数据层早备好），
 * 界面在 1.4.34 接上了——见 `ContactWalletView`（查手机 App → 他的星绥通讯 → 钱包），
 * 那一页只有零钱与收支明细：银行卡、收款码、充值、清零都是「我的钱」才有的东西。
 * 【皮】1.4.48 起改成「账册」：页面底仍是聊天家族的透粉白（从侧边栏进来
 * 不突兀），但纸块改方角、左缘压一道粉编目条、标题用书写体、账目数字等宽、
 * 主按钮是墨色方签——像一本只给自己看的册子，不是记账 App 的通用界面。
 * 公用料（书写体／等宽／硬影／粉条）都在 `WalletSheet` 里导出，调一处全族跟着变。
 * 样式还会反复改，结构先立着。
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, QrCode, Settings } from "lucide-react";
import {
  clearMaskWallet,
  deleteCard,
  formatYuan,
  getBalance,
  listCardEntries,
  listCards,
  listEntries,
  parseYuan,
  transferBalanceToCard,
  transferCardToBalance,
  type WalletCard,
  type WalletEntry,
} from "@/lib/settings/wallet";
import WalletCardEditor from "./WalletCardEditor";
import WalletCardFace from "./WalletCardFace";
import PayCodeSheet from "./PayCodeSheet";
/* 收支记录（1.4.67）：钱包页只摆最近几笔，全本（能按区间／收支／门类筛）在这一整页里。 */
import WalletLedgerView from "./WalletLedgerView";
/* 钱包设置（1.4.53）：点右上角那颗「设置」换到一整页去，那边里头的键盘还是
   `PayPasswordSheet`（它自己引），这一页不再直接摆密码面板了。 */
import WalletSettingsView from "./WalletSettingsView";
import WalletSheet, {
  WALLET_AMOUNT_INPUT,
  WALLET_MONO,
  WALLET_PAPER_BAR,
  WALLET_PAPER_SHADOW,
  WALLET_PRIMARY_BTN,
  WALLET_ROW,
  WALLET_ROW_ICON,
  WALLET_TITLE,
} from "./WalletSheet";
import { EN, SANS, T, momentTime } from "./shared";

/** 充值面板上的快捷金额（元）。 */
const QUICK_AMOUNTS = ["10", "50", "100", "200"];

/** 钱包页的收支明细只摆最近这几笔（1.4.67）——再多就看不清了，全本去「收支记录」那一页。 */
const RECENT_LIMIT = 5;

export default function WalletView({
  ownerId,
  ownerName,
  ownerAvatar,
  onBack,
  showToast,
}: {
  /** 账本主人：当前使用中面具的 id。 */
  ownerId: string;
  /** 账本主人的名字（余额卡上那句「谁的钱包」）。 */
  ownerName: string;
  /** 账本主人的头像（收款码面板上那颗）；空串＝还没设过，用渐变底兜底。 */
  ownerAvatar?: string;
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [cards, setCards] = useState<WalletCard[]>([]);
  /** 每次改动后 +1，把「读账」的两处 effect 重新跑一遍——不靠手动回读，免得漏刷新。 */
  const [tick, setTick] = useState(0);

  const [topUpOpen, setTopUpOpen] = useState(false);
  /** 充值从哪张卡出钱（面板里选中的那张）。 */
  const [topUpCardId, setTopUpCardId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  /** 「一键清零」的确认面板。 */
  const [clearOpen, setClearOpen] = useState(false);

  /** 开着详情的卡（点卡面进来的那张）。 */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 那张卡自己的记录。 */
  const [cardEntries, setCardEntries] = useState<WalletEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 卡 ↔ 零钱的搬运面板（in＝转入钱包，out＝提现到卡）。 */
  const [move, setMove] = useState<{ cardId: string; dir: "in" | "out" } | null>(null);
  const [moveText, setMoveText] = useState("");
  /** 新增／编辑卡的面板；card 为 null 就是新增。 */
  const [editor, setEditor] = useState<{ card: WalletCard | null } | null>(null);
  /** 收款码面板（我的码那张）。 */
  const [payOpen, setPayOpen] = useState(false);
  /** 钱包设置是不是开着（1.4.53 起：开着就整页换成 `WalletSettingsView`）。 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 收支记录是不是开着（1.4.67 起：开着就整页换成 `WalletLedgerView`）。 */
  const [ledgerOpen, setLedgerOpen] = useState(false);

  /** 读一遍账（只读，不碰 state）：流水新的在前；余额直接读账户那一栏。
   *  1.4.45 起**不能**拿「最新一条流水的余额」当余额了——清零会把明细清空，那时它就没影了。 */
  const readWallet = useCallback(async () => {
    const [list, cardList, balance] = await Promise.all([
      listEntries(ownerId, "mask"),
      listCards(ownerId),
      getBalance(ownerId, "mask"),
    ]);
    return { list, cardList, balance };
  }, [ownerId]);

  useEffect(() => {
    let alive = true;
    void readWallet().then((snap) => {
      if (!alive) return;
      setEntries(snap.list);
      setCards(snap.cardList);
      setBalance(snap.balance);
    });
    return () => {
      alive = false;
    };
  }, [readWallet, tick]);

  // 详情开着的时候，顺带读那张卡自己的记录（改钱、转账都会记在里面）
  useEffect(() => {
    if (!detailId) return;
    let alive = true;
    void listCardEntries(detailId).then((list) => {
      if (!alive) return;
      setCardEntries(list);
    });
    return () => {
      alive = false;
    };
  }, [detailId, tick]);

  /** 点「充值」：一张卡都没有就先别开面板——开了也没钱可充，白让她填一遍数。 */
  const openTopUp = () => {
    if (cards.length === 0) {
      showToast("还没有银行卡，先去下面添加一张");
      return;
    }
    setTopUpCardId(cards[0].id);
    setAmountText("");
    setTopUpOpen(true);
  };

  /** 充值＝从银行卡转进零钱（1.4.44）。钱只能从卡里来，不能凭空填个数就多一笔。 */
  const topUp = async () => {
    const cents = parseYuan(amountText);
    if (cents === null) {
      showToast("请填一个正数金额（最多两位小数）");
      return;
    }
    const card = cards.find((c) => c.id === topUpCardId) ?? cards[0] ?? null;
    if (!card) {
      showToast("还没有银行卡，先去添加一张");
      return;
    }
    setBusy(true);
    try {
      const res = await transferCardToBalance(card.id, cents);
      if (!res.ok) {
        showToast(res.error ?? "没充成，再试一次");
        return;
      }
      setAmountText("");
      setTopUpOpen(false);
      setTick((t) => t + 1);
      showToast(`已从「${card.title}」转入 ¥${formatYuan(cents)}`);
    } finally {
      setBusy(false);
    }
  };

  /** 一键清零＝把整个钱包清空：零钱、收支明细、银行卡连卡里的钱与卡内记录一起清。 */
  const doClear = async () => {
    const hadAnything = (balance ?? 0) !== 0 || entries.length > 0 || cards.length > 0;
    setBusy(true);
    try {
      const cleared = await clearMaskWallet(ownerId);
      setDetailId(null);
      setClearOpen(false);
      setTick((t) => t + 1);
      showToast(
        hadAnything
          ? cleared > 0
            ? `钱包已清空（零钱 ¥${formatYuan(cleared)} 一并清了；TA 那边照旧）`
            : "钱包已清空（TA 那边照旧）"
          : "钱包本来就是空的",
      );
    } finally {
      setBusy(false);
    }
  };

  const detailCard = detailId ? cards.find((c) => c.id === detailId) ?? null : null;
  const moveCard = move ? cards.find((c) => c.id === move.cardId) ?? null : null;

  /** 卡 ↔ 零钱：钱在卡里和钱包之间搬。 */
  const doMove = async () => {
    if (!move) return;
    const cents = parseYuan(moveText);
    if (cents === null) {
      showToast("请填一个正数金额（最多两位小数）");
      return;
    }
    setBusy(true);
    try {
      const res =
        move.dir === "in"
          ? await transferCardToBalance(move.cardId, cents)
          : await transferBalanceToCard(move.cardId, cents);
      if (!res.ok) {
        showToast(res.error ?? "没转成，再试一次");
        return;
      }
      setMoveText("");
      setMove(null);
      setTick((t) => t + 1);
      showToast(
        move.dir === "in" ? `已转入钱包 ¥${formatYuan(cents)}` : `已提现到卡 ¥${formatYuan(cents)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!detailCard) return;
    setBusy(true);
    try {
      await deleteCard(detailCard.id);
      setConfirmDelete(false);
      setDetailId(null);
      setTick((t) => t + 1);
      showToast("这张卡销掉了");
    } finally {
      setBusy(false);
    }
  };

  const yuan = formatYuan(balance ?? 0);
  const [intPart, fracPart] = yuan.split(".");
  /** 名下卡里的钱一共多少（清零面板要摊给她看，清的是这些）。 */
  const cardTotal = cards.reduce((sum, c) => sum + c.balance, 0);

  /* 1.4.53：设置不再用弹窗——点进去**整页换掉**（页面还在这儿等着，回来还是这一页）。
     返回键回到钱包本页；设置页里没有需要同步回来的账（密码那边自己不显示在这页上）。 */
  if (settingsOpen) {
    return (
      <WalletSettingsView
        ownerId={ownerId}
        onBack={() => setSettingsOpen(false)}
        showToast={showToast}
      />
    );
  }

  /* 1.4.67：收支记录也是整页（跟设置一个走法）。那一页只看不写，回来不用回读账本；
     真要回读也不怕——它每次挂上去都重新读一遍。 */
  if (ledgerOpen) {
    return <WalletLedgerView ownerId={ownerId} onBack={() => setLedgerOpen(false)} />;
  }

  return (
    <div style={rootStyle}>
      {/* ── 页头：近黑圆返回钮 ＋ 书写体标题（底下压一道粉横）＋ 右上角「设置」 ── */}
      <div style={headerStyle}>
        <button type="button" aria-label="返回" onClick={onBack} style={backBtnStyle}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontFamily: WALLET_TITLE, fontSize: 20, fontWeight: 500 }}>
            我的钱包
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 30, height: 2, background: T.pink }} />
            <span style={{ fontFamily: EN, fontSize: 9.5, color: T.ink3, letterSpacing: ".3em" }}>
              wallet
            </span>
          </span>
        </div>
        {/* 1.4.52：跟钱有关的开关都收进这里（眼下里头是支付密码） */}
        <button
          type="button"
          className="pressable"
          onClick={() => setSettingsOpen(true)}
          style={settingsBtnStyle}
        >
          <Settings size={14} strokeWidth={2} />
          设置
        </button>
      </div>

      <div style={scrollStyle}>
        {/* ── 余额卡 ── */}
        <div style={balanceCardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: T.ink3, letterSpacing: ".18em" }}>余额</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* 清零走灰描边：它不是页面上最想让人按的那颗，「充值」才是 */}
              <button type="button" onClick={() => setClearOpen(true)} style={clearBtnStyle}>
                清零
              </button>
              <button type="button" onClick={openTopUp} style={topUpBtnStyle}>
                <Plus size={13} strokeWidth={2.4} />
                充值
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 10 }}>
            <span style={{ fontSize: 17, color: T.ink2, fontWeight: 500 }}>¥</span>
            {/* 大数字是整个钱包页唯一的「最大」：整数大、小数收一档，仍是一眼看懂 */}
            <span
              style={{
                fontFamily: WALLET_MONO,
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "-.01em",
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {intPart}
            </span>
            <span style={{ fontFamily: WALLET_MONO, fontSize: 22, fontWeight: 700, color: T.ink2 }}>
              .{fracPart}
            </span>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>
            {ownerName} 的钱包
          </div>
        </div>

        {/* ── 收款码：一行入口，点开是我这张码（存图／换个码都在面板里）── */}
        <button
          type="button"
          className="pressable"
          onClick={() => setPayOpen(true)}
          style={{ ...WALLET_ROW, marginTop: 12 }}
        >
          <span style={WALLET_ROW_ICON}>
            <QrCode size={18} strokeWidth={2} />
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>我的收款码</span>
            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 10.5,
                color: T.ink3,
                letterSpacing: ".04em",
              }}
            >
              谁要给我钱，让他扫这张码
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={2} color={T.ink3} />
        </button>

        {/* ── 银行卡：钱从这儿来 ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>银行卡</span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            cards
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setEditor({ card: null })}
            style={addCardBtnStyle}
          >
            <Plus size={13} strokeWidth={2.4} />
            添加
          </button>
        </div>

        {cards.length === 0 ? (
          <div style={emptyHintStyle}>还没有银行卡，点右上「添加」开一张</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                className="pressable"
                onClick={() => {
                  setCardEntries([]);
                  setConfirmDelete(false);
                  setDetailId(c.id);
                }}
                style={cardBtnStyle}
              >
                <WalletCardFace card={c} />
              </button>
            ))}
          </div>
        )}

        {/* ── 收支明细：这一页只摆最近几笔（1.4.67 起），全本在「收支记录」那一整页里 ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>收支明细</span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            transactions
          </span>
          <span style={{ flex: 1 }} />
          {/* 跟银行卡段头那颗「添加」同一块料（白底粉字方签），只是这边写着「收支记录」 */}
          <button type="button" onClick={() => setLedgerOpen(true)} style={addCardBtnStyle}>
            收支记录
            <ChevronRight size={13} strokeWidth={2.4} />
          </button>
        </div>

        {entries.length === 0 ? (
          <div style={emptyHintStyle}>还没有收支记录</div>
        ) : (
          <div>
            {entries.slice(0, RECENT_LIMIT).map((e) => (
              <WalletEntryRow key={e.id} entry={e} />
            ))}
            {entries.length > RECENT_LIMIT ? (
              <button type="button" onClick={() => setLedgerOpen(true)} style={moreRowStyle}>
                还有 {entries.length - RECENT_LIMIT} 笔，去收支记录里看
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 充值面板：钱从卡里来（1.4.44 起不是凭空记账了） ── */}
      {topUpOpen ? (
        <WalletSheet
          title="充值"
          hint="从银行卡转进零钱，卡里不够就转不动"
          onClose={() => setTopUpOpen(false)}
        >
          <div style={{ fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>从哪张卡出钱</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setTopUpCardId(c.id)}
                style={cardPickStyle(topUpCardId === c.id)}
              >
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>
                    {c.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      fontSize: 10.5,
                      color: T.ink3,
                      letterSpacing: ".04em",
                    }}
                  >
                    尾号 {c.tailNumber} · 卡里 ¥{formatYuan(c.balance)}
                  </span>
                </span>
                {topUpCardId === c.id ? <Check size={16} strokeWidth={2.6} color={T.pink} /> : null}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 16 }}>
            <span style={{ fontSize: 18, color: T.ink2, fontWeight: 600 }}>¥</span>
            <input
              value={amountText}
              onChange={(ev) => setAmountText(ev.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              style={WALLET_AMOUNT_INPUT}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmountText(a)}
                style={quickChipStyle(amountText === a)}
              >
                {a}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void topUp()}
            style={{ ...WALLET_PRIMARY_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
          >
            确认充值
          </button>
        </WalletSheet>
      ) : null}

      {/* ── 一键清零：整本钱包都清，回不来，所以先摊开说清后果，再点一次 ── */}
      {clearOpen ? (
        <WalletSheet
          title="一键清零"
          hint="零钱、明细、银行卡全部清掉"
          onClose={() => setClearOpen(false)}
        >
          <div style={{ fontSize: 12.5, color: T.ink2, letterSpacing: ".04em", lineHeight: 1.85 }}>
            零钱 ¥{formatYuan(balance ?? 0)}，银行卡 {cards.length} 张（卡里一共 ¥
            {formatYuan(cardTotal)}）。
            <br />
            点下去全清掉——收支明细、卡里的钱、卡内记录一条不剩，这个钱包就空了。
            <br />
            清掉回不来。TA 那边的钱包不受影响——你俩之间的旧记录在他手机里照样留着，
            只是你这边对照不上了；我的收款码留着不动。
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" onClick={() => setClearOpen(false)} style={moveInBtnStyle}>
              再想想
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doClear()}
              style={{ ...dangerBtnStyle, opacity: busy ? 0.6 : 1 }}
            >
              确认清零
            </button>
          </div>
        </WalletSheet>
      ) : null}

      {/* ── 卡详情：一张大卡 ＋ 搬运 ＋ 这张卡自己的记录 ──
          搬运面板／编辑器打开时把这张收起来（遮罩不叠遮罩），关掉它自己回来，
          `detailId` 一直留着，回来还是原来那张卡。 */}
      {detailCard && !move && !editor ? (
        <WalletSheet
          title={detailCard.title}
          hint="卡里的钱随时能转进钱包，也能再提回来"
          onClose={() => setDetailId(null)}
        >
          <WalletCardFace card={detailCard} size="large" />

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => {
                setMoveText("");
                setMove({ cardId: detailCard.id, dir: "in" });
              }}
              style={moveInBtnStyle}
            >
              转入钱包
            </button>
            <button
              type="button"
              onClick={() => {
                setMoveText("");
                setMove({ cardId: detailCard.id, dir: "out" });
              }}
              style={moveOutBtnStyle}
            >
              提现到卡
            </button>
          </div>

          <div style={{ ...sectionHeadStyle, margin: "20px 0 2px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em" }}>卡内记录</span>
            <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
              records
            </span>
          </div>

          {cardEntries.length === 0 ? (
            <div style={{ ...emptyHintStyle, padding: "18px 0 6px" }}>这张卡还没有记录</div>
          ) : (
            <div style={{ maxHeight: 190, overflowY: "auto", overscrollBehavior: "none" }}>
              {cardEntries.map((e) => (
                <WalletEntryRow key={e.id} entry={e} />
              ))}
            </div>
          )}

          {/* 销卡要再点一下确认：卡一销，卡里的钱和记录都跟着走，不好回头 */}
          {confirmDelete ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, color: T.ink2, letterSpacing: ".04em", lineHeight: 1.7 }}>
                销掉「{detailCard.title}」？卡里的钱和这张卡的记录都会一起删掉，钱包余额不受影响。
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  style={moveInBtnStyle}
                >
                  再想想
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doDelete()}
                  style={{ ...dangerBtnStyle, opacity: busy ? 0.6 : 1 }}
                >
                  确认销卡
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setEditor({ card: detailCard })}
                style={moveInBtnStyle}
              >
                编辑这张卡
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} style={dangerBtnStyle}>
                销卡
              </button>
            </div>
          )}
        </WalletSheet>
      ) : null}

      {/* ── 卡 ↔ 零钱的搬运面板 ── */}
      {move && moveCard ? (
        <WalletSheet
          title={move.dir === "in" ? "转入钱包" : "提现到卡"}
          hint={
            move.dir === "in"
              ? `从「${moveCard.title}」搬进钱包零钱`
              : `从钱包零钱搬回「${moveCard.title}」`
          }
          onClose={() => setMove(null)}
        >
          <div style={{ fontSize: 11, color: T.ink3, letterSpacing: ".04em" }}>
            {move.dir === "in"
              ? `这张卡里还有 ¥${formatYuan(moveCard.balance)}`
              : `钱包零钱还有 ¥${formatYuan(balance ?? 0)}`}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
            <span style={{ fontSize: 18, color: T.ink2, fontWeight: 600 }}>¥</span>
            <input
              value={moveText}
              onChange={(ev) => setMoveText(ev.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              style={WALLET_AMOUNT_INPUT}
            />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void doMove()}
            style={{ ...WALLET_PRIMARY_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
          >
            {move.dir === "in" ? "确认转入" : "确认提现"}
          </button>
        </WalletSheet>
      ) : null}

      {/* ── 我的收款码 ── */}
      {payOpen ? (
        <PayCodeSheet
          ownerId={ownerId}
          ownerName={ownerName}
          ownerAvatar={ownerAvatar}
          onClose={() => setPayOpen(false)}
          showToast={showToast}
        />
      ) : null}

      {/* ── 新增／编辑卡 ── */}
      {editor ? (
        <WalletCardEditor
          ownerId={ownerId}
          card={editor.card}
          onClose={() => setEditor(null)}
          onSaved={() => setTick((t) => t + 1)}
          showToast={showToast}
        />
      ) : null}
    </div>
  );
}

/** 一条流水（零钱与卡内两处共用）：左名目与时间，右金额，进账走主粉、出账走墨色。
 *  1.4.34 起 `ContactWalletView`（TA 的钱包）也借这一行——两页一个长相，不另起一套。
 *  1.4.48 起金额走等宽、进账前面挂一小段粉条，像账册上记的一笔。 */
export function WalletEntryRow({ entry }: { entry: WalletEntry }) {
  const inflow = entry.amount > 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 2px",
        borderBottom: `1px solid ${T.lineSoft}`,
      }}
    >
      {/* 进账记一道粉，出账留灰：扫一眼就知道这本账最近进得多还是出得多 */}
      <span
        style={{
          flex: "none",
          width: 3,
          alignSelf: "stretch",
          minHeight: 18,
          background: inflow ? T.pink : T.line,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{entry.title}</div>
        <div
          style={{
            marginTop: 3,
            fontSize: 10.5,
            color: T.ink3,
            letterSpacing: ".04em",
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {momentTime(entry.createdAt)}
          {entry.detail ? ` · ${entry.detail}` : ""}
        </div>
      </div>
      <span
        style={{
          fontFamily: WALLET_MONO,
          fontSize: 14,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          /* 进账用主粉点一下（钱进来了），出账走墨色——不搞红绿那套交易所配色 */
          color: inflow ? T.pink : T.ink,
        }}
      >
        {inflow ? "+" : "-"}¥{formatYuan(Math.abs(entry.amount))}
      </span>
    </div>
  );
}

/* ── 样式 ── */

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: T.bg,
  display: "flex",
  flexDirection: "column",
  fontFamily: SANS,
  color: T.ink,
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  flexShrink: 0,
  paddingTop: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px)",
  paddingLeft: 16,
  paddingRight: 16,
  paddingBottom: 10,
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const backBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  flexShrink: 0,
  /* 方角墨签：跟面板里的主按钮同一块料，钱这一族里没有圆钮 */
  borderRadius: 0,
  border: "none",
  background: T.ink,
  color: "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "4px 16px 30px",
};

/** 余额那张纸：方角、左缘一道粉编目条、硬边错位影——像账册翻开的头一页。 */
const balanceCardStyle: CSSProperties = {
  background: "#FFFFFF",
  /* 不用 border 简写：跟 borderLeft 混用会触发 React 的样式冲突警告。 */
  borderTop: `1px solid ${T.line}`,
  borderRight: `1px solid ${T.line}`,
  borderBottom: `1px solid ${T.line}`,
  borderLeft: WALLET_PAPER_BAR,
  borderRadius: 0,
  boxShadow: WALLET_PAPER_SHADOW,
  padding: "18px 20px 16px",
};

/** 「充值」：墨色方签（这一页唯一的实心钮），跟面板里的主按钮同一块料。 */
const topUpBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 13px",
  borderRadius: 0,
  border: "none",
  background: T.ink,
  color: "#FFFFFF",
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: ".16em",
  textIndent: ".16em",
  cursor: "pointer",
};

/** 页头右上角那颗「设置」：灰描边方签，跟余额卡上的「清零」同一块料——
 *  它不是这一页的主动作（主动作是「充值」），别用墨色实心去抢。 */
const settingsBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  flexShrink: 0,
  padding: "7px 11px",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.ink2,
  fontFamily: SANS,
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".16em",
  textIndent: ".16em",
  cursor: "pointer",
};

/** 「清零」：灰描边方签——别跟墨色的「充值」抢眼，那才是这一页的主动作。 */
const clearBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.ink2,
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: ".16em",
  textIndent: ".16em",
  cursor: "pointer",
};

/** 充值面板里选卡的那一行（跟收款码那行同一个调子；选中的描粉边、淡粉底）。 */
function cardPickStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "11px 13px",
    borderRadius: 0,
    /* 不用 border 简写（会跟 borderLeft 混用触发 React 警告），四边分开写。 */
    borderTop: `1px solid ${on ? T.pink : T.line}`,
    borderRight: `1px solid ${on ? T.pink : T.line}`,
    borderBottom: `1px solid ${on ? T.pink : T.line}`,
    borderLeft: on ? WALLET_PAPER_BAR : `1px solid ${T.line}`,
    background: on ? T.pinkSoft : "#FFFFFF",
    color: T.ink,
    fontFamily: SANS,
    cursor: "pointer",
  };
}

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  margin: "24px 0 6px",
};

/** 收款码那一行、以及设置页里的条目，都用 `WalletSheet` 里导出的 `WALLET_ROW`
 *  （1.4.53 起从这儿提走：两页共用一块料，改一处全族跟着变）。 */

const addCardBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "5px 11px",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.pink,
  fontFamily: SANS,
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".16em",
  textIndent: ".16em",
  cursor: "pointer",
};

const cardBtnStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
};

/** 明细只摆最近几笔时，底下那一行「还有 N 笔」——一整条粉字方签，点它进收支记录。 */
const moreRowStyle: CSSProperties = {
  width: "100%",
  marginTop: 10,
  padding: "11px 0",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.pink,
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: ".12em",
  textIndent: ".12em",
  cursor: "pointer",
};

const emptyHintStyle: CSSProperties = {
  padding: "34px 0 8px",
  textAlign: "center",
  fontSize: 12,
  color: T.ink3,
  letterSpacing: ".06em",
};

/** 面板里的快捷金额小方签（数字走等宽，像手写在格子里）。 */
function quickChipStyle(on: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "9px 0",
    borderRadius: 0,
    border: `1px solid ${on ? T.pink : T.line}`,
    background: on ? T.pinkSoft : "#FFFFFF",
    color: on ? T.pink : T.ink2,
    fontFamily: WALLET_MONO,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/** 「转入钱包」「编辑这张卡」「再想想」——白底粉字方签，次要动作。 */
const moveInBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  borderRadius: 0,
  border: `1px solid ${T.pink}`,
  background: "#FFFFFF",
  color: T.pink,
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 700,
  letterSpacing: ".14em",
  textIndent: ".14em",
  cursor: "pointer",
};

/** 「提现到卡」——粉底白字方签，跟「转入钱包」一进一出摆成一对。 */
const moveOutBtnStyle: CSSProperties = {
  ...moveInBtnStyle,
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
};

/** 销卡：走危险色，但只描边——不是页面上最想让人按的那颗。 */
const dangerBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  borderRadius: 0,
  border: `1px solid ${T.danger}`,
  background: "#FFFFFF",
  color: T.danger,
  fontFamily: SANS,
  fontSize: 13.5,
  fontWeight: 600,
  letterSpacing: ".14em",
  textIndent: ".14em",
  cursor: "pointer",
};
