import { useEffect, useMemo, useState } from 'react';
import { Modal, Icon } from './shared';
import { useT } from '../core/i18n';
import { applySessionWorkspace } from '../core/tools/toolExecutor';
import { deleteWorkspaceFile, listSessionWorkspaceFiles, openSessionWorkspace } from '../core/tools/generatedSkillExecutor';
import { useStore } from '../store/store';

// ============================================================
// 会话工作区文件管理器
//  - 会话头部的工作目录标签点击打开
//  - 只展示当前会话专属磁盘工作区（sandbox_workspace/）
//  - 目录点击进入、支持返回上级与面包屑；文件点击复用 file_display 弹窗预览
//  - 可在确认后删除文件或目录（public 软链接除外）
// ============================================================

function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** 与 file_display 相同的「按扩展名推断展示方式」逻辑 */
function kindFromPath(path: string): 'text' | 'image' | 'html' {
  const ext = extOf(path);
  if (/^(html?)$/i.test(ext)) return 'html';
  if (/^(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(ext)) return 'image';
  return 'text';
}

interface Node {
  name: string;
  path: string; // 会话工作区内的相对路径（目录以 / 结尾）
  isDir: boolean;
}

/** 由扁平文件列表构建目录节点（目录与文件均以相对路径为唯一 key） */
function buildNodes(files: string[]): Node[] {
  const map = new Map<string, Node>();
  for (const rel of files) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/') + '/';
      if (!map.has(dirPath)) map.set(dirPath, { name: parts[i - 1], path: dirPath, isDir: true });
    }
    map.set(rel, { name: parts[parts.length - 1] || rel, path: rel, isDir: false });
  }
  return [...map.values()].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

