import type {
  ChatCompletionRequest,
  ChatStreamChunk,
  NetworkMessage,
} from '../types/models';
import { fallbackToolCallId } from './turnLoop';
import { isNetworkLikeError, toProxyUrl } from './proxy';
import { translate } from './i18n';

export const OPENAI_TIMEOUTS = { connect: 15_000, read: 60_000, write: 15_000 };

/**
 * 计算请求 URL 候选：先直连，若失败且开发服务器可用（存在 /api/ 代理），
 * 自动回退到同源代理地址。
 */
function* urlCandidates(baseUrl: string): Generator<string> {
  const base = baseUrl.replace(/\/+$/, '');
  yield base + '/chat/completions';
  const proxy = toProxyUrl(baseUrl);
  if (proxy) yield proxy.replace(/\/+$/, '') + '/chat/completions';
}

// ============================================================
// SSE 流式解析器 — 支持 thinking / tool_calls / usage
// ============================================================

export async function streamChatCompletions(
  baseUrl: string,
  apiKey: string,
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatStreamChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  // 依次尝试：直连 → 同源代理（CORS 被拦截时自动回退）
  for (const url of urlCandidates(baseUrl)) {
    const ok = await attemptStream(url, apiKey, request, onChunk, signal);
    if (ok) return;
    // 直连失败且是网络层错误（CORS 等）→ 继续尝试下一个候选（代理）
    // 若是业务错误（HTTP 4xx/5xx、解析失败）则不重试
  }
}

