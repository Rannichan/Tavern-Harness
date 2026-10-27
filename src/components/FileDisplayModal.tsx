import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Markdown } from './shared';
import { useStore } from '../store/store';
import { useT } from '../core/i18n';
import { highlightCode } from '../core/markdown';
import { readWorkspaceFileText } from '../core/tools/generatedSkillExecutor';
import { applySessionWorkspace } from '../core/tools/toolExecutor';
import { fixedViewportBounds, isMobileViewport } from '../core/viewport';
import type { DisplayFileRef } from '../types/models';

// ============================================================
// 文件展示弹窗（file_display 内置工具）
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
const PIP_EDGE_GAP = 12;
const PIP_MIN_WIDTH = 280;
const PIP_MIN_HEIGHT = 180;
const PIP_REFRESH_INTERVAL = 1000;

interface PipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createPipRect(): PipRect {
  // 用 visualViewport 边界（而不是 innerWidth/innerHeight）：Edge Android 的
  // 底部工具栏不在布局视口里，PiP 落到底部时会被工具栏盖住。
  const bounds = fixedViewportBounds();
  const availableWidth = Math.max(0, bounds.right - bounds.left - PIP_EDGE_GAP * 2);
  const availableHeight = Math.max(0, bounds.bottom - bounds.top - PIP_EDGE_GAP * 2);
  const isMobile = isMobileViewport();
  const width = Math.min(isMobile ? PIP_MIN_WIDTH : 440, availableWidth);
  const height = Math.min(isMobile ? PIP_MIN_HEIGHT : 380, availableHeight);
  return {
    x: Math.max(bounds.left + PIP_EDGE_GAP, bounds.right - width - PIP_EDGE_GAP),
    y: Math.max(bounds.top + PIP_EDGE_GAP, bounds.bottom - height - PIP_EDGE_GAP),
    width,
    height,
  };
}

function extensionOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function basenameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function previewUrl(path: string, workspaceDir: string): string {
  return `/api-v2/preview/${encodeURIComponent(workspaceDir)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function FileDisplayModal() {
  const t = useT();
  const active = useStore((s) => s.activeDisplay);
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const [content, setContent] = useState<string | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [imgError, setImgError] = useState(false);
  const [htmlZoom, setHtmlZoom] = useState(1);
  const lastModalHtmlZoomRef = useRef(1);
  const [textWrap, setTextWrap] = useState(true);
  const [isPictureInPicture, setIsPictureInPicture] = useState(true);
  const [pipRect, setPipRect] = useState<PipRect>(createPipRect);
  const contentRef = useRef<string | null>(null);
  const wasDisplayOpenRef = useRef(false);
  const pipGestureRef = useRef<
    | { type: 'move'; pointerX: number; pointerY: number; startX: number; startY: number }
    | {
      type: 'resize';
      edge: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
      pointerX: number;
      pointerY: number;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
    }
    | null
  >(null);
  // 图片缩放 / 平移
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const ref: DisplayFileRef | null = useMemo(() => {
    if (!active) return null;
    return { path: active.path, kind: active.kind, title: active.title };
  }, [active]);

  useLayoutEffect(() => {
    if (!active) {
      wasDisplayOpenRef.current = false;
      return;
    }

    const isNewDisplay = !wasDisplayOpenRef.current;
    wasDisplayOpenRef.current = true;
    setLoadState('loading');
    setWorkspaceDir(null);
    contentRef.current = null;
    setContent(null);
    setImgError(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTextWrap(true);
    if (isNewDisplay) {
      const opensInPictureInPicture = active.presentation === 'pip' || active.presentation == null;
      setHtmlZoom(opensInPictureInPicture ? lastModalHtmlZoomRef.current : 1);
      setPipRect(createPipRect());
      setIsPictureInPicture(opensInPictureInPicture);
    } else {
      setHtmlZoom(1);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !isPictureInPicture) return;
    let cancelled = false;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        if (active.sessionId == null) throw new Error('缺少会话工作目录');
        const workspaceDir = await applySessionWorkspace(active.sessionId);
        const text = await readWorkspaceFileText(active.path, workspaceDir);
        if (cancelled || text === null) return;
        setWorkspaceDir(workspaceDir);
        if (contentRef.current !== text) {
          contentRef.current = text;
          setContent(text);
        }
        setLoadState('ok');
        setImgError(false);
      } finally {
        reading = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), PIP_REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, isPictureInPicture]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // 按产生该展示的会话设置工作目录：普通弹窗（active.sessionId = 当前会话）读当前会话工作区；
    // 回看历史消息（sessionId 持久化）读该会话自己的工作区
    const read = async () => {
      try {
        if (active.sessionId == null) throw new Error('缺少会话工作目录');
        const workspaceDir = await applySessionWorkspace(active.sessionId);
        const text = await readWorkspaceFileText(active.path, workspaceDir);
        if (cancelled) return;
        setWorkspaceDir(workspaceDir);
        if (text === null) {
          setLoadState('error');
          return;
        }
        contentRef.current = text;
        setContent(text);
        setLoadState('ok');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!isPictureInPicture) return;
    const handlePointerMove = (e: PointerEvent) => {
      const gesture = pipGestureRef.current;
      if (!gesture) return;
      if (e.buttons === 0) {
        pipGestureRef.current = null;
        return;
      }
      // 与 createPipRect 使用同一套视觉视口边界，避免拖到 Edge Android
      // 底部工具栏下面（innerHeight 包含被工具栏覆盖的区域）。
      const bounds = fixedViewportBounds();
      if (gesture.type === 'move') {
        setPipRect((rect) => {
          const minX = bounds.left + PIP_EDGE_GAP;
          const maxX = Math.max(minX, bounds.right - rect.width - PIP_EDGE_GAP);
          const minY = bounds.top + PIP_EDGE_GAP;
          const maxY = Math.max(minY, bounds.bottom - rect.height - PIP_EDGE_GAP);
          return {
            ...rect,
            x: Math.min(maxX, Math.max(minX, gesture.startX + e.clientX - gesture.pointerX)),
            y: Math.min(maxY, Math.max(minY, gesture.startY + e.clientY - gesture.pointerY)),
          };
        });
        return;
      }
      setPipRect(() => {
        const minX = bounds.left + PIP_EDGE_GAP;
        const maxX = bounds.right - PIP_EDGE_GAP;
        const minY = bounds.top + PIP_EDGE_GAP;
        const maxY = bounds.bottom - PIP_EDGE_GAP;
        const minWidth = Math.min(PIP_MIN_WIDTH, maxX - minX);
        const minHeight = Math.min(PIP_MIN_HEIGHT, maxY - minY);
        const deltaX = e.clientX - gesture.pointerX;
        const deltaY = e.clientY - gesture.pointerY;
        let x = gesture.startX;
        let y = gesture.startY;
        let width = gesture.startWidth;
        let height = gesture.startHeight;

        if (gesture.edge.endsWith('left')) {
          x = Math.min(gesture.startX + gesture.startWidth - minWidth, Math.max(minX, gesture.startX + deltaX));
          width = gesture.startX + gesture.startWidth - x;
        } else {
          width = Math.max(minWidth, Math.min(maxX - gesture.startX, gesture.startWidth + deltaX));
        }
        if (gesture.edge.startsWith('top')) {
          y = Math.min(gesture.startY + gesture.startHeight - minHeight, Math.max(minY, gesture.startY + deltaY));
          height = gesture.startY + gesture.startHeight - y;
        } else {
          height = Math.max(minHeight, Math.min(maxY - gesture.startY, gesture.startHeight + deltaY));
        }
        return { x, y, width, height };
      });
    };
    const stopGesture = () => (pipGestureRef.current = null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopGesture);
    window.addEventListener('pointercancel', stopGesture);
    window.addEventListener('blur', stopGesture);
    return () => {
      pipGestureRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopGesture);
      window.removeEventListener('pointercancel', stopGesture);
      window.removeEventListener('blur', stopGesture);
    };
  }, [isPictureInPicture]);

  const title = active?.title?.trim() || (active ? basenameOf(active.path) : '');
  const ext = active ? extensionOf(active.path) : '';
  const isWorkspacePreview = active?.presentation === 'workspace';

  const close = () => setActiveDisplay(null);

  const enterPictureInPicture = () => {
    setPipRect(createPipRect());
    setIsPictureInPicture(true);
  };

  const exitPictureInPicture = () => {
    setIsPictureInPicture(false);
  };

  const openHtmlInNewPage = () => {
    if (!active || !workspaceDir) return;
    window.open(previewUrl(active.path, workspaceDir), '_blank', 'noopener,noreferrer');
  };

  const startResize = (edge: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => (e: ReactPointerEvent<HTMLButtonElement>) => {
    pipGestureRef.current = {
      type: 'resize',
      edge,
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: pipRect.x,
      startY: pipRect.y,
      startWidth: pipRect.width,
      startHeight: pipRect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

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
  const updateHtmlZoom = (update: (zoom: number) => number) => {
    setHtmlZoom((zoom) => {
      const nextZoom = update(zoom);
      if (!isPictureInPicture) lastModalHtmlZoomRef.current = nextZoom;
      return nextZoom;
    });
  };
  const htmlZoomIn = () => updateHtmlZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)));
  const htmlZoomOut = () => updateHtmlZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)));
  const resetHtmlZoom = () => updateHtmlZoom(() => 1);
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
      if (!workspaceDir) return <div className="display-error">{t('display.fileError', { path: active.path })}</div>;
      return (
        <div className="display-html-wrap">
          <div className="display-html-viewport">
            <iframe
              className="display-iframe ready"
              sandbox="allow-scripts allow-pointer-lock"
              title={title}
              src={previewUrl(active.path, workspaceDir)}
              style={{
                width: `calc(${100 / htmlZoom}% + ${2 / htmlZoom}px)`,
                height: `calc(${100 / htmlZoom}% + ${2 / htmlZoom}px)`,
                transform: `scale(${htmlZoom})`,
              }}
            />
          </div>
          <div className="display-html-note">
            <span>{t('display.htmlSandboxNote')}</span>
            {!isPictureInPicture && (
              <span className="display-html-zoom-group">
                <button className="icon-btn" title={t('display.htmlZoomOut')} onClick={htmlZoomOut}><Icon name="zoom-out" size={15} /></button>
                <button className="icon-btn" title={t('display.resetHtmlZoom')} onClick={resetHtmlZoom}>{Math.round(htmlZoom * 100)}%</button>
                <button className="icon-btn" title={t('display.htmlZoomIn')} onClick={htmlZoomIn}><Icon name="zoom-in" size={15} /></button>
              </span>
            )}
          </div>
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
          <pre className={`display-code mono ${textWrap ? 'wrapped' : ''}`}>
            <code dangerouslySetInnerHTML={{ __html: highlightCode(content, lang) }} />
          </pre>
        </div>
      );
    }
    // 纯文本（含未知扩展名）
    return (
      <div className="display-plain-scroll">
        <pre className={`display-plain mono ${textWrap ? 'wrapped' : ''}`}>{content}</pre>
      </div>
    );
  };

  const preview = (
    <>
      <div
        className="modal-head display-modal-head"
        onPointerDown={(e) => {
          if (!isPictureInPicture || (e.target as HTMLElement).closest('button')) return;
          pipGestureRef.current = { type: 'move', pointerX: e.clientX, pointerY: e.clientY, startX: pipRect.x, startY: pipRect.y };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onLostPointerCapture={() => (pipGestureRef.current = null)}
      >
        <span className="display-modal-title">
          <Icon name="file" size={15} />
          <span className="mono typo-body-sm text-secondary">{active.path}</span>
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
          {active.kind === 'text' && !MD_EXTS.has(ext) && loadState === 'ok' && (
            <button
              className={`icon-btn ${textWrap ? 'active' : ''}`}
              title={t(textWrap ? 'display.disableWrap' : 'display.enableWrap')}
              aria-label={t(textWrap ? 'display.disableWrap' : 'display.enableWrap')}
              aria-pressed={textWrap}
              onClick={() => setTextWrap((wrapped) => !wrapped)}
            >
              <Icon name="text-wrap" size={17} />
            </button>
          )}
          {active.kind === 'html' && loadState === 'ok' && workspaceDir && (
            <button
              className="icon-btn"
              title={t('display.openHtmlInNewPage')}
              aria-label={t('display.openHtmlInNewPage')}
              onClick={openHtmlInNewPage}
            >
              <Icon name="open-in-new" size={17} />
            </button>
          )}
          <button
            className="icon-btn"
            title={t(isPictureInPicture ? 'display.exitPictureInPicture' : 'display.pictureInPicture')}
            aria-label={t(isPictureInPicture ? 'display.exitPictureInPicture' : 'display.pictureInPicture')}
            onClick={() => isPictureInPicture ? exitPictureInPicture() : enterPictureInPicture()}
          >
            <Icon name={isPictureInPicture ? 'pip-exit' : 'pip'} size={17} />
          </button>
          <button className="icon-btn" title={t('common.close')} onClick={close}><Icon name="x" size={17} /></button>
        </div>
      </div>
      <div className="modal-body display-modal-body">{renderBody()}</div>
    </>
  );

  return createPortal(
    <>
      {!isPictureInPicture && !isWorkspacePreview && <div key="overlay" className="overlay" />}
      <div
        key="display-container"
        className={isPictureInPicture ? 'display-pip card' : 'modal-root display-modal-root'}
        style={isPictureInPicture
          ? { left: pipRect.x, top: pipRect.y, width: pipRect.width, height: pipRect.height }
          : undefined}
        onClick={!isPictureInPicture ? (e) => e.stopPropagation() : undefined}
      >
        <div className={isPictureInPicture ? 'display-pip-drag-layer' : 'modal card fade-up display-modal'}>
          {preview}
        </div>
        {isPictureInPicture && (
          <>
            {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((edge) => (
              <button
                key={edge}
                className={`display-pip-resize display-pip-resize-${edge}`}
                title={t('display.resizePictureInPicture')}
                aria-label={t('display.resizePictureInPicture')}
                onPointerDown={startResize(edge)}
                onLostPointerCapture={() => (pipGestureRef.current = null)}
              />
            ))}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** 解析消息上持久化的展示引用（displayRef JSON） */
export function parseStoredDisplayRef(json: string | null): DisplayFileRef | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Partial<DisplayFileRef>;
    if (!obj || typeof obj.path !== 'string' || !['text', 'image', 'html'].includes(obj.kind ?? '')) return null;
    return {
      path: obj.path,
      kind: obj.kind as DisplayFileRef['kind'],
      title: obj.title,
      sessionId: typeof obj.sessionId === 'number' ? obj.sessionId : null,
    };
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
          setActiveDisplay({ path: ref.path, kind: ref.kind, title: ref.title, sessionId: ref.sessionId ?? null });
        }
      }}
    >
      <Icon name="eye" size={12} /> {t('display.view')}
    </button>
  );
}