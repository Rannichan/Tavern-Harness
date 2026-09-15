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
  requeueSpeaker,
  safeParseQueue,
  safeParseQueueHistory,
} from '../core/turnLoop';
import type { ChatCompletionRequest, SessionMode, TurnOrderMode } from '../types/models';
import {
  MAX_CONSECUTIVE_TOOL_FAILURES,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_TOOL_CALL_DEPTH,
  MAX_TOOL_CALLS_PER_TURN,
  NEW_TOPIC_MARKER,
} from '../core/toolDefinitions';
import { getEnabledToolsForSession, executeToolCall, parseDisplayRef, applySessionWorkspace } from '../core/tools/toolExecutor';
import { ensureSessionWorkspaceDir, deleteSessionWorkspace } from '../core/tools/generatedSkillExecutor';
import { applyTheme as applyThemeManual, watchSystemTheme } from '../theme/theme';
import { setLanguage, translate } from '../core/i18n';
import { localizeBuiltinNpc } from '../db/database';
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

/** 展示类工具（file_display）当前打开的弹窗载荷 */
export interface ActiveDisplay {
  path: string;
  kind: 'text' | 'image' | 'html';
  title?: string;
  /** 产生该展示的会话 id（读取文件时按其专属工作目录解析，null = 共享工作区） */
  sessionId: number | null;
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

  /** 当前打开的展示弹窗（file_display），null = 无 */
  activeDisplay: ActiveDisplay | null;
  /** 打开 / 关闭展示弹窗 */
  setActiveDisplay: (d: ActiveDisplay | null) => void;

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
  /** 重新生成指定消息（右键菜单：右键哪条就重生成哪条）。删除该消息及之后的 tool 消息后重跑 */
  regenerateMessage: (messageId: number) => Promise<void>;
  editMessage: (messageId: number, newContent: string, sessionId: number, newAttachments?: string[], newAttachmentNames?: string[]) => Promise<void>;
  saveMessageOnly: (messageId: number, newContent: string, sessionId: number, newAttachments?: string[], newAttachmentNames?: string[]) => Promise<void>;
  stopStreaming: () => void;
  deleteSession: (id: number) => Promise<void>;
  /** 切换会话置顶状态（置顶会话排列表最前，可跨会话固定） */
  togglePin: (id: number) => Promise<void>;
  /** 从指定消息分叉（Fork）：复制该消息及之前的内容到新会话并跳转过去。返回新会话 id */
  forkSession: (messageId: number) => Promise<number | null>;
  updateSessionSettings: (sessionId: number, opts: {
    title?: string;
    npcIds: number[];
    worldBookId?: number | null;
    userPersonaNpcId?: number | null;
    turnOrderMode?: TurnOrderMode;
    participantOrder?: number[];
    enableGreeting?: boolean;
  }) => Promise<void>;
  resetSessionConversation: (sessionId: number) => Promise<void>;
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
  /** 重新加载当前活动会话的参与者（语言切换后刷新内置角色显示名） */
  refreshParticipants: () => Promise<void>;

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

/** 会话排序：置顶在前、其余在后，组内按 updatedAt 倒序（最新在前） */
function sortSessionsPinnedFirst(sessions: ChatSession[]): ChatSession[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((s) => (s as { pinned?: unknown }).pinned);
  const rest = sorted.filter((s) => !(s as { pinned?: unknown }).pinned);
  return [...pinned, ...rest];
}

/** 单回合生成结果：ok 成功 / failed 失败（应回退） / stopped 用户主动停止（不回退） */
type TurnResult = 'ok' | 'failed' | 'stopped';

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
  activeDisplay: null,

  liveQueueBySession: {},

  toasts: [],

