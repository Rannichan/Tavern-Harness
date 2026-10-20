import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampDuringClose, isEdgeAndroidUa } from './src/core/mobileViewport.ts';

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

test('isEdgeAndroidUa recognizes Edge on Android only', () => {
  const edgeAndroid =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36 EdgA/155.0.0.0';
  assert.equal(isEdgeAndroidUa(edgeAndroid), true);
  assert.equal(isEdgeAndroidUa(edgeAndroid.replace('EdgA/', 'Edg/')), true);
  assert.equal(isEdgeAndroidUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isEdgeAndroidUa('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), false);
});
