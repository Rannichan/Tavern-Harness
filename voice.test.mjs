import assert from 'node:assert/strict';
import test from 'node:test';
import { activeVoiceProvider, isVoiceAllowed, previewVoice, VOICE_PROVIDER_OPTIONS } from './src/core/voice.ts';

test('voice providers expose only approved voices', () => {
  assert.deepEqual(VOICE_PROVIDER_OPTIONS.deepseek.voices.map((voice) => voice.id), ['stella', 'tide']);
  assert.deepEqual(VOICE_PROVIDER_OPTIONS.bailian.voices.map((voice) => voice.id), ['longanlingxin', 'longanlufeng']);
  assert.equal(isVoiceAllowed('deepseek', 'longanlingxin'), false);
  assert.equal(isVoiceAllowed('bailian', 'tide'), false);
});

test('active narration requires enabled provider and matching voice', () => {
  const providers = [{ id: 7, kind: 'deepseek', apiKey: 'secret', isEnabled: true, createdAt: 1 }];
  assert.equal(activeVoiceProvider(providers, 7, 'stella')?.id, 7);
  assert.equal(activeVoiceProvider(providers, 7, 'longanlingxin'), null);
  assert.equal(activeVoiceProvider([{ ...providers[0], isEnabled: false }], 7, 'stella'), null);
});

test('preview rejects mismatched voice before sending credentials', async () => {
  let requested = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requested = true; throw new Error('unexpected request'); };
  try {
    await assert.rejects(() => previewVoice('deepseek', 'secret', 'longanlingxin', 'hello'), /不支持/);
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
