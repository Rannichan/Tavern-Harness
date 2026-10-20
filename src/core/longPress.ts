import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { isEditableTarget } from './editable';
import {
  INTERACTIVE_SELECTOR,
  LONG_PRESS_DELAY_MS,
  exceedsMoveTolerance,
  isTouchContextMenu,
  shouldIgnoreContextMenu,
  shouldTrackLongPress,
} from './longPressGesture';
import type { ViewportPoint } from './viewport';

/** iOS 的原生选词会与长按菜单抢事件，触发前后都清一次选区。 */
export function clearTextSelection(): void {
  const clear = () => window.getSelection()?.removeAllRanges();
  clear();
  requestAnimationFrame(clear);
}

type ContextMenuNativeEvent = MouseEvent & {
  pointerType?: string;
  sourceCapabilities?: { firesTouchEvents?: boolean };
};

export function useTouchLongPress(
  onLongPress: (point: ViewportPoint) => void,
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void,
  delay = LONG_PRESS_DELAY_MS,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<ViewportPoint | null>(null);
  const triggeredRef = useRef(false);
  // 最近一次触摸按下 / 长按菜单弹出的时间，用于识别系统补发的 contextmenu。
  const lastTouchAtRef = useRef(Number.NEGATIVE_INFINITY);
  const longPressAtRef = useRef(Number.NEGATIVE_INFINITY);
  // 系统 contextmenu 抢在计时器前面打开菜单时，计时器不要再打开第二次。
  const openedByContextMenuRef = useRef(false);
  // Keep the latest callbacks without restarting the timer when the row re-renders.
  const onLongPressRef = useRef(onLongPress);
  const onContextMenuRef = useRef(onContextMenu);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);
  useEffect(() => {
    onContextMenuRef.current = onContextMenu;
  }, [onContextMenu]);

  const cancel = () => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };

  // A row can unmount (session switch, list re-render) while a long press is
  // pending; without this cleanup the timer would open a menu for stale data.
  useEffect(() => () => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      const interactiveTarget = (event.target as Element).closest(INTERACTIVE_SELECTOR);
      // The listener may be attached to a button itself (for example, a sidebar
      // session). Only ignore nested interactive controls, not the target root.
      if (!shouldTrackLongPress(event.pointerType, interactiveTarget, event.currentTarget)) return;
      // Multi-touch / repeated pointerdown: drop any pending timer first.
      cancel();
      // iOS starts its document-level selection gesture before the long-press
      // timer completes. Suppress that native gesture immediately.
      event.preventDefault();
      lastTouchAtRef.current = performance.now();
      openedByContextMenuRef.current = false;
      triggeredRef.current = false;
      const point = { x: event.clientX, y: event.clientY };
      startRef.current = point;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startRef.current = null;
        triggeredRef.current = true;
        longPressAtRef.current = performance.now();
        clearTextSelection();
        // 原生 contextmenu 已经先一步弹出菜单：位置以它为准，避免二次定位。
        if (!openedByContextMenuRef.current) onLongPressRef.current(point);
      }, delay);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (exceedsMoveTolerance(start, { x: event.clientX, y: event.clientY })) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!triggeredRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      triggeredRef.current = false;
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // 可编辑控件（消息内联编辑器）保留原生右键与选词菜单。
      if (isEditableTarget(event.target)) return;
      // 其余区域：系统菜单一律由自定义菜单替代。
      event.preventDefault();
      const now = performance.now();
      const native = event.nativeEvent as ContextMenuNativeEvent;
      const source = {
        pointerType: native.pointerType,
        firesTouchEvents: native.sourceCapabilities?.firesTouchEvents,
        sinceTouchDown: now - lastTouchAtRef.current,
        sinceLongPress: now - longPressAtRef.current,
      };
      // 触摸长按：计时器已经弹出菜单时，忽略同一手势随后补发的 contextmenu，
      // 否则菜单会按原生坐标重新挂载，出现 Android 上可见的“微小位移”。
      const touchContextMenu = isTouchContextMenu(source);
      if (touchContextMenu && (triggeredRef.current || shouldIgnoreContextMenu(source))) return;
      // 如果原生手势取消了指针事件、计时器没跑起来，则仍然用 contextmenu
      // 的坐标兜底打开，保证菜单不会丢失；同时记下来，计时器稍后不要再开一次，
      // 并抑制这次长按松手后可能补发的 click（不误触会话/编辑按钮）。
      if (touchContextMenu) {
        openedByContextMenuRef.current = true;
        triggeredRef.current = true;
      }
      onContextMenuRef.current?.(event);
    },
  };
}
