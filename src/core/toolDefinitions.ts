import type { ChatCompletionTool } from '../types/models';

export const MAX_TOOL_CALL_DEPTH = 10;
export const MAX_TOOL_CALLS_PER_TURN = 20;
export const MAX_IDENTICAL_TOOL_CALLS = 3;
export const MAX_CONSECUTIVE_TOOL_FAILURES = 3;
export const NEW_TOPIC_MARKER = '开始新话题';

export const BUILTIN_TOOL_NAMES = [
  'run_shell_script',
  'roll_dice',
  'file_read',
  'file_write',
  'file_edit',
  'create_skill',
  'update_skill',
  'delete_skill',
  'get_tavern_info',
  'get_character_info',
  'get_lorebook_info',
  'file_display',
  'create_character',
  'update_character',
  'delete_character',
  'create_conversation',
  'create_lorebook',
  'update_lorebook',
  'delete_lorebook',
] as const;

const fn = (name: string, description: string, parameters: Record<string, unknown>): ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters },
});

export const BUILTIN_TOOLS: ChatCompletionTool[] = [
  fn(
    'run_shell_script',
    'Execute commands through the controlled local command service to process files, run code, or perform system operations on the user\'s machine. This is not an OS sandbox.',
    {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          maxLength: 8000,
          description: 'Local command script (max 20 commands). Supports newlines, &&, ||, and ;. Allowlisted commands run directly; every other command requires user confirmation. Pipes, redirects, and expansion are unsupported. Lines starting with # are ignored. Non-interactive only.',
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
    'Read a text file from the current conversation workspace. Paths must stay inside the workspace; for normal sessions, the public link is read-only.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current conversation workspace. Absolute paths and parent traversal are rejected. The file must exist.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    }
  ),
  fn(
    'file_write',
    'Write or append to a file in the current conversation workspace. Absolute paths and parent traversal are rejected. For normal sessions, writing to the public link is denied.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current conversation workspace. Absolute paths and parent traversal are rejected. public link is read-only in normal sessions.',
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
    'file_edit',
    'Edit an existing text file by replacing exact text. Prefer this over file_write for small code changes. The edit is rejected unless old_text occurs exactly expected_replacements times, which protects against stale or ambiguous edits. Path rules follow file_write: workspace-relative only, and public link stays read-only in normal sessions.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the current workspace. Must exist.',
        },
        old_text: {
          type: 'string',
          minLength: 1,
          description: 'Exact text to replace, including whitespace and indentation.',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text. Use an empty string to delete old_text.',
        },
        expected_replacements: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 1,
          description: 'Required number of exact matches. Defaults to 1.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
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
    'get_tavern_info',
    'Read-only snapshot of the tavern: characters, Lorebooks, skills and career statistics.',
    {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string', enum: ['characters', 'lorebooks', 'skills', 'career_stats'] },
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
    'get_character_info',
    'Get the details of a character card by name.',
    {
      type: 'object',
      properties: { name: { type: 'string', description: 'Existing character name' } },
      required: ['name'],
      additionalProperties: false,
    }
  ),
  fn(
    'get_lorebook_info',
    'Get the details of a Lorebook by name.',
    {
      type: 'object',
      properties: { name: { type: 'string', description: 'Existing Lorebook name' } },
      required: ['name'],
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
    'create_lorebook',
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
    'update_lorebook',
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
    'delete_lorebook',
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
    type: { type: 'string', enum: ['template', 'http_get', 'javascript', 'file_read', 'file_write', 'shell'] },
    template: { type: 'string', description: 'template type: result template with {{param}} placeholders' },
    url: { type: 'string', description: "http_get type: public https URL with {{param}} placeholders" },
    code: { type: 'string', maxLength: 20000, description: "javascript type: JS code. Reads 'input' (args object), assigns JSON-safe 'result'. Supports async/await. Injected helpers: await $read(path)->string, $write(path, content), $append(path, content), $list()->[paths]. Helper paths must be relative to the current session workspace; absolute paths and parent traversal (..) are rejected." },
    path: { type: 'string', description: 'file_read/file_write: relative path inside the private generated_skill_workspace' },
    content: { type: 'string', description: 'file_write: text content with {{param}} placeholders' },
    json_content: { type: 'object', description: 'file_write: JSON content, interpolated recursively' },
    append: { type: 'boolean', description: 'file_write: append instead of overwrite' },
    append_newline: { type: 'boolean', description: 'file_write: insert newline between appended records (JSONL)' },
    script: { type: 'string', maxLength: 8000, description: 'shell type: local commands; non-allowlisted commands require user confirmation' },
  };
}

function getExecutionDescription(): string {
  return [
    'Declarative implementation of the skill. One of:',
    '- template: `{template: "As of {{date}}, the price is {{price}}"}`, placeholders interpolated from args',
    '- http_get: `{url: "https://public.example.com/api?q={{q}}"}`, public HTTPS hostname required',
    '- javascript: `{code: "result = { sum: input.a + input.b }"}`, reads `input`, assigns JSON-safe `result`; supports async/await and can persist game state via `await $read/$write/$append/$list`. These helpers only accept relative paths in the current session workspace; absolute paths and `..` are rejected',
    '- file_read: `{path: "notes.md"}` — read a file from sandbox_workspace/ through the required local workspace service (100KB cap)',
    '- file_write: `{path: "notes.jsonl", json_content: {...}, append: true, append_newline: true}` — write to sandbox_workspace/ through the required local workspace service',
    '- shell: commands executed as REAL local commands via an optional controlled service (node sandbox-server.mjs); this is not OS-isolated. Supports newlines, &&, ||, and ; (max 20 commands), but not pipes, redirects, or expansion. Simple non-executing utilities, jq, and bc are allowlisted; command launchers, tools with exec/plugin hooks, and every other command require user confirmation',
  ].join(' ');
}

/** 默认内置技能名列表（酒馆老板默认启用全部内置技能） */
export const ALL_BUILTIN_TOOL_NAMES = [...BUILTIN_TOOL_NAMES];