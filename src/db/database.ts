import Dexie, { type Table } from 'dexie';
import type {
  ApiProvider,
  AppSettings,
  AchievementUnlock,
  CareerNpcStat,
  CareerStatsTotal,
  ChatMessage,
  ChatParticipant,
  ChatSession,
  ContextCompression,
  McpTool,
  NpcCharacter,
  WorldBook,
  AppLanguage,
} from '../types/models';
import { BUILTIN_TOOLS, ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';
import { currentLanguage, translate } from '../core/i18n';
import BUILTIN_TAVERN_HANDBOOK_CONTENT from '../assets/tavern-handbook.md?raw';

export class TavernDB extends Dexie {
  settings!: Table<AppSettings, number>;
  providers!: Table<ApiProvider, number>;
  npcs!: Table<NpcCharacter, number>;
  sessions!: Table<ChatSession, number>;
  participants!: Table<ChatParticipant, number>;
  messages!: Table<ChatMessage, number>;
  contextCompressions!: Table<ContextCompression, number>;
  tools!: Table<McpTool, number>;
  worldBooks!: Table<WorldBook, number>;
  careerStats!: Table<CareerStatsTotal, number>;
  careerNpcStats!: Table<CareerNpcStat, number>;
  achievementUnlocks!: Table<AchievementUnlock, number>;

  constructor() {
    super('tavern-harness');
    this.version(1).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      workspaceFiles: 'path, updatedAt',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v2：sessions 增加 pinned 索引（置顶会话）；存量记录的 pinned 在打开后归一化
    this.version(2).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      workspaceFiles: 'path, updatedAt',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v3：移除已退役的定时消息表 tasks（升级时 Dexie 自动 deleteObjectStore('tasks')，物理清理旧库残留）
    this.version(3).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      workspaceFiles: 'path, updatedAt',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v4：sessions 增加 workspaceDir 索引（会话专属沙箱工作目录，以会话 id 为名）
    this.version(4).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      workspaceFiles: 'path, updatedAt',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v5：移除已由会话沙箱文件 API 取代的 workspaceFiles 表
    this.version(5).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v6：新增上下文压缩记录。
    this.version(6).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      contextCompressions: '++id, sessionId, endMessageId, createdAt',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    // v7 已在本地运行，保留版本边界以避免 IndexedDB 降级导致 VersionError。
    this.version(7).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      contextCompressions: '++id, sessionId, endMessageId, createdAt',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    this.version(8).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      contextCompressions: '++id, sessionId, endMessageId, createdAt',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    this.version(9).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      contextCompressions: '++id, sessionId, endMessageId, createdAt',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name, isBuiltIn',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
    this.version(10).stores({
      settings: 'id',
      providers: '++id, name, isEnabled',
      npcs: '++id, name, isBuiltIn, isTavernKeeper',
      sessions: '++id, mode, updatedAt, associatedId, pinned, workspaceDir',
      participants: '[sessionId+participantId], sessionId, participantId',
      messages: '++id, [sessionId+timestamp], sessionId, timestamp',
      contextCompressions: '++id, sessionId, endMessageId, createdAt',
      tools: '++id, name, isBuiltIn',
      worldBooks: '++id, name, isBuiltIn',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
  }

  /** 打开数据库后立即执行：把 pinned 字段归一化为 0/1（旧记录为 undefined） */
  normalizePinned(): Promise<void> {
    return db.transaction('rw', db.sessions, async () => {
      const sessions = await db.sessions.toArray();
      for (const s of sessions) {
        const v = (s as unknown as { pinned?: unknown }).pinned;
        const pinned = v ? 1 : 0;
        if ((s as unknown as { pinned?: unknown }).pinned !== pinned) {
          await db.sessions.update(s.id!, { pinned });
        }
      }
    });
  }
}

export const db = new TavernDB();

export { BUILTIN_TAVERN_HANDBOOK_CONTENT };

export function builtinTavernHandbookName(): string {
  return translate('builtinWorldbook.name');
}

export function isBuiltinTavernHandbook(book: Pick<WorldBook, 'name' | 'isBuiltIn'>): boolean {
  return book.isBuiltIn === true;
}

export function isTavernKeeper(npc: Pick<NpcCharacter, 'isTavernKeeper'>): boolean {
  return npc.isTavernKeeper === true;
}

const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  baseUrl: 'https://api.openai.com/v1/',
  apiKey: '',
  defaultModel: '',
  defaultProviderId: null,
  themeMode: 'system',
  language: null,
  temperature: 1.0,
  topP: 0.95,
  maxTokens: 0,
  topK: 20,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1,
  reasoningEffort: 'auto',
  contextCompressionThreshold: 'off',
  seed: -1,
  stop: '',
  isStreaming: true,
  isThinkingModeEnabled: true,
  isToolCallsEnabled: true,
  statsResetTime: null,
};

const DEFAULT_STATS: CareerStatsTotal = {
  id: 1,
  inputTokens: 0,
  outputTokens: 0,
  totalRounds: 0,
};

/** 内置酒馆老板：默认启用所有内置技能（名称/人设/开场白随界面语言本地化） */
const DEFAULT_NPC: NpcCharacter = {
  name: translate('builtinNpc.name'),
  prompt: translate('builtinNpc.prompt'),
  greeting: translate('builtinNpc.greeting'),
  avatarColorOrdinal: 3,
  avatarDataUrl: null,
  enabledToolNames: [...ALL_BUILTIN_TOOL_NAMES],
  isBuiltIn: true,
  isTavernKeeper: true,
  createdAt: Date.now(),
};

/** 数据库初始化：种子数据 + 迁移兼容 */
export async function initDatabase(): Promise<void> {
  const count = await db.settings.count();
  if (count === 0) {
    await db.settings.add(DEFAULT_SETTINGS);
  } else {
    const settings = await db.settings.get(1);
    if (settings && settings.contextCompressionThreshold === undefined) {
      await db.settings.update(1, { contextCompressionThreshold: 'off' });
    }
  }
  const statsCount = await db.careerStats.count();
  if (statsCount === 0) {
    await db.careerStats.add(DEFAULT_STATS);
  }
  const npcCount = await db.npcs.count();
  if (npcCount === 0) {
    await db.npcs.add(DEFAULT_NPC);
  }

  // 为旧数据中的唯一内置角色补充酒馆老板标识；多个内置角色时不猜测其身份。
  const tavernKeeper = await db.npcs.filter(isTavernKeeper).first();
  if (tavernKeeper && !tavernKeeper.isBuiltIn) {
    await db.npcs.update(tavernKeeper.id!, { isBuiltIn: true });
  } else if (!tavernKeeper) {
    const builtinNpcs = await db.npcs.filter((n) => n.isBuiltIn).toArray();
    if (builtinNpcs.length === 1) {
      await db.npcs.update(builtinNpcs[0].id!, { isTavernKeeper: true });
    }
  }
  // 内置技能改名迁移：display_file → file_display（须在 seedBuiltinTools 之前，
  // 否则种子先写入 file_display、迁移再把旧 display_file 改同名，会产生重复记录）
  await migrateDisplayFileRename();
  await migrateBuiltinToolRenames();
  // 退役内置技能（web_search / manage_timer）已从默认工具列表移除：清理旧库残留
  await retireRemovedBuiltinTools();
  // 预载内置技能表
  await seedBuiltinTools();
  // 旧数据兼容：enabledToolNames 可能是 CSV 字符串
  await migrateLegacyFields();
  // 补全技能 origin 字段（旧记录：内置 → builtin，其余 → custom）
  await backfillToolOrigins();
  // 内置角色「酒馆老板」默认启用所有内置技能（老数据升级）
  await ensureBossDefaultSkills();
  // 内置世界书始终存在，名称随当前界面语言本地化，内容可由用户编辑。
  await localizeBuiltinTavernHandbook();
  // v2 升级：把存量会话的 pinned 归一化为 0/1
  await db.normalizePinned();
}

/**
 * 内置角色「酒馆老板」文本本地化：按当前界面语言写入本地化名称/人设/开场白。
 * 调用时机：store 应用语言设置（setLanguage）之后，启动时与切换语言时都会执行。
 * 只把仍是内置原始文案（中文/繁体/英文种子之一）的字段替换为当前语言——
 * 用户手动编辑过的内容不会被覆盖。
 */
export async function localizeBuiltinNpc(): Promise<void> {
  const boss = await db.npcs.filter(isTavernKeeper).first();
  if (!boss) return;

  const lang = currentLanguage();
  const prevLang = localStorage.getItem(LOCALIZE_LANG_KEY) as AppLanguage | null;
  // 语言未变化，无需处理
  if (prevLang === lang) return;

  const isPristine = (v: string) => {
    const s = v.trim();
    return (
      s === '酒馆老板' || s === '神秘的酒馆老板，可以响应客人的任何需求' || s === '你来啦！快坐下~' ||
      s === '酒館老闆' || s === '神秘的酒館老闆，可以回應客人的任何需求' || s === '你來啦！快坐下~' ||
      s === 'Tavern Keeper' || s === 'A mysterious tavern keeper who can fulfill any request from guests' || s === 'Welcome! Have a seat~'
    );
  };
  const tName = translate('builtinNpc.name');
  const tPrompt = translate('builtinNpc.prompt');
  const tGreeting = translate('builtinNpc.greeting');

  const updates: Partial<NpcCharacter> = {};
  if (isPristine(boss.name)) updates.name = tName;
  if (isPristine(boss.prompt || '')) updates.prompt = tPrompt;
  if (isPristine(boss.greeting || '')) updates.greeting = tGreeting;
  if (Object.keys(updates).length > 0) {
    await db.npcs.update(boss.id!, updates);
    // 会话标题 / 最后一条消息 / 参与者 / 消息里的旧内置文案一并更新（仅限仍是内置原文的记录）
    const sessions = await db.sessions.toArray();
    for (const s of sessions) {
      const changes: Partial<ChatSession> = {};
      if (s.title === '酒馆老板' || s.title === '酒館老闆' || s.title === 'Tavern Keeper') {
        changes.title = tName;
      }
      if (s.lastMessage && isPristine(s.lastMessage)) {
        changes.lastMessage = tGreeting;
      }
      if (Object.keys(changes).length > 0) {
        await db.sessions.update(s.id!, changes);
      }
    }
    // 参与者 / 消息里的旧内置文案一并更新（仅限仍是内置原文的记录）
    const participants = await db.participants.toArray();
    for (const p of participants) {
      if (
        p.kind === 'NPC' &&
        p.npcId === boss.id &&
        (p.displayName === '酒馆老板' || p.displayName === '酒館老闆' || p.displayName === 'Tavern Keeper')
      ) {
        await db.participants.update(p, { displayName: tName });
      }
    }
    const messages = await db.messages.toArray();
    for (const m of messages) {
      if (
        m.speakerParticipantId === boss.id &&
        (m.speakerName === '酒馆老板' || m.speakerName === '酒館老闆' || m.speakerName === 'Tavern Keeper')
      ) {
        await db.messages.update(m.id!, { speakerName: tName });
      }
    }
  }

  if (prevLang !== lang) {
    localStorage.setItem(LOCALIZE_LANG_KEY, lang);
  }
}

/** 内置世界书：识别任意已知语言名称，避免升级或语言切换时创建重复条目。 */
export async function localizeBuiltinTavernHandbook(): Promise<void> {
  const book = await db.worldBooks.filter(isBuiltinTavernHandbook).first();
  const name = builtinTavernHandbookName();
  if (book) {
    if (!book.isBuiltIn || book.name !== name) await db.worldBooks.update(book.id!, { isBuiltIn: true, name });
    return;
  }
  await db.worldBooks.add({
    name,
    content: BUILTIN_TAVERN_HANDBOOK_CONTENT,
    imageUri: null,
    isBuiltIn: true,
    createdAt: Date.now(),
  });
}

/** 内置角色本地化标记：记录上次写入内置角色文本时使用的语言 */
const LOCALIZE_LANG_KEY = 'th-builtin-npc-lang';

/** 已退役的内置技能：从默认工具列表中移除后，旧库里的记录不再被 seed 覆盖同步。
 *  迁移时删除工具记录，并从 NPC 启用列表里剔除（历史消息中的工具调用保留原文，仅作展示）。 */
const RETIRED_BUILTIN_TOOL_NAMES = ['web_search', 'manage_timer'];

const RENAMED_BUILTIN_TOOLS: Record<string, string> = {
  get_tavern_status: 'get_tavern_info',
  create_world_book: 'create_lorebook',
  update_world_book: 'update_lorebook',
  delete_world_book: 'delete_lorebook',
};

async function migrateBuiltinToolRenames(): Promise<void> {
  for (const [oldName, newName] of Object.entries(RENAMED_BUILTIN_TOOLS)) {
    const oldTools = (await db.tools.where('name').equals(oldName).toArray()).filter((tool) => tool.isBuiltIn);
    const existingNew = await db.tools.where('name').equals(newName).first();
    for (const oldTool of oldTools) {
      if (existingNew) {
        await db.tools.delete(oldTool.id!);
        continue;
      }
      let jsonContent = oldTool.jsonContent;
      try {
        const parsed = JSON.parse(jsonContent) as { function?: { name?: string } };
        if (parsed.function?.name === oldName) {
          parsed.function.name = newName;
          jsonContent = JSON.stringify(parsed);
        }
      } catch {
        /* seedBuiltinTools will replace malformed built-in definitions */
      }
      await db.tools.update(oldTool.id!, { name: newName, jsonContent });
    }
  }

  const npcs = await db.npcs.toArray();
  for (const npc of npcs) {
    if (!Array.isArray(npc.enabledToolNames)) continue;
    const renamed = npc.enabledToolNames.map((name) => RENAMED_BUILTIN_TOOLS[name] ?? name);
    if (renamed.some((name, index) => name !== npc.enabledToolNames[index])) {
      await db.npcs.update(npc.id!, { enabledToolNames: [...new Set(renamed)] });
    }
  }

  const messages = await db.messages.toArray();
  for (const message of messages) {
    if (!message.toolCallsJson || !Object.keys(RENAMED_BUILTIN_TOOLS).some((name) => message.toolCallsJson.includes(`"${name}"`))) continue;
    try {
      const calls = JSON.parse(message.toolCallsJson) as Array<{ name?: string }>;
      let changed = false;
      for (const call of calls) {
        if (call?.name && RENAMED_BUILTIN_TOOLS[call.name]) {
          call.name = RENAMED_BUILTIN_TOOLS[call.name];
          changed = true;
        }
      }
      if (changed) await db.messages.update(message.id!, { toolCallsJson: JSON.stringify(calls) });
    } catch {
      /* Preserve malformed historical payloads unchanged. */
    }
  }
}

async function retireRemovedBuiltinTools(): Promise<void> {
  for (const name of RETIRED_BUILTIN_TOOL_NAMES) {
    // 删除内置工具记录（仅限 isBuiltIn 的内置记录，同名自定义技能不删）
    const existing = await db.tools.where('name').equals(name).toArray();
    for (const t of existing) {
      if (t.isBuiltIn) await db.tools.delete(t.id!);
    }
    // 从 NPC 启用列表剔除
    const npcs = await db.npcs.toArray();
    for (const n of npcs) {
      if (Array.isArray(n.enabledToolNames) && n.enabledToolNames.includes(name)) {
        await db.npcs.update(n.id!, {
          enabledToolNames: n.enabledToolNames.filter((s) => s !== name),
        });
      }
    }
  }
}

/** 内置技能（只读保护）第一次使用时写库，已存在的同步更新 schema */
async function seedBuiltinTools(): Promise<void> {
  const now = Date.now();
  for (const tool of BUILTIN_TOOLS) {
    const name = tool.function.name;
    const exists = await db.tools.where('name').equals(name).first();
    if (exists) {
      if (exists.isBuiltIn) {
        // 已存在的内置技能：同步最新定义
        await db.tools.update(exists.id!, { jsonContent: JSON.stringify(tool) });
      } else {
        // 同名自定义技能 → 升级为内置（新增内置技能覆盖旧自定义记录）
        await db.tools.update(exists.id!, {
          jsonContent: JSON.stringify(tool),
          executionJson: null,
          isBuiltIn: true,
          origin: 'builtin',
        });
      }
      continue;
    }
    await db.tools.add({
      name,
      jsonContent: JSON.stringify(tool),
      executionJson: null,
      isBuiltIn: true,
      origin: 'builtin',
      createdAt: now,
      displayOrder: await db.tools.count(),
    });
  }
}

/** 内置角色「酒馆老板」默认启用全部内置技能（老数据只启用了 roll_dice 等） */
async function ensureBossDefaultSkills(): Promise<void> {
  const boss = await db.npcs.filter(isTavernKeeper).first();
  if (!boss) return;
  const enabled = new Set(Array.isArray(boss.enabledToolNames) ? boss.enabledToolNames : []);
  let changed = false;
  for (const name of ALL_BUILTIN_TOOL_NAMES) {
    if (!enabled.has(name)) {
      enabled.add(name);
      changed = true;
    }
  }
  if (changed) {
    await db.npcs.update(boss.id!, { enabledToolNames: [...enabled] });
  }
}

async function migrateLegacyFields(): Promise<void> {
  const npcs = await db.npcs.toArray();
  for (const npc of npcs) {
    const v = npc as unknown as { enabledToolNames?: unknown };
    if (v.enabledToolNames != null && typeof v.enabledToolNames !== 'object') {
      await db.npcs.update(npc.id!, {
        enabledToolNames: String(v.enabledToolNames).split(',').filter(Boolean),
      });
    }
  }
}

/**
 * 补全历史技能的 origin 字段（origin 加入前创建的工具没有该字段）：
 * 内置技能 → 'builtin'；其余旧工具无法追溯来源，一律归为 'custom'。
 */
async function backfillToolOrigins(): Promise<void> {
  const tools = await db.tools.toArray();
  for (const t of tools) {
    if (t.origin) continue;
    await db.tools.update(t.id!, { origin: t.isBuiltIn ? 'builtin' : 'custom' });
  }
}

/**
 * 内置技能改名/去重迁移：display_file → file_display。
 * 处理两种历史遗留：
 * A. 旧内置 display_file 尚未改名 → 改名（若 file_display 已存在则直接删除旧记录）。
 * B. 库中已有重复的 file_display（改名迁移曾被中断/重复执行，或旧版与新代码
 *    各播种过一次）→ 保留一条（displayOrder 最小者），删除其余内置重复项。
 * 同时更新 npcs.enabledToolNames 与 messages.toolCallsJson 里的技能名引用，
 * 保证老数据升级后新名字下的路由/展示/回看全部生效。
 */
async function migrateDisplayFileRename(): Promise<void> {
  const OLD = 'display_file';
  const NEW = 'file_display';

  // A. display_file → file_display（幂等：绝不产生两条 file_display）
  const oldTool = await db.tools.where('name').equals(OLD).first();
  if (oldTool && oldTool.isBuiltIn) {
    const newTool = await db.tools.where('name').equals(NEW).first();
    if (newTool && newTool.isBuiltIn) {
      await db.tools.delete(oldTool.id!);
    } else {
      let jsonContent = oldTool.jsonContent;
      try {
        const parsed = JSON.parse(jsonContent) as { function?: { name?: string } };
        if (parsed?.function?.name === OLD) {
          parsed.function.name = NEW;
          jsonContent = JSON.stringify(parsed);
        }
      } catch {
        /* 保持原样，seedBuiltinTools 会重写 */
      }
      await db.tools.update(oldTool.id!, { name: NEW, jsonContent });
    }
  }

  // B. 已污染的库：多条内置 file_display → 保留 displayOrder 最小的一条，删除其余
  const newTools = await db.tools.where('name').equals(NEW).toArray();
  if (newTools.length > 1) {
    const builtins = newTools.filter((t) => t.isBuiltIn);
    const keep = [...builtins].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0];
    for (const dup of builtins) {
      if (dup.id !== keep.id) await db.tools.delete(dup.id!);
    }
    // 非内置的重复项（用户自定义同名）不删，避免误删用户数据
  }

  // 2. NPC 启用的技能名
  const npcs = await db.npcs.toArray();
  for (const n of npcs) {
    if (Array.isArray(n.enabledToolNames) && n.enabledToolNames.includes(OLD)) {
      await db.npcs.update(n.id!, {
        enabledToolNames: n.enabledToolNames.map((s) => (s === OLD ? NEW : s)),
      });
    }
  }

  // 3. 历史消息中的工具调用名
  const messages = await db.messages.toArray();
  for (const m of messages) {
    if (!m.toolCallsJson || !m.toolCallsJson.includes(`"${OLD}"`)) continue;
    try {
      const calls = JSON.parse(m.toolCallsJson) as Array<{ name?: string }>;
      let changed = false;
      for (const c of calls) {
        if (c && c.name === OLD) {
          c.name = NEW;
          changed = true;
        }
      }
      if (changed) await db.messages.update(m.id!, { toolCallsJson: JSON.stringify(calls) });
    } catch {
      /* 坏 JSON 不处理 */
    }
  }
}