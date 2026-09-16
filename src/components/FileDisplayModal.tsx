import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, Icon, Markdown } from './shared';
import { useStore } from '../store/store';
import { useT } from '../core/i18n';
import { highlightCode } from '../core/markdown';
import { readWorkspaceFileText, setWorkspaceDir } from '../core/tools/generatedSkillExecutor';
import { applySessionWorkspace } from '../core/tools/toolExecutor';
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
const PIP_ASPECT_RATIO = 11 / 9;
const PIP_EDGE_GAP = 12;
const PIP_MIN_WIDTH = 280;
const PIP_MIN_HEIGHT = 180;
const PIP_REFRESH_INTERVAL = 1000;
const HTML_READY_MESSAGE = 'tavern-html-preview-ready';
const HTML_READY_FALLBACK_MS = 3500;

interface PipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function extensionOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function basenameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function createHtmlPreviewDocument(content: string, token: string): string {
  const probe = `<script>(()=>{const token=${JSON.stringify(token)};const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));const settledImage=(image)=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})});addEventListener('load',async()=>{const resources=Promise.all([document.fonts?.ready?.catch(()=>{})??Promise.resolve(),...Array.from(document.images,settledImage)]);await Promise.race([resources,pause(2500)]);await pause(180);requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({type:${JSON.stringify(HTML_READY_MESSAGE)},token},'*')))},{once:true})})()<\/script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(content);
  if (head?.index !== undefined) {
    const insertion = head.index + head[0].length;
    return `${content.slice(0, insertion)}${probe}${content.slice(insertion)}`;
  }
  const html = /<html(?:\s[^>]*)?>/i.exec(content);
  if (html?.index !== undefined) {
    const insertion = html.index + html[0].length;
    return `${content.slice(0, insertion)}<head>${probe}</head>${content.slice(insertion)}`;
  }
  return `<head>${probe}</head>${content}`;
}

export function FileDisplayModal() {
  const t = useT();
  const active = useStore((s) => s.activeDisplay);
  const setActiveDisplay = useStore((s) => s.setActiveDisplay);
  const [content, setContent] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [imgError, setImgError] = useState(false);
  const [htmlZoom, setHtmlZoom] = useState(1);
  const [htmlReady, setHtmlReady] = useState(false);
  const [textWrap, setTextWrap] = useState(true);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [pipRect, setPipRect] = useState<PipRect>({ x: 0, y: 0, width: 440, height: 360 });
  const contentRef = useRef<string | null>(null);
  const htmlRevealGenerationRef = useRef(0);
  const htmlIframeRef = useRef<HTMLIFrameElement>(null);
  const pipGestureRef = useRef<
    | { type: 'move'; pointerX: number; pointerY: number; startX: number; startY: number }
    | { type: 'resize'; pointerX: number; pointerY: number; startWidth: number; startHeight: number }
    | null
  >(null);
  // 图片缩放 / 平移
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const hideHtml = () => {
    htmlRevealGenerationRef.current += 1;
    setHtmlReady(false);
  };

  const ref: DisplayFileRef | null = useMemo(() => {
    if (!active) return null;
    return { path: active.path, kind: active.kind, title: active.title };
  }, [active]);

  const htmlPreview = useMemo(() => {
    if (active?.kind !== 'html' || content === null) return null;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { token, srcDoc: createHtmlPreviewDocument(content, token) };
  }, [active?.kind, content, isPictureInPicture]);

  useEffect(() => {
    if (!htmlPreview) return;
    const generation = htmlRevealGenerationRef.current;
    const reveal = () => {
      if (htmlRevealGenerationRef.current === generation) setHtmlReady(true);
    };
    const handleMessage = (event: MessageEvent) => {
      if (
        event.source === htmlIframeRef.current?.contentWindow
        && event.data?.type === HTML_READY_MESSAGE
        && event.data?.token === htmlPreview.token
      ) reveal();
    };
    const fallback = window.setTimeout(reveal, HTML_READY_FALLBACK_MS);
    window.addEventListener('message', handleMessage);
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener('message', handleMessage);
    };
  }, [htmlPreview]);

  useLayoutEffect(() => {
    setLoadState('loading');
    contentRef.current = null;
    setContent(null);
    setImgError(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setHtmlZoom(1);
    hideHtml();
    setTextWrap(true);
    setIsPictureInPicture(false);
  }, [active]);

  useEffect(() => {
    if (!active || !isPictureInPicture) return;
    let cancelled = false;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        if (active.sessionId != null) {
          try {
            await applySessionWorkspace(active.sessionId);
          } catch {
            setWorkspaceDir(null);
          }
        } else {
          setWorkspaceDir(null);
        }
        const text = await readWorkspaceFileText(active.path);
        if (cancelled || text === null) return;
        if (contentRef.current !== text) {
          hideHtml();
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
      if (active.sessionId != null) {
        try {
          await applySessionWorkspace(active.sessionId);
        } catch {
          setWorkspaceDir(null);
        }
      } else {
        setWorkspaceDir(null);
      }
      const text = await readWorkspaceFileText(active.path);
      if (cancelled) return;
      if (text === null) {
        setLoadState('error');
        return;
      }
      contentRef.current = text;
      setContent(text);
      setLoadState('ok');
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
      if (gesture.type === 'move') {
        setPipRect((rect) => ({
          ...rect,
          x: Math.min(
            Math.max(PIP_EDGE_GAP, window.innerWidth - rect.width - PIP_EDGE_GAP),
            Math.max(PIP_EDGE_GAP, gesture.startX + e.clientX - gesture.pointerX),
          ),
          y: Math.min(
            Math.max(PIP_EDGE_GAP, window.innerHeight - rect.height - PIP_EDGE_GAP),
            Math.max(PIP_EDGE_GAP, gesture.startY + e.clientY - gesture.pointerY),
          ),
        }));
        return;
      }
      setPipRect((rect) => {
        const availableWidth = window.innerWidth - rect.x - PIP_EDGE_GAP;
        const availableHeight = window.innerHeight - rect.y - PIP_EDGE_GAP;
        return {
          ...rect,
          width: Math.min(availableWidth, Math.max(Math.min(PIP_MIN_WIDTH, availableWidth), gesture.startWidth + e.clientX - gesture.pointerX)),
          height: Math.min(availableHeight, Math.max(Math.min(PIP_MIN_HEIGHT, availableHeight), gesture.startHeight + e.clientY - gesture.pointerY)),
        };
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

  const close = () => setActiveDisplay(null);

  const enterPictureInPicture = () => {
    const maxWidth = Math.max(260, Math.min(560, window.innerWidth - PIP_EDGE_GAP * 2, (window.innerHeight - PIP_EDGE_GAP * 2) * PIP_ASPECT_RATIO));
    const width = Math.min(440, maxWidth);
    const height = width / PIP_ASPECT_RATIO;
    setPipRect({
      x: window.innerWidth - width - PIP_EDGE_GAP,
      y: window.innerHeight - height - PIP_EDGE_GAP,
      width,
      height,
    });
    hideHtml();
    setIsPictureInPicture(true);
  };

  const exitPictureInPicture = () => {
    hideHtml();
    setIsPictureInPicture(false);
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
  const htmlZoomIn = () => setHtmlZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)));
  const htmlZoomOut = () => setHtmlZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)));
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
          <div className="display-html-viewport" aria-busy={!htmlReady}>
            <div className={`display-html-loading ${htmlReady ? 'hidden' : ''}`}>
              <span className="spinner" style={{ width: 22, height: 22 }} />
              <span>{t('display.loading')}</span>
            </div>
            <iframe
              ref={htmlIframeRef}
              className={`display-iframe ${htmlReady ? 'ready' : ''}`}
              sandbox="allow-scripts"
              title={title}
              srcDoc={htmlPreview?.srcDoc}
              style={{
                width: `calc(${100 / htmlZoom}% + ${2 / htmlZoom}px)`,
                height: `calc(${100 / htmlZoom}% + ${2 / htmlZoom}px)`,
                transform: `scale(${htmlZoom})`,
              }}
            />
          </div>
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
          {active.kind === 'html' && loadState === 'ok' && (
            <span className="display-zoom-group">
              <button className="icon-btn" title={t('display.htmlZoomOut')} onClick={htmlZoomOut}><Icon name="zoom-out" size={15} /></button>
              <button className="icon-btn" title={t('display.resetHtmlZoom')} onClick={() => setHtmlZoom(1)}>{Math.round(htmlZoom * 100)}%</button>
              <button className="icon-btn" title={t('display.htmlZoomIn')} onClick={htmlZoomIn}><Icon name="zoom-in" size={15} /></button>
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

  if (isPictureInPicture) {
    return createPortal(
      <div
        className="display-pip card"
        style={{ left: pipRect.x, top: pipRect.y, width: pipRect.width, height: pipRect.height }}
      >
        <div
          className="display-pip-drag-layer"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            pipGestureRef.current = { type: 'move', pointerX: e.clientX, pointerY: e.clientY, startX: pipRect.x, startY: pipRect.y };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
          onLostPointerCapture={() => (pipGestureRef.current = null)}
        >
          {preview}
        </div>
        <button
          className="display-pip-resize"
          title={t('display.resizePictureInPicture')}
          aria-label={t('display.resizePictureInPicture')}
          onPointerDown={(e) => {
            pipGestureRef.current = {
              type: 'resize',
              pointerX: e.clientX,
              pointerY: e.clientY,
              startWidth: pipRect.width,
              startHeight: pipRect.height,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
          onLostPointerCapture={() => (pipGestureRef.current = null)}
        />
      </div>,
      document.body,
    );
  }

  return (
    <Modal onClose={close} width="min(880px, calc(100vw - 32px))" className="display-modal">
      {preview}
    </Modal>
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