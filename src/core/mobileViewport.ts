/**
 * 移动端视口高度控制。
 *
 * Edge Android 的底部工具栏在键盘收起时会晚一步归位：
 * 布局视口先长到 822（工具栏仍隐藏），约一帧后才缩回 765（工具栏占 57px）。
 * 若壳层直接跟随 100%，内容就会先掉到 822 的底部、再被顶回 765，形成跳动。
 *
 * 这里用 `--app-height` 控制 fixed 壳层的高度：
 * - 键盘收起、视口长过已知的“关闭高度”时，先按关闭高度排版（多出的部分由工具栏覆盖）；
 * - 等视口真正回到该高度后再恢复跟随；
 * - 键盘弹起前紧邻的小幅地址栏/工具栏变化（约 17px）先按住 80ms，
 *   若紧接着是键盘的大幅收缩就合并成一次位移；
 * - 收起键盘时底部地址栏会先挤到键盘上方（视口再矮约 57px），这部分被键盘盖住，
 *   壳层保持不动，避免输入框先被顶上去、等工具栏滑走后再落回底部。
 *
 * Edge Android 上壳层始终使用显式像素高度（而不是 100%）：
 * 即使 resize 事件晚于绘制，壳层也只会停在旧高度，不会先跟到 822 再弹回 765。
 * 其他浏览器默认继续用 100% 跟随，只有真正观察到“关闭时超过已知高度”才切换为像素高度。
 *
 * 只在移动端断点内生效；桌面端会移除变量，不受影响。
 *
 * 此外对外提供 `isVirtualKeyboardOpen()` / `wasVirtualKeyboardOpenAtTouchStart()`：
 * 触屏长按手势需要知道软键盘是否（或手势开始时是否）弹出，以便在输入期间
 * 抑制长按菜单。
 */

// 显式带 .ts 后缀：本文件被 mobile-viewport.test.mjs 直接 import，
// Node 的 ESM 解析不会补后缀（浏览器构建侧由 Vite 处理）。
import { isEditableTarget } from './editable.ts';
import { MOBILE_MEDIA_QUERY, isMobileViewport } from './viewport.ts';

/** 键盘引起的视口变化通常 > 200px；地址栏/工具栏变化通常 < 60px。 */
const KEYBOARD_DELTA_PX = 120;
/** 合并键盘弹起前的小幅变化。 */
const SMALL_CHANGE_HOLD_MS = 80;
/** 键盘展开阶段合并二次高度变化（候选栏/工具栏收起）的等待时间。 */
const OPEN_SETTLE_MS = 40;
/** 工具栏一直不归位时（极少见），多久后接受当前高度。 */
const CLOSE_SETTLE_MS = 300;
/** 键盘展开期间，底部地址栏/工具栏最多能挤占的高度（约 57px，留出候选栏余量）。 */
const TOOLBAR_SQUEEZE_PX = 96;

let started = false;
let lastHeight = 0;
let lastWidth = 0;
/** 最近一次键盘关闭状态下的视口高度（含地址栏/工具栏）。 */
let closedCandidate = 0;
/** 本次键盘关闭后应当回到的高度。 */
let closedHeight = 0;
let keyboardOpen = false;
let focused = false;
/** 最近一次触摸开始时软键盘是否弹出（长按判定可能晚于键盘收起）。 */
let keyboardAtLastTouch = false;
let pendingSmall: number | null = null;
let holdBaseHeight = 0;
let holdTimer = 0;
let closeTimer = 0;
let openTimer = 0;
let opening = false;
let openingStart = 0;
let appliedHeight: number | null = null;
/** 是否用显式像素高度控制壳层（不跟随 100%）。 */
let explicitHeight = false;

export function isEdgeAndroidUa(userAgent: string): boolean {
  return /Android/i.test(userAgent) && /EdgA?\//.test(userAgent);
}

function isEdgeAndroid(): boolean {
  return isEdgeAndroidUa(navigator.userAgent);
}

function usesExplicitHeight(): boolean {
  return explicitHeight || isEdgeAndroid();
}

function applyHeight(px: number | null): void {
  const rounded = px == null ? null : Math.round(px);
  if (rounded === appliedHeight) return;
  appliedHeight = rounded;
  const style = document.documentElement.style;
  if (rounded == null) style.removeProperty('--app-height');
  else style.setProperty('--app-height', `${rounded}px`);
}

/** 跟随视口高度：Edge 用显式像素，其他浏览器交还 100%。 */
function followViewport(height: number): void {
  applyHeight(usesExplicitHeight() ? height : null);
}

function clearHold(): void {
  if (!holdTimer) return;
  window.clearTimeout(holdTimer);
  holdTimer = 0;
}

