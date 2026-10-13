/**
 * What to send, and when (spec 6.2 nudges, 7.2 smart reminders, 9.6). Pure functions: the Edge
 * Function reads rows and passes the clock in; unit tests cover every rule.
 *
 * Per subscription (one per phone):
 *  - daily reminder at the time the user picked, if today's goal is not reached yet,
 *  - "your streak is at risk" at 20:00 local, if the goal is not reached and a streak is alive,
 *  - rival nudges, as soon as they are synced.
 * Each scheduled message goes out at most once per local day, and the two scheduled messages never
 * arrive within the same hour.
 */

export type UserId = 'rotem' | 'noa';

export const NAMES: Record<UserId, string> = { rotem: 'רתם', noa: 'נועה' };
const FEMALE: Record<UserId, boolean> = { rotem: false, noa: true };

/** Phone-owned part of a push row (`lb_push.data`). */
export interface PushPrefs {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  userId: UserId;
  /** 'HH:MM' local, or null for no daily reminder. */
  reminderTime: string | null;
  streakAlert: boolean;
  nudges: boolean;
  /** IANA time zone of the phone, for example Asia/Jerusalem. */
  tz?: string;
  /** Minutes behind UTC (Date#getTimezoneOffset), fallback when tz is missing. */
  tzOffset?: number;
}

/** Server-owned part of a push row (`lb_push.state`). */
export interface PushState {
  /** Local date the daily reminder was handled on. */
  reminder?: string;
  /** Local date the streak alert was handled on. */
  streak?: string;
  /** Local date a streak alert was actually sent on. */
  streakSent?: string;
  /** When the last scheduled message was sent (ms). */
  lastAt?: number;
  /** What the push service answered last time (for diagnosis; never contains the endpoint). */
  lastResult?: { kind: string; status: number; reason: string; at: number };
}

export interface DayRow {
  date: string;
  xp: number;
  goalReached: boolean;
}

export interface PushMessage {
  kind: 'reminder' | 'streak' | 'nudge' | 'test';
  title: string;
  body: string;
  /** Path inside the app scope to open on tap. */
  url: string;
  tag: string;
}

export const STREAK_ALERT_MINUTES = 20 * 60;
/** A late run still sends the reminder up to this long after the chosen time. */
const REMINDER_WINDOW = 180;
const STREAK_WINDOW_END = 23 * 60 + 30;
const MIN_GAP_MS = 60 * 60_000;
/** Nudges older than this (an old phone syncing late) are not pushed. */
export const NUDGE_MAX_AGE_MS = 6 * 3600_000;

/** Normalize a stored row, including rows written by older app versions. */
export function readPrefs(data: unknown): PushPrefs | null {
  const d = data as Partial<PushPrefs> & { reminderTime?: string | null };
  const sub = d?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return null;
  if (d.userId !== 'rotem' && d.userId !== 'noa') return null;
  const time =
    typeof d.reminderTime === 'string' && /^\d{2}:\d{2}$/.test(d.reminderTime)
      ? d.reminderTime
      : d.reminderTime === null
        ? null
        : '20:00';
  return {
    subscription: sub,
    userId: d.userId,
    reminderTime: time,
    streakAlert: d.streakAlert !== false,
    nudges: d.nudges !== false,
    tz: d.tz,
    tzOffset: d.tzOffset,
  };
}

/** Local date (YYYY-MM-DD) and minutes since local midnight. */
export function localClock(
  now: number,
  tz: string | undefined,
  tzOffset: number | undefined,
): { date: string; minutes: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(now));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
      return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        minutes: Number(get('hour')) * 60 + Number(get('minute')),
      };
    } catch {
      // Unknown zone: fall through to the fixed offset.
    }
  }
  const d = new Date(now - (tzOffset ?? -180) * 60_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Same rules as `computeStreak` in src/engine/game.ts (a test keeps them identical): a freeze is
 * earned every 7 days of streak, at most 2 banked, spent automatically on a missed day.
 */
export function streakToday(
  days: readonly { date: string; goalReached: boolean }[],
  today: string,
): { current: number; pendingToday: boolean } {
  const reached = new Set(days.filter((d) => d.goalReached).map((d) => d.date));
  const first = [...reached].sort()[0];
  if (!first) return { current: 0, pendingToday: false };
  let streak = 0;
  let freezes = 0;
  let pendingToday = false;
  for (let date = first; date <= today; date = addDays(date, 1)) {
    if (reached.has(date)) {
      streak++;
      if (streak % 7 === 0) freezes = Math.min(2, freezes + 1);
    } else if (date === today) {
      pendingToday = streak > 0;
    } else if (streak > 0 && freezes > 0) {
      freezes--;
    } else {
      streak = 0;
    }
  }
  return { current: streak, pendingToday };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 20) * 60 + (m ?? 0);
}