  init: async () => {
    // StrictMode 双调用保护
    if (initLock) return initLock;
    initLock = (async () => {
      const settings = (await db.settings.get(1))!;
      setLanguage(settings.language ?? null);
      // 内置角色「酒馆老板」按当前语言本地化（未编辑过的字段才会更新）
      await localizeBuiltinNpc();
      const npcs = await db.npcs.toArray();
      const sessions = sortSessionsPinnedFirst(await db.sessions.toArray());
      const worldBooks = await db.worldBooks.toArray();
      const tools = [...(await db.tools.toArray())].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
      set({ initialized: true, settings, npcs, sessions, worldBooks, tools });
      await get().refreshProviders();
      applyThemeManual(settings.themeMode);
      // 跟随系统模式下，系统切换深浅色时自动重新应用主题
      watchSystemTheme(() => {
        const s = useStore.getState().settings;
        if (s) applyThemeManual(s.themeMode);
      });
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
      // 切换语言后：内置角色文本 / 相关会话元数据一并本地化并刷新
      await localizeBuiltinNpc();
      await get().refreshNpcs();
      await get().refreshSessions();
      await get().refreshParticipants();
    }
    applyThemeManual(next.themeMode);
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
    // 置顶会话排最前（各自按 updatedAt 倒序），其次为普通会话（同样按 updatedAt 倒序）
    set({ sessions: sortSessionsPinnedFirst(await db.sessions.toArray()) });
  },

  refreshNpcs: async () => {
    set({ npcs: await db.npcs.toArray() });
  },

  refreshWorldBooks: async () => {
    set({ worldBooks: await db.worldBooks.toArray() });
  },

  refreshTools: async () => {
    // 按 displayOrder 排序：技能表拖拽调整的顺序跨刷新保持
    const tools = [...(await db.tools.toArray())].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    set({ tools });
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
    set((s) => {
      const loadedMessages = s.streaming.sessionId === sessionId
        ? messages.map((message) => s.messages[sessionId]?.find((current) => current.id === message.id) ?? message)
        : messages;
      return {
        messages: { ...s.messages, [sessionId]: loadedMessages },
        participants: { ...s.participants, [sessionId]: participants },
      };
    });
  },

  /** 重新加载当前活动会话的参与者列表（语言切换本地化内置角色后调用） */
  refreshParticipants: async () => {
    const sessionId = get().activeSessionId;
    if (sessionId == null) return;
    await get().loadMessages(sessionId);
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
      displayRef: null,
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
    if (get().streaming.sessionId != null) return;

    // 默认入口：仍然只重生成「最后一条 assistant 回复」。
    // 具体删除 / 续跑逻辑见 regenerateMessage。
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    await get().regenerateMessage(lastAssistant.id!);
  },

  regenerateMessage: async (messageId) => {
    const message = await db.messages.get(messageId);
    if (!message) return;
    const sessionId = message.sessionId;
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (get().streaming.sessionId != null) return;

    // ---- 生成前快照：完整保留删除前的消息与队列状态，生成失败时整体回退 ----
    const snapshotMessages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const snapshotSessionFields = {
      turnQueueJson: session.turnQueueJson,
      turnQueueHistoryJson: session.turnQueueHistoryJson,
      loopIndex: session.loopIndex,
      lastMessage: session.lastMessage,
      updatedAt: session.updatedAt,
    };

    // 以目标消息的时间戳为切断点：删除它及之后的所有消息（通常为其附属 tool 结果），
    // 随后重新生成该条回复（重新生成 = 旧回复连同后续内容一起被新回复替换）
    const messages = snapshotMessages;
    const toDelete = messages.filter((m) => m.timestamp >= message.timestamp);
    await db.messages.bulkDelete(toDelete.map((m) => m.id!));
    await get().loadMessages(sessionId);

    // 会话预览回退到删除后最后一条可见消息；空则置空
    const remaining = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const lastVisible = [...remaining].reverse().find((m) => m.role !== 'tool');
    await db.sessions.update(sessionId, {
      updatedAt: Date.now(),
      lastMessage: lastVisible ? sessionPreviewText(lastVisible.content) || '…' : '',
    });

    let result: TurnResult;
    if (session.mode === 'GROUP') {
      // 群聊：把被重生成 assistant 的发言人重新置顶（联动发言队列）。
      // 若该条发言是当前循环某位成员（未知 speakerParticipantId，如收尾回复），
      // 无法映射到具体成员，则直接按当前队列继续。
      const participant = message.speakerParticipantId != null
        ? (await db.participants
            .where('sessionId').equals(sessionId)
            .filter((p) => p.participantId === message.speakerParticipantId)
            .first()) ?? null
        : null;
      result = await continueRegeneratedGroupLoop(session, message, participant);
    } else {
      result = await runConversationLoop(session);
    }

    if (result === 'failed') {
      // 生成失败（网络 / 超时 / 空回复等）→ 回退到原先的状态：
      // 恢复全部消息（含被删除的旧回复及其工具结果）与会话队列 / 预览。
      await db.transaction('rw', db.messages, async () => {
        await db.messages.where('sessionId').equals(sessionId).delete();
        await db.messages.bulkPut(snapshotMessages);
      });
      await db.sessions.update(sessionId, snapshotSessionFields);
      await get().loadMessages(sessionId);
    }
    await get().refreshSessions();
    await get().refreshLiveQueue(sessionId);
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

    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (session.mode === 'GROUP' && message.role === 'assistant') {
      // 群聊中编辑的是 NPC 的发言 → 重新生成该发言者的回复，
      // 并把该发言人重新置顶队列（联动发言队列：它还没轮完一轮时优先补发）。
      const participant =
        message.speakerParticipantId != null
          ? (await db.participants
              .where('sessionId')
              .equals(sessionId)
              .filter((p) => p.participantId === message.speakerParticipantId)
              .first()) ?? null
          : null;
      await continueRegeneratedGroupLoop(session, message, participant);
      await get().refreshSessions();
      return;
    }
    if (session.mode === 'GROUP' && message.role === 'user') {
      // 群聊中编辑的是玩家消息 → 发言队列回退到该消息所属「循环与轮次」：
      // 1) 用循环历史里该轮的完整初始顺序重建队列（移除玩家 + 该轮玩家之前已发言者，
      //    后者仅在 RANDOM 模式玩家非队首时可能出现）
      // 2) 循环历史与 loopIndex 截断回退到该轮
      // 3) 应用编辑文本中的 @点名 → 进入群聊主循环重新生成
      const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
      const fresh = (await db.sessions.get(sessionId)) ?? session;
      const player = participants.find((p) => p.kind === 'PLAYER') ?? null;
      const playerId = player?.participantId ?? -1;
      const targetLoop = message.loopIndex ?? 0;
      const history = safeParseQueueHistory(fresh.turnQueueHistoryJson || '[]');
      const curQueue = safeParseQueue(fresh.turnQueueJson);
      const loopOrder =
        history[targetLoop] ??
        (curQueue.length > 0 ? curQueue : initializeTurnQueue(participants, fresh.turnOrderMode));
      // 该轮中玩家发言之前已发言的 NPC（其消息未被删除 → 不重讲）
      const spokenBeforePlayer = new Set(
        messages
          .filter(
            (m) => m.role === 'assistant' && m.loopIndex === targetLoop && m.timestamp < message.timestamp && m.speakerParticipantId != null
          )
          .map((m) => m.speakerParticipantId as number)
      );
      // 重建该轮：移除玩家、被 @ 点名者置顶 → 再剔除玩家之前已发言的 NPC
      let rolledQueue = completeTurn(loopOrder, playerId, mentionedParticipantIds(newContent, participants, playerId));
      rolledQueue = rolledQueue.filter((id) => !spokenBeforePlayer.has(parseInt(id, 10)));
      await db.sessions.update(sessionId, {
        turnQueueJson: queueJson(rolledQueue),
        loopIndex: targetLoop,
        turnQueueHistoryJson: queueHistoryJson(history.slice(0, targetLoop + 1)),
      });
      await get().refreshLiveQueue(sessionId);
      await continueGroupConversation(sessionId);
      await get().refreshSessions();
      return;
    }

    await runConversationLoop(session);
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
    // 先取会话记录（工作目录在删除后不可查），再清理目录与数据
    const session = await db.sessions.get(id);
    await db.messages.where('sessionId').equals(id).delete();
    await db.participants.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
    // 删除会话的专属工作目录（磁盘 + 虚拟工作区）；沙箱不可用时静默跳过
    if (session?.workspaceDir) {
      await deleteSessionWorkspace(session.workspaceDir);
    }
    if (get().activeSessionId === id) set({ activeSessionId: null });
    get().clearLiveQueue(id);
    await get().refreshSessions();
  },

  togglePin: async (id) => {
    const session = await db.sessions.get(id);
    if (!session) return;
    const pinned = (session as { pinned?: unknown }).pinned ? 0 : 1;
    await db.sessions.update(id, { pinned });
    await get().refreshSessions();
  },

  /** 从指定消息分叉：复制会话与该消息之前（含）的消息到新会话，并跳转过去 */
  forkSession: async (messageId: number) => {
    const message = await db.messages.get(messageId);
    if (!message) return null;
    const sessionId = message.sessionId;
    const session = await db.sessions.get(sessionId);
    if (!session) return null;

    // 复制会话（保留模式 / 角色 / 世界书 / 人设 / 队列设置；置顶与顺序“未置顶”）
    // 新 Fork 会话分配独立工作目录（session-<newId>），与原会话互不影响
    const now = Date.now();
    const newSession: ChatSession = {
      ...session,
      id: undefined,
      title: `${session.title} #fork`,
      turnQueueJson: '[]',
      turnQueueHistoryJson: '[]',
      loopIndex: 0,
      pinned: 0,
      lastMessage: '',
      updatedAt: now,
      createdAt: now,
    };
    const newId = await db.sessions.add(newSession);
    await db.sessions.update(newId, { workspaceDir: `session-${newId}` });
    // 创建对话的同时预建其专属工作目录（会话间隔离，Fork 后互不影响）
    await ensureSessionWorkspaceDir(`session-${newId}`);

    // 复制参与者（PLAYER 保留 -1 编号，NPC 按 npcId 映射；重建 seatOrder 保持一致）
    const participants = await db.participants.where('sessionId').equals(sessionId).sortBy('seatOrder');
    const mappedParticipants = participants.map((p, i) => ({
      sessionId: newId,
      participantId: p.participantId,
      kind: p.kind,
      npcId: p.npcId,
      displayName: p.displayName,
      seatOrder: i,
    }));
    await db.participants.bulkAdd(mappedParticipants);

    // 复制消息：取该消息及之前的全部消息（按时间戳顺序）
    // 消息 id 不可复用（自增），重新按时间顺序写库，保持展示顺序一致。
    // 若分叉点在带工具调用的 assistant 消息上，其 tool 结果消息的时间戳晚于分叉点，
    // 但属于该回合（缺失会导致模型侧 tool_calls 悬空）→ 一并复制。
    const allMessages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const toCopy = allMessages.filter((m) => m.timestamp <= message.timestamp);
    // 分叉点消息及其之前 assistant 声明的工具调用 id
    const declaredCallIds = new Set<string>();
    for (const m of toCopy) {
      if (m.role !== 'assistant') continue;
      try {
        for (const tc of JSON.parse(m.toolCallsJson || '[]') as { id?: string }[]) {
          if (tc.id) declaredCallIds.add(tc.id);
        }
      } catch {
        /* ignore */
      }
    }
    // 追加这些工具调用对应的结果消息（若尚未被时间戳条件覆盖）
    const toolResultsToInclude = allMessages.filter(
      (m) => m.role === 'tool' && m.toolCallId != null && declaredCallIds.has(m.toolCallId) && !toCopy.includes(m)
    );
    const finalCopy = [...toCopy, ...toolResultsToInclude].sort((a, b) => a.timestamp - b.timestamp);
    for (const m of finalCopy) {
      const { id: _oldId, ...rest } = m;
      await db.messages.add({ ...rest, sessionId: newId });
    }

    // 新会话预览取最后一条可见消息（工具消息不计入）
    const lastVisible = [...finalCopy].reverse().find((m) => m.role !== 'tool');
    const lastMessage = lastVisible ? sessionPreviewText(lastVisible.content) || '…' : '';
    await db.sessions.update(newId, { lastMessage });

    await get().refreshSessions();
    await get().loadMessages(newId);
    await get().setActiveSession(newId);
    return newId;
  },

  updateSessionSettings: async (sessionId, opts) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    const npcIds = [...new Set((opts.npcIds ?? []).filter((id) => Number.isFinite(id)).map(Number))].slice(0, 5);
    if (npcIds.length === 0) return;
    const participantOrder = opts.participantOrder ?? [-1, ...npcIds];
    const participants = await buildSessionParticipants(sessionId, npcIds, participantOrder);
    const finalNpcIds = participants.filter((p) => p.kind === 'NPC' && p.npcId != null).map((p) => p.npcId!);
    if (finalNpcIds.length === 0) return;
    const finalTitle = opts.title?.trim() || participants
      .filter((p) => p.kind === 'NPC' && p.npcId != null)
      .map((p) => p.displayName)
      .join('、');
    const turnOrderMode = opts.turnOrderMode === 'RANDOM' ? 'RANDOM' : 'PRESET';
    const queue = initializeTurnQueue(participants, turnOrderMode);
    await db.participants.where('sessionId').equals(sessionId).delete();
    await db.participants.bulkAdd(participants);
    await db.sessions.update(sessionId, {
      title: finalTitle,
      mode: finalNpcIds.length === 1 ? 'NPC' : 'GROUP',
      associatedId: finalNpcIds.length === 1 ? finalNpcIds[0] : null,
      worldBookId: opts.worldBookId ?? null,
      userPersonaNpcId: opts.userPersonaNpcId ?? null,
      enableGreeting: opts.enableGreeting !== false,
      turnOrderMode,
      turnQueueJson: queueJson(queue),
      turnQueueHistoryJson: queueHistoryJson([queue]),
      loopIndex: 0,
      updatedAt: Date.now(),
    });
    await get().loadMessages(sessionId);
    await get().refreshSessions();
    await get().refreshLiveQueue(sessionId);
  },

