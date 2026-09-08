export type ThemeColor = 'violet' | 'blue' | 'green' | 'amber';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemePalette {
  id: ThemeColor;
  name: string;
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

/** 与 MyAgent-Android 一致的 4 套主题色——为适配暖核桃木夜色，色相整体向暖偏移：
    主色 → 红葡萄酒（本主题）、烛光湖蓝（青调）、苔藓绿、赛博琥珀保留为烛光色 */
export const PALETTES: Record<ThemeColor, ThemePalette> = {
  // 红葡萄酒：深玫瑰红至砖红，压在核桃木夜色上有温暖的"陈酿"感
  violet: {
    id: 'violet',
    name: '红葡萄酒',
    primary: '#F0B8B2',
    primaryLight: '#A13D3D',
    primaryDim: '#B06A63',
    accentSoft: 'rgba(240,184,178,0.15)',
    gradientFrom: '#C27063',
    gradientTo: '#C27063',
    glow: 'rgba(226,120,110,0.32)',
  },
  blue: {
    id: 'blue',
    name: '苍蓝',
    primary: '#9CCDE0',
    primaryLight: '#2A6E8A',
    primaryDim: '#4E87A6',
    accentSoft: 'rgba(156,205,224,0.15)',
    gradientFrom: '#6f9fb8',
    gradientTo: '#6f9fb8',
    glow: 'rgba(130,190,215,0.28)',
  },
  green: {
    id: 'green',
    name: '翡翠森林',
    primary: '#A4DCA0',
    primaryLight: '#2F7D46',
    primaryDim: '#4C9666',
    accentSoft: 'rgba(164,220,160,0.14)',
    gradientFrom: '#6fae80',
    gradientTo: '#6fae80',
    glow: 'rgba(142,200,122,0.26)',
  },
  amber: {
    id: 'amber',
    name: '赛博琥珀',
    primary: '#FFCB8B',
    primaryLight: '#9A5B17',
    primaryDim: '#C88A3F',
    accentSoft: 'rgba(255,203,139,0.16)',
    gradientFrom: '#d9a673',
    gradientTo: '#d9a673',
    glow: 'rgba(255,178,96,0.34)',
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

  // 暗色主题下的琥珀/绿/蓝回退到不同冷暖的中性背景（与 App 行为一致：只有 violet 有专属暗色背景）
  if (dark) {
    const bgByColor: Record<string, string> = {
      blue: '#0E191C',
      green: '#0F1B12',
      amber: '#20160E',
    };
    root.style.setProperty('--bg', bgByColor[color] ?? '#17120A');
    root.style.setProperty('--surface', '#211A10');
  }
}