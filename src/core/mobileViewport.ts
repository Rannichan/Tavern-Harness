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
 *   若紧接着是键盘的大幅收缩就合并成一次位移。
 *
 * Edge Android 上壳层始终使用显式像素高度（而不是 100%）：
 * 即使 resize 事件晚于绘制，壳层也只会停在旧高度，不会先跟到 822 再弹回 765。
 * 其他浏览器默认继续用 100% 跟随，只有真正观察到“关闭时超过已知高度”才切换为像素高度。
 *
 * 只在移动端断点内生效；桌面端会移除变量，不受影响。
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

let started = false;
let lastHeight = 0;
let lastWidth = 0;
/** 最近一次键盘关闭状态下的视口高度（含地址栏/工具栏）。 */
let closedCandidate = 0;
/** 本次键盘关闭后应当回到的高度。 */
let closedHeight = 0;
let keyboardOpen = false;
let focused = false;
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
