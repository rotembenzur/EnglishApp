import { useEffect, useState } from 'react';
import { En, Header } from '@/ui/kit';
import { He, Ltr } from '@/ui/bidi';
import { t } from '@/i18n/he';
import { hasLatin, stripBidi } from '@/i18n/bidi';
import tricky from '@/i18n/bidi-catalog.json';
import { sampleMessages } from '../../supabase/functions/_shared/schedule.ts';
import { loadConfusables } from '@/content/confusables';
import { getContent, loadInventory } from '@/content/inventory';
import { drawLeagueCard, drawSessionCard } from '@/ui/share';

/**
 * Bidi test page (spec 8.3), at /dev/bidi: every UI string that mixes Hebrew with English, digits
 * or signs, Hebrew content with English inside, every push notification, the share cards and the
 * inputs. Check it on the iPhone after any change to strings or bidi rules.
 */
export function BidiTest() {
  const strings = tricky;
  const [content, setContent] = useState<string[]>([]);
  const [cards, setCards] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const found: string[] = [];
      const pairs = await loadConfusables();
      for (const c of pairs) {
        if (hasLatin(c.explanation)) found.push(c.explanation);
        if (hasLatin(c.tip)) found.push(c.tip);
        if (found.length >= 6) break;
      }
      const inv = await loadInventory();
      const words = inv.lemmas.filter((l) => l.tier === 'A' && l.kind === 'word').slice(0, 300);
      for (const l of words) {
        const w = await getContent(l.id);
        if (!w) continue;
        for (const s of [w.hook ?? '', ...w.hebrew, ...w.sentences.map((x) => x.he)])
          if (hasLatin(s) || /[0-9]/.test(s)) found.push(s);
        if (found.length >= 16) break;
      }
      if (alive) setContent([...new Set(found)].slice(0, 16));
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void document.fonts.ready.then(() =>
      setCards(
        [
          drawSessionCard({ name: 'רתם', xp: 125, accuracy: 92, words: 8, mode: 'learn' }),
          drawLeagueCard({ a: 'רתם', b: 'נועה', aXp: 1250, bXp: 980, week: '2026-10-12' }),
        ].map((c) => c.toDataURL('image/png')),
      ),
    );
  }, []);

  return (
    <div
      className="scroll-pane flex h-full flex-col gap-4 pb-10"
      style={{ paddingTop: 'var(--sat)' }}
    >
      <Header title={t.settings.bidiTest} onBack={() => history.back()} />
      <div className="flex flex-col gap-5 px-4">
        <section className="flex flex-col gap-2" data-testid="bidi-strings">
          <h2 className="text-sm font-bold text-ink-3">
            <Ltr>{strings.length}</Ltr> מחרוזות ממשק עם אנגלית, מספרים או סימנים
          </h2>
          {strings.map((e) => (
            <div key={e.key} className="card flex flex-col gap-1 p-3">
              <p>{e.text}</p>
              <span className="en text-[10px] text-ink-3" dir="ltr">
                {e.key}
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2" data-testid="bidi-content">
          <h2 className="text-sm font-bold text-ink-3">תוכן בעברית עם אנגלית</h2>
          {content.map((c) => (
            <div key={c} className="card p-3">
              <He>{c}</He>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2" data-testid="bidi-push">
          <h2 className="text-sm font-bold text-ink-3">התראות (טקסט פשוט, כיוון לפי התו הראשון)</h2>
          {sampleMessages().map((m, i) => (
            <div key={i} className="card flex flex-col gap-0.5 p-3 text-sm">
              <p dir="auto" style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}>
                <strong>{m.title}</strong>
              </p>
              <p dir="auto" style={{ unicodeBidi: 'plaintext', textAlign: 'start' }}>
                {m.body}
              </p>
              <span className="en text-[10px] text-ink-3" dir="ltr">
                {m.kind}: {JSON.stringify(stripBidi(m.body))}
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-ink-3">כרטיסי שיתוף</h2>
          {cards.map((src, i) => (
            <img key={i} src={src} alt="" className="card w-full" />
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-ink-3">אנגלית ושדות קלט</h2>
          <div className="card flex flex-col gap-2 p-3">
            <En>She said “I&apos;ll decide tomorrow,” and left.</En>
            <span className="ipa">/dɪˈsaɪd/</span>
            <input
              dir="ltr"
              lang="en"
              className="en rounded-xl border border-line bg-card px-3 py-2"
              defaultValue="decide"
              aria-label="typing"
            />
            <input
              dir="auto"
              className="rounded-xl border border-line bg-card px-3 py-2"
              defaultValue="להחליט"
              aria-label="search"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
