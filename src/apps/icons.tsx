/**
 * App 图标（使用 lucide-react，风格统一、品質稳定）。
 * 一期先统一用同一组 stroke 宽度与 size；杂志页精緻版之后再独立处理。
 */

import {
  MessageSquare,
  User,
  BookOpen,
  Archive,
  Eye,
  Palette,
  Settings,
  type LucideProps,
} from "lucide-react";

export type AppIconProps = LucideProps;

/** 星绥通讯：对话气泡。 */
export const ChatIcon = MessageSquare;

/** 档案：极简人像輪廓。 */
export const ContactsIcon = User;

/** 世界书：打开的书本（跟「书」对应）。 */
export const WorldBookIcon = BookOpen;

/** 记忆：长方形存档盒＋标签。 */
export const MemoryIcon = Archive;

/** 查手机：一只眼睛（看进 TA 的手机里）。 */
export const PeekIcon = Eye;

/** 美化：调色盘。 */
export const BeautifyIcon = Palette;

/** 设置：齒輪。 */
export const SettingsIcon = Settings;
