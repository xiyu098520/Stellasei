"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Minus, Plus, Trash2, X } from "lucide-react";
import { clampBubbleMax, type ConversationPatch } from "@/lib/settings/chat";
import { AVATAR_GRADIENT, CHAT_BG_DEFAULT, EN, SANS, T } from "./shared";
import type { ArchiveEntry } from "@/types/contact";
import { TRANSLATE_LANGS, type Conversation, type TranslateSetting } from "@/types/chat";

/** 外语聊天的出厂值：两个开关都关着，语言默认日语，翻译走便宜的副接口。
 *  「显示中文那一行」默认开——开翻译却看不见中文，等于白开。
 *  inner（心声页双语）默认关：心声页默认仍是他写外语、点一下才看中文。 */
const DEFAULT_TRANSLATE: TranslateSetting = {
  out: { on: false, lang: "日语", show: true },
  in: { on: false, lang: "日语", show: true },
  api: "sub",
  inner: false,
};

/* =======================================================================
 * 每聊天设定（跟随旧档案 ChatSettings）：背景／字号／置顶／免打扰／
 * 自定义头像／清空聊天记录／拉黑／删除好友（假删）。
 * 角色生图参考与个别 API 配置在「角色设置」（通讯人 → 资料页）。
 *
 * 整页语言用 T：透粉白底／纯白卡／亮粉／无衬线／大圆角＋浮影。
 * 它上面盖着的那一屏（聊天窗口）是「黑粉蓝」板，点三个点进来风格得接得上，
 * 不能像换了个 App。
 *
 * 颜色搭配要跟侧边栏呼应，但**「样式搭配」指的其实是结构**：
 * 光换色不够，**结构**也要跟侧边栏对上眼——页头改成侧边栏那一套「一行英文
 * 小字起头＋26/800 大标题」，分组小标改成同一结构的缩小版（英文小字在上、中文名
 * 压在下面），卡里那一条条分隔线全部拿掉、换成留白撑开的一列圆角行；颜色上把
 * 「黑」引进来当重色（大标题、分组名、返回钮＝近黑圆白图标），粉只留作唯一亮点。
 * **不整页翻黑**：整页翻黑会再跟盖着它的聊天窗口断一次。
 *
 * 零件（GroupTitle／SettingRow／Switch）在文件末尾本地重写了一份，
 * **不动 `widgets.tsx`**——那份还带着「角色设置／通讯人」两个页面在用。
 *
 * 光换皮不够：五张一模一样的白卡摞到底，骨架没动，一眼还是「没变」。
 * 骨架得动，三刀：
 *   ① 首屏换成一张**预览**——当前壁纸铺满整块、角色头像浮在左上、底下压两条示意气泡，
 *      整块点一下就是换背景。「聊天背景」不再是列表里的一条，它是这一页的门面。
 *   ② **整页去卡片化**——白卡全部拿掉，字号／消息设置直接铺在粉白底上一行行排开
 *      （跟侧边栏「一行一枚圆角行」同一套）；头像段改成**并排两枚方砖**；危险区域
 *      改成**一片淡红雾**。一列到底的白卡列表到此为止。
 *   ③ 分组名放大到 19/800，跟侧边栏大标题同一语气。
 * 仍然**不整页翻黑**（会再跟盖着它的聊天窗口断一次），黑只落在大标题与返回钮上。
 * ===================================================================== */

