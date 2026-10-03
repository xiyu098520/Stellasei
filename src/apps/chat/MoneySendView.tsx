"use client";

/**
 * 星绥通讯：转账／红包的填写页。
 *
 * **从底下升起来的一张墨底弹窗**（不是整页）：先铺一层遮罩把聊天压暗，纸贴在屏底、
 * 顶上两角圆（18），上面露出聊天页——这一页内容就那几样，整页铺满会空出一大块。
 * 页头一行：左边这一笔叫什么，右边一枚浅描边的「×」收掉；再往上一根抓手。
 *
 * 正文照微信那三步排，但**每一件都在**：收钱的那一位（一张淡粉小签，左边写「你正在转账给」、
 * 右边 TA 的**方头像**）→ 金额 → 说明 →（红包）封面。这一页只管「给谁、多少钱、写句什么」——
 * 钱从零钱还是哪张卡出，留到掏钱那一屏去挑。
 *
 * 墨底那一口气跟聊天窗一脉（纸面 `#1B161B` ＋极淡网点＋顶上压一道柔光）：
 * 白字，粉只落在该落的地方——「¥」、表情、一条由实到透明的粉线（金额底下，像一条等着被填的槽）、
 * 以及底下那枚粉色渐变的圆胶囊按钮（垫一层实心粉影，跟聊天窗发送键一个做法）。
 *
 * 说明那格是一只**陷进去的墨槽**（深底、浅边、内阴影）：框上头钉一枚小字
 * （转账「添加转账说明」／红包「添加红包留言」），槽里只剩「选填」当提示。这一格是选填的
 * （`sendMoneyNow` 里 `payNoteText.trim()` 空着也照发）。
 *
 * 红包留言旁边钉一枚表情入口（**只钉红包页**，转账页没有）：表情包本体还没做，点了照实报一句。
 *
 * 红包封面：预设只剩一张默认（见 `redpacket.ts`），这一页只留**一行**——左边这张封面的缩样、
 * 右边一枚「制作封面」。自定义图走媒体仓库，消息里只存引用串（跟聊天图片同一条规矩——
 * 不撑会话记录）；**取景位置挂在引用串的尾巴上**，居中就不写，所以没挪过的封面存出来跟从前一样。
 * 点「制作封面」进封面那几页：「我的封面」画廊 → 大预览／调整位置／更多内容。
 * 那几页也是弹窗，跟这一页同一族（见 `CoverSheet`）：同一张墨底纸、同一副页头页脚——
 * 红包这条流程从填钱到做封面一口气是一个长相，不混别的族的壳。
 */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ChevronRight, Gift, Image as ImageIcon, Plus, Smile, X } from "lucide-react";
import { WALLET_MONO, WALLET_TITLE } from "./WalletSheet";
import { AVATAR_GRADIENT, KAI, SANS, T } from "./shared";
import {
  clampRedCoverPos,
  composeRedCover,
  isCustomRedCover,
  RED_COVER_CLAIMED_VEIL,
  RED_COVER_DEFAULT,
  RED_COVER_POS_CENTER,
  RED_COVER_TONE,
  redCoverBgOf,
  redCoverPosMapOf,
  redCoverPosOf,
  redCoverRefOf,
  redCoverSrcRefOf,
  type RedCoverPos,
  type RedCoverPosMap,
  type RedCoverScene,
} from "./redpacket";
import { persistImageAsset, useMediaSrc } from "@/lib/chat/media-asset";
/* 我弄过的封面：做过的都留一张在库里，下次做封面先看到这一排。 */
import {
  getRedCoverLibrary,
  putRedCoverToLibrary,
  removeRedCoverFromLibrary,
} from "@/lib/chat/red-cover-store";
/* 红包封套的两张正脸：封面的大预览与「更多内容」里的开完样式都用它们
   （跟聊天里点开红包那一页同一张脸，形状都在那个文件里）。 */
import { RedEnvelopeCard, RedOpenedCard } from "./RedPacketCards";

