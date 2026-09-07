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
  AppLanguage,
} from '../types/models';
import { BUILTIN_TOOLS, ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';
import { currentLanguage, translate } from '../core/i18n';

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
  language: null,
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

/** 内置酒馆老板：默认启用所有内置技能（名称/人设/开场白随界面语言本地化） */
export const DEFAULT_NPC: NpcCharacter = {
  name: translate('builtinNpc.name'),
  prompt: translate('builtinNpc.prompt'),
  greeting: translate('builtinNpc.greeting'),
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

/**
 * 内置角色「酒馆老板」文本本地化：按当前界面语言写入本地化名称/人设/开场白。
 * 调用时机：store 应用语言设置（setLanguage）之后，启动时与切换语言时都会执行。
 * 只把仍是内置原始文案（中文/繁体/英文种子之一）的字段替换为当前语言——
 * 用户手动编辑过的内容不会被覆盖。
 */
export async function localizeBuiltinNpc(): Promise<void> {
  const boss = await db.npcs.filter((n) => n.isBuiltIn).first();
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

/** 内置角色本地化标记：记录上次写入内置角色文本时使用的语言 */
const LOCALIZE_LANG_KEY = 'th-builtin-npc-lang';

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