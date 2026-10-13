import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LemmaInfo, UserWord } from '@/engine/types';
import { BANDS } from '@/engine/difficulty';
import { loadInventory, peekContent, getContents } from '@/content/inventory';
import { relTime, t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Crowns, En, Header } from '@/ui/kit';
import { SearchIcon } from '@/ui/icons';
import { He, Ltr } from '@/ui/bidi';
import { hasHebrew } from '@/i18n/bidi';

type Filter = keyof typeof t.library.filters;
type Sort = keyof typeof t.library.sort;

export function Library() {
  const words = useApp((s) => s.words);
  const [inv, setInv] = useState<{ byId: Map<number, LemmaInfo>; lemmas: LemmaInfo[] } | null>(
    null,
  );
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('due');
  const [band, setBand] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [, setLoaded] = useState(0);

  useEffect(() => {
    void loadInventory().then(setInv);
  }, []);

  // Load Hebrew glosses for the user's words so Hebrew search works.
  useEffect(() => {
    void getContents([...words.keys()], { online: false }).then((m) => setLoaded(m.size));
  }, [words]);

  const now = Date.now();
  const rows = useMemo(() => {
    if (!inv) return [];
    const query = q.trim().toLowerCase();
    let list: UserWord[] = [...words.values()];
    list = list.filter((w) => {
      switch (filter) {
        case 'learning':
          return w.state === 'learning' || (w.state === 'review' && w.crowns < 3);
        case 'mastered':
          return w.crowns >= 3 || w.state === 'known';
        case 'due':
          return (w.state === 'learning' || w.state === 'review') && w.card.due <= now;
        case 'favorites':
          return w.favorite;
        case 'leeches':
          return w.isLeech;
        case 'ignored':
          return w.state === 'ignored';
        case 'new':
          return now - w.firstSeenAt < 7 * 86_400_000;
        default:
          return w.state !== 'ignored';
      }
    });
    if (band) list = list.filter((w) => inv.byId.get(w.lemmaId)?.band === band);
    if (topic) list = list.filter((w) => inv.byId.get(w.lemmaId)?.tags.includes(topic));
    if (query) {
      const he = hasHebrew(query);
      list = list.filter((w) => {
        if (he) return peekContent(w.lemmaId)?.hebrew.some((h) => h.includes(query)) ?? false;
        return inv.byId.get(w.lemmaId)?.lemma.toLowerCase().includes(query) ?? false;
      });
    }
    const lemma = (w: UserWord) => inv.byId.get(w.lemmaId)?.lemma ?? '';
    list.sort((a, b) => {
      switch (sort) {
        case 'recent':
          return b.firstSeenAt - a.firstSeenAt;
        case 'alpha':
          return lemma(a).localeCompare(lemma(b));
        case 'level':
          return (inv.byId.get(a.lemmaId)?.d ?? 0) - (inv.byId.get(b.lemmaId)?.d ?? 0);
        default:
          return a.nextDueAt - b.nextDueAt;
      }
    });
    return list;
  }, [inv, words, q, filter, sort, band, topic, now]);

  // Dictionary search beyond the user's words: every lemma is reachable (spec 5.5, 7.3).
  const explore = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!inv || query.length < 2 || hasHebrew(query)) return [];
    return inv.lemmas.filter((l) => l.lemma.startsWith(query) && !words.has(l.id)).slice(0, 12);
  }, [inv, q, words]);

  const crownDist = useMemo(() => {
    const d = [0, 0, 0, 0, 0, 0];
    for (const w of words.values()) if (w.state !== 'ignored') d[Math.min(5, w.crowns)]!++;
    return d;
  }, [words]);
  const maxCrown = Math.max(1, ...crownDist);
  const topics = useMemo(() => {
    if (!inv) return [];
    const c = new Map<string, number>();
    for (const w of words.values())
      for (const tag of inv.byId.get(w.lemmaId)?.tags ?? []) c.set(tag, (c.get(tag) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [inv, words]);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Header title={t.library.title} />
      <div className="flex flex-col gap-3 px-4">
        <label className="card flex items-center gap-2 px-4">
          <SearchIcon className="text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.library.search}
            // Empty, the Hebrew placeholder reads right to left; typed text picks its own side.
            dir={q ? 'auto' : 'rtl'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 flex-1 bg-transparent outline-none"
            aria-label={t.library.search}
          />
        </label>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {(Object.keys(t.library.filters) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-pill px-3.5 py-2 text-sm font-semibold ${filter === f ? 'bg-accent text-accent-ink' : 'bg-card text-ink-2 shadow-card'}`}
            >
              {t.library.filters[f]}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {BANDS.map((b) => (
            <button
              key={b}
              type="button"
              dir="ltr"
              onClick={() => setBand(band === b ? null : b)}
              className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-bold ${band === b ? 'bg-ink text-bg' : 'bg-card-2 text-ink-2'}`}
            >
              {b}
            </button>
          ))}
          {topics.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTopic(topic === tag ? null : tag)}
              className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-bold ${topic === tag ? 'bg-ink text-bg' : 'bg-card-2 text-ink-2'}`}
            >
              {t.topics[tag] ?? tag}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm text-ink-3">
          <span>{t.library.count(rows.length)}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-lg bg-transparent py-1 text-sm"
            aria-label={t.library.sortLabel}
          >
            {(Object.keys(t.library.sort) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {t.library.sort[s]}
              </option>
            ))}
          </select>
        </div>

        {filter === 'all' && !q && words.size > 0 && (
          <div className="card flex items-end gap-2 p-4" aria-label={t.library.crownDist}>
            {crownDist.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] text-ink-3" dir="ltr">
                  {n}
                </span>
                <div
                  className="w-full rounded-t-md bg-accent"
                  style={{ height: `${8 + (n / maxCrown) * 56}px`, opacity: 0.35 + i * 0.13 }}
                />
                <Ltr className="text-[11px] text-warn">{i}♛</Ltr>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 && !explore.length && (
          <p className="py-10 text-center text-ink-3">
            {words.size ? t.library.noMatch : t.library.empty}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {rows.slice(0, 400).map((w) => {
            const l = inv?.byId.get(w.lemmaId);
            const c = peekContent(w.lemmaId);
            return (
              <li key={w.lemmaId}>
                <Link to={`/word/${w.lemmaId}`} className="card flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <En className="truncate text-lg font-semibold">{l?.lemma}</En>
                    <He className="truncate text-sm text-ink-2">{c?.hebrew.join(' · ') ?? ''}</He>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Crowns n={w.crowns} className="text-xs" />
                    <span className="text-[11px] text-ink-3">
                      {w.state === 'ignored'
                        ? t.word.state.ignored
                        : w.state === 'known'
                          ? t.word.state.known
                          : t.library.dueIn(relTime(w.nextDueAt))}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {explore.length > 0 && (
          <>
            <p className="pt-2 text-sm font-bold text-ink-3">{t.library.explore}</p>
            <ul className="flex flex-wrap gap-2" dir="ltr">
              {explore.map((l) => (
                <li key={l.id}>
                  <Link
                    to={`/word/${l.id}`}
                    className="en inline-block rounded-pill bg-card px-3 py-1.5 text-sm shadow-card"
                  >
                    {l.lemma} <span className="text-[10px] text-ink-3">{l.band}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
