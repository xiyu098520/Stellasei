/**
 * OpenAI 兼容服务商预设目录。
 *
 * 只存「地址 / 推荐模型」这类公开信息；API Key 一律由用户在设定面板
 * 手填并存 IndexedDB，绝不进任何源码或配置文件。
 *
 * 预设只是填写辅助层：选定后自动填充 baseUrl 与默认模型，之后仍可手改。
 * 数据链路（fetchAIReply）不认识预设，只消费 ChatApiSettings 四字段，
 * 因此新增 / 修改预设不会影响请求构造。
 */

import type { ApiCategory, ChatApiSettings } from "@/types/chat";

/** 一个服务商预设。 */
export interface ApiProviderPreset {
  /** 稳定标识（用于选中态）。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** 一句话说明（面板小字）。 */
  hint: string;
  /** OpenAI 兼容 base URL（含 /v1 等路径段）。 */
  baseUrl: string;
  /** 选定后自动填入的默认模型。 */
  defaultModel: string;
  /** 常见模型候选（输入联想用；自定义预设为空）。 */
  models?: string[];
}

/** 服务商预设目录：内置 2 家 + 自定义兜底。 */
export const API_PROVIDERS: ApiProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    hint: "国内直连 · 价格低",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    name: "OpenAI",
    hint: "官方接口",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  },
  /** 自定义：地址与模型都自己填（key 依然在面板里填）。 */
  {
    id: "custom",
    name: "自定义",
    hint: "填自己的地址",
    baseUrl: "",
    defaultModel: "",
    models: [],
  },
];

/** 按当前 baseUrl 反查预设（前缀匹配；空 / 不匹配一律视为自定义）。 */
export function presetOfBaseUrl(baseUrl: string): ApiProviderPreset {
  const trimmed = baseUrl.trim().toLowerCase();
  if (!trimmed) return API_PROVIDERS[API_PROVIDERS.length - 1];
  const hit = API_PROVIDERS.find(
    (p) => p.baseUrl !== "" && trimmed.startsWith(p.baseUrl.toLowerCase()),
  );
  return hit ?? API_PROVIDERS[API_PROVIDERS.length - 1];
}

/** 图文 API（图片生成）服务商预设。
    注意：OpenAI 走 /images/generations，NovelAI 是它自己一套格式
    （/ai/generate-image，返回 zip 包），两者在 chatApi 里是两条不同的通道。 */
export const IMAGE_API_PROVIDERS: ApiProviderPreset[] = [
  {
    id: "openai-image",
    name: "OpenAI",
    hint: "gpt-image · 官方接口",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-image-1",
    models: ["gpt-image-1", "dall-e-3"],
  },
  {
    id: "novelai-image",
    name: "NovelAI",
    hint: "插画风 · 官方接口（key 填 pst- 开头那串）",
    baseUrl: "https://image.novelai.net",
    defaultModel: "nai-diffusion-5-full",
    models: ["nai-diffusion-5-full", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated", "nai-diffusion-4-full", "nai-diffusion-3"],
  },
  /** 自定义：地址与模型都自己填（key 依然在面板里填）。
      必须留在最后一位——`presetOfCategoryBaseUrl` 靠 `[length-1]` 兜底。 */
  {
    id: "custom-image",
    name: "自定义",
    hint: "填自己的地址",
    baseUrl: "",
    defaultModel: "",
    models: [],
  },
];

/** 语音 API（语音合成，OpenAI 兼容 /audio/speech）服务商预设。 */
export const VOICE_API_PROVIDERS: ApiProviderPreset[] = [
  {
    id: "minimax-voice",
    name: "MiniMax 国内版",
    hint: "官方语音合成 · speech-2.8",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "speech-2.8-hd",
    models: [
      "speech-2.8-hd",
      "speech-2.8-turbo",
      "speech-2.6-hd",
      "speech-2.6-turbo",
      "speech-02-hd",
      "speech-02-turbo",
    ],
  },
  {
    id: "minimax-voice-global",
    name: "MiniMax 国际版",
    hint: "海外接口 · speech-2.8",
    baseUrl: "https://api.minimaxi.chat/v1",
    defaultModel: "speech-2.8-hd",
    models: [
      "speech-2.8-hd",
      "speech-2.8-turbo",
      "speech-2.6-hd",
      "speech-2.6-turbo",
      "speech-02-hd",
      "speech-02-turbo",
    ],
  },
  {
    id: "elevenlabs-voice",
    name: "ElevenLabs",
    hint: "官方 TTS · 音色自然、可克隆",
    baseUrl: "https://api.elevenlabs.io",
    /* 新到旧排：v4 最动情、v4_turbo 是它的实时版；multilingual_v2 老而稳，
       flash_v2_5 最快最省。哪个能用看账号档位，报错就往下换一档。 */
    defaultModel: "eleven_v4",
    models: [
      "eleven_v4",
      "eleven_v4_turbo",
      "eleven_multilingual_v2",
      "eleven_flash_v2_5",
      "eleven_turbo_v2_5",
    ],
  },
  {
    id: "openai-voice",
    name: "OpenAI",
    hint: "官方 TTS 接口",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini-tts",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
  },
  {
    id: "siliconflow-voice",
    name: "硅基流动",
    hint: "聚合平台 · CosyVoice 等",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "FunAudioLLM/CosyVoice2-0.5B",
    models: ["FunAudioLLM/CosyVoice2-0.5B", "fishaudio/fish-speech-1.5"],
  },
  /** 自定义：地址与模型都自己填（key 依然在面板里填）。 */
  {
    id: "custom-voice",
    name: "自定义",
    hint: "填自己的地址",
    baseUrl: "",
    defaultModel: "",
    models: [],
  },
];

/** 按分类取预设目录。 */
export function providersOfCategory(category: ApiCategory): ApiProviderPreset[] {
  if (category === "image") return IMAGE_API_PROVIDERS;
  if (category === "voice") return VOICE_API_PROVIDERS;
  return API_PROVIDERS;
}

/** 各分类的默认预设 id：表单完全空白时选中它，地址／模型预填，Key 留给用户自填。 */
export const DEFAULT_PRESET_ID: Record<ApiCategory, string> = {
  text: "openai",
  image: "openai-image",
  voice: "minimax-voice",
  sub: "openai", /* 副 API＝文本类接口，预设目录与默认项都跟着文本走 */
};

/** 按分类与当前 baseUrl 反查预设（前缀匹配；空 / 不匹配一律视为自定义）。 */
export function presetOfCategoryBaseUrl(
  category: ApiCategory,
  baseUrl: string,
): ApiProviderPreset {
  const list = providersOfCategory(category);
  const trimmed = baseUrl.trim().toLowerCase();
  if (!trimmed) return list[list.length - 1];
  const hit = list.find(
    (p) => p.baseUrl !== "" && trimmed.startsWith(p.baseUrl.toLowerCase()),
  );
  return hit ?? list[list.length - 1];
}

/**
 * 选定预设后的配置结果（纯函数，便于测试）：
 * - 内置预设：覆盖 baseUrl 与默认模型（key 透传保留，不由预设改动）
 * - 自定义：只保留用户已填内容，不覆盖地址与模型
 */
export function applyPreset(
  preset: ApiProviderPreset,
  prev: ChatApiSettings,
): { baseUrl: string; model: string; apiKey: string } {
  const custom = preset.baseUrl === "";
  return {
    baseUrl: custom ? prev.baseUrl : preset.baseUrl,
    model: custom ? prev.model : preset.defaultModel,
    apiKey: prev.apiKey,
  };
}