/** 文件 → 压缩 data URL（canvas，最宽 maxW，JPEG）。 */
export function fileToDataUrl(file: File, maxW: number, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("解析图片失败"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas 不可用"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** 生图参考图专用：只转格式，几乎不压缩。
 *  最长边超过 2200 才缩，一律出 JPEG。
 *  **PNG 不该无损原样返回**：PNG 恰恰是截图／微信存图／
 *  网图的默认格式，而 PNG 是无损格式、对照片极不划算——一张几 MB 的截图就这么原封不动
 *  进库、每次生图再整条发给接口。现在改成**只看结果体积，不看格式**：小 PNG（本来就
 *  没超标）仍留无损，超标一律转 JPEG。
 *  同一个坑还有 WebP：老机型 `toDataURL("image/webp")` 不支持时会**默默回你一张 PNG**，
 *  代码还以为自己压过了。所以不试 WebP、不看浏览器脸色，一律 JPEG。
 *  上限仍留 2200／2MB：参考项目实调过，压得越狠，模型越容易把构图姿势整张照抄、
 *  长相反而不稳。这张图是喂给生图模型当底图的，别再往下调。 */
export function refImageToDataUrl(file: File): Promise<string> {
  const MAX_DIM = 2200;
  const TARGET_BYTES = 2 * 1024 * 1024;
  const START_QUALITY = 0.92;
  const MIN_QUALITY = 0.5;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("解析图片失败"));
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        const scale = Math.min(1, MAX_DIM / longest);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas 不可用"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const src = (file.type || "").toLowerCase();
        /* 本来就够小的 PNG 留无损：没必要平白掉一次细节（base64 长度 × 0.75 折回字节数）。 */
        if (src === "image/png") {
          const lossless = canvas.toDataURL("image/png");
          if (lossless.length * 0.75 <= TARGET_BYTES) {
            resolve(lossless);
            return;
          }
        }
        /* 转 JPEG 前先在画面「下面」垫一层白：destination-over 只落在透明像素底下，
           不会盖掉画面本身；不垫的话透明区域转 JPEG 会变成黑块，当脸底图就毁了。 */
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        let quality = START_QUALITY;
        let out = canvas.toDataURL("image/jpeg", quality);
        while (out.length * 0.75 > TARGET_BYTES && quality > MIN_QUALITY) {
          quality = Number((quality - 0.1).toFixed(2));
          out = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(out);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** 条数步进器（与「字体大小」那行同款手感）：− 数字 ＋。
 *  不用输入框是故意的——数字框清空会送出 0，正打字时会被夹取弹回，
 *  连起来打「13」能变成「1」「3」两次落库；步进器没有这个中间态。 */
function StepCount({ value, onStep }: { value: number; onStep: (delta: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button type="button" aria-label="减少" onClick={() => onStep(-1)} style={stepBtnStyle}>
        <Minus size={15} strokeWidth={2} />
      </button>
      <span
        style={{
          fontFamily: EN,
          fontSize: 17,
          color: T.ink,
          minWidth: 22,
          textAlign: "center",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <button type="button" aria-label="增加" onClick={() => onStep(1)} style={stepBtnStyle}>
        <Plus size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

export default function ChatSettingsPanel({
  character,
  conv,
  myName,
  maskAvatar = "",
  blocked = false,
  subReady = false,
  onBack,
  onUpdate,
  onClearMessages,
  onToggleBlocked,
  onDeleteFriend,
  onHardDeleteFriend,
  showToast,
}: {
  character: ArchiveEntry;
  conv: Conversation;
  myName: string;
  /** 当前面具的头像（dataURL）：本聊天没单独设「我的头像」时就跟随它。 */
  maskAvatar?: string;
  /** 拉黑中（危险区开关的当前状态）。 */
  blocked?: boolean;
  /** 副接口是否真配齐了（启用＋地址＋模型）：翻译那一栏拿它说真话——
   *  挑的副接口没配齐时会自动退回主接口，不告诉用户的话账单上就对不上。 */
  subReady?: boolean;
  onBack: () => void;
  onUpdate: (patch: ConversationPatch) => Promise<void>;
  onClearMessages: () => Promise<void>;
  /** 拉黑／解除拉黑（外层负责落库与提示词注入）。 */
  onToggleBlocked: (next: boolean) => void;
  /** 删除好友（假删：列表消失、记录保留，由外层收尾退出聊天）。 */
  onDeleteFriend: () => void;
  /** 彻底删除好友（真删：记录与记忆一并清掉，由外层收尾退出聊天）。 */
  onHardDeleteFriend: () => void;
  showToast: (msg: string) => void;
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDelConfirm, setShowDelConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const charAvatarInputRef = useRef<HTMLInputElement>(null);
  const myAvatarInputRef = useRef<HTMLInputElement>(null);

  const charName = character.data.name || character.data.nickname || "TA";
  const fontSize = conv.fontSize ?? 13;
  /* 外语聊天：老会话没有这一格，拿出厂值顶上，改哪一项写哪一项。 */
  const tr: TranslateSetting = conv.translate ?? DEFAULT_TRANSLATE;

  const pickFile = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click();

  const onBgPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file, 900, 0.78);
      await onUpdate({ chatBgUrl: dataUrl });
      showToast("背景已更新");
    } catch {
      showToast("图片处理失败，请换一张试试");
    } finally {
      setUploading(false);
    }
  };

  const onAvatarPicked = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "charAvatar" | "myAvatar",
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file, 300, 0.72);
      await onUpdate({ [field]: dataUrl });
      showToast(field === "charAvatar" ? "角色头像已更新" : "我的头像已更新");
    } catch {
      showToast("图片处理失败，请换一张试试");
    } finally {
      setUploading(false);
    }
  };

  /* 气泡条数：每聊天设定（跟置顶／免打扰同一份存档），**这个角色归这个角色**。
     没设过的会话＝默认开、5 条，所以只有显式 false 才算关。 */
  const bubbleOn = conv.bubbleLimit !== false;
  const bubbleMax = clampBubbleMax(conv.bubbleMax);

  /* 条数的 −／＋：夹取（取整、1–15）在 clampBubbleMax 里；顶到头就不写库，
     省下一次无意义的落库。 */
  const stepBubbleMax = (delta: number) => {
    const next = clampBubbleMax(bubbleMax + delta);
    if (next === bubbleMax) return;
    void onUpdate({ bubbleMax: next });
  };

  /** 参考图等重配置已迁至「角色设置」（通讯人 → 资料页 → 角色设置）。 */

  /* 白卡全部撤掉，
     字号／消息设置直接铺在粉白底上（跟侧边栏「一行一枚圆角行」同一套语言），
     分组只靠大字标题＋段间留白来分。所以这里不再是 cardStyle，只剩「一段」的容器：
     左右各外扩 10px，让行的按下高亮能比文字宽出一指，而文字仍然对齐页边距。 */
  const sectionStyle: CSSProperties = { margin: "0 -10px" };

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
      {/* 隐藏的文件选择 */}
      <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={(e) => void onBgPicked(e)} />
      <input
        ref={charAvatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onAvatarPicked(e, "charAvatar")}
      />
      <input
        ref={myAvatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onAvatarPicked(e, "myAvatar")}
      />

      {/* 交互：按下缩一档（不跑动画，只动 transform／filter／底色） */}
      <style>{`
        .cs-soft { transition: transform .16s ease, opacity .16s ease; }
        .cs-soft:active { transform: scale(.93); opacity: .7; }
        .cs-fill { transition: transform .16s ease, filter .16s ease; }
        .cs-fill:active { filter: brightness(.94); }
        .cs-row { transition: background-color .16s ease; }
        .cs-row:active { background: rgba(232,106,155,.1); }
        @media (prefers-reduced-motion: reduce) {
          .cs-soft, .cs-fill, .cs-row { transition: none; }
        }
      `}</style>

      {/* 顶栏：不再是一条居中细题注，改成侧边栏那一套「页头」——
          一行英文小字起头（白圆返回钮同排），下面压一条 26/800 的近黑大标题。
          侧边栏的顶部就是「一行小字＋大标题」，这里照它的结构来，
          点进来像是同一本册子翻开的一页。 */}
      <header
        style={{
          position: "relative",
          flex: "none",
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 16px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="cs-soft"
            style={headerBtnStyle}
          >
            <ChevronLeft size={19} strokeWidth={2.2} />
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
            chat settings
          </span>
        </div>
        <h1
          style={{
            margin: "14px 0 0",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-.01em",
            lineHeight: 1,
            color: T.ink,
          }}
        >
          聊天设置
        </h1>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background:
              "linear-gradient(90deg, rgba(20,19,24,.04) 0%, rgba(232,106,155,.34) 50%, rgba(20,19,24,.04) 100%)",
            pointerEvents: "none",
          }}
        />
      </header>

      {/* 内容 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "6px 16px calc(var(--safe-area-bottom, 0px) + 28px)",
        }}
      >
        {/* 首屏＝一张预览，不再是列表里的一条。
            当前壁纸铺满整块、角色头像浮在左上、底下压两条示意气泡，整块点一下就是换背景。
            定死的规矩：不要彩色预设，只留默认底色＋自传壁纸，
            没壁纸时铺 CHAT_BG_DEFAULT，有壁纸时右上角多一颗 ✕ 回默认。 */}
        <div
          onClick={() => {
            if (!uploading) pickFile(bgInputRef);
          }}
          className="cs-soft"
          style={{
            position: "relative",
            aspectRatio: "16 / 11",
            borderRadius: 22,
            overflow: "hidden",
            border: `1px solid ${T.lineSoft}`,
            boxShadow: "0 20px 36px -28px rgba(20,19,24,.8)",
            background: conv.chatBgUrl ? `url(${conv.chatBgUrl}) center/cover` : CHAT_BG_DEFAULT,
            cursor: "pointer",
          }}
        >
          {/* 头顶一层黑雾：白字压在浅色壁纸上也读得清 */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "12px 14px",
              background: "linear-gradient(180deg, rgba(20,19,24,.45), rgba(20,19,24,0))",
            }}
          >
            <div
              style={{
                ...avatarPreviewStyle,
                width: 34,
                height: 34,
                fontSize: 14,
                background: conv.charAvatar
                  ? `url(${conv.charAvatar}) center/cover`
                  : character.data.photo
                    ? `url(${character.data.photo}) center/cover`
                    : AVATAR_GRADIENT,
              }}
            >
              {!conv.charAvatar && !character.data.photo ? charName.charAt(0) : null}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: ".04em",
                color: "#FFF",
                textShadow: "0 1px 6px rgba(20,19,24,.45)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {charName}
            </span>
          </div>

          {/* 两条示意气泡：左边 TA 的白泡泡、右边我自己的粉泡泡，跟真聊天里长得一样 */}
          <div
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: 48,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                alignSelf: "flex-start",
                maxWidth: "78%",
                background: T.card,
                color: T.ink,
                padding: "8px 12px",
                borderRadius: "16px 16px 16px 5px",
                fontSize: 12.5,
                letterSpacing: ".03em",
                boxShadow: "0 8px 18px -12px rgba(20,19,24,.55)",
              }}
            >
              今天也一起加油呀
            </span>
            <span
              style={{
                alignSelf: "flex-end",
                maxWidth: "78%",
                background: T.pink,
                color: "#FFF",
                padding: "8px 12px",
                borderRadius: "16px 16px 5px 16px",
                fontSize: 12.5,
                letterSpacing: ".03em",
                boxShadow: "0 8px 18px -12px rgba(232,106,155,.85)",
              }}
            >
              好呀，等我下班
            </span>
          </div>

          {/* 底下一枚浮起来的白胶囊＝「这块能点」，顺带当提示语 */}
          <span
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              transform: "translateX(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 13px",
              borderRadius: 999,
              background: "rgba(255,255,255,.9)",
              color: T.ink,
              fontSize: 11,
              letterSpacing: ".06em",
              whiteSpace: "nowrap",
              boxShadow: "0 8px 18px -12px rgba(20,19,24,.7)",
            }}
          >
            <ImagePlus size={13} strokeWidth={2} />
            {uploading ? "处理中…" : conv.chatBgUrl ? "点这里换背景" : "点这里传一张壁纸"}
          </span>

          {/* 右上角 ✕：撤掉壁纸、回默认底色（只在有壁纸时出现，且别把点击传给整块） */}
          {conv.chatBgUrl ? (
            <button
              type="button"
              aria-label="恢复默认底色"
              onClick={(e) => {
                e.stopPropagation();
                void onUpdate({ chatBgUrl: "" });
              }}
              className="cs-soft"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 28,
                height: 28,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "rgba(255,255,255,.9)",
                color: T.ink,
                cursor: "pointer",
                boxShadow: "0 6px 14px -8px rgba(20,19,24,.7)",
              }}
            >
              <X size={14} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 10, color: T.ink3, letterSpacing: ".04em", lineHeight: 1.6 }}>
          {conv.chatBgUrl ? "壁纸只影响这个聊天；按右上角 ✕ 回到默认底色。" : "未上传壁纸时使用默认底色。"}
        </p>

        {/* 字体大小 */}
        <GroupTitle title="字体大小" en="font size" />
        <div style={sectionStyle}>
          <SettingRow
            title="字体大小"
            desc="当前聊天单独调整字体大小"
            showArrow={false}
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  aria-label="减小字号"
                  onClick={() => void onUpdate({ fontSize: Math.max(10, fontSize - 1) })}
                  className="cs-soft"
                  style={stepBtnStyle}
                >
                  <Minus size={16} strokeWidth={2} />
                </button>
                <span
                  style={{
                    fontFamily: EN,
                    fontSize: 20,
                    color: T.ink,
                    minWidth: 52,
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fontSize}
                  <small style={{ fontSize: 11, color: T.ink2, letterSpacing: ".08em" }}> pt</small>
                </span>
                <button
                  type="button"
                  aria-label="增大字号"
                  onClick={() => void onUpdate({ fontSize: Math.min(24, fontSize + 1) })}
                  className="cs-soft"
                  style={stepBtnStyle}
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
              </div>
            }
          />
        </div>

        {/* 消息设置 */}
        <GroupTitle title="消息设置" en="notifications" />
        <div style={sectionStyle}>
          <SettingRow
            title="置顶聊天"
            desc="将该聊天置顶在列表最上方"
            showArrow={false}
            right={
              <Switch
                on={conv.isPinned === true}
                onClick={() => void onUpdate({ isPinned: !conv.isPinned })}
              />
            }
          />
          <SettingRow
            title="消息免打扰"
            desc="当前聊天的免打扰开关"
            showArrow={false}
            right={
              <Switch
                on={conv.isMuted === true}
                onClick={() => void onUpdate({ isMuted: !conv.isMuted })}
              />
            }
          />
          <SettingRow
            title="连续发送"
            desc="开启后发消息不再自动回复，可以一条接一条地发；攒够了再按爱心让 TA 一次回完"
            showArrow={false}
            right={
              <Switch
                on={conv.manualReply === true}
                onClick={() => void onUpdate({ manualReply: !conv.manualReply })}
              />
            }
          />
          <SettingRow
            title="气泡条数"
            desc={bubbleOn ? `已开启 · 每轮最多 ${bubbleMax} 条` : "不限条数，TA 想分几条就分几条"}
            showArrow={false}
            right={
              <Switch on={bubbleOn} onClick={() => void onUpdate({ bubbleLimit: !bubbleOn })} />
            }
          />
          {bubbleOn ? (
            <SettingRow
              title="每轮最多"
              desc="TA 知道这个上限，会自己把话收在条数里；真写超了，多出来的也会并进最后一条"
              showArrow={false}
              right={<StepCount value={bubbleMax} onStep={stepBubbleMax} />}
            />
          ) : null}
        </div>

        {/* 外语聊天（1.9.48）：他说外语、我说中文，气泡下方各挂一行中文。
            口径见 types 的 TranslateSetting——**只有说出口的话换语言**（气泡正文＋语音），
            心声／思考／签名／动态／记忆一律中文，所以这里逐条写明「管到哪儿」。 */}
        <GroupTitle title="翻译" en="translate" />
        <div style={sectionStyle}>
          <SettingRow
            title="他说外语，我用中文看"
            desc="气泡正文与语音用外语，下面挂一行中文"
            showArrow={false}
            right={
              <Switch
                on={tr.out.on}
                onClick={() => void onUpdate({ translate: { ...tr, out: { ...tr.out, on: !tr.out.on } } })}
              />
            }
          />
          {tr.out.on ? (
            <>
              <SettingRow
                title="他说的语言"
                showArrow={false}
                right={
                  <LangPick
                    value={tr.out.lang}
                    onChange={(v) => void onUpdate({ translate: { ...tr, out: { ...tr.out, lang: v } } })}
                  />
                }
              />
              <SettingRow
                title="显示中文那一行"
                showArrow={false}
                right={
                  <Switch
                    on={tr.out.show}
                    onClick={() =>
                      void onUpdate({ translate: { ...tr, out: { ...tr.out, show: !tr.out.show } } })
                    }
                  />
                }
              />
              {/* 1.9.80 心声页双语：开着时他一轮回复最前面那段 <think> 里也一次写
                  「原文|中文」两半，心声页一进去就是中文（不用再点）；关着就还是
                  点一下才翻。只在外语这个开关开着时才有意义，所以收在里面。 */}
              <SettingRow
                title="心声页也直接显示中文"
                desc="打开后心声、环境、心情那几栏也一次写两种语言，进页即中文"
                showArrow={false}
                right={
                  <Switch
                    on={tr.inner}
                    onClick={() => void onUpdate({ translate: { ...tr, inner: !tr.inner } })}
                  />
                }
              />
            </>
          ) : null}

          <SettingRow
            title="我说中文，发出去翻成他的语言"
            desc="输入框里照打中文，气泡下面挂我那句中文本意"
            showArrow={false}
            right={
              <Switch
                on={tr.in.on}
                onClick={() => void onUpdate({ translate: { ...tr, in: { ...tr.in, on: !tr.in.on } } })}
              />
            }
          />
          {tr.in.on ? (
            <>
              <SettingRow
                title="翻成"
                showArrow={false}
                right={
                  <LangPick
                    value={tr.in.lang}
                    onChange={(v) => void onUpdate({ translate: { ...tr, in: { ...tr.in, lang: v } } })}
                  />
                }
              />
              <SettingRow
                title="显示中文那一行"
                showArrow={false}
                right={
                  <Switch
                    on={tr.in.show}
                    onClick={() =>
                      void onUpdate({ translate: { ...tr, in: { ...tr.in, show: !tr.in.show } } })
                    }
                  />
                }
              />
            </>
          ) : null}

          {tr.out.on || tr.in.on ? (
            <>
              <SettingRow
                title="漏翻时用哪套接口补"
                desc="正文由模型一次写成两种语言；他万一句漏了中文，才用它补翻"
                showArrow={false}
                right={
                  <div style={{ display: "flex", gap: 6 }}>
                    {([
                      ["sub", "副接口"],
                      ["main", "主接口"],
                    ] as const).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => void onUpdate({ translate: { ...tr, api: v } })}
                        style={{
                          border: `1.5px solid ${T.ink}`,
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontSize: 11.5,
                          fontFamily: SANS,
                          background: tr.api === v ? T.pink : "#FFFFFF",
                          color: tr.api === v ? "#FFFFFF" : T.ink,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              />
              {/* 挑的副接口没配齐时我们**会自动退回主接口**——不写明的话，账单上就对不上
                  （恩熙：「我用副 API 去查看，没看见翻译的扣费」）。这句直接说此刻实际走哪套。 */}
              <div
                style={{
                  padding: "0 10px 2px",
                  fontSize: 9.8,
                  lineHeight: 1.6,
                  color: tr.api === "sub" && !subReady ? T.pink : T.ink3,
                }}
              >
                {tr.api === "sub"
                  ? subReady
                    ? "实际走：副接口。"
                    : "副接口还没配齐（要「启用」＋地址＋模型），现在实际走的是主接口。"
                  : "实际走：主接口。"}
                {" "}它平时不干活——只有他哪句漏写中文时才叫它补一句，用量极小、账单上可能只是一两分钱。
              </div>
              {/* 她自己问过「会不会把心声、签名也翻掉」——把口径直接印在这儿，一眼看得到。 */}
              <div style={{ padding: "0 10px 12px", fontSize: 9.8, lineHeight: 1.6, color: T.ink3 }}>
                开着时，他一轮回复就<b>一次写成两种语言</b>：上面是外语原文、下面挂一行中文，
                不用再发第二次翻译请求，所以不会出现「有些突然不翻」。他写下的字——签名、
                心声、日记、环境／心情／欲望那些——原本要<b>点一下</b>才显中文（翻过一次就记住）；
                把上面那个「心声页也直接显示中文」打开，心声那几栏也会一进页就是中文。
                至于思考过程和朋友圈，这一版仍保持中文。
              </div>
            </>
          ) : null}
        </div>

        {/* 头像：并排两枚方砖。两个头像地位对等，
            给它们一样大的两块地，一眼就能对比。 */}
        <GroupTitle title="头像" en="avatar" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <AvatarTile
            label={`${charName}的头像`}
            bg={
              conv.charAvatar
                ? `url(${conv.charAvatar}) center/cover`
                : character.data.photo
                  ? `url(${character.data.photo}) center/cover`
                  : AVATAR_GRADIENT
            }
            initial={!conv.charAvatar && !character.data.photo ? charName.charAt(0) : null}
            hasCustom={Boolean(conv.charAvatar)}
            busy={uploading}
            onPick={() => pickFile(charAvatarInputRef)}
            onClear={() => void onUpdate({ charAvatar: "" })}
          />
          <AvatarTile
            label="我的头像"
            bg={
              conv.myAvatar
                ? `url(${conv.myAvatar}) center/cover`
                : maskAvatar
                  ? `url(${maskAvatar}) center/cover`
                  : "linear-gradient(135deg,#E86A9B,#8FBCEC)"
                // 上面那条兜底是粉→蓝：本板的色，蓝端用马卡龙蓝 #8FBCEC（别用正蓝）；
                // 中间那跳是跟随面具头像：
                // 本聊天单独设过就用单独设的，没设过就跟「我的」里正在用的那张。
            }
            initial={!conv.myAvatar && !maskAvatar ? myName.charAt(0) : null}
            hasCustom={Boolean(conv.myAvatar)}
            busy={uploading}
            onPick={() => pickFile(myAvatarInputRef)}
            onClear={() => void onUpdate({ myAvatar: "" })}
          />
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 10, color: T.ink3, letterSpacing: ".04em", lineHeight: 1.6 }}>
          仅当前聊天生效，不会改动档案本体的照片。
        </p>

        {/* 危险区域：整段沉在一片淡红雾里。这是整页唯一一块带底色的段落，
            一眼就知道「这里的东西会删」。 */}
        <GroupTitle title="危险区域" en="danger zone" />
        <div style={{ ...sectionStyle, background: "rgba(229,72,77,.055)", borderRadius: 20, padding: "2px 0" }}>
          <SettingRow
            title="清空聊天记录"
            desc="将清空当前聊天的全部记录与 TA 的记忆"
            danger
            onClick={() => setShowClearConfirm(true)}
          />
          <SettingRow
            title={blocked ? "解除拉黑" : "加入黑名单"}
            desc={
              blocked
                ? "解除后 TA 的消息就能正常发出去了"
                : "TA 还在列表里；你发的消息 TA 都看得到，TA 发的消息 TA 那边一直显示失败，你照样看得见"
            }
            showArrow={false}
            right={<Switch on={blocked} onClick={() => onToggleBlocked(!blocked)} />}
          />
          <SettingRow
            title="删除好友"
            desc="彻底删除会连记录与记忆一起清掉；暂时删除留着记录，TA 可能会请求加回"
            danger
            onClick={() => setShowDelConfirm(true)}
          />
        </div>
      </div>

      {/* 清空确认弹窗 */}
      {showClearConfirm ? (
        <>
          <div
            style={{ position: "absolute", inset: 0, zIndex: 63, background: "rgba(20,19,24,.42)" }}
            onClick={() => setShowClearConfirm(false)}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 30,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 300,
                background: T.card,
                borderRadius: 20,
                border: `1px solid ${T.lineSoft}`,
                padding: "22px 20px 18px",
                boxShadow: "0 26px 60px -28px rgba(20,19,24,.55)",
                pointerEvents: "auto",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  margin: "0 auto 12px",
                  borderRadius: "50%",
                  background: "rgba(229,72,77,.10)",
                  color: T.danger,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Trash2 size={20} strokeWidth={1.6} />
              </div>
              <h3 style={{ margin: 0, fontSize: 15.5, letterSpacing: ".1em", fontWeight: 600 }}>
                清空聊天记录
              </h3>
              <p
                style={{
                  fontSize: 11,
                  color: T.ink2,
                  lineHeight: 1.7,
                  marginTop: 9,
                  letterSpacing: ".03em",
                  margin: "9px 0 0",
                }}
              >
                将清空当前聊天的全部聊天记录与 TA 的记忆（含每层摘要与计数），不会影响 TA
                的档案设定。确认清空吗？
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  className="cs-fill"
                  style={cancelBtnStyle}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="cs-fill"
                  style={confirmDangerBtnStyle}
                  onClick={() => {
                    setShowClearConfirm(false);
                    void onClearMessages();
                  }}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* 删除好友确认弹窗（两档：彻底删除＝真删；暂时删除＝假删，记录保留，TA 可能请求加回） */}
      {showDelConfirm ? (
        <>
          <div
            style={{ position: "absolute", inset: 0, zIndex: 63, background: "rgba(20,19,24,.42)" }}
            onClick={() => setShowDelConfirm(false)}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 30,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 300,
                background: T.card,
                borderRadius: 20,
                border: `1px solid ${T.lineSoft}`,
                padding: "22px 20px 18px",
                boxShadow: "0 26px 60px -28px rgba(20,19,24,.55)",
                pointerEvents: "auto",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  margin: "0 auto 12px",
                  borderRadius: "50%",
                  background: "rgba(229,72,77,.10)",
                  color: T.danger,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Trash2 size={20} strokeWidth={1.6} />
              </div>
              <h3 style={{ margin: 0, fontSize: 15.5, letterSpacing: ".1em", fontWeight: 600 }}>
                删除好友
              </h3>
              <p
                style={{
                  fontSize: 11,
                  color: T.ink2,
                  lineHeight: 1.8,
                  letterSpacing: ".03em",
                  margin: "9px 0 0",
                }}
              >
                彻底删除：聊天记录与记忆一并清掉，「{charName}」不会再出现在好友列表，
                也不会来请求加回。
                <br />
                暂时删除：记录留着，「{charName}」可能会来求加回。
              </p>
              {/* 跟联系人资料页同一层两档——彻底删除（真删，默认）与
                  暂时删除（假删，留着给剧情用：TA 会来求加回）。 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
                <button
                  type="button"
                  className="cs-fill"
                  style={{ ...confirmDangerBtnStyle, flex: "none" }}
                  onClick={() => {
                    setShowDelConfirm(false);
                    onHardDeleteFriend();
                  }}
                >
                  彻底删除
                </button>
                <button
                  type="button"
                  className="cs-fill"
                  style={softDangerBtnStyle}
                  onClick={() => {
                    setShowDelConfirm(false);
                    onDeleteFriend();
                  }}
                >
                  暂时删除
                </button>
                <button
                  type="button"
                  onClick={() => setShowDelConfirm(false)}
                  className="cs-fill"
                  style={{ ...cancelBtnStyle, flex: "none" }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------- 样式 ----------------------------- */

/** 页头那颗返回钮：近黑圆＋白图标——侧边栏整条就是这块黑，这是两屏对上眼的
 *  那一处（颜色呼应侧边栏，不是把整页翻黑：整页翻黑会再跟聊天窗口断一次）。 */
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

/** 次要动作（上传／更换）：淡粉底＋粉字的小胶囊。 */
const uploadBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: T.pink,
  letterSpacing: ".05em",
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid rgba(232,106,155,.28)",
  background: "rgba(232,106,155,.08)",
  cursor: "pointer",
};

/** ✕（撤掉自定义图片）：一颗灰描边的小圆。 */
const clearBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 999,
  color: T.ink3,
  border: `1px solid ${T.line}`,
  background: "transparent",
  cursor: "pointer",
  flex: "none",
};

/** 步进器的 −／＋：粉描边小圆。 */
const stepBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: "1px solid rgba(232,106,155,.22)",
  background: "rgba(232,106,155,.08)",
  color: T.pink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const avatarPreviewStyle: CSSProperties = {
  flex: "none",
  width: 44,
  height: 44,
  borderRadius: "50%",
  color: "#FFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 16,
  fontWeight: 600,
  overflow: "hidden",
  boxShadow: "inset 0 0 0 1px rgba(20,19,24,.06)",
};

const cancelBtnStyle: CSSProperties = {
  flex: 1,
  height: 44,
  borderRadius: 14,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: ".1em",
  background: "rgba(20,19,24,.05)",
  color: T.ink,
  border: "none",
  cursor: "pointer",
};

const confirmDangerBtnStyle: CSSProperties = {
  flex: 1,
  height: 44,
  borderRadius: 14,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: ".1em",
  background: T.danger,
  color: "#fff",
  border: "none",
  cursor: "pointer",
};

/** 淡红底那档（「暂时删除」）：跟彻底删除拉开轻重，别让人误点。 */
const softDangerBtnStyle: CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 14,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: ".1em",
  background: "rgba(229,72,77,.07)",
  color: T.danger,
  border: "1px solid rgba(229,72,77,.22)",
  cursor: "pointer",
};

/* --------------------- 本地零件（新板） ---------------------
   下面三件跟 `widgets.tsx` 里同名的那份是两套（那份是米白底、宋体、玫瑰棕、
   细边卡片）。那份还带着「角色设置」「通讯人」两个页面在用，不能就地改，
   所以本地重写了一份：一律 T 语言（亮粉、无衬线、大圆角）。 */

/** 头像方砖：一枚头像圆＋名字＋「更换」（有自定义图时再多一枚 ✕），两枚并排。
 *  两枚砖一样大，一眼能对比。 */
function AvatarTile({
  label,
  bg,
  initial,
  hasCustom,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  /** 头像圆的 background：图片 `url(...)` 或兜底渐变。 */
  bg: string;
  /** 没有图时圆里显示的那个字（有图就是 null）。 */
  initial: string | null;
  /** 有自定义图才显示 ✕。 */
  hasCustom: boolean;
  /** 上传中（置灰，防连点）。 */
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        background: T.card,
        borderRadius: 20,
        border: `1px solid ${T.lineSoft}`,
        boxShadow: "0 16px 30px -26px rgba(20,19,24,.85)",
        padding: "16px 12px 14px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ ...avatarPreviewStyle, width: 56, height: 56, fontSize: 20, background: bg }}>
        {initial}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".04em",
          color: T.ink,
          textAlign: "center",
          maxWidth: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={onPick} disabled={busy} className="cs-soft" style={uploadBtnStyle}>
          <ImagePlus size={12} strokeWidth={1.6} />
          更换
        </button>
        {hasCustom ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`清除${label}`}
            className="cs-soft"
            style={clearBtnStyle}
          >
            <X size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 胶囊开关：开＝亮粉底，关＝近黑极淡底。 */
function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        width: 46,
        height: 27,
        borderRadius: 999,
        background: on ? T.pink : "rgba(20,19,24,.12)",
        position: "relative",
        transition: "background .2s",
        flex: "none",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: on ? 21 : 2,
          width: 23,
          height: 23,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 2px 5px rgba(20,19,24,.22)",
          transition: "left .2s",
        }}
      />
    </div>
  );
}

