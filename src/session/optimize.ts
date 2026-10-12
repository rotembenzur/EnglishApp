/** Weekly on-device FSRS personalization (spec 4.5), run when the app is idle. */
import { MIN_REVIEWS, optimizeFor } from '@/engine/optimizer';
import { db } from '@/data/db';
import { saveProfile } from '@/data/repo';
import { useApp } from '@/state/app';

const WEEK = 7 * 86_400_000;

export function scheduleWeeklyOptimize(): void {
  window.setTimeout(() => {
    const run = async () => {
      const { profile } = useApp.getState();
      if (!profile || Date.now() - (profile.fsrsOptimizedAt ?? 0) < WEEK) return;
      const reviews = await db.reviews.where('userId').equals(profile.id).toArray();
      if (reviews.length < MIN_REVIEWS) return;
      const w = optimizeFor(reviews);
      const latest = useApp.getState().profile;
      if (!latest || latest.id !== profile.id) return;
      // Record the attempt even without improvement so it runs at most weekly.
      const next = await saveProfile({
        ...latest,
        ...(w ? { fsrsW: w } : {}),
        fsrsOptimizedAt: Date.now(),
      });
      useApp.getState().setProfile(next);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => void run());
    else void run();
  }, 15_000);
}
