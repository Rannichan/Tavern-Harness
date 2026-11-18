import type { VoiceProvider, VoiceProviderKind, VoiceId } from '../types/models';

export const VOICE_PROVIDER_OPTIONS: Record<VoiceProviderKind, {
  name: string;
  voices: ReadonlyArray<{ id: VoiceId; label: string }>;
}> = {
  deepseek: {
    name: 'Deepseek',
    voices: [
      { id: 'stella', label: '海星 · 女声' },
      { id: 'tide', label: '暗潮 · 男声' },
    ],
  },
  bailian: {
    name: '百炼 Token Plan',
    voices: [
      { id: 'longanlingxin', label: '龙安灵心' },
      { id: 'longanlufeng', label: '龙安陆风' },
    ],
  },
};

export function isVoiceAllowed(kind: VoiceProviderKind, voiceId: string): voiceId is VoiceId {
  return VOICE_PROVIDER_OPTIONS[kind].voices.some((voice) => voice.id === voiceId);
}

export function activeVoiceProvider(
  providers: VoiceProvider[],
  providerId: number | null | undefined,
  voiceId: string | null | undefined,
): VoiceProvider | null {
  const provider = providers.find((item) => item.id === providerId && item.isEnabled);
  return provider && voiceId && isVoiceAllowed(provider.kind, voiceId) ? provider : null;
}

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

async function playVoiceRequest(path: string, body: Record<string, unknown>): Promise<void> {
  currentAudio?.pause();
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || `语音合成失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('语音服务返回了空音频');
  currentObjectUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentObjectUrl);
  currentAudio.addEventListener('ended', () => {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
    currentAudio = null;
  }, { once: true });
  await currentAudio.play();
}

export async function speakText(providerId: number, voiceId: VoiceId, text: string): Promise<void> {
  const content = text.trim();
  if (!content) throw new Error('没有可朗读的文本');
  await playVoiceRequest('/api-v3/voice/synthesize', { providerId, voiceId, text: content });
}

export async function previewVoice(kind: VoiceProviderKind, apiKey: string, voiceId: VoiceId, text: string): Promise<void> {
  const content = text.trim();
  const key = apiKey.trim();
  if (!content) throw new Error('没有可朗读的文本');
  if (!key) throw new Error('API Key 不能为空');
  if (!isVoiceAllowed(kind, voiceId)) throw new Error('该 Provider 不支持所选音色');
  await playVoiceRequest('/api-v3/voice/preview', { kind, apiKey: key, voiceId, text: content });
}