  resetSessionConversation: async (sessionId) => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    const participants = (await db.participants.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.seatOrder - b.seatOrder);
    const queue = initializeTurnQueue(participants, session.turnOrderMode);
    await db.messages.where('sessionId').equals(sessionId).delete();
    const greetingSpeakerId = pickGreetingSpeakerId(session.mode, session.associatedId, queue, session.enableGreeting !== false);
    const lastMessage = await seedOpeningGreeting(sessionId, greetingSpeakerId);
    await db.sessions.update(sessionId, {
      turnQueueJson: queueJson(session.mode === 'GROUP' && greetingSpeakerId != null ? completeTurn(queue, greetingSpeakerId, []) : queue),
      turnQueueHistoryJson: queueHistoryJson([queue]),
      loopIndex: 0,
      lastMessage,
      updatedAt: Date.now(),
    });
    await get().loadMessages(sessionId);
    await get().refreshSessions();
    await get().refreshLiveQueue(sessionId);
    if (session.mode === 'GROUP' && greetingSpeakerId != null) {
      void continueGroupConversation(sessionId);
    }
  },

  resolveConfirmation: (approved) => {
    const req = get().pendingConfirmation;
    if (!req) return;
    const d = confirmationDeferreds.get(req);
    if (d) {
      confirmationDeferreds.delete(req);
      d.resolve(approved);
    }
    set({ pendingConfirmation: null });
  },

  setActiveDisplay: (d) => set({ activeDisplay: d }),

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
    turnOrderMode?: TurnOrderMode;
    participantOrder?: number[];
    enableGreeting?: boolean;
  }
): Promise<number> {
 let title = opts?.title;
 if (!title) {
   title = mode === 'STANDARD' ? translate('nav.newStandardTitle') : mode === 'NPC' ? translate('nav.newNpcTitle') : translate('nav.newGroupTitle');
 }
 const turnOrderMode = opts?.turnOrderMode === 'RANDOM' ? 'RANDOM' : 'PRESET';
 const requestedNpcIds = mode === 'NPC'
   ? (opts?.associatedId != null ? [opts.associatedId] : [])
   : [...new Set((opts?.npcIds ?? []).filter((id) => Number.isFinite(id)).map(Number))].slice(0, 5);
 const now = Date.now();
 // 会话专属工作目录：先写入会话拿自增 id，再用 id 生成目录并回填。
 // 该会话的所有工具调用（shell / 文件读写 / 脚本执行等）都在此目录下进行，会话间互相隔离。
 const id = await db.sessions.add({
   title,
   mode,
   associatedId: mode === 'NPC' ? (requestedNpcIds[0] ?? null) : null,
   worldBookId: opts?.worldBookId ?? null,
   userPersonaNpcId: opts?.userPersonaNpcId ?? null,
   enableGreeting: opts?.enableGreeting !== false,
   turnOrderMode,
   workspaceDir: null,
   turnQueueJson: '[]',
   turnQueueHistoryJson: '[]',
   loopIndex: 0,
   pinned: 0,
   lastMessage: '',
   updatedAt: now,
   createdAt: now,
  });
 // 用会话 id 作为专属工作目录名（session-<id>），单层目录、不嵌套，确保唯一且会话间互不影响
 const workspaceDir = `session-${id}`;
 await db.sessions.update(id, { workspaceDir });
 // 创建对话的同时预建其专属工作目录（磁盘沙箱启动时会真实创建；
 // 未启动/失败时静默跳过，首次工具调用时仍会自动补建）
 await ensureSessionWorkspaceDir(workspaceDir);

  // 参与者
  const participantsById = new Map<number, ChatParticipant>();
  participantsById.set(-1, {
    sessionId: id,
    participantId: -1,
    kind: 'PLAYER',
    npcId: null,
    displayName: translate('common.user'),
    seatOrder: 0,
  });

  if (mode === 'NPC' && requestedNpcIds[0] != null) {
    const npc = await db.npcs.get(requestedNpcIds[0]);
    if (npc) {
      participantsById.set(requestedNpcIds[0], {
        sessionId: id,
        participantId: requestedNpcIds[0],
        kind: 'NPC',
        npcId: requestedNpcIds[0],
        displayName: npc.name,
        seatOrder: 1,
      });
    }
  } else if (mode === 'GROUP') {
    for (const npcId of requestedNpcIds) {
      const npc = await db.npcs.get(npcId);
      if (!npc) continue;
      participantsById.set(npcId, {
        sessionId: id,
        participantId: npcId,
        kind: 'NPC',
        npcId,
        displayName: npc.name,
        seatOrder: participantsById.size,
      });
    }
  }
  const defaultParticipantOrder = [...participantsById.keys()];
  const validParticipantIds = new Set(defaultParticipantOrder);
  const normalizedParticipantOrder: number[] = [];
  for (const rawId of opts?.participantOrder ?? []) {
    const participantId = Number(rawId);
    if (!validParticipantIds.has(participantId) || normalizedParticipantOrder.includes(participantId)) continue;
    normalizedParticipantOrder.push(participantId);
  }
  for (const participantId of defaultParticipantOrder) {
    if (!normalizedParticipantOrder.includes(participantId)) normalizedParticipantOrder.push(participantId);
  }
  const participants = normalizedParticipantOrder
    .map((participantId, seatOrder) => {
      const participant = participantsById.get(participantId);
      return participant ? { ...participant, seatOrder } : null;
    })
    .filter(Boolean) as ChatParticipant[];
  await db.participants.bulkAdd(participants);

  // 初始化队列（含玩家；玩家默认队首）— 群聊的循环由全体成员组成
  const queue = initializeTurnQueue(participants, turnOrderMode);
  await db.sessions.update(id, {
    turnQueueJson: queueJson(queue),
    turnQueueHistoryJson: queueHistoryJson([queue]),
  });

  const enableGreeting = opts?.enableGreeting !== false;
  const greetingSpeakerId = pickGreetingSpeakerId(mode, mode === 'NPC' ? (requestedNpcIds[0] ?? null) : null, queue, enableGreeting);
  const greetingPreview = await seedOpeningGreeting(id, greetingSpeakerId);
  if (greetingPreview) {
    const patch: Partial<ChatSession> = { lastMessage: greetingPreview };
    if (mode === 'GROUP' && greetingSpeakerId != null) {
      patch.turnQueueJson = queueJson(completeTurn(queue, greetingSpeakerId, []));
    }
    await db.sessions.update(id, patch);
  }

  // 同步 store
  await useStore.getState().refreshSessions();
  await useStore.getState().refreshLiveQueue(id);
  if (mode === 'GROUP' && greetingSpeakerId != null) {
    void continueGroupConversation(id);
  }

  return id;
}

