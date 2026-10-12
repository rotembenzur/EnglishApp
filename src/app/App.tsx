import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shell } from '@/ui/Shell';
import { HomeScreen } from '@/screens/HomeScreen';
import { PlaceholderScreen } from '@/screens/PlaceholderScreen';
import { setupServiceWorker } from '@/pwa/registerSW';
import { applyThemeToDocument, useTheme } from '@/state/theme';
import { t } from '@/i18n/he';

export function App() {
  const mode = useTheme((s) => s.mode);
  useEffect(() => {
    applyThemeToDocument(mode);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeToDocument(useTheme.getState().mode);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    if (import.meta.env.PROD) setupServiceWorker();
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomeScreen />} />
          <Route path="learn" element={<PlaceholderScreen title={t.tabs.learn} />} />
          <Route path="words" element={<PlaceholderScreen title={t.tabs.words} />} />
          <Route path="rivalry" element={<PlaceholderScreen title={t.tabs.rivalry} />} />
          <Route path="stats" element={<PlaceholderScreen title={t.tabs.stats} />} />
          <Route path="*" element={<HomeScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
