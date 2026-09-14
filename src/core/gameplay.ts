// ============================================================
// 游戏导出 / 导入（完全重建）
// ============================================================
// 把一次「游戏局」完整导出为独立 JSON 文件：
// - 会话设置（模式 / 标题 / 世界书关联 / 用户人设 / 发言顺序 / 开场白开关 / 队列&循环历史）
// - 全部参与 NPC（角色卡：人设 / 开场白 / 头像 / 启用的技能）
// - 全部涉及的工具（生成式技能：OpenAI tool JSON + 声明式实现）
// - 对话历史（可选）：消息 / 参与者 / 队列与循环索引完全复原
// 导入时反向重建：先建工具 → 再建角色与回调映射 → 再建世界书（会话引用其新 id）→
// 再建会话与参与者 → 最后批量写入消息（保留顺序与相对间隔）。
// 幂等：技能 / 角色 / 世界书 / 用户人设不与现有对象合并——名称冲突时创建「 (2)」副本，
// 绝不覆盖用户已有数据；会话始终新建。
// 格式版本号：1
// ============================================================

import { db } from '../db/database';
import type {
  ChatMessage,
  ChatParticipant,
  ChatSession,
  McpTool,
  NpcCharacter,
  WorldBook,
} from '../types/models';
import { saveJsonFile, type SaveResult } from './fileDownload';

export const GAMEPLAY_EXPORT_VERSION = 1;
const GAMEPLAY_FORMAT = 'tavern-harness-gameplay';

/** 参与会话的角色：角色卡全量快照 + 会话内显示名 */
export interface GameplayNpc {
  npc: NpcCharacter;
  /** 会话参与者表中的显示名（可能与会话创建后角色改名不同） */
  sessionDisplayName: string;
}

/** 游戏导出文件结构 */
export interface GameplayExportPayload {
  format: typeof GAMEPLAY_FORMAT;
  version: number;
  exportedAt: number;
  appName: 'Tavern Harness';
  title: string;
  includeHistory: boolean;
  /** 会话设置（无 id 与 lastMessage；队列/循环历史按参与者旧 id 记录） */
  session: Omit<ChatSession, 'id' | 'lastMessage'>;
  /** 会话内参与记录（源 participantId → 席位/显示名，玩家恒定 -1） */
  sessionParticipants: ChatParticipant[];
  /** 参与会话的角色卡快照（含会话内显示名） */
  npcs: GameplayNpc[];
  /** 对话历史消息（仅重建所需字段，id 在导入时重建） */
  messages: ReturnType<typeof sanitizeMessage>[];
  /** 会话引用的世界书（worldBookId 关联） */
  worldBook?: WorldBook;
  /** 会话引用的用户人设（userPersonaNpcId 关联） */
  userPersona?: NpcCharacter;
  /** 会话涉及的生成式技能（NPC 启用列表 ∪ 历史消息工具记录；不含内置技能） */
  tools: McpTool[];
}

// ---------------------------------------------------------------------------
// 内部帮助函数
// ---------------------------------------------------------------------------

async function loadMessages(sessionId: number): Promise<ChatMessage[]> {
  return db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
}

/** 从会话历史消息中收集实际出现过的工具调用名 */
function collectToolNamesFromMessages(messages: ChatMessage[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    try {
      const calls = JSON.parse(m.toolCallsJson || '[]') as Array<{ name?: string }>;
      for (const c of calls) if (c.name) names.add(c.name);
    } catch {
      /* ignore */
    }
  }
  return names;
}

/** 字符串是否为有效的内嵌 data URL */
export function isDataUrl(s: string | null | undefined): boolean {
  return Boolean(s && s.startsWith('data:'));
}

/** 不影响重建对话的字段：性能 / 调试 / 运行时细节，导出时直接移除
 *  （toolCallsJson 必须保留：工具调用卡片与工具结果关联都依赖它） */
function sanitizeMessage(m: ChatMessage) {
  const {
    sessionId: _sessionId,
    latencyMs: _latencyMs,
    promptTokens: _promptTokens,
    completionTokens: _completionTokens,
    totalTokens: _totalTokens,
    tokensPerSec: _tokensPerSec,
    modelUsed: _modelUsed,
    attachmentInfos: _attachmentInfos,
    rawRequestBody: _rawRequestBody,
    rawResponseBody: _rawResponseBody,
    ...rest
  } = m;
  void _sessionId;
  void _latencyMs;
  void _promptTokens;
  void _completionTokens;
  void _totalTokens;
  void _tokensPerSec;
  void _modelUsed;
  void _attachmentInfos;
  void _rawRequestBody;
  void _rawResponseBody;
  return rest;
}

