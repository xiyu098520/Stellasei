"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { HZ, LAT, SANS, SERIF } from "./shared";

/*
 * 群聊页（1.12.67）——通讯人页「群聊」入口通向的那一页。
 *
 * 皮跟通讯人页同一支雾蓝：顶栏 G1／搜索条／分组小标／空态**一套零件照搬**，
 * 翻过去像同一本书的下一页。名录本体是自己的样子：
 *   ① 群头像：42 圆角方，拼四格迷你首字（衬线、雾蓝），一眼认出是一群人；
 *   ② 群名：宋体 15.5；星标的群名字走**雾蓝正体**（跟联系人页一条规矩，不用五角星）；
 *   ③ 名下小字：「N 位成员」。
 *
 * ⚠ 本 App **还没有群聊的数据模型**（群成员／群消息都没有落库）。
 *   所以这一页先是一个「壳」：群数据由外部以 `groups` prop 传进来，现在传的是空数组，
 *   于是走空态；等群聊落地了，把真数据接上这里即可，别的不用动。
 */

/** 群聊的最小数据模型（本地定义；没有持久层，等群聊落地再谈落库）。 */
export interface Group {
  id: string;
  name: string;
  /** 成员数（副文「N 位成员」用）。 */
  memberCount: number;
  /** 星标：名字走雾蓝正体（同联系人页的星标规矩）。 */
  starred?: boolean;
}

export default function GroupList({
  groups,
  onBack,
  showToast,
}: {
  /** 群列表（暂无数据模型，由上层传入；现在为空）。 */
  groups: Group[];
  /** 顶栏左上返回键：回通讯人页。 */
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");

  /** 搜索＋分组：星标群优先，其余按传入次序。 */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);
  const starred = useMemo(() => filtered.filter((g) => g.starred === true), [filtered]);
  const normal = useMemo(() => filtered.filter((g) => g.starred !== true), [filtered]);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: HZ.paper,
        fontFamily: SANS,
        color: HZ.ink,
        overflow: "hidden",
      }}
    >
      {/* 交互：顶部两键按下反馈＋条目之间那条从名字起头处划开的细线 */}
      <style>{`
        .gl-hbtn { transition: opacity .15s ease, transform .15s ease; }
        .gl-hbtn:active { opacity: .55; transform: scale(.94); }
        .gl-search::placeholder { color: ${HZ.ink3}; }
        .gl-entry { position: relative; transition: filter .16s ease; }
        .gl-entry:active { filter: brightness(.96); }
        .gl-entry + .gl-entry::before {
          content: ''; position: absolute; top: 0; left: 58px; right: 2px;
          height: 1px; background: ${HZ.line2};
        }
        @media (prefers-reduced-motion: reduce) { .gl-hbtn, .gl-entry { transition: none; } }
      `}</style>

      {/* 顶栏 G1（跟通讯人页／消息页同一套）：左上返回、中标题、右上加号 */}
      <div
        style={{
          flex: "none",
          zIndex: 20,
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 2px) 26px 0",
        }}
      >
        <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
          {/* 返回：钉在左侧中线上 */}
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="gl-hbtn"
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              padding: 0,
              color: HZ.ink,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>

          {/* 中心标题块：中文压着斜体英文 */}
          <div style={{ textAlign: "center" }}>
            <span
              style={{
                fontFamily: SERIF,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: ".2em",
                paddingLeft: ".2em",
                color: HZ.accent,
                lineHeight: 1,
              }}
            >
              群聊
            </span>
            <div
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: 12.5,
                letterSpacing: ".12em",
                textIndent: ".12em",
                color: HZ.ink3,
                padding: "1px 0 0",
              }}
            >
              Groups
            </div>
          </div>

          {/* 加号：钉在右侧中线上（发起群聊还没做，先给一句提示） */}
          <button
            type="button"
            onClick={() => showToast("发起群聊 · 预览")}
            aria-label="更多"
            className="gl-hbtn"
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              padding: 0,
              color: HZ.ink,
              cursor: "pointer",
            }}
          >
            <Plus size={22} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* 搜索条：跟通讯人页同一枚（圆角浅底渐变＋放大镜） */}
      <div style={{ flex: "none", padding: "12px 26px 2px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            height: 38,
            padding: "0 14px",
            borderRadius: 12,
            background: "linear-gradient(180deg,#F1F2F0,#EBEDEA)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(58,65,73,.05)",
          }}
        >
          <Search size={16} strokeWidth={1.7} color={HZ.ink3} style={{ flex: "none" }} />
          <input
            type="text"
            className="gl-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索群名"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              letterSpacing: ".16em",
              fontFamily: SANS,
              color: HZ.ink,
            }}
          />
        </div>
      </div>

      {/* 群列表：条目之间只压一条从名字起头处划开的细线 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "13px 20px 18px",
        }}
      >
        {groups.length === 0 ? (
          <EmptyState cn="还没有群聊" en="no groups yet" hint="群聊功能还在路上，之后就在这里" />
        ) : filtered.length === 0 ? (
          <EmptyState cn="这里空着" en="nothing here" hint={`没有找到「${query.trim()}」`} />
        ) : (
          <>
            {starred.length > 0 ? (
              <div>
                <GroupLabel en="Starred" cn="星标" count={starred.length} />
                {starred.map((g) => (
                  <GroupRow key={g.id} group={g} onOpen={() => showToast(`${g.name} · 预览`)} />
                ))}
              </div>
            ) : null}
            {normal.length > 0 ? (
              <div>
                <GroupLabel en="All" cn="全部群聊" count={normal.length} />
                {normal.map((g) => (
                  <GroupRow key={g.id} group={g} onOpen={() => showToast(`${g.name} · 预览`)} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 分组小标：跟通讯人页同一枚（等宽英文＋中点＋中文），右端补一枚淡条数。 */
function GroupLabel({ en, cn, count }: { en: string; cn: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 7, padding: "11px 4px 9px" }}>
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".3em",
          color: HZ.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
      <span style={{ fontFamily: LAT, fontSize: 9.5, color: HZ.ink3 }}>·</span>
      <span style={{ fontSize: 11, letterSpacing: ".26em", color: HZ.ink2 }}>{cn}</span>
      <i style={{ flex: 1 }} />
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".1em",
          color: HZ.ink3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(count).padStart(2, "0")}
      </span>
    </div>
  );
}

