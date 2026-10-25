import { useEffect } from 'react';
import { db, getKv, setKv } from '@/data/db';
import { USER_NAMES } from '@/data/repo';
import { leagueHistory, monthlyHistory, monthOf, prevMonth, weekStart } from '@/engine/stats';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { isFemale, otherUser } from '@/state/rival';
import { toast } from './toast';

/**
 * Shows nudges from the rival as toasts on next open (spec 6.2), a small weekly recap on the
 * first open of a new week and a monthly recap (who picks the date) on the first open of a new
 * month.
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
      const today = todayKey();
      const week = weekStart(today);
      const month = monthOf(today);
      const key = `recap:${me}:${week}`;
      const monthKey = `recap-month:${me}:${month}`;
      const [weekDone, monthDone] = await Promise.all([
        getKv<boolean>(key, false),
        getKv<boolean>(monthKey, false),
      ]);
      if (weekDone && monthDone) return;
      const rival = otherUser(me);
      const [a, b] = await Promise.all([
        db.dailyStats.where('userId').equals(me).toArray(),
        db.dailyStats.where('userId').equals(rival).toArray(),
      ]);
      const aXp = new Map(a.map((d) => [d.date, d.xp]));
      const bXp = new Map(b.map((d) => [d.date, d.xp]));
      const winnerOf = (r: { winner: 'a' | 'b' | 'draw' }) =>
        r.winner === 'a' ? me : r.winner === 'b' ? rival : null;

      // The month first when both are due: it decides who picks the date.
      if (!monthDone) {
        const last = monthlyHistory(aXp, bXp, month).find((m) => m.week === prevMonth(month));
        await setKv(monthKey, true);
        if (last && (last.a > 0 || last.b > 0)) {
          const winner = winnerOf(last);
          const name = t.rivalry.monthNames[Number(last.week.slice(5, 7)) - 1]!;
          const recap = t.rivalry.monthRecapToast(
            winner
              ? t.rivalry.winnerOfMonth(USER_NAMES[winner], isFemale(winner), name)
              : t.rivalry.monthDraw(name),
            last.a,
            last.b,
          );
          const date = winner ? t.rivalry.datePick(isFemale(winner)) : t.rivalry.dateSplit;
          toast(`${recap}. ${date}`, {
            icon: '💘',
            ms: 8000,
            announce: true,
          });
        }
      }

      if (!weekDone) {
        const hist = leagueHistory(aXp, bXp, week);
        const last = hist[hist.length - 1];
        await setKv(key, true);
        if (last && (last.a > 0 || last.b > 0)) {
          const winner = winnerOf(last);
          toast(
            t.rivalry.recapToast(
              winner
                ? t.rivalry.winnerOfWeek(USER_NAMES[winner], isFemale(winner))
                : t.rivalry.draws,
              last.a,
              last.b,
            ),
            { icon: '🏆', ms: 6000, announce: true },
          );
        }
      }
    })();
  }, [me]);

  return null;
}
