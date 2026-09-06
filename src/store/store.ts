import { create } from 'zustand';
import { db } from '../db/database';
import type {
  ApiProvider,
  AppSettings,
  ChatMessage,
  ChatParticipant,
  ChatSession,
  ToolConfirmationRequest,
  WorldBook,
  NpcCharacter,
  McpTool,
} from '../types/models';
import { streamChatCompletions, buildChatRequest } from '../core/openai';
import {
  buildGroupSystemPrompt,
  buildNetworkMessagesForSession,
  buildNpcSystemPrompt,
  STANDARD_SYSTEM_PROMPT,
} from '../core/prompts';
import {
  completeTurn,
  initializeTurnQueue,
  mentionedParticipantIds,
  parseMagicCommand,
  passPlayer,
  queueHistoryJson,
  queueJson,
  refreshQueue,
  safeParseQueue,
  safeParseQueueHistory,
} from '../core/turnLoop';
import type { ChatCompletionRequest, TurnOrderMode } from '../types/models';
import { NEW_TOPIC_MARKER, MAX_TOOL_CALL_DEPTH } from '../core/toolDefinitions';
import { getEnabledToolsForSession, executeToolCall } from '../core/tools/toolExecutor';
import { scheduleRestoredTasks } from '../core/tools/toolExecutor';
import { applyTheme as applyThemeManual } from '../theme/theme';
import { setLanguage, translate } from '../core/i18n';
import { estimateTokensFromChars, accumulateStats, sessionPreviewText } from '../core/stats';
import { ACHIEVEMENTS, registerUnlockDispatcher, type AchievementDef } from '../core/achievements';

// ============================================================
// Store（对应 MainViewModel）
// ============================================================

export type ActiveView = 'chat' | 'characters' | 'settings' | 'stats' | 'achievements';

interface StreamingState {
  sessionId: number | null;
  abort: AbortController | null;
}

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export interface AchievementState {
  def: AchievementDef;
  unlockedAt: number | null;
}

interface AppState {
  initialized: boolean;
  settings: AppSettings | null;
  providers: ApiProvider[];
  npcs: NpcCharacter[];
  sessions: ChatSession[];
  worldBooks: WorldBook[];
  tools: McpTool[];
  messages: Record<number, ChatMessage[]>;
  participants: Record<number, ChatParticipant[]>;
  achievements: AchievementState[];
  /** 生涯总 token（输入 + 输出），实时刷新用于成就进度展示 */
  careerTotalTokens: number | null;

  activeSessionId: number | null;
  activeView: ActiveView;

  streaming: StreamingState;
  pendingConfirmation: ToolConfirmationRequest | null;

  /** 群聊实时队列快照（与 DB 同步更新，面板订阅此值实现实时指示） */
  liveQueueBySession: Record<number, {
    /** 当前循环剩余队列（队首 = 正在发言/下一发言者） */
    queue: string[];
    /** 各循环完整初始顺序历史（含当前循环） */
    history: string[][];
    loopIndex: number;
    turnOrderMode: TurnOrderMode;
  }>;

  toasts: Toast[];

  init: () => Promise<void>;
  setSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setActiveSession: (id: number | null) => void;
  setActiveView: (v: ActiveView) => void;

  sendMessage: (text: string, attachments?: string[], attachmentNames?: string[]) => Promise<void>;
  regenerateLast: () => Promise<void>;
  editMessage: (messageId: number, newContent: string, sessionId: number, newAttachments?: string[], newAttachmentNames?: string[]) => Promise<void>;
  saveMessageOnly: (messageId: number, newContent: string, sessionId: number, newAttachments?: string[], newAttachmentNames?: string[]) => Promise<void>;
  stopStreaming: () => void;
  deleteSession: (id: number) => Promise<void>;
  resolveConfirmation: (approved: boolean) => void;
  setTurnOrderMode: (sessionId: number, mode: TurnOrderMode) => Promise<void>;
  reorderParticipants: (sessionId: number, participantIdsInOrder: number[]) => Promise<void>;
  moveParticipant: (sessionId: number, participantId: number, newSeat: number) => Promise<void>;
  /** 用 DB 最新数据刷新某会话的队列快照（面板实时源） */
  refreshLiveQueue: (sessionId: number) => Promise<void>;
  /** 清除某会话的队列快照（会话删除时） */
  clearLiveQueue: (sessionId: number) => void;

  refreshSessions: () => Promise<void>;
  refreshNpcs: () => Promise<void>;
  refreshWorldBooks: () => Promise<void>;
  refreshTools: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshAchievements: () => Promise<void>;
  loadMessages: (sessionId: number) => Promise<void>;

  /** 聚合所有启用 Provider 的模型列表（与 App 的 aggregateEnabledProviderModels 一致） */
  modelsList: string[];
  refreshModelsList: () => Promise<void>;
  selectModel: (model: string) => Promise<void>;

  addToast: (message: string, kind?: 'info' | 'error') => void;
  removeToast: (id: number) => void;
}

let toastSeq = 0;
let initLock: Promise<void> | null = null;
/** 用户主动停止生成时置位，用于中断群聊循环 */
let groupLoopStopped = false;

