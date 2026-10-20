import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
after(() => vite.close());

const { parseSillyTavernWorldInfoJson } = await vite.ssrLoadModule('/src/core/sillyTavernWorldInfo.ts');
const { retrieveCharacterBookContext } = await vite.ssrLoadModule('/src/core/characterBook.ts');

const messages = [{ role: 'user', content: 'Tell me about the capital and its guard.' }];

test('normalizes SillyTavern world info object entries into Character Book JSON', () => {
  const parsed = parseSillyTavernWorldInfoJson(JSON.stringify({
    name: 'Test Lorebook',
    description: 'World description.',
    scan_depth: 50,
    token_budget: 500,
    recursive_scanning: true,
    entries: {
      0: {
        uid: 1,
        key: ['capital'],
        keysecondary: ['guard'],
        comment: 'Capital',
        content: 'The capital has an ancient citadel.',
        constant: true,
        selective: true,
        selectiveLogic: 3,
        order: 10,
        disable: false,
        useProbability: true,
        probability: 80,
        case_sensitive: true,
      },
      1: {
        uid: 2,
        keys: ['forest'],
        secondary_keys: [],
        name: 'Forest',
        content: 'The forest is old.',
        enabled: false,
      },
    },
  }));

  assert.equal(parsed.name, 'Test Lorebook');
  assert.equal(parsed.content, 'World description.');
  assert.equal(parsed.entryCount, 2);
  assert.equal(parsed.enabledEntryCount, 1);

  const book = JSON.parse(parsed.characterBook);
  assert.equal(book.scan_depth, 50);
  assert.equal(book.token_budget, 500);
  assert.equal(book.recursive_scanning, true);
  assert.equal(book.description, 'World description.');
  assert.deepEqual(book.entries[0].keys, ['capital']);
  assert.deepEqual(book.entries[0].secondary_keys, ['guard']);
  assert.equal(book.entries[0].enabled, true);
  assert.equal(book.entries[0].constant, true);
  assert.equal(book.entries[0].selective_logic, 3);
  assert.equal(book.entries[0].insertion_order, 10);
  assert.equal(book.entries[0].probability, 80);
  assert.equal(book.entries[0].case_sensitive, true);
  assert.deepEqual(book.entries[1].keys, ['forest']);
  assert.equal(book.entries[1].enabled, false);
  assert.equal(book.entries[1].name, 'Forest');
});

test('imported world info participates in keyword recall', () => {
  const parsed = parseSillyTavernWorldInfoJson(JSON.stringify({
    name: 'Recallable',
    entries: [{ key: ['capital'], content: 'Imported capital lore.' }],
  }));
  assert.match(retrieveCharacterBookContext(parsed.characterBook, messages), /Imported capital lore/);
});

test('accepts array entries and falls back to the provided name', () => {
  const parsed = parseSillyTavernWorldInfoJson(JSON.stringify({
    entries: [{ keys: ['ocean'], content: 'Ocean lore.' }],
  }), 'Fallback name');
  assert.equal(parsed.name, 'Fallback name');
  assert.equal(parsed.entryCount, 1);
});

test('rejects invalid or empty world info JSON', () => {
  assert.throws(() => parseSillyTavernWorldInfoJson('{invalid'));
  assert.throws(() => parseSillyTavernWorldInfoJson(JSON.stringify({ name: 'No entries' })));
  assert.throws(() => parseSillyTavernWorldInfoJson(JSON.stringify({ entries: [{ key: ['x'], content: ' ' }] })));
});
