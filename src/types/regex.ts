/**
 * 正则脚本规则（1.4.10 起）。
 *
 * 恩熙 2026-09-22 定调：app 将来可能发布给别的用户用，功能不能写死——
 * 「删星号动作」「替换占位词」这类文字整理交给用户自己建规则，程序只管执行。
 * 参考项目（Float 小手机）有同款系统（settings-types.ts 的 RegexRule ＋
 * llm-prompt-assembler.ts 的 runRegexRule/applyRegex），本文件是它的简化移植。
 */

/** 规则的作用位置（一条规则可以同时勾几个位置）。 */
export type RegexPlacement =
  /** TA 回复落库前——破坏性：存下来的就是改后的文字，翻旧记录也是干净的。 */
  | "aiOutput"
  /** 只改气泡显示——存档一字不动；关掉规则后旧消息立刻还原。 */
  | "aiOutputDisplay"
  /** 我发的话送给模型前——屏幕上仍显示我打的原文，模型收到的是改后的。 */
  | "userInput";

export interface RegexRule {
  id: string;
  /** 脚本名（列表里认人用，如「删星号动作」）。 */
  name: string;
  /** 查找：正则源码（字符串形态存储，执行时才编译）。支持 {{user}}/{{char}} 宏。 */
  findRegex: string;
  /** 替换成：支持 $1 等捕获组与 {{match}}（匹配原文）与 {{user}}/{{char}} 宏；空串＝删除。 */
  replaceString: string;
  /** 总开关：关掉的规则在一切位置都不跑（留着不删，方便临时停用）。 */
  disabled: boolean;
  placement: RegexPlacement[];
  /** 英文替换不区分大小写（中文没有大小写，开了也没影响）。 */
  caseInsensitive?: boolean;
  /** 匹配到的原文里先删掉的固定字样（参考项目同名字段，高级用法，平时留空）。 */
  trimStrings?: string[];
}

/** 导入导出的文件形状（带版本号，将来规则加字段时好认旧文件）。 */
export interface RegexRuleExport {
  type: "stellasei-regex-rules";
  version: 1;
  rules: RegexRule[];
}