export default function MoneySendView({
  kind,
  name,
  avatar,
  amount,
  note,
  cover,
  busy,
  onAmountChange,
  onNoteChange,
  onCoverChange,
  onClose,
  onSubmit,
  showToast,
}: {
  /** 这一笔是红包还是转账。 */
  kind: "redpacket" | "transfer";
  /** 收钱的那一位（聊天对面的名字）。 */
  name: string;
  /** TA 的头像地址：空串就落回那枚粉色渐变块＋姓的首字。 */
  avatar: string;
  amount: string;
  note: string;
  /** 红包封面（预设 id 或自定义图的引用串；转账不用这格）。 */
  cover: string;
  busy: boolean;
  onAmountChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onCoverChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  showToast: (msg: string) => void;
}) {
  const isRp = kind === "redpacket";
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  /** 封面那几页开在哪一页：null＝没开（就是发红包这一页）。
   *  三页见文件底下 `RedCoverGallery`（挑）／`RedCoverStudio`（看长相）／`RedCoverFramer`（挪位置）。 */
  const [coverPage, setCoverPage] = useState<"gallery" | "card" | "adjust" | null>(null);
  /** 从「调整位置」退回来该回哪一页：新建那条路回画廊，给已有封面挪位置那条路回大预览。 */
  const [adjustBack, setAdjustBack] = useState<"gallery" | "card">("gallery");
  /** 正在挪位置的那张图（引用串）与它各处各挪到哪儿了。 */
  const [draftRef, setDraftRef] = useState("");
  const [draftMap, setDraftMap] = useState<RedCoverPosMap>({});
  /** 这次点「选图」是拿来当新封面，还是替换现在这张——决定选完进哪一页。 */
  const pickTargetRef = useRef<"new" | "replace">("new");
  /* 自定义封面那张图：引用串要读仓库换地址（尾巴上可能带着取景后缀，先剥掉）；
     铺的时候照**卡面这一档**的位置铺（这一页的缩样是横向小卡那个比例）。 */
  const customCoverSrc = useMediaSrc(redCoverSrcRefOf(cover));
  const coverBg = redCoverBgOf(customCoverSrc, redCoverPosOf(cover, "card"), RED_COVER_DEFAULT.bg);

  /** 传一张图当红包封面：读出来 → 压缩进媒体仓库 → 消息那边只存引用串。
   *  存不进去如实说一句，别让她以为换上了。 */
  const handleCoverFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        setCoverBusy(false);
        showToast("这张图读不出来，换一张试试");
        return;
      }
      void persistImageAsset(dataUrl).then((res) => {
        setCoverBusy(false);
        if (!res) {
          showToast("封面没存上，再试一次");
          return;
        }
        /* 新挑的一张先别定死：进「调整位置」页，她把画面挪好了再带走（三处都从正中起）。 */
        if (pickTargetRef.current === "new") {
          setDraftRef(res.ref);
          setDraftMap({});
          setAdjustBack("gallery");
          setCoverPage("adjust");
          return;
        }
        onCoverChange(res.ref);
      });
    };
    reader.onerror = () => {
      setCoverBusy(false);
      showToast("这张图读不出来，换一张试试");
    };
    reader.readAsDataURL(file);
  };

  /** 开相册挑图（两种用处共用一个 input）。 */
  const pickCoverFile = (target: "new" | "replace") => {
    pickTargetRef.current = target;
    coverInputRef.current?.click();
  };

  /** 进「调整位置」页：`ref` 是要挪的那张图，`map` 是它各处眼下各挪在哪儿。 */
  const openAdjust = (ref: string, map: RedCoverPosMap, back: "gallery" | "card") => {
    setDraftRef(ref);
    setDraftMap(map);
    setAdjustBack(back);
    setCoverPage("adjust");
  };

  /** 「调整位置」页按了确定：各处的位置拼回封面值上，带上它回上一页；
   *  这张挪好的也跟着进「我的封面」——还是同一格（同一张照片只占一条），只是位置换新了。
   *  **等库里写完再翻页**：画廊是翻页那一刻去读库的，抢先翻过去会读到旧名单，
   *  刚做的这张就看不见——非得退出去再进来才冒出来。 */
  const commitCoverPos = (map: RedCoverPosMap) => {
    const value = composeRedCover(draftRef, map);
    onCoverChange(value);
    void putRedCoverToLibrary(value)
      .catch(() => {})
      .then(() => setCoverPage(adjustBack));
  };

  return (
    <div style={rootStyle}>
      {/* 说明框里的占位字要跟着墨底走（内联样式管不到 ::placeholder） */}
      <style>{`.msv-input::placeholder{color:rgba(255,253,248,.40);}`}</style>
      {/* 遮罩：把背后的聊天页压暗，纸才浮得起来 */}
      <div style={scrimStyle} />

      <div style={sheetStyle}>
        <div style={gripStyle} />

        {/* ── 页头：左边这一笔叫什么，右边一枚「×」收掉 ── */}
        <div style={headerStyle}>
          <span style={headerTitleStyle}>{isRp ? "红包" : "转账"}</span>
          <button type="button" aria-label="关闭" onClick={onClose} style={closeBtnStyle}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div style={scrollStyle}>
          {/* ── 给谁：一张淡粉小签，里头左边写清是转给谁、右边 TA 的方头像 ── */}
          <div style={receiverRowStyle}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={receiverLabelStyle}>{isRp ? "你正在发给" : "你正在转账给"}</span>
              <span style={receiverNameStyle}>{name}</span>
            </span>
            <span
              style={{
                flex: "none",
                width: 44,
                height: 44,
                borderRadius: 8,
                background: avatar ? `url(${avatar}) center/cover` : AVATAR_GRADIENT,
                color: "#FFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 600,
                boxShadow: "0 0 0 1.5px rgba(255,253,248,.45), 0 2px 6px rgba(0,0,0,.35)",
              }}
            >
              {avatar ? null : name.charAt(0)}
            </span>
          </div>

          {/* ── 金额：这一页的主角。粉色的「¥」＋一个大数字，底下一条由实到透明的粉线 ── */}
          <div style={amountBlockStyle}>
            <span style={amountSymbolStyle}>¥</span>
            <input
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="金额"
              style={amountInputStyle}
            />
          </div>
          <div style={amountLineStyle} />

          {/* ── 说明：框上头钉着一枚固定的小字，框是一只陷进去的墨槽 ── */}
          <div style={noteBlockStyle}>
            <div style={noteHeadStyle}>
              <span style={noteLabelStyle}>{isRp ? "添加红包留言" : "添加转账说明"}</span>
              {/* 表情入口：表情包本体之后再接 */}
              {isRp ? (
                <button
                  type="button"
                  className="pressable"
                  aria-label="添加表情"
                  onClick={() => showToast("表情包之后再做，先在这儿留个位置")}
                  style={stickerBtnStyle}
                >
                  <Smile size={16} strokeWidth={2} />
                </button>
              ) : null}
            </div>
            <input
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="选填"
              aria-label={isRp ? "添加红包留言" : "添加转账说明"}
              className="msv-input"
              style={noteInputStyle}
            />
          </div>

          {/* ── 红包封面：点它进封面那几页 ── */}
          {isRp ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ ...noteLabelStyle, marginBottom: 8 }}>红包封面</div>
              <button
                type="button"
                onClick={() => setCoverPage("gallery")}
                style={coverRowStyle}
              >
                {/* 左边这张封面的缩样（跟聊天里那张卡同一张脸，按它自己的取景位置铺） */}
                <span style={{ ...coverThumbStyle, background: coverBg }}>
                  {customCoverSrc ? null : (
                    <>
                      <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: RED_COVER_TONE.glow,
                        }}
                      />
                      <span style={coverThumbBadgeStyle}>
                        <Gift
                          size={13}
                          strokeWidth={1.8}
                          color={RED_COVER_TONE.chipInk}
                        />
                      </span>
                    </>
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span
                    style={{
                      display: "block",
                      fontFamily: WALLET_TITLE,
                      fontSize: 15,
                      fontWeight: 500,
                      letterSpacing: ".02em",
                      color: "#FFFDF8",
                    }}
                  >
                    {customCoverSrc ? "自定义封面" : "默认封面"}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      fontSize: 11,
                      color: "rgba(255,253,248,.42)",
                    }}
                  >
                    点进去挑一张，看它在各处长什么样
                  </span>
                </span>
                <span style={coverEntryHintStyle}>
                  <ImageIcon size={13} strokeWidth={2} />
                  制作封面
                  <ChevronRight size={14} strokeWidth={2} />
                </span>
              </button>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleCoverFile}
              />
            </div>
          ) : null}
        </div>

        {/* ── 底下这一枚粉胶囊：钱从这儿出去 ── */}
        <div style={footerStyle}>
          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            style={{ ...submitBtnStyle, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "处理中…" : isRp ? "塞进红包" : "转账"}
          </button>
        </div>
      </div>

      {/* 封面那几页：也是从底下升起来的弹窗，叠在更高一层（在纸外面，别被这张弹窗裁着） */}
      {isRp && coverPage === "gallery" ? (
        <RedCoverGallery
          cover={cover}
          busy={coverBusy}
          onPick={(v) => {
            onCoverChange(v);
            setCoverPage("card");
          }}
          onNew={() => pickCoverFile("new")}
          onClose={() => setCoverPage(null)}
        />
      ) : null}
      {isRp && coverPage === "card" ? (
        <RedCoverStudio
          cover={cover}
          busy={coverBusy}
          onPickFile={() => pickCoverFile("replace")}
          onAdjust={() => openAdjust(redCoverRefOf(cover), redCoverPosMapOf(cover), "card")}
          onReset={() => onCoverChange(RED_COVER_DEFAULT.id)}
          onBack={() => setCoverPage("gallery")}
          onClose={() => setCoverPage(null)}
          showToast={showToast}
        />
      ) : null}
      {isRp && coverPage === "adjust" ? (
        <RedCoverFramer
          refStr={draftRef}
          initial={draftMap}
          onCancel={() => setCoverPage(adjustBack)}
          onDone={commitCoverPos}
        />
      ) : null}
    </div>
  );
}

