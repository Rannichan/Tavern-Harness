import { db } from '../../db/database';
import type {
  ChatCompletionTool,
  GeneratedSkillExecution,
  McpTool,
  ToolConfirmationRequest,
} from '../../types/models';
import { BUILTIN_TOOLS, BUILTIN_TOOL_NAMES } from '../toolDefinitions';
import { rollDice, webSearch } from './builtinTools';
import { executeGeneratedSkill, SHELL_ALLOWED } from './generatedSkillExecutor';
import { uuid } from '../turnLoop';

// ============================================================
// 工具路由与确认门控 — 对应 ToolExecutionCoordinator.kt
// ============================================================

export type ToolRoute = 'NATIVE' | 'STANDARD' | 'BLOCKED';

export function routeFor(tool: McpTool | null): ToolRoute {
  // 生成式技能（非内置）永远不可进入原生路由，即使重用内置名字
  if (tool && !tool.isBuiltIn) return 'STANDARD';
  if (tool && (BUILTIN_TOOL_NAMES as readonly string[]).includes(tool.name)) return 'NATIVE';
  return 'BLOCKED';
}

export interface ToolExecutionContext {
  sessionId: number;
  /** 用户确认回调：返回 Promise<boolean> */
  requestConfirmation: (req: ToolConfirmationRequest) => Promise<boolean>;
}

export function isConfirmationNeeded(toolName: string): boolean {
  return ['update_skill', 'delete_skill', 'update_character', 'delete_character', 'update_world_book', 'delete_world_book'].includes(toolName);
}

/**
 * 执行一个工具调用（原生或生成式）。
 * 需要确认的操作先发起确认请求，用户取消时返回 "CANCELLED: ..."
 */
export async function executeToolCall(
  toolName: string,
  argsJson: string,
  ctx: ToolExecutionContext
): Promise<string> {
  const tool = await db.tools.where('name').equals(toolName).first();
  const mcpTool = tool ?? null;
  const route = routeFor(mcpTool);

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return 'ERROR: 工具参数不是合法 JSON';
  }

  // 系统消息层：自动执行幻觉工具名（未知工具）
  if (route === 'BLOCKED') {
    return `ERROR: 工具 '${toolName}' 不存在或不可用。可用的工具: ${(await listToolNames()).join(', ')}`;
  }

  // 原生路由
  if (route === 'NATIVE') {
    return runNativeTool(toolName, args, ctx);
  }

  // 生成式技能（STANDARD 路由）：不在当前会话启用检查由上层决定
  if (mcpTool && mcpTool.executionJson) {
    try {
      const execution = JSON.parse(mcpTool.executionJson) as GeneratedSkillExecution;
      return await executeGeneratedSkill(execution, args);
    } catch (e) {
      return `ERROR: 技能实现无效 ${(e as Error).message}`;
    }
  }
  return `ERROR: 技能 '${toolName}' 没有实现`;
}

async function runNativeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<string> {
  switch (toolName) {
    case 'web_search': {
      const q = String(args.q ?? '');
      if (!q) return 'ERROR: 缺少搜索词 q';
      const max = Math.max(1, Math.min(10, Number(args.max_results) || 5));
      return await webSearch(q, max);
    }
    case 'roll_dice': {
      const expr = String(args.expression ?? '');
      if (!expr) return 'ERROR: 缺少 expression';
      return rollDice(expr);
    }
    case 'manage_timer':
      return await handleManageTimer(args, ctx);

    case 'get_tavern_status':
      return await handleGetTavernStatus(args);

    case 'create_skill':
      return await handleCreateSkill(args);
    case 'update_skill':
      return await gate(ctx, 'update_skill', `更新技能「${args.name}」？`, () => handleUpdateSkill(args));
    case 'delete_skill':
      return await gate(ctx, 'delete_skill', `删除技能「${args.name}」？此操作不可恢复。`, () => handleDeleteSkill(args));

    case 'create_character':
      return await handleCreateCharacter(args);
    case 'update_character':
      return await gate(ctx, 'update_character', `更新角色「${args.name}」？`, () => handleUpdateCharacter(args));
    case 'delete_character':
      return await gate(ctx, 'delete_character', `删除角色「${args.name}」？此操作不可恢复。`, () => handleDeleteCharacter(args));

    case 'create_world_book':
      return await handleCreateWorldBook(args);
    case 'update_world_book':
      return await gate(ctx, 'update_world_book', `更新世界书「${args.name}」？`, () => handleUpdateWorldBook(args));
    case 'delete_world_book':
      return await gate(ctx, 'delete_world_book', `删除世界书「${args.name}」？`, () => handleDeleteWorldBook(args));

    default:
      return `ERROR: 未知工具 ${toolName}`;
  }
}

