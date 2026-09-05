import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import {
  listDirectory,
  readFileContent,
  createWorkspaceFile,
  removeWorkspaceFile,
  renameWorkspaceFile,
} from '../core/tools/generatedWorkspace';
import type { FileEntry } from '../types/models';
import { Icon, Markdown } from './shared';

// ============================================================
// 文件管理（生成式技能私有工作区）
// ============================================================

export function FilesView() {
  const addToast = useStore((s) => s.addToast);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [viewing, setViewing] = useState<{ path: string; content: string } | null>(null);
  const [creating, setCreating] = useState<{ path: string; content: string } | null>(null);

  const refresh = async (dir: string) => {
    const list = await listDirectory(dir);
    setEntries(list);
  };

  useEffect(() => {
    refresh(cwd);
  }, [cwd]);

  const navigate = (entry: FileEntry) => {
    if (entry.isDir) setCwd(entry.path);
    else {
      readFileContent(entry.path)
        .then((content) => setViewing({ path: entry.path, content }))
        .catch((e) => addToast(e.message, 'error'));
    }
  };

  return (
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">文件管理</h2>
          <p className="view-sub">生成式技能私有工作区 <span className="mono">generated_skill_workspace/</span> · 文本文件可在线编辑</p>
        </div>

        <div className="card" style={{ padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 8px', borderBottom: '1px solid var(--border-soft)' }}>
            <button className="btn btn-ghost btn-sm" disabled={!cwd} onClick={() => setCwd(cwd.split('/').slice(0, -1).join('/'))}>
              ← 上级
            </button>
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
              /generated_skill_workspace/{cwd}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                className="btn btn-sm"
                onClick={() => setCreating({ path: cwd ? cwd + '/' : '', content: '' })}
              >
                <Icon name="plus" size={12} /> 新建文件
              </button>
              <button className="btn btn-sm" onClick={() => refresh(cwd)}>刷新</button>
            </div>
          </div>

          <div>
            {entries.length === 0 && (
              <div className="empty-state" style={{ padding: 34 }}>
                <div className="big">📂</div>
                <span>空目录</span>
              </div>
            )}
            {entries.map((e) => (
              <div key={e.path} className="file-row" style={{ cursor: 'pointer' }} onClick={() => navigate(e)}>
                <div className="f-icon">{e.isDir ? '📁' : e.name.endsWith('.json') ? '🧾' : e.name.includes('.') ? '📄' : '📄'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="f-name">{e.name}</div>
                  <div className="f-meta">
                    {e.isDir ? '目录' : `${formatSize(e.size)}`} · {new Date(e.modifiedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {!e.isDir && e.size < 400 * 1024 && (
                    <button className="icon-btn" title="编辑" onClick={(ev) => { ev.stopPropagation(); navigate(e); }}>
                      <Icon name="settings" size={13} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="复制路径"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      navigator.clipboard?.writeText(`generated_skill_workspace/${e.path}`).then(() => addToast('路径已复制'));
                    }}
                  >
                    <Icon name="check" size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    title="删除"
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      if (!confirm(`删除「${e.path}」？`)) return;
                      await removeWorkspaceFile(e.path);
                      await refresh(cwd);
                      addToast('已删除');
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 面包屑说明 */}
        <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.7 }}>
          <b>文件可被技能访问：</b> file_read / file_write / shell 中的路径均相对于此工作区。最大单文件 400KB，文本编辑上限 10 万字符。
        </div>
      </div>

      {viewing && (
        <FileEditor
          path={viewing.path}
          initialContent={viewing.content}
          onClose={() => setViewing(null)}
          onSaved={async (path, content) => {
            await createWorkspaceFile(path, content);
            await refresh(cwd);
            setViewing(null);
            addToast('已保存');
          }}
        />
      )}
      {creating && (
        <FileEditor
          path={creating.path}
          initialContent=""
          isNew
          onClose={() => setCreating(null)}
          onSaved={async (path, content) => {
            await createWorkspaceFile(path, content);
            await refresh(cwd);
            setCreating(null);
            addToast('已创建');
          }}
        />
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileEditor({
  path,
  initialContent,
  isNew = false,
  onClose,
  onSaved,
}: {
  path: string;
  initialContent: string;
  isNew?: boolean;
  onClose: () => void;
  onSaved: (path: string, content: string) => void;
}) {
  const [name, setName] = useState(path.split('/').pop() ?? '');
  const [content, setContent] = useState(initialContent);
  const addToast = useStore((s) => s.addToast);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card" style={{ width: 'min(760px, calc(100vw - 32px))' }}>
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-mono)' }}>
              {isNew ? '新建文件' : path}
            </span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isNew && (
              <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="文件名，如 notes.md" />
            )}
            <textarea
              className="textarea mono"
              rows={16}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="文件内容…"
            />
            {content.length > 200 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>预览：</div>
            )}
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const full = isNew ? (path ? path : '') + name : path;
                if (!full) {
                  addToast('文件名不能为空', 'error');
                  return;
                }
                onSaved(full, content);
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}