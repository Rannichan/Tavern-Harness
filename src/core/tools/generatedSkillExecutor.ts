import type { GeneratedSkillExecution, ToolConfirmationRequest } from '../../types/models';
import { sanitizeRelativePath } from './generatedWorkspace';
import { translate } from '../i18n';

// ============================================================
// 生成式技能执行引擎（JavaScript 沙箱为 Web Worker + CSP）
// ============================================================

const MAX_OUTPUT_CHARS = 20_000;
/** 单文件读写字符上限（与沙箱服务 file_read/file_write 对齐） */
const MAX_READ_CHARS = 100_000;

/** 会话工作目录名是否合规（仅允许相对目录、不允许 .. / 绝对路径 / 危险字符） */
function isValidWorkspaceDirName(dir: string): boolean {
  const s = dir.replace(/\\/g, '/').trim();
  return Boolean(s && s !== '.' && s !== '..' && /^[a-z0-9_.-]+$/i.test(s));
}

/**
 * 创建会话时预建其专属工作目录（磁盘沙箱可用时）。
 * 幂等、尽量不抛错：沙箱未启动 / 请求失败时静默跳过，目录会在首次工具调用时再建。
 */
export async function ensureSessionWorkspaceDir(dir: string | null | undefined): Promise<void> {
  if (!dir || typeof dir !== 'string' || !isValidWorkspaceDirName(dir)) return;
  try {
    await fetch('/api-v2/session_create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: dir }),
    });
  } catch {
    /* 沙箱未启动等：静默忽略 */
  }
}

/**
 * 删除会话时清理其专属磁盘工作目录。
 * 沙箱不可用时不阻塞会话删除。
 */
export async function deleteSessionWorkspace(dir: string | null | undefined): Promise<void> {
  if (dir && typeof dir === 'string' && isValidWorkspaceDirName(dir)) {
    try {
      await fetch('/api-v2/session_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: dir }),
      });
    } catch {
      /* 沙箱不可用：磁盘目录无法删除，忽略 */
    }
  }
}

/** 规范化会话工作目录名；不合规时返回 null 并禁止访问。 */
export function normalizeWorkspaceDir(dir: string | null | undefined): string | null {
  if (!dir || typeof dir !== 'string') return null;
  const s = dir.replace(/\\/g, '/').trim();
  return isValidWorkspaceDirName(s) ? s : null;
}

/** shell 确认请求回调（由调用方注入，走统一确认弹窗链路） */
export type SkillConfirmFn = (req: ToolConfirmationRequest) => Promise<boolean>;

/** 填充 {{param}} 占位符 */
function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const val = key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], args);
    if (val == null) return '';
    return String(val);
  });
}

export async function executeGeneratedSkill(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  confirm?: SkillConfirmFn | null,
  workspaceDir?: string | null,
): Promise<string> {
  switch (execution.type) {
    case 'template':
      return truncateToolOutput(interpolate(execution.template ?? '', args));
    case 'http_get':
      return execHttpGet(execution, args);
    case 'javascript':
      return execJavaScript(execution, args, workspaceDir);
    case 'file_read':
      return execFileRead(execution, args, workspaceDir);
    case 'file_write':
      return execFileWrite(execution, args, confirm, workspaceDir);
    case 'shell':
      return execShell(execution, args, confirm, workspaceDir);
    default:
      return `ERROR: 未知执行类型 ${(execution as GeneratedSkillExecution).type}`;
  }
}

export function truncateToolOutput(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + translate('tool.truncated') : s;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

// ---------- http_get ----------
async function execHttpGet(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
  const raw = interpolate(execution.url ?? '', args);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'ERROR: 无效 URL';
  }
  if (url.protocol !== 'https:') return 'ERROR: 仅允许 https 公网地址';
  // 屏蔽内网地址
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    /^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  ) {
    return 'ERROR: 不允许访问内网地址';
  }
  try {
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    const text = await resp.text();
    return truncateToolOutput(text);
  } catch (e) {
    return `ERROR: 请求失败 ${(e as Error).message}`;
  }
}

// ---------- javascript（Web Worker 沙箱，async/await + 受限桥接 API）----------
/**
 * Worker 内注入的受限桥接函数（$read / $write / $append / $list）。
 * 实现通过 postMessage 与主线程通信，实际能力全部复用主线程中已验证的
 * 文件读写沙箱（路径校验、大小上限、磁盘/虚拟双模式），技能代码本身
 * 拿不到任意文件系统或网络能力。
 */
