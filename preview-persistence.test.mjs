import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
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
const upstream = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ method: req.method, url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() }));
});
await new Promise((resolve, reject) => upstream.once('error', reject).listen(0, '127.0.0.1', resolve));

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

  const proxyResponse = await fetch(`${baseUrl}/api/127.0.0.1:${upstream.address().port}/v1/audio/speech?signature=a%2Fb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: '{"input":"hello"}',
  });
  assert.deepEqual(await proxyResponse.json(), {
    method: 'POST',
    url: '/v1/audio/speech?signature=a%2Fb',
    authorization: 'Bearer test-key',
    body: '{"input":"hello"}',
  }, 'preview must proxy speech requests without changing credentials, body, or signed query');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => upstream.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
