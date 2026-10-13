/**
 * Bidi regression guard (spec 8.3): fails when source code mixes Hebrew with English letters,
 * digits or interpolation in a string or in JSX text outside the bidi helper. Such text belongs in
 * src/i18n/he.ts, where every string passes through bidi() and is checked by
 * src/i18n/bidi.test.ts.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { trickyStrings } from '@/i18n/catalog';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose Hebrew goes through the helper as a whole, verified above. */
const THROUGH_HELPER: Record<string, string> = {
  'supabase/functions/_shared/bidi.ts': 'the helper itself',
  'src/i18n/he.ts': 'every string passes through bidiStrings(); see "every UI string"',
  'supabase/functions/_shared/schedule.ts': 'every message passes through pushText()',
  'src/screens/BidiTest.tsx': 'the dev page shows strings as they are, on purpose',
  'src/i18n/catalog.ts': 'sample arguments for the catalog',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|js)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name) ? [p] : [];
  });
}

const HEB = /[\u0590-\u05FF]/;
const MIXED = /[A-Za-z0-9]|\$\{/;

/** Hebrew string literals and JSX text that also hold Latin letters, digits or ${...}. */
function mixedHebrew(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const found: string[] = [];
  const literal = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const m of code.matchAll(literal)) {
    const s = m[0];
    if (HEB.test(s) && MIXED.test(s.slice(1, -1).replace(/\\u[0-9a-fA-F]{4}/g, ''))) found.push(s);
  }
  // What is left with Hebrew in it is JSX text: flag it when English or digits sit next to it.
  for (const line of code.replace(literal, "''").split('\n')) {
    if (!HEB.test(line)) continue;
    const text = line.replace(/\{[^}]*\}/g, ' ').replace(/<[^>]*>/g, ' ');
    if (
      HEB.test(text) &&
      (/[0-9]/.test(text) || /[A-Za-z]{2,}/.test(text) || /\}\s*[א-ת]|[א-ת]\s*\{/.test(line))
    )
      found.push(line.trim());
  }
  return found;
}

describe('source scan', () => {
  it('finds mixed strings (self test)', () => {
    expect(mixedHebrew("toast('נשמרו 3 מילים')")).toHaveLength(1);
    expect(mixedHebrew('const a = `${n} כתרים`;')).toHaveLength(1);
    expect(mixedHebrew('<p>עוד XP היום</p>')).toHaveLength(1);
    expect(mixedHebrew('<p>{n} מילים</p>')).toHaveLength(1);
    expect(mixedHebrew("const a = 'מילים'; // 12 XP")).toEqual([]);
    expect(mixedHebrew('<p>{t.home.learn}</p>')).toEqual([]);
  });

  it('has no Hebrew mixed with English or digits outside the helper', () => {
    const roots = ['src', 'supabase/functions', 'public/sw-push.js'];
    const offenders: string[] = [];
    for (const r of roots) {
      const abs = path.join(ROOT, r);
      for (const f of statSync(abs).isDirectory() ? files(abs) : [abs]) {
        const rel = path.relative(ROOT, f);
        if (THROUGH_HELPER[rel]) continue;
        for (const hit of mixedHebrew(readFileSync(f, 'utf8'))) offenders.push(`${rel}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('bidi test page', () => {
  it('keeps its list of tricky strings current (src/i18n/bidi-catalog.json)', () => {
    // The page cannot sample string functions itself: minified code has no parameter names.
    // Locally the file is rewritten when strings change; CI fails if it was not committed.
    const file = path.join(ROOT, 'src/i18n/bidi-catalog.json');
    const fresh = JSON.stringify(trickyStrings(), null, 2) + '\n';
    if (!process.env.CI && readFileSync(file, 'utf8') !== fresh) writeFileSync(file, fresh);
    expect(readFileSync(file, 'utf8')).toBe(fresh);
  });
});
