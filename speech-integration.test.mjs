import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'tavern-speech-test-'));
const port = 24000 + Math.floor(Math.random() * 10000);
const serviceToken = `speech-test-${process.pid}`;
const server = spawn(process.execPath, ['persistence-server.mjs', String(port)], {
  cwd: root, stdio: 'ignore',
  env: { ...process.env, PERSISTENCE_SERVICE_TOKEN: serviceToken, TAVERN_HARNESS_DATA_DIR: dataDir },
});
const originalFetch = globalThis.fetch;
const browserStorage = new Map();
globalThis.localStorage = {
  getItem: (key) => browserStorage.get(key) ?? null,
  setItem: (key, value) => browserStorage.set(key, String(value)),
  removeItem: (key) => browserStorage.delete(key),
};
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, querySelector: () => null };
globalThis.window = {
  location: { origin: 'http://localhost:5173' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  setInterval, clearInterval, setTimeout, clearTimeout,
};

for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await originalFetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Persistence-Service-Token': serviceToken } });
    if (response.ok) break;
  } catch { /* Server is starting. */ }
  await new Promise((resolve) => setTimeout(resolve, 25));
  if (attempt === 99) throw new Error('Persistence service did not start');
}

const calls = { replies: 0, decisions: 0, syntheses: 0 };
let shouldSpeak = false;
let holdSynthesis = false;
let synthesisStarted;
let notifySynthesisStarted;
const reply = '她轻声说：“永远不要忘记我。”';
const line = '永远不要忘记我。';
const stream = (content) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.startsWith('/api-v3/')) {
    return originalFetch(`http://127.0.0.1:${port}${target.slice('/api-v3'.length)}`, {
      ...options, headers: { ...options.headers, 'X-Persistence-Service-Token': serviceToken },
    });
  }
  if (target === '/api-v2/session_create') return Response.json({ ok: true });
  if (target.includes('/chat/completions')) {
    const body = JSON.parse(options.body);
    if (body.messages?.[0]?.content?.includes('selective dialogue voice director')) {
      calls.decisions++;
      return stream(JSON.stringify({ speak: shouldSpeak, text: shouldSpeak ? line : '' }));
    }
    calls.replies++;
    return stream(reply);
  }
  if (target.includes('/api/v1/services/audio/tts/SpeechSynthesizer')) {
    calls.syntheses++;
    assert.equal(options.headers.Authorization, 'Bearer sk-sp-example');
    assert.equal(JSON.parse(options.body).input.text, line);
    if (holdSynthesis) {
      notifySynthesisStarted();
      return new Promise((_resolve, reject) => {
        if (options.signal.aborted) reject(new DOMException('aborted', 'AbortError'));
        else options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    }
    return Response.json({ output: { audio: { url: 'https://audio.example.test/clip.mp3?signature=example' } } });
  }
  if (target.startsWith('https://audio.example.test/')) {
    assert.equal(options.headers, undefined);
    return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

const vite = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false } });
const { db, initDatabase, DEFAULT_SETTINGS } = await vite.ssrLoadModule('/src/db/database.ts');
const { useStore, createSession } = await vite.ssrLoadModule('/src/store/store.ts');
await initDatabase();
const providerId = await db.providers.add({
  name: 'Token Plan', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-sp-example',
  isEnabled: true, cachedModelsCsv: 'qwen3.8-flash', cachedSpeechModelsCsv: 'qwen-audio-3.0-tts-plus', createdAt: Date.now(),
});
const settings = {
  ...DEFAULT_SETTINGS, defaultProviderId: providerId, defaultModel: 'qwen3.8-flash',
  speechEnabled: false, speechProviderId: providerId, speechModel: 'qwen-audio-3.0-tts-plus', speechVoice: 'longanlingxin', speechAutoPlay: false,
};
await db.settings.put(settings);
const provider = await db.providers.get(providerId);
useStore.setState({ settings, providers: [provider], activeView: 'chat' });
const sessionId = await createSession('STANDARD', { enableGreeting: false });
useStore.setState({ activeSessionId: sessionId });

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

