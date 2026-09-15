#!/usr/bin/env node
// ============================================================
// 生成式技能真实 Shell 执行沙箱服务（可选，独立进程）
//
// 默认不启动。启动后 vite 开发服务器会把 /api-v2/exec 转发到本服务，
// 前端生成式技能的 shell 类型即可真实执行命令。
//
// 安全模型：
//   - 仅监听 127.0.0.1（不回显到局域网）
//   - 命令分级：
//       * 白名单（宽松）→ 直接执行，无需确认
//       * 高危黑名单 → 需客户端带 confirmed:true（用户已弹窗批准）才执行
//       * 其余命令 → 一律拒绝
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
import {
  writeFileSync, existsSync, readFileSync, readFile, writeFile, mkdirSync, readdir, stat, unlink, realpathSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve, sep, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.SANDBOX_PORT || 17891);
const LOCK_FILE = join(__dirname, '.sandbox-port');

// ---- Windows 适配 ----
// 该沙箱命令集为 Unix 风格。Windows 上尽量使用 Git for Windows 自带的
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
// 子进程继承的 PATH：Git usr\bin 放最前，保证 Unix 命令优先
const SPAWN_ENV = {
  ...process.env,
  PATH: GIT_USR_BIN ? `${GIT_USR_BIN}${delimiter}${process.env.PATH ?? ''}` : (process.env.PATH ?? ''),
};

// cmd.exe 内建命令没有独立可执行文件，spawn 找不到；需要转换为 cmd 可执行的形式
const CMD_BUILTINS = new Set(['echo', 'date', 'type', 'set', 'cd', 'cls', 'dir', 'copy', 'del', 'rd', 'md']);
function cmdForLine(cmd, args) {
  if (!IS_WIN || !CMD_BUILTINS.has(cmd)) return { cmd, args };
  // echo/date/type 在 Git bash 中都有真实可执行文件，优先用它们（GIT_USR_BIN 已注入 PATH）
  if (GIT_USR_BIN && cmd !== 'set' && cmd !== 'cd' && cmd !== 'cls' && cmd !== 'dir' && cmd !== 'copy' && cmd !== 'del' && cmd !== 'rd' && cmd !== 'md') {
    return { cmd, args };
  }
  // 其余真正需要 cmd.exe 内建：拼成单条命令行交给 cmd /c
  return { cmd: 'cmd', args: ['/c', [cmd, ...args].join(' ')] };
}

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

// ---- 白名单：可直接执行（黑名单优先于本名单判断） ----
const SHELL_ALLOWED_REAL = new Set([
  'pwd','date','echo','printf','ls','cat','touch','mkdir','rm','cp','mv','head','tail',
  'wc','basename','dirname','sort','uniq','grep','cut','tr','sha256sum','md5sum','du',
  'diff','find','stat','cmp','sed','tar','gzip','gunzip','xz','unzip','zip','jq',
  'env','which','type','localectl','timedatectl','uptime','whoami','uname','hostname',
  'true','false','seq','factor','od','xxd','hexdump','strings','file','cksum','sum',
  'tee','xargs','awk','node','npm','npx','git','ffprobe','openssl','calc','bc',
]);

// ---- 高危黑名单：需要用户明确批准（前端弹窗二次确认）才执行 ----
const SHELL_BLOCKED = new Set([
  'sudo','su','doas','pkexec','passwd','chpasswd',
  'rm','shred','dd','mkfs','fdisk','parted','mount','umount','swapon','swapoff',
  'reboot','shutdown','halt','poweroff','init','systemctl','service','killall','pkill','kill',
  'curl','wget','nc','ncat','socat','telnet','ssh','scp','sftp','ftp',
  'chmod','chown','chattr','setfacl','ln','mknod','mv',
  'docker','podman','kubectl','helm',
]);

// 危险路径前缀：rm -rf / 这类；黑名单已覆盖 rm，这里兜底其它命令带绝对危险路径
const DANGEROUS_PATHS = [
  '/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var',
  '/System', '/Library', '/Applications',
];

const MAX_LINES = 20;
const MAX_SCRIPT_CHARS = 8000;
const MAX_OUTPUT = 64 * 1024;
const CMD_TIMEOUT_MS = 5000;
const MAX_CMD_CHARS = 2000;

// ---- 真实文件工作区（generate_skill 的 file_read / file_write 落盘区） ----
// 项目根目录下 sandbox_workspace/，仅允许读写该目录内文件（虚拟磁盘）。
// 会话隔离：每次请求可携带会话工作目录（session 字段，如 "session-12"），
// 所有读写/执行都锁定在该目录内；不带 session 时沿用旧行为——共享根工作区。
const WORKSPACE_ROOT = resolve(__dirname, 'sandbox_workspace');
const MAX_FILE_READ_CHARS = 100_000;   // 单文件读取上限（与前端虚拟工作区一致）
const MAX_FILE_WRITE_BYTES = 400 * 1024; // 单文件写入上限 400KB
const MAX_LIST_ENTRIES = 500;
// 会话工作目录的安全字符集：仅允许小写字母数字、下划线、斜杠、点、连字符，
// 防止路径穿越/注入（由前端按会话 id 生成，如 "session-12"）
const SESSION_DIR_RE = /^[a-z0-9_./-]+$/;

