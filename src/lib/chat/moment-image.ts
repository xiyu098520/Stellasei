/**
 * 动态配图：把 TA 写的那段画面描述变成一张真图，落到媒体仓库，再把引用串回写进那条动态。
 *
 * 恩熙 2026-09-21：「我希望到朋友圈页面的时候，我是可以手动点击要不要生成这张图片的」
 * → 手动那一趟在朋友圈页面点「生成配图」触发；
 * 同日又补：「如果我开启了自动生图，它就会直接去生成的哦」
 * → 「自动生图」（ChatPrefs.autoGenerateImage）开着时，TA 刚发完动态（带画面描述）
 *   就由聊天那边顺手画掉，恩熙进朋友圈看到的已经是图，没有那颗按钮。
 *
 * 两条路都走这一个函数——省得「手动」和「自动」各自抄一遍四步（跑接口 → 压图进仓库
 * → 回写引用串），改一处忘一处。
 *
 * 恩熙 2026-09-21：「他朋友圈发的自拍，他不是他的人设哦。」
 * → 这条路原来只把画面描述丢给生图接口，**没带 TA 的人设外貌、也没带参考图**，
 *   画出来当然不是 TA。现在跟聊天里那条路对齐：性别＋looks 由 `buildImageSubject`
 *   统一拼（两处共用一份，见 promptBuilder），参考图也是同一个规矩（有就送、
 *   「文字锁脸」模式不送）。**聊天里怎么画，动态里就怎么画。**
 */

import { generateImage } from "./chatApi";
import { mediaRefToDataUrl, persistImageAsset } from "./media-asset";
import { buildImageSubject } from "./promptBuilder";
import { getApiBundle, getConversations, setMomentImageRef } from "@/lib/settings/chat";
import { getArchives } from "@/lib/settings/contact";

/* ---------- 「这张图正在画」的登记表（恩熙 2026-09-21） ---------- */
/* 恩熙原话：「动态的话，我返回之后，我再重新进入，我看不见他正在生成。」
   两处都在这个「看不见」里：① 她自己点的生成，离开动态页再回来，那行「生成中…」没了
   （原来这状态是 MomentsPage 的 useState，页面一卸就跟着没了，而画图那趟请求其实还在跑）；
   ② TA 在聊天那边自动画（自动生图开着），动态页压根不知道有人在画，只挂着一颗「生成配图」。
   所以把「谁在画」从页面里抬到这里：起手登记、收工销号，谁都能问到，页面重挂也丢不了。
   `version` 只是一声铃（变了就喊订阅者重渲染），真正的答案在 `generating` 里。 */
const generating = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

const momentKey = (conversationId: string, momentId: string) => `${conversationId}::${momentId}`;

/** 这一条动态的配图是不是正在画（含 TA 在聊天那边顺手画的那趟）。 */
export function isMomentImageGenerating(conversationId: string, momentId: string): boolean {
  return generating.has(momentKey(conversationId, momentId));
}

/** 登记表变了没有（配 useSyncExternalStore／订阅一起用）。 */
export function getMomentImageVersion(): number {
  return version;
}

/** 订阅登记表的变化，返回退订。 */
export function subscribeMomentImage(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function markGenerating(key: string, on: boolean) {
  if (on) generating.add(key);
  else generating.delete(key);
  version += 1;
  for (const cb of listeners) cb();
}

/**
 * 给某条动态生成配图并回写。
 * 跑不通就往外抛（接口没配／生成失败／图片压不进仓库），由调用方决定怎么提示——
 * 动态本身一个字都不动，恩熙随时可以再点一次。
 */
export async function generateMomentImage(
  conversationId: string,
  momentId: string,
  prompt: string,
): Promise<void> {
  const key = momentKey(conversationId, momentId);
  markGenerating(key, true);
  try {
    await runMomentImage(conversationId, momentId, prompt);
  } finally {
    markGenerating(key, false);
  }
}

async function runMomentImage(
  conversationId: string,
  momentId: string,
  prompt: string,
): Promise<void> {
  const bundle = await getApiBundle();
  /* 人设：这条动态挂在哪个角色身上，从会话里查（会话带着 characterId），再翻档案拼
     性别＋外貌切片。档案没找着也不拦——画个人出来总比不画强，只是这一张不像 TA。 */
  const conv = (await getConversations()).find((c) => c.id === conversationId);
  const profile = (await getArchives()).find((a) => a.id === conv?.characterId)?.data;
  const subject = buildImageSubject(profile);
  /* 参考图：规矩跟聊天里一模一样——「文字锁脸」模式不送（长相全交给人设文字）；
     角色没传过参考图就没有。它存在图片仓库里（会话里只剩一句引用串），而生图接口
     只认 data URL，所以读回来再送；读不回来就当这次没传，绝不因为这一步让整次生图
     失败——生图是按次扣钱的。 */
  const referenceImage =
    bundle.imageExtras.faceLockMode === "text"
      ? undefined
      : await mediaRefToDataUrl(conv?.charRefImage);
  const res = await generateImage(
    bundle.image,
    prompt,
    bundle.imageExtras,
    /* 翻译开关开着时要靠文本 API 把中文描述译成英文，这里必须递上（见 chatApi 里
       「提示词翻译已开启，但文本 API 未配置」那条）。 */
    bundle.text,
    referenceImage,
    subject,
  );
  const stored = await persistImageAsset(res.image);
  if (!stored) throw new Error("图片没能存进仓库");
  await setMomentImageRef(conversationId, momentId, stored.ref);
}
