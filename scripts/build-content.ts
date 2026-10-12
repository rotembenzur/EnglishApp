import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'content');
const outDir = path.join(root, 'public', 'content');

export interface ContentManifest {
  version: number;
  builtAt: string;
  lemmaCount: number;
  shards: { id: string; from: number; to: number; count: number }[];
  curated: string[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Packs authoring content (content/) into the runtime bundle (public/content/).
 * Safe to run when content is still empty: it writes an empty manifest.
 */
export async function buildContent(opts: { quiet?: boolean } = {}): Promise<ContentManifest> {
  await mkdir(path.join(outDir, 'shards'), { recursive: true });
  await mkdir(path.join(outDir, 'curated'), { recursive: true });
  const manifest: ContentManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    lemmaCount: 0,
    shards: [],
    curated: [],
  };

  const lemmasPath = path.join(contentDir, 'lemmas.json');
  if (await fileExists(lemmasPath)) {
    const lemmas = JSON.parse(await readFile(lemmasPath, 'utf8')) as {
      id: number;
      lemma: string;
      rank: number;
      pos: string[];
      d: number;
      band: string;
      tags?: string[];
      family?: number;
      cefr?: string;
    }[];
    // Compact columnar form: [id, lemma, rank, posCode, d, bandIndex, tagsCode, family]
    const packed = lemmas.map((l) => [
      l.id,
      l.lemma,
      l.rank,
      l.pos.join(','),
      l.d,
      l.band,
      (l.tags ?? []).join(','),
      l.family ?? 0,
    ]);
    await writeFile(path.join(outDir, 'lemmas.min.json'), JSON.stringify(packed));
    manifest.lemmaCount = lemmas.length;
  }

  const shardsDir = path.join(contentDir, 'shards');
  if (existsSync(shardsDir)) {
    const files = (await readdir(shardsDir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
    for (const f of files) {
      const raw = await readFile(path.join(shardsDir, f), 'utf8');
      const entries = JSON.parse(raw) as { id: number }[];
      const id = f.replace('.json', '');
      await writeFile(path.join(outDir, 'shards', f), JSON.stringify(entries));
      const ids = entries.map((e) => e.id);
      manifest.shards.push({
        id,
        from: Math.min(...ids),
        to: Math.max(...ids),
        count: entries.length,
      });
    }
  }

  const curatedDir = path.join(contentDir, 'curated');
  if (existsSync(curatedDir)) {
    const files = (await readdir(curatedDir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const raw = await readFile(path.join(curatedDir, f), 'utf8');
      await writeFile(path.join(outDir, 'curated', f), JSON.stringify(JSON.parse(raw)));
      manifest.curated.push(f.replace('.json', ''));
    }
  }

  const placementPath = path.join(contentDir, 'placement.json');
  if (await fileExists(placementPath)) {
    await writeFile(
      path.join(outDir, 'placement.json'),
      JSON.stringify(JSON.parse(await readFile(placementPath, 'utf8'))),
    );
  }

  const familiesPath = path.join(contentDir, 'families.json');
  if (await fileExists(familiesPath)) {
    await writeFile(
      path.join(outDir, 'families.json'),
      JSON.stringify(JSON.parse(await readFile(familiesPath, 'utf8'))),
    );
  }

  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  if (!opts.quiet) {
    console.info(
      `content: ${manifest.lemmaCount} lemmas, ${manifest.shards.length} shards, ${manifest.curated.length} curated lists`,
    );
  }
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildContent().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
