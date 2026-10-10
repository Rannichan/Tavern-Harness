import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Exercise the real store, IndexedDB settings, turn loop and Shell approval path.
// Model and command-service responses are deterministic; no API key is needed.
globalThis.crypto ??= webcrypto;
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {} } },
};
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class extends Event {
    constructor(type, options) {
      super(type, options);
      this.detail = options?.detail;
    }
  };
}

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
});
const originalFetch = globalThis.fetch;
let db;
let useStore;
let unsubscribe;
let modelSteps = [];
const confirmations = [];
const shellApprovals = [];
const shellExecutions = [];
const tickets = new Map();
let ticketSequence = 0;
let scenarios = 0;

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

function toolResponse(name, args) {
  return {
    tool_calls: [{ index: 0, id: `call-${++ticketSequence}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }],
  };
}

async function finish(turn) {
  let timer;
  try {
    await Promise.race([turn, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Conversation did not finish')), 3000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForConfirmation() {
  if (useStore.getState().pendingConfirmation) return useStore.getState().pendingConfirmation;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error('Expected a confirmation request'));
    }, 3000);
    const stop = useStore.subscribe((state) => {
      if (state.pendingConfirmation) {
        clearTimeout(timer);
        stop();
        resolve(state.pendingConfirmation);
      }
    });
  });
}

function startConversation(...steps) {
  assert.equal(useStore.getState().streaming.sessionId, null);
  confirmations.length = 0;
  modelSteps = steps;
  return useStore.getState().sendMessage('Test tool approval');
}

try {
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options?.body ?? '{}');
    if (String(url).includes('/chat/completions')) {
      let delta = modelSteps.shift() ?? { content: 'Done.' };
      if (typeof delta === 'function') delta = await delta();
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (url === '/api-v2/session_create') return jsonResponse({ ok: true });
    if (url === '/api-v2/exec') {
      if (payload.script === 'echo 1') return jsonResponse({ ok: true, output: '1' });
      if (payload.confirmationRequestId) {
        const ticket = tickets.get(payload.confirmationRequestId);
        assert.ok(ticket?.approved, 'Shell execution must use an approved ticket');
        assert.equal(payload.script, ticket.script);
        assert.equal(payload.session, ticket.session);
        tickets.delete(payload.confirmationRequestId);
        shellExecutions.push(payload);
        return jsonResponse({ ok: true, output: 'v22.0.0' });
      }
      const confirmationRequestId = `ticket-${++ticketSequence}`;
      tickets.set(confirmationRequestId, { ...payload, approved: false });
      return jsonResponse({ needConfirm: true, confirmationRequestId });
    }
    if (url === '/api-v2/approve') {
      const ticket = tickets.get(payload.confirmationRequestId);
      assert.ok(ticket, 'Approval must refer to an existing Shell request');
      ticket.approved = true;
      shellApprovals.push(payload.confirmationRequestId);
      return jsonResponse({ ok: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  ({ db } = await vite.ssrLoadModule('/src/db/database.ts'));
  const { initDatabase } = await vite.ssrLoadModule('/src/db/database.ts');
  ({ useStore } = await vite.ssrLoadModule('/src/store/store.ts'));
  const { createSession } = await vite.ssrLoadModule('/src/store/store.ts');
  const { MAX_IDENTICAL_TOOL_CALLS } = await vite.ssrLoadModule('/src/core/toolDefinitions.ts');
  globalThis.window = {
    location: { origin: 'http://localhost:5173' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };

  await initDatabase();
  assert.equal((await db.settings.get(1)).yoloMode, false, 'New installations must require approval');
  const legacy = { ...await db.settings.get(1) };
  delete legacy.yoloMode;
  await db.settings.put(legacy);
  await initDatabase();
  assert.equal((await db.settings.get(1)).yoloMode, false, 'Existing installations must remain opt-in');
  await db.settings.update(1, { yoloMode: true });
  await initDatabase();
  assert.equal((await db.settings.get(1)).yoloMode, true, 'Initialization must preserve an enabled setting');
  await db.settings.update(1, { yoloMode: false });
  scenarios++;

  await useStore.getState().init();
  const providerId = await db.providers.add({
    name: 'Test provider', baseUrl: 'https://model.test/v1/', apiKey: '',
    isEnabled: true, cachedModelsCsv: 'test-model', createdAt: Date.now(),
  });
  await useStore.getState().setSettings({ defaultProviderId: providerId, defaultModel: 'test-model' });
  const keeper = await db.npcs.filter((npc) => npc.isTavernKeeper).first();
  const targetId = await db.npcs.add({ ...keeper, id: undefined, name: 'Approval target',
    prompt: 'Original prompt', isBuiltIn: false, isTavernKeeper: false });
  await db.tools.add({ name: 'test_shell_skill', isBuiltIn: false,
    jsonContent: JSON.stringify({ type: 'function', function: { name: 'test_shell_skill',
      description: 'Test generated Shell skill', parameters: { type: 'object', properties: {} } } }),
    executionJson: JSON.stringify({ type: 'shell', script: 'node --version' }),
    createdAt: Date.now() });
  await db.npcs.update(keeper.id, { enabledToolNames: [...keeper.enabledToolNames, 'test_shell_skill'] });
  const sessionId = await createSession('NPC', { associatedId: keeper.id, enableGreeting: false });
  useStore.setState({ activeSessionId: sessionId });
  unsubscribe = useStore.subscribe((state) => {
    if (state.pendingConfirmation) confirmations.push(state.pendingConfirmation);
  });
  const update = (prompt) => toolResponse('update_character', { name: 'Approval target', prompt });

  // Missing values also fail closed before the database migration has run.
  const missingSetting = { ...useStore.getState().settings };
  delete missingSetting.yoloMode;
  useStore.setState({ settings: missingSetting });
  let turn = startConversation(update('Must be rejected'));
  assert.equal((await waitForConfirmation()).toolName, 'update_character');
  useStore.getState().resolveConfirmation(false);
  await finish(turn);
  assert.equal((await db.npcs.get(targetId)).prompt, 'Original prompt');
  scenarios++;

  await useStore.getState().setSettings({ yoloMode: false });
  turn = startConversation(update('Manually approved'));
  await waitForConfirmation();
  useStore.getState().resolveConfirmation(true);
  await finish(turn);
  assert.equal((await db.npcs.get(targetId)).prompt, 'Manually approved');
  scenarios++;

  // Enabling YOLO also resolves a tool request that is already waiting.
  turn = startConversation(update('Approved after enabling'));
  await waitForConfirmation();
  await useStore.getState().setSettings({ yoloMode: true });
  await finish(turn);
  assert.equal((await db.npcs.get(targetId)).prompt, 'Approved after enabling');
  assert.equal((await db.settings.get(1)).yoloMode, true, 'The setting must persist in IndexedDB');
  scenarios++;

  await finish(startConversation(update('Automatically approved')));
  assert.equal((await db.npcs.get(targetId)).prompt, 'Automatically approved');
  assert.equal(confirmations.length, 0, 'YOLO must not open a tool confirmation');
  scenarios++;

  for (const name of ['run_shell_script', 'test_shell_skill']) {
    const before = shellExecutions.length;
    await finish(startConversation(toolResponse(name, { script: 'node --version' })));
    const results = await db.messages.where('sessionId').equals(sessionId).toArray();
    assert.equal(confirmations.length, 0, `${name} must be approved without a dialog`);
    assert.equal(shellExecutions.length, before + 1,
      `${name} must execute exactly once: ${results.filter((message) => message.role === 'tool').at(-1)?.content}`);
    assert.equal(shellApprovals.length, shellExecutions.length, 'Shell approval must use the normal approval endpoint');
    assert.ok(results.some((message) => message.role === 'tool' && message.content === 'v22.0.0'));
    scenarios++;
  }

  // Check the live setting on each tool call, including within the same turn.
  turn = startConversation(update('First tool approved'), async () => {
    await useStore.getState().setSettings({ yoloMode: false });
    return update('Second tool must be rejected');
  });
  await waitForConfirmation();
  useStore.getState().resolveConfirmation(false);
  await finish(turn);
  assert.equal((await db.npcs.get(targetId)).prompt, 'First tool approved');
  assert.equal((await db.settings.get(1)).yoloMode, false);
  scenarios++;

  const before = shellApprovals.length;
  turn = startConversation(toolResponse('run_shell_script', { script: 'node --version' }));
  assert.equal((await waitForConfirmation()).toolName, 'run_shell_script');
  useStore.getState().resolveConfirmation(false);
  await finish(turn);
  assert.equal(shellApprovals.length, before, 'Rejected Shell requests must not be approved');
  scenarios++;

  await useStore.getState().setSettings({ yoloMode: true });
  turn = startConversation(...Array.from({ length: MAX_IDENTICAL_TOOL_CALLS + 1 }, () => update('Repeated tool')));
  assert.equal((await waitForConfirmation()).kind, 'limit', 'YOLO must retain Agent execution limits');
  await useStore.getState().setSettings({ yoloMode: true });
  assert.equal(useStore.getState().pendingConfirmation?.kind, 'limit', 'Settings updates must not approve a limit request');
  useStore.getState().resolveConfirmation(false);
  await finish(turn);
  scenarios++;

  console.log(`YOLO mode integration tests passed (${scenarios} scenarios)`);
} finally {
  useStore?.getState().resolveConfirmation(false);
  useStore?.getState().stopStreaming();
  unsubscribe?.();
  db?.close();
  globalThis.fetch = originalFetch;
  await vite.close();
}
