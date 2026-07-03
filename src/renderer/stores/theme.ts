import { create } from 'zustand';

export type ThemePreset = 'dark' | 'light' | 'dark-hc' | 'light-warm' | 'custom';

export type ThemeArea = 'global' | 'editor' | 'terminal' | 'sidebar' | 'chat' | 'agentPanel';

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  border: string;
  chatUser: string;
  chatAi: string;
  chatText: string;  // 气泡内文字色，独立于全局 --text-primary，方便只改气泡背景时配套
}

const PRESET_COLORS: Record<Exclude<ThemePreset, 'custom'>, ThemeColors> = {
  dark:      { bgPrimary: '#1e1e2e', bgSecondary: '#252536', bgTertiary: '#2d2d44', textPrimary: '#e0e0e0', textSecondary: '#8888a0', accent: '#7c3aed', border: '#3a3a50', chatUser: 'rgba(124,58,237,0.1)', chatAi: '#2d2d44', chatText: '#e0e0e0' },
  light:     { bgPrimary: '#ffffff', bgSecondary: '#f5f5f5', bgTertiary: '#ebebeb', textPrimary: '#1e1e1e', textSecondary: '#666666', accent: '#7c3aed', border: '#d4d4d4', chatUser: '#ede9fe',       chatAi: '#f3f4f6', chatText: '#1e1e1e' },
  'dark-hc': { bgPrimary: '#000000', bgSecondary: '#0d0d0d', bgTertiary: '#1a1a1a', textPrimary: '#ffffff', textSecondary: '#aaaaaa', accent: '#a78bfa', border: '#444444', chatUser: 'rgba(167,139,250,0.12)', chatAi: '#1a1a1a', chatText: '#ffffff' },
  'light-warm': { bgPrimary: '#fefdf9', bgSecondary: '#f5f0e8', bgTertiary: '#ede4d3', textPrimary: '#3d3522', textSecondary: '#8b7e65', accent: '#7c3aed', border: '#d4c9b0', chatUser: 'rgba(124,58,237,0.08)', chatAi: '#f5f0e8', chatText: '#3d3522' },
};

interface ThemeState {
  globalPreset: ThemePreset;
  globalCustom: ThemeColors;
  areas: Partial<Record<ThemeArea, { preset: ThemePreset; custom: ThemeColors }>>;
  setGlobalPreset: (p: ThemePreset) => void;
  setGlobalCustom: (c: ThemeColors) => void;
  loadTheme: () => Promise<void>;
  setAreaPreset: (area: ThemeArea, p: ThemePreset) => void;
  setAreaCustom: (area: ThemeArea, c: ThemeColors) => void;
  resetArea: (area: ThemeArea) => void;
  getAreaColors: (area: ThemeArea) => ThemeColors;
}

function applyColors(element: HTMLElement | null, colors: ThemeColors, area: ThemeArea) {
  if (!element) return;
  const map: Record<keyof ThemeColors, string> = {
    bgPrimary: '--bg-primary', bgSecondary: '--bg-secondary', bgTertiary: '--bg-tertiary',
    textPrimary: '--text-primary', textSecondary: '--text-secondary',
    accent: '--accent', border: '--border',
    chatUser: '--chat-user', chatAi: '--chat-ai', chatText: '--chat-text',
  };
  const keys = Object.keys(map) as Array<keyof ThemeColors>;
  for (const k of keys) {
    element.style.setProperty(map[k], colors[k]);
  }
}

function clearColors(element: HTMLElement | null, area: ThemeArea) {
  if (!element) return;
  const map: Record<keyof ThemeColors, string> = {
    bgPrimary: '--bg-primary', bgSecondary: '--bg-secondary', bgTertiary: '--bg-tertiary',
    textPrimary: '--text-primary', textSecondary: '--text-secondary',
    accent: '--accent', border: '--border',
    chatUser: '--chat-user', chatAi: '--chat-ai', chatText: '--chat-text',
  };
  const keys = Object.keys(map) as Array<keyof ThemeColors>;
  for (const k of keys) {
    element.style.removeProperty(map[k]);
  }
}

