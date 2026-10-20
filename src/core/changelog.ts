import data from '../generated/changelog.json';

// ============================================================
// 版本记录（由 scripts/changelog.mjs 从 changelog/v*.md 生成）
// 条目正文不放进 i18n 字典：每发一版只改数据源，不用同步三份文案。
// ============================================================

export type ChangelogKind = 'added' | 'changed' | 'fixed' | 'internal';

export interface ChangelogGroup {
  kind: ChangelogKind;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  breaking: boolean;
  compare: string | null;
  groups: {
    'zh-CN': ChangelogGroup[];
    en: ChangelogGroup[];
  };
}

interface ChangelogData {
  latest: string | null;
  repo: string;
  entries: ChangelogEntry[];
}

export const CHANGELOG = data as unknown as ChangelogData;

/** 取当前界面语言对应的条目；繁體中文回退到简体中文（版本记录不维护第三份文案） */
export function entryGroups(entry: ChangelogEntry, language: string): ChangelogGroup[] {
  return entry.groups[language === 'en' ? 'en' : 'zh-CN'] ?? entry.groups['zh-CN'];
}

export function compareUrl(entry: ChangelogEntry): string {
  return entry.compare
    ? `${CHANGELOG.repo}/compare/${entry.compare}`
    : `${CHANGELOG.repo}/releases/tag/v${entry.version}`;
}
