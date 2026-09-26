import { db } from '../../db/database';
import { createSession } from '../../store/store';
import type {
  ChatCompletionTool,
  ChatSession,
  GeneratedSkillExecution,
  McpTool,
  ToolConfirmationRequest,
} from '../../types/models';
import { BUILTIN_TOOL_NAMES } from '../toolDefinitions';
import { rollDice } from './builtinTools';
import {
  executeGeneratedSkill,
  normalizeWorkspaceDir,
  readWorkspaceFileText,
  truncateToolOutput,
  writeWorkspaceFileTextFor,
} from './generatedSkillExecutor';

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
  /** 发起工具调用的 NPC。 */
  npcId: number | null;
  /** 用户确认回调：返回 Promise<boolean> */
  requestConfirmation: (req: ToolConfirmationRequest) => Promise<boolean>;
}

/**
 * 执行一个工具调用（原生或生成式）。
 * 修改/删除类工具的统一确认入口在外层白名单（store.ts 回合循环）；
 * shell 类工具的确认在执行过程中按需触发（沙箱服务判定）。
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
    return 'ERROR: Tool arguments are not valid JSON';
  }

  // 系统消息层：自动执行幻觉工具名（未知工具）
  if (route === 'BLOCKED') {
    return `ERROR: Tool '${toolName}' does not exist or is unavailable. Available tools: ${(await listToolNames()).join(', ')}`;
  }

  // 原生路由
  if (route === 'NATIVE') {
    return runNativeTool(toolName, args, ctx);
  }

  // 生成式技能（STANDARD 路由）：不在当前会话启用检查由上层决定
  if (mcpTool && mcpTool.executionJson) {
    try {
      const execution = JSON.parse(mcpTool.executionJson) as GeneratedSkillExecution;
      const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
      return await executeGeneratedSkill(execution, args, ctx.requestConfirmation, workspaceDir);
    } catch (e) {
      return `ERROR: Invalid skill implementation: ${(e as Error).message}`;
    }
  }
  return `ERROR: Skill '${toolName}' has no implementation`;
}

/**
 * 把工具调用工作目录切到当前会话的沙箱目录。
 * 内置酒馆老板的 NPC 单人会话固定使用 public；其他会话使用专属目录。
 * 会话记录上的 workspaceDir（如 "session-12"）由创建会话时生成；
 * 旧会话没有该字段或数据库读取失败时，也回退到 session-<id>，避免意外扩大权限。
 */
export async function applySessionWorkspace(sessionId: number, npcId?: number | null): Promise<string> {
  let dir = `session-${sessionId}`;
  try {
    const session = await db.sessions.get(sessionId);
    if (session?.mode === 'NPC' && session.associatedId != null) {
      const effectiveNpcId = npcId === undefined ? session.associatedId : npcId;
      if (effectiveNpcId === session.associatedId && (await db.npcs.get(effectiveNpcId))?.isBuiltIn) {
        return 'public';
      }
    }
    if (session && typeof (session as ChatSession).workspaceDir === 'string') {
      dir = (session as ChatSession).workspaceDir!;
    }
  } catch {
    dir = `session-${sessionId}`;
  }
  return normalizeWorkspaceDir(dir) ?? `session-${sessionId}`;
}

async function runNativeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<string> {
  switch (toolName) {
    case 'roll_dice': {
      const expr = String(args.expression ?? '');
      if (!expr) return 'ERROR: Missing expression';
      return rollDice(expr);
    }
    case 'file_read':
      return await handleFileRead(args, ctx);
    case 'file_write':
      return await handleFileWrite(args, ctx);
    case 'file_edit':
      return await handleFileEdit(args, ctx);
    case 'run_shell_script':
      return await handleRunShellScript(args, ctx);

    case 'get_tavern_info':
      return await handleGetTavernInfo(args);
    case 'get_character_info':
      return await handleGetCharacterInfo(args);
    case 'get_lorebook_info':
      return await handleGetLorebookInfo(args);

    case 'file_display':
      return await handleFileDisplay(args, ctx);

    case 'create_skill':
      return await handleCreateSkill(args);
    // 修改/删除组的确认统一在外层白名单（store.ts 回合循环）收口，此处直接执行
    case 'update_skill':
      return await handleUpdateSkill(args);
    case 'delete_skill':
      return await handleDeleteSkill(args);

    case 'create_character':
      return await handleCreateCharacter(args);
    case 'update_character':
      return await handleUpdateCharacter(args);
    case 'delete_character':
      return await handleDeleteCharacter(args);

    case 'create_conversation':
      return await handleCreateConversation(args);
    case 'create_lorebook':
      return await handleCreateLorebook(args);
    case 'update_lorebook':
      return await handleUpdateLorebook(args);
    case 'delete_lorebook':
      return await handleDeleteLorebook(args);

    default:
      return `ERROR: Unknown tool ${toolName}`;
  }
}

