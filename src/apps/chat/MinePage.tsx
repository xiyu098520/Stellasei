"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Camera, ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react";
import {
  DEFAULT_MASK_ID,
  MASK_UID_RE,
  genMaskUid,
  saveMasks,
  type Mask,
} from "@/lib/settings/mask";
import { copyText } from "@/lib/clipboard";
import { uuid } from "@/lib/uuid";
import { AVATAR_GRADIENT, EN, SANS, T } from "./shared";

/* =======================================================================
 * 「我的」页（侧边栏头像进入）
 * 当前使用的面具卡 → 面具列表（默认面具置顶，不可删）→ 新增／编辑／切换
 * 名字由使用中的面具决定；全空时 TA 眼中只有「我」
 *
 * 皮是 T：透粉白底、纯白卡、无衬线，黑只落在大标题与返回钮上，不整页翻黑；
 * 页头是「近黑圆返回钮＋一行英文小字起头＋28/800 近黑大标题＋通栏册页线」。
 * 骨给这一页自己的样子——「我的」讲的是面具，首屏就摆**一张名片**：
 * 当前面具是一张粉白渐变的大卡（左上角一根粉色小色标、右上角实粉「使用中」小牌、
 * 白环包住头像、ID 做成可点复制的小胶囊、人设摘要压在底下），右下角一行粉色「编辑 ›」。
 * 跟通讯人页的纯白方格墙一眼分得开：那页是名册，这页是名片。
 * 面具册（其他面具）去卡内分隔线，改用留白撑开一列圆角行；
 * 「使用」＝淡粉底粉字小胶囊，「新增面具」＝一条淡粉实底通栏行（不再是虚框）。
 * 零件（MaskAvatar／MenuItem／GroupLabel）在文件末尾本地改，**不动 `widgets.tsx`**。
 *
 * 签名并进面具：签名是面具自己的一个栏位——
 * 名片卡上多一行签名（点它直接改），面具编辑页在「名字」下面多一个「签名」输入框，
 * 「设置」分组里不再有签名入口。
 * ===================================================================== */

