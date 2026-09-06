import { Icon } from './shared';
import { Modal } from './shared';

// ============================================================
// 通用删除确认弹窗（与对话删除弹窗样式一致）
// 用法：把「待删除项」放进 state，渲染本组件，onConfirm 里执行删除
// ============================================================

export function DeleteConfirmDialog({
  title,
  itemName,
  onCancel,
  onConfirm,
  dangerText = '删除',
}: {
  title: string;
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  dangerText?: string;
}) {
  return (
    <Modal onClose={onCancel} width="min(400px, calc(100vw - 32px))">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{title}</span>
        <button className="icon-btn" onClick={onCancel}><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        确定删除「{itemName}」？该操作不可恢复。
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>取消</button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            await onConfirm();
            onCancel();
          }}
        >
          <Icon name="trash" size={13} /> {dangerText}
        </button>
      </div>
    </Modal>
  );
}