async function gate(
  ctx: ToolExecutionContext,
  toolName: string,
  title: string,
  action: () => Promise<string>
): Promise<string> {
  try {
    const confirmed = await ctx.requestConfirmation({
      sessionId: ctx.sessionId,
      toolName,
      title,
      message: title,
      argsJson: '{}',
    });
    if (!confirmed) return `CANCELLED: 用户取消了 ${toolName}`;
    return await action();
  } catch {
    return `CANCELLED: 用户取消了 ${toolName}`;
  }
}

// ============================================================
// 原生工具实现
// ============================================================

async function handleManageTimer(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const op = String(args.operation ?? 'list');
  if (op === 'list') {
    const tasks = await db.tasks.where('sessionId').equals(ctx.sessionId).toArray();
    const filtered = args.status && args.status !== 'all' ? tasks.filter((t) => t.status === args.status) : tasks;
    if (filtered.length === 0) {
      return '定时消息: (无)';
    }
    return (
      '定时消息列表:\n' +
      filtered
        .map(
          (t) =>
            `- ${t.status === 'pending' ? '⏳' : t.status === 'completed' ? '✅' : '❌'} ${t.id} ${t.label} ` +
            `触发于 ${new Date(t.triggerAtMillis).toLocaleString()} › 「${t.messageContent.slice(0, 30)}${t.messageContent.length > 30 ? '…' : ''}」`
        )
        .join('\n')
    );
  }
  if (op === 'cancel') {
    const id = String(args.timer_id ?? '');
    if (!id) return 'ERROR: 缺少 timer_id';
    const task = await db.tasks.get(id);
    if (!task) return 'ERROR: 定时任务不存在';
    await db.tasks.update(id, { status: 'cancelled' as const, completedAt: Date.now() });
    return `OK: 已取消定时任务 ${id}`;
  }
  if (op === 'create') {
    const session = await db.sessions.get(ctx.sessionId);
    if (session?.mode !== 'NPC') return 'ERROR: 定时消息仅支持 NPC 会话';
    const pending = await db.tasks.where('sessionId').equals(ctx.sessionId).filter((t) => t.status === 'pending').count();
    if (pending >= 5) return 'ERROR: 该会话最多 5 个待触发定时消息';

    const label = String(args.label ?? '').slice(0, 80);
    const content = String(args.content ?? '').slice(0, 500);
    if (!content) return 'ERROR: 缺少定时消息内容 content';
    const showNotification = args.show_notification !== false;

    let triggerAt: number;
    if (args.delay_seconds != null) {
      const delay = Number(args.delay_seconds);
      if (delay < 60 || delay > 2_592_000) return 'ERROR: delay_seconds 需在 60~2592000 之间';
      triggerAt = Date.now() + delay * 1000;
    } else if (args.trigger_at) {
      const t = Date.parse(String(args.trigger_at));
      if (Number.isNaN(t)) return 'ERROR: trigger_at 必须是带时区的 ISO 8601 时间';
      triggerAt = t;
    } else {
      return 'ERROR: 需要 delay_seconds 或 trigger_at';
    }

    // 5 分钟内重复内容拦截
    const dup = await db.tasks
      .where('sessionId')
      .equals(ctx.sessionId)
      .filter((t) => t.messageContent === content && t.status === 'pending' && Date.now() - t.createdAt < 5 * 60_000)
      .first();
    if (dup) return 'ERROR: 5 分钟内已有相同内容的定时消息';

    const session2 = await db.sessions.get(ctx.sessionId);
    const character = session2?.associatedId ? await db.npcs.get(session2.associatedId) : null;

    const id = uuid();
    await db.tasks.add({
      id,
      sessionId: ctx.sessionId,
      sourceTurnMessageId: null,
      label: label || '定时消息',
      triggerAtMillis: triggerAt,
      messageContent: content,
      showNotification,
      characterNameSnapshot: character?.name ?? '',
      status: 'pending',
      resultMessage: null,
      createdAt: Date.now(),
      completedAt: null,
    });
    // 启动倒计时（Web 定时器）
    scheduleTask(id, triggerAt);

    return JSON.stringify(
      {
        timer_id: id,
        status: 'pending',
        label: label || '定时消息',
        trigger_at_epoch_ms: triggerAt,
        content,
        scheduling: 'exact',
      },
      null,
      2
    );
  }
  return 'ERROR: 未知操作';
}

