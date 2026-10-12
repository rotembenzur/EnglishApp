import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from '@/ui/Shell';
import { setupServiceWorker } from '@/pwa/registerSW';
import { applyThemeToDocument, useTheme } from '@/state/theme';
import { useApp } from '@/state/app';
import { loadVoices, unlockAudio } from '@/audio/speech';
import { loadInventory } from '@/content/inventory';
import { startSyncLoop, syncNow } from '@/sync/engine';
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
const ReadMode = lazy(() => import('@/screens/ReadMode').then((m) => ({ default: m.ReadMode })));
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
    // iOS only allows speech from inside a user gesture: unlock on the first touch anywhere.
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    void loadInventory();
    startSyncLoop();
    if (import.meta.env.PROD) setupServiceWorker();
  }, [init]);

  useEffect(() => {
    if (!userId) return;
    void setPresence(userId, false).then(() => syncNow());
    schedulePrefetch();
    scheduleWeeklyOptimize();
  }, [userId]);

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
            <Route path="read" element={<ReadMode />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
