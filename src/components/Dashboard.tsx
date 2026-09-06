import { useState } from 'react';
import { useStore } from '../store/store';
import { Icon } from './shared';
import { NewSessionMenu } from './NewSessionMenu';
import { useT } from '../core/i18n';

// ============================================================
// 仪表盘（无活动会话时的起始页）
// ============================================================

export function Dashboard() {
  const npcs = useStore((s) => s.npcs);
  const sessions = useStore((s) => s.sessions);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [showNew, setShowNew] = useState(false);

  const startNpc = async (id: number) => {
    const { createSession } = await import('../store/store');
    const sid = await createSession('NPC', { associatedId: id });
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
  };

  const startGroup = async () => {
    const { createSession } = await import('../store/store');
    const npcIds = npcs.map((n) => n.id!).slice(0, 3);
    if (npcIds.length < 2) {
      addToast(t('toast.needTwoNpcs'), 'error');
      return;
    }
    const sid = await createSession('GROUP', { npcIds });
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
  };

  return (
    <div className="dash-scroll">
      <div className="dash">
        <div className="dash-hero fade-up">
          <h1>{t('dash.welcome')}</h1>
          <p>
            {t('dash.hero')}
          </p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={14} /> {t('dash.newChat')}
            </button>
            <button
              className="btn"
              onClick={() => {
                useStore.getState().setActiveView('characters');
              }}
            >
              <Icon name="users" size={14} /> {t('dash.goCharacters')}
            </button>
          </div>
        </div>

        <div>
          <span className="section-title">{t('dash.continue')}</span>
          {sessions.filter((s) => s.mode !== 'STANDARD').length === 0 && (
            <div className="card empty-state">
              <div className="big">🍺</div>
              <span>{t('dash.noCharConv')}</span>
            </div>
          )}
        </div>

        <div>
          <span className="section-title">{t('dash.regulars')}</span>
          <div className="char-grid">
            {npcs.map((n) => (
              <div key={n.id} className="char-card">
                <div className="cname">
                  <span className="avatar xs" style={{ background: `linear-gradient(135deg, var(--grad-from), var(--grad-to))` }}>
                    {n.name.slice(0, 1)}
                  </span>
                  {n.name}
                  {n.isBuiltIn && <span className="tag">{t('common.builtin')}</span>}
                </div>
                <div className="cgreet">{n.greeting}</div>
                <div className="cactions">
                  <button className="btn btn-sm btn-primary" onClick={() => startNpc(n.id!)}>{t('dash.startChat')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNew && <NewSessionMenu onClose={() => setShowNew(false)} />}
    </div>
  );
}