import type { ThemePaletteId } from '../types/models';

export type ThemeMode = 'system' | 'light' | 'dark';
export type { ThemePaletteId } from '../types/models';

interface ThemePalette {
  primary: string;
  primaryLight: string;
  primaryDim: string;
  accentSoft: string;
  gradientFrom: string;
  gradientTo: string;
  glow: string;
  lightBg: string;
  lightBgDeep: string;
  lightSurface: string;
  lightSurface2: string;
  lightSurface3: string;
  darkBg: string;
  darkBgDeep: string;
  darkSurface: string;
  darkSurface2: string;
  darkSurface3: string;
}

const PALETTES: Record<ThemePaletteId, ThemePalette> = {
  amber: {
    primary: '#FFCB8B', primaryLight: '#9A5B17', primaryDim: '#C88A3F', accentSoft: 'rgba(255,203,139,0.16)',
    gradientFrom: '#d9a673', gradientTo: '#d9a673', glow: 'rgba(255,178,96,0.34)',
    lightBg: '#F7F0E4', lightBgDeep: '#E9DDCA', lightSurface: '#FFFDF8', lightSurface2: '#F3E7D5', lightSurface3: '#DFCFB8',
    darkBg: '#20160E', darkBgDeep: '#0f0b06', darkSurface: '#211A10', darkSurface2: '#2B2215', darkSurface3: '#362A1A',
  },
  jade: {
    primary: '#8EDDB8', primaryLight: '#217052', primaryDim: '#55A982', accentSoft: 'rgba(142,221,184,0.16)',
    gradientFrom: '#68C49A', gradientTo: '#9BD6B9', glow: 'rgba(75,205,145,0.30)',
    lightBg: '#F2F4F3', lightBgDeep: '#DDE1DF', lightSurface: '#FFFFFF', lightSurface2: '#E9ECEA', lightSurface3: '#D3D8D5',
    darkBg: '#151918', darkBgDeep: '#0B0E0D', darkSurface: '#1D2220', darkSurface2: '#282E2B', darkSurface3: '#353C38',
  },
  rose: {
    primary: '#F2A6B8', primaryLight: '#9B405A', primaryDim: '#C97088', accentSoft: 'rgba(242,166,184,0.16)',
    gradientFrom: '#DF8FA7', gradientTo: '#F0B0A4', glow: 'rgba(235,123,157,0.30)',
    lightBg: '#F8EFF1', lightBgDeep: '#EBD9DE', lightSurface: '#FFFCFD', lightSurface2: '#F4E4E8', lightSurface3: '#E2CAD1',
    darkBg: '#201216', darkBgDeep: '#12090C', darkSurface: '#29191E', darkSurface2: '#362128', darkSurface3: '#452B34',
  },
  indigo: {
    primary: '#AEBBFF', primaryLight: '#4D5FA8', primaryDim: '#7889D5', accentSoft: 'rgba(174,187,255,0.16)',
    gradientFrom: '#899CF0', gradientTo: '#B39DEB', glow: 'rgba(123,145,255,0.32)',
    lightBg: '#F0F1F8', lightBgDeep: '#DCDFF0', lightSurface: '#FDFDFF', lightSurface2: '#E7E9F5', lightSurface3: '#CDD1E5',
    darkBg: '#111522', darkBgDeep: '#090B13', darkSurface: '#191E2D', darkSurface2: '#22283B', darkSurface3: '#2D354D',
  },
};

function isDarkMode(mode: ThemeMode): boolean {
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

const THEME_CACHE_KEY = 'tav-theme-mode';
const THEME_PALETTE_CACHE_KEY = 'tav-theme-palette';

export function cacheTheme(mode: ThemeMode, palette: ThemePaletteId): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode);
    localStorage.setItem(THEME_PALETTE_CACHE_KEY, palette);
  } catch {
    // 隐私模式等环境下忽略
  }
}

function cachedThemeMode(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_CACHE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : null;
  } catch {
    return null;
  }
}

function cachedThemePalette(): ThemePaletteId {
  try {
    const v = localStorage.getItem(THEME_PALETTE_CACHE_KEY);
    return v === 'jade' || v === 'rose' || v === 'indigo' ? v : 'amber';
  } catch {
    return 'amber';
  }
}

