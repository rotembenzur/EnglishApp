import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkEntry,
  compileSchema,
  contentDir,
  sentenceUsesLemma,
  type Entry,
} from './content-rules';

const shardsDir = path.join(contentDir, 'shards');
const files = existsSync(shardsDir)
  ? readdirSync(shardsDir).filter((f) => /^\d{4}\.json$/.test(f))
  : [];
const HEBREW = /[֐-׿]/;

describe('Tier A content', () => {
  it('every shard validates against the schema and the quality rules', async () => {
    const validate = await compileSchema();
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      const entries = JSON.parse(readFileSync(path.join(shardsDir, f), 'utf8')) as Entry[];
      if (!validate(entries)) problems.push(`${f}: schema`);
      for (const e of entries) {
        if (seen.has(e.lemma)) problems.push(`${f}#${e.id}: duplicate`);
        seen.add(e.lemma);
        problems.push(...checkEntry(e, `${f}#${e.id}`));
        expect(e.sentences.length).toBeGreaterThanOrEqual(2);
        for (const s of e.sentences) {
          expect(HEBREW.test(s.he)).toBe(true);
          expect(HEBREW.test(s.en)).toBe(false);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the lemma check accepts inflections and listed forms', () => {
    expect(sentenceUsesLemma('She decided to stay.', 'decide')).toBe(true);
    expect(sentenceUsesLemma('He tried again.', 'try')).toBe(true);
    expect(sentenceUsesLemma('We went home.', 'go', ['went'])).toBe(true);
    expect(sentenceUsesLemma('Nothing here.', 'decide')).toBe(false);
  });
});