export const useStore = create<AppState>((set, get) => ({
  initialized: false,
  settings: null,
  providers: [],
  npcs: [],
  sessions: [],
  worldBooks: [],
  tools: [],
  messages: {},
  participants: {},
  achievements: [],
  careerTotalTokens: null,

  activeSessionId: null,
  activeView: 'chat',
  modelsList: [],

  streaming: { sessionId: null, abort: null },
  pendingConfirmation: null,

  liveQueueBySession: {},

  toasts: [],

  init: async () => {
    // StrictMode 双调用保护
    if (initLock) return initLock;
    initLock = (async () => {
      const settings = (await db.settings.get(1))!;
      setLanguage(settings.language ?? null);
      const npcs = await db.npcs.toArray();
      const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
      const worldBooks = await db.worldBooks.toArray();
      const tools = await db.tools.toArray();
      set({ initialized: true, settings, npcs, sessions, worldBooks, tools });
      await get().refreshProviders();
      applyThemeManual(settings.themeMode, settings.themeColor);
      await scheduleRestoredTasks();
      await get().refreshAchievements();
      // 不自动创建会话：由用户通过左下角「新建」或仪表盘入口创建
      if (sessions.length > 0) {
        set({ activeSessionId: sessions[0].id! });
        await get().loadMessages(sessions[0].id!);
        await get().refreshLiveQueue(sessions[0].id!);
      } else {
        set({ activeSessionId: null, activeView: 'chat' });
      }
    })();
    return initLock;
  },

  setSettings: async (partial) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...partial };
    await db.settings.put(next);
    set({ settings: next });
    if (partial.language !== undefined) {
      setLanguage(next.language ?? null);
    }
    applyThemeManual(next.themeMode, next.themeColor);
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id, activeView: 'chat' });
    if (id != null) {
      get().loadMessages(id);
      get().refreshLiveQueue(id);
    }
  },

  setActiveView: (v) => set({ activeView: v }),

  refreshSessions: async () => {
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    set({ sessions });
  },

  refreshNpcs: async () => {
    set({ npcs: await db.npcs.toArray() });
  },

  refreshWorldBooks: async () => {
    set({ worldBooks: await db.worldBooks.toArray() });
  },

  refreshTools: async () => {
    set({ tools: await db.tools.toArray() });
  },

  refreshAchievements: async () => {
    const unlocked = await db.achievementUnlocks.toArray();
    const byId = new Map(unlocked.map((u) => [u.achievementId, u.unlockedAt]));
    set({
      achievements: ACHIEVEMENTS.map((def) => ({
        def,
        unlockedAt: byId.get(def.id) ?? null,
      })),
    });
    const stats = (await db.careerStats.get(1)) ?? { id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 };
    set({ careerTotalTokens: stats.inputTokens + stats.outputTokens });
  },

  refreshProviders: async () => {
    const providers = await db.providers.toArray();
    set({ providers });
    // 同步聚合模型列表
    const models = aggregateEnabledProviderModels(providers);
    set({ modelsList: models });
    // 若当前默认模型不在列表、但列表非空，自动取第一个
    const current = get().settings;
    if (current) {
      const enabledProviders = providers.filter((p) => p.isEnabled && p.baseUrl.trim());
      const next: Partial<AppSettings> = {};
      // 唯一启用 Provider 时自动设为默认
      if (enabledProviders.length === 1 && current.defaultProviderId !== enabledProviders[0].id) {
        next.defaultProviderId = enabledProviders[0].id ?? null;
      }
      const selected = current.defaultModel.trim();
      if ((!selected || !models.includes(selected)) && models.length > 0) {
        next.defaultModel = models[0];
      }
      if (Object.keys(next).length > 0) {
        const updated = { ...current, ...next };
        await db.settings.put(updated);
        set({ settings: updated });
      }
    }
  },

  refreshModelsList: async () => {
    const providers = await db.providers.toArray();
    set({ modelsList: aggregateEnabledProviderModels(providers) });
  },

  selectModel: async (model) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, defaultModel: model };
    await db.settings.put(next);
    set({ settings: next });
  },

  loadMessages: async (sessionId) => {
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
    set((s) => ({
      messages: { ...s.messages, [sessionId]: messages },
      participants: { ...s.participants, [sessionId]: participants },
    }));
  },

  sendMessage: async (text, attachments = [], attachmentNames = []) => {
    const sessionId = get().activeSessionId;
    if (sessionId == null) return;
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (get().streaming.sessionId != null) {
      get().addToast(translate('toast.busy'), 'error');
      return;
    }

    // 魔法命令（有附件时不生效）
    const cmd = parseMagicCommand(text, attachments.length > 0);
    if (cmd) {
      await handleMagicCommand(session, cmd.text);
      await get().refreshSessions();
      return;
    }

    // 保存用户消息（若在群聊中轮到玩家，同时将其移出队列）
    const attachInfos = attachments.map((a, i) => ({
      mimeType: a.startsWith('data:image') ? 'image/png' : 'video/mp4',
      displayName: attachmentNames[i]?.trim() || translate('common.attachment'),
      sizeBytes: a.length,
    }));
    const userMsg: ChatMessage = {
      sessionId,
      role: 'user',
      speakerParticipantId: null,
      speakerName: null,
      content: text,
      toolCallsJson: '[]',
      toolCallId: null,
      thinkingContent: null,
      // 群聊：用户发言归属于当前循环（用于对话↔队列联动滚动定位）
      loopIndex: session.mode === 'GROUP' ? currentLoopIndexOf(session) : null,
      timestamp: Date.now(),
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensPerSec: null,
      modelUsed: null,
      attachments,
      attachmentInfos: attachInfos,
      rawRequestBody: null,
      rawResponseBody: null,
    };
    await db.messages.add(userMsg);
    await db.sessions.update(sessionId, { updatedAt: Date.now(), lastMessage: sessionPreviewText(text) });
    await get().loadMessages(sessionId);
    await get().refreshSessions();

    if (session.mode === 'GROUP') {
      // 群聊：玩家始终是队列正式成员（默认队首）。轮到玩家时输入 → 将玩家移出队列，
      // 其余成员继续发言；@点名也能让目标优先/立即发言。
      const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
      const fresh = (await db.sessions.get(sessionId)) ?? session;
      const { queue, loopIndex, loopStarted } = refreshQueue(fresh, participants);
      const player = participants.find((p) => p.kind === 'PLAYER') ?? { participantId: -1 } as ChatParticipant;
      const playerId = player.participantId.toString();
      const isPlayerQueued = queue.includes(playerId);
      const next = isPlayerQueued
        ? completeTurn(queue, player.participantId, mentionedParticipantIds(text, participants, player.participantId))
        : queue;
      // 边界时 queue 为全新完整顺序 → persistQueue 会把它追加进循环历史
      await persistQueue(sessionId, next, loopIndex, loopStarted);
      await get().refreshLiveQueue(sessionId);
      await continueGroupConversation(sessionId);
      return;
    }

    await runConversationLoop(session);
  },

  regenerateLast: async () => {
    const sessionId = get().activeSessionId;
    if (sessionId == null) return;
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (get().streaming.sessionId != null) return;

    // 找到最后一条 assistant 消息，删除它及之后的 tool 消息
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    const cutTime = lastAssistant.timestamp;
    const toDelete = messages.filter((m) => m.timestamp >= cutTime);
    await db.messages.bulkDelete(toDelete.map((m) => m.id!));
    await get().loadMessages(sessionId);

    await runConversationLoop(session);
    await get().refreshSessions();
  },

  editMessage: async (messageId, newContent, sessionId, newAttachments?: string[], newAttachmentNames?: string[]) => {
    if (get().streaming.sessionId != null) return;
    const message = await db.messages.get(messageId);
    if (!message) return;
    // 编辑该消息，删除它之后的所有消息（不含自身）
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const toDelete = messages.filter(
      (m) => m.timestamp > message.timestamp || (m.timestamp === message.timestamp && m.id !== messageId)
    );
    await db.messages.bulkDelete(toDelete.map((m) => m.id!));
    const attachments = newAttachments ?? message.attachments;
    const attachmentInfos = (newAttachments != null ? newAttachments : message.attachments).map((a, i) => ({
      mimeType: a.startsWith('data:image') ? 'image/png' : 'video/mp4',
      displayName: (newAttachmentNames?.[i]?.trim()) || message.attachmentInfos?.[i]?.displayName || translate('common.attachment'),
      sizeBytes: a.length,
    }));
    await db.messages.update(messageId, { content: newContent, attachments, attachmentInfos });
    await get().loadMessages(sessionId);
    await runConversationLoop((await db.sessions.get(sessionId))!);
    await get().refreshSessions();
  },

  saveMessageOnly: async (messageId, newContent, sessionId, newAttachments?: string[], newAttachmentNames?: string[]) => {
    if (get().streaming.sessionId != null) return;
    const message = await db.messages.get(messageId);
    if (!message) return;
    const attachments = newAttachments ?? message.attachments;
    const attachmentInfos = (newAttachments != null ? newAttachments : message.attachments).map((a, i) => ({
      mimeType: a.startsWith('data:image') ? 'image/png' : 'video/mp4',
      displayName: (newAttachmentNames?.[i]?.trim()) || message.attachmentInfos?.[i]?.displayName || translate('common.attachment'),
      sizeBytes: a.length,
    }));
    // 仅修改本条消息内容，不删除任何后续消息、不触发重新生成
    await db.messages.update(messageId, { content: newContent, attachments, attachmentInfos });
    await get().loadMessages(sessionId);
    await get().refreshSessions();
  },

  stopStreaming: () => {
    const abort = get().streaming.abort;
    if (abort) {
      groupLoopStopped = true;
      abort.abort();
    }
  },

  deleteSession: async (id) => {
    await db.messages.where('sessionId').equals(id).delete();
    await db.participants.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
    if (get().activeSessionId === id) set({ activeSessionId: null });
    get().clearLiveQueue(id);
    await get().refreshSessions();
  },

  resolveConfirmation: (approved) => {
    const req = get().pendingConfirmation;
    if (!req) return;
    const d = confirmationDeferreds.get(req);
    if (d) d.resolve(approved);
    set({ pendingConfirmation: null });
  },

  /** 切换群聊发言顺序模式（PRESET 固定座位 / RANDOM 每循环洗牌）。
   * 只更新模式本身：不重置当前队列、不动循环历史、不改 loopIndex，
   * 因此不影响当前循环与队列面板的历史展示；新顺序在进入下一轮循环
   * （队列为空重建）时生效，并由 persistQueue 追加到循环历史末尾。 */
  setTurnOrderMode: async (sessionId, mode) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    await db.sessions.update(sessionId, { turnOrderMode: mode });
    await get().refreshSessions();
    await get().refreshLiveQueue(sessionId);
  },

  /** 保存群聊成员的固定座位顺序（由排序弹窗拖动产生） */
  reorderParticipants: async (sessionId, participantIdsInOrder) => {
    const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
    const seatById = new Map<string, number>();
    participantIdsInOrder.forEach((id, i) => seatById.set(String(id), i));
    let changed = false;
    for (const p of participants) {
      const seat = seatById.get(String(p.participantId));
      if (seat != null && seat !== p.seatOrder) {
        await db.participants.update(p, { seatOrder: seat });
        changed = true;
      }
    }
    if (changed) {
      await get().loadMessages(sessionId);
      await get().refreshSessions();
      await get().refreshLiveQueue(sessionId);
    }
  },

  /** 单个成员移动到新座位（拖拽重排时交互式更新，保持其余成员相对位置） */
  moveParticipant: async (sessionId, participantId, newSeat) => {
    const participants = (await db.participants.where('sessionId').equals(sessionId).toArray()).sort(
      (a, b) => a.seatOrder - b.seatOrder
    );
    const idx = participants.findIndex((p) => p.participantId === participantId);
    if (idx < 0) return;
    const [moved] = participants.splice(idx, 1);
    const clamped = Math.max(0, Math.min(newSeat, participants.length));
    participants.splice(clamped, 0, moved);
    for (let i = 0; i < participants.length; i++) {
      if (participants[i].seatOrder !== i) {
        await db.participants.update(participants[i], { seatOrder: i });
      }
    }
    await get().loadMessages(sessionId);
    await get().refreshSessions();
    await get().refreshLiveQueue(sessionId);
  },

  /** 用 DB 最新队列刷新快照（群聊面板的实时数据源） */
  refreshLiveQueue: async (sessionId) => {
    const session = await db.sessions.get(sessionId);
    if (!session) {
      get().clearLiveQueue(sessionId);
      return;
    }
    const history = await ensureLoopHistory(sessionId);
    const parts = await db.participants.where('sessionId').equals(sessionId).toArray();
    // 展示用：队首仅用于「正在发言」指示；队列本身以循环历史为准
    const queue = safeParseQueue(session.turnQueueJson).filter((id) =>
      parts.some((p) => String(p.participantId) === id)
    );
    set((s) => ({
      liveQueueBySession: {
        ...s.liveQueueBySession,
        [sessionId]: {
          queue,
          history,
          loopIndex: session.loopIndex,
          turnOrderMode: session.turnOrderMode,
        },
      },
    }));
  },

  /** 清除某会话的队列快照 */
  clearLiveQueue: (sessionId) => {
    set((s) => {
      if (!(sessionId in s.liveQueueBySession)) return {};
      const next = { ...s.liveQueueBySession };
      delete next[sessionId];
      return { liveQueueBySession: next };
    });
  },

  addToast: (message, kind = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500);
  },

  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// ============================================================