const scheduledTimers = new Map<string, number>();

export function scheduleTask(id: string, triggerAtMillis: number): void {
  const existing = scheduledTimers.get(id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, triggerAtMillis - Date.now());
  const timer = window.setTimeout(async () => {
    scheduledTimers.delete(id);
    const task = await db.tasks.get(id);
    if (!task || task.status !== 'pending') return;
    await db.tasks.update(id, { status: 'completed', completedAt: Date.now() });
    // 投递为 assistant 消息（modelUsed 作去重标记）
    await db.messages.add({
      sessionId: task.sessionId,
      role: 'assistant',
      speakerParticipantId: null,
      speakerName: task.characterNameSnapshot || null,
      content: task.messageContent,
      toolCallsJson: '[]',
      toolCallId: null,
      thinkingContent: null,
      timestamp: Date.now(),
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokensPerSec: null,
      modelUsed: `scheduled:${task.id}`,
      attachments: [],
      attachmentInfos: [],
      rawRequestBody: null,
      rawResponseBody: null,
    });
    if (task.showNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('⏰ Tavern Harness 定时消息', {
          body: `${task.characterNameSnapshot ? `[${task.characterNameSnapshot}] ` : ''}${task.messageContent.slice(0, 80)}`,
        });
      } catch {
        /* ignore */
      }
    }
    // 刷新会话预览
    const session = await db.sessions.get(task.sessionId);
    if (session) {
      await db.sessions.update(task.sessionId, { updatedAt: Date.now(), lastMessage: task.messageContent.slice(0, 60) });
    }
  }, delay);
  // 超长延迟（>24.8 天）用远端持久化兜底，由 app 启动时恢复
  if (delay > 2_147_483_647) {
    // IndexedDB 已存任务，下次打开页面时 scheduleRestoredTasks 会重新安排
    scheduledTimers.delete(id);
  } else {
    scheduledTimers.set(id, timer);
  }
}

/** 页面启动时恢复未触发的定时任务 */
export async function scheduleRestoredTasks(): Promise<void> {
  const tasks = await db.tasks.where('status').equals('pending').toArray();
  for (const t of tasks) {
    scheduleTask(t.id, t.triggerAtMillis);
  }
}

