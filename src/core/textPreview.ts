/** 截断卡片列表中的长文本预览。 */
export const CARD_PREVIEW_MAX_CHARS = 2000;

/**
 * 截断卡片预览文本；不拆开代理对（emoji / 生僻字），并追加省略号。
 * `maxChars <= 0` 表示不截断（调用方默认使用 CARD_PREVIEW_MAX_CHARS）。
 */
export function textPreview(text: string | null | undefined, maxChars: number = CARD_PREVIEW_MAX_CHARS): string {
  if (!text) return '';
  if (maxChars <= 0 || text.length <= maxChars) return text;
  let end = maxChars;
  const last = text.charCodeAt(end - 1);
  // 高代理项结尾：少切一个，避免把两段 UTF-16 组成的字符劈开
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}
