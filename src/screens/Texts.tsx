import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { refreshTextAudio } from '@/audio/textAudio';
import { fetchArticle } from '@/content/article';
import { loadInventory } from '@/content/inventory';
import { analyzeText, autoMark, autoTitle } from '@/content/text';
import type { StoredText } from '@/data/db';
import { listTexts, saveText, textProgress } from '@/data/texts';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { Bar, Button, En, Header, Sheet } from '@/ui/kit';
import { toast } from '@/ui/toast';

const MAX_CHARS = 20_000;
const URL_ONLY = /^https?:\/\/\S+$/i;

export function Texts() {
  const nav = useNavigate();
  const userId = useApp((s) => s.userId)!;
  const words = useApp((s) => s.words);
  const accent = useApp((s) => s.profile?.settings.accent ?? 'us');
  const [tick, setTick] = useState(0);
  const texts = useLive(() => listTexts(userId), [userId, tick]);
  const [adding, setAdding] = useState(false);

  // Texts whose audio is still on its way: one check each, so the list shows where they stand.
  const waiting = texts
    ?.filter((x) => x.audio && !x.audio.readyAt)
    .map((x) => x.id)
    .join(',');
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    void Promise.all(waiting.split(',').map((id) => refreshTextAudio(id, accent))).then(
      () => alive && setTick((n) => n + 1),
    );
    return () => {
      alive = false;
    };
  }, [waiting, accent]);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header title={t.texts.title} onBack={() => nav(-1)} />
      <div className="flex flex-col gap-3 px-4">
        <p className="text-sm text-ink-2">{t.texts.intro}</p>
        <Button onClick={() => setAdding(true)}>+ {t.texts.newText}</Button>
        {texts && texts.length === 0 && (
          <div className="card flex flex-col items-center gap-1 p-6 text-center">
            <p className="text-4xl">📖</p>
            <p className="font-bold">{t.texts.empty}</p>
            <p className="text-sm text-ink-3">{t.texts.emptyBody}</p>
          </div>
        )}
        {texts?.map((tx) => {
          const p = textProgress(tx, words);
          return (
            <Link
              key={tx.id}
              to={`/texts/${tx.id}`}
              className="card tap flex flex-col gap-2 p-4"
              data-testid="text-row"
            >
              <En className="line-clamp-2 text-lg font-bold">{tx.title}</En>
              <Bar value={p.learned} max={p.total || 1} className="h-2" />
              <span className="text-xs text-ink-3">
                {p.total ? t.texts.progress(p.learned, p.total) : t.texts.noMarked}
                {tx.check ? ` · ${t.texts.lastCheck(tx.check.correct, tx.check.total)}` : ''}
              </span>
              {tx.audio && (
                <span className="text-xs text-ink-3">
                  {tx.audio.readyAt
                    ? `🔊 ${t.textAudio.listReady}`
                    : `⏳ ${t.textAudio.listPreparing}`}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <NewText
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(id) => nav(`/texts/${id}`)}
      />
    </div>
  );
}

function NewText({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const userId = useApp((s) => s.userId)!;
  const words = useApp((s) => s.words);
  const theta = useApp((s) => s.profile?.ability?.theta ?? 40);
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Fetch an article into the form; null when it cannot be fetched (a toast says what to do). */
  const fetchIt = async (link: string) => {
    setFetching(true);
    const a = await fetchArticle(link.trim()).catch(() => null);
    setFetching(false);
    if (!a) {
      toast(t.texts.fetchFailed, { icon: '⚠️' });
      return null;
    }
    setBody(a.body);
    setUrl(link.trim());
    setTitle(a.title);
    return a;
  };

  const save = async () => {
    let text = body.trim();
    let link = url.trim();
    let name = title;
    // Only a link (pasted into either field): fetch the article and save it in one go.
    const source = URL_ONLY.test(text) ? text : !text && URL_ONLY.test(link) ? link : '';
    if (source) {
      const a = await fetchIt(source);
      if (!a) return;
      text = a.body.trim();
      link = source;
      name = a.title;
    }
    setSaving(true);
    const inv = await loadInventory();
    const clipped = text.slice(0, MAX_CHARS);
    const analysis = analyzeText(clipped, inv.byLemma);
    const now = Date.now();
    const row: StoredText = {
      id: crypto.randomUUID(),
      userId,
      title: (name.trim() || autoTitle(clipped)).slice(0, 120),
      body: clipped,
      ...(link ? { url: link } : {}),
      marked: autoMark(analysis, words, theta),
      createdAt: now,
      updatedAt: now,
      openedAt: now,
    };
    await saveText(row);
    setSaving(false);
    toast(text.length > MAX_CHARS ? t.texts.trimmed : t.texts.saved, { icon: '✓' });
    setBody('');
    setUrl('');
    setTitle('');
    onSaved(row.id);
  };

  const ready = /[A-Za-z]{2}/.test(body) || URL_ONLY.test(url.trim());
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.texts.newText}
      footer={
        <Button
          className="w-full"
          disabled={!ready || saving || fetching}
          onClick={() => void save()}
        >
          {fetching ? t.texts.fetching : t.texts.save}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t.texts.bodyLabel}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            dir="ltr"
            lang="en"
            rows={6}
            placeholder={t.texts.bodyPlaceholder}
            autoCapitalize="off"
            spellCheck={false}
            className="en max-h-[30vh] min-h-28 w-full resize-none overflow-y-auto rounded-2xl border border-line bg-bg p-3 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
            data-testid="text-body"
          />
        </label>
        <p className="text-xs text-ink-3">{t.texts.titleHint}</p>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t.texts.urlLabel}
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              dir="ltr"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              placeholder={t.texts.urlPlaceholder}
              className="en min-w-0 flex-1 rounded-2xl border border-line bg-bg p-3 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
              data-testid="text-url"
            />
            <Button
              variant="outline"
              className="shrink-0 px-3"
              disabled={!URL_ONLY.test(url.trim()) || fetching}
              onClick={() =>
                void fetchIt(url).then((a) => a && toast(t.texts.fetched, { icon: '✓' }))
              }
            >
              {fetching ? t.texts.fetching : t.texts.fetchArticle}
            </Button>
          </div>
        </label>
      </div>
    </Sheet>
  );
}
