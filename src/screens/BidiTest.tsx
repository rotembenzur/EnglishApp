import { Bidi, En, Header } from '@/ui/kit';
import { t } from '@/i18n/he';

/** Dev-only page listing tricky mixed-direction strings (spec 8.3). */
const CASES = [
  'יש לך 12 מילים שמחכות',
  'נועה כבר ב־40 XP היום',
  'המילה decide נלמדה',
  'עברת ל־B2!',
  'שיא: 365 ימים.',
  '(beta) גרסה 0.2.0',
  'תודה! "break the ice" נוסף למועדפות.',
  'הליגה: 120:95 לטובתך',
  'URL: https://example.com/a?b=1',
  '50% מהחזרות היום',
  '⌨️ 50 מילים מוקלדות נכון',
];

export function BidiTest() {
  return (
    <div className="flex flex-col gap-4 pb-10">
      <Header title={t.settings.bidiTest} onBack={() => history.back()} />
      <div className="flex flex-col gap-3 px-4">
        {CASES.map((c) => (
          <div key={c} className="card flex flex-col gap-1 p-3">
            <Bidi>{c}</Bidi>
            <span className="text-xs text-ink-3">plain: {c}</span>
          </div>
        ))}
        <div className="card p-3">
          <En>She said “I&apos;ll decide tomorrow,” and left.</En>
        </div>
        <div className="card p-3">
          <span className="ipa">/dɪˈsaɪd/</span>
        </div>
      </div>
    </div>
  );
}
