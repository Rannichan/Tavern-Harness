import assert from 'node:assert/strict';
import test from 'node:test';
import { activeVoiceProvider, isVoiceAllowed, previewVoice, speakText, stopVoicePlayback, VOICE_PROVIDER_OPTIONS } from './src/core/voice.ts';

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

test('stopping voice playback pauses and releases the active audio', async () => {
  const originalAudio = globalThis.Audio;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const audios = [];
  const revokedUrls = [];

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = false;
      audios.push(this);
    }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  globalThis.Audio = FakeAudio;
  globalThis.fetch = async () => new Response(new Blob(['audio']), { status: 200 });
  URL.createObjectURL = () => 'blob:active';
  URL.revokeObjectURL = (url) => revokedUrls.push(url);
  try {
    await speakText(1, 'stella', 'hello');
    stopVoicePlayback();
    assert.equal(audios[0].paused, true);
    assert.deepEqual(revokedUrls, ['blob:active']);
  } finally {
    stopVoicePlayback();
    globalThis.Audio = originalAudio;
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test('the latest voice request prevents an older request from playing', async () => {
  const originalAudio = globalThis.Audio;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const audios = [];
  let resolveFirst;
  let requestCount = 0;
  let objectUrlCount = 0;

  class FakeAudio {
    constructor(src) {
      this.src = src;
      audios.push(this);
    }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() {}
  }

  globalThis.Audio = FakeAudio;
  globalThis.fetch = (_path, options) => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Promise((resolve) => {
        resolveFirst = resolve;
        options.signal.addEventListener('abort', () => resolve(new Response(new Blob(['old']), { status: 200 })), { once: true });
      });
    }
    return Promise.resolve(new Response(new Blob(['new']), { status: 200 }));
  };
  URL.createObjectURL = () => `blob:${++objectUrlCount}`;
  URL.revokeObjectURL = () => {};
  try {
    const older = speakText(1, 'stella', 'older');
    const latest = speakText(1, 'stella', 'latest');
    await latest;
    resolveFirst?.(new Response(new Blob(['old']), { status: 200 }));
    await older;
    assert.deepEqual(audios.map((audio) => audio.src), ['blob:1']);
  } finally {
    stopVoicePlayback();
    globalThis.Audio = originalAudio;
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
