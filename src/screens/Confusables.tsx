import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadConfusables, type Confusable } from '@/content/confusables';
import { t } from '@/i18n/he';
import { Header } from '@/ui/kit';
import { ConfusableCard } from '@/ui/ConfusableCard';
import { SearchIcon } from '@/ui/icons';

export function Confusables() {
  const nav = useNavigate();
  const [all, setAll] = useState<Confusable[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void loadConfusables().then(setAll);
  }, []);
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (all ?? [])
      .filter((c) => !query || c.words.some((w) => w.toLowerCase().includes(query)))
      .sort((a, b) => a.d - b.d);
  }, [all, q]);
  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header title={t.confusables.title} onBack={() => nav(-1)} />
      <div className="flex flex-col gap-3 px-4">
        <p className="text-sm text-ink-2">{t.confusables.intro}</p>
        <label className="card flex items-center gap-2 px-4">
          <SearchIcon className="text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="affect, borrow..."
            className="en h-12 flex-1 bg-transparent outline-none"
            aria-label={t.confusables.title}
          />
        </label>
        {all && !all.length && <p className="py-8 text-center text-ink-3">{t.common.soon}</p>}
        {list.map((c) =>
          open === c.id ? (
            <div key={c.id} onClick={() => setOpen(null)}>
              <ConfusableCard c={c} />
            </div>
          ) : (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpen(c.id)}
              className="card tap flex items-center justify-between px-4 py-3 text-start"
            >
              <span className="en text-lg font-semibold" dir="ltr">
                {c.words.join(' / ')}
              </span>
              <span className="text-xs text-ink-3" dir="ltr">
                {c.d < 30 ? 'A2' : c.d < 45 ? 'B1' : c.d < 62 ? 'B2' : 'C1'}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
