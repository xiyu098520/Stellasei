"use client";

/**
 * API 设定（星绥通讯真后端接入）。
 *
 * ApiSettingsPanel —— 分类列表：文本／图文／语音三大类，各自独立配置；
 * ApiCategoryForm —— 单类配置表单（服务商预设＋地址／密钥／模型＋启用开关）。
 * 仅在设置 App「API 设定」页使用；标题／返回由外层 AppChrome 提供。
 * 自行读写 IndexedDB。配色：撞色贴纸风（白卡 ＋ 黑描边 ＋ 无模糊硬阴影 ＋ 荧光撞色），
 * 底料见 pop-style.ts；无衬线由外层 AppChrome 统一给出，本文件不再自己写字体。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
  Volume2,
} from "lucide-react";
import {
  POP_CARD,
  POP_INK,
  POP_TONE,
  type PopTone,
} from "@/components/phone/apps/pop-style";
import {
  applyPreset,
  DEFAULT_PRESET_ID,
  presetOfCategoryBaseUrl,
  providersOfCategory,
  type ApiProviderPreset,
} from "@/lib/chat/providers";
import {
  fetchModelList,
  generateImage,
  MINIMAX_VOICES,
  synthesizeSpeech,
  testTextApi,
} from "@/lib/chat/chatApi";
import {
  DEFAULT_CHAT_PREFS,
  deleteApiPreset,
  getApiBundle,
  getApiPresets,
  getChatPrefs,
  saveApiCategory,
  saveApiPreset,
  saveChatPrefs,
  saveImageExtras,
  saveVoiceExtras,
} from "@/lib/settings/chat";
import type {
  ApiCategory,
  ApiPresetEntry,
  ApiSettingsBundle,
  ChatApiSettings,
  ImageApiExtras,
  VoiceApiExtras,
} from "@/types/chat";
import { DEFAULT_IMAGE_EXTRAS, DEFAULT_VOICE_EXTRAS } from "@/types/chat";

/** 分类撞色：文本＝蓝、图文＝橙、语音＝紫。 */
const CATEGORY_TONE: Record<ApiCategory, PopTone> = {
  text: "blue",
  image: "orange",
  voice: "purple",
};

/** 状态徽章底色：已启用＝薄荷、未启用＝柠檬黄、未配置＝浅灰。 */
const STATUS_BG: Record<string, string> = {
  "已启用": POP_TONE.mint,
  "未启用": POP_TONE.yellow,
  "未配置": "#E9E7E1",
};

/** 输入框／下拉统一的配方：黑描边 ＋ 大圆角，聚焦时换蓝边蓝影。 */
const POP_FIELD =
  "w-full rounded-xl border-2 border-[#141414] bg-white px-3 py-2.5 text-[14px] font-medium text-[#141414] placeholder:text-[#A8A8A8] focus:border-[#4C8DFF] focus:shadow-[3px_3px_0_#4C8DFF] focus:outline-none disabled:opacity-50";

/** 文本域：在输入框配方上加高、禁用手动拖拽。 */
const POP_TEXTAREA = `${POP_FIELD} min-h-[80px] resize-none leading-relaxed`;

/** 字段名小标题。 */
const POP_LABEL = "text-[11px] font-extrabold tracking-wide text-[#141414]";

/** 提示／说明小字。 */
const POP_HINT = "text-[11px] font-medium leading-relaxed text-[#8C8C8C]";

/** 按钮公用：黑描边 ＋ 硬阴影 ＋ 按下往阴影里沉（只动 transform）。 */
const POP_BTN =
  "cursor-pointer rounded-xl border-2 border-[#141414] px-4 py-2.5 text-[14px] font-bold text-[#141414] shadow-[3px_3px_0_#141414] transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-50";

/** 主按钮（保存／测试）：柠檬黄打底。 */
const POP_BTN_PRIMARY = `bg-[#D9F24D] ${POP_BTN}`;

/** 次按钮（取消／关闭／重试）：白底黑描边。 */
const POP_BTN_GHOST = `bg-white ${POP_BTN}`;

/** 四大分类的展示信息（设置页标题与列表共用）。 */
export const API_CATEGORY_META: Record<
  ApiCategory,
  { title: string; titleEn: string; desc: string; icon: typeof Type }
> = {
  text: { title: "文本 API", titleEn: "TEXT API", desc: "聊天回复 · 对话模型", icon: Type },
  image: { title: "图文 API", titleEn: "IMAGE API", desc: "图片生成 · TA 发的图", icon: ImageIcon },
  voice: { title: "语音 API", titleEn: "VOICE API", desc: "语音合成 · TA 的声音", icon: Volume2 },
};

/** 分类顺序（列表展示用）。 */
export const API_CATEGORY_ORDER: ApiCategory[] = ["text", "image", "voice"];

/** 分类表单顶部说明。 */
const CATEGORY_INTRO: Record<ApiCategory, string> = {
  text: "OpenAI 兼容接口。填好并启用后 TA 才会真正回应；未配置时发消息只会得到系统提示。Key 只存在本机，不会写入任何文件。",
  image: "图片生成接口（OpenAI 兼容 /images/generations，或 NovelAI 官方接口）。填好并启用后，聊天中的图片功能才能生成真正的图片。Key 只存在本机，不会写入任何文件。",
  voice: "OpenAI 兼容语音合成接口。填好并启用后，TA 的语音消息才能转成真实的声音播放。Key 只存在本机，不会写入任何文件。",
};

/** 模型名占位示例。 */
const MODEL_PLACEHOLDER: Record<ApiCategory, string> = {
  text: "deepseek-chat",
  image: "gpt-image-1",
  voice: "gpt-4o-mini-tts",
};

/** 启用开关旁的文字。 */
const ENABLE_LABEL: Record<ApiCategory, string> = {
  text: "启用文本接口",
  image: "启用图文接口",
  voice: "启用语音接口",
};

/** 常见音色快捷选择（OpenAI 标准＋国内常见；也可在输入框手填服务商的音色名）。 */
const VOICE_PRESETS: { value: string; label: string }[] = [
  { value: "alloy", label: "alloy·中性" },
  { value: "nova", label: "nova·女声" },
  { value: "shimmer", label: "shimmer·女声" },
  { value: "echo", label: "echo·男声" },
  { value: "onyx", label: "onyx·低沉男" },
  { value: "fable", label: "fable·叙事" },
];

/** NovelAI 采样器（服务端 /api/nai-generate 的白名单与这份一致，多填的会被打回默认）。 */
const NAI_SAMPLER_OPTIONS: { value: string; label: string }[] = [
  { value: "k_euler_ancestral", label: "Euler Ancestral·默认" },
  { value: "k_euler", label: "Euler" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim", label: "DDIM·旧模型" },
];

/** 音色显示名：两套目录里查得到用中文名，查不到（如复刻音色）显示原 ID。 */
function voiceLabel(voice: string): string {
  const hit = [...MINIMAX_VOICES, ...VOICE_PRESETS].find((v) => v.value === voice);
  return hit?.label ?? voice;
}

/** 单类配置状态：已启用／填过未启用／完全空白。 */
function statusOf(s: ChatApiSettings): { label: string; active: boolean } {
  const filled = s.baseUrl.trim() !== "" || s.model.trim() !== "" || s.apiKey.trim() !== "";
  if (s.enabled && s.baseUrl.trim() !== "" && s.model.trim() !== "") {
    return { label: "已启用", active: true };
  }
  return { label: filled ? "未启用" : "未配置", active: false };
}

/** 自制贴纸开关（替代聊天 App 的玫瑰棕 Switch）：轨道荧光黄，滑块只动 transform。 */
function AmberSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`relative h-7 w-[52px] flex-none cursor-pointer rounded-full border-2 border-[#141414] ${
        on ? "bg-[#D9F24D]" : "bg-[#E9E7E1]"
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-[22px] w-[22px] rounded-full border-2 border-[#141414] bg-white transition-transform duration-200 ${
          on ? "translate-x-[22px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * 一行采样参数（频率惩罚／存在惩罚）：开关打开才发。
 * 关着＝这个值根本不进请求体，走服务商自己的默认——不是「发个 0」。
 * 有些服务商不认这些字段，硬塞会 400，所以默认一律关着。
 */
function SampleRow({
  label,
  hint,
  on,
  onToggle,
  value,
  onValue,
  min,
  max,
  step,
  format,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  value: number;
  onValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** 数值显示（带正负号之类）。 */
  format: (v: number) => string;
}) {
  return (
    <div className="rounded-xl bg-[#F7F4ED] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-extrabold text-[#141414]">{label}</div>
          <div className={`mt-0.5 ${POP_HINT}`}>{hint}</div>
        </div>
        <AmberSwitch on={on} onClick={onToggle} />
      </div>
      {on ? (
        <label className="mt-2 flex flex-col gap-1">
          <span className={`text-right text-[11px] font-extrabold text-[#141414]`}>
            {format(value)}
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onValue(Number(e.target.value))}
            style={{ accentColor: POP_TONE.blue }}
          />
        </label>
      ) : null}
    </div>
  );
}