export function applyTheme(mode: ThemeMode, palette: ThemePaletteId = 'amber'): void {
  const dark = isDarkMode(mode);
  const p = PALETTES[palette];
  const root = document.documentElement;
  const is = (light: string, darkV: string) => (dark ? darkV : light);
  const lightText = palette === 'amber' ? '#30251C' : palette === 'jade' ? '#26312D' : palette === 'rose' ? '#38262C' : '#252A3D';
  const lightTextDim = palette === 'amber' ? '#66574A' : palette === 'jade' ? '#5B6661' : palette === 'rose' ? '#705761' : '#5B6178';
  const bubbleUser = palette === 'jade'
    ? is('color-mix(in srgb, var(--primary) 10%, #D8DDDA)', 'color-mix(in srgb, var(--primary) 12%, #3A403D)')
    : 'color-mix(in srgb, var(--primary) 20%, transparent)';
  const bubbleNpc = palette === 'jade'
    ? is('#FFFFFF', '#202624')
    : is('color-mix(in srgb, var(--primary) 4%, var(--surface))', 'color-mix(in srgb, var(--primary) 7%, var(--surface))');
  const bubbleBorder = palette === 'jade'
    ? is('color-mix(in srgb, var(--primary) 10%, #B8C0BC)', 'color-mix(in srgb, var(--primary) 13%, #59615D)')
    : is('color-mix(in srgb, var(--primary) 14%, var(--border))', 'color-mix(in srgb, var(--primary) 18%, var(--border))');

  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.palette = palette;
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.backgroundColor = dark ? p.darkBg : p.lightBg;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    dark ? p.darkBg : p.lightBg,
  );

  const vars: Record<string, string> = {
    // 主色：浅色模式用深色变体（羊皮纸底上对比足够），深色模式用烛光浅亮色
    '--primary': is(p.primaryLight, p.primary),
    '--primary-dim': is(p.primaryLight, p.primaryDim),
    '--primary-soft': dark ? p.accentSoft : 'color-mix(in srgb, var(--primary) 12%, transparent)',
    '--grad-from': is(p.primaryLight, p.gradientFrom),
    '--grad-to': is(p.primaryLight, p.gradientTo),
    '--glow': is('color-mix(in srgb, var(--primary) 28%, transparent)', p.glow),

    '--bg': is(p.lightBg, p.darkBg),
    '--bg-deep': is(p.lightBgDeep, p.darkBgDeep),
    '--surface': is(p.lightSurface, p.darkSurface),
    '--surface-2': is(p.lightSurface2, p.darkSurface2),
    '--surface-3': is(p.lightSurface3, p.darkSurface3),
    '--border': is('rgba(60,40,10,0.14)', 'rgba(255,214,160,0.13)'),
    '--border-soft': is('rgba(60,40,10,0.08)', 'rgba(255,214,160,0.07)'),

    '--text': is(lightText, '#F1F0EC'),
    '--text-dim': is(lightTextDim, '#AAA8A2'),
    '--text-faint': is(`color-mix(in srgb, ${lightTextDim} 76%, transparent)`, '#74736F'),

    // 翡翠配色中，普通消息使用白/灰中性色，绿色仅保留为强调色，
    // 避免与成功状态的功能绿混淆。
    '--bubble-user': bubbleUser,
    '--bubble-border-user': palette === 'jade'
      ? is('color-mix(in srgb, var(--primary) 18%, #A9B1AD)', 'color-mix(in srgb, var(--primary) 20%, #68706C)')
      : is('color-mix(in srgb, var(--primary) 34%, transparent)', 'color-mix(in srgb, var(--primary) 30%, transparent)'),
    '--bubble-npc': bubbleNpc,
    '--bubble-border': bubbleBorder,

    // 思考过程：暖紫。借头像色板里的 #A98DB5，浅色模式下压深以保证
    // 12.5px 小字可读，深色模式下提亮。紫色是唯一没被语义占用的色相
    //（琥珀=用户 / 绿=成功 / 红=失败），和用户气泡区分度最大。
    '--think': is('#7A5E8C', '#C6A9D6'),

    '--code-bg': is(
      'color-mix(in srgb, var(--primary) 5%, var(--surface-2))',
      'color-mix(in srgb, var(--primary) 7%, var(--surface-2))',
    ),
    '--code-bg-inline': is(
      'color-mix(in srgb, var(--primary) 8%, var(--surface-3))',
      'color-mix(in srgb, var(--primary) 11%, var(--surface-3))',
    ),
    '--code-keyword': 'var(--primary)',
    '--code-string': 'color-mix(in srgb, var(--success) 82%, var(--text))',
    '--code-number': 'color-mix(in srgb, var(--primary) 62%, var(--think))',
    '--code-type': 'color-mix(in srgb, var(--primary) 48%, var(--text))',
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
    '--shadow-shell': is('0 1px 3px rgba(60,40,10,0.10), 0 3px 7px -2px rgba(60,40,10,0.14)', '0 1px 3px rgba(0,0,0,0.38), 0 3px 7px -2px rgba(0,0,0,0.48)'),
  };

  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

/** 首帧同步应用主题（无缓存时按系统偏好），避免刷新出现主题闪动 */
export function applyThemeFromCache(): void {
  const cached = cachedThemeMode();
  const mode: ThemeMode =
    cached ??
    (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  applyTheme(mode, cachedThemePalette());
}
