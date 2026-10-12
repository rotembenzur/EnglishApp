/**
 * Share cards (spec 7.2): render a result image on a canvas and hand it to the share sheet
 * (WhatsApp and friends). Falls back to downloading the PNG.
 */
import { t } from '@/i18n/he';

const W = 1080;
const H = 1080;

function accent(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#ff6b4a'
  );
}

function base(ctx: CanvasRenderingContext2D, title: string) {
  const a = accent();
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#11131a');
  g.addColorStop(1, '#1e2230');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = a;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(W - 120, 140, 320, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Heebo Variable", Heebo, sans-serif';
  ctx.fillText(title, W - 90, 170);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = '800 44px "Outfit Variable", Outfit, sans-serif';
  ctx.fillStyle = a;
  ctx.fillText('LexBites', 90, H - 90);
}

async function share(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // cancelled: fall through to nothing
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function stat(ctx: CanvasRenderingContext2D, x: number, y: number, value: string, label: string) {
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 120px "Outfit Variable", Outfit, sans-serif';
  ctx.fillText(value, x, y);
  ctx.direction = 'rtl';
  ctx.font = '500 40px "Heebo Variable", Heebo, sans-serif';
  ctx.fillStyle = '#b4b9c8';
  ctx.fillText(label, x, y + 64);
}

export async function shareSessionCard(s: {
  name: string;
  xp: number;
  accuracy: number;
  words: number;
  mode: string;
}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  base(ctx, `${s.name} · ${t.common.today}`);
  stat(ctx, W * 0.25, 560, `+${s.xp}`, 'XP');
  stat(ctx, W * 0.5, 560, `${s.accuracy}%`, t.summary.accuracy);
  stat(ctx, W * 0.75, 560, String(s.words), t.summary.newWords);
  await share(canvas, 'lexbites-today.png');
}

export async function shareLeagueCard(l: {
  a: string;
  b: string;
  aXp: number;
  bXp: number;
  week: string;
}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  base(ctx, t.rivalry.league);
  const max = Math.max(1, l.aXp, l.bXp);
  const bar = (y: number, name: string, xp: number, color: string) => {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 52px "Heebo Variable", Heebo, sans-serif';
    ctx.fillText(name, W - 90, y);
    ctx.fillStyle = color;
    const w = ((W - 180) * xp) / max;
    ctx.fillRect(W - 90 - w, y + 30, w, 60);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 48px "Outfit Variable", Outfit, sans-serif';
    ctx.fillText(`${xp} XP`, 90, y);
  };
  bar(420, l.a, l.aXp, '#ff6b4a');
  bar(640, l.b, l.bXp, '#7c5cff');
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#b4b9c8';
  ctx.font = '500 36px "Heebo Variable", Heebo, sans-serif';
  ctx.fillText(t.rivalry.weekOf(l.week), W - 90, 250);
  await share(canvas, 'lexbites-league.png');
}
