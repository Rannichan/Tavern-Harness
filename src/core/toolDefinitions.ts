import type { ChatCompletionTool } from '../types/models';

export const MAX_TOOL_CALL_DEPTH = 4;
export const NEW_TOPIC_MARKER = '开始新话题';

export const BUILTIN_TOOL_NAMES = [
  'web_search',
  'roll_dice',
  'create_skill',
  'update_skill',
  'delete_skill',
  'manage_timer',
  'get_tavern_status',
  'create_character',
  'update_character',
  'delete_character',
  'create_world_book',
  'update_world_book',
  'delete_world_book',
] as const;

const fn = (name: string, description: string, parameters: Record<string, unknown>): ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters },
});

export const BUILTIN_TOOLS: ChatCompletionTool[] = [
  fn(
    'web_search',
    'Search the web using Bing (no API key required, works well in China). Returns ranked results with title, snippet and URL. Use it when you need up-to-date or factual information.',
    {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
        max_results: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Max results 1-10' },
      },
      required: ['q'],
      additionalProperties: false,
    }
  ),
  fn(
    'roll_dice',
    'Roll dice for tabletop RPG. Supports expressions like d20, 2d6, 3d10+2. Natural 20 / natural 1 on a single d20 are reported as critical success/failure.',
    {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: "Dice expression, e.g. 'd20', '2d6', '3d10+2'",
        },
      },
      required: ['expression'],
      additionalProperties: false,
    }
  ),
  fn(
    'create_skill',
    'Create a new generated skill (tool) usable by characters. The skill is defined by a declarative execution schema. New skill is NOT enabled for any character until you enable it via update_character.',
    {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          pattern: '^[a-z][a-z0-9_]*$',
          minLength: 3,
          maxLength: 40,
          description: 'Lowercase snake_case skill name, 3-40 chars',
        },
        description: { type: 'string', maxLength: 500 },
        parameters: {
          type: 'object',
          description: 'JSON Schema parameter object (must be type: object with properties)',
        },
        execution: {
          type: 'object',
          description: getExecutionDescription(),
          additionalProperties: false,
          required: ['type'],
          properties: executionProperties(),
        },
      },
      required: ['name', 'description', 'parameters', 'execution'],
      additionalProperties: false,
    }
  ),
  fn(
    'update_skill',
    'Update an existing generated skill (name, description, parameters or execution). Requires user confirmation. Built-in skills are protected.',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Existing skill name' },
        new_name: { type: 'string', pattern: '^[a-z][a-z0-9_]*$', minLength: 3, maxLength: 40 },
        description: { type: 'string', maxLength: 500 },
        parameters: { type: 'object' },
        execution: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: executionProperties(),
        },
      },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'delete_skill',
    'Delete a generated skill. Requires user confirmation. Built-in skills cannot be deleted.',
    {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'manage_timer',
    'Create, list or cancel scheduled messages (timers) that will be delivered back to this conversation when the time comes. NPC sessions only; max 5 pending timers per session; delay 1 minute to 30 days. At fire time the pre-written content is delivered as a message — no model call happens.',
    {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'list', 'cancel'] },
        label: { type: 'string', maxLength: 80, description: 'Timer label' },
        delay_seconds: { type: 'integer', minimum: 60, maximum: 2592000, description: 'Delay from now in seconds (mutually exclusive with trigger_at)' },
        trigger_at: { type: 'string', description: 'ISO 8601 timestamp with explicit offset, e.g. 2026-08-18T22:00:00+08:00' },
        content: { type: 'string', maxLength: 500, description: 'Pre-written message content delivered at fire time' },
        show_notification: { type: 'boolean', default: true },
        timer_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'completed', 'cancelled', 'failed', 'all'], description: 'Filter for list' },
      },
      required: ['operation'],
      additionalProperties: false,
    }
  ),
  fn(
    'get_tavern_status',
    'Read-only snapshot of the tavern: characters, world books, skills and career statistics. Never modifies anything.',
    {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string', enum: ['characters', 'world_books', 'skills', 'career_stats'] },
          minItems: 1,
          uniqueItems: true,
          description: 'Fields to include',
        },
      },
      required: ['fields'],
      additionalProperties: false,
    }
  ),
  fn(
    'create_character',
    'Create a new character (NPC) in the tavern. The character becomes available for NPC or group sessions.',
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 40 },
        greeting: { type: 'string', minLength: 1, maxLength: 1000, description: 'First message the character says' },
        prompt: { type: 'string', minLength: 1, maxLength: 4000, description: 'Persona / system prompt' },
      },
      required: ['name', 'greeting', 'prompt'],
      additionalProperties: false,
    }
  ),
  fn(
    'update_character',
    'Update an existing character. Requires user confirmation. Built-in characters are protected (cannot delete, but can be updated with care).',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Existing character name' },
        new_name: { type: 'string', maxLength: 40 },
        greeting: { type: 'string', maxLength: 1000 },
        prompt: { type: 'string', maxLength: 4000 },
        enable_skills: { type: 'array', items: { type: 'string' }, description: 'Skill names to enable (must exist)' },
        disable_skills: { type: 'array', items: { type: 'string' }, description: 'Skill names to disable' },
      },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'delete_character',
    'Delete a character. Requires user confirmation. Built-in characters are protected and cannot be deleted.',
    {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'create_world_book',
    'Create a world book (world-building text appended to character personas).',
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        content: { type: 'string', minLength: 1, maxLength: 10000, description: 'World-building plain text' },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    }
  ),
  fn(
    'update_world_book',
    'Update a world book. Requires user confirmation.',
    {
      type: 'object',
      properties: {
        name: { type: 'string' },
        new_name: { type: 'string', maxLength: 60 },
        content: { type: 'string', maxLength: 10000 },
      },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'delete_world_book',
    'Delete a world book. Requires user confirmation. Unlinks from all sessions.',
    {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    }
  ),
];

