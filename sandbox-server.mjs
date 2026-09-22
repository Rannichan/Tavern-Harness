#!/usr/bin/env node
// ============================================================
// 生成式技能受控本地命令执行服务（可选，独立进程）
//
// 默认不启动。启动后 vite 开发服务器会把 /api-v2/exec 转发到本服务，
// 前端生成式技能的 shell 类型即可真实执行命令。
//
// 执行模型：
//   - 仅监听 127.0.0.1（不回显到局域网）
//   - 白名单命令直接执行，无需确认
//   - 任一非白名单命令均需用户批准并回传服务端签发的一次性确认票据
//   - 支持受控的 &&、||、; 连接符；无 shell 解释器（spawn shell:false），
//     不支持管道、重定向、变量展开或命令替换
//   - 单条命令 5s 超时，超时即 kill 进程树
//   - 输出截断 64KB，合并 stderr
//
// 启动：node sandbox-server.mjs [port]   （默认 17891）
// 锁文件：.sandbox-port（写端口号，供 vite 插件读取）
// ============================================================

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  writeFileSync, existsSync, lstatSync, readlinkSync, readFileSync, readFile, writeFile, mkdirSync, mkdtempSync, readdir, stat, statSync, symlinkSync, unlink, realpathSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.SANDBOX_PORT || 17891);
const LOCK_FILE = join(__dirname, '.sandbox-port');
const SERVICE_TOKEN = process.env.COMMAND_SERVICE_TOKEN;
const APPROVAL_TOKEN = process.env.COMMAND_APPROVAL_TOKEN;
if (!SERVICE_TOKEN || !APPROVAL_TOKEN) {
  console.error('[command-service] missing COMMAND_SERVICE_TOKEN or COMMAND_APPROVAL_TOKEN');
  process.exit(1);
}

// ---- Windows 适配 ----
// 该命令集为 Unix 风格。Windows 上尽量使用 Git for Windows 自带的
// usr/bin 工具（bool 验证过 pwd/ls/date/echo 等均存在）。
const IS_WIN = process.platform === 'win32';
function findGitUsrBin() {
  if (!IS_WIN) return null;
  const candidates = [
    // 常见 Git 安装位置（不含 \cmd 的父级为安装根，usr\bin 在根下）
    'C:\\Program Files\\Git\\usr\\bin',
    'C:\\Program Files (x86)\\Git\\usr\\bin',
  ];
  try {
    const which = spawnSync('where', ['git'], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout) {
      const gitPath = which.stdout.split(/\r?\n/).find((l) => l.trim());
      if (gitPath) {
        const root = dirname(dirname(gitPath)); // 去掉 \cmd\git.exe
        const p = join(root, 'usr', 'bin');
        if (existsSync(join(p, 'pwd.exe'))) return p;
      }
    }
  } catch { /* ignore */ }
  for (const c of candidates) if (existsSync(join(c, 'pwd.exe'))) return c;
  return null;
}
const GIT_USR_BIN = findGitUsrBin();
const SANDBOX_ENV_ROOT = mkdtempSync(join(tmpdir(), 'tavern-harness-env-'));
const SANDBOX_HOME = join(SANDBOX_ENV_ROOT, 'home');
const SANDBOX_TMP = join(SANDBOX_ENV_ROOT, 'tmp');
mkdirSync(SANDBOX_HOME, { recursive: true });
mkdirSync(SANDBOX_TMP, { recursive: true });
process.once('exit', () => rmSync(SANDBOX_ENV_ROOT, { recursive: true, force: true }));

// 子进程仅继承运行所需变量；Git usr\bin 放在 PATH 最前，保证 Unix 命令优先。
const SPAWN_ENV = {
  PATH: GIT_USR_BIN ? `${GIT_USR_BIN}${delimiter}${process.env.PATH ?? ''}` : (process.env.PATH ?? ''),
  LANG: process.env.LANG ?? 'C.UTF-8',
  LC_ALL: process.env.LC_ALL ?? '',
  HOME: SANDBOX_HOME,
  TMPDIR: SANDBOX_TMP,
};

