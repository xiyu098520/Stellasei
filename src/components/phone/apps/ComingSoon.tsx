"use client";

import type { RegisteredApp } from "@/apps/registry";
import { AppChrome } from "@/components/phone/apps/AppChrome";

/**
 * 一期尚未实现的 App 统一入口页。
 * 不做空页、不假装可用——老实说清它在路线图上的位置。
 */
export function ComingSoon({ app }: { app: RegisteredApp }) {
  return (
    <AppChrome title={app.name} titleEn={app.nameEn}>
      <div className="mt-10 flex flex-col items-center px-4 text-center">
        <span
          className="flex h-20 w-20 items-center justify-center rounded-[22px] text-white"
          style={{
            background: `linear-gradient(150deg, ${app.accent ?? "#8b86a8"} 0%, rgba(0,0,0,0.18) 140%), ${app.accent ?? "#8b86a8"}`,
          }}
        >
          <app.Icon width={40} height={40} strokeWidth={1.2} />
        </span>
        <p className="mt-6 font-serif text-[11px] tracking-[0.32em] text-[#b0a8cc] pl-[0.32em]">
          COMING SOON
        </p>
        <h3 className="mt-2 font-song text-[20px] tracking-[0.12em] text-[#3a3454]">
          「{app.tagline ?? app.name}」
        </h3>
        <p className="mt-3 max-w-[240px] text-[12.5px] leading-relaxed text-[#8d86a6]">
          他正在慢慢甦醒，这部分会在路线图的下个階段来到你面前。
        </p>
      </div>
    </AppChrome>
  );
}
