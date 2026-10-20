/**
 * 长按手势的纯逻辑（不依赖 React / DOM 实例），便于单元测试。
 * 与浏览器相关的部分（计时器、事件绑定）在 `longPress.ts`；
 * 视口坐标换算在 `viewport.ts`。
 */

type Point = { x: number; y: number };

/** 长按触发时间。 */
export const LONG_PRESS_DELAY_MS = 500;
/** 手指移动超过该距离即视为滚动/拖拽，取消长按。 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 12;
/** 嵌套在这些控件内的触摸不触发长按菜单。 */
export const INTERACTIVE_SELECTOR = 'button, input, textarea, select, a, [role="button"]';
/** 触摸按下后该窗口内到达的原生 contextmenu 视为同一次触摸手势。 */
export const TOUCH_CONTEXT_MENU_WINDOW_MS = 1200;
/** 自定义长按菜单已弹出后，忽略原生 contextmenu 的时间窗口。 */
export const CONTEXT_MENU_DEDUPE_MS = 1000;

/** 移动距离是否已超出长按容差。 */
export function exceedsMoveTolerance(
  start: Point,
  current: Point,
  tolerance = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerance;
}

/**
 * 是否应该开始长按计时。
 * - 仅触摸指针；鼠标 / 触控笔交给原生 contextmenu。
 * - 命中嵌套交互控件时忽略；但监听器本身挂在按钮上（交互目标是 currentTarget）时必须放行。
 */
export function shouldTrackLongPress(
  pointerType: string,
  interactiveTarget: unknown,
  currentTarget: unknown,
): boolean {
  if (pointerType !== 'touch') return false;
  return interactiveTarget == null || interactiveTarget === currentTarget;
}

/**
 * 原生 contextmenu 的来源信息。
 *
 * - `sinceTouchDown`：距最近一次触摸 pointerdown 的毫秒数，没有触摸时为 `Infinity`；
 * - `sinceLongPress`：距自定义长按菜单弹出的毫秒数，尚未弹出时为 `Infinity`。
 */
export type ContextMenuSource = {
  pointerType?: string;
  firesTouchEvents?: boolean;
  sinceTouchDown: number;
  sinceLongPress: number;
};

/** 该 contextmenu 是否由触摸手势产生（Android 上长按会补发一次）。 */
export function isTouchContextMenu(
  source: Pick<ContextMenuSource, 'pointerType' | 'firesTouchEvents' | 'sinceTouchDown'>,
  touchWindowMs = TOUCH_CONTEXT_MENU_WINDOW_MS,
): boolean {
  // 明确的鼠标/触控笔来源直接排除，避免混合设备上触摸后紧接右键被误判。
  if (source.firesTouchEvents === true) return true;
  if (source.pointerType === 'touch') return true;
  if (source.pointerType) return false;
  // 老 WebView 可能既没有 pointerType 也没有 sourceCapabilities：只能靠时间窗。
  return source.sinceTouchDown <= touchWindowMs;
}

/**
 * 软键盘弹出时，手势结束时是否应主动让输入框失焦（收起键盘）。
 *
 * 只有点击才失焦：滑动页面必须保留焦点，否则用户一滚动聊天记录键盘就没了；
 * 长按已经由 `triggeredRef` 标记（可能是在选词或拖动光标），同样不算点击。
 */
export function shouldBlurAfterTap(
  keyboardOpenAtDown: boolean,
  moved: boolean,
  longPressed: boolean,
): boolean {
  return keyboardOpenAtDown && !moved && !longPressed;
}

/**
 * 软键盘弹出期间，触摸长按（以及系统随后补发的 contextmenu）不应弹出菜单。
 *
 * 鼠标右键不受影响：同一台设备可能既连着鼠标又弹着软键盘。
 */
export function shouldSuppressTouchContextMenu(
  source: Pick<ContextMenuSource, 'pointerType' | 'firesTouchEvents' | 'sinceTouchDown'>,
  keyboardOpen: boolean,
  touchWindowMs = TOUCH_CONTEXT_MENU_WINDOW_MS,
): boolean {
  return keyboardOpen && isTouchContextMenu(source, touchWindowMs);
}

/**
 * 是否忽略这次原生 contextmenu。
 *
 * 触摸长按时自定义计时器已经弹出菜单，随后系统补发的 contextmenu 若再按
 * 自己的坐标打开一次，菜单就会重新挂载并产生可见位移（Android 微信内置
 * 浏览器上尤其明显）。只去重“菜单已经弹出”的这一段窗口；若原生手势抢先
 * 取消了指针事件、计时器没跑起来，则仍然放行 contextmenu 作为兜底。
 */
export function shouldIgnoreContextMenu(
  source: ContextMenuSource,
  dedupeMs = CONTEXT_MENU_DEDUPE_MS,
  touchWindowMs = TOUCH_CONTEXT_MENU_WINDOW_MS,
): boolean {
  return isTouchContextMenu(source, touchWindowMs) && source.sinceLongPress <= dedupeMs;
}
