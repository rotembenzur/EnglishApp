import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LemmaInfo, WordContent } from '@/engine/types';
import { ignoreWord, introduceWord, unignoreWord } from '@/engine/learn';
import { getContent, loadInventory } from '@/content/inventory';
import { confusablesFor, type Confusable } from '@/content/confusables';
import { ConfusableCard } from '@/ui/ConfusableCard';
import { deviceId } from '@/data/db';
import { addEvent, putWord } from '@/data/repo';
import { relTime, t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Button, Crowns, En, Header, Pill, Section, Sheet, Speak } from '@/ui/kit';
import { toast } from '@/ui/toast';
import { WordCard } from '@/ui/WordCard';
import { highlight } from '@/ui/word-utils';
import { EyeOffIcon, FlagIcon, StarIcon } from '@/ui/icons';
import { He, Ltr } from '@/ui/bidi';

export function WordDetail() {
  const { id } = useParams();
  const lemmaId = Number(id);
  const nav = useNavigate();
  const userId = useApp((s) => s.userId)!;
  const word = useApp((s) => s.words.get(lemmaId));
  const setWord = useApp((s) => s.setWord);
  const [content, setContent] = useState<WordContent | null | undefined>(undefined);
  const [info, setInfo] = useState<LemmaInfo | undefined>();
  const [family, setFamily] = useState<LemmaInfo[]>([]);
  const [note, setNote] = useState(word?.note ?? '');
  const [reporting, setReporting] = useState(false);
  const [confusing, setConfusing] = useState<Confusable[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const inv = await loadInventory();
      const l = inv.byId.get(lemmaId);
      if (!alive) return;
      setInfo(l);
      if (l?.family)
        setFamily(
          inv.lemmas
            .filter((x) => x.family === l.family && x.id !== l.id)
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 12),
        );
      if (l) void confusablesFor(l.lemma).then((x) => alive && setConfusing(x));
      const c = await getContent(lemmaId);
      if (alive) setContent(c);
    })();
    return () => {
      alive = false;
    };
  }, [lemmaId]);

  const save = async (patch: Partial<NonNullable<typeof word>>) => {
    if (!word) return;
    const next = { ...word, ...patch, updatedAt: Date.now(), deviceId: await deviceId() };
    await putWord(next);
    setWord(next);
  };

  const addToLearning = async () => {
    const w = introduceWord(userId, lemmaId, Date.now(), await deviceId(), 'manual');
    await putWord(w);
    setWord(w);
    toast(t.word.added, { icon: '✓' });
  };

  return (
    <div className="flex flex-col pb-10">
      <Header title={info?.lemma ?? ''} onBack={() => nav(-1)} />
      <div className="flex flex-col gap-6 px-4">
        {content === undefined && <div className="card h-48 animate-pulse-soft" />}
        {content === null && (
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-3">
              <En className="flex-1 text-4xl font-bold">{info?.lemma}</En>
              {info && <Speak text={info.lemma} isWord />}
            </div>
            <p className="text-ink-2">{t.word.unavailable}</p>
          </div>
        )}
        {content && (
          <div className="card p-5">
            <WordCard word={content} sentences={3} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {info && (
            <>
              <Pill className="bg-accent-soft text-accent">
                {t.word.band} <Ltr>{info.band}</Ltr>
              </Pill>
              {info.rank > 0 && (
                <Pill className="bg-card-2 text-ink-2">{t.word.rank(info.rank)}</Pill>
              )}
              {info.tags.map((tag) => (
                <Pill key={tag} className="bg-card-2 text-ink-2">
                  {t.topics[tag] ?? tag}
                </Pill>
              ))}
            </>
          )}
        </div>

        {word ? (
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{t.word.state[word.state]}</span>
              <Crowns n={word.crowns} />
            </div>
            {(word.state === 'learning' || word.state === 'review') && (
              <p className="text-sm text-ink-2">
                {t.word.nextReview}: {relTime(word.nextDueAt)}
              </p>
            )}
            {word.lapses > 0 && <p className="text-sm text-ink-3">{t.word.lapses(word.lapses)}</p>}
            {word.isLeech && (
              <Pill className="self-start bg-bad-soft text-bad">🪱 {t.word.leech}</Pill>
            )}
          </div>
        ) : (
          <Button variant="soft" onClick={() => void addToLearning()}>
            {t.word.addToLearning}
          </Button>
        )}

        {content?.context && (
          <Section title={t.word.context}>
            <div className="card flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2">
                <En className="flex-1 leading-relaxed">{highlight(content.context.en, content)}</En>
                <Speak text={content.context.en} size="sm" />
              </div>
              <He className="text-sm leading-relaxed text-ink-2">{content.context.he}</He>
            </div>
          </Section>
        )}

        {content?.collocations && content.collocations.length > 0 && (
          <Section title={t.word.collocations}>
            <div className="flex flex-wrap gap-2" dir="ltr">
              {content.collocations.map((c) => (
                <span key={c} className="en rounded-pill bg-card px-3 py-1.5 text-sm shadow-card">
                  {c}
                </span>
              ))}
            </div>
          </Section>
        )}

        {confusing.length > 0 && (
          <Section title={t.confusables.onWord}>
            {confusing.map((c) => (
              <ConfusableCard key={c.id} c={c} />
            ))}
          </Section>
        )}

        {family.length > 0 && (
          <Section title={t.word.family}>
            <div className="flex flex-wrap gap-2" dir="ltr">
              {family.map((f) => (
                <Link
                  key={f.id}
                  to={`/word/${f.id}`}
                  className="en rounded-pill bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                >
                  {f.lemma}
                </Link>
              ))}
            </div>
          </Section>
        )}

        {word && (
          <Section title={t.word.notes}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== (word.note ?? '') && void save({ note })}
              placeholder={t.word.notePlaceholder}
              dir="auto"
              rows={3}
              className="card w-full resize-none border-0 p-4 outline-none focus:ring-2 focus:ring-accent"
            />
          </Section>
        )}

        <div className="grid grid-cols-3 gap-2">
          {word && (
            <Button
              variant="outline"
              className="flex-col gap-1 py-3 text-xs"
              onClick={() => void save({ favorite: !word.favorite })}
            >
              <StarIcon filled={word.favorite} className={word.favorite ? 'text-warn' : ''} />
              {word.favorite ? t.word.unfavorite : t.word.addFavorite}
            </Button>
          )}
          {word && (
            <Button
              variant="outline"
              className="flex-col gap-1 py-3 text-xs"
              onClick={async () => {
                const dev = await deviceId();
                const next =
                  word.state === 'ignored'
                    ? unignoreWord(word, Date.now(), dev)
                    : ignoreWord(word, Date.now(), dev);
                await putWord(next);
                setWord(next);
              }}
            >
              <EyeOffIcon />
              {word.state === 'ignored' ? t.word.unignore : t.word.ignore}
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-col gap-1 py-3 text-xs"
            onClick={() => setReporting(true)}
          >
            <FlagIcon />
            {t.word.report}
          </Button>
        </div>
      </div>

      <Sheet open={reporting} onClose={() => setReporting(false)} title={t.word.reportTitle}>
        <div className="grid gap-2">
          {(Object.keys(t.word.reportKinds) as (keyof typeof t.word.reportKinds)[]).map((k) => (
            <Button
              key={k}
              variant="outline"
              onClick={async () => {
                await addEvent({
                  userId,
                  type: 'report',
                  payload: { lemmaId, lemma: info?.lemma, kind: k, tier: content?.tier ?? 'C' },
                });
                setReporting(false);
                toast(t.word.reportThanks, { icon: '🛡️' });
              }}
            >
              {t.word.reportKinds[k]}
            </Button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
