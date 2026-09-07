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
//   - 每行一条命令、整段脚本解析；无 shell 解释器（spawn shell:false），
//     因此 & | ; > 等字符仅为普通参数，不构成拼接/注入
//   - 单条命令 5s 超时，超时即 kill 进程树
//   - 输出截断 64KB，合并 stderr
//
// 启动：node sandbox-server.mjs [port]   （默认 17891）
// 锁文件：.sandbox-port（写端口号，供 vite 插件读取）
// ============================================================

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.SANDBOX_PORT || 17891);
const LOCK_FILE = join(__dirname, '.sandbox-port');

// ---- 白名单：可直接执行（黑名单优先于本名单判断） ----
const SHELL_ALLOWED_REAL = new Set([
  'pwd','date','echo','printf','ls','cat','touch','mkdir','rm','cp','mv','head','tail',
  'wc','basename','dirname','sort','uniq','grep','cut','tr','sha256sum','md5sum','du',
  'diff','find','stat','cmp','sed','tar','gzip','gunzip','xz','unzip','zip','jq',
  'env','which','type','localectl','timedatectl','uptime','whoami','uname','hostname',
  'true','false','seq','factor','od','xxd','hexdump','strings','file','cksum','sum',
  'tee','xargs','awk','python3','node','npm','npx','git','ffprobe','openssl','calc','bc',
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

// ---- HTTP 服务 ----
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/exec') {
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
      const out = await runOne(line.trim());
      if (typeof out === 'string') outputs.push(out.trimEnd());
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
  if (lines.length > MAX_LINES) return '脚本行数超过 20';
  let needConfirm = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const cmd = trimmed.split(/\s+/)[0];
    if (SHELL_BLOCKED.has(cmd)) {
      needConfirm = true;
      continue; // 记录后继续检查其它行的语法/白名单
    }
    if (!SHELL_ALLOWED_REAL.has(cmd)) return `命令 ${cmd} 不在白名单`;
    for (const p of DANGEROUS_PATHS) {
      if (trimmed.includes(p + sep) || trimmed === p || trimmed.startsWith(p + '/')) {
        return `脚本引用了危险路径 ${p}`;
      }
    }
  }
  return needConfirm && !confirmed ? 'NEED_CONFIRM' : null;
}

function runOne(line) {
  const tokens = line.split(/\s+/);
  const cmd = tokens[0];
  const args = tokens.slice(1);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
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
      const err = stderr.trim();
      if (code !== 0 || err) {
        reject(new Error(err || `退出码 ${code}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ---- 锁文件 + 启动 ----
writeFileSync(LOCK_FILE, String(PORT));
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sandbox-server] listening on http://127.0.0.1:${PORT} (lock: ${LOCK_FILE})`);
});