function executionProperties(): Record<string, unknown> {
  return {
    type: { type: 'string', enum: ['template', 'http_get', 'javascript', 'file_read', 'file_write', 'shell', 'device_action'] },
    template: { type: 'string', description: 'template type: result template with {{param}} placeholders' },
    url: { type: 'string', description: "http_get type: public https URL with {{param}} placeholders" },
    code: { type: 'string', maxLength: 20000, description: "javascript type: JS code. Reads 'input', assigns JSON-safe 'result'" },
    path: { type: 'string', description: 'file_read/file_write: relative path inside the private generated_skill_workspace' },
    content: { type: 'string', description: 'file_write: text content with {{param}} placeholders' },
    json_content: { type: 'object', description: 'file_write: JSON content, interpolated recursively' },
    append: { type: 'boolean', description: 'file_write: append instead of overwrite' },
    append_newline: { type: 'boolean', description: 'file_write: insert newline between appended records (JSONL)' },
    script: { type: 'string', maxLength: 8000, description: 'shell type: one allow-listed command per line' },
    action: { type: 'string', enum: ['flashlight', 'vibrate', 'notification', 'sequence'], description: 'device_action type' },
    state: { type: 'string', enum: ['on', 'off', 'blink'] },
    flashes: { type: 'integer', minimum: 1, maximum: 10 },
    on_ms: { type: 'integer', minimum: 20, maximum: 1000 },
    off_ms: { type: 'integer', minimum: 20, maximum: 2000 },
    duration_ms: { type: 'integer', minimum: 1, maximum: 10000 },
    title: { type: 'string', maxLength: 100 },
    message: { type: 'string', maxLength: 500 },
    sequence: {
      type: 'array',
      maxItems: 6,
      description: 'device_action sequence: 1-6 sub actions, no nesting',
      items: { type: 'object' },
    },
  };
}

function getExecutionDescription(): string {
  return [
    'Declarative implementation of the skill. One of:',
    '- template: `{template: "As of {{date}}, the price is {{price}}"}`, placeholders interpolated from args',
    '- http_get: `{url: "https://public.example.com/api?q={{q}}"}`, public HTTPS hostname required',
    '- javascript: `{code: "result = { sum: input.a + input.b }"}`, reads `input`, assigns JSON-safe `result`, 750ms sandbox limit',
    '- file_read: `{path: "notes.md"}` — read file in private workspace (100KB cap)',
    '- file_write: `{path: "notes.jsonl", json_content: {...}, append: true, append_newline: true}`',
    '- shell: one allow-listed command per line (pwd, date, echo, printf, ls, cat, touch, mkdir, rm, cp, mv, head, tail, wc, basename, dirname, sort, uniq, grep, cut, tr, sha256sum, md5sum, du, diff, find, stat, cmp, sed)',
    '- device_action: `{action: "vibrate", duration_ms: 300}` | notification | flashlight | sequence (1-6 steps)',
  ].join(' ');
}

/** 内置技能默认启用集合（酒馆老板） */
export const DEFAULT_ENABLED_TOOLS = ['web_search', 'roll_dice'];