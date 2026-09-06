import { db } from '../db/database';

// ============================================================
// 成就系统（基于生涯总 Token 数的等级制成就）
// ============================================================

export interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  /** 达成所需累计 Token 数（输入 + 输出） */
  threshold: number;
  description: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'traveler', name: '旅人', icon: '🧭', threshold: 1_000, description: '累计使用 1,000 Token' },
  { id: 'old-friend', name: '老友', icon: '🤝', threshold: 10_000, description: '累计使用 10,000 Token' },
  { id: 'bard', name: '吟游诗人', icon: '🎻', threshold: 100_000, description: '累计使用 100,000 Token' },
  { id: 'night-owl', name: '午夜不归人', icon: '🌙', threshold: 1_000_000, description: '累计使用 1,000,000 Token' },
  { id: 'legend', name: '酒馆传奇', icon: '🏆', threshold: 100_000_000, description: '累计使用 100,000,000 Token' },
];

export const MAX_ACHIEVEMENT_THRESHOLD = ACHIEVEMENTS[ACHIEVEMENTS.length - 1].threshold;

/** 生涯总 token（输入 + 输出） */
export async function getTotalTokens(): Promise<number> {
  const stats = (await db.careerStats.get(1)) ?? { id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 };
  return stats.inputTokens + stats.outputTokens;
}

/** 已解锁的成就 id 集合 */
export async function getUnlockedAchievementIds(): Promise<Set<string>> {
  const rows = await db.achievementUnlocks.toArray();
  return new Set(rows.map((r) => r.achievementId));
}

const unlockDispatcher: { push: (ach: AchievementDef, total: number) => void } = {
  push: () => {},
};

/** 注册「解锁成就」回调（由 UI 层在启动时注入，用于弹窗撒花展示） */
export function registerUnlockDispatcher(dispatcher: (ach: AchievementDef, total: number) => void): void {
  unlockDispatcher.push = dispatcher;
}

let checkLock: Promise<void> | null = null;

/**
 * 检测是否有新解锁的成就（幂等：已解锁的不会重复触发）。
 * 并发安全：内部串行执行，避免多次流式回合同时触发重复弹窗。
 */
export async function checkAchievementUnlocks(): Promise<void> {
  if (checkLock) {
    await checkLock;
    return;
  }
  const run = async (): Promise<void> => {
    const total = await getTotalTokens();
    const unlocked = await getUnlockedAchievementIds();
    const newly: Array<{ def: AchievementDef; total: number }> = [];

    for (const def of ACHIEVEMENTS) {
      if (unlocked.has(def.id)) continue;
      if (total >= def.threshold) {
        await db.achievementUnlocks.add({ achievementId: def.id, unlockedAt: Date.now() });
        newly.push({ def, total });
      }
    }
    if (newly.length > 0) {
      // 先同步进 store，成就页无需刷新即可看到最新解锁
      const { useStore } = await import('../store/store');
      useStore.getState().refreshAchievements();
      // 由高到低依次展示（若多级同时达成）
      for (const { def, total } of newly.sort((a, b) => b.def.threshold - a.def.threshold)) {
        try {
          unlockDispatcher.push(def, total);
        } catch {
          // 忽略 UI 展示层的错误，不影响统计与持久化
        }
      }
    }
  };
  checkLock = run().finally(() => {
    checkLock = null;
  });
  await checkLock;
}