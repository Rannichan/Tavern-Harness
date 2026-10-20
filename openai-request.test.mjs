import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
after(() => vite.close());

const { buildChatRequest } = await vite.ssrLoadModule('/src/core/openai.ts');

const messages = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'hello' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'character_book_ctx_1',
      type: 'function',
      function: { name: 'recall_memory', arguments: '{"keywords":[]}' },
    }],
  },
  { role: 'tool', tool_call_id: 'character_book_ctx_1', content: 'recalled lore' },
  { role: 'assistant', content: 'answer' },
];

function request(overrides = {}) {
  return buildChatRequest({
    model: 'deepseek-flash',
    messages,
    temperature: 0.7,
    topP: 0,
    maxTokens: 0,
    topK: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: 1,
    reasoningEffort: 'auto',
    isThinkingModeEnabled: true,
    streaming: true,
    baseUrl: 'https://api.deepseek.com',
    ...overrides,
  });
}

test('fills empty reasoning_content on every assistant message for DeepSeek thinking mode', () => {
  const built = request();
  const assistants = built.messages.filter((message) => message.role === 'assistant');
  assert.equal(assistants.length, 2);
  for (const message of assistants) assert.equal(message.reasoning_content, '');
  assert.equal('reasoning_content' in built.messages.find((message) => message.role === 'user'), false);
  assert.equal('reasoning_content' in built.messages.find((message) => message.role === 'tool'), false);
  assert.deepEqual(built.thinking, { type: 'enabled' });
  assert.equal(built.enable_thinking, undefined);
});

test('preserves existing reasoning_content', () => {
  const built = request({
    messages: [{ role: 'assistant', content: 'answer', reasoning_content: 'original reasoning' }],
  });
  assert.equal(built.messages[0].reasoning_content, 'original reasoning');
});

test('maps app reasoning levels to DeepSeek reasoning_effort', () => {
  for (const [effort, wire] of Object.entries({ low: 'low', medium: 'high', xhigh: 'max' })) {
    const built = request({ reasoningEffort: effort });
    assert.deepEqual(built.thinking, { type: 'enabled' });
    assert.equal(built.reasoning_effort, wire);
  }
  // auto: 交给服务端默认值（high），不显式发送 reasoning_effort。
  const auto = request({ reasoningEffort: 'auto' });
  assert.deepEqual(auto.thinking, { type: 'enabled' });
  assert.equal(auto.reasoning_effort, undefined);
});

test('uses the new DeepSeek fields when the official host is behind a proxy', () => {
  const built = request({
    model: 'deepseek-flash',
    baseUrl: 'http://localhost:5174/api/https/api.deepseek.com',
  });
  assert.deepEqual(built.thinking, { type: 'enabled' });
});

test('keeps enable_thinking for DeepSeek models hosted by other providers', () => {
  const built = request({
    model: 'deepseek-ai/DeepSeek-V3',
    baseUrl: 'https://api.siliconflow.cn/v1',
  });
  assert.equal(built.thinking, undefined);
  assert.equal(built.enable_thinking, true);
  assert.equal(built.reasoning_effort, undefined);
});

test('does not add reasoning_content for non-DeepSeek providers', () => {
  const built = request({
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  });
  assert.equal(built.messages.some((message) => 'reasoning_content' in message), false);
  assert.equal(built.thinking, undefined);
});

test('does not add reasoning_content when thinking mode is off', () => {
  const built = request({ reasoningEffort: 'off' });
  assert.equal(built.messages.some((message) => 'reasoning_content' in message), false);
  assert.deepEqual(built.thinking, { type: 'disabled' });
  assert.equal(built.reasoning_effort, undefined);
  assert.equal(built.enable_thinking, undefined);
});
