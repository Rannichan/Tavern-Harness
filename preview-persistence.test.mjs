import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const port = 21000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'tavern-harness-preview-'));
const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, TAVERN_HARNESS_DATA_DIR: dataDir },
});

function post(headers = {}) {
  return fetch(`${baseUrl}/api-v3/lock/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ clientId: 'preview-test' }),
  });
}

try {
  let response;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      // Same-origin without Sec-Fetch-Site: covered because some mobile
      // browsers omit fetch metadata for same-origin requests.
      response = await post({ Origin: baseUrl });
      if (response.status !== 404) break;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(response?.status, 200, 'vite preview must proxy persistence requests');
  assert.deepEqual((await response.json()).lock, { writable: false, held: false });

  // Negative cases: the proxy must keep rejecting non-browser / cross-site
  // callers even though Sec-Fetch-Site is now optional.
  const missingOrigin = await post();
  assert.equal(missingOrigin.status, 403, 'requests without Origin must be rejected');

  const crossOrigin = await post({ Origin: 'http://evil.example' });
  assert.equal(crossOrigin.status, 403, 'requests with a foreign Origin must be rejected');

  const crossSite = await post({ Origin: baseUrl, 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403, 'cross-site fetch metadata must be rejected');

  const sameOrigin = await post({ Origin: baseUrl, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(sameOrigin.status, 200, 'explicit same-origin fetch metadata must be accepted');
} finally {
  server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}