async function handleGetTavernStatus(args: Record<string, unknown>): Promise<string> {
  const fields = Array.isArray(args.fields) ? (args.fields as string[]) : [];
  if (fields.length === 0) return 'ERROR: 需要至少一个 fields 字段';
  const out: Record<string, unknown> = {};

  if (fields.includes('characters')) {
    const npcs = await db.npcs.toArray();
    out.characters = npcs.map((n) => ({
      name: n.name,
      greeting: n.greeting,
      is_default: n.isBuiltIn,
      enabled_skills: n.enabledToolNames,
    }));
  }
  if (fields.includes('world_books')) {
    const books = await db.worldBooks.toArray();
    out.world_books = books.map((b) => ({ name: b.name }));
  }
  if (fields.includes('skills')) {
    const tools = await db.tools.toArray();
    out.skills = tools.map((t) => {
      const parsed = safeJsonParse<ChatCompletionTool>(t.jsonContent);
      const exec = safeJsonParse<{ type?: string }>(t.executionJson);
      return {
        name: t.name,
        description: parsed?.function?.description ?? '',
        is_default: t.isBuiltIn,
        implementation_type: t.isBuiltIn ? 'native' : (exec?.type ?? 'unknown'),
      };
    });
  }
  if (fields.includes('career_stats')) {
    const stats = (await db.careerStats.get(1)) ?? { inputTokens: 0, outputTokens: 0, totalRounds: 0 };
    const sessionCount = await db.careerStats.count();
    const npcStats = await db.careerNpcStats.toArray();
    const mostActive = npcStats.length
      ? npcStats.sort((a, b) => b.rounds - a.rounds)[0]
      : null;
    out.career_stats = {
      input_tokens: stats.inputTokens,
      output_tokens: stats.outputTokens,
      total_tokens: stats.inputTokens + stats.outputTokens,
      total_rounds: stats.totalRounds,
      session_count: sessionCount,
      average_rounds_per_session: sessionCount ? Math.round(stats.totalRounds / sessionCount * 10) / 10 : 0,
      most_active_npc: mostActive?.npcName ?? null,
      most_active_npc_rounds: mostActive?.rounds ?? 0,
    };
  }
  return JSON.stringify(out, null, 2);
}

// ---------- 技能 CRUD ----------

function validateSkillArgs(args: Record<string, unknown>): string | null {
  const name = String(args.name ?? '');
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(name)) return '技能名需为 3-40 位小写字母数字下划线（字母开头）';
  const desc = String(args.description ?? '');
  if (desc.length > 500) return '描述超过 500 字符';
  const params = args.parameters as Record<string, unknown> | undefined;
  if (params && params.type !== 'object') return '参数必须是 object 类型 schema';
  return null;
}

async function createSkillTool(name: string, description: string, parameters: Record<string, unknown>, execution: unknown): Promise<McpTool> {
  const tool: ChatCompletionTool = {
    type: 'function',
    function: { name, description, parameters: parameters ?? { type: 'object', properties: {} } },
  };
  return {
    name,
    jsonContent: JSON.stringify(tool),
    executionJson: execution ? JSON.stringify(execution) : null,
    isBuiltIn: false,
    createdAt: Date.now(),
    displayOrder: (await db.tools.count()) + 1,
  };
}

async function handleCreateSkill(args: Record<string, unknown>): Promise<string> {
  const err = validateSkillArgs(args);
  if (err) return `ERROR: ${err}`;
  const name = String(args.name);
  const exists = await db.tools.where('name').equals(name).first();
  if (exists) return `ERROR: 技能 ${name} 已存在`;
  const tool = await createSkillTool(name, String(args.description ?? ''), (args.parameters as Record<string, unknown>) ?? {}, args.execution);
  await db.tools.add(tool);
  return `OK: 已创建技能 ${name}。注意：新技能默认未对任何角色启用，可用 update_character 的 enable_skills 启用。`;
}

