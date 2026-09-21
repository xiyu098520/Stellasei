"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Archive,
  ChevronRight,
  ChevronsDown,
  EyeOff,
  HeartCrack,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { usePhone } from "@/context/PhoneContext";
import {
  CATEGORY_LABEL,
  MOMENT_INJECT_MAX,
  deleteMemory,
  deleteMemoryItem,
  forceCompress,
  forceCondense,
  getAllMemories,
  getMemory,
  updateMemoryItem,
  updateMemorySettings,
} from "@/lib/chat/memory";
import { getArchives } from "@/lib/settings/contact";
import { getMasks, DEFAULT_MASK_ID, getCurrentMask } from "@/lib/settings/mask";
import {
  clearConversation,
  clearMomentsAndSignature,
  getApiBundle,
  getConversations,
} from "@/lib/settings/chat";
import { releaseImageAsset } from "@/lib/chat/media-asset";
import { AVATAR_GRADIENT } from "@/apps/chat/shared";
import type { ArchiveEntry } from "@/types/contact";
import type { Mask } from "@/lib/settings/mask";
import type { CharacterMemory, Conversation, MemoryItem } from "@/types/chat";

/* =======================================================================
 * 记忆 App（私人刊物 · 档案编目）
 * 一个角色的记忆＝一本只给一个人看的册子：封面是 TA，内页是编目卡片。
 * 三条铁律：
 *   ① 纸白打底、樱花粉做主色，天蓝只留给「系统正在运转」这一处对比；
 *   ② 黑色只出现在标签贴上（索引、主按钮），分类贴改用樱花粉深调，别处一律不黑；
 *   ③ 标题用书写体（霞鹜文楷）、正文用宋体、装饰英文全大写大字距、所有编目数字一律等宽。
 * 列表页：所有联系人（创建即入列）；详情页：分层记忆管理。
 * 分层：重要（永不遗忘）→ 短期（可编辑）→ 中期/长期（只读，已压缩）。
 * ===================================================================== */

const M = {
  /* 纸 */
  bg: "#F7F3F0",
  paper: "#FFFFFF",
  /* 墨 */
  ink: "#1B1918",
  ink2: "#6E6663",
  ink3: "#A79D98",
  /* 樱花粉（主色） */
  pink: "#E7A3B1",
  pinkDeep: "#D4758C",
  pinkWash: "rgba(231,163,177,.16)",
  /* 天蓝（唯一对比色，只用在「系统正在运转」） */
  blue: "#6FAECF",
  /* 黑标签贴 */
  label: "#1B1918",
  /* 戳记 */
  gold: "#C2994F",
  red: "#C2544F",
  /* 线 */
  line: "rgba(27,25,24,.10)",
  lineSoft: "rgba(27,25,24,.06)",
  dash: "rgba(27,25,24,.22)",
} as const;

/** 纸纹：樱花粉网点，双层错位排开的圆点——是印刷的底，不是任何人的斜纹。 */
const GRAIN: CSSProperties = {
  backgroundImage:
    "radial-gradient(rgba(231,163,177,.34) 1.15px, transparent 1.25px), radial-gradient(rgba(231,163,177,.34) 1.15px, transparent 1.25px)",
  backgroundSize: "14px 14px, 14px 14px",
  backgroundPosition: "0 0, 7px 7px",
};
/** 硬边错位投影：剪贴拼贴感，比柔和 shadow 更像印刷品。 */
const OFFSET_SHADOW = "3px 3px 0 rgba(27,25,24,.06)";

const SERIF = "'Songti SC', Georgia, serif";
/** 标题：书写体——笔画有起有收、横画微仰，像编者亲手写在卡片上的，不是活字砖块。
 *  首选霞鹜文楷（自托管分块，见 src/app/lxgw-wenkai.css），标题一律用它的 500
 *  （Medium）——恩熙看过 400 后说「稍微粗一点点」，500 是它的下一档，笔锋还在；
 *  ⚠️ 不要再往上加到 600/700：霞鹜文楷只有 400/500 两个字重，超出的字重浏览器会
 *  合成加粗（描边），反而把笔锋糊平，就是上一版「看不出变化」的原因。
 *  后面几个系统楷体只在字体块下载完成前兜底。 */
const TITLE = "'LXGW WenKai GB', 'Kaiti SC', 'STKaiti', 'KaiTi', 'Songti SC', Georgia, serif";
const EN = "var(--font-playfair), Georgia, serif";
/** 编目数字（日期戳、编号、计数）一律等宽，像打上去的。 */
const MONO = "var(--font-mono), ui-monospace, Menlo, monospace";

const shortTime = (iso: string) => iso.slice(5, 16).replace("T", " ");

/** 动态的日期戳：MM/DD。跟注入给 TA 的记忆块里那枚一模一样（memory.ts 的
 *  `momentDate`），页面跟 TA 记的要对得上。 */
const momentStamp = (iso: string) => iso.slice(5, 10).replace("-", "/");

/** 层元信息（分组标题＋说明）。层号＝编目分区号，越往下越模糊。 */
const TIER_META: Record<string, { title: string; en: string; desc: string; no: string }> = {
  core: { title: "重要记忆", en: "forever", desc: "永远不会忘的事实 · 不参与压缩", no: "I" },
  short: { title: "短期记忆", en: "recent", desc: "细节清晰 · 可编辑可标记 · 攒满自动压入中期", no: "II" },
  mid: { title: "中期记忆", en: "compressed", desc: "事件清楚，细节已模糊 · 只读", no: "III" },
  long: { title: "长期记忆", en: "impressions", desc: "只剩模糊印象 · 只读", no: "IV" },
};

/** 重要记忆默认竖向只露这么多条，多的折起来（下面还有短期记忆，不能让它们被挤出屏幕）。 */
const CORE_PREVIEW = 3;

/** 第五编：朋友圈动态。这一编的数据**不在记忆条目里**（前四编是聊天记录浓缩出来的），
 *  而是 TA 发在朋友圈的动态本身——单独成编列在最后，抬头就写明来源，
 *  一眼分得清「哪些是聊天里说过的、哪些是发在朋友圈的」。
 *  恩熙 2026-09-21：「可以在记忆里面多增加一个朋友圈的栏位……让角色分清楚」。 */
const MOMENT_META = {
  title: "朋友圈动态",
  en: "moments",
  no: "V",
  desc: "TA 自己发在朋友圈的 · 近的原文照录，更早的只剩个大概 · ★ 重要的一直记着 · 聊天里说过的在前面几层",
} as const;

/** 朋友圈动态默认只露最近这么多条：动态会越攒越多，全摊开在页面上太长；
 *  要全看再自己点开（跟上面「重要记忆」一个做法）。恩熙 2026-09-21：「全部都直接
 *  这样摊开在页面上会有点多，能不能把它做成，就是我点进去之后才会显现的那一种？」 */
const MOMENT_PREVIEW = 3;

/** 编目条：封底那排粗细不一的竖条，纯装饰。 */
function Barcode() {
  return (
    <span style={barcodeStyle} aria-hidden>
      {BARCODE.map((w, i) => (
        <span key={i} style={{ width: w, height: i % 2 ? 9 : 15, background: M.ink3 }} />
      ))}
    </span>
  );
}

/** 四心小标：一枚像素心不大，四枚连成一排，像一条贴纸（页脚那一枚发行标）。 */
function HeartMark({ size = 18 }: { size?: number }) {
  return (
    <span style={heartMarkStyle} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <svg
          key={i}
          width={size}
          height={(size * 6) / 7}
          viewBox="0 0 7 6"
          shapeRendering="crispEdges"
          style={{ display: "block" }}
        >
          <path d={PIXEL_HEART_PATH} fill={M.pinkDeep} />
        </svg>
      ))}
    </span>
  );
}

