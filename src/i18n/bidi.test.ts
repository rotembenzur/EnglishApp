/**
 * RTL and bidi (spec 8.3): the helper, every UI string, every push notification and the React
 * components. The source scan for Hebrew mixed with English outside the helper is in
 * scripts/bidi-scan.test.ts.
 *
 * Visual checks use a reference implementation of the Unicode Bidirectional Algorithm (bidi-js)
 * and assert what the eye sees, drawn left to right. The marks we emit (LRM, RLM, WJ) behave the
 * same in WebKit, so these hold on the iPhone too.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  LRM,
  RLM,
  WJ,
  bidi,
  bidiPlain,
  hasHebrew,
  isBidiSafe,
  ltr,
  splitBidi,
  stripBidi,
} from './bidi';
import { catalog, trickyStrings } from './catalog';
import { t } from './he';
import { pushText, sampleMessages } from '../../supabase/functions/_shared/schedule.ts';
import { He, Ltr } from '@/ui/bidi';
import { paragraphDir, visual } from '@/test/visual';

/** Every LTR run of the text shows up whole, in reading order, in the drawn line. */
function runsIntact(text: string, base: 'rtl' | 'auto' = 'rtl') {
  const drawn = visual(text, base);
  for (const seg of splitBidi(text)) if (seg.ltr) expect(drawn).toContain(seg.text);
}

describe('bidi helper', () => {
  it('keeps a number and an English code in reading order inside Hebrew', () => {
    const raw = 'השליחה לא הצליחה (403 BadJwtToken)';
    // The bug: in an RTL line the two LTR pieces swap.
    expect(visual(raw)).toContain('(BadJwtToken 403)');
    expect(visual(bidi(raw))).toContain('(403 BadJwtToken)');
  });

  it('starts a Hebrew line that opens with English with an RLM', () => {
    const raw = 'LexBites: ככה נראית תזכורת. ההתראות עובדות ✓';
    expect(paragraphDir(raw)).toBe('ltr');
    const fixed = bidi(raw);
    expect(fixed.startsWith(RLM)).toBe(true);
    expect(paragraphDir(fixed)).toBe('rtl');
    // RTL: the check mark ends the line on the left, "LexBites:" starts it on the right.
    expect(visual(fixed, 'auto').startsWith('✓')).toBe(true);
    expect(visual(fixed, 'auto').endsWith(':LexBites')).toBe(true);
  });

  it('keeps a number with its unit together', () => {
    expect(visual('נועה כבר ב־40 XP היום')).toContain('XP 40');
    expect(visual(bidi('נועה כבר ב־40 XP היום'))).toContain('40 XP־ב');
    expect(visual('10,000 XP')).toBe('XP 10,000');
    expect(visual(bidi('10,000 XP'))).toBe('10,000 XP');
  });

  it('keeps signs on the left of their number', () => {
    for (const [raw, sign] of [
      ['הרמה זזה ב־+0.4', '+0.4'],
      ['הרמה זזה ב־−0.3', '−0.3'],
      ['קומבו ×3', '×3'],
      ['5 מתוך ~25', '~25'],
    ]) {
      expect(visual(raw!)).not.toContain(sign!);
      expect(visual(bidi(raw!))).toContain(sign!);
    }
  });

  it('glues a Hebrew prefix to the English word it is attached to', () => {
    for (const raw of ['הורידו מ-LexBites', 'פותחים ב־Safari', 'כבר ב-40 XP']) {
      const segs = splitBidi(raw);
      const run = segs.find((s) => s.ltr)!;
      expect(run.prefix).toMatch(/^[א-ת]{1,3}[־-]$/);
      const out = bidi(raw);
      // Prefix, hyphen, word joiner, then the isolated word: no line break, right visual order.
      expect(out).toContain(`${run.prefix}${WJ}${LRM}${run.text}${LRM}`);
      expect(visual(out)).toContain(`${run.text}${[...run.prefix!].reverse().join('')}`);
    }
    // A hyphen after a whole word is not a prefix.
    expect(splitBidi('אנטי-virus').find((s) => s.ltr)?.prefix).toBeUndefined();
    // A hyphen before a number is a prefix, not a minus sign.
    expect(splitBidi('ל-5 ימים')).toEqual([{ text: 'ל-5 ימים', ltr: false }]);
  });

  it('leaves text that needs nothing untouched', () => {
    for (const s of ['יש לך 12 מילים', 'שיא: 365 ימים.', 'הליגה: 120:95', 'decide', 'XP', '']) {
      expect(bidi(s)).toBe(s);
      expect(isBidiSafe(s)).toBe(true);
    }
  });

  it('is idempotent and reversible', () => {
    for (const { text } of catalog()) {
      const once = bidi(text);
      expect(bidi(once)).toBe(once);
      expect(stripBidi(once)).toBe(stripBidi(text));
    }
  });

  it('keeps URLs and versions whole', () => {
    runsIntact(bidi('הוראות: https://example.com/a?b=1 ועוד'));
    expect(visual(bidi('גרסה 0.5.0 (beta)'))).toContain('(beta)');
    expect(ltr('0.5.0')).toBe(`${LRM}0.5.0${LRM}`);
  });

  it('bidiPlain always opens Hebrew with an RLM and leaves English alone', () => {
    expect(bidiPlain('הרצף בסכנה 🔥')).toBe(`${RLM}הרצף בסכנה 🔥`);
    expect(bidiPlain('LexBites')).toBe('LexBites');
  });
});

