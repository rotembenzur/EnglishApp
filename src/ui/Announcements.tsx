import { useEffect } from 'react';
import { db, getKv, setKv } from '@/data/db';
import { USER_NAMES } from '@/data/repo';
import { leagueHistory, weekStart } from '@/engine/stats';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { isFemale, otherUser } from '@/state/rival';
import { toast } from './toast';

/**
 * Shows nudges from the rival as toasts on next open (spec 6.2) and a small weekly recap on the
 * first open of a new week.
 */
export function Announcements() {
  const me = useApp((s) => s.userId);
  const version = useApp((s) => s.version);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const nudges = await db.events
        .where('to')
        .equals(me)
        .filter((e) => e.type === 'nudge' && e.seen !== 1)
        .toArray();
      for (const n of nudges.slice(-3)) {
        toast(
          t.rivalry.nudgeFrom(
            USER_NAMES[n.userId],
            String(n.payload.emoji ?? '👋'),
            isFemale(n.userId),
          ),
          // The emoji is already in the text; no separate icon.
          { ms: 5000, announce: true },
        );
      }
      if (nudges.length) await db.events.bulkPut(nudges.map((n) => ({ ...n, seen: 1 as const })));
    })();
  }, [me, version]);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const week = weekStart(todayKey());
      const key = `recap:${me}:${week}`;
      if (await getKv<boolean>(key, false)) return;
      const rival = otherUser(me);
      const [a, b] = await Promise.all([
        db.dailyStats.where('userId').equals(me).toArray(),
        db.dailyStats.where('userId').equals(rival).toArray(),
      ]);
      const hist = leagueHistory(
        new Map(a.map((d) => [d.date, d.xp])),
        new Map(b.map((d) => [d.date, d.xp])),
        week,
      );
      const last = hist[hist.length - 1];
      await setKv(key, true);
      if (!last || (last.a === 0 && last.b === 0)) return;
      const winner = last.winner === 'a' ? me : last.winner === 'b' ? rival : null;
      toast(
        t.rivalry.recapToast(
          winner ? t.rivalry.winnerOfWeek(USER_NAMES[winner], isFemale(winner)) : t.rivalry.draws,
          last.a,
          last.b,
        ),
        { icon: '🏆', ms: 6000, announce: true },
      );
    })();
  }, [me]);

  return null;
}
