import { useState } from 'react';
import { useStore, createSession } from '../store/store';
import { Avatar, Icon, SessionVisual } from './shared';
import type { ChatSession } from '../types/models';

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const npcs = useStore((s) => s.npcs);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const activeView = useStore((s) => s.activeView);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveView = useStore((s) => s.setActiveView);
  const deleteSession = useStore((s) => s.deleteSession);
  const addToast = useStore((s) => s.addToast);

  const [showNew, setShowNew] = useState(false);

  const npcById = (id: number | null) => (id != null ? npcs.find((n) => n.id === id) : null);

  const handleNewSession = async (mode: 'STANDARD' | 'NPC' | 'GROUP', npcId?: number) => {
    const id = await createSession(mode, {
      associatedId: mode === 'NPC' ? npcId : undefined,
      npcIds: mode === 'GROUP' ? undefined : undefined,
    });
    setActiveSession(id);
    setShowNew(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-logo">🫖</div>
          <div>
            <div className="brand-name">Tavern Harness</div>
            <div className="brand-sub">酒馆 · 本地 AI 助手</div>
          </div>
        </div>
        <div className="side-nav">
          <button className={`nav-chip ${activeView === 'chat' ? 'active' : ''}`} onClick={() => setActiveView('chat')}>
            <Icon name="send" size={13} /> 对话
          </button>
          <button className={`nav-chip ${activeView === 'characters' ? 'active' : ''}`} onClick={() => setActiveView('characters')}>
            <Icon name="users" size={13} /> 角色工坊
          </button>
          <button className={`nav-chip ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}>
            <Icon name="file" size={13} /> 文件
          </button>
          <button className={`nav-chip ${activeView === 'stats' ? 'active' : ''}`} onClick={() => setActiveView('stats')}>
            <Icon name="chart" size={13} /> 统计
          </button>
          <button className={`nav-chip ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>
            <Icon name="settings" size={13} /> 设置
          </button>
        </div>
      </div>

      <div className="session-list">
        <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-title" style={{ margin: 0 }}>会话</span>
        </div>
        {sessions.map((s) => {
          const npc = npcById(s.associatedId);
          return (
            <button
              key={s.id}
              className={`session-item ${s.id === activeSessionId && activeView === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveSession(s.id!)}
            >
              {s.mode === 'NPC' ? (
                <Avatar name={npc?.name ?? 'NPC'} colorOrdinal={npc?.avatarColorOrdinal ?? 0} imageUrl={npc?.avatarDataUrl} size="xs" />
              ) : (
                <SessionVisual mode={s.mode} />
              )}
              <div className="smeta">
                <div className="stitle">{s.title}</div>
                <div className="sprev">{s.lastMessage || '开始新对话…'}</div>
              </div>
              <span
                className="sdel"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id!);
                  addToast('会话已删除');
                }}
              >
                <Icon name="trash" size={13} />
              </span>
            </button>
          );
        })}
        {sessions.length === 0 && (
          <div className="empty-state" style={{ padding: 30 }}>
            <div className="big">🍺</div>
            <span>还没有会话，先开一局？</span>
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>新会话</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>标准 / 角色 / 群聊</span>
        </div>
        <div className="foot-actions">
          <button className="btn" onClick={() => setShowNew(!showNew)}>
            <Icon name="plus" size={14} /> 新建
          </button>
        </div>
      </div>

      {showNew && <NewSessionMenu onClose={() => setShowNew(false)} />}
    </aside>
  );
}

function NewSessionMenu({ onClose }: { onClose: () => void }) {
  const npcs = useStore((s) => s.npcs);
  const createSession = useStore((s) => s.setActiveSession);

  const start = async (mode: 'STANDARD' | 'NPC' | 'GROUP', opts?: { associatedId?: number; npcIds?: number[]; title?: string }) => {
    const id = await createSessionWithBoss(mode, opts);
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(id);
    onClose();
  };

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card fade-up" style={{ maxWidth: 400 }}>
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>新建会话</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => start('STANDARD')}>
              💬 标准对话<span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 11 }}>与 AI 助手一对一</span>
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', padding: '4px 2px' }}>
              与角色对话（NPC） — 选择一个角色
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {npcs.map((n) => (
                <button key={n.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => start('NPC', { associatedId: n.id! })}>
                  <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
                  <span>{n.name}</span>
                  {n.isBuiltIn && <span className="tag">内置</span>}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', padding: '4px 2px' }}>
              群聊（GROUP）
            </div>
            <button
              className="btn"
              style={{ justifyContent: 'flex-start' }}
              onClick={async () => {
                const ids = npcs.slice(0, 3).map((n) => n.id!);
                if (ids.length < 2) {
                  useStore.getState().addToast('需要至少 2 位角色才能创建群聊', 'error');
                  return;
                }
                await start('GROUP', { npcIds: ids });
              }}
            >
              👥 创建群聊（前 {Math.min(3, npcs.length)} 位角色）
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 复用 store 中的 createSession（避免循环导入）
import { createSession as createSessionWithBoss } from '../store/store';

// 重新导出类型（供 App 使用）
export type { ChatSession };