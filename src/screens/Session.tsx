import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SessionMode } from '@/engine/session';
import { comboMultiplier } from '@/engine/game';
import { t } from '@/i18n/he';
import { useSession } from '@/session/runner';
import { unlockAudio, stopAudio } from '@/audio/speech';
import { syncNow } from '@/sync/engine';
import { Bar, Button, Sheet } from '@/ui/kit';
import { CloseIcon } from '@/ui/icons';
import { CapCard } from '@/ui/CapCard';
import { useCapReached } from '@/ui/cap';
import { ExerciseView } from './session/ExerciseView';
import { Summary } from './session/Summary';
import { sfx } from '@/audio/sfx';
import { schedulePrefetch } from '@/session/prefetch';
import { duelLemmaIds, todayDuel } from '@/session/duel';
import { todayKey, useApp } from '@/state/app';
import { hashString } from '@/engine/rng';
import { prepareTextPractice } from '@/session/textPractice';

const MODES: SessionMode[] = ['learn', 'review', 'hard', 'listening', 'speed', 'boss'];

export function Session() {
  const { mode } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const status = useSession((s) => s.status);
  const exercise = useSession((s) => s.exercise);
  const feedback = useSession((s) => s.feedback);
  const built = useSession((s) => s.built);
  const index = useSession((s) => s.index);
  const combo = useSession((s) => s.combo);
  const deadline = useSession((s) => s.deadline);
  const start = useSession((s) => s.start);
  const resume = useSession((s) => s.resume);
  const abandon = useSession((s) => s.abandon);
  const finish = useSession((s) => s.finish);
  const [confirmExit, setConfirmExit] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    unlockAudio();
    if (mode === 'resume') {
      void resume().then((ok) => {
        if (!ok) nav('/', { replace: true });
      });
    } else if (mode === 'duel') {
      void (async () => {
        const me = useApp.getState().userId;
        if (!me || (await todayDuel(me))) return nav('/rivalry', { replace: true });
        await start('duel', {
          lemmaIds: await duelLemmaIds(todayKey()),
          seed: hashString(todayKey()),
        });
      })();
    } else if (mode === 'text') {
      void (async () => {
        const app = useApp.getState();
        const id = search.get('id');
        const prep =
          id && app.userId
            ? await prepareTextPractice(id, app.userId, app.words, { online: navigator.onLine })
            : null;
        if (!prep || !id) return nav('/texts', { replace: true });
        await start('text', { lemmaIds: prep.lemmaIds, text: { id, sentences: prep.sentences } });
      })();
    } else if (mode && MODES.includes(mode as SessionMode)) {
      void start(mode as SessionMode);
    } else nav('/', { replace: true });
    return () => {
      stopAudio();
    };
  }, [mode, start, resume, nav, search]);

  useEffect(() => {
    if (status === 'done') {
      void syncNow();
      schedulePrefetch(1500);
    }
  }, [status]);

  const exit = async () => {
    setConfirmExit(false);
    stopAudio();
    await abandon();
    void syncNow();
    nav('/', { replace: true });
  };

  const requestExit = () => {
    // Confirm only when an item is on screen and unanswered (spec 8.2).
    if (status === 'running' && exercise && !feedback && exercise.kind !== 'intro')
      setConfirmExit(true);
    else void exit();
  };

  if (status === 'done') return <Summary onAgain={(m) => void start(m)} />;

  const total = built?.plan.length ?? 1;
  return (
    <div
      className="mx-auto flex h-full w-full max-w-md flex-col"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-label={t.common.close}
          onClick={requestExit}
          className="tap -ms-2 grid place-items-center rounded-full text-ink-3"
        >
          <CloseIcon />
        </button>
        <Bar value={index + (feedback ? 1 : 0)} max={total} className="h-3 flex-1" />
        {combo >= 3 && (
          <span
            key={combo}
            className="animate-pop rounded-pill bg-warn-soft px-2 py-0.5 text-xs font-black text-ink"
            dir="ltr"
          >
            ×{comboMultiplier(combo)}
          </span>
        )}
        {deadline && <Countdown deadline={deadline} onEnd={() => void finish()} />}
      </div>

      <div className="scroll-pane flex flex-1 flex-col px-4 pb-4">
        {(status === 'building' || status === 'idle') && (
          <div
            className="flex flex-1 flex-col gap-4 pt-6"
            aria-busy="true"
            aria-label={t.session.building}
          >
            <div className="h-6 w-24 animate-pulse-soft rounded-pill bg-card" />
            <div className="h-40 animate-pulse-soft rounded-[1.25rem] bg-card" />
            <div className="h-16 animate-pulse-soft rounded-2xl bg-card" />
            <div className="h-16 animate-pulse-soft rounded-2xl bg-card" />
          </div>
        )}
        {status === 'empty' && (
          <EmptySession
            mode={built?.mode ?? 'learn'}
            onLearn={() => void start('learn')}
            onHome={() => nav('/', { replace: true })}
          />
        )}
        {status === 'running' && exercise && (
          <ExerciseView
            key={exercise.item.key + ':' + index}
            exercise={exercise}
            mode={built?.mode ?? 'learn'}
            onSfx={sfx}
          />
        )}
      </div>

      <Sheet open={confirmExit} onClose={() => setConfirmExit(false)}>
        <p className="mb-5 text-lg font-semibold">{t.session.exitConfirm}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setConfirmExit(false)}>
            {t.session.exitNo}
          </Button>
          <Button variant="danger" onClick={() => void exit()}>
            {t.session.exitYes}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** A mode with nothing to play explains why and offers the way forward (never a dead end). */
function EmptySession({
  mode,
  onLearn,
  onHome,
}: {
  mode: SessionMode;
  onLearn: () => void;
  onHome: () => void;
}) {
  const capReached = useCapReached();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
      data-testid="session-empty"
    >
      <p className="text-5xl">🌤️</p>
      <p className="text-xl font-bold">{t.session.empty}</p>
      <p className="text-ink-2">{t.session.emptyBy[mode] ?? t.session.emptyBody}</p>
      {capReached && (
        <div className="w-full text-start">
          <CapCard onRaised={onLearn} />
        </div>
      )}
      <div className="flex gap-3">
        {mode !== 'learn' && mode !== 'duel' && (
          <Button onClick={onLearn}>{t.session.emptyLearn}</Button>
        )}
        <Button variant="outline" onClick={onHome}>
          {t.summary.home}
        </Button>
      </div>
    </div>
  );
}

function Countdown({ deadline, onEnd }: { deadline: number; onEnd: () => void }) {
  const [left, setLeft] = useState(Math.max(0, deadline - Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => {
      const l = Math.max(0, deadline - Date.now());
      setLeft(l);
      if (l === 0) {
        window.clearInterval(id);
        onEnd();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [deadline, onEnd]);
  return (
    <span
      className={`min-w-14 text-center text-sm font-black tabular-nums ${left < 10_000 ? 'text-bad' : 'text-ink-2'}`}
    >
      {t.session.secondsLeft(Math.ceil(left / 1000))}
    </span>
  );
}