async function handleUpdateSkill(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const tool = await db.tools.where('name').equals(name).first();
  if (!tool) return `ERROR: 技能 ${name} 不存在`;
  if (tool.isBuiltIn) return `ERROR: 内置技能 ${name} 受保护，不可修改`;
  const newName = args.new_name ? String(args.new_name) : tool.name;
  if (args.new_name && !/^[a-z][a-z0-9_]{2,39}$/.test(newName)) return 'ERROR: 新技能名不合法';
  if (args.new_name && (await db.tools.where('name').equals(newName).first())) return `ERROR: 技能 ${newName} 已存在`;

  const parsed = safeJsonParse<ChatCompletionTool>(tool.jsonContent);
  const updatedTool = {
    ...tool,
    name: newName,
    jsonContent: JSON.stringify({
      type: 'function',
      function: {
        name: newName,
        description: args.description != null ? String(args.description) : parsed?.function?.description ?? '',
        parameters: args.parameters ?? parsed?.function?.parameters ?? { type: 'object', properties: {} },
      },
    }),
    executionJson: args.execution ? JSON.stringify(args.execution) : tool.executionJson,
  };
  await db.tools.put(updatedTool);
  // 同步角色启用的技能名
  if (newName !== name) {
    const npcs = await db.npcs.toArray();
    for (const n of npcs) {
      if (n.enabledToolNames.includes(name)) {
        await db.npcs.update(n.id!, {
          enabledToolNames: n.enabledToolNames.map((t) => (t === name ? newName : t)),
        });
      }
    }
  }
  return `OK: 已更新技能 ${name}`;
}

async function handleDeleteSkill(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const tool = await db.tools.where('name').equals(name).first();
  if (!tool) return `ERROR: 技能 ${name} 不存在`;
  if (tool.isBuiltIn) return `ERROR: 内置技能 ${name} 受保护，不可删除`;
  await db.tools.delete(tool.id!);
  // 清理角色引用
  const npcs = await db.npcs.toArray();
  for (const n of npcs) {
    if (n.enabledToolNames.includes(name)) {
      await db.npcs.update(n.id!, { enabledToolNames: n.enabledToolNames.filter((t) => t !== name) });
    }
  }
  return `OK: 已删除技能 ${name}`;
}

// ---------- 角色 CRUD ----------

async function handleCreateCharacter(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '').trim();
  const greeting = String(args.greeting ?? '');
  const prompt = String(args.prompt ?? '');
  if (!name || !greeting || !prompt) return 'ERROR: 需要 name / greeting / prompt';
  const exists = await db.npcs.where('name').equals(name).first();
  if (exists) return `ERROR: 角色 ${name} 已存在`;
  await db.npcs.add({
    name,
    prompt,
    greeting,
    avatarColorOrdinal: Math.floor(Math.random() * 6),
    avatarDataUrl: null,
    enabledToolNames: [],
    isBuiltIn: false,
    createdAt: Date.now(),
  });
  return `OK: 已创建角色 ${name}`;
}

async function handleUpdateCharacter(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const npc = await db.npcs.where('name').equals(name).first();
  if (!npc) return `ERROR: 角色 ${name} 不存在`;
  const updates: Partial<import('../../types/models').NpcCharacter> = {};
  if (args.new_name) {
    const n = String(args.new_name);
    if (await db.npcs.where('name').equals(n).first()) return `ERROR: 角色 ${n} 已存在`;
    updates.name = n;
  }
  if (args.greeting != null) updates.greeting = String(args.greeting).slice(0, 1000);
  if (args.prompt != null) updates.prompt = String(args.prompt).slice(0, 4000);
  if (Array.isArray(args.enable_skills) || Array.isArray(args.disable_skills)) {
    const allTools = new Set((await db.tools.toArray()).map((t) => t.name));
    const enabled = new Set(npc.enabledToolNames);
    for (const s of args.enable_skills as string[]) {
      if (!allTools.has(s)) return `ERROR: 技能 ${s} 不存在`;
      enabled.add(s);
    }
    for (const s of args.disable_skills as string[]) {
      enabled.delete(s);
    }
    updates.enabledToolNames = [...enabled];
  }
  if (Object.keys(updates).length > 0) await db.npcs.update(npc.id!, updates);
  return `OK: 已更新角色 ${name}`;
}

