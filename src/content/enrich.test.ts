import { describe, expect, it } from 'vitest';
import { lookup, translate, translateMany, type Fetcher } from './enrich';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const google = (he: string) => [[[he, 'x', null, null]]];

/** Dictionary has no entry (like "multimodal"); Google translates; MyMemory is down. */
function fetcher(calls: string[], opts: { google?: boolean } = {}): Fetcher {
  return (url) => {
    calls.push(url);
    if (url.includes('dictionaryapi')) return json({ title: 'No Definitions Found' }, 404);
    if (url.includes('translate.googleapis') && opts.google !== false) {
      const q = decodeURIComponent(url.split('&q=')[1]!);
      return json(
        google(
          q
            .split('\n')
            .map((l) => `תרגום ${l.length}`)
            .join('\n'),
        ),
      );
    }
    if (url.includes('translate.googleapis')) return json({}, 429);
    return Promise.reject(new Error('blocked'));
  };
}

describe('lookup (Read mode, texts)', () => {
  it('returns Hebrew for a word the dictionary does not know', async () => {
    const g = await lookup('multimodal', fetcher([]));
    expect(g?.hebrew[0]).toMatch(/[֐-׿]/);
    expect(g?.definition).toBeUndefined();
    expect(g?.examples).toEqual([]);
  });

  it('returns null only when no translation source answers', async () => {
    expect(await lookup('multimodal', fetcher([], { google: false }))).toBeNull();
  });

  it('asks Google first', async () => {
    const calls: string[] = [];
    await translate('hello', fetcher(calls));
    expect(calls[0]).toContain('translate.googleapis.com');
    expect(calls).toHaveLength(1);
  });
});

describe('translateMany', () => {
  it('translates many sentences in one request and keeps their order', async () => {
    const calls: string[] = [];
    const out = await translateMany(['One.', 'Three words here.', 'Two two.'], fetcher(calls));
    expect(calls).toHaveLength(1);
    expect(out).toEqual(['תרגום 4', 'תרגום 17', 'תרגום 8']);
  });

  it('leaves nulls when the network fails', async () => {
    expect(await translateMany(['A b.', 'C d.'], fetcher([], { google: false }))).toEqual([
      null,
      null,
    ]);
  });
});