/** 语言选择（外语聊天那两行）：就用原生下拉，省得再画一套弹层。
 *  贴纸风对齐面板其它小件：黑描边＋纸白底＋圆角。 */
function LangPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        border: `1.5px solid ${T.ink}`,
        borderRadius: 10,
        background: "#FFFFFF",
        color: T.ink,
        fontFamily: SANS,
        fontSize: 12.5,
        padding: "4px 10px",
        cursor: "pointer",
      }}
    >
      {TRANSLATE_LANGS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/** 分组名：英文小字起头、中文名字压在下面（跟侧边栏顶部「一行小字＋大标题」同一个
 *  结构，只是缩了一号）。中文提到 19/800——白卡撤掉之后，分组全靠它撑，
 *  太小整页就散架了；段与段之间也只靠这里的上留白分开。 */
function GroupTitle({ title, en }: { title: string; en: string }) {
  return (
    <div style={{ margin: "28px 0 8px" }}>
      <em
        style={{
          display: "block",
          fontFamily: EN,
          fontStyle: "normal",
          fontSize: 8.5,
          letterSpacing: ".26em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </em>
      <b
        style={{
          display: "block",
          marginTop: 6,
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: "-.01em",
          lineHeight: 1.1,
          color: T.ink,
        }}
      >
        {title}
      </b>
    </div>
  );
}

/** 设置行（标题＋描述＋值／箭头／右侧自定义）。 */
function SettingRow({
  title,
  desc,
  value,
  right,
  onClick,
  showArrow,
  danger,
}: {
  title: string;
  desc?: string;
  value?: string;
  /** 右侧自定义内容（提供时覆盖 value／箭头）。 */
  right?: ReactNode;
  onClick?: () => void;
  showArrow?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={onClick ? "cs-row" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 10px",
        borderRadius: 16,
        marginBottom: 2,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            letterSpacing: ".04em",
            fontWeight: 500,
            color: danger ? T.danger : T.ink,
          }}
        >
          {title}
        </div>
        {desc ? (
          <div
            style={{
              fontSize: 9.8,
              color: T.ink3,
              marginTop: 3,
              letterSpacing: ".04em",
              lineHeight: 1.45,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {desc}
          </div>
        ) : null}
      </div>
      {right ?? (
        <>
          {value ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                color: T.ink2,
                letterSpacing: ".04em",
                flex: "none",
                whiteSpace: "nowrap",
              }}
            >
              {value}
            </div>
          ) : null}
          {(showArrow ?? true) && onClick ? (
            <ChevronRight size={15} strokeWidth={2} color={danger ? T.danger : T.ink3} />
          ) : null}
        </>
      )}
    </div>
  );
}
