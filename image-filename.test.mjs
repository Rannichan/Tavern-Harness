import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
after(async () => { await vite.close(); });
const { buildGeneratedImagePath } = await vite.ssrLoadModule('/src/core/imageFilename.ts');

test('uses a readable requested filename and adds a uniqueness suffix', () => {
  assert.equal(
    buildGeneratedImagePath('夕阳下的城堡.png', 'ignored prompt', 'webp', 1234),
    'images/夕阳下的城堡-1234.webp',
  );
});

test('sanitizes paths and unsafe filename characters', () => {
  assert.equal(
    buildGeneratedImagePath('../../Cat portrait: blue eyes?', 'ignored prompt', 'png', 42),
    'images/Cat-portrait-blue-eyes-42.png',
  );
});

test('falls back to a prompt-derived readable filename', () => {
  assert.equal(
    buildGeneratedImagePath('', 'A fox reading a book under moonlight', 'jpg', 99),
    'images/A-fox-reading-a-book-under-moonlight-99.jpg',
  );
});

test('limits the readable filename stem to 64 Unicode characters', () => {
  const path = buildGeneratedImagePath('猫'.repeat(80), 'ignored prompt', 'png', 7);
  assert.equal(path, `images/${'猫'.repeat(64)}-7.png`);
});
