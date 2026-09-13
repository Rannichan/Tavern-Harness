import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Icon, Markdown } from './shared';
import { useStore } from '../store/store';
import { useT } from '../core/i18n';
import { highlightCode } from '../core/markdown';
import { readWorkspaceFileText } from '../core/tools/generatedSkillExecutor';
import type { DisplayFileRef } from '../types/models';

// ============================================================
// 文件展示弹窗（display_file 内置工具）
//  - image: 图片直接展示，支持滚轮/按钮缩放与拖拽平移
//  - html : 在隔离 iframe（sandbox）中渲染，可运行动画/交互脚本
//  - text : 按扩展名智能渲染：markdown → MD 渲染（含代码高亮与公式），
//           代码文件 → 等宽字体 + 语法高亮，纯文本 → 原样展示
// ============================================================

const CODE_EXTS = new Set([
  'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb',
  'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'css', 'scss', 'less', 'sql', 'graphql', 'xml', 'vue', 'svelte',
  'lua', 'pl', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'ml',
]);
// .txt 是纯文本原样展示；markdown 才走 MD 渲染
const MD_EXTS = new Set(['md', 'markdown', 'mdx']);

function extensionOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function basenameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function FileDisplayModal() {
  const t = useT();
  const active = useStore((s) => s.activeDisplay);
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const [content, setContent] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [imgError, setImgError] = useState(false);
  // 图片缩放 / 平移
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const ref: DisplayFileRef | null = useMemo(() => {
    if (!active) return null;
    return { path: active.path, kind: active.kind, title: active.title };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadState('loading');
    setContent(null);
    setImgError(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    void readWorkspaceFileText(active.path).then((text) => {
      if (cancelled) return;
      if (text === null) {
        setLoadState('error');
        return;
      }
      setContent(text);
      setLoadState('ok');
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const title = active?.title?.trim() || (active ? basenameOf(active.path) : '');
  const ext = active ? extensionOf(active.path) : '';

  const close = () => setActiveDisplay(null);

  /** 图片数据：优先 data: URI；否则按扩展名拼 data URI（SVG 直接内联，位图按 base64 文本） */
  const imageSrc = useMemo(() => {
    if (content === null) return null;
    if (/^data:/i.test(content)) return content;
    const extMime: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    };
    const mime = extMime[ext] || 'image/png';
    if (ext === 'svg') {
      // SVG 是文本格式：直接内联（含缩进的空格保留，避免破坏标记）
      return `data:image/svg+xml,${encodeURIComponent(content)}`;
    }
    const cleaned = content.replace(/\s+/g, '');
    return `data:${mime};base64,${cleaned}`;
  }, [content, ext]);

  if (!active || !ref) return null;

  const zoomIn = () => setZoom((z) => Math.min(8, +(z * 1.3).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.1, +(z / 1.3).toFixed(2)));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const renderBody = () => {
    if (loadState === 'loading') {
      return (
        <div className="display-loading">
          <span className="spinner" style={{ width: 22, height: 22 }} />
          <span>{t('display.loading')}</span>
        </div>
      );
    }
    if (loadState === 'error' || content === null) {
      return <div className="display-error">{t('display.fileError', { path: active.path })}</div>;
    }

    if (active.kind === 'image') {
      return (
        <div
          ref={viewportRef}
          className="display-image-viewport"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              if (e.deltaY < 0) zoomIn();
              else zoomOut();
            }
          }}
        >
          {imgError ? (
            <div className="display-error">{t('display.imageLoadError')}</div>
          ) : (
            <img
              className="display-image"
              src={imageSrc ?? undefined}
              alt={basenameOf(active.path)}
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: dragRef.current ? 'grabbing' : 'grab',
              }}
              onError={() => setImgError(true)}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                dragRef.current = { startX: e.clientX - pan.x, startY: e.clientY - pan.y, panX: pan.x, panY: pan.y };
                e.preventDefault();
              }}
              onMouseMove={(e) => {
                if (!dragRef.current) return;
                setPan({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
              }}
              onMouseUp={() => (dragRef.current = null)}
              onMouseLeave={() => (dragRef.current = null)}
              onDoubleClick={resetView}
            />
          )}
        </div>
      );
    }

    if (active.kind === 'html') {
      return (
        <div className="display-html-wrap">
          <iframe
            className="display-iframe"
            sandbox="allow-scripts"
            title={title}
            srcDoc={content}
          />
          <div className="display-html-note">{t('display.htmlSandboxNote')}</div>
        </div>
      );
    }

    // text：按扩展名智能渲染
    if (MD_EXTS.has(ext)) {
      return (
        <div className="display-md-scroll">
          <div className="md">
            <Markdown text={content} />
          </div>
        </div>
      );
    }
    if (CODE_EXTS.has(ext)) {
      const lang = ext === 'tsx' || ext === 'jsx' || ext === 'ts' || ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'mts' ? 'tsx' : ext;
      return (
        <div className="display-code-scroll">
          <pre className="display-code mono">
            <code dangerouslySetInnerHTML={{ __html: highlightCode(content, lang) }} />
          </pre>
        </div>
      );
    }
    // 纯文本（含未知扩展名）
    return (
      <div className="display-plain-scroll">
        <pre className="display-plain mono">{content}</pre>
      </div>
    );
  };

  return (
    <Modal onClose={close} width="min(880px, calc(100vw - 32px))" className="display-modal">
      <div className="modal-head display-modal-head">
        <span className="display-modal-title">
          <Icon name="file" size={15} />
          <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{active.path}</span>
          <span className="display-title-text">{title}</span>
        </span>
        <div className="display-head-actions">
          {active.kind === 'image' && loadState === 'ok' && !imgError && (
            <span className="display-zoom-group">
              <button className="icon-btn" title={t('display.zoomOut')} onClick={zoomOut}><Icon name="zoom-out" size={15} /></button>
              <button className="icon-btn" title={t('display.resetView')} onClick={resetView}>{Math.round(zoom * 100)}%</button>
              <button className="icon-btn" title={t('display.zoomIn')} onClick={zoomIn}><Icon name="zoom-in" size={15} /></button>
            </span>
          )}
          <button className="icon-btn" title={t('common.close')} onClick={close}><Icon name="x" size={17} /></button>
        </div>
      </div>
      <div className="modal-body display-modal-body">{renderBody()}</div>
    </Modal>
  );
}

/** 解析消息上持久化的展示引用（displayRef JSON） */
export function parseStoredDisplayRef(json: string | null): DisplayFileRef | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Partial<DisplayFileRef>;
    if (!obj || typeof obj.path !== 'string' || !['text', 'image', 'html'].includes(obj.kind ?? '')) return null;
    return { path: obj.path, kind: obj.kind as DisplayFileRef['kind'], title: obj.title };
  } catch {
    return null;
  }
}

/** 工具结果消息上的「查看」按钮：随时重开已展示过的文件 */
export function FileDisplayViewButton({ displayRef }: { displayRef: string | null }) {
  const t = useT();
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  if (!displayRef) return null;
  return (
    <button
      className="btn btn-sm display-view-btn"
      onClick={() => {
        const ref = parseStoredDisplayRef(displayRef);
        if (ref) {
          setActiveDisplay({ path: ref.path, kind: ref.kind, title: ref.title });
        }
      }}
    >
      <Icon name="eye" size={12} /> {t('display.view')}
    </button>
  );
}