"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, ImagePlus, X } from "lucide-react";
import { MINIMAX_VOICES } from "@/lib/chat/chatApi";
import { persistRefImage, releaseImageAsset, useMediaSrc } from "@/lib/chat/media-asset";
import { getApiBundle, getApiPresets, type CharacterChatSettings } from "@/lib/settings/chat";
import { refImageToDataUrl } from "./ChatSettingsPanel";
import { AVATAR_GRADIENT, EN, SANS, T } from "./shared";
import { GroupTitle, SettingRow, Switch } from "./widgets";
import type { ArchiveEntry } from "@/types/contact";
import type {
  ApiPresetEntry,
  ApiSettingsBundle,
  ChatApiSettings,
  Conversation,
  VoiceApiExtras,
} from "@/types/chat";
import { DEFAULT_API_SETTINGS, DEFAULT_VOICE_EXTRAS } from "@/types/chat";

/** 角色级 API 覆盖只支持这三类。 */
type RoleApiCategory = "text" | "image" | "voice";

/* =======================================================================
 * 角色设置（通讯人 → 资料页进入）：比较重的个别配置都在这里。
 * - 三类 API 的个别配置：从「设置」里存好的预设方案中点选（不重新填表单）
 * - 个别语音参数（音色／语速／音调；语音方案带音色时一并套用）
 * - 角色生图参考图（从聊天设置迁来，仅此绑定生效）
 *
 * 全页与全 App 同壳：
 *   ① 皮用 T：粉白底／纯白卡／亮粉／无衬线，不用玫瑰棕 #B0776A（勾选框、音色 TAG、
 *      上传钮、滑杆的 accentColor 全落主粉）。
 *   ② 页头用**编辑风**：与个人资料页**逐字同构**——近黑块打底、白圆返回钮、极小英文
 *      索引「character」、26/800 白大标题，下沿 16 柔边过渡、底下接 60 高粉收口带。
 *   ③ 卡内不画分隔线，用 999 圆胶囊行留白撑开（零件见 `widgets.tsx`）。
 * 与「聊天设置」的分工不变：那一页管聊天窗口自身，这一页管这个角色的个别配置。
 * ===================================================================== */

/** 覆盖配置是否与某个预设方案完全一致（地址＋Key＋模型）。 */
function matchesScheme(p: ApiPresetEntry, s?: ChatApiSettings): boolean {
  if (!s) return false;
  return p.baseUrl === s.baseUrl && p.apiKey === s.apiKey && p.model === s.model;
}

/** 音色显示名（MiniMax 目录里的中文名，其余显示原值）。 */
const voiceLabel = (v: string) => MINIMAX_VOICES.find((x) => x.value === v)?.label ?? v;

/** 三类 API 的展示信息。 */
const CAT_META: Record<RoleApiCategory, { title: string; desc: string }> = {
  text: { title: "文本 API", desc: "TA 的回复走这个接口" },
  image: { title: "图文 API", desc: "TA 发的图片走这个接口" },
  voice: { title: "语音 API", desc: "TA 的声音走这个接口" },
};
const CAT_ORDER: RoleApiCategory[] = ["text", "image", "voice"];

const BLANK_API: ChatApiSettings = { ...DEFAULT_API_SETTINGS };

