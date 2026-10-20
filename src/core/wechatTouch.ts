/**
 * 微信 Android 内置浏览器（X5 / XWeb）的长按兜底。
 *
 * `-webkit-touch-callout` 是 iOS 的扩展，Blink 内核不认；微信 Android 还会
 * 在原生层接管长按。即使气泡正文设置了 `user-select: none`，原生选词也会
 * “吸附”到附近唯一的可选文字（输入区模型名称、页面其它文本），弹出系统
 * 「复制 / 全选 / 搜一搜」菜单。这里做三层兜底：
 *
 * 1. 安装时给 `<html>` 加 `wechat-android` 类：`global.css` 用它将气泡正文
 *    等纯文本区域移出命中测试，并让聊天区内不再产生文本选区；
 * 2. 从消息 / 会话项开始触摸时，给 `<body>` 临时加内联 `user-select: none`
 *    （抬手后恢复），这样系统在 500ms 长按判定时找不到任何可选文字；
 *    只有非交互目标才加锁，输入框、消息内按钮、链接不受影响；
 * 3. 触摸期间阻止 `selectstart`，并清掉落到非输入控件上的选区。
 *
 * 只在 Android + MicroMessenger 下安装。输入框 / 搜索框 / 代码编辑器的
 * 聚焦与选词完全不受影响——不能把整个 `.app-shell` 长期设为不可选，否则
 * 微信软键盘可能无法弹出。
 */
import { isEditableNode, isEditableTarget } from './editable.ts';
import { INTERACTIVE_SELECTOR } from './longPressGesture.ts';

export function isWeChatAndroidUa(userAgent: string): boolean {
  return /Android/i.test(userAgent) && /MicroMessenger/i.test(userAgent);
}

/** 与 `useTouchLongPress` 绑定的表面保持一致。 */
const LONG_PRESS_SURFACE_SELECTOR = '.msg-row, .session-item';

/**
 * 与 `shouldTrackLongPress` 相同的判定：目标在长按表面上，且不是嵌套的
 * 交互控件（消息内按钮、链接等）。会话项本身是 `<button>`，所以要允许
 * “交互目标就是长按表面”的情况。
 */
function isLongPressSurfaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const surface = target.closest(LONG_PRESS_SURFACE_SELECTOR);
  if (!surface) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive == null || interactive === surface;
}

/** 微信原生选词/菜单可能在抬手后一小段时间才落地，保留一个短窗口。 */
const RELEASE_GRACE_MS = 300;

export function installWeChatTouchSelectionGuard(userAgent = navigator.userAgent): () => void {
  if (!isWeChatAndroidUa(userAgent)) return () => {};

  document.documentElement.classList.add('wechat-android');

  let touching = false;
  /** 本次触摸是否从消息 / 会话项（非交互区域）开始。 */
  let touchOnLongPressSurface = false;
  let releaseTimer = 0;

  let bodyLocked = false;
  let savedUserSelect = '';
  let savedWebkitUserSelect = '';

  const lockBodySelection = () => {
    if (bodyLocked || !document.body) return;
    const style = document.body.style;
    savedUserSelect = style.getPropertyValue('user-select');
    savedWebkitUserSelect = style.getPropertyValue('-webkit-user-select');
    style.setProperty('user-select', 'none');
    style.setProperty('-webkit-user-select', 'none');
    bodyLocked = true;
  };

  const unlockBodySelection = () => {
    if (!bodyLocked || !document.body) return;
    const style = document.body.style;
    style.removeProperty('user-select');
    style.removeProperty('-webkit-user-select');
    if (savedUserSelect) style.setProperty('user-select', savedUserSelect);
    if (savedWebkitUserSelect) style.setProperty('-webkit-user-select', savedWebkitUserSelect);
    savedUserSelect = '';
    savedWebkitUserSelect = '';
    bodyLocked = false;
  };

  const endTouch = () => {
    if (releaseTimer) window.clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(() => {
      releaseTimer = 0;
      touching = false;
      touchOnLongPressSurface = false;
      unlockBodySelection();
    }, RELEASE_GRACE_MS);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (releaseTimer) {
      window.clearTimeout(releaseTimer);
      releaseTimer = 0;
    }
    // 新手势开始：先解除上一次长按留下的临时锁，避免影响正常输入。
    unlockBodySelection();
    touching = true;
    touchOnLongPressSurface = isLongPressSurfaceTarget(event.target);
    // 系统长按判定发生在触摸持续期间；临时锁住整个页面，避免选区吸附。
    if (touchOnLongPressSurface) lockBodySelection();
  };

  const onSelectStart = (event: Event) => {
    if (!touching || !touchOnLongPressSurface) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
  };

  const onSelectionChange = () => {
    if (!touching || !touchOnLongPressSurface) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    // 只清普通文本的选区；输入框 / 代码编辑器里的选区保持原样。
    if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) return;
    selection.removeAllRanges();
  };

  // 只对从消息 / 会话项开始的触摸拦截系统 contextmenu；不影响输入框。
  const onContextMenu = (event: Event) => {
    if (!touching || !touchOnLongPressSurface) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
  };

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchend', endTouch, { capture: true, passive: true });
  document.addEventListener('touchcancel', endTouch, { capture: true, passive: true });
  document.addEventListener('selectstart', onSelectStart, { capture: true });
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('contextmenu', onContextMenu, { capture: true });

  return () => {
    if (releaseTimer) window.clearTimeout(releaseTimer);
    unlockBodySelection();
    document.documentElement.classList.remove('wechat-android');
    document.removeEventListener('touchstart', onTouchStart, { capture: true });
    document.removeEventListener('touchend', endTouch, { capture: true });
    document.removeEventListener('touchcancel', endTouch, { capture: true });
    document.removeEventListener('selectstart', onSelectStart, { capture: true });
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('contextmenu', onContextMenu, { capture: true });
  };
}