/**
 * 找出与某份配置完全一致的「我的预设方案」。
 * 同账号多音色场景：地址／Key／模型全相同，还须生成参数（音色等）也一致
 * 才算同一套——否则多个方案同时匹配，勾永远停在第一个上。
 */
function matchPresetId(
  presets: ApiPresetEntry[],
  category: ApiCategory,
  form: {
    baseUrl: string;
    apiKey: string;
    model: string;
    voiceExtras?: VoiceApiExtras;
    imageExtras?: ImageApiExtras;
  },
): string | null {
  const hit = presets.find((p) => {
    if (p.baseUrl !== form.baseUrl || p.apiKey !== form.apiKey || p.model !== form.model) {
      return false;
    }
    if (category === "voice" && p.voiceExtras && form.voiceExtras) {
      if (JSON.stringify(p.voiceExtras) !== JSON.stringify(form.voiceExtras)) return false;
    }
    if (category === "image" && p.imageExtras && form.imageExtras) {
      if (!sameImageExtras(p.imageExtras, form.imageExtras)) return false;
    }
    return true;
  });
  return hit?.id ?? null;
}

/**
 * 两份图文生成参数是不是同一套。
 *
 * 不能拿 JSON 串硬比（图文方案点上去**不打勾**）：
 * 老方案是过去存下的，可能缺画风预设／采样参数这些后加的字段，串一比就永远
 * 差一截，勾永远不出来；而且按钮一点走的是 `{...DEFAULT_IMAGE_EXTRAS, ...方案值}`
 * 这条**补默认值**的路（见 applyMyPreset），表单那边字段是齐的，方案那边是缺的。
 * 所以先各自按默认值补齐再逐项比——字段缺不缺、顺序先后都不影响结果。
 */
function sameImageExtras(a: ImageApiExtras, b: ImageApiExtras): boolean {
  const x: ImageApiExtras = { ...DEFAULT_IMAGE_EXTRAS, ...a };
  const y: ImageApiExtras = { ...DEFAULT_IMAGE_EXTRAS, ...b };
  return (Object.keys(x) as (keyof ImageApiExtras)[]).every((k) => x[k] === y[k]);
}

/**
 * API 设定主页：三大分类列表（文本／图文／语音）。
 * 点某一类进入对应配置表单。
 */
