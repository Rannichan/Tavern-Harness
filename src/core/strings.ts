export function trimEdgeNewlines(text: string): string {
  return text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}

export function idToKey(id: string): string {
  return id.replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}