/**
 * 可排序列表共用的 dnd-kit 传感器（技能卡、新建会话的角色顺序）。
 *
 * - 鼠标：移动 4px 进入拖拽，桌面端保持原行为；
 * - 触屏：按住 250ms 不动才进入拖拽，轻触后直接上下滑动仍然是滚动页面；
 * - 键盘：保留无指针操作。
 *
 * 刻意不注册 PointerSensor：它会把触控笔一并纳入拖拽，而本产品不需要手写笔排序
 * （产品决定）。将来若要支持触控笔，需要单独评估 PointerSensor 与 TouchSensor
 * 的组合，而不是用它顶替 MouseSensor。
 */
import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export function useSortableSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
