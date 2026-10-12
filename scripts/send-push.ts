/**
 * Push reminder sender (spec 9.6), run by .github/workflows/push-reminders.yml every 30 minutes.
 * Reads subscriptions and today's stats from the sync backend and sends, per subscriber:
 *  - the daily reminder at the chosen time (mentioning the rival's XP when it helps),
 *  - "your streak is at risk" at 20:00 local if the daily goal is not reached,
 *  - rival nudges received since the last run.
 * Each message is sent at most once per day per device (tracked in the subscription row).
 */
import webpush from 'web-push';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.info(`push: ${k} not configured, nothing to do`);
    process.exit(0);
  }
  return v;
};

const url = env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/';
const anon = env('SUPABASE_ANON_KEY');
const keyHash = env('LEXBITES_KEY_HASH');
webpush.setVapidDetails(
  'mailto:noreply@lexbites.app',
  env('VITE_VAPID_PUBLIC_KEY'),
  env('VAPID_PRIVATE_KEY'),
);

const headers = {
  apikey: anon,
  Authorization: `Bearer ${anon}`,
  'x-lexbites-key': keyHash,
  'Content-Type': 'application/json',
};

interface PushRow {
  endpoint: string;
  user_id: 'rotem' | 'noa';
  data: {
    subscription: webpush.PushSubscription;
    reminderTime: string;
    tzOffset: number;
    sent?: Record<string, string>;
    lastNudgeAt?: number;
  };
}

const NAMES = { rotem: 'רתם', noa: 'נועה' } as const;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(url + path, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

function localNow(tzOffset: number): { date: string; minutes: number } {
  const d = new Date(Date.now() - tzOffset * 60000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

async function main() {
  const subs = await get<PushRow[]>('lb_push?select=endpoint,user_id,data');
  let sent = 0;
  for (const s of subs) {
    const { date, minutes } = localNow(s.data.tzOffset ?? -180);
    const rival = s.user_id === 'rotem' ? 'noa' : 'rotem';
    const rows = await get<
      { user_id: string; data: { xp: number; goal: number; goalReached: boolean } }[]
    >(`lb_daily?select=user_id,data&date=eq.${date}`);
    const mine = rows.find((r) => r.user_id === s.user_id)?.data;
    const theirs = rows.find((r) => r.user_id === rival)?.data;
    const sentMap = { ...(s.data.sent ?? {}) };
    const messages: { kind: string; title: string; body: string }[] = [];
    const [h, m] = (s.data.reminderTime ?? '20:00').split(':').map(Number);
    const target = (h ?? 20) * 60 + (m ?? 0);
    if (
      !mine?.goalReached &&
      minutes >= target &&
      minutes < target + 30 &&
      sentMap.reminder !== date
    ) {
      const body =
        theirs && theirs.xp > 0
          ? `${NAMES[rival]} כבר ב־${theirs.xp} XP היום. חמש דקות ${s.user_id === 'noa' ? 'ואת' : 'ואתה'} בפנים`
          : 'חמש דקות של מילים, והיום נסגר';
      messages.push({ kind: 'reminder', title: 'LexBites', body });
    }
    if (
      !mine?.goalReached &&
      minutes >= 20 * 60 &&
      minutes < 20 * 60 + 30 &&
      sentMap.streak !== date
    ) {
      messages.push({
        kind: 'streak',
        title: 'הרצף בסכנה 🔥',
        body: 'עוד לא הגעת ליעד היום. סשן קצר והרצף נשמר',
      });
    }
    const since = s.data.lastNudgeAt ?? Date.now() - 3600_000;
    const nudges = await get<
      {
        data: { type: string; userId: string; to: string; payload: { emoji?: string }; at: number };
      }[]
    >(`lb_events?select=data&user_id=eq.${rival}&updated_at=gt.${since}`);
    let lastNudgeAt = since;
    for (const n of nudges) {
      if (n.data.type !== 'nudge' || n.data.to !== s.user_id) continue;
      messages.push({
        kind: 'nudge',
        title: NAMES[rival],
        body: `${n.data.payload.emoji ?? '👋'} נקירה מ${NAMES[rival]}`,
      });
      lastNudgeAt = Math.max(lastNudgeAt, n.data.at);
    }
    for (const msg of messages) {
      try {
        await webpush.sendNotification(
          s.data.subscription,
          JSON.stringify({ title: msg.title, body: msg.body, url: './' }),
        );
        sent++;
        if (msg.kind !== 'nudge') sentMap[msg.kind] = date;
      } catch (e) {
        console.error(`push failed for ${s.user_id}: ${(e as Error).message}`);
      }
    }
    if (messages.length) {
      await fetch(`${url}lb_push?on_conflict=endpoint`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([
          {
            endpoint: s.endpoint,
            user_id: s.user_id,
            data: { ...s.data, sent: sentMap, lastNudgeAt },
            updated_at: Date.now(),
            device_id: 'push-sender',
          },
        ]),
      });
    }
  }
  console.info(`push: ${subs.length} subscription(s), ${sent} message(s) sent`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
