import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Exercise the real streaming parser, executor and conversation loop. File-service
// requests are recorded so corrupted or incomplete arguments cannot hide a write.
globalThis.crypto ??= webcrypto;
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } } };
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class extends Event {
    constructor(type, options) { super(type, options); this.detail = options?.detail; }
  };
}

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
const originalFetch = globalThis.fetch;
const files = new Map();
const writes = [];
const modelRequests = [];
let responses = [];
let networkChunkSize = 17;
let db;
let useStore;
let scenarios = 0;

function packet(toolCalls, finishReason = null) {
  return { choices: [{ delta: { tool_calls: toolCalls }, finish_reason: finishReason }] };
}
function toolDelta(name, args, index = 0) {
  return { index, ...(name ? { id: `call-${index}`, type: 'function' } : {}),
    function: { ...(name ? { name } : {}), arguments: args } };
}
function sse(packets, { tail = '\n\ndata: [DONE]\n\n', newline = '\n' } = {}) {
  return packets.map((p) => `data: ${JSON.stringify(p)}`).join(newline + newline) + tail;
}
function toolStream(name, parts, options) {
  return sse(parts.map((args, index) => packet([toolDelta(index === 0 ? name : '', args)])), options);
}
function jsonResponse(body) { return new Response(JSON.stringify(body)); }
async function check(name, run) {
  try { await run(); scenarios++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
async function finish(turn) {
  let timer;
  try {
    await Promise.race([turn, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Conversation did not finish')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options?.body ?? '{}');
    if (String(url).includes('/chat/completions')) {
      modelRequests.push(payload);
      const body = responses.shift();
      assert.equal(typeof body, 'string', 'Every model response must be specified');
      const bytes = new TextEncoder().encode(body);
      let offset = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) { controller.close(); return; }
          controller.enqueue(bytes.slice(offset, offset + networkChunkSize));
          offset += networkChunkSize;
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url === '/api-v2/session_create') return jsonResponse({ ok: true });
    if (url === '/api-v2/file_list') return jsonResponse({ ok: true, files: [] });
    const key = `${payload.session}/${payload.path}`;
    if (url === '/api-v2/file_write') {
      writes.push(payload);
      files.set(key, (payload.mode === 'append' ? files.get(key) ?? '' : '') + payload.content);
      return jsonResponse({ ok: true });
    }
    if (url === '/api-v2/file_read') return jsonResponse(files.has(key)
      ? { ok: true, content: files.get(key) } : { ok: false, message: 'File not found' });
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const { streamChatCompletions, buildChatRequest } = await vite.ssrLoadModule('/src/core/openai.ts');
  const { parseToolArguments } = await vite.ssrLoadModule('/src/core/toolArguments.ts');
  ({ db } = await vite.ssrLoadModule('/src/db/database.ts'));
  const { initDatabase } = await vite.ssrLoadModule('/src/db/database.ts');
  const { executeToolCall } = await vite.ssrLoadModule('/src/core/tools/toolExecutor.ts');
  const { createSession } = await vite.ssrLoadModule('/src/store/store.ts');
  ({ useStore } = await vite.ssrLoadModule('/src/store/store.ts'));
  const { setLanguage } = await vite.ssrLoadModule('/src/core/i18n.ts');
  globalThis.window = { location: { origin: 'http://localhost:5173' },
    matchMedia: () => ({ matches: false, addEventListener() {} }) };
  await initDatabase();
  await useStore.getState().init();
  setLanguage('en');

  const providerId = await db.providers.add({ name: 'Test provider', baseUrl: 'https://model.test/v1/',
    apiKey: '', isEnabled: true, cachedModelsCsv: 'test-model', createdAt: Date.now() });
  await useStore.getState().setSettings({ defaultProviderId: providerId, defaultModel: 'test-model' });
  const keeper = await db.npcs.filter((npc) => npc.isTavernKeeper).first();
  const sessionId = await createSession('NPC', { associatedId: keeper.id, enableGreeting: false });
  useStore.setState({ activeSessionId: sessionId });
  const context = { sessionId, npcId: keeper.id, requestConfirmation: async () => true };
  const request = { model: 'test-model', messages: [], temperature: 1, stream: true };
  async function collect(body, { allowError = false } = {}) {
    responses = [body];
    const chunks = [];
    await streamChatCompletions('https://model.test/v1', '', request, (chunk) => chunks.push(chunk));
    if (!allowError) assert.deepEqual(chunks.filter((c) => c.type === 'error'), []);
    return chunks;
  }
  const finalCall = (chunks, id = 'call-0') => chunks.filter((c) => c.type === 'tool_call' && c.id === id).at(-1);
  const content = 'function demo() {\n\tconst path = "C:\\temp\\file";\n\treturn { value: "中文🙂", literal: "\\n" };\n}\n```json\n{}\n```';
  const fileArgs = JSON.stringify({ path: 'demo.js', content });

  await check('Repeated braces, escapes and Unicode in file_write deltas', async () => {
    networkChunkSize = 1;
    const call = finalCall(await collect(toolStream('file_write', [...fileArgs])));
    assert.equal(call.argJson, fileArgs);
    assert.doesNotMatch(await executeToolCall(call.name, call.argJson, context), /^ERROR:/);
    assert.equal(writes.at(-1).content, content);
    networkChunkSize = 17;
  });

  const skillArgs = { name: 'test_json_writer', description: 'Test JSON argument handling',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'], additionalProperties: false },
    execution: { type: 'file_write', path: '{{path}}', content: '{{content}}' } };
  await check('Nested create_skill arguments remain valid and create a working skill', async () => {
    const argsJson = JSON.stringify(skillArgs);
    const call = finalCall(await collect(toolStream('create_skill', [...argsJson])));
    assert.equal(call.argJson, argsJson);
    assert.doesNotMatch(await executeToolCall(call.name, call.argJson, context), /^ERROR:/);
    assert.deepEqual(JSON.parse((await db.tools.where('name').equals(skillArgs.name).first()).executionJson), skillArgs.execution);
  });

  await check('Cumulative snapshots and repeated complete snapshots remain compatible', async () => {
    const parts = Array.from({ length: Math.ceil(fileArgs.length / 5) }, (_, i) => fileArgs.slice(0, (i + 1) * 5));
    parts.push(fileArgs, fileArgs);
    const call = finalCall(await collect(toolStream('file_write', parts)));
    assert.equal(call.argJson, fileArgs);
  });

  await check('Final SSE data line without newline is consumed', async () => {
    const call = finalCall(await collect(toolStream('file_write', [fileArgs.slice(0, -2), fileArgs.slice(-2)], { tail: '' })));
    assert.equal(call.argJson, fileArgs);
    assert.doesNotMatch(await executeToolCall(call.name, call.argJson, context), /^ERROR:/);
    assert.equal(writes.at(-1).content, content);
  });

  await check('Parallel tool-call indexes and CRLF network boundaries stay separate', async () => {
    const second = JSON.stringify({ path: 'second.txt', content: '{repeat} {repeat}' });
    const chunks = await collect(sse([
      packet([toolDelta('file_write', fileArgs.slice(0, 10)), toolDelta('file_write', second.slice(0, 10), 1)]),
      packet([toolDelta('', fileArgs.slice(10)), toolDelta('', second.slice(10), 1)]),
      { choices: [{ finish_reason: 'tool_calls' }] },
    ], { newline: '\r\n', tail: '\r\n\r\ndata: [DONE]\r\n\r\n' }));
    assert.equal(finalCall(chunks).argJson, fileArgs);
    assert.equal(finalCall(chunks, 'call-1').argJson, second);
    assert.equal(chunks.filter((c) => c.type === 'done').length, 1);
  });

  await check('DONE ends the stream without consuming later data', async () => {
    const chunks = await collect(toolStream('file_write', [fileArgs]) + toolStream('file_write', ['invalid tail']));
    assert.equal(finalCall(chunks).argJson, fileArgs);
  });

  await check('Large file content survives repeated fragment boundaries', async () => {
    const largeContent = 'if (true) { console.log("中文🙂\\n"); }\n'.repeat(1800);
    const json = JSON.stringify({ path: 'large.js', content: largeContent });
    const parts = json.match(/.{1,127}/gs);
    const call = finalCall(await collect(toolStream('file_write', parts)));
    assert.equal(call.argJson, json);
    assert.doesNotMatch(await executeToolCall(call.name, call.argJson, context), /^ERROR:/);
    assert.equal(writes.at(-1).content, largeContent);
  });

  await check('Literal string control characters preserve exact native and generated file bytes', async () => {
    const text = 'line1\r\n\tline2\u0000 end';
    const invalid = `{"path":"controls.txt","content":"${text}"}`;
    const call = finalCall(await collect(toolStream('file_write', [invalid])));
    assert.deepEqual(JSON.parse(call.argJson), { path: 'controls.txt', content: text });
    for (const name of ['file_write', skillArgs.name]) {
      assert.doesNotMatch(await executeToolCall(name, invalid, context), /^ERROR:/);
      assert.equal(writes.at(-1).content, text);
    }
    const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
    assert.equal(parseToolArguments(`{"content":"${controls}"}`).args.content, controls);
  });

  await check('Only complete outer JSON fences are unwrapped', async () => {
    const fenced = '```json\n' + fileArgs + '\n```';
    const call = finalCall(await collect(toolStream('file_write', [fenced])));
    assert.equal(call.argJson, fileArgs);
    assert.equal(parseToolArguments(fileArgs).json, fileArgs);
    assert.equal(parseToolArguments(fenced).args.content, content);
  });

  await check('Malformed or truncated arguments never reach the file service', async () => {
    const count = writes.length;
    for (const invalid of [fileArgs.slice(0, -1), '{"path":"x","content":"unclosed',
      '{"path":"x","content":"quote " broken"}', '{"path":"x","content":"bad\\q"}',
      '{"path":"x","content":"unfinished\\\n"}', '```json\n' + fileArgs, fileArgs + ' trailing']) {
      assert.match(await executeToolCall('file_write', invalid, context), /^ERROR: Tool arguments are not valid JSON\./);
    }
    assert.equal(writes.length, count);
  });

  await check('Non-object JSON is rejected before any tool executes', async () => {
    const count = writes.length;
    for (const invalid of ['null', '[]', '123', '"text"', 'true']) {
      assert.match(await executeToolCall('file_write', invalid, context), /^ERROR: Tool arguments must be a JSON object/);
    }
    assert.equal(writes.length, count);
    assert.deepEqual(parseToolArguments('').args, {});
  });

  await check('file_edit preserves exact code in old_text and new_text', async () => {
    const newText = 'const value = { name: "替换🙂", path: "C:\\tmp" };\n';
    const json = JSON.stringify({ path: 'demo.js', old_text: content, new_text: newText });
    const call = finalCall(await collect(toolStream('file_edit', [...json])));
    assert.equal(call.argJson, json);
    assert.doesNotMatch(await executeToolCall(call.name, call.argJson, context), /^ERROR:/);
    assert.equal(writes.at(-1).content, newText);
  });

  await check('Harness instructions apply to generated and native tools without mutating history', async () => {
    const messages = [{ role: 'system', content: 'Character prompt' }, { role: 'user', content: 'Write a file' }];
    const options = { model: 'test', messages, temperature: 1, topP: 1, maxTokens: 0, topK: 0,
      frequencyPenalty: 0, presencePenalty: 0, repetitionPenalty: 1, reasoningEffort: 'auto',
      isThinkingModeEnabled: true, streaming: true, baseUrl: 'https://model.test/v1' };
    const tool = JSON.parse((await db.tools.where('name').equals(skillArgs.name).first()).jsonContent);
    const withTools = buildChatRequest({ ...options, tools: [tool] });
    assert.match(withTools.messages[0].content, /complete JSON object/);
    assert.equal(messages[0].content, 'Character prompt');
    assert.equal(withTools.messages.filter((m) => m.role === 'system').length, 1);
    assert.equal(buildChatRequest(options).messages, messages);
    assert.equal(buildChatRequest({ ...options, messages: messages.slice(1), tools: [tool] }).messages[0].role, 'system');
  });

  await check('Conversation persists repaired JSON and executes native/generated writes exactly', async () => {
    await db.npcs.update(keeper.id, { enabledToolNames: [...keeper.enabledToolNames, skillArgs.name] });
    const text = 'Generated file\n\t{body}\r\n';
    for (const name of ['file_write', skillArgs.name]) {
      responses = [toolStream(name, [`{"path":"conversation.txt","content":"${text}"}`]),
        sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }])];
      const count = writes.length;
      await finish(useStore.getState().sendMessage('Write a file'));
      assert.equal(writes.length, count + 1);
      assert.equal(writes.at(-1).content, text);
      const call = modelRequests.at(-1).messages.findLast((m) => m.tool_calls)?.tool_calls[0];
      assert.equal(JSON.parse(call.function.arguments).content, text);
      assert.match(modelRequests.at(-1).messages[0].content, /complete JSON object/);
    }
  });

  await check('Token limits and filtering prevent writes and show actionable diagnostics', async () => {
    for (const reason of ['length', 'content_filter']) {
      // A complete first call must also be withheld when a later call is truncated.
      for (const calls of [[toolDelta('file_write', fileArgs.slice(0, -2))],
        [toolDelta('file_write', fileArgs), toolDelta('file_write', fileArgs.slice(0, -2), 1)]]) {
        const body = sse([packet(calls), { choices: [{ finish_reason: reason }] }]);
        const chunks = await collect(body, { allowError: true });
        assert.match(chunks.find((c) => c.type === 'error').message, /tools were not executed/);
        const count = writes.length;
        responses = [body];
        await finish(useStore.getState().sendMessage('Write a large file'));
        assert.equal(writes.length, count);
        assert.match(useStore.getState().toasts.at(-1).message, /tools were not executed/);
      }
    }
  });

  process.stdout.write(`Tool argument integration tests passed (${scenarios} scenarios)\n`);
} finally {
  useStore?.getState().stopStreaming();
  globalThis.fetch = originalFetch;
  if (db) await db.delete();
  await vite.close();
}