async function buildSessionParticipants(sessionId: number, npcIds: number[], participantOrder?: number[]): Promise<ChatParticipant[]> {
  const participantsById = new Map<number, ChatParticipant>();
  participantsById.set(-1, {
    sessionId,
    participantId: -1,
    kind: 'PLAYER',
    npcId: null,
    displayName: translate('common.user'),
    seatOrder: 0,
  });
  for (const npcId of npcIds) {
    const npc = await db.npcs.get(npcId);
    if (!npc) continue;
    participantsById.set(npcId, {
      sessionId,
      participantId: npcId,
      kind: 'NPC',
      npcId,
      displayName: npc.name,
      seatOrder: participantsById.size,
    });
  }
  const defaultParticipantOrder = [...participantsById.keys()];
  const validParticipantIds = new Set(defaultParticipantOrder);
  const normalizedParticipantOrder: number[] = [];
  for (const rawId of participantOrder ?? []) {
    const participantId = Number(rawId);
    if (!validParticipantIds.has(participantId) || normalizedParticipantOrder.includes(participantId)) continue;
    normalizedParticipantOrder.push(participantId);
  }
  for (const participantId of defaultParticipantOrder) {
    if (!normalizedParticipantOrder.includes(participantId)) normalizedParticipantOrder.push(participantId);
  }
  return normalizedParticipantOrder
    .map((participantId, seatOrder) => {
      const participant = participantsById.get(participantId);
      return participant ? { ...participant, seatOrder } : null;
    })
    .filter(Boolean) as ChatParticipant[];
}

