/**
 * Audio plan: every clip the app should have, and which of them still need rendering.
 *
 *   pnpm audio:plan [--store store.json] [--out audio-work] [--limit N]
 *
 * Words and curated items get an American and a British clip at normal and slow speed; example
 * sentences get an American clip. Each clip has a generation hash (`g`) over everything that
 * shapes its sound (pipeline version, model, voice, speed, text, our IPA, overrides). Clips whose
 * hash is already in the store are reused, so only new or changed text is rendered again.
 * Prints counts only.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clipKey, normText } from '../../src/audio/key';
import { contentDir } from '../content-rules';

export const audioDir = path.dirname(new URL(import.meta.url).pathname);

export interface AudioConfig {
  pipeline: number;
  model: string;
  modelUrl: string;
  voices: { us: string; uk: string };
  slowSpeed: number;
  aacBitrate: string;
  sampleRate: number;
  chunks: number;
  asrFirst: string;
  asrSecond: string;
  sentenceSampleEvery: number;
  release: string;
}

export type Accent = 'us' | 'uk';

export interface WordUnit {
  type: 'word';
  key: string;
  voice: Accent;
  text: string;
  ipa?: string;
  /** American IPA, used to pick the right reading of a heteronym for both voices. */
  refIpa?: string;
  override?: string;
  bucket: string;
  /** Generation hashes of the normal and the slow clip. */
  g: string;
  gs: string;
}

export interface SentenceUnit {
  type: 'sentence';
  key: string;
  voice: 'us';
  text: string;
  bucket: string;
  sample: boolean;
  g: string;
}

export interface Plan {
  pipeline: number;
  words: WordUnit[];
  sentences: SentenceUnit[];
}

export async function loadConfig(): Promise<AudioConfig> {
  return JSON.parse(await readFile(path.join(audioDir, 'config.json'), 'utf8')) as AudioConfig;
}

interface ShardEntry {
  lemma: string;
  ipa?: string;
  ipaUk?: string;
  sentences: { en: string }[];
}
interface CuratedEntry {
  text: string;
  sentences: { en: string }[];
}

const sha = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

export async function buildPlan(cfg: AudioConfig): Promise<Plan> {
  const overrides = JSON.parse(
    await readFile(path.join(audioDir, 'overrides.json'), 'utf8'),
  ) as Record<string, string>;
  const words = new Map<string, WordUnit>();
  const sentences = new Map<string, SentenceUnit>();

  const addWord = (text: string, bucket: string, ipa?: string, ipaUk?: string) => {
    const t = normText(text);
    if (!t) return;
    for (const voice of ['us', 'uk'] as const) {
      const key = clipKey(t);
      if (words.has(`${voice}:${key}`)) continue;
      const own = voice === 'us' ? ipa : ipaUk;
      const override = overrides[`${voice}:${t}`];
      const base = [
        cfg.pipeline,
        cfg.model,
        cfg.voices[voice],
        t,
        own ?? '',
        ipa ?? '',
        override ?? '',
      ];
      words.set(`${voice}:${key}`, {
        type: 'word',
        key,
        voice,
        text: t,
        ...(own ? { ipa: own } : {}),
        ...(ipa ? { refIpa: ipa } : {}),
        ...(override ? { override } : {}),
        bucket,
        g: sha([...base, 1, cfg.aacBitrate]),
        gs: sha([...base, cfg.slowSpeed, cfg.aacBitrate]),
      });
    }
  };
  const addSentence = (text: string, bucket: string) => {
    const t = normText(text);
    if (!t) return;
    const key = clipKey(t);
    if (sentences.has(key)) return;
    sentences.set(key, {
      type: 'sentence',
      key,
      voice: 'us',
      text: t,
      bucket,
      sample: parseInt(key.slice(-4), 36) % cfg.sentenceSampleEvery === 0,
      g: sha([cfg.pipeline, cfg.model, cfg.voices.us, t, 1, cfg.aacBitrate]),
    });
  };

  const shardsDir = path.join(contentDir, 'shards');
  for (const f of (await readdir(shardsDir)).filter((x) => x.endsWith('.json')).sort()) {
    const bucket = f.replace('.json', '');
    const entries = JSON.parse(await readFile(path.join(shardsDir, f), 'utf8')) as ShardEntry[];
    for (const e of entries) {
      addWord(e.lemma, bucket, e.ipa, e.ipaUk);
      for (const s of e.sentences ?? []) addSentence(s.en, bucket);
    }
  }
  const curatedDir = path.join(contentDir, 'curated');
  if (existsSync(curatedDir)) {
    for (const f of (await readdir(curatedDir)).filter((x) => x.endsWith('.json')).sort()) {
      const bucket = `c-${f.replace('.json', '')}`;
      const items = JSON.parse(await readFile(path.join(curatedDir, f), 'utf8')) as CuratedEntry[];
      for (const it of items) {
        addWord(it.text, bucket);
        for (const s of it.sentences ?? []) addSentence(s.en, bucket);
      }
    }
  }
  return { pipeline: cfg.pipeline, words: [...words.values()], sentences: [...sentences.values()] };
}

