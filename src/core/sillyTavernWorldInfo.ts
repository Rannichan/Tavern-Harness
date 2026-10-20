// ============================================================
// SillyTavern 世界书（World Info / Lorebook）JSON 导入
// ============================================================
// 支持两种 entries 结构：
// - 对象映射：{ "0": {...}, "1": {...} }（SillyTavern 导出格式）
// - 数组：[{...}, {...}]（Character Book 格式）
// 输出统一为角色卡 Character Book JSON，字段标准与角色卡知识库完全一致。

export interface ParsedSillyTavernWorldBook {
  /** 世界书名（优先取 JSON 的 name，否则回退到文件名） */
  name: string;
  /** 世界书固定内容（SillyTavern 的 description，可为空） */
  content: string;
  /** 归一化后的 Character Book JSON */
  characterBook: string;
  entryCount: number;
  /** 启用且内容非空的条目数（会参与关键词召回） */
  enabledEntryCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = numberValue(value);
    if (number != null) return number;
  }
  return undefined;
}

/** 把单条 SillyTavern 世界书条目归一化为 Character Book 条目字段。 */
function normalizeEntry(value: unknown, index: number): Record<string, unknown> | null {
  const entry = asRecord(value);
  if (!entry) return null;

  const keys = stringArray(entry.keys ?? entry.key);
  const secondaryKeys = stringArray(entry.secondary_keys ?? entry.keysecondary);
  const comment = stringValue(entry.comment).trim();
  const name = stringValue(entry.name).trim() || comment;
  const content = stringValue(entry.content);
  // SillyTavern 用 disable 表示停用，新版导出同时带 enabled；两者都存在时以 enabled 为准。
  const enabled = entry.enabled !== undefined
    ? entry.enabled !== false
    : entry.disable !== true;

  const normalized: Record<string, unknown> = {
    id: entry.id ?? entry.uid ?? index,
    keys,
    secondary_keys: secondaryKeys,
    content,
    enabled,
    constant: booleanValue(entry.constant, false),
    selective: booleanValue(entry.selective, false),
    selective_logic: firstNumber(entry.selective_logic, entry.selectiveLogic) ?? 0,
    insertion_order: firstNumber(entry.insertion_order, entry.order, entry.priority) ?? index,
  };
  if (name) normalized.name = name;
  if (comment) normalized.comment = comment;
  if (entry.priority !== undefined) {
    const priority = numberValue(entry.priority);
    if (priority != null) normalized.priority = priority;
  }
  if (entry.case_sensitive !== undefined) normalized.case_sensitive = booleanValue(entry.case_sensitive, false);
  if (entry.match_whole_words !== undefined) normalized.match_whole_words = booleanValue(entry.match_whole_words, false);
  if (entry.useProbability !== undefined) normalized.useProbability = booleanValue(entry.useProbability, false);
  if (entry.probability !== undefined) {
    const probability = numberValue(entry.probability);
    if (probability != null) normalized.probability = probability;
  }
  if (entry.position !== undefined) normalized.position = entry.position;
  if (entry.depth !== undefined) {
    const depth = numberValue(entry.depth);
    if (depth != null) normalized.depth = depth;
  }
  if (entry.excludeRecursion !== undefined) normalized.excludeRecursion = booleanValue(entry.excludeRecursion, false);
  if (entry.extensions !== undefined) normalized.extensions = entry.extensions;
  if (entry.characterFilter !== undefined) normalized.characterFilter = entry.characterFilter;
  return normalized;
}

/**
 * 解析 SillyTavern 世界书 JSON 文本。
 * 失败时抛出带可读原因的 Error；成功时返回可直接写入世界书知识库的 Character Book JSON。
 */
export function parseSillyTavernWorldInfoJson(raw: string, fallbackName = 'Imported world book'): ParsedSillyTavernWorldBook {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON');
  }
  const root = asRecord(json);
  if (!root) throw new Error('World info JSON must be an object');

  const entriesValue = root.entries;
  const rawEntries = Array.isArray(entriesValue)
    ? entriesValue
    : (() => {
        const record = asRecord(entriesValue);
        return record ? Object.values(record) : [];
      })();
  if (rawEntries.length === 0) throw new Error('World info JSON has no entries');

  const entries = rawEntries
    .map((entry, index) => normalizeEntry(entry, index))
    .filter((entry): entry is Record<string, unknown> => entry != null);
  if (entries.length === 0) throw new Error('World info JSON has no valid entries');
  if (!entries.some((entry) => typeof entry.content === 'string' && entry.content.trim())) {
    throw new Error('World info JSON has no entry content');
  }

  const name = stringValue(root.name).trim() || fallbackName.trim() || 'Imported world book';
  const description = stringValue(root.description);
  const book: Record<string, unknown> = { name, entries };
  if (description) book.description = description;
  const scanDepth = numberValue(root.scan_depth);
  if (scanDepth != null) book.scan_depth = scanDepth;
  const tokenBudget = numberValue(root.token_budget);
  if (tokenBudget != null) book.token_budget = tokenBudget;
  if (root.recursive_scanning !== undefined) book.recursive_scanning = booleanValue(root.recursive_scanning, false);
  if (root.extensions !== undefined) book.extensions = root.extensions;

  return {
    name,
    content: description.trim(),
    characterBook: JSON.stringify(book, null, 2),
    entryCount: entries.length,
    enabledEntryCount: entries.filter((entry) => entry.enabled !== false && typeof entry.content === 'string' && entry.content.trim()).length,
  };
}

/** 读取并解析 SillyTavern 世界书 JSON 文件（不落库，由 UI 预填后确认保存）。 */
export async function parseSillyTavernWorldInfoFile(file: File, fallbackName?: string): Promise<ParsedSillyTavernWorldBook> {
  const raw = await file.text();
  const fileFallback = file.name.replace(/\.json$/i, '').trim();
  return parseSillyTavernWorldInfoJson(raw, fileFallback || fallbackName);
}