const SETTINGS_KEY = 'theme';
const LOCAL_KEY = 'ohmydeepseek_theme';

function readLocal(): { globalPreset: ThemePreset; globalCustom: ThemeColors } | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function writeLocal(preset: ThemePreset, custom: ThemeColors) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ globalPreset: preset, globalCustom: custom }));
  } catch {}
}

function applyPreset(preset: ThemePreset, custom: ThemeColors) {
  document.documentElement.setAttribute('data-theme', preset === 'custom' ? 'dark' : preset);
  if (preset === 'custom') {
    applyColors(document.documentElement, custom, 'global');
  } else {
    applyColors(document.documentElement, PRESET_COLORS[preset], 'global');
  }
}

// 同步加载 localStorage 中的主题，避免启动闪烁
const local = readLocal();

export const useThemeStore = create<ThemeState>((set, get) => ({
  globalPreset: local?.globalPreset ?? 'light',
  globalCustom: local?.globalCustom ?? { ...PRESET_COLORS.dark },
  areas: {},

  setGlobalPreset: (p) => {
    applyPreset(p, get().globalCustom);
    set({ globalPreset: p });
    writeLocal(p, get().globalCustom);
    window.api.settings.set(SETTINGS_KEY, JSON.stringify({ globalPreset: p, globalCustom: get().globalCustom })).catch(() => {});
  },

  setGlobalCustom: (c) => {
    applyColors(document.documentElement, c, 'global');
    set({ globalCustom: c });
    writeLocal(get().globalPreset, c);
    window.api.settings.set(SETTINGS_KEY, JSON.stringify({ globalPreset: get().globalPreset, globalCustom: c })).catch(() => {});
  },

  loadTheme: async () => {
    // 从 main process 加载并覆盖 localStorage（主进程数据优先级更高）
    try {
      const raw = await window.api.settings.get(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.globalPreset) {
          const p = saved.globalPreset as ThemePreset;
          const c = (saved.globalCustom && saved.globalPreset === 'custom') ? saved.globalCustom : get().globalCustom;
          applyPreset(p, c);
          writeLocal(p, c);
          set({ globalPreset: p, globalCustom: c });
        }
      }
    } catch {}
  },

  setAreaPreset: (area, p) => {
    const el = document.querySelector(`[data-area="${area}"]`) as HTMLElement | null;
    if (!el) return;
    clearColors(el, area);
    el.removeAttribute('data-theme');
    if (p !== get().globalPreset) {
      if (p === 'custom') {
        const prev = get().areas[area];
        if (prev?.custom) applyColors(el, prev.custom, area);
      } else {
        el.setAttribute('data-theme', p);
      }
    }
    set(s => ({ areas: { ...s.areas, [area]: { ...s.areas[area], preset: p } } }));
  },

  setAreaCustom: (area, c) => {
    const el = document.querySelector(`[data-area="${area}"]`) as HTMLElement | null;
    if (!el) return;
    el.removeAttribute('data-theme');
    applyColors(el, c, area);
    set(s => ({ areas: { ...s.areas, [area]: { ...s.areas[area], custom: c } } }));
  },

  resetArea: (area) => {
    const el = document.querySelector(`[data-area="${area}"]`) as HTMLElement | null;
    if (el) {
      clearColors(el, area);
      el.removeAttribute('data-theme');
    }
    set(s => {
      const a = { ...s.areas };
      delete a[area];
      return { areas: a };
    });
  },

  getAreaColors: (area) => {
    const s = get();
    const a = s.areas[area];
    if (a?.preset === 'custom' && a.custom) return a.custom;
    if (a?.preset && a.preset !== 'custom') return PRESET_COLORS[a.preset];
    if (s.globalPreset === 'custom') return s.globalCustom;
    return PRESET_COLORS[s.globalPreset];
  },
}));

// 立即应用初始主题（从 localStorage 同步读取，避免启动闪烁）
{
  const { globalPreset, globalCustom } = useThemeStore.getState();
  applyPreset(globalPreset, globalCustom);
}
