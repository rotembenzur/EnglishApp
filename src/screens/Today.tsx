import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { computeStreak } from '@/engine/game';
import { dueWords } from '@/engine/session';
import { allDaily } from '@/data/repo';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { otherUser, snapshot } from '@/state/rival';
import { Ring } from '@/ui/kit';
import { Ltr } from '@/ui/bidi';

/** Compact card for a Safari start-page bookmark (spec 7.2 widget substitute). */
export function Today() {
  const profile = useApp((s) => s.profile);
  const words = useApp((s) => s.words);
  const today = useApp((s) => s.today);
  const userId = profile?.id;
  const daily = useLive(async () => (userId ? allDaily(userId) : []), [userId]);
  const rival = useLive(async () => (userId ? snapshot(otherUser(userId)) : null), [userId]);
  const streak = useMemo(() => computeStreak(daily ?? [], todayKey()).current, [daily]);
  const due = useMemo(() => dueWords([...words.values()], Date.now()).length, [words]);
  if (!profile) return null;
  const goal = profile.settings.dailyGoal;
  return (
    <div
      className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-5"
      style={{ paddingTop: 'calc(var(--sat) + 1rem)' }}
    >
      <div className="card flex items-center gap-5 p-5">
        <Ring value={today?.goalReached ? goal : (today?.xp ?? 0)} max={goal} size={96} stroke={10}>
          <span className="text-xl font-black" dir="ltr">
            {today?.xp ?? 0}
          </span>
        </Ring>
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-lg font-bold">{profile.name}</p>
          <p className="text-sm text-ink-2">🔥 {t.home.streakDays(streak)}</p>
          <p className="text-sm text-ink-2">
            {due ? t.home.queue(due, Math.max(1, Math.round(due / 4))) : t.home.queueEmpty}
          </p>
        </div>
      </div>
      {rival && (
        <div className="card flex items-center justify-between p-4 text-sm">
          <span className="font-semibold" style={{ color: 'var(--c-rival)' }}>
            {rival.name}
          </span>
          <Ltr>{rival.today?.xp ?? 0} XP</Ltr>
          <span>🔥 {rival.streak}</span>
        </div>
      )}
      <Link to="/" className="rounded-2xl bg-accent py-4 text-center font-bold text-accent-ink">
        {t.today.open}
      </Link>
    </div>
  );
}
