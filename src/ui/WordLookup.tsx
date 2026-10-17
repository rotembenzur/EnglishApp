import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Gloss } from '@/content/enrich';
import { getGloss, LookupError } from '@/content/gloss';
import { peekContent } from '@/content/inventory';
import type { LemmaInfo } from '@/engine/types';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Button, En, Pill, Speak } from './kit';
import { He } from './bidi';

type State =
  { kind: 'loading' } | { kind: 'ready'; gloss: Gloss } | { kind: 'error'; offline: boolean };

/**
 * The card of a word tapped in a text: always a loading state, then the word, or a message with a
 * retry. Never an empty card. Audio is the recording when there is one, else the dictionary clip,
 * else the system voice.
 */
export function WordLookup({
  surface,
  info,
  context,
  marked,
  onToggleMark,
  onAdd,
}: {
  surface: string;
  info?: LemmaInfo;
  /** The sentence of the text the word was tapped in. */
  context?: { en: string; he?: string | null };
  marked?: boolean;
  onToggleMark?: () => void;
  onAdd?: () => void;
}) {
  const words = useApp((s) => s.words);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const word = info?.lemma ?? surface.toLowerCase();

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getGloss(surface, info).then(
      (gloss) => alive && setState({ kind: 'ready', gloss }),
      (e: unknown) =>
        alive && setState({ kind: 'error', offline: e instanceof LookupError && e.offline }),
    );
    return () => {
      alive = false;
    };
  }, [surface, info, attempt]);
  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((a) => a + 1);
  };

  const g = state.kind === 'ready' ? state.gloss : null;
  const urls = {
    ...(g?.audioUrl ? { us: g.audioUrl } : {}),
    ...(g?.audioUrlUk ? { uk: g.audioUrlUk } : {}),
  };
  const studied = !!info && words.has(info.id);
  const hasCard = !!info && (!!peekContent(info.id) || studied);
  return (
    <div className="flex flex-col gap-3" data-testid="word-lookup">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <En className="break-words text-3xl font-bold">{word}</En>
          {g && (g.ipa || g.pos.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
              {g.ipa && <span className="ipa">{g.ipa}</span>}
              {g.pos.slice(0, 2).map((p) => (
                <Pill key={p} className="bg-card-2 text-ink-2">
                  {t.pos[p] ?? p}
                </Pill>
              ))}
            </div>
          )}
        </div>
        <Speak text={word} urls={urls} isWord />
      </div>

      {state.kind === 'loading' && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t.common.loading}>
          <div className="h-7 w-2/3 animate-pulse-soft rounded-xl bg-card-2" />
          <div className="h-4 w-full animate-pulse-soft rounded-xl bg-card-2" />
        </div>
      )}
      {g && (
        <>
          <p className="text-xl font-semibold" data-testid="lookup-hebrew">
            <He>{g.hebrew.join(' · ')}</He>
          </p>
          {g.definition && (
            <p dir="ltr" className="en text-sm text-ink-3">
              {g.definition}
            </p>
          )}
        </>
      )}
      {state.kind === 'error' && (
        <div className="flex items-center gap-3 rounded-2xl bg-warn-soft p-3" role="alert">
          <p className="flex-1 text-sm">
            {state.offline ? t.texts.lookupOffline : t.texts.lookupFailed}
          </p>
          <Button variant="outline" className="!min-h-0 px-3 py-2 text-sm" onClick={retry}>
            {t.common.retry}
          </Button>
        </div>
      )}

      {context && (
        <div className="flex items-start gap-2 rounded-2xl bg-bg-2/70 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-bold text-ink-3">{t.texts.inText}</span>
            <En className="text-[15px] leading-snug">{context.en}</En>
            {context.he && <He className="text-sm text-ink-2">{context.he}</He>}
          </div>
          <Speak text={context.en} size="sm" label={t.common.playSentence} />
        </div>
      )}

      {!info && <p className="text-xs text-ink-3">{t.texts.notInList}</p>}
      {info && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {onToggleMark && !studied ? (
            <Button variant="outline" onClick={onToggleMark}>
              {marked ? t.texts.unmark : t.texts.mark}
            </Button>
          ) : hasCard ? (
            <Link
              to={`/word/${info.id}`}
              className="tap grid place-items-center rounded-2xl border border-line font-semibold"
            >
              {t.texts.fullCard}
            </Link>
          ) : (
            <span />
          )}
          <Button disabled={studied || state.kind !== 'ready'} onClick={onAdd}>
            {studied ? t.word.state.learning : t.word.addToLearning}
          </Button>
        </div>
      )}
    </div>
  );
}
