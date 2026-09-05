import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
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

export default defineConfig({
  plugins: [react(), corsProxyPlugin()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});