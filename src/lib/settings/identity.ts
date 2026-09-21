/**
 * 「我的」资料（**已并进面具，这里只剩迁移用**）。
 *
 * 2026-09-21 恩熙：「这个签名是不是要在面具里面呢？……因为我可能对不同的角色有不同的
 * 签名呀，对不对？」——签名从此是面具自己的一个栏位（见 `mask.ts` 的 `Mask.signature`），
 * 侧边栏／名片卡／prompt 全走面具。这个存储只为把升级前那条全局签名**搬一次**而留：
 * `ChatApp` 载入时读它、填给「使用中」的面具，搬完即写回空串，此后不再读写。
 * 仅在客户端读写 IndexedDB。
 */

import { kvGet, kvSet } from "@/lib/db/idb";

const MY_KEY = "identity";

export interface MyIdentity {
  /** 个性签名；空字符串时用预设文案。 */
  signature: string;
}

export const DEFAULT_IDENTITY: MyIdentity = { signature: "" };

export async function getMyIdentity(): Promise<MyIdentity> {
  const saved = await kvGet<MyIdentity>(MY_KEY);
  // 兼容旧的 { name, signature } 资料：只取 signature。
  if (saved && typeof saved.signature === "string") {
    return { signature: saved.signature };
  }
  return { ...DEFAULT_IDENTITY };
}

export async function saveMyIdentity(identity: MyIdentity): Promise<void> {
  await kvSet(MY_KEY, identity);
}