/** 签名兜底文案（侧边栏／名片卡都用它；旧档案同款）。 */
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
  onBack,
  showToast,
}: {
  signature: string;
  masks: Mask[];
  onSignatureChange: (next: string) => void;
  onMasksChange: (next: Mask[]) => void;
  onBack: () => void;
  showToast: (msg: string) => void;
}) {
  /* ---------- 面具编辑 ---------- */
  /** null＝主页；"new"＝新增；Mask＝编辑既有。 */
  const [maskEdit, setMaskEdit] = useState<Mask | "new" | null>(null);
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

  /** 面具行的副行：性别·生日，否则人设摘要。 */
  const maskSubline = (m: Mask) => {
    const base = [m.gender, m.birth ? birthText(m.birth) : ""].filter(Boolean).join(" · ");
    if (base) return base;
    const p = m.persona.trim();
    if (p) return p.length > 20 ? `${p.slice(0, 20)}…` : p;
    return "尚未填写人设";
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
        : { cn: "我的", en: "the masks" };

  const handleBack = () => {
    if (maskEdit) setMaskEdit(null);
    else onBack();
  };

  /** 其他面具（当前面具之外的那些）。 */
  const others = masks.filter((m) => m.id !== current?.id);

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
      {/* 交互：按下整卡／整行往里收一档（同通讯人页、消息列表） */}
      <style>{`
        .mp-card { transition: transform .16s ease, filter .16s ease; }
        .mp-card:active { transform: scale(.982); filter: brightness(.97); }
        .mp-hbtn { transition: transform .15s ease, opacity .15s ease; }
        .mp-hbtn:active { transform: scale(.93); opacity: .78; }
        .mp-row { transition: transform .16s ease, background-color .16s ease; }
        /* 按住立刻染一层淡粉（过渡压到 .06s），松手再慢慢化开 */
        .mp-row:active { transform: scale(.986); background-color: ${T.pinkSoft}; transition-duration: .06s; }
        .mp-soft { transition: transform .16s ease, filter .16s ease; }
        .mp-soft:active { transform: scale(.96); filter: brightness(.97); }
        .mp-field::placeholder { color: ${T.ink3}; }
        @media (prefers-reduced-motion: reduce) {
          .mp-card, .mp-hbtn, .mp-row, .mp-soft { transition: none; }
        }
      `}</style>

      {/* 页头：近黑圆返回钮＋一行英文小字起头，下面压一条 28/800 近黑大标题，
          底下一根通栏粉线（同设置面板／通讯人页）。
          这枚钮在任何子页都先退一层（面具编辑 → 主页 → 侧边栏），不是一步回主屏 */}
      <header
        style={{
          position: "relative",
          flex: "none",
          zIndex: 20,
          overflow: "hidden",
          padding: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 10px) 20px 14px",
        }}
      >
        {/* 页头补装饰：撤黑不等于全白，页头得有东西垫着。
            ①头顶一团淡粉晕——页头算是有「底」了，但不落成黑块；
            ②右上角一行超大英文水印 MINE——侧边栏「超大字压上去」的缩小版：它跟大标题
              「我的」是一个意思（中文大字＋英文水印配对，同侧边栏的「星绥通讯 / STELLASEI」），
              又不会跟左边那行现有索引 THE MASKS 撞词。只露个轮廓，给这页一个记号。 */}
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
              "radial-gradient(circle at 50% 44%, rgba(232,106,155,.20) 0%, rgba(232,106,155,.07) 46%, rgba(232,106,155,0) 72%)",
            pointerEvents: "none",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 14,
            top: "calc(var(--safe-area-top, 0px) + var(--sim-status-h, 0px) + 6px)",
            fontFamily: EN,
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: ".01em",
            color: "rgba(232,106,155,.13)",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          MINE
        </span>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={handleBack}
            aria-label="返回"
            className="mp-hbtn"
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
            {header.en}
          </span>
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-.01em",
              lineHeight: 1,
              color: T.ink,
            }}
          >
            {header.cn}
          </h1>
          {/* 面具张数：一枚粉色小牌（只在主页出来，子页不占位） */}
          {maskEdit === null ? (
            <span
              style={{
                flex: "none",
                minWidth: 24,
                height: 22,
                padding: "0 8px",
                borderRadius: 999,
                background: T.pink,
                color: "#FFFFFF",
                fontFamily: EN,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".04em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontVariantNumeric: "tabular-nums",
                boxShadow: "0 8px 16px -10px rgba(232,106,155,.95)",
              }}
            >
              {masks.length}
            </span>
          ) : null}
        </div>

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

      {/* 内容区 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "none",
          padding: "16px 20px calc(var(--safe-area-bottom, 0px) + 24px)",
        }}
      >
        {maskEdit !== null ? (
          /* ==================== 面具编辑 ==================== */
          <div style={{ ...cardGroupStyle, padding: "18px 16px" }}>
            {/* 头像 */}
            <div
              style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="更换头像"
                style={{ position: "relative", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
              >
                <MaskAvatar mask={{ avatar: mAvatar, name: mName } as Mask} size={72} />
                <span
                  style={{
                    position: "absolute",
                    right: -3,
                    bottom: -3,
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: T.pink,
                    /* 一圈白环把粉圆从头像上托起来（同侧边栏那枚粉圆钮的浮影） */
                    boxShadow: "0 0 0 3px #FFFFFF, 0 8px 16px -8px rgba(232,106,155,.95)",
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

            <label style={{ ...fieldLabelStyle, marginTop: 16 }}>人设</label>
            <textarea
              value={mPersona}
              onChange={(e) => setMPersona(e.target.value)}
              placeholder="你的性格、身份、说话方式……"
              maxLength={500}
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
              maxLength={300}
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
        ) : (
          <>
            {/* ==================== 名片：当前使用的面具（整卡点一下编辑） ==================== */}
            {current ? (
              <div
                onClick={() => openMaskEdit(current)}
                data-tap="true"
                className="mp-card"
                style={{
                  position: "relative",
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 22,
                  overflow: "hidden",
                  padding: 16,
                  /* 粉白渐变：整页唯一一块带色的底 —— 这一页的门面，跟通讯人页的纯白方格墙一眼分得开 */
                  background: `linear-gradient(135deg, ${T.pinkSoft} 0%, #FFFFFF 62%)`,
                  boxShadow: "0 18px 38px -26px rgba(20,19,24,.75)",
                  cursor: "pointer",
                }}
              >
                {/* 左侧一条通高粉书脊：整卡「就是当前这一张」的记号，往下渐隐——
                    跟侧边栏「当前项」同一种做法。垫在最前面，后面的内容都压在它上面。 */}
                <i
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    background: `linear-gradient(180deg, ${T.pink} 0%, rgba(232,106,155,.22) 100%)`,
                    pointerEvents: "none",
                  }}
                />

                {/* 顶行：「当前面具 / in use」，右端一枚实粉「使用中」 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: ".18em",
                      color: T.ink,
                      pointerEvents: "none",
                    }}
                  >
                    当前面具
                  </span>
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
                    in use
                  </span>
                  <i
                    style={{
                      flex: 1,
                      minWidth: 12,
                      height: 1,
                      background: "rgba(20,19,24,.07)",
                      pointerEvents: "none",
                    }}
                  />
                  <span style={currentBadgeStyle}>使用中</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
                  {/* 头像：白环把它从粉底上托起来，白环外再套一圈细粉线、底下一层浮影
                      ——跟个人资料页那颗头像同一套做法，两页的头一样大一样亮 */}
                  <div
                    style={{
                      flex: "none",
                      padding: 3.5,
                      borderRadius: 999,
                      background: "#FFFFFF",
                      boxShadow:
                        "0 0 0 1px rgba(232,106,155,.30), 0 14px 28px -16px rgba(20,19,24,.5)",
                      pointerEvents: "none",
                    }}
                  >
                    <MaskAvatar mask={current} size={82} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                      <span style={maskNoStyle}>{maskNoOf(current.id)}</span>
                      <span
                        style={{
                          minWidth: 0,
                          fontSize: 23,
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
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: T.ink2,
                        marginTop: 4,
                        letterSpacing: ".05em",
                        pointerEvents: "none",
                      }}
                    >
                      {current.id === DEFAULT_MASK_ID && !current.name.trim() && !current.persona.trim()
                        ? "默认面具 · 尚未填写任何信息"
                        : [current.gender, current.birth ? birthText(current.birth) : ""].filter(Boolean).join(" · ") ||
                          "还没填性别和生日"}
                    </div>
                    {/* ID 胶囊本身是一枚按钮：真机上按它走的是它自己的 click（复制），不会连带整卡一起进编辑 */}
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
                        marginTop: 8,
                        padding: "4px 9px",
                        borderRadius: 999,
                        border: `1px solid ${T.line}`,
                        background: "#FFFFFF",
                        color: T.ink2,
                        fontSize: 10.5,
                        fontFamily: SANS,
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        fontVariantNumeric: "tabular-nums",
                        cursor: "pointer",
                      }}
                    >
                      ID · {current.uid || "未设置"}
                      <Copy size={11} strokeWidth={2.4} color={T.pink} />
                    </button>
                  </div>
                </div>

                {/* 签名行：签名是这张面具自己的，点这行直接改——
                    自带 stopPropagation，不会连带整卡进编辑。 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSigDraft(signature);
                    setSigOpen(true);
                  }}
                  className="mp-soft"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    boxSizing: "border-box",
                    marginTop: 14,
                    padding: "9px 12px",
                    borderRadius: 14,
                    border: `1px solid ${T.line}`,
                    background: "rgba(255,255,255,.72)",
                    color: T.ink2,
                    fontFamily: SANS,
                    fontSize: 12,
                    letterSpacing: ".04em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ flex: "none", color: T.pink, fontWeight: 700, letterSpacing: ".06em" }}>
                    签名
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {signature.trim() || SIGNATURE_FALLBACK}
                  </span>
                  <ChevronRight size={13} strokeWidth={2.6} color={T.ink3} />
                </button>

                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: T.ink2,
                    marginTop: 10,
                    lineHeight: 1.75,
                    letterSpacing: ".04em",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    pointerEvents: "none",
                  }}
                >
                  {personaSummary(current)}
                </p>

                {/* 右下角一行粉色「编辑 ›」：把「整张卡都能点」这件事说出来 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 2,
                    marginTop: 8,
                    color: T.pink,
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    pointerEvents: "none",
                  }}
                >
                  编辑
                  <ChevronRight size={14} strokeWidth={2.6} />
                </div>
              </div>
            ) : null}

            {/* ==================== 面具册：其他面具＋新增 ==================== */}
            <div style={{ marginTop: 22 }}>
              <GroupLabel cn="面具" en="masks" count={masks.length} dot={T.pink} />
              <div style={{ ...cardGroupStyle, padding: "4px 8px 10px" }}>
                {others.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      padding: "8px 8px 2px",
                      fontSize: 11.5,
                      color: T.ink3,
                      letterSpacing: ".04em",
                      lineHeight: 1.75,
                    }}
                  >
                    还只有这一张面具 —— 再添一张，换个人去说话。
                  </p>
                ) : (
                  others.map((m) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* 整行可点（进编辑）：显式铺满、子元素不吃指针，按下一层淡粉 */}
                      <div
                        onClick={() => openMaskEdit(m)}
                        data-tap="true"
                        className="mp-row"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 8px",
                          borderRadius: 14,
                          cursor: "pointer",
                        }}
                      >
                        <MaskAvatar mask={m} size={44} />
                        <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                            <span style={maskNoStyle}>{maskNoOf(m.id)}</span>
                            <span
                              style={{
                                minWidth: 0,
                                fontSize: 15,
                                fontWeight: 700,
                                color: T.ink,
                                letterSpacing: ".04em",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {m.name.trim() || "我"}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 10.5,
                              color: T.ink3,
                              marginTop: 3,
                              letterSpacing: ".04em",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {m.id === DEFAULT_MASK_ID
                              ? `默认面具${m.name.trim() || m.persona.trim() ? "" : " · 空白"}`
                              : maskSubline(m)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void activateMask(m.id)}
                        className="mp-soft"
                        style={useBtnStyle}
                      >
                        使用
                      </button>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={() => openMaskEdit("new")}
                  className="mp-soft"
                  style={addMaskBtnStyle}
                >
                  <Plus size={15} strokeWidth={2.3} />
                  <span>新增面具</span>
                </button>
              </div>
            </div>

            {/* ==================== 设置分组 ==================== */}
            <div style={{ marginTop: 24 }}>
              <GroupLabel cn="设置" en="settings" count={2} dot={T.ink} />
              <div style={{ ...cardGroupStyle, padding: 4 }}>
                <MenuItem
                  icon="status"
                  label="在线状态"
                  desc="在线"
                  color={T.blueDeep}
                  bg={T.blueSoft}
                  onClick={() => showToast("在线状态 · 预览")}
                />
                <MenuItem
                  icon="pat"
                  label="拍一拍"
                  desc="设置拍一拍文案"
                  color={T.pink}
                  bg={T.pinkSoft}
                  onClick={() => showToast("拍一拍 · 预览")}
                />
              </div>
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

/** 面具头像：有图显图，无图渐变底＋名字首字（空名「我」）。 */
function MaskAvatar({ mask, size }: { mask: Mask; size: number }) {
  if (mask.avatar) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flex: "none",
          boxShadow: "0 8px 18px -10px rgba(232,106,155,.7)",
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
        borderRadius: "50%",
        background: AVATAR_GRADIENT,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFF",
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: ".05em",
        boxShadow: "0 8px 18px -10px rgba(232,106,155,.85)",
      }}
    >
      {(mask.name.trim() || "我").charAt(0)}
    </div>
  );
}

