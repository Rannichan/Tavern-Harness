import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const port = 20000 + Math.floor(Math.random() * 1000);
const token = `test-token-${process.pid}`;
const dataDir = mkdtempSync(join(tmpdir(), 'tavern-harness-data-'));
const server = spawn(process.execPath, ['persistence-server.mjs', String(port)], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, PERSISTENCE_SERVICE_TOKEN: token, TAVERN_HARNESS_DATA_DIR: dataDir },
});

async function request(path, body = {}, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Persistence-Service-Token': token,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  let health;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      health = await request('/health', {}, 'GET');
      if (health.status === 200) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(health?.status, 200, 'persistence service must start');
  const initialSettings = await request('/records/get', { collection: 'settings', key: '1' });
  assert.equal(initialSettings.body.record, null, 'A second browser can observe an unseeded database without crashing');

  const clientA = 'browser-a';
  const clientB = 'browser-b';
  assert.equal((await request('/lock/acquire/', { clientId: clientA })).status, 200);
  assert.equal((await request('/lock/status', { clientId: clientA })).body.lock.writable, true);
  assert.equal((await request('/lock/acquire', { clientId: clientB })).status, 423);
  assert.equal((await request('/records/put', { clientId: clientB, collection: 'settings', key: '1', value: { themeMode: 'dark' } })).status, 423);
  const takeover = await request('/lock/takeover/', { clientId: clientB });
  assert.equal(takeover.status, 200);
  assert.equal(takeover.body.lock.writable, true);
  assert.equal((await request('/lock/status', { clientId: clientB })).body.lock.writable, true);
  assert.equal((await request('/lock/status', { clientId: clientA })).body.lock.writable, false);
  assert.equal((await request('/records/put', { clientId: clientA, collection: 'settings', key: '1', value: { themeMode: 'light' } })).status, 423);
  assert.equal((await request('/records/put', { clientId: clientB, collection: 'settings', key: '1', value: { themeMode: 'dark' } })).status, 200);

  const firstId = await request('/records/allocate-id', { clientId: clientB, collection: 'sessions' });
  const secondId = await request('/records/allocate-id', { clientId: clientB, collection: 'sessions' });
  assert.deepEqual([firstId.body.id, secondId.body.id], [1, 2]);
  assert.equal((await request('/records/put', { clientId: clientB, collection: 'sessions', key: String(firstId.body.id), value: { id: firstId.body.id } })).status, 200);
  assert.equal((await request('/records/allocate-id', { clientId: clientB, collection: 'sessions' })).body.id, 3);
  assert.equal((await request('/records/allocate-id', { clientId: clientA, collection: 'sessions' })).status, 423);

  const record = await request('/records/get', { collection: 'settings', key: '1' });
  assert.deepEqual(record.body.record.value, { themeMode: 'dark' });
  const list = await request('/records/list', { collection: 'settings' });
  assert.equal(list.body.records.length, 1);

  assert.equal((await request('/lock/acquire', { clientId: clientA })).status, 423);
  assert.equal((await request('/records/delete', { clientId: clientB, collection: 'settings', key: '1' })).status, 200);
  assert.equal((await request('/records/get', { collection: 'settings', key: '1' })).body.record, null);

  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const restarted = spawn(process.execPath, ['persistence-server.mjs', String(port)], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, PERSISTENCE_SERVICE_TOKEN: token, TAVERN_HARNESS_DATA_DIR: dataDir },
  });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        health = await request('/health', {}, 'GET');
        if (health.status === 200) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(health?.status, 200, 'restarted persistence service must start');
    assert.equal((await request('/lock/acquire', { clientId: clientA })).status, 423);
    assert.equal((await request('/lock/takeover', { clientId: clientA })).status, 200);
  } finally {
    restarted.kill('SIGTERM');
  }
} finally {
  server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}
