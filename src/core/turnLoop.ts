import type { ChatParticipant, ChatSession, TurnOrderMode } from '../types/models';
import { NEW_TOPIC_MARKER } from './toolDefinitions';
import { translate } from './i18n';

// ============================================================
// 魔数命令（与 App 一致：/new 与 /pass）
// ============================================================

export interface MagicCommand {
  text: string;
  description: string;
}

export const MAGIC_COMMANDS: MagicCommand[] = [
  { text: '/new', description: '' },
  { text: '/pass', description: '' },
];

/** 获取命令描述（每次读取当前语言） */
export function commandDescription(text: string): string {
  return text === '/new' ? translate('chat.cmdNew') : translate('chat.cmdPass');
}

/** 精确匹配 /new 或 /pass（有附件时不生效） */
export function parseMagicCommand(text: string, hasAttachments: boolean): { text: string } | null {
  if (hasAttachments) return null;
  const trimmed = text.trim();
  const cmd = MAGIC_COMMANDS.find((c) => c.text === trimmed);
  return cmd ? { text: cmd.text } : null;
}

export function suggestMagicCommands(input: string): MagicCommand[] {
  if (!input.startsWith('/') || input.includes('\n')) return [];
  return MAGIC_COMMANDS.filter((c) => c.text.startsWith(input)).map((c) => ({
    text: c.text,
    description: commandDescription(c.text),
  }));
}

// ============================================================
// 回合循环（纯队列数学，与 App 的 TurnLoop.kt 一致）
// ============================================================

/** 初始化发言队列：全体成员（含玩家）按座位排序；RANDOM 洗牌 */
export function initializeTurnQueue(participants: ChatParticipant[], mode: TurnOrderMode): string[] {
  const sorted = [...participants].sort((a, b) => a.seatOrder - b.seatOrder);
  const ids = sorted.map((p) => String(p.participantId));
  if (mode === 'RANDOM') {
    return shuffle(ids);
  }
  return ids;
}

export function shuffle<T>(arr: T[]): T[] {
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

/**
 * 完成一轮发言：发言者（或 /pass 跳过的玩家）移出队列。
 * 被 @ 点名者若在队列中 → 移到队首；若不在队列中 → 插入队首。
 * 因此被点名者会立即（或优先）再次获得发言机会。
 */
export function completeTurn(
  queue: string[],
  speakerParticipantId: number,
  mentionedIds: number[]
): string[] {
  const rest = queue.filter((id) => id !== String(speakerParticipantId));
  const mentioned = [...new Set(mentionedIds.map(String))];
  const out = [...rest];
  for (const id of mentioned.reverse()) {
    out.splice(0, 0, id);
  }
  return out;
}

/** 玩家 /pass 跳过：将玩家移出队列，不修改任何对话历史 */
export function passPlayer(queue: string[], playerParticipantId: number): string[] {
  return queue.filter((id) => id !== String(playerParticipantId));
}

/** 刷新队列：为空时 loopIndex++ 并重新初始化；返回是否刚开启新循环 */
export function refreshQueue(
  session: Pick<ChatSession, 'turnOrderMode' | 'loopIndex' | 'turnQueueJson'>,
  participants: ChatParticipant[]
): { queue: string[]; loopIndex: number; loopStarted: boolean } {
  let queue = safeParseQueue(session.turnQueueJson);
  const validIds = new Set(participants.map((p) => String(p.participantId)));
  queue = queue.filter((id) => validIds.has(id));
  let loopIndex = session.loopIndex;
  let loopStarted = false;
  if (queue.length === 0) {
    loopIndex += 1;
    queue = initializeTurnQueue(participants, session.turnOrderMode);
    loopStarted = true;
  }
  return { queue, loopIndex, loopStarted };
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

// ============================================================
// 循环历史（完整初始顺序）辅助
// ============================================================

/** 解析循环历史 JSON（二维数组），失败返回空数组 */
export function safeParseQueueHistory(json: string): string[][] {
  try {
    const v = JSON.parse(json || '[]');
    if (Array.isArray(v) && v.every((x) => Array.isArray(x))) {
      return v.map((arr) => arr.map(String));
    }
    return [];
  } catch {
    return [];
  }
}

/** 序列化循环历史 → JSON */
export function queueHistoryJson(history: string[][]): string {
  return JSON.stringify(history);
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

/**
 * 解析当前应发言者（队首）。玩家（PLAYER）也参与队列。
 * 群聊中返回 null 表示当前队列为空（等待重新初始化 / 新的玩家输入）。
 */
export function resolveTurnSpeaker(
  session: Pick<ChatSession, 'mode' | 'turnOrderMode' | 'loopIndex' | 'turnQueueJson'>,
  participants: ChatParticipant[]
): { participant: ChatParticipant; queue: string[]; loopIndex: number } | null {
  if (session.mode !== 'GROUP') return null;
  const { queue, loopIndex } = refreshQueue(session, participants);
  if (queue.length === 0) return null;
  const id = parseInt(queue[0], 10);
  const participant = participants.find((p) => p.participantId === id);
  if (!participant) return null;
  return { participant, queue, loopIndex };
}

/**
 * 计算用于左侧「发言队列」展示的队列（含补全逻辑）：
 * - 队列非空 → 不解构，原样返回（含当前发言者）
 * - 队列为空（循环结束）→ 模拟下一循环的初始顺序（不加 loopIndex，仅展示）
 */
export function effectiveDisplayQueue(
  session: Pick<ChatSession, 'mode' | 'turnOrderMode' | 'loopIndex' | 'turnQueueJson'>,
  participants: ChatParticipant[]
): string[] {
  if (session.mode !== 'GROUP') return [];
  const { queue } = refreshQueue(session, participants);
  if (queue.length > 0) return queue;
  return initializeTurnQueue(participants, session.turnOrderMode);
}

/** 流式输出中的发言者标签：玩家 → 用户，NPC → 显示名 */
export function speakerLabel(p: ChatParticipant): string {
  return p.kind === 'PLAYER' ? translate('common.user') : p.displayName;
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