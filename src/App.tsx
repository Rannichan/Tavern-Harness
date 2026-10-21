import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type ActiveView } from './store/store';
import { Sidebar } from './components/Sidebar';
import { ChatView, ChatInput, MessageMenu, TurnQueuePanel } from './components/ChatView';
import { CharactersView } from './components/CharactersView';
import { SettingsView } from './components/SettingsView';
import { StatsView } from './components/StatsView';
import { Dashboard } from './components/Dashboard';
import { NewSessionMenu } from './components/NewSessionMenu';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { FileDisplayModal } from './components/FileDisplayModal';
import { WorkspaceFileManagerModal } from './components/WorkspaceFileManagerModal';
import { Toasts } from './components/Toasts';
import { AchievementModal, showAchievementUnlock } from './components/AchievementModal';
import { GameplayExportModal, GameplayImportModal } from './components/GameplayDialogs';
import { Icon, SessionVisual, Modal } from './components/shared';
import type { NpcCharacter } from './types/models';
import { registerUnlockDispatcher } from './core/achievements';
import { useT } from './core/i18n';
import './theme/chat.css';
import './theme/views.css';

export default function App() {
  const [takingControl, setTakingControl] = useState(false);
  const initStatus = useStore((s) => s.initStatus);
  const initError = useStore((s) => s.initError);
  const addToast = useStore((s) => s.addToast);
  const readOnly = useStore((s) => s.readOnly);
  const init = useStore((s) => s.init);
  const syncControlState = useStore((s) => s.syncControlState);
  const takeOverControl = useStore((s) => s.takeOverControl);
  const activeView = useStore((s) => s.activeView);
  const [mountedViews, setMountedViews] = useState<ActiveView[]>([activeView]);
  if (!mountedViews.includes(activeView)) {
    setMountedViews([...mountedViews, activeView]);
  }
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const messages = useStore((s) => s.messages);
  const contextCompressions = useStore((s) => s.contextCompressions);
  const participants = useStore((s) => s.participants);
  const isStreaming = useStore((s) => s.streaming.sessionId != null);
  const t = useT();

  useEffect(() => {
    registerUnlockDispatcher(async (achievement, total) => {
      await useStore.getState().refreshAchievements();
      showAchievementUnlock(achievement, total);
    });
    return () => registerUnlockDispatcher(() => {});
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setInterval(() => void syncControlState(), 1_000);
    return () => window.clearInterval(timer);
  }, [readOnly, syncControlState]);

  useEffect(() => {
    if (!isStreaming) return;
    const confirmLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', confirmLeave);
    return () => window.removeEventListener('beforeunload', confirmLeave);
  }, [isStreaming]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const sessionMessages = activeSessionId != null ? (messages[activeSessionId] ?? []) : [];
  const sessionParticipants = activeSessionId != null ? (participants[activeSessionId] ?? []) : [];
  const isStreamingSession = useStore((s) => s.streaming.sessionId === activeSessionId);

  const handleTakeOverControl = async () => {
    setTakingControl(true);
    try {
      await takeOverControl();
    } catch (error) {
      console.error('Failed to take over control', error);
      addToast(t('control.takeOverFailed'), 'error');
    } finally {
      setTakingControl(false);
    }
  };

  if (initStatus === 'loading') {
    return <div className="tav-bg" />;
  }

  if (initStatus === 'error') {
    return (
      <>
        <div className="tav-bg" />
        <div className="init-error" role="alertdialog" aria-modal="true" aria-labelledby="init-error-title">
          <div className="init-error-inner">
            <h1 id="init-error-title">{t('init.failed')}</h1>
            <p className="init-error-hint">{t('init.failedHint')}</p>
            <p className="init-error-detail">{initError}</p>
            {/* 焦点直接落在唯一可操作项上，键盘 / 读屏用户不必先找 */}
            <button type="button" className="init-error-retry" autoFocus onClick={() => void init()}>
              {t('init.retry')}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="tav-bg" />
      {readOnly && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('control.dialogLabel')}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          <main style={{ textAlign: 'center' }}>
            <h1>{t('control.activeElsewhere')}</h1>
            <button
              type="button"
              disabled={takingControl}
              onClick={() => void handleTakeOverControl()}
              style={{ padding: '10px 18px', border: 0, borderRadius: 8, cursor: takingControl ? 'wait' : 'pointer', fontWeight: 700, background: 'color-mix(in srgb, var(--primary) 25%, transparent)', color: 'var(--primary)' }}
            >
              {t('control.takeOverHere')}
            </button>
          </main>
        </div>
      )}
      <div className="app-shell">
        <Sidebar />
        <main className="main-area">
          <ViewSlot active={activeView === 'chat'}>
            {activeSession ? (
              <>
                <SessionHeader session={activeSession} participants={sessionParticipants} />
                <div className="chat-main-row">
                  <div className="chat-main-col">
                    <ChatView
                      session={activeSession}
                      messages={sessionMessages}
                      participants={sessionParticipants}
                      compressions={contextCompressions[activeSession.id!] ?? []}
                      streaming={isStreamingSession}
                      active={activeView === 'chat'}
                    />
                    <ChatInput sessionId={activeSession.id!} />
                  </div>
                  <TurnQueuePanel session={activeSession} participants={sessionParticipants} />
                </div>
              </>
            ) : (
              <Dashboard />
            )}
          </ViewSlot>
          {mountedViews.includes('characters') && (
            <ViewSlot active={activeView === 'characters'}>
              <CharactersView active={activeView === 'characters'} />
            </ViewSlot>
          )}
          {mountedViews.includes('settings') && (
            <ViewSlot active={activeView === 'settings'}>
              <SettingsView />
            </ViewSlot>
          )}
          {mountedViews.includes('stats') && (
            <ViewSlot active={activeView === 'stats'}>
              <StatsView active={activeView === 'stats'} />
            </ViewSlot>
          )}
        </main>
      </div>
          <ConfirmationDialog />
          <MessageMenu />
          <Toasts />
          <AchievementModal />
          <FileDisplayModal />
          {/* 游戏导出 / 导入的全局入口（会话右键菜单 / 侧边栏导入按钮共用） */}
      <GameplayEntryDialogs />
    </>
  );
}

