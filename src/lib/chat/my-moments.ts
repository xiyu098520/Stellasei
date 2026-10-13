/**
 * 星绥通讯：「我」发的朋友圈，怎么让 TA 真的看见。
 *
 * 动态页里那个「可见范围」不是卡片上的一行字——它真决定谁能看见：
 * 聊天拼上下文时（`promptBuilder` 的易变区一块），把**这个人有权看的那几条**端给他；
 * 被挡在外面的角色一个字都读不到，也就无从提起（这就是「信息差」的底子）。
 *
 * 三条口径：
 * - 公开：谁都看得见。
 * - 仅自己可见：谁都看不见（只挂在动态页上给她自己看）。
 * - 部分可见：勾到的角色 ＋ 勾到的**世界里的人**（世界是活名单，角色挪进挪出跟着变）。
 * - 不给谁看：在上面那句之上**再挡掉**勾到的角色／整个世界的人（黑白并存）。
 *
 * token（祖训②）：只取最近 MY_MOMENTS_MAX 条、每条正文截到 MY_MOMENT_CHARS 字。
 * 她随时可能发新的，所以这块走易变区，不进前缀缓存（见 promptBuilder 的分区注释）。
 */

import { getSelfMoments } from "@/lib/settings/chat";
import type { SelfMoment } from "@/types/chat";

/** 最多端几条（再往前的老动态让 TA 从记忆里拿）。 */
export const MY_MOMENTS_MAX = 5;
/** 每条正文截断字数：动态是「知道有这么回事」，不必逐字全给。 */
const MY_MOMENT_CHARS = 60;

/** 这个人有权看的**全部**那几条（新→旧，不截断）——记忆压缩要用全量来筛。 */
export function filterVisibleMyMoments(
  items: SelfMoment[],
  characterId: string,
  categoryId?: string,
): SelfMoment[] {
  return items
    .filter((m) => {
      const v = m.visibility ?? "public";
      if (v === "private") return false;
      /* ① 白名单（哪些人有资格看）：公开／不给谁看＝全体；部分可见＝勾到的角色 ＋
            勾到的**世界里的人**（世界是活名单，角色挪进挪出跟着变）。 */
      const inBase =
        v === "public" || v === "exclude"
          ? true
          : (m.visibleTo ?? []).includes(characterId) ||
            (categoryId !== undefined && (m.visibleWorlds ?? []).includes(categoryId));
      if (!inBase) return false;
      /* ② 黑名单：白名单里**再挡掉**某些角色／整个世界的人（与白名单并存——
            例：部分可见勾了一整个世界，又在「不给谁看」里挡掉这世界里的某个人）。 */
      const excluded =
        (m.excludeTo ?? []).includes(characterId) ||
        (categoryId !== undefined && (m.excludeWorlds ?? []).includes(categoryId));
      return !excluded;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 这个人有权看的那几条（新→旧，最多 MY_MOMENTS_MAX 条）。 */
export function visibleMyMoments(
  items: SelfMoment[],
  characterId: string,
  categoryId?: string,
): SelfMoment[] {
  return filterVisibleMyMoments(items, characterId, categoryId).slice(0, MY_MOMENTS_MAX);
}

/** 拼成易变区那一块；这个人一条也看不到时回空串（整块不注入，不多给模型一个字）。 */
export async function buildMyMomentsBlock(
  characterId: string,
  categoryId: string | undefined,
  maskId: string,
): Promise<string> {
  /* 读不出来（库出岔子）不该连累聊天：当作没有动态，照常往下聊。 */
  const items = await getSelfMoments(maskId).catch(() => []);
  const list = visibleMyMoments(items, characterId, categoryId);
  if (list.length === 0) return "";
  const lines = list.map((m) => {
    const text = m.content.replace(/\s+/g, " ").trim().slice(0, MY_MOMENT_CHARS);
    /* 配图那句话（发布时「看一眼」写下的）跟着正文一起端给 TA；没有就按纯图报一声。
       「文字描述当图」那条：把描述原样报成「配了一张图」，TA 就当它是一张图片。 */
    const note = (m.imageNote ?? "").replace(/\s+/g, " ").trim().slice(0, MY_MOMENT_CHARS);
    const textImage = (m.imageText ?? "").replace(/\s+/g, " ").trim().slice(0, MY_MOMENT_CHARS);
    const photo = note
      ? `（配图：${note}）`
      : textImage
        ? `（配了一张图：${textImage}）`
        : m.imageRef
          ? "（配了一张照片）"
          : "";
    const body = [text, photo].filter(Boolean).join(" ");
    const tags = (m.tags ?? []).map((t) => `#${t}`).join(" ");
    const month = Number(m.createdAt.slice(5, 7));
    const day = Number(m.createdAt.slice(8, 10));
    return `- ${month}月${day}日：${body}${tags ? ` ${tags}` : ""}`;
  });
  return `【我在朋友圈发过的】\n${lines.join("\n")}`;
}
