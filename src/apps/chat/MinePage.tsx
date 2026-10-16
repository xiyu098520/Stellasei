"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Camera, ChevronLeft, ChevronRight, Copy, Pencil, Plus } from "lucide-react";
import {
  DEFAULT_MASK_ID,
  MASK_UID_RE,
  genMaskUid,
  saveMasks,
  type Mask,
} from "@/lib/settings/mask";
import { copyText } from "@/lib/clipboard";
import { uuid } from "@/lib/uuid";
import { APP_VERSION } from "@/lib/version";
import { EN, HZ, LAT, SANS, SERIF } from "./shared";

/* =======================================================================
 * 「我的」页（底部 tab 进入，微信「我」的骨架）
 * 顶部资料块（当前面具：头像＋名字＋签名，整块点进编辑）→ 面具册入口卡（进子页）
 * → 分组卡片行（收藏／钱包／聊天全局设定 · 在线状态／拍一拍 · 检查更新／帮助 · 退出）。
 * 原侧边栏（已撤）的入口全部收进这页；导航大梁换成了底部 tab。
 *
 * 面具不再摊在主页：**面具册是一张卡**，点进去才见名片（当前面具）＋列表＋新增。
 * 编辑（新增／既有）＝再下一层：主页 ⇄ 面具册 ⇄ 编辑。
 * 名字由使用中的面具决定；全空时 TA 眼中只有「我」。
 *
 * 皮走「雾蓝白灰」（照消息列表页那份），整页**再没有粉色**：
 * 页头是「居中宋体中文压斜体英文」（子页在左侧多一枚透明返回钮）；
 * 正文是「一册纸上的名册」——直角、发丝线、留白，中文大字压英文小字，不铺卡片不铺气泡。
 * 零件（MaskAvatar／MenuItem／SectLabel／GroupLabel）在文件末尾本地改，**不动 `widgets.tsx`**。
 *
 * 签名并进面具：签名是面具自己的一个栏位——
 * 主页刊头那行就是它（点一下就地改），面具编辑页在「名字」下面也有「签名」输入框。
 * ===================================================================== */

/** 「我的」页自己的皮：雾蓝白灰（照消息列表页那份 HZ）。
 *  **就地覆盖，不引全局那套粉**——恩熙定的：这一页不要再出现粉色。
 *  这里仍叫 `T`，是为了让下面所有零件与样式定义原样落到「这一页的皮」上，改动面最小。
 *  全局 `AVATAR_GRADIENT` 一点没动，只在 `MaskAvatar` 里另给一个雾蓝兜底。 */
const T = {
  bg: HZ.paper,
  card: "#FFFFFF",
  ink: HZ.ink,
  ink2: HZ.ink2,
  ink3: HZ.ink3,
  pink: HZ.accent,
  pinkSoft: HZ.accentSoft,
  blue: HZ.accent,
  blueDeep: HZ.accent,
  blueSoft: HZ.accentSoft,
  danger: "#C0563F",
  line: HZ.line,
  lineSoft: HZ.line2,
} as const;

/** 签名兜底文案（资料块／名片卡／动态页都用它）。 */
export const SIGNATURE_FALLBACK = "所有心事都寄存在黄昏里";

/** 生日下拉的年份范围：1930 ～ 今年。 */
const YEAR_OPTIONS = Array.from(
  { length: new Date().getFullYear() - 1930 + 1 },
  (_, i) => String(1930 + i),
);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));

