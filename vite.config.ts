import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
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
 * 若 sandbox 未启动（无锁文件），返回 503，前端报错提示先启动服务。
 */
function sandboxProxyPlugin(): Plugin {
  let sandboxPort: number | null = null;
  const lockPath = join(process.cwd(), '.sandbox-port');

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

  return {
    name: 'sandbox-proxy',
    configureServer(server) {
      sandboxPort = loadPort();
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        if (req.url !== '/api-v2/exec' || req.method !== 'POST') return next();
        const port = sandboxPort ?? loadPort();
        if (!port) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'sandbox server not running' }));
          return;
        }
        const proxyReq = http.request(
          { protocol: 'http:', hostname: '127.0.0.1', port, path: '/exec', method: 'POST', headers: req.headers },
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