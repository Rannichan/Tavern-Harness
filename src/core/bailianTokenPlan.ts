import type { ApiProvider } from '../types/models';

// Token Plan personal and pay-as-you-go keys use different endpoints.
// https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start
export const BAILIAN_TOKEN_PLAN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
export const BAILIAN_TOKEN_PLAN_SPEECH_MODEL = 'qwen-audio-3.0-tts-plus';
// Use a voice listed specifically for the 3.0 TTS Plus model:
// https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list
export const BAILIAN_TOKEN_PLAN_SPEECH_VOICE = 'longanlingxin';

// Text/chat models documented for the personal plan. Users can add model IDs
// themselves when Alibaba changes the catalogue.
export const BAILIAN_TOKEN_PLAN_MODELS = [
  'qwen3.8-flash',
  'qwen3.8-max',
  'qwen3.7-plus',
  'qwen3.7-max',
  'qwen3.6-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4.1-flash-1017',
  'deepseek-v4-pro',
  'deepseek-v4-pro-0813',
  'deepseek-v4-flash-0731',
  'glm-5.3',
  'glm-5.2',
] as const;

export function isBailianTokenPlanUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const path = url.pathname.replace(/\/+$/, '');
    return (url.protocol === 'https:'
      && url.hostname === 'token-plan.cn-beijing.maas.aliyuncs.com'
      && !url.port
      && path === '/compatible-mode/v1')
      || ((url.protocol === 'http:' || url.protocol === 'https:')
        && path === '/api/https/token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
  } catch {
    return false;
  }
}

export function createBailianTokenPlanProvider(): ApiProvider {
  return {
    name: 'Bailian Token Plan',
    baseUrl: BAILIAN_TOKEN_PLAN_BASE_URL,
    apiKey: '',
    isEnabled: true,
    cachedModelsCsv: BAILIAN_TOKEN_PLAN_MODELS.join(','),
    cachedSpeechModelsCsv: BAILIAN_TOKEN_PLAN_SPEECH_MODEL,
    modelAliasesJson: JSON.stringify(Object.fromEntries(
      BAILIAN_TOKEN_PLAN_MODELS.map((model) => [model, `Token Plan · ${model}`]),
    )),
    enabledModelIdsJson: JSON.stringify([BAILIAN_TOKEN_PLAN_MODELS[0]]),
    createdAt: Date.now(),
  };
}
