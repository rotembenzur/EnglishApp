import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserId } from '@/engine/types';
import { USER_IDS } from '@/engine/types';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { USER_NAMES } from '@/data/repo';
import { unlockAudio } from '@/audio/speech';
import { PinPad } from './PinGate';
import { db } from '@/data/db';

const ACCENT: Record<UserId, string> = { rotem: '#ff6b4a', noa: '#7c5cff' };
const EMOJI: Record<UserId, string> = { rotem: '🦊', noa: '🦉' };

export function ProfilePicker() {
  const selectUser = useApp((s) => s.selectUser);
  const unlock = useApp((s) => s.unlock);
  const nav = useNavigate();
  const [pinFor, setPinFor] = useState<{ id: UserId; hash: string } | null>(null);

  const choose = async (id: UserId) => {
    unlockAudio();
    const existing = await db.users.get(id);
    if (existing?.pinHash) {
      setPinFor({ id, hash: existing.pinHash });
      return;
    }
    await selectUser(id);
    unlock();
    nav('/', { replace: true });
  };

  if (pinFor) {
    return (
      <PinPad
        userId={pinFor.id}
        expected={pinFor.hash}
        onOk={async () => {
          await selectUser(pinFor.id);
          unlock();
          nav('/', { replace: true });
        }}
        onCancel={() => setPinFor(null)}
      />
    );
  }

  return (
    <div
      className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-5 py-10"
      style={{ paddingTop: 'calc(var(--sat) + 2rem)' }}
    >
      <div className="text-center">
        <img
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt=""
          className="mx-auto mb-4 h-20 w-20 rounded-[22px] shadow-card"
        />
        <h1 className="text-3xl font-extrabold">{t.picker.title}</h1>
        <p className="mt-2 text-ink-2">{t.picker.subtitle}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {USER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void choose(id)}
            className="card tap flex flex-col items-center gap-3 px-4 py-8 transition active:scale-[0.97]"
            style={{ boxShadow: `0 10px 30px -14px ${ACCENT[id]}` }}
          >
            <span
              className="grid h-20 w-20 place-items-center rounded-full text-4xl"
              style={{ background: `color-mix(in oklab, ${ACCENT[id]} 18%, transparent)` }}
            >
              {EMOJI[id]}
            </span>
            <span className="text-xl font-bold" style={{ color: ACCENT[id] }}>
              {USER_NAMES[id]}
            </span>
          </button>
        ))}
      </div>
      <details className="card p-4 text-sm text-ink-2">
        <summary className="cursor-pointer font-semibold text-ink">{t.picker.install}</summary>
        <ol className="mt-3 list-inside list-decimal space-y-1.5">
          {t.picker.installSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
      <p className="text-center text-xs text-ink-3">{t.app.tagline}</p>
    </div>
  );
}

export const USER_EMOJI = EMOJI;
export const USER_ACCENT = ACCENT;