const JS_INJECT_BOOT = `
self.__pending = new Map();
self.__seq = 0;
self.__bridge = (method, payload) => new Promise((resolve, reject) => {
  const id = ++self.__seq;
  self.__pending.set(id, { resolve, reject });
  self.postMessage({ __bridge__: true, id, method, payload });
});
self.__req = async (name, payload) => {
  const r = await self.__bridge(name, payload);
  if (r && r.ok === false) throw new Error(r.error || '操作失败');
  return r;
};
self.__run = async (ev) => {
  const input = ev.input;
  const $read = async (p) => (await self.__req('read', { path: p })).content;
  const $write = async (p, c) => (await self.__req('write', { path: p, content: c })).result;
  const $append = async (p, c) => (await self.__req('append', { path: p, content: c })).result;
  const $list = async () => (await self.__req('list', {})).files;
  try {
    const fn = new Function('input', '$read', '$write', '$append', '$list', CODE_FN);
    const result = await fn(input, $read, $write, $append, $list);
    let safe;
    try {
      safe = JSON.parse(JSON.stringify(result ?? null));
    } catch (e) {
      self.postMessage({ __error__: 'result 不可序列化: ' + String(e) });
      return;
    }
    self.postMessage({ __result__: safe });
  } catch (e) {
    self.postMessage({ __error__: String((e && e.message) || e) });
  }
};
self.onmessage = (ev) => {
  const d = ev.data;
  if (d && d.__bridge_resp__) {
    const p = self.__pending.get(d.id);
    if (!p) return;
    self.__pending.delete(d.id);
    if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
    return;
  }
  self.__run(d);
};
`;

function createSandboxWorker(code: string): Worker {
  // 函数体内声明 let result，兼容旧式 `result = {...}` 用户代码；
  // 函数体为 async 包装，用户代码可用 await + $read/$write/$append/$list
  const codeFn = `return (async () => { "use strict";\nlet result;\n${code}\nreturn result; })();`;
  const src = JS_INJECT_BOOT.replace('CODE_FN', JSON.stringify(codeFn));
  const blob = new Blob([src], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}

async function execJavaScript(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  workspaceDir?: string | null,
): Promise<string> {
  const code = execution.code ?? '';
  if (code.length > 20_000) return 'ERROR: 代码超过 2 万字符';
  const input = JSON.parse(JSON.stringify(args ?? {}));

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = createSandboxWorker(code);
    } catch (e) {
      resolve(`ERROR: 无法创建沙箱 ${(e as Error).message}`);
      return;
    }
    // 单次执行总超时（含所有桥接等待），到点即 terminate
    const timer = setTimeout(() => {
      worker.terminate();
      resolve('ERROR: 脚本执行超时 (5000ms)');
    }, 5000);
    // 桥接请求：复用主线程已验证的文件沙箱能力
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d) return;
      if (d.__bridge__) {
        void handleBridgeCall(d, workspaceDir).then(
          (result) => worker.postMessage({ __bridge_resp__: true, id: d.id, ok: true, result }),
          (err) => worker.postMessage({ __bridge_resp__: true, id: d.id, ok: false, error: String((err && err.message) || err) })
        );
        return;
      }
      if (d.__error__) {
        clearTimeout(timer);
        worker.terminate();
        resolve(`ERROR: ${d.__error__}`);
        return;
      }
      if ('__result__' in d) {
        clearTimeout(timer);
        worker.terminate();
        resolve(truncateToolOutput(JSON.stringify(d.__result__ ?? null)));
        return;
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(`ERROR: ${e.message}`);
    };
    worker.postMessage({ input });
  });
}

/**
 * 主线程侧桥接实现：全部复用已验证的文件沙箱逻辑。
 * 统一返回 { ok, content?/result?/files?, error? }，Worker 内 $read 等
 * 在失败时 reject 成 Error，技能代码用 try/catch 接住。
 */
async function handleBridgeCall(
  req: { method: string; payload: Record<string, unknown> },
  workspaceDir?: string | null,
): Promise<unknown> {
  const { method, payload } = req;
  switch (method) {
    case 'read': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      await requireFileServer(workspaceDir);
      const text = await diskFileRead(path, workspaceDir!);
      if (text === null) return { ok: false, error: `文件不存在: ${path}` };
      return { ok: true, content: text.slice(0, MAX_READ_CHARS) };
    }
    case 'write': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      const content = String(payload.content ?? '');
      await requireFileServer(workspaceDir);
      return { ok: true, result: await diskFileWrite(path, content, false, workspaceDir!) };
    }
    case 'append': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      const content = String(payload.content ?? '');
      await requireFileServer(workspaceDir);
      return { ok: true, result: await diskFileWrite(path, content, true, workspaceDir!) };
    }
    case 'list': {
      await requireFileServer(workspaceDir);
      const files = await diskFileList(workspaceDir!);
      return { ok: true, files: files.slice(0, 500) };
    }
    default:
      return { ok: false, error: `未知桥接方法 ${method}` };
  }
}

