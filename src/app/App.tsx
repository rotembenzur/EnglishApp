import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from '@/ui/Shell';
import { setupServiceWorker } from '@/pwa/registerSW';
import { applyThemeToDocument, useTheme } from '@/state/theme';
import { useApp } from '@/state/app';
import { audioHidden, loadVoices, resumeAudio, unlockAudio } from '@/audio/speech';
import { loadRecordings, syncWordPacks } from '@/audio/recordings';
import { loadInventory } from '@/content/inventory';
import { startSyncLoop, syncNow } from '@/sync/engine';
import { refreshPush } from '@/sync/push';
import { setPresence } from '@/data/repo';
import { schedulePrefetch } from '@/session/prefetch';
import { scheduleWeeklyOptimize } from '@/session/optimize';
import { Toasts } from '@/ui/kit';
import { Announcements } from '@/ui/Announcements';
import { ProfilePicker } from '@/screens/ProfilePicker';
import { PinPad } from '@/screens/PinGate';
import { Home } from '@/screens/Home';

const Placement = lazy(() => import('@/screens/Placement').then((m) => ({ default: m.Placement })));
const Session = lazy(() => import('@/screens/Session').then((m) => ({ default: m.Session })));
const LearnHub = lazy(() => import('@/screens/LearnHub').then((m) => ({ default: m.LearnHub })));
const Library = lazy(() => import('@/screens/Library').then((m) => ({ default: m.Library })));
const WordDetail = lazy(() =>
  import('@/screens/WordDetail').then((m) => ({ default: m.WordDetail })),
);
const Stats = lazy(() => import('@/screens/Stats').then((m) => ({ default: m.Stats })));
const Rivalry = lazy(() => import('@/screens/Rivalry').then((m) => ({ default: m.Rivalry })));
const Settings = lazy(() => import('@/screens/Settings').then((m) => ({ default: m.Settings })));
const Today = lazy(() => import('@/screens/Today').then((m) => ({ default: m.Today })));
const Texts = lazy(() => import('@/screens/Texts').then((m) => ({ default: m.Texts })));
const TextRead = lazy(() => import('@/screens/TextRead').then((m) => ({ default: m.TextRead })));
const TextCheck = lazy(() => import('@/screens/TextCheck').then((m) => ({ default: m.TextCheck })));
const Confusables = lazy(() =>
  import('@/screens/Confusables').then((m) => ({ default: m.Confusables })),
);
const BidiTest = lazy(() => import('@/screens/BidiTest').then((m) => ({ default: m.BidiTest })));

/** Requires a selected, unlocked profile. */
function Gate({ children }: { children: ReactNode }) {
  const ready = useApp((s) => s.ready);
  const userId = useApp((s) => s.userId);
  const profile = useApp((s) => s.profile);
  const unlocked = useApp((s) => s.unlocked);
  const unlock = useApp((s) => s.unlock);
  const loc = useLocation();
  if (!ready) return null;
  if (!userId || !profile) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (profile.pinHash && !unlocked)
    return (
      <PinPad
        userId={userId}
        expected={profile.pinHash}
        onOk={unlock}
        onCancel={() => void useApp.getState().selectUser(null)}
      />
    );
  return <>{children}</>;
}

export function App() {
  const mode = useTheme((s) => s.mode);
  const init = useApp((s) => s.init);
  const userId = useApp((s) => s.userId);
  const accent = useApp((s) => s.profile?.settings.accent);

  useEffect(() => {
    applyThemeToDocument(mode);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeToDocument(useTheme.getState().mode);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    void init();
    void loadVoices();
    // iOS only allows audio from inside a user gesture, and suspends it after a call, the lock
    // screen or other audio: unlock and resume on every touch and on return to the foreground
    // (touchend and click count as gestures for media on iOS, pointerdown not always).
    for (const ev of ['pointerdown', 'touchend', 'click'])
      document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
    // In the background iOS can leave the audio silent while it reports "running": the next tap
    // replaces it (src/audio/speech.ts).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resumeAudio();
      else audioHidden();
    });
    window.addEventListener('pagehide', audioHidden);
    window.addEventListener('pageshow', resumeAudio);
    void loadRecordings();
    void loadInventory();
    startSyncLoop();
    if (import.meta.env.PROD) setupServiceWorker();
  }, [init]);

  useEffect(() => {
    if (!userId) return;
    void setPresence(userId, false).then(() => syncNow());
    void refreshPush(userId);
    schedulePrefetch();
    scheduleWeeklyOptimize();
  }, [userId]);

  // Natural audio for saved texts that was still being prepared when the app was last open.
  useEffect(() => {
    if (!userId || !accent) return;
    const t = window.setTimeout(
      () => void import('@/audio/textAudio').then((m) => m.resumeTextAudio(userId, accent)),
      3000,
    );
    return () => window.clearTimeout(t);
  }, [userId, accent]);

  // Recorded words of the chosen accent are stored for offline use in the background.
  useEffect(() => {
    if (!accent) return;
    const run = () => void syncWordPacks(accent);
    const t = window.setTimeout(run, 5000);
    window.addEventListener('online', run);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('online', run);
    };
  }, [accent]);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Toasts />
      <Announcements />
      <Suspense fallback={null}>
        <Routes>
          <Route path="welcome" element={<ProfilePicker />} />
          <Route
            path="placement"
            element={
              <Gate>
                <Placement />
              </Gate>
            }
          />
          <Route
            path="session/:mode"
            element={
              <Gate>
                <Session />
              </Gate>
            }
          />
          <Route
            path="today"
            element={
              <Gate>
                <Today />
              </Gate>
            }
          />
          <Route path="dev/bidi" element={<BidiTest />} />
          <Route
            element={
              <Gate>
                <Shell />
              </Gate>
            }
          >
            <Route index element={<Home />} />
            <Route path="learn" element={<LearnHub />} />
            <Route path="words" element={<Library />} />
            <Route path="word/:id" element={<WordDetail />} />
            <Route path="rivalry" element={<Rivalry />} />
            <Route path="stats" element={<Stats />} />
            <Route path="stats/:user" element={<Stats />} />
            <Route path="settings" element={<Settings />} />
            <Route path="read" element={<Navigate to="/texts" replace />} />
            <Route path="texts" element={<Texts />} />
            <Route path="texts/:id" element={<TextRead />} />
            <Route path="texts/:id/check" element={<TextCheck />} />
            <Route path="confusables" element={<Confusables />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