/**
 * 命令行分词：支持单引号/双引号（去引号）、反斜杠转义、引号内空白保持原样。
 * `& | ; > < $ ( ) \` 等字符在引号外保持字面量（不作为 shell 操作符）——
 * 仍然每行一条命令、经 spawn 直接执行（无 shell 解释器），不构成拼接/注入。
 * 参数以空白开头/结尾（如 printf 的 \n" 结尾）会被 trim 掉，与之前行为一致。
 */
function tokenize(line) {
  const tokens = [];
  let cur = null;   // 当前 token 缓冲（null 表示不在 token 中）
  let quote = null; // null | "'" | '"'
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        // 双引号内只转义 \" \\；其余反斜杠保留字面量（与 bash 一致）
        const nx = line[i + 1];
        if (nx === '"' || nx === '\\') {
          cur += nx;
          i += 2;
          continue;
        }
        cur += ch;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (cur === null) cur = '';
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      // 引号外：反斜杠转义下一个字符，避免引号被当作语法（如 \" 保留为字面量 "）
      if (cur === null) cur = '';
      cur += line[i + 1];
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== null) {
        tokens.push(cur);
        cur = null;
      }
      i += 1;
      continue;
    }
    if (cur === null) cur = '';
    cur += ch;
    i += 1;
  }
  if (cur !== null) tokens.push(cur);
  return tokens;
}

/** 在引号与转义之外拆分受控连接符，不解释任何其它 shell 语法。 */
function parseCommandLine(line) {
  const commands = [];
  const operators = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    const operator = line.startsWith('&&', i) ? '&&' : line.startsWith('||', i) ? '||' : ch === ';' ? ';' : null;
    if (!operator) continue;
    const command = line.slice(start, i).trim();
    if (!command) throw new Error(`连接符 ${operator} 前缺少命令`);
    commands.push(command);
    operators.push(operator);
    i += operator.length - 1;
    start = i + 1;
  }
  if (quote) throw new Error('命令包含未闭合的引号');
  const command = line.slice(start).trim();
  if (!command) throw new Error('连接符后缺少命令');
  commands.push(command);
  return { commands, operators };
}

// ---- 白名单：可直接执行；名单外命令统一请求用户许可 ----
const SHELL_ALLOWLIST_GROUPS = {
  basicInfo: [
    'pwd', 'date', 'whoami', 'uname', 'hostname', 'uptime', 'which',
  ],
  fileAndDirectory: [
    'ls', 'touch', 'mkdir', 'cp', 'basename', 'dirname', 'du', 'stat', 'file',
  ],
  textProcessing: [
    'echo', 'printf', 'cat', 'head', 'tail', 'wc', 'uniq', 'grep', 'cut', 'tr',
    'diff', 'cmp', 'od', 'xxd', 'hexdump', 'strings', 'tee', 'jq',
  ],
  systemQuery: [
    'localectl', 'timedatectl', 'ffprobe',
  ],
  logicAndMath: [
    'true', 'false', 'seq', 'factor', 'bc', 'sha256sum', 'md5sum', 'cksum', 'sum',
  ],
};
const SHELL_ALLOWED_REAL = new Set(Object.values(SHELL_ALLOWLIST_GROUPS).flat());

