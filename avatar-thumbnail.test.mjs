import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVATAR_THUMBNAIL_THRESHOLD,
  isOversizedAvatarUrl,
} from './src/core/avatarThumbnail.ts';

const png = (bytes) => `data:image/png;base64,${'A'.repeat(bytes)}`;

test('only oversized bitmap data URLs are thumbnailed', () => {
  assert.equal(isOversizedAvatarUrl(null), false);
  assert.equal(isOversizedAvatarUrl(undefined), false);
  assert.equal(isOversizedAvatarUrl(''), false);

  // 小图直接使用原图，避免不必要的解码/编码（阈值按 data URL 总长度判断）
  const prefix = 'data:image/png;base64,';
  assert.equal(isOversizedAvatarUrl(png(AVATAR_THUMBNAIL_THRESHOLD - prefix.length)), false);
  assert.equal(isOversizedAvatarUrl(png(AVATAR_THUMBNAIL_THRESHOLD - prefix.length + 1)), true);

  // 普通 URL 交给浏览器缓存与解码
  assert.equal(isOversizedAvatarUrl(`https://example.com/${'a'.repeat(200_000)}.png`), false);

  // 动图/矢量图缩略会丢帧或失真，跳过
  assert.equal(isOversizedAvatarUrl(`data:image/gif;base64,${'A'.repeat(200_000)}`), false);
  assert.equal(isOversizedAvatarUrl(`data:image/svg+xml;base64,${'A'.repeat(200_000)}`), false);

  // 其他位图格式在允许列表内
  for (const mime of ['image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/avif', 'IMAGE/PNG']) {
    assert.equal(isOversizedAvatarUrl(`data:${mime};base64,${'A'.repeat(200_000)}`), true, mime);
  }
});
