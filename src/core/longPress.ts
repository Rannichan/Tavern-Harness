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
  shouldBlurAfterTap,
  shouldIgnoreContextMenu,
  shouldSuppressTouchContextMenu,
  shouldTrackLongPress,
} from './longPressGesture';
import { isVirtualKeyboardOpen, wasVirtualKeyboardOpenAtTouchStart } from './mobileViewport';
import type { ViewportPoint } from './viewport';

/** iOS 的原生选词会与长按菜单抢事件，触发前后都清一次选区。 */
export function clearTextSelection(): void {
  const clear = () => window.getSelection()?.removeAllRanges();
  clear();
  requestAnimationFrame(clear);
}

/** 让当前输入控件失焦（移动端会随之收起软键盘）。 */
function blurActiveEditable(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && isEditableTarget(active)) active.blur();
}

type ContextMenuNativeEvent = MouseEvent & {
  pointerType?: string;
  sourceCapabilities?: { firesTouchEvents?: boolean };
};

/**
 * 软键盘弹出期间是否应忽略一次原生 contextmenu。
 *
 * 供没有接入 `useTouchLongPress` 的元素（例如对话压缩横幅）使用：鼠标右键
 * 始终放行；触摸来源在键盘此刻弹出、或手势按下时键盘已弹出时抑制（触摸可能
 * 先让输入框失焦，系统随即收起键盘）。
 */
export function shouldSuppressContextMenuWhileTyping(event: MouseEvent): boolean {
  if ((event as ContextMenuNativeEvent).pointerType === 'mouse') return false;
  return isVirtualKeyboardOpen() || wasVirtualKeyboardOpenAtTouchStart();
}

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
  // 本次手势按下时软键盘是否已经弹出。键盘可能在 500ms 判定完成前就被
  // 系统收起，必须按手势开始时的状态判断，否则仍会弹出菜单。
  const keyboardAtDownRef = useRef(false);
  // 键盘弹出时的手势要区分“点击”与“滑动”：只有点击才主动失焦收起键盘，
  // 滑动页面时必须保留输入框焦点。
  const movedRef = useRef(false);
  const tapToBlurRef = useRef(false);
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
      const touch = event.pointerType === 'touch';
      // 每次按下都重新记录，避免上一次“键盘弹出中”的状态残留到新手势。
      keyboardAtDownRef.current = touch && isVirtualKeyboardOpen();
      movedRef.current = false;
      tapToBlurRef.current = false;
      if (touch) lastTouchAtRef.current = performance.now();
      const interactiveTarget = (event.target as Element).closest(INTERACTIVE_SELECTOR);
      // The listener may be attached to a button itself (for example, a sidebar
      // session). Only ignore nested interactive controls, not the target root.
      if (!shouldTrackLongPress(event.pointerType, interactiveTarget, event.currentTarget)) return;
      // Multi-touch / repeated pointerdown: drop any pending timer first.
      cancel();
      openedByContextMenuRef.current = false;
      triggeredRef.current = false;
      // 只有“键盘弹出时开始”的手势才需要在点击后失焦。
      tapToBlurRef.current = keyboardAtDownRef.current;
      const point = { x: event.clientX, y: event.clientY };
      startRef.current = point;
      // 软键盘弹出时用户仍在输入：不弹菜单。
      if (keyboardAtDownRef.current) {
        // 阻止触摸按下时的默认焦点切换：否则浏览器一按下就会让输入框
        // 失焦，滑动页面也会把键盘收起来。这里改为在 pointerup 时判断
        // 手势是否发生移动，只有点击（没有滑动）才主动失焦收起键盘。
        event.preventDefault();
        // 长按满时长后只标记本次手势，抑制松手补发的 click，
        // 避免把一次长按误当成会话切换 / 消息按钮点击。
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          // 保留 startRef：长按满 500ms 后用户仍可能拖动页面，
          // pointerup / pointermove 还要靠起点判断这是滑动而不是点击。
          triggeredRef.current = true;
        }, delay);
        return;
      }
      // iOS starts its document-level selection gesture before the long-press
      // timer completes. Suppress that native gesture immediately.
      event.preventDefault();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startRef.current = null;
        triggeredRef.current = true;
        // 手势进行期间键盘才弹出（例如多指 / 外接键盘切换）：同样不弹菜单。
        if (isVirtualKeyboardOpen()) return;
        longPressAtRef.current = performance.now();
        clearTextSelection();
        // 原生 contextmenu 已经先一步弹出菜单：位置以它为准，避免二次定位。
        if (!openedByContextMenuRef.current) onLongPressRef.current(point);
      }, delay);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (exceedsMoveTolerance(start, { x: event.clientX, y: event.clientY })) {
        movedRef.current = true;
        cancel();
      }
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      // 部分 WebView 滑动时不再派发 pointermove，抬手坐标也要参与判断，
      // 否则一次滑动手势会被误当成点击而收起键盘。
      const start = startRef.current;
      const moved = movedRef.current
        || (start != null && exceedsMoveTolerance(start, { x: event.clientX, y: event.clientY }));
      // 长按（triggered）不算点击，不做失焦，否则选词 / 移光标会顺手收起键盘。
      const shouldBlur = shouldBlurAfterTap(tapToBlurRef.current, moved, triggeredRef.current);
      tapToBlurRef.current = false;
      cancel();
      if (shouldBlur) blurActiveEditable();
    },
    onPointerCancel: () => {
      // 浏览器接管滚动 / 手势时会派发 pointercancel，这不算点击。
      tapToBlurRef.current = false;
      cancel();
    },
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
      // 软键盘弹出期间的长按不弹菜单：手势按下时键盘已经弹出，或此刻仍然
      // 弹出，都抑制这次系统补发的 contextmenu（鼠标右键不受影响）。
      const keyboardOpen = keyboardAtDownRef.current
        || isVirtualKeyboardOpen()
        || wasVirtualKeyboardOpenAtTouchStart();
      if (shouldSuppressTouchContextMenu(source, keyboardOpen)) return;
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
