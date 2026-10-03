/**
 * 档案（他的角色档案）数据模型。
 *
 * 对齐旧项目 ArchiveData 详情页排版用到的全部栏位（birth / relTime
 * 不在详情页出现，留到生活节奏再做）。tag 在旧项目语义是「种族」，
 * labels 是拍立得下方的关键词标签（逗号分隔），这里保持一致，
 * 之后从旧项目导数据不会错位。
 *
 * 栏位太碎，用户不知道该往哪格写、写不出来就空着——
 * 把细碎的栏位并成三个大格，用户一口气就能填完。并掉的只是**界面格数**，
 * 内容一样会被读进提示词（旧档案由 lib/settings/contact.ts 无感迁移）。
 *   looks       ← 外貌特征 ＋ 穿衣风格 ＋ 标志性特征
 *   persona     ← 性格详细描述 ＋ 喜好 ＋ 厌恶 ＋ 口头禅 ＋ 小习惯 ＋ 角色背景 ＋ 重要事件
 *   onlineStyle ← 线上表现（线下表现撤掉，旧值追加进这里）
 * 另单开一格 signature：签名。它不属人设——从人设里截第一句当签名会让
 * 「他是一个沉稳冷静的人」顶上资料页，很怪。
 */

export interface ContactProfile {
  /** 他的本名（必填）。 */
  name: string;
  /** 你对他的专属昵称。 */
  nickname: string;
  /**
   * 签名。资料页上那一句——用户第一次替他写，之后他在聊天里可以自己改
   * （改了以 `Conversation.signature` 为准，见 apps/chat/shared.ts 的 defaultSignature）。
   */
  signature: string;
  gender: string;
  age: string;
  /** 生日。随手写（「3月15日」这样），年份可省——角色多是虚构年份。 */
  birth: string;
  occupation: string;
  /** 种族。 */
  tag: string;
  /** 关键词标签（逗号分隔，拍立得下方显示，之后世界书与记忆绑定用）。 */
  labels: string;
  /** 身高 / 体重。 */
  height: string;
  blood: string;
  /** 角色详情：外貌特征／穿衣风格／标志性特征，一格写完。 */
  looks: string;
  /**
   * 角色人设：性格、喜好、厌恶、口头禅、小习惯、角色背景、重要事件——
   * 除了外貌以外关于他的一切。多行自由文本。
   */
  persona: string;
  /** 人际关系：他和谁是什么关系（家人、室友……以及和你是什么关系）。 */
  relOther: string;
  /**
   * 对话参考：打字与交流的风格，可以直接写成几组对话范例（挂在屏幕这头的相处方式）。
   * 「线下表现」已撤掉（线下还没有实际的东西，等做到了再加），
   * 老档案里那一格的值由迁移追加到这里，不丢。
   */
  onlineStyle: string;
  /** 自订补充区标题。 */
  customTitle: string;
  /** 自订补充区内容。 */
  customContent: string;
  /** 照片（压缩过的 data URL）。 */
  photo: string;
  /**
   * 卡面取景：列表卡上的照片是按 `cover` 裁切的，裁到哪一段由这里定——
   * 两个 0–100 的百分数，对应 CSS `background-position` 的 x／y（缺省＝50／50 居中）。
   * 横构图的照片需要能挪动、找到合适的位置。
   * 只在列表卡面上用得到——详情页那张大照片不裁切，整张铺满。
   */
  coverPos?: { x: number; y: number };
  /**
   * AI 助手模式（1.4.1 起）：正文与人设跟普通角色**逐字一样**，唯一的多出来的是
   * 末尾一条【测试模式 · 绝对服从】——陪恩熙测试这台小手机时，指令绝对服从、
   * 不许拒绝推脱（见 chatApi.ts 的 testModeRule）。
   * 缺省（undefined／false）＝普通角色。名字仍由用户自定，不内置预设。
   */
  isAssistant?: boolean;
}

export const EMPTY_PROFILE: ContactProfile = {
  name: "",
  nickname: "",
  signature: "",
  gender: "",
  age: "",
  birth: "",
  occupation: "",
  tag: "",
  labels: "",
  height: "",
  blood: "",
  looks: "",
  persona: "",
  relOther: "",
  onlineStyle: "",
  customTitle: "",
  customContent: "",
  photo: "",
};

/** 完整档案条目（含 id、时间戳）。 */
export interface ArchiveEntry {
  id: string;
  /** 对外短 ID（手机号式 11 位数字，添加好友用；生成后不变）。 */
  uid: string;
  createdAt: string;
  updatedAt: string;
  /** 分类 ID，"all" 表示已唤醒（未分类）。 */
  categoryId: string;
  data: ContactProfile;
}

/** 档案分类（左侧竖向标签栏）。 */
export interface ArchiveCategory {
  id: string;
  name: string;
}
