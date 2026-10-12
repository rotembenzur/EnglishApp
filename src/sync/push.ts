/**
 * Web push (spec 9.6), behind a feature flag: shown only when a VAPID public key is configured
 * (VITE_VAPID_PUBLIC_KEY at build time), sync is configured, and the browser supports push
 * (iOS 16.4+ in standalone mode). Subscriptions are stored in the lb_push table; the scheduled
 * GitHub Actions workflow `push-reminders.yml` sends the reminders.
 */
import type { UserId } from '@/engine/types';
import { deviceId } from '@/data/db';
import { loadConfig, useSync } from './engine';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return (
    !!VAPID &&
    useSync.getState().configured &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(userId: UserId, reminderTime: string): Promise<boolean> {
  if (!pushSupported() || !VAPID) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID),
    }));
  const cfg = await loadConfig();
  if (!cfg) return false;
  const tzOffset = new Date().getTimezoneOffset();
  const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/rest/v1/lb_push?on_conflict=endpoint`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'x-lexbites-key': cfg.keyHash,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        endpoint: sub.endpoint,
        user_id: userId,
        data: { subscription: sub.toJSON(), userId, reminderTime, tzOffset },
        updated_at: Date.now(),
        device_id: await deviceId(),
      },
    ]),
  });
  return res.ok;
}