/**
 * 解析会话工作目录：null = 共享根工作区（旧行为）。
 * 校验会话目录是纯相对路径、不含 .. 与绝对路径，且必须位于工作区内。
 */
function resolveSessionBase(session) {
  if (session === undefined || session === null) return null;
  const raw = String(session).replace(/\\/g, '/').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) throw new Error('simba.sess.abs: 会话工作目录不能是绝对路径');
  const parts = raw.split('/').filter((s) => s && s !== '.');
  if (parts.length === 0) return null;
  if (parts.some((s) => s === '..' || !SESSION_DIR_RE.test(s))) {
    throw new Error('会话工作目录不合法（含 .. 或非法字符）');
  }
  return join(WORKSPACE_ROOT, ...parts);
}

/** 相对路径校验：禁止绝对路径、.. 等，锁定在会话工作目录（或共享根）内 */
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
  const root = base ?? WORKSPACE_ROOT;
  return join(root, ...safe.split('/'));
}

/** 校验最终解析路径仍在会话工作目录（或共享根）内（防符号链接逃逸） */
function assertInside(root, p) {
  const rp = resolve(p);
  if (rp !== root && !rp.startsWith(root + sep)) throw new Error('路径超出工作区');
}

// ---- HTTP 服务 ----
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
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
        const rel = sanitizeWorkspaceRelativePath(String(payload?.path ?? ''));
        const fp = workspacePathFor(rel, base);
        const text = await readFileAsync(fp);
        res.end(JSON.stringify({ ok: true, path: rel, content: text.slice(0, MAX_FILE_READ_CHARS) }));
      } else if (req.url === '/file_write') {
        const rel = sanitizeWorkspaceRelativePath(String(payload?.path ?? ''));
        const fp = workspacePathFor(rel, base);
        const mode = payload?.mode === 'append' ? 'append' : 'write';
        mkdirSync(dirname(fp), { recursive: true });
        const baseRoot = base ?? WORKSPACE_ROOT;
        assertInside(baseRoot, realpathSync(dirname(fp)));
        if (existsSync(fp)) assertInside(baseRoot, realpathSync(fp)); // 已有实体文件防符号链接
        const content = String(payload?.content ?? '');
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
        // file_list：返回会话工作目录（或共享根）内的相对路径（分组目录）
        const files = [];
        await walkWorkspace(base ?? WORKSPACE_ROOT, '', files);
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
      if (!base || base === WORKSPACE_ROOT) {
        throw new Error('缺少合法的会话工作目录');
      }
      if (req.url === '/session_create') {
        mkdirSync(base, { recursive: true });
      } else {
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
  const confirmed = payload?.confirmed === true;
  // 会话隔离：shell 命令在会话工作目录（cwd）下执行；自动创建目录
  let sessionBase = null;
  try {
    sessionBase = resolveSessionBase(payload?.session);
  } catch (e) {
    res.end(JSON.stringify({ ok: false, message: String((e && e.message) || e) }));
    return;
  }
  if (sessionBase) mkdirSync(sessionBase, { recursive: true });

  // 校验：黑名单命令需客户端已确认（前端弹窗批准后带 confirmed:true 重发）
  const check = validateScript(script, confirmed);
  if (check === 'NEED_CONFIRM') {
    res.end(JSON.stringify({ ok: false, needConfirm: true, message: '脚本包含高危命令，需要用户确认' }));
    return;
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
 * 返回 null → 通过；'NEED_CONFIRM' → 有黑名单命令且未被确认；字符串 → 拒绝原因
 */
function validateScript(script, confirmed) {
  if (script.length > MAX_SCRIPT_CHARS) return '脚本超过 8000 字符';
  if (script.length > MAX_CMD_CHARS) return '脚本过长';
  const lines = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) return '空脚本';
  let commandCount = 0;
  let needConfirm = false;
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
      const cmd = tokenize(command)[0];
      if (SHELL_BLOCKED.has(cmd)) {
        needConfirm = true;
      } else if (!SHELL_ALLOWED_REAL.has(cmd)) {
        return `命令 ${cmd} 不在支持名单`;
      }
      for (const p of DANGEROUS_PATHS) {
        if (command.includes(p + sep) || command === p || command.startsWith(p + '/')) {
          return `脚本引用了危险路径 ${p}`;
        }
      }
    }
  }
  return needConfirm && !confirmed ? 'NEED_CONFIRM' : null;
}

function runOne(line, sessionBase) {
  const tokens = tokenize(line);
  let cmd = tokens[0];
  let args = tokens.slice(1);
  const adapted = cmdForLine(cmd, args);
  cmd = adapted.cmd;
  args = adapted.args;
  return new Promise((resolve, reject) => {
    // cwd：会话隔离工作目录（无 session 时为共享根工作区，沿用旧行为）
    const cwd = sessionBase ?? WORKSPACE_ROOT;
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SPAWN_ENV,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
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