/** 保持已访问的视图挂载，并隔离隐藏视图的焦点与辅助功能。 */
function ViewSlot({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
      return;
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && el.contains(focused)) focused.blur();
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  }, [active]);
  return (
    <div ref={ref} className="view-slot" data-active={active ? 'true' : 'false'}>
      {children}
    </div>
  );
}

/** 全局注册的游戏导出/导入弹窗（供 Sidebar 与 SessionHeader 之外的入口使用） */
function GameplayEntryDialogs() {
  const [exportTarget, setExportTarget] = useState<{ sessionId: number; includeHistory: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const onExport = (e: CustomEvent<{ sessionId: number; includeHistory: boolean }>) => {
      setImportOpen(false);
      setExportTarget(e.detail);
    };
    const onImport = () => {
      setExportTarget(null);
      setImportOpen(true);
    };
    window.addEventListener('th-gameplay-export', onExport as EventListener);
    window.addEventListener('th-gameplay-import', onImport as EventListener);
    return () => {
      window.removeEventListener('th-gameplay-export', onExport as EventListener);
      window.removeEventListener('th-gameplay-import', onImport as EventListener);
    };
  }, []);

  return (
    <>
      {exportTarget && (
        <GameplayExportModal
          sessionId={exportTarget.sessionId}
          defaultIncludeHistory={exportTarget.includeHistory}
          onClose={() => setExportTarget(null)}
        />
      )}
      {importOpen && <GameplayImportModal onClose={() => setImportOpen(false)} />}
    </>
  );
}