after(async () => {
  await useStore.getState().setSettings({ speechEnabled: false });
  db.close();
  await vite.close();
  globalThis.fetch = originalFetch;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test('voice is opt-in; decisions, saved audio, edits, and cancellation follow the real conversation flow', async () => {
  await useStore.getState().sendMessage('普通对话');
  assert.equal(calls.replies, 1);
  assert.equal(calls.decisions, 0);
  assert.equal(calls.syntheses, 0);

  shouldSpeak = true;
  await useStore.getState().setSettings({ speechEnabled: true });
  await useStore.getState().sendMessage('重要的告别');
  await waitFor(() => useStore.getState().messages[sessionId]?.some((message) => message.speechAudio), 'speech did not finish');
  const voiced = useStore.getState().messages[sessionId].find((message) => message.speechAudio);
  assert.equal(voiced.speechAudio.text, line);
  assert.equal(voiced.speechAudio.dataUrl, 'data:audio/mpeg;base64,AQID');
  assert.equal((await db.messages.get(voiced.id)).speechAudio.text, line);
  assert.equal(calls.decisions, 1);
  assert.equal(calls.syntheses, 1);

  await useStore.getState().saveMessageOnly(voiced.id, '这句话被修改了。', sessionId);
  assert.equal((await db.messages.get(voiced.id)).speechAudio, null, 'edited messages must not retain mismatched audio');

  shouldSpeak = false;
  await useStore.getState().sendMessage('普通的下一句');
  await waitFor(() => calls.decisions === 2, 'ordinary reply was not evaluated');
  assert.equal(calls.syntheses, 1, 'a negative decision must not call TTS');

  shouldSpeak = true;
  holdSynthesis = true;
  synthesisStarted = new Promise((resolve) => { notifySynthesisStarted = resolve; });
  await useStore.getState().sendMessage('再一次告别');
  await synthesisStarted;
  const latest = (await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp')).filter((message) => message.role === 'assistant').at(-1);
  await useStore.getState().saveMessageOnly(latest.id, '已修改的回复', sessionId);
  assert.equal((await db.messages.get(latest.id)).speechAudio ?? null, null);
  assert.equal(useStore.getState().speechPendingMessageIds[latest.id], undefined);

  synthesisStarted = new Promise((resolve) => { notifySynthesisStarted = resolve; });
  await useStore.getState().sendMessage('最后的告别');
  await synthesisStarted;
  const pendingMessage = (await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp')).filter((message) => message.role === 'assistant').at(-1);
  await useStore.getState().setSettings({ speechEnabled: false });
  assert.equal((await db.messages.get(pendingMessage.id)).speechAudio ?? null, null, 'turning speech off cancels in-flight synthesis');
  assert.equal(useStore.getState().speechPendingMessageIds[pendingMessage.id], undefined);
  await useStore.getState().setSettings({ speechEnabled: true });
  holdSynthesis = false;
  const keeper = (await db.npcs.toArray()).find((npc) => npc.isTavernKeeper);
  const secondNpcId = await db.npcs.add({ ...keeper, id: undefined, name: 'Second character', isBuiltIn: false, isTavernKeeper: false });
  const groupId = await createSession('GROUP', { npcIds: [keeper.id, secondNpcId], enableGreeting: false });
  useStore.setState({ activeSessionId: groupId });
  const beforeGroup = calls.syntheses;
  await useStore.getState().sendMessage('大家说点重要的话');
  await waitFor(() => (useStore.getState().messages[groupId] ?? []).filter((message) => message.speechAudio).length === 2, 'group speech did not finish');
  const groupVoices = useStore.getState().messages[groupId].filter((message) => message.speechAudio);
  assert.equal(calls.syntheses, beforeGroup + 2);
  assert.equal(new Set(groupVoices.map((message) => message.speakerParticipantId)).size, 2, 'each character keeps their own audio');

  let exportedText = '';
  window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async (content) => { exportedText = content; }, close: async () => {} }) });
  const { exportGameplay, importGameplay } = await vite.ssrLoadModule('/src/core/gameplay.ts');
  assert.equal(await exportGameplay({ sessionId: groupId, includeHistory: true }), 'saved');
  const payload = JSON.parse(exportedText);
  assert.equal(payload.messages.filter((message) => message.speechAudio).length, 2);
  const imported = await importGameplay(payload);
  const restored = await db.messages.where('sessionId').equals(imported.sessionId).toArray();
  assert.equal(restored.filter((message) => message.speechAudio?.dataUrl === 'data:audio/mpeg;base64,AQID').length, 2, 'export and import retain replayable audio');
});
