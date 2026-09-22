// ============================================================
// 生成式技能工作区路径校验
// ============================================================

/** 校验路径：相对路径、不允许 .. / 绝对路径 */
export function sanitizeRelativePath(path: string): string {
  const p = path.replace(/\\/g, '/').trim();
  if (p.startsWith('/')) throw new Error('不允许绝对路径');
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error('路径不能包含 ..');
  if (parts.length === 0) throw new Error('无效路径');
  return parts.join('/');
}