// ---------- file_read / file_write（仅使用项目 sandbox_workspace/）----------
interface ServiceProbeState {
  available: boolean;
  retryAt: number;
}

async function probeLocalService(
  state: ServiceProbeState,
  url: string,
  body: Record<string, unknown>,
  workspaceDir?: string | null,
): Promise<boolean> {
  if (!normalizeWorkspaceDir(workspaceDir)) return false;
  if (state.available) return true;
  if (Date.now() < state.retryAt) return false;
  if (typeof window === 'undefined' || !/^https?:\/\//.test(window.location.origin)) {
    state.retryAt = Date.now() + 60_000;
    return false;
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    state.available = resp.ok;
  } catch {
    state.available = false;
  }
  if (!state.available) state.retryAt = Date.now() + 5000;
  return state.available;
}

/** 本地文件服务可用性（与本地命令服务共用端点，成功则缓存） */
const fileServerProbe: ServiceProbeState = { available: false, retryAt: 0 };
async function detectFileServer(workspaceDir?: string | null): Promise<boolean> {
  return probeLocalService(fileServerProbe, '/api-v2/file_list', { session: workspaceDir }, workspaceDir);
}

async function requireFileServer(workspaceDir?: string | null): Promise<void> {
  if (!(await detectFileServer(workspaceDir))) {
    throw new Error('本地工作区服务不可用，无法读写文件');
  }
}

async function diskFileRead(path: string, workspaceDir: string): Promise<string | null> {
  try {
    const resp = await fetch('/api-v2/file_read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, session: workspaceDir }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string; content?: string };
    if (resp.ok && data.ok) return data.content ?? '';
    if (data.message === '文件不存在') return null;
    throw new Error(data.message || `HTTP ${resp.status}`);
  } catch (e) {
    throw new Error(`本地工作区读取失败: ${(e as Error).message}`);
  }
}

async function diskFileWrite(
  path: string,
  content: string,
  append: boolean,
  workspaceDir: string,
  confirm?: SkillConfirmFn | null,
  confirmationRequestId?: string,
  toolName: string = 'file_write',
): Promise<string> {
  try {
    const resp = await fetch('/api-v2/file_write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        content,
        mode: append ? 'append' : 'write',
        session: workspaceDir,
        confirmationRequestId,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string; needConfirm?: boolean; confirmationRequestId?: string };
    if (data.needConfirm && data.confirmationRequestId) {
      const approved = confirm
        ? await confirm({
            sessionId: -1,
            toolName,
            title: translate(toolName === 'file_edit' ? 'tool.gateFileEditTitle' : 'tool.gateFileWriteTitle'),
            message: translate(
              toolName === 'file_edit' ? 'tool.gateFileEditMsg' : 'tool.gateFileWriteMsg',
              { path },
            ),
            argsJson: JSON.stringify({ path, append }),
          })
        : false;
      if (!approved) return translate(toolName === 'file_edit' ? 'tool.fileEditDenied' : 'tool.fileWriteDenied');
      const approvalError = await approveSandboxScript(data.confirmationRequestId);
      if (approvalError) return approvalError;
      return diskFileWrite(path, content, append, workspaceDir, null, data.confirmationRequestId, toolName);
    }
    if (!resp.ok || !data.ok) throw new Error(data?.message || `HTTP ${resp.status}`);
    return `OK: 已写入 ${path} (${content.length} 字符)`;
  } catch (e) {
    throw new Error(`磁盘写入失败: ${(e as Error).message}`);
  }
}

async function diskFileList(workspaceDir: string): Promise<string[]> {
  try {
    const resp = await fetch('/api-v2/file_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: workspaceDir }),
    });
    const data = (await resp.json()) as { ok?: boolean; files?: string[]; message?: string };
    if (resp.ok && data.ok) return data.files ?? [];
    throw new Error(data.message || `HTTP ${resp.status}`);
  } catch (e) {
    throw new Error(`本地工作区列表读取失败: ${(e as Error).message}`);
  }
}

