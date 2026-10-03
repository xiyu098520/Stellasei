"use client";

import { usePhone } from "@/context/PhoneContext";
import { BeautifyApp } from "@/components/phone/apps/BeautifyApp";
import { SettingsApp } from "@/components/phone/apps/SettingsApp";
import { ComingSoon } from "@/components/phone/apps/ComingSoon";
import { ContactsApp } from "@/apps/contacts/ContactsApp";
import WorldBookApp from "@/apps/worldbook/WorldBookApp";
import ChatApp from "@/apps/chat/ChatApp";
import MemoryApp from "@/apps/memory/MemoryApp";
import PeekApp from "@/apps/peek/PeekApp";

/**
 * 视窗管理：当前 App 以全屏覆盖层呈现（z 高於主屏幕、低於开屏）。
 * 之后做开合动画与多工切换时，改这一层即可，各 App 本身不感知。
 */
export function AppWindow() {
  const { currentApp } = usePhone();

  if (!currentApp) return null;

  let content;
  if (currentApp.id === "contacts") {
    content = <ContactsApp />;
  } else if (currentApp.id === "worldbook") {
    content = <WorldBookApp />;
  } else if (currentApp.id === "chat") {
    content = <ChatApp />;
  } else if (currentApp.id === "memory") {
    content = <MemoryApp />;
  } else if (currentApp.id === "peek") {
    content = <PeekApp />;
  } else if (currentApp.comingSoon) {
    content = <ComingSoon app={currentApp} />;
  } else if (currentApp.id === "beautify") {
    content = <BeautifyApp />;
  } else if (currentApp.id === "settings") {
    content = <SettingsApp />;
  } else {
    content = <ComingSoon app={currentApp} />;
  }

  return (
    <div className="absolute inset-0 z-40 animate-app-rise overflow-hidden">
      {content}
    </div>
  );
}
