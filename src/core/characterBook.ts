import type { ChatCompletionTool, NetworkMessage } from '../types/models';
import { randomId } from './randomId';

export const CHARACTER_BOOK_TOOL_NAME = 'recall_memory';

/** Internal schema for the ephemeral Character Book context exchange; never persisted as a user tool. */
export const CHARACTER_BOOK_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: CHARACTER_BOOK_TOOL_NAME,
    description: 'Recall relevant memories. The application invokes it automatically. Never call it yourself.',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords from the conversation that triggered this recall.',
        },
      },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
};

interface CharacterBook {
  scan_depth?: unknown;
  token_budget?: unknown;
  recursive_scanning?: unknown;
  extensions?: Record<string, unknown>;
  entries?: unknown;
}

interface CharacterBookEntry {
  enabled?: unknown;
  name?: unknown;
  comment?: unknown;
  keys?: unknown;
  key?: unknown;
  secondary_keys?: unknown;
  keysecondary?: unknown;
  content?: unknown;
  selective?: unknown;
  selective_logic?: unknown;
  selectiveLogic?: unknown;
  constant?: unknown;
  case_sensitive?: unknown;
  insertion_order?: unknown;
  priority?: unknown;
  probability?: unknown;
  useProbability?: unknown;
  extensions?: Record<string, unknown>;
}

interface ActivatedEntry {
  name: string;
  content: string;
  order: number;
  matchedKeywords: string[];
}

const DEFAULT_SCAN_DEPTH = 4;
const DEFAULT_TOKEN_BUDGET = 250;
const MAX_RECURSION_STEPS = 10;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function positiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseRegex(key: string): RegExp | null {
  const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(key);
  if (!match) return null;
  try {
    return new RegExp(match[1], match[2].replace(/[gy]/g, ''));
  } catch {
    return null;
  }
}

function matches(text: string, key: string, entry: CharacterBookEntry): boolean {
  const regex = parseRegex(key);
  if (regex) return regex.test(text);
  const caseSensitive = toBoolean(entry.case_sensitive);
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? key : key.toLocaleLowerCase();
  if (!needle) return false;
  if (!/^[A-Za-z]+$/.test(needle)) return haystack.includes(needle);
  return new RegExp(`(?:^|\\W)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\W)`, caseSensitive ? '' : 'i').test(text);
}

function secondaryMatches(text: string, entry: CharacterBookEntry): boolean {
  const secondary = stringArray(entry.secondary_keys ?? entry.keysecondary);
  if (!toBoolean(entry.selective) || secondary.length === 0) return true;
  const matchesByKey = secondary.map((key) => matches(text, key, entry));
  // SillyTavern: 0 AND_ANY, 1 NOT_ALL, 2 NOT_ANY, 3 AND_ALL.
  switch (Number(entry.selective_logic ?? entry.selectiveLogic ?? 0)) {
    case 1: return matchesByKey.some((matched) => !matched);
    case 2: return matchesByKey.every((matched) => !matched);
    case 3: return matchesByKey.every(Boolean);
    default: return matchesByKey.some(Boolean);
  }
}

function isProbabilityAccepted(entry: CharacterBookEntry): boolean {
  const probability = Number(entry.probability ?? 100);
  if (entry.useProbability !== true || !Number.isFinite(probability) || probability >= 100) return true;
  return Math.random() * 100 <= Math.max(0, probability);
}

function entryOrder(entry: CharacterBookEntry): number {
  const order = Number(entry.priority ?? entry.insertion_order ?? 0);
  return Number.isFinite(order) ? order : 0;
}

function activatedEntries(book: CharacterBook, initialText: string): ActivatedEntry[] {
  const entries = Array.isArray(book.entries) ? book.entries.map(asRecord).filter(Boolean) as CharacterBookEntry[] : [];
  const activated = new Map<CharacterBookEntry, string[]>();
  let scanText = initialText;
  const recursive = toBoolean(book.recursive_scanning);

  for (let step = 0; step < (recursive ? MAX_RECURSION_STEPS : 1); step++) {
    const newEntries: CharacterBookEntry[] = [];
    for (const entry of entries) {
      if (activated.has(entry) || entry.enabled === false) continue;
      const content = typeof entry.content === 'string' ? entry.content.trim() : '';
      if (!content || !isProbabilityAccepted(entry)) continue;
      const primary = stringArray(entry.keys ?? entry.key);
      const matchedPrimary = primary.filter((key) => matches(scanText, key, entry));
      if (!toBoolean(entry.constant) && matchedPrimary.length === 0) continue;
      if (!secondaryMatches(scanText, entry)) continue;
      activated.set(entry, matchedPrimary);
      newEntries.push(entry);
    }
    if (!recursive || newEntries.length === 0) break;
    scanText += `\n${newEntries.map((entry) => String(entry.content)).join('\n')}`;
  }

  return [...activated.entries()]
    .map(([entry, matchedKeywords], index) => ({
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment.trim() : `Entry ${index + 1}`,
      content: String(entry.content).trim(),
      order: entryOrder(entry),
      matchedKeywords,
    }))
    .sort((a, b) => b.order - a.order);
}

