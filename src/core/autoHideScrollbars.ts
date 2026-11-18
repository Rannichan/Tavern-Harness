// ============================================================
// 全局悬浮滚动条
//
// 原生滚动条会占据布局宽度、外观也随平台变化。这里把原生滚动条完全
// 隐藏（见 global.css），再以 position: fixed 的细条覆盖在滚动容器上：
//   * 只在容器滚动时出现，静止一段时间后淡出；
//   * 悬浮绘制，不参与 layout，出现/消失都不会让内容尺寸跳动。
//
// 滚动事件不冒泡，但可以在 document 上以 capture 捕获到所有容器。
// 启动时调用一次 installAutoHideScrollbars() 即可。
// ============================================================

const IDLE_HIDE_MS = 1400;
const THICKNESS = 6;
const EDGE_INSET = 3;
const MIN_THUMB = 28;

interface ThumbPair {
  vertical: HTMLDivElement | null;
  horizontal: HTMLDivElement | null;
  timer: number;
}

interface ScrollMetrics {
  innerTop: number;
  innerLeft: number;
  innerWidth: number;
  innerHeight: number;
  scrollTop: number;
  scrollLeft: number;
  scrollWidth: number;
  scrollHeight: number;
}

const pairs = new WeakMap<Element, ThumbPair>();
const dirty = new Set<Element>();
const active = new Set<Element>();
let layer: HTMLDivElement | null = null;
let frame = 0;

function getLayer(): HTMLDivElement {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'th-scrollbar-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function getPair(el: Element): ThumbPair {
  let pair = pairs.get(el);
  if (!pair) {
    pair = { vertical: null, horizontal: null, timer: 0 };
    pairs.set(el, pair);
  }
  return pair;
}

function getThumb(pair: ThumbPair, axis: 'vertical' | 'horizontal'): HTMLDivElement {
  if (axis === 'vertical') {
    if (!pair.vertical) {
      pair.vertical = document.createElement('div');
      pair.vertical.className = 'th-scrollbar-thumb th-scrollbar-thumb--v';
      getLayer().appendChild(pair.vertical);
    }
    return pair.vertical;
  }
  if (!pair.horizontal) {
    pair.horizontal = document.createElement('div');
    pair.horizontal.className = 'th-scrollbar-thumb th-scrollbar-thumb--h';
    getLayer().appendChild(pair.horizontal);
  }
  return pair.horizontal;
}

function measure(el: Element): ScrollMetrics | null {
  if (el === document.documentElement) {
    const se = document.scrollingElement ?? document.documentElement;
    return {
      innerTop: 0,
      innerLeft: 0,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollTop: window.scrollY,
      scrollLeft: window.scrollX,
      scrollWidth: se.scrollWidth,
      scrollHeight: se.scrollHeight,
    };
  }
  if (!(el instanceof HTMLElement) || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    innerTop: rect.top + el.clientTop,
    innerLeft: rect.left + el.clientLeft,
    innerWidth: el.clientWidth,
    innerHeight: el.clientHeight,
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
  };
}

function positionVertical(node: HTMLDivElement, m: ScrollMetrics): boolean {
  if (m.scrollHeight - m.innerHeight <= 1) return false;
  const trackTop = m.innerTop + EDGE_INSET;
  const trackHeight = m.innerHeight - EDGE_INSET * 2;
  const thumbHeight = Math.max(MIN_THUMB, (trackHeight * m.innerHeight) / m.scrollHeight);
  if (thumbHeight >= trackHeight) return false;
  const maxScroll = m.scrollHeight - m.innerHeight;
  const progress = maxScroll > 0 ? Math.min(1, Math.max(0, m.scrollTop / maxScroll)) : 0;
  node.style.left = `${m.innerLeft + m.innerWidth - THICKNESS - EDGE_INSET}px`;
  node.style.top = `${trackTop + (trackHeight - thumbHeight) * progress}px`;
  node.style.height = `${thumbHeight}px`;
  return true;
}

function positionHorizontal(node: HTMLDivElement, m: ScrollMetrics): boolean {
  if (m.scrollWidth - m.innerWidth <= 1) return false;
  const trackLeft = m.innerLeft + EDGE_INSET;
  const trackWidth = m.innerWidth - EDGE_INSET * 2;
  const thumbWidth = Math.max(MIN_THUMB, (trackWidth * m.innerWidth) / m.scrollWidth);
  if (thumbWidth >= trackWidth) return false;
  const maxScroll = m.scrollWidth - m.innerWidth;
  const progress = maxScroll > 0 ? Math.min(1, Math.max(0, m.scrollLeft / maxScroll)) : 0;
  node.style.top = `${m.innerTop + m.innerHeight - THICKNESS - EDGE_INSET}px`;
  node.style.left = `${trackLeft + (trackWidth - thumbWidth) * progress}px`;
  node.style.width = `${thumbWidth}px`;
  return true;
}

function hidePair(pair: ThumbPair): void {
  pair.vertical?.classList.remove('is-visible');
  pair.horizontal?.classList.remove('is-visible');
}

function update(el: Element): void {
  const metrics = measure(el);
  if (!metrics) return;
  const pair = getPair(el);
  const vertical = getThumb(pair, 'vertical');
  const horizontal = getThumb(pair, 'horizontal');
  const hasVertical = positionVertical(vertical, metrics);
  const hasHorizontal = positionHorizontal(horizontal, metrics);

  vertical.classList.toggle('is-visible', hasVertical);
  horizontal.classList.toggle('is-visible', hasHorizontal);
  active.add(el);

  window.clearTimeout(pair.timer);
  pair.timer = window.setTimeout(() => {
    hidePair(pair);
    active.delete(el);
    // 容器已被移除时顺手回收浮层节点（WeakMap 无法清理 DOM 引用）。
    if (!el.isConnected) {
      pair.vertical?.remove();
      pair.horizontal?.remove();
      pairs.delete(el);
    }
  }, IDLE_HIDE_MS);
}

function flush(): void {
  frame = 0;
  for (const el of dirty) update(el);
  dirty.clear();
}

function onScroll(event: Event): void {
  const target = event.target;
  let el: Element;
  if (target === document) el = document.documentElement;
  else if (target instanceof Element) el = target;
  else return;
  dirty.add(el);
  if (frame === 0) frame = window.requestAnimationFrame(flush);
}

export function installAutoHideScrollbars(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // 视口尺寸变化后旧坐标会失效，先收起，等下一次滚动重新定位。
  window.addEventListener('resize', () => {
    for (const el of active) {
      const pair = pairs.get(el);
      if (pair) hidePair(pair);
    }
    active.clear();
  });
}
