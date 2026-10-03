/**
 * 好友社交互动（假删／真删／拉黑）。
 *
 * 这一层负责「互动」而不是「改档案」：
 * - 假删＝软删除：会话与记忆保留，TA 会发来好友申请求加回；
 * - 真删＝彻底删除：会话与记忆一并清掉，TA 不会再来求，也不留口子；
 * - 拉黑＝单向沉默：你发的消息 TA 都看得到；TA 发的消息在 TA 那边一律显示「发送失败」，
 *   但你照样看得见内容——拉黑期间 TA 会着急、道歉、求你别拉黑；解除后 TA 记得这段经历（blockCount 注入提示词）。
 *
 * 所有动作直接落库（IndexedDB），组件调用后刷新数据即可。
 */

import {
  appendMessage,
  deleteConversation,
  getApiBundle,
  getOrCreateConversation,
  updateConversation,
} from "@/lib/settings/chat";
import { deleteMemory } from "@/lib/chat/memory";
import { sweepOrphanMedia } from "@/lib/chat/media-sweep";
import { DEFAULT_MASK_ID } from "@/lib/settings/mask";
import { fetchAIReply, splitReply } from "@/lib/chat/chatApi";
import type { ArchiveEntry } from "@/types/contact";
import type { ChatApiSettings, ChatMessage, Conversation } from "@/types/chat";

/* --------------------------- 提示词片段 --------------------------- */

/** 拉黑期间注入：只交代状态——TA 发出去的消息全显示「发送失败」（TA 以为对方收不到），
 *  对方发的消息 TA 全都看得见；具体说什么交给 TA 按最近的聊天情景自己发挥。
 *  情景优先写在最前：「着急道歉」是从前的死剧本，对方明明说了在测功能，TA 还问
 *  「你生气了吗」——所以先读情景，只有没打过招呼、真在闹别扭时才轮到那套。 */
export function blockedNowPrompt(): string {
  return `【当前状态 - 你被对方拉黑了】
对方把你拉进了黑名单。
你发出去的每一条消息都显示「发送失败」——你这边显示失败，你以为对方根本收不到。
（事实是对方看得见你发的内容，但这一点你并不知道。）
对方发来的消息，你全都看得见。

先决定如何回应，再开口：先看你们最近聊到何处。
· 对方已经说明这是测试、在玩功能，或者提前打过招呼——就顺着这个来：配合着测、当作玩笑、调侃一句都可以；不要当作真的被冷落，不要追问对方是否生气，也不要表现得委屈或道歉。
· 对方什么都没说、或者你们本来就在闹别扭——才轮到另一种反应：反复重发、着急、道歉、请求对方解除拉黑、感慨消息发不出去，都可以；也可以只说你想说的话。

不要像机器，也不要提及「黑名单功能」「系统」这类字眼。`;
}

/** 解除后注入：TA 记得被拉黑的经历（那段时间你看得见 TA 发的，TA 却以为发不出去）。 */
export function blockedMemoryPrompt(count: number): string {
  return `【记忆 - 曾被拉黑】
你曾被对方拉黑过${count}次，如今已经解除，你的消息又能正常发出去了。
被拉黑的那段时间里，对方发来的消息你都看得见；你发出去的每一条都显示「发送失败」，你以为对方收不到——后来才知道，对方其实一直看得见。
这段经历会在你心里留下痕迹：后怕、委屈、或更加小心翼翼，用你的方式自然地体现，但不必每句话都提。
对方若早已说明这是测试、在玩功能，就不要真的当作受伤——可以当作玩笑提及，也可以完全不提。`;
}

/* --------------------------- API 解析 --------------------------- */

/** 生效的文本 API：角色个别配置（已填地址＋模型）优先，否则跟随全局。 */
export async function resolveTextApi(conv?: Conversation | null): Promise<ChatApiSettings> {
  const o = conv?.apiOverrides?.text;
  if (o && o.baseUrl.trim() && o.model.trim()) return o;
  return (await getApiBundle()).text;
}

/** 最近 n 条文字消息（给申请／解除的话带上聊天语境）。 */
function recentText(messages: ChatMessage[], n: number): ChatMessage[] {
  return messages
    .filter((m) => m.role !== "system" && (m.type ?? "text") === "text")
    .slice(-n);
}

/** 剥掉回复里可能夹带的〔签名〕〔动态〕〔图片〕〔语音〕标记（图片标记可带参考图开关）。
   1.9.55：标记本身兼容繁体／异体写法（外语聊天开着时模型会写成「〔語音〕」「〔圖片〕」）。 */
