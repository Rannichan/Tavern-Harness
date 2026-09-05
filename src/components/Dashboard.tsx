import { useStore, createSession } from '../store/store';
import { Icon } from './shared';

// ============================================================
// 仪表盘（无活动会话时的起始页）
// ============================================================

export function Dashboard() {
  const npcs = useStore((s) => s.npcs);
  const sessions = useStore((s) => s.sessions);
  const addToast = useStore((s) => s.addToast);

  const startStandard = async () => {
    const id = await createSession('STANDARD');
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(id);
  };

  const startNpc = async (id: number) => {
    const sid = await createSession('NPC', { associatedId: id });
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
  };

  const startGroup = async () => {
    const npcIds = npcs.map((n) => n.id!).slice(0, 3);
    if (npcIds.length < 2) {
      addToast('需要至少 2 位角色才能创建群聊', 'error');
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
          <h1>欢迎回到酒馆 🫖</h1>
          <p>
            Tavern Harness — 本地优先的 AI 助手与角色扮演工作台。
            支持任意 OpenAI 兼容 API、角色卡（NPC）、世界书、生成式技能、群聊回合制，全部数据存储在你的浏览器中。
          </p>
          <div className="actions">
            <button className="btn btn-primary" onClick={startStandard}>
              <Icon name="plus" size={14} /> 开始标准对话
            </button>
            <button
              className="btn"
              onClick={() => {
                useStore.getState().setActiveView('characters');
              }}
            >
              <Icon name="users" size={14} /> 前往角色工坊
            </button>
          </div>
        </div>

        <div>
          <span className="section-title">与角色继续对话</span>
          {sessions.filter((s) => s.mode !== 'STANDARD').length === 0 && (
            <div className="card empty-state">
              <div className="big">🍺</div>
              <span>还没有角色对话，从下面的角色卡片开始</span>
            </div>
          )}
        </div>

        <div>
          <span className="section-title">酒馆常客</span>
          <div className="char-grid">
            {npcs.map((n) => (
              <div key={n.id} className="char-card">
                <div className="cname">
                  <span className="avatar xs" style={{ background: `linear-gradient(135deg, var(--grad-from), var(--grad-to))` }}>
                    {n.name.slice(0, 1)}
                  </span>
                  {n.name}
                  {n.isBuiltIn && <span className="tag">内置</span>}
                </div>
                <div className="cgreet">{n.greeting}</div>
                <div className="cactions">
                  <button className="btn btn-sm btn-primary" onClick={() => startNpc(n.id!)}>开始对话</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}