import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkTyping,
  levenshtein,
  diffSpelling,
  chooseDistractors,
  buildOptions,
  SPEED_ITEM_MS,
} from '@/engine/exercises';
import { createRng } from '@/engine/rng';
import type { SessionMode } from '@/engine/session';
import type { GradedType } from '@/engine/types';
import { t } from '@/i18n/he';
import { useSession, type Feedback } from '@/session/runner';
import { toOptionWord, type Exercise } from '@/session/exercise';
import { useApp } from '@/state/app';
import { isAudioUnlocked, playWord, speak } from '@/audio/speech';
import type { Sfx } from '@/audio/sfx';
import { buzz } from '@/audio/sfx';
import { Bar, Button, En, Pill, Speak } from '@/ui/kit';
import { WordCard } from '@/ui/WordCard';
import { audioUrls, highlight } from '@/ui/word-utils';
import { SpeakerIcon } from '@/ui/icons';

type OnSfx = (s: Sfx) => void;

export function ExerciseView({
  exercise,
  mode,
  onSfx,
}: {
  exercise: Exercise;
  mode: SessionMode;
  onSfx: OnSfx;
}) {
  switch (exercise.kind) {
    case 'intro':
      return <Intro ex={exercise} />;
    case 'choice':
      return <Choice ex={exercise} mode={mode} onSfx={onSfx} />;
    case 'typing':
      return <Typing ex={exercise} onSfx={onSfx} />;
    case 'cloze':
      return <ClozeView ex={exercise} onSfx={onSfx} />;
    case 'match':
      return <Match ex={exercise} onSfx={onSfx} />;
  }
}

function useSpeakOpts() {
  const s = useApp((st) => st.profile?.settings);
  return {
    accent: s?.accent ?? 'us',
    ...(s?.voiceURI ? { voiceURI: s.voiceURI } : {}),
    rate: s?.speechRate ?? 0.95,
    autoplay: s?.autoplay ?? true,
  };
}

