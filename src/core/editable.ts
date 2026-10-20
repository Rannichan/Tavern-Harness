/**
 * 文本输入控件的判定（输入框、文本域、contenteditable）。
 *
 * 键盘 / 视口逻辑（`mobileViewport.ts`）和微信长按兜底（`wechatTouch.ts`）
 * 共用同一份判定，避免两处选择器不一致。
 *
 * 注意：`mobileViewport.ts` 会被 Node 单测直接加载，所以从它引用的模块
 * 需要显式带 `.ts` 后缀（Node 的 ESM 解析不补后缀）。
 */

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

function closestElement(node: Node | null): Element | null {
  return node instanceof Element ? node : node?.parentElement ?? null;
}

/** 事件目标（或其祖先）是否是可编辑控件。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) != null;
}

/** 选区端点可能是文本节点，先取最近的元素再判断。 */
export function isEditableNode(node: Node | null): boolean {
  return closestElement(node)?.closest(EDITABLE_SELECTOR) != null;
}
