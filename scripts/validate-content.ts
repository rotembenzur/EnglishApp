/**
 * Validates authored content against content/schema.json and the quality rules
 * from spec section 10. Exits non-zero on any violation. Run: pnpm content:validate
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'content');

const HEBREW = /[֐-׿]/;

interface Sentence {
  en: string;
  he: string;
}
interface Entry {
  id: number;
  lemma: string;
  pos: string[];
  ipa: string;
  hebrew: string[];
  definition: string;
  sentences: Sentence[];
  collocations?: string[];
  hook?: string;
  tags?: string[];
  tier: 'A' | 'B';
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const schemaPath = path.join(contentDir, 'schema.json');
  const shardsDir = path.join(contentDir, 'shards');
  if (!existsSync(schemaPath) || !existsSync(shardsDir)) {
    console.info('content: nothing to validate yet');
    return;
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);

  const lemmasPath = path.join(contentDir, 'lemmas.json');
  const lemmaById = new Map<number, string>();
  if (existsSync(lemmasPath)) {
    const lemmas = JSON.parse(await readFile(lemmasPath, 'utf8')) as {
      id: number;
      lemma: string;
    }[];
    for (const l of lemmas) lemmaById.set(l.id, l.lemma);
  }

  const files = (await readdir(shardsDir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const entries = JSON.parse(await readFile(path.join(shardsDir, f), 'utf8')) as Entry[];
    if (!validate(entries)) {
      for (const e of validate.errors ?? []) problems.push(`${f}: ${e.instancePath} ${e.message}`);
    }
    for (const e of entries) {
      total++;
      const where = `${f}#${e.lemma}`;
      if (seen.has(e.lemma)) problems.push(`${where}: duplicate lemma`);
      seen.add(e.lemma);
      if (lemmaById.size && lemmaById.get(e.id) !== e.lemma)
        problems.push(`${where}: id ${e.id} does not match lemmas.json (${lemmaById.get(e.id)})`);
      if (e.sentences.length < 2) problems.push(`${where}: fewer than 2 sentences`);
      for (const h of e.hebrew) {
        if (!HEBREW.test(h)) problems.push(`${where}: hebrew "${h}" has no Hebrew characters`);
      }
      if (HEBREW.test(e.definition)) problems.push(`${where}: definition contains Hebrew`);
      if (HEBREW.test(e.ipa)) problems.push(`${where}: ipa contains Hebrew`);
      for (const s of e.sentences) {
        if (HEBREW.test(s.en)) problems.push(`${where}: english sentence contains Hebrew: ${s.en}`);
        if (!HEBREW.test(s.he)) problems.push(`${where}: hebrew sentence has no Hebrew: ${s.he}`);
        if (
          !s.en
            .toLowerCase()
            .includes(e.lemma.slice(0, Math.max(3, e.lemma.length - 3)).toLowerCase())
        )
          problems.push(`${where}: sentence does not seem to use the lemma: ${s.en}`);
      }
      for (const c of e.collocations ?? []) {
        if (HEBREW.test(c)) problems.push(`${where}: collocation contains Hebrew: ${c}`);
      }
      if (e.hook && !HEBREW.test(e.hook)) problems.push(`${where}: hook is not in Hebrew`);
    }
  }

  const curatedDir = path.join(contentDir, 'curated');
  if (existsSync(curatedDir)) {
    for (const f of (await readdir(curatedDir)).filter((x) => x.endsWith('.json'))) {
      const items = JSON.parse(await readFile(path.join(curatedDir, f), 'utf8')) as {
        text: string;
        hebrew: string[];
        sentences: Sentence[];
      }[];
      const seenText = new Set<string>();
      for (const it of items) {
        const where = `${f}#${it.text}`;
        if (seenText.has(it.text)) problems.push(`${where}: duplicate`);
        seenText.add(it.text);
        if (!it.hebrew?.length || !it.hebrew.every((h) => HEBREW.test(h)))
          problems.push(`${where}: missing Hebrew`);
        if (!it.sentences || it.sentences.length < 2)
          problems.push(`${where}: fewer than 2 sentences`);
        for (const s of it.sentences ?? []) {
          if (HEBREW.test(s.en)) problems.push(`${where}: english sentence contains Hebrew`);
          if (!HEBREW.test(s.he)) problems.push(`${where}: hebrew sentence has no Hebrew`);
        }
      }
    }
  }

  if (problems.length) {
    console.error(`content: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 200)) console.error('  ' + p);
    process.exit(1);
  }
  console.info(`content: ${files.length} shards, ${total} Tier A entries valid`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
