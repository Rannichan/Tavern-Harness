import { useEffect } from 'react';
import { useStore, createSession } from './store/store';
import { Sidebar } from './components/Sidebar';
import { ChatView, ChatInput, MessageMenu } from './components/ChatView';
import { CharactersView } from './components/CharactersView';
import { SettingsView } from './components/SettingsView';
import { FilesView } from './components/FilesView';
import { StatsView } from './components/StatsView';
import { Dashboard } from './components/Dashboard';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { Toasts } from './components/Toasts';
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
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>正在支起酒馆…</div>
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
              <SessionHeader
                session={activeSession}
                participants={sessionParticipants}
                onNew={() => {
                  createSession('STANDARD').then((id) => {
                    useStore.getState().setActiveSession(id);
                  });
                }}
              />
              <ChatView
                session={activeSession}
                messages={sessionMessages}
                participants={sessionParticipants}
                streaming={isStreamingSession}
              />
              <ChatInput sessionId={activeSession.id!} />
            </>
          )}
          {activeView === 'chat' && !activeSession && <Dashboard />}
          {activeView === 'characters' && <CharactersView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'files' && <FilesView />}
          {activeView === 'stats' && <StatsView />}
        </main>
      </div>
      <ConfirmationDialog />
      <MessageMenu />
      <Toasts />
    </>
  );
}

function SessionHeader({
  session,
  participants,
  onNew,
}: {
  session: NonNullable<ReturnType<typeof useStore.getState>['sessions'][number]>;
  participants: ReturnType<typeof useStore.getState>['participants'][number];
  onNew: () => void;
}) {
  const npcs = useStore((s) => s.npcs);
  const modeLabel = session.mode === 'STANDARD' ? '标准对话' : session.mode === 'NPC' ? '角色对话' : '群聊';
  const npcRef = session.associatedId ? npcs.find((n) => n.id === session.associatedId) : null;
  const groupNpcs = participants.filter((p) => p.kind === 'NPC').map((p) => npcs.find((n) => n.id === p.npcId)).filter(Boolean);

  return (
    <div className="chat-header">
      <div className="avatar">
        {session.mode === 'STANDARD' && '✦'}
        {session.mode === 'NPC' && (npcRef?.name?.slice(0, 1) ?? '?')}
        {session.mode === 'GROUP' && '👥'}
      </div>
      <div className="tinfo">
        <div className="ttitle">{session.title}</div>
        <div className="tsub">
          {modeLabel}
          {session.mode === 'GROUP' && (
            <span style={{ marginLeft: 8 }}>
              {groupNpcs.map((n) => n!.name).join(' · ')}
            </span>
          )}
        </div>
      </div>
      <div className="foot-actions">
        <button className="btn btn-ghost btn-sm" onClick={onNew} title="新建会话">
          ＋ 新会话
        </button>
      </div>
    </div>
  );
}