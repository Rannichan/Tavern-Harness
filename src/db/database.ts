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
  McpTool,
  NpcCharacter,
  ScheduledTask,
  WorldBook,
} from '../types/models';
import { BUILTIN_TOOLS, ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';

export class TavernDB extends Dexie {
  settings!: Table<AppSettings, number>;
  providers!: Table<ApiProvider, number>;
  npcs!: Table<NpcCharacter, number>;
  sessions!: Table<ChatSession, number>;
  participants!: Table<ChatParticipant, number>;
  messages!: Table<ChatMessage, number>;
  tools!: Table<McpTool, number>;
  worldBooks!: Table<WorldBook, number>;
  tasks!: Table<ScheduledTask, string>;
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
      tasks: 'id, sessionId, status, triggerAtMillis',
      careerStats: 'id',
      careerNpcStats: 'npcId',
      workspaceFiles: 'path, updatedAt',
      achievementUnlocks: '++id, achievementId, unlockedAt',
    });
  }
}

export const db = new TavernDB();

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  baseUrl: 'https://api.openai.com/v1/',
  apiKey: '',
  defaultModel: '',
  defaultProviderId: null,
  themeMode: 'system',
  themeColor: 'violet',
  temperature: 1.0,
  topP: 0.95,
  maxTokens: 0,
  topK: 20,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1,
  reasoningEffort: 'auto',
  seed: -1,
  stop: '',
  isStreaming: true,
  isThinkingModeEnabled: true,
  isToolCallsEnabled: true,
  statsResetTime: null,
};

export const DEFAULT_STATS: CareerStatsTotal = {
  id: 1,
  inputTokens: 0,
  outputTokens: 0,
  totalRounds: 0,
};

/** 内置酒馆老板：默认启用所有内置技能 */
export const DEFAULT_NPC: NpcCharacter = {
  name: '酒馆老板',
  prompt: '神秘的酒馆老板，可以响应客人的任何需求',
  greeting: '你来啦！快坐下~',
  avatarColorOrdinal: 3,
  avatarDataUrl: null,
  enabledToolNames: [...ALL_BUILTIN_TOOL_NAMES],
  isBuiltIn: true,
  createdAt: Date.now(),
};

/** 数据库初始化：种子数据 + 迁移兼容 */
export async function initDatabase(): Promise<void> {
  const count = await db.settings.count();
  if (count === 0) {
    await db.settings.add(DEFAULT_SETTINGS);
  }
  const statsCount = await db.careerStats.count();
  if (statsCount === 0) {
    await db.careerStats.add(DEFAULT_STATS);
  }
  const npcCount = await db.npcs.count();
  if (npcCount === 0) {
    await db.npcs.add(DEFAULT_NPC);
  }
  // 确保默认 NPC 是内置且受保护的
  const boss = await db.npcs.filter((n) => n.isBuiltIn).first();
  if (boss && !boss.isBuiltIn) {
    await db.npcs.update(boss.id!, { isBuiltIn: true });
  }
  // 预载内置技能表
  await seedBuiltinTools();
  // 旧数据兼容：enabledToolNames 可能是 CSV 字符串
  await migrateLegacyFields();
  // 内置角色「酒馆老板」默认启用所有内置技能（老数据升级）
  await ensureBossDefaultSkills();
}

/** 内置技能（只读保护）第一次使用时写库 */
export async function seedBuiltinTools(): Promise<void> {
  const now = Date.now();
  for (const tool of BUILTIN_TOOLS) {
    const exists = await db.tools.where('name').equals(tool.function.name).first();
    if (exists) continue;
    await db.tools.add({
      name: tool.function.name,
      jsonContent: JSON.stringify(tool),
      executionJson: null,
      isBuiltIn: true,
      createdAt: now,
      displayOrder: await db.tools.count(),
    });
  }
}

/** 内置角色「酒馆老板」默认启用全部内置技能（老数据只启用了 web_search / roll_dice） */
async function ensureBossDefaultSkills(): Promise<void> {
  const boss = await db.npcs.filter((n) => n.isBuiltIn).first();
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