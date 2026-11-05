import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true },
});
after(() => vite.close());

const { BAILIAN_TOKEN_PLAN_BASE_URL, BAILIAN_TOKEN_PLAN_MODELS, createBailianTokenPlanProvider, isBailianTokenPlanUrl } =
  await vite.ssrLoadModule('/src/core/bailianTokenPlan.ts');
const { buildChatRequest, streamChatCompletions } = await vite.ssrLoadModule('/src/core/openai.ts');
const { fetchModelsSmart } = await vite.ssrLoadModule('/src/core/providerModels.ts');

function request(overrides = {}) {
  return buildChatRequest({
    model: 'qwen3.8-flash',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 1,
    topP: 0.95,
    maxTokens: 0,
    topK: 20,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: 1,
    reasoningEffort: 'auto',
    isThinkingModeEnabled: true,
    streaming: true,
    baseUrl: BAILIAN_TOKEN_PLAN_BASE_URL,
    ...overrides,
  });
}

test('personal plan preset has a dedicated endpoint, no key, and an enabled chat model', () => {
  const provider = createBailianTokenPlanProvider();
  assert.equal(provider.baseUrl, BAILIAN_TOKEN_PLAN_BASE_URL);
  assert.equal(provider.apiKey, '');
  assert.equal(provider.isEnabled, true);
  assert.deepEqual(JSON.parse(provider.enabledModelIdsJson), ['qwen3.8-flash']);
  const models = provider.cachedModelsCsv.split(',');
  assert.deepEqual(models, [...BAILIAN_TOKEN_PLAN_MODELS]);
  assert.equal(new Set(models).size, models.length);
  assert.equal(JSON.parse(provider.modelAliasesJson)['qwen3.8-flash'], 'Token Plan · qwen3.8-flash');
});

