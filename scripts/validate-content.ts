/**
 * Validates authored content against content/schema.json and the quality rules
 * from spec section 10. Exits non-zero on any violation. Run: pnpm content:validate
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  checkEntry,
  compileSchema,
  contentDir,
  loadLemmas,
  shardsDir,
  SHARD_SIZE,
  type Entry,
  type Sentence,
} from './content-rules';

const HEBREW = /[\u0590-\u05FF]/;

async function main(): Promise<void> {
  const problems: string[] = [];
  const lemmasPath = path.join(contentDir, 'lemmas.json');
  if (!existsSync(lemmasPath)) {
    console.info('content: no lemma inventory yet');
    return;
  }
  const lemmas = await loadLemmas();
  if (lemmas.length < 50000) problems.push(`lemmas.json has ${lemmas.length} entries (< 50,000)`);
  const lemmaById = new Map(lemmas.map((l) => [l.id, l]));
  if (lemmaById.size !== lemmas.length) problems.push('lemmas.json has duplicate ids');
  if (new Set(lemmas.map((l) => l.lemma)).size !== lemmas.length)
    problems.push('lemmas.json has duplicate lemmas');

  const validate = await compileSchema();
  const files = existsSync(shardsDir)
    ? (await readdir(shardsDir)).filter((f) => /^\d{4}\.json$/.test(f)).sort()
    : [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const index = Number(f.slice(0, 4));
    const entries = JSON.parse(await readFile(path.join(shardsDir, f), 'utf8')) as Entry[];
    if (!validate(entries)) {
      for (const e of (validate.errors ?? []).slice(0, 20))
        problems.push(`${f}: ${e.instancePath} ${e.message}`);
    }
    for (const e of entries) {
      total++;
      const where = `${f}#${e.id}`;
      if (seen.has(e.lemma)) problems.push(`${where}: duplicate lemma`);
      seen.add(e.lemma);
      const lem = lemmaById.get(e.id);
      if (!lem || lem.lemma !== e.lemma) problems.push(`${where}: id does not match lemmas.json`);
      else if (Math.floor((lem.rank - 1) / SHARD_SIZE) !== index)
        problems.push(`${where}: lemma belongs to another shard`);
      problems.push(...checkEntry(e, where));
    }
  }

  const curatedDir = path.join(contentDir, 'curated');
  if (existsSync(curatedDir)) {
    for (const f of (await readdir(curatedDir)).filter((x) => x.endsWith('.json'))) {
      const items = JSON.parse(await readFile(path.join(curatedDir, f), 'utf8')) as {
        id: string;
        text: string;
        hebrew: string[];
        sentences: Sentence[];
      }[];
      const seenText = new Set<string>();
      for (const it of items) {
        const where = `${f}#${it.id}`;
        if (!it.id) problems.push(`${f}: item without id`);
        if (seenText.has(it.text)) problems.push(`${where}: duplicate`);
        seenText.add(it.text);
        if (!it.hebrew?.length || !it.hebrew.every((h) => HEBREW.test(h)))
          problems.push(`${where}: missing Hebrew`);
        if (!it.sentences || it.sentences.length < 2)
          problems.push(`${where}: fewer than 2 sentences`);
        for (const s of it.sentences ?? []) {
          if (HEBREW.test(s.en)) problems.push(`${where}: English sentence contains Hebrew`);
          if (!HEBREW.test(s.he)) problems.push(`${where}: Hebrew sentence has no Hebrew`);
        }
      }
    }
  }

  const placementPath = path.join(contentDir, 'placement.json');
  if (existsSync(placementPath)) {
    const bank = JSON.parse(await readFile(placementPath, 'utf8')) as {
      id: number;
      lemma: string;
      pos: string;
      d: number;
      he: string;
    }[];
    const ids = new Set<number>();
    for (const b of bank) {
      if (ids.has(b.id)) problems.push(`placement.json#${b.id}: duplicate`);
      ids.add(b.id);
      if (lemmaById.get(b.id)?.lemma !== b.lemma)
        problems.push(`placement.json#${b.id}: does not match lemmas.json`);
      if (!HEBREW.test(b.he)) problems.push(`placement.json#${b.id}: Hebrew missing`);
    }
    if (bank.length < 200) problems.push(`placement.json has only ${bank.length} items`);
  }

  if (problems.length) {
    console.error(`content: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 200)) console.error('  ' + p);
    process.exit(1);
  }
  console.info(
    `content: ${lemmas.length} lemmas, ${files.length} shards, ${total} Tier A entries valid`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
