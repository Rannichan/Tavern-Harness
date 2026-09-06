import { useStore } from '../store/store';
import { Icon } from './shared';
import { useT } from '../core/i18n';

// ============================================================
// 工具确认门控弹窗（更新/删除类操作）
// ============================================================

export function ConfirmationDialog() {
  const pending = useStore((s) => s.pendingConfirmation);
  const resolve = useStore((s) => s.resolveConfirmation);
  const t = useT();

  if (!pending) return null;

  let argsText = pending.argsJson;
  try {
    argsText = JSON.stringify(JSON.parse(pending.argsJson), null, 2);
  } catch {
    /* keep raw */
  }

  return (
    <>
      <div className="overlay" />
      <div className="modal-root">
        <div className="modal card confirm fade-up">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="settings" size={15} /> {pending.title}
            </span>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {t('confirm.modify')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t('confirm.tool')}<span className="mono" style={{ color: 'var(--primary)' }}>{pending.toolName}</span></div>
            <pre className="confirm-args mono">{argsText}</pre>
          </div>
          <div className="modal-foot">
            <button
              className="btn"
              onClick={() => resolve(false)}
            >
              {t('confirm.reject')}
            </button>
            <button className="btn btn-primary" onClick={() => resolve(true)}>
              {t('confirm.allow')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}