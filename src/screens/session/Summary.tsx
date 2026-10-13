import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionMode } from '@/engine/session';
import type { WordContent } from '@/engine/types';
import { getContent } from '@/content/inventory';
import { levelTitle, t } from '@/i18n/he';
import { levelForXp } from '@/engine/game';
import { allDaily } from '@/data/repo';
import { useLive } from '@/state/live';
import { useSession } from '@/session/runner';
import { useApp } from '@/state/app';
import { sfx } from '@/audio/sfx';
import { Button, En, Speak } from '@/ui/kit';
import { audioUrls } from '@/ui/word-utils';
import { Confetti } from '@/ui/Confetti';
import { He } from '@/ui/bidi';
import { RivalCard } from '../Home';
import { shareSessionCard } from '@/ui/share';

export function Summary({ onAgain }: { onAgain: (m: SessionMode) => void }) {
  const nav = useNavigate();
  const s = useSession((st) => st.summary)!;
  const name = useApp((st) => st.profile?.name ?? '');
  const accuracy = s.graded ? Math.round((s.correct / s.graded) * 100) : 0;
  const [wos, setWos] = useState<WordContent | null>(null);
  const highlightId = useMemo(
    () => s.newLearned[0] ?? s.introduced[0] ?? s.missed[0] ?? s.strengthened[0],
    [s],
  );
  useEffect(() => {
    if (highlightId) void getContent(highlightId).then(setWos);
  }, [highlightId]);
  useEffect(() => {
    if (s.goalReachedNow) sfx('goal');
  }, [s.goalReachedNow]);
  const delta = s.thetaAfter - s.thetaBefore;
  const userId = useApp((st) => st.userId);
  const totalXp = useLive(
    async () => (userId ? (await allDaily(userId)).reduce((a, d) => a + d.xp, 0) : 0),
    [userId],
  );
  const levelUp =
    totalXp !== undefined &&
    s.xp > 0 &&
    levelForXp(totalXp).level > levelForXp(totalXp - s.xp).level;
  useEffect(() => {
    if (levelUp) sfx('level');
  }, [levelUp]);
  const celebrate = s.goalReachedNow || s.perfect || s.badges.length > 0 || levelUp;

  return (
    <div
      className="mx-auto flex h-full w-full max-w-md flex-col"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      {celebrate && <Confetti />}
      <div className="scroll-pane flex flex-1 flex-col gap-5 px-4 pb-6 pt-6">
        <div className="text-center">
          <p className="text-5xl">{s.perfect ? '💎' : s.goalReachedNow ? '🎯' : '🎉'}</p>
          <h1 className="mt-2 text-3xl font-extrabold">
            {s.perfect ? t.summary.perfect : t.summary.title}
          </h1>
          {s.goalReachedNow && (
            <p className="mt-1 font-semibold text-good">{t.summary.goalReached}</p>
          )}
          {levelUp && totalXp !== undefined && (
            <p className="mt-2 animate-pop text-lg font-extrabold text-accent">
              ⬆️ {t.celebrate.levelUp(levelTitle(levelForXp(totalXp).level))}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Tile value={`+${s.xp}`} label={t.summary.xp} />
          <Tile value={`${accuracy}%`} label={t.summary.accuracy} />
          {s.mode === 'speed' ? (
            <Tile value={String(s.speedScore ?? 0)} label={t.summary.speedCorrect} />
          ) : (
            <Tile
              value={String(s.newLearned.length || s.introduced.length)}
              label={t.summary.newWords}
            />
          )}
        </div>
        {s.strengthened.length > 0 && (
          <p className="text-center text-sm text-ink-2">
            {t.summary.strengthened}: <strong>{s.strengthened.length}</strong>
          </p>
        )}
        {Math.abs(delta) >= 0.05 && (
          <p className="text-center text-xs text-ink-3">{t.summary.levelMoved(delta)}</p>
        )}

        {s.badges.length > 0 && (
          <div className="card flex flex-col gap-2 p-4">
            <p className="text-sm font-bold text-ink-3">{t.summary.newBadge}</p>
            {s.badges.map((b) => (
              <p key={b} className="animate-pop text-lg font-bold">
                🏅 {t.badges[b]?.[0] ?? b}
                <span className="ms-2 text-sm font-normal text-ink-2">{t.badges[b]?.[1]}</span>
              </p>
            ))}
          </div>
        )}

        {wos && (
          <div className="card flex flex-col gap-2 p-4">
            <p className="text-xs font-bold uppercase text-ink-3">{t.summary.wordOfSession}</p>
            <div className="flex items-center gap-3">
              <En className="flex-1 text-3xl font-bold">{wos.lemma}</En>
              <Speak text={wos.lemma} urls={audioUrls(wos)} isWord />
            </div>
            <He className="font-semibold text-ink-2">{wos.hebrew.join(' · ')}</He>
            {wos.sentences[0] && (
              <div className="flex items-start gap-2">
                <En className="flex-1 text-sm text-ink-2">{wos.sentences[0].en}</En>
                <Speak text={wos.sentences[0].en} size="sm" />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-3">{t.summary.vsRival}</p>
          <RivalCard compact />
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-3 px-4 pb-4">
        <Button
          variant="ghost"
          aria-label={t.summary.share}
          onClick={() =>
            void shareSessionCard({
              name,
              xp: s.xp,
              accuracy,
              words: s.introduced.length,
              mode: s.mode,
            })
          }
        >
          ↗
        </Button>
        <Button variant="outline" onClick={() => nav('/', { replace: true })}>
          {t.summary.home}
        </Button>
        <Button onClick={() => onAgain(s.mode === 'duel' ? 'learn' : s.mode)}>
          {t.summary.again}
        </Button>
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 p-3">
      <span className="text-2xl font-black" dir="ltr">
        {value}
      </span>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}
