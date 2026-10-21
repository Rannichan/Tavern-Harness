/**
 * 滚动容器“贴底”跟随。
 *
 * 软键盘弹起 / 收起会改变滚动容器的高度（移动端布局视口随键盘收缩），
 * 输入框随内容增高时也会。若只在事件回调里 `requestAnimationFrame` 之后再贴底，
 * 浏览器会先用旧滚动位置绘制一帧：内容先闪在错误位置，下一帧才跳到底部。
 *
 * `ResizeObserver` 的回调在布局之后、绘制之前执行，在这里同步修正 `scrollTop`，
 * 滚动位置与高度变化会落在同一帧里，因此不会出现残影 / 二次跳动。
 */

/** 距底部多少像素以内算“贴底”。与消息区自动滚动的阈值保持一致。 */
export const STICKY_BOTTOM_THRESHOLD = 60;

/** 纯函数：滚动位置是否已经贴底。 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = STICKY_BOTTOM_THRESHOLD,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * 让容器在高度变化时保持贴底。
 *
 * 只在变化**之前**已经贴底时才跟随；用户主动向上回看时保持阅读位置，
 * 不会因为地址栏显隐或键盘弹起被强行拉回底部。
 *
 * @returns 解除监听的函数
 */
export function keepStickyBottom(el: HTMLElement, threshold = STICKY_BOTTOM_THRESHOLD): () => void {
  let lastHeight = el.clientHeight;
  const observer = new ResizeObserver(() => {
    const height = el.clientHeight;
    if (height === 0) return;
    if (height === lastHeight) return;
    // 用变化前的高度判断，避免容器长高时浏览器已经把 scrollTop 夹到新上限而误判。
    const wasNearBottom = isNearBottom(el.scrollHeight, el.scrollTop, lastHeight, threshold);
    lastHeight = height;
    if (wasNearBottom) el.scrollTop = el.scrollHeight;
  });
  observer.observe(el);
  return () => observer.disconnect();
}