// ---------- file_read ----------
/**
 * 读取工作区文件文本。
 * 从 sandbox_workspace/ 读取；文件不存在返回 null，服务不可用时抛出明确错误。
 * 供 file_read 技能、file_display 展示以及弹窗回看共用。
 */
export async function readWorkspaceFileText(path: string, workspaceDir: string): Promise<string | null> {
  const readablePath = normalizePath(path);
  if (!readablePath) throw new Error('无效路径');
  await requireFileServer(workspaceDir);
  return diskFileRead(readablePath, workspaceDir);
}

/**
 * 写入本地沙箱工作区（可携带确认回调与工具名）。
 * 与 file_write 技能一致：工作区内直接写；工作区外需用户确认（一次性票据）。
 * 供 file_edit 在外部路径上复用同一确认链路。
 */
export async function writeWorkspaceFileTextFor(
  path: string,
  content: string,
  workspaceDir: string,
  confirm: SkillConfirmFn | null,
  toolName = 'file_write',
): Promise<string> {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) throw new Error('无效路径');
  await requireFileServer(workspaceDir);
  return diskFileWrite(normalizedPath, content, false, workspaceDir, confirm, undefined, toolName);
}

// ---------- 会话工作区枚举（文件管理器只读浏览共用） ----------
/**
 * 列出当前会话专属工作区内的全部文件相对路径。
 * 仅通过本地沙箱服务枚举；服务不可用时抛出明确错误。
 */
export async function listSessionWorkspaceFiles(workspaceDir: string): Promise<string[]> {
  await requireFileServer(workspaceDir);
  return (await diskFileList(workspaceDir)).slice(0, 500);
}

async function execFileRead(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  workspaceDir?: string | null,
): Promise<string> {
  try {
    const path = normalizePath(interpolate(execution.path ?? '', args));
    if (!path) throw new Error('无效路径');
    const text = await readWorkspaceFileText(path, normalizeWorkspaceDir(workspaceDir) ?? '');
    if (text === null) return `ERROR: 文件不存在: ${path}`;
    return truncateToolOutput(text);
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

// ---------- file_write ----------
async function execFileWrite(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  confirm?: SkillConfirmFn | null,
  workspaceDir?: string | null,
): Promise<string> {
  try {
    const path = normalizePath(interpolate(execution.path ?? '', args));
    if (!path) throw new Error('无效路径');
    let content: string;
    if (execution.json_content != null) {
      content = JSON.stringify(interpolateDeep(execution.json_content, args), null, 2);
    } else {
      content = interpolate(execution.content ?? '', args);
    }
    const safeWorkspaceDir = normalizeWorkspaceDir(workspaceDir);
    await requireFileServer(safeWorkspaceDir);
    const diskContent = execution.append && execution.append_newline ? `${content}\n` : content;
    return await diskFileWrite(path, diskContent, execution.append ?? false, safeWorkspaceDir!, confirm);
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

function interpolateDeep(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolate(value, args);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, args));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = interpolateDeep(v, args);
    return out;
  }
  return value;
}

// ---------- shell（真实执行：白名单直执 + 其它命令确认）----------

/** 按服务端规则统计换行及 && / || / ; 分隔的命令，忽略引号和转义内的连接符。 */
function countShellCommands(script: string): number {
  const lines = script.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  let count = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let commandStart = 0;
    let quote: "'" | '"' | null = null;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      const operator = line.startsWith('&&', index) ? '&&' : line.startsWith('||', index) ? '||' : char === ';' ? ';' : null;
      if (!operator) continue;
      if (!line.slice(commandStart, index).trim()) throw new Error(`连接符 ${operator} 前缺少命令`);
      count += 1;
      index += operator.length - 1;
      commandStart = index + 1;
    }
    if (quote) throw new Error('命令包含未闭合的引号');
    if (!line.slice(commandStart).trim()) throw new Error('连接符后缺少命令');
    count += 1;
  }
  return count;
}

/** 本地命令服务是否可用（成功则永久缓存；失败后短暂重试，避免探测结果永久失效） */
const sandboxProbe: ServiceProbeState = { available: false, retryAt: 0 };
async function detectSandbox(workspaceDir?: string | null): Promise<boolean> {
  return probeLocalService(
    sandboxProbe,
    '/api-v2/exec',
    { script: 'echo 1', session: workspaceDir },
    workspaceDir,
  );
}

