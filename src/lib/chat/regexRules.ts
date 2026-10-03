/**
 * 正则脚本引擎（1.4.10）：把用户自建的查找替换规则跑进消息流的三个位置
 * （aiOutput＝落库前／aiOutputDisplay＝仅显示／userInput＝送模型前）。
 *
 * 设计口径（照参考项目的「空框架」）：
 * - **默认零规则**——不预置任何规则，用户自己在设置里建（发布给别人用时各人配各人的）。
 * - **单条隔离**——任何一条写坏（正则编不过／跑出错）只跳过那一条，绝不把聊天炸了。
 * - **宏只做两个**：{{user}}／{{char}}（查找与替换都支持，换成用户名／角色名），
 *   外加 {{match}}（替换串里引用匹配到的原文）。参考项目那套 MacroEngine
 *   宏体系刻意不搬——我们没有那套变量生态。
 * - **刻意不做**（防以后顺手加回来）：按对话深度、按角色作用域、tags 分组、
 *   思维链位置、提示词／世界书位置、斜杠命令。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { uuid } from "@/lib/uuid";
import type { RegexPlacement, RegexRule, RegexRuleExport } from "@/types/regex";

const REGEX_RULES_KEY = "regex-rules";

/** 宏上下文：{{user}} 换用户名、{{char}} 换角色名。 */
export interface RegexCtx {
  userName: string;
  charName: string;
}

/**
 * 读全部规则（没建过＝空数组）。数组顺序即执行顺序。
 *
 * 载入时顺手把**编不过的老规则停用**：编辑器的实时校验是后来才加的，更早存下的、
 * 或从别人的分享包导入的规则里，可能躺着一条正则坏掉的（如 `加号|印章|印章墙|+`
 * ——末尾那个 `+` 前面没东西，编都编不出来）。引擎本来就单条隔离、炸不了，
 * 但它每跑一遍都在控制台刷一条 SyntaxError；停用之后她能在列表里看见那条、
 * 改好再打开，而不是听见一串看不懂的报错。
 */
export async function loadRegexRules(): Promise<RegexRule[]> {
  const raw = (await kvGet<RegexRule[]>(REGEX_RULES_KEY)) ?? [];
  let changed = false;
  const rules = raw.map((r) => {
    if (r.disabled || !r.findRegex.trim()) return r;
    if (validateRegexSource(r.findRegex) === null) return r;
    changed = true;
    return { ...r, disabled: true };
  });
  if (changed) {
    try {
      await kvSet(REGEX_RULES_KEY, rules);
    } catch {
      /* 写不回去也不影响这一趟：内存里已经是停用后的那份。 */
    }
  }
  return rules;
}

/** 整表写回（新建／修改／删除／排序都走这里）。 */
export async function saveRegexRules(rules: RegexRule[]): Promise<void> {
  await kvSet(REGEX_RULES_KEY, rules);
}

/** 新建一条规则的骨架（默认作用位＝改落库；名字与正则留给编辑页填）。 */
export function blankRegexRule(): RegexRule {
  return {
    id: uuid(),
    name: "",
    findRegex: "",
    replaceString: "",
    disabled: false,
    placement: ["aiOutput"],
    caseInsensitive: false,
  };
}

/** 宏替换：{{user}}／{{char}} → 用户名／角色名。 */
function applyMacros(text: string, ctx: RegexCtx): string {
  return text.split("{{user}}").join(ctx.userName).split("{{char}}").join(ctx.charName);
}

/**
 * 校验一段正则源码能不能编：编得过返回 null，编不过返回人话错误。
 * 编辑页拿它做实时标红；引擎拿不到 null 时直接跳过那条规则。
 */
export function validateRegexSource(src: string): string | null {
  if (!src.trim()) return "查找正则还没写";
  try {
    new RegExp(src);
    return null;
  } catch (err) {
    /* 浏览器的正则报错自带位置信息（如“Unmatched ')'”），够用了。 */
    return err instanceof Error ? err.message : "正则写错了";
  }
}

