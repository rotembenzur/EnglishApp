import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LemmaInfo, WordContent } from '@/engine/types';
import { introduceWord } from '@/engine/learn';
import { getContent, loadInventory, type Inventory } from '@/content/inventory';
import { deviceId } from '@/data/db';
import { putWord } from '@/data/repo';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Button, En, Header, Sheet, Speak } from '@/ui/kit';
import { toast } from '@/ui/toast';
import { audioUrls } from '@/ui/word-utils';
import { lemmatize } from '@/content/lemmatize';

type Status = 'studied' | 'new' | 'easy' | 'none';

export function ReadMode() {
  const nav = useNavigate();
  const words = useApp((s) => s.words);
  const setWord = useApp((s) => s.setWord);
  const userId = useApp((s) => s.userId)!;
  const theta = useApp((s) => s.profile?.ability?.theta ?? 40);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [text, setText] = useState('');
  const [analyzed, setAnalyzed] = useState('');
  const [open, setOpen] = useState<LemmaInfo | null>(null);
  const [content, setContent] = useState<WordContent | null | undefined>(undefined);

  useEffect(() => {
    void loadInventory().then(setInv);
  }, []);

  const tokens = useMemo(() => {
    if (!inv || !analyzed) return [];
    return analyzed.split(/([A-Za-z][A-Za-z'-]*)/).map((part) => {
      if (!/^[A-Za-z]/.test(part)) return { part, lemma: undefined, status: 'none' as Status };
      const lemma = lemmatize(part.replace(/'s$/, ''), inv.byLemma);
      if (!lemma) return { part, lemma, status: 'none' as Status };
      const status: Status = words.has(lemma.id)
        ? 'studied'
        : lemma.d >= theta - 4
          ? 'new'
          : 'easy';
      return { part, lemma, status };
    });
  }, [inv, analyzed, words, theta]);

  const unknown = useMemo(() => {
    const seen = new Map<number, LemmaInfo>();
    for (const tk of tokens) if (tk.status === 'new' && tk.lemma) seen.set(tk.lemma.id, tk.lemma);
    return [...seen.values()].sort((a, b) => a.d - b.d);
  }, [tokens]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getContent(open.id).then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
      setContent(undefined);
    };
  }, [open]);

  const add = async (ids: number[]) => {
    const dev = await deviceId();
    let n = 0;
    for (const id of ids) {
      if (words.has(id)) continue;
      const w = introduceWord(userId, id, Date.now(), dev, 'manual');
      await putWord(w);
      setWord(w);
      n++;
    }
    toast(t.read.added(n), { icon: '✓' });
  };

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header title={t.read.title} onBack={() => nav(-1)} />
      <div className="flex flex-col gap-4 px-4">
        <p className="text-sm text-ink-2">{t.read.intro}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="ltr"
          lang="en"
          rows={6}
          placeholder={t.read.placeholder}
          autoCapitalize="off"
          spellCheck={false}
          className="card en w-full resize-y border-0 p-4 outline-none focus:ring-2 focus:ring-accent"
          aria-label={t.read.placeholder}
        />
        <Button onClick={() => setAnalyzed(text.slice(0, 20_000))} disabled={!text.trim() || !inv}>
          {t.read.analyze}
        </Button>

        {tokens.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-ink-3">
              <span>
                <span className="me-1 inline-block h-3 w-3 rounded bg-accent-soft align-middle" />{' '}
                {t.read.legendNew}
              </span>
              <span>
                <span className="me-1 inline-block h-3 w-3 rounded border-b-2 border-good align-middle" />{' '}
                {t.read.legendStudied}
              </span>
            </div>
            <div className="card p-4 text-lg leading-loose" dir="ltr">
              <p className="en whitespace-pre-wrap">
                {tokens.map((tk, i) =>
                  tk.lemma ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setOpen(tk.lemma!)}
                      className={`rounded px-0.5 ${tk.status === 'new' ? 'bg-accent-soft font-semibold text-accent' : tk.status === 'studied' ? 'border-b-2 border-good' : ''}`}
                    >
                      {tk.part}
                    </button>
                  ) : (
                    <span key={i}>{tk.part}</span>
                  ),
                )}
              </p>
            </div>
            {unknown.length > 0 && (
              <Button
                variant="soft"
                onClick={() => void add(unknown.slice(0, 25).map((l) => l.id))}
              >
                {t.read.addAll(Math.min(25, unknown.length))}
              </Button>
            )}
          </>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <En className="flex-1 text-3xl font-bold">{open.lemma}</En>
              <Speak text={open.lemma} urls={content ? audioUrls(content) : {}} isWord />
            </div>
            {content === undefined && (
              <div className="h-16 animate-pulse-soft rounded-xl bg-card-2" />
            )}
            {content && <p className="text-xl font-semibold">{content.hebrew.join(' · ')}</p>}
            {content?.sentences[0] && (
              <En className="text-sm text-ink-2">{content.sentences[0].en}</En>
            )}
            {content === null && <p className="text-sm text-ink-3">{t.word.unavailable}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Link
                to={`/word/${open.id}`}
                className="tap grid place-items-center rounded-2xl border border-line font-semibold"
              >
                {t.read.fullCard}
              </Link>
              <Button
                disabled={words.has(open.id)}
                onClick={() => {
                  void add([open.id]);
                  setOpen(null);
                }}
              >
                {words.has(open.id) ? t.word.state.learning : t.word.addToLearning}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
