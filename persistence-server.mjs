#!/usr/bin/env node
// Server-side SQLite persistence service. It is intentionally reachable only
// through Vite's same-origin proxy; this process itself listens on loopback.

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.argv[2] || process.env.PERSISTENCE_PORT || 17892);
// 记录读写（图片/附件）走大上限；锁和健康检查的请求体很小，单独收紧。
const MAX_RECORD_BODY_BYTES = 30 * 1024 * 1024;
const MAX_CONTROL_BODY_BYTES = 1024 * 1024;
const SERVICE_TOKEN = process.env.PERSISTENCE_SERVICE_TOKEN;
if (!SERVICE_TOKEN) {
  console.error('[persistence-service] missing PERSISTENCE_SERVICE_TOKEN');
  process.exit(1);
}

const dataDir = resolve(process.env.TAVERN_HARNESS_DATA_DIR || join(homedir(), '.tavern-harness'));
mkdirSync(dataDir, { recursive: true });
const databasePath = join(dataDir, 'tavern-harness.sqlite');
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_records (
    collection TEXT NOT NULL,
    record_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (collection, record_key)
  );
  CREATE INDEX IF NOT EXISTS idx_app_records_collection ON app_records(collection);
  CREATE TABLE IF NOT EXISTS record_sequences (
    collection TEXT PRIMARY KEY,
    next_id INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_state (
    state_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`);

const getServiceState = database.prepare('SELECT value_json FROM service_state WHERE state_key = ?');
const saveServiceState = database.prepare(`
  INSERT INTO service_state (state_key, value_json) VALUES (?, ?)
  ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json
`);
const deleteServiceState = database.prepare('DELETE FROM service_state WHERE state_key = ?');

function loadWriteLock() {
  const row = getServiceState.get('write_lock');
  if (!row) return null;
  try {
    const lock = JSON.parse(row.value_json);
    return typeof lock?.clientId === 'string' && typeof lock?.leaseId === 'string' ? lock : null;
  } catch {
    return null;
  }
}

let writeLock = loadWriteLock();

function setWriteLock(lock) {
  writeLock = lock;
  if (lock) saveServiceState.run('write_lock', JSON.stringify(lock));
  else deleteServiceState.run('write_lock');
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  const acceptedEncodings = String(res.req.headers['accept-encoding'] || '').toLowerCase();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Accept-Encoding',
  };
  let encoded = payload;
  if (payload.length >= 1024 && /\bbr\b/.test(acceptedEncodings)) {
    encoded = brotliCompressSync(payload, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
    headers['Content-Encoding'] = 'br';
  } else if (payload.length >= 1024 && /\bgzip\b/.test(acceptedEncodings)) {
    encoded = gzipSync(payload, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = String(encoded.length);
  res.writeHead(status, headers);
  res.end(encoded);
}

function readJson(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    let raw = '';
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return; // 拒绝后继续排空请求体，但不再累计内存
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        tooLarge = true;
        const error = new Error('Request body is too large');
        error.status = 413;
        reject(error);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON request body'));
      }
    });
    req.on('error', reject);
  });
}

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const expected = Buffer.from(SERVICE_TOKEN);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validCollection(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/i.test(value);
}

function validKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255;
}

function validBulkUpdates(value) {
  return Array.isArray(value)
    && value.length <= 10_000
    && value.every((update) => update
      && typeof update === 'object'
      && validKey(update.key)
      && update.changes
      && typeof update.changes === 'object'
      && !Array.isArray(update.changes));
}

function lockState(clientId) {
  return {
    writable: Boolean(writeLock && writeLock.clientId === clientId),
    held: Boolean(writeLock),
  };
}

function requireWriter(clientId) {
  if (!writeLock || writeLock.clientId !== clientId) {
    const error = new Error(writeLock ? 'Another browser currently holds the write lock' : 'Write lock required');
    error.status = 423;
    throw error;
  }
}

function saveRecord(collection, key, value) {
  database.prepare(`
    INSERT INTO app_records (collection, record_key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, record_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(collection, key, JSON.stringify(value), Date.now());
}

const getRecord = database.prepare('SELECT value_json, updated_at FROM app_records WHERE collection = ? AND record_key = ?');
const listRecords = database.prepare('SELECT record_key, value_json, updated_at FROM app_records WHERE collection = ? ORDER BY record_key');
const getMessageRawLog = database.prepare(`
  SELECT json_extract(value_json, '$.rawRequestBody') AS raw_request_body,
         json_extract(value_json, '$.rawResponseBody') AS raw_response_body
  FROM app_records
  WHERE collection = 'messages' AND record_key = ?
`);
const listRecordsByJsonField = database.prepare(`
  SELECT record_key, value_json, updated_at
  FROM app_records
  WHERE collection = ? AND json_extract(value_json, ?) = ?
  ORDER BY record_key
`);
const listStartupRecords = database.prepare(`
  SELECT collection, record_key, value_json, updated_at
  FROM app_records
  WHERE collection IN ('settings', 'providers', 'npcs', 'sessions', 'worldBooks', 'tools', 'achievementUnlocks')
  ORDER BY collection, record_key
`);
const deleteRecord = database.prepare('DELETE FROM app_records WHERE collection = ? AND record_key = ?');
const clearCollection = database.prepare('DELETE FROM app_records WHERE collection = ?');
function bulkUpdateRecords(collection, updates) {
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const { key, changes } of updates) {
      const record = getRecord.get(collection, key);
      if (!record) continue;
      saveRecord(collection, key, { ...JSON.parse(record.value_json), ...changes });
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
const nextNumericRecordKey = database.prepare(`
  SELECT COALESCE(MAX(CAST(record_key AS INTEGER)), 0) + 1 AS next_key
  FROM app_records
  WHERE collection = ? AND record_key GLOB '[0-9]*'
`);
const getRecordSequence = database.prepare('SELECT next_id FROM record_sequences WHERE collection = ?');
const saveRecordSequence = database.prepare(`
  INSERT INTO record_sequences (collection, next_id) VALUES (?, ?)
  ON CONFLICT(collection) DO UPDATE SET next_id = excluded.next_id
`);

function allocateNumericRecordId(collection) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const sequence = getRecordSequence.get(collection);
    const initialId = Number(nextNumericRecordKey.get(collection).next_key);
    const id = Math.max(Number(sequence?.next_id) || 0, initialId);
    saveRecordSequence.run(collection, id + 1);
    database.exec('COMMIT');
    return id;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

const server = createServer(async (req, res) => {
  if (!tokenMatches(req.headers['x-persistence-service-token'])) {
    json(res, 401, { ok: false, message: 'Unauthorized persistence service request' });
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && pathname === '/health') {
      json(res, 200, { ok: true, databasePath, lock: lockState(null) });
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, message: 'Method not allowed' });
      return;
    }

    const bodyLimit = pathname.startsWith('/records/') ? MAX_RECORD_BODY_BYTES : MAX_CONTROL_BODY_BYTES;
    const body = await readJson(req, bodyLimit);
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';

    if (pathname === '/lock/status') {
      json(res, 200, { ok: true, lock: lockState(clientId) });
      return;
    }
    if (pathname === '/lock/acquire' || pathname === '/lock/takeover') {
      const existing = writeLock;
      if (!clientId || clientId.length > 255) {
        json(res, 400, { ok: false, message: 'A valid clientId is required' });
        return;
      }
      if (existing && existing.clientId !== clientId && pathname !== '/lock/takeover') {
        json(res, 423, { ok: false, message: 'Another browser currently holds the write lock', lock: lockState(clientId) });
        return;
      }
      setWriteLock({ clientId, leaseId: randomBytes(24).toString('base64url') });
      json(res, 200, { ok: true, leaseId: writeLock.leaseId, lock: lockState(clientId) });
      return;
    }
    if (pathname === '/startup/snapshot') {
      if (!clientId || clientId.length > 255) {
        json(res, 400, { ok: false, message: 'A valid clientId is required' });
        return;
      }
      if (!writeLock) setWriteLock({ clientId, leaseId: randomBytes(24).toString('base64url') });
      const collections = {
        settings: [],
        providers: [],
        npcs: [],
        sessions: [],
        worldBooks: [],
        tools: [],
        achievementUnlocks: [],
      };
      for (const row of listStartupRecords.all()) {
        collections[row.collection].push({
          key: row.record_key,
          value: JSON.parse(row.value_json),
          updatedAt: row.updated_at,
        });
      }
      json(res, 200, { ok: true, lock: lockState(clientId), collections });
      return;
    }
    if (!pathname.startsWith('/records/')) {
      json(res, 404, { ok: false, message: `Unknown persistence endpoint: ${pathname}` });
      return;
    }

    const collection = body.collection;
    if (!validCollection(collection)) {
      json(res, 400, { ok: false, message: `Invalid collection for ${pathname}` });
      return;
    }

    if (pathname === '/records/message-raw-log') {
      if (collection !== 'messages' || !validKey(body.key)) {
        json(res, 400, { ok: false, message: 'A valid message key is required' });
        return;
      }
      const record = getMessageRawLog.get(body.key);
      json(res, 200, {
        ok: true,
        rawLog: record ? {
          rawRequestBody: record.raw_request_body ?? null,
          rawResponseBody: record.raw_response_body ?? null,
        } : null,
      });
      return;
    }
    if (pathname === '/records/list' || pathname === '/records/list-by-field') {
      let rows;
      if (pathname === '/records/list-by-field') {
        const { field, value } = body;
        if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)) {
          json(res, 400, { ok: false, message: 'Invalid record field' });
          return;
        }
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          json(res, 400, { ok: false, message: 'Invalid record field value' });
          return;
        }
        rows = listRecordsByJsonField.all(collection, `$.${field}`, value);
      } else {
        rows = listRecords.all(collection);
      }
      const records = rows.map((row) => {
        const value = JSON.parse(row.value_json);
        // 原始请求与响应只在用户显式打开日志时按消息 id 获取，避免长会话重复传输大字段。
        if (collection === 'messages') {
          value.rawLogAvailable = Boolean(value.rawRequestBody || value.rawResponseBody);
          value.rawRequestBody = null;
          value.rawResponseBody = null;
        }
        return { key: row.record_key, value, updatedAt: row.updated_at };
      });
      json(res, 200, { ok: true, records });
      return;
    }
    if (pathname === '/records/get') {
      if (!validKey(body.key)) {
        json(res, 400, { ok: false, message: 'Invalid record key' });
        return;
      }
      const record = getRecord.get(collection, body.key);
      json(res, 200, {
        ok: true,
        record: record ? { key: body.key, value: JSON.parse(record.value_json), updatedAt: record.updated_at } : null,
      });
      return;
    }
    if (pathname === '/records/allocate-id') {
      requireWriter(clientId);
      json(res, 200, { ok: true, id: allocateNumericRecordId(collection) });
      return;
    }
    if (pathname === '/records/bulk-update') {
      if (!validBulkUpdates(body.updates)) {
        json(res, 400, { ok: false, message: 'Invalid record updates' });
        return;
      }
      requireWriter(clientId);
      bulkUpdateRecords(collection, body.updates);
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/records/put') {
      if (!validKey(body.key)) {
        json(res, 400, { ok: false, message: 'Invalid record key' });
        return;
      }
      requireWriter(clientId);
      saveRecord(collection, body.key, body.value);
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/records/delete') {
      if (!validKey(body.key)) {
        json(res, 400, { ok: false, message: 'Invalid record key' });
        return;
      }
      requireWriter(clientId);
      deleteRecord.run(collection, body.key);
      json(res, 200, { ok: true });
      return;
    }
    if (pathname === '/records/clear') {
      requireWriter(clientId);
      clearCollection.run(collection);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { ok: false, message: 'Unknown persistence endpoint' });
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    json(res, status, { ok: false, message: error instanceof Error ? error.message : 'Unexpected persistence service error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[persistence-service] listening on 127.0.0.1:${PORT}; data: ${databasePath}`);
});

function shutdown() {
  database.close();
  server.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
