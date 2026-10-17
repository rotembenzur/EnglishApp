import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchArticle } from '@/content/article';
import { loadInventory } from '@/content/inventory';
import { analyzeText, autoMark, guessTitle } from '@/content/text';
import type { StoredText } from '@/data/db';
import { listTexts, saveText, textProgress } from '@/data/texts';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { Bar, Button, En, Header, Sheet } from '@/ui/kit';
import { toast } from '@/ui/toast';

const MAX_CHARS = 20_000;

export function Texts() {
  const nav = useNavigate();
  const userId = useApp((s) => s.userId)!;
  const words = useApp((s) => s.words);
  const texts = useLive(() => listTexts(userId), [userId]);
  const [adding, setAdding] = useState(false);

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
            </Link>
          );
        })}
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.texts.newText}>
        {adding && <NewText onSaved={(id) => nav(`/texts/${id}`)} />}
      </Sheet>
    </div>
  );
}

function NewText({ onSaved }: { onSaved: (id: string) => void }) {
  const userId = useApp((s) => s.userId)!;
  const words = useApp((s) => s.words);
  const theta = useApp((s) => s.profile?.ability?.theta ?? 40);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchIt = async () => {
    setFetching(true);
    const a = await fetchArticle(url.trim()).catch(() => null);
    setFetching(false);
    if (!a) {
      toast(t.texts.fetchFailed, { icon: '⚠️' });
      return;
    }
    setBody(a.body);
    if (!title.trim() && a.title) setTitle(a.title);
  };

  const save = async () => {
    setSaving(true);
    const inv = await loadInventory();
    const clipped = body.trim().slice(0, MAX_CHARS);
    const analysis = analyzeText(clipped, inv.byLemma);
    const now = Date.now();
    const row: StoredText = {
      id: crypto.randomUUID(),
      userId,
      title: title.trim() || guessTitle(clipped),
      body: clipped,
      ...(url.trim() ? { url: url.trim() } : {}),
      marked: autoMark(analysis, words, theta),
      createdAt: now,
      updatedAt: now,
      openedAt: now,
    };
    await saveText(row);
    setSaving(false);
    toast(body.trim().length > MAX_CHARS ? t.texts.trimmed : t.texts.saved, { icon: '✓' });
    onSaved(row.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.texts.titleLabel}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          dir="auto"
          placeholder={t.texts.titlePlaceholder}
          className="card en border-0 p-3 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
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
          className="card en max-h-[32dvh] min-h-24 w-full resize-none overflow-y-auto border-0 p-3 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
          data-testid="text-body"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.texts.urlLabel}
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            dir="ltr"
            type="url"
            inputMode="url"
            placeholder={t.texts.urlPlaceholder}
            className="card en min-w-0 flex-1 border-0 p-3 text-base font-normal outline-none focus:ring-2 focus:ring-accent"
          />
          <Button
            variant="outline"
            className="shrink-0 px-3"
            disabled={!/^https?:\/\/\S+$/i.test(url.trim()) || fetching}
            onClick={() => void fetchIt()}
          >
            {fetching ? t.texts.fetching : t.texts.fetchArticle}
          </Button>
        </div>
      </label>
      <div className="sticky -bottom-5 -mx-5 -mb-5 bg-card px-5 pb-5 pt-2">
        <Button
          className="w-full"
          disabled={!/[A-Za-z]{2}/.test(body) || saving}
          onClick={() => void save()}
        >
          {t.texts.save}
        </Button>
      </div>
    </div>
  );
}
