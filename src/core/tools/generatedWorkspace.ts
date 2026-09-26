// ============================================================
// 生成式技能工作区路径校验
// ============================================================

/** 校验路径：相对路径、不允许 .. / 绝对路径 */
export function sanitizeRelativePath(path: string): string {
  const p = path.replace(/\\/g, '/').trim();
  if (p.startsWith('/')) throw new Error('Absolute paths are not allowed');
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error('Path must not contain ..');
  if (parts.length === 0) throw new Error('Invalid path');
  return parts.join('/');
}