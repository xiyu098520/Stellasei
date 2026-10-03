"use client";

/**
 * 星绥通讯：收支记录（1.4.67 建，从「我的钱包」收支明细那一块的「全部 ›」进来）。
 *
 * 【为什么单独开一页】恩熙 2026-09-23：「我希望收支记录有个单独的页面，并且点进去
 * 可能有一个树状图呀，或者是其他的。然后并且它可以看、可以筛选，就是选今天、昨天、
 * 本周、本月或者年，然后也可以以及可以区分收入跟支出。或者是已经有个简单的分类，
 * 就比如说转账是一类，就像微信一样嘛，转账有一类，娱乐消费啊或是什么的有一类。
 * 因为我们之后会做出游嘛，然后跟外卖的功能，所以一定还是会有区分的。」
 *
 * 【这一页有什么】
 * 1. **区间**：今天／昨天／本周／本月／今年／全部——六颗方签，选了就只算这一段。
 * 2. **方向**：收支都看／只看进的／只看出的。
 * 3. **门类图**：区间里按门类（转账／红包／充值／提现／其他）堆成一条横带，
 *    下面每类一行，带金额与占比；**点一行就只看这一类**（再点一下放开）。
 *    恩熙说的「树状图呀，或者是其他的」——做的是这条分门类的图：
 *    一条横带看占比，一行行点开看明细，比真画棵树更经得起小屏。
 * 4. **明细**：按天分组（今天／昨天／8月16日），一行的写法跟钱包页那条一个调子。
 * 5. **汇总**：这段时间进了多少、出了多少、净多少——摆在最上面那张纸里。
 *
 * 【门类怎么来的】账本里**不存**分类这一栏，按流水的名目现算（见 `wallet.ts` 的
 * `entryCategory`）——名目是事实，门类只是给名目归堆。以后出游、外卖接进来，
 * 各自带一句自己的名目，往那张归堆表里加一条关键词即可。
 *
 * 【皮】跟钱包页、钱包设置页同一块料：方角纸、左缘粉编目条、硬边错位影、
 * 书写体标题、等宽数字，公用料都在 `WalletSheet` 里导出。
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";
import {
  WALLET_CATEGORY_CN,
  WALLET_CATEGORY_EN,
  entryCategory,
  formatYuan,
  listEntries,
  type WalletEntry,
  type WalletEntryCategory,
} from "@/lib/settings/wallet";
import {
  WALLET_MONO,
  WALLET_PAPER_BAR,
  WALLET_PAPER_SHADOW,
  WALLET_TITLE,
} from "./WalletSheet";
import { EN, SANS, T } from "./shared";

/* ── 三组筛选项 ── */

const RANGES = [
  { key: "today", cn: "今天" },
  { key: "yesterday", cn: "昨天" },
  { key: "week", cn: "本周" },
  { key: "month", cn: "本月" },
  { key: "year", cn: "今年" },
  { key: "all", cn: "全部" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const FLOWS = [
  { key: "all", cn: "全部" },
  { key: "in", cn: "收入" },
  { key: "out", cn: "支出" },
] as const;
type FlowKey = (typeof FLOWS)[number]["key"];

/** 门类在图上那一小格的色阶（第一档主粉，往后越来越淡，最后一档是灰）。 */
const CAT_TINTS = ["#E86A9B", "#F08CB2", "#F5AFC9", "#F9D2E0", "#E7E1E5"];

/* ── 时间：区间与分组 ── */

/** 一天开始的毫秒数（本地时间）。 */
function dayStart(offsetDays: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays).getTime();
}

/** 选的那个区间是「从哪到哪」（含头不含尾）。「全部」两头都不设限。 */
function rangeBounds(key: RangeKey): { from: number; to: number } {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: dayStart(0), to: dayStart(1) };
    case "yesterday":
      return { from: dayStart(-1), to: dayStart(0) };
    case "week": {
      /* 一周从周一算（国内习惯）：把「周日＝0」掰成「周一＝0」。 */
      const ahead = (now.getDay() + 6) % 7;
      return { from: dayStart(-ahead), to: dayStart(1) };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: dayStart(1) };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: dayStart(1) };
    default:
      return { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
  }
}

