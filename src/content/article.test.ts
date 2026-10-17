import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle, markdownToText } from './article';

/** What the Jina reader answers for an article (shape as documented by r.jina.ai). */
const READER = `Title: Labs race to open their models

URL Source: https://example.com/news/open-models

Markdown Content:
[Skip to content](https://example.com/#main)

* [News](https://example.com/news)
* [Tech](https://example.com/tech)

# Labs race to open their models
![A server room](https://example.com/a.jpg)

Anthropic released a new **multimodal** model today, and [Meta](https://meta.com) answered within hours.

The researchers say the system can describe images and transcribe speech, although critics disagree.

Share this article

Still, the company plans to publish the weights next month, according to two people familiar with the plan.
`;

afterEach(() => vi.unstubAllGlobals());

describe('markdownToText', () => {
  it('keeps the article paragraphs as plain text and drops navigation, images and links', () => {
    const text = markdownToText(READER.split('Markdown Content:')[1]!);
    expect(text.split('\n\n')).toEqual([
      'Anthropic released a new multimodal model today, and Meta answered within hours.',
      'The researchers say the system can describe images and transcribe speech, although critics disagree.',
      'Still, the company plans to publish the weights next month, according to two people familiar with the plan.',
    ]);
  });
});

describe('fetchArticle', () => {
  it('reads the title and the text through the reader', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(READER);
    });
    const a = await fetchArticle('https://example.com/news/open-models');
    expect(calls[0]).toBe('https://r.jina.ai/https://example.com/news/open-models');
    expect(a?.title).toBe('Labs race to open their models');
    expect(a?.body).toContain('publish the weights next month');
  });

  it('gives up cleanly when neither the reader nor the site answers', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 403 }));
    expect(await fetchArticle('https://example.com/x')).toBeNull();
    expect(await fetchArticle('not a link')).toBeNull();
  });
});
