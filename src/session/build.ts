/**
 * Builds a ready-to-run session: selects new words and a probe, composes the plan, loads content
 * for every item and drops items that cannot be shown (offline and not cached).
 */
import {
  distractorPool,
  getContent,
  getContents,
  loadInventory,
  usable,
} from '@/content/inventory';
import { pickProbe, selectNewWords, newWordsLeft, MAX_CAP } from '@/engine/selection';
import { composeSession, type PlanItem, type SessionMode } from '@/engine/session';
import { createRng, type Rng } from '@/engine/rng';
import type { LemmaInfo, UserWord, WordContent } from '@/engine/types';
import type { UserProfile, DailyStats } from '@/data/db';
import { toOptionWord } from './exercise';
import type { OptionWord } from '@/engine/exercises';

export interface BuiltSession {
  mode: SessionMode;
  plan: PlanItem[];
  contents: Map<number, WordContent>;
  infos: Map<number, LemmaInfo>;
  pool: OptionWord[];
  seed: number;
}

const DAY = 86_400_000;

/** Families with a member first seen in the last 3 days (slow family introduction). */
function recentFamilies(words: Iterable<UserWord>, byId: Map<number, LemmaInfo>, now: number) {
  const out = new Set<number>();
  for (const w of words) {
    if (now - w.firstSeenAt < 3 * DAY) {
      const f = byId.get(w.lemmaId)?.family;
      if (f) out.add(f);
    }
  }
  return out;
}

export async function buildSession(opts: {
  mode: SessionMode;
  profile: UserProfile;
  words: Map<number, UserWord>;
  today: DailyStats;
  now?: number;
  seed?: number;
  /** For duels: an explicit list of lemma ids. */
  lemmaIds?: number[];
}): Promise<BuiltSession> {
  const now = opts.now ?? Date.now();
  const seed = opts.seed ?? (now ^ 0x5bd1e995) >>> 0;
  const rng: Rng = createRng(seed);
  const inv = await loadInventory();
  const { profile } = opts;
  const settings = profile.settings;
  const theta = profile.ability?.theta ?? 40;
  const studied = new Set(opts.words.keys());
  const active = [...opts.words.values()].filter((w) => w.state !== 'ignored');
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  let newWords: LemmaInfo[] = [];
  let probe: LemmaInfo | null = null;
  if (opts.mode === 'learn') {
    const left = Math.min(newWordsLeft(settings.newPerDay, opts.today.newWords), MAX_CAP);
    if (left > 0) {
      const ctx = {
        theta,
        studied,
        topics: settings.topics,
        disabledKinds: settings.disabledKinds,
        recentFamilies: recentFamilies(opts.words.values(), inv.byId, now),
      };
      // Over-select so words without usable content can be swapped out.
      const candidates = selectNewWords(inv.lemmas, ctx, Math.min(left, 5) + 8, rng, inv.byId);
      const contents = await getContents(
        candidates.map((c) => c.id),
        { online },
      );
      newWords = candidates
        .filter((c) => {
          const ct = contents.get(c.id);
          return ct && usable(ct);
        })
        .slice(0, left);
      if (!newWords.length) {
        // Nothing usable in the window (offline, or content not authored that high yet): fall back
        // to the closest authored words so a session is never empty. "I already know this" keeps
        // it quick when they turn out to be easy.
        const target = theta + 5;
        const fallback = inv.lemmas
          .filter(
            (l) =>
              l.tier === 'A' &&
              !studied.has(l.id) &&
              (!l.kind || l.kind === 'word' || !settings.disabledKinds.includes(l.kind)),
          )
          .sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target))
          .slice(0, Math.min(left, 5) + 8);
        const fc = await getContents(
          fallback.map((l) => l.id),
          { online: false },
        );
        newWords = fallback.filter((l) => fc.has(l.id) && usable(fc.get(l.id)!)).slice(0, left);
      }
    }
    for (let tries = 0; tries < 6 && !probe; tries++) {
      const p = pickProbe(inv.lemmas, { theta, studied }, rng);
      if (!p) break;
      const c = await getContent(p.id, { online });
      if (c && usable(c)) probe = p;
      else studied.add(p.id); // do not pick it again this time
    }
  }

  let plan: PlanItem[];
  if (opts.mode === 'duel' && opts.lemmaIds) {
    plan = opts.lemmaIds.map((id, i) => ({
      key: `duel:${id}:${i}`,
      lemmaId: id,
      type: 'speed' as const,
      role: 'speed' as const,
    }));
  } else {
    plan = composeSession({
      mode: opts.mode,
      now,
      words: active,
      newWords,
      probe,
      retention: settings.retention,
      rng,
    });
  }

  const ids = [...new Set(plan.flatMap((p) => p.matchIds ?? [p.lemmaId]))];
  const contents = await getContents(ids, { online });
  plan = plan.filter((p) => (p.matchIds ?? [p.lemmaId]).every((id) => contents.has(id)));

  const infos = new Map<number, LemmaInfo>();
  for (const id of ids) {
    const l = inv.byId.get(id);
    if (l) infos.set(id, l);
  }
  const poolContent = await distractorPool(ids);
  for (const c of contents.values()) poolContent.push(c);
  const pool = poolContent.map((c) => toOptionWord(c, inv.byId.get(c.lemmaId)));
  return { mode: opts.mode, plan, contents, infos, pool, seed };
}
