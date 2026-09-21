"use client";

import type { RegisteredApp } from "@/apps/registry";
import { usePhone } from "@/context/PhoneContext";

/**
 * 标准网格（参数对齐参考项目 ai-virtual-phone 的 icon-grid）：
 * - 固定 4 栏 × 6 排；格位 66px 定宽，水平 gap 20px，垂直 gap 3px（紧凑）
 * - 图标本体 58×58 圆角 16px，名字标签在下方
 * - 行高 1fr 均分铺满；空格子传 null 占位（拖动排序预留）
 */

const GRID_COLS = 4;
const GRID_ROWS = 6;
const GRID_TOTAL = GRID_COLS * GRID_ROWS; // 24 格

const SLOT = 66; // 格位宽（参考项目 clamp 后在 iPhone 14 Pro Max 的值）
const GAP_X = 20; // 水平间距
const GAP_Y = 3; // 垂直行距（参考项目 --home-row-gap-y: 3px）

const GRID_ICON_COLOR = "#4a4366";
const GRID_CARD_BG = "rgba(110, 98, 168, 0.08)";
const GRID_CARD_BORDER = "rgba(110, 98, 168, 0.18)";

export function GridLayout({ apps }: { apps: readonly (RegisteredApp | null)[] }) {
  const { openApp } = usePhone();

  // 补满到固定网格大小（空著的格子只占位置，没有内容；apps 里也可传 null 占位）。
  const slots: (RegisteredApp | null)[] = [
    ...apps,
    ...Array(Math.max(0, GRID_TOTAL - apps.length)).fill(null),
  ];

  return (
    <div
      className="grid h-full w-full justify-center"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLS}, ${SLOT}px)`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`, // 行高均分，刚好铺满状态栏到 Dock
        columnGap: GAP_X,
        rowGap: GAP_Y,
      }}
    >
      {slots.map((app, index) => {
        if (!app) {
          // 空格子：只占位置，不显示任何東西。
          return <div key={`empty-${index}`} aria-hidden />;
        }
        return (
          <button
            key={app.id}
            type="button"
            onClick={() => openApp(app.id)}
            className="pressable flex w-full flex-col items-center justify-center gap-[5px] outline-none"
          >
            <span
              className="relative flex h-[58px] w-[58px] items-center justify-center overflow-hidden rounded-[16px]"
              style={{
                background: GRID_CARD_BG,
                boxShadow: `inset 0 0 0 1px ${GRID_CARD_BORDER}, 0 1px 4px rgba(60, 45, 110, 0.03)`,
                color: GRID_ICON_COLOR,
              }}
            >
              <span
                className="pointer-events-none absolute inset-0 rounded-[16px]"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 55%)",
                }}
                aria-hidden
              />
              <app.Icon size={26} strokeWidth={1.75} />
            </span>
            <span className="w-full truncate text-center text-[10px] font-medium leading-tight text-[#4a4366]/75">
              {app.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
