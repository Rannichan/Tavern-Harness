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
import { hasBrowserUiPreferences, saveBrowserUiPreferences } from '../core/browserPreferences';
import { randomId } from '../core/randomId';
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
    // v11：sessions 增加仅 @ 模式设置（无需索引）。
    this.version(11).stores({
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
    // v12：NPC 支持可选 Character Book JSON（非索引字段）。
    this.version(12).stores({
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
    // v13：世界书支持可选 Character Book JSON 知识库（与角色卡字段标准一致，非索引字段）。
    this.version(13).stores({
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

const COLLECTIONS = [
  'settings', 'providers', 'npcs', 'sessions', 'participants', 'messages',
  'contextCompressions', 'tools', 'worldBooks', 'careerStats', 'careerNpcStats', 'achievementUnlocks',
] as const;

type CollectionName = typeof COLLECTIONS[number];
type Row = Record<string, unknown>;

const legacyDb = new TavernDB();
const READ_ONLY_CONTROL_KEY = 'th-persistence-read-only';
const browserSessionStorage = typeof sessionStorage === 'undefined' ? null : sessionStorage;

function isControlReadOnly(): boolean {
  return browserSessionStorage?.getItem(READ_ONLY_CONTROL_KEY) === '1';
}

function markControlReadOnly(): void {
  browserSessionStorage?.setItem(READ_ONLY_CONTROL_KEY, '1');
}

function clearControlReadOnly(): void {
  browserSessionStorage?.removeItem(READ_ONLY_CONTROL_KEY);
}

const clientId = (() => {
  const key = 'th-persistence-client-id';
  const existing = browserSessionStorage?.getItem(key);
  if (existing) return existing;
  const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `non-browser-${randomId()}`;
  browserSessionStorage?.setItem(key, created);
  return created;
})();

let hasWriteLock = false;
let lockHeartbeat: number | null = null;

const PERSISTENCE_REQUEST_TIMEOUT_MS = 8_000;

async function persistenceRequest<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), PERSISTENCE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`/api-v3${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, clientId }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Persistence request ${path} timed out`);
    }
    throw new Error('Unable to reach the persistence service');
  } finally {
    globalThis.clearTimeout(timeout);
  }
  let payload: T & { ok?: boolean; message?: string };
  try {
    payload = await response.json() as T & { ok?: boolean; message?: string };
  } catch {
    throw new Error(`Persistence service returned an invalid response (${response.status})`);
  }
  if (!response.ok || payload.ok === false) {
    if (response.status === 423) {
      hasWriteLock = false;
      markControlReadOnly();
    }
    throw new Error(`Persistence request ${path} failed: ${payload.message || `HTTP ${response.status}`}`);
  }
  return payload;
}

async function requireWriteLock(): Promise<void> {
  const result = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/acquire');
  hasWriteLock = result.lock.writable;
  if (!hasWriteLock) throw new Error('This browser is read-only because another browser is editing Tavern Harness data');
  if (lockHeartbeat == null) {
    lockHeartbeat = window.setInterval(async () => {
      try {
        const state = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/status');
        hasWriteLock = state.lock.writable;
      } catch {
        hasWriteLock = false;
      }
    }, 1_000);
  }
}

type StartupSnapshot = {
  lock: { writable: boolean; held: boolean };
  collections: {
    settings: Array<{ value: AppSettings }>;
    providers: Array<{ value: ApiProvider }>;
    npcs: Array<{ value: NpcCharacter }>;
    sessions: Array<{ value: ChatSession }>;
    worldBooks: Array<{ value: WorldBook }>;
    tools: Array<{ value: McpTool }>;
  };
};

/** 一次请求取得首屏所需的轻量数据，避免逐表读取产生的串行 HTTP 往返。 */
export async function loadStartupSnapshot(): Promise<StartupSnapshot> {
  let snapshot: StartupSnapshot;
  try {
    snapshot = await persistenceRequest<StartupSnapshot>('/startup/snapshot');
  } catch (error) {
    // 热更新期间旧服务进程可能还未注册快照路由。临时降级到旧的逐表读取，
    // 让页面可用；Vite 会在 persistence-server.mjs 变更后重启该进程。
    if (!(error instanceof Error) || !error.message.includes('Unknown persistence endpoint: /startup/snapshot')) throw error;
    await initDatabase();
    const readOnly = await isWriteLocked();
    const [settings, providers, npcs, sessions, worldBooks, tools] = await Promise.all([
      db.settings.toArray(),
      db.providers.toArray(),
      db.npcs.toArray(),
      db.sessions.toArray(),
      db.worldBooks.toArray(),
      db.tools.toArray(),
    ]);
    return {
      lock: { writable: !readOnly, held: readOnly || hasWriteLock },
      collections: {
        settings: settings.map((value) => ({ value })),
        providers: providers.map((value) => ({ value })),
        npcs: npcs.map((value) => ({ value })),
        sessions: sessions.map((value) => ({ value })),
        worldBooks: worldBooks.map((value) => ({ value })),
        tools: tools.map((value) => ({ value })),
      },
    };
  }
  hasWriteLock = snapshot.lock.writable;
  if (snapshot.lock.writable && lockHeartbeat == null) {
    lockHeartbeat = window.setInterval(async () => {
      try {
        const state = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/status');
        hasWriteLock = state.lock.writable;
      } catch {
        hasWriteLock = false;
      }
    }, 1_000);
  }
  if (snapshot.lock.held && !snapshot.lock.writable) markControlReadOnly();
  return snapshot;
}

export async function isWriteLocked(): Promise<boolean> {
  if (isControlReadOnly()) return true;
  const result = await persistenceRequest<{ lock: { writable: boolean; held: boolean } }>('/lock/status');
  hasWriteLock = result.lock.writable;
  const readOnly = result.lock.held && !result.lock.writable;
  if (readOnly) markControlReadOnly();
  return readOnly;
}

export async function takeOverWriteLock(): Promise<void> {
  const result = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/takeover');
  hasWriteLock = result.lock.writable;
  if (!hasWriteLock) throw new Error('Unable to take control of Tavern Harness');
  const verified = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/status');
  hasWriteLock = verified.lock.writable;
  if (!hasWriteLock) throw new Error('Control transfer could not be verified');
  clearControlReadOnly();
  if (lockHeartbeat == null) {
    lockHeartbeat = window.setInterval(async () => {
      try {
        const state = await persistenceRequest<{ lock: { writable: boolean } }>('/lock/status');
        hasWriteLock = state.lock.writable;
      } catch {
        hasWriteLock = false;
      }
    }, 1_000);
  }
}

function primaryKey(collection: CollectionName, value: Row): string {
  if (collection === 'participants') return `${value.sessionId}:${value.participantId}`;
  if (collection === 'settings' || collection === 'careerStats') return '1';
  if (collection === 'careerNpcStats') return String(value.npcId);
  if (value.id == null) throw new Error(`Missing id for ${collection}`);
  return String(value.id);
}

class RemoteQuery<T extends object> {
  constructor(private readonly table: RemoteTable<T>, private readonly predicate: (value: T) => boolean = () => true) {}
  equals(value: unknown): RemoteQuery<T> {
    const fields = this.table.queryField === '[sessionId+participantId]'
      ? ['sessionId', 'participantId']
      : [this.table.queryField];
    return new RemoteQuery(this.table, (row) => {
      const actual = fields.length === 1 ? (row as Row)[fields[0]] : fields.map((field) => (row as Row)[field]);
      return this.predicate(row) && JSON.stringify(actual) === JSON.stringify(value);
    });
  }
  filter(predicate: (value: T) => boolean): RemoteQuery<T> { return new RemoteQuery(this.table, (row) => this.predicate(row) && predicate(row)); }
  async toArray(): Promise<T[]> { return (await this.table.toArray()).filter(this.predicate); }
  async first(): Promise<T | undefined> { return (await this.toArray())[0]; }
  async count(): Promise<number> { return (await this.toArray()).length; }
  async sortBy(field: string): Promise<T[]> { return (await this.toArray()).sort((a, b) => Number((a as Row)[field]) - Number((b as Row)[field])); }
  async delete(): Promise<void> { for (const value of await this.toArray()) await this.table.delete(this.table.keyFor(value)); }
}

class RemoteOrderedQuery<T extends object> {
  private start = 0;
  private end: number | undefined;
  constructor(private readonly table: RemoteTable<T>, private readonly field: string) {}
  offset(value: number): this { this.start = value; return this; }
  limit(value: number): this { this.end = this.start + value; return this; }
  async toArray(): Promise<T[]> {
    return (await this.table.toArray())
      .sort((a, b) => Number((a as Row)[this.field]) - Number((b as Row)[this.field]))
      .slice(this.start, this.end);
  }
}

class RemoteTable<T extends object> {
  queryField = '';
  constructor(private readonly collection: CollectionName) {}
  keyFor(value: T): string { return primaryKey(this.collection, value as Row); }
  async toArray(): Promise<T[]> {
    const result = await persistenceRequest<{ records: Array<{ value: T }> }>('/records/list', { collection: this.collection });
    return result.records.map((record) => record.value);
  }
  async get(key: unknown): Promise<T | undefined> {
    const result = await persistenceRequest<{ record: { value: T } | null }>('/records/get', { collection: this.collection, key: Array.isArray(key) ? key.join(':') : String(key) });
    return result.record?.value;
  }
  async count(): Promise<number> { return (await this.toArray()).length; }
  async add(value: T): Promise<number> {
    await requireWriteLock();
    const record = { ...value } as T & { id?: number };
    if (['providers', 'npcs', 'sessions', 'messages', 'contextCompressions', 'tools', 'worldBooks', 'achievementUnlocks'].includes(this.collection) && record.id == null) {
      const result = await persistenceRequest<{ id: number }>('/records/allocate-id', { collection: this.collection });
      record.id = result.id;
    }
    await persistenceRequest('/records/put', { collection: this.collection, key: this.keyFor(record), value: record });
    return Number(record.id ?? 0);
  }
  async bulkAdd(values: T[]): Promise<void> { for (const value of values) await this.add(value); }
  async bulkPut(values: T[]): Promise<void> { for (const value of values) await this.put(value); }
  async put(value: T): Promise<number> { return this.add(value); }
  async update(key: unknown, changes: Partial<T>): Promise<number> {
    await requireWriteLock();
    const existing = await this.get(key);
    if (!existing) return 0;
    const value = { ...existing, ...changes } as T;
    await persistenceRequest('/records/put', { collection: this.collection, key: this.keyFor(value), value });
    return 1;
  }
  async delete(key: unknown): Promise<void> {
    await requireWriteLock();
    await persistenceRequest('/records/delete', { collection: this.collection, key: Array.isArray(key) ? key.join(':') : String(key) });
  }
  async bulkDelete(keys: unknown[]): Promise<void> { for (const key of keys) await this.delete(key); }
  async clear(): Promise<void> {
    await requireWriteLock();
    await persistenceRequest('/records/clear', { collection: this.collection });
  }
  where(field: string): RemoteQuery<T> { this.queryField = field; return new RemoteQuery(this); }
  filter(predicate: (value: T) => boolean): RemoteQuery<T> { return new RemoteQuery(this, predicate); }
  orderBy(field: string): RemoteOrderedQuery<T> { return new RemoteOrderedQuery(this, field); }
}

class RemoteTavernDB {
  settings = new RemoteTable<AppSettings>('settings');
  providers = new RemoteTable<ApiProvider>('providers');
  npcs = new RemoteTable<NpcCharacter>('npcs');
  sessions = new RemoteTable<ChatSession>('sessions');
  participants = new RemoteTable<ChatParticipant>('participants');
  messages = new RemoteTable<ChatMessage>('messages');
  contextCompressions = new RemoteTable<ContextCompression>('contextCompressions');
  tools = new RemoteTable<McpTool>('tools');
  worldBooks = new RemoteTable<WorldBook>('worldBooks');
  careerStats = new RemoteTable<CareerStatsTotal>('careerStats');
  careerNpcStats = new RemoteTable<CareerNpcStat>('careerNpcStats');
  achievementUnlocks = new RemoteTable<AchievementUnlock>('achievementUnlocks');
  async transaction<T>(
    _mode: string,
    _tableA: unknown,
    callback: () => Promise<T>,
  ): Promise<T>;
  async transaction<T>(
    _mode: string,
    _tableA: unknown,
    _tableB: unknown,
    callback: () => Promise<T>,
  ): Promise<T>;
  async transaction<T>(...args: unknown[]): Promise<T> {
    return (args.at(-1) as () => Promise<T>)();
  }
  async delete(): Promise<void> {
    for (const table of [this.settings, this.providers, this.npcs, this.sessions, this.participants, this.messages, this.contextCompressions, this.tools, this.worldBooks, this.careerStats, this.careerNpcStats, this.achievementUnlocks]) await table.clear();
  }
  close(): void {
    if (lockHeartbeat != null && typeof window !== 'undefined') {
      window.clearInterval(lockHeartbeat);
      lockHeartbeat = null;
    }
  }
  async normalizePinned(): Promise<void> {
    for (const session of await this.sessions.toArray()) if (session.pinned !== 0 && session.pinned !== 1) await this.sessions.update(session.id!, { pinned: session.pinned ? 1 : 0 });
  }
}

export const db = new RemoteTavernDB();

async function importLegacyCollection<T extends object>(collection: CollectionName, rows: T[]): Promise<void> {
  const remote = db[collection] as unknown as RemoteTable<T>;
  if (await remote.count()) return;
  for (const row of rows) await remote.put(row);
}

async function importLegacyBrowserData(): Promise<void> {
  if (localStorage.getItem('th-server-persistence-imported') === '1') return;
  const serverIsEmpty = (await Promise.all(COLLECTIONS.map((collection) => (db[collection] as unknown as RemoteTable<object>).count())))
    .every((count) => count === 0);
  if (!serverIsEmpty) {
    localStorage.setItem('th-server-persistence-imported', '1');
    return;
  }
  const legacySettings = await legacyDb.settings.toArray();
  if (!hasBrowserUiPreferences() && legacySettings[0]) {
    saveBrowserUiPreferences({ language: legacySettings[0].language, themeMode: legacySettings[0].themeMode });
  }
  await importLegacyCollection('settings', legacySettings.map(({ language: _language, themeMode: _themeMode, ...settings }) => ({ ...settings, language: null, themeMode: 'system' })));
  await importLegacyCollection('providers', await legacyDb.providers.toArray());
  await importLegacyCollection('npcs', await legacyDb.npcs.toArray());
  await importLegacyCollection('sessions', await legacyDb.sessions.toArray());
  await importLegacyCollection('participants', await legacyDb.participants.toArray());
  await importLegacyCollection('messages', await legacyDb.messages.toArray());
  await importLegacyCollection('contextCompressions', await legacyDb.contextCompressions.toArray());
  await importLegacyCollection('tools', await legacyDb.tools.toArray());
  await importLegacyCollection('worldBooks', await legacyDb.worldBooks.toArray());
  await importLegacyCollection('careerStats', await legacyDb.careerStats.toArray());
  await importLegacyCollection('careerNpcStats', await legacyDb.careerNpcStats.toArray());
  await importLegacyCollection('achievementUnlocks', await legacyDb.achievementUnlocks.toArray());
  localStorage.setItem('th-server-persistence-imported', '1');
}

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

/** 「生成参数」卡片的默认值；设置页重置按钮与首次初始化共用这一份来源。 */
export const DEFAULT_GENERATION_SETTINGS = {
  temperature: 1.0,
  topP: 0.95,
  maxTokens: 0,
  topK: 20,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1,
  reasoningEffort: 'auto',
  contextCompressionThreshold: 'off',
} satisfies Partial<AppSettings>;

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  baseUrl: 'https://api.openai.com/v1/',
  apiKey: '',
  defaultModel: '',
  defaultProviderId: null,
  themeMode: 'system',
  language: null,
  ...DEFAULT_GENERATION_SETTINGS,
  seed: -1,
  stop: '',
  isStreaming: true,
  isThinkingModeEnabled: true,
  isToolCallsEnabled: true,
  yoloMode: false,
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
  let writable = true;
  try {
    await requireWriteLock();
  } catch {
    // A second browser is intentionally read-only. It can still load the
    // existing shared data; all mutating actions remain rejected server-side.
    writable = false;
  }
  if (!writable) return;
  await importLegacyBrowserData();
  const count = await db.settings.count();
  if (count === 0) {
    await db.settings.add(DEFAULT_SETTINGS);
  } else {
    const settings = await db.settings.get(1);
    if (settings && settings.contextCompressionThreshold === undefined) {
      await db.settings.update(1, { contextCompressionThreshold: 'off' });
    }
    if (settings && settings.yoloMode === undefined) {
      await db.settings.update(1, { yoloMode: false });
    }
    if (settings && (settings.language !== null || settings.themeMode !== 'system')) {
      await db.settings.update(1, { language: null, themeMode: 'system' });
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
const RETIRED_BUILTIN_TOOL_NAMES = ['web_search', 'manage_timer', 'get_character_book_context', 'recall_memory'];

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
