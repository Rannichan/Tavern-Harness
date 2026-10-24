import { db } from '../db/database';
import type { ChatMessage } from '../types/models';
import { checkAchievementUnlocks } from './achievements';

// ============================================================
// 生涯统计（append-only）与工具函数
// ============================================================

interface StatsDelta {
  inputTokens: number;
  outputTokens: number;
  rounds: number;
  npcRounds?: { npcId: number; npcName: string; rounds: number };
}

export interface CareerStats {
  inputTokens: number;
  outputTokens: number;
  totalRounds: number;
  sessionCount: number;
  npcStats: Array<{ npcId: number; npcName: string; rounds: number }>;
}

let cachedCareerStats: CareerStats | null = null;
let loadingCareerStats: Promise<CareerStats> | null = null;

async function loadCareerStats(): Promise<CareerStats> {
  const [stats, npcStats, sessionCount] = await Promise.all([
    db.careerStats.get(1),
    db.careerNpcStats.toArray(),
    db.sessions.count(),
  ]);
  return {
    ...(stats ?? { id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 }),
    npcStats,
    sessionCount,
  };
}

/** 后台预读成就页所需的统计，避免首次打开页面时等待远端持久化服务。 */
export async function preloadCareerStats(): Promise<void> {
  if (cachedCareerStats) return;
  loadingCareerStats ??= loadCareerStats().then((stats) => {
    cachedCareerStats = stats;
    return stats;
  }).finally(() => {
    loadingCareerStats = null;
  });
  await loadingCareerStats;
}

/** 消息产生后累计到生涯统计（服务器关闭也不丢失：已持久化消息带 usage） */
export async function accumulateStats(delta: StatsDelta, sessionId: number | null, _npcId: number | null): Promise<void> {
  if (delta.inputTokens <= 0 && delta.outputTokens <= 0 && delta.rounds <= 0) return;
  const stats = (await db.careerStats.get(1)) ?? { id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 };
  await db.careerStats.put({
    ...stats,
    inputTokens: stats.inputTokens + delta.inputTokens,
    outputTokens: stats.outputTokens + delta.outputTokens,
    totalRounds: stats.totalRounds + delta.rounds,
  });
  if (delta.npcRounds && delta.npcRounds.rounds > 0) {
    const existing = await db.careerNpcStats.get(delta.npcRounds.npcId);
    if (existing) {
      await db.careerNpcStats.update(delta.npcRounds.npcId, {
        rounds: existing.rounds + delta.npcRounds.rounds,
      });
    } else {
      await db.careerNpcStats.add({
        npcId: delta.npcRounds.npcId,
        npcName: delta.npcRounds.npcName,
        rounds: delta.npcRounds.rounds,
      });
    }
  }
  void sessionId;
  cachedCareerStats = null;

  // 成就检测（基于累计 Token 数）
  await checkAchievementUnlocks();
}

export async function getCareerStats(): Promise<CareerStats> {
  if (cachedCareerStats) {
    const stats = cachedCareerStats;
    cachedCareerStats = null;
    return stats;
  }
  if (loadingCareerStats) {
    const stats = await loadingCareerStats;
    cachedCareerStats = null;
    return stats;
  }
  return loadCareerStats();
}

export async function resetCareerStats(): Promise<void> {
  await db.careerStats.put({ id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 });
  await db.careerNpcStats.clear();
  cachedCareerStats = null;
}


/** 从消息内容剥离思考标签，用于列表预览 */
function stripThinking(content: string): string {
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/\b(?:thinking|reasoning|思考)\s*[:\-＝=][\s\S]*?(?=\n\s*(?:<\/?(?:thinking|reasoning|think)>|\S))/gi, '')
    .replace(/<\/?(?:thinking|reasoning|think)>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sessionPreviewText(content: string, maxLength = 60): string {
  const stripped = stripThinking(content).replace(/\s+/g, ' ').trim();
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + '…' : stripped;
}

// ============================================================
// 消息指标（tokens/s 估算）
// ============================================================

export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.round(chars / 3.8));
}

export function formatMetrics(m: Pick<ChatMessage, 'latencyMs' | 'tokensPerSec' | 'promptTokens' | 'completionTokens'>): string {
  const parts: string[] = [];
  if (m.latencyMs != null) parts.push(`⏱️ ${m.latencyMs}ms`);
  if (m.tokensPerSec != null) parts.push(`⚡ ${m.tokensPerSec.toFixed(1)} t/s`);
  if (m.promptTokens > 0 || m.completionTokens > 0) {
    parts.push(`📥 ${m.promptTokens}`);
    parts.push(`📤 ${m.completionTokens}`);
  }
  return parts.join(' | ');
}