/** 单条规则执行：匹配 → （trimStrings 清理原文）→ 替换串展开 $n／{{match}}／宏。 */
function runRule(text: string, rule: RegexRule, ctx: RegexCtx): string {
  const src = applyMacros(rule.findRegex, ctx);
  const re = new RegExp(src, rule.caseInsensitive ? "gi" : "g");
  const trim = (rule.trimStrings ?? [])
    .map((s) => applyMacros(s, ctx))
    .filter((s) => s.length > 0);
  const template = applyMacros(rule.replaceString, ctx);
  return text.replace(re, (...args) => {
    const matched = String(args[0]);
    let piece = matched;
    for (const t of trim) piece = piece.split(t).join("");
    /* 函数替换的返回值不认 $n，捕获组得自己展开；{{match}} 引用清理后的匹配原文。
       split/join 防止原文里恰好带 $& 这类特殊串被二次解释。 */
    let out = template.replace(/\$(\d+)/g, (_, d) => String(args[Number(d)] ?? ""));
    out = out.split("{{match}}").join(piece);
    return out;
  });
}

/**
 * 在指定位置跑一遍全部启用的规则（同步、无 IO——规则由调用方先取好传进来）。
 * 坏规则单条跳过：聊天永远比规则重要。
 */
export function applyRegexRules(
  text: string,
  placement: RegexPlacement,
  ctx: RegexCtx,
  rules: RegexRule[],
): string {
  let out = text;
  for (const rule of rules) {
    if (rule.disabled || !rule.placement?.includes(placement)) continue;
    if (!rule.findRegex.trim()) continue;
    try {
      out = runRule(out, rule, ctx);
    } catch {
      /* 单条隔离：跑挂了就当这条不存在。 */
    }
  }
  return out;
}

/** 编辑页测试框：贴一段示例文字，看替换结果与命中几次。 */
export function testRegexRule(
  rule: RegexRule,
  sample: string,
  ctx: RegexCtx,
): { error: string | null; output: string; matchCount: number } {
  const invalid = validateRegexSource(rule.findRegex);
  if (invalid) return { error: invalid, output: sample, matchCount: 0 };
  try {
    const re = new RegExp(applyMacros(rule.findRegex, ctx), rule.caseInsensitive ? "gi" : "g");
    const matchCount = [...sample.matchAll(re)].length;
    const output = runRule(sample, rule, ctx);
    return { error: null, output, matchCount };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "跑不动", output: sample, matchCount: 0 };
  }
}

/** 导出成 JSON 文本（用户之间分享规则用）。 */
export function serializeRegexRules(rules: RegexRule[]): string {
  const payload: RegexRuleExport = { type: "stellasei-regex-rules", version: 1, rules };
  return JSON.stringify(payload, null, 2);
}

/** 三种作用位（给 UI 复用，别在界面里再抄一份字符串）。 */
export const PLACEMENTS: { key: RegexPlacement; label: string; hint: string }[] = [
  { key: "aiOutput", label: "TA 的回复", hint: "落库前改——存下来的就是干净的" },
  { key: "aiOutputDisplay", label: "TA 的回复（仅显示）", hint: "只改屏幕，存档不动" },
  { key: "userInput", label: "我说的话", hint: "送模型前改，屏幕仍显示原文" },
];

/**
 * 解析导入的 JSON 文本：认不出形状就抛人话错误；认得出的逐条消毒
 * （缺字段补、未知作用位丢），保证写库的一定是合法规则。
 */
export function parseRegexRules(json: string): RegexRule[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("这不是合法的 JSON 文本");
  }
  const obj = data as Partial<RegexRuleExport>;
  if (!obj || obj.type !== "stellasei-regex-rules" || !Array.isArray(obj.rules)) {
    throw new Error("这不是一份正则规则导出文件（认不出标记）");
  }
  const known: RegexPlacement[] = ["aiOutput", "aiOutputDisplay", "userInput"];
  const out: RegexRule[] = [];
  for (const raw of obj.rules) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<RegexRule>;
    const placement = (Array.isArray(r.placement) ? r.placement : []).filter(
      (p): p is RegexPlacement => known.includes(p),
    );
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : uuid(),
      name: typeof r.name === "string" ? r.name : "",
      findRegex: typeof r.findRegex === "string" ? r.findRegex : "",
      replaceString: typeof r.replaceString === "string" ? r.replaceString : "",
      disabled: r.disabled === true,
      placement: placement.length > 0 ? placement : ["aiOutput"],
      ...(r.caseInsensitive === true ? { caseInsensitive: true } : {}),
      ...(Array.isArray(r.trimStrings)
        ? { trimStrings: r.trimStrings.filter((s): s is string => typeof s === "string") }
        : {}),
    });
  }
  if (out.length === 0) throw new Error("文件里没有一条能用的规则");
  return out;
}
