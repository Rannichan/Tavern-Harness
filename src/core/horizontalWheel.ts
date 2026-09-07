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

export function enableHorizontalWheel(): void {
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