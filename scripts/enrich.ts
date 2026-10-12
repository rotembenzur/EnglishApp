/**
 * Tier A authoring pipeline (spec 5.2). Makes every content pass mechanical.
 *
 *   pnpm enrich --from 1 --to 3000      Write authoring tasks for every missing shard in the
 *                                       rank range to scripts/.cache/tasks/ and print a summary.
 *   pnpm enrich --shard 7 --print       Print the authoring task for shard 7 to stdout.
 *   pnpm enrich --check 7               Validate shard 7 and report coverage.
 *   pnpm enrich --status                Coverage of the whole inventory.
 *   pnpm enrich --shard 7 --api         Author shard 7 through the Anthropic API, in chunks
 *                                       (only when ANTHROPIC_API_KEY is set; never required).
 *
 * Shard N holds ranks N*200+1 .. N*200+200 in content/shards/NNNN.json.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  checkEntry,
  compileSchema,
  lemmasForShard,
  loadLemmas,
  root,
  shardFile,
  shardsDir,
  SHARD_SIZE,
  type Entry,
  type Lemma,
} from './content-rules';

const tasksDir = path.join(root, 'scripts', '.cache', 'tasks');

const EXAMPLE: Entry = {
  id: 512,
  lemma: 'decide',
  pos: ['verb'],
  ipa: '/dɪˈsaɪd/',
  hebrew: ['להחליט', 'להכריע'],
  definition: 'to choose what to do after thinking about the options',
  sentences: [
    {
      en: "We still haven't decided where to go for dinner.",
      he: 'עדיין לא החלטנו לאן ללכת לארוחת ערב.',
    },
    {
      en: 'She decided to quit her job and travel for a year.',
      he: 'היא החליטה לעזוב את העבודה ולטייל במשך שנה.',
    },
    {
      en: 'One goal in the last minute decided the game.',
      he: 'שער אחד בדקה האחרונה הכריע את המשחק.',
    },
  ],
  collocations: ['decide to do something', 'decide between', 'decide against', 'hard to decide'],
  hook: 'decide נשמע כמו "די, סייד": די, בחרת צד',
  context: {
    en: "I spent an hour reading reviews of two laptops. In the end I couldn't decide, so I asked my sister. She looked at both for ten seconds and picked one. Sometimes you just need someone else to decide for you.",
    he: 'ביליתי שעה בקריאת ביקורות על שני מחשבים ניידים. בסוף לא הצלחתי להחליט, אז שאלתי את אחותי. היא הסתכלה על שניהם עשר שניות ובחרה אחד. לפעמים פשוט צריך שמישהו אחר יחליט בשבילך.',
  },
  tags: ['everyday'],
  tier: 'A',
};

export function authoringTask(index: number, lemmas: Lemma[], existing: Entry[] = []): string {
  const have = new Set(existing.map((e) => e.id));
  const todo = lemmas.filter((l) => !have.has(l.id));
  const lines = todo.map(
    (l) =>
      `${l.id}\t${l.lemma}\t${l.pos.join(',')}\t${l.band}${l.tags ? '\t' + l.tags.join(',') : ''}`,
  );
  return `# LexBites Tier A authoring task: shard ${String(index).padStart(4, '0')}

Write \`content/shards/${String(index).padStart(4, '0')}.json\`: a JSON array with one entry per lemma
below, in the same order, validated by \`content/schema.json\` (run \`pnpm enrich --check ${index}\`).
${existing.length ? `The file already has ${existing.length} entries; add the missing ones and keep rank order.\n` : ''}
## Rules

- Learners: Hebrew-speaking adults, B1 to C1, general fluency (conversation, work, travel, media).
- \`id\` and \`lemma\` exactly as given. \`pos\`: the word's real parts of speech, most common first
  (allowed: noun, verb, adj, adv, prep, conj, pron, det, aux, interj, num, other).
- \`ipa\`: American pronunciation between slashes. Add \`ipaUk\` only when British differs clearly.
- \`hebrew\`: 1 to 3 translations, one per distinct common sense, most common first. Lemma form
  (infinitive for verbs, singular masculine for adjectives unless the English is plural). Modern
  everyday Hebrew, no niqqud. Ambiguous words get a second sense ("bank": בנק, גדה).
  Function words get a short functional gloss (for "the": ה- (הידיעה)).
- \`definition\`: a short, plain English learner definition of the most common sense.
- \`sentences\`: exactly 3, each \`{en, he}\`. Natural sentences a real person would say or read,
  varied contexts (home, work, travel, news, friends), first one uses the most common sense,
  B1 to C1 register, 6 to 18 words. The Hebrew is a natural translation, not word-for-word.
  Every English sentence must contain the lemma or one of its inflections. Irregular inflections
  that appear in sentences (went, children, better) go in \`forms\`.
- \`collocations\`: 2 to 4 common English collocations.
- \`hook\`: optional one-line memory hook in Hebrew; include it only when it genuinely helps
  (sound-alike, root, contrast). Skip for trivial words.
- \`context\`: a 3 to 4 sentence mini paragraph using the word naturally, with a Hebrew translation.
  Required for content words (nouns, verbs, adjectives, adverbs); omit for function words.
- \`tags\`: 0 to 4 of family, work, travel, food, tech, emotions, health, nature, law, finance,
  academic, slang, everyday, media.
- \`tier\`: "A".
- Gender-neutral Hebrew where natural. No offensive content. JSON only, UTF-8, no comments.

## Example entry

\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`

## Lemmas (${todo.length}): id, lemma, pos hint, band, topic hint

${lines.join('\n')}
`;
}

async function readShard(index: number): Promise<Entry[]> {
  const f = shardFile(index);
  if (!existsSync(f)) return [];
  return JSON.parse(await readFile(f, 'utf8')) as Entry[];
}

async function check(index: number, lemmas: Lemma[]): Promise<boolean> {
  const validate = await compileSchema();
  const entries = await readShard(index);
  const expected = lemmasForShard(lemmas, index);
  const problems: string[] = [];
  if (!validate(entries)) {
    for (const e of (validate.errors ?? []).slice(0, 30))
      problems.push(`${e.instancePath} ${e.message}`);
  }
  const byId = new Map(expected.map((l) => [l.id, l]));
  for (const e of entries) {
    const l = byId.get(e.id);
    if (!l || l.lemma !== e.lemma) problems.push(`#${e.id}: not a lemma of this shard`);
    problems.push(...checkEntry(e, `#${e.id}`));
  }
  const order = entries.map((e) => byId.get(e.id)?.rank ?? 0);
  if (order.some((r, i) => i > 0 && r < order[i - 1]!))
    problems.push('entries are not in rank order');
  const missing = expected.filter((l) => !entries.some((e) => e.id === l.id)).length;
  console.info(
    `shard ${index}: ${entries.length}/${expected.length} entries, ${missing} missing, ${problems.length} problem(s)`,
  );
  for (const p of problems.slice(0, 60)) console.info('  ' + p);
  return problems.length === 0;
}

async function authorWithApi(index: number, lemmas: Lemma[]): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set; author the shard directly instead.');
  const model = process.env.LEXBITES_MODEL ?? 'claude-sonnet-5-5';
  const all = lemmasForShard(lemmas, index);
  let entries = await readShard(index);
  for (let i = 0; i < all.length; i += 25) {
    const chunk = all.slice(i, i + 25).filter((l) => !entries.some((e) => e.id === l.id));
    if (!chunk.length) continue;
    const prompt =
      authoringTask(index, chunk) +
      '\n\nReturn only the JSON array for these lemmas, nothing else.';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 32000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = body.content.map((c) => c.text ?? '').join('');
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const got = JSON.parse(json) as Entry[];
    const rank = new Map(all.map((l) => [l.id, l.rank]));
    entries = [...entries, ...got.filter((e) => rank.has(e.id))].sort(
      (a, b) => rank.get(a.id)! - rank.get(b.id)!,
    );
    await mkdir(shardsDir, { recursive: true });
    await writeFile(shardFile(index), JSON.stringify(entries, null, 2) + '\n');
    console.info(`shard ${index}: ${entries.length}/${all.length}`);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const lemmas = await loadLemmas();
  const has = (n: string) => process.argv.includes(`--${n}`);

  if (has('status')) {
    const files = existsSync(shardsDir)
      ? (await readdir(shardsDir)).filter((f) => /^\d{4}\.json$/.test(f))
      : [];
    let total = 0;
    for (const f of files) total += (await readShard(Number(f.slice(0, 4)))).length;
    console.info(
      `Tier A: ${total} of ${lemmas.length} lemmas in ${files.length} shards (${((total / lemmas.length) * 100).toFixed(2)}%)`,
    );
    return;
  }
  if (arg('check') !== undefined) {
    const ok = await check(Number(arg('check')), lemmas);
    process.exit(ok ? 0 : 1);
  }
  if (arg('shard') !== undefined) {
    const index = Number(arg('shard'));
    if (has('api')) return authorWithApi(index, lemmas);
    const task = authoringTask(index, lemmasForShard(lemmas, index), await readShard(index));
    if (has('print')) {
      process.stdout.write(task);
      return;
    }
    await mkdir(tasksDir, { recursive: true });
    const out = path.join(tasksDir, `shard-${String(index).padStart(4, '0')}.md`);
    await writeFile(out, task);
    console.info(`task written: ${path.relative(root, out)}`);
    return;
  }
  const from = Number(arg('from') ?? 1);
  const to = Number(arg('to') ?? from + SHARD_SIZE - 1);
  await mkdir(tasksDir, { recursive: true });
  const first = Math.floor((from - 1) / SHARD_SIZE);
  const last = Math.floor((to - 1) / SHARD_SIZE);
  let written = 0;
  for (let i = first; i <= last; i++) {
    const have = await readShard(i);
    const expected = lemmasForShard(lemmas, i);
    if (have.length >= expected.length) continue;
    await writeFile(
      path.join(tasksDir, `shard-${String(i).padStart(4, '0')}.md`),
      authoringTask(i, expected, have),
    );
    written++;
  }
  console.info(
    `ranks ${from}..${to}: shards ${first}..${last}, ${written} task file(s) in scripts/.cache/tasks/`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
