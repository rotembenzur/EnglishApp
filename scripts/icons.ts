/**
 * Generates all app icons and iOS splash screens from a single SVG design.
 * Run: pnpm icons
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'public', 'icons');
const splashDir = path.join(root, 'public', 'splash');

const BG = '#0f1115';
const ACCENT = '#ff7a59';
const ACCENT2 = '#ffb347';

/** The LexBites mark: a bold rounded tile, a speech-bubble "bite" and the letters Lb. */
function iconSvg(size: number, opts: { padding?: number; background?: string } = {}): string {
  const pad = opts.padding ?? 0;
  const inner = size - pad * 2;
  const r = inner * 0.22;
  const bg = opts.background ?? 'none';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT2}"/>
    </linearGradient>
  </defs>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${r}" fill="url(#g)"/>
  <circle cx="${pad + inner * 0.82}" cy="${pad + inner * 0.2}" r="${inner * 0.16}" fill="${BG}"/>
  <text x="${pad + inner * 0.5}" y="${pad + inner * 0.68}" text-anchor="middle" font-family="Arial Black, Helvetica, Arial, sans-serif" font-weight="900" font-size="${inner * 0.52}" fill="${BG}">Lb</text>
</svg>`;
}

async function png(svg: string, out: string, size?: number): Promise<void> {
  let img = sharp(Buffer.from(svg));
  if (size) img = img.resize(size, size);
  await img.png().toFile(out);
}

async function main(): Promise<void> {
  await mkdir(iconsDir, { recursive: true });
  await mkdir(splashDir, { recursive: true });

  await writeFile(path.join(iconsDir, 'favicon.svg'), iconSvg(64));
  await png(iconSvg(192), path.join(iconsDir, 'icon-192.png'));
  await png(iconSvg(512), path.join(iconsDir, 'icon-512.png'));
  await png(iconSvg(512, { padding: 64, background: BG }), path.join(iconsDir, 'maskable-512.png'));
  await png(
    iconSvg(180, { padding: 0, background: BG }),
    path.join(iconsDir, 'apple-touch-icon.png'),
  );

  const sizes: [number, number][] = [
    [1170, 2532],
    [1179, 2556],
    [1206, 2622],
    [1284, 2778],
    [1290, 2796],
    [1320, 2868],
    [1125, 2436],
    [750, 1334],
    [1242, 2688],
    [828, 1792],
  ];
  for (const [w, h] of sizes) {
    const icon = Math.round(Math.min(w, h) * 0.28);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${(w - icon) / 2}, ${(h - icon) / 2})">${iconSvg(icon)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')}</g>
</svg>`;
    await png(svg, path.join(splashDir, `splash-${w}x${h}.png`));
  }
  console.info('icons and splash screens generated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
