"use client";

import { getDockApps, type RegisteredApp } from "@/apps/registry";
import { usePhone } from "@/context/PhoneContext";

/**
 * 底部 Dock（参数对齐参考项目 ai-virtual-phone 的 .dock）：
 * - 定宽公式：count×66 + (count-1)×20 + 30 → 4 颗时 354px，不满宽、居中悬浮
 * - 高 92px、圆角 32px，图标 58px 垂直居中（上下各留 17px）
 * - 图标间距与主屏网格完全一致（66px 格位 + 20px gap）
 */

const SLOT = 66; // 与主屏网格同格位
const GAP_X = 20; // 与主屏网格同间距

const DOCK_ICON_COLOR = "#4a4366";
const DOCK_CARD_BG = "rgba(110, 98, 168, 0.08)";
const DOCK_CARD_BORDER = "rgba(110, 98, 168, 0.18)";

function DockButton({
  app,
  onOpen,
}: {
  app: RegisteredApp;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={app.name}
      onClick={onOpen}
      className="pressable relative flex h-[58px] w-[58px] items-center justify-center overflow-hidden rounded-[16px]"
      style={{
        background: DOCK_CARD_BG,
        boxShadow: `inset 0 0 0 1px ${DOCK_CARD_BORDER}, 0 1px 4px rgba(60, 45, 110, 0.03)`,
        color: DOCK_ICON_COLOR,
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
    </button>
  );
}

export function Dock() {
  const { openApp } = usePhone();
  const dockApps = getDockApps();
  const count = Math.max(1, dockApps.length);

  // 参考项目宽度公式：格位×数量 + 间距×(数量-1) + 30px 左右余量。
  const dockWidth = count * SLOT + (count - 1) * GAP_X + 30;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center"
      style={{ paddingBottom: "calc(var(--safe-area-bottom) + 10px)" }}
    >
      <div
        className="pointer-events-auto grid items-center rounded-[32px] border border-white/40 backdrop-blur-2xl"
        style={{
          width: `min(${dockWidth}px, calc(100% - 8px))`,
          minHeight: 92, // 图标 58px 上下各留约 17px
          background: "rgba(255, 255, 255, 0.35)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backdropFilter: "blur(24px) saturate(160%)",
          boxShadow:
            "0 8px 30px rgba(60, 45, 110, 0.10), inset 0 1px 0 rgba(255,255,255,0.55)",
          gridTemplateColumns: `repeat(${count}, ${SLOT}px)`,
          columnGap: GAP_X,
          justifyContent: "center",
        }}
      >
        {dockApps.map((app) => (
          <DockButton key={app.id} app={app} onOpen={() => openApp(app.id)} />
        ))}
      </div>
    </div>
  );
}
