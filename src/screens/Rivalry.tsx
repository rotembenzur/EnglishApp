import { useState } from 'react';
import { todayDuel } from '@/session/duel';
import { Link, useNavigate } from 'react-router-dom';
import {
  compareDuel,
  daysLeftInMonth,
  headToHead,
  leagueHistory,
  monthlyHistory,
  monthOf,
  monthXp,
  prevMonth,
  weekStart,
} from '@/engine/stats';
import type { UserId } from '@/engine/types';
import { db } from '@/data/db';
import { addEvent, USER_NAMES } from '@/data/repo';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { isFemale, otherUser, snapshot } from '@/state/rival';
import { useSync } from '@/sync/engine';
import { syncNow } from '@/sync/engine';
import { Button, Header, Section } from '@/ui/kit';
import { toast } from '@/ui/toast';
import { shareLeagueCard } from '@/ui/share';
import { TrophyIcon } from '@/ui/icons';
import { Ltr } from '@/ui/bidi';
import { USER_EMOJI } from './ProfilePicker';

const NUDGES = ['👋', '🔥', '😴', '🏆'];

export function Rivalry() {
  const nav = useNavigate();
  const me = useApp((s) => s.userId)!;
  const rival = otherUser(me);
  const configured = useSync((s) => s.configured);
  const [sent, setSent] = useState<string | null>(null);

  const data = useLive(async () => {
    const [a, b, aDaily, bDaily, myDuel, theirDuel] = await Promise.all([
      snapshot(me),
      snapshot(rival),
      db.dailyStats.where('userId').equals(me).toArray(),
      db.dailyStats.where('userId').equals(rival).toArray(),
      todayDuel(me),
      todayDuel(rival),
    ]);
    const aXp = new Map(aDaily.map((d) => [d.date, d.xp]));
    const bXp = new Map(bDaily.map((d) => [d.date, d.xp]));
    const today = todayKey();
    const history = leagueHistory(aXp, bXp, weekStart(today));
    const month = monthOf(today);
    const months = monthlyHistory(aXp, bXp, month);
    const monthly = {
      month,
      daysLeft: daysLeftInMonth(today),
      a: monthXp(aXp, month),
      b: monthXp(bXp, month),
      last: months.find((m) => m.week === prevMonth(month) && (m.a > 0 || m.b > 0)),
      h2h: headToHead(months),
      played: months.length,
    };
    return { a, b, history, h2h: headToHead(history), monthly, myDuel, theirDuel };
  }, [me, rival]);

  const nudge = async (emoji: string) => {
    await addEvent({ userId: me, type: 'nudge', to: rival, payload: { emoji } });
    setSent(emoji);
    toast(t.rivalry.nudgeSent, { icon: emoji });
    void syncNow();
  };

  if (!data) return <Header title={t.rivalry.title} />;
  const { a, b, history, h2h, monthly, myDuel, theirDuel } = data;
  const max = Math.max(1, ...a.weekByDay, ...b.weekByDay);
  const lastWeek = history[history.length - 1];
  const duelResult = myDuel && theirDuel ? compareDuel(myDuel, theirDuel) : null;

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Header title={t.rivalry.title} />
      <div className="flex flex-col gap-6 px-4">
        {!configured && (
          <div className="card flex flex-col gap-2 border border-warn/40 p-4">
            <p className="font-bold">{t.rival.noSync}</p>
            <p className="text-sm text-ink-2">{t.rival.noSyncBody}</p>
            <Link to="/settings#sync" className="text-sm font-semibold text-accent">
              {t.rival.setup}
            </Link>
          </div>
        )}

        <Section
          title={t.rivalry.league}
          action={
            <button
              type="button"
              className="text-sm font-semibold text-accent"
              onClick={() =>
                void shareLeagueCard({
                  a: a.name,
                  b: b.name,
                  aXp: a.weekXp,
                  bXp: b.weekXp,
                  week: weekStart(todayKey()),
                })
              }
            >
              {t.rivalry.shareWeek}
            </button>
          }
        >
          <div className="card flex flex-col gap-4 p-4">
            <div className="flex items-center justify-around">
              <Player id={me} xp={a.weekXp} lead={a.weekXp > b.weekXp} />
              <span className="text-sm font-bold text-ink-3">VS</span>
              <Player id={rival} xp={b.weekXp} lead={b.weekXp > a.weekXp} />
            </div>
            <div className="flex items-end gap-2" style={{ height: 110 }}>
              {t.rivalry.daysShort.map((d, i) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end justify-center gap-[3px]">
                    <div
                      className="w-1/2 rounded-t bg-accent"
                      style={{
                        height: `${(a.weekByDay[i]! / max) * 100}%`,
                        minHeight: a.weekByDay[i] ? 3 : 0,
                      }}
                    />
                    <div
                      className="w-1/2 rounded-t"
                      style={{
                        background: 'var(--c-rival)',
                        height: `${(b.weekByDay[i]! / max) * 100}%`,
                        minHeight: b.weekByDay[i] ? 3 : 0,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-ink-3">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {lastWeek && (
          <div className="card flex items-center gap-3 p-4">
            <TrophyIcon className="text-warn" />
            <p className="flex-1 text-sm font-semibold">
              {lastWeek.winner === 'draw'
                ? t.rivalry.draws
                : t.rivalry.winnerOfWeek(
                    USER_NAMES[lastWeek.winner === 'a' ? me : rival],
                    isFemale(lastWeek.winner === 'a' ? me : rival),
                  )}
            </p>
            {/* Read right to left like the players above: my score first, on the right. */}
            <span className="text-xs text-ink-3">
              <Ltr>{lastWeek.a}</Ltr> : <Ltr>{lastWeek.b}</Ltr>
            </span>
          </div>
        )}

        <MonthLeague me={me} rival={rival} m={monthly} />

        <Section title={t.rivalry.history}>
          <div className="card grid grid-cols-3 gap-2 p-4 text-center">
            <div>
              <div className="text-2xl font-black text-accent">{h2h.aWins}</div>
              <div className="text-xs text-ink-3">
                {t.rivalry.wins} {a.name}
              </div>
            </div>
            <div>
              <div className="text-2xl font-black">{h2h.draws}</div>
              <div className="text-xs text-ink-3">{t.rivalry.draws}</div>
            </div>
            <div>
              <div className="text-2xl font-black" style={{ color: 'var(--c-rival)' }}>
                {h2h.bWins}
              </div>
              <div className="text-xs text-ink-3">
                {t.rivalry.wins} {b.name}
              </div>
            </div>
            <div className="col-span-3 text-xs text-ink-3">
              {t.rivalry.longestRun}: {a.name} {h2h.longestA} · {b.name} {h2h.longestB}
            </div>
          </div>
        </Section>

        <Section title={t.rivalry.duelTitle}>
          <div className="card flex flex-col gap-3 p-4">
            <p className="text-sm text-ink-2">{t.rivalry.duelBody}</p>
            {myDuel ? (
              <>
                <p className="font-semibold">{t.rivalry.duelDone(myDuel.correct)}</p>
                {duelResult ? (
                  <p className="font-bold">
                    {duelResult === 'a'
                      ? `🥇 ${t.rivalry.duelWin}`
                      : duelResult === 'b'
                        ? t.rivalry.duelLose
                        : t.rivalry.duelDraw}
                    <span className="mt-1 block text-xs font-normal text-ink-3">
                      {t.rivalry.duelScore(
                        a.name,
                        myDuel.correct,
                        (myDuel.ms / 1000).toFixed(1),
                        b.name,
                        theirDuel!.correct,
                        (theirDuel!.ms / 1000).toFixed(1),
                      )}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-3">{t.rivalry.duelWaiting}</p>
                )}
              </>
            ) : (
              <Button onClick={() => nav('/session/duel')}>{t.rivalry.duelPlay} ⚔️</Button>
            )}
          </div>
        </Section>

        <Section title={t.rivalry.nudges}>
          <div className="grid grid-cols-4 gap-3">
            {NUDGES.map((e) => (
              <button
                key={e}
                type="button"
                disabled={!configured}
                onClick={() => void nudge(e)}
                className={`card tap grid h-16 place-items-center text-3xl transition active:scale-90 disabled:opacity-40 ${sent === e ? 'animate-pop' : ''}`}
                aria-label={t.rivalry.nudgeLabel(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </Section>

        <Link to={`/stats/${rival}`} className="card flex items-center gap-3 p-4">
          <span className="text-2xl">{USER_EMOJI[rival]}</span>
          <span className="flex-1 font-semibold">{t.rivalry.viewStats(USER_NAMES[rival])}</span>
        </Link>
      </div>
    </div>
  );
}

const monthName = (month: string) => t.rivalry.monthNames[Number(month.slice(5, 7)) - 1]!;

interface Monthly {
  month: string;
  daysLeft: number;
  a: number;
  b: number;
  last: { week: string; a: number; b: number; winner: 'a' | 'b' | 'draw' } | undefined;
  h2h: ReturnType<typeof headToHead>;
  played: number;
}

/** The monthly league: the month's XP race, played for a date the winner picks and treats. */
function MonthLeague({ me, rival, m }: { me: UserId; rival: UserId; m: Monthly }) {
  const leader = m.a > m.b ? me : m.b > m.a ? rival : null;
  const total = m.a + m.b;
  const last = m.last;
  const lastWinner = last ? (last.winner === 'a' ? me : last.winner === 'b' ? rival : null) : null;
  return (
    <Section
      title={t.rivalry.monthLeague}
      action={
        <button
          type="button"
          className="text-sm font-semibold text-accent"
          onClick={() =>
            void shareLeagueCard({
              a: USER_NAMES[me],
              b: USER_NAMES[rival],
              aXp: m.a,
              bXp: m.b,
              week: m.month,
              title: t.rivalry.monthLeague,
              subtitle: monthName(m.month),
            })
          }
        >
          {t.rivalry.shareMonth}
        </button>
      }
    >
      <div className="card flex flex-col gap-4 p-4" data-testid="month-league">
        <p className="text-sm font-semibold">💘 {t.rivalry.monthStake}</p>
        <div className="flex items-center justify-around">
          <Player id={me} xp={m.a} lead={leader === me} />
          <span className="text-sm font-bold text-ink-3">VS</span>
          <Player id={rival} xp={m.b} lead={leader === rival} />
        </div>
        {/* Right to left like the players above: my share on the right. */}
        <div className="flex h-3 overflow-hidden rounded-full bg-line">
          {total > 0 && (
            <>
              <div className="bg-accent" style={{ width: `${(m.a / total) * 100}%` }} />
              <div className="bg-rival" style={{ width: `${(m.b / total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
          <span className="font-semibold text-ink-2">
            {leader
              ? t.rivalry.monthLeading(USER_NAMES[leader], isFemale(leader), Math.abs(m.a - m.b))
              : t.rivalry.monthTied}
          </span>
          <span>{t.rivalry.monthDaysLeft(monthName(m.month), m.daysLeft)}</span>
        </div>
        {last && (
          <div className="flex items-center gap-3 rounded-xl bg-card-2 p-3">
            <TrophyIcon className="text-warn" />
            <p className="flex-1 text-sm font-semibold">
              {lastWinner
                ? t.rivalry.winnerOfMonth(
                    USER_NAMES[lastWinner],
                    isFemale(lastWinner),
                    monthName(last.week),
                  )
                : t.rivalry.monthDraw(monthName(last.week))}
              <span className="block text-xs font-normal text-ink-3">
                {lastWinner ? t.rivalry.datePick(isFemale(lastWinner)) : t.rivalry.dateSplit}
              </span>
            </p>
            <span className="text-xs text-ink-3">
              <Ltr>{last.a}</Ltr> : <Ltr>{last.b}</Ltr>
            </span>
          </div>
        )}
        {m.played > 0 && (
          <p className="text-center text-xs text-ink-3">
            {t.rivalry.monthTally(
              USER_NAMES[me],
              m.h2h.aWins,
              USER_NAMES[rival],
              m.h2h.bWins,
              m.h2h.draws,
            )}
          </p>
        )}
      </div>
    </Section>
  );
}

function Player({ id, xp, lead }: { id: UserId; xp: number; lead: boolean }) {
  const me = useApp((s) => s.userId);
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="relative grid h-14 w-14 place-items-center rounded-full text-3xl"
        style={{ background: id === me ? 'var(--c-accent-soft)' : 'var(--c-rival-soft)' }}
      >
        {USER_EMOJI[id]}
        {lead && <span className="absolute -top-2 text-lg">👑</span>}
      </span>
      <span className="font-bold">{USER_NAMES[id]}</span>
      <Ltr className="text-lg font-black">{xp} XP</Ltr>
    </div>
  );
}
