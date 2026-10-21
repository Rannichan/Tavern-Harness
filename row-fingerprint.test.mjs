import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hashText,
  npcFingerprint,
  sameRows,
  toolFingerprint,
  worldBookFingerprint,
} from './src/core/rowFingerprint.ts';

const npc = (overrides = {}) => ({
  id: 1,
  name: '老板',
  prompt: '你是一位酒馆老板。',
  greeting: '欢迎光临。',
  alternateGreetings: ['又见面了。'],
  characterBook: '{"entries":[]}',
  avatarColorOrdinal: 2,
  avatarDataUrl: 'data:image/png;base64,AAAA',
  enabledToolNames: ['roll_dice', 'get_time'],
  isBuiltIn: true,
  isTavernKeeper: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

test('hashText is stable and empty-safe', () => {
  assert.equal(hashText(''), 0);
  assert.equal(hashText(null), 0);
  assert.equal(hashText(undefined), 0);
  assert.equal(hashText('酒馆'), hashText('酒馆'));
  assert.notEqual(hashText('酒馆'), hashText('酒馆 '));
});

test('npcFingerprint ignores object identity but tracks visible fields', () => {
  const base = npcFingerprint(npc());
  assert.equal(base, npcFingerprint(npc()));

  for (const patch of [
    { name: '老板娘' },
    { prompt: '你是一位旅人。' },
    { greeting: '打烊了。' },
    { alternateGreetings: ['又见面了。', '晚安。'] },
    { characterBook: '{"entries":[1]}' },
    { avatarColorOrdinal: 3 },
    { avatarDataUrl: 'data:image/png;base64,BBBBB' },
    { enabledToolNames: ['roll_dice'] },
    { isBuiltIn: false },
    { isTavernKeeper: false },
  ]) {
    assert.notEqual(base, npcFingerprint(npc(patch)), `expected fingerprint change for ${JSON.stringify(patch)}`);
  }
});

test('npcFingerprint hashes small avatars and only compares length for large ones', () => {
  const smallA = npc({ avatarDataUrl: 'data:image/png;base64,AAAA' });
  const smallB = npc({ avatarDataUrl: 'data:image/png;base64,BBBB' });
  assert.notEqual(npcFingerprint(smallA), npcFingerprint(smallB));

  // 大图只比长度：逐字符哈希几 MB 的 base64 代价太高。
  const largeA = `data:image/png;base64,${'A'.repeat(200_000)}`;
  const largeB = `data:image/png;base64,${'B'.repeat(200_000)}`;
  assert.equal(npcFingerprint(npc({ avatarDataUrl: largeA })), npcFingerprint(npc({ avatarDataUrl: largeB })));
});

test('worldBookFingerprint tracks editable content and image content', () => {
  const book = { id: 3, name: '手册', content: '正文', characterBook: '{}', imageUri: null, isBuiltIn: true, createdAt: 1 };
  const base = worldBookFingerprint(book);
  assert.equal(base, worldBookFingerprint({ ...book }));
  assert.notEqual(base, worldBookFingerprint({ ...book, name: '新手册' }));
  assert.notEqual(base, worldBookFingerprint({ ...book, content: '新正文' }));
  assert.notEqual(base, worldBookFingerprint({ ...book, characterBook: '{"a":1}' }));
  assert.notEqual(base, worldBookFingerprint({ ...book, isBuiltIn: false }));
  assert.notEqual(base, worldBookFingerprint({ ...book, imageUri: 'data:image/png;base64,AA' }));

  // 等长的小图仍能通过内容指纹区分，只有超大图才退化为长度比较。
  assert.notEqual(
    worldBookFingerprint({ ...book, imageUri: 'data:image/png;base64,AA' }),
    worldBookFingerprint({ ...book, imageUri: 'data:image/png;base64,BB' }),
  );
  const largeA = `data:image/png;base64,${'A'.repeat(200_000)}`;
  const largeB = `data:image/png;base64,${'B'.repeat(200_000)}`;
  assert.equal(
    worldBookFingerprint({ ...book, imageUri: largeA }),
    worldBookFingerprint({ ...book, imageUri: largeB }),
  );
});

test('toolFingerprint tracks the definition and drag order', () => {
  const tool = {
    id: 5,
    name: 'roll_dice',
    jsonContent: '{"name":"roll_dice"}',
    executionJson: null,
    isBuiltIn: true,
    origin: 'builtin',
    createdAt: 1,
    displayOrder: 0,
  };
  const base = toolFingerprint(tool);
  assert.equal(base, toolFingerprint({ ...tool }));
  assert.notEqual(base, toolFingerprint({ ...tool, displayOrder: 2 }));
  assert.notEqual(base, toolFingerprint({ ...tool, jsonContent: '{"name":"roll_dice","x":1}' }));
  assert.notEqual(base, toolFingerprint({ ...tool, executionJson: '{}' }));
  assert.notEqual(base, toolFingerprint({ ...tool, origin: 'custom' }));
});

test('sameRows treats equal fingerprints as unchanged', () => {
  const prev = [npc(), npc({ id: 2, name: '第二位' })];
  // 重新从存储读出来的对象是新的引用，但内容一致 → 不写入，避免整页重渲染
  assert.equal(sameRows(prev, prev.map((row) => ({ ...row })), npcFingerprint), true);
  assert.equal(sameRows(prev, [...prev], npcFingerprint), true);
  assert.equal(sameRows([], [], npcFingerprint), true);

  const changed = prev.map((row) => ({ ...row }));
  changed[1] = { ...changed[1], greeting: '新开场白' };
  assert.equal(sameRows(prev, changed, npcFingerprint), false);

  // 数量变化（新增 / 删除角色）必须写入
  assert.equal(sameRows(prev, [...prev, npc({ id: 3 })], npcFingerprint), false);
  assert.equal(sameRows(prev, [prev[0]], npcFingerprint), false);

  // 顺序变化（排序规则变化）也要写入
  assert.equal(sameRows(prev, [prev[1], prev[0]], npcFingerprint), false);
});
