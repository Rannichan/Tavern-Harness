import { Icon } from './shared';
import { Modal } from './shared';
import { useT } from '../core/i18n';

// ============================================================
// 通用删除确认弹窗（与对话删除弹窗样式一致）
// 用法：把「待删除项」放进 state，渲染本组件，onConfirm 里执行删除
// ============================================================

export function DeleteConfirmDialog({
  title,
  itemName,
  onCancel,
  onConfirm,
  dangerText,
}: {
  title: string;
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  dangerText?: string;
}) {
  const t = useT();
  const danger = dangerText ?? t('common.delete');
  return (
    <Modal onClose={onCancel} width="min(400px, calc(100vw - 32px))">
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>{title}</span>
        <button className="icon-btn" onClick={onCancel}><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        {t('common.confirmDelete', { name: itemName })}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            await onConfirm();
            onCancel();
          }}
        >
          <Icon name="trash" size={13} /> {danger}
        </button>
      </div>
    </Modal>
  );
}