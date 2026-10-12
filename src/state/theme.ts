import { create } from 'zustand';

export type ThemeMode = 'auto' | 'dark' | 'light';
export type UserId = 'rotem' | 'noa';

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  applyUser: (u: UserId | null) => void;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem('lexbites.theme');
    return v === 'dark' || v === 'light' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyThemeToDocument(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'auto') delete root.dataset.theme;
  else root.dataset.theme = mode;
  const dark =
    mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  const color = dark ? '#0f1115' : '#fbf7f0';
  if (meta) meta.setAttribute('content', color);
  else {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    m.content = color;
    document.head.appendChild(m);
  }
}

export const useTheme = create<ThemeState>((set) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      if (mode === 'auto') localStorage.removeItem('lexbites.theme');
      else localStorage.setItem('lexbites.theme', mode);
    } catch {
      // ignore storage failures
    }
    applyThemeToDocument(mode);
    set({ mode });
  },
  applyUser: (u) => {
    const root = document.documentElement;
    if (u) root.dataset.user = u;
    else delete root.dataset.user;
    try {
      if (u) localStorage.setItem('lexbites.user', u);
      else localStorage.removeItem('lexbites.user');
    } catch {
      // ignore
    }
  },
}));