// 成就解锁分发（UI 层以此为唯一入口展示解锁弹窗）
// ============================================================

registerUnlockDispatcher((ach, total) => {
  import('../components/AchievementModal').then(({ showAchievementUnlock }) => {
    showAchievementUnlock(ach, total);
  });
});

// ============================================================
// 内部实现
// ============================================================

const confirmationDeferreds = new Map<ToolConfirmationRequest, { resolve: (v: boolean) => void }>();

/** 聚合启用 Provider 的模型列表（对应 App 的 aggregateEnabledProviderModels） */
function aggregateEnabledProviderModels(providers: ApiProvider[]): string[] {
  return providers
    .filter((p) => p.isEnabled && p.baseUrl.trim())
    .flatMap((p) =>
      (p.cachedModelsCsv || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    )
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
}

/** 创建会话（公开给 UI 用） */
export async function createSession(
  mode: 'STANDARD' | 'NPC' | 'GROUP',
  opts?: {
    associatedId?: number;
    npcIds?: number[];
    title?: string;
    worldBookId?: number | null;
    userPersonaNpcId?: number | null;
  }
): Promise<number> {
  let title = opts?.title;
  if (!title) {
    title = mode === 'STANDARD' ? translate('nav.newStandardTitle') : mode === 'NPC' ? translate('nav.newNpcTitle') : translate('nav.newGroupTitle');
  }
  const now = Date.now();
  const id = await db.sessions.add({
    title,
    mode,
    associatedId: mode === 'NPC' ? (opts?.associatedId ?? null) : null,
    worldBookId: opts?.worldBookId ?? null,
    userPersonaNpcId: opts?.userPersonaNpcId ?? null,
    turnOrderMode: 'PRESET',
    turnQueueJson: '[]',
    turnQueueHistoryJson: '[]',
    loopIndex: 0,
    lastMessage: '',
    updatedAt: now,
    createdAt: now,
  });

  // 参与者
  const participants: ChatParticipant[] = [];
  // 玩家始终存在
  participants.push({
    sessionId: id,
    participantId: -1,
    kind: 'PLAYER',
    npcId: null,
    displayName: '用户',
    seatOrder: 0,
  });

  if (mode === 'NPC' && opts?.associatedId != null) {
    const npc = await db.npcs.get(opts.associatedId);
    if (npc) {
      participants.push({
        sessionId: id,
        participantId: opts.associatedId,
        kind: 'NPC',
        npcId: opts.associatedId,
        displayName: npc.name,
        seatOrder: 1,
      });
    }
  } else if (mode === 'GROUP' && opts?.npcIds) {
    const ids = opts.npcIds.slice(0, 5);
    for (let i = 0; i < ids.length; i++) {
      const npc = await db.npcs.get(ids[i]);
      if (!npc) continue;
      participants.push({
        sessionId: id,
        participantId: ids[i],
        kind: 'NPC',
        npcId: ids[i],
        displayName: npc.name,
        seatOrder: i + 1,
      });
    }
  }
  await db.participants.bulkAdd(participants);

  // 初始化队列（含玩家；玩家默认队首）— 群聊的循环由全体成员组成
  const queue = initializeTurnQueue(participants, 'PRESET');
  await db.sessions.update(id, {
    turnQueueJson: queueJson(queue),
    turnQueueHistoryJson: queueHistoryJson([queue]),
  });

  // NPC 模式的问候语
  if (mode === 'NPC' && opts?.associatedId != null) {
    const npc = await db.npcs.get(opts.associatedId);
    if (npc?.greeting) {
      await db.messages.add({
        sessionId: id,
        role: 'assistant',
        speakerParticipantId: opts.associatedId,
        speakerName: npc.name,
        content: npc.greeting,
        toolCallsJson: '[]',
        toolCallId: null,
        thinkingContent: null,
        loopIndex: 0,
        timestamp: Date.now(),
        latencyMs: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokensPerSec: null,
        modelUsed: null,
        attachments: [],
        attachmentInfos: [],
        rawRequestBody: null,
        rawResponseBody: null,
      });
      await db.sessions.update(id, { lastMessage: sessionPreviewText(npc.greeting) });
    }
  }

  // 同步 store
  await useStore.getState().refreshSessions();
  await useStore.getState().refreshLiveQueue(id);

  return id;
}

async function handleMagicCommand(session: ChatSession, cmd: string): Promise<void> {
  if (cmd === '/new') {
    const marker: ChatMessage = {
      sessionId: session.id!,
      role: 'system',
      speakerParticipantId: null,
      speakerName: null,
      content: NEW_TOPIC_MARKER,
      toolCallsJson: '[]',
      toolCallId: null,
      thinkingContent: null,
      loopIndex: session.mode === 'GROUP' ? currentLoopIndexOf(session) : null,
      timestamp: Date.now(),
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensPerSec: null,
      modelUsed: null,
      attachments: [],
      attachmentInfos: [],
      rawRequestBody: null,
      rawResponseBody: null,
    };
    await db.messages.add(marker);
    await db.sessions.update(session.id!, { updatedAt: Date.now(), lastMessage: NEW_TOPIC_MARKER });
    await useStore.getState().loadMessages(session.id!);
  } else if (cmd === '/pass') {
    // 魔法指令 /pass：将玩家移出队列，不修改任何对话历史
    if (session.mode === 'GROUP') {
      const participants = await db.participants.where('sessionId').equals(session.id!).toArray();
      const session1 = await db.sessions.get(session.id!);
      if (session1) {
        const player = participants.find((p) => p.kind === 'PLAYER');
        const playerId = player ? player.participantId : -1;
        const { queue, loopIndex, loopStarted } = refreshQueue(session1, participants);
        // 将玩家移出队列；边界时把新循环完整顺序写入历史
        await persistQueue(session1.id!, passPlayer(queue, playerId), loopIndex, loopStarted);
        // 实时刷新队列面板（玩家已移出）
        await useStore.getState().refreshLiveQueue(session1.id!);
        // 继续群聊（其余成员依次发言）
        await continueGroupConversation(session.id!);
      }
    } else {
      useStore.getState().addToast(translate('toast.passOnlyGroup'), 'error');
    }
  }
}

/** 对话主循环：NPC / STANDARD 直接回复；GROUP 依队列轮转 */
async function runConversationLoop(session: ChatSession): Promise<void> {
  if (session.mode === 'STANDARD') {
    await streamAssistantTurn(session, null, null);
  } else if (session.mode === 'NPC') {
    const npc = session.associatedId ? await db.npcs.get(session.associatedId) : null;
    if (npc) {
      await streamAssistantTurn(session, npc, session.associatedId);
    }
  } else if (session.mode === 'GROUP') {
    await continueGroupConversation(session.id!);
  }
}

/**
 * 统一持久化队列与循环历史：
 * - 保存剩余队列（队首 = 下一发言者）
 * - loopStarted（刚进入新循环）→ 把新循环完整顺序追加到历史末尾
 * 所有队列变更点（玩家发言 / /pass / 回合推进 / 循环结束重初始化）都经由它落库，
 * 保证面板的「循环历史」完整可观测。
 */
async function persistQueue(
  sessionId: number,
  queue: string[],
  loopIndex: number,
  loopStarted: boolean
): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const history = safeParseQueueHistory(session.turnQueueHistoryJson || '[]');
  const nextHistory = loopStarted ? [...history, queue] : history;
  await db.sessions.update(sessionId, {
    turnQueueJson: queueJson(queue),
    loopIndex,
    turnQueueHistoryJson: queueHistoryJson(nextHistory),
  });
}

