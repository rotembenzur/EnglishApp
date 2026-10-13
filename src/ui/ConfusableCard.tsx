import type { Confusable } from '@/content/confusables';
import { En, Speak } from './kit';
import { He } from './bidi';
import { t } from '@/i18n/he';
import { LightbulbIcon } from './icons';

export function ConfusableCard({ c }: { c: Confusable }) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <p className="flex flex-wrap items-center gap-2 text-xl font-bold" dir="ltr">
        {c.words.map((w, i) => (
          <span key={w} className="en">
            {i > 0 && <span className="mx-1 text-ink-3">/</span>}
            {w}
          </span>
        ))}
      </p>
      <p className="leading-relaxed">
        <He>{c.explanation}</He>
      </p>
      <p className="flex items-start gap-2 rounded-2xl bg-accent-soft p-3 text-sm">
        <LightbulbIcon size={18} className="mt-0.5 shrink-0 text-accent" />
        <He>{c.tip}</He>
      </p>
      <ul className="flex flex-col gap-2">
        {c.examples.map((e) => (
          <li key={e.en} className="flex items-start gap-3 rounded-2xl bg-bg-2/70 p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-bold text-accent" dir="ltr">
                {e.word}
              </span>
              <En className="leading-snug">{e.en}</En>
              <He className="text-sm text-ink-2">{e.he}</He>
            </div>
            <Speak text={e.en} size="sm" label={t.common.playSentence} />
          </li>
        ))}
      </ul>
    </div>
  );
}
