import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';
import { applyUpdate } from './update';

interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  update: () => Promise<void>;
  dismiss: () => void;
}

let registration: ServiceWorkerRegistration | undefined;

export const usePwa = create<PwaState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  update: async () => {
    set({ needRefresh: false });
    await applyUpdate(registration);
  },
  dismiss: () => set({ needRefresh: false, offlineReady: false }),
}));

export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwa.setState({ needRefresh: true });
    },
    onOfflineReady() {
      usePwa.setState({ offlineReady: true });
      setTimeout(() => usePwa.setState({ offlineReady: false }), 4000);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration = reg;
      // Check for updates whenever the app regains focus (every open on iOS standalone).
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    },
  });
}
