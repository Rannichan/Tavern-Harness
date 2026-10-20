/**
 * 视口 / 弹层定位的纯计算 + 浏览器包装。
 * 纯函数部分不触碰 `window`，可以被 Node 单测直接导入。
 */

export type ViewportPoint = { x: number; y: number };
export type Viewport = {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
};
/** `position: fixed` 弹层使用的布局视口边界。 */
export type ViewportBounds = { left: number; top: number; right: number; bottom: number };
export type PopoverSize = { width: number; height: number };

/** 弹层与视口边缘的最小间距。 */
export const POPOVER_EDGE_GAP = 8;
/** 与 CSS `@media (max-width: 680px)` 保持一致。 */
export const MOBILE_BREAKPOINT_PX = 680;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

export function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/**
 * 把 client 坐标换算成 `position: fixed` 弹层使用的布局视口坐标。
 * 页面缩放时 client 坐标相对 visual viewport，而 fixed 定位相对 layout viewport。
 */
export function toLayoutViewportPoint(
  point: ViewportPoint,
  viewport?: Viewport | null,
): ViewportPoint {
  return {
    x: point.x + (viewport?.offsetLeft ?? 0),
    y: point.y + (viewport?.offsetTop ?? 0),
  };
}

/** fixed 弹层可用的布局视口边界；没有 visualViewport 时退回窗口尺寸。 */
export function layoutViewportBounds(
  viewport: Viewport | null | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): ViewportBounds {
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    left,
    top,
    right: left + (viewport?.width ?? fallbackWidth),
    bottom: top + (viewport?.height ?? fallbackHeight),
  };
}

/** client 坐标 → 布局视口坐标（缩放时两者不一致）。 */
export function fixedViewportPoint(point: ViewportPoint): ViewportPoint {
  return toLayoutViewportPoint(point, window.visualViewport);
}

/** fixed 弹层可用的布局视口边界。 */
export function fixedViewportBounds(): ViewportBounds {
  return layoutViewportBounds(window.visualViewport, window.innerWidth, window.innerHeight);
}

/**
 * 把弹层左上角钳制在可视区域内。`point` 必须已经是布局视口坐标
 * （通过 `fixedViewportPoint` 转换），`bounds` 来自 `fixedViewportBounds`。
 */
export function clampPopoverPosition(
  point: ViewportPoint,
  size: PopoverSize,
  bounds: ViewportBounds,
  gap = POPOVER_EDGE_GAP,
): { left: number; top: number } {
  return {
    left: Math.max(bounds.left + gap, Math.min(point.x, bounds.right - size.width - gap)),
    top: Math.max(bounds.top + gap, Math.min(point.y, bounds.bottom - size.height - gap)),
  };
}
