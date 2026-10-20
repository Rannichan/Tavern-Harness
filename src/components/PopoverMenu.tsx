import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { clampPopoverPosition, fixedViewportBounds, type ViewportPoint } from '../core/viewport';

/**
 * 浮动菜单（消息菜单 / 会话菜单共用）：遮罩 + 贴边钳制的卡片。
 *
 * 菜单项数量随上下文变化，用硬编码宽高去钳制会算错位置。这里先按触发点挂载，
 * 再用 `useLayoutEffect` 在绘制前按实测尺寸重新钳制一次。测量完成前菜单保持
 * `visibility: hidden`：即使个别 WebView 把布局副作用推迟到一帧之后，用户也
 * 不会看到菜单从触发点跳到钳制位置。
 * 切换菜单时由外层 `key` 触发重新挂载，保证每次打开都会重新测量。
 */
export function PopoverMenu({
  point,
  onClose,
  children,
}: {
  point: ViewportPoint;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setPosition(
      clampPopoverPosition(
        point,
        { width: element.offsetWidth, height: element.offsetHeight },
        fixedViewportBounds(),
      ),
    );
    // 点到点之间不重复渲染：point 对象每次都是新引用，按坐标值比较。
  }, [point.x, point.y]);

  return (
    <>
      <div className="overlay-msg" onClick={onClose} />
      <div
        ref={ref}
        className="msg-menu card"
        style={{
          left: position?.left ?? point.x,
          top: position?.top ?? point.y,
          visibility: position ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>
  );
}
