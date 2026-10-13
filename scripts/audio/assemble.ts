/**
 * Assemble the audio store from reused and freshly rendered clips.
 *
 *   pnpm exec tsx scripts/audio/assemble.ts --plan audio-work/plan.json --old old/ --new new/ --out out/
 *
 * Output (the release assets of the `audio-store` release, see docs/DECISIONS.md, audio):
 * - `w-<voice>-<bucket>-<hash>.pack`: the word and curated-item clips of one content shard,
 *   normal and slow, concatenated. The app precaches these and plays slices of them.
 * - `s-<bucket>.tar`: the sentence clips of one shard, one `<key>.m4a` per sentence.
 * - `w-us-<hash>.json`, `w-uk-<hash>.json`, `s-<hash>.json`: the indexes the app reads.
 * - `index.json`: the root index (the only file the app re-checks).
 * - `store.json`: what each clip is (generation hash, pronunciation, checks) and where it lives,
 *   so the next run can reuse it. `report.json` and `report.md`: coverage and quality numbers.
 * - `upload.txt` and `delete.txt`: the assets that changed and the ones that are gone.
 * Prints counts only.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, type Plan, type WordUnit } from './plan';

interface Result {
  g: string;
  key: string;
  voice: 'us' | 'uk';
  kind: 'word' | 'sentence';
  speed: number;
  ok: boolean;
  asrOk?: boolean | null;
  attempts?: number;
  method?: string;
  phonemes?: string;
  qc?: { dur?: number; gap?: number; ok?: boolean; why?: string };
  asr?: { ok: boolean; how?: string; pd?: number; model?: string; heard?: string };
  bytes?: number;
}

interface StoreItem extends Result {
  asset: string;
  off?: number;
  len?: number;
}

interface Store {
  pipeline: number;
  builtAt: string;
  items: Record<string, StoreItem>;
  assets: Record<string, string>;
}

const sha = (b: Buffer | string, n = 8) => createHash('sha256').update(b).digest('hex').slice(0, n);

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string, def: string) => {
    const i = args.indexOf(name);
    return path.resolve(i >= 0 ? args[i + 1]! : def);
  };
  const cfg = await loadConfig();
  const plan = JSON.parse(await readFile(opt('--plan', 'audio-work/plan.json'), 'utf8')) as Plan;
  const oldDir = opt('--old', 'audio-old');
  const newDir = opt('--new', 'audio-new');
  const out = opt('--out', 'audio-out');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const tmp = path.join(out, '..', `.assemble-tmp`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });

  // Previous store: metadata plus the bytes in its packs and tars.
  const oldStore: Store | null = existsSync(path.join(oldDir, 'store.json'))
    ? (JSON.parse(await readFile(path.join(oldDir, 'store.json'), 'utf8')) as Store)
    : null;
  const oldSent = path.join(tmp, 'old-s');
  await mkdir(oldSent, { recursive: true });
  for (const f of (await walk(oldDir)).filter((f) => /\/s-[^/]+\.tar$/.test(f))) {
    const dest = path.join(oldSent, path.basename(f, '.tar'));
    await mkdir(dest, { recursive: true });
    execFileSync('tar', ['-xf', f, '-C', dest]);
  }
  const packCache = new Map<string, Buffer>();
  const oldBytes = (it: StoreItem): Buffer | null => {
    if (it.asset.endsWith('.pack')) {
      let b = packCache.get(it.asset);
      if (!b) {
        const p = path.join(oldDir, it.asset);
        if (!existsSync(p)) return null;
        b = readFileSync(p);
        packCache.set(it.asset, b);
      }
      return b.subarray(it.off!, it.off! + it.len!);
    }
    const p = path.join(oldSent, it.asset.replace('.tar', ''), `${it.key}.m4a`);
    return existsSync(p) ? readFileSync(p) : null;
  };

  // Fresh clips from the render jobs.
  const fresh = new Map<string, { r: Result; file: string }>();
  for (const f of (await walk(newDir)).filter((f) => f.endsWith('results.jsonl'))) {
    for (const line of (await readFile(f, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Result;
      const file = path.join(path.dirname(f), `${r.g}.m4a`);
      if (r.ok && existsSync(file)) fresh.set(r.g, { r, file });
      else if (!fresh.has(r.g)) fresh.set(r.g, { r, file: '' });
    }
  }

  const items: Record<string, StoreItem> = {};
  const clip = (g: string): { meta: Result; bytes: Buffer } | null => {
    const f = fresh.get(g);
    if (f?.file) return { meta: f.r, bytes: readFileSync(f.file) };
    const o = oldStore?.items[g];
    if (o?.ok) {
      const b = oldBytes(o);
      if (b) return { meta: o, bytes: b };
    }
    return null;
  };
  const strip = (m: Result): Result => {
    const { asr, ...rest } = m as Result & { asset?: string; off?: number; len?: number };
    delete (rest as { asset?: string }).asset;
    delete (rest as { off?: number }).off;
    delete (rest as { len?: number }).len;
    if (!asr) return rest;
    // Keep what was heard only for misses; the rest is noise in a 40,000-item store.
    const { heard, ...a } = asr;
    return { ...rest, asr: a.ok ? a : { ...a, heard: heard ?? '' } };
  };

  const assets: Record<string, string> = {};
  const index: Record<string, string> = {};
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  let totalBytes = 0;
  let totalSeconds = 0;

  // Word packs, one per voice and bucket.
  for (const voice of ['us', 'uk'] as const) {
    const byBucket = new Map<string, WordUnit[]>();
    for (const u of plan.words.filter((w) => w.voice === voice)) {
      byBucket.set(u.bucket, [...(byBucket.get(u.bucket) ?? []), u]);
    }
    const packs: { f: string; k: string; l: number[] }[] = [];
    for (const [bucket, units] of [...byBucket.entries()].sort()) {
      const parts: Buffer[] = [];
      const lens: number[] = [];
      let keys = '';
      const metas: { g: string; meta: Result; off: number; len: number }[] = [];
      let off = 0;
      for (const u of [...units].sort((a, b) => a.key.localeCompare(b.key))) {
        const n = clip(u.g);
        const s = clip(u.gs);
        if (!n && !s) continue;
        keys += u.key;
        for (const [g, c] of [
          [u.g, n],
          [u.gs, s],
        ] as const) {
          const len = c?.bytes.length ?? 0;
          lens.push(len);
          if (c) {
            parts.push(c.bytes);
            metas.push({ g, meta: c.meta, off, len });
            off += len;
          }
        }
        const curated = bucket.startsWith('c-') ? 'curated' : 'words';
        if (n) bump(`${voice}.${curated}`);
        if (s) bump(`${voice}.${curated}.slow`);
      }
      if (!keys) continue;
      const body = Buffer.concat(parts);
      const name = `w-${voice}-${bucket}-${sha(body)}.pack`;
      await writeFile(path.join(out, name), body);
      assets[name] = sha(body, 64);
      for (const m of metas) {
        items[m.g] = { ...strip(m.meta), asset: name, off: m.off, len: m.len } as StoreItem;
        totalSeconds += m.meta.qc?.dur ?? 0;
      }
      totalBytes += body.length;
      packs.push({ f: name, k: keys, l: lens });
    }
    const json = JSON.stringify({ packs });
    const name = `w-${voice}-${sha(json)}.json`;
    await writeFile(path.join(out, name), json);
    assets[name] = sha(json, 64);
    index[voice] = name;
  }

  // Sentence tars, one per bucket.
  const sentenceKeys: string[] = [];
  const byBucket = new Map<string, typeof plan.sentences>();
  for (const s of plan.sentences) byBucket.set(s.bucket, [...(byBucket.get(s.bucket) ?? []), s]);
  for (const [bucket, units] of [...byBucket.entries()].sort()) {
    const dir = path.join(tmp, 'new-s', bucket);
    await mkdir(dir, { recursive: true });
    const name = `s-${bucket}.tar`;
    let any = false;
    for (const u of units) {
      const c = clip(u.g);
      if (!c) continue;
      any = true;
      await writeFile(path.join(dir, `${u.key}.m4a`), c.bytes);
      items[u.g] = { ...strip(c.meta), asset: name } as StoreItem;
      sentenceKeys.push(u.key);
      totalBytes += c.bytes.length;
      totalSeconds += c.meta.qc?.dur ?? 0;
      bump('us.sentences');
    }
    if (!any) continue;
    const tarPath = path.join(out, name);
    execFileSync('tar', [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-cf',
      tarPath,
      '-C',
      dir,
      '.',
    ]);
    assets[name] = sha(readFileSync(tarPath), 64);
  }
  sentenceKeys.sort();
  const sJson = JSON.stringify({ k: sentenceKeys.join('') });
  const sName = `s-${sha(sJson)}.json`;
  await writeFile(path.join(out, sName), sJson);
  assets[sName] = sha(sJson, 64);

  // Quality report over the whole store (reused and fresh clips alike).
  const all = Object.values(items);
  const wordClips = all.filter((i) => i.kind === 'word');
  const checkedWords = wordClips.filter((i) => i.asr);
  const missWords = checkedWords.filter((i) => !i.asr!.ok);
  const sampled = all.filter((i) => i.kind === 'sentence' && i.asr);
  const missSent = sampled.filter((i) => !i.asr!.ok);
  const firstMiss = all.filter((i) => (i.attempts ?? 1) > 1);
  const failed = [...fresh.values()].filter((f) => !f.file).length;
  const methods: Record<string, number> = {};
  for (const i of wordClips) methods[i.method ?? '?'] = (methods[i.method ?? '?'] ?? 0) + 1;
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  // Where the misses are (counts only): voice and speed, word length, what Whisper returned.
  const missBy: Record<string, number> = {};
  const lenOf = (g: string) => {
    const u = plan.words.find((w) => w.g === g || w.gs === g);
    const n = u?.text.length ?? 0;
    return n <= 3 ? 'len<=3' : n <= 6 ? 'len4-6' : n <= 10 ? 'len7-10' : 'len11+';
  };
  for (const [g, i] of Object.entries(items)) {
    if (i.kind !== 'word' || !i.asr) continue;
    const tag = (k: string) => (missBy[k] = (missBy[k] ?? 0) + (i.asr!.ok ? 0 : 1));
    tag(`${i.voice}.${i.speed < 1 ? 'slow' : 'normal'}`);
    tag(lenOf(g));
    const vs = `${i.voice}.${i.speed < 1 ? 'slow' : 'normal'}`;
    if (i.asr.ok && i.asr.how === 'word+filler')
      missBy[`${vs}.word+filler`] = (missBy[`${vs}.word+filler`] ?? 0) + 1;
    if (i.speed > 0.75 && i.speed < 1)
      missBy[`${vs}.retried-at-0.8`] = (missBy[`${vs}.retried-at-0.8`] ?? 0) + 1;
    if ((i.asr as { overruled?: string[] }).overruled) {
      missBy[`${vs}.saved-by-bigger-model`] = (missBy[`${vs}.saved-by-bigger-model`] ?? 0) + 1;
    }
    if (!i.asr.ok) {
      if ((i.asr as { contains?: boolean }).contains) tag(`${vs}.heard-target-plus-more`);
      const heard = (i.asr.heard ?? '').trim();
      tag(
        !heard
          ? 'heard-nothing'
          : heard.split(/\s+/).length > 1
            ? 'heard-several-words'
            : 'heard-one-word',
      );
      tag(`pd${Math.min(10, Math.round((i.asr.pd ?? 1) * 10))}`);
    }
  }
  const report = {
    pipeline: cfg.pipeline,
    builtAt: new Date().toISOString(),
    voices: cfg.voices,
    counts,
    planned: {
      wordsPerVoice: plan.words.filter((w) => w.voice === 'us').length,
      sentences: plan.sentences.length,
    },
    asr: {
      wordClipsChecked: checkedWords.length,
      wordClipsMismatched: missWords.length,
      wordMismatchRate: pct(missWords.length, checkedWords.length),
      sentencesSampled: sampled.length,
      sentencesMismatched: missSent.length,
      sentenceMismatchRate: pct(missSent.length, sampled.length),
      clipsRetried: firstMiss.length,
    },
    pronunciation: methods,
    missBy,
    renderFailuresThisRun: failed,
    freshThisRun: [...fresh.values()].filter((f) => f.file).length,
    totalBytes,
    totalMB: Math.round(totalBytes / 1e5) / 10,
    totalHours: Math.round(totalSeconds / 360) / 10,
  };
  const root = {
    v: 1,
    pipeline: cfg.pipeline,
    builtAt: report.builtAt,
    voices: cfg.voices,
    w: index,
    s: sName,
    bytes: totalBytes,
  };
  const rootJson = JSON.stringify(root);
  await writeFile(path.join(out, 'index.json'), rootJson);
  assets['index.json'] = sha(rootJson, 64);
  const store: Store = { pipeline: cfg.pipeline, builtAt: report.builtAt, items, assets };
  await writeFile(path.join(out, 'store.json'), JSON.stringify(store));
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const md = [
    `## Audio store (pipeline ${cfg.pipeline})`,
    '',
    `| | US (${cfg.voices.us}) | UK (${cfg.voices.uk}) |`,
    '|---|---|---|',
    `| Words | ${counts['us.words'] ?? 0} (+${counts['us.words.slow'] ?? 0} slow) | ${counts['uk.words'] ?? 0} (+${counts['uk.words.slow'] ?? 0} slow) |`,
    `| Curated items | ${counts['us.curated'] ?? 0} (+${counts['us.curated.slow'] ?? 0} slow) | ${counts['uk.curated'] ?? 0} (+${counts['uk.curated.slow'] ?? 0} slow) |`,
    `| Sentences | ${counts['us.sentences'] ?? 0} | (American recording) |`,
    '',
    `Planned: ${report.planned.wordsPerVoice} words and items per voice, ${report.planned.sentences} sentences.`,
    '',
    `ASR on word clips: ${missWords.length} of ${checkedWords.length} mismatched (${report.asr.wordMismatchRate}%).`,
    `ASR on sampled sentences: ${missSent.length} of ${sampled.length} mismatched (${report.asr.sentenceMismatchRate}%).`,
    `Clips re-rendered with another pronunciation: ${firstMiss.length}. Render failures this run: ${failed}.`,
    `Pronunciation source of word clips: ${JSON.stringify(methods)}.`,
    `Word misses by group: ${JSON.stringify(missBy)}.`,
    '',
    `Total: ${report.totalMB} MB, ${report.totalHours} hours of audio.`,
    '',
  ].join('\n');
  await writeFile(path.join(out, 'report.md'), md);

  // What changed against the previous release.
  const oldAssets = oldStore?.assets ?? {};
  const upload = Object.keys(assets).filter((n) => oldAssets[n] !== assets[n]);
  upload.push('store.json', 'report.json', 'report.md');
  const present = new Set((await walk(oldDir)).map((f) => path.basename(f)));
  const keep = new Set([...Object.keys(assets), 'store.json', 'report.json', 'report.md']);
  const del = [...present].filter((n) => !keep.has(n));
  // Unchanged assets are not re-uploaded; drop their local copies to keep the job light.
  for (const n of Object.keys(assets)) {
    if (!upload.includes(n)) await rm(path.join(out, n), { force: true });
  }
  await writeFile(path.join(out, '..', 'upload.txt'), upload.join('\n') + '\n');
  await writeFile(path.join(out, '..', 'delete.txt'), del.join('\n') + (del.length ? '\n' : ''));
  await rm(tmp, { recursive: true, force: true });
  console.info(md);
  console.info(
    `assets: ${Object.keys(assets).length}, to upload ${upload.length}, to delete ${del.length}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
