export function normalizeBailianAudioUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (
    url.protocol === 'http:'
    && !url.port
    && /^(?:[a-z0-9][a-z0-9-]*\.)?oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(url.hostname)
  ) {
    url.protocol = 'https:';
  }

  return url.protocol === 'https:' ? url.href : null;
}
