import { useSyncExternalStore } from 'react';

// ============================================================
// 版本号与「版本记录已读」状态
// - APP_VERSION 由 vite.config.ts 的 define 从 package.json 注入，
//   运行期不读文件、不请求 npm registry。
// ============================================================

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const STORAGE_KEY = 'tavern-harness:last-seen-version';
const listeners = new Set<() => void>();

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隐私模式 / 禁用存储时当作未读处理，只是多一个提示点
    return null;
  }
}

export function hasUnseenVersion(): boolean {
  return readLastSeen() !== APP_VERSION;
}

export function markVersionSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, APP_VERSION);
  } catch {
    /* 写入失败不影响使用 */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前版本是否有尚未查看的版本记录（设置入口的小圆点） */
export function useHasUnseenVersion(): boolean {
  return useSyncExternalStore(subscribe, hasUnseenVersion, () => false);
}
