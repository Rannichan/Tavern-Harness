import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

function formatContextTokens(tokens: number): string {
  return `${(tokens / 1_000).toFixed(1)}K`;
}

function ChatLoadingPlaceholder({ session }: { session: import('./types/models').ChatSession }) {
  const npcs = useStore((s) => s.npcs);
  const t = useT();
  const npc = session.associatedId != null ? npcs.find((item) => item.id === session.associatedId) : null;

  return (
    <div className="chat-scroll" aria-busy="true">
      <div className="chat-col">
        <div className="empty-state fade-up">
          <div className="big">🫖</div>
          <div>
            {session.mode === 'STANDARD' && <><b>{t('chat.emptyStandardTitle')}</b><br />{t('chat.emptyStandardSub')}</>}
            {session.mode === 'NPC' && <><b>{t('chat.emptyNpcTitle', { name: npc?.name ?? t('chat.speakerChar') })}</b><br />{npc?.greeting}</>}
            {session.mode === 'GROUP' && <><b>{t('chat.emptyGroupTitle')}</b><br />{t('chat.emptyGroupSub')}</>}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [renderedSessionId, setRenderedSessionId] = useState<number | null>(activeSessionId);
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
  const sessionParticipants = activeSessionId != null ? (participants[activeSessionId] ?? []) : [];
  const isStreamingSession = useStore((s) => s.streaming.sessionId === activeSessionId);

  useEffect(() => {
    if (activeSessionId == null || messages[activeSessionId] !== undefined) {
      setRenderedSessionId(activeSessionId);
    }
  }, [activeSessionId, messages]);

  const renderedSession = sessions.find((s) => s.id === renderedSessionId) ?? null;
  const renderedSessionMessages = renderedSessionId != null ? (messages[renderedSessionId] ?? []) : [];
  const renderedSessionParticipants = renderedSessionId != null ? (participants[renderedSessionId] ?? []) : [];

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
    return (
      <div className="startup-loading" role="status" aria-label={t('init.loading')} aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
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
              className="control-takeover-btn"
              style={{ cursor: takingControl ? 'wait' : 'pointer' }}
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
                    {renderedSession != null && renderedSession.id === activeSession.id ? (
                      <ChatView
                        session={renderedSession}
                        messages={renderedSessionMessages}
                        participants={renderedSessionParticipants}
                        compressions={contextCompressions[renderedSession.id!] ?? []}
                        streaming={isStreamingSession}
                        active={activeView === 'chat'}
                      />
                    ) : (
                      <ChatLoadingPlaceholder session={activeSession} />
                    )}
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
  const lastTheme = useRef<string | undefined>();
  const revealFrame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) {
      const theme = document.documentElement.dataset.theme;
      const themeChanged = lastTheme.current !== undefined && lastTheme.current !== theme;
      if (themeChanged) {
        // 隐藏视图在 content-visibility 下会延后解析变量；显示的首帧禁用过渡，
        // 避免旧主题颜色被补绘并动画到新主题。
        el.dataset.themeReveal = 'true';
        revealFrame.current = window.requestAnimationFrame(() => {
          revealFrame.current = window.requestAnimationFrame(() => {
            delete el.dataset.themeReveal;
            revealFrame.current = null;
          });
        });
      }
      lastTheme.current = theme;
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
      return () => {
        if (revealFrame.current != null) window.cancelAnimationFrame(revealFrame.current);
      };
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
  const themeMode = useStore((s) => s.settings?.themeMode ?? 'system');
  const setSettings = useStore((s) => s.setSettings);
  const t = useT();
  const [showEdit, setShowEdit] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const mobileActionsRef = useRef<HTMLDivElement>(null);

  const messages = useStore((s) => s.messages[session.id!] ?? []);
  const contextTokens = useMemo(() => {
    const assistantMessages = messages.filter((message) => message.role === 'assistant' && message.totalTokens > 0);
    if (assistantMessages.length === 0) return null;
    if (session.mode !== 'GROUP') return assistantMessages.at(-1)!.totalTokens;
    const latestLoopIndex = assistantMessages.at(-1)!.loopIndex;
    return Math.max(...assistantMessages
      .filter((message) => message.loopIndex === latestLoopIndex)
      .map((message) => message.totalTokens));
  }, [messages, session.mode]);
  const npcRef = session.associatedId ? npcs.find((n) => n.id === session.associatedId) : null;
  const usesPublicWorkspace = session.mode === 'NPC' && npcRef?.isBuiltIn === true;
  const groupNpcs = participants.filter((p) => p.kind === 'NPC').map((p) => npcs.find((n) => n.id === p.npcId)).filter(Boolean);
  const groupMemberAvatars = (groupNpcs as NpcCharacter[]).slice(0, 4).map((n) => ({
    name: n.name,
    colorOrdinal: n.avatarColorOrdinal,
    imageUrl: n.avatarDataUrl,
  }));
  const isDarkTheme = themeMode === 'dark'
    || (themeMode === 'system' && document.documentElement.dataset.theme === 'dark');
  const toggleTheme = () => void setSettings({ themeMode: isDarkTheme ? 'light' : 'dark' });

  useEffect(() => {
    if (!showMobileActions) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!mobileActionsRef.current?.contains(event.target as Node)) {
        setShowMobileActions(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [showMobileActions]);

  return (
    <div className="chat-header">
      <SessionVisual mode={session.mode} npcName={npcRef?.name ?? undefined} hue={npcRef?.avatarColorOrdinal ?? 0} imageUrl={npcRef?.avatarDataUrl} members={session.mode === 'GROUP' ? groupMemberAvatars : undefined} size="lg" />
      <div className="tinfo">
        <div className="ttitle">{session.title}</div>
        {contextTokens != null && (
          <div className="tsub">
            <span className="tsub-mode">{t('nav.contextUsage', { tokens: formatContextTokens(contextTokens) })}</span>
          </div>
        )}
      </div>
      <div className="chat-actions" ref={mobileActionsRef}>
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
        <button
          className="btn-ghost icon-tooltip chat-actions-more"
          type="button"
          title={t('header.moreActions')}
          aria-label={t('header.moreActions')}
          aria-expanded={showMobileActions}
          onClick={() => setShowMobileActions(!showMobileActions)}
        >
          <Icon name="more" size={18} />
        </button>
        <button
          className="btn-ghost icon-tooltip chat-theme-toggle"
          type="button"
          title={t(isDarkTheme ? 'header.switchToLightTip' : 'header.switchToDarkTip')}
          aria-label={t(isDarkTheme ? 'header.switchToLightTip' : 'header.switchToDarkTip')}
          onClick={toggleTheme}
        >
          <Icon name={isDarkTheme ? 'sun' : 'moon'} size={17} />
        </button>
        {showMobileActions && (
          <div className="chat-actions-menu card">
            <button onClick={() => { setShowWorkspace(true); setShowMobileActions(false); }}>
              <Icon name="folder" size={15} /> {t('header.workspaceAction')}
            </button>
            <button onClick={() => { setShowEdit(true); setShowMobileActions(false); }}>
              <Icon name="pencil" size={15} /> {t('nav.editSession')}
            </button>
            <button onClick={() => { setConfirmReset(true); setShowMobileActions(false); }}>
              <Icon name="refresh" size={15} /> {t('header.resetSessionTip')}
            </button>
            <button onClick={() => { setExportOpen(true); setShowMobileActions(false); }}>
              <Icon name="share" size={15} /> {t('nav.exportGameplay')}
            </button>
            <button className="danger" onClick={() => { setConfirmDelete(true); setShowMobileActions(false); }}>
              <Icon name="trash" size={15} /> {t('header.deleteTip')}
            </button>
          </div>
        )}
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
        <Modal onClose={() => setConfirmReset(false)} size="compact">
          <div className="modal-head">
            <span className="typo-dialog-title">{t('header.resetSessionTitle')}</span>
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
        <Modal onClose={() => setConfirmDelete(false)} size="compact">
          <div className="modal-head">
            <span className="typo-dialog-title">{t('header.deleteTitle')}</span>
            <button className="icon-btn" onClick={() => setConfirmDelete(false)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            {t('header.deleteConfirm', { title: session.title })}
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-danger"
              disabled={deletingSession}
              onClick={async () => {
                if (deletingSession) return;
                setDeletingSession(true);
                try {
                  await deleteSession(session.id!);
                  setConfirmDelete(false);
                  addToast(t('toast.sessionDeleted'));
                } catch (error) {
                  addToast(t('toast.sessionDeleteFailed', { msg: (error as Error).message }), 'error');
                } finally {
                  setDeletingSession(false);
                }
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