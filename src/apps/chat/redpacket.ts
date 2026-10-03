/**
 * 星绥通讯：红包封面。
 *
 * 【为什么单独一个文件】封面要被两头用——发红包那页（MoneySendView 的封面挑选）
 * 和聊天里（红包卡／开红包页的渲染）——预设表和判定放这儿，谁也不用引谁。
 *
 * 【两种封面】
 *  - 预设：纯 CSS 渐层，id 存在消息的 `redCover` 上（"classic"/"crimson"/"pink"/"gold"）；
 *  - 自定义：一张图，存的是媒体仓库引用串 `media-store://mc_xxx`（图本体在独立库里，
 *    不会把「每次读列表都整份读出」的会话记录撑爆——跟聊天图片同一条规矩）；
 *    老数据也可能是 data URL，两种都认。
 *
 * 【TA 发的红包】模型那边选不了封面（提示词管不到这张卡长什么样），
 * `redCover` 是空的——渲染时按消息 id 稳定挑一张预设（同一个红包永远是同一张，
 * 不同的红包会换花样），不必落库。
 */

/** 一款预设封面：眼下只是一段渐层底（要加花纹就再添字段，别在用它的地方写死）。 */
export interface RedCoverPreset {
  id: string;
  /** 封面底色（可直接当 CSS background 用）。 */
  bg: string;
}

/** 预设封面。**只剩一张**（另外三张 crimson／pink／gold 从界面撤了）。
 *
 *  【1.9.78：换成「柔和野兽派」的平灰底】恩熙从四套里挑了第四套，底色不再走淡粉——
 *  一块平灰（#F5F5F5）。纹样（顶边粉条、三颗柔色圆点、左下那条羽化紫斜条）不烘进
 *  底色，另挂在 `RED_COVER_TONE.glow` 那层上，只铺预设封面（照片封面不压）。
 *
 *  【色只在这儿定】灰底上走深墨字——凡是要往预设封套上铺字／铺图标的地方，
 *  一律取下面 `RED_COVER_TONE` 里那几个，别各自写死颜色。
 *
 *  【id 为什么还叫 "classic"】历史红包消息的 `redCover` 里存的就是这个串，
 *  改了名老红包就认不出封面了——颜色怎么换，这个 id 不许动。
 *
 *  【为什么另三张的 id 还留着】它们从挑封面的界面撤了，但**历史红包消息的
 *   `redCover` 里可能还写着 "pink" 这种值**——`RED_COVER_LEGACY_IDS` 让这些 id
 *  仍被认成「预设」（一律画成这张默认），不然 `isCustomRedCover` 会把它当成一张图
 *  去媒体仓库里找一个叫 "pink" 的资产，白找一趟。 */
export const RED_COVER_PRESETS: RedCoverPreset[] = [
  {
    id: "classic",
    bg: "#F5F5F5",
  },
];

/** 预设封套的**野兽派一套**：灰底上要读得清的字、图标、纹样、硬投影都在这儿。
 *  预设有变它就跟着变，铺预设封面的地方别再各写各的颜色。
 *  自定义照片封面不取这套——照片深浅不由我们定，那些地方另有自己的遮罩。 */
export const RED_COVER_TONE = {
  /** 封面上的主字（祝福语、谁发的红包）。 */
  ink: "#1A1A1A",
  /** 次一档的小字。 */
  inkSoft: "#5B5B5B",
  /** 圆标：底、边、里头那枚图标。边只存颜色，2px 宽度由调用处拼。 */
  chipBg: "#F472B6",
  chipBorder: "#1A1A1A",
  chipInk: "#1A1A1A",
  /** 预设封面上那层纹样（「柔和野兽派」四处花样，从下往上叠）：
   *  最底一条左下起笔的羽化紫斜条，其上三颗柔色圆点，顶边压一条 4px 粉带。
   *  【只铺预设封面】各处都是 `!customSrc` 才压这层——照片封面走 url(...)，
   *  自带的花样会跑出来，这层纹样不上去。
   *  【末段别收暗】末尾别再挂玫粉把封面下沿压深——底下紧挨着那条带，
   *  一压就在弧那儿横出一道色差；卡立不立得住靠硬投影，不靠压深。 */
  glow:
    "linear-gradient(to bottom, #F472B6 0 4px, transparent 4px), " +
    "radial-gradient(circle at 89% 76%, rgba(244,114,182,.5) 0 8px, rgba(244,114,182,0) 14px), " +
    "radial-gradient(circle at 75% 26%, rgba(45,212,191,.42) 0 5px, rgba(45,212,191,0) 10px), " +
    "radial-gradient(circle at 64% 74%, rgba(250,204,21,.34) 0 6px, rgba(250,204,21,0) 12px), " +
    "linear-gradient(45deg, transparent 0 13%, rgba(167,139,250,.22) 22% 28%, transparent 37%)",
  /** 未领那张卡的投影：野兽派的硬边投影——平推 4px，不留虚边。 */
  shadow: "4px 4px 0 0 rgba(0,0,0,.2)",
} as const;

