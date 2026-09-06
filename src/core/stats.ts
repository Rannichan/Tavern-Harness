import { db } from '../db/database';
import type { ChatMessage } from '../types/models';
import { saveJsonFile, type SaveResult } from './fileDownload';

// ============================================================
// 生涯统计（append-only）与工具函数
// ============================================================

export interface StatsDelta {
  inputTokens: number;
  outputTokens: number;
  rounds: number;
  npcRounds?: { npcId: number; npcName: string; rounds: number };
}

/** 消息产生后累计到生涯统计（服务器关闭也不丢失：已持久化消息带 usage） */
export async function accumulateStats(delta: StatsDelta, sessionId: number | null, npcId: number | null): Promise<void> {
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
}

export async function getCareerStats() {
  const stats = (await db.careerStats.get(1)) ?? { id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 };
  const npcStats = await db.careerNpcStats.toArray();
  const sessions = await db.sessions.count();
  return { ...stats, npcStats, sessionCount: sessions };
}

export async function resetCareerStats(): Promise<void> {
  await db.careerStats.put({ id: 1, inputTokens: 0, outputTokens: 0, totalRounds: 0 });
  await db.careerNpcStats.clear();
}

// ============================================================
// 会话预览与导出
// ============================================================

/** 从消息内容剥离思考标签，用于列表预览 */
export function stripThinking(content: string): string {
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

/** 另存会话为 JSON 文件（弹出保存对话框，支持选择位置与文件名） */
export async function exportSessionJson(sessionId: number, suggestedName?: string): Promise<SaveResult> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('会话不存在');
  const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('timestamp');
  const mapped = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const payload = {
    sessionId,
    sessionTitle: session.title,
    mode: session.mode,
    exportedAt: Date.now(),
    messages: mapped,
  };
  return saveJsonFile(payload, suggestedName ?? `session-${sessionId}-${Date.now()}.json`);
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