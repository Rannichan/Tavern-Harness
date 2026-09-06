export type ThemeColor = 'violet' | 'blue' | 'green' | 'amber';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemePalette {
  id: ThemeColor;
  name: string;
  primary: string;
  primaryDim: string;
  accentSoft: string;
  /** 聊天栏气泡渐变端点 */
  gradientFrom: string;
  gradientTo: string;
  glow: string;
}

/** 与 MyAgent-Android 一致的 4 套主题色（低饱和度纯色，不使用渐变） */
export const PALETTES: Record<ThemeColor, ThemePalette> = {
  violet: {
    id: 'violet',
    name: '紫罗兰',
    primary: '#D0BCFF',
    primaryDim: '#7E6BC4',
    accentSoft: 'rgba(208,188,255,0.14)',
    gradientFrom: '#9b8fd8',
    gradientTo: '#9b8fd8',
    glow: 'rgba(160,132,255,0.35)',
  },
  blue: {
    id: 'blue',
    name: '苍蓝',
    primary: '#9FC1FF',
    primaryDim: '#5B7FD4',
    accentSoft: 'rgba(159,193,255,0.14)',
    gradientFrom: '#7f9ad9',
    gradientTo: '#7f9ad9',
    glow: 'rgba(110,150,255,0.35)',
  },
  green: {
    id: 'green',
    name: '翡翠森林',
    primary: '#9FE8BD',
    primaryDim: '#3F9E6F',
    accentSoft: 'rgba(159,232,189,0.13)',
    gradientFrom: '#6fbe96',
    gradientTo: '#6fbe96',
    glow: 'rgba(90,210,150,0.32)',
  },
  amber: {
    id: 'amber',
    name: '赛博琥珀',
    primary: '#FFCB8B',
    primaryDim: '#C88A3F',
    accentSoft: 'rgba(255,203,139,0.14)',
    gradientFrom: '#d9a673',
    gradientTo: '#d9a673',
    glow: 'rgba(255,170,90,0.35)',
  },
};

export function isDarkMode(mode: ThemeMode): boolean {
  if (mode === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return mode === 'dark';
}

/** 应用主题 CSS 变量到 :root */
export function applyTheme(mode: ThemeMode, color: ThemeColor): void {
  const dark = isDarkMode(mode);
  const p = PALETTES[color];
  const root = document.documentElement;
  const is = (light: string, darkV: string) => (dark ? darkV : light);

  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.color = color;

  const vars: Record<string, string> = {
    '--primary': p.primary,
    '--primary-dim': p.primaryDim,
    '--primary-soft': p.accentSoft,
    '--grad-from': p.gradientFrom,
    '--grad-to': p.gradientTo,
    '--glow': p.glow,

    '--bg': is('#FAF9FC', '#14121c'),
    '--bg-deep': is('#f2f0f8', '#0e0c15'),
    '--surface': is('#ffffff', '#1c1a26'),
    '--surface-2': is('#f3f1f9', '#242230'),
    '--surface-3': is('#ece9f5', '#2b2930'),
    '--border': is('rgba(30,20,60,0.10)', 'rgba(255,255,255,0.09)'),
    '--border-soft': is('rgba(30,20,60,0.06)', 'rgba(255,255,255,0.05)'),

    '--text': is('#1c1728', '#eceaf2'),
    '--text-dim': is('#6f6a80', '#9d97ad'),
    '--text-faint': is('#a09aac', '#6d6879'),

    '--bubble-user': is('#efeaff', 'rgba(124,104,214,0.20)'),
    '--bubble-border-user': is('rgba(110,80,220,0.25)', 'rgba(208,188,255,0.16)'),
    '--bubble-npc': is('#ffffff', '#1f1d29'),
    '--bubble-border': is('rgba(30,20,60,0.09)', 'rgba(255,255,255,0.07)'),

    '--code-bg': is('#f6f4fb', '#1e1c29'),
    '--code-bg-inline': is('#efeaf8', '#2a2737'),
    '--tag-bg': is('#efe9ff', 'rgba(160,132,255,0.14)'),
    '--tag-text': is('#6f55c8', '#c9b8ff'),

    '--danger': is('#c62828', '#ff8f8f'),
    '--danger-soft': is('rgba(198,40,40,0.08)', 'rgba(255,143,143,0.12)'),
    '--success': is('#2e7d32', '#8fe0a8'),
    '--success-soft': is('rgba(46,125,50,0.08)', 'rgba(143,224,168,0.12)'),
    '--warn': is('#b26a00', '#ffc46b'),
    '--warn-soft': is('rgba(178,106,0,0.08)', 'rgba(255,196,107,0.12)'),

    '--shadow': is('0 2px 18px rgba(40,20,90,0.08)', '0 4px 24px rgba(0,0,0,0.45)'),
    '--shadow-lg': is('0 12px 40px rgba(40,20,90,0.16)', '0 16px 60px rgba(0,0,0,0.6)'),
  };

  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

  // 暗色主题下的琥珀/绿/蓝回退到中性背景（与 App 行为一致：只有 violet 有专属暗色背景）
  if (dark) {
    const bgByColor: Record<string, string> = {
      blue: '#0F1524',
      green: '#0D1610',
      amber: '#1B140E',
    };
    root.style.setProperty('--bg', bgByColor[color] ?? '#14121c');
    root.style.setProperty('--surface', '#1c1f2b');
  }
}