const TRUSTED_COMMAND_DIRS = (IS_WIN
  ? [GIT_USR_BIN]
  : ['/bin', '/usr/bin', '/usr/sbin', '/sbin'])
  .filter(Boolean)
  .map((dir) => {
    try {
      return realpathSync(dir);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

function resolveTrustedCommand(command) {
  const names = IS_WIN ? [`${command}.exe`, command] : [command];
  for (const trustedDir of TRUSTED_COMMAND_DIRS) {
    for (const name of names) {
      const candidate = join(trustedDir, name);
      if (!existsSync(candidate)) continue;
      try {
        const resolved = realpathSync(candidate);
        if (!resolved.startsWith(trustedDir + sep)) return null;
        if (IS_WIN) return resolved; // Windows 无 POSIX 权限位（Git usr/bin 的 exe 显示 666），跳过 uid/writable 校验
        const executable = statSync(resolved);
        const writableByNonOwner = (executable.mode & 0o022) !== 0;
        if (executable.uid === 0 && !writableByNonOwner) return resolved;
      } catch { /* try next candidate */ }
    }
  }
  return null;
}

const TRUSTED_COMMAND_PATHS = new Map(
  [...SHELL_ALLOWED_REAL]
    .map((command) => [command, resolveTrustedCommand(command)])
    .filter((entry) => entry[1])
);

const MAX_LINES = 20;
const MAX_SCRIPT_CHARS = 8000;
const MAX_OUTPUT = 64 * 1024;
const CMD_TIMEOUT_MS = 5000;
const CONFIRMATION_TTL_MS = 60_000;
const MAX_PENDING_CONFIRMATIONS = 1000;
const pendingConfirmations = new Map();

function confirmationDigest(operation, sessionBase) {
  return createHash('sha256')
    .update(operation)
    .update('\0')
    .update(sessionBase)
    .digest();
}

function issueConfirmationRequest(operation, sessionBase) {
  const now = Date.now();
  for (const [requestId, entry] of pendingConfirmations) {
    if (entry.expiresAt <= now) pendingConfirmations.delete(requestId);
  }
  while (pendingConfirmations.size >= MAX_PENDING_CONFIRMATIONS) {
    pendingConfirmations.delete(pendingConfirmations.keys().next().value);
  }
  const requestId = randomBytes(32).toString('base64url');
  pendingConfirmations.set(requestId, {
    digest: confirmationDigest(operation, sessionBase),
    expiresAt: now + CONFIRMATION_TTL_MS,
    approved: false,
  });
  return requestId;
}

function approveConfirmationRequest(requestId) {
  if (typeof requestId !== 'string' || !requestId) return false;
  const entry = pendingConfirmations.get(requestId);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    pendingConfirmations.delete(requestId);
    return false;
  }
  entry.approved = true;
  return true;
}

function consumeApprovedConfirmation(requestId, operation, sessionBase) {
  if (typeof requestId !== 'string' || !requestId) return false;
  const entry = pendingConfirmations.get(requestId);
  if (!entry || !entry.approved) return false;
  pendingConfirmations.delete(requestId);
  if (entry.expiresAt <= Date.now()) return false;
  return timingSafeEqual(entry.digest, confirmationDigest(operation, sessionBase));
}

// ---- 真实文件工作区（generate_skill 的 file_read / file_write 落盘区） ----
// 项目根目录下 sandbox_workspace/，仅允许读写该目录内文件（虚拟磁盘）。
// 会话隔离：每次请求必须携带会话工作目录（session 字段，如 "session-12"），
// 所有读写/执行都锁定在该目录内，不允许回退到共享根工作区。
const WORKSPACE_ROOT = resolve(__dirname, 'sandbox_workspace');
const PUBLIC_WORKSPACE = join(WORKSPACE_ROOT, 'public');
const MAX_FILE_READ_CHARS = 100_000;   // 单文件读取上限（与前端虚拟工作区一致）
const MAX_FILE_WRITE_BYTES = 400 * 1024; // 单文件写入上限 400KB
const MAX_LIST_ENTRIES = 500;
// 会话工作目录的安全字符集：仅允许小写字母数字、下划线、斜杠、点、连字符，
// 防止路径穿越/注入（由前端按会话 id 生成，如 "session-12"）
const SESSION_DIR_RE = /^[a-z0-9_.-]+$/;

/**
 * 解析会话工作目录。仅允许 sandbox_workspace 下的单层目录。
 */
function resolveSessionBase(session) {
  if (session === undefined || session === null) throw new Error('缺少合法的会话工作目录');
  const raw = String(session).replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw === '.' || raw === '..' || !SESSION_DIR_RE.test(raw)) {
    throw new Error('缺少合法的会话工作目录');
  }
  return join(WORKSPACE_ROOT, raw);
}

/** 创建会话目录，并为普通会话提供固定的只读公共目录入口。 */
function ensureSessionBase(base) {
  mkdirSync(PUBLIC_WORKSPACE, { recursive: true });
  mkdirSync(base, { recursive: true });
  if (base === PUBLIC_WORKSPACE) return;
  const publicLink = join(base, 'public');
  if (existsSync(publicLink)) {
    if (!lstatSync(publicLink).isSymbolicLink() || realpathSync(publicLink) !== realpathSync(PUBLIC_WORKSPACE)) {
      throw new Error('会话 public 入口不是合法的公共目录链接');
    }
  } else {
    symlinkSync(IS_WIN ? PUBLIC_WORKSPACE : '../public', publicLink, IS_WIN ? 'junction' : 'dir');
  }
}

/** 相对路径校验：禁止绝对路径、.. 等，锁定在会话工作目录内 */
function sanitizeWorkspaceRelativePath(p) {
  const normalized = String(p).replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/')) throw new Error('非法路径');
  const parts = normalized.split('/').filter((s) => s && s !== '.');
  if (parts.length === 0) throw new Error('非法路径');
  if (parts.some((s) => s === '..')) throw new Error('路径不能包含 ..');
  return parts.join('/');
}

function workspacePathFor(rel, base) {
  const safe = sanitizeWorkspaceRelativePath(rel);
  return join(base, ...safe.split('/'));
}

/** 校验最终解析路径仍在会话工作目录内（防符号链接逃逸） */
function assertInside(root, p) {
  const rp = resolve(p);
  if (rp !== root && !rp.startsWith(root + sep)) throw new Error('路径超出工作区');
}

function isInside(root, p) {
  return p === root || p.startsWith(root + sep);
}

function assertWritableParent(base, parent) {
  let existing = parent;
  while (!existsSync(existing) && existing !== base) existing = dirname(existing);
  assertInside(base, realpathSync(existing));
}

// ---- HTTP 服务 ----
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const suppliedToken = req.headers['x-command-service-token'];
  const tokenMatches = typeof suppliedToken === 'string'
    && suppliedToken.length === SERVICE_TOKEN.length
    && timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(SERVICE_TOKEN));
  if (!tokenMatches) {
    res.writeHead(401);
    res.end(JSON.stringify({ ok: false, message: 'unauthorized' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
    return;
  }

  if (req.url === '/approve') {
    const suppliedApprovalToken = req.headers['x-command-approval-token'];
    const approvalTokenMatches = typeof suppliedApprovalToken === 'string'
      && suppliedApprovalToken.length === APPROVAL_TOKEN.length
      && timingSafeEqual(Buffer.from(suppliedApprovalToken), Buffer.from(APPROVAL_TOKEN));
    if (!approvalTokenMatches) {
      res.writeHead(401);
      res.end(JSON.stringify({ ok: false, message: 'approval unauthorized' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    if (body.length > 16 * 1024) {
      res.writeHead(413);
      res.end(JSON.stringify({ ok: false, message: 'body too large' }));
      return;
    }
    try {
      const payload = JSON.parse(body);
      const approved = approveConfirmationRequest(payload?.confirmationRequestId);
      res.writeHead(approved ? 200 : 404);
      res.end(JSON.stringify({ ok: approved, message: approved ? undefined : 'confirmation request not found or expired' }));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: 'invalid json' }));
    }
    return;
  }

  // ---- 真实文件工作区端点（file_read / file_write / file_list） ----
  if (req.url === '/file_read' || req.url === '/file_write' || req.url === '/file_list') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (body.length > 512 * 1024) {
      res.writeHead(413);
      res.end(JSON.stringify({ ok: false, message: 'body too large' }));
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: 'invalid json' }));
      return;
    }
    try {
      // 会话隔离：同一端点按会话工作目录读写文件（互不影响）
      const base = resolveSessionBase(payload?.session);
      if (req.url === '/file_read') {
        const rawPath = String(payload?.path ?? '').replace(/\\/g, '/').trim();
        if (!rawPath) throw new Error('非法路径');
        const rel = sanitizeWorkspaceRelativePath(rawPath);
        const readingPublicLink = base !== PUBLIC_WORKSPACE && (rel === 'public' || rel.startsWith('public/'));
        if (!readingPublicLink && resolvesOutsideSession(rel, base)) {
          throw new Error('路径超出工作区');
        }
        const fp = resolve(base, rel);
        const text = await readFileAsync(fp);
        res.end(JSON.stringify({ ok: true, path: rel, content: text.slice(0, MAX_FILE_READ_CHARS) }));
      } else if (req.url === '/file_write') {
        const rawPath = String(payload?.path ?? '').replace(/\\/g, '/').trim();
        if (!rawPath) throw new Error('非法路径');
        const mode = payload?.mode === 'append' ? 'append' : 'write';
        const content = String(payload?.content ?? '');
        ensureSessionBase(base);
        const rel = sanitizeWorkspaceRelativePath(rawPath);
        if (base !== PUBLIC_WORKSPACE && (rel === 'public' || rel.startsWith('public/'))) {
          throw new Error('public 目录仅允许读取，不允许写入');
        }
        if (resolvesOutsideSession(rel, base)) {
          throw new Error('路径超出工作区');
        }
        const fp = resolve(base, rel);
        assertWritableParent(base, dirname(fp));
        mkdirSync(dirname(fp), { recursive: true });
        assertInside(base, realpathSync(dirname(fp)));
        if (existsSync(fp)) assertInside(base, realpathSync(fp));
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_WRITE_BYTES) {
          throw new Error(`文件超过 ${MAX_FILE_WRITE_BYTES / 1024}KB 上限`);
        }
        if (mode === 'append') {
          const existing = existsSync(fp) ? await readFilePromise(fp, 'utf8') : '';
          await writeFilePromise(fp, existing + content, 'utf8');
        } else {
          await writeFilePromise(fp, content, 'utf8');
        }
        res.end(JSON.stringify({ ok: true, path: rel, mode, bytes: Buffer.byteLength(content, 'utf8') }));
      } else {
        // file_list：返回会话工作目录内的相对路径（分组目录）
        const files = [];
        await walkWorkspace(base, '', files);
        files.sort();
        const sliced = files.slice(0, MAX_LIST_ENTRIES);
        res.end(JSON.stringify({ ok: true, files: sliced, truncated: files.length > MAX_LIST_ENTRIES }));
      }
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: String((e && e.message) || e) }));
    }
    return;
  }

  // ---- 会话工作目录生命周期：对话创建时预建目录、删除对话时清理目录 ----
  // session_create：幂等，目录已存在则无操作；session_delete：递归删除并忽略不存在。
  // 必须带合法会话工作目录（resolveSessionBase 已拦截 .. / 绝对路径 / 非法字符）。
  if (req.url === '/session_create' || req.url === '/session_delete') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (body.length > 64 * 1024) {
      res.writeHead(413);
      res.end(JSON.stringify({ ok: false, message: 'body too large' }));
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: 'invalid json' }));
      return;
    }
    try {
      const base = resolveSessionBase(payload?.session);
      if (req.url === '/session_create') {
        ensureSessionBase(base);
      } else {
        if (base === PUBLIC_WORKSPACE) throw new Error('公共工作目录不可删除');
        rmSync(base, { recursive: true, force: true });
      }
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: String((e && e.message) || e) }));
    }
    return;
  }

  if (req.url !== '/exec') {
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  if (body.length > 64 * 1024) {
    res.writeHead(413);
    res.end(JSON.stringify({ ok: false, message: 'body too large' }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, message: 'invalid json' }));
    return;
  }
  const script = String(payload?.script ?? '');
  // 会话隔离：shell 命令在会话工作目录（cwd）下执行；自动创建目录
  let sessionBase;
  try {
    sessionBase = resolveSessionBase(payload?.session);
  } catch (e) {
    res.end(JSON.stringify({ ok: false, message: String((e && e.message) || e) }));
    return;
  }
  ensureSessionBase(sessionBase);

  // 校验：非白名单命令只能凭服务端签发、绑定脚本与会话的一次性票据执行。
  let check = validateScript(script, sessionBase);
  if (check?.needConfirmReason) {
    if (!consumeApprovedConfirmation(payload?.confirmationRequestId, script, sessionBase)) {
      const confirmationRequestId = issueConfirmationRequest(script, sessionBase);
      res.end(JSON.stringify({
        ok: false,
        needConfirm: true,
        confirmationReason: check.needConfirmReason,
        confirmationRequestId,
        confirmationExpiresInMs: CONFIRMATION_TTL_MS,
        message: '脚本包含非白名单命令，需要用户确认',
      }));
      return;
    }
    check = null;
  }
  if (check) {
    res.end(JSON.stringify({ ok: false, message: check }));
    return;
  }

  const lines = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  const outputs = [];
  for (const line of lines) {
    try {
      const { commands, operators } = parseCommandLine(line.trim());
      let lastCode = 0;
      let lastError = '';
      for (let i = 0; i < commands.length; i++) {
        const previousOperator = operators[i - 1];
        if ((previousOperator === '&&' && lastCode !== 0) || (previousOperator === '||' && lastCode === 0)) continue;
        const result = await runOne(commands[i], sessionBase);
        lastCode = result.code;
        lastError = result.stderr || (lastCode !== 0 ? `退出码 ${lastCode}` : '');
        if (result.stdout) outputs.push(result.stdout.trimEnd());
        if (result.stderr) outputs.push(result.stderr.trimEnd());
      }
      if (lastCode !== 0) throw new Error(lastError);
    } catch (e) {
      res.end(JSON.stringify({ ok: false, message: `${line.trim()}:\n${(e).message}` }));
      return;
    }
  }
  res.end(JSON.stringify({ ok: true, output: outputs.join('\n').slice(0, MAX_OUTPUT) }));
});

