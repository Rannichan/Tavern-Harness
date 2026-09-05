import type { GeneratedSkillExecution } from '../../types/models';
import {
  createWorkspaceFile,
  getWorkspaceFile,
  readFileContent,
  removeWorkspaceFile,
  sanitizeRelativePath,
} from './generatedWorkspace';

// ============================================================
// 生成式技能执行引擎（JavaScript 沙箱为 Web Worker + CSP）
// ============================================================

const MAX_OUTPUT_CHARS = 20_000;

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
  args: Record<string, unknown>
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
      return execShell(execution, args);
    case 'device_action':
      return execDeviceAction(execution, args);
    default:
      return `ERROR: 未知执行类型 ${(execution as GeneratedSkillExecution).type}`;
  }
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + '\n…(已截断)' : s;
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

// ---------- javascript（Web Worker 沙箱）----------
const workerUrlByCode = new Map<string, string>();
function createSandboxWorker(code: string): Worker {
  const src = `
    self.onmessage = (ev) => {
      const input = ev.data.input;
      let result;
      try {
        const timeout = setTimeout(() => { throw new Error('timeout'); }, 750);
        // 用 Function 将用户代码包在作用域内执行
        const fn = new Function('input', \`"use strict";\n${JSON.stringify(code)}\nreturn result;\`);
        result = fn(input);
        clearTimeout(timeout);
      } catch (e) {
        self.postMessage({ __error__: String(e && e.message || e) });
        return;
      }
      try {
        const safe = JSON.parse(JSON.stringify(result ?? null));
        self.postMessage({ result: safe });
      } catch (e) {
        self.postMessage({ __error__: 'result 不可序列化: ' + String(e) });
      }
    };
  `;
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
    const timer = setTimeout(() => {
      worker.terminate();
      resolve('ERROR: 脚本执行超时 (750ms)');
    }, 2000);
    worker.onmessage = (ev: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      if (ev.data && ev.data.__error__) {
        resolve(`ERROR: ${ev.data.__error__}`);
      } else {
        resolve(truncate(JSON.stringify(ev.data?.result ?? null)));
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

// ---------- file_read ----------
async function execFileRead(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
  try {
    const path = sanitizeRelativePath(interpolate(execution.path ?? '', args));
    const f = await getWorkspaceFile(path);
    if (!f) return `ERROR: 文件不存在: ${path}`;
    return truncate(f.content);
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

// ---------- shell（白名单命令模拟）----------
export const SHELL_ALLOWED = [
  'pwd', 'date', 'echo', 'printf', 'ls', 'cat', 'touch', 'mkdir', 'rm', 'cp', 'mv', 'head', 'tail',
  'wc', 'basename', 'dirname', 'sort', 'uniq', 'grep', 'cut', 'tr', 'sha256sum', 'md5sum', 'du',
  'diff', 'find', 'stat', 'cmp', 'sed',
];

async function execShell(execution: GeneratedSkillExecution, args: Record<string, unknown>): Promise<string> {
  const script = interpolate(execution.script ?? '', args);
  if (script.length > 8000) return 'ERROR: 脚本超过 8000 字符';
  const lines = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length > 20) return 'ERROR: 脚本行数超过 20';
  if (/[;&|`$<>]/.test(script.replace(/\$\{/g, ''))) return 'ERROR: 脚本包含禁止字符';

  const outputs: string[] = [];
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    const cmd = tokens[0];
    const rest = tokens.slice(1);
    if (!SHELL_ALLOWED.includes(cmd)) return `ERROR: 命令 ${cmd} 不在白名单`;
    try {
      outputs.push(await runShellCommand(cmd, rest));
    } catch (e) {
      return `ERROR: ${cmd}: ${(e as Error).message}`;
    }
  }
  return truncate(outputs.join('\n'));
}

async function runShellCommand(cmd: string, args: string[]): Promise<string> {
  const files = await listAllFiles();
  const cwd = files; // 模拟目录
  switch (cmd) {
    case 'pwd':
      return '/generated_skill_workspace';
    case 'date': {
      const fmt = args.join(' ') || undefined;
      const d = new Date();
      if (fmt === '-u') return d.toISOString();
      return d.toString();
    }
    case 'echo':
      return args.join(' ').replace(/^["']|["']$/g, '');
    case 'printf': {
      // 仅支持 %s %d
      return args.map((a) => a.replace(/^%[sd]\s?/, '')).join(' ').trim();
    }
    case 'ls': {
      const showAll = args.includes('-a') || args.includes('-l') || args.includes('-al') || args.includes('-la');
      return files.map((f) => (showAll ? f : f.replace(/^\./, ''))).join('\n') || '(空)';
    }
    case 'cat': {
      const path = args.join(' ').replace(/^["']|["']$/g, '');
      const f = files.find((f) => f === path);
      if (!f) throw new Error(`文件不存在: ${path}`);
      return await readFileContent(path);
    }
    case 'touch': {
      const path = args.join(' ').replace(/^["']|["']$/g, '');
      const existing = await getWorkspaceFile(path);
      if (!existing) await createWorkspaceFile(path, '');
      return '';
    }
    case 'mkdir': {
      const path = args.filter((a) => a !== '-p').join(' ').replace(/^["']|["']$/g, '');
      await createWorkspaceFile(path + '/.keep', '');
      return '';
    }
    case 'rm': {
      const path = args.filter((a) => a !== '-f' && a !== '-r').join(' ').replace(/^["']|["']$/g, '');
      if (path === '*') {
        for (const f of files) await removeWorkspaceFile(f);
        return '';
      }
      await removeWorkspaceFile(path);
      return '';
    }
    case 'head': {
      const n = args.includes('-n') ? parseInt(args[args.indexOf('-n') + 1] ?? '10', 10) || 10 : 10;
      const path = args[args.length - 1];
      if (args.length === 1 && !isNaN(parseInt(args[0]))) {
        // head -5 (stdin 不支持，直接返回空)
        return '(无 stdin)';
      }
      const content = await readFileContent(path);
      return content.split('\n').slice(0, Math.max(1, Math.min(1000, n))).join('\n');
    }
    case 'tail': {
      const n = args.includes('-n') ? parseInt(args[args.indexOf('-n') + 1] ?? '10', 10) || 10 : 10;
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      return content.split('\n').slice(-Math.max(1, Math.min(1000, n))).join('\n');
    }
    case 'wc': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const lines = content.split('\n').length - 1;
      const words = content.split(/\s+/).filter(Boolean).length;
      const chars = content.length;
      return `${lines} ${words} ${chars} ${path}`;
    }
    case 'basename':
      return args[0] ? args[0].split('/').pop() ?? '' : '';
    case 'dirname':
      return args[0] ? (args[0].split('/').slice(0, -1).join('/') || '.') : '.';
    case 'grep': {
      const pattern = args.find((a) => !a.startsWith('-')) ?? '';
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const caseInsensitive = flags.includes('i');
      const invert = flags.includes('v');
      const re = new RegExp(pattern, caseInsensitive ? 'i' : '');
      return content
        .split('\n')
        .filter((l, i) => {
          const m = re.test(l);
          if (invert) return !m;
          return m;
        })
        .join('\n');
    }
    case 'sort': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const lines = content.split('\n');
      if (args.includes('-r') || args.includes('-nr') || args.includes('-rn')) lines.reverse();
      if (args.includes('-n') || args.includes('-nr') || args.includes('-rn')) {
        lines.sort((a, b) => parseFloat(a) - parseFloat(b));
      } else {
        lines.sort();
      }
      if (args.includes('-u')) return [...new Set(lines)].join('\n');
      return lines.join('\n');
    }
    case 'uniq': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const lines = content.split('\n');
      const out: string[] = [];
      for (const l of lines) {
        if (args.includes('-d')) {
          if (!out.includes(l) && lines.filter((x) => x === l).length > 1) out.push(l);
        } else if (args.includes('-u')) {
          if (lines.filter((x) => x === l).length === 1) out.push(l);
        } else {
          if (!out[out.length - 1]?.includes(l)) out.push(l);
        }
      }
      return out.join('\n');
    }
    case 'cut': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const cFlag = args.find((a) => a.startsWith('-c'))?.slice(2);
      const fFlag = args.find((a) => a.startsWith('-f'))?.slice(2);
      const d = args[args.indexOf('-d') + 1] ?? '\t';
      return content
        .split('\n')
        .map((line) => {
          if (cFlag) {
            const [start, end] = cFlag.split('-').map((n) => (n ? parseInt(n, 10) : null));
            const chars = line.split('');
            const s = (start ?? 1) - 1;
            const e = end ?? chars.length;
            return chars.slice(s, e).join('');
          }
          if (fFlag) {
            const parts = line.split(d);
            if (fFlag.includes('-')) {
              const [start, end] = fFlag.split('-').map((n) => (n ? parseInt(n, 10) : null));
              return parts.slice((start ?? 1) - 1, end ?? parts.length).join(d);
            }
            return fFlag.split(',').map((n) => parts[parseInt(n, 10) - 1] ?? '').join(d);
          }
          return line;
        })
        .join('\n');
    }
    case 'sha256sum': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const hash = await sha256(content);
      return `${hash}  ${path}`;
    }
    case 'md5sum': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const hash = await md5(content);
      return `${hash}  ${path}`;
    }
    case 'du': {
      // 简化：文件大小
      return files.length === 0 ? '0' : files.map((f) => f).join(' ');
    }
    case 'find': {
      return files.join('\n');
    }
    case 'stat': {
      const path = args[args.length - 1];
      const f = await getWorkspaceFile(path);
      if (!f) throw new Error(`文件不存在: ${path}`);
      const fmt = args[args.indexOf('-c') + 1] ?? '%s';
      if (fmt === '%s') return String(f.content.length);
      return JSON.stringify({ path, size: f.content.length, mtime: new Date(f.updatedAt).toISOString() });
    }
    case 'cmp': {
      const fileA = args[0];
      const fileB = args[1];
      if (args.includes('-s')) return '';
      const a = await readFileContent(fileA);
      const b = await readFileContent(fileB);
      return a === b ? '' : `${fileA} ${fileB} differ: char 1, line 1`;
    }
    case 'sed': {
      const path = args[args.length - 1];
      const content = await readFileContent(path);
      const expr = args[0].replace(/^["']|["']$/g, '');
      const m = expr.match(/^s\/(.*?)\/(.*?)\/([gip]*)$/);
      if (m) {
        const [_, pattern, repl, flags] = m;
        let text = content;
        const global = flags.includes('g');
        const caseIns = flags.includes('i');
        const re = new RegExp(pattern, caseIns ? (global ? 'gi' : 'i') : global ? 'g' : '');
        text = text.replace(re, repl);
        return text;
      }
      // 打印行 N[,M]p
      const pm = expr.match(/^(\d+)(?:,(\d+))?p$/);
      if (pm) {
        const start = parseInt(pm[1], 10);
        const end = pm[2] ? parseInt(pm[2], 10) : start;
        return content.split('\n').filter((_, i) => i + 1 >= start && i + 1 <= end).join('\n');
      }
      return content;
    }
    case 'cp': {
      const [src, dst] = args;
      const content = await readFileContent(src);
      await createWorkspaceFile(dst, content);
      return '';
    }
    case 'mv': {
      const [src, dst] = args;
      const content = await readFileContent(src);
      await removeWorkspaceFile(src);
      await createWorkspaceFile(dst, content);
      return '';
    }
    case 'diff': {
      const fileA = args[args.length - 2];
      const fileB = args[args.length - 1];
      const a = (await readFileContent(fileA)).split('\n');
      const b = (await readFileContent(fileB)).split('\n');
      const out: string[] = [];
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (a[i] !== b[i]) {
          if (a[i] != null) out.push(`< ${a[i]}`);
          if (b[i] != null) out.push(`> ${b[i]}`);
        }
      }
      return out.join('\n') || '(无差异)';
    }
    default:
      return `ERROR: 命令 ${cmd} 未实现`;
  }
}

async function listAllFiles(): Promise<string[]> {
  const files = await listAllFromWorkspace();
  return files;
}

async function listAllFromWorkspace(): Promise<string[]> {
  const { listWorkspaceFiles } = await import('./generatedWorkspace');
  const files = await listWorkspaceFiles();
  return files.map((f) => f.path.split('/').slice(1).join('/'));
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function md5(text: string): Promise<string> {
  // 简化实现（Web Crypto 不支持 md5）；用作演示
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
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