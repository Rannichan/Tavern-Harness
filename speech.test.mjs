import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('.', import.meta.url)), configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());
const { parseSpeechDecision, chooseDialogueForSpeech, synthesizeSpeech } = await vite.ssrLoadModule('/src/core/speech.ts');
const { splitProviderModels } = await vite.ssrLoadModule('/src/core/providerModels.ts');
const { BAILIAN_TOKEN_PLAN_BASE_URL, createBailianTokenPlanProvider } = await vite.ssrLoadModule('/src/core/bailianTokenPlan.ts');

const tokenEndpoint = { baseUrl: BAILIAN_TOKEN_PLAN_BASE_URL, apiKey: 'sk-sp-example', model: 'qwen-audio-3.0-tts-plus' };
const judgeEndpoint = { ...tokenEndpoint, model: 'qwen3.8-flash' };

function mockStream(content) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
}

test('model discovery separates chat, speech, and unrelated media models', () => {
  const result = splitProviderModels([
    'qwen3.8-flash', 'deepseek-v4-pro', 'qwen-audio-3.0-tts-plus',
    'gpt-4o-mini-tts', 'qwen-image-3.0-pro', 'qwen-audio-3.0-asr-flash',
    'qwen3-tts-flash-realtime', 'wan2.7-image', 'happyhorse-1.1-t2v',
    'text-embedding-v4', 'qwen3.8-flash',
  ]);
  assert.deepEqual(result.text, ['deepseek-v4-pro', 'qwen3.8-flash']);
  assert.deepEqual(result.speech, ['gpt-4o-mini-tts', 'qwen-audio-3.0-tts-plus']);
  assert.equal(createBailianTokenPlanProvider().cachedSpeechModelsCsv, 'qwen-audio-3.0-tts-plus');
});

test('voice decisions accept only a short, exact line in the assistant reply', () => {
  const reply = '她轻声说：“我会一直等你。”然后转身离开。';
  assert.equal(parseSpeechDecision('```json\n{"speak":true,"text":"我会一直等你。"}\n```', reply), '我会一直等你。');
  assert.equal(parseSpeechDecision('{"speak":false,"text":"我会一直等你。"}', reply), null);
  assert.equal(parseSpeechDecision('{"speak":true,"text":"编造的台词"}', reply), null);
  assert.equal(parseSpeechDecision('{"speak":true,"text":""}', reply), null);
  assert.equal(parseSpeechDecision('{"speak":true,"text":"' + 'a'.repeat(241) + '"}', 'a'.repeat(241)), null);
  assert.equal(parseSpeechDecision('not json', reply), null);
});

test('the selected text model decides whether a reply needs voice', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return mockStream('{"speak":true,"text":"我会一直等你。"}');
    };
    const reply = '她轻声说：“我会一直等你。”';
    const result = await chooseDialogueForSpeech(judgeEndpoint, [
      { role: 'user', content: [{ type: 'text', text: '你会回来吗？' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,SECRET' } }] },
    ], reply);
    assert.equal(result, '我会一直等你。');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BAILIAN_TOKEN_PLAN_BASE_URL}/chat/completions`);
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.model, 'qwen3.8-flash');
    assert.equal(body.enable_thinking, false);
    assert.equal(body.tools, undefined);
    assert.ok(body.messages[1].content.includes('你会回来吗'));
    assert.equal(body.messages[1].content.includes('data:image'), false);
    assert.equal(body.messages[1].content.includes('sk-sp-example'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Token Plan synthesis downloads and stores audio instead of the expiring URL', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const audioUrl = 'https://example.oss-cn-beijing.aliyuncs.com/speech.mp3?Expires=123&Signature=a%2Bb';
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return Response.json({ output: { audio: { url: audioUrl } } });
      return new Response(Uint8Array.from([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg' } });
    };
    const clip = await synthesizeSpeech(tokenEndpoint, 'longanlingxin', '我会一直等你。');
    assert.equal(calls[0].url, 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-sp-example');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      model: 'qwen-audio-3.0-tts-plus', input: { text: '我会一直等你。', voice: 'longanlingxin', format: 'mp3', sample_rate: 22050 },
    });
    assert.equal(calls[1].url, audioUrl);
    assert.equal(calls[1].options.headers, undefined, 'the API key is not sent to the audio host');
    assert.equal(clip.dataUrl, 'data:audio/mpeg;base64,AQIDBA==');
    assert.equal(clip.text, '我会一直等你。');
    assert.equal(JSON.stringify(clip).includes('Expires='), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upgrades signed Alibaba HTTP audio URLs to HTTPS and retries only the download via proxy', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  const audioUrl = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3?Expires=123&Signature=a%2Bb%2F%3D';
  try {
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return Response.json({ output: { audio: { url: audioUrl } } });
      if (calls.length === 2) throw new TypeError('Failed to fetch');
      return new Response(Uint8Array.from([42]), { headers: { 'content-type': 'application/octet-stream' } });
    };
    const clip = await synthesizeSpeech(tokenEndpoint, 'longanlingxin', '你好');
    assert.equal(calls[0].url, 'http://localhost:5173/api/https/token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    assert.equal(calls[1].url, 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3?Expires=123&Signature=a%2Bb%2F%3D');
    assert.equal(calls[2].url, 'http://localhost:5173/api/https/dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3?Expires=123&Signature=a%2Bb%2F%3D');
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(calls[2].options.headers, undefined);
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
    assert.equal(clip.dataUrl, 'data:audio/mpeg;base64,Kg==');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('OpenAI-compatible synthesis sends the configured model and voice', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://example.com/v1/audio/speech');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(options.body), { model: 'gpt-4o-mini-tts', input: 'Hello.', voice: 'alloy', response_format: 'mp3' });
      return new Response(Uint8Array.from([8, 9]), { headers: { 'content-type': 'audio/mpeg' } });
    };
    const clip = await synthesizeSpeech({ baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4o-mini-tts' }, 'alloy', 'Hello.');
    assert.equal(clip.dataUrl, 'data:audio/mpeg;base64,CAk=');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects invalid download URLs, HTTP errors, oversized audio, and interrupted requests', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }); };
    await assert.rejects(synthesizeSpeech(tokenEndpoint, 'voice', 'text'), /HTTP 401/);
    assert.equal(calls, 1);

    for (const url of [
      'http://127.0.0.1/private',
      'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.example/clip.mp3',
      'http://user:password@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3',
      'ftp://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3',
      'not a URL',
    ]) {
      globalThis.fetch = async () => Response.json({ output: { audio: { url } } });
      await assert.rejects(synthesizeSpeech(tokenEndpoint, 'voice', 'text'), /Invalid speech audio URL/);
    }

    globalThis.fetch = async () => new Response('audio', { headers: { 'content-type': 'audio/mpeg', 'content-length': String(5 * 1024 * 1024) } });
    await assert.rejects(synthesizeSpeech({ baseUrl: 'https://example.com/v1', apiKey: '', model: 'tts-1' }, 'alloy', 'text'), /too large/);

    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    const controller = new AbortController();
    const pending = synthesizeSpeech(tokenEndpoint, 'voice', 'text', controller.signal);
    controller.abort();
    await assert.rejects(pending, /aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