describe('every UI string', () => {
  const all = catalog();

  it('covers the whole strings table', () => {
    expect(all.length).toBeGreaterThan(450);
    expect(trickyStrings().length).toBeGreaterThan(40);
  });

  it('isolates every English run, sign and unit, and reads right to left', () => {
    const bad = all.filter((e) => !isBidiSafe(e.text)).map((e) => e.key);
    expect(bad).toEqual([]);
    for (const e of all) {
      if (!hasHebrew(e.text)) continue;
      expect(paragraphDir(e.text), e.key).toBe('rtl');
      runsIntact(e.text, 'auto');
    }
  });

  it('spot checks', () => {
    expect(visual(t.settings.pushTestFailed('403 BadJwtToken'))).toContain('(403 BadJwtToken)');
    expect(visual(t.summary.levelMoved(0.4))).toContain('+0.4');
    expect(visual(t.summary.levelMoved(-0.4))).toContain('−0.4');
    expect(visual(t.rival.leading(40))).toContain('40 XP');
    expect(visual(t.session.combo(3))).toContain('×3');
    expect(visual(t.placement.progress(5, 25))).toContain('~25');
    expect(visual(t.badges.xp_10000![1])).toBe('10,000 XP');
    expect(visual(t.settings.pushStatus.unsupported)).toContain('iOS 16.4');
  });
});

describe('push notifications', () => {
  const messages = sampleMessages(Date.UTC(2026, 9, 13, 12));

  it('send every title and body through the helper', () => {
    expect(messages.length).toBeGreaterThanOrEqual(10);
    for (const m of messages) {
      for (const text of [m.title, m.body]) {
        expect(bidiPlain(text)).toBe(text);
        if (hasHebrew(text)) {
          expect(text.startsWith(RLM)).toBe(true);
          expect(paragraphDir(text)).toBe('rtl');
        }
        runsIntact(text, 'auto');
      }
    }
  });

  it('renders the rival reminder in the right order', () => {
    const reminder = messages.find((m) => stripBidi(m.body).includes('1250 XP'))!;
    // Drawn left to right: "...היום" | "1250 XP" | "ב־" | name, read right to left. iOS picks
    // the direction from the first strong character, which is the leading RLM.
    expect(visual(reminder.body, 'auto')).toContain('1250 XP־ב');
  });

  it('pushText is what the server applies', () => {
    const m = pushText({
      kind: 'test',
      title: 'LexBites',
      body: 'LexBites מוכנה: 3 מילים, 40 XP',
      url: './',
      tag: 'x',
    });
    expect(m.title).toBe('LexBites');
    expect(m.body.startsWith(`${RLM}${LRM}LexBites${LRM}`)).toBe(true);
    expect(visual(m.body, 'auto').startsWith('40 XP')).toBe(true);
  });
});

describe('React rendering', () => {
  it('He isolates English runs and keeps prefixes on one line', () => {
    const html = renderToStaticMarkup(
      createElement(He, null, 'זוגות כמו affect ו־effect, ב-40 XP'),
    );
    expect(html).toBe(
      '<span dir="rtl" class="he ">זוגות כמו <span dir="ltr" class="ltr ">affect</span> ' +
        '<span class="whitespace-nowrap">ו־<span dir="ltr" class="ltr ">effect</span></span>, ' +
        '<span class="whitespace-nowrap">ב-<span dir="ltr" class="ltr ">40 XP</span></span></span>',
    );
  });

  it('He renders marked strings the same as raw ones', () => {
    const raw = 'נועה כבר ב־40 XP היום';
    const a = renderToStaticMarkup(createElement(He, null, raw));
    const b = renderToStaticMarkup(createElement(He, null, bidi(raw)));
    expect(a).toBe(b);
  });

  it('Ltr is an isolated LTR span', () => {
    expect(renderToStaticMarkup(createElement(Ltr, null, '0.5.0'))).toBe(
      '<span dir="ltr" class="ltr ">0.5.0</span>',
    );
  });
});
