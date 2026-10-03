"use client";

/**
 * 正则规则管理（1.4.11）：设置 App 里「正则规则」的整块界面。
 *
 * 两级页面：
 * - 列表页：一条规则一行（总开关＋名字＋查找正则缩略＋作用位小标签），
 *   点行进编辑；新建／导入／导出。
 * - 编辑页：名字／查找正则（写错当场标红）／替换成／三个作用位开关／
 *   测试框（贴一段示例文字，实时看替换结果与命中次数）／保存／删除。
 *
 * 皮跟设置 App 同一套（pop-style 的白卡黑描边硬阴影）；数据全部走
 * regexRules.ts 的引擎接口，这里只管界面，不碰聊天流（接线在 1.4.12）。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { AppChrome } from "@/components/phone/apps/AppChrome";
import {
  POP_CARD,
  POP_INK,
  POP_PRESS,
  POP_TONE,
  type PopTone,
} from "@/components/phone/apps/pop-style";
import {
  PLACEMENTS,
  blankRegexRule,
  loadRegexRules,
  parseRegexRules,
  saveRegexRules,
  serializeRegexRules,
  testRegexRule,
  validateRegexSource,
  type RegexCtx,
} from "@/lib/chat/regexRules";
import { uuid } from "@/lib/uuid";
import type { RegexPlacement, RegexRule } from "@/types/regex";

/* ---------------------- 贴纸皮通用小件（本文件私有） ---------------------- */

/** 输入框：黑描边，聚焦时浮一层硬阴影（贴纸的「抬起来」）。 */
const INPUT =
  "w-full rounded-[12px] border-2 border-[#141414] bg-white px-3 py-2 text-[13px] font-medium text-[#141414] placeholder:text-[#B0AEA8] focus:outline-none focus:shadow-[3px_3px_0_#141414]";
/** 正则／JSON 用的等宽款（符号多，等宽好认）。 */
const INPUT_MONO = INPUT + " font-mono text-[12px] leading-relaxed";

/** 小节标签（照设置页 SettingGroup 的撞色标签，缩小一号）。 */
function SectionTag({ tone, children }: { tone: PopTone; children: ReactNode }) {
  return (
    <span
      className="mb-2 inline-block rounded-full border-2 border-[#141414] px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide shadow-[2px_2px_0_#141414]"
      style={{ background: POP_TONE[tone], color: POP_INK }}
    >
      {children}
    </span>
  );
}

