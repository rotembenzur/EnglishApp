/**
 * Web push (spec 9.6, SETUP.md step 4). The phone subscribes with the VAPID public key and stores
 * the subscription plus its reminder choices in lb_push; the lexbites-push Edge Function sends
 * daily reminders, streak alerts and rival nudges (supabase/functions/lexbites-push).
 * The section stays hidden behind its status until sync is connected and the function reports
 * ready, so nothing breaks before the owner adds the push secrets.
 */
import type { UserId } from '@/engine/types';
import { deviceId, getKv, setKv } from '@/data/db';
import { loadConfig, useSync, type SyncConfig } from './engine';
import { PUSH_FUNCTION, VAPID_PUBLIC_KEY } from './config';

export type PushAvailability =
  /** Sync is not connected on this phone yet. */
  | 'no-sync'
  /** iPhone Safari tab: push works only from the home screen app. */
  | 'needs-install'
  /** The browser has no web push (iOS below 16.4, some desktop browsers). */
  | 'unsupported'
  /** The push server is not deployed or not reachable. */
  | 'server-off'
  /** The user blocked notifications for the app in iOS Settings. */
  | 'denied'
  | 'ready';

export interface PushPrefs {
  enabled: boolean;
  /** 'HH:MM', or null for no daily reminder. */
  reminderTime: string | null;
  streakAlert: boolean;
  nudges: boolean;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: false,
  reminderTime: '20:00',
  streakAlert: true,
  nudges: true,
};

const PREFS_KEY = 'pushPrefs';
const SAVED_KEY = 'pushSaved';

export async function loadPushPrefs(): Promise<PushPrefs> {
  return { ...DEFAULT_PUSH_PREFS, ...(await getKv<Partial<PushPrefs>>(PREFS_KEY, {})) };
}

function functionUrl(cfg: { url: string }): string {
  return `${cfg.url.replace(/\/+$/, '')}/functions/v1/${PUSH_FUNCTION}`;
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function browserSupportsPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Whether the Edge Function is deployed and has its VAPID key (GET, no auth). */
export async function pushServerReady(
  cfg: { url: string } | null,
  f: typeof fetch = fetch,
): Promise<boolean> {
  if (!cfg) return false;
  try {
    const res = await f(functionUrl(cfg), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ready?: boolean };
    return body.ready === true;
  } catch {
    return false;
  }
}

export async function pushAvailability(): Promise<PushAvailability> {
  if (!useSync.getState().configured) return 'no-sync';
  if (!browserSupportsPush()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (!(await pushServerReady(await loadConfig()))) return 'server-off';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

function b64urlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const b64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** False only when the subscription is known to use another key (older Safari omits options). */
function keyMatches(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true;
  const x = new Uint8Array(current);
  return x.length === key.length && x.every((v, i) => v === key[i]);
}

async function subscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  const key = b64urlToBytes(VAPID_PUBLIC_KEY);
  const existing = await reg.pushManager.getSubscription();
  if (existing && keyMatches(existing, key)) return existing;
  // A subscription made with another key (an older build) cannot receive our pushes.
  if (existing) await existing.unsubscribe().catch(() => false);
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function restHeaders(cfg: SyncConfig, extra: Record<string, string> = {}) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'x-lexbites-key': cfg.keyHash,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** The row the Edge Function reads (supabase/functions/_shared/schedule.ts, PushPrefs). */
export function pushRowData(
  sub: PushSubscriptionJSON,
  userId: UserId,
  prefs: PushPrefs,
  now = new Date(),
) {
  return {
    subscription: sub,
    userId,
    reminderTime: prefs.reminderTime,
    streakAlert: prefs.streakAlert,
    nudges: prefs.nudges,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffset: now.getTimezoneOffset(),
    appVersion: __APP_VERSION__,
  };
}

async function saveRow(cfg: SyncConfig, sub: PushSubscription, userId: UserId, prefs: PushPrefs) {
  const data = pushRowData(sub.toJSON(), userId, prefs);
  const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/rest/v1/lb_push?on_conflict=endpoint`, {
    method: 'POST',
    headers: restHeaders(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([
      {
        endpoint: sub.endpoint,
        user_id: userId,
        data,
        updated_at: Date.now(),
        device_id: await deviceId(),
      },
    ]),
  });
  if (res.ok) await setKv(SAVED_KEY, { sig: JSON.stringify(data), at: Date.now() });
  return res.ok;
}

async function deleteRow(cfg: SyncConfig, endpoint: string) {
  await fetch(
    `${cfg.url.replace(/\/+$/, '')}/rest/v1/lb_push?endpoint=eq.${encodeURIComponent(endpoint)}`,
    { method: 'DELETE', headers: restHeaders(cfg, { Prefer: 'return=minimal' }) },
  ).catch(() => undefined);
}

export type EnableResult = 'ok' | 'denied' | 'failed';

/**
 * Turn notifications on. Call straight from a tap: iOS shows the permission prompt only inside a
 * user gesture, so nothing is awaited before requesting it.
 */
export async function enablePush(userId: UserId, prefs: PushPrefs): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const cfg = await loadConfig();
    if (!cfg) return 'failed';
    const sub = await subscription();
    const next = { ...prefs, enabled: true };
    if (!(await saveRow(cfg, sub, userId, next))) return 'failed';
    await setKv(PREFS_KEY, next);
    return 'ok';
  } catch {
    return 'failed';
  }
}

/** Save changed choices (time, streak alert, nudges) for an enabled phone. */
export async function updatePushPrefs(userId: UserId, prefs: PushPrefs): Promise<boolean> {
  await setKv(PREFS_KEY, prefs);
  if (!prefs.enabled) return true;
  return refreshPush(userId, true);
}

export async function disablePush(): Promise<void> {
  await setKv(PREFS_KEY, { ...(await loadPushPrefs()), enabled: false });
  await setKv(SAVED_KEY, null);
  if (!browserSupportsPush()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const cfg = await loadConfig();
  if (cfg) await deleteRow(cfg, sub.endpoint);
  await sub.unsubscribe().catch(() => false);
}

/**
 * On app open and profile switch: keep the stored subscription current. iOS can rotate the
 * endpoint, the phone can change time zone, and the profile on this phone can change. Writes only
 * when something changed or once a day.
 */
export async function refreshPush(userId: UserId, force = false): Promise<boolean> {
  try {
    const prefs = await loadPushPrefs();
    if (!prefs.enabled || !browserSupportsPush() || Notification.permission !== 'granted') {
      return false;
    }
    const cfg = await loadConfig();
    if (!cfg) return false;
    const sub = await subscription();
    const sig = JSON.stringify(pushRowData(sub.toJSON(), userId, prefs));
    const saved = await getKv<{ sig: string; at: number } | null>(SAVED_KEY, null);
    if (!force && saved?.sig === sig && Date.now() - saved.at < 86400_000) return true;
    return await saveRow(cfg, sub, userId, prefs);
  } catch {
    return false;
  }
}

/** Ask the server to send a test notification to this phone. */
export async function sendTestPush(): Promise<boolean> {
  try {
    const cfg = await loadConfig();
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!cfg || !sub) return false;
    const res = await fetch(functionUrl(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lexbites-key': cfg.keyHash },
      body: JSON.stringify({ kind: 'test', endpoint: sub.endpoint }),
    });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/** Whether this phone currently has a live subscription (the toggle shows this). */
export async function pushActive(): Promise<boolean> {
  if (!browserSupportsPush() || Notification.permission !== 'granted') return false;
  if (!(await loadPushPrefs()).enabled) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
