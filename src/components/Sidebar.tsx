import { useState } from 'react';
import { useStore } from '../store/store';
import { Avatar, Icon, SessionVisual, Modal } from './shared';
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
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);

  // 最多 5 个角色槽位（1 = NPC 对话；2-5 = 群聊）
  const [slots, setSlots] = useState<(number | null)[]>([null]);
  const [title, setTitle] = useState('');
  const [userPersonaNpcId, setUserPersonaNpcId] = useState<number | null>(null);
  const [worldBookId, setWorldBookId] = useState<number | null>(null);

  const selectedNpcIds = slots.filter(Boolean) as number[];
  const modeLabel = selectedNpcIds.length === 0 ? '未选择' : selectedNpcIds.length === 1 ? 'NPC 对话' : `群聊（${selectedNpcIds.length} 人）`;

  const create = async () => {
    if (selectedNpcIds.length === 0) {
      addToast('请至少选择一位角色', 'error');
      return;
    }
    const finalTitle = title.trim() || selectedNpcIds.map((id) => npcs.find((n) => n.id === id)?.name).filter(Boolean).join('、');
    let sid: number;
    if (selectedNpcIds.length === 1) {
      sid = await createSessionWithBoss('NPC', {
        associatedId: selectedNpcIds[0],
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
      });
    } else {
      sid = await createSessionWithBoss('GROUP', {
        npcIds: selectedNpcIds,
        title: finalTitle,
        worldBookId,
        userPersonaNpcId,
      });
    }
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
    onClose();
  };

  const addSlot = () => {
    if (slots.length < 5) setSlots([...slots, null]);
  };
  const setSlot = (idx: number, npcId: number | null) => {
    // 不允许重复选择
    const others = slots.filter((_, i) => i !== idx).filter(Boolean) as number[];
    if (npcId != null && others.includes(npcId)) {
      addToast('该角色已在会话中', 'error');
      return;
    }
    const next = [...slots];
    next[idx] = npcId;
    // 移除尾部的空位
    while (next.length > 1 && next[next.length - 1] == null) next.pop();
    setSlots(next);
  };
  const removeSlot = (idx: number) => {
    if (slots.length === 1) return;
    const next = slots.filter((_, i) => i !== idx);
    while (next.length > 1 && next[next.length - 1] == null) next.pop();
    setSlots(next);
  };

  const canCreate = selectedNpcIds.length > 0;

  return (
    <Modal onClose={onClose} width={460}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>创建对话</span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 标题 */}
        <div className="field">
          <label>对话名称</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder={selectedNpcIds.length > 0 ? selectedNpcIds.map((id) => npcs.find((n) => n.id === id)?.name).join('、') : '未命名'}
          />
        </div>

        {/* 角色槽位 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 0.3 }}>参与角色</label>
            <span className="tag">{modeLabel}</span>
          </div>
          {npcs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '8px 12px', borderRadius: 9 }}>
              ⚠️ 请先在「角色工坊」创建角色卡！
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {slots.map((id, i) => {
                const npc = id != null ? npcs.find((n) => n.id === id) : null;
                return (
                  <div key={i} className="npc-slot">
                    {npc ? (
                      <>
                        <Avatar name={npc.name} colorOrdinal={npc.avatarColorOrdinal} imageUrl={npc.avatarDataUrl} size="sm" />
                        <span className="npc-slot-name">{npc.name}</span>
                        <button className="npc-slot-x" onClick={() => removeSlot(i)}><Icon name="x" size={11} /></button>
                      </>
                    ) : (
                      <select className="npc-slot-select" value="" onChange={(e) => setSlot(i, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">＋ 选择角色</option>
                        {npcs.filter((n) => !slots.some((s, j) => j !== i && s === n.id)).map((n) => (
                          <option key={n.id} value={n.id!}>{n.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
              {slots.length < 5 && <button className="npc-slot-add" onClick={addSlot} title="添加角色（最多 5 位）">＋</button>}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>
            选择 1 位角色 = NPC 对话 · 选择 2~5 位 = 群聊回合制
          </div>
        </div>

        {/* 用户人设 */}
        <div className="field">
          <label>用户人设（可选）</label>
          <select className="select" value={userPersonaNpcId ?? ''} onChange={(e) => setUserPersonaNpcId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">不使用用户人设</option>
            {npcs.filter((n) => n.id != null && !selectedNpcIds.includes(n.id!)).map((n) => (
              <option key={n.id} value={n.id!}>{n.name}</option>
            ))}
          </select>
        </div>

        {/* 世界书 */}
        <div className="field">
          <label>世界书（可选）</label>
          <select className="select" value={worldBookId ?? ''} onChange={(e) => setWorldBookId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">不使用世界书</option>
            {worldBooks.map((b) => (
              <option key={b.id} value={b.id!}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!canCreate} onClick={create}>确定</button>
      </div>
    </Modal>
  );
}

// 复用 store 中的 createSession（避免循环导入）
import { createSession as createSessionWithBoss } from '../store/store';

// 重新导出类型（供 App 使用）
export type { ChatSession };