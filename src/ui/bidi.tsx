/**
 * React side of the bidi rules (spec 8.3, src/i18n/bidi.ts).
 *  - <Ltr>: one LTR fragment inside Hebrew (a number with a unit, a version, a URL, a code),
 *    isolated with dir="ltr" and unicode-bidi: isolate.
 *  - <He>: a Hebrew paragraph that may carry English (translations, sentence translations, memory
 *    hooks, explanations, toasts). Explicitly RTL, every LTR run isolated in its own <Ltr>, and a
 *    Hebrew prefix ("ל־", "מ-") kept on the same line as its word.
 */
import type { ReactNode } from 'react';
import { splitBidi } from '@/i18n/bidi';

export function Ltr({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`ltr ${className}`}>
      {children}
    </span>
  );
}

export function He({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span dir="rtl" className={`he ${className}`}>
      {splitBidi(children).map((seg, i) =>
        !seg.ltr ? (
          seg.text
        ) : seg.prefix ? (
          <span key={i} className="whitespace-nowrap">
            {seg.prefix}
            <Ltr>{seg.text}</Ltr>
          </span>
        ) : (
          <Ltr key={i}>{seg.text}</Ltr>
        ),
      )}
    </span>
  );
}