export default function MinePage({
  signature,
  masks,
  onSignatureChange,
  onMasksChange,
  onOpenWallet,
  onOpenChatGlobal,
  onExit,
  showToast,
}: {
  signature: string;
  masks: Mask[];
  onSignatureChange: (next: string) => void;
  onMasksChange: (next: Mask[]) => void;
  /* 我的钱包（原侧边栏入口，现从这页进）。 */
  onOpenWallet: () => void;
  /* 聊天全局设定（同上）。 */
  onOpenChatGlobal: () => void;
  /* 退出星绥通讯（原侧边栏「退出」）。 */
  onExit: () => void;
  showToast: (msg: string) => void;
}) {
  /* ---------- 页内层级 ---------- */
  /** null＝主页；"new"＝新增；Mask＝编辑既有。 */
  const [maskEdit, setMaskEdit] = useState<Mask | "new" | null>(null);
  /** 面具册子页（主页 ⇄ 面具册 ⇄ 编辑）。 */
  const [maskRoster, setMaskRoster] = useState(false);
  const [mUid, setMUid] = useState("");
  const [mName, setMName] = useState("");
  const [mSignature, setMSignature] = useState("");
  const [mPersona, setMPersona] = useState("");
  const [mGender, setMGender] = useState("");
  const [mYear, setMYear] = useState("");
  const [mMonth, setMMonth] = useState("");
  const [mDay, setMDay] = useState("");
  const [mExtra, setMExtra] = useState("");
  const [mAvatar, setMAvatar] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* ---------- 签名编辑 ---------- */
  const [sigOpen, setSigOpen] = useState(false);
  const [sigDraft, setSigDraft] = useState(signature);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 当前使用的面具（默认面具保证存在，一般不为 null）。 */
  const current = masks.find((m) => m.current) ?? null;

  /** 打开面具编辑（新增或既有），初始化表单。 */
  const openMaskEdit = (target: Mask | "new") => {
    if (target === "new") {
      setMUid(genMaskUid());
      setMName("");
      setMSignature("");
      setMPersona("");
      setMGender("");
      setMYear("");
      setMMonth("");
      setMDay("");
      setMExtra("");
      setMAvatar("");
    } else {
      setMUid(target.uid);
      setMName(target.name);
      setMSignature(target.signature);
      setMPersona(target.persona);
      setMGender(target.gender);
      /* 生日回显：库里存的是带前导零的 2000-05-09，下拉框的选项值是不带零的 5——
         直接 split 回填会匹配不到选项，月／日看起来就「没保存住」，先转成纯数字。 */
      const [y, mo, d] = target.birth ? target.birth.split("-") : ["", "", ""];
      setMYear(y);
      setMMonth(mo ? String(parseInt(mo, 10)) : "");
      setMDay(d ? String(parseInt(d, 10)) : "");
      setMExtra(target.extra);
      setMAvatar(target.avatar);
    }
    setConfirmDelete(false);
    setMaskEdit(target);
  };

  /** 年／月变更后把日夹在该月天数内（2 月等）。 */
  const clampDay = (y: string, mo: string, d: string) => {
    const yy = parseInt(y, 10);
    const mm = parseInt(mo, 10);
    const dd = parseInt(d, 10);
    if (!yy || !mm || !dd) return d;
    const max = new Date(yy, mm, 0).getDate();
    return dd > max ? String(max) : d;
  };

  const yNum = parseInt(mYear, 10);
  const mNum = parseInt(mMonth, 10);
  const daysInMonth = yNum && mNum ? new Date(yNum, mNum, 0).getDate() : 31;

  /** 选头像：读文件 → 压到 256px dataURL（控制 IndexedDB 体积）。 */
  const pickAvatar = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 256;
        const scale = Math.min(SIZE / img.width, SIZE / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setMAvatar(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  /** 保存面具（新增／修改）；新增的第一个面具自动换上。 */
  const saveMask = async () => {
    if (!mName.trim()) {
      showToast("请输入名字");
      return;
    }
    const uid = mUid.trim();
    if (!MASK_UID_RE.test(uid)) {
      showToast("ID 需为 4-20 位字母、数字或横线");
      return;
    }
    const editId = maskEdit === "new" || !maskEdit ? "" : maskEdit.id;
    if (masks.some((m) => m.uid === uid && m.id !== editId)) {
      showToast("这个 ID 已被其他面具使用");
      return;
    }
    const birth =
      mYear && mMonth && mDay
        ? `${mYear}-${mMonth.padStart(2, "0")}-${mDay.padStart(2, "0")}`
        : "";
    let next: Mask[];
    if (maskEdit === "new") {
      const mask: Mask = {
        id: uuid(),
        uid,
        name: mName.trim(),
        signature: mSignature.trim(),
        persona: mPersona.trim(),
        gender: mGender,
        birth,
        extra: mExtra.trim(),
        avatar: mAvatar,
        createdAt: new Date().toISOString(),
        // 尚无使用中的面具时，新增的第一个自动换上。
        current: !masks.some((m) => m.current),
      };
      next = [...masks, mask];
    } else if (maskEdit) {
      next = masks.map((m) =>
        m.id === maskEdit.id
          ? {
              ...m,
              uid,
              name: mName.trim(),
              signature: mSignature.trim(),
              persona: mPersona.trim(),
              gender: mGender,
              birth,
              extra: mExtra.trim(),
              avatar: mAvatar,
            }
          : m,
      );
    } else {
      return;
    }
    await saveMasks(next);
    onMasksChange(next);
    setMaskEdit(null);
    showToast("已保存");
  };

  /** 换上某个面具（同一时间只有一个使用中）。 */
  const activateMask = async (id: string) => {
    const next = masks.map((m) => ({ ...m, current: m.id === id }));
    await saveMasks(next);
    onMasksChange(next);
    showToast("已换上此面具");
  };

  /** 删除面具（经确认弹窗）；删除使用中的面具时默认面具自动换上。 */
  const deleteMask = async () => {
    if (maskEdit === "new" || !maskEdit) return;
    let next = masks.filter((m) => m.id !== maskEdit.id);
    if (maskEdit.current) {
      next = next.map((m) => (m.id === DEFAULT_MASK_ID ? { ...m, current: true } : m));
    }
    await saveMasks(next);
    onMasksChange(next);
    setMaskEdit(null);
    setConfirmDelete(false);
    showToast("已删除");
  };

  /** 保存签名（写进「使用中」那张面具；父层负责落库）。 */
  const saveSignature = () => {
    onSignatureChange(sigDraft.trim());
    setSigOpen(false);
    showToast("已保存");
  };

  /* ---------- 展示辅助 ---------- */

  /** 生日显示：2000-01-01 → 2000/01/01。 */
  const birthText = (birth: string) => {
    const [y, mo, d] = birth.split("-");
    if (!y || !mo || !d) return "";
    return `${y}/${mo}/${d}`;
  };

  /** 人设摘要（当前面具卡用）。 */
  const personaSummary = (m: Mask) => {
    const p = m.persona.trim();
    if (!p) return "尚未填写人设";
    return p.length > 40 ? `${p.slice(0, 40)}…` : p;
  };

  /** 面具编号＝它在面具册里的位次，两位补零。消息列表那条面具标签上挂的就是同一个号，
   *  两边对得上。 */
  const maskNoOf = (id: string) =>
    String(masks.findIndex((x) => x.id === id) + 1).padStart(2, "0");

  /* ---------- 顶部标题 ---------- */
  const header =
    maskEdit === "new"
      ? { cn: "新增面具", en: "new mask" }
      : maskEdit
        ? { cn: "编辑面具", en: "edit mask" }
        : maskRoster
          ? { cn: "面具册", en: "mask book" }
          : { cn: "我的", en: "me" };

  /** 只在子页（面具册／编辑）露返回钮；主页是 tab 根视图，不设返回。 */
  const showBackBtn = maskEdit !== null || maskRoster;

  const handleBack = () => {
    if (maskEdit) setMaskEdit(null);
    else if (maskRoster) setMaskRoster(false);
  };

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        fontFamily: SANS,
        color: T.ink,
        overflow: "hidden",
      }}
    >
      {/* 交互：按下整行往里收一档（同通讯人页、消息列表）；
          一册纸上的名册——行与行之间只压一条从「字头」划开的发丝线，不铺卡片不铺气泡。 */}
      <style>{`
        .mp-row { position: relative; transition: transform .16s ease, background-color .16s ease; }
        /* 按住立刻染一层淡雾蓝（过渡压到 .06s），松手再慢慢化开 */
        .mp-row:active { transform: scale(.986); background-color: ${T.pinkSoft}; transition-duration: .06s; }
        /* 区内相邻两行：一条从「字头」划到右边的发丝线 */
        .mp-grp .mp-row + .mp-row::before,
        .mp-mlist .mp-mrow + .mp-mrow::before {
          content: ''; position: absolute; top: 0; right: 4px;
          height: 1px; background: ${T.lineSoft};
        }
        /* 设置行：字头＝左内边距 4 ＋图标 22 ＋图标右距 13 */
        .mp-grp .mp-row + .mp-row::before { left: 39px; }
        /* 面具行：字头＝左内边距 4 ＋头像 46 ＋间距 13 */
        .mp-mlist .mp-mrow + .mp-mrow::before { left: 62px; }
        .mp-hbtn { transition: transform .15s ease, opacity .15s ease; }
        .mp-hbtn:active { transform: scale(.9); opacity: .7; }
        .mp-soft { transition: transform .16s ease, filter .16s ease; }
        .mp-soft:active { transform: scale(.96); filter: brightness(.97); }
        .mp-field::placeholder { color: ${T.ink3}; }
        @media (prefers-reduced-motion: reduce) {
          .mp-hbtn, .mp-row, .mp-soft { transition: none; }
        }
      `}</style>

      {/* 页头：居中宋体中文压斜体英文（同消息页／通讯人页一套）。
          子页在左边多一枚透明返回钮，一层一层退（编辑 → 面具册 → 主页），
          主页是 tab 根视图，不设返回。 */}
      <header
        style={{
          position: "relative",
          flex: "none",
          zIndex: 20,
          overflow: "hidden",
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 12px) 26px 12px",
        }}
      >
        {/* 头顶一团雾蓝晕：页头算是有「底」了，但不落成色块 */}
        <i
          aria-hidden
          style={{
            position: "absolute",
            top: -98,
            left: "50%",
            transform: "translateX(-50%)",
            width: 340,
            height: 250,
            borderRadius: 999,
            background:
              "radial-gradient(circle at 50% 44%, rgba(90,115,145,.16) 0%, rgba(90,115,145,.05) 46%, rgba(90,115,145,0) 72%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 24 }}>
          {showBackBtn ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label="返回"
              className="mp-hbtn"
              style={headerBtnStyle}
            >
              <ChevronLeft size={22} strokeWidth={1.5} />
            </button>
          ) : null}
          <div style={{ textAlign: "center" }}>
            <span
              style={{
                display: "block",
                fontFamily: SERIF,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: ".2em",
                paddingLeft: ".2em",
                color: T.pink,
                lineHeight: 1,
              }}
            >
              {header.cn}
            </span>
            <span
              style={{
                display: "block",
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: 12.5,
                letterSpacing: ".12em",
                textIndent: ".12em",
                textTransform: "capitalize",
                color: T.ink3,
                paddingTop: 3,
              }}
            >
              {header.en}
            </span>
          </div>
        </div>
      </header>

      {/* 内容区 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "20px 22px calc(var(--safe-area-bottom, 0px) + 28px)",
        }}
      >
        {maskEdit !== null ? (
          /* ==================== 面具编辑 ==================== */
          <div style={{ padding: "2px 0" }}>
            {/* 头像 */}
            <div
              style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="更换头像"
                style={{ position: "relative", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
              >
                <MaskAvatar mask={{ avatar: mAvatar, name: mName } as Mask} size={76} />
                <span
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    width: 26,
                    height: 26,
                    background: T.pink,
                    /* 一圈白环把雾蓝方牌托起来 */
                    boxShadow: "0 0 0 3px #FFFFFF, 0 8px 16px -8px rgba(90,115,145,.85)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFFFFF",
                  }}
                >
                  <Camera size={13} strokeWidth={2} />
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickAvatar(f);
                  e.target.value = "";
                }}
              />
            </div>

            <label style={fieldLabelStyle}>名字</label>
            <input
              type="text"
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              placeholder="你的名字"
              maxLength={12}
              className="mp-field"
              style={inputStyle}
            />

            {/* 签名并进面具：一张面具一个签名，跟着它一起改，
                免得为了给某张面具换签名还得先把它换上。 */}
            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>签名</label>
            <input
              type="text"
              value={mSignature}
              onChange={(e) => setMSignature(e.target.value)}
              placeholder={SIGNATURE_FALLBACK}
              maxLength={30}
              className="mp-field"
              style={inputStyle}
            />

            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>ID</label>
            <input
              type="text"
              value={mUid}
              onChange={(e) => setMUid(e.target.value)}
              placeholder="4-20 位字母、数字或横线"
              maxLength={20}
              autoCapitalize="off"
              autoCorrect="off"
              className="mp-field"
              style={{ ...inputStyle, fontVariantNumeric: "tabular-nums", letterSpacing: ".06em" }}
            />
            <p style={{ ...fieldHintStyle, marginTop: 6 }}>
              像微信号一样的外部 ID；角色添加你时会看到。
            </p>

            {/* 人设／补充都不设字数上限（1.4.37 恩熙：「把我的人设文字开放一下，不要设上限」）：
                人设本来就没法用字数框死，写长了只是多占一点存储，不值得为它挡人。
                存储与提示词两侧都没有截断，放开这里就是全放开。 */}
            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>人设</label>
            <textarea
              value={mPersona}
              onChange={(e) => setMPersona(e.target.value)}
              placeholder="你的性格、身份、说话方式……"
              className="mp-field"
              style={textareaStyle}
            />

            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>性别</label>
            <div style={{ display: "flex", gap: 10 }}>
              {["女", "男", "其他"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setMGender((prev) => (prev === g ? "" : g))}
                  style={mGender === g ? genderPillActiveStyle : genderPillStyle}
                >
                  {g}
                </button>
              ))}
            </div>
            <p style={{ ...fieldHintStyle, marginTop: 6 }}>再点一次可取消；留空表示不填写。</p>

            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>生日</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={mYear}
                onChange={(e) => {
                  setMYear(e.target.value);
                  setMDay((d) => clampDay(e.target.value, mMonth, d));
                }}
                style={selectStyle}
              >
                <option value="">年</option>
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select
                value={mMonth}
                onChange={(e) => {
                  setMMonth(e.target.value);
                  setMDay((d) => clampDay(mYear, e.target.value, d));
                }}
                style={selectStyle}
              >
                <option value="">月</option>
                {MONTH_OPTIONS.map((mo) => (
                  <option key={mo} value={mo}>{mo}</option>
                ))}
              </select>
              <select
                value={mDay}
                onChange={(e) => setMDay(e.target.value)}
                style={selectStyle}
              >
                <option value="">日</option>
                {Array.from({ length: daysInMonth }, (_, i) => String(i + 1)).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>补充</label>
            <textarea
              value={mExtra}
              onChange={(e) => setMExtra(e.target.value)}
              placeholder="其他想让 TA 知道的事……"
              className="mp-field"
              style={{ ...textareaStyle, minHeight: 72 }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button type="button" onClick={() => setMaskEdit(null)} style={cancelBtnStyle}>
                取消
              </button>
              <button type="button" onClick={() => void saveMask()} style={saveBtnStyle}>
                保存
              </button>
            </div>

            {maskEdit !== "new" && maskEdit.id !== DEFAULT_MASK_ID ? (
              <button type="button" onClick={() => setConfirmDelete(true)} style={deleteBtnStyle}>
                删除此面具
              </button>
            ) : null}
          </div>
        ) : maskRoster ? (
          <>
            {/* ==================== 面具册子页：当前面具（平铺，不铺卡片） ==================== */}
            {current ? (
              <div
                onClick={() => openMaskEdit(current)}
                data-tap="true"
                className="mp-row"
                style={{
                  position: "relative",
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {/* 顶行：一根雾蓝竖条 ＋ Current ／ 当前面具 ＋ 细线 ＋ 右端「编辑 ›」 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 17px" }}>
                  <i style={{ flex: "none", width: 4, height: 14, background: T.pink, pointerEvents: "none" }} />
                  <span
                    style={{
                      fontFamily: EN,
                      fontSize: 9,
                      letterSpacing: ".18em",
                      color: T.ink3,
                      textTransform: "uppercase",
                      pointerEvents: "none",
                    }}
                  >
                    Current
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".18em", color: T.ink, pointerEvents: "none" }}>
                    当前面具
                  </span>
                  <i style={{ flex: 1, minWidth: 12, height: 1, background: T.lineSoft, pointerEvents: "none" }} />
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 1,
                      color: T.pink,
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: ".1em",
                      pointerEvents: "none",
                    }}
                  >
                    编辑
                    <ChevronRight size={13} strokeWidth={2.6} />
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 15, padding: "0 4px" }}>
                  <MaskAvatar mask={current} size={64} variant="deep" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        letterSpacing: ".01em",
                        lineHeight: 1.05,
                        color: T.ink,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        pointerEvents: "none",
                      }}
                    >
                      {current.name.trim() || "我"}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: T.ink2,
                        marginTop: 5,
                        letterSpacing: ".05em",
                        pointerEvents: "none",
                      }}
                    >
                      {current.id === DEFAULT_MASK_ID && !current.name.trim() && !current.persona.trim()
                        ? "默认面具 · 尚未填写任何信息"
                        : [current.gender, current.birth ? birthText(current.birth) : ""].filter(Boolean).join(" · ") ||
                          "还没填性别和生日"}
                    </div>
                    {/* ID 一行：极淡，点一下复制；自带 stopPropagation，不会连带整卡进编辑 */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyText(current.uid).then((ok) =>
                          showToast(ok ? "ID 已复制" : "复制失败，请手动记下"),
                        );
                      }}
                      className="mp-soft"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 7,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        color: T.ink3,
                        fontFamily: LAT,
                        fontSize: 10.5,
                        letterSpacing: ".08em",
                        fontVariantNumeric: "tabular-nums",
                        cursor: "pointer",
                      }}
                    >
                      ID · {current.uid || "未设置"}
                      <Copy size={10} strokeWidth={2.2} color={T.ink3} />
                    </button>
                  </div>
                </div>

                {/* meta：签名／人设两行，各压一条发丝线；只读，要改去编辑页 */}
                <div style={{ marginTop: 16, borderTop: `1px solid ${T.lineSoft}`, pointerEvents: "none" }}>
                  <div style={{ display: "flex", gap: 11, padding: "11px 4px", borderBottom: `1px solid ${T.lineSoft}` }}>
                    <span style={{ flex: "none", width: 30, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: T.pink }}>
                      签名
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.7, letterSpacing: ".03em", color: T.ink2 }}>
                      {signature.trim() || SIGNATURE_FALLBACK}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 11, padding: "11px 4px", borderBottom: `1px solid ${T.lineSoft}` }}>
                    <span style={{ flex: "none", width: 30, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: T.pink }}>
                      人设
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.7, letterSpacing: ".03em", color: T.ink2 }}>
                      {personaSummary(current)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ==================== 面具册：全部面具（当前行带「使用中」）＋新增 ==================== */}
            <div style={{ marginTop: 26 }}>
              <GroupLabel cn="面具" en="masks" count={masks.length} dot={T.pink} />
              <div className="mp-mlist">
                {masks.map((m) => {
                  const on = m.id === current?.id;
                  const sub = m.signature.trim() || SIGNATURE_FALLBACK;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => (on ? openMaskEdit(m) : void activateMask(m.id))}
                      className="mp-mrow"
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        gap: 13,
                        width: "100%",
                        padding: "13px 4px",
                        border: "none",
                        background: "none",
                        fontFamily: SANS,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <MaskAvatar mask={m} size={46} variant={on ? "deep" : "flat"} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                          <span
                            style={{
                              flex: "none",
                              fontFamily: EN,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: ".1em",
                              color: on ? T.pink : T.ink3,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {maskNoOf(m.id)}
                          </span>
                          <span
                            style={{
                              minWidth: 0,
                              fontSize: 15,
                              fontWeight: 700,
                              letterSpacing: ".04em",
                              color: T.ink,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {m.name.trim() || "我"}
                          </span>
                          {on ? (
                            <span
                              style={{
                                flex: "none",
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: ".1em",
                                padding: "2px 7px",
                                background: T.pinkSoft,
                                color: T.pink,
                              }}
                            >
                              使用中
                            </span>
                          ) : null}
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 5,
                            fontSize: 11,
                            letterSpacing: ".03em",
                            color: T.ink2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {sub}
                          <span style={{ color: T.ink3, margin: "0 6px" }}>·</span>
                          <span
                            style={{
                              fontFamily: LAT,
                              fontSize: 10,
                              letterSpacing: ".08em",
                              color: T.ink3,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {m.uid || "未设置"}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => openMaskEdit("new")}
                  className="mp-mrow mp-soft"
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    width: "100%",
                    padding: "13px 4px",
                    border: "none",
                    background: "none",
                    fontFamily: SANS,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      flex: "none",
                      width: 46,
                      height: 46,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px dashed rgba(90,115,145,.42)",
                      color: T.pink,
                    }}
                  >
                    <Plus size={20} strokeWidth={1.8} />
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: ".04em", color: T.pink }}>新增面具</span>
                </button>
              </div>
            </div>

          </>
        ) : (
          <>
            {/* ==================== 身份区：左对齐刊头（方牌即「面具册」入口） ==================== */}
            {current ? (
              <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 4px 0" }}>
                <button
                  type="button"
                  onClick={() => setMaskRoster(true)}
                  aria-label="进入面具册"
                  className="mp-hbtn"
                  style={{ flex: "none", padding: 0, border: "none", background: "none", cursor: "pointer" }}
                >
                  <MaskAvatar mask={current} size={80} variant="hero" />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: SERIF,
                      fontSize: 24,
                      fontWeight: 600,
                      letterSpacing: ".1em",
                      lineHeight: 1,
                      color: T.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {current.name.trim() || "我"}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: LAT,
                      fontSize: 10.5,
                      letterSpacing: ".06em",
                      color: T.ink3,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    @{current.uid || "未设置"}
                  </div>
                  {/* 引文行：点一下就改签名 */}
                  <button
                    type="button"
                    onClick={() => {
                      setSigDraft(signature);
                      setSigOpen(true);
                    }}
                    className="mp-soft"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 10,
                      padding: 0,
                      border: "none",
                      background: "none",
                      fontFamily: SANS,
                      fontSize: 12.5,
                      letterSpacing: ".04em",
                      color: T.ink2,
                      textAlign: "left",
                      cursor: "pointer",
                      maxWidth: "100%",
                      minWidth: 0,
                    }}
                  >
                    <i style={{ flex: "none", width: 16, height: 1, background: T.ink3 }} />
                    <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {signature.trim() || SIGNATURE_FALLBACK}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {/* ==================== 拍一拍（贴近资料区，属于「我」这一块） ==================== */}
            <div className="mp-grp" style={{ marginTop: 20 }}>
              <MenuItem
                icon="pat"
                label="拍一拍"
                desc="点右边就地改文案"
                edit="拍了拍我的小世界"
                onEditClick={() => showToast("拍一拍 · 预览")}
                onClick={() => showToast("拍一拍 · 预览")}
              />
            </div>

            {/* ==================== 资产 ==================== */}
            <SectLabel en="Assets" cn="资产" />
            <div className="mp-grp">
              <MenuItem icon="bookmark" label="我的收藏" onClick={() => showToast("我的收藏 · 预览")} />
              <MenuItem icon="wallet" label="我的钱包" onClick={onOpenWallet} />
            </div>

            {/* ==================== 设置 ==================== */}
            <SectLabel en="Settings" cn="设置" />
            <div className="mp-grp">
              <MenuItem icon="settings" label="聊天全局设定" onClick={onOpenChatGlobal} />
            </div>

            {/* ==================== 关于 ==================== */}
            <SectLabel en="About" cn="关于" />
            <div className="mp-grp">
              {/* iOS 主屏幕 App 从快照复活、不重新加载页面，改版后可能一直跑旧代码；
                  这里给一个手动重载入口兜底（原侧边栏同款）。 */}
              <MenuItem
                icon="update"
                label="检查更新"
                desc={`当前版本 v${APP_VERSION}`}
                onClick={() => window.location.reload()}
              />
              <MenuItem icon="help" label="帮助与反馈" onClick={() => showToast("帮助与反馈 · 预览")} />
            </div>

            {/* ==================== 底部动作 ==================== */}
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 28 }}>
              <button type="button" onClick={() => current && openMaskEdit(current)} style={primaryBtnStyle}>
                编辑资料
              </button>
              <button type="button" onClick={onExit} style={ghostDangerBtnStyle}>
                退出星绥通讯
              </button>
            </div>
          </>
        )}
      </div>

      {/* 签名编辑弹窗 */}
      {sigOpen ? (
        <div
          onClick={() => setSigOpen(false)}
          style={modalOverlayStyle}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={modalCardStyle}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.ink, letterSpacing: ".1em", textAlign: "center" }}>
              签名
            </p>
            <input
              type="text"
              value={sigDraft}
              onChange={(e) => setSigDraft(e.target.value)}
              placeholder={SIGNATURE_FALLBACK}
              maxLength={30}
              className="mp-field"
              style={{ ...inputStyle, marginTop: 14 }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setSigOpen(false)} style={cancelBtnStyle}>
                取消
              </button>
              <button type="button" onClick={() => void saveSignature()} style={saveBtnStyle}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除确认弹窗 */}
      {confirmDelete && maskEdit && maskEdit !== "new" ? (
        <div
          onClick={() => setConfirmDelete(false)}
          style={modalOverlayStyle}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={modalCardStyle}
          >
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.ink, letterSpacing: ".08em", textAlign: "center" }}>
              删除此面具？
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: T.ink3,
                marginTop: 6,
                letterSpacing: ".05em",
                textAlign: "center",
              }}
            >
              删除后不可恢复
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setConfirmDelete(false)} style={cancelBtnStyle}>
                取消
              </button>
              <button type="button" onClick={() => void deleteMask()} style={deleteConfirmBtnStyle}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- 元件与样式 ---------------- */

