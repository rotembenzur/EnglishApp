/**
 * Shared Tier A content rules (spec 5.2 and 10), used by validate-content.ts and enrich.ts.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const contentDir = path.join(root, 'content');
export const shardsDir = path.join(contentDir, 'shards');
export const SHARD_SIZE = 200;

const HEBREW = /[\u0590-\u05FF]/;
const NIQQUD = /[\u0591-\u05BD\u05BF-\u05C7]/;

export interface Sentence {
  en: string;
  he: string;
}
export interface Entry {
  id: number;
  lemma: string;
  pos: string[];
  ipa: string;
  ipaUk?: string;
  hebrew: string[];
  definition: string;
  sentences: Sentence[];
  collocations?: string[];
  hook?: string;
  context?: Sentence;
  forms?: string[];
  tags?: string[];
  tier: 'A';
}
export interface Lemma {
  id: number;
  lemma: string;
  rank: number;
  pos: string[];
  d: number;
  band: string;
  cefr?: string;
  tags?: string[];
  family?: number;
}

export async function loadLemmas(): Promise<Lemma[]> {
  return JSON.parse(await readFile(path.join(contentDir, 'lemmas.json'), 'utf8')) as Lemma[];
}

export function shardFile(index: number): string {
  return path.join(shardsDir, `${String(index).padStart(4, '0')}.json`);
}

/** Lemmas belonging to shard `index`: ranks index*200+1 .. index*200+200. */
export function lemmasForShard(lemmas: Lemma[], index: number): Lemma[] {
  const from = index * SHARD_SIZE + 1;
  const to = from + SHARD_SIZE - 1;
  return lemmas.filter((l) => l.rank >= from && l.rank <= to).sort((a, b) => a.rank - b.rank);
}

export async function compileSchema() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(path.join(contentDir, 'schema.json'), 'utf8'));
  return ajv.compile(schema);
}

/** True when the sentence uses the lemma or one of its listed forms (case-insensitive). */
export function sentenceUsesLemma(en: string, lemma: string, forms: string[] = []): boolean {
  const text = en.toLowerCase();
  const l = lemma.toLowerCase();
  const stem = l.length > 4 ? l.slice(0, Math.max(3, l.length - 2)) : l;
  if (text.includes(stem)) return true;
  // Consonant doubling and y -> i changes: stop -> stopped, try -> tried.
  if (l.endsWith('y') && text.includes(l.slice(0, -1) + 'i')) return true;
  if (l.endsWith('e') && text.includes(l.slice(0, -1))) return true;
  return forms.some((f) => text.includes(f.toLowerCase()));
}

/** Quality rules beyond the JSON schema. Returns human-readable problems. */
export function checkEntry(e: Entry, where: string): string[] {
  const p: string[] = [];
  if (e.sentences.length < 2) p.push(`${where}: fewer than 2 sentences`);
  for (const h of e.hebrew) {
    if (!HEBREW.test(h)) p.push(`${where}: hebrew "${h}" has no Hebrew characters`);
    if (NIQQUD.test(h)) p.push(`${where}: hebrew "${h}" contains niqqud`);
  }
  if (new Set(e.hebrew).size !== e.hebrew.length) p.push(`${where}: duplicate Hebrew sense`);
  if (HEBREW.test(e.definition)) p.push(`${where}: definition contains Hebrew`);
  if (HEBREW.test(e.ipa)) p.push(`${where}: ipa contains Hebrew`);
  const all = [...e.sentences, ...(e.context ? [e.context] : [])];
  for (const s of all) {
    if (HEBREW.test(s.en)) p.push(`${where}: English sentence contains Hebrew`);
    if (!HEBREW.test(s.he)) p.push(`${where}: Hebrew sentence has no Hebrew`);
    if (NIQQUD.test(s.he)) p.push(`${where}: Hebrew sentence contains niqqud`);
  }
  for (const s of e.sentences) {
    if (!sentenceUsesLemma(s.en, e.lemma, e.forms))
      p.push(`${where}: a sentence does not use the lemma (add the form to "forms")`);
  }
  const ens = e.sentences.map((s) => s.en.trim().toLowerCase());
  if (new Set(ens).size !== ens.length) p.push(`${where}: duplicate sentence`);
  for (const c of e.collocations ?? []) {
    if (HEBREW.test(c)) p.push(`${where}: collocation contains Hebrew`);
  }
  if (e.hook && !HEBREW.test(e.hook)) p.push(`${where}: hook is not in Hebrew`);
  if (e.hook && NIQQUD.test(e.hook)) p.push(`${where}: hook contains niqqud`);
  if (NIQQUD.test(e.definition)) p.push(`${where}: definition contains niqqud`);
  return p;
}
