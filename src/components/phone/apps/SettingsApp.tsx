"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Clock, Cloud, Database, HardDrive, KeyRound, Smartphone } from "lucide-react";
import { AppChrome } from "@/components/phone/apps/AppChrome";
import {
  API_CATEGORY_META,
  ApiCategoryForm,
  ApiSettingsPanel,
} from "@/components/phone/apps/ApiSettingsPanel";
import { StorageCheckPanel } from "@/components/phone/apps/StorageCheckPanel";
import {
  POP_CARD,
  POP_INK,
  POP_TONE,
  type PopTone,
} from "@/components/phone/apps/pop-style";
import {
  DEFAULT_CHAT_PREFS,
  getChatPrefs,
  saveChatPrefs,
  type ChatPrefs,
} from "@/lib/settings/chat";
import type { ApiCategory } from "@/types/chat";

/* =======================================================================
 * 设置 App（撞色贴纸风）
 * 白卡 ＋ 黑描边 ＋ 硬阴影 ＋ 撞色图标座 ＋ 无衬线粗字；
 * 配色配方全部来自 pop-style.ts（与 API 设定、存储体检共用一套底料）。
 * ===================================================================== */

/** 一行的排版：行与行之间只隔一条虚线，边框由所属白卡给。 */
const ROW = "flex items-center gap-4 border-t-2 border-dashed border-[#EDEAE2] px-4 py-4 first:border-t-0";
/** 图标座：一枚撞色小方块（描边＋硬阴影，看着像贴上去的）。 */
const ICON_TILE =
  "flex h-11 w-11 flex-none items-center justify-center rounded-[14px] border-2 border-[#141414] shadow-[3px_3px_0_#141414]";
const ROW_TITLE = "text-[15px] font-bold text-[#141414]";
const ROW_SUB = "mt-1 text-[11px] font-medium text-[#8C8C8C]";