// ---- 校验与执行 ----
/**
 * 返回 null → 全部命令均在白名单；'NEED_CONFIRM' → 至少一个命令不在白名单；字符串 → 拒绝原因
 */
function extractPathCandidate(value) {
  if (!value || value === '-') return null;
  let candidate = value;
  if (value.startsWith('-')) {
    const equalsIndex = value.indexOf('=');
    const traversalIndex = value.indexOf('..');
    const absoluteIndex = value.indexOf('/');
    const pathIndex = equalsIndex >= 0
      ? equalsIndex + 1
      : traversalIndex >= 0
        ? traversalIndex
        : absoluteIndex >= 0
          ? absoluteIndex
          : -1;
    if (pathIndex < 0) return null;
    candidate = value.slice(pathIndex);
  }
  return candidate || null;
}

function isPublicLinkReadPath(value, sessionBase) {
  if (sessionBase === PUBLIC_WORKSPACE) return false;
  const candidate = extractPathCandidate(value);
  if (!candidate) return false;
  const normalized = candidate.replace(/\\/g, '/').trim();
  return normalized === 'public' || normalized.startsWith('public/');
}

function resolvesOutsideSession(value, sessionBase) {
  const candidate = extractPathCandidate(value);
  if (!candidate) return false;
  const target = resolve(sessionBase, candidate);
  if (!isInside(sessionBase, target)) return true;

  try {
    const realBase = realpathSync(sessionBase);
    const relativeTarget = target.slice(sessionBase.length).split(sep).filter(Boolean);
    let resolvedPrefix = realBase;
    let symlinkHops = 0;
    for (const part of relativeTarget) {
      const next = join(resolvedPrefix, part);
      try {
        if (lstatSync(next).isSymbolicLink()) {
          resolvedPrefix = resolve(dirname(next), readlinkSync(next));
        } else {
          resolvedPrefix = next;
        }
      } catch {
        resolvedPrefix = next;
      }
      if (!isInside(realBase, resolvedPrefix)) return true;
      while (true) {
        try {
          if (!lstatSync(resolvedPrefix).isSymbolicLink()) break;
          if (++symlinkHops > 40) return true;
          resolvedPrefix = resolve(dirname(resolvedPrefix), readlinkSync(resolvedPrefix));
          if (!isInside(realBase, resolvedPrefix)) return true;
        } catch {
          break;
        }
      }
    }
    return false;
  } catch {
    return true;
  }
}