async function refreshQueueAndSave(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const parts = await db.participants.where('sessionId').equals(sessionId).toArray();
  const { queue, loopIndex, loopStarted } = refreshQueue(session, parts);
  await persistQueue(sessionId, queue, loopIndex, loopStarted);
  await useStore.getState().refreshLiveQueue(sessionId);
}

/**
 * 读取循环历史（带兼容兜底：无历史记录时用当前队列作为第 1 轮）。
 * 历史的新循环追加由各队列变更点（persistQueue）完成。
 */
async function ensureLoopHistory(sessionId: number): Promise<string[][]> {
  const session = await db.sessions.get(sessionId);
  if (!session) return [];
  const history = safeParseQueueHistory(session.turnQueueHistoryJson || '[]');
  if (history.length > 0) return history;
  // 兼容旧数据 / 极早阶段：用当前队列作为唯一一轮
  const parts = await db.participants.where('sessionId').equals(sessionId).toArray();
  const { queue } = refreshQueue(session, parts);
  if (queue.length > 0) {
    await db.sessions.update(sessionId, { turnQueueHistoryJson: queueHistoryJson([queue]) });
    return [queue];
  }
  return [];
}

function lastUserText(sessionId: number): string {
  const list = useStore.getState().messages[sessionId] ?? [];
  const last = [...list].reverse().find((m) => m.role === 'user');
  return last?.content ?? '';
}