/** 分组头上的日期：今天／昨天／8月16日（跨年带上年份）。 */
function dayLabel(d: Date): string {
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 行上那个时刻（分组头已经写了日期，这里只报时分）。 */
function hhmm(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── 页面 ── */

export default function WalletLedgerView({
  ownerId,
  onBack,
}: {
  /** 谁的钱包（当前使用中面具的 id）。 */
  ownerId: string;
  onBack: () => void;
}) {
  /** 零钱流水（新的在前）；`null`＝还没读回来。 */
  const [entries, setEntries] = useState<WalletEntry[] | null>(null);
  const [range, setRange] = useState<RangeKey>("month");
  const [flow, setFlow] = useState<FlowKey>("all");
  /** 只看某一个门类（null＝不分门类）。 */
  const [cat, setCat] = useState<WalletEntryCategory | null>(null);

  useEffect(() => {
    let alive = true;
    void listEntries(ownerId, "mask").then((list) => {
      if (!alive) return;
      setEntries(list);
    });
    return () => {
      alive = false;
    };
  }, [ownerId]);

  const { from, to } = useMemo(() => rangeBounds(range), [range]);

  /** 区间内的（还没按方向、门类筛）——汇总与图都从这一份算。 */
  const inRange = useMemo(
    () =>
      (entries ?? []).filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return t >= from && t < to;
      }),
    [entries, from, to],
  );

  /** 图上那一份：区间 ＋ 方向（**不叠门类筛选**——不然点了一类，那条带就只剩一根了）。 */
  const byFlow = useMemo(
    () =>
      inRange.filter((e) =>
        flow === "all" ? true : flow === "in" ? e.amount > 0 : e.amount < 0,
      ),
    [inRange, flow],
  );

  /** 区间里的进、出、净（整段的事实，不随方向签变）。 */
  const totalIn = inRange.reduce((s, e) => s + (e.amount > 0 ? e.amount : 0), 0);
  const totalOut = inRange.reduce((s, e) => s + (e.amount < 0 ? -e.amount : 0), 0);

  /** 图上每一类：金额（取绝对值相加）、条数。大的在前。 */
  const buckets = useMemo(() => {
    const map = new Map<WalletEntryCategory, { cents: number; count: number }>();
    for (const e of byFlow) {
      const key = entryCategory(e);
      const got = map.get(key) ?? { cents: 0, count: 0 };
      got.cents += Math.abs(e.amount);
      got.count += 1;
      map.set(key, got);
    }
    const list = [...map.entries()].map(([key, v]) => ({ key, ...v }));
    list.sort((a, b) => b.cents - a.cents);
    return list;
  }, [byFlow]);

  const bucketTotal = buckets.reduce((s, b) => s + b.cents, 0);

  /** 明细：区间 ＋ 方向 ＋ 门类，再按天分组（新的在前）。 */
  const groups = useMemo(() => {
    const rows = cat ? byFlow.filter((e) => entryCategory(e) === cat) : byFlow;
    const out: { key: string; label: string; net: number; rows: WalletEntry[] }[] = [];
    for (const e of rows) {
      const d = new Date(e.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: dayLabel(d), net: 0, rows: [] };
        out.push(g);
      }
      g.net += e.amount;
      g.rows.push(e);
    }
    return out;
  }, [byFlow, cat]);

  const rangeCn = RANGES.find((r) => r.key === range)?.cn ?? "本月";
  const chartHead =
    flow === "in"
      ? { cn: "钱从哪来", en: "where it came from" }
      : flow === "out"
        ? { cn: "钱花在哪", en: "where it went" }
        : { cn: "按门类", en: "by category" };

  return (
    <div style={rootStyle}>
      {/* ── 页头：跟钱包页一个长相，只是标题换成「收支记录」 ── */}
      <div style={headerStyle}>
        <button type="button" aria-label="返回" onClick={onBack} style={backBtnStyle}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontFamily: WALLET_TITLE, fontSize: 20, fontWeight: 500 }}>
            收支记录
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 30, height: 2, background: T.pink }} />
            <span style={{ fontFamily: EN, fontSize: 9.5, color: T.ink3, letterSpacing: ".3em" }}>
              ledger
            </span>
          </span>
        </div>
      </div>

      <div style={scrollStyle}>
        {/* ── 汇总纸：区间签 ＋ 进／出／净 ── */}
        <div style={summaryPaperStyle}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 11, color: T.ink3, letterSpacing: ".18em" }}>这段时间</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".24em" }}>
              {rangeCn}
            </span>
          </div>

          {/* 六颗区间签平分一行（1.4.70：恩熙「明细里这个全部能不能就在今年的后面，
              不要分到第二行？」）——原来靠 `flexWrap` 自动折行，窄屏上「全部」被挤下去；
              改成六等分格，一行到底，窄屏也塞得下。 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
              gap: 5,
              marginTop: 10,
            }}
          >
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                style={{
                  ...chipStyle(range === r.key),
                  width: "100%",
                  padding: "6px 0",
                  textAlign: "center",
                }}
              >
                {r.cn}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", marginTop: 16 }}>
            <div style={sumCellStyle}>
              <span style={sumCapStyle}>进账</span>
              <span style={{ ...sumNumStyle, color: totalIn > 0 ? T.pink : T.ink3 }}>
                +{formatYuan(totalIn)}
              </span>
            </div>
            <div style={{ ...sumCellStyle, borderLeft: `1px solid ${T.lineSoft}` }}>
              <span style={sumCapStyle}>出账</span>
              <span style={{ ...sumNumStyle, color: totalOut > 0 ? T.ink : T.ink3 }}>
                -{formatYuan(totalOut)}
              </span>
            </div>
            <div style={{ ...sumCellStyle, borderLeft: `1px solid ${T.lineSoft}` }}>
              <span style={sumCapStyle}>净</span>
              <span
                style={{
                  ...sumNumStyle,
                  color: totalIn - totalOut >= 0 ? T.pink : T.ink,
                }}
              >
                {totalIn - totalOut >= 0 ? "+" : "-"}
                {formatYuan(Math.abs(totalIn - totalOut))}
              </span>
            </div>
          </div>
        </div>

        {/* ── 方向签 ── */}
        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
          {FLOWS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFlow(f.key)}
              style={{ ...chipStyle(flow === f.key), flex: 1, textAlign: "center" }}
            >
              {f.cn}
            </button>
          ))}
        </div>

        {/* ── 门类图：一条堆叠横带 ＋ 每类一行（点一行＝只看这一类） ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>
            {chartHead.cn}
          </span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            {chartHead.en}
          </span>
          <span style={{ flex: 1 }} />
          {cat ? (
            <button type="button" onClick={() => setCat(null)} style={miniBtnStyle}>
              放开
            </button>
          ) : null}
        </div>

        {bucketTotal === 0 ? (
          <div style={emptyHintStyle}>
            {entries === null ? "正在读账…" : `这${rangeCn === "全部" ? "本账" : "段时间"}里没有进出的账`}
          </div>
        ) : (
          <>
            {/* 堆叠横带：一格一格按占比分，方角、无圆角，像账册上量出来的一段刻度 */}
            <div style={{ display: "flex", height: 12, border: `1px solid ${T.line}` }}>
              {buckets.map((b, i) => (
                <span
                  key={b.key}
                  style={{
                    flexGrow: b.cents,
                    flexBasis: 0,
                    background: CAT_TINTS[i % CAT_TINTS.length],
                    borderLeft: i === 0 ? "none" : "1px solid #FFFFFF",
                  }}
                />
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {buckets.map((b, i) => {
                const on = cat === b.key;
                const pct = bucketTotal > 0 ? Math.round((b.cents / bucketTotal) * 100) : 0;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setCat(on ? null : b.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
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
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        width: 9,
                        height: 9,
                        background: CAT_TINTS[i % CAT_TINTS.length],
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>
                        {WALLET_CATEGORY_CN[b.key]}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          fontFamily: EN,
                          fontSize: 9,
                          color: T.ink3,
                          letterSpacing: ".16em",
                        }}
                      >
                        {WALLET_CATEGORY_EN[b.key]} · {b.count} 笔
                      </span>
                    </span>
                    <span
                      style={{
                        fontFamily: WALLET_MONO,
                        fontSize: 13.5,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ¥{formatYuan(b.cents)}
                    </span>
                    <span
                      style={{
                        flex: "none",
                        width: 32,
                        textAlign: "right",
                        fontFamily: WALLET_MONO,
                        fontSize: 11,
                        color: T.ink3,
                      }}
                    >
                      {pct}%
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── 明细：按天分组 ── */}
        <div style={sectionHeadStyle}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em" }}>明细</span>
          <span style={{ fontFamily: EN, fontSize: 9, color: T.ink3, letterSpacing: ".3em" }}>
            records
          </span>
          <span style={{ flex: 1 }} />
          {/* 只报当下看的范围，按不按得动看上面那几行门类——这里不摆第二颗一样的键 */}
          <span style={{ fontSize: 10.5, color: T.ink3, letterSpacing: ".1em" }}>
            {cat ? `只看${WALLET_CATEGORY_CN[cat]}` : "全部门类"}
          </span>
        </div>

        {groups.length === 0 ? (
          <div style={emptyHintStyle}>这里还没有记录</div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div style={dayHeadStyle}>
                <span style={{ fontFamily: WALLET_TITLE, fontSize: 13.5, fontWeight: 500 }}>
                  {g.label}
                </span>
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: WALLET_MONO,
                    fontSize: 10.5,
                    color: g.net > 0 ? T.pink : T.ink3,
                  }}
                >
                  {g.net > 0 ? "+" : "-"}
                  {formatYuan(Math.abs(g.net))}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: EN, fontSize: 8.5, color: T.ink3, letterSpacing: ".2em" }}>
                  {g.rows.length} 笔
                </span>
              </div>
              {g.rows.map((e) => (
                <LedgerRow key={e.id} entry={e} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** 明细里的一行：门类小字 ＋ 名目 ＋ 时刻，右边金额（进粉出墨）。 */
function LedgerRow({ entry }: { entry: WalletEntry }) {
  const inflow = entry.amount > 0;
  const key = entryCategory(entry);
  return (
    <div style={rowStyle}>
      {/* 进账记一道粉、出账留灰——跟钱包页那条一个读法 */}
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
        <div style={{ fontSize: 13, fontWeight: 500 }}>{entry.title}</div>
        <div
          style={{
            marginTop: 3,
            fontSize: 10,
            color: T.ink3,
            letterSpacing: ".04em",
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hhmm(entry.createdAt)} · {WALLET_CATEGORY_CN[key]}
          {entry.detail ? ` · ${entry.detail}` : ""}
        </div>
      </div>
      <span
        style={{
          fontFamily: WALLET_MONO,
          fontSize: 13.5,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: inflow ? T.pink : T.ink,
        }}
      >
        {inflow ? "+" : "-"}¥{formatYuan(Math.abs(entry.amount))}
      </span>
    </div>
  );
}

/* ── 样式（页头／页底跟钱包页、钱包设置页同一套） ── */

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

/** 顶上那张纸：跟钱包页余额卡同一块料（方角 ＋ 左缘粉编目条 ＋ 硬影）。 */
const summaryPaperStyle: CSSProperties = {
  background: "#FFFFFF",
  /* 不用 border 简写：跟 borderLeft 混用会触发 React 的样式冲突警告。 */
  borderTop: `1px solid ${T.line}`,
  borderRight: `1px solid ${T.line}`,
  borderBottom: `1px solid ${T.line}`,
  borderLeft: WALLET_PAPER_BAR,
  borderRadius: 0,
  boxShadow: WALLET_PAPER_SHADOW,
  padding: "14px 16px 12px",
};

const sumCellStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const sumCapStyle: CSSProperties = {
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".16em",
};

const sumNumStyle: CSSProperties = {
  fontFamily: WALLET_MONO,
  fontSize: 15.5,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-.01em",
};

const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  margin: "22px 0 10px",
};

/** 筛选小方签（账户这一族的规矩：方角、细线，选中描粉边、淡粉底）。 */
function chipStyle(on: boolean): CSSProperties {
  return {
    flex: "none",
    padding: "6px 13px",
    borderRadius: 0,
    border: `1px solid ${on ? T.pink : T.line}`,
    background: on ? T.pinkSoft : "#FFFFFF",
    color: on ? T.pink : T.ink2,
    fontFamily: SANS,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: ".1em",
    textIndent: ".1em",
    cursor: "pointer",
  };
}

/** 段头右边那颗小字按钮（「放开」「全部门类」）。 */
const miniBtnStyle: CSSProperties = {
  flex: "none",
  padding: "4px 9px",
  borderRadius: 0,
  border: `1px solid ${T.line}`,
  background: "#FFFFFF",
  color: T.ink3,
  fontFamily: SANS,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".12em",
  cursor: "pointer",
};

const dayHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  marginTop: 14,
  paddingBottom: 6,
  borderBottom: `1px solid ${T.line}`,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "11px 2px",
  borderBottom: `1px solid ${T.lineSoft}`,
};

const emptyHintStyle: CSSProperties = {
  padding: "30px 0 8px",
  textAlign: "center",
  fontSize: 12,
  color: T.ink3,
  letterSpacing: ".06em",
};
