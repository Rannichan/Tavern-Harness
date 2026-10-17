import type { AppLanguage, ThemeModeId } from '../types/models';

const BROWSER_UI_PREFERENCES_KEY = 'th-browser-ui-preferences';

export interface BrowserUiPreferences {
  language: AppLanguage;
  themeMode: ThemeModeId;
}

const DEFAULT_BROWSER_UI_PREFERENCES: BrowserUiPreferences = {
  language: null,
  themeMode: 'system',
};

export function hasBrowserUiPreferences(): boolean {
  try {
    return localStorage.getItem(BROWSER_UI_PREFERENCES_KEY) != null;
  } catch {
    return false;
  }
}

export function readBrowserUiPreferences(): BrowserUiPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BROWSER_UI_PREFERENCES_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return DEFAULT_BROWSER_UI_PREFERENCES;
    const value = parsed as Partial<BrowserUiPreferences>;
    return {
      language: value.language === 'zh-CN' || value.language === 'zh-TW' || value.language === 'en' ? value.language : null,
      themeMode: value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system' ? value.themeMode : 'system',
    };
  } catch {
    return DEFAULT_BROWSER_UI_PREFERENCES;
  }
}

export function saveBrowserUiPreferences(preferences: Partial<BrowserUiPreferences>): BrowserUiPreferences {
  const next = { ...readBrowserUiPreferences(), ...preferences };
  try {
    localStorage.setItem(BROWSER_UI_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Private browsing and blocked storage keep the current-page preference only.
  }
  return next;
}
