/**
 * 动态配图「读图」：发布那一刻，让文本接口**看一眼**这张图，把图里是什么写成一句话，
 * 回写进这条动态（`imageNote`）。
 *
 * 为什么要「看一眼就写下来」而不是每轮把图带给 TA：
 * - 图是按**尺寸**算 token 的（祖训②）：每轮重带＝每轮把钱重烧一遍；
 * - 看一眼＝一次花费、永久记住：此后 TA 读「我在朋友圈发过的」、以及旧动态压成印象时，
 *   都带着这句，聊天里自然就能提起图里的事。
 *
 * 兜底（跟聊天发图失败同待遇）：接口没配／站点不支持看图／识别失败——**一律静默返空**，
 * 不报错、不挡发布；这条动态只是 TA 读不到图内容，其余照旧。
 */

import { fetchAIReply } from "./chatApi";
import { mediaRefToVisionDataUrl } from "./media-asset";
import { getApiBundle, setSelfMomentImageNote } from "@/lib/settings/chat";

/** 描述最多留多少字（太长会把上下文撑肥，一句话足够）。 */
const NOTE_MAX_CHARS = 60;

/** 拼好给模型的指令：只描述、不发挥，免得它把图编成一段小说。 */
const VISION_SYSTEM =
  "你正看着一张照片。请用一句话（不超过30字）平实地说清照片里是什么——拍了什么、在哪、什么感觉。" +
  "只输出这句话本身，不加引号，不加任何前后缀。";

/**
 * 给一条刚发布的带图动态写「读图那句话」并回写。
 * 任何一步不成都静默收场（不抛错）——读图是锦上添花，绝不带崩发布。
 */
export async function describeSelfMomentImage(
  maskId: string,
  momentId: string,
  imageRef: string,
): Promise<void> {
  try {
    const api = (await getApiBundle()).text;
    if (!api.enabled || !api.baseUrl.trim() || !api.model.trim()) return;
    /* 压成「给模型看」的小图（768／0.7），只在这一次请求上用，用完即弃、不落库。 */
    const vision = await mediaRefToVisionDataUrl(imageRef);
    if (!vision) return;
    const reply = await fetchAIReply(
      api,
      VISION_SYSTEM,
      [],
      "这张照片里是什么？",
      undefined,
      80, // 只要一句话，额度给够就行
      0.4, // 描述要贴着图，别发散
      undefined,
      undefined,
      vision,
    );
    const note = reply.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_CHARS);
    if (!note) return;
    await setSelfMomentImageNote(maskId, momentId, note);
  } catch {
    /* 接口没配／不支持看图／识别失败：这条 TA 看不到图内容，照常发，不提示、不重试。 */
  }
}