// ============================================================
// 原生工具实现
// ============================================================

async function handleGetTavernInfo(args: Record<string, unknown>): Promise<string> {
  const fields = Array.isArray(args.fields) ? (args.fields as string[]) : [];
  if (fields.length === 0) return 'ERROR: At least one field is required';
  const out: Record<string, unknown> = {};

  if (fields.includes('characters')) {
    const npcs = await db.npcs.toArray();
    out.characters = npcs.map((n) => ({
      name: n.name,
      is_default: n.isBuiltIn,
    }));
  }
  if (fields.includes('lorebooks')) {
    const books = await db.worldBooks.toArray();
    out.lorebooks = books.map((b) => ({ name: b.name }));
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
    const sessionCount = await db.sessions.count();
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

async function handleGetCharacterInfo(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '').trim();
  if (!name) return 'ERROR: Missing name';
  const npc = await db.npcs.where('name').equals(name).first();
  if (!npc) return `ERROR: Character ${name} does not exist`;
  return JSON.stringify({
    name: npc.name,
    prompt: npc.prompt,
    greeting: npc.greeting,
    alternate_greetings: npc.alternateGreetings ?? [],
    is_default: npc.isBuiltIn,
    enabled_skills: npc.enabledToolNames,
  }, null, 2);
}

async function handleGetLorebookInfo(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '').trim();
  if (!name) return 'ERROR: Missing name';
  const book = await db.worldBooks.where('name').equals(name).first();
  if (!book) return `ERROR: Lorebook ${name} does not exist`;
  return JSON.stringify({ name: book.name, content: book.content }, null, 2);
}

// ---------- file_display（弹窗展示工作区文件，只读） ----------

/**
 * 结果中携带的展示引用标记前缀。store 在落库工具结果时会解析它，
 * 把 JSON 部分写入消息的 displayRef 字段，并自动打开展示弹窗。
 * 对模型返回的仍是可读文本（不暴露内部标记）。
 */
export const DISPLAY_REF_PREFIX = 'DISPLAY_REF: ';

export interface DisplayPayload {
  path: string;
  kind: 'text' | 'image' | 'html';
  title?: string;
}

/** 解析工具结果中的展示引用（无标记返回 null） */
export function parseDisplayRef(result: string): DisplayPayload | null {
  if (!result.startsWith(DISPLAY_REF_PREFIX)) return null;
  // DISPLAY_REF 是结果的第一行，JSON 后可能还有换行和摘要文本
  const firstLine = result.slice(DISPLAY_REF_PREFIX.length).split('\n')[0]!;
  try {
    const obj = JSON.parse(firstLine) as DisplayPayload;
    if (!obj || typeof obj.path !== 'string' || !['text', 'image', 'html'].includes(obj.kind)) return null;
    return { path: obj.path, kind: obj.kind, title: typeof obj.title === 'string' ? obj.title : undefined };
  } catch {
    return null;
  }
}

