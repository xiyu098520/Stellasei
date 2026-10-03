/**
 * 星绥通讯：**我弄过的红包封面**。
 *
 * 发红包时自己换上的封面图，顺手在这儿留一条；下次做封面时先看到这一排，
 * 不用再从相册里翻同一张照片。这里只管**这份名单**，长什么样、怎么摆由
 * `MoneySendView` 的封面画廊决定。
 *
 * 【还有一格「眼下用的那张」】她选定一张之后，那就是**以后各处的默认**——
 * 换到哪个对话框、重开 App 都还是它，除非她再换。存在这儿（见 `DEFAULT_KEY`），
 * 因为它是「封面」这件事的一部分，而不是某一段对话的属性。
 *
 * 存的是**完整的封面值**（`media-store://mc_x#p=50,40` 这种，尾巴上带着取景位置），
 * 但认的是**照片本身**：同一张照片挪了位置，就把那一条就地换成新位置，不再多占一格。
 * （存的是完整值，所以画廊照它自己的取景铺出来，跟她上次挪好的一样。）
 * 预设封面（没照片的那几张、老的那些预设 id）不进来：这份名单只装她自己弄过的照片。
 * 图本身在媒体仓库里，这里只记引用串，所以这份名单一直很小。
 * 排序＝新→旧，画廊照这个顺序摆。
 */

import { kvGet, kvSet } from "@/lib/db/idb";
import { isCustomRedCover, redCoverRefOf } from "@/apps/chat/redpacket";

const COVERS_KEY = "red-covers";

/** 眼下用的那一张（**全局**：跟哪个对话框、哪一笔都无关）。
 *  单独一格存，不混进上面那份名单——名单是「挑得出来的」，这一格是「现在挂着的」，
 *  名单里那张被删掉时，这一格照样留着，她下次发红包还是它。 */
const DEFAULT_KEY = "red-cover-default";

/** 最多留这么多张：一屏扫得过来就够了，堆着翻不到反而没用。 */
const MAX_COVERS = 12;

export async function getRedCoverLibrary(): Promise<string[]> {
  return (await kvGet<string[]>(COVERS_KEY)) ?? [];
}

/** 眼下用的那张封面（预设 id 或自定义图的引用串）；从没换过＝空串，由调用处回落默认那张。 */
export async function getDefaultRedCover(): Promise<string> {
  return (await kvGet<string>(DEFAULT_KEY)) ?? "";
}

/** 换上新的默认封面。空值不写（别把「正在用」清成一个空封面）。 */
export async function setDefaultRedCover(cover: string): Promise<void> {
  if (!cover) return;
  await kvSet(DEFAULT_KEY, cover);
}

/** 收一张进来（新→旧）。**按照片认人**：同一张照片只占一条，挪过位置的就把那一条
 *  换成新位置、并挪到最前面——不然她每挪一下，画廊里就多长出一格。
 *  预设封面（没照片的）不收。 */
export async function putRedCoverToLibrary(cover: string): Promise<void> {
  if (!cover || !isCustomRedCover(cover)) return;
  const ref = redCoverRefOf(cover);
  const old = await getRedCoverLibrary();
  const rest = old.filter((c) => redCoverRefOf(c) !== ref);
  await kvSet(COVERS_KEY, [cover, ...rest].slice(0, MAX_COVERS));
}

/** 从名单里去掉一条（画廊那一格右上角的小「×」）。按完整值去，删掉的就是她点的那一格。 */
export async function removeRedCoverFromLibrary(cover: string): Promise<void> {
  const old = await getRedCoverLibrary();
  await kvSet(COVERS_KEY, old.filter((c) => c !== cover));
}
