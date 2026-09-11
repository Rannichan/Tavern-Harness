// ============================================================
// 横向滚动容器的「垂直滚轮 → 水平滚动」翻译
//
// 问题背景：类似 .side-nav（侧边栏上部导航 / 角色工坊 tab 栏）的
// 容器是 overflow-x: auto。桌面鼠标滚轮默认产生垂直 deltaY，
// 悬停其上不会触发横向滚动，导致窄布局下按钮被裁掉却滚不动。
//
// 方案：在 document 上做事件委托（capture + passive:false），
// 当滚轮事件落在带 [data-hscroll] 的容器内、且容器存在横向溢出时，
// 把 deltaY（必要时叠加 deltaX）写入 scrollLeft；滚动到两端边界时
// 还原默认行为（放行给外层容器/页面），避免“粘住”不可达的滚动条。
//
// 用法：给希望滚轮横滚的容器加 data-hscroll 属性即可，无需改组件。
// 本模块在应用启动时调用一次 enableHorizontalWheel()。
// ============================================================

function findScrollParent(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? (target as HTMLElement) : null;
  while (el && el !== document.body) {
    if (el.matches('[data-hscroll]')) return el;
    el = el.parentElement;
  }
  return null;
}

// 维护横向溢出提示状态（class 由 CSS 的 mask 渐变消费）：
//   has-overflow — 存在横向溢出（内容确实被遮挡）
//   hidden-left  — 左侧有内容被遮挡 → 左边缘淡出
//   hidden-right — 右侧有内容被遮挡 → 右边缘淡出
function updateOverflowHint(el: HTMLElement): void {
  const overflowX = el.scrollWidth > el.clientWidth + 1;
  const atStart = el.scrollLeft <= 1;
  const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
  el.classList.toggle('has-overflow', overflowX);
  el.classList.toggle('hidden-left', overflowX && !atStart);
  el.classList.toggle('hidden-right', overflowX && !atEnd);
}

export function enableHorizontalWheel(): void {
  // 滚动时刷新溢出提示
  document.addEventListener(
    'scroll',
    (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const h = target.closest('[data-hscroll]') as HTMLElement | null;
      if (!h) return;
      updateOverflowHint(h);
    },
    { capture: true, passive: true }
  );

  // 布局变化（初次渲染 / 窗口尺寸变化 / 字体加载）后重新计算
  const sweep = () => {
    document.querySelectorAll<HTMLElement>('[data-hscroll]').forEach(updateOverflowHint);
  };
  // 初次渲染可能晚于 enableHorizontalWheel 调用，延后到 React 挂载完成后执行
  requestAnimationFrame(() => setTimeout(sweep, 0));
  window.addEventListener('resize', sweep);
  window.addEventListener('load', sweep);
  document.fonts?.ready?.then(sweep).catch(() => {});
  // 动态挂载的 [data-hscroll] 容器（如工坊 tab 切换）出现后立即计算
  const mo = new MutationObserver(sweep);
  mo.observe(document.body, { subtree: true, childList: true });

  document.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      const el = findScrollParent(e.target);
      if (!el) return;

      const canScrollX = el.scrollWidth > el.clientWidth + 1;
      if (!canScrollX) return;

      // 只有横向溢出才接管；无横向溢出时保持默认（不影响页面内其它滚动）
      const delta = e.deltaY ?? 0;
      if (delta === 0 && (e.deltaX ?? 0) === 0) return;

      // 滚轮偏移换算：正常一次“格”约 100px，与常规滚动体感一致
      let target = el.scrollLeft + delta + (e.deltaX ?? 0);
      const max = el.scrollWidth - el.clientWidth;
      const prev = el.scrollLeft;
      target = Math.max(0, Math.min(target, max));
      if (target !== prev) {
        el.scrollLeft = target;
        // 到此为止：真正发生了横向滚动，阻止默认（避免外层/页面也跟着滚）
        e.preventDefault();
      }
      // 若目标在两端（无剩余空间），不 preventDefault，让事件自然冒泡
    },
    { capture: true, passive: false }
  );
}