import { useStore } from '../store/store';

// ============================================================
// Toast 通知
// ============================================================

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const remove = useStore((s) => s.removeToast);

  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'err' : ''}`} onClick={() => remove(t.id)}>
          {t.kind === 'error' ? '⚠️ ' : '✓ '}{t.message}
        </div>
      ))}
    </div>
  );
}