async function seedOpeningGreeting(
  sessionId: number,
  greetingSpeakerId: number | null
): Promise<string> {
  if (greetingSpeakerId == null) return '';
  const npc = await db.npcs.get(greetingSpeakerId);
  if (!npc) return '';
  const all = [npc.greeting, ...(npc.alternateGreetings ?? [])].filter(Boolean);
  const greeting = all.length > 0 ? all[Math.floor(Math.random() * all.length)] : '';
  if (!greeting) return '';
  await db.messages.add({
    sessionId,
    role: 'assistant',
    speakerParticipantId: greetingSpeakerId,
    speakerName: npc.name,
    content: greeting,
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
    displayRef: null,
    rawRequestBody: null,
    rawResponseBody: null,
  });
  return sessionPreviewText(greeting);
}

function pickGreetingSpeakerId(
  mode: SessionMode,
  associatedId: number | null,
  queue: string[],
  enableGreeting: boolean
): number | null {
  if (!enableGreeting) return null;
  if (mode === 'NPC' && associatedId != null) return associatedId;
  if (mode === 'GROUP') {
    const firstSpeakerId = Number(queue[0] ?? NaN);
    if (Number.isFinite(firstSpeakerId) && firstSpeakerId !== -1) return firstSpeakerId;
  }
  return null;
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
      displayRef: null,
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

/** 对话主循环：NPC / STANDARD 直接回复；GROUP 依队列轮转。
 * 返回该轮生成结果（供「重新生成」失败回退判断）。 */
async function runConversationLoop(session: ChatSession): Promise<TurnResult> {
  if (session.mode === 'STANDARD') {
    return streamAssistantTurn(session, null, null);
  } else if (session.mode === 'NPC') {
    const npc = session.associatedId ? await db.npcs.get(session.associatedId) : null;
    if (npc) {
      return streamAssistantTurn(session, npc, session.associatedId);
    }
    return 'failed';
  } else if (session.mode === 'GROUP') {
    return continueGroupConversation(session.id!);
  }
  return 'ok';
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

/** 最近一次某 NPC 的发言文本（用于解析该 NPC 发言中的 @ 点名） */
function lastAssistantTextBySpeaker(sessionId: number, speakerParticipantId: number): string {
  const list = useStore.getState().messages[sessionId] ?? [];
  const last = [...list]
    .reverse()
    .find((m) => m.role === 'assistant' && m.speakerParticipantId === speakerParticipantId);
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
 * 执行一次 assistant 流式回合（含 ReAct 工具调用链，最多 4 层）。
 * 返回该回合结果：'ok' 已产出回复 / 'failed' 生成失败（调用方据此回退）
 * / 'stopped' 用户主动停止（视为成功保留部分内容，不回退）。
 */
async function streamAssistantTurn(
  session: ChatSession,
  npc: NpcCharacter | null,
  participantId: number | null = null,
  participant?: ChatParticipant,
  mentionedIds: number[] = [],
  turnLoopIndex: number | null = null
): Promise<TurnResult> {
  const settings = useStore.getState().settings;
  if (!settings) return 'failed';

  const endpoint = await resolveActiveEndpoint();
  if (!endpoint) {
    useStore.getState().addToast(translate('toast.noEndpoint'), 'error');
    return 'failed';
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
  // 是否已成功持久化一条回复（含工具调用消息）；false 且非停止 → 视为生成失败
  let produced = false;
  // 本回合是否已计入 1 轮对话（ReAct 多层循环只计一次，避免一轮生成被重复统计）
  let roundCounted = false;
  let toolCallCount = 0;
  let consecutiveToolFailures = 0;
  let lastToolCallSignature = '';
  let identicalToolCallCount = 0;
  let limitDeclined = false;
  const resetToolBudgets = () => {
    depth = 0;
    toolCallCount = 0;
    consecutiveToolFailures = 0;
    lastToolCallSignature = '';
    identicalToolCallCount = 0;
  };
  const confirmLimitContinuation = async (reason: string): Promise<boolean> => {
    const approved = await requestLimitConfirmation(sessionId, reason, {
      depth,
      toolCallCount,
      identicalToolCallCount,
      consecutiveToolFailures,
    });
    if (approved) resetToolBudgets();
    else limitDeclined = true;
    return approved;
  };

  // ---- ReAct 深度循环 ----
  let depth = 0;
  while (true) {
    if (depth >= MAX_TOOL_CALL_DEPTH) {
      const continued = await confirmLimitContinuation(
        translate('confirm.depthLimit', { limit: MAX_TOOL_CALL_DEPTH })
      );
      if (!continued) break;
    }
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
      displayRef: null,
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

    // Large file_write arguments arrive as a growing JSON string. Publishing every token
    // repeatedly parses/reconciles the whole value and can monopolize the browser main thread.
    // Persist the same snapshots so a reload can recover an in-progress draft.
    const DRAFT_PUBLISH_INTERVAL_MS = 100;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPublishedAt = 0;
    let draftWrite = Promise.resolve();
    const publishDraft = () => {
      publishTimer = null;
      lastPublishedAt = Date.now();
      const contentSnapshot = content;
      const thinkingContent = thinking || null;
      const toolCallsJson = JSON.stringify(
        toolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))
      );
      useStore.setState((s) => {
        const list = [...(s.messages[sessionId] ?? [])];
        const idx = list.findIndex((m) => m.id === draftId);
        if (idx < 0) return {};
        list[idx] = { ...list[idx], content: contentSnapshot, thinkingContent, toolCallsJson };
        return { messages: { ...s.messages, [sessionId]: list } };
      });
      draftWrite = draftWrite
        .then(() => db.messages.update(draftId, { content: contentSnapshot, thinkingContent, toolCallsJson }))
        .then(() => undefined);
    };
    const scheduleDraftPublish = () => {
      if (publishTimer) return;
      const delay = Math.max(0, DRAFT_PUBLISH_INTERVAL_MS - (Date.now() - lastPublishedAt));
      publishTimer = setTimeout(publishDraft, delay);
    };

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
          {
            const idx = toolCalls.findIndex((tc) => tc.id === chunk.id);
            if (idx >= 0) {
              toolCalls[idx] = {
                ...toolCalls[idx],
                name: chunk.name || toolCalls[idx].name,
                argumentsJson: chunk.argJson || toolCalls[idx].argumentsJson,
              };
            } else {
              toolCalls.push({
                id: chunk.id,
                name: chunk.name,
                argumentsJson: chunk.argJson,
                contentOffset: content.length,
              });
            }
          }
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
      scheduleDraftPublish();
    }, abortController.signal);

    if (publishTimer) clearTimeout(publishTimer);
    publishDraft();
    await draftWrite;

    // 出错时：撤销草稿消息并提示
    if (errorMsg) {
      await db.messages.delete(draftId);
      await useStore.getState().loadMessages(sessionId);
      useStore.setState({ streaming: { sessionId: null, abort: null } });
      useStore.getState().addToast(translate('toast.genFailed', { msg: errorMsg }), 'error');
      return 'failed';
    }

    // 用户点击「停止」时：中断后续处理（工具调用、ReAct 下一层）
    if (stopped || abortController.signal.aborted) {
      await persistPartialDraft(draftId, sessionId, content, thinking, toolCalls, request, rawLines, promptTokens, completionTokens, startTime, model, !roundCounted, npc);
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
    const normalizedContent = trimEdgeNewlines(content);
    const isEmptyAssistantReply =
      !normalizedContent &&
      !thinking.trim() &&
      finalToolCalls.length === 0;
    if (isEmptyAssistantReply) {
      await db.messages.delete(draftId);
      await useStore.getState().loadMessages(sessionId);
      continue;
    }
    produced = true;

    await db.messages.update(draftId, {
      content: normalizedContent,
      thinkingContent: thinking || null,
      toolCallsJson: JSON.stringify(
        finalToolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))
      ),
      latencyMs: errorMsg ? null : latencyMs,
      promptTokens,
      completionTokens: finalTokens,
      totalTokens: promptTokens + finalTokens,
      tokensPerSec,
      rawRequestBody: JSON.stringify(request),
      rawResponseBody: rawLines.join('\n'),
    });
    await useStore.getState().loadMessages(sessionId);

    // 生涯统计：1 个回复回合 = 1 轮对话（ReAct 多层只计一次）；
    // 群聊中 NPC 发言会把该轮计入对应角色的 careerNpcStats（最活跃角色统计）
    const { rounds: assistantRounds, npcRounds } = assistantRoundDelta(!roundCounted, npc);
    roundCounted = roundCounted || assistantRounds > 0;
    await accumulateStats(
      {
        inputTokens: promptTokens,
        outputTokens: finalTokens,
        rounds: assistantRounds,
        npcRounds,
      },
      sessionId,
      null
    );

    // 更新会话预览
    const preview = sessionPreviewText(normalizedContent);
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
        let result: string;
        const signature = toolCallSignature(tc.name, tc.argumentsJson);
        const nextIdenticalCount = signature === lastToolCallSignature ? identicalToolCallCount + 1 : 1;

        let allowed = !limitDeclined;
        let limitReason = '';
        if (allowed && toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
          limitReason = translate('confirm.callLimit', { limit: MAX_TOOL_CALLS_PER_TURN });
        } else if (allowed && nextIdenticalCount >= MAX_IDENTICAL_TOOL_CALLS) {
          limitReason = translate('confirm.identicalLimit', {
            name: tc.name,
            limit: MAX_IDENTICAL_TOOL_CALLS,
          });
        } else if (allowed && consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
          limitReason = translate('confirm.failureLimit', { limit: MAX_CONSECUTIVE_TOOL_FAILURES });
        }
        if (limitReason) allowed = await confirmLimitContinuation(limitReason);

        if (!allowed) {
          result = translate('confirm.limitCanceled');
        } else try {
          identicalToolCallCount = signature === lastToolCallSignature ? identicalToolCallCount + 1 : 1;
          lastToolCallSignature = signature;
          toolCallCount++;
          // 会话隔离：每个工具调用前把工作目录切到当前会话（shell / 文件读写都在该会话目录内）
          await applySessionWorkspace(sessionId);
          const needsConfirm = ['update_skill', 'delete_skill', 'update_character', 'delete_character', 'update_world_book', 'delete_world_book'].includes(tc.name);
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
        } catch (e) {
          // 工具执行本身抛异常（网络 / 沙箱 / 安全拦截等）→ 立即落库为失败结果，
          // 避免整个回合中断、失败不可见（只有用户下一条消息后才显示）
          result = `ERROR: ${(e as Error).message || String(e)}`;
        }
        // 工具没有返回任何内容（空模板 / 空文件 / 空输出等）→ 补占位结果，
        // 保证调用卡片立即显示「无结果」而不是空白
        if (!result || !result.trim()) result = translate('tool.noResult');
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
          displayRef: displayRefForToolName(tc.name, result),
          rawRequestBody: null,
          rawResponseBody: null,
        });

        // 展示类工具（file_display）：执行成功后自动打开展示弹窗
        const displayPayload = tc.name === 'file_display' ? parseDisplayRef(result) : null;
        if (displayPayload) {
          useStore.getState().setActiveDisplay({
            path: displayPayload.path,
            kind: displayPayload.kind,
            title: displayPayload.title,
            sessionId,
          });
        }

        // 工具调用失败 / 被取消 / 无结果 → 立即提示，避免用户误以为还在执行中。
        // 失败判定沿用 UI 的惯例：ERROR: / CANCELLED: 前缀（部分工具成功时返回非 OK: 文本，
        // 如掷骰结果、JSON 快照、模板输出，不能简单用「非 OK:」判定失败）；
        // 用户主动取消（CANCELLED + 取消文案）不算失败，不弹错误提示。
        const canceledResult = translate('toast.canceled', { name: tc.name });
        const limitCanceled = limitDeclined && result.startsWith('CANCELLED:');
        const isToolError =
          !limitCanceled &&
          (result.startsWith('ERROR:') || (result.startsWith('CANCELLED:') && result !== canceledResult));
        if (isToolError) {
          consecutiveToolFailures++;
          useStore
            .getState()
            .addToast(translate('toast.toolFailed', { name: tc.name, detail: result.slice(0, 120) }), 'error');
        } else {
          consecutiveToolFailures = 0;
        }

        if (
          !limitDeclined &&
          consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES &&
          !(await confirmLimitContinuation(
            translate('confirm.failureLimit', { limit: MAX_CONSECUTIVE_TOOL_FAILURES })
          ))
        ) {
          limitDeclined = true;
        }
      }

      // 工具结果在 DB 落库后立刻刷新 UI（无论是否继续下一层 ReAct），
      // 保证「失败 / 无结果」在工具执行完成时立即可见，而不是等用户下一条消息
      await useStore.getState().loadMessages(sessionId);

      if (limitDeclined) break;

      // 有工具结果 → 下一层 ReAct
      depth++;
      continue;
    }

    break; // 无工具调用则结束
  }

  useStore.setState({ streaming: { sessionId: null, abort: null } });
  await refreshQueueAndSave(sessionId);

  // 用户主动停止 → 保留部分内容（不回退）；未产出任何回复 → 视为失败
  if (stopped || abortController.signal.aborted) return 'stopped';
  return produced ? 'ok' : 'failed';
}

