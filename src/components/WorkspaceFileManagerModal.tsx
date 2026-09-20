import { useEffect, useMemo, useState } from 'react';
import { Modal, Icon } from './shared';
import { useT } from '../core/i18n';
import { applySessionWorkspace } from '../core/tools/toolExecutor';
import { listSessionWorkspaceFiles, setWorkspaceDir } from '../core/tools/generatedSkillExecutor';
import { useStore } from '../store/store';

// ============================================================
// 会话工作区文件管理器（只读浏览）
//  - 会话头部的工作目录标签点击打开
//  - 只展示当前会话专属磁盘工作区（sandbox_workspace/）
//  - 目录点击进入、支持返回上级与面包屑；文件点击复用 file_display 弹窗预览（只读）
// ============================================================

function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** 与 file_display 相同的「按扩展名推断展示方式」逻辑 */
export function kindFromPath(path: string): 'text' | 'image' | 'html' {
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
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId));
  const associatedNpc = useStore((s) => s.npcs.find((npc) => npc.id === session?.associatedId));
  const hasRootAccess = session?.mode === 'NPC' && associatedNpc?.isBuiltIn === true;
  // 根目录标签：显示会话实际工作目录名（如 session-9）；旧会话无该字段时回退翻译文案
  const rootLabel = hasRootAccess ? t('header.workspaceRoot') : session?.workspaceDir?.trim() || `session-${sessionId}`;
  const [files, setFiles] = useState<string[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  // 当前浏览目录（'' = 根；否则为以 / 结尾的会话内相对路径）
  const [dir, setDir] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setDir('');
    const load = async () => {
      // 多人及普通单人对话列出会话目录；酒馆老板单人对话列出沙箱根目录
      try {
        await applySessionWorkspace(sessionId);
      } catch {
        setWorkspaceDir(null);
      }
      try {
        const list = await listSessionWorkspaceFiles();
        if (cancelled) return;
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
      if (dir === '') return !p.replace(/\/$/, '').includes('/');
      return p.startsWith(dir) && p !== dir && !p.slice(dir.length).includes('/');
    };
    return nodes.filter((n) => directChild(n.path));
  }, [nodes, dir]);

  const crumbs = useMemo(() => (dir === '' ? [] : dir.slice(0, -1).split('/')), [dir]);

  const goUp = () => {
    if (crumbs.length <= 1) setDir('');
    else setDir(crumbs.slice(0, -1).join('/') + '/');
  };

  const openFile = (node: Node) => {
    // 复用 file_display 展示弹窗（按所属会话解析工作区，只读预览）
    setActiveDisplay({
      path: node.path,
      kind: kindFromPath(node.path),
      title: node.name,
      sessionId,
      presentation: 'modal',
    });
    onClose();
  };

  return (
    <Modal onClose={onClose} width="min(640px, calc(100vw - 32px))" className="ws-fm-modal">
      <div className="modal-head ws-fm-head">
        <span className="ws-fm-title">
          <Icon name="folder" size={15} />
          {t('header.fileManagerTitle')}
          <span className="mono ws-fm-crumb">
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
          </span>
        </span>
        <button className="icon-btn" onClick={onClose} title={t('common.close')}><Icon name="x" /></button>
      </div>
      <div className="modal-body ws-fm-body">
        <div className="ws-fm-note">
          <Icon name="eye" size={12} /> {t('header.fileManagerReadonly')}
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
            {visible.map((n) =>
              n.isDir ? (
                <div key={n.path} className="ws-fm-row" role="button" onClick={() => setDir(n.path)} title={n.path}>
                  <span className="ws-fm-arrow" />
                  <Icon name="folder" size={14} />
                  <span className="ws-fm-name">{n.name}/</span>
                </div>
              ) : (
                <div key={n.path} className="ws-fm-row" role="button" onClick={() => openFile(n)} title={n.path}>
                  <span className="ws-fm-arrow" />
                  <Icon name="file" size={14} />
                  <span className="ws-fm-name mono">{n.name}</span>
                  <span className="ws-fm-open"><Icon name="eye" size={12} /></span>
                </div>
              )
            )}
            {visible.length === 0 && <div className="ws-fm-empty">{t('header.fileManagerEmpty')}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
