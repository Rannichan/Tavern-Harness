import { useEffect, useState } from 'react';
import { useStore } from './store/store';
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
import { AchievementModal } from './components/AchievementModal';
import { GameplayExportModal, GameplayImportModal } from './components/GameplayDialogs';
import { Icon, SessionVisual, Modal } from './components/shared';
import type { NpcCharacter } from './types/models';
import { useT } from './core/i18n';
import './theme/chat.css';
import './theme/views.css';

export default function App() {
  const initialized = useStore((s) => s.initialized);
  const init = useStore((s) => s.init);
  const activeView = useStore((s) => s.activeView);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const messages = useStore((s) => s.messages);
  const participants = useStore((s) => s.participants);
  const t = useT();

  useEffect(() => {
    init();
  }, [init]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const sessionMessages = activeSessionId != null ? (messages[activeSessionId] ?? []) : [];
  const sessionParticipants = activeSessionId != null ? (participants[activeSessionId] ?? []) : [];
  const isStreamingSession = useStore((s) => s.streaming.sessionId === activeSessionId);

  if (!initialized) {
    return (
      <>
        <div className="tav-bg" />
        <div style={{ height: '100dvh', display: 'grid', placeItems: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div className="brand-logo" style={{ width: 56, height: 56, fontSize: 26 }}>🫖</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('nav.loading')}</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="tav-bg" />
      <div className="app-shell">
        <Sidebar />
        <main className="main-area">
          {activeView === 'chat' && activeSession && (
            <>
              <SessionHeader session={activeSession} participants={sessionParticipants} />
              <div className="chat-main-row">
                <div className="chat-main-col">
                  <ChatView
                    session={activeSession}
                    messages={sessionMessages}
                    participants={sessionParticipants}
                    streaming={isStreamingSession}
                  />
                  <ChatInput sessionId={activeSession.id!} />
                </div>
                <TurnQueuePanel session={activeSession} participants={sessionParticipants} />
              </div>
            </>
          )}
          {activeView === 'chat' && !activeSession && <Dashboard />}
          {activeView === 'characters' && <CharactersView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'stats' && <StatsView />}
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

/** 全局注册的游戏导出/导入弹窗（供 Sidebar 与 SessionHeader 之外的入口使用） */
function GameplayEntryDialogs() {
  const [exportTarget, setExportTarget] = useState<{ sessionId: number; includeHistory: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const onExport = (e: CustomEvent<{ sessionId: number; includeHistory: boolean }>) => {
      setImportOpen(false);
      setExportTarget(e.detail);
    };
    const onImport = (e: CustomEvent) => {
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
          {/* 会话专属沙箱工作目录标签：与模式标签同一行对齐，点击打开只读文件管理器 */}
          {session.workspaceDir && (
            <button
              className="workspace-chip mono"
              title={t('header.workspaceHint')}
              onClick={() => setShowWorkspace(true)}
            >
              <Icon name="folder" size={11} /> {session.workspaceDir}
            </button>
          )}
        </div>
      </div>
      <div className="chat-actions">
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