/** 分组索引签：一根小竖色条＋名字＋英文，再一条细线拉到右端，最右是条数（同通讯人页）。 */
function GroupLabel({ cn, en, count, dot }: { cn: string; en: string; count: number; dot?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 2px 7px" }}>
      <i
        style={{
          flex: "none",
          width: 4,
          height: 14,
          borderRadius: 2,
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

/** 设置行：一枚彩色小方块图标＋标题／副行，右端一枚箭头（按下一层淡粉）。 */
function MenuItem({
  icon,
  label,
  desc,
  color,
  bg,
  onClick,
}: {
  icon: string;
  label: string;
  desc?: string;
  color: string;
  bg?: string;
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
        padding: "13px 12px",
        borderRadius: 14,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: bg ?? T.pinkSoft,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 12,
          pointerEvents: "none",
        }}
      >
        <MenuIcon type={icon} color={color} />
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
      <ChevronRight size={15} strokeWidth={1.8} color={T.ink3} style={{ flex: "none", marginLeft: 8, pointerEvents: "none" }} />
    </div>
  );
}

function MenuIcon({ type, color }: { type: string; color: string }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.5 } as const;
  switch (type) {
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

/* 页头返回钮：近黑圆＋白图标（同设置面板那枚，按下走 .mp-hbtn 缩一档） */
const headerBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  flex: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: T.ink,
  border: "none",
  borderRadius: 999,
  color: "#FFFFFF",
  cursor: "pointer",
  boxShadow: "0 4px 12px -4px rgba(20,19,24,.5)",
};

const cardGroupStyle: CSSProperties = {
  background: T.card,
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 10px 26px -22px rgba(20,19,24,.7)",
};

/* 实粉小牌：只会落在浅粉底／白底上，白字压得住 */
const currentBadgeStyle: CSSProperties = {
  flex: "none",
  fontSize: 9.5,
  fontWeight: 700,
  padding: "3px 8px",
  borderRadius: 999,
  background: T.pink,
  color: "#FFFFFF",
  letterSpacing: ".08em",
  boxShadow: "0 8px 16px -10px rgba(232,106,155,.95)",
};

/* 面具编号：淡灰、等宽数字，安静地待在名字前面。 */
const maskNoStyle: CSSProperties = {
  flex: "none",
  fontFamily: SANS,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".1em",
  color: T.ink3,
  fontVariantNumeric: "tabular-nums",
};

const useBtnStyle: CSSProperties = {
  flex: "none",
  padding: "6px 14px",
  borderRadius: 999,
  border: "none",
  background: T.pinkSoft,
  color: T.pink,
  fontSize: 11.5,
  fontWeight: 700,
  fontFamily: SANS,
  letterSpacing: ".1em",
  cursor: "pointer",
};

const addMaskBtnStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "12px 0",
  marginTop: 6,
  border: "none",
  borderRadius: 14,
  background: T.pinkSoft,
  color: T.pink,
  fontSize: 13,
  fontWeight: 700,
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
  borderRadius: 12,
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
  borderRadius: 12,
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
  borderRadius: 12,
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
  borderRadius: 12,
  border: `1px solid ${T.line}`,
  background: T.bg,
  color: T.ink2,
  fontSize: 13.5,
  fontFamily: SANS,
  letterSpacing: ".1em",
  cursor: "pointer",
};

/* 选中：实粉底白字（跟条数牌、使用中牌同一颗粉） */
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
  borderRadius: 12,
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
  borderRadius: 12,
  border: "none",
  background: T.pink,
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: SANS,
  letterSpacing: ".14em",
  cursor: "pointer",
  boxShadow: "0 10px 20px -12px rgba(232,106,155,.95)",
};

const deleteBtnStyle: CSSProperties = {
  width: "100%",
  marginTop: 14,
  padding: "11px 0",
  borderRadius: 12,
  border: `1px solid rgba(229,72,77,.3)`,
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
  borderRadius: 12,
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
  borderRadius: 18,
  padding: "22px 20px",
  width: "100%",
  maxWidth: 260,
  boxShadow: "0 18px 44px rgba(20,19,24,.2)",
};