export default function CharacterSettingsPanel({
  character,
  conv,
  onBack,
  onUpdate,
  showToast,
}: {
  character: ArchiveEntry;
  conv: Conversation;
  onBack: () => void;
  /* 这三样（个别 API／语音参数／生图参考图）是**角色级**的，跟角色走、不跟面具，
     所以类型是 CharacterChatSettings 而不是会话的 patch。 */
  onUpdate: (patch: CharacterChatSettings) => Promise<void>;
  showToast: (msg: string) => void;
}) {
  /* 全局设定（开关关闭时显示「跟随全局」的状态；开启时作为初始底稿）。 */
  const [bundle, setBundle] = useState<ApiSettingsBundle | null>(null);
  /* 「设置」里存好的预设方案（三类各自一份，点选套用）。 */
  const [presetLists, setPresetLists] = useState<Record<RoleApiCategory, ApiPresetEntry[]>>({
    text: [],
    image: [],
    voice: [],
  });
  /* 三类覆盖的当前值镜像（保留 MiniMax 团队 ID 等方案里没存的字段）。 */
  const [drafts, setDrafts] = useState<Record<RoleApiCategory, ChatApiSettings>>({
    text: BLANK_API,
    image: BLANK_API,
    voice: BLANK_API,
  });
  /* 个别语音参数底稿。 */
  const [voiceDraft, setVoiceDraft] = useState<VoiceApiExtras>(DEFAULT_VOICE_EXTRAS);
  const [uploading, setUploading] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  /* 参考图预览地址：新数据是图片仓库的引用串（得读库换临时地址），老数据是 data URL（原样用）。 */
  const refSrc = useMediaSrc(conv.charRefImage);

  const charName = character.data.name || character.data.nickname || "TA";
  /* 头像跟随：页头那枚徽记要跟个人资料页那张头像同源。
     档案里有照片就用照片，没有才退回首字。 */
  const charPhoto = character.data.photo;
  const overrides = conv.apiOverrides ?? {};

  /* 载入全局设定＋已有覆盖底稿＋「设置」里存好的预设方案。 */
  useEffect(() => {
    let alive = true;
    void getApiBundle().then((b) => {
      if (!alive) return;
      setBundle(b);
      setDrafts({
        text: overrides.text ?? b.text,
        image: overrides.image ?? b.image,
        voice: overrides.voice ?? b.voice,
      });
      setVoiceDraft(conv.voiceOverride ?? b.voiceExtras);
    });
    void Promise.all([
      getApiPresets("text"),
      getApiPresets("image"),
      getApiPresets("voice"),
    ]).then(([text, image, voice]) => {
      if (!alive) return;
      setPresetLists({ text, image, voice });
    });
    return () => {
      alive = false;
    };
    // 仅载入时执行一次：之后底稿由本地编辑驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 覆盖开关 ---------- */

  /* 最新覆盖镜像（覆盖只有本页会写：连续开关多类时以本地累积为准，避免旧 conv 覆盖新值）。 */
  const overridesRef = useRef(conv.apiOverrides);

  /* 本页写入队列：所有角色级设置更新串行排队＋失败弹 toast（防止静默丢失）。 */
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueWrite = (patch: CharacterChatSettings): Promise<void> => {
    writeQueueRef.current = writeQueueRef.current
      .then(() => onUpdate(patch))
      .catch(() => {
        showToast("保存失败，请重试");
      });
    return writeQueueRef.current;
  };

  /* ---------- 参考图旧数据搬家 ---------- */

  /* 参考图当前值的最新镜像：搬家是异步的，回来时得知道这张图有没有被换掉。 */
  const refValueRef = useRef(conv.charRefImage);
  useEffect(() => {
    refValueRef.current = conv.charRefImage;
  }, [conv.charRefImage]);

  /* 以前参考图是 base64 长串直接躺在会话记录里，而会话记录是「每次读列表都整份读出」的那个键，
     一张截图就能让它膨胀几 MB。所以载入时静默把它搬进图片仓库，会话里只留一句引用串——
     只搬这一次，以后新上传的图当场就进仓库了。
     存库失败、或期间用户自己换了图：什么都不做，图还在原处，照常能用。 */
  useEffect(() => {
    const cur = refValueRef.current;
    if (!cur || !cur.startsWith("data:")) return;
    void persistRefImage(cur).then((stored) => {
      if (!stored || refValueRef.current !== cur) return;
      void enqueueWrite({ charRefImage: stored.ref });
    });
    // 仅载入时搬一次家。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 写入某一类的覆盖（整包写入，基于最新镜像累积）。 */
  const saveOverride = (cat: RoleApiCategory, next: ChatApiSettings) => {
    setDrafts((d) => ({ ...d, [cat]: next }));
    const merged = { ...overridesRef.current, [cat]: next };
    overridesRef.current = merged;
    void enqueueWrite({ apiOverrides: merged });
  };

  const toggleCat = (cat: RoleApiCategory) => {
    if (overrides[cat]) {
      // 关：删掉覆盖，跟随全局
      const merged = { ...overridesRef.current, [cat]: undefined };
      overridesRef.current = merged;
      void enqueueWrite({ apiOverrides: merged });
      return;
    }
    // 开：以全局为底稿抄一份（Key 也带上，通常只是换个模型）；清掉来源方案标记
    const base = bundle ? bundle[cat] : drafts[cat];
    saveOverride(cat, { ...base, presetId: undefined, presetName: undefined });
  };

  /** 跟随全局时的状态描述。 */
  const globalStatus = (cat: RoleApiCategory): string => {
    if (!bundle) return "跟随全局设定";
    const s = bundle[cat];
    if (s.enabled && s.baseUrl.trim() && s.model.trim()) return `跟随全局 · ${s.model}`;
    return s.baseUrl.trim() || s.model.trim() ? "跟随全局 · 未启用" : "跟随全局 · 未配置";
  };

  /** 当前行选中的方案：优先按记录的方案 ID（点哪行勾哪行），旧数据退回按值匹配。 */
  const activeSchemeOf = (cat: RoleApiCategory): ApiPresetEntry | undefined => {
    const s = overrides[cat];
    if (!s) return undefined;
    const list = presetLists[cat];
    return list.find((p) => p.id === s.presetId) ?? list.find((p) => matchesScheme(p, s));
  };

  /** 行描述：开启时显示方案名／与全局相同／独立配置。 */
  const descOf = (cat: RoleApiCategory): string => {
    const s = overrides[cat];
    if (!s) return globalStatus(cat);
    const active = activeSchemeOf(cat);
    if (active) return `使用方案「${active.name}」`;
    // 方案已被删除但覆盖还在：按记录的名字显示来源
    if (s.presetName) return `使用方案「${s.presetName}」（方案已删）`;
    const g = bundle?.[cat];
    if (
      g &&
      s.baseUrl === g.baseUrl &&
      s.apiKey === g.apiKey &&
      s.model === g.model &&
      s.enabled === g.enabled
    ) {
      return "已开启 · 当前与全局相同";
    }
    return `独立配置 · ${s.model || "未设模型"}`;
  };

  /** 套用一个预设方案为该角色的覆盖（来自「设置」里存的方案；语音方案带音色时一并套用）。 */
  const applyScheme = (cat: RoleApiCategory, p: ApiPresetEntry) => {
    const next: ChatApiSettings = {
      // MiniMax 团队 ID 不随方案走：沿用当前值（方案里没存这个）
      ...(cat === "voice" && drafts.voice.groupId ? { groupId: drafts.voice.groupId } : {}),
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      enabled: true,
      // 记住来源方案：选中状态按 ID 认，不靠值比对
      presetId: p.id,
      presetName: p.name,
    };
    setDrafts((d) => ({ ...d, [cat]: next }));
    const merged = { ...overridesRef.current, [cat]: next };
    overridesRef.current = merged;
    // apiOverrides 与 voiceOverride 合成一个 patch 一次写入，避免两次落库互相覆盖。
    const patch: CharacterChatSettings = { apiOverrides: merged };
    if (cat === "voice" && p.voiceExtras) {
      setVoiceDraft(p.voiceExtras);
      patch.voiceOverride = p.voiceExtras;
      showToast(`已切换到「${p.name}」· 音色参数一并套用`);
    } else {
      showToast(`已切换到「${p.name}」`);
    }
    void enqueueWrite(patch);
  };

  /* ---------- 语音参数 ---------- */

  const voiceOn = !!conv.voiceOverride;

  const toggleVoiceExtras = () => {
    if (voiceOn) {
      void enqueueWrite({ voiceOverride: undefined });
      return;
    }
    const base = bundle?.voiceExtras ?? voiceDraft;
    setVoiceDraft(base);
    void enqueueWrite({ voiceOverride: base });
  };

  const commitVoiceExtras = () => {
    if (voiceOn) void enqueueWrite({ voiceOverride: voiceDraft });
  };

  /* ---------- 参考图 ---------- */

  const onRefPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    /* 换新图前先记下旧的那张：写成功之后它再没人引用，得从仓库里收回。 */
    const prev = refValueRef.current;
    try {
      const dataUrl = await refImageToDataUrl(file);
      /* 压好的图直接进图片仓库，会话里只留一句引用串——
         长 base64 从此不再躺在聊天记录里。仓库出任何问题都退回原图 data URL，
         图绝不会因为仓库的事而丢。 */
      const stored = await persistRefImage(dataUrl);
      await enqueueWrite({ charRefImage: stored?.ref ?? dataUrl });
      releaseImageAsset(prev);
      showToast("参考图已更新，TA 的自拍会照着这张脸生成");
    } catch {
      showToast("图片处理失败，请换一张试试");
    } finally {
      setUploading(false);
    }
  };

  /** 清空参考图：会话里的引用去掉，仓库那份一并收回（否则只进不出）。 */
  const clearRefImage = async () => {
    const prev = refValueRef.current;
    await enqueueWrite({ charRefImage: "" });
    releaseImageAsset(prev);
  };

  /* 白卡：与聊天设置页同一套纯白卡——圆角加大、投影压得很低很薄，卡只是白卡，不再是一张纸。 */
  const cardStyle: CSSProperties = {
    background: T.card,
    borderRadius: 18,
    border: `1px solid ${T.lineSoft}`,
    boxShadow: "0 16px 30px -26px rgba(20,19,24,.85)",
    overflow: "hidden",
    marginBottom: 18,
  };

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        fontFamily: SANS,
        color: T.ink,
        overflow: "hidden",
      }}
    >
      <input
        ref={refInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onRefPicked(e)}
      />

      {/* 顶栏：这页页头就两行字，**不要压一整块色块**——色块再说明亮也是块空地，
          越重越显空（黑块、深玫红块都试过，同样不行）。所以改成跟「聊天设置」页同一套
          **轻页头**：浅粉渐变底打头、近黑只落返回钮那一枚、墨色 26/800 大标题，
          底下一条粉渐变细线收边。设置类页面（信息量小）就该这样轻着头，
          大色块留给有头像、有名字撑得住的资料页。

          底色解决后还得有属于「角色」的东西，不能做成聊天设置页的翻版（页头两行字、
          底下三个白盒子）。所以定下**结构语言**：
          ① 页头加一枚角色身份徽记（首字压在头像渐变上）——页头有落点，不是一张空白公文纸；
          ② 三张卡从「卡外一行小标题」改成「卡内章节头」——左边一枚编号方块 01／02／03，
             中间标题、右边英文索引，底下一条淡线隔开内容：三张卡成了册子里的三个章节，
             而且编号方块在「这块已配置」时亮粉，顺手当状态灯用。 */}
      <div
        style={{
          flex: "none",
          position: "relative",
          background: `linear-gradient(180deg, #FDE9F1 0%, ${T.bg} 100%)`,
        }}
      >
        <div
          style={{
            padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 18px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" onClick={onBack} aria-label="返回" style={headerBtnStyle}>
              <ChevronLeft size={19} strokeWidth={2.4} />
            </button>
            <span
              style={{
                fontFamily: EN,
                fontSize: 9,
                letterSpacing: ".26em",
                color: T.ink3,
                textTransform: "uppercase",
              }}
            >
              character
            </span>
          </div>

          {/* 身份牌：一枚角色头像徽记 ＋ 大标题，底下压一行角色名。
              徽记要跟个人资料页那张头像同源：①照片优先，没照片才退回首字；
              ②白→粉描边＋外一圈细粉环＋浮影，跟个人资料页那颗头像同一套做法（缩小版）。 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <div style={crestStyle}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: ".02em",
                  overflow: "hidden",
                  background: charPhoto ? `url(${charPhoto}) center/cover` : AVATAR_GRADIENT,
                }}
              >
                {!charPhoto ? charName.charAt(0) : null}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 25,
                  fontWeight: 800,
                  letterSpacing: "-.01em",
                  lineHeight: 1,
                  color: T.ink,
                }}
              >
                角色设置
              </h1>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 10.5,
                  color: T.ink2,
                  letterSpacing: ".05em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {charName}
              </div>
            </div>
          </div>
        </div>

        {/* 页头收边：一条 1px 粉渐变线（同聊天设置页），粉只在这里跳一下 */}
        <i
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 0,
            height: 1,
            background: "linear-gradient(90deg, transparent, rgba(232,106,155,.34), transparent)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* 内容 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "14px 16px calc(var(--safe-area-bottom, 0px) + 28px)",
        }}
      >
        {/* 说明段：左侧一根粉引注线，跟三个「章节」同一套排法，别让它散在页上 */}
        <p
          style={{
            margin: "0 0 14px",
            paddingLeft: 11,
            borderLeft: "2px solid rgba(232,106,155,.28)",
            fontSize: 10.5,
            color: T.ink3,
            letterSpacing: ".05em",
            lineHeight: 1.8,
          }}
        >
          只对「{charName}」生效的设定。开启后从「设置」里存好的预设方案中点选；
          关闭则跟随主屏幕「设置」里的全局配置。
        </p>

        {/* 个别 API 配置（章节 01：三类里任意一类开了覆盖，编号方块就亮粉） */}
        <div style={cardStyle}>
          <GroupTitle
            title="个别 API 配置"
            en="api overrides"
            num="01"
            on={CAT_ORDER.some((cat) => !!overrides[cat])}
          />
          {CAT_ORDER.map((cat) => {
            const on = !!overrides[cat];
            const meta = CAT_META[cat];
            const list = presetLists[cat];
            const active = activeSchemeOf(cat);
            return (
              <div key={cat}>
                {/* 卡内不画分隔线：行与行靠圆胶囊自己的留白撑开，
                    卡里不再一道一道划横线 */}
                <SettingRow
                  title={meta.title}
                  desc={descOf(cat)}
                  showArrow={false}
                  right={<Switch on={on} onClick={() => toggleCat(cat)} />}
                />
                {on ? (
                  <div style={{ padding: "2px 14px 14px" }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: T.ink3,
                        letterSpacing: ".04em",
                        lineHeight: 1.7,
                        margin: "0 2px 8px",
                      }}
                    >
                      点选一个方案给 {charName} 用：
                    </div>
                    {list.length === 0 ? (
                      <div style={emptySchemeStyle}>
                        还没有可选的方案。到主屏幕「设置」→「API 设定」里，把配好的配置点「存当前配置」存成方案，这里就能直接选。
                      </div>
                    ) : (
                      list.map((p) => {
                        const sel = active?.id === p.id;
                        const host = p.baseUrl.replace(/^https?:\/\//, "").split("/")[0];
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyScheme(cat, p)}
                            style={schemeRowStyle(sel)}
                          >
                            <span style={radioStyle(sel)}>
                              {sel ? <Check size={10} strokeWidth={3} color="#FFF" /> : null}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={schemeNameStyle}>{p.name}</span>
                              <span style={schemeSubStyle}>
                                {p.model || "未设模型"} · {host || "未设地址"}
                                {cat === "voice" && p.voiceExtras?.voice
                                  ? ` · ${voiceLabel(p.voiceExtras.voice)}`
                                  : ""}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 个别语音参数（章节 02） */}
        <div style={cardStyle}>
          <GroupTitle title="个别语音参数" en="voice params" num="02" on={voiceOn} />
          <SettingRow
            title="语音参数"
            desc={voiceOn ? "已开启个别配置" : "跟随全局 · 音色与语速语调"}
            showArrow={false}
            right={<Switch on={voiceOn} onClick={toggleVoiceExtras} />}
          />
          {voiceOn ? (
            <div style={{ padding: "2px 14px 16px" }}>
              <div style={fieldLabelStyle}>音色（服务商的 voice 名，可手填）</div>
              <input
                type="text"
                value={voiceDraft.voice}
                onChange={(e) => setVoiceDraft({ ...voiceDraft, voice: e.target.value })}
                onBlur={commitVoiceExtras}
                placeholder="如 alloy / male-qn-qingse / 复刻音色 ID"
                style={inputStyle}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {MINIMAX_VOICES.map((v) => {
                  const selected = voiceDraft.voice === v.value;
                  return (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => {
                        setVoiceDraft({ ...voiceDraft, voice: v.value });
                        if (voiceOn) void enqueueWrite({ voiceOverride: { ...voiceDraft, voice: v.value } });
                      }}
                      style={selected ? tagSelStyle : tagStyle}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ ...fieldLabelStyle, marginTop: 14 }}>
                语速 <span style={{ fontFamily: EN, color: T.ink2 }}>{voiceDraft.speed.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={voiceDraft.speed}
                onChange={(e) => setVoiceDraft({ ...voiceDraft, speed: Number(e.target.value) })}
                onPointerUp={commitVoiceExtras}
                onKeyUp={commitVoiceExtras}
                style={{ width: "100%", accentColor: T.pink }}
              />

              <div style={{ ...fieldLabelStyle, marginTop: 12 }}>
                音调 <span style={{ fontFamily: EN, color: T.ink2 }}>{voiceDraft.pitch.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={voiceDraft.pitch}
                onChange={(e) => setVoiceDraft({ ...voiceDraft, pitch: Number(e.target.value) })}
                onPointerUp={commitVoiceExtras}
                onKeyUp={commitVoiceExtras}
                style={{ width: "100%", accentColor: T.pink }}
              />
            </div>
          ) : null}
        </div>

        {/* 角色生图参考（章节 03：已传参考图就亮粉） */}
        <div style={cardStyle}>
          <GroupTitle title="角色生图参考" en="reference" num="03" on={!!conv.charRefImage} />
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ fontSize: 10, color: T.ink3, letterSpacing: ".04em", lineHeight: 1.7, marginBottom: 10 }}>
              上传一张 TA 的形象照作为参考图：TA 发自拍时只照着这张脸画——脸部特征、发型、
              体型保持一致，姿势和场景会按 TA 描述的全新画。仅这个绑定生效；需图文 API 支持图片参考。
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  ...refPreviewStyle,
                  background: refSrc
                    ? `url(${refSrc}) center/cover`
                    : AVATAR_GRADIENT,
                }}
              >
                {!conv.charRefImage ? charName.charAt(0) : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, letterSpacing: ".06em", fontWeight: 500 }}>
                  {charName}的参考图
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                  <button
                    type="button"
                    onClick={() => refInputRef.current?.click()}
                    disabled={uploading}
                    style={uploadBtnStyle}
                  >
                    <ImagePlus size={12} strokeWidth={1.6} />
                    {uploading ? "处理中…" : conv.charRefImage ? "更换参考图" : "上传参考图"}
                  </button>
                  {conv.charRefImage ? (
                    <button
                      type="button"
                      onClick={() => void clearRefImage()}
                      style={clearBtnStyle}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- 样式 ----------------------------- */

/** 预设方案行（点选套用；选中行带淡粉底与圆形勾）。 */
const schemeRowStyle = (sel: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 10px",
  borderRadius: 12,
  border: "none",
  background: sel ? "rgba(232,106,155,.1)" : "transparent",
  cursor: "pointer",
  textAlign: "left",
  transition: "background .15s",
});

/** 方案行左侧的圆形勾选框（未选＝新墨的浅灰圈，选中＝主粉实心）。 */
const radioStyle = (sel: boolean): CSSProperties => ({
  flex: "none",
  width: 16,
  height: 16,
  borderRadius: "50%",
  border: `1px solid ${sel ? T.pink : "rgba(20,19,24,.14)"}`,
  background: sel ? T.pink : "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#FFF",
});

const schemeNameStyle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: T.ink,
  letterSpacing: ".04em",
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const schemeSubStyle: CSSProperties = {
  display: "block",
  fontFamily: EN,
  fontSize: 9,
  color: T.ink3,
  letterSpacing: ".06em",
  marginTop: 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 没有可选方案时的引导文案。 */
const emptySchemeStyle: CSSProperties = {
  fontSize: 10,
  color: T.ink3,
  lineHeight: 1.8,
  letterSpacing: ".04em",
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(20,19,24,.04)",
};

/** 页头那颗返回钮：跟聊天设置页同一颗——近黑小圆＋白箭头。
    页头不再是色块，黑就只剩这一枚，当整页的「重点」用。 */
const headerBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#FFFFFF",
  background: T.ink,
  border: "none",
  boxShadow: "0 4px 12px -4px rgba(20,19,24,.5)",
  cursor: "pointer",
  flex: "none",
};

/** 页头头像徽记：就是个人资料页那颗头像的缩小版——白→粉渐变描边（`padding 2.5`），
    外圈拿两层 `boxShadow` 叠出一圈细粉环（4px 淡粉带 ＋ 5px 粉线），底下一层浮影。
    里层自己铺照片（有照片）或头像渐变＋首字（没照片），见用它的那一处。
    页头两行字太素，加一枚有颜色的身份标记才有落点；
    这枚要**跟随个人资料页那张头像**——同源，也同一样子。 */
const crestStyle: CSSProperties = {
  position: "relative",
  flex: "none",
  width: 46,
  height: 46,
  borderRadius: "50%",
  padding: 2.5,
  background: "linear-gradient(150deg, #FFFFFF 0%, #FBD3E6 100%)",
  boxShadow:
    "0 0 0 4px rgba(232,106,155,.14), 0 0 0 5px rgba(232,106,155,.30), 0 12px 22px -14px rgba(20,19,24,.5)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 10,
  color: T.ink3,
  letterSpacing: ".08em",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: `1px solid ${T.line}`,
  background: T.bg,
  borderRadius: 12,
  padding: "9px 12px",
  fontSize: 12.5,
  fontFamily: SANS,
  color: T.ink,
  outline: "none",
  letterSpacing: ".03em",
};

const tagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 10,
  color: T.ink2,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid rgba(20,19,24,.14)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: SANS,
  letterSpacing: ".04em",
};

const tagSelStyle: CSSProperties = {
  ...tagStyle,
  color: T.pink,
  border: "1px solid rgba(232,106,155,.5)",
  background: "rgba(232,106,155,.08)",
};

const uploadBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10.5,
  color: T.pink,
  letterSpacing: ".05em",
  padding: "5px 11px",
  borderRadius: 999,
  border: "1px solid rgba(232,106,155,.3)",
  background: "rgba(232,106,155,.08)",
  cursor: "pointer",
  fontFamily: SANS,
};

const clearBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 999,
  color: T.ink3,
  border: "1px solid rgba(20,19,24,.14)",
  background: "transparent",
  cursor: "pointer",
};

/** 参考图预览：方形圆角，示意「这是一张照片」而非头像。 */
const refPreviewStyle: CSSProperties = {
  flex: "none",
  width: 52,
  height: 52,
  borderRadius: 10,
  color: "#FFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 17,
  fontWeight: 600,
  overflow: "hidden",
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)",
};
