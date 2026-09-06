import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { Sidebar } from './components/Sidebar';
import { ChatView, ChatInput, MessageMenu } from './components/ChatView';
import { CharactersView } from './components/CharactersView';
import { SettingsView } from './components/SettingsView';
import { StatsView } from './components/StatsView';
import { Dashboard } from './components/Dashboard';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { Toasts } from './components/Toasts';
import { Icon, SessionVisual, Modal } from './components/shared';
import type { NpcCharacter } from './types/models';
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
              <SessionHeader session={activeSession} participants={sessionParticipants} />
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
}: {
  session: NonNullable<ReturnType<typeof useStore.getState>['sessions'][number]>;
  participants: ReturnType<typeof useStore.getState>['participants'][number];
}) {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const addToast = useStore((s) => s.addToast);
  const deleteSession = useStore((s) => s.deleteSession);
  const [picker, setPicker] = useState<'persona' | 'worldbook' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const modeLabel = session.mode === 'STANDARD' ? '标准对话' : session.mode === 'NPC' ? '角色对话' : '群聊';
  const npcRef = session.associatedId ? npcs.find((n) => n.id === session.associatedId) : null;
  const groupNpcs = participants.filter((p) => p.kind === 'NPC').map((p) => npcs.find((n) => n.id === p.npcId)).filter(Boolean);
  const groupMemberAvatars = (groupNpcs as NpcCharacter[]).slice(0, 4).map((n) => ({
    name: n.name,
    colorOrdinal: n.avatarColorOrdinal,
    imageUrl: n.avatarDataUrl,
  }));

  const changePersona = async (npcId: number | null) => {
    await updateSessionMeta(session.id!, { userPersonaNpcId: npcId });
    await refreshSessions();
    addToast(npcId == null ? '已清除用户人设' : `已更换用户人设`);
    setPicker(null);
  };

  const changeWorldBook = async (worldBookId: number | null) => {
    await updateSessionMeta(session.id!, { worldBookId });
    await refreshSessions();
    addToast(worldBookId == null ? '已移除世界书' : `已更换世界书`);
    setPicker(null);
  };

  const share = async () => {
    const { exportSessionJson } = await import('./core/stats');
    try {
      const safe = session.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'session';
      const result = await exportSessionJson(session.id!, `${safe}-${Date.now()}.json`);
      if (result === 'canceled') {
        addToast('已取消导出');
      } else {
        addToast('会话已导出（分享文件）');
      }
    } catch (e) {
      addToast(`导出失败: ${(e as Error).message}`, 'error');
    }
  };

  const personaName = session.userPersonaNpcId != null ? npcs.find((n) => n.id === session.userPersonaNpcId)?.name : null;
  const worldBookName = session.worldBookId != null ? worldBooks.find((b) => b.id === session.worldBookId)?.name : null;

  return (
    <div className="chat-header">
      <SessionVisual mode={session.mode} npcName={npcRef?.name ?? undefined} hue={npcRef?.avatarColorOrdinal ?? 0} imageUrl={npcRef?.avatarDataUrl} members={session.mode === 'GROUP' ? groupMemberAvatars : undefined} size="lg" />
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
      <div className="chat-actions">
        <button
          className={`btn-ghost icon-tooltip ${personaName ? 'has-value' : ''}`}
          title={personaName ? `用户人设：${personaName}` : '更换用户人设'}
          onClick={() => setPicker('persona')}
        >
          <Icon name="user-persona" size={17} />
        </button>
        <button
          className={`btn-ghost icon-tooltip ${worldBookName ? 'has-value' : ''}`}
          title={worldBookName ? `世界书：${worldBookName}` : '更换世界书'}
          onClick={() => setPicker('worldbook')}
        >
          <Icon name="book" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip" title="分享对话（导出 JSON）" onClick={share}>
          <Icon name="share" size={17} />
        </button>
        <button className="btn-ghost icon-tooltip danger" title="删除对话" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={17} />
        </button>
      </div>

      {picker === 'persona' && (
        <Modal onClose={() => setPicker(null)} width="min(420px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>更换用户人设</span>
            <button className="icon-btn" onClick={() => setPicker(null)}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            <button className={`sel-opt ${session.userPersonaNpcId == null ? 'active' : ''}`} onClick={() => changePersona(null)}>
              <span>不使用用户人设</span>
              {session.userPersonaNpcId == null && <span className="sel-opt-check">✓</span>}
            </button>
            {npcs.filter((n) => n.id != null && n.id !== session.associatedId).map((n) => (
              <button key={n.id} className={`sel-opt ${session.userPersonaNpcId === n.id ? 'active' : ''}`} onClick={() => changePersona(n.id!)}>
                <span>{n.name}</span>
                {session.userPersonaNpcId === n.id && <span className="sel-opt-check">✓</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {picker === 'worldbook' && (
        <Modal onClose={() => setPicker(null)} width="min(420px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>更换世界书</span>
            <button className="icon-btn" onClick={() => setPicker(null)}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            <button className={`sel-opt ${session.worldBookId == null ? 'active' : ''}`} onClick={() => changeWorldBook(null)}>
              <span>不使用世界书</span>
              {session.worldBookId == null && <span className="sel-opt-check">✓</span>}
            </button>
            {worldBooks.map((b) => (
              <button key={b.id} className={`sel-opt ${session.worldBookId === b.id ? 'active' : ''}`} onClick={() => changeWorldBook(b.id!)}>
                <span>{b.name}</span>
                {session.worldBookId === b.id && <span className="sel-opt-check">✓</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} width="min(400px, calc(100vw - 32px))">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>删除对话</span>
            <button className="icon-btn" onClick={() => setConfirmDelete(false)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            确定删除对话「{session.title}」？该操作不可恢复。
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDelete(false)}>取消</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await deleteSession(session.id!);
                setConfirmDelete(false);
                addToast('会话已删除');
              }}
            >
              <Icon name="trash" size={13} /> 删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

async function updateSessionMeta(id: number, patch: { userPersonaNpcId?: number | null; worldBookId?: number | null }) {
  const { db } = await import('./db/database');
  await db.sessions.update(id, patch);
}