export const RED_COVER_DEFAULT = RED_COVER_PRESETS[0];

/** 领完之后压上来的那层浅色遮罩。
 *  【为什么不是 filter】给整张卡挂 `grayscale` 是条看着顺的路，但会**整张图都灰掉**，
 *  不是「领过了」那种淡下来的感觉。所以封套不动，上面**淡进一层浅色**，
 *  卡退成「已领取」的浅样子；自定义图也走同一层（不透明度低一档，图还看得见），
 *  不去色。
 *  【这层跟着新底色】灰底（#F5F5F5）上压一层同色系的半透明灰（.75），
 *  领完只是「同一张灰纸淡下去一点」，不是换一张纸。 */
export const RED_COVER_CLAIMED_VEIL = "rgba(245,245,245,.75)";

/** 已撤掉、只在老消息里可能出现的预设 id（见上面那段说明）。 */
const RED_COVER_LEGACY_IDS = ["crimson", "pink", "gold"];

/** 这串值是不是「自定义图片封面」（引用串或 data URL）——不是预设 id 就是。
 *  【带取景后缀的也算】后缀是贴在引用串后面的，带不带后缀都是同一张照片。 */
export function isCustomRedCover(cover: string | undefined): boolean {
  if (!cover) return false;
  if (RED_COVER_LEGACY_IDS.includes(cover)) return false;
  return !RED_COVER_PRESETS.some((p) => p.id === cover);
}

/** 取景位置：0–100 的百分比，跟 CSS `background-position` 一个语义（50／50 就是正中）。
 *
 *  照片铺满封面时总要裁掉一部分，裁哪一片由这对数说了算。 */
export interface RedCoverPos {
  x: number;
  y: number;
}

export const RED_COVER_POS_CENTER: RedCoverPos = { x: 50, y: 50 };

/** 取景的**场合**：同一张照片落进三个比例差得远的框，所以各归各挪、各记一份。
 *  - `card`：聊天里那张横向小卡（228×76）；
 *  - `open`：开红包那一页的封面区（250×236）——还没开那张封套与开完之后那张纸是同一块封面、
 *    同一条弧，所以这一档**两处共用**；
 *  - `detail`：领取详情页顶上那条通栏封面（整屏宽 × 280）。 */
export type RedCoverScene = "card" | "open" | "detail";

/** 各场合挪到哪儿了；没记的那一档＝居中。 */
export type RedCoverPosMap = Partial<Record<RedCoverScene, RedCoverPos>>;

/** 拼串的顺序（定死，别靠对象自己的键序）。 */
const COVER_SCENES: RedCoverScene[] = ["card", "open", "detail"];

/** 取景后缀（贴在图的引用串尾巴上：`media-store://mc_x#p=card:50,40;open:30,50`）。
 *
 *  【为什么贴在串上，不另开一格字段】这个值得跟着消息走——老红包翻出来还得是她当初
 *  挪好的样子。消息里 `redCover` 只有一格字符串，另开字段就要动落库白名单与所有老数据。
 *
 *  【某一处居中就不写它那一档】三处都没挪过＝整截后缀都不写，存量数据的形状一个字不变
 *  （也就等于「没挪过」＝三处居中），老红包不会因为这次改动而变样。
 *
 *  【老格式只有一对数】从前只支持一个位置，写出来是 `#p=50,40`——那一对数当年就是三处
 *  共用的意思，所以读到这种没有场合键的老值，三档一律取它，老红包看着跟从前一样。
 *
 *  【谁得先剥掉它】凡是拿这个值去**取图**的地方（读媒体仓库、递 vision）都必须先过
 *  `redCoverRefOf`——仓库认的键是完整引用串，尾巴上多一截就找不到那张图了。 */
const COVER_POS_TAG = "#p=";

function clampCoverPos(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

/** 把一对数收进 0–100 并取整。取景页拖动时每一帧都要过一遍，所以单放出来。 */
export function clampRedCoverPos(pos: RedCoverPos): RedCoverPos {
  return { x: clampCoverPos(pos.x), y: clampCoverPos(pos.y) };
}

/** 剥出「图的引用」——取图（读仓库／递 vision）只认这个。 */
export function redCoverRefOf(cover: string): string {
  const i = cover.indexOf(COVER_POS_TAG);
  return i < 0 ? cover : cover.slice(0, i);
}

/** 这一段是不是一个场合键（老格式那对裸数字不算）。 */
function isCoverScene(v: string): v is RedCoverScene {
  return (COVER_SCENES as string[]).includes(v);
}

/** 解一段 `x,y`；不是两个数就回 null（这一档当没写）。 */
function parseCoverPair(text: string): RedCoverPos | null {
  const [x, y] = text.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clampCoverPos(x), y: clampCoverPos(y) };
}