/** 方牌三档深浅：flat 列表默认、deep 当前、hero 刊头大牌。 */
const AVATAR_VARIANTS = {
  flat: {
    background: "linear-gradient(155deg,#9CB2CA 0%,#7A93B1 52%,#5F7A99 100%)",
    ring: "0 0 0 2.5px rgba(90,115,145,.11)",
    weight: 600,
  },
  deep: {
    background: "linear-gradient(155deg,#8AA1BC 0%,#64809E 55%,#4A6588 100%)",
    ring: "0 0 0 2.5px rgba(90,115,145,.14)",
    weight: 700,
  },
  hero: {
    background: "linear-gradient(155deg,#8FA6C1 0%,#6A85A3 55%,#4F6A8C 100%)",
    ring: "0 0 0 3.5px rgba(90,115,145,.12)",
    weight: 600,
  },
} as const;

/** 面具头像：有图显图，无图雾蓝方牌＋名字首字（空名「我」）。 */
function MaskAvatar({
  mask,
  size,
  variant = "flat",
}: {
  mask: Mask;
  size: number;
  variant?: "flat" | "deep" | "hero";
}) {
  const v = AVATAR_VARIANTS[variant];
  if (mask.avatar) {
    return (
      <div
        style={{
          width: size,
          height: size,
          overflow: "hidden",
          flex: "none",
          boxShadow: "0 0 0 2.5px rgba(90,115,145,.14), 0 10px 18px -12px rgba(46,62,82,.6)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mask.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        background: v.background,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFF",
        fontFamily: SERIF,
        fontSize: size >= 74 ? 27 : size >= 60 ? 22 : size >= 44 ? 17 : Math.round(size * 0.37),
        fontWeight: v.weight,
        letterSpacing: ".08em",
        boxShadow: `${v.ring}, inset 0 1.5px 0 rgba(255,255,255,.42), inset 0 -12px 18px -14px rgba(26,44,68,.55), 0 12px 20px -12px rgba(46,62,82,.6), 0 2px 4px rgba(46,62,82,.12)`,
      }}
    >
      {(mask.name.trim() || "我").charAt(0)}
    </div>
  );
}

/** 分组索引签：一根小竖色条＋名字＋英文，再一条细线拉到右端，最右是条数（同通讯人页）。 */
function GroupLabel({ cn, en, count, dot }: { cn: string; en: string; count: number; dot?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 4px 9px" }}>
      <i
        style={{
          flex: "none",
          width: 4,
          height: 14,
          background: dot ?? T.ink,
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".18em", color: T.ink, whiteSpace: "nowrap" }}>
        {cn}
      </span>
      <span
        style={{
          fontFamily: EN,
          fontSize: 9,
          letterSpacing: ".18em",
          color: T.ink3,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {en}
      </span>
      {/* 索引线：从名字后面一直拉到右端 */}
      <i style={{ flex: 1, height: 1, background: T.lineSoft, minWidth: 12 }} />
      <span
        style={{
          fontFamily: EN,
          fontSize: 9.5,
          letterSpacing: ".12em",
          color: T.ink3,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(count).padStart(2, "0")}
      </span>
    </div>
  );
}

/** 章节签（比 GroupLabel 更轻）：英文小字·中文小字＋一条拉到右端的细线，无竖条。 */
function SectLabel({ en, cn }: { en: string; cn: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 7, padding: "34px 4px 10px" }}>
      <span
        style={{
          fontFamily: LAT,
          fontSize: 9.5,
          letterSpacing: ".3em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
      <span style={{ fontFamily: LAT, fontSize: 9.5, color: T.ink3 }}>·</span>
      <span style={{ fontSize: 11, letterSpacing: ".26em", color: T.ink2 }}>{cn}</span>
      <span style={{ flex: 1, alignSelf: "center", height: 1, background: T.lineSoft, minWidth: 12 }} />
    </div>
  );
}

/** 设置行：一枚雾蓝细线图标＋标题／副行；右端一枚箭头，或就地编辑入口（虚线底＋铅笔）。 */
function MenuItem({
  icon,
  label,
  desc,
  edit,
  onEditClick,
  onClick,
}: {
  icon: string;
  label: string;
  desc?: string;
  edit?: string;
  onEditClick?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      data-tap="true"
      className="mp-row"
      style={{
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        width: "100%",
        padding: "13px 4px",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 13,
          pointerEvents: "none",
        }}
      >
        <MenuIcon type={icon} color={T.pink} />
      </div>
      <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: ".06em", color: T.ink }}>{label}</p>
        {desc ? (
          <p
            style={{
              margin: 0,
              fontSize: 10.5,
              marginTop: 3,
              letterSpacing: ".04em",
              color: T.ink3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {desc}
          </p>
        ) : null}
      </div>
      {edit !== undefined ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onEditClick?.();
          }}
          className="mp-soft"
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginLeft: 8,
            maxWidth: "46%",
            fontSize: 12,
            letterSpacing: ".02em",
            color: T.pink,
            borderBottom: "1px dashed rgba(90,115,145,.45)",
          }}
        >
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {edit}
          </span>
          <Pencil size={11} strokeWidth={1.9} style={{ flex: "none" }} />
        </span>
      ) : (
        <ChevronRight
          size={15}
          strokeWidth={1.8}
          color={T.ink3}
          style={{ flex: "none", marginLeft: 8, pointerEvents: "none" }}
        />
      )}
    </div>
  );
}