function SessionHeader({
  session,
  participants,
}: {
  session: NonNullable<ReturnType<typeof useStore.getState>['sessions'][number]>;
  participants: ReturnType<typeof useStore.getState>['participants'][number];
}) {
  const npcs = useStore((s) => s.npcs);
  const addToast = useStore((s) => s.addToast);
  const deleteSession = useStore((s) => s.deleteSession);
  const resetSessionConversation = useStore((s) => s.resetSessionConversation);
  const t = useT();
  const [showEdit, setShowEdit] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);

  const modeLabel = session.mode === 'STANDARD' ? t('header.modeStandard') : session.mode === 'NPC' ? t('header.modeNpc') : t('header.modeGroup');
  const npcRef = session.associatedId ? npcs.find((n) => n.id === session.associatedId) : null;
  const usesPublicWorkspace = session.mode === 'NPC' && npcRef?.isBuiltIn === true;
  const groupNpcs = participants.filter((p) => p.kind === 'NPC').map((p) => npcs.find((n) => n.id === p.npcId)).filter(Boolean);
  const groupMemberAvatars = (groupNpcs as NpcCharacter[]).slice(0, 4).map((n) => ({
    name: n.name,
    colorOrdinal: n.avatarColorOrdinal,
    imageUrl: n.avatarDataUrl,
  }));

  return (
    <div className="chat-header">
      <SessionVisual mode={session.mode} npcName={npcRef?.name ?? undefined} hue={npcRef?.avatarColorOrdinal ?? 0} imageUrl={npcRef?.avatarDataUrl} members={session.mode === 'GROUP' ? groupMemberAvatars : undefined} size="lg" />
      <div className="tinfo">
        <div className="ttitle">{session.title}</div>
        <div className="tsub">
          <span className="tsub-mode">{modeLabel}</span>
          {session.mode === 'GROUP' && (
            <span className="tsub-members">
              {groupNpcs.map((n) => n!.name).join(' · ')}
            </span>
          )}
        </div>
      </div>
      <div className="chat-actions">
        <button className="btn-ghost icon-tooltip" title={t(usesPublicWorkspace ? 'header.workspaceRootHint' : 'header.workspaceHint')} onClick={() => setShowWorkspace(true)}>
          <Icon name="folder" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip" title={t('header.editSessionTip')} onClick={() => setShowEdit(true)}>
          <Icon name="pencil" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip" title={t('header.resetSessionTip')} onClick={() => setConfirmReset(true)}>
          <Icon name="refresh" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip" title={t('header.exportGameplayTip')} onClick={() => setExportOpen(true)}>
          <Icon name="share" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip danger" title={t('header.deleteTip')} onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={17} />
        </button>
      </div>

      {showEdit && <NewSessionMenu editingSession={session} onClose={() => setShowEdit(false)} />}

      {showWorkspace && (
        <WorkspaceFileManagerModal sessionId={session.id!} onClose={() => setShowWorkspace(false)} />
      )}

      {exportOpen && (
        <GameplayExportModal
          sessionId={session.id!}
          defaultIncludeHistory={true}
          onClose={() => setExportOpen(false)}
        />
      )}

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} width="min(400px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>{t('header.resetSessionTitle')}</span>
            <button className="icon-btn" onClick={() => setConfirmReset(false)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            {t('header.resetSessionConfirm', { title: session.title })}
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmReset(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await resetSessionConversation(session.id!);
                setConfirmReset(false);
                addToast(t('toast.sessionReset'));
              }}
            >
              <Icon name="refresh" size={13} /> {t('header.resetSessionAction')}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} width="min(400px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>{t('header.deleteTitle')}</span>
            <button className="icon-btn" onClick={() => setConfirmDelete(false)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            {t('header.deleteConfirm', { title: session.title })}
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await deleteSession(session.id!);
                setConfirmDelete(false);
                addToast(t('toast.sessionDeleted'));
              }}
            >
              <Icon name="trash" size={13} /> {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}

    </div>
  );
}