async function attemptStream(
  url: string,
  apiKey: string,
  request: ChatCompletionRequest,
  onChunk: (chunk: ChatStreamChunk) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const resetReadTimeout = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUTS.read);
  };
  resetReadTimeout();

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.text();
        detail = body.slice(0, 500);
      } catch {
        /* ignore */
      }
      onChunk({ type: 'error', message: `HTTP ${resp.status}: ${detail || resp.statusText}` });
      return true; // 业务性错误，不再重试代理
    }

    if (!resp.body) {
      onChunk({ type: 'error', message: 'Response body is empty (streaming not supported?)' });
      return true;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    // Delta 工具调用按 index 组装
    const toolDeltas = new Map<number, { id: string; name: string; args: string; lastEmitted: string }>();
    let hasUsage = false;

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetReadTimeout();
      buffer += decoder.decode(value, { stream: true });

      // 按行切分 SSE
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') break;
          if (data) {
            handleDataLine(data, onChunk, toolDeltas, () => (hasUsage = true));
          }
        }
      }
    }

    // 收尾：补发未完成的工具调用
    for (const [idx, td] of toolDeltas) {
      const id = td.id || fallbackToolCallId(idx);
      const nextEmit = `${id}\n${td.name}\n${td.args}`;
      if (td.lastEmitted === nextEmit) continue;
      td.lastEmitted = nextEmit;
      onChunk({
        type: 'tool_call',
        id,
        name: td.name,
        argJson: td.args,
      });
    }
    onChunk({ type: 'done' });
    return true;
  } catch (e) {
    if (signal?.aborted) {
      onChunk({ type: 'done' });
      return true;
    }
    if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') {
      onChunk({ type: 'error', message: translate('tool.timeout') });
      return true;
    }
    // 网络层错误：若还有代理候选则返回 false 让外层重试；否则报错
    if (isNetworkLikeError(e)) {
      return false;
    }
    onChunk({ type: 'error', message: (e as Error).message || String(e) });
    return true;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function handleDataLine(
  data: string,
  onChunk: (c: ChatStreamChunk) => void,
  toolDeltas: Map<number, { id: string; name: string; args: string; lastEmitted: string }>,
  setHasUsage: () => void
): void {
  try {
    const json = JSON.parse(data);
    onChunk({ type: 'raw', line: data });

    const usage = json.usage;
    if (usage) {
      setHasUsage();
      onChunk({
        type: 'usage',
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      });
    }
    const choices = json.choices as Array<{
      delta?: {
        content?: string | null;
        reasoning?: string | null;
        reasoning_content?: string | null;
        thinking_content?: string | null;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    if (!choices) return;
    for (const choice of choices) {
      const delta = choice.delta;
      if (!delta) continue;

      const thinking =
        delta.reasoning ?? delta.reasoning_content ?? delta.thinking_content ?? null;
      if (thinking) onChunk({ type: 'thinking', text: thinking });

      // deepseek-r1 风格 的 思考/回答 分隔标记
      const content = delta.content;
      if (content != null) {
        const parts = splitThinkingMarkers(content);
        for (const p of parts) {
          if (p.kind === 'think') onChunk({ type: 'thinking', text: p.text });
          else onChunk({ type: 'content', text: p.text });
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolDeltas.get(idx) ?? { id: '', name: '', args: '', lastEmitted: '' };
          if (tc.id) cur.id = tc.id;
          if (!cur.id) cur.id = fallbackToolCallId(idx);
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolDeltas.set(idx, cur);
          if (cur.name) {
            const nextEmit = `${cur.id}\n${cur.name}\n${cur.args}`;
            if (cur.lastEmitted !== nextEmit) {
              cur.lastEmitted = nextEmit;
              onChunk({
                type: 'tool_call',
                id: cur.id,
                name: cur.name,
                argJson: cur.args,
              });
            }
          }
        }
      }
      if (choice.finish_reason === 'tool_calls') {
        // 立即发出发射工具调用事件
        for (const [idx, td] of toolDeltas) {
          const id = td.id || fallbackToolCallId(idx);
          const nextEmit = `${id}\n${td.name}\n${td.args}`;
          if (td.lastEmitted === nextEmit) continue;
          td.lastEmitted = nextEmit;
          onChunk({
            type: 'tool_call',
            id,
            name: td.name,
            argJson: td.args,
          });
        }
        toolDeltas.clear();
      } else if (choice.finish_reason && choice.finish_reason !== 'stop') {
        // stop/reasoning/content_filter 等
      }
    }
  } catch {
    // 非 JSON 行（如注释），忽略
  }
}

/** 拆分 deepseek / kimi 风格的 思考→回答 标记 */
function splitThinkingMarkers(content: string): Array<{ kind: 'think' | 'text'; text: string }> {
  // 以 "thinking:" / "reasoning:" / "思考:" 等行为分界，将前后文本拆为 thinking/text 段
  const markerRe = /\b(?:thinking|reasoning|思考)\s*(?:content)?\s*[:\-＝=]/gi;
  return splitByMarkers(content, markerRe);
}

function splitByMarkers(content: string, markerRe: RegExp): Array<{ kind: 'think' | 'text'; text: string }> {
  // 若存在 marker 行，第一个 marker 前为纯文本，marker 后为思考，直到遇到 /thinking 或 应答 marker
  const parts: Array<{ kind: 'think' | 'text'; text: string }> = [];
  let inThink = false;
  let current = '';
  const push = (kind: 'think' | 'text') => {
    if (current) {
      parts.push({ kind, text: current });
      current = '';
    }
  };
  const lines = content.split('\n');
  const closeRe = /^\s*<\/?(?:thinking|reasoning|think)>?\s*$/i;
  for (const line of lines) {
    const m = line.match(markerRe);
    const close = closeRe.test(line.trim());
    if (close) {
      if (inThink) push('think');
      else push('text');
      inThink = false;
      continue;
    }
    if (m && !inThink) {
      push('text');
      inThink = true;
      // 丢弃 marker 本身
      current = line.replace(markerRe, '').trim();
      continue;
    }
    current += (current ? '\n' : '') + line;
  }
  if (inThink) push('think');
  else push('text');
  return parts;
}

// ============================================================
// 请求构造辅助
// ============================================================

export function buildChatRequest(
  p: {
    model: string;
    messages: NetworkMessage[];
    tools?: ChatCompletionRequest['tools'];
    temperature: number;
    topP: number;
    maxTokens: number;
    topK: number;
    frequencyPenalty: number;
    presencePenalty: number;
    repetitionPenalty: number;
    reasoningEffort: string;
    isThinkingModeEnabled: boolean;
    streaming: boolean;
    baseUrl: string;
  }
): ChatCompletionRequest {
  const request: ChatCompletionRequest = {
    model: p.model,
    messages: p.messages,
    temperature: Math.round(p.temperature * 100) / 100,
    stream: p.streaming,
  };

  if (p.topP > 0) request.top_p = Math.round(p.topP * 100) / 100;
  // maxTokens 0 = 不限制（很多 provider 用 max_tokens 表示新 token 数）
  if (p.maxTokens > 0) request.max_tokens = p.maxTokens;
  if (p.topK > 0) request.top_k = Math.round(p.topK);
  if (p.frequencyPenalty)

request.frequency_penalty = Math.round(p.frequencyPenalty * 100) / 100;
  if (p.presencePenalty) request.presence_penalty = Math.round(p.presencePenalty * 100) / 100;
  if (p.repetitionPenalty && p.repetitionPenalty !== 1)
    request.repetition_penalty = Math.round(p.repetitionPenalty * 100) / 100;

  if (p.streaming) request.stream_options = { include_usage: true };

  // 思考模式参数（与 App 逻辑一致）
  const effort = p.reasoningEffort;
  if (effort !== 'auto' && effort !== 'off') {
    request.reasoning_effort = effort;
  }
  const thinkingEnabled = p.isThinkingModeEnabled && effort !== 'off';
  const modelKey = p.model.toLowerCase();
  const urlKey = p.baseUrl.toLowerCase();
  const supportsThinking = /deepseek|qwen|qwq|r1|siliconflow|dashscope|ollama|vllm/.test(modelKey + ' ' + urlKey);
  if (supportsThinking && !/qwen/.test(modelKey)) {
    request.enable_thinking = thinkingEnabled;
  }
  if (/qwen/.test(modelKey)) {
    request.chat_template_kwargs = { enable_thinking: thinkingEnabled, preserve_thinking: true };
  }

  if (p.tools && p.tools.length > 0) {
    request.tools = p.tools;
    request.tool_choice = 'auto';
  }

  return request;
}

/** 清理历史中的思考标签（模型不应看到旧思考） */
export function sanitizeHistoryContentForModel(content: string): string {
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    // 移除 "thinking:" / "思考:" 行及其后的思考内容（直到换行处,若下一行仍是思考则继续）
    .split('\n')
    .filter((line) => !/^\s*(?:thinking|reasoning|思考)\s*[:\-＝=]/i.test(line))
    .join('\n')
    .replace(/<\/?(?:thinking|reasoning|think)>/gi, '')
    .trim();
}