/** 解出各场合挪在哪儿；没带的那一档缺席（调用方按居中算）。 */
export function redCoverPosMapOf(cover: string | undefined): RedCoverPosMap {
  const map: RedCoverPosMap = {};
  if (!cover) return map;
  const i = cover.indexOf(COVER_POS_TAG);
  if (i < 0) return map;
  /* 老格式那位「三处共用」的位置先记着，最后补进没被单独记过的档 */
  let legacy: RedCoverPos | null = null;
  for (const seg of cover.slice(i + COVER_POS_TAG.length).split(";")) {
    const c = seg.indexOf(":");
    if (c < 0) {
      legacy = parseCoverPair(seg) ?? legacy;
      continue;
    }
    const key = seg.slice(0, c);
    if (!isCoverScene(key)) continue;
    const pos = parseCoverPair(seg.slice(c + 1));
    if (pos) map[key] = pos;
  }
  if (legacy) {
    for (const scene of COVER_SCENES) if (!map[scene]) map[scene] = legacy;
  }
  return map;
}

/** 这一处挪到哪儿了；没带后缀（含老数据／压根没选封面）＝居中。 */
export function redCoverPosOf(cover: string | undefined, scene: RedCoverScene): RedCoverPos {
  return redCoverPosMapOf(cover)[scene] ?? RED_COVER_POS_CENTER;
}

/** 拼一串封面值：各档都居中就一截后缀都不写（跟以前那些值长得一样）。 */
export function composeRedCover(ref: string, map: RedCoverPosMap): string {
  const parts: string[] = [];
  for (const scene of COVER_SCENES) {
    const raw = map[scene];
    if (!raw) continue;
    const pos = clampRedCoverPos(raw);
    if (pos.x === RED_COVER_POS_CENTER.x && pos.y === RED_COVER_POS_CENTER.y) continue;
    parts.push(`${scene}:${pos.x},${pos.y}`);
  }
  if (!parts.length) return ref;
  return `${ref}${COVER_POS_TAG}${parts.join(";")}`;
}

/** 读封面图要用的那个引用串（`useMediaSrc` 只认它）；不是自定义图封面就回 undefined。
 *  【为什么要这么一层】调用方要的是「该拿什么去读仓库」——先剥取景后缀，不是图就别读。
 *  各处自己写 `isCustomRedCover(...) ? redCoverRefOf(...) : undefined` 太啰嗦，也容易漏掉剥后缀。 */
export function redCoverSrcRefOf(cover: string | undefined): string | undefined {
  if (!cover || !isCustomRedCover(cover)) return undefined;
  return redCoverRefOf(cover);
}

/** 一条封面值 → 一段能直接当 CSS `background` 用的铺法（图缺了／是预设就落回 `fallback`）。
 *  照片按**这一处**的取景位置铺满（跟 CSS `background-position` 同语义），所以那一处挪到哪儿、它就长什么样。 */
export function redCoverBgOf(
  src: string | undefined,
  pos: RedCoverPos,
  fallback: string,
): string {
  if (!src) return fallback;
  return `url(${src}) ${pos.x}% ${pos.y}% / cover`;
}

/** 这条红包该用哪张预设封面。**眼下只剩一张默认**，所以不再按 id／seed 挑——一律这张默认封套。
 *  自定义图封面不走这里（调用方先用 isCustomRedCover 分去走 useMediaSrc）。 */
export function redCoverPresetOf(): RedCoverPreset {
  return RED_COVER_DEFAULT;
}

/** 封面在 TA 眼里是什么来头——接在「（发来一个红包：…，留言「…」）」那半句后面。
 *
 *  【为什么要有】TA 那边原本只看得到金额与留言：封面这东西全项目只有渲染层认，
 *  她换了张照片当封面，TA 一无所知，也就没法就着封面接话。
 *
 *  【自定义那档这句话说不全】照片里是什么，一句话描述不出来——真让 TA 看懂靠的是
 *  把那张图随这一轮一起递过去（见 ChatWindow 的 visionImage），这句话只交代来头。
 *  预设那档是纯 CSS 渐层、没有图可取，说到这儿为止。
 *
 *  与 moneyNoteOf 那句拼在一起，两个场合（发钱那一轮／回喂历史）共用同一份写法。 */
export function redCoverNoteOf(cover: string | undefined): string {
  if (isCustomRedCover(cover)) return "一张自己换的图";
  return "一张浅灰的卡片";
}