/** Estimated render seconds, used to balance the parallel jobs. */
function cost(u: WordUnit | SentenceUnit): number {
  return u.type === 'word' ? 2.2 + u.text.length * 0.05 : 0.6 + u.text.length * 0.025;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const cfg = await loadConfig();
  const out = path.resolve(opt('--out') ?? 'audio-work');
  const limit = Number(opt('--limit') ?? 0);
  const storePath = opt('--store');
  const plan = await buildPlan(cfg);

  const have = new Set<string>();
  if (storePath && existsSync(storePath)) {
    const store = JSON.parse(await readFile(storePath, 'utf8')) as {
      items: Record<string, unknown>;
    };
    for (const g of Object.keys(store.items ?? {})) have.add(g);
  }
  let todo: (WordUnit | SentenceUnit)[] = [
    ...plan.words.filter((u) => !have.has(u.g) || !have.has(u.gs)),
    ...plan.sentences.filter((u) => !have.has(u.g)),
  ];
  if (limit > 0) {
    // Test runs: a slice of each kind, and the plan itself shrinks to match.
    const pick = <T extends WordUnit | SentenceUnit>(xs: T[]) => xs.slice(0, limit);
    plan.words = [
      ...pick(plan.words.filter((u) => u.voice === 'us')),
      ...pick(plan.words.filter((u) => u.voice === 'uk')),
    ];
    plan.sentences = pick(plan.sentences);
    const keep = new Set([...plan.words, ...plan.sentences]);
    todo = todo.filter((u) => keep.has(u));
  }

  const n = Math.max(1, Math.min(cfg.chunks, Math.ceil(todo.length / 50)));
  const chunks: { units: (WordUnit | SentenceUnit)[]; cost: number }[] = Array.from(
    { length: n },
    () => ({
      units: [],
      cost: 0,
    }),
  );
  for (const u of [...todo].sort((a, b) => cost(b) - cost(a))) {
    const c = chunks.reduce((m, x) => (x.cost < m.cost ? x : m));
    c.units.push(u);
    c.cost += cost(u);
  }

  await mkdir(path.join(out, 'chunks'), { recursive: true });
  await writeFile(path.join(out, 'plan.json'), JSON.stringify(plan));
  const used = todo.length ? chunks.map((_, i) => i) : [];
  for (const i of used) {
    await writeFile(
      path.join(out, 'chunks', `chunk-${i}.json`),
      JSON.stringify({ units: chunks[i]!.units }),
    );
  }
  await writeFile(path.join(out, 'matrix.json'), JSON.stringify(used));

  const count = (kind: string, voice?: string) =>
    todo.filter((u) => u.type === kind && (!voice || u.voice === voice)).length;
  console.info(
    `plan: ${plan.words.filter((u) => u.voice === 'us').length} words and items per voice, ` +
      `${plan.sentences.length} sentences (${plan.sentences.filter((s) => s.sample).length} in the ASR sample)`,
  );
  console.info(
    `to render: ${count('word', 'us')} US words, ${count('word', 'uk')} UK words, ` +
      `${count('sentence')} sentences in ${used.length} chunk(s), ` +
      `about ${Math.round(chunks.reduce((s, c) => s + c.cost, 0) / 60)} CPU minutes`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
