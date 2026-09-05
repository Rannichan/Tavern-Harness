// ============================================================
// CORS 代理辅助：当直连请求被浏览器跨域拦截（CORS）时，
// 自动回退到 Vite 开发服务器的同源代理。
// 代理规则：http://<当前站点>/api/<host:port>/<剩余路径>
// 例：http://192.168.1.5:8788/v1/ → http://localhost:5173/api/192.168.1.5:8788/v1/
// ============================================================

/** 判断当前环境是否可能提供代理（Vite dev 服务器） */
export function canUseProxy(): boolean {
  if (typeof window === 'undefined') return false;
  // 仅当页面运行在开发服务器（非 file:// 等）时可用
  return /^https?:\/\//.test(window.location.origin);
}

/** 该 URL 是否已经是同源 /api/ 代理形式 */
export function isProxyUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * 把直连 Base URL 转换为同源代理 URL。
 * 返回 null 表示不需要/无法转换（如已是代理、或非 http(s) URL）。
 * 例：
 *   http://192.168.1.5:8788        → http://localhost:5173/api/192.168.1.5:8788
 *   http://192.168.1.5:8788/v1/    → http://localhost:5173/api/192.168.1.5:8788/v1/
 *   https://api.deepseek.com/v1/   → null（公有 HTTPS 服务一般带 CORS；不代理外网）
 */
export function toProxyUrl(baseUrl: string): string | null {
  if (!canUseProxy() || isProxyUrl(baseUrl)) return null;
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // 仅代理内网/局域网地址，外网公开 API 保持直连（避免滥用代理）
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname);
  const isPrivateHost = ipv4 || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (!isPrivateHost) return null;

  const host = u.host; // hostname:port
  const rest = u.pathname.replace(/^\/+/, '');
  const path = `/api/${host}/${rest}`.replace(/\/+$/, '');
  return `${window.location.origin}${path}`;
}

/** 判断 fetch 失败是否“像” CORS / 网络层问题（可用代理回退） */
export function isNetworkLikeError(e: unknown): boolean {
  const msg = (e as Error)?.message || String(e);
  return /Failed to fetch|NetworkError|Load failed|TypeError|Network request failed/i.test(msg);
}