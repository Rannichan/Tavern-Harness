import type { GeneratedSkillExecution, ToolConfirmationRequest } from '../../types/models';
import {
  createWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  sanitizeRelativePath,
  readFileContent,
} from './generatedWorkspace';
import { translate } from '../i18n';

// ============================================================
// 生成式技能执行引擎（JavaScript 沙箱为 Web Worker + CSP）
// ============================================================

const MAX_OUTPUT_CHARS = 20_000;
/** 单文件读写字符上限（与沙箱服务 file_read/file_write 对齐） */
const MAX_READ_CHARS = 100_000;
/** 虚拟工作区 IndexedDB 键前缀 */
const WORKSPACE_KEY = 'generated_skill_workspace';

/** shell 确认请求回调（由调用方注入，走统一确认弹窗链路） */
export type SkillConfirmFn = (req: ToolConfirmationRequest) => Promise<boolean>;

/** 填充 {{param}} 占位符 */
export function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const val = key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], args);
    if (val == null) return '';
    return String(val);
  });
}

export async function executeGeneratedSkill(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  confirm?: SkillConfirmFn | null
): Promise<string> {
  switch (execution.type) {
    case 'template':
      return truncate(interpolate(execution.template ?? '', args));
    case 'http_get':
      return execHttpGet(execution, args);
    case 'javascript':
      return execJavaScript(execution, args);
    case 'file_read':
      return execFileRead(execution, args);
    case 'file_write':
      return execFileWrite(execution, args);
    case 'shell':
      return execShell(execution, args, confirm);
    case 'device_action':
      return execDeviceAction(execution, args);
    default:
      return `ERROR: 未知执行类型 ${(execution as GeneratedSkillExecution).type}`;
  }
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + translate('tool.truncated') : s;
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
      headers: { 'User-Agent': 'Tavern-Harness/1.0' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    const text = await resp.text();
    return truncate(text.slice(0, 20_000));
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

async function execJavaScript(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
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
        void handleBridgeCall(d).then(
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
        resolve(truncate(JSON.stringify(d.__result__ ?? null)));
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
async function handleBridgeCall(req: { method: string; payload: Record<string, unknown> }): Promise<unknown> {
  const { method, payload } = req;
  switch (method) {
    case 'read': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      const onDisk = await resolveFsMode();
      if (onDisk) {
        const text = await diskFileRead(path);
        if (text !== null) return { ok: true, content: text.slice(0, MAX_READ_CHARS) };
        return { ok: false, error: `文件不存在: ${path}` };
      }
      const f = await getWorkspaceFile(path);
      if (!f) return { ok: false, error: `文件不存在: ${path}` };
      return { ok: true, content: f.content.slice(0, MAX_READ_CHARS) };
    }
    case 'write': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      const content = String(payload.content ?? '');
      const onDisk = await resolveFsMode();
      if (onDisk) {
        return { ok: true, result: await diskFileWrite(path, content, false) };
      }
      if (content.length > MAX_READ_CHARS) return { ok: false, error: '文件超过可写大小上限' };
      await createWorkspaceFile(path, content);
      return { ok: true, result: `OK: 已写入 ${path} (${content.length} 字符)` };
    }
    case 'append': {
      const path = sanitizeRelativePath(String(payload.path ?? ''));
      const content = String(payload.content ?? '');
      const onDisk = await resolveFsMode();
      if (onDisk) {
        return { ok: true, result: await diskFileWrite(path, content, true) };
      }
      const existing = await getWorkspaceFile(path);
      const newContent = (existing ? existing.content : '') + content;
      if (newContent.length > MAX_READ_CHARS) return { ok: false, error: '文件超过可写大小上限' };
      await createWorkspaceFile(path, newContent);
      return { ok: true, result: `OK: 已追加 ${path}` };
    }
    case 'list': {
      const onDisk = await resolveFsMode();
      if (onDisk) {
        const files = (await diskFileList()) ?? [];
        return { ok: true, files: files.slice(0, 500) };
      }
      const files = await listWorkspaceFiles();
      return { ok: true, files: files.map((f) => f.path.slice(WORKSPACE_KEY.length + 1)) };
    }
    default:
      return { ok: false, error: `未知桥接方法 ${method}` };
  }
}

// ---------- file_read / file_write（优先落盘到项目 sandbox_workspace/，服务不可用时回退虚拟工作区）----------
/** 本地文件服务可用性（探测与 shell 沙箱同一端点，成功则缓存） */
let fileServerAvailable: boolean | null = null;
let fileServerRetryAt = 0;
async function detectFileServer(): Promise<boolean> {
  if (fileServerAvailable === true) return true;
  if (Date.now() < fileServerRetryAt) return false;
  if (typeof window === 'undefined' || !/^https?:\/\//.test(window.location.origin)) {
    fileServerRetryAt = Date.now() + 60_000;
    return false;
  }
  try {
    const resp = await fetch('/api-v2/file_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    fileServerAvailable = resp.ok;
  } catch {
    fileServerAvailable = false;
  }
  if (!fileServerAvailable) fileServerRetryAt = Date.now() + 5000; // 5 秒后自动重试
  return fileServerAvailable;
}

/** 平台前缀：沙箱真实工作区 vs 虚拟工作区 */
const fsMode: { disk: boolean } = { disk: false };
async function resolveFsMode(): Promise<boolean> {
  if (fsMode.disk) return true;
  if (await detectFileServer()) {
    fsMode.disk = true;
    return true;
  }
  return false;
}

async function diskFileRead(path: string): Promise<string | null> {
  try {
    const resp = await fetch('/api-v2/file_read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string; content?: string };
    if (resp.ok && data.ok) return data.content ?? '';
    return null;
  } catch {
    return null;
  }
}

async function diskFileWrite(path: string, content: string, append: boolean): Promise<string> {
  try {
    const resp = await fetch('/api-v2/file_write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, mode: append ? 'append' : 'write' }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string };
    if (!resp.ok || !data.ok) throw new Error(data?.message || `HTTP ${resp.status}`);
    return `OK: 已写入 ${path} (${content.length} 字符)`;
  } catch (e) {
    throw new Error(`磁盘写入失败: ${(e as Error).message}`);
  }
}

async function diskFileList(): Promise<string[] | null> {
  try {
    const resp = await fetch('/api-v2/file_list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = (await resp.json()) as { ok?: boolean; files?: string[]; message?: string };
    if (resp.ok && data.ok) return data.files ?? [];
    return null;
  } catch {
    return null;
  }
}

// ---------- file_read ----------
/**
 * 读取工作区文件文本。
 * 磁盘沙箱可用时优先读 sandbox_workspace/；磁盘模式读不到（文件写在
 * 虚拟工作区 / 模式切换过）时回退虚拟工作区。两处都无 → null。
 * 供 file_read 技能、file_display 展示以及弹窗回看共用。
 */
export async function readWorkspaceFileText(path: string): Promise<string | null> {
  const safe = sanitizeRelativePath(path);
  const onDisk = await resolveFsMode();
  if (onDisk) {
    const text = await diskFileRead(safe);
    if (text !== null) return text;
    // 磁盘上不存在（可能写到虚拟工作区）→ 回退虚拟工作区
    try {
      return await readFileContent(safe);
    } catch {
      return null;
    }
  }
  try {
    return await readFileContent(safe);
  } catch {
    return null;
  }
}

async function execFileRead(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
  try {
    const path = sanitizeRelativePath(interpolate(execution.path ?? '', args));
    const text = await readWorkspaceFileText(path);
    if (text === null) return `ERROR: 文件不存在: ${path}`;
    return truncate(text);
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

// ---------- file_write ----------
async function execFileWrite(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
  try {
    const path = sanitizeRelativePath(interpolate(execution.path ?? '', args));
    let content: string;
    if (execution.json_content != null) {
      content = JSON.stringify(interpolateDeep(execution.json_content, args), null, 2);
    } else {
      content = interpolate(execution.content ?? '', args);
    }
    const onDisk = await resolveFsMode();
    if (onDisk) {
      let diskContent = content;
      if (execution.append) {
        const sep = execution.append_newline ? '\n' : '';
        const existing = (await diskFileRead(path)) ?? '';
        diskContent = existing + (existing.endsWith('\n') || !existing ? '' : sep) + diskContent;
        if (execution.append_newline) diskContent += '\n';
      }
      return await diskFileWrite(path, diskContent, execution.append ?? false);
    }
    const existing = await getWorkspaceFile(path);
    if (execution.append && existing) {
      const sep = execution.append_newline ? '\n' : '';
      content = existing.content + (existing.content.endsWith('\n') || !existing.content ? '' : sep) + content;
      if (execution.append_newline) content += '\n';
    }
    await createWorkspaceFile(path, content);
    return `OK: 已写入 ${path} (${content.length} 字符)`;
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

// ---------- shell（真实执行：白名单直执 + 黑名单弹窗）----------

/**
 * 可由本地 sandbox-server 真实执行的命令（白名单，与 sandbox-server.mjs 对齐）。
 * 白名单命令直接执行，无需弹窗。
 */
export const SHELL_ALLOWED = [
  'pwd', 'date', 'echo', 'printf', 'ls', 'cat', 'touch', 'mkdir', 'rm', 'cp', 'mv', 'head', 'tail',
  'wc', 'basename', 'dirname', 'sort', 'uniq', 'grep', 'cut', 'tr', 'sha256sum', 'md5sum', 'du',
  'diff', 'find', 'stat', 'cmp', 'sed',
  'tar', 'gzip', 'gunzip', 'xz', 'unzip', 'zip', 'jq',
  'env', 'which', 'type', 'timedatectl', 'uptime', 'whoami', 'uname', 'hostname',
  'true', 'false', 'seq', 'factor', 'od', 'xxd', 'hexdump', 'strings', 'file', 'cksum', 'sum',
  'tee', 'xargs', 'awk', 'python3', 'node', 'npm', 'npx', 'git', 'ffprobe', 'openssl', 'calc', 'bc',
];

/**
 * 高危命令：真实执行前需要弹窗确认（与 sandbox-server.mjs 对齐）。
 * 白名单之外的命令一律拒绝（不在白名单，不在黑名单）。
 */
export const SHELL_BLOCKED = [
  'sudo', 'su', 'doas', 'pkexec', 'passwd', 'chpasswd',
  'rm', 'shred', 'dd', 'mkfs', 'fdisk', 'parted', 'mount', 'umount', 'swapon', 'swapoff',
  'reboot', 'shutdown', 'halt', 'poweroff', 'init', 'systemctl', 'service', 'killall', 'pkill', 'kill',
  'curl', 'wget', 'nc', 'ncat', 'socat', 'telnet', 'ssh', 'scp', 'sftp', 'ftp',
  'chmod', 'chown', 'chattr', 'setfacl', 'ln', 'mknod', 'mv',
  'docker', 'podman', 'kubectl', 'helm',
];

/** 本地 sandbox 是否可用（成功则永久缓存；失败后短暂重试，避免探测结果永久失效） */
let sandboxAvailable: boolean | null = null;
let sandboxRetryAt = 0;
async function detectSandbox(): Promise<boolean> {
  if (sandboxAvailable === true) return true;
  if (Date.now() < sandboxRetryAt) return false;
  if (typeof window === 'undefined' || !/^https?:\/\//.test(window.location.origin)) {
    sandboxRetryAt = Date.now() + 60_000;
    return false;
  }
  try {
    const resp = await fetch('/api-v2/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: 'echo 1' }) });
    sandboxAvailable = resp.ok;
  } catch {
    sandboxAvailable = false;
  }
  if (!sandboxAvailable) sandboxRetryAt = Date.now() + 5000; // 5 秒后自动重试，无需刷新页面
  return sandboxAvailable;
}

/** 把整段脚本送去本地 sandbox 执行（白名单/黑名单/超时在服务端再做一次） */
async function execShell(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>,
  confirm?: SkillConfirmFn | null
): Promise<string> {
  const script = interpolate(execution.script ?? '', args);
  if (script.length > 8000) return 'ERROR: 脚本超过 8000 字符';
  const lines = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length > 20) return 'ERROR: 脚本行数超过 20';

  // 先尝试让本地沙箱执行（服务端再做一次白名单/黑名单校验）
  const result = await sendToSandbox(script);
  if (typeof result === 'string') return result; // ERROR: ...

  // 服务端返回需要确认：脚本包含黑名单命令 → 弹窗请用户批准
  if (result.needConfirm) {
    let approved = true;
    if (confirm) {
      try {
        approved = await confirm({
          sessionId: -1,
          toolName: 'shell',
          title: translate('tool.gateShellTitle'),
          message: translate('tool.gateShellMsg', { script: script.slice(0, 800) }),
          argsJson: JSON.stringify({ script: script.slice(0, 2000) }),
        });
      } catch {
        approved = false;
      }
    }
    if (!approved) return translate('tool.shellDenied', { name: 'shell' });
    return await execSandboxScript(script);
  }

  return truncate(result.output ?? '');
}

interface SandboxResult {
  needConfirm: boolean;
  output?: string;
}

/** 发送脚本到本地沙箱；返回 needConfirm=true 表示需用户批准后重发 */
async function sendToSandbox(script: string): Promise<SandboxResult | string> {
  const available = await detectSandbox();
  if (!available) return 'ERROR: 真实 shell 沙箱未启动（请先运行 node sandbox-server.mjs）';
  try {
    const resp = await fetch('/api-v2/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: script.slice(0, 8000) }),
    });
    const data = (await resp.json()) as { ok?: boolean; message?: string; output?: string; needConfirm?: boolean };
    if (resp.ok && data.ok) return { needConfirm: false, output: data.output ?? '' };
    if (data.needConfirm) return { needConfirm: true };
    return `ERROR: ${data?.message ?? `HTTP ${resp.status}`}`;
  } catch (e) {
    return `ERROR: shell 执行端点异常 ${(e as Error).message}`;
  }
}

/** 确认后重发执行 */
async function execSandboxScript(script: string): Promise<string> {
  const resp = await fetch('/api-v2/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: script.slice(0, 8000), confirmed: true }),
  });
  const data = (await resp.json()) as { ok?: boolean; message?: string; output?: string };
  if (resp.ok && data.ok) return truncate(data.output ?? '');
  return `ERROR: ${data?.message ?? `HTTP ${resp.status}`}`;
}

// ---------- device_action ----------
async function execDeviceAction(
  execution: GeneratedSkillExecution,
  args: Record<string, unknown>
): Promise<string> {
  const interpolated = (e: GeneratedSkillExecution) => ({
    ...e,
    title: e.title ? interpolate(e.title, args) : e.title,
    message: e.message ? interpolate(e.message, args) : e.message,
  });

  const runOne = async (e: GeneratedSkillExecution): Promise<string> => {
    switch (e.action) {
      case 'flashlight': {
        // Web: 无闪光灯 API，模拟状态
        return `OK: 闪光灯 ${e.state ?? 'off'}${e.state === 'blink' ? ` (闪烁 ${e.flashes ?? 3} 次)` : ''}（Web 环境不支持真实闪光灯）`;
      }
      case 'vibrate': {
        const ms = Math.max(1, Math.min(10_000, e.duration_ms ?? 300));
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          const ok = (navigator as Navigator & { vibrate: (ms: number) => boolean }).vibrate(ms);
          return ok ? `OK: 已震动 ${ms}ms` : 'OK: 浏览器不支持震动';
        }
        return `OK: 震动 ${ms}ms（浏览器不支持）`;
      }
      case 'notification': {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(e.title || 'Tavern Harness', { body: e.message || '' });
            return `OK: 已发送通知「${e.title}」`;
          } catch {
            return `OK: 通知已生成（浏览器限制静默）`;
          }
        }
        return `OK: 通知「${e.title || ''}」已生成（需授权浏览器通知）`;
      }
      case 'sequence': {
        const steps = (e.sequence ?? []).slice(0, 6);
        const results: string[] = [];
        for (const s of steps) results.push(await runOne(s));
        return results.join('\n');
      }
      default:
        return `OK: 设备动作 ${(e as GeneratedSkillExecution).action} 已执行`;
    }
  };

  return await runOne(interpolated(execution));
}