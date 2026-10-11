import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Load the real stream parser with existing dependencies; no browser, database
// or model service is needed. Only the fetch response is simulated.
const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await vite.close(); });
const { streamChatCompletions } = await vite.ssrLoadModule('/src/core/openai.ts');

function packet(toolCalls) {
  return { choices: [{ delta: { tool_calls: toolCalls } }] };
}
function toolDelta(name, args, index = 0) {
  return { index, ...(name ? { id: `call-${index}`, type: 'function' } : {}),
    function: { ...(name ? { name } : {}), arguments: args } };
}
function sse(packets, { tail = '\n\ndata: [DONE]\n\n', newline = '\n' } = {}) {
  return packets.map((p) => `data: ${JSON.stringify(p)}`).join(newline + newline) + tail;
}
function toolPackets(name, parts) {
  return parts.map((args, index) => packet([toolDelta(index === 0 ? name : '', args)]));
}
async function collect(body, chunkSize = 17) {
  globalThis.fetch = async () => {
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const chunks = [];
  await streamChatCompletions('https://model.test/v1', '',
    { model: 'test-model', messages: [], temperature: 1, stream: true },
    (chunk) => chunks.push(chunk));
  assert.deepEqual(chunks.filter((c) => c.type === 'error'), []);
  assert.equal(chunks.filter((c) => c.type === 'done').length, 1);
  return chunks;
}
const finalCall = (chunks, id = 'call-0') => chunks.filter((c) => c.type === 'tool_call' && c.id === id).at(-1);
const content = 'function demo() {\n\treturn { path: "C:\\temp", text: "中文🙂", literal: "\\n" };\n}';
const fileArgs = JSON.stringify({ path: 'demo.js', content });

test('nested object deltas keep repeated opening braces', async () => {
  const parts = ['{', '"parameters":', '{', '"type":"object"}}'];
  const call = finalCall(await collect(sse(toolPackets('create_skill', parts))));
  assert.equal(call.argJson, parts.join(''));
  assert.deepEqual(JSON.parse(call.argJson), { parameters: { type: 'object' } });
});

test('file argument deltas preserve escapes and Unicode across single-byte reads', async () => {
  const call = finalCall(await collect(sse(toolPackets('file_write', [...fileArgs])), 1));
  assert.equal(call.argJson, fileArgs);
  assert.equal(JSON.parse(call.argJson).content, content);
});

test('valid delta JSON takes precedence over a different valid snapshot', async () => {
  const parts = [' ', ' {"value":1}'];
  const call = finalCall(await collect(sse(toolPackets('example', parts))));
  assert.equal(call.argJson, parts.join(''));
});

for (const finish of ['tool_calls', 'eof']) {
  test(`growing and repeated snapshots fall back at ${finish}`, async () => {
    const parts = ['{', '{"path":', fileArgs, fileArgs];
    const packets = toolPackets('file_write', parts);
    if (finish === 'tool_calls') packets.push(
      { choices: [{ finish_reason: 'tool_calls' }] },
      { choices: [{ delta: { content: 'after tools' } }] },
    );
    const chunks = await collect(sse(packets, { tail: '' }));
    assert.equal(finalCall(chunks).argJson, fileArgs);
    assert.equal(chunks.filter((c) => c.type === 'tool_call' && c.argJson === fileArgs).length, 1);
    if (finish === 'tool_calls') {
      assert.ok(chunks.indexOf(finalCall(chunks)) < chunks.findIndex((c) => c.type === 'content'));
    }
  });
}

test('non-growing fragments cannot repair invalid delta JSON via snapshot fallback', async () => {
  const parts = ['{', '{"path":', '"x"}'];
  const call = finalCall(await collect(sse(toolPackets('file_write', parts))));
  assert.equal(call.argJson, parts.join(''));
});

test('snapshot fallback requires a complete JSON object', async () => {
  for (const parts of [['{', '{"path":'], ['[', '[1]'], ['n', 'null'], ['1', '1e2'], ['"', '"text"']]) {
    const call = finalCall(await collect(sse(toolPackets('example', parts))));
    assert.equal(call.argJson, parts.join(''));
  }
});

test('JSON arguments are passed through without repair or normalization', async () => {
  for (const args of ['```json\n{"x":1}\n```', '{"x":"line\nbreak"}', '{"x":', 'null', '[]']) {
    const call = finalCall(await collect(sse(toolPackets('example', [args]))));
    assert.equal(call.argJson, args);
  }
});

test('final tool argument data line is read without a trailing newline', async () => {
  const packets = toolPackets('file_write', [fileArgs.slice(0, -2), fileArgs.slice(-2)]);
  assert.equal(finalCall(await collect(sse(packets, { tail: '' }))).argJson, fileArgs);
});

test('final content and usage data line is read without a trailing newline', async () => {
  const chunks = await collect(sse([{ choices: [{ delta: { content: '最后🙂' } }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }], { tail: '' }), 1);
  assert.equal(chunks.find((c) => c.type === 'content').text, '最后🙂');
  assert.deepEqual(chunks.find((c) => c.type === 'usage'), { type: 'usage', prompt: 2, completion: 3, total: 5 });
});

test('parallel tool calls stay separate across CRLF and network boundaries', async () => {
  const second = JSON.stringify({ path: 'second.txt', content: '{repeat} {repeat}' });
  const chunks = await collect(sse([
    packet([toolDelta('file_write', fileArgs.slice(0, 10)), toolDelta('file_write', second.slice(0, 10), 1)]),
    packet([toolDelta('', fileArgs.slice(10)), toolDelta('', second.slice(10), 1)]),
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ], { newline: '\r\n', tail: '\r\n\r\ndata: [DONE]' }), 1);
  assert.equal(finalCall(chunks).argJson, fileArgs);
  assert.equal(finalCall(chunks, 'call-1').argJson, second);
});

test('large file content survives repeated fragment boundaries', async () => {
  const largeContent = content.repeat(1000);
  const json = JSON.stringify({ path: 'large.js', content: largeContent });
  const call = finalCall(await collect(sse(toolPackets('file_write', json.match(/.{1,127}/gs)))));
  assert.equal(call.argJson, json);
  assert.equal(JSON.parse(call.argJson).content, largeContent);
});
