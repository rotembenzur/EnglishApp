import type { Plugin } from 'vite';
import { buildContent } from './build-content';

/**
 * Runs the content build (content/ -> public/content/) when Vite starts,
 * so dev and production always serve runtime content that matches the source shards.
 */
export function contentPlugin(): Plugin {
  return {
    name: 'lexbites-content',
    async buildStart() {
      await buildContent({ quiet: true });
    },
  };
}
