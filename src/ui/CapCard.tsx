import { useState } from 'react';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { raiseTodayCap, useCapReached } from './cap';
import { Button } from './kit';

/**
 * Shown on home and at the end of a session once the daily cap is reached: the cap protects the
 * review load, it never ends the fun. One tap adds 5 new words for today, then `onRaised` runs
 * (usually: start a learning session).
 */
export function CapCard({ onRaised }: { onRaised: () => void }) {
  const today = useApp((s) => s.today);
  const reached = useCapReached();
  const [busy, setBusy] = useState(false);
  if (!reached) return null;
  return (
    <div className="card flex flex-col gap-3 p-4" data-testid="cap-card">
      <p className="font-bold">🌱 {t.cap.title}</p>
      <p className="text-sm text-ink-2">{t.cap.body(today?.newWords ?? 0)}</p>
      <Button
        variant="soft"
        className="py-2"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void raiseTodayCap()
            .then(onRaised)
            .finally(() => setBusy(false));
        }}
      >
        ✨ {t.cap.more}
      </Button>
      <p className="text-center text-xs text-ink-3">{t.cap.note}</p>
    </div>
  );
}
