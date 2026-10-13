/**
 * Push server scheduling (supabase/functions/_shared/schedule.ts): daily reminders, streak alerts
 * and nudges, plus the contract between what the app stores and what the server reads.
 * The Web Push crypto is tested in scripts/webpush.test.ts.
 */
import {
  localClock,
  nudgeMessage,
  planScheduled,
  readPrefs,
  streakToday,
  type DayRow,
  type PushPrefs,
} from '../../supabase/functions/_shared/schedule.ts';
import { computeStreak } from '@/engine/game';
import { stripBidi } from '@/i18n/bidi';
import { pushRowData, DEFAULT_PUSH_PREFS } from './push';

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const SUB = {
  endpoint: 'https://web.push.apple.com/x',
  keys: { p256dh: 'BAAA', auth: 'AAAA' },
};

function prefs(over: Partial<PushPrefs> = {}): PushPrefs {
  return {
    subscription: SUB,
    userId: 'rotem',
    reminderTime: '08:30',
    streakAlert: true,
    nudges: true,
    tz: 'Asia/Jerusalem',
    ...over,
  };
}

/** A UTC instant for an Israel local time on 2026-10-13 (IDT, UTC+3). */
function il(hhmm: string, date = '2026-10-13'): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.parse(`${date}T00:00:00Z`) + ((h! - 3) * 60 + m!) * 60_000;
}

/** A streak of `n` days ending yesterday. */
function streakDays(n: number, today = '2026-10-13'): DayRow[] {
  const out: DayRow[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), xp: 80, goalReached: true });
  }
  return out;
}

