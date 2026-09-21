/** 六码 hex 转 rgba（alpha 预设 1）。八码 hex 直接回传。 */
export function hexToRgba(hex: string, alpha = 1): string {
  if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
  const clean = hex.replace("#", "");
  if (clean.length === 8) return `#${clean}`;

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 同色系 135° 透气渐变（低透明，旧项目的輕盈手法）。 */
export function softGradient(hex: string): string {
  return `linear-gradient(135deg, ${hexToRgba(hex, 0.12)} 0%, ${hexToRgba(hex, 0.05)} 100%)`;
}

/** inset 细边框（0.18 透明度，旧项目卡片的边框强度）。 */
export function softInset(hex: string): string {
  return `inset 0 0 0 1px ${hexToRgba(hex, 0.18)}`;
}