function toolCallSignature(name: string, argumentsJson: string): string {
  try {
    return `${name}:${JSON.stringify(sortJsonValue(JSON.parse(argumentsJson || '{}')))}`;
  } catch {
    return `${name}:${argumentsJson.trim()}`;
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)])
    );
  }
  return value;
}

/**
 * 用户停止生成时，把已流式收到的部分内容持久化为最终消息，
 * 避免中断后内容丢失（停止而非报错：不加 latency/raw 等数据）。
 * 返回是否真的持久化了一条非空回复（用于轮数统计）。
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
  model: string,
  countRound: boolean,
  npc: NpcCharacter | null
): Promise<void> {
  const latencyMs = Date.now() - startTime;
  const normalizedContent = trimEdgeNewlines(content);
  const isEmptyAssistantReply =
    !normalizedContent &&
    !thinking.trim() &&
    toolCalls.length === 0;
  if (isEmptyAssistantReply) {
    await db.messages.delete(draftId);
    await useStore.getState().loadMessages(sessionId);
    return;
  }
  const finalTokens = completionTokens > 0 ? completionTokens : estimateTokensFromChars(normalizedContent.length);
  await db.messages.update(draftId, {
    content: normalizedContent,
    thinkingContent: thinking || null,
    toolCallsJson: JSON.stringify(toolCalls.map((tc) => ({ id: tc.id, name: tc.name, argumentsJson: tc.argumentsJson, contentOffset: tc.contentOffset }))),
    latencyMs,
    promptTokens,
    completionTokens: finalTokens,
    totalTokens: promptTokens + finalTokens,
    tokensPerSec: latencyMs > 0 ? finalTokens / (latencyMs / 1000) : null,
    modelUsed: model,
    rawRequestBody: JSON.stringify(request),
    rawResponseBody: rawLines.join('\n'),
  });
  await useStore.getState().loadMessages(sessionId);

  // 生涯统计与会话预览仍同步（与正常回合一致）；
  // 用户停止但保留了部分内容 → 仍算 1 轮对话（未停止前产生的内容也计）
  const { rounds: partialRounds, npcRounds } = assistantRoundDelta(countRound, npc);
  await accumulateStats(
    { inputTokens: promptTokens, outputTokens: finalTokens, rounds: partialRounds, npcRounds },
    sessionId,
    null
  );
  const preview = sessionPreviewText(normalizedContent);
  await db.sessions.update(sessionId, {
    updatedAt: Date.now(),
    lastMessage: preview || '…',
  });
}

function trimEdgeNewlines(text: string): string {
  return text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}

/** 当前 assistant 回合产生的「一轮对话」对应到生涯统计的增量 */
function assistantRoundDelta(
  round: boolean,
  npc: NpcCharacter | null
): { rounds: number; npcRounds?: { npcId: number; npcName: string; rounds: number } } {
  if (!round) return { rounds: 0 };
  if (npc) {
    return {
      rounds: 1,
      npcRounds: { npcId: npc.id!, npcName: npc.name, rounds: 1 },
    };
  }
  return { rounds: 1 };
}

