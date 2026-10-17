import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sfx } from '@/audio/sfx';
import { translateAll } from '@/content/gloss';
import { loadInventory } from '@/content/inventory';
import { analyzeText, buildCheck, type CheckQuestion } from '@/content/text';
import { getText, touchText } from '@/data/texts';
import { createRng, hashString } from '@/engine/rng';
import { t } from '@/i18n/he';
import { Bar, Button, En, Header, Speak } from '@/ui/kit';
import { He } from '@/ui/bidi';

/** A few questions about the text itself, after practicing its words (or on their own). */
export function TextCheck() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [qs, setQs] = useState<CheckQuestion[] | null>(null);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    void (async () => {
      const text = await getText(id);
      if (!text) return nav('/texts', { replace: true });
      const inv = await loadInventory();
      const sentences = analyzeText(text.body, inv.byLemma).sentences.map((s) => s.text);
      const he = await translateAll(sentences);
      setQs(buildCheck(sentences, he, createRng(hashString(`${id}:${Date.now() >> 16}`))));
    })();
  }, [id, nav]);

  if (!qs)
    return (
      <div className="flex flex-col gap-4 px-4 pt-16" aria-busy="true">
        <div className="h-24 animate-pulse-soft rounded-[1.25rem] bg-card" />
        <div className="h-14 animate-pulse-soft rounded-2xl bg-card" />
        <div className="h-14 animate-pulse-soft rounded-2xl bg-card" />
      </div>
    );

  const done = at >= qs.length;
  const q = qs[at];
  const answer = (i: number) => {
    if (picked !== null || !q) return;
    setPicked(i);
    const ok = i === q.correct;
    sfx(ok ? 'correct' : 'wrong');
    if (ok) setScore((s) => s + 1);
    if (at === qs.length - 1)
      void touchText(id, {
        check: { correct: score + (ok ? 1 : 0), total: qs.length, at: Date.now() },
      });
  };

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header title={t.texts.checkTitle} onBack={() => nav(`/texts/${id}`)} />
      <div className="flex flex-col gap-4 px-4">
        {qs.length === 0 && <p className="text-ink-2">{t.texts.checkNone}</p>}
        {qs.length > 0 && !done && q && (
          <>
            <Bar value={at} max={qs.length} className="h-2" />
            <p className="text-sm font-bold text-ink-3">
              {q.kind === 'meaning'
                ? t.texts.qMeaning
                : q.kind === 'which'
                  ? t.texts.qWhich
                  : t.texts.qNext}
            </p>
            <div className="card flex items-start gap-3 p-4">
              {q.kind === 'which' ? (
                <p className="flex-1 text-lg font-semibold">
                  <He>{q.prompt}</He>
                </p>
              ) : (
                <>
                  <En className="flex-1 text-lg leading-snug">{q.prompt}</En>
                  <Speak text={q.prompt} size="sm" label={t.common.playSentence} />
                </>
              )}
            </div>
            <div className="flex flex-col gap-2" data-testid="check-options">
              {q.options.map((o, i) => {
                const state =
                  picked === null
                    ? ''
                    : i === q.correct
                      ? 'border-good bg-good-soft'
                      : i === picked
                        ? 'border-bad bg-bad-soft'
                        : 'opacity-60';
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => answer(i)}
                    dir={q.kind === 'meaning' ? 'rtl' : 'ltr'}
                    className={`tap rounded-2xl border border-line bg-card p-3 text-start leading-snug ${q.kind === 'meaning' ? '' : 'en'} ${state}`}
                  >
                    {q.kind === 'meaning' ? <He>{o}</He> : o}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <Button
                onClick={() => {
                  setPicked(null);
                  setAt((x) => x + 1);
                }}
              >
                {t.common.continue}
              </Button>
            )}
          </>
        )}
        {qs.length > 0 && done && (
          <div
            className="card flex flex-col items-center gap-2 p-6 text-center"
            data-testid="check-done"
          >
            <p className="text-5xl">{score === qs.length ? '🎯' : '📖'}</p>
            <p className="text-2xl font-extrabold">{t.texts.checkResult(score, qs.length)}</p>
            <p className="text-ink-2">
              {score >= qs.length - 1 ? t.texts.checkGreat : t.texts.checkOkay}
            </p>
          </div>
        )}
        {(done || qs.length === 0) && (
          <Button variant="outline" onClick={() => nav(`/texts/${id}`, { replace: true })}>
            {t.texts.backToText}
          </Button>
        )}
      </div>
    </div>
  );
}