export function WorkspaceFileManagerModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const t = useT();
  const addToast = useStore((s) => s.addToast);
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId));
  const associatedNpc = useStore((s) => s.npcs.find((npc) => npc.id === session?.associatedId));
  const usesPublicWorkspace = session?.mode === 'NPC' && associatedNpc?.isBuiltIn === true;
  const rootLabel = usesPublicWorkspace ? t('header.workspaceRoot') : session?.workspaceDir?.trim() || `session-${sessionId}`;
  const [files, setFiles] = useState<string[] | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [pendingDelete, setPendingDelete] = useState<Node | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openingLocation, setOpeningLocation] = useState(false);
  // 当前浏览目录（'' = 根；否则为以 / 结尾的会话内相对路径）
  const [dir, setDir] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setDir('');
    const load = async () => {
      // 多人及普通单人对话列出会话目录；酒馆老板单人对话列出 public 目录
      try {
        const workspaceDir = await applySessionWorkspace(sessionId);
        const list = await listSessionWorkspaceFiles(workspaceDir);
        if (cancelled) return;
        setWorkspaceDir(workspaceDir);
        setFiles(list);
        setLoadState(list.length === 0 ? 'empty' : 'ok');
      } catch {
        if (cancelled) return;
        setFiles([]);
        setLoadState('error');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const nodes = useMemo(() => buildNodes(files ?? []), [files]);

  // 当前目录的直接子项（目录与文件同级）
  const visible = useMemo(() => {
    const directChild = (p: string) => {
      const normalized = p.replace(/\/$/, '');
      if (dir === '') return !normalized.includes('/');
      return normalized.startsWith(dir) && normalized !== dir.slice(0, -1) && !normalized.slice(dir.length).includes('/');
    };
    return nodes.filter((n) => directChild(n.path));
  }, [nodes, dir]);

  const crumbs = useMemo(() => (dir === '' ? [] : dir.slice(0, -1).split('/')), [dir]);

  const goUp = () => {
    if (crumbs.length <= 1) setDir('');
    else setDir(crumbs.slice(0, -1).join('/') + '/');
  };

  const openFile = (node: Node) => {
    setActiveDisplay({
      path: node.path,
      kind: kindFromPath(node.path),
      title: node.name,
      sessionId,
      presentation: 'workspace',
    });
  };

  const downloadFile = (node: Node) => {
    if (!workspaceDir) return;
    const url = `/api-v2/preview/${encodeURIComponent(workspaceDir)}/${node.path.split('/').map(encodeURIComponent).join('/')}`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = node.name;
    anchor.click();
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      const workspaceDir = await applySessionWorkspace(sessionId);
      await deleteWorkspaceFile(pendingDelete.path, workspaceDir);
      setFiles((current) => {
        const next = (current ?? []).filter((path) => (
          pendingDelete.isDir ? !path.startsWith(pendingDelete.path) : path !== pendingDelete.path
        ));
        setLoadState(next.length === 0 ? 'empty' : 'ok');
        return next;
      });
      setPendingDelete(null);
    } catch (error) {
      addToast((error as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const openWorkspaceLocation = async () => {
    setOpeningLocation(true);
    try {
      await openSessionWorkspace(await applySessionWorkspace(sessionId));
    } catch (error) {
      const message = (error as Error).message;
      addToast(message === 'WORKSPACE_OPEN_LOCAL_ONLY' ? t('toast.workspaceOpenLocalOnly') : message, 'error');
    } finally {
      setOpeningLocation(false);
    }
  };

  return (
    <Modal onClose={onClose} className="ws-fm-modal">
      <div className="modal-head ws-fm-head">
        <span className="ws-fm-title">
          <Icon name="folder" size={15} />
          {t('header.fileManagerTitle')}
        </span>
        <span className="ws-fm-head-actions">
          <button
            className="icon-btn ws-fm-location-btn"
            onClick={() => void openWorkspaceLocation()}
            disabled={openingLocation}
            title={t('header.fileManagerOpenLocation')}
            aria-label={t('header.fileManagerOpenLocation')}
          >
            <Icon name="folder" size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} title={t('common.close')}><Icon name="x" /></button>
        </span>
      </div>
      <div className="modal-body ws-fm-body">
        <div className="mono ws-fm-crumb">
          {crumbs.length === 0 ? rootLabel : (
            <>
              <span className="ws-fm-crumb-link" onClick={() => setDir('')}>{rootLabel}</span>
              {crumbs.map((c, i) => (
                <span key={i}>
                  <span className="ws-fm-crumb-sep">/</span>
                  {i === crumbs.length - 1 ? (
                    <span className="ws-fm-crumb-cur">{c}</span>
                  ) : (
                    <span className="ws-fm-crumb-link" onClick={() => setDir(crumbs.slice(0, i + 1).join('/') + '/')}>{c}</span>
                  )}
                </span>
              ))}
            </>
          )}
        </div>
        {loadState === 'loading' && (
          <div className="ws-fm-empty">
            <span className="spinner" style={{ width: 20, height: 20 }} />
            <span>{t('display.loading')}</span>
          </div>
        )}
        {loadState === 'empty' && <div className="ws-fm-empty">{t('header.fileManagerEmpty')}</div>}
        {loadState === 'error' && <div className="ws-fm-empty">{t('header.fileManagerError')}</div>}
        {loadState === 'ok' && (
          <div className="ws-fm-list">
            {dir !== '' && (
              <div className="ws-fm-row" role="button" onClick={goUp} title="..">
                <span className="ws-fm-arrow" />
                <Icon name="folder" size={14} />
                <span className="ws-fm-name">..</span>
              </div>
            )}
            {visible.map((n) => {
              const isPublicLink = n.isDir && n.path === 'public/';
              return (
                <div
                  key={n.path}
                  className="ws-fm-row"
                  role="button"
                  onClick={() => n.isDir ? setDir(n.path) : openFile(n)}
                  title={n.path}
                >
                  <span className="ws-fm-arrow" />
                  <Icon name={n.isDir ? 'folder' : 'file'} size={14} />
                  <span className={`ws-fm-name${n.isDir ? '' : ' mono'}`}>{n.name}{n.isDir ? '/' : ''}</span>
                  {!n.isDir && (
                    <span className="ws-fm-actions">
                      <button
                        className="icon-btn ws-fm-download"
                        title={t('common.download')}
                        aria-label={t('common.download')}
                        onClick={(event) => {
                          event.stopPropagation();
                          downloadFile(n);
                        }}
                      ><span aria-hidden="true">↓</span></button>
                      <button
                        className="icon-btn ws-fm-delete"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDelete(n);
                        }}
                      ><Icon name="trash" size={13} /></button>
                    </span>
                  )}
                  {n.isDir && (
                    <span className="ws-fm-actions">
                      <button
                        className="icon-btn ws-fm-download"
                        title={t('common.download')}
                        aria-label={t('common.download')}
                        disabled
                      ><span aria-hidden="true">↓</span></button>
                      {!isPublicLink && (
                        <button
                          className="icon-btn ws-fm-delete"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(n);
                          }}
                        ><Icon name="trash" size={13} /></button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            {visible.length === 0 && <div className="ws-fm-empty">{t('header.fileManagerEmpty')}</div>}
          </div>
        )}
      </div>
      {pendingDelete && (
        <div className="ws-fm-delete-layer" role="dialog" aria-modal="true" aria-labelledby="ws-fm-delete-title">
          <div className="ws-fm-delete-dialog card fade-up">
            <div className="modal-head">
              <span id="ws-fm-delete-title" className="typo-dialog-title">{t('header.fileManagerDeleteTitle')}</span>
              <button className="icon-btn" onClick={() => setPendingDelete(null)} disabled={deleting} title={t('common.close')}>
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">{t('common.confirmDelete', { name: pendingDelete.path })}</div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPendingDelete(null)} disabled={deleting}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Icon name="trash" size={13} />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