/** 群聊主循环：持续从队列取发言者。
 * 返回整段循环的结果：任一回合成败决定整体结果（供「重新生成」失败回退判断）。 */
async function continueGroupConversation(sessionId: number): Promise<TurnResult> {
  groupLoopStopped = false;
  let guard = 0;
  let failed = false;
  let stopped = false;
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
    // 先不推进队列：让流式发言期间队列首位 = 正在发言的角色（面板实时高亮）
    const turnResult = await streamAssistantTurn(session, npc, nextId, next, [], loopIndex);
    if (turnResult === 'failed') failed = true;
    const mentioned = mentionedParticipantIds(lastAssistantTextBySpeaker(sessionId, nextId), players, nextId);
    // 回合结束：移出该发言者 + 被 @ 点名者插入/移到队首（历史轮次不受影响）
    await persistQueue(sessionId, completeTurn(queue, nextId, mentioned), loopIndex, false);
    if (turnResult === 'stopped') {
      stopped = true;
      break;
    }
    guard++;
    // 用户主动 stop 时中断
    if (groupLoopStopped) break;
  }
  if (groupLoopStopped || stopped) return 'stopped';
  return failed ? 'failed' : 'ok';
}

/**
 * 群聊中「编辑消息 / 重新生成」后的续跑：
 * 把被编辑的 assistant 发言人重新置顶当前队列（联动发言队列），
 * 再进入群聊主循环 —— 因此新回复会由「刚才被编辑的角色」生成，
 * 其余轮次按队列自然推进，队列面板历史也会同步更新。
 *
 * 参数 editedSpeaker 可为 null（如发言者已被删除 / 未知 speakerParticipantId），
 * 此时退化为普通 continueGroupConversation。
 */