function reminderMessage(user: UserId, rival: { xp: number; goalReached: boolean } | null) {
  const other = rival ? otherUser(user) : null;
  let body = 'חמש דקות של מילים, והיום נסגר';
  if (other && rival?.goalReached) {
    body = `${NAMES[other]} ${FEMALE[other] ? 'כבר סגרה' : 'כבר סגר'} את היעד היום. תורך`;
  } else if (other && rival && rival.xp > 0) {
    body = `${NAMES[other]} כבר ב-${rival.xp} XP היום. חמש דקות ונכנסים לתמונה`;
  }
  return { kind: 'reminder' as const, title: 'LexBites', body, url: './', tag: 'lexbites-daily' };
}

function streakMessage(days: number): PushMessage {
  return {
    kind: 'streak',
    title: 'הרצף בסכנה 🔥',
    body:
      days > 1
        ? `${days} ימים ברצף, והיעד של היום עוד פתוח. חמש דקות ונגמר הסיפור`
        : 'הרצף רק התחיל, והיעד של היום עוד פתוח. חמש דקות ונגמר הסיפור',
    url: './',
    tag: 'lexbites-daily',
  };
}

export function otherUser(u: UserId): UserId {
  return u === 'rotem' ? 'noa' : 'rotem';
}

export interface ScheduleInput {
  now: number;
  prefs: PushPrefs;
  state: PushState;
  /** All daily rows of this user (date, xp, goalReached). */
  days: readonly DayRow[];
  /** The rival's row for the same local date, if any. */
  rivalToday: { xp: number; goalReached: boolean } | null;
}

/** Scheduled messages due now, and the state to store afterwards. */
export function planScheduled(input: ScheduleInput): {
  messages: PushMessage[];
  state: PushState;
} {
  const { now, prefs, days, rivalToday } = input;
  const state: PushState = { ...input.state };
  const { date, minutes } = localClock(now, prefs.tz, prefs.tzOffset);
  const reached = days.some((d) => d.date === date && d.goalReached);
  const streak = streakToday(days, date);
  const recentlySent = state.lastAt !== undefined && now - state.lastAt < MIN_GAP_MS;

  const target = prefs.reminderTime ? toMinutes(prefs.reminderTime) : null;
  const reminderDue =
    target !== null &&
    state.reminder !== date &&
    minutes >= target &&
    minutes < target + REMINDER_WINDOW;
  const streakDue =
    prefs.streakAlert &&
    state.streak !== date &&
    minutes >= STREAK_ALERT_MINUTES &&
    minutes < STREAK_WINDOW_END;

  const messages: PushMessage[] = [];
  if (streakDue) {
    state.streak = date;
    if (!reached && streak.pendingToday) {
      // The streak alert says everything the daily reminder would, so it replaces it today.
      if (reminderDue || !recentlySent) {
        messages.push(streakMessage(streak.current));
        state.streakSent = date;
      }
      if (reminderDue) state.reminder = date;
    }
  }
  if (reminderDue && state.reminder !== date) {
    state.reminder = date;
    // After a streak alert today, a later daily reminder would only nag.
    if (!reached && state.streakSent !== date && !recentlySent) {
      messages.push(reminderMessage(prefs.userId, rivalToday));
    }
  }
  if (messages.length) state.lastAt = now;
  return { messages, state };
}

export interface NudgeEvent {
  type: string;
  userId: UserId;
  to?: UserId;
  payload?: { emoji?: unknown };
  at: number;
}

/** The push for a rival nudge, or null when it should not be pushed. */
export function nudgeMessage(ev: NudgeEvent, now: number): PushMessage | null {
  if (ev.type !== 'nudge' || !ev.to || ev.to === ev.userId) return null;
  if (ev.userId !== 'rotem' && ev.userId !== 'noa') return null;
  if (!(now - ev.at < NUDGE_MAX_AGE_MS)) return null;
  const emoji = typeof ev.payload?.emoji === 'string' ? ev.payload.emoji.slice(0, 8) : '👋';
  const from = ev.userId;
  return {
    kind: 'nudge',
    title: NAMES[from],
    body: `${NAMES[from]} ${FEMALE[from] ? 'שלחה' : 'שלח'} לך ${emoji}`,
    url: './rivalry',
    tag: `lexbites-nudge-${from}`,
  };
}

export const TEST_MESSAGE: PushMessage = {
  kind: 'test',
  title: 'LexBites',
  body: 'ככה נראית תזכורת. ההתראות עובדות ✓',
  url: './',
  tag: 'lexbites-test',
};
