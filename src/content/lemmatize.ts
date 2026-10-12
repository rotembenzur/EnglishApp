import type { LemmaInfo } from '@/engine/types';

const IRREGULAR: Record<string, string> = {
  went: 'go',
  gone: 'go',
  was: 'be',
  were: 'be',
  been: 'be',
  is: 'be',
  are: 'be',
  am: 'be',
  had: 'have',
  has: 'have',
  did: 'do',
  does: 'do',
  done: 'do',
  said: 'say',
  made: 'make',
  took: 'take',
  taken: 'take',
  got: 'get',
  gotten: 'get',
  saw: 'see',
  seen: 'see',
  came: 'come',
  knew: 'know',
  known: 'know',
  thought: 'think',
  told: 'tell',
  found: 'find',
  gave: 'give',
  given: 'give',
  left: 'leave',
  felt: 'feel',
  brought: 'bring',
  began: 'begin',
  begun: 'begin',
  kept: 'keep',
  held: 'hold',
  wrote: 'write',
  written: 'write',
  stood: 'stand',
  heard: 'hear',
  meant: 'mean',
  met: 'meet',
  ran: 'run',
  paid: 'pay',
  sat: 'sit',
  spoke: 'speak',
  spoken: 'speak',
  lay: 'lie',
  led: 'lead',
  grew: 'grow',
  grown: 'grow',
  lost: 'lose',
  fell: 'fall',
  fallen: 'fall',
  sent: 'send',
  built: 'build',
  understood: 'understand',
  drew: 'draw',
  drawn: 'draw',
  broke: 'break',
  broken: 'break',
  spent: 'spend',
  rose: 'rise',
  risen: 'rise',
  drove: 'drive',
  driven: 'drive',
  bought: 'buy',
  wore: 'wear',
  worn: 'wear',
  chose: 'choose',
  chosen: 'choose',
  sought: 'seek',
  threw: 'throw',
  thrown: 'throw',
  caught: 'catch',
  taught: 'teach',
  fought: 'fight',
  ate: 'eat',
  eaten: 'eat',
  children: 'child',
  men: 'man',
  women: 'woman',
  people: 'person',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
};

/** Map a surface token to an inventory lemma with light, rule-based lemmatization. */
export function lemmatize(token: string, byLemma: Map<string, LemmaInfo>): LemmaInfo | undefined {
  const w = token.toLowerCase();
  const direct = byLemma.get(w);
  const cands: string[] = [];
  if (IRREGULAR[w]) cands.push(IRREGULAR[w]);
  if (w.endsWith('ies')) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied')) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) cands.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) cands.push(w.slice(0, -1));
  if (w.endsWith('ed')) cands.push(w.slice(0, -2), w.slice(0, -1), w.slice(0, -3));
  if (w.endsWith('ing')) cands.push(w.slice(0, -3), w.slice(0, -3) + 'e', w.slice(0, -4));
  if (w.endsWith('ly')) cands.push(w.slice(0, -2), w.slice(0, -3) + 'y');
  if (w.endsWith('er')) cands.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est')) cands.push(w.slice(0, -3), w.slice(0, -2));
  for (const c of cands) {
    const hit = byLemma.get(c);
    // Prefer the base form when the surface form is itself a rarer lemma ("rated" vs "rate").
    if (hit && (!direct || hit.rank < direct.rank)) return hit;
  }
  return direct;
}
