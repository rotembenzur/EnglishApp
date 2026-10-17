/**
 * Fetching an article from a link. Most sites block cross-origin reads, so the free Jina reader
 * (r.jina.ai, no key) is asked first: it returns the article as Markdown. A direct fetch with a
 * light paragraph extraction is the fallback. Returns null when neither works.
 */
export interface Article {
  title: string;
  body: string;
}

const MIN_WORDS = 6;

/** Markdown from the reader to plain paragraphs: no images, links as their text, no nav lines. */
export function markdownToText(md: string): string {
  const lines = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/, '')
        .replace(/(\*\*|__|\*|_|`)/g, '')
        .trim(),
    );
  const out: string[] = [];
  for (const l of lines) {
    const words = l.split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length;
    if (words >= MIN_WORDS && /[.!?:"”)]$/.test(l)) out.push(l);
  }
  return out.join('\n\n');
}

function fromHtml(html: string): Article | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
  const paras = [...root.querySelectorAll('p')]
    .map((p) => p.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((p) => p.split(/\s+/).length >= MIN_WORDS);
  if (!paras.length) return null;
  const title = doc.querySelector('h1')?.textContent?.trim() || doc.title.trim();
  return { title, body: paras.join('\n\n') };
}

async function get(url: string, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchArticle(url: string): Promise<Article | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const reader = await get(`https://r.jina.ai/${url}`, 20000);
  if (reader) {
    const md = await reader.text();
    const title = md.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const content = md.split(/^Markdown Content:\s*$/m)[1] ?? md;
    const body = markdownToText(content);
    if (body.split(/\s+/).length >= 30) return { title, body };
  }
  const direct = await get(url, 12000);
  if (direct) {
    const a = fromHtml(await direct.text());
    if (a && a.body.split(/\s+/).length >= 30) return a;
  }
  return null;
}
