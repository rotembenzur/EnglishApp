import { CAP_BONUS_STEP, newWordsLeft } from '@/engine/selection';
import { bumpDaily } from '@/data/repo';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { toast } from './toast';

/** True once today's new words (setting plus any bonus) are all in. */
export function useCapReached(): boolean {
  const profile = useApp((s) => s.profile);
  const today = useApp((s) => s.today);
  if (!profile?.ability) return false;
  return newWordsLeft(profile.settings.newPerDay, today?.newWords ?? 0, today?.bonusNew) === 0;
}

/** Raises today's cap by CAP_BONUS_STEP, for today only (the setting is untouched). */
export async function raiseTodayCap(): Promise<void> {
  const app = useApp.getState();
  if (!app.userId || !app.profile) return;
  const { after } = await bumpDaily(
    app.userId,
    todayKey(),
    { bonusNew: CAP_BONUS_STEP },
    app.profile.settings.dailyGoal,
  );
  app.setToday(after);
  toast(t.cap.raised, { tone: 'good', icon: '✨' });
}