async function continueRegeneratedGroupLoop(
  session: ChatSession,
  editedMessage: ChatMessage,
  editedSpeaker: ChatParticipant | null
): Promise<TurnResult> {
  const sessionId = session.id!;
  const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
  const speakerParticipantId = editedSpeaker?.participantId ?? editedMessage.speakerParticipantId;
  if (speakerParticipantId == null) {
    // 发言者不可映射 → 仅刷新队列并照常续跑
    await refreshQueueAndSave(sessionId);
    return continueGroupConversation(sessionId);
  }
  const { queue, loopIndex, loopStarted } = refreshQueue(session, participants);
  // 编辑后：该角色“重讲一遍” → 置顶队列，联动发言队列面板与下一轮顺序
  const nextQueue = requeueSpeaker(queue, speakerParticipantId);
  await persistQueue(sessionId, nextQueue, loopIndex, loopStarted);
  await useStore.getState().refreshLiveQueue(sessionId);
  return continueGroupConversation(sessionId);
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

function requestLimitConfirmation(
  sessionId: number,
  reason: string,
  counters: {
    depth: number;
    toolCallCount: number;
    identicalToolCallCount: number;
    consecutiveToolFailures: number;
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    const req: ToolConfirmationRequest = {
      sessionId,
      toolName: 'agent_limit',
      title: translate('confirm.limitTitle'),
      message: translate('confirm.limitMessage', { reason }),
      argsJson: JSON.stringify({
        depth: counters.depth,
        tool_calls: counters.toolCallCount,
        identical_calls: counters.identicalToolCallCount,
        consecutive_failures: counters.consecutiveToolFailures,
      }),
      kind: 'limit',
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

/**
 * 展示类工具（file_display）的结果会携带展示引用（DISPLAY_REF 前缀）。
 * 解析成功 → 返回序列化后的 DisplayFileRef（写入工具结果消息的 displayRef 字段，
 * 供对话流中的「查看」按钮回看）；其他工具一律返回 null。
 */
function displayRefForToolName(toolName: string, result: string): string | null {
  if (toolName !== 'file_display') return null;
  const payload = parseDisplayRef(result);
  if (!payload) return null;
  // path 前面去展示前缀的剩余文本是给模型看的（留在 content 中）。
  // displayRef 只保存展示所需的最小信息；sessionId 用于回看时定位会话工作目录。
  const sessionId = useStore.getState().activeSessionId;
  return JSON.stringify({
    path: payload.path,
    kind: payload.kind,
    title: payload.title,
    sessionId,
  });
}