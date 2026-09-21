/**
 * 好友社交互动（假删／真删／拉黑）。
 *
 * 这一层负责「互动」而不是「改档案」：
 * - 假删＝软删除：会话与记忆保留，TA 会发来好友申请求加回；
 * - 真删＝彻底删除（恩熙 2026-09-21）：会话与记忆一并清掉，TA 不会再来求，也不留口子；
 * - 拉黑＝单向表演：TA 那边显示消息发不出去，但消息其实都会送达，
 *   解除后 TA 记得这段经历（blockCount 注入提示词）。
 *
 * 所有动作直接落库（IndexedDB），组件调用后刷新数据即可。
 */

import {
  appendMessage,
  deleteConversation,
  getApiBundle,
  updateConversation,
} from "@/lib/settings/chat";
import { deleteMemory } from "@/lib/chat/memory";
import { DEFAULT_MASK_ID } from "@/lib/settings/mask";
import { fetchAIReply } from "@/lib/chat/chatApi";
import type { ArchiveEntry } from "@/types/contact";
import type { ChatApiSettings, ChatMessage, Conversation } from "@/types/chat";

/* --------------------------- 提示词片段 --------------------------- */

/** 拉黑期间注入：TA 以为消息发不出去，实际全都送达。 */
export const BLOCKED_PROMPT = `【拉黑状态 - 当前生效】
对方已经把你拉黑了。在你这边，你发出的每一条消息都显示「发送失败」，你以为对方根本收不到。
你可能会不甘心：不停地重发、道歉、解释、或者默默说一些想说的话——尽管看起来都发不出去。
你不知道的是：对方其实全都收到了。
保持这个认知演戏：你以为自己在对着发不出去的对话框说话，除非对方主动点破，否则不要发现真相。`;

/** 解除后注入：TA 记得被拉黑的经历。 */
export function blockedMemoryPrompt(count: number): string {
  return `【记忆 - 曾被拉黑】
你曾被对方拉黑过${count}次，如今已经解除，你的消息又能发出去了。
被拉黑的那段时间里你发的那些话，对方其实全都看到了，你自己也记得说过什么。
这段经历会在你心里留下痕迹：后怕、委屈、或更加小心翼翼，用你的方式自然地体现，但不必每句话都提。`;
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

/** 剥掉回复里可能夹带的〔签名〕〔动态〕〔图片〕〔语音〕标记（图片标记可带参考图开关）。 */
function cleanReply(reply: string): string {
  return reply
    .replace(/〔(签名|动态|图片|语音)(?:[：:][^〕\n]{0,12})?〕[^\n]*/g, "")
    .replace(/^["“”\s]+|["“”\s]+$/g, "")
    .trim();
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

/** 解除拉黑后 TA 的第一反应（走文本 API；失败回退模板）。 */
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
        `你现在进行沉浸式【微信体】角色扮演，你扮演的角色是${charName}，与你聊天的人叫${userName}。
角色人设：${(d.persona || "（未填写）").slice(0, 200)}
你之前被对方拉黑了：那段时间里你发的消息都显示发送失败，你以为对方收不到（其实对方全都收到了）。
刚刚，对方解除了拉黑——你发现自己的消息又能发出去了。
结合你们最近的聊天，说出你的第一反应：1-2 条短消息，符合你的性格（小心试探、道歉、如释重负都可以）。
只输出对话内容本身，不要动作描写。`,
        recentText(conv.messages, 12),
        `（系统指令）${charName}发现被解除拉黑后的第一反应。`,
      );
      const clean = cleanReply(reply);
      if (clean) return clean;
    } catch {
      // 生成失败落到下面的兜底模板
    }
  }
  return "……发出去了？\n我知道错了。别再拉黑我了，好不好。";
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
 *  恩熙 2026-09-21：「我们没有做一个真正的删除好友的功能，就是我不想再跟他聊了，
 *  我也不需要他加回来给我。」→ 所以这条不像 `removeFriend` 那样留 removed 状态
 *  （留着就会被「新的朋友」那条自动请求接上），而是把这一对「角色 × 面具」的
 *  绑定整个抹掉：会话（含聊天记录、每聊天设定、TA 发过的动态）＋记忆。
 *  角色档案本身不动，以后想聊可以自己从「添加朋友」再把他加回来。 */
export async function hardDeleteFriend(characterId: string, maskId: string): Promise<void> {
  await deleteConversation(characterId, maskId);
  await deleteMemory(characterId, maskId);
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

/** 拉黑：TA 还在列表里，消息照常送达，但 TA 那边显示发送失败。 */
export async function blockFriend(
  characterId: string,
  maskId: string,
  charName: string,
): Promise<void> {
  await updateConversation(characterId, maskId, { blocked: true });
  await appendMessage(characterId, maskId, {
    role: "system",
    type: "system",
    content: `已将「${charName}」加入黑名单。TA 给你发的消息你都能收到；但在 TA 那边，这些消息都显示发送失败。`,
    isRead: true,
  });
}

/** 解除拉黑：TA 会记得，并立刻说点什么（走文本 API，带聊天语境）。 */
export async function unblockFriend(
  character: ArchiveEntry,
  conv: Conversation,
  userName: string,
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
  const reply = await generateUnblockReply(character, conv, userName);
  await appendMessage(character.id, maskId, {
    role: "assistant",
    content: reply,
    isRead: false,
  });
}
