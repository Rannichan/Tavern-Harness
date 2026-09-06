import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { getCareerStats, resetCareerStats } from '../core/stats';
import { Icon } from './shared';

// ============================================================
// 生涯统计
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

  const mostActive = [...data.npcStats].sort((a, b) => b.rounds - a.rounds)[0];
  const totalTokens = data.inputTokens + data.outputTokens;

  return (
    <div className="view-page">
      <div className="view-col">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="view-title">成就</h2>
            <p className="view-sub">生涯统计：append-only，删除消息不影响统计；仅累加真实用户回合</p>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!confirm('确定重置生涯统计？')) return;
              await resetCareerStats();
              await refresh();
              addToast('统计已重置');
            }}
          >
            <Icon name="refresh" size={12} /> 重置
          </button>
        </div>

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
          {mostActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 26 }}>🎭</div>
              <div>
                <div style={{ fontWeight: 800 }}>{mostActive.npcName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{mostActive.rounds} 轮对话</div>
              </div>
            </div>
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
      </div>
    </div>
  );
}