/** 记忆条目卡片（哪一层都能编辑内容；重要/秘密/心结只在短期、重要两层可标）。 */
function MemoryCard({
  item,
  onEdit,
  onTogglePin,
  onToggleSecret,
  onToggleGrudge,
  onDelete,
}: {
  item: MemoryItem;
  onEdit: () => void;
  onTogglePin: () => void;
  onToggleSecret: () => void;
  onToggleGrudge: () => void;
  onDelete: () => void;
}) {
  /* 中期、长期也能编辑内容——AI 万一记岔了，得留一条手动修的路。
     「重要／秘密／心结」仍只给短期与重要两层：标「重要」会把条目升进重要层。 */
  const canFlag = item.tier === "short" || item.tier === "core";
  return (
    <div style={cardStyle}>
      <div style={{ padding: "11px 12px 9px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={catChipStyle}>{CATEGORY_LABEL[item.category]}</span>
          {item.secret ? (
            <span style={{ ...statusChipStyle, color: M.ink2 }}>
              <EyeOff size={9} strokeWidth={2} /> 秘密
            </span>
          ) : null}
          {item.grudge && !item.resolvedIso ? (
            <span style={{ ...statusChipStyle, color: M.red, borderColor: "rgba(194,84,79,.38)" }}>
              <HeartCrack size={9} strokeWidth={2} /> 心结未解
            </span>
          ) : null}
          {item.resolvedIso ? (
            <span style={{ ...statusChipStyle, color: M.pinkDeep, borderColor: "rgba(212,117,140,.45)" }}>
              已解开
            </span>
          ) : null}
          {item.fulfilledIso ? (
            <span style={{ ...statusChipStyle, color: M.pinkDeep, borderColor: "rgba(212,117,140,.45)" }}>
              已兑现
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span style={timeStyle}>{shortTime(item.toIso)}</span>
        </div>
        <p style={itemTextStyle}>{item.content}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", borderTop: `1px dashed ${M.dash}`, padding: "5px 6px 5px 10px" }}>
        <button type="button" onClick={onEdit} style={actBtnStyle} aria-label="编辑">
          <Pencil size={12} strokeWidth={1.8} /> 编辑
        </button>
        {canFlag ? (
          <>
            <button
              type="button"
              onClick={onTogglePin}
              style={{
                ...actBtnStyle,
                color: item.important ? M.gold : M.ink3,
              }}
              aria-label="标记重要"
            >
              <Star size={12} strokeWidth={1.8} fill={item.important ? M.gold : "none"} />
              {item.important ? "重要" : "标重要"}
            </button>
            <button
              type="button"
              onClick={onToggleSecret}
              style={{
                ...actBtnStyle,
                color: item.secret ? M.ink : M.ink3,
              }}
              aria-label="标记秘密"
            >
              <EyeOff size={12} strokeWidth={1.8} /> {item.secret ? "秘密" : "标秘密"}
            </button>
            <button
              type="button"
              onClick={onToggleGrudge}
              style={{
                ...actBtnStyle,
                color: item.grudge ? M.red : M.ink3,
              }}
              aria-label="标记心结"
            >
              <HeartCrack size={12} strokeWidth={1.8} /> 心结
            </button>
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDelete}
          style={{ ...actBtnStyle, color: M.ink3 }}
          aria-label="删除"
        >
          <Trash2 size={12} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

export default function MemoryApp() {
  const { closeApp } = usePhone();
  /* 列表数据。 */
  const [archives, setArchives] = useState<ArchiveEntry[] | null>(null);
  const [memories, setMemories] = useState<CharacterMemory[] | null>(null);
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  /* 详情页。 */
  const [openId, setOpenId] = useState<{ characterId: string; maskId: string } | null>(null);
  const [detail, setDetail] = useState<CharacterMemory | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* 分类筛选：「all」＝不过滤；六个分类各看各的（短期中期长期一起过滤）。 */
  const [catFilter, setCatFilter] = useState<string>("all");
  /* 编辑弹层：item id＋草稿。 */
  const [editing, setEditing] = useState<{ id: string; content: string; category: string } | null>(null);
  /* 确认弹窗。 */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [toast, setToast] = useState("");
  /** 重要记忆是否展开全部（默认只露前 CORE_PREVIEW 条）。 */
  const [coreOpen, setCoreOpen] = useState(false);
  /** 第五编朋友圈动态是否展开全部（默认只露最近 MOMENT_PREVIEW 条）。 */
  const [momentOpen, setMomentOpen] = useState(false);

  /* 排查用的报错文案比较长，多留一会儿才念得完。 */
  const showToast = (msg: string, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(""), ms);
  };

  /* 载入列表数据。 */
  useEffect(() => {
    let alive = true;
    void Promise.all([getArchives(), getAllMemories(), getConversations(), getMasks()]).then(
      ([arcs, mems, cs, mks]) => {
        if (!alive) return;
        setArchives(arcs);
        setMemories(mems);
        setConvs(cs);
        setMasks(mks);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  /* 打开详情：拉取该绑定记忆。 */
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    void getMemory(openId.characterId, openId.maskId).then((m) => {
      if (alive) setDetail(m);
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  const refresh = async () => {
    setMemories(await getAllMemories());
    /* 会话也要重读：朋友圈动态那一编直接读会话上的 `moments`，清空记忆后
       不重读的话，页面里那份还是旧的（动态看着照旧还在）。 */
    setConvs(await getConversations());
    if (openId) setDetail(await getMemory(openId.characterId, openId.maskId));
  };

  /** 列表行：联系人（全部，创建即入列）。 */
  const rows = useMemo(() => {
    if (!archives || !memories || !convs) return [];
    return archives.map((a) => {
      const mems = memories.filter((m) => m.characterId === a.id);
      /* 「几个身份」＝这位角色名下有**聊过的面具**（有消息）或**已经攒下记忆的面具**（聊天记录
         被清空、记忆还在的也算，否则那份记忆在列表上就看不见了）。
         恩熙 2026-09-21：「记忆它好像是没有做面具 A、B 的分区哦。」 */
      const ids = new Set<string>();
      for (const c of convs) {
        if (c.characterId === a.id && c.messages.length > 0) ids.add(c.maskId ?? DEFAULT_MASK_ID);
      }
      for (const m of mems) if (m.items.length > 0) ids.add(m.maskId);
      const totalItems = mems.reduce((n, m) => n + m.items.length, 0);
      return { archive: a, bindCount: ids.size, totalItems, enabled: mems.every((m) => m.enabled) };
    });
  }, [archives, memories, convs]);

  /** 使用中的面具（记忆跟聊天走同一个身份）。 */
  const currentMaskId = getCurrentMask(masks)?.id ?? DEFAULT_MASK_ID;

  /** 打开某角色的记忆时落在哪张面具：优先**当前使用中的面具**——只要它在这位角色名下
      聊过天、或已经攒下记忆；否则回落「本我」。
      以前一律落「本我」：换面具聊了半天，进记忆看的还是本我那份，看着就像没按面具分区。 */
  const pickMaskFor = (characterId: string): string => {
    const talked = (convs ?? []).some(
      (c) =>
        c.characterId === characterId &&
        (c.maskId ?? DEFAULT_MASK_ID) === currentMaskId &&
        c.messages.length > 0,
    );
    const remembered = (memories ?? []).some(
      (m) => m.characterId === characterId && m.maskId === currentMaskId && m.items.length > 0,
    );
    return talked || remembered ? currentMaskId : DEFAULT_MASK_ID;
  };

  /** 详情页角色信息。 */
  const archive = openId ? archives?.find((a) => a.id === openId.characterId) : undefined;
  const charName = archive?.data.name || archive?.data.nickname || "TA";
  /** 该角色的绑定（面具切换用）。 */
  const bindChips = useMemo(() => {
    if (!openId) return [];
    /* 口径跟列表行的「几个身份」一致：聊过的面具 ∪ 攒下记忆的面具。
       只认有消息的，会出现「列表写着两个身份、进来却只有一枚 chip」的矛盾。
       恩熙 2026-09-21。 */
    const seen = new Set<string>();
    const list: Array<{ maskId: string; label: string }> = [];
    const push = (mid: string) => {
      if (seen.has(mid)) return;
      seen.add(mid);
      const label =
        mid === DEFAULT_MASK_ID ? "本我" : (masks.find((k) => k.id === mid)?.name.trim() || "已删面具");
      list.push({ maskId: mid, label });
    };
    for (const c of convs ?? []) {
      if (c.characterId === openId.characterId && c.messages.length > 0) push(c.maskId ?? DEFAULT_MASK_ID);
    }
    for (const m of memories ?? []) {
      if (m.characterId === openId.characterId && m.items.length > 0) push(m.maskId);
    }
    return list;
  }, [openId, convs, masks, memories]);

  /** 分组条目（按分类筛选后，层内过滤；空层由渲染处隐藏）。 */
  const groups = useMemo(() => {
    if (!detail) return [];
    const order: MemoryItem["tier"][] = ["core", "short", "mid", "long"];
    return order.map((tier) => ({
      tier,
      items: detail.items.filter(
        (it) => it.tier === tier && (catFilter === "all" || it.category === catFilter),
      ),
    }));
  }, [detail, catFilter]);

  /** 各分类的条数（筛选条上显示；含所有层，让用户一眼看出「哪类记得多」）。 */
  const catCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of detail?.items ?? []) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    return counts;
  }, [detail]);

  /** 当前绑定的朋友圈动态（第五编）。跟注入给 TA 的是**同一个源**：直接读这条会话的
      `moments`，不另存一份——清空记忆时那边一清，这里自然就空了，不会留下对不上的影子。
      过掉没内容的（跟注入口径一致，否则页面列着一条 TA 根本没记住的东西）。 */
  const moments = useMemo(() => {
    if (!openId || !convs) return [];
    const conv = convs.find(
      (c) => c.characterId === openId.characterId && (c.maskId ?? DEFAULT_MASK_ID) === openId.maskId,
    );
    return (conv?.moments ?? []).filter((m) => m.content.trim());
  }, [openId, convs]);

  /** 第五编要摊开的几截：重要的、近期原文、最早那段印象。
      口径跟注入给 TA 的**逐字一致**（memory.ts 的 buildMomentSection）——
      页面列着的、跟 TA 记着的，得是同一批，不然对不上账。
      `pinned`／`recent` 都已倒成新→旧；`unlisted` 是攒够该压、但还没到压缩时机的那几条，
      这批 TA 只被告知了个条数。 */
  const momentView = useMemo(() => {
    /* 印象得跟 id 配套：只有印象文字在、却没记下压了哪几条时当作没压过（跟注入侧同一个防呆）。 */
    const digest = detail?.momentDigest?.trim() ?? "";
    const covered = new Set(digest ? (detail?.momentDigestIds ?? []) : []);
    const pinned = moments.filter((m) => m.pinnedByUser);
    const live = moments.filter((m) => !m.pinnedByUser && !covered.has(m.id));
    const recent = live.slice(-MOMENT_INJECT_MAX);
    return {
      pinned: pinned.slice().reverse(),
      recent: recent.slice().reverse(),
      unlisted: live.length - recent.length,
      /* 印象卡上那句「最早的 N 条」：按还在库里的 id 数（id 失效的不算）。 */
      coveredCount: moments.filter((m) => covered.has(m.id)).length,
      digest,
    };
  }, [moments, detail]);

  /* 横滑筛选条的右缘渐隐：右边还有内容时显示（提示可滑），滑到最右自动消失。 */
  const catScrollRef = useRef<HTMLDivElement>(null);
  const [catHint, setCatHint] = useState(false);
  const measureCatHint = () => {
    const el = catScrollRef.current;
    if (!el) return;
    setCatHint(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };
  useEffect(() => {
    /* 渲染完成后测一次（内容宽度在布局后才确定）；rAF 异步 setState，避免编译器 lint。 */
    const id = requestAnimationFrame(measureCatHint);
    return () => cancelAnimationFrame(id);
  }, [detail, catCounts]);

  /* ---------- 动作 ---------- */

  const toggleEnabled = async () => {
    if (!openId || !detail) return;
    setDetail(await updateMemorySettings(openId.characterId, openId.maskId, { enabled: !detail.enabled }));
    void refresh();
  };

  const toggleAutoCondense = async () => {
    if (!openId || !detail) return;
    setDetail(await updateMemorySettings(openId.characterId, openId.maskId, { autoCondense: !detail.autoCondense }));
  };

  const stepContext = async (delta: number) => {
    if (!openId || !detail) return;
    const next = Math.min(300, Math.max(20, detail.contextLimit + delta));
    setDetail(await updateMemorySettings(openId.characterId, openId.maskId, { contextLimit: next }));
  };

  const runCondense = async () => {
    if (!openId || busy) return;
    const conv = convs?.find(
      (c) => c.characterId === openId.characterId && (c.maskId ?? DEFAULT_MASK_ID) === openId.maskId,
    );
    if (!conv) {
      showToast("还没和 TA 聊过天");
      return;
    }
    setBusy(true);
    try {
      const bundle = await getApiBundle();
      const api =
        conv.apiOverrides?.text &&
        conv.apiOverrides.text.enabled &&
        conv.apiOverrides.text.baseUrl.trim() &&
        conv.apiOverrides.text.model.trim()
          ? conv.apiOverrides.text
          : bundle.text;
      if (!api.baseUrl.trim() || !api.model.trim()) {
        showToast("文本 API 未配置，无法归总");
        return;
      }
      const result = await forceCondense(
        { characterId: openId.characterId, maskId: openId.maskId, messages: conv.messages },
        charName,
        "我",
        api,
      );
      if (result.ran) {
        await refresh();
        showToast("已归总进短期记忆");
      } else {
        showToast(result.error ?? "暂无可归总的对话", 7000);
      }
    } catch {
      showToast("归总失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  const runCompress = async (fromTier: "short" | "mid") => {
    if (!openId || busy) return;
    const conv = convs?.find(
      (c) => c.characterId === openId.characterId && (c.maskId ?? DEFAULT_MASK_ID) === openId.maskId,
    );
    setBusy(true);
    try {
      const bundle = await getApiBundle();
      const api =
        conv?.apiOverrides?.text &&
        conv.apiOverrides.text.enabled &&
        conv.apiOverrides.text.baseUrl.trim() &&
        conv.apiOverrides.text.model.trim()
          ? conv.apiOverrides.text
          : bundle.text;
      if (!api.baseUrl.trim() || !api.model.trim()) {
        showToast("文本 API 未配置，无法压缩");
        return;
      }
      const label = fromTier === "short" ? "中期" : "长期";
      const result = await forceCompress(
        { characterId: openId.characterId, maskId: openId.maskId },
        charName,
        "我",
        api,
        fromTier,
      );
      if (result.ran) {
        await refresh();
        setDetail(await getMemory(openId.characterId, openId.maskId));
        showToast(`已压缩进${label}记忆`);
      } else {
        showToast(result.error ?? "暂无可压缩的记忆");
      }
    } catch {
      showToast("压缩失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!openId || !editing) return;
    const content = editing.content.trim();
    if (!content) {
      showToast("内容不能为空");
      return;
    }
    const next = await updateMemoryItem(openId.characterId, openId.maskId, editing.id, {
      content: content.slice(0, 200),
      category: editing.category as MemoryItem["category"],
    });
    setDetail(next);
    setEditing(null);
    void refresh();
  };

  const removeItem = async () => {
    if (!openId || !confirmDel) return;
    const next = await deleteMemoryItem(openId.characterId, openId.maskId, confirmDel);
    setConfirmDel(null);
    setDetail(next);
    void refresh();
    showToast("已删除");
  };

  const wipeAll = async () => {
    if (!openId) return;
    const conv = (await getConversations()).find(
      (c) => c.characterId === openId.characterId && c.maskId === openId.maskId,
    );
    /* 清空记忆＝连上下文一起清（2026-09-17 恩熙定）：只删摘要、聊天记录照发，
       等于钱照花、TA 照记——所以这里把消息一并清掉，跟设置里的「清空聊天记录」等价。
       消息一删引用链就断，图要顺手回收（否则仓库只进不出）。
       朋友圈也要一起清（2026-09-21 恩熙：「我重置记忆朋友圈也还会存在 应该要消息的」）：
       动态是 TA 随着聊天攒下的，记忆都重置了，这些留着就说不通；图同样要回收。
       TA 自己改过的签名一并清掉（同一天恩熙补：「签名也要一起签的」），清完回落到档案自带的默认签名。 */
    for (const m of conv?.messages ?? []) releaseImageAsset(m.imageUrl);
    for (const mo of conv?.moments ?? []) releaseImageAsset(mo.imageRef);
    await clearConversation(openId.characterId, openId.maskId);
    await clearMomentsAndSignature(openId.characterId, openId.maskId);
    await deleteMemory(openId.characterId, openId.maskId);
    /* 让聊天那边重新读一遍（ChatApp 监听 moments-updated 刷新会话）：不然动态页
       拿的还是刷记忆之前那份数据，朋友圈看着照旧还在（2026-09-21 恩熙报的就是这个）。 */
    window.dispatchEvent(new CustomEvent("moments-updated"));
    setConfirmWipe(false);
    setDetail(null);
    setOpenId(null);
    await refresh();
    showToast("记忆与聊天记录已清空");
  };

  const back = () => {
    setDetail(null);
    setEditing(null);
    setSettingsOpen(false);
    setOpenId(null);
  };

  const headerPad = "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 6px)";

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        overflow: "hidden",
        backgroundColor: M.bg,
        ...GRAIN,
        fontFamily: SERIF,
        color: M.ink,
      }}
    >
      {/* ---------------- 列表页 ---------------- */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          transform: openId ? "translateX(-28%)" : "none",
          opacity: openId ? 0 : 1,
          pointerEvents: openId ? "none" : "auto",
          transition: "transform .3s cubic-bezier(.22,1,.36,1), opacity .3s",
        }}
      >
        <div style={{ ...headerStyle, padding: `${headerPad} 12px 14px` }}>
          <button type="button" onClick={closeApp} aria-label="关闭" style={btnStyle}>
            <X size={20} strokeWidth={1.6} />
          </button>
          <div style={{ textAlign: "center", pointerEvents: "none" }}>
            <span style={{ fontSize: 23, fontWeight: 500, letterSpacing: ".3em", textIndent: ".3em", fontFamily: TITLE }}>记忆</span>
            <span style={{ ...enLabelStyle, display: "block", marginTop: 3 }}>memory archive</span>
          </div>
          <div style={{ width: 38, textAlign: "right" }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: M.ink3, letterSpacing: ".06em" }}>VOL.01</span>
          </div>
          {/* 刊头下面那道骑缝虚线（四心贴纸只放页脚，刊头不放）。 */}
          <span style={seamStyle} aria-hidden />
        </div>

        <div style={scrollBodyStyle}>
          {archives === null ? null : rows.length === 0 ? (
            <div style={{ ...emptyWrap, paddingTop: 100 }}>
              {/* 一张贴上去的空相框：背后再错开一张，像没贴照片的那页。 */}
              <div style={{ position: "relative", width: 62, height: 62 }}>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: -8,
                    border: "1px dashed rgba(27,25,24,.14)",
                    background: "rgba(255,255,255,.6)",
                    transform: "rotate(3.2deg)",
                  }}
                />
                <div style={{ ...emptyCircle, position: "absolute", inset: 0 }}>
                  <Archive size={24} strokeWidth={1.5} />
                </div>
              </div>
              <div style={{ marginTop: 18, fontSize: 15, color: M.ink2, letterSpacing: ".14em" }}>还没有认识的人</div>
              <div style={{ ...enLabelStyle, marginTop: 8 }}>nobody yet</div>
              <div style={{ marginTop: 14, fontSize: 12, color: M.ink3, letterSpacing: ".06em" }}>
                去档案创建一个角色，聊聊天，记忆会自己长出来
              </div>
            </div>
          ) : (
            <>
              <p style={editorNoteStyle}>
                聊天攒满一批后自动浓缩成短期记忆，越久远越模糊——像真的记性一样。
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px 12px" }}>
                <span style={catChipStyle}>收录</span>
                <em style={enLabelStyle}>contents</em>
                {/* 目录点线：把「收录」引到右边的条目数上。 */}
                <span style={leaderStyle} aria-hidden />
                <span style={{ fontFamily: MONO, fontSize: 9, color: M.ink3, letterSpacing: ".06em" }}>
                  {String(rows.length).padStart(2, "0")}
                </span>
              </div>
              {rows.map((r, idx) => (
                <button
                  key={r.archive.id}
                  type="button"
                  onClick={() => {
                    setCoreOpen(false);
                    /* 恩熙 2026-09-21：以前写死「本我」，换面具聊完进记忆还是本我那份，
                       看着就像记忆没按面具分区。现在落「当前使用中的面具」。 */
                    setOpenId({ characterId: r.archive.id, maskId: pickMaskFor(r.archive.id) });
                  }}
                  style={personCardStyle(idx)}
                >
                  {/* 页码：压在卡角的浅粉水印，是刊物的页脚。 */}
                  <span style={folioStyle} aria-hidden>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {/* 左缘两枚装订孔，像从活页册上撕下来的一页。 */}
                  <span style={punchStyle("26%")} aria-hidden />
                  <span style={punchStyle("66%")} aria-hidden />
                  {/* 左下角折起一只角，露出纸背的粉。 */}
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: 0,
                      height: 0,
                      zIndex: 2,
                      borderBottom: "18px solid rgba(231,163,177,.55)",
                      borderRight: "18px solid transparent",
                      pointerEvents: "none",
                    }}
                  />
                  <div style={personRowStyle}>
                    <div style={frameStyle}>
                      <div
                        style={{
                          ...avatarStyle,
                          background: r.archive.data.photo
                            ? `url(${r.archive.data.photo}) center/cover`
                            : AVATAR_GRADIENT,
                          color: "#FFF",
                        }}
                      >
                        {r.archive.data.photo ? "" : (r.archive.data.name || "档").charAt(0)}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      {/* 索引号：这册子里的第几号人物页。 */}
                      <span style={{ display: "block", fontFamily: MONO, fontSize: 8, color: M.pinkDeep, letterSpacing: ".14em", marginBottom: 3 }}>
                        №{String(idx + 1).padStart(2, "0")}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={personNameStyle}>
                          {r.archive.data.name || r.archive.data.nickname || "未命名"}
                        </span>
                        {!r.enabled ? <span style={offTagStyle}>已关闭</span> : null}
                      </div>
                      <div style={personRuleStyle} />
                      <div style={personMetaStyle}>
                        {r.bindCount === 0
                          ? "还没开始聊天"
                          : `${r.totalItems} 条记忆${r.bindCount > 1 ? ` · ${r.bindCount} 个身份` : ""}`}
                      </div>
                    </div>
                    <ChevronRight size={14} strokeWidth={1.8} color={M.ink3} />
                  </div>
                </button>
              ))}

              {/* 封底：编目条＋一枚四心贴纸，翻到最后一页的样子。贴纸骑在虚线上，像手账里贴上去的。 */}
              <div
                style={{
                  position: "relative",
                  marginTop: 26,
                  paddingTop: 14,
                  borderTop: `1px dashed ${M.dash}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <Barcode />
                <span style={{ ...enLabelStyle, fontSize: 8, letterSpacing: ".26em" }}>end of archive</span>
                <span style={{ flex: 1 }} />
                <span aria-hidden style={{ position: "absolute", right: 0, top: -8, transform: "rotate(-5deg)" }}>
                  <HeartMark />
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---------------- 详情页 ---------------- */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          backgroundColor: M.bg,
          ...GRAIN,
          transform: openId ? "none" : "translateX(100%)",
          transition: "transform .3s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <div style={{ ...headerStyle, padding: `${headerPad} 12px 14px` }}>
          <button type="button" onClick={back} aria-label="返回" style={btnStyle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div style={{ textAlign: "center", pointerEvents: "none", minWidth: 0 }}>
            <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: ".18em", fontFamily: TITLE }}>{charName}的记忆</span>
            <span style={{ ...enLabelStyle, display: "block", marginTop: 3 }}>layers of memory</span>
          </div>
          <div style={{ width: 44, textAlign: "right", pointerEvents: "none" }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: M.ink, letterSpacing: ".04em" }}>
              {String(detail?.items.length ?? 0).padStart(2, "0")}
            </span>
            <span style={{ ...enLabelStyle, display: "block", marginTop: 2 }}>items</span>
          </div>
          {/* 骑缝虚线（把这页钉成册子里的一帖；四心贴纸只放页脚）。 */}
          <span style={seamStyle} aria-hidden />
        </div>

        <div style={scrollBodyStyle}>
          {detail ? (
            <>
              {/* 面具切换：多绑定，或这张角色名下存在非「本我」的身份时显示——
                  否则只绑一张面具时，进来根本看不出这是谁的记忆。
                  恩熙 2026-09-21。 */}
              {bindChips.length > 1 || bindChips.some((b) => b.maskId !== DEFAULT_MASK_ID) ? (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  {bindChips.map((b) => (
                    <button
                      key={b.maskId}
                      type="button"
                      onClick={() => {
                        setCoreOpen(false);
                        setOpenId({ characterId: openId!.characterId, maskId: b.maskId });
                      }}
                      style={{
                        ...maskChipStyle,
                        background: openId?.maskId === b.maskId ? M.label : M.paper,
                        color: openId?.maskId === b.maskId ? "#FFF" : M.ink2,
                        borderColor: openId?.maskId === b.maskId ? M.label : M.line,
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* 状态卡：四角压上裁切角线，像印厂的开纸标记。 */}
              <div style={{ ...cardStyle, position: "relative" }}>
                <span style={cropStyle("tl")} aria-hidden />
                <span style={cropStyle("tr")} aria-hidden />
                <span style={cropStyle("bl")} aria-hidden />
                <span style={cropStyle("br")} aria-hidden />
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: ".16em", fontFamily: TITLE }}>记忆系统</span>
                        <em style={enLabelStyle}>memory system</em>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            flex: "none",
                            background: detail.enabled ? M.blue : M.ink3,
                          }}
                        />
                        <span style={{ fontSize: 9.8, color: detail.enabled ? M.blue : M.ink3, letterSpacing: ".08em" }}>
                          {detail.enabled ? "运行中 · 会自动浓缩与注入" : "已关闭 · 不浓缩也不注入"}
                        </span>
                      </div>
                    </div>
                    <div onClick={() => void toggleEnabled()} style={switchStyle(detail.enabled)}>
                      <div style={switchKnobStyle(detail.enabled)} />
                    </div>
                  </div>

                  {detail.enabled ? (
                    <>
                      {/* 当前批进度 */}
                      <div style={{ marginTop: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                          <span style={{ fontSize: 9.8, color: M.ink2, letterSpacing: ".12em" }}>距下次整理</span>
                          <span style={{ fontFamily: MONO, fontSize: 10, color: M.ink, letterSpacing: ".06em" }}>
                            {String(detail.newCount).padStart(2, "0")} / {detail.contextLimit}
                          </span>
                        </div>
                        {/* 刻度条：二十格，攒满即整批浓缩，像打表。 */}
                        <div style={{ display: "flex", gap: 2 }}>
                          {Array.from({ length: 20 }).map((_, i) => (
                            <span
                              key={i}
                              style={{
                                flex: 1,
                                height: 8,
                                background:
                                  i < Math.round(Math.min(1, detail.newCount / detail.contextLimit) * 20)
                                    ? M.pinkDeep
                                    : "rgba(27,25,24,.07)",
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ fontSize: 9, color: M.ink3, marginTop: 6, letterSpacing: ".04em" }}>
                          攒满后整批浓缩成短期记忆，进度从头再算（这不是上下文条数）
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                        <button type="button" onClick={() => void runCondense()} disabled={busy} style={primaryBtnStyle}>
                          <Sparkles size={12} strokeWidth={1.6} />
                          {busy ? "归总中…" : "手动归总"}
                        </button>
                        <button type="button" onClick={() => setSettingsOpen((v) => !v)} style={plainBtnStyle}>
                          设置
                        </button>
                        <button type="button" onClick={() => setConfirmWipe(true)} style={dangerBtnStyle}>
                          清空
                        </button>
                      </div>

                      {/* 手动压缩（测试层级细节用；不看阈值，整层压） */}
                      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                        <button type="button" onClick={() => void runCompress("short")} disabled={busy} style={plainBtnStyle}>
                          <ChevronsDown size={12} strokeWidth={1.6} />
                          压缩到中期
                        </button>
                        <button type="button" onClick={() => void runCompress("mid")} disabled={busy} style={plainBtnStyle}>
                          <ChevronsDown size={12} strokeWidth={1.6} />
                          压缩到长期
                        </button>
                      </div>

                      {/* 设置区 */}
                      {settingsOpen ? (
                        <div style={{ marginTop: 12, padding: "10px 12px", border: `1px dashed ${M.dash}`, background: "rgba(27,25,24,.02)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flex: 1, fontSize: 11.5, letterSpacing: ".04em" }}>上下文条数（浓缩触发线）</span>
                            <button type="button" onClick={() => void stepContext(-10)} style={stepBtnStyle} aria-label="减少">
                              <Minus size={13} strokeWidth={2} />
                            </button>
                            <span style={{ fontFamily: MONO, fontSize: 14, minWidth: 34, textAlign: "center", letterSpacing: ".04em" }}>{detail.contextLimit}</span>
                            <button type="button" onClick={() => void stepContext(10)} style={stepBtnStyle} aria-label="增加">
                              <Plus size={13} strokeWidth={2} />
                            </button>
                          </div>
                          <div style={{ height: 1, background: M.lineSoft, margin: "9px 0" }} />
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flex: 1, fontSize: 11.5, letterSpacing: ".04em" }}>自动浓缩（攒满自动归总）</span>
                            <div onClick={() => void toggleAutoCondense()} style={{ ...switchStyle(detail.autoCondense), width: 40, height: 24 }}>
                              <div style={{ ...switchKnobStyle(detail.autoCondense), width: 20, height: 20, left: detail.autoCondense ? 18 : 2 }} />
                            </div>
                          </div>
                          <div style={{ height: 1, background: M.lineSoft, margin: "9px 0" }} />
                          <div style={{ fontSize: 9, color: M.ink3, marginTop: 8, lineHeight: 1.7, letterSpacing: ".04em" }}>
                            每 10 条一步（20–300）。短期攒满 20 条自动压入中期；中期满 10 条压入长期。
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              {/* 分类筛选：单行横滑条（不换行不堆高），分类多时左右滑动查看；
                  六个分类各看各的，短期中期长期一起过滤。
                  右缘渐隐遮罩：右边还有内容时提示「可以滑」，滑到最右自动消失。 */}
              {(detail?.items.length ?? 0) > 0 ? (
                <div style={{ position: "relative", marginTop: 16 }}>
                  <div
                    ref={catScrollRef}
                    className="cat-scroll"
                    onScroll={measureCatHint}
                    style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}
                  >
                    {[["all", "全部", detail?.items.length ?? 0] as [string, string, number], ...Object.entries(
                      CATEGORY_LABEL,
                    ).map(([key, label]) => [key, label, catCounts.get(key) ?? 0] as [string, string, number])].map(
                      ([key, label, count]) => {
                        const on = catFilter === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className="pressable"
                            onClick={() => setCatFilter(key)}
                            style={{
                              display: "inline-flex",
                              flex: "none",
                              alignItems: "center",
                              gap: 7,
                              fontSize: 11.5,
                              letterSpacing: ".14em",
                              borderRadius: 3,
                              padding: "7px 12px",
                              background: on ? M.label : M.paper,
                              color: on ? "#FFF" : M.ink2,
                              border: `1px solid ${on ? M.label : M.line}`,
                              fontWeight: on ? 500 : 400,
                            }}
                          >
                            {label}
                            <span
                              style={{
                                fontSize: 9.5,
                                fontFamily: MONO,
                                minWidth: 16,
                                height: 16,
                                lineHeight: "16px",
                                textAlign: "center",
                                borderRadius: 2,
                                background: on ? "rgba(255,255,255,.20)" : M.pinkWash,
                                color: on ? "#FFF" : M.pinkDeep,
                                padding: "0 4px",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                  {catHint ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 4,
                        width: 32,
                        background: `linear-gradient(to right, transparent, ${M.bg})`,
                        pointerEvents: "none",
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {/* 分层分组 */}
              {groups.map(({ tier, items }) => {
                if (items.length === 0) return null;
                /* 重要记忆默认竖向折起来只露前几条：条数再多也只是一小截，
                   下面的短期记忆照样一眼看得到；要全看再自己点开。 */
                const canFold = tier === "core" && items.length > CORE_PREVIEW;
                const folded = canFold && !coreOpen;
                const shown = folded ? items.slice(0, CORE_PREVIEW) : items;
                return (
                  <div key={tier} style={{ marginTop: 22 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px" }}>
                      {/* 分区号装进一枚粉描边小方块，像贴在页边的分区标。 */}
                      <span
                        aria-hidden
                        style={{
                          alignSelf: "center",
                          flex: "none",
                          fontFamily: MONO,
                          fontSize: 9,
                          lineHeight: 1,
                          color: M.pinkDeep,
                          border: "1px solid rgba(212,117,140,.45)",
                          borderRadius: 2,
                          padding: "4px 5px",
                        }}
                      >
                        {TIER_META[tier].no}
                      </span>
                      <b style={{ fontSize: 13.5, fontWeight: 500, color: tier === "core" ? M.pinkDeep : M.ink, letterSpacing: ".2em", fontFamily: TITLE }}>
                        {TIER_META[tier].title}
                      </b>
                      <em style={enLabelStyle}>{TIER_META[tier].en}</em>
                      <span style={{ flex: 1 }} />
                      {canFold ? (
                        <button
                          type="button"
                          className="pressable"
                          onClick={() => setCoreOpen((v) => !v)}
                          style={foldToggleStyle}
                        >
                          {coreOpen ? "收起 ▴" : `展开全部 ${items.length} 条 ▾`}
                        </button>
                      ) : (
                        <span style={{ fontFamily: MONO, fontSize: 9, color: M.ink2, letterSpacing: ".06em" }}>
                          {String(items.length).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                    {/* 分区线：一道黑、一道粉，像编目页的双框。 */}
                    <div style={{ margin: "7px 2px" }}>
                      <div style={{ height: 1, background: M.ink }} />
                      <div style={{ height: 3 }} />
                      <div style={{ height: 1, background: M.pink }} />
                    </div>
                    <div style={{ fontSize: 9, color: M.ink3, letterSpacing: ".04em", margin: "0 2px 10px" }}>
                      {TIER_META[tier].desc}
                    </div>
                    {shown.map((it) => (
                      <MemoryCard
                        key={it.id}
                        item={it}
                        onEdit={() => setEditing({ id: it.id, content: it.content, category: it.category })}
                        onTogglePin={() =>
                          void (async () => {
                            if (!openId) return;
                            const next = await updateMemoryItem(openId.characterId, openId.maskId, it.id, {
                              important: !it.important,
                              pinnedByUser: !it.important ? true : undefined,
                              tier: !it.important ? "core" : "short",
                            });
                            setDetail(next);
                          })()
                        }
                        onToggleSecret={() =>
                          void (async () => {
                            if (!openId) return;
                            const next = await updateMemoryItem(openId.characterId, openId.maskId, it.id, {
                              secret: !it.secret,
                            });
                            setDetail(next);
                          })()
                        }
                        onToggleGrudge={() =>
                          void (async () => {
                            if (!openId) return;
                            const next = await updateMemoryItem(openId.characterId, openId.maskId, it.id, {
                              grudge: !it.grudge,
                            });
                            setDetail(next);
                          })()
                        }
                        onDelete={() => setConfirmDel(it.id)}
                      />
                    ))}
                    {folded ? (
                      <button
                        type="button"
                        className="pressable"
                        onClick={() => setCoreOpen(true)}
                        style={{ ...foldToggleStyle, display: "block", width: "100%", padding: "9px 0", color: M.ink2, textAlign: "center" }}
                      >
                        · 还有 {items.length - CORE_PREVIEW} 条 ·
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {/* 第五编 · 朋友圈动态（恩熙 2026-09-21 点名要的栏位）：
                  动态不来自聊天记录浓缩，所以不混进上面四层，单独成编列在最后。
                  抬头写明来源，一眼看得出哪些是聊天里说过的、哪些是 TA 发在朋友圈的。 */}
              <div style={{ marginTop: 22 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px" }}>
                  <span
                    aria-hidden
                    style={{
                      alignSelf: "center",
                      flex: "none",
                      fontFamily: MONO,
                      fontSize: 9,
                      lineHeight: 1,
                      color: M.pinkDeep,
                      border: "1px solid rgba(212,117,140,.45)",
                      borderRadius: 2,
                      padding: "4px 5px",
                    }}
                  >
                    {MOMENT_META.no}
                  </span>
                  <b style={{ fontSize: 13.5, fontWeight: 500, color: M.ink, letterSpacing: ".2em", fontFamily: TITLE }}>
                    {MOMENT_META.title}
                  </b>
                  <em style={enLabelStyle}>{MOMENT_META.en}</em>
                  <span style={{ flex: 1 }} />
                  {moments.length > MOMENT_PREVIEW ? (
                    <button
                      type="button"
                      className="pressable"
                      onClick={() => setMomentOpen((v) => !v)}
                      style={foldToggleStyle}
                    >
                      {momentOpen ? "收起 ▴" : `展开全部 ${moments.length} 条 ▾`}
                    </button>
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 9, color: M.ink2, letterSpacing: ".06em" }}>
                      {String(moments.length).padStart(2, "0")}
                    </span>
                  )}
                </div>
                {/* 分区线：跟上面几层同一套双线，看着是一本册子。 */}
                <div style={{ margin: "7px 2px" }}>
                  <div style={{ height: 1, background: M.ink }} />
                  <div style={{ height: 3 }} />
                  <div style={{ height: 1, background: M.pink }} />
                </div>
                <div style={{ fontSize: 9, color: M.ink3, letterSpacing: ".04em", margin: "0 2px 10px" }}>
                  {MOMENT_META.desc}
                </div>
                {moments.length === 0 ? (
                  <div style={{ fontSize: 10.5, color: M.ink3, letterSpacing: ".05em", margin: "0 2px" }}>
                    TA 还没发过朋友圈动态
                  </div>
                ) : (
                  <>
                    {/* 折起来的时候只露最近几条（`recent` 已经是新→旧）；点开才把标了重要的
                        跟「更早的那批」也摊出来。 */}
                    {(momentOpen
                      ? [...momentView.pinned, ...momentView.recent]
                      : momentView.recent.slice(0, MOMENT_PREVIEW)
                    ).map((mo) => (
                      <div key={mo.id} style={{ ...cardStyle, padding: "10px 12px 11px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={timeStyle}>{momentStamp(mo.createdAt)}</span>
                          {/* 恩熙自己标了「重要」的那条：永远原文留在 TA 脑子里，这儿星标出来。
                              恩熙 2026-09-21：「那朋友圈是不是也要有一个能够标记为重要 的功能呢？」 */}
                          {mo.pinnedByUser ? (
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 9,
                                color: M.pinkDeep,
                                letterSpacing: ".08em",
                              }}
                            >
                              ★ 重要
                            </span>
                          ) : null}
                        </div>
                        <p style={{ ...itemTextStyle, marginTop: 5 }}>{mo.content}</p>
                        {/* 图文动态：TA 当时写下的画面描述也列出来，跟注入给 TA 的那一行对得上。
                            纯文字动态没有这段。恩熙 2026-09-21：「如果他是发的图文，
                            那他图片应该也要有文字描述写进去」。 */}
                        {mo.imagePrompt?.trim() ? (
                          <p style={{ ...itemTextStyle, marginTop: 4, fontSize: 10.5, color: M.ink3 }}>
                            （配图：{mo.imagePrompt.trim()}）
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {momentOpen ? (
                      <>
                        {/* 攒够该压、还没到压缩时机的那几条：TA 只被告知了条数，这里说清楚，
                            免得以为「页面上明明列着、TA 怎么不记得」。 */}
                        {momentView.unlisted > 0 ? (
                          <div style={{ fontSize: 9, color: M.ink3, letterSpacing: ".04em", margin: "2px 2px 0" }}>
                            再往前的 {momentView.unlisted} 条，只把条数报给了 TA
                          </div>
                        ) : null}
                        {/* 最早的那批已经压成一段印象，TA 心里就剩这么点大概。
                            恩熙 2026-09-21：「我肯定不会记得我上个月发的朋友圈内容写了什么」。 */}
                        {momentView.digest ? (
                          <div
                            style={{
                              ...cardStyle,
                              margin: "10px 0 0",
                              padding: "10px 12px 11px",
                              background: M.pinkWash,
                            }}
                          >
                            <span style={timeStyle}>最早的 {momentView.coveredCount} 条</span>
                            <p style={{ ...itemTextStyle, marginTop: 5, color: M.ink2 }}>
                              只记得个大概：{momentView.digest}
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {/* 页脚：编目条＋刊号＋一枚四心贴纸，这一帖到此为止。贴纸骑在虚线上。
                  有动态也算「有内容」——不然只发过动态、还没攒下记忆的角色，这一编底下光秃秃的。 */}
              {detail.items.length > 0 || moments.length > 0 ? (
                <div
                  style={{
                    position: "relative",
                    marginTop: 26,
                    paddingTop: 14,
                    borderTop: `1px dashed ${M.dash}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                  }}
                >
                  <Barcode />
                  <span style={{ ...enLabelStyle, fontSize: 8, letterSpacing: ".26em" }}>vol.01 · catalogue</span>
                  <span style={{ flex: 1 }} />
                  <span aria-hidden style={{ position: "absolute", right: 0, top: -8, transform: "rotate(-5deg)" }}>
                    <HeartMark />
                  </span>
                </div>
              ) : null}

              {detail.items.length === 0 ? (
                <div style={{ ...emptyWrap, paddingTop: 40 }}>
                  <div style={{ fontSize: 12.5, color: M.ink2, letterSpacing: ".1em" }}>还没有记忆</div>
                  <div style={{ marginTop: 8, fontSize: 11, color: M.ink3, letterSpacing: ".05em" }}>
                    聊几句之后，点上面的「手动归总」试试
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* 编辑弹层 */}
      {editing ? (
        <div style={modalMaskStyle} onClick={() => setEditing(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>编辑记忆</div>
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              style={textareaStyle}
              maxLength={200}
              autoFocus
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }}>
              {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditing({ ...editing, category: key })}
                  style={{
                    ...catChipStyle,
                    background: editing.category === key ? M.label : M.paper,
                    color: editing.category === key ? "#FFF" : M.ink2,
                    border: `1px solid ${editing.category === key ? M.label : M.line}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={modalBtnRowStyle}>
              <button type="button" onClick={() => setEditing(null)} style={modalCancelStyle}>
                取消
              </button>
              <button type="button" onClick={() => void saveEdit()} style={modalOkStyle}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除确认 */}
      {confirmDel ? (
        <div style={modalMaskStyle} onClick={() => setConfirmDel(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>删除这条记忆</div>
            <div style={modalDescStyle}>
              {charName} 会彻底忘掉这件事，无法恢复。
            </div>
            <div style={modalBtnRowStyle}>
              <button type="button" onClick={() => setConfirmDel(null)} style={modalCancelStyle}>
                取消
              </button>
              <button type="button" onClick={() => void removeItem()} style={modalOkDangerStyle}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 清空确认 */}
      {confirmWipe ? (
        <div style={modalMaskStyle} onClick={() => setConfirmWipe(false)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>清空全部记忆</div>
            <div style={modalDescStyle}>
              {charName} 的全部记忆和聊天记录都会被清掉，无法恢复。
            </div>
            <div style={modalBtnRowStyle}>
              <button type="button" onClick={() => setConfirmWipe(false)} style={modalCancelStyle}>
                取消
              </button>
              <button type="button" onClick={() => void wipeAll()} style={modalOkDangerStyle}>
                清空
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* toast */}
      {toast ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(var(--safe-area-bottom, 0px) + 30px)",
            transform: "translateX(-50%) rotate(-1.2deg)",
            zIndex: 90,
            background: M.label,
            color: "#FFF",
            fontSize: 11,
            letterSpacing: ".14em",
            padding: "8px 16px",
            borderRadius: 2,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- 样式 ----------------------------- */

/* 刊头：底透出纸纹，下面压一道双线（再压一道骑缝虚线，见 seamStyle）。 */
const headerStyle: CSSProperties = {
  position: "relative",
  flex: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "transparent",
  borderBottom: `3px double rgba(27,25,24,.18)`,
};

const btnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: M.ink,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  flex: "none",
};

/* 装饰英文：全大写、小字号、大字距——只当纹样，不当信息。 */
const enLabelStyle: CSSProperties = {
  fontFamily: EN,
  fontStyle: "normal",
  fontSize: 8.5,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: ".32em",
  color: M.ink3,
};

/* 骑缝虚线：刊头双线之下再压一道，像册子的装订缝。 */
const seamStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: -4,
  height: 1,
  backgroundImage: "repeating-linear-gradient(to right, rgba(27,25,24,.16) 0 4px, transparent 4px 9px)",
  pointerEvents: "none",
  zIndex: 3,
};

/* 四心小标：像素心四连，一一二三四，像贴上去的一条贴纸。只在两处页脚出现。 */
const heartMarkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  opacity: 0.88,
  flex: "none",
  pointerEvents: "none",
  userSelect: "none",
};

/** 像素心：7×6 格方块堆出来的爱心——全是直线和直角，一处圆弧都没有。 */
const PIXEL_HEART_PATH =
  "M1 0h2v1H1zM4 0h2v1H4zM0 1h7v1H0zM0 2h7v1H0zM1 3h5v1H1zM2 4h3v1H2zM3 5h1v1H3z";

/* 裁切角线：只描一只角，像印厂的开纸标记。 */
const cropStyle = (corner: "tl" | "tr" | "bl" | "br"): CSSProperties => {
  const base: CSSProperties = {
    position: "absolute",
    width: 8,
    height: 8,
    borderStyle: "solid",
    borderColor: "rgba(212,117,140,.5)",
    pointerEvents: "none",
  };
  if (corner === "tl") return { ...base, top: 4, left: 4, borderWidth: "1.5px 0 0 1.5px" };
  if (corner === "tr") return { ...base, top: 4, right: 4, borderWidth: "1.5px 1.5px 0 0" };
  if (corner === "bl") return { ...base, bottom: 4, left: 4, borderWidth: "0 0 1.5px 1.5px" };
  return { ...base, bottom: 4, right: 4, borderWidth: "0 1.5px 1.5px 0" };
};

/* 装订孔：活页左缘的圆孔，透出纸底色。 */
const punchStyle = (top: string): CSSProperties => ({
  position: "absolute",
  left: 9,
  top,
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: M.bg,
  boxShadow: "inset 0 1px 1.5px rgba(27,25,24,.22)",
  pointerEvents: "none",
});

/* 目录点线：把左边的字引到右边那个数字上。 */
const leaderStyle: CSSProperties = {
  flex: 1,
  minWidth: 12,
  borderBottom: `1px dotted ${M.dash}`,
  transform: "translateY(-3px)",
  margin: "0 4px",
};

/* 条形码：封底的编目条，纯装饰。 */
const barcodeStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 2,
  height: 15,
  opacity: 0.55,
  flex: "none",
};
const BARCODE = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 3, 1];

const scrollBodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: "14px 14px calc(var(--safe-area-bottom, 0px) + 24px)",
};

/* 编者按：左侧一道粉色竖线，像刊物开篇的引文。 */
const editorNoteStyle: CSSProperties = {
  margin: "0 2px 18px",
  paddingLeft: 10,
  borderLeft: `2px solid ${M.pink}`,
  fontSize: 10.5,
  color: M.ink2,
  letterSpacing: ".06em",
  lineHeight: 1.9,
};

/* 人物页卡：方角＋硬边错位投影；左缘一道粉编目条，单双页往反向微旋，像贴上去的一叠册页。 */
const personCardStyle = (idx: number): CSSProperties => ({
  position: "relative",
  display: "block",
  width: "100%",
  overflow: "hidden",
  textAlign: "left",
  background: M.paper,
  border: `1px solid ${M.line}`,
  borderLeft: `4px solid ${M.pink}`,
  boxShadow: OFFSET_SHADOW,
  padding: "15px 14px",
  marginBottom: 13,
  cursor: "pointer",
  fontFamily: SERIF,
  transform: idx % 2 === 0 ? "rotate(-.55deg)" : "rotate(.55deg)",
});

/* 卡内横排：相框 + 名字 + 页码，压在页码水印之上。 */
const personRowStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 14,
};

/* 页码：等宽大字，浅粉水印压在卡角，是整册的页脚。 */
const folioStyle: CSSProperties = {
  position: "absolute",
  right: 9,
  bottom: 1,
  zIndex: 0,
  fontFamily: MONO,
  fontSize: 46,
  lineHeight: 1,
  color: "rgba(231,163,177,.30)",
  letterSpacing: ".02em",
  pointerEvents: "none",
  userSelect: "none",
};

/* 人名：整张卡的主角，书写体大字——像编者亲手写下的，不是印上去的。 */
const personNameStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 500,
  letterSpacing: ".1em",
  color: M.ink,
  fontFamily: TITLE,
};

/* 名字底下压一道粉短横，像刊物人物页的分隔。 */
const personRuleStyle: CSSProperties = {
  width: 30,
  height: 2,
  background: M.pink,
  margin: "8px 0",
};

/* 编目行：条数／身份数。 */
const personMetaStyle: CSSProperties = {
  fontSize: 10,
  color: M.ink3,
  letterSpacing: ".08em",
};

/* 照片：整张人物页的主角，够大才立得住。 */
const avatarStyle: CSSProperties = {
  flex: "none",
  width: 76,
  height: 76,
  borderRadius: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 26,
  fontWeight: 600,
  overflow: "hidden",
};

/* 相框：白边＋虚线外框，微微歪一点，像贴上去的证件照。 */
const frameStyle: CSSProperties = {
  flex: "none",
  padding: 3,
  background: "#FFF",
  border: `1px dashed ${M.dash}`,
  transform: "rotate(-1.6deg)",
};

const offTagStyle: CSSProperties = {
  fontSize: 8.5,
  color: M.ink3,
  border: `1px dashed ${M.dash}`,
  padding: "1px 5px",
  letterSpacing: ".12em",
};

/* 编目卡：方角＋硬边错位投影，卡与卡之间留一条缝。 */
const cardStyle: CSSProperties = {
  background: M.paper,
  border: `1px solid ${M.line}`,
  boxShadow: OFFSET_SHADOW,
  marginBottom: 8,
};

/* 分类＝樱花粉标签贴（1.0.78 起由黑改粉），歪一点，像贴上去的。 */
const catChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 9,
  color: "#FFF",
  background: M.pinkDeep,
  borderRadius: 2,
  padding: "2.5px 7px",
  letterSpacing: ".14em",
  transform: "rotate(-1.8deg)",
};

/* 状态＝戳记，只留细边，不填色。 */
const statusChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 8.5,
  borderRadius: 2,
  padding: "2px 6px",
  letterSpacing: ".12em",
  border: `1px solid ${M.line}`,
};

/* 日期戳：一律等宽，像打上去的。 */
const timeStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9,
  color: M.ink3,
  letterSpacing: ".02em",
};

const itemTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  lineHeight: 1.95,
  letterSpacing: ".03em",
  color: M.ink,
};

/* 卡内操作：不描边框，只靠字距和图标，像书页边上的小字。 */
const actBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 9.5,
  color: M.ink2,
  letterSpacing: ".1em",
  padding: "4px 7px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: SERIF,
};

const maskChipStyle: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: ".12em",
  padding: "5px 12px",
  borderRadius: 2,
  border: `1px solid ${M.line}`,
  cursor: "pointer",
  fontFamily: SERIF,
};

/* 开关：开＝天蓝（全册唯一的对比色，语义就是「在运转」）。 */
const switchStyle = (on: boolean): CSSProperties => ({
  width: 46,
  height: 27,
  borderRadius: 14,
  background: on ? M.blue : "rgba(27,25,24,.13)",
  position: "relative",
  transition: "background .2s",
  flex: "none",
  cursor: "pointer",
});

const switchKnobStyle = (on: boolean): CSSProperties => ({
  position: "absolute",
  top: 2,
  left: on ? 21 : 2,
  width: 23,
  height: 23,
  borderRadius: "50%",
  background: "#FFF",
  boxShadow: "0 2px 5px rgba(27,25,24,.25)",
  transition: "left .2s",
});

/* 主按钮＝樱花粉实底（原先是黑标签贴，2026-09-18 恩熙说「手动汇总感觉得换一个颜色」）。 */
const primaryBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  color: "#FFF",
  letterSpacing: ".14em",
  padding: "6px 12px",
  borderRadius: 2,
  border: `1px solid ${M.pinkDeep}`,
  background: M.pinkDeep,
  cursor: "pointer",
  fontFamily: SERIF,
};

const plainBtnStyle: CSSProperties = {
  fontSize: 10.5,
  color: M.ink2,
  letterSpacing: ".12em",
  padding: "6px 12px",
  borderRadius: 2,
  border: `1px solid ${M.line}`,
  background: "transparent",
  cursor: "pointer",
  fontFamily: SERIF,
};

/** 「展开全部／收起」——轻量文字按钮，压在分层小标题右端（重要记忆、朋友圈动态共用）。 */
const foldToggleStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9,
  color: M.pinkDeep,
  letterSpacing: ".06em",
  padding: 0,
  border: "none",
  background: "none",
};

const dangerBtnStyle: CSSProperties = {
  fontSize: 10.5,
  color: M.red,
  letterSpacing: ".12em",
  padding: "6px 12px",
  borderRadius: 2,
  border: "1px solid rgba(194,84,79,.38)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: SERIF,
};

const stepBtnStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: M.ink2,
  border: `1px solid ${M.line}`,
  background: M.paper,
  cursor: "pointer",
};

const emptyWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0 30px 40px",
  textAlign: "center",
};

/* 空页：一枚虚线方框，像还没贴照片的相框。 */
const emptyCircle: CSSProperties = {
  width: 62,
  height: 62,
  borderRadius: 2,
  border: `1px dashed ${M.dash}`,
  background: "#FFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: M.pinkDeep,
  transform: "rotate(-2deg)",
};

const modalMaskStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 80,
  background: "rgba(27,25,24,.42)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 30,
};

/* 弹层＝一张压在册子上的纸：方角、顶上压一道黑边、底下再压一道粉骑缝，右下错位投影。 */
const modalCardStyle: CSSProperties = {
  width: 300,
  maxHeight: "80%",
  overflowY: "auto",
  background: M.paper,
  /* 黑边之下的粉色骑缝虚线：用背景画，不占版面。 */
  backgroundImage: "repeating-linear-gradient(to right, rgba(212,117,140,.6) 0 5px, transparent 5px 10px)",
  backgroundSize: "100% 1px",
  backgroundPosition: "0 7px",
  backgroundRepeat: "no-repeat",
  border: `1px solid ${M.line}`,
  borderTop: `4px solid ${M.label}`,
  padding: "18px 18px 14px",
  textAlign: "center",
  boxShadow: `6px 6px 0 rgba(27,25,24,.10), 0 18px 40px rgba(27,25,24,.18)`,
};

const modalTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: ".2em",
  fontFamily: TITLE,
};

const modalDescStyle: CSSProperties = {
  fontSize: 11,
  color: M.ink2,
  lineHeight: 1.9,
  letterSpacing: ".04em",
  margin: "10px 0 16px",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  marginTop: 14,
  minHeight: 90,
  borderRadius: 2,
  border: `1px solid ${M.dash}`,
  background: "#FFF",
  padding: "10px 12px",
  fontSize: 12,
  lineHeight: 1.9,
  letterSpacing: ".03em",
  fontFamily: SERIF,
  color: M.ink,
  outline: "none",
  resize: "vertical",
};

const modalBtnRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
};

const modalCancelStyle: CSSProperties = {
  flex: 1,
  padding: "9px 0",
  borderRadius: 2,
  border: `1px solid ${M.line}`,
  background: "transparent",
  color: M.ink2,
  fontSize: 12,
  letterSpacing: ".16em",
  cursor: "pointer",
  fontFamily: SERIF,
};

const modalOkStyle: CSSProperties = {
  flex: 1,
  padding: "9px 0",
  borderRadius: 2,
  border: "none",
  background: M.label,
  color: "#FFF",
  fontSize: 12,
  letterSpacing: ".16em",
  cursor: "pointer",
  fontFamily: SERIF,
};

const modalOkDangerStyle: CSSProperties = {
  flex: 1,
  padding: "9px 0",
  borderRadius: 2,
  border: "none",
  background: M.red,
  color: "#FFF",
  fontSize: 12,
  letterSpacing: ".16em",
  cursor: "pointer",
  fontFamily: SERIF,
};