function IconTile({ tone, children }: { tone: PopTone; children: ReactNode }) {
  return (
    <div className={ICON_TILE} style={{ background: POP_TONE[tone], color: POP_INK }}>
      {children}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-[#141414]"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** 顶上一排歪歪的小色块（纯装饰）：八枚一路排过去，横着拉满一整条。 */
function StickerStrip() {
  const tones: PopTone[] = ["lemon", "pink", "blue", "red", "mint", "purple", "yellow", "orange"];
  /* 一圈歪角：相邻两句方向相反，看着才像手贴上去的。 */
  const tilt = [
    "-rotate-[7deg]",
    "rotate-[5deg]",
    "-rotate-[3deg]",
    "rotate-[8deg]",
    "-rotate-[5deg]",
    "rotate-[3deg]",
    "-rotate-[8deg]",
    "rotate-[6deg]",
  ];
  return (
    <div className="flex items-center gap-2 pb-5 pt-1" aria-hidden>
      {tones.map((tone, i) => (
        <span
          key={tone}
          className={`h-3 min-w-0 flex-1 rounded-full border-2 border-[#141414] shadow-[2px_2px_0_#141414] ${tilt[i]}`}
          style={{ background: POP_TONE[tone] }}
        />
      ))}
    </div>
  );
}

/** 设置分组：撞色小标签当标题，下面一张白卡装这一组。 */
function SettingGroup({
  title,
  tone,
  children,
}: {
  title: string;
  tone: PopTone;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <span
        className="mb-2 inline-block rounded-full border-2 border-[#141414] px-3 py-1 text-[11px] font-extrabold tracking-wide shadow-[2px_2px_0_#141414]"
        style={{ background: POP_TONE[tone], color: POP_INK }}
      >
        {title}
      </span>
      <div className={POP_CARD + " overflow-hidden"}>{children}</div>
    </section>
  );
}

/** 可点击的设置项：撞色图标座＋粗体标题＋小字副标题＋右箭头。 */
function SettingItem({
  icon,
  tone,
  title,
  subtitle,
  soon = false,
  onClick,
}: {
  icon: ReactNode;
  tone: PopTone;
  title: string;
  subtitle: string;
  /** 二期规划项：不可点，箭头位置换成「规划中」标签。 */
  soon?: boolean;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick) && !soon;
  return (
    <div
      className={`${ROW} ${clickable ? "cursor-pointer active:bg-[#FFF4DC]" : ""}`}
      onClick={soon ? undefined : onClick}
    >
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className={ROW_TITLE}>{title}</div>
        <div className={ROW_SUB}>{subtitle}</div>
      </div>
      {soon ? (
        <span className="flex-none rounded-full border-2 border-[#141414] bg-[#E9E7E1] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]">
          规划中
        </span>
      ) : onClick ? (
        <Chevron />
      ) : null}
    </div>
  );
}

/** 带开关的设置行（右端贴纸开关；点整行即切换）。 */
function ToggleItem({
  icon,
  tone,
  title,
  subtitle,
  on,
  onToggle,
}: {
  icon: ReactNode;
  tone: PopTone;
  title: string;
  subtitle: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div
      className={`${ROW} cursor-pointer active:bg-[#FFF4DC]`}
      onClick={() => onToggle(!on)}
      role="switch"
      aria-checked={on}
      aria-label={title}
    >
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className={ROW_TITLE}>{title}</div>
        <div className={ROW_SUB}>{subtitle}</div>
      </div>
      <span
        className={`relative h-7 w-[52px] flex-none rounded-full border-2 border-[#141414] ${
          on ? "bg-[#D9F24D]" : "bg-[#E9E7E1]"
        }`}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-[22px] w-[22px] rounded-full border-2 border-[#141414] bg-white transition-transform duration-200 ${
            on ? "translate-x-[22px]" : "translate-x-0"
          }`}
        />
      </span>
    </div>
  );
}

/** 纯信息行（无箭头无点击），用于展示系统状态。 */
function InfoItem({ icon, tone, title, value }: { icon: ReactNode; tone: PopTone; title: string; value: string }) {
  return (
    <div className={ROW}>
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className={ROW_TITLE}>{title}</div>
      </div>
      <span className="min-w-0 truncate rounded-full border-2 border-[#141414] bg-[#E9E7E1] px-2.5 py-1 text-[10px] font-extrabold text-[#141414]">
        {value}
      </span>
    </div>
  );
}

/**
 * 设置：API 设定（文本／图文／语音三类接口）＋存储体检＋系统信息。
 */
export function SettingsApp() {
  const [view, setView] = useState<"list" | "api" | "api-form" | "storage">("list");
  const [apiCat, setApiCat] = useState<ApiCategory>("text");
  /* 对话偏好：预设值先渲染，真值等客户端读完再补（IndexedDB 只在客户端碰）。 */
  const [prefs, setPrefs] = useState<ChatPrefs>(DEFAULT_CHAT_PREFS);
  useEffect(() => {
    void getChatPrefs().then(setPrefs);
  }, []);

  /* 先动界面再落库：写失败也只是下次进来回到旧值，不至于点不动。 */
  const toggleTimeAware = (next: boolean) => {
    setPrefs((p) => ({ ...p, timeAware: next }));
    void saveChatPrefs({ timeAware: next });
  };

  if (view === "storage") {
    return (
      <AppChrome
        title="存储体检"
        titleEn="STORAGE"
        theme="pop"
        onBack={() => setView("list")}
      >
        <StorageCheckPanel />
      </AppChrome>
    );
  }

  if (view === "api") {
    return (
      <AppChrome title="API 设定" titleEn="API SETTINGS" theme="pop" onBack={() => setView("list")}>
        <ApiSettingsPanel
          onOpenCategory={(cat) => {
            setApiCat(cat);
            setView("api-form");
          }}
        />
      </AppChrome>
    );
  }

  if (view === "api-form") {
    const meta = API_CATEGORY_META[apiCat];
    return (
      <AppChrome
        title={meta.title}
        titleEn={meta.titleEn}
        theme="pop"
        onBack={() => setView("api")}
      >
        <ApiCategoryForm category={apiCat} />
      </AppChrome>
    );
  }

  return (
    <AppChrome title="设置" titleEn="SETTINGS" theme="pop">
      <StickerStrip />

      {/* 接口 */}
      <SettingGroup title="Interface · 接口" tone="blue">
        <SettingItem
          icon={<KeyRound size={20} strokeWidth={2.2} />}
          tone="blue"
          title="API 设定"
          subtitle="Dialogue · 模型与密钥"
          onClick={() => setView("api")}
        />
      </SettingGroup>

      {/* 对话 */}
      <SettingGroup title="Dialogue · 对话" tone="orange">
        <ToggleItem
          icon={<Clock size={20} strokeWidth={2.2} />}
          tone="orange"
          title="时间感知"
          subtitle="Time · TA 知道此刻的真实时间"
          on={prefs.timeAware}
          onToggle={toggleTimeAware}
        />
      </SettingGroup>

      {/* 云端 */}
      <SettingGroup title="Cloud · 云端" tone="purple">
        <SettingItem
          icon={<Cloud size={20} strokeWidth={2.2} />}
          tone="purple"
          title="云端同步"
          subtitle="Sync · Supabase 推送与跨装置"
          soon
        />
      </SettingGroup>

      {/* 系统 */}
      <SettingGroup title="System · 系统" tone="mint">
        <SettingItem
          icon={<HardDrive size={20} strokeWidth={2.2} />}
          tone="pink"
          title="存储体检"
          subtitle="Storage · 占用明细与手机额度"
          onClick={() => setView("storage")}
        />
        <InfoItem
          icon={<Database size={20} strokeWidth={2.2} />}
          tone="yellow"
          title="本机数据库"
          value="IndexedDB · stellasei-new"
        />
        <InfoItem
          icon={<Smartphone size={20} strokeWidth={2.2} />}
          tone="mint"
          title="运行模式"
          value="PWA · 可加到主画面"
        />
      </SettingGroup>

      <div className="mt-8 text-center text-[10px] font-extrabold tracking-[0.3em] text-[#B0AEA8]">
        STELLASEI · 一期
      </div>
    </AppChrome>
  );
}
