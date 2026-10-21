import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARD_PREVIEW_MAX_CHARS, textPreview } from './src/core/textPreview.ts';

test('keeps short previews untouched', () => {
  assert.equal(textPreview(''), '');
  assert.equal(textPreview(null), '');
  assert.equal(textPreview(undefined), '');
  assert.equal(textPreview('欢迎光临。'), '欢迎光临。');
  assert.equal(textPreview('x'.repeat(CARD_PREVIEW_MAX_CHARS)), 'x'.repeat(CARD_PREVIEW_MAX_CHARS));
});

test('truncates long previews to a fixed budget', () => {
  const long = '字'.repeat(5_000_000);
  const preview = textPreview(long);
  assert.equal(preview.length, CARD_PREVIEW_MAX_CHARS + 1); // 预览上限 + 省略号
  assert.ok(preview.endsWith('…'));
});

test('does not split a surrogate pair', () => {
  // 截断点落在 emoji 的两个 UTF-16 码元之间：丢掉整个 emoji，而不是留下半个
  const split = 'a'.repeat(CARD_PREVIEW_MAX_CHARS - 1) + '😀' + 'tail';
  const preview = textPreview(split);
  assert.equal(preview, 'a'.repeat(CARD_PREVIEW_MAX_CHARS - 1) + '…');
  assert.doesNotMatch(preview, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

  // 截断点正好在完整 emoji 之后：保留 emoji
  const whole = 'a'.repeat(CARD_PREVIEW_MAX_CHARS - 2) + '😀' + 'tail';
  assert.ok(textPreview(whole).endsWith('😀…'));
});

test('supports a custom budget and trims trailing whitespace', () => {
  assert.equal(textPreview('abcdefghij', 5), 'abcde…');
  assert.equal(textPreview('abc   defgh', 6), 'abc…');
  assert.equal(textPreview('abcdefghij', 0), 'abcdefghij');
});