/** 把整段脚本送去本地命令服务执行（白名单/确认票据/超时均由服务端校验） */
async function execShell(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  confirm?: SkillConfirmFn | null,
  workspaceDir?: string | null,
): Promise<string> {
  const script = interpolate(execution.script ?? '', args);
  if (script.length > 8000) return 'ERROR: 脚本超过 8000 字符';
  let commandCount: number;
  try {
    commandCount = countShellCommands(script);
  } catch (error) {
    return `ERROR: ${(error as Error).message}`;
  }
  if (commandCount === 0) return 'ERROR: 空脚本';
  if (commandCount > 20) return 'ERROR: 脚本命令数超过 20';

  // 先尝试让本地命令服务执行（服务端决定是否需要确认）
  const safeWorkspaceDir = normalizeWorkspaceDir(workspaceDir);
  const result = await sendToSandbox(script, safeWorkspaceDir);
  if (typeof result === 'string') return result; // ERROR: ...

  // 服务端返回需要确认：脚本包含非白名单命令或访问工作目录之外的路径
  if (result.needConfirm) {
    const confirmationRequestId = result.confirmationRequestId;
    const reasonKey = result.confirmationReason === 'both'
      ? 'Both'
      : result.confirmationReason === 'external_path'
        ? 'External'
        : result.confirmationReason === 'non_allowlisted'
          ? 'NonAllowlisted'
          : 'Unknown';
    let approved = false;
    if (confirm && confirmationRequestId) {
      try {
        approved = await confirm({
          sessionId: -1,
          toolName: 'run_shell_script',
          title: translate(`tool.gateShell${reasonKey}Title`),
          message: translate(`tool.gateShell${reasonKey}Msg`),
          argsJson: JSON.stringify({ script }),
        });
      } catch {
        approved = false;
      }
    }
    if (!approved) return translate('tool.shellDenied', { name: 'shell' });
    const approvalError = await approveSandboxScript(confirmationRequestId!);
    if (approvalError) return approvalError;
    return await execSandboxScript(script, confirmationRequestId!, safeWorkspaceDir!);
  }

  return truncateToolOutput(result.output ?? '');
}

interface SandboxResult {
  needConfirm: boolean;
  output?: string;
  confirmationRequestId?: string;
  confirmationReason?: 'non_allowlisted' | 'external_path' | 'both';
}

/** 发送脚本到本地沙箱；返回 needConfirm=true 表示需用户批准后重发 */
async function sendToSandbox(script: string, workspaceDir: string | null): Promise<SandboxResult | string> {
  const available = await detectSandbox(workspaceDir);
  if (!available) return 'ERROR: 本地命令执行服务未启动（请先运行 node sandbox-server.mjs）';
  try {
    const resp = await fetch('/api-v2/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: script.slice(0, 8000), session: workspaceDir }),
    });
    const data = (await resp.json()) as {
      ok?: boolean;
      message?: string;
      output?: string;
      needConfirm?: boolean;
      confirmationRequestId?: string;
      confirmationReason?: 'non_allowlisted' | 'external_path' | 'both';
    };
    if (resp.ok && data.ok) return { needConfirm: false, output: data.output ?? '' };
    if (data.needConfirm) {
      return {
        needConfirm: true,
        confirmationRequestId: data.confirmationRequestId,
        confirmationReason: data.confirmationReason,
      };
    }
    return `ERROR: ${data?.message ?? `HTTP ${resp.status}`}`;
  } catch (e) {
    return `ERROR: shell 执行端点异常 ${(e as Error).message}`;
  }
}

/** 用户确认后，通过 Vite 的受信任端点批准待执行请求。 */
async function approveSandboxScript(confirmationRequestId: string): Promise<string | null> {
  try {
    const resp = await fetch('/api-v2/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationRequestId }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string };
    if (resp.ok && data.ok) return null;
    return `ERROR: ${data?.message ?? `HTTP ${resp.status}`}`;
  } catch (error) {
    return `ERROR: shell 批准端点异常 ${(error as Error).message}`;
  }
}

/** 消费已由受信任批准端点授权的一次性请求。 */
async function execSandboxScript(script: string, confirmationRequestId: string, workspaceDir: string): Promise<string> {
  const resp = await fetch('/api-v2/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: script.slice(0, 8000),
      confirmationRequestId,
      session: workspaceDir,
    }),
  });
  const data = (await resp.json()) as { ok?: boolean; message?: string; output?: string };
  if (resp.ok && data.ok) return truncateToolOutput(data.output ?? '');
  return `ERROR: ${data?.message ?? `HTTP ${resp.status}`}`;
}
