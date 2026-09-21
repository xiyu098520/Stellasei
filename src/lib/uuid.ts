/**
 * 生成 UUID。
 *
 * 为什么不直接用 crypto.randomUUID：
 * 该 API 只在安全上下文（HTTPS／localhost）存在。手机联调走
 * http://192.168.x.x:3000 属非安全上下文，直接调用会抛
 * TypeError，曾导致档案 App 卡在「载入中」（空库首次建档时触发）。
 * 这里在不支持时退回 Math.random 拼装版本，局域网联调也能正常建档。
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