/** 会话中最近一次「角色/用户」发言文本（用于解析任一发言者消息中的 @ 点名） */
function lastSpeakerText(sessionId: number): string {
  const list = useStore.getState().messages[sessionId] ?? [];
  const last = [...list].reverse().find((m) => m.role === 'user' || m.role === 'assistant');
  return last?.content ?? '';
}

/**
 * 群聊当前循环号（0 起）：以会话最新持久化的 loopIndex 为准。
 * 玩家在某循环发言时，消息归属该循环；会话刚进入新循环（loopIndex 未变）时，
 * 新循环的“领首”消息仍归属当前 loopIndex，保证对话与队列循环历史逐轮对齐。
 */
function currentLoopIndexOf(session: ChatSession): number {
  return session.loopIndex ?? 0;
}

/**
 * 解析当前生效的 API 端点：
 * 1. 若 settings.defaultProviderId 指向已启用 Provider → 用其 baseUrl/apiKey
 * 2. 否则回退 settings 中的 baseUrl/apiKey
 */
async function resolveActiveEndpoint(): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
} | null> {
  const settings = useStore.getState().settings;
  if (!settings) return null;
  const providers = await db.providers.toArray();
  const defaultProvider =
    settings.defaultProviderId != null
      ? providers.find((p) => p.id === settings.defaultProviderId && p.isEnabled)
      : null;

  // 未指定默认 Provider 时：若存在唯一启用的 Provider，自动使用
  const activeProvider =
    defaultProvider ??
    (providers.filter((p) => p.isEnabled && p.baseUrl.trim()).length === 1
      ? providers.find((p) => p.isEnabled && p.baseUrl.trim()) ?? null
      : null);

  const baseUrl = activeProvider?.baseUrl || settings.baseUrl;
  const apiKey = activeProvider?.apiKey || settings.apiKey;
  const model = settings.defaultModel?.trim() || '';

  if (!baseUrl || !model) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 执行一次 assistant 流式回合（含 ReAct 工具调用链，最多 4 层）
 */
async function streamAssistantTurn(
  session: ChatSession,
  npc: NpcCharacter | null,
  participantId: number | null = null,
  participant?: ChatParticipant,
  mentionedIds: number[] = [],
  turnLoopIndex: number | null = null
): Promise<void> {
  const settings = useStore.getState().settings;
  if (!settings) return;

  const endpoint = await resolveActiveEndpoint();
  if (!endpoint) {
    useStore.getState().addToast(translate('toast.noEndpoint'), 'error');
    return;
  }
  const { baseUrl, apiKey, model } = endpoint;

  const sessionId = session.id!;
  const abortController = new AbortController();
  useStore.setState({ streaming: { sessionId, abort: abortController } });
  // 面板实时指示：该角色开始发言（队列首位高亮）
  await useStore.getState().refreshLiveQueue(sessionId);

  const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
  const activeParticipantId = participantId;
  // 用户点击「停止生成」（stopStreaming → abort.abort()）后置位，用于中断正在进行的流式拉取
  let stopped = false;

  // ---- ReAct 深度循环 ----
  let depth = 0;
  while (depth <= MAX_TOOL_CALL_DEPTH) {
    const allMessages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const nmessages = buildNetworkMessagesForSession({
      session,
      participants,
      activeSpeakerParticipantId: activeParticipantId,
      messages: allMessages.map((m) => ({
        role: m.role,
        content: m.content,
        speakerParticipantId: m.speakerParticipantId,
        speakerName: m.speakerName,
        thinkingContent: m.thinkingContent,
        toolCallsJson: m.toolCallsJson,
        toolCallId: m.toolCallId,
        attachments: m.attachments,
      })),
    });

    // system prompt
    const worldBook = session.worldBookId ? await db.worldBooks.get(session.worldBookId) : null;
    const userPersona = session.userPersonaNpcId ? await db.npcs.get(session.userPersonaNpcId) : null;
    let systemPrompt: string;
    if (session.mode === 'STANDARD') systemPrompt = STANDARD_SYSTEM_PROMPT;
    else if (session.mode === 'NPC') {
      systemPrompt = buildNpcSystemPrompt(npc?.prompt ?? '', worldBook?.content, userPersona?.prompt);
    } else {
      const name = participant?.displayName ?? npc?.name ?? '';
      // 传入全体成员、玩家称谓与当前回合队列顺序，让模型感知轮次与 @ 呼叫
      const allSpeakerNames = participants
        .filter((p) => p.kind === 'NPC')
        .map((p) => p.displayName);
      const playerP = participants.find((p) => p.kind === 'PLAYER');
      const queueOrder = safeParseQueue(session.turnQueueJson).map((id) => {
        const p = participants.find((pp) => String(pp.participantId) === id);
        return p
          ? p.kind === 'PLAYER'
            ? playerP?.displayName ?? translate('common.user')
            : p.displayName
          : id;
      });
      systemPrompt = buildGroupSystemPrompt(name, npc?.prompt ?? '', worldBook?.content, userPersona?.prompt, {
        allSpeakerNames,
        playerName: playerP?.displayName ?? translate('common.user'),
        currentTurnQueueOrder: queueOrder,
      });
    }
    nmessages.unshift({ role: 'system', content: systemPrompt });

    // 工具
    const tools = await getEnabledToolsForSession(sessionId, activeParticipantId ?? null);

    const request = buildChatRequest({
      model,
      messages: nmessages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: settings.maxTokens,
      topK: settings.topK,
      frequencyPenalty: settings.frequencyPenalty,
      presencePenalty: settings.presencePenalty,
      repetitionPenalty: settings.repetitionPenalty,
      reasoningEffort: settings.reasoningEffort,
      // 流式输出与工具调用默认开启（无 UI 开关）；思考强度由 Reasoning Effort 控制
      isThinkingModeEnabled: true,
      streaming: true,
      baseUrl,
    });

    // 本次循环已因用户停止而中断 → 不再发起新一轮请求
    if (abortController.signal.aborted) break;

    // 草稿消息（流式更新）
    const startTime = Date.now();
    const draftId = await db.messages.add({
      sessionId,
      role: 'assistant',
      speakerParticipantId: participantId,
      speakerName: participant?.displayName ?? npc?.name ?? null,
      content: '',
      toolCallsJson: '[]',
      toolCallId: null,
      thinkingContent: null,
      loopIndex: turnLoopIndex,
      timestamp: Date.now(),
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensPerSec: null,
      modelUsed: model,
      attachments: [],
      attachmentInfos: [],
      rawRequestBody: null,
      rawResponseBody: null,
    });
    await useStore.getState().loadMessages(sessionId);

    let content = '';
    let thinking = '';
    let promptTokens = 0;
    let completionTokens = 0;
    const rawLines: string[] = [];
    const toolCalls: Array<{ id: string; name: string; argumentsJson: string; contentOffset: number }> = [];
    let errorMsg = '';

    await streamChatCompletions(baseUrl, apiKey, request, (chunk) => {
      switch (chunk.type) {
        case 'raw':
          rawLines.push(chunk.line);
          break;
        case 'content':
          content += chunk.text;
          break;
        case 'thinking':
          thinking += chunk.text;
          break;
        case 'tool_call':
          toolCalls.push({
            id: chunk.id,
            name: chunk.name,
            argumentsJson: chunk.argJson,
            contentOffset: content.length,
          });
          break;
        case 'usage':
          promptTokens = chunk.prompt;
          completionTokens = chunk.completion;
          break;
        case 'error':
          errorMsg = chunk.message;
          break;
        case 'done':
          // 用户点击「停止」（stopStreaming → abort.abort()）导致读取被中断时,
          // attemptStream 会以 done 结束;不再继续累积内容/工具调用
          if (abortController.signal.aborted) stopped = true;
          break;
      }
      // 流式更新草稿
      useStore.setState((s) => {
        if (s.activeSessionId !== sessionId) return {};
        const list = [...(s.messages[sessionId] ?? [])];
        const idx = list.findIndex((m) => m.id === draftId);
        if (idx < 0) return {};
        list[idx] = {
          ...list[idx],
          content,
          thinkingContent: thinking,
          toolCallsJson: JSON.stringify(
            toolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))
          ),
        };
        return { messages: { ...s.messages, [sessionId]: list } };
      });
    }, abortController.signal);

    // 出错时：撤销草稿消息并提示
    if (errorMsg) {
      await db.messages.delete(draftId);
      await useStore.getState().loadMessages(sessionId);
      useStore.setState({ streaming: { sessionId: null, abort: null } });
      useStore.getState().addToast(translate('toast.genFailed', { msg: errorMsg }), 'error');
      return;
    }

    // 用户点击「停止」时：中断后续处理（工具调用、ReAct 下一层）
    if (stopped || abortController.signal.aborted) {
      await persistPartialDraft(draftId, sessionId, content, thinking, toolCalls, request, rawLines, promptTokens, completionTokens, startTime, model);
      break;
    }

    // 最终持久化草稿
    const latencyMs = Date.now() - startTime;
    const finalTokens = completionTokens > 0 ? completionTokens : estimateTokensFromChars(content.length);
    const tokensPerSec = latencyMs > 0 ? finalTokens / (latencyMs / 1000) : null;
    const finalToolCalls = toolCalls.map((tc, i) => ({
      ...tc,
      id: tc.id || `call-${Date.now()}-${i}`,
    }));

    await db.messages.update(draftId, {
      content,
      thinkingContent: thinking || null,
      toolCallsJson: JSON.stringify(
        finalToolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))
      ),
      latencyMs: errorMsg ? null : latencyMs,
      promptTokens,
      completionTokens: finalTokens,
      totalTokens: promptTokens + finalTokens,
      tokensPerSec,
      rawRequestBody: JSON.stringify(request).slice(0, 64_000),
      rawResponseBody: rawLines.join('\n').slice(0, 64_000),
    });
    await useStore.getState().loadMessages(sessionId);

    // 生涯统计
    await accumulateStats(
      {
        inputTokens: promptTokens,
        outputTokens: finalTokens,
        rounds: 0,
      },
      sessionId,
      null
    );

    // 更新会话预览
    const preview = sessionPreviewText(content);
    await db.sessions.update(sessionId, {
      updatedAt: Date.now(),
      lastMessage: preview || '…',
    });

    if (errorMsg) {
      useStore.getState().addToast(translate('toast.genFailed', { msg: errorMsg }), 'error');
    }

    // ---- 工具调用处理（默认开启） ----
    if (finalToolCalls.length > 0) {
      for (const tc of finalToolCalls) {
        const needsConfirm = ['update_skill', 'delete_skill', 'update_character', 'delete_character', 'update_world_book', 'delete_world_book'].includes(tc.name);
        let result: string;
        if (needsConfirm) {
          const approved = await requestToolConfirmation(sessionId, tc);
          if (!approved) {
            result = translate('toast.canceled', { name: tc.name });
          } else {
            result = await executeToolCall(tc.name, tc.argumentsJson, { sessionId, requestConfirmation: async () => true });
          }
        } else {
          result = await executeToolCall(tc.name, tc.argumentsJson, { sessionId, requestConfirmation: async () => true });
        }
        // 数据变更类工具执行后即时刷新 store，保证界面（角色工坊等）无需刷新即可看到最新数据
        if (result.startsWith('OK:')) {
          if (tc.name.includes('character')) await useStore.getState().refreshNpcs();
          if (tc.name.includes('world_book')) await useStore.getState().refreshWorldBooks();
          if (tc.name.includes('skill')) {
            await useStore.getState().refreshTools();
            await useStore.getState().refreshNpcs();
          }
        }
        await db.messages.add({
          sessionId,
          role: 'tool',
          speakerParticipantId: null,
          speakerName: null,
          content: result,
          toolCallsJson: '[]',
          toolCallId: tc.id,
          thinkingContent: null,
          loopIndex: turnLoopIndex,
          timestamp: Date.now(),
          latencyMs: null,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          tokensPerSec: null,
          modelUsed: null,
          attachments: [],
          attachmentInfos: [],
          rawRequestBody: null,
          rawResponseBody: null,
        });
      }

      // 有工具结果 → 下一层 ReAct
      depth++;
      if (depth > MAX_TOOL_CALL_DEPTH) break;
      await useStore.getState().loadMessages(sessionId);
      continue;
    }

    break; // 无工具调用则结束
  }

  useStore.setState({ streaming: { sessionId: null, abort: null } });
  await refreshQueueAndSave(sessionId);
}

