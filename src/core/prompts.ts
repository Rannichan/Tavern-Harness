import type {
  ChatParticipant,
  ChatSession,
  NetworkMessage,
  NpcCharacter,
  WorldBook,
} from '../types/models';
import { sanitizeHistoryContentForModel } from './openai';
import { translate } from './i18n';

// ============================================================
// 提示词组装 — 与 MainViewModel.buildNpcSystemPrompt 等一致
// ============================================================

export function buildNpcSystemPrompt(
  npcPrompt: string,
  worldBookContent?: string | null,
  userPersonaPrompt?: string | null
): string {
  return (
    npcPrompt +
    (worldBookContent ? `\n\n=== ${translate('prompt.worldBook')} ===\n${worldBookContent}` : '') +
    (userPersonaPrompt ? `\n\n=== ${translate('prompt.userInfo')} ===\n${userPersonaPrompt}` : '')
  );
}

export function buildGroupSystemPrompt(
  activeSpeakerName: string,
  activeNpcPrompt: string,
  worldBookContent?: string | null,
  userPersonaPrompt?: string | null,
  requestPayload?: {
    allSpeakerNames: string[];
    playerName?: string | null;
    currentTurnQueueOrder: string[];
  }
): string {
  const others = (requestPayload?.allSpeakerNames ?? []).filter((n) => n !== activeSpeakerName);
  const playerName = requestPayload?.playerName ?? '用户';
  const orderHint =
    requestPayload?.currentTurnQueueOrder && requestPayload.currentTurnQueueOrder.length > 0
      ? `\nThe speaking order for the current round is: ${requestPayload.currentTurnQueueOrder.join(' → ')}`
      : '';

  return (
    `You are participating in a multi-character conversation. Reply only as ${activeSpeakerName}.\n` +
    `Never write dialogue for another participant.\n` +
    (others.length > 0
      ? `The other participants are: ${others.join(', ')}.\nThe user (a participant named "${playerName}") may speak at any moment — when they do, respond naturally as ${activeSpeakerName}.\n`
      : '') +
    `Messages prefixed with [${translate('prompt.roleTag')}] are utterances by that participant; messages prefixed with [${playerName}] are the user's.\n` +
    `When you need to direct the next speaker, you may use @${translate('prompt.roleTag')} in your reply to call on another participant.\n` +
    orderHint +
    `\n\n=== ${activeSpeakerName} ===\n` +
    activeNpcPrompt +
    (worldBookContent ? `\n\n=== ${translate('prompt.worldBook')} ===\n${worldBookContent}` : '') +
    (userPersonaPrompt ? `\n\n=== ${translate('prompt.userInfo')} ===\n${userPersonaPrompt}` : '')
  );
}

export const STANDARD_SYSTEM_PROMPT = 'You are a helpful assistant.';

// ============================================================
// 历史消息 → 网络消息（GROUP 角色折叠 / 附件 / 思考清理）
// ============================================================

export interface BuildNetworkMessageInput extends ChatParticipant {}

export function buildNetworkMessagesForSession(p: {
  messages: Array<{
    role: string;
    content: string;
    speakerParticipantId: number | null;
    speakerName: string | null;
    thinkingContent: string | null;
    toolCallsJson: string;
    toolCallId: string | null;
    attachments: string[];
  }>;
  session: ChatSession | null;
  participants: ChatParticipant[];
  activeSpeakerParticipantId: number | null;
}): NetworkMessage[] {
  const { messages, session, participants, activeSpeakerParticipantId } = p;
  const result: NetworkMessage[] = [];
  const participantMap = new Map(participants.map((pp) => [pp.participantId, pp]));

  for (const m of messages) {
    // 工具消息原样传递
    if (m.role === 'tool') {
      result.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? undefined,
      });
      continue;
    }
    if (m.role === 'system') {
      result.push({ role: 'system', content: m.content });
      continue;
    }

    const toolCalls = parseToolCalls(m.toolCallsJson);
    // 带工具调用的 assistant 消息始终为 assistant（不折叠）
    if (m.role === 'assistant' && toolCalls.length > 0) {
      result.push({
        role: 'assistant',
        content: sanitizeHistoryContentForModel(m.content),
        tool_calls: toolCalls,
      });
      continue;
    }

    const isGroup = session?.mode === 'GROUP';
    const speakerIsActive =
      m.speakerParticipantId != null && m.speakerParticipantId === activeSpeakerParticipantId;

    if (isGroup) {
      const isPlayer = m.role === 'user' && m.speakerParticipantId == null;
      if (m.role === 'assistant' && speakerIsActive) {
        result.push({
          role: 'assistant',
          content: sanitizeHistoryContentForModel(m.content),
        });
        continue;
      }
      // 折叠成 user 消息，前缀 [标签]
      const speaker = m.speakerParticipantId != null ? participantMap.get(m.speakerParticipantId) : undefined;
      const label = isPlayer || m.speakerParticipantId == null ? '用户' : (speaker?.displayName ?? m.speakerName ?? '用户');
      const text = buildContentWithAttachments(m.content, m.attachments);
      result.push({ role: 'user', content: `[${label}] ${text}` });
      continue;
    }

    // 非群聊
    result.push({
      role: m.role as NetworkMessage['role'],
      content: buildContentWithAttachments(sanitizeHistoryContentForModel(m.content), m.attachments),
    });
  }

  return result;
}

/** 附件转 data URL content parts（base64 图片/视频） */
function buildContentWithAttachments(content: string, attachments: string[]): string | NetworkMessage['content'] {
  if (!attachments || attachments.length === 0) {
    return content || null;
  }
  const parts: NonNullable<NetworkMessage['content']> = [];
  if (content) parts.push({ type: 'text', text: content });
  for (const url of attachments) {
    const isImage = /^data:image\//.test(url);
    parts.push({
      type: isImage ? 'image_url' : 'video_url',
      [isImage ? 'image_url' : 'video_url']: { url },
    });
  }
  return parts as NetworkMessage['content'];
}

function parseToolCalls(json: string): NonNullable<NetworkMessage['tool_calls']> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const result: NonNullable<NetworkMessage['tool_calls']> = [];
    for (const tc of arr) {
      if (!tc || typeof tc !== 'object') continue;
      // 已是标准网络格式（id/type/function）
      if (tc.id && tc.type === 'function' && tc.function && typeof tc.function === 'object') {
        const fn = tc.function as { name?: unknown; arguments?: unknown };
        result.push({
          id: String(tc.id),
          type: 'function',
          function: {
            name: String(fn.name ?? ''),
            arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
          },
        });
        continue;
      }
      // 内部 ToolCallRecord 格式（id/name/argumentsJson/contentOffset）
      if (tc.id && tc.name) {
        result.push({
          id: String(tc.id),
          type: 'function',
          function: {
            name: String(tc.name),
            arguments: typeof tc.argumentsJson === 'string' ? tc.argumentsJson : JSON.stringify(tc.argumentsJson ?? {}),
          },
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export { parseToolCalls };