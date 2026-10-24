import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

const projectRoot = dirname(fileURLToPath(import.meta.url));

// 运行时版本号只在构建时从 package.json 注入，避免应用读文件或请求 npm registry
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string };

/**
 * 浏览器同源校验：Origin 必须存在且与请求的 Host 一致；`Sec-Fetch-Site` 若存在
 * 必须是 same-origin（部分手机浏览器访问局域网地址时不发 fetch metadata，
 * 所以不能强制要求这个头）。
 *
 * 这只用来挡住"别的站点直接打本机端口"，不是身份认证：Origin / Host 都能被
 * 非浏览器客户端伪造，真正的授权是持久化 / 沙箱服务的 service token。
 * DNS rebinding 也不在本检查的覆盖范围内（它会让 Host 与 Origin 同时变成
 * 攻击者域名），需要的话得在服务侧校验 Host 白名单。
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite != null && fetchSite !== 'same-origin') return false;
  try {
    // URL 会把 host 归一成小写，Host 头则原样保留，两边都归一后再比
    const requestHost = String(req.headers.host ?? '').toLowerCase();
    return new URL(origin).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function lanAddressPlugin(): Plugin {
  return {
    name: 'lan-address',
    configureServer(server) {
      server.middlewares.use('/api-v2/lan-address', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET') return next();
        const host = req.headers.host || '';
        const port = host.split(':').at(-1);
        const address = Object.values(networkInterfaces())
          .flat()
          .find((network) => network?.family === 'IPv4' && !network.internal)?.address;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ url: address && port ? `http://${address}:${port}/` : null }));
      });
    },
  };
}

/**
 * CORS 转发中间件：为本地及外部 HTTPS OpenAI 兼容服务提供同源代理。
 * Base URL 填 http://localhost:5173/api/192.168.50.175:8788/ 即可；
 * HTTPS 目标格式为 /api/https/<host>/，例如：
 * http://localhost:5173/api/https/ark.cn-beijing.volces.com/api/v3。
 * /api/<host>/ 之后的路径（含 query）原样转发到目标服务。
 */
function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url || '';
        const m = /^\/api\/([^/]+)(\/[^?]*)?(\?.*)?$/.exec(url);
        if (!m) return next();

        const rawHost = m[1]; // e.g. 192.168.50.175:8788 or https
        const path = (m[2] || '') + (m[3] || '');
        const isHttps = rawHost === 'https';
        const host = isHttps ? (m[2] || '').split('/')[1] : rawHost;
        const forwardedPath = isHttps
          ? `/${(m[2] || '').split('/').slice(2).join('/')}${m[3] || ''}`
          : path;
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
            path: forwardedPath,
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
function persistenceProxyPlugin(): Plugin {
  let persistenceChild: ChildProcess | null = null;
  let starting: Promise<number | null> | null = null;
  let childPort: number | null = null;
  const serviceToken = randomBytes(32).toString('base64url');
  const persistenceScript = join(projectRoot, 'persistence-server.mjs');
  const DEFAULT_PORT = 17892;

  const portOpen = (port: number) => new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });

  const serviceReady = (port: number) => new Promise<boolean>((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      headers: { 'X-Persistence-Service-Token': serviceToken },
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
    request.end();
  });

  const stopPersistence = () => {
    const child = persistenceChild;
    persistenceChild = null;
    childPort = null;
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
  };

  const ensurePersistence = async (): Promise<number | null> => {
    if (starting) return starting;
    starting = (async () => {
      if (childPort != null && (await portOpen(childPort)) && (await serviceReady(childPort))) return childPort;
      if (persistenceChild) return null;
      for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port++) {
        if (await portOpen(port)) continue;
        childPort = port;
        const child = spawn(process.execPath, [persistenceScript, String(port)], {
          cwd: projectRoot,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, PERSISTENCE_SERVICE_TOKEN: serviceToken },
        });
        persistenceChild = child;
        child.on('exit', () => {
          if (persistenceChild === child) {
            persistenceChild = null;
            childPort = null;
          }
        });
        process.once('exit', () => child.kill());
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (await serviceReady(port)) return port;
        }
        child.kill();
        persistenceChild = null;
        childPort = null;
        return null;
      }
      return null;
    })().finally(() => {
      starting = null;
    });
    return starting;
  };

  const registerMiddleware = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith('/api-v3/')) return next();
        if (!isSameOriginRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Persistence access requires a same-origin browser request' }));
          return;
        }
        void (async () => {
          const port = await ensurePersistence();
          if (port == null) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Persistence server not running' }));
            return;
          }
          const proxyReq = http.request({
            hostname: '127.0.0.1',
            port,
            path: req.url!.slice('/api-v3'.length),
            method: req.method,
            headers: { ...req.headers, 'x-persistence-service-token': serviceToken },
          }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          });
          proxyReq.once('error', (error: Error) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: `Persistence proxy error: ${error.message}` }));
          });
          req.pipe(proxyReq);
        })();
      });
  };

  return {
    name: 'persistence-proxy',
    closeBundle: stopPersistence,
    configureServer(server) {
      server.watcher.add(persistenceScript);
      server.watcher.on('change', (path) => {
        if (resolve(path) === persistenceScript) stopPersistence();
      });
      registerMiddleware(server);
    },
    configurePreviewServer: registerMiddleware,
  };
}

function sandboxProxyPlugin(): Plugin {
  let sandboxChild: ChildProcess | null = null;
  let starting: Promise<number | null> | null = null;
  let childPort: number | null = null;
  const serviceToken = randomBytes(32).toString('base64url');
  const approvalToken = randomBytes(32).toString('base64url');
  const lockPath = join(projectRoot, '.sandbox-port');
  const SANDBOX_SCRIPT = join(projectRoot, 'sandbox-server.mjs');
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
          cwd: projectRoot,
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
        const m = /^\/api-v2\/(exec|approve|file_read|file_write|file_delete|file_list|session_create|session_delete)$/.exec(req.url || '');
        if (!m || req.method !== 'POST') return next();
        if (!isSameOriginRequest(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'sandbox access requires a same-origin browser request' }));
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
  plugins: [react(), lanAddressPlugin(), corsProxyPlugin(), persistenceProxyPlugin(), sandboxProxyPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  optimizeDeps: {
    force: true,
    include: [
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'dexie',
      'dompurify',
      'katex',
      'marked',
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
      'react-dom/client',
      'use-sync-external-store/shim/with-selector',
      'zustand',
    ],
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});