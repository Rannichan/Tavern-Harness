import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getCareerStats, resetCareerStats } from '../core/stats';
import { Icon } from './shared';
import type { AchievementState } from '../store/store';
import { useT, currentLocale } from '../core/i18n';

// ============================================================
// 生涯统计 + 成就陈列
// ============================================================

interface StatsData {
  inputTokens: number;
  outputTokens: number;
  totalRounds: number;
  sessionCount: number;
  npcStats: Array<{ npcId: number; npcName: string; rounds: number }>;
}

export function StatsView() {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [data, setData] = useState<StatsData | null>(null);

  const refresh = async () => {
    const d = await getCareerStats();
    setData(d);
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!data) {
    return <div className="view-page"><div className="spinner" /></div>;
  }

  return (
    <div className="view-page">
      <div className="view-col">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 className="view-title">{t('stats.title')}</h2>
            <p className="view-sub">{t('stats.sub')}</p>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!confirm(t('stats.resetConfirm'))) return;
              await resetCareerStats();
              await refresh();
              addToast(t('toast.statsReset'));
            }}
          >
            <Icon name="refresh" size={12} /> {t('stats.resetBtn')}
          </button>
        </div>

        {/* 成就陈列柜 */}
        <AchievementShelf />

        {/* 生涯统计 */}
        <StatCards data={data} />
      </div>
    </div>
  );
}

/** 成就陈列柜：已解锁的奖杯点亮，未解锁的只展示锁定状态 */
function AchievementShelf() {
  const achievements = useStore((s) => s.achievements);
  const t = useT();
  const unlockedCount = achievements.filter((a) => a.unlockedAt != null).length;

  return (
    <div className="set-section">
      <h3>{t('stats.shelfTitle')}</h3>
      <div className="ach-shelf">
        {achievements.map((a) => (
          <AchievementCard key={a.def.id} data={a} />
        ))}
      </div>
      <div className="ach-shelf-summary">
        {t('stats.unlocked')} <b>{unlockedCount}</b> / {achievements.length} {t('stats.trophies')}
      </div>
    </div>
  );
}

function AchievementCard({ data }: { data: AchievementState }) {
  const t = useT();
  const unlocked = data.unlockedAt != null;

  return (
    <div className={`ach-card ${unlocked ? 'unlocked' : ''}`} title={unlocked ? t('stats.unlockedStatus') : t('stats.locked')}>
      <div className="ach-card-head">
        <span className="ach-card-icon">{unlocked ? data.def.icon : '🔒'}</span>
        <span className="ach-card-status">{unlocked ? t('stats.unlockedStatus') : t('stats.locked')}</span>
      </div>
      <div className="ach-card-name">{unlocked ? t(`ach.${data.def.id}.name`) : t('stats.hidden')}</div>
      {unlocked && (
        <div className="ach-card-desc">{t(`ach.${data.def.id}.desc`)}</div>
      )}
      {unlocked && data.unlockedAt && (
        <div className="ach-card-time">
          {new Date(data.unlockedAt).toLocaleDateString(currentLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })} {t('stats.unlockedAt')}
        </div>
      )}
    </div>
  );
}

function StatCards({ data }: { data: StatsData }) {
  const t = useT();
  const totalTokens = data.inputTokens + data.outputTokens;

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{totalTokens.toLocaleString()}</div>
          <div className="k">{t('stats.totalTokens')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.inputTokens.toLocaleString()}</div>
          <div className="k">{t('stats.inputTokens')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.outputTokens.toLocaleString()}</div>
          <div className="k">{t('stats.outputTokens')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.totalRounds}</div>
          <div className="k">{t('stats.rounds')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.sessionCount}</div>
          <div className="k">{t('stats.sessions')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.totalRounds && data.sessionCount ? (data.totalRounds / data.sessionCount).toFixed(1) : '0'}</div>
          <div className="k">{t('stats.avgRounds')}</div>
        </div>
      </div>

      <div className="set-section">
        <h3>{t('stats.mostActive')}</h3>
        {data.npcStats.length > 0 ? (
          <>
            {(() => {
              const mostActive = [...data.npcStats].sort((a, b) => b.rounds - a.rounds)[0];
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 26 }}>🎭</div>
                  <div>
                    <div style={{ fontWeight: 800 }}>{mostActive.npcName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('stats.roundsCount', { n: mostActive.rounds })}</div>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('stats.noData')}</div>
        )}
      </div>

      {data.npcStats.length > 0 && (
        <div className="set-section">
          <h3>{t('stats.ranking')}</h3>
          <table className="table">
            <thead>
              <tr><th>{t('stats.colChar')}</th><th>{t('stats.colRounds')}</th></tr>
            </thead>
            <tbody>
              {[...data.npcStats].sort((a, b) => b.rounds - a.rounds).map((n) => (
                <tr key={n.npcId}>
                  <td>{n.npcName}</td>
                  <td>{n.rounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}