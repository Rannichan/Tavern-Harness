/** Parse the common argument format used by both native and generated tools. */
export function parseToolArguments(input: string): { args: Record<string, unknown>; json: string } {
  let json = input.trim() || '{}';
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    // Only unwrap a complete outer fence. Fences inside file content are untouched.
    const fence = json.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fence) json = fence[1].trim();
    json = escapeStringControls(json);
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error(
        'Tool arguments are not valid JSON. Send a complete JSON object with double-quoted keys and escaped strings. ' +
        'Do not omit closing quotes or braces. For large file_write requests, use smaller chunks with append: true.'
      );
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be a JSON object, not null, an array or a primitive.');
  }
  return { args: value as Record<string, unknown>, json };
}

/**
 * Literal control characters in model-generated strings have an unambiguous value.
 * Escape them for JSON without changing the decoded file/code content. Never guess
 * missing quotes, escapes, commas or closing delimiters.
 */
function escapeStringControls(input: string): string {
  let inString = false;
  let escaped = false;
  let result = '';
  for (const char of input) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      } else if (char.charCodeAt(0) < 0x20) {
        result += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    result += char;
  }
  return result;
}

export const TOOL_ARGUMENTS_INSTRUCTIONS =
  'Tool arguments must be a complete JSON object matching the tool parameter schema. ' +
  'Use double-quoted keys and properly escape quotes, backslashes, newlines and tabs inside string values, including file content and code. ' +
  'Do not wrap arguments in Markdown fences. If file_write is available, write large files in smaller chunks and use append: true for subsequent chunks.';
