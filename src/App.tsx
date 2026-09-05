import { useEffect, useState } from 'react';
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
import { Icon } from './components/shared';
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
  const settings = useStore((s) => s.settings);
  const modelsList = useStore((s) => s.modelsList);
  const selectModel = useStore((s) => s.selectModel);
  const [showPicker, setShowPicker] = useState(false);

  const modeLabel = session.mode === 'STANDARD' ? '标准对话' : session.mode === 'NPC' ? '角色对话' : '群聊';
  const npcRef = session.associatedId ? npcs.find((n) => n.id === session.associatedId) : null;
  const groupNpcs = participants.filter((p) => p.kind === 'NPC').map((p) => npcs.find((n) => n.id === p.npcId)).filter(Boolean);

  const selectedModel = settings?.defaultModel?.trim() || '';
  const modelLabel = selectedModel || '未选择模型';

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
        {/* 模型选择器（对齐 Android：顶部副标题区可点击 chip → 单选列表） */}
        <button
          className="model-chip"
          onClick={() => setShowPicker(true)}
          title="选择模型"
        >
          <span className="model-chip-label">{modelLabel}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      <div className="foot-actions">
        <button className="btn btn-ghost btn-sm" onClick={onNew} title="新建会话">
          ＋ 新会话
        </button>
      </div>

      {showPicker && (
        <ModelPickerDialog
          models={modelsList}
          selected={selectedModel}
          onSelect={async (m) => {
            await selectModel(m);
            setShowPicker(false);
          }}
          onDismiss={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

/** 模型选择对话框：RadioButton 列表（对齐 Android ModelPickerDialog） */
function ModelPickerDialog({
  models,
  selected,
  onSelect,
  onDismiss,
}: {
  models: string[];
  selected: string;
  onSelect: (model: string) => void;
  onDismiss: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const hasModels = models.length > 0;
  const manualModel = settings?.defaultModel?.trim() || '';

  return (
    <>
      <div className="overlay" onClick={onDismiss} />
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card" style={{ width: 'min(420px, calc(100vw - 32px))' }}>
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>选择模型</span>
            <button className="icon-btn" onClick={onDismiss}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ padding: '8px 10px' }}>
            {hasModels ? (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflowY: 'auto' }}>
                {models.map((m) => (
                  <label key={m} className="model-option" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="model-pick"
                      checked={m === selected}
                      onChange={() => onSelect(m)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, wordBreak: 'break-all' }}>{m}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                暂无可用模型列表。请先在「设置 → 模型服务 Provider」中添加并测试连接一个 Provider，
                或手动输入模型名。
              </div>
            )}
            {!hasModels && manualModel && (
              <div style={{ padding: '0 6px 6px' }}>
                <div className="s-desc" style={{ marginBottom: 6 }}>当前手动模型：</div>
                <div className="model-option" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer' }}>
                  <input type="radio" name="model-pick" checked onChange={() => onSelect(manualModel)} style={{ accentColor: 'var(--primary)' }} />
                  <span className="mono">{manualModel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}