function MenuIcon({ type, color }: { type: string; color: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.5 } as const;
  switch (type) {
    /* 面具：舞台脸谱（两张孔＋笑口，罩在盾形轮廓里）。 */
    case "mask":
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M5 4.5h14v6.5a7 7 0 0 1-14 0z" />
          <path d="M8.9 9.3c.55-.75 1.5-.75 2.05 0M13.05 9.3c.55-.75 1.5-.75 2.05 0" strokeLinecap="round" />
          <path d="M9.4 12.8c.65.85 1.6 1.35 2.6 1.35s1.95-.5 2.6-1.35" strokeLinecap="round" />
        </svg>
      );
    /* 收藏：书签。 */
    case "bookmark":
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M7 4h10v16l-5-3-5 3z" />
        </svg>
      );
    /* 钱包：圆角票夹＋右侧一枚扣眼。 */
    case "wallet":
      return (
        <svg {...common} strokeLinejoin="round">
          <rect x="3.5" y="6" width="17" height="13" rx="2.6" />
          <path d="M14 12.5h6.5" strokeLinecap="round" />
          <circle cx="15.6" cy="12.5" r="1" />
        </svg>
      );
    /* 聊天全局设定：滑杆（三道横线各挂一颗珠）。 */
    case "settings":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M5 7.5h14M5 12h14M5 16.5h14" />
          <circle cx="9.5" cy="7.5" r="1.9" />
          <circle cx="14.5" cy="12" r="1.9" />
          <circle cx="8" cy="16.5" r="1.9" />
        </svg>
      );
    /* 检查更新：回环箭头。 */
    case "update":
      return (
        <svg {...common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v4h-4" />
        </svg>
      );
    /* 帮助与反馈：问号圈。 */
    case "help":
      return (
        <svg {...common} strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.6" />
          <circle cx="12" cy="16.9" r="0.5" fill={color} stroke="none" />
        </svg>
      );
    /* 退出：门＋出箭。 */
    case "exit":
      return (
        <svg {...common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
          <path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5" />
        </svg>
      );
    case "signature":
      return (
        <svg {...common}>
          <path d="M14 3l7 7L8 21H3v-5L14 3z" strokeLinejoin="round" />
        </svg>
      );
    case "status":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      );
    case "pat":
      return (
        <svg {...common}>
          <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="8.5" />
        </svg>
      );
  }
}

