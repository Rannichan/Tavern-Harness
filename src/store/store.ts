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
  queueJson,
  refreshQueue,
} from '../core/turnLoop';
import { NEW_TOPIC_MARKER, MAX_TOOL_CALL_DEPTH } from '../core/toolDefinitions';
import { getEnabledToolsForSession, executeToolCall } from '../core/tools/toolExecutor';
import { scheduleRestoredTasks } from '../core/tools/toolExecutor';
import { applyTheme as applyThemeManual } from '../theme/theme';
import { estimateTokensFromChars, accumulateStats, sessionPreviewText } from '../core/stats';

// ============================================================
// Store（对应 MainViewModel）
// ============================================================

export type ActiveView = 'chat' | 'characters' | 'settings' | 'files' | 'stats';

interface StreamingState {
  sessionId: number | null;
  abort: AbortController | null;
}

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface AppState {
  initialized: boolean;
  settings: AppSettings | null;
  providers: ApiProvider[];
  npcs: NpcCharacter[];
  sessions: ChatSession[];
  worldBooks: WorldBook[];
  messages: Record<number, ChatMessage[]>;
  participants: Record<number, ChatParticipant[]>;

  activeSessionId: number | null;
  activeView: ActiveView;

  streaming: StreamingState;
  pendingConfirmation: ToolConfirmationRequest | null;

  toasts: Toast[];

  init: () => Promise<void>;
  setSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setActiveSession: (id: number | null) => void;
  setActiveView: (v: ActiveView) => void;

  sendMessage: (text: string, attachments?: string[]) => Promise<void>;
  regenerateLast: () => Promise<void>;
  editMessage: (messageId: number, newContent: string, sessionId: number) => Promise<void>;
  stopStreaming: () => void;
  deleteSession: (id: number) => Promise<void>;
  resolveConfirmation: (approved: boolean) => void;

  refreshSessions: () => Promise<void>;
  refreshNpcs: () => Promise<void>;
  refreshWorldBooks: () => Promise<void>;
  refreshProviders: () => Promise<void>;
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

export const useStore = create<AppState>((set, get) => ({
  initialized: false,
  settings: null,
  providers: [],
  npcs: [],
  sessions: [],
  worldBooks: [],
  messages: {},
  participants: {},

  activeSessionId: null,
  activeView: 'chat',
  modelsList: [],

  streaming: { sessionId: null, abort: null },
  pendingConfirmation: null,

  toasts: [],

  init: async () => {
    // StrictMode 双调用保护
    if (initLock) return initLock;
    initLock = (async () => {
      const settings = (await db.settings.get(1))!;
      const npcs = await db.npcs.toArray();
      const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
      const worldBooks = await db.worldBooks.toArray();
      set({ initialized: true, settings, npcs, sessions, worldBooks });
      await get().refreshProviders();
      applyThemeManual(settings.themeMode, settings.themeColor);
      await scheduleRestoredTasks();
      // 默认创建一个标准会话，方便开箱即用
      if (sessions.length === 0) {
        const id = await createSession('STANDARD');
        set({ activeSessionId: id });
        await get().loadMessages(id);
        await get().refreshSessions();
      } else {
        set({ activeSessionId: sessions[0].id! });
        await get().loadMessages(sessions[0].id!);
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
    applyThemeManual(next.themeMode, next.themeColor);
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id, activeView: 'chat' });
    if (id != null) get().loadMessages(id);
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

  sendMessage: async (text, attachments = []) => {
    const sessionId = get().activeSessionId;
    if (sessionId == null) return;
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (get().streaming.sessionId != null) {
      get().addToast('正在生成中，请稍候', 'error');
      return;
    }

    // 魔法命令（有附件时不生效）
    const cmd = parseMagicCommand(text, attachments.length > 0);
    if (cmd) {
      await handleMagicCommand(session, cmd.text);
      await get().refreshSessions();
      return;
    }

    // 保存用户消息
    const userMsg: ChatMessage = {
      sessionId,
      role: 'user',
      speakerParticipantId: null,
      speakerName: null,
      content: text,
      toolCallsJson: '[]',
      toolCallId: null,
      thinkingContent: null,
      timestamp: Date.now(),
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensPerSec: null,
      modelUsed: null,
      attachments,
      attachmentInfos: attachments.map((a) => ({
        mimeType: a.startsWith('data:image') ? 'image/png' : 'video/mp4',
        displayName: '附件',
        sizeBytes: a.length,
      })),
      rawRequestBody: null,
      rawResponseBody: null,
    };
    await db.messages.add(userMsg);
    await db.sessions.update(sessionId, { updatedAt: Date.now(), lastMessage: sessionPreviewText(text) });
    await get().loadMessages(sessionId);
    await get().refreshSessions();

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

  editMessage: async (messageId, newContent, sessionId) => {
    if (get().streaming.sessionId != null) return;
    const message = await db.messages.get(messageId);
    if (!message) return;
    // 编辑该消息，删除它之后的所有消息（不含自身）
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
    const toDelete = messages.filter(
      (m) => m.timestamp > message.timestamp || (m.timestamp === message.timestamp && m.id !== messageId)
    );
    await db.messages.bulkDelete(toDelete.map((m) => m.id!));
    await db.messages.update(messageId, { content: newContent, attachments: [], attachmentInfos: [] });
    await get().loadMessages(sessionId);
    await runConversationLoop((await db.sessions.get(sessionId))!);
    await get().refreshSessions();
  },

  stopStreaming: () => {
    const abort = get().streaming.abort;
    if (abort) abort.abort();
  },

  deleteSession: async (id) => {
    await db.messages.where('sessionId').equals(id).delete();
    await db.participants.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
    if (get().activeSessionId === id) set({ activeSessionId: null });
    await get().refreshSessions();
  },

  resolveConfirmation: (approved) => {
    const req = get().pendingConfirmation;
    if (!req) return;
    const d = confirmationDeferreds.get(req);
    if (d) d.resolve(approved);
    set({ pendingConfirmation: null });
  },

  addToast: (message, kind = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3500);
  },

  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

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
    title = mode === 'STANDARD' ? '新对话' : mode === 'NPC' ? '新角色对话' : '新群聊';
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

  // 初始化队列
  const queue = initializeTurnQueue(participants.filter((p) => p.kind === 'NPC'), 'PRESET');
  await db.sessions.update(id, { turnQueueJson: queueJson(queue) });

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
    await db.sessions.update(session.id!, { updatedAt: Date.now(), lastMessage: '开始新话题' });
    await useStore.getState().loadMessages(session.id!);
  } else if (cmd === '/pass') {
    // 群聊中跳过当前回合（玩家回合 → 下一位）
    if (session.mode === 'GROUP') {
      const participants = await db.participants.where('sessionId').equals(session.id!).toArray();
      const session1 = await db.sessions.get(session.id!);
      if (session1) {
        const { queue, loopIndex } = refreshQueue(session1, participants);
        const next = completeTurn(queue, -1, []);
        await db.sessions.update(session1.id!, { turnQueueJson: queueJson(next), loopIndex });
        // 继续群聊
        await continueGroupConversation(session.id!);
      }
    } else {
      useStore.getState().addToast('/pass 仅在群聊中有效', 'error');
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

async function refreshQueueAndSave(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const parts = await db.participants.where('sessionId').equals(sessionId).toArray();
  const { queue, loopIndex } = refreshQueue(session, parts);
  await db.sessions.update(sessionId, { turnQueueJson: queueJson(queue), loopIndex });
}

function lastUserText(sessionId: number): string {
  const list = useStore.getState().messages[sessionId] ?? [];
  const last = [...list].reverse().find((m) => m.role === 'user');
  return last?.content ?? '';
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
  mentionedIds: number[] = []
): Promise<void> {
  const settings = useStore.getState().settings;
  if (!settings) return;

  const endpoint = await resolveActiveEndpoint();
  if (!endpoint) {
    useStore.getState().addToast('请在「模型服务 Provider」中添加并启用一个端点，并选择模型', 'error');
    return;
  }
  const { baseUrl, apiKey, model } = endpoint;

  const sessionId = session.id!;
  useStore.setState({ streaming: { sessionId, abort: new AbortController() } });

  const participants = await db.participants.where('sessionId').equals(sessionId).toArray();
  const activeParticipantId = participantId;

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
      systemPrompt = buildGroupSystemPrompt(name, npc?.prompt ?? '', worldBook?.content, userPersona?.prompt);
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
      isThinkingModeEnabled: settings.isThinkingModeEnabled,
      streaming: settings.isStreaming,
      baseUrl,
    });

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
    });

    // 出错时：撤销草稿消息并提示
    if (errorMsg) {
      await db.messages.delete(draftId);
      await useStore.getState().loadMessages(sessionId);
      useStore.setState({ streaming: { sessionId: null, abort: null } });
      useStore.getState().addToast(`生成失败: ${errorMsg}`, 'error');
      return;
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
      useStore.getState().addToast(`生成失败: ${errorMsg}`, 'error');
    }

    // ---- 工具调用处理 ----
    if (finalToolCalls.length > 0 && settings.isToolCallsEnabled) {
      for (const tc of finalToolCalls) {
        const needsConfirm = ['update_skill', 'delete_skill', 'update_character', 'delete_character', 'update_world_book', 'delete_world_book'].includes(tc.name);
        let result: string;
        if (needsConfirm) {
          const approved = await requestToolConfirmation(sessionId, tc);
          if (!approved) {
            result = `CANCELLED: 用户取消了 ${tc.name}`;
          } else {
            result = await executeToolCall(tc.name, tc.argumentsJson, { sessionId, requestConfirmation: async () => true });
          }
        } else {
          result = await executeToolCall(tc.name, tc.argumentsJson, { sessionId, requestConfirmation: async () => true });
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

/** 群聊主循环：持续从队列取发言者 */
async function continueGroupConversation(sessionId: number): Promise<void> {
  let guard = 0;
  while (guard < 20) {
    const session = await db.sessions.get(sessionId);
    if (!session) break;
    const players = await db.participants.where('sessionId').equals(sessionId).toArray();
    const { queue, loopIndex } = refreshQueue(session, players);
    if (queue.length === 0) {
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
    const npc = next.npcId ? await db.npcs.get(next.npcId) : null;
    if (!npc) {
      await db.sessions.update(sessionId, {
        turnQueueJson: queueJson(completeTurn(queue, nextId, [])),
        loopIndex,
      });
      guard++;
      continue;
    }
    const mentioned = mentionedParticipantIds(lastUserText(sessionId), players, nextId);
    await streamAssistantTurn(session, npc, nextId, next, mentioned);
    guard++;
    // 用户主动 stop 时中断
    if (!useStore.getState().streaming.sessionId && guard > 1) {
      // streamAssistantTurn 内部维护 streaming；检查是否中断
      const isStillStreaming = useStore.getState().streaming.sessionId != null;
      if (isStillStreaming) break;
    }
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