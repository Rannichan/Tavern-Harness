import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBailianAudioUrl } from './voice-server.mjs';

test('Bailian audio URLs accept HTTPS downloads', () => {
  const url = 'https://example.oss-cn-beijing.aliyuncs.com/speech.mp3?Expires=123&Signature=a%2Bb';
  assert.equal(normalizeBailianAudioUrl(url), url);
});

test('Bailian HTTP OSS URLs are upgraded to HTTPS', () => {
  const url = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3?Expires=123&Signature=a%2Bb%2F%3D';
  assert.equal(
    normalizeBailianAudioUrl(url),
    'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/clip.mp3?Expires=123&Signature=a%2Bb%2F%3D',
  );
});

test('Bailian audio URLs reject unsafe values', () => {
  assert.equal(normalizeBailianAudioUrl('http://example.com/audio.mp3'), null);
  assert.equal(normalizeBailianAudioUrl('https://user:secret@example.com/audio.mp3'), null);
  assert.equal(normalizeBailianAudioUrl('not a URL'), null);
});
