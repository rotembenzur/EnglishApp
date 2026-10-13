#!/usr/bin/env bash
# Lay the recorded audio from the audio-store release into the built site: dist/audio/index.json,
# its indexes, dist/audio/w/*.pack (words) and dist/audio/s/<key>.m4a (sentences).
# Without a release (or with a broken one) the site ships without recordings and the app falls
# back to the system voice. Needs GH_TOKEN. Prints counts only.
set -euo pipefail
dist=${1:-dist}
tag=$(node -p "require('./scripts/audio/config.json').release")
if ! gh release view "$tag" >/dev/null 2>&1; then
  echo "audio: no '$tag' release yet, deploying without recordings"
  exit 0
fi
tmp=$(mktemp -d)
gh release download "$tag" -D "$tmp" -p '*.pack' -p '*.tar' -p 'index.json' -p 'w-*.json' -p 's-*.json'
mkdir -p "$dist/audio/w" "$dist/audio/s"
shopt -s nullglob
for f in "$tmp"/*.pack; do mv "$f" "$dist/audio/w/"; done
for t in "$tmp"/s-*.tar; do tar -xf "$t" -C "$dist/audio/s"; done
for f in "$tmp"/*.json; do mv "$f" "$dist/audio/"; done
rm -rf "$tmp"
node --input-type=module - "$dist/audio" <<'JS'
import { existsSync, readFileSync, rmSync } from 'node:fs';
const dir = process.argv[2];
const root = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
const missing = [];
let packs = 0;
for (const v of Object.values(root.w)) {
  if (!existsSync(`${dir}/${v}`)) { missing.push(v); continue; }
  for (const p of JSON.parse(readFileSync(`${dir}/${v}`, 'utf8')).packs) {
    packs++;
    if (!existsSync(`${dir}/w/${p.f}`)) missing.push(p.f);
  }
}
if (!existsSync(`${dir}/${root.s}`)) missing.push(root.s);
const s = existsSync(`${dir}/${root.s}`) ? JSON.parse(readFileSync(`${dir}/${root.s}`, 'utf8')).k : '';
let sMissing = 0;
for (let i = 0; i < s.length; i += 11) if (!existsSync(`${dir}/s/${s.slice(i, i + 11)}.m4a`)) sMissing++;
if (missing.length || sMissing) {
  console.error(`audio: ${missing.length} index file(s) or pack(s) and ${sMissing} sentence clip(s) missing; deploying without recordings`);
  rmSync(dir, { recursive: true, force: true });
} else {
  console.info(`audio: ${packs} word packs, ${s.length / 11} sentence clips, ${(root.bytes / 1e6).toFixed(1)} MB`);
}
JS
size=$(du -sb "$dist" | cut -f1)
echo "site size: $((size / 1000000)) MB"
if [ "$size" -gt 990000000 ]; then
  echo "::error::the site is over the 1 GB GitHub Pages limit"
  exit 1
fi