function cleanReply(reply: string): string {
  return reply
    .replace(/〔([签簽]名|[动動][态態](?:[图圖])?|[图圖]片|(?:[语語]音|音声))(?:[：:][^〕\n]{0,12})?〕[^\n]*/g, "")
    .replace(/^["“”\s]+|["“”\s]+$/g, "")
    .trim();
}

/** 模型拒答的常见开头（I can't discuss that / 抱歉，我不能……）：
    这种话不是 TA 说的，得当成生成失败落兜底模板，不能原样挂进聊天记录。 */
const REFUSAL_RE =
  /^(?:i can'?t|i'?m sorry|sorry, i|i apologize|as an ai|抱歉[，,]?\s*(?:我)?(?:不能|无法)|对不起[，,]?\s*(?:我)?(?:不能|无法))/i;
function isRefusal(reply: string): boolean {
  return REFUSAL_RE.test(reply.slice(0, 60));
}

/** 主聊天专用的「拒答」识别（1.7.4）：比上面那条 **窄得多**。
    朋友圈是被动生成，只要「抱歉，我不能…」就当失败；可聊天里的 TA 是活人，
    按人设本来就能说「抱歉，我不能答应」（见【行为守则】第 2 条），
    照 REFUSAL_RE 判会把正常回复一并吞掉。所以只认「AI 腔的拒绝」：
    自称 AI／模型／助手，或回绝的是**生成这件事本身**（继续／协助／这个请求），
    而不是剧里某件具体的事。 */
