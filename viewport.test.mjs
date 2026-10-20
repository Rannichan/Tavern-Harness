import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  clampPopoverPosition,
  layoutViewportBounds,
  toLayoutViewportPoint,
} from './src/core/viewport.ts';
import {
  isNearBottom,
  keepStickyBottom,
  STICKY_BOTTOM_THRESHOLD,
} from './src/core/stickyBottom.ts';

const bounds = { left: 0, top: 0, right: 400, bottom: 600 };
const size = { width: 190, height: 200 };

test('toLayoutViewportPoint adds the visual viewport offset', () => {
  assert.deepEqual(toLayoutViewportPoint({ x: 10, y: 20 }), { x: 10, y: 20 });
  assert.deepEqual(toLayoutViewportPoint({ x: 10, y: 20 }, null), { x: 10, y: 20 });
  assert.deepEqual(
    toLayoutViewportPoint({ x: 10, y: 20 }, { offsetLeft: 5, offsetTop: 7, width: 390, height: 844 }),
    { x: 15, y: 27 },
  );
});

test('layoutViewportBounds falls back to the window size without visualViewport', () => {
  assert.deepEqual(layoutViewportBounds(null, 390, 844), { left: 0, top: 0, right: 390, bottom: 844 });
  assert.deepEqual(layoutViewportBounds(undefined, 390, 844), { left: 0, top: 0, right: 390, bottom: 844 });
  assert.deepEqual(
    layoutViewportBounds({ offsetLeft: 12, offsetTop: 30, width: 300, height: 400 }, 390, 844),
    { left: 12, top: 30, right: 312, bottom: 430 },
  );
});

test('clampPopoverPosition keeps an in-bounds point unchanged', () => {
  assert.deepEqual(clampPopoverPosition({ x: 100, y: 150 }, size, bounds), { left: 100, top: 150 });
});

test('clampPopoverPosition keeps the popover inside the right/bottom edges', () => {
  assert.deepEqual(
    clampPopoverPosition({ x: 350, y: 500 }, size, bounds),
    { left: 400 - size.width - 8, top: 600 - size.height - 8 },
  );
});

test('clampPopoverPosition clamps to the top/left edges', () => {
  assert.deepEqual(clampPopoverPosition({ x: -20, y: -10 }, size, bounds), { left: 8, top: 8 });
});

test('clampPopoverPosition respects a zoomed visual viewport offset and custom gap', () => {
  const zoomed = { left: 30, top: 40, right: 230, bottom: 340 };
  assert.deepEqual(
    clampPopoverPosition({ x: 10, y: 20 }, { width: 100, height: 100 }, zoomed, 4),
    { left: 34, top: 44 },
  );
});

test('clampPopoverPosition falls back to the leading edge when the popover is larger than the viewport', () => {
  const tight = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.deepEqual(clampPopoverPosition({ x: 50, y: 50 }, { width: 190, height: 200 }, tight), { left: 8, top: 8 });
});

test('isNearBottom treats the last visible pixel as bottom', () => {
  assert.equal(isNearBottom(1000, 600, 400), true);
  assert.equal(isNearBottom(1000, 599, 400), true);
  assert.equal(isNearBottom(1000, 600 - STICKY_BOTTOM_THRESHOLD + 1, 400), true);
  assert.equal(isNearBottom(1000, 600 - STICKY_BOTTOM_THRESHOLD, 400), false);
});

test('isNearBottom respects a custom threshold and short content', () => {
  assert.equal(isNearBottom(1000, 501, 400, 100), true);
  assert.equal(isNearBottom(1000, 500, 400, 100), false);
  assert.equal(isNearBottom(300, 0, 400), true);
});

/** 最小 ResizeObserver / 滚动元素替身，用来验证贴底回调的同步修正逻辑。 */
function resizeWithStickyObserver({ clientHeight, scrollHeight, scrollTop }, nextHeight) {
  let top = scrollTop;
  let trigger = null;
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      trigger = callback;
    }
    observe() {}
    disconnect() {}
  };
  try {
    const el = {
      clientHeight,
      scrollHeight,
      get scrollTop() {
        return top;
      },
      set scrollTop(value) {
        top = Math.min(Math.max(0, value), scrollHeight - el.clientHeight);
      },
    };
    keepStickyBottom(el);
    el.clientHeight = nextHeight;
    trigger?.([], {});
    return top;
  } finally {
    globalThis.ResizeObserver = original;
  }
}

test('keepStickyBottom follows a shrinking scroll container within the resize callback', () => {
  // 键盘弹起：容器变矮 300px，滚动位置在同一帧补到新的底部
  assert.equal(
    resizeWithStickyObserver({ clientHeight: 400, scrollHeight: 1000, scrollTop: 600 }, 100),
    900,
  );
});

test('keepStickyBottom leaves a reader who scrolled up alone', () => {
  assert.equal(
    resizeWithStickyObserver({ clientHeight: 400, scrollHeight: 1000, scrollTop: 120 }, 100),
    120,
  );
});

test('viewport meta asks Chromium to resize the layout viewport for the keyboard', () => {
  // Edge Android 只有在 meta 里显式声明 interactive-widget=resizes-content 时
  // 才会随软键盘收缩布局视口；否则 fixed 壳层不收缩，输入框会被键盘盖住。
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const match = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html);
  assert.ok(match, 'index.html 缺少 viewport meta');
  assert.match(match[1], /interactive-widget=resizes-content/);
});

test('modal overlay clamps the modal to the visible viewport so its body can scroll', () => {
  // 移动端 .modal 用 max-height:100% 限制高度；若 .modal-root 的隐式网格行
  // 被弹窗内容撑高，百分比会按撑高后的区域解析，长内容弹窗（如技能详情）
  // 会超出屏幕且无法上下滑动。固定 1fr 行 + 正文 min-height:0 才能滚动。
  const css = readFileSync(new URL('./src/theme/views.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.modal-root\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/, '.modal-root 需要固定单行 1fr');
  assert.match(css, /\.modal-body\s*\{[^}]*min-height:\s*0/, '.modal-body 需要允许收缩');
});