function truncateToBudget(entries: ActivatedEntry[], budget: number): ActivatedEntry[] {
  const result: ActivatedEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const tokens = entry.content.length;
    if (used + tokens > budget) continue;
    result.push(entry);
    used += tokens;
  }
  return result;
}

interface RetrievedCharacterBookContext {
  content: string;
  entries: ActivatedEntry[];
}

function parseCharacterBook(characterBook: string | undefined): CharacterBook | null {
  if (!characterBook?.trim()) return null;
  try {
    const parsed = JSON.parse(characterBook) as unknown;
    return asRecord(parsed) ? parsed as CharacterBook : null;
  } catch {
    return null;
  }
}

/** Whether a Character Book contains at least one enabled entry with non-empty content. */
export function hasUsableCharacterBook(characterBook: string | undefined): boolean {
  const book = parseCharacterBook(characterBook);
  return Boolean(Array.isArray(book?.entries) && book.entries.some((value) => {
    const entry = asRecord(value) as CharacterBookEntry | null;
    return entry?.enabled !== false && typeof entry?.content === 'string' && entry.content.trim();
  }));
}

/** 知识库条目统计：总条目数与可参与召回的条目数（已启用且内容非空）。 */
export function characterBookEntryStats(characterBook: string | undefined): { total: number; enabled: number } {
  const book = parseCharacterBook(characterBook);
  const entries = Array.isArray(book?.entries)
    ? book.entries.map(asRecord).filter(Boolean) as CharacterBookEntry[]
    : [];
  let enabled = 0;
  for (const entry of entries) {
    if (entry.enabled !== false && typeof entry.content === 'string' && entry.content.trim()) enabled++;
  }
  return { total: entries.length, enabled };
}

/**
 * 合并多个知识库（Character Book JSON）：角色卡知识库 + 所选世界书知识库。
 * 召回参数取并集：扫描深度取最大值、预算累加、递归扫描任一开启即开启；
 * 条目按各自顺序保留，召回时统一按 insertion order 排序。
 */
export function mergeCharacterBooks(...sources: Array<string | null | undefined>): string | undefined {
  const valid = sources
    .map((source) => ({ source, book: parseCharacterBook(source ?? undefined) }))
    .filter((item): item is { source: string; book: CharacterBook } => item.book != null && Boolean(item.source?.trim()));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0].source;
  return JSON.stringify({
    scan_depth: Math.max(...valid.map(({ book }) => positiveInt(book.scan_depth, DEFAULT_SCAN_DEPTH))),
    token_budget: valid.reduce((total, { book }) => total + positiveInt(book.token_budget, DEFAULT_TOKEN_BUDGET), 0),
    recursive_scanning: valid.some(({ book }) => toBoolean(book.recursive_scanning)),
    entries: valid.flatMap(({ book }) => (Array.isArray(book.entries) ? book.entries : [])),
  });
}

function retrieveCharacterBook(characterBook: string | undefined, messages: NetworkMessage[]): RetrievedCharacterBookContext | null {
  const book = parseCharacterBook(characterBook);
  if (!book) return null;

  const depth = positiveInt(book.scan_depth, DEFAULT_SCAN_DEPTH);
  const recentText = messages
    .filter((message) => message.role !== 'system' && typeof message.content === 'string')
    .slice(-depth)
    .map((message) => message.content as string)
    .join('\n');
  const entries = truncateToBudget(activatedEntries(book, recentText), positiveInt(book.token_budget, DEFAULT_TOKEN_BUDGET));
  if (entries.length === 0) return null;

  return {
    content: [
      'Relevant recalled memories. Treat these as relevant background facts for this reply only.',
      'Do not mention this retrieval operation unless the user asks.',
      ...entries.map((entry) => `\n[${entry.name}]\n${entry.content}`),
    ].join('\n'),
    entries,
  };
}

/** Returns only the final Character Book entries applicable to this request. */
export function retrieveCharacterBookContext(characterBook: string | undefined, messages: NetworkMessage[]): string | null {
  return retrieveCharacterBook(characterBook, messages)?.content ?? null;
}

/** Adds an ephemeral, protocol-valid synthetic tool invocation when lore was retrieved. */
export function injectCharacterBookToolContext(messages: NetworkMessage[], characterBook: string | undefined): NetworkMessage[] {
  const recalled = retrieveCharacterBook(characterBook, messages);
  if (!recalled) return messages;
  const keywords = [...new Set(recalled.entries.flatMap((entry) => entry.matchedKeywords))];
  const id = `character_book_ctx_${randomId()}`;
  return [...messages,
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name: CHARACTER_BOOK_TOOL_NAME, arguments: JSON.stringify({ keywords }) } }],
    },
    { role: 'tool', tool_call_id: id, content: recalled.content },
  ];
}