/** 群聊的一条：42 圆角方群头像（拼四格迷你首字）＋宋体群名（星标走雾蓝）＋成员数。 */
function GroupRow({ group, onOpen }: { group: Group; onOpen: () => void }) {
  /* 头像四格：取群名前四字，不足的格子用「·」占位（没有成员数据时的兜底画法）。 */
  const cells = Array.from(group.name).slice(0, 4);
  while (cells.length < 4) cells.push("·");

  return (
    <div
      onClick={onOpen}
      data-tap="true"
      className="gl-entry"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 2px",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          flex: "none",
          width: 42,
          height: 42,
          borderRadius: 13,
          overflow: "hidden",
          background: "#FFFFFF",
          border: "1px solid rgba(255,255,255,.75)",
          boxShadow: "0 1px 2px rgba(58,65,73,.07), inset 0 1px 0 rgba(255,255,255,.95)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          pointerEvents: "none",
        }}
      >
        {cells.map((ch, i) => (
          <i
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontStyle: "normal",
              fontFamily: SERIF,
              fontSize: 11,
              fontWeight: 600,
              color: HZ.accent,
              boxShadow: "inset 0 0 0 .5px rgba(58,65,73,.06)",
            }}
          >
            {ch}
          </i>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 15.5,
            fontWeight: 600,
            letterSpacing: ".08em",
            color: group.starred ? HZ.accent : HZ.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {group.name}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            letterSpacing: ".02em",
            color: HZ.ink2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {group.memberCount} 位成员
        </div>
      </div>

      <ChevronRight size={15} strokeWidth={1.9} color={HZ.ink3} style={{ flex: "none" }} />
    </div>
  );
}

/** 空状态：跟通讯人页同一枚（一小撮雾蓝线起头＋宋体一行＋提示）。 */
function EmptyState({ cn, en, hint }: { cn: string; en: string; hint: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "90px 34px 40px",
        textAlign: "center",
      }}
    >
      <span
        style={{ width: 32, height: 4, borderRadius: 999, background: HZ.accent, opacity: 0.7, marginBottom: 20 }}
      />
      <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, color: HZ.ink, letterSpacing: ".08em" }}>
        {cn}
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: LAT,
          fontSize: 9,
          letterSpacing: ".26em",
          color: HZ.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: HZ.ink2, letterSpacing: ".04em", lineHeight: 1.6 }}>
        {hint}
      </div>
    </div>
  );
}
