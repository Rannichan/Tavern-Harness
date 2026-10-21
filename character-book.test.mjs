import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
after(() => vite.close());

const { CHARACTER_BOOK_TOOL_NAME, characterBookEntryStats, hasUsableCharacterBook, injectCharacterBookToolContext, mergeCharacterBooks, retrieveCharacterBookContext } =
  await vite.ssrLoadModule('/src/core/characterBook.ts');

const messages = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'Tell me about the capital and its guard.' },
];

function book(entries, extra = {}) {
  return JSON.stringify({ scan_depth: 2, token_budget: 1000, entries, ...extra });
}

test('detects usable enabled Character Book entries', () => {
  assert.equal(hasUsableCharacterBook(book([{ keys: ['ocean'], content: 'Recallable fact.' }])), true);
  assert.equal(hasUsableCharacterBook(book([{ keys: ['ocean'], content: ' ', enabled: false }])), false);
  assert.equal(hasUsableCharacterBook('{invalid'), false);
});

test('returns null and preserves messages when no entry matches', () => {
  const source = book([{ keys: ['ocean'], content: 'No match.' }]);
  assert.equal(retrieveCharacterBookContext(source, messages), null);
  assert.strictEqual(injectCharacterBookToolContext(messages, source), messages);
});

test('injects one ephemeral assistant tool call and its result for matches', () => {
  const source = book([{ name: 'Capital', keys: ['capital'], content: 'The capital has an ancient citadel.' }]);
  const injected = injectCharacterBookToolContext(messages, source);
  assert.equal(injected.length, messages.length + 2);
  assert.equal(injected.at(-2).role, 'assistant');
  assert.equal(injected.at(-2).tool_calls[0].function.name, CHARACTER_BOOK_TOOL_NAME);
  assert.deepEqual(JSON.parse(injected.at(-2).tool_calls[0].function.arguments), { keywords: ['capital'] });
  assert.equal(injected.at(-1).role, 'tool');
  assert.equal(injected.at(-1).tool_call_id, injected.at(-2).tool_calls[0].id);
  assert.match(injected.at(-1).content, /ancient citadel/);
});

test('matches English keyword boundaries by default', () => {
  const source = book([{ keys: ['die'], content: 'Should not be recalled.' }]);
  assert.equal(retrieveCharacterBookContext(source, [{ role: 'user', content: '*obedient*' }]), null);
});

test('matches Chinese keywords as contiguous text regardless of match_whole_words', () => {
  const source = book([{ keys: ['王都'], match_whole_words: true, content: 'The capital city.' }]);
  assert.match(retrieveCharacterBookContext(source, [{ role: 'user', content: '王都是帝国中心。' }]), /The capital city/);
});

test('uses primary keys plus SillyTavern selective secondary-key logic', () => {
  const source = book([
    { keys: ['capital'], secondary_keys: ['guard'], selective: true, selective_logic: 3, content: 'All secondary keys matched.' },
    { keys: ['capital'], secondary_keys: ['missing'], selective: true, selective_logic: 0, content: 'Must not appear.' },
  ]);
  const result = retrieveCharacterBookContext(source, messages);
  assert.match(result, /All secondary keys matched/);
  assert.doesNotMatch(result, /Must not appear/);
});

test('recursive scanning activates entries referenced by an activated entry', () => {
  const source = book([
    { keys: ['capital'], content: 'The capital is ruled by the Crown.' },
    { keys: ['Crown'], content: 'The Crown is hereditary.' },
  ], { recursive_scanning: true });
  const result = retrieveCharacterBookContext(source, messages);
  assert.match(result, /ruled by the Crown/);
  assert.match(result, /Crown is hereditary/);
});

test('constant entries are retrieved without a keyword match', () => {
  const source = book([{ constant: true, content: 'Always relevant fact.' }]);
  assert.match(retrieveCharacterBookContext(source, messages), /Always relevant fact/);
});

test('merges character and world book knowledge into one recall context', () => {
  const characterBook = book([{ keys: ['capital'], content: 'Character-side capital lore.' }]);
  const worldBook = JSON.stringify({
    scan_depth: 6,
    token_budget: 500,
    entries: [{ keys: ['capital'], content: 'World-side capital lore.' }],
  });
  const merged = mergeCharacterBooks(characterBook, worldBook);
  assert.notEqual(merged, characterBook);
  const result = retrieveCharacterBookContext(merged, messages);
  assert.match(result, /Character-side capital lore/);
  assert.match(result, /World-side capital lore/);
  const parsed = JSON.parse(merged);
  assert.equal(parsed.scan_depth, 6);
  // 预算为各知识库预算之和：1000 + 500
  assert.equal(parsed.token_budget, 1500);
});

test('mergeCharacterBooks ignores missing or invalid books', () => {
  const source = book([{ keys: ['ocean'], content: 'Only source.' }]);
  assert.equal(mergeCharacterBooks(source), source);
  assert.equal(mergeCharacterBooks(source, undefined, '', '{invalid'), source);
  assert.equal(mergeCharacterBooks(undefined, null, ''), undefined);
});

test('characterBookEntryStats counts total and recallable entries', () => {
  const source = book([
    { keys: ['a'], content: 'Enabled.' },
    { keys: ['b'], content: 'Disabled.', enabled: false },
    { keys: ['c'], content: '   ' },
  ]);
  assert.deepEqual(characterBookEntryStats(source), { total: 3, enabled: 1 });
  assert.deepEqual(characterBookEntryStats('{invalid'), { total: 0, enabled: 0 });
});

test('injects recall context without crypto.randomUUID (LAN http is not a secure context)', () => {
  // 手机扫码打开局域网 http 页面时 `crypto.randomUUID` 不存在（仅安全上下文提供），
  // 此时召回注入不能抛错，否则整个回合会在发出请求前中断。
  const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: { getRandomValues },
  });
  try {
    assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
    const source = book([{ constant: true, content: 'Always relevant fact.' }]);
    const injected = injectCharacterBookToolContext(messages, source);
    assert.equal(injected.length, messages.length + 2);
    const id = injected.at(-2).tool_calls[0].id;
    assert.match(id, /^character_book_ctx_[0-9a-z]+$/);
    assert.notEqual(id, 'character_book_ctx_undefined');
    assert.equal(injected.at(-1).tool_call_id, id);
  } finally {
    if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  }
});
