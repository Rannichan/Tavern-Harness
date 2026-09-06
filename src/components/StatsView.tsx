import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getCareerStats, resetCareerStats } from '../core/stats';
import { Icon } from './shared';
import type { AchievementState } from '../store/store';

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
            <h2 className="view-title">🏆 成就</h2>
            <p className="view-sub">成就奖杯会陈列在这里；生涯统计为 append-only，删除消息不影响统计</p>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!confirm('确定重置生涯统计？（不会清除已解锁的成就奖杯）')) return;
              await resetCareerStats();
              await refresh();
              addToast('统计已重置');
            }}
          >
            <Icon name="refresh" size={12} /> 重置统计
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

  const unlockedCount = achievements.filter((a) => a.unlockedAt != null).length;

  return (
    <div className="set-section">
      <h3>🎖️ 奖杯陈列柜</h3>
      <div className="ach-shelf">
        {achievements.map((a) => (
          <AchievementCard key={a.def.id} data={a} />
        ))}
      </div>
      <div className="ach-shelf-summary">
        已解锁 <b>{unlockedCount}</b> / {achievements.length} 枚奖杯
      </div>
    </div>
  );
}

function AchievementCard({ data }: { data: AchievementState }) {
  const unlocked = data.unlockedAt != null;

  return (
    <div className={`ach-card ${unlocked ? 'unlocked' : ''}`} title={unlocked ? '已解锁' : '未解锁'}>
      <div className="ach-card-head">
        <span className="ach-card-icon">{unlocked ? data.def.icon : '🔒'}</span>
        <span className="ach-card-status">{unlocked ? '✓ 已解锁' : '未解锁'}</span>
      </div>
      <div className="ach-card-name">{unlocked ? data.def.name : '？？？'}</div>
      {unlocked && (
        <div className="ach-card-desc">{data.def.description}</div>
      )}
      {unlocked && data.unlockedAt && (
        <div className="ach-card-time">
          {new Date(data.unlockedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })} 解锁
        </div>
      )}
    </div>
  );
}

function StatCards({ data }: { data: StatsData }) {
  const totalTokens = data.inputTokens + data.outputTokens;

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="v">{totalTokens.toLocaleString()}</div>
          <div className="k">总 Tokens（输入 + 输出）</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.inputTokens.toLocaleString()}</div>
          <div className="k">输入 Tokens</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.outputTokens.toLocaleString()}</div>
          <div className="k">输出 Tokens</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.totalRounds}</div>
          <div className="k">对话轮数</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.sessionCount}</div>
          <div className="k">累计会话</div>
        </div>
        <div className="stat-card">
          <div className="v">{data.totalRounds && data.sessionCount ? (data.totalRounds / data.sessionCount).toFixed(1) : '0'}</div>
          <div className="k">平均轮数 / 会话</div>
        </div>
      </div>

      <div className="set-section">
        <h3>🏆 最活跃角色</h3>
        {data.npcStats.length > 0 ? (
          <>
            {(() => {
              const mostActive = [...data.npcStats].sort((a, b) => b.rounds - a.rounds)[0];
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 26 }}>🎭</div>
                  <div>
                    <div style={{ fontWeight: 800 }}>{mostActive.npcName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{mostActive.rounds} 轮对话</div>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>暂无数据，去和角色聊聊天吧</div>
        )}
      </div>

      {data.npcStats.length > 0 && (
        <div className="set-section">
          <h3>🎭 角色轮数排行</h3>
          <table className="table">
            <thead>
              <tr><th>角色</th><th>轮数</th></tr>
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