/* 页头返回钮：透明细线箭头，绝对定位贴左（按下走 .mp-hbtn 缩一档）。 */
const headerBtnStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  margin: "auto 0",
  height: 24,
  width: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  background: "none",
  color: T.ink,
  cursor: "pointer",
};

/* 底部主按钮：实心雾蓝、直角、白字。 */
const primaryBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "15px 0",
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
  boxShadow: "0 16px 30px -18px rgba(90,115,145,.75)",
};

/* 底部危险按钮：浅底砖红字、直角。 */
const ghostDangerBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "15px 0",
  border: "none",
  background: "rgba(58,65,73,.05)",
  color: T.danger,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: SANS,
  letterSpacing: ".12em",
  cursor: "pointer",
};

const fieldLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: T.ink2,
  letterSpacing: ".12em",
  marginBottom: 7,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${T.line}`,
  background: T.bg,
  padding: "11px 13px",
  fontSize: 14,
  fontFamily: SANS,
  color: T.ink,
  outline: "none",
  letterSpacing: ".03em",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${T.line}`,
  background: T.bg,
  padding: "11px 13px",
  fontSize: 13.5,
  fontFamily: SANS,
  color: T.ink,
  outline: "none",
  letterSpacing: ".03em",
  lineHeight: 1.7,
  resize: "none",
  minHeight: 100,
};

const selectStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${T.line}`,
  background: T.bg,
  padding: "10px 6px",
  fontSize: 13,
  fontFamily: SANS,
  color: T.ink,
  outline: "none",
  textAlign: "center",
};

const genderPillStyle: CSSProperties = {
  flex: 1,
  padding: "10px 0",
  border: `1px solid ${T.line}`,
  background: T.bg,
  color: T.ink2,
  fontSize: 13.5,
  fontFamily: SANS,
  letterSpacing: ".1em",
  cursor: "pointer",
};

/* 选中：实雾蓝底白字（跟底部主按钮同一颗蓝） */
const genderPillActiveStyle: CSSProperties = {
  ...genderPillStyle,
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
  fontWeight: 700,
};

const fieldHintStyle: CSSProperties = {
  margin: 0,
  fontSize: 10.5,
  color: T.ink3,
  letterSpacing: ".05em",
};

const cancelBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  border: "none",
  background: "rgba(20,19,24,.05)",
  color: T.ink2,
  fontSize: 14,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
};

const saveBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
  boxShadow: "0 10px 20px -12px rgba(90,115,145,.95)",
};

const deleteBtnStyle: CSSProperties = {
  width: "100%",
  marginTop: 14,
  padding: "11px 0",
  border: `1px solid rgba(192,86,63,.32)`,
  background: "transparent",
  color: T.danger,
  fontSize: 13,
  fontFamily: SANS,
  letterSpacing: ".12em",
  cursor: "pointer",
};

const deleteConfirmBtnStyle: CSSProperties = {
  flex: 1,
  padding: "12px 0",
  border: "none",
  background: T.danger,
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
};

const modalOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20,19,24,.4)",
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 28,
};

const modalCardStyle: CSSProperties = {
  background: T.card,
  padding: "22px 20px",
  width: "100%",
  maxWidth: 260,
  boxShadow: "0 18px 44px rgba(20,19,24,.2)",
};
