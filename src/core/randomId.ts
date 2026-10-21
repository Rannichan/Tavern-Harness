/**
 * 生成一个唯一 id。
 *
 * `crypto.randomUUID()` 只在安全上下文（HTTPS / localhost）可用；通过局域网
 * http 地址（手机扫码）打开的页面里它是 undefined，直接调用会让整个回合抛错。
 * 因此优先使用它，其次退回 `crypto.getRandomValues()`（非安全上下文同样可用），
 * 最后才是 Math.random 兜底。
 */
export function randomId(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return hex;
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
