import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTEXT_MENU_DEDUPE_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  TOUCH_CONTEXT_MENU_WINDOW_MS,
  exceedsMoveTolerance,
  isTouchContextMenu,
  shouldIgnoreContextMenu,
  shouldTrackLongPress,
} from './src/core/longPressGesture.ts';
import { isWeChatAndroidUa } from './src/core/wechatTouch.ts';

test('exceedsMoveTolerance uses the strict distance threshold', () => {
  // Exactly on the tolerance is still considered "not moved".
  assert.equal(exceedsMoveTolerance({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE_PX, y: 0 }), false);
  assert.equal(exceedsMoveTolerance({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE_PX + 0.01, y: 0 }), true);
  // Diagonal distance: 6-8-10 is inside, 9-12-15 is outside.
  assert.equal(exceedsMoveTolerance({ x: 0, y: 0 }, { x: 6, y: 8 }), false);
  assert.equal(exceedsMoveTolerance({ x: 0, y: 0 }, { x: 9, y: 12 }), true);
  // Explicit tolerance overrides the default.
  assert.equal(exceedsMoveTolerance({ x: 10, y: 10 }, { x: 10, y: 13 }, 2), true);
});

test('shouldTrackLongPress only tracks touch outside nested interactive controls', () => {
  const root = { id: 'root' };
  const nested = { id: 'nested-button' };
  assert.equal(shouldTrackLongPress('mouse', null, root), false);
  assert.equal(shouldTrackLongPress('pen', null, root), false);
  assert.equal(shouldTrackLongPress('touch', null, root), true);
  // A listener attached to a button itself must still work.
  assert.equal(shouldTrackLongPress('touch', root, root), true);
  // A button nested inside the long-press surface keeps its own click.
  assert.equal(shouldTrackLongPress('touch', nested, root), false);
});

test('isTouchContextMenu recognizes touch even when the browser omits pointerType', () => {
  assert.equal(isTouchContextMenu({ pointerType: 'touch', sinceTouchDown: 10 }), true);
  assert.equal(isTouchContextMenu({ firesTouchEvents: true, sinceTouchDown: Infinity }), true);
  // 老 WebView 可能不给 pointerType / sourceCapabilities，只能靠时间窗兜底。
  assert.equal(isTouchContextMenu({ sinceTouchDown: TOUCH_CONTEXT_MENU_WINDOW_MS }), true);
  assert.equal(isTouchContextMenu({ sinceTouchDown: TOUCH_CONTEXT_MENU_WINDOW_MS + 1 }), false);
  // 鼠标右键不受触摸时间窗影响。
  assert.equal(isTouchContextMenu({ pointerType: 'mouse', sinceTouchDown: Infinity }), false);
  assert.equal(isTouchContextMenu({ pointerType: 'mouse', sinceTouchDown: 0 }), false);
  // 兼容鼠标事件 + firesTouchEvents 仍可识别为触摸来源。
  assert.equal(isTouchContextMenu({ pointerType: 'mouse', firesTouchEvents: true, sinceTouchDown: Infinity }), true);
});

test('shouldIgnoreContextMenu dedupes only the contextmenu of a menu that already opened', () => {
  // 长按菜单刚由计时器打开：同一手势补发的 contextmenu 应忽略（避免菜单重定位）。
  assert.equal(
    shouldIgnoreContextMenu({ pointerType: 'touch', sinceTouchDown: 10, sinceLongPress: 0 }),
    true,
  );
  assert.equal(
    shouldIgnoreContextMenu({ pointerType: 'touch', sinceTouchDown: 10, sinceLongPress: CONTEXT_MENU_DEDUPE_MS }),
    true,
  );
  assert.equal(
    shouldIgnoreContextMenu({ pointerType: 'touch', sinceTouchDown: 10, sinceLongPress: CONTEXT_MENU_DEDUPE_MS + 1 }),
    false,
  );
  // 指针事件被原生手势取消、计时器没跑起来：放行 contextmenu 兜底打开菜单。
  assert.equal(
    shouldIgnoreContextMenu({ pointerType: 'touch', sinceTouchDown: 10, sinceLongPress: Infinity }),
    false,
  );
  // 鼠标右键永远放行。
  assert.equal(
    shouldIgnoreContextMenu({ pointerType: 'mouse', sinceTouchDown: Infinity, sinceLongPress: 0 }),
    false,
  );
  // 触摸已经过去很久（老 WebView 没给 pointerType 时只能靠时间窗判断）。
  assert.equal(
    shouldIgnoreContextMenu({
      sinceTouchDown: TOUCH_CONTEXT_MENU_WINDOW_MS + 1,
      sinceLongPress: 0,
    }),
    false,
  );
});

test('isWeChatAndroidUa only matches WeChat on Android', () => {
  const wechatAndroid =
    'Mozilla/5.0 (Linux; Android 13; PGT-AN10 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MMWEBID/1234 MicroMessenger/8.0.47.2560(0x28002F30) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64';
  const wechatIos =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2c) NetType/WIFI Language/zh_CN';
  const chromeAndroid =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  assert.equal(isWeChatAndroidUa(wechatAndroid), true);
  assert.equal(isWeChatAndroidUa(wechatIos), false);
  assert.equal(isWeChatAndroidUa(chromeAndroid), false);
});