function operandsAfterOptions(args, optionsWithValues = new Set()) {
  const operands = [];
  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!optionsEnded && arg === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith('-') && arg !== '-') {
      const option = arg.split('=', 1)[0];
      if (!arg.includes('=') && optionsWithValues.has(option)) index += 1;
      continue;
    }
    operands.push(arg);
  }
  return operands;
}

function shellWriteTargets(command, args) {
  if (command === 'touch') {
    return operandsAfterOptions(args, new Set(['-d', '--date', '-r', '--reference', '-t']));
  }
  if (command === 'mkdir') {
    return operandsAfterOptions(args, new Set(['-m', '--mode', '-Z', '--context']));
  }
  if (command === 'tee') return operandsAfterOptions(args);
  if (command === 'uniq') {
    const operands = operandsAfterOptions(args, new Set([
      '-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars',
    ]));
    return operands.length > 1 ? [operands[1]] : [];
  }
  if (command === 'xxd') {
    const operands = operandsAfterOptions(args, new Set([
      '-a', '-c', '-cols', '-g', '-groupsize', '-l', '-len', '-o', '-s', '-seek',
    ]));
    return operands.length > 1 ? [operands[1]] : [];
  }
  if (command === 'cp') {
    let targetDirectory = null;
    const operands = [];
    let optionsEnded = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (!optionsEnded && arg === '--') {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && (arg === '-t' || arg === '--target-directory')) {
        targetDirectory = args[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (!optionsEnded && arg.startsWith('--target-directory=')) {
        targetDirectory = arg.slice('--target-directory='.length);
        continue;
      }
      if (!optionsEnded && arg.startsWith('-t') && arg.length > 2) {
        targetDirectory = arg.slice(2);
        continue;
      }
      if (!optionsEnded && arg.startsWith('-') && arg !== '-') continue;
      operands.push(arg);
    }
    if (targetDirectory) return [targetDirectory];
    return operands.length > 1 ? [operands.at(-1)] : [];
  }
  return [];
}

function shellReadTargets(command, args) {
  if (['ls', 'du', 'stat', 'file', 'basename', 'dirname', 'sha256sum', 'md5sum', 'cksum', 'sum', 'ffprobe'].includes(command)) {
    return operandsAfterOptions(args);
  }
  if (['cat', 'head', 'tail', 'wc', 'od', 'hexdump', 'strings', 'cut'].includes(command)) {
    return operandsAfterOptions(args, new Set(['-n', '-c', '-s', '-w', '-f', '--fields']));
  }
  if (command === 'uniq') {
    const operands = operandsAfterOptions(args, new Set([
      '-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars',
    ]));
    return operands.length > 0 ? [operands[0]] : [];
  }
  if (command === 'xxd') {
    const operands = operandsAfterOptions(args, new Set([
      '-a', '-c', '-cols', '-g', '-groupsize', '-l', '-len', '-o', '-s', '-seek',
    ]));
    return operands.length > 0 ? [operands[0]] : [];
  }
  if (command === 'grep') {
    const operands = operandsAfterOptions(args, new Set([
      '-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C',
    ]));
    return operands.length > 1 ? operands.slice(1) : [];
  }
  if (command === 'tr') return [];
  if (command === 'diff' || command === 'cmp') {
    const operands = operandsAfterOptions(args);
    return operands.slice(0, 2);
  }
  if (command === 'cp') {
    let targetDirectory = null;
    const operands = [];
    let optionsEnded = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (!optionsEnded && arg === '--') {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && (arg === '-t' || arg === '--target-directory')) {
        targetDirectory = args[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (!optionsEnded && arg.startsWith('--target-directory=')) {
        targetDirectory = arg.slice('--target-directory='.length);
        continue;
      }
      if (!optionsEnded && arg.startsWith('-t') && arg.length > 2) {
        targetDirectory = arg.slice(2);
        continue;
      }
      if (!optionsEnded && arg.startsWith('-') && arg !== '-') continue;
      operands.push(arg);
    }
    if (targetDirectory) return operands;
    return operands.length > 1 ? operands.slice(0, -1) : [];
  }
  if (command === 'jq') {
    const operands = operandsAfterOptions(args, new Set([
      '-f', '--from-file', '-L',
    ]));
    if (operands.length === 0) return [];
    if (operands.length === 1) return [];
    return operands.slice(1);
  }
  return [];
}

function validateScript(script, sessionBase) {
  if (script.length > MAX_SCRIPT_CHARS) return '脚本超过 8000 字符';
  const lines = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) return '空脚本';
  let commandCount = 0;
  let hasNonAllowlistedCommand = false;
  let hasExternalWrite = false;
  let hasExternalRead = false;
  for (const line of lines) {
    let commands;
    try {
      commands = parseCommandLine(line.trim()).commands;
    } catch (e) {
      return e.message;
    }
    commandCount += commands.length;
    if (commandCount > MAX_LINES) return '脚本命令数超过 20';
    for (const command of commands) {
      const [cmd, ...args] = tokenize(command);
      if (!SHELL_ALLOWED_REAL.has(cmd)) hasNonAllowlistedCommand = true;
      if (shellWriteTargets(cmd, args).some((arg) => resolvesOutsideSession(arg, sessionBase))) {
        hasExternalWrite = true;
      }
      if (shellReadTargets(cmd, args).some((arg) => (
        !isPublicLinkReadPath(arg, sessionBase) && resolvesOutsideSession(arg, sessionBase)
      ))) {
        hasExternalRead = true;
      }
    }
  }
  if (hasExternalRead) return '脚本读取路径必须位于当前会话工作目录（仅允许通过 public 链接读取公共目录）';
  if (hasExternalWrite) return '脚本写入路径必须位于当前会话工作目录（public 链接只读）';
  if (hasNonAllowlistedCommand) return { needConfirmReason: 'non_allowlisted' };
  return null;
}

function runOne(line, sessionBase) {
  const tokens = tokenize(line);
  let cmd = tokens[0];
  const args = tokens.slice(1);
  const trustedPath = SHELL_ALLOWED_REAL.has(cmd) ? TRUSTED_COMMAND_PATHS.get(cmd) : null;
  if (SHELL_ALLOWED_REAL.has(cmd) && !trustedPath) {
    return Promise.reject(new Error(`白名单命令 ${cmd} 在受信任系统目录中不可用`));
  }
  if (trustedPath) {
    cmd = trustedPath;
  }
  return new Promise((resolve, reject) => {
    const cwd = sessionBase;
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SPAWN_ENV,
      detached: !IS_WIN,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (IS_WIN) {
          const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          if (killed.error || killed.status !== 0) child.kill('SIGKILL');
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch { /* ignore */ }
      reject(new Error(`命令超时 (${CMD_TIMEOUT_MS}ms)`));
    }, CMD_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > MAX_OUTPUT) child.stdout.pause();
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > MAX_OUTPUT) child.stderr.pause();
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`无法执行 ${cmd}: ${e.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr: stderr.trim() });
    });
  });
}

// ---- 真实工作区文件工具 ----
function readFileAsync(p) {
  return new Promise((resolve, reject) => {
    readFile(p, 'utf8', (err, data) => (err ? reject(new Error('文件不存在')) : resolve(data)));
  });
}
function readFilePromise(p, enc) {
  return new Promise((resolve, reject) => {
    readFile(p, enc, (err, data) => (err ? reject(err) : resolve(data)));
  });
}
function writeFilePromise(p, data, enc) {
  return new Promise((resolve, reject) => {
    writeFile(p, data, enc, (err) => (err ? reject(err) : resolve()));
  });
}
/** 递归收集工作区相对文件路径（仅文件） */
function readdirPromise(p) {
  return new Promise((resolve, reject) => {
    readdir(p, { withFileTypes: true }, (err, ents) => (err ? reject(err) : resolve(ents)));
  });
}
async function walkWorkspace(dir, prefix, out) {
  let entries;
  try {
    entries = await readdirPromise(dir);
  } catch {
    return; // 目录不存在 → 空
  }
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        await walkWorkspace(full, rel, out);
      } else if (ent.isSymbolicLink() && rel === 'public' && realpathSync(full) === realpathSync(PUBLIC_WORKSPACE)) {
        await walkWorkspace(full, rel, out);
      } else if (ent.isFile()) {
        out.push(rel);
      }
    } catch { /* 跳过无权限项 */ }
  }
}

// ---- 锁文件 + 启动 ----
// 确保工作区根目录存在
mkdirSync(WORKSPACE_ROOT, { recursive: true });
writeFileSync(LOCK_FILE, String(PORT));
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sandbox-server] listening on http://127.0.0.1:${PORT} (lock: ${LOCK_FILE})`);
  console.log(`[sandbox-server] workspace: ${WORKSPACE_ROOT}`);
});