/**
 * 用户停止生成时，把已流式收到的部分内容持久化为最终消息，
 * 避免中断后内容丢失（停止而非报错：不加 latency/raw 等数据）。
 */
async function persistPartialDraft(
  draftId: number,
  sessionId: number,
  content: string,
  thinking: string,
  toolCalls: Array<{ id: string; name: string; argumentsJson: string; contentOffset: number }>,
  request: ChatCompletionRequest,
  rawLines: string[],
  promptTokens: number,
  completionTokens: number,
  startTime: number,
  model: string
): Promise<void> {
  const latencyMs = Date.now() - startTime;
  const finalTokens = completionTokens > 0 ? completionTokens : estimateTokensFromChars(content.length);
  await db.messages.update(draftId, {
    content,
    thinkingContent: thinking || null,
    toolCallsJson: JSON.stringify(toolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))),
    latencyMs,
    promptTokens,
    completionTokens: finalTokens,
    totalTokens: promptTokens + finalTokens,
    tokensPerSec: latencyMs > 0 ? finalTokens / (latencyMs / 1000) : null,
    modelUsed: model,
    rawRequestBody: JSON.stringify(request).slice(0, 64_000),
    rawResponseBody: rawLines.join('\n').slice(0, 64_000),
  });
  await useStore.getState().loadMessages(sessionId);

  // 生涯统计与会话预览仍同步（与正常回合一致）
  await accumulateStats({ inputTokens: promptTokens, outputTokens: finalTokens, rounds: 0 }, sessionId, null);
  const preview = sessionPreviewText(content);
  await db.sessions.update(sessionId, {
    updatedAt: Date.now(),
    lastMessage: preview || '…',
  });
}