/* ── 样式：这一页自己的一套，不挂钱包那族的纸块料 ── */

const rootStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 130,
  /* 铺满整屏，纸自己贴在底下；底下透出来的是聊天页，所以这一层只管排版 */
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  fontFamily: SANS,
  color: "#FFFDF8",
  overflow: "hidden",
};

/** 遮罩：把背后的聊天页压暗，纸才浮得起来。 */
const scrimStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20,19,24,.44)",
};

/** 纸：从底下升起来的一张墨底弹窗，顶上两角圆、贴屏底，底下拖一条软影。 */
const sheetStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxHeight: "94%",
  display: "flex",
  flexDirection: "column",
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  padding: "0 20px calc(var(--safe-area-bottom, 0px) + 20px)",
  boxShadow: "0 -18px 44px rgba(0,0,0,.5)",
  backgroundColor: "#1B161B",
  backgroundImage:
    "radial-gradient(circle, rgba(255,253,248,.05) 1px, transparent 1.2px), " +
    "radial-gradient(130% 90% at 50% 0%, rgba(255,253,248,.07) 0%, transparent 62%)",
  backgroundSize: "10px 10px, 100% 100%",
  backgroundPosition: "50% 50%, 0 0",
};

/** 顶上一根抓手：说清这张纸是从底下推上来的。 */
const gripStyle: CSSProperties = {
  width: 34,
  height: 3,
  borderRadius: 999,
  background: "rgba(255,253,248,.20)",
  margin: "8px auto 0",
};

/** 页头那一行：左边这一笔叫什么，右边一枚「×」。 */
const headerStyle: CSSProperties = {
  flexShrink: 0,
  paddingTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerTitleStyle: CSSProperties = {
  fontFamily: WALLET_TITLE,
  fontSize: 18,
  fontWeight: 500,
  letterSpacing: ".08em",
  color: "rgba(255,253,248,.88)",
};

const closeBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  borderRadius: 0,
  border: "1.5px solid rgba(255,253,248,.5)",
  background: "transparent",
  color: "#FFFDF8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "none",
  padding: 0,
};

/** 给谁那一张淡粉小签：里头左边两行字、右边 TA 的方头像。 */
const receiverRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 18,
  padding: "12px 14px",
  borderRadius: 14,
  background: "rgba(232,106,155,.13)",
  border: "1px solid rgba(232,106,155,.26)",
};

const receiverLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "rgba(255,253,248,.42)",
  letterSpacing: ".14em",
};

const receiverNameStyle: CSSProperties = {
  display: "block",
  marginTop: 4,
  fontFamily: WALLET_TITLE,
  fontSize: 20,
  fontWeight: 500,
  letterSpacing: ".02em",
  color: "#FFFDF8",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 金额那一块：粉色的「¥」＋等宽大号数字，这一页的主角。 */
const amountBlockStyle: CSSProperties = {
  marginTop: 30,
  display: "flex",
  alignItems: "baseline",
  gap: 6,
};

const amountSymbolStyle: CSSProperties = {
  flex: "none",
  fontSize: 20,
  fontWeight: 600,
  color: T.pink,
  lineHeight: 1,
};

const amountInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  fontFamily: WALLET_MONO,
  fontSize: 46,
  fontWeight: 700,
  color: "#FFFDF8",
  letterSpacing: ".01em",
  padding: 0,
};

/** 金额底下那条线：由实到透明的粉——像一条等着被填进去的槽，不像红包的横杠。 */
const amountLineStyle: CSSProperties = {
  height: 2,
  marginTop: 3,
  background:
    "linear-gradient(90deg, rgba(232,106,155,.7) 0%, rgba(232,106,155,.20) 60%, rgba(232,106,155,0) 100%)",
};

/** 说明那一块：框上头钉一枚固定的小字，框本身是一只陷进去的墨槽。 */
const noteBlockStyle: CSSProperties = {
  marginTop: 30,
};

/** 框上头那一行：左边钉死的小字，右边贴着表情入口。 */
const noteHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 8,
};

/** 框上头那枚钉死的小字（「添加转账说明」／「添加红包留言」）。 */
const noteLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,253,248,.42)",
  letterSpacing: ".14em",
};

/** 表情入口：一枚粉色的笑脸，占着留言旁边这个位置，等表情包做出来再接上。 */
const stickerBtnStyle: CSSProperties = {
  flex: "none",
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: T.pink,
  padding: 0,
  cursor: "pointer",
};

/** 说明那一栏：一只陷进去的墨槽——深底、浅边、内阴影，一眼看得出这里能写字。 */
const noteInputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,253,248,.13)",
  borderRadius: 12,
  outline: "none",
  background: "rgba(255,253,248,.06)",
  padding: "13px 14px",
  fontFamily: SANS,
  fontSize: 14.5,
  fontWeight: 500,
  color: "#FFFDF8",
  boxShadow: "inset 0 2px 6px rgba(0,0,0,.42)",
};

