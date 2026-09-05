import type { ChatParticipant, ChatSession, TurnOrderMode } from '../types/models';
import { NEW_TOPIC_MARKER } from './toolDefinitions';

// ============================================================
// 魔数命令（与 App 一致：/new 与 /pass）
// ============================================================

export interface MagicCommand {
  text: string;
  description: string;
}

export const MAGIC_COMMANDS: MagicCommand[] = [
  { text: '/new', description: '开始新话题（截断上下文）' },
  { text: '/pass', description: '跳过本轮发言（群聊中）' },
];

/** 精确匹配 /new 或 /pass（有附件时不生效） */
export function parseMagicCommand(text: string, hasAttachments: boolean): { text: string } | null {
  if (hasAttachments) return null;
  const trimmed = text.trim();
  const cmd = MAGIC_COMMANDS.find((c) => c.text === trimmed);
  return cmd ? { text: cmd.text } : null;
}

export function suggestMagicCommands(input: string): MagicCommand[] {
  if (!input.startsWith('/') || input.includes('\n')) return [];
  return MAGIC_COMMANDS.filter((c) => c.text.startsWith(input));
}

// ============================================================
// 回合循环（纯队列数学，与 App 的 TurnLoop.kt 一致）
// ============================================================

/** 初始化发言队列：按座位排序；RANDOM 洗牌 */
export function initializeTurnQueue(participants: ChatParticipant[], mode: TurnOrderMode): string[] {
  const sorted = [...participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const ids = sorted.map((p) => String(p.participantId));
  if (mode === 'RANDOM') {
    return shuffle(ids);
  }
  return ids;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从文本中提取被 @ 提及的参与者 id（最长名称优先匹配） */
export function mentionedParticipantIds(
  text: string,
  participants: ChatParticipant[],
  speakerParticipantId: number
): number[] {
  const names = participants
    .filter((p) => p.participantId !== speakerParticipantId)
    .map((p) => p.displayName)
    .sort((a, b) => b.length - a.length);
  const found: number[] = [];
  for (const name of names) {
    // @名字 后跟空白或标点（中英文）
    const re = new RegExp(`@${escapeRegExp(name)}(?=\\s|[，。！？,.!?]|$)`);
    if (re.test(text)) {
      const p = participants.find((pp) => pp.displayName === name);
      if (p) found.push(p.participantId);
    }
  }
  return found;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 完成一轮发言：移除发言者，将被提及者按反向提及顺序置于队首 */
export function completeTurn(queue: string[], speakerParticipantId: number, mentionedIds: number[]): string[] {
  const rest = queue.filter((id) => id !== String(speakerParticipantId));
  const mentioned = [...new Set(mentionedIds.map(String))].reverse();
  return [...mentioned, ...rest];
}

/** 刷新队列：为空时 loopIndex++ 并重新初始化 */
export function refreshQueue(
  session: Pick<ChatSession, 'turnOrderMode' | 'loopIndex' | 'turnQueueJson'>,
  participants: ChatParticipant[]
): { queue: string[]; loopIndex: number } {
  let queue = safeParseQueue(session.turnQueueJson);
  const validIds = new Set(participants.map((p) => String(p.participantId)));
  queue = queue.filter((id) => validIds.has(id));
  let loopIndex = session.loopIndex;
  if (queue.length === 0) {
    loopIndex += 1;
    queue = initializeTurnQueue(participants, session.turnOrderMode);
  }
  // 若队列只含发言人自身（单人 NPC 会话），保持可用
  return { queue, loopIndex };
}

export function safeParseQueue(json: string): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function queueJson(queue: string[]): string {
  return JSON.stringify(queue);
}

/** 从参与者中取下一个发言人（队首） */
export function nextSpeaker(queue: string[], participantIdMap: Map<number, ChatParticipant>): ChatParticipant | null {
  while (queue.length > 0) {
    const id = parseInt(queue[0], 10);
    const p = participantIdMap.get(id);
    if (p) return p;
    queue.shift();
  }
  return null;
}

/** 流式输出中的发言者标签：玩家 → 用户，NPC → 显示名 */
export function speakerLabel(p: ChatParticipant): string {
  return p.kind === 'PLAYER' ? '用户' : p.displayName;
}

// ============================================================
// 工具函数
// ============================================================

export function parseIsoWithOffset(s: string): number | null {
  // 要求显式时区偏移（如 +08:00 / Z），避免浏览器按本地时区解析出歧义
  if (!/^[+-]\d{2}:?\d{2}$/.test(s.slice(-6).replace('Z', '+00:00'))) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 一个实用的 AI 工具调用 id 回退生成 */
export function fallbackToolCallId(index: number): string {
  return `call-${Date.now()}-${index}`;
}

let uid = 0;
export function uuid(): string {
  uid += 1;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${uid}`;
}

export const NEW_TOPIC_COMMAND = '/new';
export const PASS_COMMAND = '/pass';