test('detects the official endpoint and the app proxy without matching other hosts', () => {
  assert.equal(isBailianTokenPlanUrl(`${BAILIAN_TOKEN_PLAN_BASE_URL}/`), true);
  assert.equal(isBailianTokenPlanUrl('http://localhost:5173/api/https/token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'), true);
  assert.equal(isBailianTokenPlanUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'), false);
  assert.equal(isBailianTokenPlanUrl('https://token-plan.cn-beijing.maas.aliyuncs.com.example.com/compatible-mode/v1'), false);
  assert.equal(isBailianTokenPlanUrl('http://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'), false);
  assert.equal(isBailianTokenPlanUrl('not a URL'), false);
});

test('Qwen uses Bailian thinking fields and leaves historical thinking out', () => {
  const built = request({ reasoningEffort: 'xhigh' });
  assert.equal(built.enable_thinking, true);
  assert.equal(built.preserve_thinking, false);
  assert.equal(built.reasoning_effort, 'xhigh');
  assert.equal(built.chat_template_kwargs, undefined);
  assert.equal(request({ reasoningEffort: 'off' }).enable_thinking, false);
  assert.equal(request({ model: 'qwen3.7-plus', reasoningEffort: 'medium' }).reasoning_effort, undefined);
});

test('DeepSeek uses Model Studio parameters and excludes unsupported sampling fields', () => {
  const built = request({
    model: 'deepseek-v4-pro', reasoningEffort: 'low',
    frequencyPenalty: 0.5, presencePenalty: 0.5, repetitionPenalty: 1.2,
    messages: [{ role: 'assistant', content: 'Earlier answer' }],
  });
  assert.equal(built.enable_thinking, true);
  assert.equal(built.reasoning_effort, 'high');
  assert.equal(built.thinking, undefined);
  assert.equal(built.top_k, undefined);
  assert.equal(built.repetition_penalty, undefined);
  assert.equal(built.presence_penalty, undefined);
  assert.equal(built.frequency_penalty, undefined);
  assert.equal(built.messages[0].reasoning_content, undefined);
  assert.equal(request({ model: 'deepseek-v4-pro-0813', reasoningEffort: 'low' }).reasoning_effort, 'low');
  assert.equal(request({ model: 'deepseek-v4.1-flash', reasoningEffort: 'off' }).enable_thinking, false);
});

test('GLM tool calls and thinking-only mode use supported parameters', () => {
  const tools = [{ type: 'function', function: { name: 'roll', parameters: { type: 'object' } } }];
  const glm52 = request({ model: 'glm-5.2', tools, reasoningEffort: 'off' });
  assert.equal(glm52.enable_thinking, false);
  assert.equal(glm52.clear_thinking, true);
  assert.equal(glm52.tool_stream, true);
  assert.equal(glm52.tool_choice, 'auto');
  assert.equal(request({ model: 'glm-5.2', streaming: false, tools }).tool_stream, undefined);
  const glm53 = request({ model: 'glm-5.3', reasoningEffort: 'off', repetitionPenalty: 1.2 });
  assert.equal(glm53.enable_thinking, undefined);
  assert.equal(glm53.clear_thinking, true);
  assert.equal(glm53.top_k, undefined);
  assert.equal(glm53.repetition_penalty, undefined);
  assert.equal(request({ model: 'glm-5.3', reasoningEffort: 'medium' }).reasoning_effort, 'high');
});

test('model-list test sends the personal key only to the Token Plan models endpoint', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json({ data: [{ id: 'qwen3.8-max' }, { id: 'qwen3.8-flash' }] });
    };
    const result = await fetchModelsSmart(BAILIAN_TOKEN_PLAN_BASE_URL, 'sk-sp-example');
    assert.deepEqual(result, { models: ['qwen3.8-flash', 'qwen3.8-max'], viaProxy: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BAILIAN_TOKEN_PLAN_BASE_URL}/models`);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-sp-example');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('model-list test preserves authentication errors and falls back on network failure', async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  try {
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return new Response('', { status: 401 });
    };
    await assert.rejects(fetchModelsSmart(BAILIAN_TOKEN_PLAN_BASE_URL, 'sk-sp-example'), /HTTP 401/);
    assert.deepEqual(calls, [`${BAILIAN_TOKEN_PLAN_BASE_URL}/models`]);

    calls.length = 0;
    globalThis.fetch = async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer sk-sp-example');
      if (calls.length === 1) throw new TypeError('Failed to fetch');
      return Response.json({ data: [{ id: 'qwen3.8-flash' }] });
    };
    const result = await fetchModelsSmart(BAILIAN_TOKEN_PLAN_BASE_URL, 'sk-sp-example');
    assert.equal(result.viaProxy, true);
    assert.deepEqual(calls, [
      `${BAILIAN_TOKEN_PLAN_BASE_URL}/models`,
      'http://localhost:5173/api/https/token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models',
    ]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
});

test('streams a Token Plan chat with the supplied key and parses thinking, content, tools, and usage', async () => {
  const oldFetch = globalThis.fetch;
  const chunks = [];
  const wireRequest = request();
  const data = [
    { choices: [{ delta: { reasoning_content: 'thinking' } }] },
    { choices: [{ delta: { content: 'answer' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'roll', arguments: '{"sides":6}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } },
  ];
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${BAILIAN_TOKEN_PLAN_BASE_URL}/chat/completions`);
      assert.equal(options.headers.Authorization, 'Bearer sk-sp-example');
      assert.deepEqual(JSON.parse(options.body), wireRequest);
      return new Response(`${data.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join('')}data: [DONE]\n\n`);
    };
    await streamChatCompletions(BAILIAN_TOKEN_PLAN_BASE_URL, 'sk-sp-example', wireRequest, (chunk) => chunks.push(chunk));
    assert.ok(chunks.some((chunk) => chunk.type === 'thinking' && chunk.text === 'thinking'));
    assert.ok(chunks.some((chunk) => chunk.type === 'content' && chunk.text === 'answer'));
    assert.ok(chunks.some((chunk) => chunk.type === 'tool_call' && chunk.name === 'roll' && chunk.argJson === '{"sides":6}'));
    assert.ok(chunks.some((chunk) => chunk.type === 'usage' && chunk.total === 11));
    assert.equal(chunks.at(-1).type, 'done');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
