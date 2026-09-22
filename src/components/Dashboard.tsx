import { useEffect, useMemo, useState } from 'react';
import { createSession, useStore } from '../store/store';
import { db } from '../db/database';
import { Icon, SessionVisual } from './shared';
import { NewSessionMenu } from './NewSessionMenu';
import { useT, currentLocale } from '../core/i18n';
import type { SessionMember } from './shared';
import type { NpcCharacter } from '../types/models';

// ============================================================
// 仪表盘（无活动会话时的起始页）
// ============================================================

export function Dashboard() {
  const npcs = useStore((s) => s.npcs);
  const sessions = useStore((s) => s.sessions);
  const t = useT();
  const [showNew, setShowNew] = useState(false);

  const startNpc = async (id: number) => {
    const sid = await createSession('NPC', { associatedId: id });
    await useStore.getState().refreshSessions();
    useStore.getState().setActiveSession(sid);
  };

  // 群聊会话 → 参与者中的 NPC 角色（用于群头像拼贴，每个会话一次）
  const [groupMembers, setGroupMembers] = useState<Record<number, NpcCharacter[]>>({});
  useEffect(() => {
    const groupSessions = sessions.filter((s) => s.mode === 'GROUP');
    if (groupSessions.length === 0) return;
    let cancelled = false;
    (async () => {
      const loaded: Record<number, NpcCharacter[]> = {};
      await Promise.all(
        groupSessions.map(async (s) => {
          const parts = await db.participants.where('sessionId').equals(s.id!).toArray();
          const npcs1 = parts
            .filter((p) => p.kind === 'NPC' && p.npcId != null)
            .map((p) => npcs.find((n) => n.id === p.npcId))
            .filter((n): n is NpcCharacter => Boolean(n));
          loaded[s.id!] = npcs1;
        })
      );
      if (!cancelled) setGroupMembers(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, npcs]);

  // 与角色继续对话：最近按 updatedAt 排序的 3 个有实际内容的会话（最新在前）
  const recentSessions = useMemo(() => {
    return sessions
      .filter((s) => s.mode !== 'STANDARD')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);
  }, [sessions]);

  // 会话缩略标题：使用最后一条消息的首行，截断到 42 字符
  const sessionPreview = (s: (typeof sessions)[number]) => {
    const text = s.lastMessage || (s.mode === 'GROUP' ? t('dash.groupSession') : t('dash.newSession'));
    const line = text.trim().split('\n').find(Boolean) ?? '';
    return line.length > 42 ? `${line.slice(0, 42)}…` : line;
  };

  // 会话相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前），与界面语言一致
  const sessionTime = (ts: number) => {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const hour = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (min < 1) return t('dash.timeJustNow');
    if (min < 60) return t('dash.timeMinAgo', { n: min });
    if (hour < 24) return t('dash.timeHourAgo', { n: hour });
    if (day < 30) return t('dash.timeDayAgo', { n: day });
    return new Date(ts).toLocaleDateString(currentLocale());
  };

  return (
    <div className="dash-scroll">
      <div className="dash">
        <div className="dash-hero fade-up">
          <h1>{t('dash.welcome')}</h1>
          <p>
            {t('dash.hero')}
            <span className="dash-hero-accent">{t('dash.heroAccent')}</span>
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
          {recentSessions.length === 0 ? (
            <div className="card empty-state">
              <div className="big">🍺</div>
              <span>{t('dash.noCharConv')}</span>
            </div>
          ) : (
            <div className="recent-list">
              {recentSessions.map((s) => {
                const npc = npcs.find((n) => n.id === s.associatedId);
                const members: SessionMember[] | undefined =
                  s.mode === 'GROUP'
                    ? (groupMembers[s.id!] ?? []).slice(0, 4).map((n) => ({
                        name: n.name,
                        colorOrdinal: n.avatarColorOrdinal,
                        imageUrl: n.avatarDataUrl,
                      }))
                    : undefined;
                return (
                  <button
                    key={s.id}
                    className="recent-item"
                    onClick={() => useStore.getState().setActiveSession(s.id!)}
                  >
                    <SessionVisual
                      mode={s.mode}
                      npcName={npc?.name}
                      hue={npc?.avatarColorOrdinal}
                      imageUrl={npc?.avatarDataUrl}
                      members={members}
                    />
                    <div className="recent-meta">
                      <div className="recent-title">
                        <span className="recent-title-text">{s.title}</span>
                        <span className="recent-time">{sessionTime(s.updatedAt)}</span>
                      </div>
                      <div className="recent-preview">{sessionPreview(s)}</div>
                    </div>
                    <span className="recent-go">
                      <Icon name="send" size={13} />
                    </span>
                  </button>
                );
              })}
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