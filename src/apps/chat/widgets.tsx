"use client";

import { ChevronRight } from "lucide-react";
import { EN, T } from "./shared";

/** 胶囊开关（旧档案同款手感；2026-09-21 恩熙「开关的颜色没有改变」——配色已换新板）。 */
export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 46,
        height: 27,
        borderRadius: 14,
        /* 恩熙 2026-09-21：「按钮开关的颜色没有改变啊，开了之后、关了之后……还是一样的」
           —— 这颗开关一直停在旧纸板的 C.rose（陈旧玫瑰灰）和旧灰底上，新板页面里开/关
           都像没配过色。换到新板：开＝主粉、关＝新墨的浅灰，粉只跳这一下 */
        background: on ? T.pink : "rgba(20,19,24,.14)",
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
          boxShadow: "0 2px 5px rgba(20,19,24,.2)",
          transition: "left .2s",
        }}
      />
    </div>
  );
}

/** 章节头：卡**内**的标题栏——左侧一枚编号方块（01／02／03），中间中文标题，
 *  右侧极小英文索引，底下一条极淡横线把「章节名」和「章节内容」分开。
 *  恩熙 2026-09-21 第四调（「这样很没有设计感，就是很普通的页面」）：原来是卡**外**一行
 *  「小英文＋中文」，三张卡排下来就是三个白盒子，翻版聊天设置页。现在每个卡头带自己的编号，
 *  整页像一本册子翻到三个章节；`on` 为真时编号方块亮粉，兼当「这块已经配过」的状态灯。 */
export function GroupTitle({
  title,
  en,
  num,
  on = false,
}: {
  title: string;
  en: string;
  /** 章节号（01／02／03）；不传就退回旧的一行式标题。 */
  num?: string;
  /** 这一章节是否已配置：编号方块亮粉。 */
  on?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 14px 11px",
        borderBottom: `1px solid ${T.lineSoft}`,
      }}
    >
      {num ? (
        <span
          style={{
            flex: "none",
            width: 24,
            height: 24,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: EN,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".02em",
            background: on ? "rgba(232,106,155,.12)" : "rgba(20,19,24,.05)",
            color: on ? T.pink : T.ink3,
            transition: "background .18s, color .18s",
          }}
        >
          {num}
        </span>
      ) : null}
      <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: ".01em", color: T.ink }}>
        {title}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: EN,
          fontSize: 8.5,
          letterSpacing: ".2em",
          color: T.ink3,
          textTransform: "uppercase",
        }}
      >
        {en}
      </span>
    </div>
  );
}

/** 设置行（标题＋描述＋值／箭头／右侧自定义）。
 *  恩熙 2026-09-21 换板：改成**一行一枚 999 圆胶囊**，跟个人资料页的 `ProfileRow`
 *  同一套——旧版是「54 高、两侧各 14 内边距」的纸板行，一行行贴着卡片边，像表格；
 *  圆胶囊行才跟侧边栏菜单对得上眼。 */
export function SettingRow({
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
  right?: React.ReactNode;
  onClick?: () => void;
  showArrow?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 12px",
        borderRadius: 999,
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
              marginTop: 2,
              letterSpacing: ".04em",
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
                color: T.ink,
                letterSpacing: ".04em",
                flex: "none",
                whiteSpace: "nowrap",
              }}
            >
              {value}
            </div>
          ) : null}
          {(showArrow ?? true) && onClick ? (
            <ChevronRight size={15} strokeWidth={2.2} color={danger ? T.danger : T.ink3} />
          ) : null}
        </>
      )}
    </div>
  );
}
