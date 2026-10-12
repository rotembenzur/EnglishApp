import { useEffect, useState } from 'react';
import type { UserId } from '@/engine/types';
import { t } from '@/i18n/he';
import { hashPin } from '@/state/app';
import { USER_NAMES } from '@/data/repo';
import { Button } from '@/ui/kit';
import { LockIcon } from '@/ui/icons';

/** 4-digit PIN pad. With `expected` it verifies; without it, it collects a new PIN. */
export function PinPad({
  userId,
  expected,
  onOk,
  onCancel,
  title,
}: {
  userId: UserId;
  expected?: string;
  onOk: (pinHash: string) => void | Promise<void>;
  onCancel?: () => void;
  title?: string;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length !== 4) return;
    let alive = true;
    void hashPin(userId, pin).then(async (h) => {
      if (!alive) return;
      if (!expected || h === expected) await onOk(h);
      else {
        setError(true);
        setPin('');
      }
    });
    return () => {
      alive = false;
    };
  }, [pin, expected, userId, onOk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const press = (d: string) => {
    setError(false);
    setPin((p) => (p.length < 4 ? p + d : p));
  };

  return (
    <div
      className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-6 px-6 py-10"
      style={{ paddingTop: 'calc(var(--sat) + 2rem)' }}
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <LockIcon />
      </span>
      <h1 className="text-2xl font-bold">{title ?? t.picker.pinTitle(USER_NAMES[userId])}</h1>
      <div className={`flex gap-3 ${error ? 'animate-shake' : ''}`} dir="ltr" aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-accent' : 'bg-line'}`}
          />
        ))}
      </div>
      <p className="h-5 text-sm text-bad">{error ? t.picker.pinWrong : ''}</p>
      <div className="grid w-64 grid-cols-3 gap-3" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className="tap h-16 rounded-2xl bg-card text-2xl font-semibold shadow-card active:scale-95"
              onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : press(k))}
              aria-label={k === '⌫' ? 'מחיקה' : k}
            >
              {k}
            </button>
          ),
        )}
      </div>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          {t.common.back}
        </Button>
      )}
    </div>
  );
}
