import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampDuringClose, isEdgeAndroidUa, isKeyboardViewportShrunk, isToolbarSqueeze } from './src/core/mobileViewport.ts';

test('clampDuringClose holds the known closed height when Edge overshoots', () => {
  // Edge 收起键盘时先到 822（工具栏未归位），最终才回到 765
  assert.equal(clampDuringClose(822, 765), 765);
});

test('clampDuringClose follows the viewport at or below the closed height', () => {
  assert.equal(clampDuringClose(765, 765), null);
  assert.equal(clampDuringClose(764, 765), null);
  assert.equal(clampDuringClose(767, 765), null);
  assert.equal(clampDuringClose(768, 765), 765);
});

test('isKeyboardViewportShrunk detects the iOS keyboard visual-viewport shrink', () => {
  // 布局视口 800：键盘占 300px 时视觉视口只剩 500。
  assert.equal(isKeyboardViewportShrunk(500, 800), true);
  // 地址栏 / 工具栏的小幅变化不算键盘。
  assert.equal(isKeyboardViewportShrunk(730, 800), false);
  // 阈值边界：默认 120px。
  assert.equal(isKeyboardViewportShrunk(680, 800), true);
  assert.equal(isKeyboardViewportShrunk(681, 800), false);
  // 双指缩放 / iOS 输入框自动放大：先折算预期高度，单纯放大不算键盘。
  assert.equal(isKeyboardViewportShrunk(533, 800, 1.5), false);
  // 放大后仍被键盘压矮 120px 以上才算键盘。
  assert.equal(isKeyboardViewportShrunk(400, 800, 1.5), true);
});

test('isToolbarSqueeze ignores the address-bar shrink while the keyboard is open', () => {
  // Edge 收起键盘时地址栏先挤到键盘上方：页面区矮约 57px，输入框会被顶上去。
  assert.equal(isToolbarSqueeze(343, 400), true);
  // 只矮了一个工具栏高度以内（含候选栏余量）都按挤压处理。
  assert.equal(isToolbarSqueeze(304, 400), true);
  // 键盘本身变高（超过工具栏高度）：仍然要跟随，否则输入框会被藏到键盘后面。
  assert.equal(isToolbarSqueeze(303, 400), false);
  // 视口比壳层高（正常收起 / 变大）不是挤压。
  assert.equal(isToolbarSqueeze(457, 400), false);
  // 壳层不跟随时（桌面 / 非 Edge）没有可保持的像素高度。
  assert.equal(isToolbarSqueeze(343, null), false);
});

test('isEdgeAndroidUa recognizes Edge on Android only', () => {
  const edgeAndroid =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36 EdgA/155.0.0.0';
  assert.equal(isEdgeAndroidUa(edgeAndroid), true);
  assert.equal(isEdgeAndroidUa(edgeAndroid.replace('EdgA/', 'Edg/')), true);
  assert.equal(isEdgeAndroidUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isEdgeAndroidUa('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), false);
});

test('the shell keeps its height when the address bar squeezes the page during a close', async () => {
  const { initMobileViewport } = await import('./src/core/mobileViewport.ts');

  const resizeListeners = [];
  const timers = new Map();
  const style = new Map();
  let nextTimer = 0;
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
  };
  // Node 21+ 自带只读的 navigator，只能通过属性描述符替换。
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fakeWindow = {
    innerHeight: 765,
    innerWidth: 412,
    addEventListener(type, fn) {
      if (type === 'resize') resizeListeners.push(fn);
    },
    setTimeout(fn) {
      nextTimer += 1;
      timers.set(nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    matchMedia() {
      return { matches: true, addEventListener() {} };
    },
    visualViewport: { addEventListener() {} },
  };
  globalThis.window = fakeWindow;
  globalThis.document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          style.set(name, value);
        },
        removeProperty(name) {
          style.delete(name);
        },
      },
    },
    addEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36 EdgA/155.0.0.0',
    },
  });

  const resize = (height) => {
    fakeWindow.innerHeight = height;
    for (const listener of resizeListeners) listener();
  };
  const flushTimers = () => {
    while (timers.size > 0) {
      const [id, run] = timers.entries().next().value;
      timers.delete(id);
      run();
    }
  };
  const shellHeight = () => Number.parseInt(style.get('--app-height'), 10);

  try {
    initMobileViewport();
    assert.equal(shellHeight(), 765);

    resize(400); // 键盘展开
    flushTimers(); // 合并窗口结束，一次性落到键盘高度
    assert.equal(shellHeight(), 400);

    // 地址栏先挤到键盘上方（57px）：壳层保持不动，输入框不会被顶上去。
    resize(343);
    assert.equal(shellHeight(), 400);
    // 视口小幅回升但仍低于键盘展开高度：继续按住，避免来回抽动。
    resize(380);
    assert.equal(shellHeight(), 400);

    // 键盘和地址栏一起收起：一次性落回页面底部。
    resize(765);
    assert.equal(shellHeight(), 765);

    // 键盘本身变高（超过工具栏高度）仍然跟随，避免把输入框藏到键盘后面。
    resize(400);
    flushTimers();
    resize(250);
    assert.equal(shellHeight(), 250);
    resize(765);
    assert.equal(shellHeight(), 765);
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
    else delete globalThis.navigator;
  }
});