/** 右箭头（这一行可以点的提示；跟设置页同款）。 */
function Chevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-[#141414]"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** 作用位 → 撞色（小标签用，固定配色）。 */
const PLACEMENT_TONE: Record<RegexPlacement, PopTone> = {
  aiOutput: "orange",
  aiOutputDisplay: "purple",
  userInput: "blue",
};

/** 作用位小标签（列表行右侧那几枚）。 */
function PlacementChip({ p }: { p: RegexPlacement }) {
  const meta = PLACEMENTS.find((x) => x.key === p);
  return (
    <span
      className="flex-none rounded-full border-2 border-[#141414] px-2 py-0.5 text-[9px] font-extrabold"
      style={{ background: POP_TONE[PLACEMENT_TONE[p]], color: POP_INK }}
    >
      {meta?.label ?? p}
    </span>
  );
}

/** 小开关（设置页 ToggleItem 的开关缩小一号；点击自带 stopPropagation）。 */
function MiniSwitch({
  on,
  onFlip,
  label,
}: {
  on: boolean;
  onFlip?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onFlip?.();
      }}
      className={`relative h-6 w-[44px] flex-none rounded-full border-2 border-[#141414] ${
        on ? "bg-[#D9F24D]" : "bg-[#E9E7E1]"
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full border-2 border-[#141414] bg-white transition-transform duration-200 ${
          on ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ----------------------------- 编辑页 ----------------------------- */

/** 测试框里的名字占位：{{user}}／{{char}} 宏在测试时换成这两个。 */
const TEST_CTX: RegexCtx = { userName: "我", charName: "TA" };

function RuleEditor({
  initial,
  onSave,
  onDelete,
}: {
  initial: RegexRule;
  onSave: (rule: RegexRule) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<RegexRule>(initial);
  const [sample, setSample] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* 写错当场标红：查找正则实时编译校验。 */
  const regexError = useMemo(
    () => (draft.findRegex.trim() ? validateRegexSource(draft.findRegex) : null),
    [draft.findRegex],
  );
  /* 测试框：贴一段示例文字，实时看替换结果与命中几次。 */
  const test = useMemo(
    () => (sample.trim() && draft.findRegex.trim() ? testRegexRule(draft, sample, TEST_CTX) : null),
    [draft, sample],
  );
  const canSave = Boolean(draft.findRegex.trim()) && !regexError;

  const patch = (p: Partial<RegexRule>) => setDraft((d) => ({ ...d, ...p }));
  const flipPlacement = (key: RegexPlacement) =>
    setDraft((d) => ({
      ...d,
      placement: d.placement.includes(key)
        ? d.placement.filter((x) => x !== key)
        : [...d.placement, key],
    }));

  return (
    <div className="pb-6">
      {/* 名字 */}
      <section className="mb-5">
        <SectionTag tone="lemon">名字</SectionTag>
        <input
          className={INPUT}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="给这条规则起个名，如「删星号动作」"
          maxLength={30}
        />
      </section>

      {/* 查找 */}
      <section className="mb-5">
        <SectionTag tone="blue">查找（正则）</SectionTag>
        <textarea
          rows={2}
          className={INPUT_MONO + (regexError ? " border-[#FF5A4D]" : "")}
          value={draft.findRegex}
          onChange={(e) => patch({ findRegex: e.target.value })}
          placeholder={"\\*[^*\\n]+\\*  ← 例子：匹配 *笑着摆摆手* 这样的星号段"}
        />
        {regexError && (
          <p className="mt-1.5 text-[11px] font-bold text-[#FF5A4D]">{regexError}</p>
        )}
      </section>

      {/* 替换 */}
      <section className="mb-5">
        <SectionTag tone="pink">替换成</SectionTag>
        <input
          className={INPUT_MONO}
          value={draft.replaceString}
          onChange={(e) => patch({ replaceString: e.target.value })}
          placeholder="留空＝删掉匹配到的 · 可用 $1 引用括号分组、{{match}} 匹配原文"
        />
      </section>

      {/* 选项：大小写＋高级清理（trimStrings，平时留空） */}
      <section className="mb-5">
        <SectionTag tone="purple">选项</SectionTag>
        <div className={POP_CARD}>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[#141414]">不分大小写</div>
              <div className="mt-0.5 text-[10px] font-medium text-[#8C8C8C]">
                改英文时「Hello」也能匹配「hello」；中文没有大小写，开了也没影响
              </div>
            </div>
            <MiniSwitch
              on={draft.caseInsensitive === true}
              onFlip={() => patch({ caseInsensitive: !(draft.caseInsensitive === true) })}
              label="不分大小写"
            />
          </div>
          <div className="border-t-2 border-dashed border-[#EDEAE2] px-4 py-3">
            <div className="text-[13px] font-bold text-[#141414]">先删掉这些字样（高级）</div>
            <div className="mt-0.5 text-[10px] font-medium text-[#8C8C8C]">
              匹配到的原文里先删掉这些字样再替换（每行一条；配合 &#123;&#123;match&#125;&#125; 用，平时留空）
            </div>
            {/* onChange 只按行拆、不滤空行——滤了会吃掉刚敲的回车，打不了第二行；
                空行由引擎执行时自己跳过。 */}
            <textarea
              rows={2}
              className={INPUT_MONO + " mt-2"}
              value={(draft.trimStrings ?? []).join("\n")}
              onChange={(e) => patch({ trimStrings: e.target.value.split("\n") })}
              placeholder="每行一条，比如：动作："
            />
          </div>
        </div>
      </section>

      {/* 作用位 */}
      <section className="mb-5">
        <SectionTag tone="orange">在哪生效</SectionTag>
        <div className={POP_CARD}>
          {PLACEMENTS.map((p, i) => (
            <div
              key={p.key}
              className={`flex items-center gap-3 px-4 py-3 ${
                i > 0 ? "border-t-2 border-dashed border-[#EDEAE2]" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-[#141414]">{p.label}</div>
                <div className="mt-0.5 text-[10px] font-medium text-[#8C8C8C]">{p.hint}</div>
              </div>
              <MiniSwitch
                on={draft.placement.includes(p.key)}
                onFlip={() => flipPlacement(p.key)}
                label={p.label}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 测试 */}
      <section className="mb-6">
        <SectionTag tone="mint">试一试</SectionTag>
        <textarea
          rows={3}
          className={INPUT_MONO}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="贴一段示例文字（比如 TA 说过的带 *动作* 的一句话），下面立刻看替换结果"
        />
        {test && (
          <div className="mt-2 rounded-[12px] border-2 border-[#141414] bg-[#F6F9F4] px-3 py-2.5">
            <div className="mb-1 text-[10px] font-extrabold text-[#141414]">
              {test.error ? (
                <span className="text-[#FF5A4D]">{test.error}</span>
              ) : (
                `命中 ${test.matchCount} 处 · 替换后：`
              )}
            </div>
            <div className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[#141414]">
              {test.output || "（替换后变成空的）"}
            </div>
          </div>
        )}
        <p className="mt-1.5 text-[10px] font-medium text-[#B0AEA8]">
          {`测试时 {{user}} 换成「我」、{{char}} 换成「TA」；真正聊天时用你们真实的名字。`}
        </p>
      </section>

      {/* 保存／删除 */}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(draft)}
          className={`flex h-12 flex-1 items-center justify-center rounded-[14px] border-2 border-[#141414] text-[14px] font-extrabold ${
            canSave
              ? `${POP_PRESS} bg-[#D9F24D] text-[#141414] shadow-[4px_4px_0_#141414]`
              : "bg-[#E9E7E1] text-[#B0AEA8]"
          }`}
        >
          保存这条规则
        </button>
        <button
          type="button"
          onClick={() => (confirmDelete ? onDelete(draft.id) : setConfirmDelete(true))}
          className={`flex h-12 flex-none items-center justify-center gap-1.5 rounded-[14px] border-2 border-[#141414] px-4 text-[12px] font-extrabold ${POP_PRESS} shadow-[4px_4px_0_#141414]`}
          style={{ background: confirmDelete ? POP_TONE.red : "#FFFFFF", color: POP_INK }}
        >
          <Trash2 size={16} strokeWidth={2.4} />
          {confirmDelete ? "再点一次确认" : "删除"}
        </button>
      </div>
      {!canSave && (
        <p className="mt-2 text-center text-[10px] font-medium text-[#B0AEA8]">
          {regexError ? "把查找正则改对就能保存" : "先写查找正则才能保存"}
        </p>
      )}
    </div>
  );
}

/* --------------------------- 导入导出弹层 --------------------------- */

function ShareSheet({
  rules,
  onImport,
  onClose,
}: {
  rules: RegexRule[];
  onImport: (added: RegexRule[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const exportText = useMemo(
    () => (rules.length > 0 ? serializeRegexRules(rules) : ""),
    [rules],
  );

  const doImport = () => {
    try {
      /* 全部换新 id 再追加：同一份文件导两次也只是多两份，不会互相覆盖。 */
      const added = parseRegexRules(text).map((r) => ({ ...r, id: uuid() }));
      onImport(added);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-5"
      onClick={onClose}
    >
      <div
        className={POP_CARD + " max-h-[82vh] w-full max-w-[420px] overflow-y-auto p-5"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold text-[#141414]">分享规则</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className={
              POP_PRESS + " rounded-full border-2 border-[#141414] bg-white p-1.5 shadow-[2px_2px_0_#141414]"
            }
          >
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>

        {/* 导出 */}
        <SectionTag tone="blue">导出</SectionTag>
        {exportText ? (
          <textarea
            readOnly
            rows={6}
            className={INPUT_MONO}
            value={exportText}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          <p className="rounded-[12px] border-2 border-dashed border-[#D8D5CE] px-3 py-3 text-[11px] font-medium text-[#8C8C8C]">
            还没有规则可导出——先建一条吧。
          </p>
        )}
        <p className="mb-4 mt-1.5 text-[10px] font-medium text-[#B0AEA8]">
          点一下文本框会全选，复制发给别人。
        </p>

        {/* 导入 */}
        <SectionTag tone="orange">导入</SectionTag>
        <textarea
          rows={6}
          className={INPUT_MONO}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="把别人分享的规则文本整段粘贴到这里"
        />
        {error && <p className="mt-1.5 text-[11px] font-bold text-[#FF5A4D]">{error}</p>}
        <button
          type="button"
          disabled={!text.trim()}
          onClick={doImport}
          className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[#141414] text-[13px] font-extrabold ${
            text.trim()
              ? `${POP_PRESS} bg-[#6BE3B8] text-[#141414] shadow-[3px_3px_0_#141414]`
              : "bg-[#E9E7E1] text-[#B0AEA8]"
          }`}
        >
          <Upload size={15} strokeWidth={2.4} />
          导入这些规则
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ 主组件 ------------------------------ */

export function RegexManager({ onExit }: { onExit: () => void }) {
  /* null＝还在读库，读完了才有列表（首帧不闪「空状态」）。 */
  const [rules, setRules] = useState<RegexRule[] | null>(null);
  const [editing, setEditing] = useState<RegexRule | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    void loadRegexRules().then(setRules);
  }, []);

  /** 先动界面再落库：写失败也只是下次进来回到旧值，不至于点不动。 */
  const persist = (next: RegexRule[]) => {
    setRules(next);
    void saveRegexRules(next);
  };

  /* ---------- 编辑页 ---------- */
  if (editing) {
    return (
      <AppChrome
        title="编辑规则"
        titleEn="REGEX RULE"
        theme="pop"
        onBack={() => setEditing(null)}
      >
        <RuleEditor
          initial={editing}
          onSave={(saved) => {
            const list = rules ?? [];
            const idx = list.findIndex((r) => r.id === saved.id);
            persist(idx >= 0 ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]);
            setEditing(null);
          }}
          onDelete={(id) => {
            persist((rules ?? []).filter((r) => r.id !== id));
            setEditing(null);
          }}
        />
      </AppChrome>
    );
  }

  /* ---------- 列表页 ---------- */
  const list = rules ?? [];
  return (
    <AppChrome title="正则规则" titleEn="REGEX" theme="pop" onBack={onExit}>
      {/* 说明卡 */}
      <div className={POP_CARD + " mb-5 px-4 py-3.5"}>
        <p className="text-[11px] font-medium leading-relaxed text-[#5A5750]">
          {"正则规则＝自动查找替换：TA 回复里的 "}
          <span className="font-mono">*星号动作*</span>
          {" 删掉、某个词换成别的写法，都能让程序自动做。默认一条都没有，想用就在下面建。"}
        </p>
      </div>

      {/* 规则列表 */}
      <section className="mb-5">
        <SectionTag tone="orange">{`规则（${list.length}）`}</SectionTag>
        {list.length === 0 ? (
          <div className={POP_CARD + " px-4 py-5"}>
            <p className="text-[12px] font-bold text-[#141414]">还没有规则</p>
            <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-[#8C8C8C]">
              {"想试试的话：新建一条，查找填 "}
              <span className="font-mono">{"\\*[^*\\n]+\\*"}</span>
              {"、替换留空、勾上「TA 的回复」——TA 以后说的 *星号动作* 就自动消失了。"}
            </p>
          </div>
        ) : (
          <div className={POP_CARD + " overflow-hidden"}>
            {list.map((r, i) => (
              <div
                key={r.id}
                onClick={() => setEditing(r)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 active:bg-[#FFF4DC] ${
                  i > 0 ? "border-t-2 border-dashed border-[#EDEAE2]" : ""
                }`}
              >
                <MiniSwitch
                  on={!r.disabled}
                  onFlip={() =>
                    persist(
                      list.map((x) => (x.id === r.id ? { ...x, disabled: !x.disabled } : x)),
                    )
                  }
                  label={`${r.name || "未命名规则"}总开关`}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      "truncate text-[13px] font-bold " +
                      (r.disabled ? "text-[#B0AEA8]" : "text-[#141414]")
                    }
                  >
                    {r.name || "未命名规则"}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[#8C8C8C]">
                    {r.findRegex || "（还没写查找正则）"}
                  </div>
                </div>
                <div className="flex max-w-[92px] flex-none flex-wrap justify-end gap-1">
                  {r.placement.slice(0, 2).map((p) => (
                    <PlacementChip key={p} p={p} />
                  ))}
                  {r.placement.length > 2 && (
                    <span className="text-[9px] font-extrabold text-[#8C8C8C]">
                      +{r.placement.length - 2}
                    </span>
                  )}
                </div>
                <Chevron />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 按钮排 */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setEditing(blankRegexRule())}
          className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border-2 border-[#141414] bg-[#D9F24D] text-[14px] font-extrabold text-[#141414] shadow-[4px_4px_0_#141414] ${POP_PRESS}`}
        >
          <Plus size={17} strokeWidth={2.6} />
          新建规则
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border-2 border-[#141414] bg-white text-[14px] font-extrabold text-[#141414] shadow-[4px_4px_0_#141414] ${POP_PRESS}`}
        >
          <Upload size={16} strokeWidth={2.4} />
          导入 / 导出
        </button>
      </div>

      {shareOpen && (
        <ShareSheet
          rules={list}
          onImport={(added) => {
            persist([...list, ...added]);
            setShareOpen(false);
          }}
          onClose={() => setShareOpen(false)}
        />
      )}
    </AppChrome>
  );
}
