import { usePwa } from '@/pwa/registerSW';
import { t } from '@/i18n/he';

export function PwaToasts() {
  const { needRefresh, offlineReady, update, dismiss } = usePwa();
  if (!needRefresh && !offlineReady) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(var(--tabbar-h) + var(--sab) + 12px)' }}
    >
      <div className="card pointer-events-auto flex max-w-md items-center gap-3 px-4 py-3 text-sm animate-fade-up">
        {needRefresh ? (
          <>
            <span className="flex-1">{t.pwa.updateReady}</span>
            <button
              className="tap rounded-pill bg-accent px-3 py-1.5 font-semibold text-accent-ink"
              onClick={() => void update()}
            >
              {t.pwa.updateNow}
            </button>
            <button className="tap px-2 text-ink-3" onClick={dismiss}>
              {t.pwa.updateLater}
            </button>
          </>
        ) : (
          <span className="flex-1">{t.pwa.offlineReady}</span>
        )}
      </div>
    </div>
  );
}