const footerStyle: CSSProperties = {
  flexShrink: 0,
  paddingTop: 20,
};

/** 出去那一枚：粉色渐变的圆胶囊，底下垫一层实心粉影（跟聊天窗发送键一个做法）。 */
const submitBtnStyle: CSSProperties = {
  width: "100%",
  padding: "15px 0",
  borderRadius: 999,
  border: "none",
  background: "linear-gradient(180deg,#EE7BA6 0%,#D22F6E 100%)",
  color: "#FFFFFF",
  fontFamily: WALLET_TITLE,
  fontSize: 14.5,
  fontWeight: 600,
  letterSpacing: ".1em",
  textIndent: ".1em",
  boxShadow: "0 6px 0 rgba(224,65,122,.30)",
  cursor: "pointer",
};

/* ── 封面那一行 ── */

/** 那一行本身：左边缩样、中间两行字、右边「制作封面」，整行一处可点。 */
const coverRowStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid rgba(255,253,248,.14)",
  borderRadius: 14,
  background: "rgba(255,253,248,.05)",
  fontFamily: SANS,
  color: "#FFFDF8",
  cursor: "pointer",
  boxSizing: "border-box",
};

/** 缩样：跟聊天里那张卡同一张脸的小一号，红包封面长什么样一眼看得出。 */
const coverThumbStyle: CSSProperties = {
  position: "relative",
  flex: "none",
  width: 56,
  height: 38,
  borderRadius: 8,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

/** 缩样上那枚圆底礼盒（跟聊天卡、开红包页同一枚，只是缩到合手的大小）。 */
const coverThumbBadgeStyle: CSSProperties = {
  position: "relative",
  width: 20,
  height: 20,
  borderRadius: "50%",
  background: RED_COVER_TONE.chipBg,
  border: `1px solid ${RED_COVER_TONE.chipBorder}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** 右边那枚提示（「制作封面 ›」）——这一行是入口，用主色说清它能点。 */
const coverEntryHintStyle: CSSProperties = {
  flex: "none",
  display: "flex",
  alignItems: "center",
  gap: 3,
  fontSize: 12,
  color: T.pink,
  letterSpacing: ".04em",
};

/* ── 「我的封面」画廊 ── */

/** 一格一格的封面：三格一行，格子按封面那块地的比例（跟红包卡上封面那块一样）。 */
const coverGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
};

const coverTileStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "250 / 236",
  borderRadius: 12,
  border: "1px solid rgba(255,253,248,.16)",
  overflow: "hidden",
  padding: 0,
  boxSizing: "border-box",
  background: "#FFFFFF",
  cursor: "pointer",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
};

/** 眼下正在用的那张：贴着格子内圈描一道粉，别撑动排版。 */
const coverTileOnStyle: CSSProperties = {
  boxShadow: `inset 0 0 0 2px ${T.pink}`,
};

/** 「正在用」那枚小签，压在选中那格的下沿。 */
const coverTileChipStyle: CSSProperties = {
  marginBottom: 7,
  padding: "2px 7px",
  borderRadius: 999,
  background: "rgba(255,255,255,.9)",
  color: T.pink,
  fontSize: 10,
  letterSpacing: ".06em",
};

/** 那一格右上角的小「×」：只长在库里那些上（正在用的那张不给删）。 */
const coverTileCloseStyle: CSSProperties = {
  position: "absolute",
  top: 5,
  right: 5,
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "rgba(255,255,255,.92)",
  color: T.ink2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 3px rgba(20,19,24,.12)",
};

/** 末尾那格「新建」：虚线圈一块空地，一枚「＋」说清这儿能添一张（墨纸上的浅描边）。 */
const newTileStyle: CSSProperties = {
  ...coverTileStyle,
  border: "1px dashed rgba(255,253,248,.28)",
  background: "transparent",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  color: "rgba(255,253,248,.50)",
};

const newTileTextStyle: CSSProperties = {
  fontSize: 11.5,
  letterSpacing: ".08em",
};

/* ── 封面那几页（画廊／大预览／调整位置）── */

/* ── 封面那几页的壳：跟发红包那一页（同一条流程）同一族的墨底弹窗——遮罩＋贴屏底
   的墨纸（#1B161B＋极淡网点＋顶上柔光）、顶上两角圆、一根抓手、页头标题在左「×」在右、
   页脚一枚粉色胶囊主按钮。只是叠在更高一层（盖在发红包那张纸上）。
   「调整位置」页的第④块要通栏贴到纸边，所以滚动区本体不留左右边（各页自己包 20px）。 ── */

const coverSheetLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 140,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  overflow: "hidden",
};

/** 跟发红包那页同一张墨纸（sheetStyle 的底样），只是不带左右内边距——滚动区要通栏。 */
const coverSheetPaperStyle: CSSProperties = {
  position: "relative",
  maxHeight: "92%",
  display: "flex",
  flexDirection: "column",
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  padding: "0 0 calc(var(--safe-area-bottom, 0px) + 12px)",
  boxShadow: "0 -18px 44px rgba(0,0,0,.5)",
  backgroundColor: "#1B161B",
  backgroundImage:
    "radial-gradient(circle, rgba(255,253,248,.05) 1px, transparent 1.2px), " +
    "radial-gradient(130% 90% at 50% 0%, rgba(255,253,248,.07) 0%, transparent 62%)",
  backgroundSize: "10px 10px, 100% 100%",
  backgroundPosition: "50% 50%, 0 0",
  fontFamily: SANS,
  color: "#FFFDF8",
};

/** 滚动区。【`overflowX: "hidden"` 别删】只写 overflowY 时另一轴按 CSS 的规定**算成 auto**——
    「调整位置」那页的通栏块比正文宽，横轴一松 iOS 上整页就跟着左右晃。 */
const coverScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  overscrollBehavior: "none",
};

/** 封面那几页共用的墨底弹窗骨架：遮罩＋墨纸（抓手＋页头），正文塞滚动区、
 *  主按钮钉在页脚（跟发红包那页一个摆法）；`overlay` 是要铺满整屏的那层（大预览的「预览」）。 */
function CoverSheet({
  title,
  onClose,
  children,
  footer,
  overlay,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div style={coverSheetLayerStyle}>
      <div style={scrimStyle} />
      <div style={coverSheetPaperStyle}>
        <div style={gripStyle} />
        {/* 页头的留白得一项一项写：用 padding 简写会把 headerStyle 自带的
            paddingTop 冲掉，整行就贴死在抓手底下、又贴死在正文头上（× 没了喘气的地方）。 */}
        <div
          style={{
            ...headerStyle,
            paddingLeft: 20,
            paddingRight: 20,
            paddingBottom: 12,
          }}
        >
          <span style={headerTitleStyle}>{title}</span>
          <button type="button" aria-label="关闭" onClick={onClose} style={closeBtnStyle}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        {children}
        {footer ? (
          <div style={{ ...footerStyle, paddingLeft: 20, paddingRight: 20 }}>{footer}</div>
        ) : null}
      </div>
      {overlay}
    </div>
  );
}

/** 每一格预览的底：墨纸上一只浅描边的暗槽，托着封面卡当主角。 */
const studioPanelStyle: CSSProperties = {
  border: "1px solid rgba(255,253,248,.13)",
  borderRadius: 16,
  background: "rgba(255,253,248,.05)",
  padding: "18px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** 次要的文字钮（「恢复默认封面」／「预览」／「各处回到正中」）：主按钮底下居中一句小字。 */
const studioResetBtnStyle: CSSProperties = {
  width: "100%",
  padding: "11px 0",
  border: "none",
  background: "transparent",
  fontFamily: SANS,
  fontSize: 12.5,
  color: "rgba(255,253,248,.45)",
  letterSpacing: ".06em",
  textAlign: "center",
  cursor: "pointer",
};

/* ── 封面那几页的小零件 ── */

/** 大预览底下那行小字（说清照片会被裁到哪儿）——墨纸上的浅字。 */
const studioHintStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 11.5,
  color: "rgba(255,253,248,.45)",
  letterSpacing: ".04em",
  textAlign: "center",
};

/** 那一行入口（更换封面照片｜添加挂件｜更多内容）：竖线隔开，字用主粉（墨底上读得清）。 */
const studioEntryRowStyle: CSSProperties = {
  marginTop: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 13,
};

const studioEntryBtnStyle: CSSProperties = {
  position: "relative",
  padding: "4px 2px",
  border: "none",
  background: "none",
  fontFamily: SANS,
  fontSize: 13.5,
  color: T.pink,
  letterSpacing: ".04em",
  cursor: "pointer",
};

/** 「添加挂件」角上那枚小红点：先当个记号，别让她以为没东西可点。 */
const studioEntryDotStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  right: -5,
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: T.danger,
};

const studioEntryBarStyle: CSSProperties = {
  width: 1,
  height: 13,
  flex: "none",
  background: "rgba(255,253,248,.22)",
};

/** 「更多内容」子页里每一块的标题（以及右边那枚「更换」）。 */
const studioBlockHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const studioBlockTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "rgba(255,253,248,.92)",
  letterSpacing: ".02em",
};

/** 块与块之间那条淡线（跟微信那页一样，横着拉通）——墨纸上的浅痕。 */
const studioDividerStyle: CSSProperties = {
  height: 1,
  margin: "26px 0 0",
  background: "rgba(255,253,248,.12)",
};

/** 「预览」按下去铺满一屏看那张卡（点哪儿都收）。 */
const studioPeekStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 146,
  background: "radial-gradient(120% 92% at 50% 34%, rgba(78,44,38,.72), rgba(22,17,16,.86))",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "zoom-out",
};

/** 封面的大预览页：从画廊点进来，看这一整张封面的正脸（跟开红包那一页同一张脸，
 *  只是那枚「開」点不动），下面一行入口「更换封面照片 / 调整位置 / 添加挂件 / 更多内容」，
 *  底部「完成」收页、底下一枚小字「预览」（按下去铺满一屏看）。
 *  「更多内容」是子页：看这张封面在聊天气泡里、以及开完之后那张纸上的样子。
 *  这一页的封面一律只读，动得了它的只有换一张图 / 挪位置 / 恢复默认封面。
 *  （预览里的名字都写「你」／「我发出的红包」——这一页是看长相用的，不接真消息。） */
function RedCoverStudio({
  cover,
  busy,
  onPickFile,
  onAdjust,
  onReset,
  onBack,
  onClose,
  showToast,
}: {
  /** 眼下这张封面（预设 id 或带取景后缀的引用串）。 */
  cover: string;
  /** 正在把图压进媒体仓库——这期间别让她连点。 */
  busy: boolean;
  onPickFile: () => void;
  /** 进「调整位置」页挪这张照片。 */
  onAdjust: () => void;
  onReset: () => void;
  /** 退回「我的封面」画廊（页头那枚「×」）。 */
  onBack: () => void;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  /** 「更多内容」子页开没开。 */
  const [moreOpen, setMoreOpen] = useState(false);
  /** 「预览」铺满一屏那张开没开。 */
  const [peekOpen, setPeekOpen] = useState(false);
  const customSrc = useMediaSrc(redCoverSrcRefOf(cover));
  /* 这一页摆的是开红包那一张脸（还没开的封套／开完那张纸），所以照**开红包这一档**的取景铺；
     「更多内容」里那个聊天气泡照**卡面这一档**——各处挪在哪儿由她分开定，预览得跟真的一样。 */
  const coverBgOpen = redCoverBgOf(customSrc, redCoverPosOf(cover, "open"), RED_COVER_DEFAULT.bg);
  const coverBgCard = redCoverBgOf(customSrc, redCoverPosOf(cover, "card"), RED_COVER_DEFAULT.bg);

  if (moreOpen) {
    return (
      <CoverSheet
        title="更多内容"
        onClose={() => setMoreOpen(false)}
        footer={
          <button type="button" onClick={() => setMoreOpen(false)} style={submitBtnStyle}>
            确定
          </button>
        }
      >
        <div style={coverScrollStyle}>
          <div style={{ padding: "4px 20px 22px" }}>
            {/* ① 这张封面在聊天气泡里的样子 */}
            <div style={studioBlockTitleStyle}>消息气泡里的样子</div>
            <div style={{ ...studioHintStyle, marginTop: 8, textAlign: "left" }}>
              封面照片会自动裁成气泡里那个横向的区域
            </div>
            <div style={{ ...studioPanelStyle, marginTop: 14 }}>
              <StudioCard coverBg={coverBgCard} customSrc={customSrc} done={false} />
            </div>

            <div style={studioDividerStyle} />

            {/* ② 开完之后那张纸上的样子 */}
            <div style={{ ...studioBlockHeadStyle, marginTop: 20 }}>
              <span style={studioBlockTitleStyle}>更换红包打开后的样式</span>
              <button
                type="button"
                disabled={busy}
                onClick={onPickFile}
                style={{ ...studioEntryBtnStyle, opacity: busy ? 0.6 : 1 }}
              >
                更换
              </button>
            </div>
            <div style={{ ...studioPanelStyle, marginTop: 14 }}>
              <RedOpenedCard
                coverBg={coverBgOpen}
                customSrc={customSrc}
                amount="8.88"
                statusLine="已存入我的零钱"
                footLine="刚刚 · 你 的红包"
              />
            </div>
          </div>
        </div>
      </CoverSheet>
    );
  }

  return (
    <CoverSheet
      title="制作我的红包封面"
      onClose={onBack}
      footer={
        <>
          <button type="button" onClick={onClose} style={submitBtnStyle}>
            完成
          </button>
          <button
            type="button"
            onClick={() => setPeekOpen(true)}
            style={{ ...studioResetBtnStyle, marginTop: 4 }}
          >
            预览
          </button>
        </>
      }
      overlay={
        /* 预览那张全屏蒙层：贴在纸外面（铺满整屏） */
        peekOpen ? (
          <div onClick={() => setPeekOpen(false)} style={studioPeekStyle} aria-hidden>
            <RedEnvelopeCard
              coverBg={coverBgOpen}
              customSrc={customSrc}
              senderLine="我发出的红包"
              note="恭喜发财，大吉大利"
            />
          </div>
        ) : null
      }
    >
      <div style={coverScrollStyle}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "4px 20px 22px",
          }}
        >
          {/* 这张封面的正脸（跟聊天里点开红包那一页同一张，那枚「開」在这儿点不动） */}
          <div style={{ marginTop: 6 }}>
            <RedEnvelopeCard
              coverBg={coverBgOpen}
              customSrc={customSrc}
              senderLine="我发出的红包"
              note="恭喜发财，大吉大利"
            />
          </div>
          <div style={studioHintStyle}>封面照片会自动裁成这张卡上的区域</div>

          {/* 那一行入口：换照片 / 挪位置（自定义图才有）/ 挂件 / 更多内容 */}
          <div style={studioEntryRowStyle}>
            <button
              type="button"
              disabled={busy}
              onClick={onPickFile}
              style={{ ...studioEntryBtnStyle, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "正在存入…" : customSrc ? "更换封面照片" : "从相册挑一张"}
            </button>
            {customSrc ? (
              <>
                <span style={studioEntryBarStyle} />
                <button type="button" onClick={onAdjust} style={studioEntryBtnStyle}>
                  调整位置
                </button>
              </>
            ) : null}
            <span style={studioEntryBarStyle} />
            <button
              type="button"
              onClick={() => showToast("挂件之后再做，先在这儿留个位置")}
              style={studioEntryBtnStyle}
            >
              添加挂件
              <span style={studioEntryDotStyle} />
            </button>
            <span style={studioEntryBarStyle} />
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              style={studioEntryBtnStyle}
            >
              更多内容
            </button>
          </div>

          {customSrc ? (
            <button type="button" onClick={onReset} style={studioResetBtnStyle}>
              恢复默认封面
            </button>
          ) : null}
        </div>
      </div>
    </CoverSheet>
  );
}

/** 「我的封面」：最前是那张默认的，后面是她自己弄过的（发过的、做过的都收在库里的），
 *  末尾一格「新建」。点任意一格＝用它并进大预览；「新建」＝挑一张照片，挑完进「调整位置」。 */
function RedCoverGallery({
  cover,
  busy,
  onPick,
  onNew,
  onClose,
}: {
  /** 眼下选中的那张。 */
  cover: string;
  /** 正在把新挑的图压进媒体仓库。 */
  busy: boolean;
  onPick: (v: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  /** 库里的封面（新→旧）。这一页每次打开都重挂，所以进来读一次就够。 */
  const [mine, setMine] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void getRedCoverLibrary().then((list) => {
      if (alive) setMine(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 删掉库里的一张：先从这一页抹掉（她点了就得立刻没），落库在背后跟上。 */
  const drop = (v: string) => {
    setMine((list) => list.filter((c) => c !== v));
    void removeRedCoverFromLibrary(v).catch(() => {});
  };

  return (
    <CoverSheet
      title="我的封面"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} style={submitBtnStyle}>
          完成
        </button>
      }
    >
      <div style={coverScrollStyle}>
        <div style={{ padding: "4px 20px 20px" }}>
          <div style={coverGridStyle}>
            <CoverTile
              value={RED_COVER_DEFAULT.id}
              selected={!isCustomRedCover(cover)}
              onPick={onPick}
            />
            {mine.map((v) => (
              <CoverTile
                key={v}
                value={v}
                selected={v === cover}
                /* 正在用的那张不给删：删了它，眼下这份「正在用」就没地方挂了 */
                onRemove={v === cover ? undefined : () => drop(v)}
                onPick={onPick}
              />
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={onNew}
              style={{ ...newTileStyle, opacity: busy ? 0.6 : 1 }}
            >
              <Plus size={20} strokeWidth={2} />
              <span style={newTileTextStyle}>{busy ? "正在存入…" : "新建"}</span>
            </button>
          </div>
          <div style={studioHintStyle}>
            点一张就用它，点进去还能换照片、挪位置；「新建」是从相册里挑一张新的
          </div>
        </div>
      </div>
    </CoverSheet>
  );
}

/** 画廊里的一格：按这张封面**开红包那一档**的取景位置铺（这格的框就是 250／236 那个比例）。 */
function CoverTile({
  value,
  selected,
  onRemove,
  onPick,
}: {
  value: string;
  selected: boolean;
  /** 有这一条才长那枚小「×」；眼下正在用的那张不传（删了它就没得用了）。 */
  onRemove?: () => void;
  onPick: (v: string) => void;
}) {
  const src = useMediaSrc(redCoverSrcRefOf(value));
  const bg = redCoverBgOf(src, redCoverPosOf(value, "open"), RED_COVER_DEFAULT.bg);

  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      style={{ ...coverTileStyle, background: bg, ...(selected ? coverTileOnStyle : null) }}
    >
      {/* 预设那张的柔光（照片不压——照片自己就有光影） */}
      {src ? null : (
        <span
          style={{ position: "absolute", inset: 0, background: RED_COVER_TONE.glow }}
        />
      )}
      {selected ? <span style={coverTileChipStyle}>正在用</span> : null}
      {onRemove ? (
        <span
          role="button"
          aria-label="删掉这张封面"
          onClick={(e) => {
            /* 别让这一下顺手把这张也选中了 */
            e.stopPropagation();
            onRemove();
          }}
          style={coverTileCloseStyle}
        >
          <X size={12} strokeWidth={2.4} />
        </span>
      ) : null}
    </button>
  );
}

/** 「调整位置」页里各块预览的标签（红包卡面／开红包前／开红包后／详情页）。
 *  标签贴左边（滚动区本体没留边，左起 20px）；块本身在居中的那一栏里。 */
const framerLabelStyle: CSSProperties = {
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 600,
  color: "rgba(255,253,248,.60)",
  letterSpacing: ".08em",
  alignSelf: "flex-start",
  paddingLeft: 20,
};

/** 各块预览共用的手感：拖得动，拖的时候不带着页面一起滚。
 *  【`flexShrink: 0` 别删】那一栏是竖排 flex，内容比容器高时默认会把各块**压扁**——
 *  红包卡面自带 `overflow:hidden`、详情页那块是空框，两者的自动最小高都算 0，
 *  会被压成一条线，整块看不见（看着就像这页只有两块）。撑住各自写死的高度，让它们溢出、去滚。 */
const framerGrabStyle: CSSProperties = {
  touchAction: "none",
  cursor: "grab",
  userSelect: "none",
  flexShrink: 0,
};

/** 调整位置页里那几块预览的**照片区**尺寸（跟 `RedPacketCards.tsx` 的卡宽与 `CUT_Y`、
 *  跟 ChatWindow 里那张 228×76 小卡、跟详情页那条通栏封面一致）：拖动得按照片那一块算——
 *  封套底下还有带与纸、小卡上还压着字，把整块算进去，手指和照片就对不上了。 */
const FRAMER_CARD_W = 250;
const FRAMER_CUT_H = 236;
const FRAMER_DETAIL_H = 280;
const FRAMER_CHAT_W = 228;
const FRAMER_CHAT_H = 76;

/** 「调整位置」：这一页把这张封面**各处**的样子摊开摆——聊天里那张红包卡、开红包那一页
 *  （还没开那一张封套、开完之后那张纸）、领取详情页顶上那条通栏封面。**各挪各的**：
 *  按住哪一块拖就只动哪一块。开红包的前与后是同一档（同一块封面、同一条弧），
 *  拖哪一块两块一起动；其余各处互不相干。挪好按「确定」，这几处的位置就跟着这张封面走。
 *  （拖的是**照片**：手指往右，照片跟着往右、露出它左边那一片。不是拖格子换顺序。） */
function RedCoverFramer({
  refStr,
  initial,
  onCancel,
  onDone,
}: {
  /** 正在挪的那张图（媒体仓库引用串）。 */
  refStr: string;
  /** 进来时各处各挪在哪儿。 */
  initial: RedCoverPosMap;
  onCancel: () => void;
  onDone: (map: RedCoverPosMap) => void;
}) {
  const src = useMediaSrc(refStr);
  const [map, setMap] = useState<RedCoverPosMap>(initial);
  /** 这一处照它自己那份位置铺。 */
  const bgOf = (scene: RedCoverScene) =>
    redCoverBgOf(src, map[scene] ?? RED_COVER_POS_CENTER, RED_COVER_DEFAULT.bg);
  /** 照片本来的大小：拖动时靠它算「手指挪一像素＝位置动百分之几」。
   *  不算这个就只能凭猜——照片会比手指跑得快或慢，手感是飘的。
   *  连同「这是哪张图的尺寸」一起记：换了图，上一张的尺寸自动作废。 */
  const [natSize, setNatSize] = useState<{ src: string; w: number; h: number } | null>(null);
  const nat = natSize && natSize.src === src ? natSize : null;
  const dragRef = useRef<{
    id: number;
    scene: RedCoverScene;
    x: number;
    y: number;
    pos: RedCoverPos;
    box: { width: number; height: number };
  } | null>(null);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setNatSize({ src, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setNatSize(null);
    img.src = src;
  }, [src]);

  /** 按住某一处：那一块是哪一档写在元素的 `data-scene` 上，从这儿认。
   *  记下那一档此刻在哪儿，以及**照片那块**的宽高（量的是手指按的那一块，
   *  所以每块元素的尺寸都得是照片区，不是整张卡）。 */
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const scene = e.currentTarget.dataset.scene;
    if (scene !== "card" && scene !== "open" && scene !== "detail") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id: e.pointerId,
      scene,
      x: e.clientX,
      y: e.clientY,
      pos: map[scene] ?? RED_COVER_POS_CENTER,
      box: { width: box.width, height: box.height },
    };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || !nat) return;
    const over = coverOverflow(d.box, nat);
    const next = clampRedCoverPos({
      /* 手指往右＝把照片往右挪＝露出它左边那一片，所以位置反而往小里走。
         位置从头算（不是一帧一帧累加），取整就不会一点点把行程吃掉。 */
      x: over.x > 0 ? d.pos.x - ((e.clientX - d.x) * 100) / over.x : d.pos.x,
      y: over.y > 0 ? d.pos.y - ((e.clientY - d.y) * 100) / over.y : d.pos.y,
    });
    setMap((m) => ({ ...m, [d.scene]: next }));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  return (
    <CoverSheet
      title="调整位置"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={() => onDone(map)} style={submitBtnStyle}>
            确定
          </button>
          <button
            type="button"
            onClick={() => setMap({})}
            style={{ ...studioResetBtnStyle, marginTop: 4 }}
          >
            各处回到正中
          </button>
        </>
      }
    >
      <div
        style={{
          ...coverScrollStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 0 22px",
        }}
      >
        <div style={{ ...studioHintStyle, marginTop: 4, padding: "0 20px" }}>
          一共四处，往下滑能看全；开红包前、后是同一张，那两块会一起挪
        </div>

        {/* ① 聊天里那张红包卡（228×76 横向小卡）：照片铺满整张卡，礼盒与那两行字压在照片上不动 */}
        <div style={{ ...framerLabelStyle, marginTop: 18 }}>① 聊天里的红包卡</div>
        <div
          data-scene="card"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{
            ...framerGrabStyle,
            position: "relative",
            marginTop: 8,
            width: FRAMER_CHAT_W,
            height: FRAMER_CHAT_H,
            boxSizing: "border-box",
            borderRadius: 11,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            background: bgOf("card"),
            boxShadow: RED_COVER_TONE.shadow,
          }}
        >
          <span
            style={{
              position: "relative",
              flex: "none",
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: RED_COVER_TONE.chipBg,
              border: `1px solid ${RED_COVER_TONE.chipBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Gift size={20} strokeWidth={1.6} color={RED_COVER_TONE.chipInk} />
          </span>
          <span
            style={{
              position: "relative",
              marginLeft: 12,
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span
              style={{
                fontFamily: KAI,
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1.35,
                color: RED_COVER_TONE.ink,
                letterSpacing: ".03em",
                textShadow: "0 1px 0 rgba(255,255,255,.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              恭喜发财
            </span>
            <span
              style={{
                marginTop: 3,
                fontFamily: KAI,
                fontSize: 11,
                lineHeight: 1.3,
                color: RED_COVER_TONE.inkSoft,
                letterSpacing: ".06em",
              }}
            >
              星绥红包
            </span>
          </span>
        </div>

        {/* ② 开红包前那一张封套。抓的那一层只盖住**照片区**：卡底下还有带与纸，
            连整张卡一起算进去，手指和照片就对不上了。 */}
        <div style={{ ...framerLabelStyle, marginTop: 26 }}>② 开红包前</div>
        <div style={{ position: "relative", marginTop: 8 }}>
          <RedEnvelopeCard
            coverBg={bgOf("open")}
            customSrc={src}
            senderLine="我发出的红包"
            note="恭喜发财，大吉大利"
          />
          <div
            data-scene="open"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{
              ...framerGrabStyle,
              position: "absolute",
              left: 0,
              top: 0,
              width: FRAMER_CARD_W,
              height: FRAMER_CUT_H,
            }}
          />
        </div>

        {/* ③ 开完之后那一屏（同一块封面接着白纸上的金额）：跟 ② 是同一档，拖哪一块两块一起动 */}
        <div style={{ ...framerLabelStyle, marginTop: 26 }}>③ 开红包后</div>
        <div style={{ position: "relative", marginTop: 8, paddingBottom: 4 }}>
          <RedOpenedCard
            coverBg={bgOf("open")}
            customSrc={src}
            amount="8.88"
            statusLine="已存入我的零钱"
            footLine="刚刚 · 你 的红包"
          />
          <div
            data-scene="open"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{
              ...framerGrabStyle,
              position: "absolute",
              left: 0,
              top: 0,
              width: FRAMER_CARD_W,
              height: FRAMER_CUT_H,
            }}
          />
        </div>

        {/* ④ 领取详情页顶上那条通栏封面：真身是**整屏宽**。这一页的滚动区没留左右边，
            所以它直接 100% 就是纸的整宽——框的比例跟真的详情页一样，取景才对得上。 */}
        <div style={{ ...framerLabelStyle, marginTop: 26 }}>④ 领取详情页</div>
        <div
          data-scene="detail"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{
            ...framerGrabStyle,
            marginTop: 8,
            width: "100%",
            height: FRAMER_DETAIL_H,
            background: bgOf("detail"),
            boxShadow: "0 12px 28px -20px rgba(0,0,0,.6)",
          }}
        />
      </div>
    </CoverSheet>
  );
}

/** 照片按 `cover` 铺进这个框时，横、竖各溢出多少像素——溢出为 0 的那个方向拖不动。
 *  比例没量出来（图还没加载完）就回 0／0，一下都不动，免得先跳一下。 */
function coverOverflow(
  box: { width: number; height: number },
  nat: { w: number; h: number },
) {
  if (!box.width || !box.height || !nat.w || !nat.h) return { x: 0, y: 0 };
  const ratio = nat.w / nat.h;
  const drawnW = Math.max(box.width, box.height * ratio);
  const drawnH = drawnW / ratio;
  return { x: drawnW - box.width, y: drawnH - box.height };
}

/** 封面那一层里那张聊天卡：跟聊天里 `RedPacketCard` 同一张脸（留言写死一句吉祥话、
 *  第二行平时报「星绥红包」、领完换成状态字）——这一页只看长相，不接真消息。 */
function StudioCard({
  coverBg,
  customSrc,
  done,
}: {
  coverBg: string;
  customSrc?: string;
  done: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: 228,
        height: 76,
        borderRadius: 11,
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        background: coverBg,
        boxShadow: done
          ? "0 6px 18px -12px rgba(20,19,24,.26)"
          : RED_COVER_TONE.shadow,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: RED_COVER_CLAIMED_VEIL,
          opacity: done ? (customSrc ? 0.72 : 1) : 0,
        }}
      />
      {!customSrc ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: RED_COVER_TONE.glow,
            opacity: done ? 0 : 1,
          }}
        />
      ) : null}
      <span
        style={{
          position: "relative",
          flex: "none",
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: done ? "rgba(215,71,48,.1)" : RED_COVER_TONE.chipBg,
          border: `1px solid ${done ? "rgba(215,71,48,.16)" : RED_COVER_TONE.chipBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Gift
          size={20}
          strokeWidth={1.6}
          style={{ color: done ? "#D74730" : RED_COVER_TONE.chipInk }}
        />
      </span>
      <span
        style={{
          position: "relative",
          marginLeft: 12,
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span
          style={{
            fontFamily: KAI,
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.35,
            color: done ? T.ink : RED_COVER_TONE.ink,
            letterSpacing: ".03em",
            textShadow: done ? "none" : "0 1px 0 rgba(255,255,255,.55)",
          }}
        >
          恭喜发财
        </span>
        <span
          style={{
            marginTop: 3,
            fontFamily: KAI,
            fontSize: 11,
            lineHeight: 1.3,
            color: done ? T.ink3 : RED_COVER_TONE.inkSoft,
            letterSpacing: ".06em",
          }}
        >
          {done ? "已领取" : "星绥红包"}
        </span>
      </span>
    </div>
  );
}
