import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';

interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  update: () => Promise<void>;
  dismiss: () => void;
}

let updateFn: ((reload?: boolean) => Promise<void>) | null = null;

export const usePwa = create<PwaState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  update: async () => {
    if (updateFn) await updateFn(true);
  },
  dismiss: () => set({ needRefresh: false, offlineReady: false }),
}));

export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  updateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwa.setState({ needRefresh: true });
    },
    onOfflineReady() {
      usePwa.setState({ offlineReady: true });
      setTimeout(() => usePwa.setState({ offlineReady: false }), 4000);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Check for updates whenever the app regains focus (every open on iOS standalone).
      const check = () => registration.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    },
  });
}