function clearCloseTimer(): void {
  if (!closeTimer) return;
  window.clearTimeout(closeTimer);
  closeTimer = 0;
}

function clearOpenTimer(): void {
  if (!openTimer) return;
  window.clearTimeout(openTimer);
  openTimer = 0;
}

function reset(): void {
  clearHold();
  clearCloseTimer();
  clearOpenTimer();
  opening = false;
  openingStart = 0;
  lastHeight = window.innerHeight;
  lastWidth = window.innerWidth;
  closedCandidate = lastHeight;
  closedHeight = lastHeight;
  keyboardOpen = false;
  focused = false;
  keyboardAtLastTouch = false;
  pendingSmall = null;
  holdBaseHeight = 0;
  // 需要显式像素高度时（Edge Android，或已观察到工具栏延迟归位）按当前高度排版；
  // 其余情况交还 100%，让浏览器自己跟随布局视口。
  applyHeight(isMobileViewport() && usesExplicitHeight() ? lastHeight : null);
}

/** 按住一次小幅变化，等可能的键盘收缩到来后合并。 */
function holdSmall(nextHeight: number, holdAt: number): void {
  if (pendingSmall == null) holdBaseHeight = holdAt;
  pendingSmall = nextHeight;
  applyHeight(holdBaseHeight);
  clearHold();
  holdTimer = window.setTimeout(() => {
    holdTimer = 0;
    if (keyboardOpen || pendingSmall == null) return;
    closedCandidate = pendingSmall;
    pendingSmall = null;
    followViewport(closedCandidate);
  }, SMALL_CHANGE_HOLD_MS);
}

function scheduleCloseSettle(): void {
  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    closeTimer = 0;
    if (!keyboardOpen) return;
    // 视口停在了一个更高的位置：接受它，避免内容一直悬浮
    closeSettled(window.innerHeight);
  }, CLOSE_SETTLE_MS);
}

function closeSettled(height: number): void {
  keyboardOpen = false;
  focused = false;
  closedHeight = height;
  closedCandidate = height;
  pendingSmall = null;
  holdBaseHeight = 0;
  clearHold();
  clearCloseTimer();
  followViewport(height);
}

/**
 * 键盘收起途中，若布局视口已经长过“工具栏归位后的高度”，
 * 返回应该使用的壳层高度（先按最终高度排版）；否则返回 null 表示跟随视口。
 * 纯函数，便于单测。
 */
export function clampDuringClose(height: number, closedHeight: number): number | null {
  return height > closedHeight + 2 ? closedHeight : null;
}

/**
 * 键盘展开期间，视口比壳层当前高度矮、但只矮了一点：多半是底部地址栏/
 * 工具栏挤到了键盘上方（Edge Android 收起键盘时地址栏会先占住页面底部）。
 *
 * 多出来的部分被键盘盖住，壳层不应该跟着压矮：否则输入框会先从键盘顶部
 * 上浮一点、停在那里，等键盘和地址栏都收起后再落回页面底部。超过工具栏
 * 高度的变化视为键盘本身变高，仍然要跟随，否则输入框会被藏到键盘后面。
 *
 * @param height 当前布局视口高度
 * @param shellHeight 壳层当前使用的像素高度（不跟随时为 null）
 * @param maxShortfall 允许被工具栏挤占的最大高度
 */
export function isToolbarSqueeze(
  height: number,
  shellHeight: number | null,
  maxShortfall = TOOLBAR_SQUEEZE_PX,
): boolean {
  if (shellHeight == null) return false;
  const shortfall = shellHeight - height;
  return shortfall > 0 && shortfall <= maxShortfall;
}

/**
 * 视觉视口是否明显矮于布局视口。
 *
 * Android 声明 `interactive-widget=resizes-content` 后会直接缩小布局视口，
 * 由 `keyboardOpen` 判断即可；iOS Safari 不认该声明，`innerHeight` 不变，
 * 只有 `visualViewport.height` 会按键盘高度收缩，这里用高度差兜底。
 *
 * 视觉视口会随页面缩放一起变小（双指缩放 / iOS 输入框自动放大），
 * 所以先按 `scale` 折算“没有键盘时的预期高度”，再判断是否被键盘压矮。
 */
export function isKeyboardViewportShrunk(
  visualHeight: number,
  layoutHeight: number,
  scale = 1,
  threshold = KEYBOARD_DELTA_PX,
): boolean {
  const expectedHeight = layoutHeight / Math.max(scale, 1);
  return visualHeight <= expectedHeight - threshold;
}

/**
 * 软键盘是否处于弹出状态。
 *
 * 用于抑制键盘弹出期间的长按右键菜单：此时用户仍在输入，长按多半是
 * 想移动光标 / 滚动内容，不应弹出自定义菜单。
 */
