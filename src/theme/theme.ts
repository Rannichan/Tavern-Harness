export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemePalette {
  /** 深色模式主色（烛光发光色，浅亮） */
  primary: string;
  /** 浅色模式主色（在羊皮纸背景上有足够对比的深色变体） */
  primaryLight: string;
  primaryDim: string;
  accentSoft: string;
  /** 聊天栏气泡渐变端点 */
  gradientFrom: string;
  gradientTo: string;
  glow: string;
}

/** 固定主题色：赛博琥珀（与 MyAgent-Android 温暖烛光一致） */
export const AMBER_PALETTE: ThemePalette = {
  primary: '#FFCB8B',
  primaryLight: '#9A5B17',
  primaryDim: '#C88A3F',
  accentSoft: 'rgba(255,203,139,0.16)',
  gradientFrom: '#d9a673',
  gradientTo: '#d9a673',
  glow: 'rgba(255,178,96,0.34)',
};

export function isDarkMode(mode: ThemeMode): boolean {
  if (mode === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return mode === 'dark';
}

let themeWatcherInstalled = false;

/** 监听系统深浅色切换，模式为「跟随系统」时自动重新应用主题 */
export function watchSystemTheme(onChange: () => void): void {
  if (themeWatcherInstalled || typeof window === 'undefined') return;
  themeWatcherInstalled = true;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => onChange();
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', listener);
  } else {
    // 旧版 Safari 回退
    (mq as unknown as { addListener: (fn: () => void) => void }).addListener(listener);
  }
}

/** 应用主题 CSS 变量到 :root（固定使用琥珀色主题） */
export function applyTheme(mode: ThemeMode): void {
  const dark = isDarkMode(mode);
  const p = AMBER_PALETTE;
  const root = document.documentElement;
  const is = (light: string, darkV: string) => (dark ? darkV : light);

  root.dataset.theme = dark ? 'dark' : 'light';

  const vars: Record<string, string> = {
    // 主色：浅色模式用深色变体（羊皮纸底上对比足够），深色模式用烛光浅亮色
    '--primary': is(p.primaryLight, p.primary),
    '--primary-dim': is(p.primaryLight, p.primaryDim),
    '--primary-soft': dark ? p.accentSoft : 'color-mix(in srgb, var(--primary) 12%, transparent)',
    '--grad-from': is(p.primaryLight, p.gradientFrom),
    '--grad-to': is(p.primaryLight, p.gradientTo),
    '--glow': is('color-mix(in srgb, var(--primary) 28%, transparent)', p.glow),

    '--bg': is('#F7F2E9', '#17120A'),
    '--bg-deep': is('#efe8da', '#0f0b06'),
    '--surface': is('#FDFBF5', '#211A10'),
    '--surface-2': is('#efe8da', '#2B2215'),
    '--surface-3': is('#e6ddca', '#362A1A'),
    '--border': is('rgba(60,40,10,0.14)', 'rgba(255,214,160,0.13)'),
    '--border-soft': is('rgba(60,40,10,0.08)', 'rgba(255,214,160,0.07)'),

    '--text': is('#241c10', '#F2EADC'),
    '--text-dim': is('#7a6a50', '#AA9C86'),
    '--text-faint': is('#a3957c', '#6f6352'),

    '--bubble-user': is('color-mix(in srgb, var(--primary) 11%, transparent)', 'color-mix(in srgb, var(--primary) 13%, transparent)'),
    '--bubble-border-user': is('color-mix(in srgb, var(--primary) 24%, transparent)', 'color-mix(in srgb, var(--primary) 22%, transparent)'),
    '--bubble-npc': is('#FDFBF5', '#241C12'),
    '--bubble-border': is('rgba(60,40,10,0.12)', 'rgba(255,214,160,0.10)'),

    '--code-bg': is('#ece4d2', '#282015'),
    '--code-bg-inline': is('#e6dcc6', '#382C1B'),
    '--tag-bg': is('color-mix(in srgb, var(--primary) 11%, transparent)', 'color-mix(in srgb, var(--primary) 13%, transparent)'),
    '--tag-text': is('var(--primary)', 'color-mix(in srgb, var(--primary) 78%, #e8cfa0)'),

    '--danger': is('#a3382c', '#ff9b8f'),
    '--danger-soft': is('rgba(163,56,44,0.09)', 'rgba(255,155,143,0.12)'),
    '--success': is('#2f6b45', '#92d9a8'),
    '--success-soft': is('rgba(47,107,69,0.09)', 'rgba(146,217,168,0.12)'),
    '--warn': is('#9a6416', '#ffc46b'),
    '--warn-soft': is('rgba(154,100,22,0.10)', 'rgba(255,196,107,0.12)'),

    '--shadow': is('0 1px 2px rgba(60,40,10,0.05), 0 4px 16px rgba(60,40,10,0.10)', '0 2px 10px rgba(0,0,0,0.35), 0 8px 30px rgba(0,0,0,0.45)'),
    '--shadow-lg': is('0 2px 4px rgba(60,40,10,0.06), 0 16px 44px rgba(60,40,10,0.16)', '0 8px 24px rgba(0,0,0,0.5), 0 24px 70px rgba(0,0,0,0.65)'),
  };

  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

  // 琥珀主题的暗色背景（暖木色）
  if (dark) {
    root.style.setProperty('--bg', '#20160E');
    root.style.setProperty('--surface', '#211A10');
  }
}