function sanitizeSession(session: ChatSession): Omit<ChatSession, 'id' | 'lastMessage'> {
  const { id: _id, lastMessage: _last, ...rest } = session;
  void _id;
  void _last;
  return rest;
}

function safeFileName(title: string): string {
  return (title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'gameplay') + '-gameplay.json';
}

/** 队列 JSON 里的参与者 id 是字符串（'-1' = 玩家，其余为 NPC 的 participantId）。
 *  导入后 NPC 的 participantId 变为新 npc id，因此逐 token 替换队列字符串。 */
function remapQueueJson(value: string, map: Map<number, number>): string {
  if (!value || map.size === 0) return value;
  return value.replace(/"(-?\d+)"/g, (match, raw: string) => {
    const num = Number(raw);
    if (Number.isInteger(num)) {
      const mapped = map.get(num);
      if (mapped != null) return `"${mapped}"`;
    }
    return match;
  });
}

/** 生成一个不与现有条目重名的名称：重名时追加「 (2)」「 (3)」… */
async function uniqueName(
  table: 'npcs' | 'worldBooks' | 'tools',
  name: string
): Promise<string> {
  const count = (n: string) =>
    db[table].where('name').equals(n).count();
  if ((await count(name)) === 0) return name;
  let i = 2;
  for (;;) {
    const candidate = `${name} (${i})`;
    if ((await count(candidate)) === 0) return candidate;
    i += 1;
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export interface ExportGameplayOptions {
  sessionId: number;
  includeHistory: boolean;
}

/**
 * 导出会话游戏为 JSON 文件（弹出保存对话框）。
 * 返回：'saved' 保存成功 / 'downloaded' 已下载到默认目录 / 'canceled' 用户取消
 */
export async function exportGameplay({ sessionId, includeHistory }: ExportGameplayOptions): Promise<SaveResult> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('会话不存在');

  const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
  const messages = includeHistory ? await loadMessages(sessionId) : [];

  // 参与角色（按座位顺序）
  const npcIds = participants
    .filter((p) => p.kind === 'NPC' && p.npcId != null)
    .sort((a, b) => a.seatOrder - b.seatOrder)
    .map((p) => p.npcId!);
  if (session.associatedId != null && !npcIds.includes(session.associatedId)) {
    npcIds.unshift(session.associatedId);
  }

  const npcs: GameplayNpc[] = [];
  for (const npcId of npcIds) {
    const npc = await db.npcs.get(npcId);
    if (!npc) continue;
    const participant = participants.find((p) => p.kind === 'NPC' && p.npcId === npcId);
    npcs.push({ npc, sessionDisplayName: participant?.displayName ?? npc.name });
  }

  const worldBook = session.worldBookId != null
    ? (await db.worldBooks.get(session.worldBookId)) ?? undefined
    : undefined;
  const userPersona = session.userPersonaNpcId != null
    ? (await db.npcs.get(session.userPersonaNpcId)) ?? undefined
    : undefined;

  // 涉及技能：NPC 启用列表 ∪ 历史消息工具调用
  const toolNames = new Set<string>();
  for (const n of npcs) for (const name of n.npc.enabledToolNames) toolNames.add(name);
  for (const name of collectToolNamesFromMessages(messages)) toolNames.add(name);

  const allTools = await db.tools.toArray();
  const tools = allTools
    .filter((t) => !t.isBuiltIn && toolNames.has(t.name))
    .map((t) => stripToolId(t));

  const payload: GameplayExportPayload = {
    format: GAMEPLAY_FORMAT,
    version: GAMEPLAY_EXPORT_VERSION,
    exportedAt: Date.now(),
    appName: 'Tavern Harness',
    title: session.title,
    includeHistory,
    session: sanitizeSession(session),
    sessionParticipants: participants,
    messages: messages.map(sanitizeMessage),
    npcs,
    worldBook,
    userPersona,
    tools,
  };

  return saveJsonFile(payload, safeFileName(session.title));
}

/** 去除工具表的自增 id（导入时重建） */
function stripToolId(tool: McpTool): Omit<McpTool, 'id'> {
  const { id: _id, ...rest } = tool;
  void _id;
  return rest;
}

/** 把消息的 toolCallsJson 中的工具调用名重映射到副本名（工具重名被改为「 (2)」时） */
function remapToolCallsJson(value: string | undefined, map: Map<string, string>): string {
  if (!value || map.size === 0) return value || '[]';
  try {
    const calls = JSON.parse(value) as Array<{ name?: string }>;
    if (!Array.isArray(calls)) return value;
    let changed = false;
    for (const c of calls) {
      if (c && typeof c.name === 'string') {
        const mapped = map.get(c.name);
        if (mapped && mapped !== c.name) {
          c.name = mapped;
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(calls) : value;
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

export interface ImportGameplayResult {
  sessionId: number;
  sessionTitle: string;
  createdNpcs: number;
  importedWorldBook: boolean;
  importedPersona: boolean;
  importedTools: number;
  importedMessages: number;
}

/**
 * 把游戏导出 JSON 完全重建为可游玩的会话。
 * 返回统计信息；失败抛出带信息的 Error。
 */
export async function importGameplay(payload: unknown): Promise<ImportGameplayResult> {
  const data = parseGameplayPayload(payload);

  // ---- 1. 工具（生成式技能）：重名不覆盖，创建独立副本 ----
  // toolNameMap：源工具名 → 副本最终名，供 NPC enabledToolNames / 消息记录重映射
  let importedTools = 0;
  const toolNameMap = new Map<string, string>();
  for (const tool of data.tools) {
    if (!tool.name) continue;
    const finalName = await uniqueName('tools', tool.name);
    toolNameMap.set(tool.name, finalName);
    await db.tools.add({
      name: finalName,
      jsonContent: tool.jsonContent,
      executionJson: tool.executionJson ?? null,
      isBuiltIn: false,
      origin: 'imported',
      createdAt: Date.now(),
      displayOrder: (await db.tools.count()) + 1,
    });
    importedTools += 1;
  }

  // ---- 2. 角色（NPC）与用户人设：重名不覆盖，创建副本；保留源 id → 新 id 映射 ----
  const sourceNpcIdToNew = new Map<number, number>();
  let createdNpcs = 0;
  const createNpcCopy = async (source: NpcCharacter): Promise<number | null> => {
    if (!source || !source.name) return null;
    if (source.id != null && sourceNpcIdToNew.has(source.id)) return sourceNpcIdToNew.get(source.id)!;
    const finalName = await uniqueName('npcs', source.name);
    const id = await db.npcs.add({
      name: finalName,
      prompt: source.prompt ?? '',
      greeting: source.greeting ?? '',
      alternateGreetings: source.alternateGreetings ?? [],
      avatarColorOrdinal: source.avatarColorOrdinal ?? 0,
      avatarDataUrl: source.avatarDataUrl ?? null,
      enabledToolNames: (source.enabledToolNames ?? []).map((n) => toolNameMap.get(n) ?? n),
      isBuiltIn: false,
      createdAt: Date.now(),
    });
    if (source.id != null) sourceNpcIdToNew.set(source.id, id);
    createdNpcs += 1;
    return id;
  };

  // 参与角色按导出顺序登记
  for (const entry of data.npcs) {
    await createNpcCopy(entry.npc);
  }

  // 用户人设角色
  let personaNpcId: number | null = null;
  if (data.userPersona) {
    personaNpcId = await createNpcCopy(data.userPersona);
  }

  // ---- 3. 世界书：重名不覆盖，创建副本 ----
  let importedWorldBook = false;
  let worldBookId: number | null = null;
  if (data.worldBook && data.worldBook.name) {
    const finalName = await uniqueName('worldBooks', data.worldBook.name);
    worldBookId = await db.worldBooks.add({
      name: finalName,
      content: data.worldBook.content ?? '',
      imageUri: null,
      createdAt: Date.now(),
    });
    importedWorldBook = true;
  }

  // ---- 4. 会话 ----
  const src = data.session;
  const title = data.title?.trim() || src.title || '导入的游戏';
  const sessionId = await db.sessions.add({
    title,
    mode: src.mode === 'NPC' || src.mode === 'GROUP' ? src.mode : 'STANDARD',
    associatedId: null,
    worldBookId,
    userPersonaNpcId: personaNpcId,
    enableGreeting: src.enableGreeting !== false,
    turnOrderMode: src.turnOrderMode === 'RANDOM' ? 'RANDOM' : 'PRESET',
    workspaceDir: null, // 导入的会话分配全新的独立工作目录，不继承源导出文件
    turnQueueJson: remapQueueJson(src.turnQueueJson || '[]', sourceNpcIdToNew),
    turnQueueHistoryJson: remapQueueJson(src.turnQueueHistoryJson || '[]', sourceNpcIdToNew),
    loopIndex: Number.isFinite(src.loopIndex) ? src.loopIndex : 0,
    pinned: 0,
    lastMessage: '',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  });
  // 会话专属工作目录（session-<id>，单层目录、不嵌套）
  await db.sessions.update(sessionId, { workspaceDir: `session-${sessionId}` });

  // ---- 5. 参与者（玩家恒定 -1；NPC participantId = 新 npc id，保持座位顺序） ----
  const participants: ChatParticipant[] = [];
  participants.push({
    sessionId,
    participantId: -1,
    kind: 'PLAYER',
    npcId: null,
    displayName: '用户',
    seatOrder: 0,
  });
  const sortedSrcParticipants = [...data.sessionParticipants].sort((a, b) => a.seatOrder - b.seatOrder);
  for (const sp of sortedSrcParticipants) {
    if (sp.kind !== 'NPC' || sp.npcId == null) continue;
    const newNpcId = sourceNpcIdToNew.get(sp.npcId) ?? null;
    if (newNpcId == null) continue;
    participants.push({
      sessionId,
      participantId: newNpcId,
      kind: 'NPC',
      npcId: newNpcId,
      displayName: sp.displayName || '',
      seatOrder: participants.length,
    });
  }
  await db.participants.bulkAdd(participants);

  // 会话关联角色（NPC 模式）
  const npcParts = participants.filter((p) => p.kind === 'NPC');
  await db.sessions.update(sessionId, {
    associatedId: npcParts.length === 1 ? npcParts[0].npcId : null,
    mode: npcParts.length === 1 ? 'NPC' : 'GROUP',
  });

  // ---- 6. 消息（保留顺序与相对间隔，id 重建） ----
  // 注意：导出时已剔除性能/调试字段（tokens、latency、model、raw body、attachmentInfos），
  // 此处为所有非导出字段补齐默认值，兼容旧版导出文件。
  let importedMessages = 0;
  if (data.messages.length > 0) {
    const sorted = [...data.messages].sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = sorted[0]?.timestamp ?? Date.now();
    const baseTime = Date.now() - (sorted.length - 1) * 30_000;
    for (const m of sorted) {
      const speaker = m.speakerParticipantId == null
        ? null
        : m.speakerParticipantId === -1
          ? -1
          : sourceNpcIdToNew.get(m.speakerParticipantId) ?? null;
      const row: ChatMessage = {
        sessionId,
        role: m.role,
        speakerParticipantId: speaker,
        speakerName: m.speakerName ?? null,
        content: m.content ?? '',
        toolCallsJson: remapToolCallsJson(m.toolCallsJson || '[]', toolNameMap),
        toolCallId: m.toolCallId ?? null,
        thinkingContent: m.thinkingContent ?? null,
        loopIndex: m.loopIndex ?? null,
        timestamp: baseTime + Math.max(0, (m.timestamp ?? firstTs) - firstTs),
        latencyMs: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokensPerSec: null,
        modelUsed: null,
        attachments: m.attachments ?? [],
        attachmentInfos: [],
        displayRef: m.displayRef ?? null,
        rawRequestBody: null,
        rawResponseBody: null,
      };
      await db.messages.add(row);
      importedMessages += 1;
    }
    // 会话预览
    const lastVisible = [...sorted].reverse().find((m) => m.role !== 'tool');
    if (lastVisible && lastVisible.content) {
      await db.sessions.update(sessionId, { lastMessage: lastVisible.content.slice(0, 60) });
    }
  }

  // ---- 7. 收尾：刷新 store ----
  const store = await import('../store/store');
  await store.useStore.getState().refreshNpcs();
  await store.useStore.getState().refreshWorldBooks();
  await store.useStore.getState().refreshTools();
  await store.useStore.getState().refreshSessions();

  return {
    sessionId,
    sessionTitle: title,
    createdNpcs,
    importedWorldBook,
    importedPersona: Boolean(personaNpcId),
    importedTools,
    importedMessages,
  };
}

/** 校验并规范化游戏导出结构；失败抛出带信息的 Error */
function parseGameplayPayload(payload: unknown): GameplayExportPayload {
  if (!payload || typeof payload !== 'object') throw new Error('无效的游戏文件');
  const p = payload as Partial<GameplayExportPayload> & { participants?: ChatParticipant[] };
  if (p.format !== GAMEPLAY_FORMAT) {
    throw new Error('不是 Tavern Harness 游戏导出文件');
  }
  const session = p.session as Partial<ChatSession> | undefined;
  if (!session || typeof session !== 'object' || !session.mode) {
    throw new Error('游戏文件缺少会话信息');
  }
  return {
    format: GAMEPLAY_FORMAT,
    version: typeof p.version === 'number' ? p.version : 0,
    exportedAt: typeof p.exportedAt === 'number' ? p.exportedAt : 0,
    appName: 'Tavern Harness',
    title: typeof p.title === 'string' ? p.title : (session.title ?? ''),
    includeHistory: p.includeHistory !== false,
    session: session as Omit<ChatSession, 'id' | 'lastMessage'>,
    sessionParticipants: Array.isArray(p.sessionParticipants)
      ? p.sessionParticipants
      : Array.isArray(p.participants)
        ? p.participants
        : [],
    messages: Array.isArray(p.messages) ? p.messages : [],
    npcs: Array.isArray(p.npcs) ? p.npcs : [],
    worldBook: p.worldBook,
    userPersona: p.userPersona,
    tools: Array.isArray(p.tools) ? p.tools : [],
  };
}