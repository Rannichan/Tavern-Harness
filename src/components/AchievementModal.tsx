import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AchievementDef } from '../core/achievements';
import { useT, currentLocale } from '../core/i18n';

// ============================================================
// 成就解锁庆祝弹窗（奖杯 + 撒花）
// 全局单例：core 层解锁成就时通过 showAchievementUnlock 触发
// ============================================================

interface QueueItem {
  id: number;
  ach: AchievementDef;
  total: number;
}

let seq = 0;
let currentItem: QueueItem | null = null;
const pendingQueue: QueueItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

/** 展示成就解锁弹窗（core 层调用；同一时刻只展示一个，其余排队） */
export function showAchievementUnlock(ach: AchievementDef, total: number): void {
  const item: QueueItem = { id: ++seq, ach, total };
  if (currentItem) {
    pendingQueue.push(item);
    return;
  }
  currentItem = item;
  notify();
}

function next(): void {
  currentItem = pendingQueue.shift() ?? null;
  notify();
}

const CONFETTI_COLORS = ['#ff5e7d', '#ffb84d', '#53d769', '#42a5f5', '#c56cf0', '#ffd166', '#7f9ad9'];

interface ConfettiPiece {
  id: number;
  left: number; // vw
  delay: number; // s
  duration: number; // s
  size: number; // px
  color: string;
  rotate: number;
  drift: number;
  round: boolean;
}

function makeConfetti(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.9 + 0.35,
    duration: 2.6 + Math.random() * 1.8,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 120,
    round: Math.random() < 0.3,
  }));
}

function AchievementCelebration() {
  const [, force] = useState(0);
  useEffect(() => {
    listeners.add(() => force((n) => n + 1));
    return () => {
      listeners.delete(() => force((n) => n + 1));
    };
  }, []);

  return currentItem ? <CelebrationOverlay key={currentItem.id} item={currentItem} /> : null;
}

function CelebrationOverlay({ item }: { item: QueueItem }) {
  const t = useT();
  const confetti = useMemo(() => makeConfetti(90), [item.id]);
  const [leaving, setLeaving] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const dismiss = (queueNext = true) => {
    setLeaving(true);
    window.setTimeout(() => {
      if (queueNext) {
        next();
      } else {
        // 关闭整个展示链（清空队列）
        pendingQueue.length = 0;
        currentItem = null;
        next();
      }
    }, 260);
  };

  useEffect(() => {
    closeTimer.current = window.setTimeout(() => dismiss(true), 5800);
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, [item.id]);

  const fmt = (n: number) => n.toLocaleString(currentLocale());

  return createPortal(
    <>
      <div className="ach-overlay" onClick={() => dismiss(true)} />
      <div className="ach-celebration">
        <div className={`ach-rain ${leaving ? 'leave' : ''}`}>
          {confetti.map((c) => (
            <i
              key={c.id}
              className={c.round ? 'round' : ''}
              style={{
                left: `${c.left}vw`,
                width: c.size,
                height: c.round ? c.size : c.size * 1.45,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
                ['--drift' as string]: `${c.drift}px`,
                ['--rot' as string]: `${c.rotate}deg`,
              }}
            />
          ))}
        </div>
        <div className={`ach-trophy ${leaving ? 'leave' : ''}`}>
          <div className="ach-trophy-badge">{item.ach.icon}</div>
          <div className="ach-trophy-glow" />
        </div>
        <div className={`ach-caption ${leaving ? 'leave' : ''}`}>
          <div className="ach-caption-title">{t('achModal.title')}</div>
          <div className="ach-caption-name">{t(`ach.${item.ach.id}.name`)}</div>
          <div className="ach-caption-desc">
            {t(`ach.${item.ach.id}.desc`)}
            <br />
            <span className="ach-caption-total">{t('achModal.total', { n: fmt(item.total) })}</span>
          </div>
          <button className="btn btn-sm" onClick={() => dismiss(true)}>
            {t('achModal.accept')}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

export function AchievementModal() {
  return <AchievementCelebration />;
}