export function ApiSettingsPanel({
  onOpenCategory,
}: {
  onOpenCategory: (category: ApiCategory) => void;
}) {
  const [bundle, setBundle] = useState<ApiSettingsBundle | null>(null);

  useEffect(() => {
    let alive = true;
    void getApiBundle().then((b) => {
      if (alive) setBundle(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <p className={POP_HINT}>
        星绥通讯的接口分三类，各自独立配置：文本负责 TA 的回复，图文负责图片生成，语音负责 TA 的声音。
      </p>

      <div className={POP_CARD + " overflow-hidden"}>
        {API_CATEGORY_ORDER.map((cat) => {
          const meta = API_CATEGORY_META[cat];
          const status = bundle ? statusOf(bundle[cat]) : null;
          const Icon = meta.icon;
          return (
            <div
              key={cat}
              className="group flex cursor-pointer items-center gap-4 border-t-2 border-dashed border-[#EDEAE2] px-4 py-4 first:border-t-0 active:bg-[#FFF4DC]"
              onClick={() => onOpenCategory(cat)}
            >
              {/* 图标座：一枚撞色小方块，颜色按分类给 */}
              <div
                className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] border-2 border-[#141414] shadow-[3px_3px_0_#141414]"
                style={{ background: POP_TONE[CATEGORY_TONE[cat]], color: POP_INK }}
              >
                <Icon size={20} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-[#141414]">{meta.title}</div>
                <div className="mt-1 text-[11px] font-medium text-[#8C8C8C]">{meta.desc}</div>
              </div>
              {status ? (
                <span
                  className="rounded-full border-2 border-[#141414] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]"
                  style={{ background: STATUS_BG[status.label] }}
                >
                  {status.label}
                </span>
              ) : null}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[#141414] transition-transform duration-100 group-hover:translate-x-1"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 单类 API 配置表单（文本／图文／语音通用）。
 * 服务商预设按分类切换；保存只写本类，其余两类不动。
 */
export function ApiCategoryForm({ category }: { category: ApiCategory }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [groupId, setGroupId] = useState("");
  const [enabled, setEnabled] = useState(false);
  /* 流式输出（仅文本 API）：不填视为开启。 */
  const [streamOn, setStreamOn] = useState(true);
  /* 采样参数（仅文本 API）：默认一律不发，走服务商自己的默认。
     温度多一档「不发」——有的接口（开了思考的代理）带上 temperature 就 400，
     那一档存 null，等于明确告诉请求层「这个接口不吃温度」。 */
  const [temperatureMode, setTemperatureMode] = useState<"default" | "custom" | "off">("default");
  const [temperature, setTemperature] = useState(0.8);
  const [frequencyPenaltyOn, setFrequencyPenaltyOn] = useState(false);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0);
  const [presencePenaltyOn, setPresencePenaltyOn] = useState(false);
  const [presencePenalty, setPresencePenalty] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [providerId, setProviderId] = useState("custom");
  const [loaded, setLoaded] = useState(false);
  /* 自存预设方案 */
  const [presets, setPresets] = useState<ApiPresetEntry[]>([]);
  const [naming, setNaming] = useState<null | { id?: string; name: string }>(null);
  /* 当前表单是从哪个「我的预设方案」点进来的：之后保存要连带更新它，而不是留下旧的。 */
  const [linkedPresetId, setLinkedPresetId] = useState<string | null>(null);
  /* 套用方案后的确认提示（几秒后消失；地址 Key 模型相同时也看得见切换生效）。 */
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);
  /* 测试（文本＝连通性；图文＝生成一张测试图；语音＝合成一段试听） */
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | {
    ok: boolean;
    msg: string;
    image?: string;
    prompt?: string;
    audio?: string;
  }>(null);
  /* 模型列表：自动获取 ／ 手动输入并存 */
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  /* 图文附加参数（仅 image 分类展示） */
  const [imgExtras, setImgExtras] = useState<ImageApiExtras>(DEFAULT_IMAGE_EXTRAS);
  /* 语音附加参数（仅 voice 分类展示） */
  const [voiceExtras, setVoiceExtras] = useState<VoiceApiExtras>(DEFAULT_VOICE_EXTRAS);
  /* 文本 API 设定（提示词翻译用） */
  const [textApi, setTextApi] = useState<ChatApiSettings | null>(null);
  /* 「自动生成」总开关：属于全局对话习惯（ChatPrefs），不在这份配置里，
     所以它一点就存、不等下面那颗「保存」——切预设方案也不该带走它。 */
  const [autoGenImage, setAutoGenImage] = useState(DEFAULT_CHAT_PREFS.autoGenerateImage);

  const providers = providersOfCategory(category);

  /* 当前是否 MiniMax（国内／国际版）：语音接口走专用格式，表单多一个团队 ID。 */
  const isMiniMax = /api\.minimax(i)?\.chat/i.test(baseUrl);
  /* 地址是 NovelAI：图文面板要单独给一栏（画幅档位 ＋ Steps/CFG/采样器/Seed），
     密钥的填法也跟 OpenAI 那套不一样（见下面各处的 isNovelAI）。 */
  const isNovelAI = category === "image" && /novelai\.net/i.test(baseUrl);

  /* OpenAI 那套通道下，把「画风预设／正面提示词前缀／正面提示词后缀」三格合成一格显示：
     GPT 读的是**一整句话**，不像 NovelAI 那样按位置分权重，
     分三格只会让人以为要写标签、白填两格。合成值＝三段按原顺序拼起来（所见即所得）；
     一编辑就整段写回「正面提示词前缀」、另两格清空——内容不丢，只是归位。切回 NovelAI
     通道时三格各自独立。 */
  const mergedImagePrompt = [imgExtras.stylePreset, imgExtras.positivePrompt, imgExtras.promptSuffix]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("，");

  /** 当前选中的预设方案＝与表单完全一致的那个。 */
  const activePresetId = useMemo(
    () => matchPresetId(presets, category, { baseUrl, apiKey, model, voiceExtras, imageExtras: imgExtras }),
    [presets, category, baseUrl, apiKey, model, voiceExtras, imgExtras],
  );

  /** 保存时要连带更新的方案（已被删掉则视为没有）。 */
  const linkedPreset = linkedPresetId
    ? presets.find((p) => p.id === linkedPresetId)
    : undefined;

  /* 下拉「点外面关掉」：用 document 指针事件代替全屏透明遮罩。
     透明遮罩会被祖先的 backdrop-filter / transform 改掉定位（containing block），
     尺寸位置全凭祖先样式，容易反过来挡住整个界面，点了没反应。 */
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!modelDropdownRef.current?.contains(e.target as Node)) setModelDropdownOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [modelDropdownOpen]);

  useEffect(() => {
    let alive = true;
    void Promise.all([getApiBundle(), getApiPresets(category), getChatPrefs()]).then(([b, list, prefs]) => {
      if (!alive) return;
      setAutoGenImage(prefs.autoGenerateImage);
      const s = b[category];
      setStreamOn(s.stream !== false);
      /* 采样参数：不填＝没设过（不发这个值）；温度存了 null＝明确「不发温度」。 */
      setTemperatureMode(
        s.temperature === null ? "off" : s.temperature === undefined ? "default" : "custom",
      );
      setTemperature(s.temperature ?? 0.8);
      setFrequencyPenaltyOn(s.frequencyPenalty !== undefined);
      setFrequencyPenalty(s.frequencyPenalty ?? 0);
      setPresencePenaltyOn(s.presencePenalty !== undefined);
      setPresencePenalty(s.presencePenalty ?? 0);
      /* 完全没配置过：默认选中 OpenAI 预设，地址／模型预填，Key 留空给用户填。 */
      const blank =
        !s.baseUrl.trim() && !s.model.trim() && !s.apiKey.trim() && !s.enabled;
      if (blank) {
        const preset =
          providers.find((p) => p.id === DEFAULT_PRESET_ID[category]) ?? providers[0];
        setProviderId(preset.id);
        setBaseUrl(preset.baseUrl);
        // 模型不预填：留给「获取模型」下拉或手动输入。
        setModel("");
        setApiKey("");
        setEnabled(false);
      } else {
        setBaseUrl(s.baseUrl);
        setApiKey(s.apiKey);
        setModel(s.model);
        setGroupId(s.groupId ?? "");
        setEnabled(s.enabled);
        setProviderId(presetOfCategoryBaseUrl(category, s.baseUrl).id);
      }
      const imgNext = { ...DEFAULT_IMAGE_EXTRAS, ...b.imageExtras };
      setImgExtras(imgNext);
      const merged = { ...DEFAULT_VOICE_EXTRAS, ...b.voiceExtras };
      /* 仅当音色是 OpenAI 那套（alloy 等）才换默认：自定义／复刻音色 ID
         不在目录里属正常，保留用户存的值——否则重新进页面勾会匹配不上。 */
      const isForeignVoice = VOICE_PRESETS.some((v) => v.value === merged.voice);
      const switchToMiniMaxVoice =
        /api\.minimax(i)?\.chat/i.test(b.voice.baseUrl) && isForeignVoice;
      const voiceNext = switchToMiniMaxVoice
        ? { ...merged, voice: MINIMAX_VOICES[0].value }
        : merged;
      setVoiceExtras(voiceNext);
      setTextApi(b.text);
      setPresets(list);
      /* 进页面时当前配置正好等于某个方案，也当作「从这个方案进来的」：
         否则改完保存会留下一个没跟着变的旧方案，看着就像凭空多出一套配置。 */
      if (!blank) {
        const matched = matchPresetId(list, category, {
          baseUrl: s.baseUrl,
          apiKey: s.apiKey,
          model: s.model,
          voiceExtras: voiceNext,
          imageExtras: imgNext,
        });
        if (matched) setLinkedPresetId(matched);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [category, providers]);

  /** 重新拉取预设列表（新增／改名／删除后调用）。 */
  const refreshPresets = async () => {
    setPresets(await getApiPresets(category));
  };

  const activeProvider: ApiProviderPreset =
    providers.find((p) => p.id === providerId) ?? providers[providers.length - 1];
  const modelCandidates = activeProvider.models ?? [];

  /** 下拉候选：优先接口获取的列表，没获取过用预设推荐。 */
  const modelAll = modelList ?? modelCandidates;
  /* 仅当输入内容不是列表里的完整模型名（＝正在手动打字）时才按其过滤；
     已选定模型后再展开下拉，显示全部模型供随时更换。 */
  const modelQuery = model.trim().toLowerCase();
  const modelExact = modelQuery !== "" && modelAll.some((m) => m.toLowerCase() === modelQuery);
  const dropdownItems =
    modelQuery === "" || modelExact
      ? modelAll
      : modelAll.filter((m) => m.toLowerCase().includes(modelQuery));

  const pickProvider = (preset: ApiProviderPreset) => {
    setProviderId(preset.id);
    /* 换成内置服务商＝不再是某个自存方案的表单，解绑，免得保存时误改那个方案。 */
    setLinkedPresetId(null);
    const next = applyPreset(preset, { baseUrl, apiKey, model, enabled });
    setBaseUrl(next.baseUrl);
    // 换服务商后旧模型不再适用：清空重选（自定义保留手填内容）。
    if (preset.baseUrl !== "") setModel("");
    // 之前拉的模型列表属于旧服务商，一并清掉。
    setModelList(null);
    setModelFetchError(null);
    setModelDropdownOpen(false);
    setSaved(false);
    /* 切到 MiniMax：音色若还是 OpenAI 那套（alloy 等）才换默认；
       自定义／复刻音色 ID 保留（它们本来就不在目录里）。 */
    if (/api\.minimax(i)?\.chat/i.test(preset.baseUrl)) {
      setVoiceExtras((prev) =>
        VOICE_PRESETS.some((v) => v.value === prev.voice)
          ? { ...prev, voice: MINIMAX_VOICES[0].value }
          : prev,
      );
    }
  };

  const markEdited = () => {
    setSaved(false);
  };

  /** 套用一个自存预设方案到表单（含生成参数：音色／语速／音调等）。 */
  const applyMyPreset = (p: ApiPresetEntry) => {
    setLinkedPresetId(p.id);
    setBaseUrl(p.baseUrl);
    setApiKey(p.apiKey);
    setModel(p.model);
    setProviderId(presetOfCategoryBaseUrl(category, p.baseUrl).id);
    setModelList(null);
    setModelFetchError(null);
    setModelDropdownOpen(false);
    setSaved(false);
    setTestResult(null);
    if (category === "voice" && p.voiceExtras) setVoiceExtras({ ...p.voiceExtras });
    /* 旧方案可能缺后加的字段（画风预设／采样参数等）：先铺一层默认值再覆盖。 */
    if (category === "image" && p.imageExtras) {
      setImgExtras({ ...DEFAULT_IMAGE_EXTRAS, ...p.imageExtras });
    }
    /* 旧方案（音色功能之前存的）不含声音信息：明确告知，避免「点了没反应」的错觉。 */
    const noVoice =
      category === "voice" &&
      !p.voiceExtras &&
      (voiceExtras.voice !== "" || voiceExtras.speed !== 1 || voiceExtras.pitch !== 0);
    const label =
      category === "voice" && p.voiceExtras?.voice
        ? `${p.name} · ${voiceLabel(p.voiceExtras.voice)}`
        : p.name;
    setSwitchedTo(noVoice ? `${label}（该方案未存音色，声音保持当前值）` : label);
    window.setTimeout(() => setSwitchedTo(null), 3200);
  };

  /** 把当前表单内容存成新预设（或更新指定预设的配置，生成参数一并打包）。 */
  const confirmNaming = async () => {
    if (!naming) return;
    const entry = await saveApiPreset(category, {
      id: naming.id,
      name: naming.name,
      baseUrl,
      apiKey,
      model,
      ...(category === "voice" ? { voiceExtras: { ...voiceExtras } } : {}),
      ...(category === "image" ? { imageExtras: { ...imgExtras } } : {}),
    });
    /* 刚存下的这套就是表单此刻的内容，顺手绑上：接着再改、再点保存，改的还是它。 */
    setLinkedPresetId(entry.id);
    await refreshPresets();
    setNaming(null);
  };

  /** 重命名预设方案（其余字段原样保留，含生成参数）。 */
  const renamePreset = async (p: ApiPresetEntry, name: string) => {
    await saveApiPreset(category, {
      ...p,
      name,
    });
    await refreshPresets();
  };

  const removePreset = async (id: string) => {
    await deleteApiPreset(category, id);
    await refreshPresets();
  };

  const handleSave = async () => {
    setSaving(true);
    await saveApiCategory(category, {
      baseUrl,
      apiKey,
      model,
      enabled,
      ...(category === "text"
        ? {
            stream: streamOn,
            /* 温度：默认＝不填（请求层按 0.8 发）；自定义＝按滑条；不发＝null。 */
            temperature:
              temperatureMode === "off"
                ? null
                : temperatureMode === "custom"
                  ? temperature
                  : undefined,
            frequencyPenalty: frequencyPenaltyOn ? frequencyPenalty : undefined,
            presencePenalty: presencePenaltyOn ? presencePenalty : undefined,
          }
        : {}),
      ...(isMiniMax ? { groupId: groupId.trim() } : {}),
    });
    if (category === "image") await saveImageExtras(imgExtras);
    if (category === "voice") await saveVoiceExtras(voiceExtras);
    /* 表单是从某个方案点进来的：保存＝连同那个方案一起改，方案名不动。
       只更新当前生效配置的话，方案里还留着改动前的旧地址／模型，
       看上去就像「改动没落到这个方案上、又多出一套配置」。 */
    if (linkedPreset) {
      await saveApiPreset(category, {
        id: linkedPreset.id,
        name: linkedPreset.name,
        baseUrl,
        apiKey,
        model,
        ...(category === "voice" ? { voiceExtras: { ...voiceExtras } } : {}),
        ...(category === "image" ? { imageExtras: { ...imgExtras } } : {}),
      });
      await refreshPresets();
    }
    setSaving(false);
    setSaved(true);
  };

  /** 测试连通性：用当前表单值发一条最小请求（仅文本 API）。 */
  const runTest = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      setTestResult({ ok: false, msg: "请先填好地址和模型再测试" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await testTextApi({ baseUrl, apiKey, model, enabled });
      setTestResult({ ok: true, msg: `连接成功，TA 说：${reply.slice(0, 30)}` });
    } catch (err) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  /** 测试生图：固定用「英俊男子对镜自拍」提示词（正面提示词仍会叠加），含翻译流程。 */
  const runImageTest = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      setTestResult({ ok: false, msg: "请先填好地址和模型再测试" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    /* 测试自己的 3 分钟上限：这里没有「不等了」按钮，不能让它一直转。
       注意这只是我们这头收手——对方可能照旧画完并计费，所以失败文案照实说。 */
    let timedOut = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 180_000);
      try {
        const res = await generateImage(
          { baseUrl, apiKey, model, enabled },
          TEST_IMAGE_PROMPT,
          imgExtras,
          textApi ?? undefined,
          undefined,
          undefined,
          controller.signal,
        );
        setTestResult({
          ok: true,
          msg: `${res.via === "chat" ? "生成成功（经聊天接口出图）" : "生成成功"}${
            res.translateFailed ? "；翻译失败，已用中文原文生图" : ""
          }`,
          image: res.image,
          prompt: res.finalPrompt,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const raw = timedOut
        ? "测试等了 3 分钟还没回音，先收手了。请求已经发出去了，对方可能已经画好并计费——过一会儿再测更稳妥。"
        : err instanceof Error
          ? err.message
          : String(err);
      /* 中转站常见错误附人话提示，告诉用户下一步该做什么。 */
      let hint = "";
      if (/No available compatible accounts|无可用渠道/i.test(raw)) {
        hint = "。这是中转站的问题：它给这个模型配的账号暂时全不可用（额度用尽或被限流），过几分钟再试通常能恢复，你的配置没有问题";
      } else if (/not supported on the Chat Completions endpoint/i.test(raw)) {
        hint = "。这个模型只支持图片接口，聊天接口的报错可以忽略，以图片接口的原因为准";
      }
      setTestResult({ ok: false, msg: raw + hint });
    } finally {
      setTesting(false);
    }
  };

  /** 测试语音：用当前表单值＋语音参数合成一句固定试听语。 */
  const runVoiceTest = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      setTestResult({ ok: false, msg: "请先填好地址和模型再测试" });
      return;
    }
    if (isMiniMax && !groupId.trim()) {
      setTestResult({ ok: false, msg: "MiniMax 需要填写团队 ID（在 MiniMax 平台「账户管理」页可以看到）" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await synthesizeSpeech(
        { baseUrl, apiKey, model, enabled, ...(isMiniMax ? { groupId: groupId.trim() } : {}) },
        "喂，是我。你那边能听到吗？",
        voiceExtras,
      );
      setTestResult({ ok: true, msg: "合成成功，点下方播放试听", audio: res.audio });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  /** 自动获取模型列表：请求服务商的 /models 接口，成功后展开下拉供选择。 */
  const runFetchModels = async () => {
    setFetchingModels(true);
    setModelFetchError(null);
    setModelList(null);
    setModelDropdownOpen(false);
    try {
      const list = await fetchModelList({ baseUrl, apiKey });
      setModelList(list);
      setModelDropdownOpen(true);
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <p className={POP_HINT}>{CATEGORY_INTRO[category]}</p>

      {/* 服务商预设：选定自动填地址与模型，仍可手改；自定义保留手填 */}
      <div className={POP_CARD + " flex flex-col gap-3 p-4"}>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => {
            const active = p.id === providerId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProvider(p)}
                className={`cursor-pointer rounded-full border-2 border-[#141414] px-3.5 py-1.5 text-[12px] text-[#141414] shadow-[3px_3px_0_#141414] transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none ${
                  active ? "bg-[#D9F24D] font-extrabold" : "bg-white font-bold"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <div className={POP_HINT}>{activeProvider.hint}</div>
      </div>

      {/* 我的预设方案：存当前配置为命名方案，之后一键套用 */}
      <div className={POP_CARD + " p-4"}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="rounded-full border-2 border-[#141414] bg-[#FF7AB8] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]">
            我的预设方案
          </span>
          <button
            type="button"
            onClick={() =>
              setNaming({ name: activeProvider.id !== "" ? `${activeProvider.name} · 备用` : "我的方案" })
            }
            className="flex cursor-pointer items-center gap-1 rounded-xl border-2 border-[#141414] bg-[#D9F24D] px-3 py-1.5 text-[12px] font-bold text-[#141414] shadow-[2px_2px_0_#141414] transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            <Plus size={12} strokeWidth={2.5} />
            存当前配置
          </button>
        </div>
        {switchedTo ? (
          <div className="mb-2.5 rounded-xl bg-[#E4FBF1] px-3 py-2 text-[11px] font-bold leading-relaxed text-[#0F7B55]">
            已切换到「{switchedTo}」
          </div>
        ) : null}
        {presets.length === 0 ? (
          <p className={POP_HINT}>
            还没有预设方案。填好一套配置后点「存当前配置」，换个名字保存，
            以后就能一键切换回来。
          </p>
        ) : (
          <div className="flex flex-col border-t-2 border-dashed border-[#EDEAE2]">
            {presets.map((p) => {
              const active = p.id === activePresetId;
              const host = p.baseUrl.replace(/^https?:\/\//, "").split("/")[0];
              return (
                <div
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2.5 border-t-2 border-dashed border-[#EDEAE2] px-2.5 py-3 first:border-t-0 ${
                    active ? "bg-[#FFF4DC]" : "hover:bg-[#FFF4DC]"
                  }`}
                  onClick={() => applyMyPreset(p)}
                >
                  <div
                    className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 border-[#141414] ${
                      active ? "bg-[#D9F24D]" : "bg-white"
                    }`}
                  >
                    {active ? <Check size={11} strokeWidth={3} className="text-[#141414]" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-bold text-[#141414]">{p.name}</div>
                    <div className={`mt-0.5 truncate ${POP_HINT}`}>
                      {p.model || "未设模型"} · {host || "未设地址"}
                      {category === "voice" && p.voiceExtras?.voice
                        ? ` · ${voiceLabel(p.voiceExtras.voice)}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="重命名"
                    className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-lg border-2 border-[#141414] bg-white text-[#141414] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNaming({ id: p.id, name: p.name });
                    }}
                  >
                    <Pencil size={12} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label="删除"
                    className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-lg border-2 border-[#141414] bg-[#FF5A4D] text-[#141414] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removePreset(p.id);
                    }}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 字段 */}
      <div className={POP_CARD + " flex flex-col gap-4 p-4"}>
        <label className="flex flex-col gap-1.5">
          <span className={POP_LABEL}>Base URL</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              markEdited();
            }}
            placeholder="https://api.openai.com/v1"
            className={POP_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={POP_LABEL}>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              markEdited();
            }}
            placeholder={
              isNovelAI
                ? "pst-…（NovelAI 持久令牌）"
                : isMiniMax
                  ? "MiniMax 平台的 API Key"
                  : "sk-…"
            }
            className={POP_FIELD}
          />
          {isNovelAI ? (
            <span className={POP_HINT}>
              NovelAI 账号的 API Token：官网 → 账户 → Get Persistent API Token（pst- 开头那串）
            </span>
          ) : null}
        </label>

        {/* 团队 ID：仅 MiniMax（国内／国际版）显示 */}
        {isMiniMax ? (
          <label className="flex flex-col gap-1.5">
            <span className={POP_LABEL}>团队 ID</span>
            <input
              type="text"
              value={groupId}
              maxLength={40}
              onChange={(e) => {
                setGroupId(e.target.value);
                markEdited();
              }}
              placeholder="MiniMax 平台「账户管理」页的 Group ID"
              className={POP_FIELD}
            />
            <span className={POP_HINT}>
              MiniMax 专用：登录 MiniMax 开放平台，在「账户管理」页可以找到
            </span>
          </label>
        ) : null}

        {/* 模型：手动输入 ＋ 下拉选择（获取后或预设推荐） */}
        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <span className={POP_LABEL}>模型名称</span>
            <button
              type="button"
              disabled={fetchingModels}
              onClick={() => void runFetchModels()}
              className="flex cursor-pointer items-center gap-1 rounded-full border-2 border-[#141414] bg-[#6BE3B8] px-2.5 py-1 text-[10.5px] font-bold text-[#141414] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] disabled:opacity-50"
            >
              <RefreshCw
                size={10}
                strokeWidth={2.5}
                className={fetchingModels ? "animate-spin" : ""}
              />
              {fetchingModels ? "获取中…" : "获取模型"}
            </button>
          </div>
          <div className="relative" ref={modelDropdownRef}>
            <input
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                markEdited();
              }}
              placeholder={activeProvider.defaultModel || MODEL_PLACEHOLDER[category]}
              className={`${POP_FIELD} pr-[38px]`}
            />
            <button
              type="button"
              aria-label="选择模型"
              onClick={() => setModelDropdownOpen((v) => !v)}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[#141414] active:bg-[#FFF4DC]"
            >
              <ChevronDown
                size={15}
                strokeWidth={2}
                style={{
                  transition: "transform .2s",
                  transform: modelDropdownOpen ? "rotate(180deg)" : "none",
                }}
              />
            </button>

            {/* 下拉：获取到的模型（没获取过则显示预设推荐），点选填入 */}
            {modelDropdownOpen ? (
              <>
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-48 overflow-y-auto rounded-xl border-2 border-[#141414] bg-white shadow-[3px_3px_0_#141414]">
                  {dropdownItems.length === 0 ? (
                    <div className={`px-3 py-3 ${POP_HINT}`}>
                      {modelList === null && modelCandidates.length === 0
                        ? "点右上「获取模型」拉取列表，或直接输入模型名"
                        : `没有匹配「${model.trim()}」的模型（清空输入框可看全部）`}
                    </div>
                  ) : (
                    dropdownItems.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left text-[12px] font-bold text-[#141414] ${
                          m === model ? "bg-[#D9F24D]" : "hover:bg-[#FFF4DC]"
                        }`}
                        onClick={() => {
                          setModel(m);
                          markEdited();
                          setModelDropdownOpen(false);
                        }}
                      >
                        <span className="truncate">{m}</span>
                        {m === model ? (
                          <Check size={12} strokeWidth={2.5} className="ml-2 flex-none" />
                        ) : null}
                      </button>
                    ))
                  )}
                  {/* 正在显示接口获取的列表时，提供一键回到官方推荐
                      （MiniMax 等语音模型不在 /models 清单里，需要能切回来）。 */}
                  {modelList !== null ? (
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-1.5 border-t-2 border-dashed border-[#EDEAE2] px-3 py-2 text-[10.5px] font-bold text-[#8C8C8C] hover:text-[#141414]"
                      onClick={() => {
                        setModelList(null);
                        setModelDropdownOpen(false);
                      }}
                    >
                      <RotateCcw size={10} strokeWidth={2} />
                      恢复推荐列表
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* 获取失败提示 */}
        {modelFetchError ? (
          <div className="rounded-xl border-2 border-[#B3261E] bg-[#FFE7E4] px-3 py-2 text-[11px] font-bold leading-relaxed text-[#B3261E]">
            ✕ {modelFetchError}（也可直接手动输入模型名）
          </div>
        ) : null}

        {/* 图文生成参数：尺寸／质量／正负面提示词（仅图文 API） */}
        {category === "image" ? (
          <div className="border-t-2 border-dashed border-[#EDEAE2] pt-4">
            {/* 自动生成摆在图文页最上面：
                它决定的是「这张要不要画」，比下面「怎么画」更靠前；而且是全局习惯
                （ChatPrefs），不跟预设方案走，所以一点就存、不等下面那颗「保存」。 */}
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border-2 border-[#141414] bg-[#FFF4DC] px-3 py-3 shadow-[3px_3px_0_#141414]">
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold text-[#141414]">自动生成</div>
                <div className={`mt-1 ${POP_HINT}`}>
                  开：TA 要发图就立刻画；关：先给你看画面描述，点一下才画（不点就不画）
                </div>
              </div>
              <AmberSwitch
                on={autoGenImage}
                onClick={() => {
                  const next = !autoGenImage;
                  setAutoGenImage(next);
                  void saveChatPrefs({ autoGenerateImage: next });
                }}
              />
            </div>
            <div className="mb-3">
              <span className="rounded-full border-2 border-[#141414] bg-[#FF8A3D] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]">
                生成参数
              </span>
            </div>
            <div className="flex flex-col gap-4">
              <SelectField
                label={isNovelAI ? "画幅" : "图片尺寸"}
                value={imgExtras.size}
                options={
                  isNovelAI
                    ? [
                        { value: "832x1216", label: "竖版 832 × 1216" },
                        { value: "1216x832", label: "横版 1216 × 832" },
                        { value: "1024x1024", label: "方形 1024 × 1024" },
                        { value: "1024x1536", label: "竖版 1024 × 1536" },
                        { value: "1536x1024", label: "横版 1536 × 1024" },
                        { value: "auto", label: "自动 · 按竖版 832 × 1216" },
                      ]
                    : [
                        { value: "auto", label: "自动 · 由接口决定" },
                        { value: "1024x1024", label: "1024 × 1024 · 方形" },
                        { value: "1024x1536", label: "1024 × 1536 · 竖版" },
                        { value: "1536x1024", label: "1536 × 1024 · 横版" },
                      ]
                }
                onChange={(v) => {
                  setImgExtras((prev) => ({ ...prev, size: v }));
                  setSaved(false);
                }}
              />
              <div className={`-mt-2 ${POP_HINT}`}>
                {isNovelAI
                  ? "NovelAI 的分辨率必须是 64 的倍数，这几档都已对齐；选「自动」按竖版 832 × 1216。"
                  : "所选尺寸会作为接口参数送出；部分接口（如 gpt-image 系）不认 size 参数、会自己挑比例。选「自动」则交由接口决定。"}
              </div>
              {/* 图片质量是 OpenAI 那套的参数，NovelAI 不吃——它那边给的是画幅与采样参数。 */}
              {isNovelAI ? null : (
                <SelectField
                  label="图片质量"
                  value={imgExtras.quality}
                  options={[
                    { value: "auto", label: "自动" },
                    { value: "low", label: "低" },
                    { value: "medium", label: "中" },
                    { value: "high", label: "高" },
                  ]}
                  onChange={(v) => {
                    setImgExtras((prev) => ({ ...prev, quality: v }));
                    setSaved(false);
                  }}
                />
              )}
              {/* 正面提示词这块按通道分两种长相：
                  · NovelAI —— 三格分开（它是标签模型，位置真影响权重：画风在最前、
                    后缀在最末），照另一个 App 的分法，好分别调；
                  · OpenAI 那套 —— 合成一格（GPT 读一整句话，分三格只会误导，
                    还白占两格地方）。合成/拆分的规矩见上面的 mergedImagePrompt。 */}
              {isNovelAI ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className={POP_LABEL}>画风预设</span>
                    <textarea
                      value={imgExtras.stylePreset}
                      maxLength={2000}
                      onChange={(e) => {
                        setImgExtras((prev) => ({ ...prev, stylePreset: e.target.value }));
                        setSaved(false);
                      }}
                      placeholder="整张画的风格，拼在提示词最前面，如：精致柔光二次元，通透感，厚涂"
                      className={POP_TEXTAREA}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={POP_LABEL}>正面提示词前缀</span>
                    <textarea
                      value={imgExtras.positivePrompt}
                      maxLength={2000}
                      onChange={(e) => {
                        setImgExtras((prev) => ({ ...prev, positivePrompt: e.target.value }));
                        setSaved(false);
                      }}
                      placeholder="每张图都要出现的词，如：masterpiece, best quality, detailed eyes"
                      className={POP_TEXTAREA}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={POP_LABEL}>正面提示词后缀</span>
                    <textarea
                      value={imgExtras.promptSuffix}
                      maxLength={2000}
                      onChange={(e) => {
                        setImgExtras((prev) => ({ ...prev, promptSuffix: e.target.value }));
                        setSaved(false);
                      }}
                      placeholder="补细节用、拼在最后，如：cinematic lighting, depth of field"
                      className={POP_TEXTAREA}
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className={POP_LABEL}>提示词补充</span>
                  <textarea
                    value={mergedImagePrompt}
                    maxLength={6000}
                    onChange={(e) => {
                      /* 整段写回「正面提示词前缀」，另两格清空——内容已经都在这段里了，
                         留着会重复拼一遍。 */
                      setImgExtras((prev) => ({
                        ...prev,
                        positivePrompt: e.target.value,
                        stylePreset: "",
                        promptSuffix: "",
                      }));
                      setSaved(false);
                    }}
                    placeholder="风格和细节都写这儿，如：精致柔光二次元，通透感，厚涂，cinematic lighting"
                    className={POP_TEXTAREA}
                  />
                  <span className={POP_HINT}>
                    想画成什么样就写什么——画风、要补的细节都放这儿。GPT 读的是一整句话，
                    不像 NovelAI 那样分前后位置算权重，所以合成一格。
                  </span>
                </label>
              )}
              <label className="flex flex-col gap-1.5">
                <span className={POP_LABEL}>负面提示词</span>
                <textarea
                  value={imgExtras.negativePrompt}
                  maxLength={2000}
                  onChange={(e) => {
                    setImgExtras((prev) => ({ ...prev, negativePrompt: e.target.value }));
                    setSaved(false);
                  }}
                  placeholder="想避免出现的内容，如：模糊，低清，畸变"
                  className={POP_TEXTAREA}
                />
                <span className={POP_HINT}>
                  {isNovelAI
                    ? "NovelAI 接口直接读这串当负面提示词。"
                    : "认这个参数的接口（多数中转站）会直接收下；OpenAI 官方（GPT 系）与方舟没有这个参数，会把内容改写进正面描述里。建议只填名词——模糊、水印、多余手指这种，别写「不要…」的长句子，模型容易理解反。"}
                </span>
              </label>

              {/* NovelAI 专属采样参数：只有它这套接口吃这四个值，
                  别的接口一律忽略，所以连这一块都只在 NAI 地址下露出来。 */}
              {isNovelAI ? (
                <div className="rounded-2xl border-2 border-[#141414] bg-[#FFF4DC] px-3 py-3">
                  <div className="text-[12.5px] font-extrabold text-[#141414]">NovelAI 采样参数</div>
                  <div className={`mt-1 ${POP_HINT}`}>
                    只有 NovelAI 官方接口吃这四个值；OpenAI 兼容那套会忽略。
                  </div>
                  <div className="mt-3 flex gap-3">
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className={POP_LABEL}>Steps</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={imgExtras.steps === 0 ? "" : String(imgExtras.steps)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d]/g, "");
                          setImgExtras((prev) => ({
                            ...prev,
                            steps: raw === "" ? 0 : Math.min(50, Number(raw)),
                          }));
                          setSaved(false);
                        }}
                        placeholder="28"
                        className={POP_FIELD}
                      />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className={POP_LABEL}>CFG Scale</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={imgExtras.cfgScale === 0 ? "" : String(imgExtras.cfgScale)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d.]/g, "");
                          setImgExtras((prev) => ({
                            ...prev,
                            cfgScale: raw === "" ? 0 : Math.min(10, Number(raw)),
                          }));
                          setSaved(false);
                        }}
                        placeholder="5"
                        className={POP_FIELD}
                      />
                    </label>
                  </div>
                  <div className="mt-3">
                    <SelectField
                      label="采样器"
                      value={imgExtras.sampler}
                      options={NAI_SAMPLER_OPTIONS}
                      onChange={(v) => {
                        setImgExtras((prev) => ({ ...prev, sampler: v }));
                        setSaved(false);
                      }}
                    />
                  </div>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className={POP_LABEL}>Seed</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={imgExtras.seed}
                      onChange={(e) => {
                        setImgExtras((prev) => ({
                          ...prev,
                          seed: e.target.value.replace(/[^\d]/g, ""),
                        }));
                        setSaved(false);
                      }}
                      placeholder="留空随机"
                      className={POP_FIELD}
                    />
                    <span className={POP_HINT}>
                      Steps 1–50，CFG 0–10；Steps 与 CFG 留空按 28 / 5 走。Seed 填了同一颗就能复现同一张。
                    </span>
                  </label>
                </div>
              ) : null}

              {/* 锁脸方式：参考图 vs 纯文字（miya 的 GPT 路线就是纯文字锁脸） */}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#F7F4ED] px-3 py-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-[#141414]">
                    文字锁脸（不用参考图）
                  </div>
                  <div className={`mt-1 ${POP_HINT}`}>
                    开：长相全靠人设文字，表情角度完全自由（偶尔走样）。关：用角色参考图，长相稳定但表情机位容易照抄参考图
                  </div>
                </div>
                <AmberSwitch
                  on={imgExtras.faceLockMode === "text"}
                  onClick={() => {
                    setImgExtras((prev) => ({
                      ...prev,
                      faceLockMode: prev.faceLockMode === "text" ? "ref" : "text",
                    }));
                    setSaved(false);
                  }}
                />
              </div>

              {/* 提示词翻译：中文提示词先经文本 API 译成英文再生图 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#F7F4ED] px-3 py-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-[#141414]">提示词翻译</div>
                  <div className={`mt-1 ${POP_HINT}`}>
                    生图前自动把中文提示词译成英文（需已启用文本 API）
                  </div>
                </div>
                <AmberSwitch
                  on={imgExtras.translatePrompt}
                  onClick={() => {
                    setImgExtras((prev) => ({ ...prev, translatePrompt: !prev.translatePrompt }));
                    setSaved(false);
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* 语音生成参数：音色／语速／音调（仅语音 API） */}
        {category === "voice" ? (
          <div className="border-t-2 border-dashed border-[#EDEAE2] pt-4">
            <div className="mb-3">
              <span className="rounded-full border-2 border-[#141414] bg-[#A78BFA] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]">
                生成参数
              </span>
            </div>
            <div className="flex flex-col gap-4">
              {/* 音色：下拉选常见音色，也支持手动改 */}
              <div className="flex flex-col gap-1.5">
                <span className={POP_LABEL}>音色</span>
                <input
                  type="text"
                  value={voiceExtras.voice}
                  maxLength={40}
                  onChange={(e) => {
                    setVoiceExtras((prev) => ({ ...prev, voice: e.target.value }));
                    setSaved(false);
                  }}
                  placeholder={isMiniMax ? "MiniMax 音色 ID，如 male-qn-qingse" : "服务商的音色名，如 alloy"}
                  className={POP_FIELD}
                />
                <div className="mt-0.5 flex flex-wrap gap-2">
                  {(isMiniMax ? MINIMAX_VOICES : VOICE_PRESETS).map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      className={`cursor-pointer rounded-full border-2 border-[#141414] px-2.5 py-1 text-[10px] text-[#141414] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] ${
                        voiceExtras.voice === v.value
                          ? "bg-[#A78BFA] font-extrabold shadow-[2px_2px_0_#141414]"
                          : "bg-white font-bold"
                      }`}
                      onClick={() => {
                        setVoiceExtras((prev) => ({ ...prev, voice: v.value }));
                        setSaved(false);
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 语速：0.25–4.0 滑杆 */}
              <label className="flex flex-col gap-1.5">
                <span className={POP_LABEL}>
                  语速
                  <span className="ml-2 text-[11px] font-extrabold text-[#141414]">
                    {voiceExtras.speed.toFixed(2)}×
                  </span>
                </span>
                <input
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={voiceExtras.speed}
                  onChange={(e) => {
                    setVoiceExtras((prev) => ({ ...prev, speed: Number(e.target.value) }));
                    setSaved(false);
                  }}
                  style={{ accentColor: POP_TONE.purple }}
                />
              </label>

              {/* 音调：-1 到 1 滑杆 */}
              <label className="flex flex-col gap-1.5">
                <span className={POP_LABEL}>
                  音调
                  <span className="ml-2 text-[11px] font-extrabold text-[#141414]">
                    {voiceExtras.pitch > 0
                      ? `+${voiceExtras.pitch.toFixed(2)}`
                      : voiceExtras.pitch.toFixed(2)}
                  </span>
                </span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={voiceExtras.pitch}
                  onChange={(e) => {
                    setVoiceExtras((prev) => ({ ...prev, pitch: Number(e.target.value) }));
                    setSaved(false);
                  }}
                  style={{ accentColor: POP_TONE.purple }}
                />
                <span className={`mt-1 flex justify-between ${POP_HINT}`}>
                  <span>低沉</span>
                  <span>正常</span>
                  <span>高亢</span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {/* 流式输出（仅文本 API）：边生成边显示 vs 等整段写完一次显示 */}
        {category === "text" ? (
          <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-[#EDEAE2] pt-4">
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-[#141414]">流式输出</div>
              <div className={`mt-1 ${POP_HINT}`}>
                开启后边生成边显示（打字机效果）；关闭则等 TA 写完一次显示
              </div>
            </div>
            <AmberSwitch
              on={streamOn}
              onClick={() => {
                setStreamOn((v) => !v);
                markEdited();
              }}
            />
          </div>
        ) : null}

        {/* 采样参数（仅文本 API）：默认全不发，想调再逐个打开 */}
        {category === "text" ? (
          <div className="space-y-3 border-t-2 border-dashed border-[#EDEAE2] pt-4">
            <div>
              <div className="text-[12.5px] font-bold text-[#141414]">采样参数</div>
              <div className={`mt-1 ${POP_HINT}`}>
                控制 TA 说话的随机程度。默认都不发，走服务商自己的设定；想改再打开。
              </div>
            </div>

            {/* 温度：三档（默认／自定义／不发）——数值不是「发个 0」，是真的不发 */}
            <div className="rounded-xl bg-[#F7F4ED] px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-extrabold text-[#141414]">温度</div>
                  <div className={`mt-0.5 ${POP_HINT}`}>越高越跳脱，越低越稳</div>
                </div>
                <div className="flex flex-none gap-1">
                  {(
                    [
                      ["default", "默认"],
                      ["custom", "自定义"],
                      ["off", "不发"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setTemperatureMode(mode);
                        markEdited();
                      }}
                      style={temperatureMode === mode ? { background: POP_TONE.blue } : undefined}
                      className={`cursor-pointer rounded-lg border-2 border-[#141414] px-2 py-1 text-[10px] font-extrabold text-[#141414] ${
                        temperatureMode === mode ? "" : "bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {temperatureMode === "custom" ? (
                <label className="mt-2 flex flex-col gap-1">
                  <span className="text-right text-[11px] font-extrabold text-[#141414]">
                    {temperature.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => {
                      setTemperature(Number(e.target.value));
                      setSaved(false);
                    }}
                    style={{ accentColor: POP_TONE.blue }}
                  />
                  <span className={`flex justify-between ${POP_HINT}`}>
                    <span>稳</span>
                    <span>跳</span>
                  </span>
                </label>
              ) : null}
              <div className={`mt-1.5 ${POP_HINT}`}>
                {temperatureMode === "default"
                  ? "不调，按 0.8 发"
                  : temperatureMode === "off"
                    ? "这个接口不吃温度，一个都不发"
                    : "按上面的数值发"}
              </div>
            </div>

            <SampleRow
              label="频率惩罚"
              hint="同一个词出现得越多越压它，治复读"
              on={frequencyPenaltyOn}
              onToggle={() => {
                setFrequencyPenaltyOn((v) => !v);
                markEdited();
              }}
              value={frequencyPenalty}
              onValue={(v) => {
                setFrequencyPenalty(v);
                setSaved(false);
              }}
              min={-2}
              max={2}
              step={0.1}
              format={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
            />

            <SampleRow
              label="存在惩罚"
              hint="已经说过的词就少提，治绕圈"
              on={presencePenaltyOn}
              onToggle={() => {
                setPresencePenaltyOn((v) => !v);
                markEdited();
              }}
              value={presencePenalty}
              onValue={(v) => {
                setPresencePenalty(v);
                setSaved(false);
              }}
              min={-2}
              max={2}
              step={0.1}
              format={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
            />

            <div className={POP_HINT}>
              推理型模型（deepseek-reasoner、o1／o3 等）本来就不吃采样参数，无论这里怎么调都会自动跳过。
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-[#EDEAE2] pt-4">
          <span className="text-[13px] font-bold text-[#141414]">{ENABLE_LABEL[category]}</span>
          <AmberSwitch
            on={enabled}
            onClick={() => {
              setEnabled((v) => !v);
              markEdited();
            }}
          />
        </div>
      </div>

      {/* 测试结果（文本＝回复文字；图文＝生成的图片）＋保存 */}
      {testResult ? (
        <div
          className={`rounded-2xl border-2 border-[#141414] px-3 py-2.5 text-[11px] font-bold leading-relaxed shadow-[4px_4px_0_#141414] ${
            testResult.ok ? "bg-[#E4FBF1] text-[#0F7B55]" : "bg-[#FFE7E4] text-[#B3261E]"
          }`}
        >
          {testResult.ok ? "✓ " : "✕ "}
          {testResult.msg}
          {testResult.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={testResult.image}
              alt="测试生成的图片"
              className="mt-2.5 w-full rounded-xl border-2 border-[#141414]"
            />
          ) : null}
          {testResult.audio ? (
            <audio src={testResult.audio} controls className="mt-2.5 w-full" />
          ) : null}
          {testResult.prompt ? (
            <div className="mt-2 break-all text-[10px] font-medium text-[#8C8C8C]">
              实际提示词：{testResult.prompt}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 测试生图固定提示词说明（仅图文页显示） */}
      {category === "image" ? (
        <div className="rounded-2xl bg-[#F7F4ED] px-3 py-2.5 text-[10.5px] font-medium leading-relaxed text-[#8C8C8C]">
          <span className="font-extrabold text-[#141414]">默认提示词</span>（为测试生图功能所用）
          <div className="mt-1">{TEST_IMAGE_PROMPT}</div>
        </div>
      ) : null}

      {/* 保存范围提示：从方案点进来的，保存会连着那个方案一起更新 */}
      {linkedPreset ? (
        <div className={POP_HINT}>这次保存会一并更新方案「{linkedPreset.name}」。</div>
      ) : null}

      <div className="flex gap-3 pt-1">
        {category === "text" ? (
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className={POP_BTN_GHOST + " flex-1"}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        ) : null}
        {category === "image" ? (
          <button
            type="button"
            disabled={testing}
            onClick={() => void runImageTest()}
            className={POP_BTN_GHOST + " flex-1"}
          >
            {testing ? "生成中…" : "测试生图"}
          </button>
        ) : null}
        {category === "voice" ? (
          <button
            type="button"
            disabled={testing}
            onClick={() => void runVoiceTest()}
            className={POP_BTN_GHOST + " flex-1"}
          >
            {testing ? "合成中…" : "测试语音"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className={POP_BTN_PRIMARY + " flex-1"}
        >
          {saving ? "保存中…" : saved ? "已保存" : "保存"}
        </button>
      </div>

      {/* 命名弹窗：新增预设方案／重命名 */}
      {naming ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141414]/40 px-8"
          onClick={() => setNaming(null)}
        >
          <div
            className="w-full max-w-[280px] rounded-[20px] border-2 border-[#141414] bg-white px-5 py-5 shadow-[6px_6px_0_#141414]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center text-[14px] font-extrabold text-[#141414]">
              {naming.id ? "重命名方案" : "存为预设方案"}
            </div>
            {naming.id ? null : (
              <p className={`mt-2 text-center ${POP_HINT}`}>
                把当前表单的地址、Key 和模型一起存进这个方案
              </p>
            )}
            <input
              type="text"
              value={naming.name}
              autoFocus
              maxLength={20}
              onChange={(e) => setNaming({ ...naming, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (naming.id) {
                    const target = presets.find((p) => p.id === naming.id);
                    if (target) void renamePreset(target, naming.name).then(() => setNaming(null));
                  } else {
                    void confirmNaming();
                  }
                }
              }}
              className={`mt-3 ${POP_FIELD}`}
            />
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setNaming(null)}
                className={POP_BTN_GHOST + " flex-1"}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (naming.id) {
                    const target = presets.find((p) => p.id === naming.id);
                    if (target)
                      void renamePreset(target, naming.name).then(() => setNaming(null));
                  } else {
                    void confirmNaming();
                  }
                }}
                className={POP_BTN_PRIMARY + " flex-1"}
              >
                {naming.id ? "改好" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 小型下拉选择（图片尺寸／质量等固定选项；样式与输入框统一）。 */
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  /* 同 ApiCategoryForm：用 document 指针事件代替全屏透明遮罩。 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={POP_LABEL}>{label}</span>
      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full cursor-pointer items-center justify-between gap-2 text-left ${POP_FIELD}`}
        >
          <span className="truncate">{current}</span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className="flex-none text-[#141414]"
            style={{
              transition: "transform .2s",
              transform: open ? "rotate(180deg)" : "none",
            }}
          />
        </button>
        {open ? (
          <>
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-40 overflow-y-auto rounded-xl border-2 border-[#141414] bg-white shadow-[3px_3px_0_#141414]">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left text-[12px] font-bold text-[#141414] ${
                    o.value === value ? "bg-[#D9F24D]" : "hover:bg-[#FFF4DC]"
                  }`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value ? (
                    <Check size={12} strokeWidth={2.5} className="ml-2 flex-none" />
                  ) : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 测试生图固定提示词：英俊男子对镜自拍（手戴饰品），仅供测试功能所用。 */
const TEST_IMAGE_PROMPT =
  "英俊帅气的年轻男子对镜自拍，剑眉星目，五官深邃，微乱的黑发，白衬衫袖口随意挽起，一手举着手机，另一只手自然抬起，指间戴着简约的银戒指，腕间缠绕黑色皮绳手链，眼神漫不经心，室内自然光";

