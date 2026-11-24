import { memo } from 'react';
import { createSession, useStore } from '../store/store';
import { Avatar, Icon, MasonryGrid } from './shared';
import { useT } from '../core/i18n';
import { textPreview } from '../core/textPreview';
import { restartManualChapterFour, restartManualChapterTwo, restartOpeningGuide } from './OpeningGuide';

// ============================================================
// 仪表盘（无活动会话时的起始页）
// ============================================================

export const Dashboard = memo(function Dashboard() {
  const npcs = useStore((s) => s.npcs);
  const t = useT();

  const startNpc = async (id: number) => {
    const sid = await createSession('NPC', { associatedId: id });
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
            <span className="dash-hero-accent">{t('dash.heroAccent')}</span>
          </p>
          <div className="actions">
            <a className="btn btn-primary" href="https://github.com/Rannichan/Tavern-Harness" target="_blank" rel="noreferrer">
              <span className="github-icon" aria-hidden="true" /> {t('dash.openGitHub')}
            </a>
            <a className="btn" href="https://rannichan.github.io/Tavern-Harness/index.html" target="_blank" rel="noreferrer">
              <Icon name="open-in-new" size={14} /> {t('dash.openIntro')}
            </a>
            <a className="btn" href="https://rannichan.github.io/Tavern-Harness/wiki.html" target="_blank" rel="noreferrer">
              <Icon name="book" size={14} /> {t('dash.openWiki')}
            </a>
          </div>
        </div>

        <section className="tavern-manual">
          <span className="section-title">{t('dash.manual')}</span>
          <div className="manual-chapter-list">
            <button className="manual-chapter" onClick={restartOpeningGuide}>
              <span className="manual-chapter-icon"><Icon name="book" size={18} /></span>
              <span className="manual-chapter-copy">
                <strong>{t('dash.manualChapterOne')}</strong>
                <span>{t('dash.manualChapterOneDesc')}</span>
              </span>
              <span className="manual-chapter-action">{t('dash.manualStart')} <Icon name="send" size={13} /></span>
            </button>
            <button className="manual-chapter" onClick={restartManualChapterTwo}>
              <span className="manual-chapter-icon"><Icon name="users" size={18} /></span>
              <span className="manual-chapter-copy">
                <strong>{t('dash.manualChapterTwo')}</strong>
                <span>{t('dash.manualChapterTwoDesc')}</span>
              </span>
              <span className="manual-chapter-action">{t('dash.manualStart')} <Icon name="send" size={13} /></span>
            </button>
            <button className="manual-chapter" onClick={restartManualChapterFour}>
              <span className="manual-chapter-icon"><Icon name="shield" size={18} /></span>
              <span className="manual-chapter-copy">
                <strong>{t('dash.manualChapterFour')}</strong>
                <span>{t('dash.manualChapterFourDesc')}</span>
              </span>
              <span className="manual-chapter-action">{t('dash.manualStart')} <Icon name="send" size={13} /></span>
            </button>
          </div>
        </section>

        <div>
          <span className="section-title">{t('dash.regulars')}</span>
          <MasonryGrid>
            {npcs.map((n) => (
              <div key={n.id} className="char-card">
                <div className="cname">
                  <Avatar
                    name={n.name}
                    colorOrdinal={n.avatarColorOrdinal}
                    imageUrl={n.avatarDataUrl}
                    size="xs"
                  />
                  {n.name}
                  {n.isBuiltIn && <span className="tag">{t('common.builtin')}</span>}
                </div>
                <div className="cgreet">{textPreview(n.greeting)}</div>
                <div className="cactions">
                  <button className="btn btn-sm btn-primary" onClick={() => startNpc(n.id!)}>{t('dash.startChat')}</button>
                </div>
              </div>
            ))}
          </MasonryGrid>
        </div>
      </div>
    </div>
  );
});