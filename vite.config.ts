import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * CORS 转发中间件：为本地（无 CORS 头）的 OpenAI 兼容服务提供同源代理。
 * Base URL 填 http://localhost:5173/api/192.168.50.175:8788/ 即可；
 * /api/<host>/ 之后的路径（含 query）原样转发到 http://<host>/。
 */
function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url || '';
        const m = /^\/api\/([^/]+)(\/[^?]*)?(\?.*)?$/.exec(url);
        if (!m) return next();

        const rawHost = m[1]; // e.g. 192.168.50.175:8788
        const path = (m[2] || '') + (m[3] || '');
        const isHttps = rawHost.startsWith('https://');
        const host = rawHost.replace(/^https?:\/\//, '');
        const [hostname, portStr] = host.split(':');
        const port = portStr ? parseInt(portStr, 10) : isHttps ? 443 : 80;

        const mod = isHttps ? https : http;
        const forwardedHeaders: Record<string, string | string[] | undefined> = {
          ...(req.headers as Record<string, string | string[] | undefined>),
          host: host,
        };

        const proxyReq = mod.request(
          {
            protocol: isHttps ? 'https:' : 'http:',
            hostname,
            port,
            path,
            method: req.method,
            headers: forwardedHeaders,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on('error', (e: Error) => {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`proxy error: ${e.message}`);
        });
        req.pipe(proxyReq);
      });
    },
  };
}

/**
 * 生成式技能真实 Shell 执行端点。
 * 规则：/api-v2/exec 转发到本地 sandbox-server（127.0.0.1:17891，端口从 .sandbox-port 锁文件读取）。
 * 若 sandbox 未启动，会在收到请求时自动拉起 sandbox-server 子进程，无需手动执行 node sandbox-server.mjs。
 */
function sandboxProxyPlugin(): Plugin {
  let sandboxChild: ChildProcess | null = null;
  let starting: Promise<number | null> | null = null;
  let childPort: number | null = null;
  const serviceToken = randomBytes(32).toString('base64url');
  const approvalToken = randomBytes(32).toString('base64url');
  const lockPath = join(process.cwd(), '.sandbox-port');
  const SANDBOX_SCRIPT = join(process.cwd(), 'sandbox-server.mjs');
  const DEFAULT_PORT = 17891;

  const loadPort = () => {
    try {
      if (existsSync(lockPath)) {
        const p = parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
        if (!Number.isNaN(p) && p > 0) return p;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  /** 探测 127.0.0.1:port 是否已有服务监听 */
  const portOpen = (port: number) =>
    new Promise<boolean>((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port, timeout: 400 });
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('timeout', () => {
        sock.destroy();
        resolve(false);
      });
      sock.once('error', () => resolve(false));
    });

  const serviceReady = (port: number) =>
    new Promise<boolean>((resolve) => {
      const body = JSON.stringify({ script: 'echo ready' });
      const request = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/exec',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Command-Service-Token': serviceToken,
        },
        timeout: 400,
      }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.once('timeout', () => {
        request.destroy();
        resolve(false);
      });
      request.once('error', () => resolve(false));
      request.end(body);
    });

  const findAvailablePort = async () => {
    for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port++) {
      if (!(await portOpen(port))) return port;
    }
    return null;
  };

  const stopSandbox = () => {
    const child = sandboxChild;
    sandboxChild = null;
    childPort = null;
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
  };

  /** 确保 sandbox-server 在运行：已有则复用；否则自动拉起并等待就绪 */
  const ensureSandbox = async (): Promise<number | null> => {
    if (starting) return starting;
    starting = (async () => {
      // 1) 复用已在运行的沙箱（手动启动/上次 vite 拉起）
      const known = loadPort() ?? DEFAULT_PORT;
      if ((await portOpen(known)) && (await serviceReady(known))) return known;
      if (known !== DEFAULT_PORT && (await portOpen(DEFAULT_PORT)) && (await serviceReady(DEFAULT_PORT))) return DEFAULT_PORT;
      // 2) 自动拉起子进程
      if (!sandboxChild && existsSync(SANDBOX_SCRIPT)) {
        const availablePort = await findAvailablePort();
        if (availablePort == null) return null;
        childPort = availablePort;
        const child = spawn(process.execPath, [SANDBOX_SCRIPT, String(availablePort)], {
          cwd: process.cwd(),
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            COMMAND_SERVICE_TOKEN: serviceToken,
            COMMAND_APPROVAL_TOKEN: approvalToken,
          },
        });
        sandboxChild = child;
        child.on('exit', () => {
          if (sandboxChild !== child) return;
          sandboxChild = null;
          childPort = null;
        });
        child.unref();
        process.once('exit', () => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        });
      }
      if (!sandboxChild) return null;
      // 3) 等待就绪（最多 3s）
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (childPort != null && (await serviceReady(childPort))) return childPort;
      }
      return null;
    })().finally(() => {
      starting = null;
    });
    return starting;
  };

  return {
    name: 'sandbox-proxy',
    closeBundle() {
      stopSandbox();
    },
    configureServer(server) {
      server.watcher.add(SANDBOX_SCRIPT);
      server.watcher.on('change', (path) => {
        if (path === SANDBOX_SCRIPT) stopSandbox();
      });
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        // 转发与沙箱服务相关的端点：/exec 及真实工作区文件端点
        const m = /^\/api-v2\/(exec|approve|file_read|file_write|file_list|session_create|session_delete)$/.exec(req.url || '');
        if (!m || req.method !== 'POST') return next();
        const origin = req.headers.origin;
        if (!origin || req.headers['sec-fetch-site'] !== 'same-origin') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'sandbox access requires a same-origin browser request' }));
          return;
        }
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'invalid origin' }));
          return;
        }
        if (originHost !== req.headers.host) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'cross-origin request denied' }));
          return;
        }
        void (async () => {
          const port = await ensureSandbox();
          if (!port) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'sandbox server not running' }));
            return;
          }
          const forwardedHeaders = {
            ...req.headers,
            'x-command-service-token': serviceToken,
            ...(m[1] === 'approve' ? { 'x-command-approval-token': approvalToken } : {}),
          };
          const proxyReq = http.request(
            { protocol: 'http:', hostname: '127.0.0.1', port, path: `/${m[1]}`, method: 'POST', headers: forwardedHeaders },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
              proxyRes.pipe(res);
            }
          );
          proxyReq.on('error', (e: Error) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: `sandbox proxy error: ${e.message}` }));
          });
          req.pipe(proxyReq);
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), corsProxyPlugin(), sandboxProxyPlugin()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});