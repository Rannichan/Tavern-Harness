import { db } from '../../db/database';
import type { FileEntry } from '../../types/models';

// ============================================================
// 生成式技能私有工作区（虚拟文件系统，IndexedDB 持久化）
// 对应 App 的 GeneratedSkillSandbox / AppFileManager
// ============================================================

const WORKSPACE_ROOT = 'generated_skill_workspace';
const MAX_FILE_SIZE = 400 * 1024; // 400KB
const MAX_READ_CHARS = 100_000;

interface WorkspaceFile {
  path: string;
  mimeType: string;
  content: string;
  updatedAt: number;
}

/** 校验路径：相对路径、不允许 .. / 绝对路径 */
export function sanitizeRelativePath(path: string): string {
  let p = path.replace(/\\/g, '/').trim();
  if (p.startsWith('/')) p = p.slice(1);
  const parts = p.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error('路径不能包含 ..');
  if (parts.length === 0) throw new Error('无效路径');
  return parts.join('/');
}

function keyFor(path: string): string {
  return `${WORKSPACE_ROOT}/${sanitizeRelativePath(path)}`;
}

async function readFile(path: string): Promise<WorkspaceFile | null> {
  const key = keyFor(path);
  const f = await db.table('workspaceFiles').get(key);
  return (f as WorkspaceFile) ?? null;
}

async function writeFile(path: string, content: string, mimeType = 'text/plain'): Promise<void> {
  const key = keyFor(path);
  if (content.length > MAX_READ_CHARS) throw new Error('文件内容超过 10 万字符上限');
  await db.table('workspaceFiles').put({
    path: key,
    mimeType,
    content,
    updatedAt: Date.now(),
  } as WorkspaceFile & { path: string });
}

async function deleteFile(path: string): Promise<void> {
  await db.table('workspaceFiles').delete(keyFor(path));
}

/** 列出工作区文件（递归） */
export async function listWorkspaceFiles(): Promise<WorkspaceFile[]> {
  const all = (await db.table('workspaceFiles').toArray()) as WorkspaceFile[];
  return all
    .filter((f) => f.path.startsWith(WORKSPACE_ROOT + '/'))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function getWorkspaceFile(path: string): Promise<WorkspaceFile | null> {
  return readFile(path);
}

export async function saveWorkspaceFile(path: string, content: string): Promise<void> {
  if (content.length > MAX_READ_CHARS) throw new Error('文件内容超过 10 万字符上限');
  await writeFile(path, content);
}

export async function removeWorkspaceFile(path: string): Promise<void> {
  await deleteFile(path);
}

export async function renameWorkspaceFile(oldPath: string, newPath: string): Promise<void> {
  const oldKey = keyFor(oldPath);
  const f = (await db.table('workspaceFiles').get(oldKey)) as WorkspaceFile | undefined;
  if (!f) throw new Error('文件不存在');
  await deleteFile(oldPath);
  await writeFile(newPath, f.content, f.mimeType);
}

export const getWorkspaceTree = listWorkspaceFiles;

// ============================================================
// 文件管理器：浏览 (目录结构由路径推断)
// ============================================================

export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const files = await listWorkspaceFiles();
  const dir = dirPath.trim() === '' || dirPath === '/' ? '' : sanitizeRelativePath(dirPath) + '/';
  const entries = new Map<string, FileEntry>();

  for (const f of files) {
    const rel = f.path.slice(WORKSPACE_ROOT.length + 1);
    if (!rel.startsWith(dir)) continue;
    const rest = rel.slice(dir.length);
    const [top] = rest.split('/');
    if (!top) continue;
    const full = dir + top;
    if (rest.includes('/')) {
      // 目录
      if (!entries.has(full)) {
        entries.set(full, { name: top, path: full, isDir: true, size: 0, modifiedAt: f.updatedAt });
      }
    } else {
      entries.set(full, {
        name: top,
        path: full,
        isDir: false,
        size: new Blob([f.content]).size,
        modifiedAt: f.updatedAt,
      });
    }
  }
  return [...entries.values()].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

export async function readFileContent(path: string): Promise<string> {
  const f = await readFile(path);
  if (!f) throw new Error('文件不存在');
  if (f.content.length > MAX_READ_CHARS) throw new Error('文件超过可编辑大小');
  return f.content;
}

export async function createWorkspaceFile(path: string, content: string): Promise<void> {
  await writeFile(path, content);
}

export async function deleteWorkspaceEntry(path: string): Promise<void> {
  // 若是目录则删除其下所有
  if (path.endsWith('/')) {
    const files = await listWorkspaceFiles();
    const prefix = `${WORKSPACE_ROOT}/${path.replace(/\/+$/, '')}/`;
    for (const f of files) {
      if (f.path.startsWith(prefix)) await db.table('workspaceFiles').delete(f.path);
    }
    return;
  }
  await deleteFile(path);
}

export function workspaceToVirtualFs(): { read: (p: string) => Promise<string>; write: (p: string, c: string) => Promise<void>; list: () => Promise<string[]> } {
  return {
    read: readFileContent,
    write: createWorkspaceFile,
    list: async () => (await listWorkspaceFiles()).map((f) => f.path.slice(WORKSPACE_ROOT.length + 1)),
  };
}

// 注册表避免 table not found（在 database.ts 中定义表）
export const WORKSPACE_TABLE = 'workspaceFiles';