export function isVirtualKeyboardOpen(): boolean {
  if (keyboardOpen) return true;
  // iOS 等只收缩 visualViewport 的浏览器：键盘会把视觉视口压矮一大截，
  // 地址栏 / 工具栏的小幅变化和页面缩放（在 isKeyboardViewportShrunk 中折算）
  // 都不会触发。
  const viewport = window.visualViewport;
  return viewport != null
    && isKeyboardViewportShrunk(viewport.height, window.innerHeight, viewport.scale);
}

/**
 * 最近一次触摸开始时软键盘是否弹出。
 *
 * 长按菜单要等 500ms 才判定，触摸本身可能先让输入框失焦、系统随即收起键盘；
 * 没有接入 `useTouchLongPress` 的原生 contextmenu（例如对话压缩横幅）只能靠
 * 手势开始时的状态兜底。
 */
export function wasVirtualKeyboardOpenAtTouchStart(): boolean {
  return keyboardAtLastTouch;
}

function onResize(): void {
  if (!isMobileViewport()) {
    reset();
    return;
  }

  const height = window.innerHeight;
  const width = window.innerWidth;
  if (width !== lastWidth) {
    // 旋转屏幕 / 断点变化：旧的“关闭高度”不再适用
    reset();
    return;
  }
  // 同一帧可能同时收到 window.resize 与 visualViewport.resize，只处理一次
  if (height === lastHeight) return;

  const previous = lastHeight;
  const delta = height - previous;
  lastHeight = height;

  if (keyboardOpen && opening) {
    // 键盘高度还在展开过程中变化（例如候选栏收起）：继续等，不先排版
    if (height - openingStart < KEYBOARD_DELTA_PX) return;
    // 还没稳定就开始收起了：取消合并，交给下面的关闭逻辑
    opening = false;
    clearOpenTimer();
  }

  if (keyboardOpen) {
    const clamped = clampDuringClose(height, closedHeight);
    if (clamped != null) {
      // 观察到“关闭时超过已知高度”：后续都改用显式像素高度，避免事件晚到一帧
      explicitHeight = true;
      // 底部工具栏尚未归位：先按工具栏归位后的高度排版
      applyHeight(clamped);
      scheduleCloseSettle();
      return;
    }
    if (height >= closedHeight - 2) {
      closeSettled(height);
      return;
    }
    // 底部地址栏/工具栏先挤到键盘上方：多的部分被键盘盖住，保持壳层高度。
    // 跟随这次变矮会让输入框先上浮、停一会儿再落回底部，正是要避免的跳动。
    if (isToolbarSqueeze(height, appliedHeight)) return;
    // 仍在收起动画中（视口还没长到关闭高度），跟随
    followViewport(height);
    if (delta > 0) scheduleCloseSettle();
    return;
  }

  if (delta <= -KEYBOARD_DELTA_PX) {
    // 键盘弹起：合并此前按住的小幅地址栏变化
    clearHold();
    closedHeight = pendingSmall ?? closedCandidate;
    pendingSmall = null;
    holdBaseHeight = 0;
    keyboardOpen = true;
    // 键盘高度可能还会二次变化（候选栏/工具栏收起），等一小段再一次性落位，
    // 避免输入框先弹到较高位置、再落回键盘上方。
    opening = true;
    openingStart = height;
    clearOpenTimer();
    openTimer = window.setTimeout(() => {
      openTimer = 0;
      if (!opening) return;
      opening = false;
      followViewport(lastHeight);
    }, OPEN_SETTLE_MS);
    return;
  }

  closedCandidate = height;
  if (focused && delta < 0) {
    holdSmall(height, previous);
    return;
  }

  clearHold();
  pendingSmall = null;
  holdBaseHeight = 0;
  followViewport(height);
}

export function initMobileViewport(): void {
  if (started) return;
  started = true;
  reset();
  window.addEventListener('resize', onResize);
  // visualViewport 的 resize 有时比 window.resize 更早到达，先设好 --app-height
  window.visualViewport?.addEventListener('resize', onResize);
  // 触摸刚开始时记下键盘状态：后续长按期间键盘可能被系统收起。
  // 用 pointerdown 而不是 touchstart：它在焦点默认行为之前触发，能可靠地
  // 读到“点击空白处之前”的键盘状态。
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'touch') keyboardAtLastTouch = isVirtualKeyboardOpen();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      if (isEditableTarget(event.target)) focused = true;
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (event) => {
      if (isEditableTarget(event.target)) focused = false;
    },
    true,
  );
  window.matchMedia(MOBILE_MEDIA_QUERY).addEventListener?.('change', () => {
    if (!isMobileViewport()) reset();
  });
}