/** 群聊主循环：持续从队列取发言者 */
async function continueGroupConversation(sessionId: number): Promise<void> {
  groupLoopStopped = false;
  let guard = 0;
  while (guard < 20) {
    if (groupLoopStopped) break;
    const session = await db.sessions.get(sessionId);
    if (!session) break;
    const players = await db.participants.where('sessionId').equals(sessionId).toArray();
    const { queue, loopIndex, loopStarted } = refreshQueue(session, players);
    if (loopStarted) {
      // 循环边界：把新循环的完整顺序写入历史（队首可能直接是 NPC，需先落库），
      // 并立刻刷新面板 → 新循环立即加入显示
      await persistQueue(sessionId, queue, loopIndex, true);
      await useStore.getState().refreshLiveQueue(sessionId);
    }
    if (queue.length === 0) {
      // 队列空 = 循环结束：刷新面板
      await refreshQueueAndSave(sessionId);
      break;
    }
    const nextId = parseInt(queue[0], 10);
    const next = players.find((p) => p.participantId === nextId);
    if (!next || next.kind !== 'NPC') {
      // 轮到玩家 → 等待输入，结束本轮
      await refreshQueueAndSave(sessionId);
      break;
    }
    // 面板实时指示：正在发言者 = 队列首位
    await useStore.getState().refreshLiveQueue(sessionId);
    const npc = next.npcId ? await db.npcs.get(next.npcId) : null;
    if (!npc) {
      await persistQueue(sessionId, completeTurn(queue, nextId, []), loopIndex, false);
      guard++;
      continue;
    }
    const mentioned = mentionedParticipantIds(lastSpeakerText(sessionId), players, nextId);
    // 先不推进队列：让流式发言期间队列首位 = 正在发言的角色（面板实时高亮）
    await streamAssistantTurn(session, npc, nextId, next, mentioned, loopIndex);
    // 回合结束：移出该发言者 + 被 @ 点名者插入/移到队首（历史轮次不受影响）
    await persistQueue(sessionId, completeTurn(queue, nextId, mentioned), loopIndex, false);
    guard++;
    // 用户主动 stop 时中断
    if (groupLoopStopped) break;
  }
}

/** 请求用户确认（挂起直到 resolveConfirmation） */
function requestToolConfirmation(
  sessionId: number,
  tc: { id: string; name: string; argumentsJson: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    const req: ToolConfirmationRequest = {
      sessionId,
      toolName: tc.name,
      title: `确认 ${tc.name}`,
      message: `模型请求执行修改操作「${tc.name}」。\n\n参数:\n${formatArgs(tc.argumentsJson)}`,
      argsJson: tc.argumentsJson,
    };
    confirmationDeferreds.set(req, { resolve });
    useStore.setState({ pendingConfirmation: req });
  });
}

function formatArgs(argsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 2);
  } catch {
    return argsJson;
  }
}