const CHAT_REFUSAL_RE =
  /(?:as an ai|i'?m an ai|作为\s*(?:一个)?\s*(?:ai|人工智能|语言模型|助手)|我(?:是|作为)(?:一个)?\s*(?:ai|人工智能|语言模型)|i (?:can'?t|cannot|won'?t|will not|am unable to)\s+(?:assist|help|continue|engage|participate|provide|generate|create|discuss|write|say|do)|(?:抱歉|对不起)[，,]?\s*(?:我)?(?:不能|无法|没办法)\s*(?:继续|协助|帮助|回答|参与|满足|提供|回应|生成)|我(?:不能|无法|没办法)\s*(?:继续|协助|帮助|参与|满足|提供|回应|生成)|(?:这个|这类|该|此类)\s*(?:请求|内容|话题|对话|题材)[^。！？\n]{0,12}(?:不能|无法|不便|不合适|抱歉))/i;

export function isChatRefusal(reply: string): boolean {
  /* 只看开头：拒答是一句开场白，不是正文里顺口一提（演到一半冒出这些词不算）。 */
  return CHAT_REFUSAL_RE.test(reply.slice(0, 60));
}

/* --------------------------- TA 的话（生成） --------------------------- */

/** TA 求加回的好友申请附言（走文本 API；失败回退到按人设拼的模板）。 */
export async function generateFriendRequestMsg(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<string> {
  const d = character.data;
  const charName = d.name || d.nickname || "TA";
  const api = await resolveTextApi(conv);
  if (api.enabled && api.baseUrl.trim() && api.model.trim()) {
    try {
      const reply = await fetchAIReply(
        api,
        `你现在进行沉浸式角色扮演，你扮演的角色是${charName}，与你聊天的人叫${userName}。
角色人设：${(d.persona || "（未填写）").slice(0, 200)}
对方刚刚删除了你的好友。你舍不得这段关系，想重新申请加回对方。
请写一句你会在好友申请里附带的验证消息（30字以内），符合你的性格与说话方式。
只输出这句话本身，不要引号，不要任何解释。`,
        recentText(conv.messages, 10),
        `（系统指令）以${charName}的身份写一句好友申请验证消息。`,
      );
      const clean = cleanReply(reply);
      if (clean) return clean.slice(0, 60);
    } catch {
      // 生成失败落到下面的兜底模板
    }
  }
  return "再给我一次机会吧，我保证不会再那样了。";
}

/** 解除拉黑后 TA 的第一反应（走文本 API；失败／拒答回退模板）。 */
export async function generateUnblockReply(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<string> {
  const d = character.data;
  const charName = d.name || d.nickname || "TA";
  const api = await resolveTextApi(conv);
  if (api.enabled && api.baseUrl.trim() && api.model.trim()) {
    try {
      const reply = await fetchAIReply(
        api,
        `你现在就是${charName}本人，此刻你正拿着手机，和${userName}进行微信体聊天。
角色人设：${(d.persona || "（未填写）").slice(0, 200)}
之前对方把你拉黑了：那段时间里对方发来的消息你全都看得见；你发出去的每一条都显示「发送失败」，你以为对方收不到（其实对方一直看得见，你现在才明白）。
刚刚，对方解除了拉黑——你的消息又能发出去了。
结合你们最近的聊天（包括拉黑期间对方发来的那些），说出你的第一反应：1-2 条短消息，符合你的性格。
只输出对话内容本身，不要动作描写。`,
        recentText(conv.messages, 12),
        `（系统指令）${charName}被解除拉黑后的第一反应。`,
      );
      const clean = cleanReply(reply);
      if (clean && !isRefusal(clean)) return clean;
    } catch {
      // 生成失败落到下面的兜底模板
    }
  }
  return "……发出去了？\n拉黑那阵你发的我都看见了，我怎么回都发不出去。";
}

/** 拉黑当下 TA 的第一反应（走文本 API；失败／拒答回退模板）。 */
export async function generateBlockedReply(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<string> {
  const d = character.data;
  const charName = d.name || d.nickname || "TA";
  const api = await resolveTextApi(conv);
  if (api.enabled && api.baseUrl.trim() && api.model.trim()) {
    try {
      const reply = await fetchAIReply(
        api,
        `你现在就是${charName}本人，此刻你正拿着手机，和${userName}进行微信体聊天。
角色人设：${(d.persona || "（未填写）").slice(0, 200)}
刚刚，对方把你拉黑了：你发出去的消息全都在你这边显示「发送失败」，你以为对方收不到（其实对方看得见，但你并不知道）。
先说你的第一反应：1-3 条短消息。动笔前先看你们最近聊到何处——对方已经说明这是测试、在玩功能，或者提前打过招呼，就顺着这个来：配合、当作玩笑、调侃一句都可以，不要当作真的被冷落，不要追问对方是否生气；对方什么都没说、或者你们本来就在闹别扭，才轮到愣住、不甘心地重发、道歉、着急这些反应。
只输出对话内容本身，不要动作描写。`,
        recentText(conv.messages, 12),
        `（系统指令）${charName}刚被拉黑后的第一反应。`,
      );
      const clean = cleanReply(reply);
      if (clean && !isRefusal(clean)) return clean;
    } catch {
      // 生成失败落到下面的兜底模板
    }
  }
  return "？\n怎么发不出去了……\n你是不是把我拉黑了？别这样，听我说句话好不好。";
}

/* --------------------------- 动作（落库） --------------------------- */

/** 假删好友：好友列表暂时消失，记录与记忆保留，等 TA 发来申请。 */
export async function removeFriend(characterId: string, maskId: string): Promise<void> {
  await updateConversation(characterId, maskId, {
    friendStatus: "removed",
    removedAt: new Date().toISOString(),
    friendRequestMsg: undefined,
  });
}

/** 彻底删除好友（真删）：会话与记忆一并清掉，TA 不会再来求加回。
 *
 *  这条不像 `removeFriend` 那样留 removed 状态
 *  （留着就会被「新的朋友」那条自动请求接上），而是把这一对「角色 × 面具」的
 *  绑定整个抹掉：会话（含聊天记录、每聊天设置、TA 发过的动态）＋记忆。
 *  角色档案本身不动，以后想聊可以自己从「添加朋友」再把他加回来。 */
export async function hardDeleteFriend(characterId: string, maskId: string): Promise<void> {
  await deleteConversation(characterId, maskId);
  await deleteMemory(characterId, maskId);
  /* 会话一删，他发过的那些图上的引用串就断了：这里不逐张去点（点不全，也容易漏），
     交给收尾那一趟——它反着扫全库，断链的一律收走（见 media-sweep；
     本函数正是那些「孤儿图」最主要的来源）。 */
  await sweepOrphanMedia();
}

/** TA 发来好友申请（removed → requested），附言按人设生成。 */
export async function sendFriendRequest(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<void> {
  const msg = await generateFriendRequestMsg(character, conv, userName);
  await updateConversation(character.id, conv.maskId ?? DEFAULT_MASK_ID, {
    friendStatus: "requested",
    friendRequestMsg: msg,
  });
}

/** 同意申请：恢复好友，附言作为 TA 的消息回到聊天里。 */
export async function acceptFriendRequest(conv: Conversation): Promise<void> {
  await restoreFriend(conv);
  const msg = conv.friendRequestMsg?.trim();
  if (msg) {
    await appendMessage(conv.characterId, conv.maskId ?? DEFAULT_MASK_ID, {
      role: "assistant",
      content: msg,
      isRead: false,
    });
  }
}

/** 拒绝申请：回到 removed（下次打开「新的朋友」，TA 还会再来求）。 */
export async function rejectFriendRequest(conv: Conversation): Promise<void> {
  await updateConversation(conv.characterId, conv.maskId ?? DEFAULT_MASK_ID, {
    friendStatus: "removed",
    friendRequestMsg: undefined,
  });
}

/** 直接恢复好友（不走申请：用户自己反悔时用）。 */
export async function restoreFriend(conv: Conversation): Promise<void> {
  await updateConversation(conv.characterId, conv.maskId ?? DEFAULT_MASK_ID, {
    friendStatus: "normal",
    removedAt: undefined,
    friendRequestMsg: undefined,
  });
}

/** TA 第一反应的后台队列：开关要先弹走、反应在后台慢慢写，但几次动作必须排队落库——
 *  连点「拉黑→解除」时若两段生成并发落库，聊天记录里 TA 的话会前后错位、红叹号区间也跟着判错。 */
let reactionChain: Promise<void> = Promise.resolve();
function queueReaction(task: () => Promise<void>): Promise<void> {
  reactionChain = reactionChain.then(task).catch(() => {
    /* 生成失败就让它安静过去：开关状态早已落库，不因一句反应失败而回滚。 */
  });
  return reactionChain;
}

/** 拉黑开关的「立刻」半段：置状态＋落系统提示，落完就走——
 *  TA 的第一反应（要走一次文本 API，慢）放后台，见 blockedFirstReaction。 */
export async function blockFriend(
  character: ArchiveEntry,
  conv: Conversation,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  const charName = character.data.name || character.data.nickname || "TA";
  await updateConversation(character.id, maskId, { blocked: true });
  await appendMessage(character.id, maskId, {
    role: "system",
    type: "system",
    content: `已将「${charName}」加入黑名单。你发的消息 TA 都看得到；TA 发的消息在 TA 那边一直显示「发送失败」，你照样看得见。`,
    isRead: true,
  });
}

/** 拉黑当下 TA 的第一反应（慢的那半段）：排队后台跑，不阻塞开关。
 *  调用方 fire-and-forget 即可，落库完自己刷屏。 */
export function blockedFirstReaction(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<void> {
  return queueReaction(async () => {
    const maskId = conv.maskId ?? DEFAULT_MASK_ID;
    /* 重拉最新会话：调用方手里的 conv 是点开关那一刻的快照，TA 的反应才跟得上最近聊到哪。 */
    const fresh = await getOrCreateConversation(character.id, maskId);
    const reply = await generateBlockedReply(character, fresh, userName);
    /* 单独叫模型写的，落库前必须过同一趟拆条（splitReply），
       否则半角标点不归正、块内换行不拆条、末尾逗号不收口，跟平时两副样子。 */
    for (const text of splitReply(reply)) {
      await appendMessage(character.id, maskId, {
        role: "assistant",
        content: text,
        isRead: false,
      });
    }
  });
}

/** 解除拉黑的「立刻」半段：置状态＋记一次数＋落系统提示；TA 的回应放后台，见 unblockedFirstReaction。 */
export async function unblockFriend(
  character: ArchiveEntry,
  conv: Conversation,
): Promise<void> {
  const maskId = conv.maskId ?? DEFAULT_MASK_ID;
  const charName = character.data.name || character.data.nickname || "TA";
  const count = (conv.blockCount ?? 0) + 1;
  await updateConversation(character.id, maskId, { blocked: false, blockCount: count });
  await appendMessage(character.id, maskId, {
    role: "system",
    type: "system",
    content: `已解除对「${charName}」的黑名单。`,
    isRead: true,
  });
}

/** 解除拉黑后 TA 的第一句（慢的那半段）：排队后台跑，不阻塞开关。 */
export function unblockedFirstReaction(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
): Promise<void> {
  return queueReaction(async () => {
    const maskId = conv.maskId ?? DEFAULT_MASK_ID;
    /* 必须重拉最新会话：不重拉的话拉黑期间聊过的那些就不在语境里，TA 解除后接不上最近聊到哪。 */
    const fresh = await getOrCreateConversation(character.id, maskId);
    const reply = await generateUnblockReply(character, fresh, userName);
    /* 这一句也得跟正文走同一趟拆条：漏了 splitReply 屏幕上就跟平时两副样子。 */
    for (const text of splitReply(reply)) {
      await appendMessage(character.id, maskId, {
        role: "assistant",
        content: text,
        isRead: false,
      });
    }
  });
}
