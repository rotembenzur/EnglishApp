import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cachedTranslations, ensureContent, translateAll } from '@/content/gloss';
import { loadInventory, type Inventory } from '@/content/inventory';
import { analyzeText, sentencesWith, type TextToken } from '@/content/text';
import { playSentence, stopAudio, unlockAudio } from '@/audio/speech';
import { deviceId, type StoredText } from '@/data/db';
import { putWord } from '@/data/repo';
import { deleteText, getText, textProgress, touchText } from '@/data/texts';
import { introduceWord } from '@/engine/learn';
import type { LemmaInfo } from '@/engine/types';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Bar, Button, En, Header, Sheet, Speak } from '@/ui/kit';
import { He } from '@/ui/bidi';
import { CloseIcon, SpeakerIcon } from '@/ui/icons';
import { toast } from '@/ui/toast';
import { WordLookup } from '@/ui/WordLookup';

type Tap = 'word' | 'sentence';
type Open =
  | { kind: 'word'; token: TextToken; sentence: number }
  | { kind: 'sentence'; index: number }
  | { kind: 'delete' };

export function TextRead() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const userId = useApp((s) => s.userId)!;
  const words = useApp((s) => s.words);
  const setWord = useApp((s) => s.setWord);
  const settings = useApp((s) => s.profile?.settings);
  const [text, setText] = useState<StoredText | null | undefined>(undefined);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [tap, setTap] = useState<Tap>('word');
  const [open, setOpen] = useState<Open | null>(null);
  const [he, setHe] = useState<(string | null)[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    void getText(id).then((x) => {
      setText(x ?? null);
      if (x) void touchText(id, { openedAt: Date.now() });
    });
    void loadInventory().then(setInv);
    return () => {
      stopRef.current = true;
      stopAudio();
    };
  }, [id]);

  const analysis = useMemo(
    () => (text && inv ? analyzeText(text.body, inv.byLemma) : null),
    [text, inv],
  );
  const sentences = useMemo(() => analysis?.sentences.map((s) => s.text) ?? [], [analysis]);
  useEffect(() => {
    if (sentences.length) void cachedTranslations(sentences).then(setHe);
  }, [sentences]);

  const marked = useMemo(() => new Set(text?.marked ?? []), [text]);
  const markedInfos = useMemo(
    () =>
      (text?.marked ?? [])
        .map((m) => inv?.byId.get(m))
        .filter((l): l is LemmaInfo => !!l)
        .sort((a, b) => a.lemma.localeCompare(b.lemma)),
    [text, inv],
  );
  const toAdd = markedInfos.filter((l) => !words.has(l.id));

  if (text === null) {
    return (
      <div className="flex flex-col gap-4">
        <Header title={t.texts.title} onBack={() => nav('/texts')} />
        <p className="px-4 text-ink-2">{t.texts.empty}</p>
      </div>
    );
  }
  if (!text || !analysis) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-16" aria-busy="true">
        <div className="h-8 w-1/2 animate-pulse-soft rounded-xl bg-card" />
        <div className="h-60 animate-pulse-soft rounded-[1.25rem] bg-card" />
      </div>
    );
  }

  const speakOpts = {
    accent: settings?.accent ?? 'us',
    ...(settings?.voiceURI ? { voiceURI: settings.voiceURI } : {}),
    rate: settings?.speechRate ?? 0.95,
  };

  const setMarked = async (next: number[]) => {
    const row = { ...text, marked: next, updatedAt: Date.now() };
    setText(row);
    await touchText(text.id, { marked: next, updatedAt: row.updatedAt });
  };
  const toggleMark = (lemmaId: number) =>
    void setMarked(
      marked.has(lemmaId) ? text.marked.filter((x) => x !== lemmaId) : [...text.marked, lemmaId],
    );

  const translateSome = async (indexes: number[]) => {
    const missing = indexes.filter((i) => !he[i]);
    if (!missing.length) return true;
    const got = await translateAll(missing.map((i) => sentences[i]!));
    setHe((cur) => {
      const next = [...cur];
      missing.forEach((i, k) => (next[i] = got[k] ?? next[i] ?? null));
      return next;
    });
    return got.every(Boolean);
  };

  const toggleAll = async () => {
    if (showAll) return setShowAll(false);
    setTranslating(true);
    const ok = await translateSome(sentences.map((_, i) => i));
    setTranslating(false);
    setShowAll(true);
    if (!ok) toast(t.texts.translateFailed, { icon: '⚠️' });
  };

  const playAll = async () => {
    if (playing !== null) {
      stopRef.current = true;
      stopAudio();
      setPlaying(null);
      return;
    }
    unlockAudio();
    stopRef.current = false;
    for (let i = 0; i < sentences.length && !stopRef.current; i++) {
      setPlaying(i);
      await playSentence(sentences[i]!, speakOpts);
    }
    setPlaying(null);
  };

  const add = async (infos: LemmaInfo[]) => {
    setBusy(true);
    const dev = await deviceId();
    let n = 0;
    let failed = 0;
    for (const info of infos) {
      if (useApp.getState().words.has(info.id)) continue;
      const own = sentencesWith(analysis, info.id).map((s) => s.text);
      if (!(await ensureContent(info, own))) {
        failed++;
        continue;
      }
      const w = introduceWord(userId, info.id, Date.now(), dev, 'manual');
      await putWord(w);
      setWord(w);
      n++;
    }
    setBusy(false);
    if (n) toast(t.texts.added(n), { icon: '✓' });
    if (failed) toast(t.texts.notReady(failed), { icon: '⚠️' });
  };

  const progress = textProgress(text, words);
  const tokenClass = (tk: TextToken) =>
    tk.lemma && words.has(tk.lemma.id)
      ? 'border-b-2 border-good'
      : tk.lemma && marked.has(tk.lemma.id)
        ? 'bg-accent-soft font-semibold text-accent'
        : '';

  const renderTokens = (si: number) =>
    analysis.sentences[si]!.tokens.map((tk, i) =>
      tk.word && tap === 'word' ? (
        <button
          key={i}
          type="button"
          onClick={() => setOpen({ kind: 'word', token: tk, sentence: si })}
          className={`rounded px-px ${tokenClass(tk)}`}
          data-marked={tk.lemma && marked.has(tk.lemma.id) ? '1' : undefined}
        >
          {tk.part}
        </button>
      ) : (
        <span key={i} className={tk.word ? tokenClass(tk) : ''}>
          {tk.part}
        </span>
      ),
    );

  /** A sentence in the flowing view (word taps); its gap keeps line breaks. */
  const sentenceSpan = (si: number) => (
    <span key={si}>
      <span className={playing === si ? 'rounded bg-warn-soft' : ''}>{renderTokens(si)}</span>
      {analysis.sentences[si]!.gap}
    </span>
  );

  const openWord = open?.kind === 'word' ? open : null;
  const openSentence = open?.kind === 'sentence' ? open.index : null;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header
        title={t.texts.title}
        onBack={() => nav('/texts')}
        right={
          <button
            type="button"
            aria-label={t.texts.deleteText}
            onClick={() => setOpen({ kind: 'delete' })}
            className="tap grid place-items-center rounded-full text-ink-3"
          >
            <CloseIcon />
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-4">
        <En className="text-2xl font-extrabold leading-tight">{text.title}</En>
        {progress.total > 0 && (
          <div className="flex flex-col gap-1">
            <Bar value={progress.learned} max={progress.total} className="h-2" />
            <span className="text-xs text-ink-3">
              {t.texts.progress(progress.learned, progress.total)}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3">{t.texts.tapLabel}</span>
          <div className="flex rounded-pill bg-card-2 p-1" role="radiogroup">
            {(['word', 'sentence'] as Tap[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={tap === m}
                onClick={() => setTap(m)}
                className={`rounded-pill px-3 py-1 font-semibold ${tap === m ? 'bg-card text-ink shadow' : 'text-ink-3'}`}
              >
                {m === 'word' ? t.texts.tapWord : t.texts.tapSentence}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={translating} onClick={() => void toggleAll()}>
            {translating
              ? t.texts.translating
              : showAll
                ? t.texts.hideTranslation
                : t.texts.translateAll}
          </Button>
          <Button variant="outline" onClick={() => void playAll()}>
            <span className="inline-flex items-center gap-2">
              <SpeakerIcon size={18} />
              {playing !== null ? t.texts.stop : t.texts.playAll}
            </span>
          </Button>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-ink-3">
          <span>
            <span className="me-1 inline-block h-3 w-3 rounded bg-accent-soft align-middle" />{' '}
            {t.texts.legendMarked}
          </span>
          <span>
            <span className="me-1 inline-block h-3 w-3 rounded border-b-2 border-good align-middle" />{' '}
            {t.texts.legendStudied}
          </span>
        </div>

        <div className="card p-4 text-lg leading-loose" dir="ltr" data-testid="text-view">
          {showAll ? (
            <div className="flex flex-col gap-3">
              {analysis.sentences.map((s, si) => (
                <div key={si} className={s.gap.includes('\n') ? 'pb-2' : ''}>
                  <p className="en">
                    {tap === 'sentence' ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpen({ kind: 'sentence', index: si })}
                        className={playing === si ? 'rounded bg-warn-soft' : ''}
                      >
                        {renderTokens(si)}
                      </span>
                    ) : (
                      <span className={playing === si ? 'rounded bg-warn-soft' : ''}>
                        {renderTokens(si)}
                      </span>
                    )}
                  </p>
                  {he[si] && (
                    <p dir="rtl" className="text-base leading-snug text-ink-2">
                      <He>{he[si]!}</He>
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="en whitespace-pre-wrap">
              {analysis.sentences.map((s, si) =>
                tap === 'sentence' ? (
                  <span key={si}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen({ kind: 'sentence', index: si })}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && setOpen({ kind: 'sentence', index: si })
                      }
                      className={`cursor-pointer rounded ${playing === si ? 'bg-warn-soft' : 'active:bg-card-2'}`}
                      data-testid="sentence"
                    >
                      {renderTokens(si)}
                    </span>
                    {s.gap}
                  </span>
                ) : (
                  sentenceSpan(si)
                ),
              )}
            </p>
          )}
        </div>

        <section className="card flex flex-col gap-3 p-4">
          <p className="font-bold" data-testid="marked-count">
            {t.texts.marked(markedInfos.length)}
          </p>
          <p className="text-xs text-ink-3">{t.texts.markedHint}</p>
          {markedInfos.length > 0 && (
            <div className="flex flex-wrap gap-2" dir="ltr">
              {markedInfos.map((l) => (
                <span
                  key={l.id}
                  className={`inline-flex items-center gap-1 rounded-pill px-3 py-1 text-sm ${words.has(l.id) ? 'bg-good-soft' : 'bg-accent-soft text-accent'}`}
                >
                  <button
                    type="button"
                    className="en font-semibold"
                    onClick={() => {
                      const si = sentencesWith(analysis, l.id)[0]?.index ?? 0;
                      const token = analysis.sentences[si]?.tokens.find(
                        (x) => x.lemma?.id === l.id,
                      ) ?? { part: l.lemma, word: true, proper: false, lemma: l };
                      setOpen({ kind: 'word', token, sentence: si });
                    }}
                  >
                    {l.lemma}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t.texts.unmark} ${l.lemma}`}
                    onClick={() => toggleMark(l.id)}
                    className="grid h-5 w-5 place-items-center rounded-full text-ink-3"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {markedInfos.length > 0 &&
            (toAdd.length ? (
              <Button variant="soft" disabled={busy} onClick={() => void add(toAdd)}>
                {busy ? t.common.loading : t.texts.addAll(toAdd.length)}
              </Button>
            ) : (
              <p className="text-sm text-good">{t.texts.allAdded}</p>
            ))}
        </section>

        <section className="flex flex-col gap-2">
          <Button
            disabled={!markedInfos.length}
            onClick={() => nav(`/session/text?id=${encodeURIComponent(text.id)}`)}
          >
            {t.texts.practice}
          </Button>
          <p className="text-center text-xs text-ink-3">
            {markedInfos.length ? t.texts.practiceHint : t.texts.practiceNone}
          </p>
          <Link
            to={`/texts/${text.id}/check`}
            className="tap grid place-items-center rounded-2xl text-sm font-semibold text-accent"
          >
            {t.texts.checkOnly}
            {text.check ? ` · ${t.texts.lastCheck(text.check.correct, text.check.total)}` : ''}
          </Link>
        </section>
      </div>

      <Sheet open={!!openWord} onClose={() => setOpen(null)}>
        {openWord && (
          <WordLookup
            key={`${openWord.sentence}:${openWord.token.part}`}
            surface={openWord.token.part}
            {...(openWord.token.lemma ? { info: openWord.token.lemma } : {})}
            context={{ en: sentences[openWord.sentence] ?? '', he: he[openWord.sentence] ?? null }}
            {...(openWord.token.lemma
              ? {
                  marked: marked.has(openWord.token.lemma.id),
                  onToggleMark: () => toggleMark(openWord.token.lemma!.id),
                  onAdd: () => {
                    void add([openWord.token.lemma!]);
                    setOpen(null);
                  },
                }
              : {})}
          />
        )}
        {openWord?.token.proper && <p className="pt-2 text-xs text-ink-3">{t.texts.name}</p>}
      </Sheet>

      <Sheet open={openSentence !== null} onClose={() => setOpen(null)}>
        {openSentence !== null && (
          <SentenceCard
            en={sentences[openSentence] ?? ''}
            he={he[openSentence] ?? null}
            load={() => translateSome([openSentence])}
          />
        )}
      </Sheet>

      <Sheet open={open?.kind === 'delete'} onClose={() => setOpen(null)}>
        <p className="mb-5 text-lg font-semibold">{t.texts.deleteConfirm}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setOpen(null)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void deleteText(text.id).then(() => {
                toast(t.texts.deleted);
                nav('/texts', { replace: true });
              })
            }
          >
            {t.texts.deleteText}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function SentenceCard({
  en,
  he,
  load,
}: {
  en: string;
  he: string | null;
  load: () => Promise<boolean>;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(he ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (he) return;
    let alive = true;
    void load().then((ok) => alive && setState(ok ? 'ready' : 'error'));
    return () => {
      alive = false;
    };
    // `load` changes every render; the attempt counter is what asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const run = () => {
    setState('loading');
    setAttempt((a) => a + 1);
  };
  return (
    <div className="flex flex-col gap-3" data-testid="sentence-card">
      <div className="flex items-start gap-3">
        <En className="flex-1 text-lg leading-snug">{en}</En>
        <Speak text={en} label={t.common.playSentence} />
      </div>
      {he && (
        <p className="text-lg font-semibold">
          <He>{he}</He>
        </p>
      )}
      {!he && state === 'loading' && (
        <div className="h-6 w-3/4 animate-pulse-soft rounded-xl bg-card-2" aria-busy="true" />
      )}
      {!he && state === 'error' && (
        <div className="flex items-center gap-3 rounded-2xl bg-warn-soft p-3" role="alert">
          <p className="flex-1 text-sm">{t.texts.translateFailed}</p>
          <Button variant="outline" className="!min-h-0 px-3 py-2 text-sm" onClick={run}>
            {t.common.retry}
          </Button>
        </div>
      )}
    </div>
  );
}