/** Auto-play the word once the session's first gesture unlocked audio (spec 4.7.1, 5.3). */
function useAutoplay(text: string, urls: { us?: string; uk?: string }, enabled: boolean) {
  const opts = useSpeakOpts();
  useEffect(() => {
    if (!enabled || !opts.autoplay || !isAudioUnlocked()) return;
    const id = window.setTimeout(() => void playWord(text, urls, opts), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled]);
}

function RoleTag({ ex }: { ex: Exercise }) {
  if (ex.item.role === 'probe')
    return <Pill className="self-start bg-card-2 text-ink-3">{t.session.probe}</Pill>;
  if (ex.item.role === 'intro')
    return <Pill className="self-start bg-accent-soft text-accent">{t.session.newWord}</Pill>;
  return null;
}

// ---------------------------------------------------------------------------
// Intro card with "I already know this" verification
// ---------------------------------------------------------------------------

function Intro({ ex }: { ex: Extract<Exercise, { kind: 'intro' }> }) {
  const acknowledge = useSession((s) => s.acknowledgeIntro);
  const verifyKnown = useSession((s) => s.verifyKnown);
  const built = useSession((s) => s.built);
  const [verify, setVerify] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<'pass' | 'fail' | null>(null);
  const shownAt = useRef(Date.now());
  useAutoplay(ex.word.lemma, audioUrls(ex.word), true);

  const options = useMemo(() => {
    if (!built) return null;
    const rng = createRng(ex.word.lemmaId * 31);
    const target = toOptionWord(ex.word, built.infos.get(ex.word.lemmaId));
    const ds = chooseDistractors(target, built.pool, 3, rng);
    return ds.length === 3 ? buildOptions(target, ds, 'he', rng) : null;
  }, [built, ex.word]);

  if (verify && options) {
    return (
      <div className="flex flex-1 animate-fade-up flex-col gap-6 pt-6">
        <p className="text-center text-ink-2">{t.session.verifyTitle}</p>
        <En className="text-center text-4xl font-bold">{ex.word.lemma}</En>
        <Options
          labels={options.options.map((o) => o.label)}
          correct={options.correctIndex}
          picked={picked}
          dirAttr="rtl"
          onPick={(i) => {
            if (picked !== null) return;
            setPicked(i);
            const ok = i === options.correctIndex;
            setResult(ok ? 'pass' : 'fail');
            window.setTimeout(() => void verifyKnown(ok, Date.now() - shownAt.current), 1100);
          }}
        />
        {result && (
          <p
            className={`text-center font-semibold ${result === 'pass' ? 'text-good' : 'text-ink-2'}`}
          >
            {result === 'pass' ? t.session.verifyPass : t.session.verifyFail}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 animate-fade-up flex-col gap-5 pt-2">
      <RoleTag ex={ex} />
      <WordCard word={ex.word} />
      <div className="mt-auto grid grid-cols-[1fr_2fr] gap-3 pt-2">
        <Button variant="outline" onClick={() => setVerify(true)} disabled={!options}>
          {t.session.alreadyKnow}
        </Button>
        <Button onClick={() => void acknowledge()} autoFocus>
          {t.session.gotIt}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared option list with keyboard shortcuts 1-4
// ---------------------------------------------------------------------------

function Options({
  labels,
  correct,
  picked,
  onPick,
  dirAttr,
  large = false,
}: {
  labels: string[];
  correct: number;
  picked: number | null;
  onPick: (i: number) => void;
  dirAttr: 'ltr' | 'rtl';
  large?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= labels.length) onPick(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labels.length, onPick]);
  return (
    <div className={`grid gap-2.5 ${large ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {labels.map((label, i) => {
        const done = picked !== null;
        const state = done && i === correct ? 'right' : done && i === picked ? 'wrong' : 'idle';
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            disabled={done}
            dir={dirAttr}
            className={`tap flex items-center gap-3 rounded-2xl border-2 px-4 text-start font-medium transition ${large ? 'min-h-24 justify-center text-center text-xl' : 'py-3.5 text-lg'} ${
              state === 'right'
                ? 'animate-pop border-good bg-good-soft'
                : state === 'wrong'
                  ? 'animate-shake border-bad bg-bad-soft'
                  : 'border-line bg-card active:scale-[0.98]'
            } ${dirAttr === 'ltr' ? 'en' : ''}`}
          >
            {!large && <span className="hidden text-xs text-ink-3 sm:inline">{i + 1}</span>}
            <span className="flex-1">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multiple choice: EN->HE, HE->EN, listening, speed
// ---------------------------------------------------------------------------

function Choice({
  ex,
  mode,
  onSfx,
}: {
  ex: Extract<Exercise, { kind: 'choice' }>;
  mode: SessionMode;
  onSfx: OnSfx;
}) {
  const answer = useSession((s) => s.answer);
  const next = useSession((s) => s.next);
  const feedback = useSession((s) => s.feedback);
  const [picked, setPicked] = useState<number | null>(null);
  const shownAt = useRef(Date.now());
  const opts = useSpeakOpts();
  const listening = ex.prompt === 'audio';
  const urls = audioUrls(ex.word);
  const sideLtr = ex.options.options[0]
    ? /^[\x20-\x7e]+$/.test(ex.options.options[0].label)
    : false;
  const speedy = mode === 'speed' || mode === 'duel' || !!ex.timerMs;
  useAutoplay(ex.word.lemma, urls, listening || ex.prompt === 'en');

  const pick = useCallback(
    (i: number) => {
      if (picked !== null) return;
      setPicked(i);
      const correct = i === ex.options.correctIndex;
      const type: GradedType = ex.item.type === 'intro' ? 'en_he' : (ex.item.type as GradedType);
      onSfx(correct ? 'correct' : 'wrong');
      if (!correct) buzz(30);
      void answer({
        type,
        correct,
        hinted: false,
        nearMiss: false,
        responseMs: Date.now() - shownAt.current,
      }).then((fb) => {
        if (correct || speedy)
          window.setTimeout(() => next(), speedy ? (correct ? 350 : 1100) : 800);
        return fb;
      });
    },
    [picked, ex, answer, next, onSfx, speedy],
  );

  // Item timer for speed items (6 s).
  const [left, setLeft] = useState(ex.timerMs ?? 0);
  useEffect(() => {
    if (!ex.timerMs) return;
    const startAt = Date.now();
    const id = window.setInterval(() => {
      const l = Math.max(0, ex.timerMs! - (Date.now() - startAt));
      setLeft(l);
      if (l === 0) {
        window.clearInterval(id);
        if (picked === null) pick(-1);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [ex.timerMs, pick, picked]);

  return (
    <div className="flex flex-1 animate-fade-up flex-col gap-6 pt-2">
      <RoleTag ex={ex} />
      {ex.timerMs ? (
        <Bar
          value={left}
          max={SPEED_ITEM_MS}
          color={left < 2000 ? 'var(--color-bad)' : 'var(--c-accent)'}
        />
      ) : null}
      <p className="text-center text-sm font-semibold text-ink-3">
        {listening ? t.session.listen : sideLtr ? t.session.chooseWord : t.session.chooseMeaning}
      </p>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4">
        {ex.prompt === 'en' && (
          <div className="flex items-center gap-3">
            <En className="text-5xl font-bold">{ex.word.lemma}</En>
            <Speak text={ex.word.lemma} urls={urls} isWord />
          </div>
        )}
        {ex.prompt === 'he' && (
          <p className="text-center text-4xl font-bold">{ex.word.hebrew[0]}</p>
        )}
        {listening && (
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              aria-label="השמעה"
              onClick={() => void playWord(ex.word.lemma, urls, opts)}
              className="tap grid h-28 w-28 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_14px_30px_-12px_var(--c-accent)] active:scale-95"
            >
              <SpeakerIcon size={48} />
            </button>
            {ex.word.sentences[0] && (
              <Button
                variant="soft"
                className="py-2 text-sm"
                onClick={() => void speak(ex.word.sentences[0]!.en, opts)}
              >
                {t.session.playSentence}
              </Button>
            )}
          </div>
        )}
      </div>
      <Options
        labels={ex.options.options.map((o) => o.label)}
        correct={ex.options.correctIndex}
        picked={picked}
        onPick={pick}
        dirAttr={sideLtr ? 'ltr' : 'rtl'}
        large={mode === 'listening'}
      />
      {feedback && !feedback.correct && !speedy && <MistakePanel ex={ex} feedback={feedback} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing and spell-from-audio
// ---------------------------------------------------------------------------

function Typing({ ex, onSfx }: { ex: Extract<Exercise, { kind: 'typing' }>; onSfx: OnSfx }) {
  const answer = useSession((s) => s.answer);
  const next = useSession((s) => s.next);
  const feedback = useSession((s) => s.feedback);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(0);
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const opts = useSpeakOpts();
  const urls = audioUrls(ex.word);
  useAutoplay(ex.word.lemma, urls, ex.audioOnly);

  useEffect(() => {
    // Focus without scrolling the pane on iOS.
    const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
    return () => window.clearTimeout(id);
  }, []);

  const submit = (giveUp = false) => {
    if (feedback) {
      next();
      return;
    }
    if (!giveUp && !value.trim()) return;
    const res = checkTyping(giveUp ? '' : value, ex.accepted);
    const correct = res.verdict !== 'wrong';
    onSfx(correct ? 'correct' : 'wrong');
    if (!correct) buzz(30);
    void answer(
      {
        type: ex.audioOnly ? 'spell_audio' : 'typing',
        correct,
        hinted: hint > 0,
        nearMiss: res.verdict === 'near',
        responseMs: Date.now() - shownAt.current,
      },
      { typed: value, expected: res.expected, near: res.verdict === 'near' },
    ).then((fb) => {
      if (fb.correct && !fb.near) window.setTimeout(() => next(), 900);
    });
  };

  const hintText = ex.word.lemma.slice(0, hint);
  return (
    <div className="flex flex-1 animate-fade-up flex-col gap-5 pt-2">
      <RoleTag ex={ex} />
      <p className="text-center text-sm font-semibold text-ink-3">
        {ex.audioOnly ? t.session.spellAudio : t.session.typeWord}
      </p>
      <div className="flex flex-col items-center gap-4 py-2">
        {ex.audioOnly ? (
          <button
            type="button"
            aria-label="השמעה"
            onClick={() => void playWord(ex.word.lemma, urls, opts)}
            className="tap grid h-24 w-24 place-items-center rounded-full bg-accent text-accent-ink active:scale-95"
          >
            <SpeakerIcon size={40} />
          </button>
        ) : (
          <p className="text-center text-3xl font-bold">{ex.word.hebrew.join(' · ')}</p>
        )}
        {ex.cloze && !ex.audioOnly && (
          <p className="text-center text-lg text-ink-2">
            <En>
              {ex.cloze.before}
              <span className="mx-1 inline-block min-w-16 border-b-2 border-accent" />
              {ex.cloze.after}
            </En>
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={!!feedback}
          dir="ltr"
          lang="en"
          inputMode="text"
          enterKeyHint="go"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={hintText ? `${hintText}…` : '...'}
          aria-label={t.session.typeWord}
          className={`en w-full rounded-2xl border-2 bg-card px-4 py-4 text-center text-2xl font-semibold outline-none transition focus:border-accent ${
            feedback
              ? feedback.correct
                ? feedback.near
                  ? 'border-warn'
                  : 'border-good'
                : 'border-bad animate-shake'
              : 'border-line'
          }`}
        />
        {!feedback && (
          <div className="grid grid-cols-[1fr_1fr_2fr] gap-2">
            <Button variant="ghost" className="py-2 text-sm" onClick={() => submit(true)}>
              {t.session.dontKnow}
            </Button>
            <Button
              variant="ghost"
              className="py-2 text-sm"
              disabled={hint >= Math.max(1, ex.word.lemma.length - 2)}
              onClick={() => setHint((h) => h + 1)}
            >
              {t.session.hint}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {t.session.check}
            </Button>
          </div>
        )}
      </form>
      {feedback && (feedback.near || !feedback.correct) && (
        <MistakePanel ex={ex} feedback={feedback} />
      )}
      {feedback && feedback.correct && !feedback.near && <Praise feedback={feedback} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cloze
// ---------------------------------------------------------------------------

function ClozeView({ ex, onSfx }: { ex: Extract<Exercise, { kind: 'cloze' }>; onSfx: OnSfx }) {
  const answer = useSession((s) => s.answer);
  const next = useSession((s) => s.next);
  const feedback = useSession((s) => s.feedback);
  const [picked, setPicked] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const shownAt = useRef(Date.now());
  const sentence = ex.cloze.before + ex.cloze.answer + ex.cloze.after;

  const grade = (correct: boolean, near: boolean, typed?: string) => {
    onSfx(correct ? 'correct' : 'wrong');
    void answer(
      {
        type: 'cloze',
        correct,
        hinted: false,
        nearMiss: near,
        responseMs: Date.now() - shownAt.current,
      },
      { ...(typed !== undefined ? { typed } : {}), expected: ex.cloze.answer, near },
    ).then((fb) => {
      if (fb.correct && !fb.near) window.setTimeout(() => next(), 1000);
    });
  };

  return (
    <div className="flex flex-1 animate-fade-up flex-col gap-5 pt-2">
      <RoleTag ex={ex} />
      <p className="text-center text-sm font-semibold text-ink-3">{t.session.fillBlank}</p>
      <div className="card flex items-start gap-3 p-4">
        <p className="flex-1 text-xl leading-relaxed">
          <En>
            {ex.cloze.before}
            {feedback ? (
              <strong className={feedback.correct ? 'text-good' : 'text-bad'}>
                {ex.cloze.answer}
              </strong>
            ) : (
              <span className="mx-1 inline-block min-w-16 border-b-2 border-accent" />
            )}
            {ex.cloze.after}
          </En>
        </p>
        <Speak text={sentence} size="sm" />
      </div>
      <p className="text-center text-sm text-ink-3">{ex.sentenceHe}</p>
      {ex.options ? (
        <Options
          labels={ex.options.options.map((o) => o.label)}
          correct={ex.options.correctIndex}
          picked={picked}
          dirAttr="ltr"
          onPick={(i) => {
            if (picked !== null) return;
            setPicked(i);
            grade(i === ex.options!.correctIndex, false);
          }}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (feedback) return next();
            if (!value.trim()) return;
            const res = checkTyping(value, [ex.cloze.answer]);
            // Typing the base form when an inflection was needed counts as a near miss.
            const base =
              checkTyping(value, [ex.word.lemma]).verdict === 'correct' &&
              res.verdict !== 'correct';
            grade(res.verdict !== 'wrong' || base, res.verdict === 'near' || base, value);
          }}
          className="flex flex-col gap-3"
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            readOnly={!!feedback}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="go"
            autoFocus
            aria-label={t.session.fillBlank}
            className="en w-full rounded-2xl border-2 border-line bg-card px-4 py-4 text-center text-2xl font-semibold outline-none focus:border-accent"
          />
          {!feedback && (
            <Button type="submit" disabled={!value.trim()}>
              {t.session.check}
            </Button>
          )}
        </form>
      )}
      {feedback && (feedback.near || !feedback.correct) && (
        <MistakePanel ex={ex} feedback={feedback} />
      )}
      {feedback && feedback.correct && !feedback.near && <Praise feedback={feedback} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match pairs
// ---------------------------------------------------------------------------

function Match({ ex, onSfx }: { ex: Extract<Exercise, { kind: 'match' }>; onSfx: OnSfx }) {
  const answerMatch = useSession((s) => s.answerMatch);
  const next = useSession((s) => s.next);
  const feedback = useSession((s) => s.feedback);
  const [left, setLeft] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<number | null>(null);
  const startAt = useRef(Date.now());
  const times = useRef(new Map<number, number>());
  const total = ex.board.left.length;

  const tryPair = (rightId: number) => {
    if (left === null) return;
    if (left === rightId) {
      onSfx('correct');
      times.current.set(rightId, Date.now() - startAt.current);
      const d = new Set(done);
      d.add(rightId);
      setDone(d);
      setLeft(null);
      if (d.size === total) {
        const ms = Date.now() - startAt.current;
        void answerMatch(
          ex.board.left.map((l) => ({
            lemmaId: l.lemmaId,
            correct: !wrong.has(l.lemmaId),
            ms: Math.round(ms / total),
          })),
          ms,
        ).then(() => window.setTimeout(() => next(), 1200));
      }
    } else {
      onSfx('wrong');
      buzz(30);
      const w = new Set(wrong);
      w.add(left);
      w.add(rightId);
      setWrong(w);
      setFlash(rightId);
      window.setTimeout(() => setFlash(null), 400);
      setLeft(null);
    }
  };

  const cell = (active: boolean, isDone: boolean, isFlash: boolean) =>
    `tap rounded-2xl border-2 px-3 py-3 text-center font-semibold transition ${
      isDone
        ? 'border-good/40 bg-good-soft opacity-50'
        : isFlash
          ? 'animate-shake border-bad bg-bad-soft'
          : active
            ? 'border-accent bg-accent-soft'
            : 'border-line bg-card'
    }`;

  return (
    <div className="flex flex-1 animate-fade-up flex-col gap-5 pt-2">
      <p className="text-center text-sm font-semibold text-ink-3">{t.session.match}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2.5" dir="ltr">
          {ex.board.left.map((l) => (
            <button
              key={l.lemmaId}
              type="button"
              disabled={done.has(l.lemmaId)}
              onClick={() => setLeft(l.lemmaId)}
              className={`${cell(left === l.lemmaId, done.has(l.lemmaId), false)} en`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {ex.board.right.map((r) => (
            <button
              key={r.lemmaId}
              type="button"
              disabled={done.has(r.lemmaId)}
              onClick={() => tryPair(r.lemmaId)}
              className={cell(false, done.has(r.lemmaId), flash === r.lemmaId)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {feedback && <Praise feedback={feedback} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function Praise({ feedback }: { feedback: Feedback }) {
  const word = useMemo(
    () => t.session.correct[Math.floor(Math.random() * t.session.correct.length)],
    [],
  );
  return (
    <div className="animate-pop text-center">
      <p className="text-lg font-bold text-good">
        {word}
        {feedback.xp > 0 && (
          <span className="ms-2 text-sm text-ink-3" dir="ltr">
            +{feedback.xp} XP
          </span>
        )}
      </p>
      {feedback.learnedNow && (
        <p className="text-sm font-semibold text-accent">{t.session.learned} ✨</p>
      )}
    </div>
  );
}

/** A mistake is a learning moment: show the full card, then continue (spec 4.7). */
function MistakePanel({
  ex,
  feedback,
}: {
  ex: Exclude<Exercise, { kind: 'match' | 'intro' }>;
  feedback: Feedback;
}) {
  const next = useSession((s) => s.next);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') next();
    };
    const id = window.setTimeout(() => window.addEventListener('keydown', onKey), 300);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [next]);
  return (
    <div className="mt-2 flex animate-fade-up flex-col gap-4 rounded-[1.5rem] border border-line bg-card p-4">
      <p className={`font-bold ${feedback.near ? 'text-warn' : 'text-bad'}`}>
        {feedback.near ? t.session.near : t.session.wrong}
      </p>
      {feedback.typed !== undefined &&
        feedback.expected &&
        feedback.typed.trim() &&
        levenshtein(feedback.typed.trim().toLowerCase(), feedback.expected.toLowerCase()) <= 3 && (
          <p
            className="en text-2xl font-bold tracking-wide"
            dir="ltr"
            aria-label={`${t.session.theAnswer} ${feedback.expected}`}
          >
            {diffSpelling(feedback.typed, feedback.expected).map((op, i) =>
              op.op === 'extra' ? null : (
                <span
                  key={i}
                  className={
                    op.op === 'same' ? 'text-ink' : 'rounded bg-warn-soft text-bad underline'
                  }
                >
                  {op.ch}
                </span>
              ),
            )}
          </p>
        )}
      <WordCard word={ex.word} big={false} sentences={1} />
      {ex.kind === 'cloze' && ex.cloze.answer.toLowerCase() !== ex.word.lemma.toLowerCase() && (
        <p className="text-sm text-ink-2">
          <En>{highlight(ex.cloze.before + ex.cloze.answer + ex.cloze.after, ex.word)}</En>
        </p>
      )}
      <Button onClick={() => next()} autoFocus>
        {t.session.next}
      </Button>
    </div>
  );
}