/** 读取本地沙箱工作区文件并生成展示结果 */
async function handleFileDisplay(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  try {
    const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
    // 与 file_read 对齐：仅允许会话工作区内相对路径；public 软链只读
    const rawPath = String(args.path ?? '').replace(/\\/g, '/').trim();
    if (!rawPath) return 'ERROR: Invalid path';
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;

    // 从文件后缀推断展示方式
    const ext = /\.([A-Za-z0-9]+)$/.exec(rawPath);
    const extLower = ext ? ext[1].toLowerCase() : '';
    const kind: DisplayPayload['kind'] =
      /^(html?)$/i.test(extLower) ? 'html' :
      /^(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(extLower) ? 'image' :
      'text';

    const content = await readWorkspaceFileText(rawPath, workspaceDir);
    if (content === null) {
      return `ERROR: File not found: ${rawPath}`;
    }
    const payload: DisplayPayload = { path: rawPath, kind, title };
    // 第一行携带展示引用（store 解析并写入 displayRef / 自动弹窗）。
    // 不做内容摘要：完整内容在展示弹窗里，模型如需阅读应改用 file_read。
    return `${DISPLAY_REF_PREFIX}${JSON.stringify(payload)}\nOK: 已在弹窗中展示 ${rawPath}（kind=${kind}）`;
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

// ---------- file_read / file_write / run_shell_script（内置技能，复用生成式执行引擎的本地能力） ----------

async function handleFileRead(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  try {
    const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
    const path = String(args.path ?? '').replace(/\\/g, '/').trim();
    if (!path) return 'ERROR: Invalid path';
    const content = await readWorkspaceFileText(path, workspaceDir);
    if (content === null) {
      return `ERROR: File not found: ${path}`;
    }
    return truncateToolOutput(content);
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

async function handleFileWrite(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
  return executeGeneratedSkill(
    { type: 'file_write', path: String(args.path ?? ''), content: String(args.content ?? ''), append: args.append === true },
    args,
    ctx.requestConfirmation,
    workspaceDir,
  );
}

async function handleFileEdit(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
  try {
    const path = String(args.path ?? '').replace(/\\/g, '/').trim();
    const oldText = String(args.old_text ?? '');
    const newText = String(args.new_text ?? '');
    const expected = args.expected_replacements == null ? 1 : Number(args.expected_replacements);
    if (!path) return 'ERROR: Invalid path';
    if (!oldText) return 'ERROR: old_text must not be empty';
    if (!Number.isInteger(expected) || expected < 1 || expected > 100) {
      return 'ERROR: expected_replacements must be an integer from 1 to 100';
    }

    const content = await readWorkspaceFileText(path, workspaceDir);
    if (content === null) return `ERROR: File not found: ${path}`;
    const matches = content.split(oldText).length - 1;
    if (matches !== expected) {
      return `ERROR: ${path} was not modified: old_text matched ${matches} times; expected ${expected}`;
    }

    // 与 file_write 对齐：仅工作区内写入；public 软链写入直接拒绝
    await writeWorkspaceFileTextFor(
      path,
      content.split(oldText).join(newText),
      workspaceDir,
    );
    return `OK: 已编辑 ${path}，替换 ${matches} 处`;
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

async function handleRunShellScript(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<string> {
  const workspaceDir = await applySessionWorkspace(ctx.sessionId, ctx.npcId);
  return executeGeneratedSkill(
    { type: 'shell', script: String(args.script ?? '') },
    args,
    ctx.requestConfirmation,
    workspaceDir,
  );
}

// ---------- 技能 CRUD ----------

function validateSkillArgs(args: Record<string, unknown>): string | null {
  const name = String(args.name ?? '');
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(name)) return 'Skill name must contain 3-40 lowercase letters, digits, or underscores and start with a letter';
  const desc = String(args.description ?? '');
  if (desc.length > 500) return 'Description exceeds 500 characters';
  const params = args.parameters as Record<string, unknown> | undefined;
  if (params && params.type !== 'object') return 'Parameters must use an object schema';
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
    origin: 'custom',
    createdAt: Date.now(),
    displayOrder: (await db.tools.count()) + 1,
  };
}

async function handleCreateSkill(args: Record<string, unknown>): Promise<string> {
  const err = validateSkillArgs(args);
  if (err) return `ERROR: ${err}`;
  const name = String(args.name);
  const exists = await db.tools.where('name').equals(name).first();
  if (exists) return `ERROR: Skill ${name} already exists`;
  const tool = await createSkillTool(name, String(args.description ?? ''), (args.parameters as Record<string, unknown>) ?? {}, args.execution);
  await db.tools.add(tool);
  return `OK: 已创建技能 ${name}。注意：新技能默认未对任何角色启用，可用 update_character 的 enable_skills 启用。`;
}

async function handleUpdateSkill(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const tool = await db.tools.where('name').equals(name).first();
  if (!tool) return `ERROR: Skill ${name} does not exist`;
  if (tool.isBuiltIn) return `ERROR: Built-in skill ${name} is protected and cannot be modified`;
  const newName = args.new_name ? String(args.new_name) : tool.name;
  if (args.new_name && !/^[a-z][a-z0-9_]{2,39}$/.test(newName)) return 'ERROR: Invalid new skill name';
  if (args.new_name && (await db.tools.where('name').equals(newName).first())) return `ERROR: Skill ${newName} already exists`;

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
  if (!tool) return `ERROR: Skill ${name} does not exist`;
  if (tool.isBuiltIn) return `ERROR: Built-in skill ${name} is protected and cannot be deleted`;
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
  if (!name || !greeting || !prompt) return 'ERROR: name, greeting, and prompt are required';
  const exists = await db.npcs.where('name').equals(name).first();
  if (exists) return `ERROR: Character ${name} already exists`;
  const alternates = Array.isArray(args.alternate_greetings)
    ? (args.alternate_greetings as unknown[])
        .map((g) => String(g ?? '').trim())
        .filter((g, i, arr) => g && g !== greeting && arr.indexOf(g) === i)
        .slice(0, 20)
        .map((g) => g.slice(0, 1000))
    : [];
  await db.npcs.add({
    name,
    prompt,
    greeting,
    alternateGreetings: alternates,
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
  if (!npc) return `ERROR: Character ${name} does not exist`;
  const updates: Partial<import('../../types/models').NpcCharacter> = {};
  if (args.new_name) {
    const n = String(args.new_name);
    if (await db.npcs.where('name').equals(n).first()) return `ERROR: Character ${n} already exists`;
    updates.name = n;
  }
  if (args.greeting != null) updates.greeting = String(args.greeting).slice(0, 1000);
  if (Array.isArray(args.alternate_greetings)) {
    updates.alternateGreetings = (args.alternate_greetings as unknown[])
      .map((g) => String(g ?? '').trim())
      .filter((g, i, arr) => g && g !== String(args.greeting ?? npc.greeting) && arr.indexOf(g) === i)
      .slice(0, 20)
      .map((g) => g.slice(0, 1000));
  }
  if (args.prompt != null) updates.prompt = String(args.prompt).slice(0, 4000);
  if (Array.isArray(args.enable_skills) || Array.isArray(args.disable_skills)) {
    const allTools = new Set((await db.tools.toArray()).map((t) => t.name));
    const enabled = new Set(npc.enabledToolNames);
    if (Array.isArray(args.enable_skills)) {
      for (const s of args.enable_skills) {
        if (!allTools.has(s)) return `ERROR: Skill ${s} does not exist`;
        enabled.add(s);
      }
    }
    if (Array.isArray(args.disable_skills)) {
      for (const s of args.disable_skills) {
        enabled.delete(s);
      }
    }
    updates.enabledToolNames = [...enabled];
  }
  if (Object.keys(updates).length > 0) await db.npcs.update(npc.id!, updates);
  return `OK: 已更新角色 ${name}`;
}

async function handleDeleteCharacter(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const npc = await db.npcs.where('name').equals(name).first();
  if (!npc) return `ERROR: Character ${name} does not exist`;
  if (npc.isBuiltIn) return `ERROR: Built-in character ${name} is protected and cannot be deleted`;
  await db.npcs.delete(npc.id!);
  // 清理会话关联（删除关联会话？App 中保留用户会话，仅解绑）
  const sessions = await db.sessions.where('associatedId').equals(npc.id!).toArray();
  for (const s of sessions) {
    await db.sessions.update(s.id!, { associatedId: null });
    await db.participants.where('[sessionId+participantId]').equals([s.id!, npc.id!]).delete();
  }
  return `OK: 已删除角色 ${name}`;
}

async function handleCreateConversation(args: Record<string, unknown>): Promise<string> {
  const rawParticipants = Array.isArray(args.participants)
    ? (args.participants as unknown[]).map((name) => String(name ?? '').trim()).filter(Boolean)
    : [];
  if (rawParticipants.length === 0) return 'ERROR: At least one participating character is required';
  if (new Set(rawParticipants).size !== rawParticipants.length) return 'ERROR: participants contains duplicate characters';

  const npcIds: number[] = [];
  const npcNameToId = new Map<string, number>();
  for (const name of rawParticipants) {
    const npc = await db.npcs.where('name').equals(name).first();
    if (!npc?.id) return `ERROR: Character ${name} does not exist`;
    npcIds.push(npc.id);
    npcNameToId.set(npc.name, npc.id);
  }

  let worldBookId: number | null = null;
  if (args.world_book != null) {
    const worldBookName = String(args.world_book).trim();
    if (worldBookName) {
      const worldBook = await db.worldBooks.where('name').equals(worldBookName).first();
      if (!worldBook?.id) return `ERROR: Lorebook ${worldBookName} does not exist`;
      worldBookId = worldBook.id;
    }
  }

  let userPersonaNpcId: number | null = null;
  if (args.user_persona != null) {
    const personaName = String(args.user_persona).trim();
    if (personaName) {
      const persona = await db.npcs.where('name').equals(personaName).first();
      if (!persona?.id) return `ERROR: User persona ${personaName} does not exist`;
      userPersonaNpcId = persona.id;
    }
  }

  const orderTokens = Array.isArray(args.speaking_order)
    ? (args.speaking_order as unknown[]).map((token) => String(token ?? '').trim()).filter(Boolean)
    : [];
  const playerAliases = new Set(['user', 'player', 'me', 'self', 'you', '用户', '用戶', '玩家']);
  const participantOrder: number[] = [];
  for (const token of orderTokens) {
    const normalized = token.toLowerCase();
    if (playerAliases.has(normalized)) {
      if (participantOrder.includes(-1)) return 'ERROR: Player appears more than once in the speaking order';
      participantOrder.push(-1);
      continue;
    }
    const npcId = npcNameToId.get(token);
    if (npcId == null) return `ERROR: Participant ${token} in the speaking order does not exist`;
    if (participantOrder.includes(npcId)) return `ERROR: Participant ${token} appears more than once in the speaking order`;
    participantOrder.push(npcId);
  }
  for (const participantId of [-1, ...npcIds]) {
    if (!participantOrder.includes(participantId)) participantOrder.push(participantId);
  }

  const mode = npcIds.length === 1 ? 'NPC' : 'GROUP';
  const sessionId = await createSession(mode, {
    associatedId: npcIds[0],
    npcIds,
    title: String(args.title ?? '').trim().slice(0, 60) || undefined,
    worldBookId,
    userPersonaNpcId,
    turnOrderMode: args.random_order === true ? 'RANDOM' : 'PRESET',
    participantOrder,
    enableGreeting: args.enable_greeting !== false,
  });
  return JSON.stringify({
    session_id: sessionId,
    mode,
    participant_count: npcIds.length + 1,
    random_order: args.random_order === true,
    greeting_enabled: args.enable_greeting !== false,
  }, null, 2);
}

// ---------- Lorebook CRUD ----------

async function handleCreateLorebook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '').trim();
  const content = String(args.content ?? '');
  if (!name || !content) return 'ERROR: name and content are required';
  if (await db.worldBooks.where('name').equals(name).first()) return `ERROR: Lorebook ${name} already exists`;
  await db.worldBooks.add({ name, content: content.slice(0, 10_000), imageUri: null, createdAt: Date.now() });
  return `OK: 已创建世界书 ${name}`;
}

async function handleUpdateLorebook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const book = await db.worldBooks.where('name').equals(name).first();
  if (!book) return `ERROR: Lorebook ${name} does not exist`;
  const updates: Partial<import('../../types/models').WorldBook> = {};
  if (args.new_name) updates.name = String(args.new_name).slice(0, 60);
  if (args.content != null) updates.content = String(args.content).slice(0, 10_000);
  await db.worldBooks.update(book.id!, updates);
  return `OK: 已更新世界书 ${name}`;
}

async function handleDeleteLorebook(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? '');
  const book = await db.worldBooks.where('name').equals(name).first();
  if (!book) return `ERROR: Lorebook ${name} does not exist`;
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