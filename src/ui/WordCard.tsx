import type { WordContent } from '@/engine/types';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Bidi, En, Pill, Speak } from './kit';
import { LightbulbIcon } from './icons';
import { audioUrls, highlight } from './word-utils';

/** The full word card: word, IPA, audio, POS, Hebrew, sentences. Used on intros and mistakes. */
export function WordCard({
  word,
  sentences = 2,
  showHook = true,
  className = '',
  big = true,
}: {
  word: WordContent;
  sentences?: number;
  showHook?: boolean;
  className?: string;
  big?: boolean;
}) {
  const accent = useApp((s) => s.profile?.settings.accent ?? 'us');
  const ipa = accent === 'uk' && word.ipaUk ? word.ipaUk : word.ipa;
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <En className={`${big ? 'text-4xl' : 'text-2xl'} break-words font-bold leading-tight`}>
            {word.lemma}
          </En>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            {ipa && <span className="ipa">{ipa}</span>}
            {word.pos.slice(0, 2).map((p) => (
              <Pill key={p} className="bg-card-2 text-ink-2">
                {t.pos[p] ?? p}
              </Pill>
            ))}
            {word.auto && <Pill className="bg-warn-soft text-ink-2">{t.session.autoNote}</Pill>}
          </div>
        </div>
        <Speak text={word.lemma} urls={audioUrls(word)} isWord size={big ? 'lg' : 'md'} />
      </div>
      <p className={`${big ? 'text-2xl' : 'text-xl'} font-bold text-ink`}>
        {word.hebrew.join(' · ')}
      </p>
      {word.definition && (
        <p dir="ltr" className="en text-sm text-ink-3">
          {word.definition}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {word.sentences.slice(0, sentences).map((s) => (
          <li key={s.en} className="flex items-start gap-3 rounded-2xl bg-bg-2/70 p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <En className="text-[17px] leading-snug">{highlight(s.en, word)}</En>
              <span className="text-sm text-ink-2">{s.he}</span>
            </div>
            <Speak text={s.en} size="sm" label="השמעת המשפט" />
          </li>
        ))}
      </ul>
      {showHook && word.hook && (
        <p className="flex items-start gap-2 rounded-2xl bg-accent-soft p-3 text-sm">
          <LightbulbIcon size={18} className="mt-0.5 shrink-0 text-accent" />
          <Bidi>{word.hook}</Bidi>
        </p>
      )}
    </div>
  );
}
