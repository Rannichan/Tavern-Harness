import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const port = 21000 + Math.floor(Math.random() * 1000);
const dataDir = mkdtempSync(join(tmpdir(), 'tavern-harness-preview-'));
const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, TAVERN_HARNESS_DATA_DIR: dataDir },
});

try {
  let response;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api-v3/lock/status`, {
        method: 'POST',
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clientId: 'preview-test' }),
      });
      if (response.status !== 404) break;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(response?.status, 200, 'vite preview must proxy persistence requests');
  assert.deepEqual((await response.json()).lock, { writable: false, held: false });
} finally {
  server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}