async function handleDeleteCharacter(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const npc = await db.npcs.where('name').equals(name).first();
  if (!npc) return `ERROR: 角色 ${name} 不存在`;
  if (npc.isBuiltIn) return `ERROR: 内置角色 ${name} 受保护，不可删除`;
  await db.npcs.delete(npc.id!);
  // 清理会话关联（删除关联会话？App 中保留用户会话，仅解绑）
  const sessions = await db.sessions.where('associatedId').equals(npc.id!).toArray();
  for (const s of sessions) {
    await db.sessions.update(s.id!, { associatedId: null });
    await db.participants.where('[sessionId+participantId]').equals([s.id!, npc.id!]).delete();
  }
  return `OK: 已删除角色 ${name}`;
}

// ---------- 世界书 CRUD ----------

async function handleCreateWorldBook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '').trim();
  const content = String(args.content ?? '');
  if (!name || !content) return 'ERROR: 需要 name / content';
  if (await db.worldBooks.where('name').equals(name).first()) return `ERROR: 世界书 ${name} 已存在`;
  await db.worldBooks.add({ name, content: content.slice(0, 10_000), imageUri: null, createdAt: Date.now() });
  return `OK: 已创建世界书 ${name}`;
}

async function handleUpdateWorldBook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const book = await db.worldBooks.where('name').equals(name).first();
  if (!book) return `ERROR: 世界书 ${name} 不存在`;
  const updates: Partial<import('../../types/models').WorldBook> = {};
  if (args.new_name) updates.name = String(args.new_name).slice(0, 60);
  if (args.content != null) updates.content = String(args.content).slice(0, 10_000);
  await db.worldBooks.update(book.id!, updates);
  return `OK: 已更新世界书 ${name}`;
}

async function handleDeleteWorldBook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const book = await db.worldBooks.where('name').equals(name).first();
  if (!book) return `ERROR: 世界书 ${name} 不存在`;
  await db.worldBooks.delete(book.id!);
  const sessions = await db.sessions.toArray();
  for (const s of sessions) {
    if (s.worldBookId === book.id) await db.sessions.update(s.id!, { worldBookId: null });
  }
  return `OK: 已删除世界书 ${name}`;
}

// ---------- 工具列举 ----------

export async function listToolNames(): Promise<string[]> {
  const tools = await db.tools.toArray();
  return tools.map((t) => t.name).sort();
}

export function getBuiltinTools(): ChatCompletionTool[] {
  return BUILTIN_TOOLS;
}

/** 根据会话与当前发言人获取已启用的工具列表（NPC 会话取 associatedId，群聊取当前发言人 NPC） */
export async function getEnabledToolsForSession(
  sessionId: number,
  activeSpeakerParticipantId: number | null
): Promise<ChatCompletionTool[]> {
  const session = await db.sessions.get(sessionId);
  if (!session) return [];

  let npcId: number | null = session.associatedId;
  if (session.mode === 'GROUP' && activeSpeakerParticipantId != null) {
    const p = await db.participants
      .where('[sessionId+participantId]')
      .equals([sessionId, activeSpeakerParticipantId])
      .first();
    npcId = p?.npcId ?? null;
  }
  if (npcId == null) return [];
  const npc = await db.npcs.get(npcId);
  if (!npc) return [];

  const enabled = new Set(Array.isArray(npc.enabledToolNames) ? npc.enabledToolNames : []);
  if (enabled.size === 0) return [];

  const allTools = await db.tools.toArray();
  const result: ChatCompletionTool[] = [];
  for (const t of allTools) {
    if (!enabled.has(t.name)) continue;
    const parsed = safeJsonParse(t.jsonContent) as ChatCompletionTool | null;
    if (parsed) result.push(parsed);
  }
  return result;
}

export function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export { SHELL_ALLOWED };