describe('push schedule', () => {
  it('reads local time in the phone time zone, across daylight saving changes', () => {
    expect(localClock(il('08:30'), 'Asia/Jerusalem', undefined)).toEqual({
      date: '2026-10-13',
      minutes: 8 * 60 + 30,
    });
    // Israel is back on UTC+2 from 2026-10-25.
    const winter = Date.parse('2026-11-02T06:30:00Z');
    expect(localClock(winter, 'Asia/Jerusalem', -180).minutes).toBe(8 * 60 + 30);
    // No zone: fixed offset.
    expect(localClock(Date.parse('2026-10-13T23:30:00Z'), undefined, -180)).toEqual({
      date: '2026-10-14',
      minutes: 150,
    });
  });

  it('sends the daily reminder once, at or after the chosen time', () => {
    const before = planScheduled({
      now: il('08:25'),
      prefs: prefs(),
      state: {},
      days: [],
      rivalToday: null,
    });
    expect(before.messages).toEqual([]);
    const due = planScheduled({
      now: il('08:31'),
      prefs: prefs(),
      state: {},
      days: [],
      rivalToday: null,
    });
    expect(due.messages.map((m) => m.kind)).toEqual(['reminder']);
    expect(due.state.reminder).toBe('2026-10-13');
    const again = planScheduled({
      now: il('08:36'),
      prefs: prefs(),
      state: due.state,
      days: [],
      rivalToday: null,
    });
    expect(again.messages).toEqual([]);
    // A late run (GitHub or pg_cron hiccup) still catches up within 3 hours, not later.
    expect(
      planScheduled({ now: il('11:00'), prefs: prefs(), state: {}, days: [], rivalToday: null })
        .messages,
    ).toHaveLength(1);
    expect(
      planScheduled({ now: il('11:31'), prefs: prefs(), state: {}, days: [], rivalToday: null })
        .messages,
    ).toHaveLength(0);
  });

  it('stays quiet when the goal is reached or the reminder is off', () => {
    const reached = [{ date: '2026-10-13', xp: 70, goalReached: true }];
    const r = planScheduled({
      now: il('08:31'),
      prefs: prefs(),
      state: {},
      days: reached,
      rivalToday: null,
    });
    expect(r.messages).toEqual([]);
    expect(r.state.reminder).toBe('2026-10-13');
    const off = planScheduled({
      now: il('08:31'),
      prefs: prefs({ reminderTime: null }),
      state: {},
      days: [],
      rivalToday: null,
    });
    expect(off.messages).toEqual([]);
  });

  it('mentions the rival in the reminder', () => {
    const run = (rivalToday: { xp: number; goalReached: boolean } | null, userId = 'rotem') =>
      planScheduled({
        now: il('08:31'),
        prefs: prefs({ userId: userId as 'rotem' }),
        state: {},
        days: [],
        rivalToday,
      }).messages[0]!.body;
    // Copy only; the bidi marks are covered in src/i18n/bidi.test.ts.
    const text = (...a: Parameters<typeof run>) => stripBidi(run(...a));
    expect(text({ xp: 40, goalReached: false })).toContain('נועה כבר ב־40 XP היום');
    expect(text({ xp: 90, goalReached: true })).toContain('נועה כבר סגרה את היעד');
    expect(text({ xp: 90, goalReached: true }, 'noa')).toContain('רתם כבר סגר את היעד');
    expect(text(null)).toBe('חמש דקות של מילים, והיום נסגר');
  });

  it('warns at 20:00 only when a live streak is at risk', () => {
    const p = prefs({ reminderTime: null });
    const atRisk = planScheduled({
      now: il('20:02'),
      prefs: p,
      state: {},
      days: streakDays(5),
      rivalToday: null,
    });
    expect(atRisk.messages.map((m) => m.kind)).toEqual(['streak']);
    expect(stripBidi(atRisk.messages[0]!.body)).toContain('5 ימים ברצף');
    expect(
      planScheduled({
        now: il('19:58'),
        prefs: p,
        state: {},
        days: streakDays(5),
        rivalToday: null,
      }).messages,
    ).toEqual([]);
    // No streak alive: nothing to protect.
    expect(
      planScheduled({ now: il('20:02'), prefs: p, state: {}, days: [], rivalToday: null }).messages,
    ).toEqual([]);
    // Turned off.
    expect(
      planScheduled({
        now: il('20:02'),
        prefs: { ...p, streakAlert: false },
        state: {},
        days: streakDays(5),
        rivalToday: null,
      }).messages,
    ).toEqual([]);
  });

  it('never sends the reminder and the streak alert within the same hour', () => {
    // Reminder chosen at 20:00: one message, the streak alert, and both are marked done.
    const same = planScheduled({
      now: il('20:01'),
      prefs: prefs({ reminderTime: '20:00' }),
      state: {},
      days: streakDays(3),
      rivalToday: null,
    });
    expect(same.messages.map((m) => m.kind)).toEqual(['streak']);
    expect(same.state).toMatchObject({ reminder: '2026-10-13', streak: '2026-10-13' });
    // Reminder at 19:40, then 20:00: the alert is skipped.
    const first = planScheduled({
      now: il('19:41'),
      prefs: prefs({ reminderTime: '19:40' }),
      state: {},
      days: streakDays(3),
      rivalToday: null,
    });
    expect(first.messages.map((m) => m.kind)).toEqual(['reminder']);
    const second = planScheduled({
      now: il('20:01'),
      prefs: prefs({ reminderTime: '19:40' }),
      state: first.state,
      days: streakDays(3),
      rivalToday: null,
    });
    expect(second.messages).toEqual([]);
    // Reminder at 21:30 after a streak alert at 20:00: the reminder is skipped.
    const alert = planScheduled({
      now: il('20:01'),
      prefs: prefs({ reminderTime: '21:30' }),
      state: {},
      days: streakDays(3),
      rivalToday: null,
    });
    const later = planScheduled({
      now: il('21:31'),
      prefs: prefs({ reminderTime: '21:30' }),
      state: alert.state,
      days: streakDays(3),
      rivalToday: null,
    });
    expect(later.messages).toEqual([]);
    // A reminder at 21:30 still goes out when no streak alert was needed.
    const noStreak = planScheduled({
      now: il('21:31'),
      prefs: prefs({ reminderTime: '21:30' }),
      state: { streak: '2026-10-13' },
      days: [],
      rivalToday: null,
    });
    expect(noStreak.messages.map((m) => m.kind)).toEqual(['reminder']);
  });

  it('computes streaks exactly like the app', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 300; run++) {
      const days: DayRow[] = [];
      for (let i = 0; i < 60; i++) {
        const d = new Date(Date.UTC(2026, 7, 1 + i));
        if (rnd() < 0.75) {
          days.push({ date: d.toISOString().slice(0, 10), xp: 60, goalReached: rnd() < 0.85 });
        }
      }
      const today = new Date(Date.UTC(2026, 7, 30 + Math.floor(rnd() * 30)))
        .toISOString()
        .slice(0, 10);
      const app = computeStreak(days, today);
      expect(streakToday(days, today)).toEqual({
        current: app.current,
        pendingToday: app.pendingToday,
      });
    }
  });

  it('pushes fresh nudges only, with the sender in the copy', () => {
    const now = Date.now();
    const ev = { type: 'nudge', userId: 'noa' as const, to: 'rotem' as const, at: now - 5000 };
    const fire = nudgeMessage({ ...ev, payload: { emoji: '🔥' } }, now)!;
    expect(fire).toMatchObject({ kind: 'nudge', url: './rivalry' });
    expect(stripBidi(fire.title)).toBe('נועה');
    expect(stripBidi(fire.body)).toBe('נועה שלחה לך 🔥');
    expect(
      stripBidi(
        nudgeMessage({ ...ev, userId: 'rotem', to: 'noa', payload: { emoji: '👋' } }, now)!.body,
      ),
    ).toBe('רתם שלח לך 👋');
    expect(nudgeMessage({ ...ev, at: now - 7 * 3600_000 }, now)).toBeNull();
    expect(nudgeMessage({ ...ev, type: 'badge' }, now)).toBeNull();
    expect(nudgeMessage({ ...ev, to: 'noa' }, now)).toBeNull();
  });

  it('reads what the app stores, including rows from older versions', () => {
    const data = pushRowData(
      SUB as unknown as PushSubscriptionJSON,
      'noa',
      { ...DEFAULT_PUSH_PREFS, enabled: true, reminderTime: '07:15', nudges: false },
      new Date('2026-10-13T08:00:00Z'),
    );
    expect(readPrefs(JSON.parse(JSON.stringify(data)))).toMatchObject({
      userId: 'noa',
      reminderTime: '07:15',
      streakAlert: true,
      nudges: false,
      subscription: SUB,
    });
    expect(readPrefs({ ...data, reminderTime: null })!.reminderTime).toBeNull();
    // 0.3.x rows: reminderTime and tzOffset only.
    expect(
      readPrefs({ subscription: SUB, userId: 'rotem', reminderTime: '21:00', tzOffset: -180 }),
    ).toMatchObject({ reminderTime: '21:00', streakAlert: true, nudges: true });
    expect(readPrefs({ subscription: { endpoint: 'x' }, userId: 'rotem' })).toBeNull();
    expect(readPrefs({ subscription: SUB, userId: 'someone' })).toBeNull();
  });
});
