import { isBailianTokenPlanUrl } from './bailianTokenPlan';
import { isNetworkLikeError, toProxyUrl } from './proxy';

interface ModelsResult {
  models: string[];
  viaProxy: boolean;
}

/** Keep synthesis and other non-chat models out of the conversation selector. */
export function splitProviderModels(models: string[]): { text: string[]; speech: string[] } {
  const text: string[] = [];
  const speech: string[] = [];
  for (const id of [...new Set(models.map((model) => model.trim()).filter(Boolean))]) {
    const lower = id.toLowerCase();
    const realtime = /(?:^|[-_/])realtime(?:$|[-_/])/.test(lower);
    const isSpeech = !realtime && (/(?:^|[-_/])tts(?:$|[-_/])/.test(lower)
      || /^(?:cosyvoice|sambert)/.test(lower)
      || /(?:^|\/)speech[-_]/.test(lower));
    if (isSpeech) {
      speech.push(id);
    } else if (!realtime
      && !/(?:^|[-_/])(?:image|video|audio|asr|embedding|rerank|ocr|moderation)(?:$|[-_/])/.test(lower)
      && !/^(?:wan\d|happyhorse|tripo|decision-model)/.test(lower)) {
      text.push(id);
    }
  }
  return { text: text.sort(), speech: speech.sort() };
}

/** Try common model-list endpoints, falling back to the same-origin proxy on network errors. */
export async function fetchModelsSmart(baseUrl: string, apiKey: string): Promise<ModelsResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const isTokenPlan = isBailianTokenPlanUrl(baseUrl);
  const candidates = isTokenPlan ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
  const proxyUrl = toProxyUrl(baseUrl);
  let lastErr: Error | null = null;

  const tryFetch = async (url: string): Promise<string[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const resp = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as { data?: Array<{ id?: unknown }> };
      const models = Array.isArray(json.data)
        ? json.data.flatMap((model) => typeof model?.id === 'string' && model.id.trim() ? [model.id.trim()] : []).sort()
        : [];
      if (models.length === 0) throw new Error('empty-model-list');
      return models;
    } finally {
      clearTimeout(timer);
    }
  };

  for (const url of candidates) {
    try {
      return { models: await tryFetch(url), viaProxy: false };
    } catch (error) {
      lastErr = error as Error;
    }
  }

  if (proxyUrl && (lastErr?.name === 'AbortError' || isNetworkLikeError(lastErr))) {
    const proxiedCandidates = isTokenPlan ? [`${proxyUrl}/models`] : [`${proxyUrl}/models`, `${proxyUrl}/v1/models`];
    for (const url of proxiedCandidates) {
      try {
        return { models: await tryFetch(url), viaProxy: true };
      } catch (error) {
        lastErr = error as Error;
      }
    }
  }

  throw lastErr ?? new Error('unknown-error');
}
