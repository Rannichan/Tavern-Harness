import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { Icon, Modal } from './shared';
import { useT } from '../core/i18n';
import { exportGameplay, importGameplay } from '../core/gameplay';

// ============================================================
// 游戏导出 / 导入
// 三种打开方式：
//  - <GameplayExportModal sessionId onClose includeHistory defaultIncludeHistory>
//      导出游戏（含「是否包含对话历史」开关）
//  - <GameplayImportModal onClose onImported>
//      从游戏 JSON 文件完全重建
//  - 从会话右键菜单「导出游戏」：走 App 级全局弹窗（ExportSessionDialog）
// ============================================================

export function GameplayExportModal({
  sessionId,
  onClose,
  defaultIncludeHistory,
}: {
  sessionId: number;
  onClose: () => void;
  defaultIncludeHistory: boolean;
}) {
  const t = useT();
  const addToast = useStore((s) => s.addToast);
  const [includeHistory, setIncludeHistory] = useState(defaultIncludeHistory);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const result = await exportGameplay({ sessionId, includeHistory });
      if (result === 'canceled') {
        addToast(t('toast.exportCanceled'));
      } else {
        addToast(t('toast.gameplayExported'));
      }
      onClose();
    } catch (e) {
      addToast(t('toast.exportFailed', { msg: (e as Error).message }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={420}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="share" size={15} /> {t('gameplay.exportTitle')}
        </span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="gameplay-history-row">
          <div className="field" style={{ gap: 3 }}>
            <label>{t('gameplay.includeHistory')}</label>
            <span className="field-hint">{t('gameplay.includeHistoryHint')}</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(e) => setIncludeHistory(e.target.checked)}
            />
            <span className="switch-slider" />
          </label>
        </div>
        <div className="gameplay-summary">
          {t('gameplay.exportSummary')}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy} onClick={doExport}>
          <Icon name="upload" size={13} /> {busy ? t('gameplay.busy') : t('gameplay.exportAction')}
        </button>
      </div>
    </Modal>
  );
}

export function GameplayImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: (sessionId: number) => void;
}) {
  const t = useT();
  const addToast = useStore((s) => s.addToast);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const refreshNpcs = useStore((s) => s.refreshNpcs);
  const refreshWorldBooks = useStore((s) => s.refreshWorldBooks);
  const refreshTools = useStore((s) => s.refreshTools);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const loadMessages = useStore((s) => s.loadMessages);
  const refreshLiveQueue = useStore((s) => s.refreshLiveQueue);
  const [busy, setBusy] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingData = useRef<unknown | null>(null);

  const openPicker = () => fileRef.current?.click();

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        pendingData.current = parsed;
        setSelectedName(file.name.replace(/\.json$/i, ''));
      } catch {
        addToast(t('toast.importFailed', { msg: t('gameplay.invalidFile') }), 'error');
      }
    };
    reader.onerror = () => addToast(t('toast.importFailed', { msg: t('gameplay.invalidFile') }), 'error');
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!pendingData.current) return;
    setBusy(true);
    try {
      const result = await importGameplay(pendingData.current);
      pendingData.current = null;
      setSelectedName(null);
      addToast(
        t('toast.gameplayImported', {
          title: result.sessionTitle,
          npc: String(result.createdNpcs),
          wb: result.importedWorldBook ? '1' : '0',
          tools: String(result.importedTools),
          msgs: String(result.importedMessages),
        })
      );
      await Promise.all([refreshNpcs(), refreshWorldBooks(), refreshTools(), refreshSessions()]);
      await loadMessages(result.sessionId);
      await refreshLiveQueue(result.sessionId);
      setActiveSession(result.sessionId);
      onImported?.(result.sessionId);
      onClose();
    } catch (e) {
      addToast(t('toast.importFailed', { msg: (e as Error).message }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={420}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="import" size={15} /> {t('gameplay.importTitle')}
        </span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button
          className="btn gameplay-file-btn"
          onClick={openPicker}
          disabled={busy}
          style={{ justifyContent: 'center', padding: '14px 12px' }}
        >
          <Icon name="file" size={14} />
          {selectedName ? selectedName : t('gameplay.chooseFile')}
        </button>
        <div className="gameplay-summary">{t('gameplay.importSummary')}</div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !selectedName} onClick={doImport}>
          <Icon name="import" size={13} /> {busy ? t('gameplay.busy') : t('gameplay.importAction')}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = '';
        }}
      />
    </Modal>
  );
}