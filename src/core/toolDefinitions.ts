import type { ChatCompletionTool } from '../types/models';

export const MAX_TOOL_CALL_DEPTH = 4;
export const NEW_TOPIC_MARKER = '开始新话题';

export const BUILTIN_TOOL_NAMES = [
  'run_shell_script',
  'roll_dice',
  'file_read',
  'file_write',
  'create_skill',
  'update_skill',
  'delete_skill',
  'get_tavern_status',
  'file_display',
  'create_character',
  'update_character',
  'delete_character',
  'create_conversation',
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
    'run_shell_script',
    'Execute a shell script in the local sandbox to process files, run code, or perform system operations on the user\'s machine.',
    {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          maxLength: 8000,
          description: 'Shell script, one command per line (max 20 lines). Lines starting with # are ignored. Non-interactive only.',
        },
      },
      required: ['script'],
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
    'file_read',
    'Read a text file from the current workspace.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current workspace. Must exist.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    }
  ),
  fn(
    'file_write',
    'Write or append to a file in the current workspace.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current workspace.',
        },
        content: {
          type: 'string',
          description: 'File content as a string.',
        },
        append: {
          type: 'boolean',
          description: 'Append to existing file instead of overwriting.',
        },
      },
      required: ['path', 'content'],
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
    'get_tavern_status',
    'Read-only snapshot of the tavern: characters, Lorebooks, skills and career statistics. Never modifies anything.',
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
    'file_display',
    'Display any file from the current workspace to the user in a popup. Useful for inspecting existing files, reviewing generated output (reports, dashboards, images, HTML pages), or browsing the workspace content. Only shows the file in the UI — it does NOT return the file content; use file_read to actually read the content.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current workspace. Must exist.',
        },
        title: {
          type: 'string',
          description: 'Optional popup title. Defaults to the file name.',
        },
      },
      required: ['path'],
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
        alternate_greetings: { type: 'array', items: { type: 'string', maxLength: 1000 }, description: 'Optional alternative greetings; one is picked at random when a chat starts' },
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
        alternate_greetings: { type: 'array', items: { type: 'string', maxLength: 1000 }, description: 'Replace the full list of alternate greetings' },
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
    'create_conversation',
    'Create a new conversation. The player is always included automatically; you only need to specify the characters to add, plus optional Lorebook, speaking order, random-order switch, and user persona.',
    {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 60, description: 'Conversation name' },
        participants: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          description: 'Character names to add to the conversation. The player is included automatically.',
        },
        world_book: { type: 'string', description: 'Optional Lorebook name' },
        speaking_order: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          description: "Optional fixed speaking order. Use character names plus 'user' for the player.",
        },
        user_persona: { type: 'string', description: 'Optional character name used as the user persona' },
        random_order: { type: 'boolean', default: false, description: 'Whether to randomize speaking order each round' },
        enable_greeting: {
          type: 'boolean',
          default: true,
          description: 'Whether to seed an opening greeting. In group chats, only the first non-user speaker greets; if the user goes first, no greeting is added.',
        },
      },
      required: ['participants'],
      additionalProperties: false,
    }
  ),
  fn(
    'create_world_book',
    'Create a Lorebook (world-building text appended to character personas).',
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
    'Update a Lorebook. Requires user confirmation.',
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
    'Delete a Lorebook. Requires user confirmation. Unlinks from all sessions.',
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
    code: { type: 'string', maxLength: 20000, description: "javascript type: JS code. Reads 'input' (args object), assigns JSON-safe 'result'. Supports async/await. Injected helpers: await $read(path)->string, $write(path, content), $append(path, content), $list()->[paths] — these read/write the current workspace (sandboxed to sandbox_workspace/ or virtual workspace) with the same path & size limits as file_read/file_write" },
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
    '- javascript: `{code: "result = { sum: input.a + input.b }"}`, reads `input`, assigns JSON-safe `result`; supports async/await, and can persist game state via `await $read/$write/$append/$list` (sandboxed current workspace, same limits as file_read/file_write)',
    '- file_read: `{path: "notes.md"}` — read file in workspace (real disk sandbox_workspace/ when local sandbox running, else in-browser virtual workspace; 100KB cap)',
    '- file_write: `{path: "notes.jsonl", json_content: {...}, append: true, append_newline: true}` — writes to real sandbox_workspace/ folder in project dir when local sandbox running, else virtual workspace',
    '- shell: one allow-listed command per line, executed as REAL local commands via an optional local sandbox service (node sandbox-server.mjs). Whitelisted commands (pwd, ls, cat, grep, sed, tar, unzip, jq, awk, python3, node, git, ...) run directly without confirmation. High-risk commands (sudo, curl, wget, dd, shutdown, docker, ssh, ...) require a user confirmation dialog first; everything else is rejected',
    '- device_action: `{action: "vibrate", duration_ms: 300}` | notification | flashlight | sequence (1-6 steps)',
  ].join(' ');
}

/** 默认内置技能名列表（酒馆老板默认启用全部内置技能） */
export const ALL_BUILTIN_TOOL_NAMES = [...BUILTIN_TOOL_NAMES];