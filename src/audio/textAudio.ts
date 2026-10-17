/**
 * Natural audio for saved texts (0.10.0, docs/DECISIONS.md "Text audio").
 *
 * Everything in a text that has no recording (its sentences, almost always, and its rare words)
 * is rendered with Kokoro, the voice of the recordings, by the Text audio workflow on GitHub:
 *  1. the phone adds a job to lb_tts_jobs (Supabase, behind the sync passphrase) and asks the
 *     lexbites-tts Edge Function to start the workflow right away;
 *  2. the workflow stores the clips in lb_tts_clips a few at a time, in reading order;
 *  3. the phone polls while the text is open, downloads each clip as it lands and keeps it in
 *     Cache Storage (src/audio/generated.ts), so the text plays offline afterwards.
 * Until a clip is here the speaker shows "preparing"; the system voice plays only when rendering
 * failed, is stuck, or cannot start (sync off).
 */
import { create } from 'zustand';
import { analyzeText, cardWord } from '@/content/text';
import { loadInventory } from '@/content/inventory';
import type { Accent, StoredText } from '@/data/db';
import { getText, touchText } from '@/data/texts';
import { base, headers, loadConfig, type SyncConfig } from '@/sync/engine';
import { putClip, storedClips } from './generated';
import { addPending, clearPending } from './pending';
import { clipKey } from './key';
import { recordedKeys } from './recordings';

export interface Unit {
  /** Clip key of the text. */
  k: string;
  v: Accent;
  t: string;
  /** A single word (rendered with the word checks, in the accent's voice). */
  w?: true;
}

export type AudioPhase =
  | 'checking'
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'slow'
  | 'offline'
  | 'nosync';

export interface TextAudioStatus {
  phase: AudioPhase;
  /** Clips on this phone, of all the text needs. */
  local: number;
  total: number;
  /** Started right away (true) or waiting for the five-minute schedule (false). */
  dispatch?: boolean;
}

export const useTextAudio = create<{ byText: Record<string, TextAudioStatus> }>(() => ({
  byText: {},
}));

/** Past this a job is treated as stuck: the system voice fills in, polling goes on. */
export const STUCK_MS = 20 * 60_000;
const MAX_UNITS = 2000;
const FN = 'lexbites-tts';

const unitId = (u: Pick<Unit, 'k' | 'v'>) => `${u.v}:${u.k}`;

/**
 * The units of a text that need rendering, in reading order: every sentence without a recording,
 * then every word without one (marked words first), in the accent's voice.
 */
export async function unitsFor(text: StoredText, accent: Accent): Promise<Unit[]> {
  const inv = await loadInventory();
  const analysis = analyzeText(text.body, inv.byLemma);
  const rec = await recordedKeys(accent);
  const out: Unit[] = [];
  const seen = new Set<string>();
  const add = (u: Unit) => {
    const id = unitId(u);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(u);
  };
  for (const s of analysis.sentences) {
    const k = clipKey(s.text);
    if (!rec.sentences?.has(k) && /[A-Za-z]/.test(s.text)) add({ k, v: 'us', t: s.text });
  }
  const marked = new Set(text.marked);
  const words: { word: string; first: boolean }[] = [];
  for (const s of analysis.sentences)
    for (const tk of s.tokens) {
      if (!tk.word) continue;
      const word = cardWord(tk);
      if (word.length < 2) continue;
      words.push({ word, first: !!tk.lemma && marked.has(tk.lemma.id) });
    }
  words.sort((a, b) => Number(b.first) - Number(a.first));
  for (const { word } of words) {
    const k = clipKey(word);
    if (!rec.words?.has(k)) add({ k, v: accent, t: word, w: true });
  }
  return out.slice(0, MAX_UNITS);
}

function setStatus(textId: string, s: TextAudioStatus, waiting: string[]) {
  useTextAudio.setState((st) => ({ byText: { ...st.byText, [textId]: s } }));
  if (waiting.length) addPending(waiting);
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function rest<T>(cfg: SyncConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(base(cfg) + path, {
    ...init,
    headers: headers(cfg, (init.headers as Record<string, string>) ?? {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

/** Submit a job for the text's missing clips. Returns false when there is nothing to submit. */
async function submit(cfg: SyncConfig, text: StoredText, units: Unit[]): Promise<boolean> {
  if (!units.length) return false;
  const job = crypto.randomUUID();
  await rest(cfg, 'lb_tts_jobs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ id: job, user_id: text.userId, units, total: units.length }),
  });
  const audio: NonNullable<StoredText['audio']> = {
    job,
    at: Date.now(),
    keys: units.map(unitId),
  };
  await touchText(text.id, { audio });
  // Start the render now; without the function's token the schedule picks the job up.
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/functions/v1/${FN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lexbites-key': cfg.keyHash },
      body: JSON.stringify({ job }),
    });
    const out = (await res.json().catch(() => ({}))) as { dispatched?: boolean };
    await touchText(text.id, { audio: { ...audio, dispatch: !!out.dispatched } });
  } catch {
    await touchText(text.id, { audio: { ...audio, dispatch: false } });
  }
  return true;
}

/** Download every finished clip of the text that is not on the phone yet. */
async function download(cfg: SyncConfig, ids: string[]): Promise<number> {
  const have = await storedClips();
  const missing = ids.filter((id) => !have.has(id));
  let got = 0;
  for (const v of ['us', 'uk'] as Accent[]) {
    const keys = missing.filter((id) => id.startsWith(`${v}:`)).map((id) => id.slice(3));
    for (let i = 0; i < keys.length; i += 30) {
      const rows = await rest<{ k: string; v: Accent; audio: string }[]>(
        cfg,
        `lb_tts_clips?select=k,v,audio&v=eq.${v}&k=in.(${keys.slice(i, i + 30).join(',')})`,
      );
      for (const r of rows ?? []) {
        await putClip(r.v, r.k, decode(r.audio));
        got++;
      }
      if (rows?.length) clearPending(rows.map((r) => `${r.v}:${r.k}`));
    }
  }
  return got;
}

const running = new Map<string, Promise<TextAudioStatus>>();

/**
 * One step for a text: submit a job when the text has none (or its job is gone), download what
 * is ready, report where it stands. Safe to call repeatedly (the open text polls it).
 */
export function refreshTextAudio(
  textId: string,
  accent: Accent,
  opts: { retry?: boolean } = {},
): Promise<TextAudioStatus> {
  const cur = running.get(textId);
  if (cur) return cur;
  const p = step(textId, accent, opts).finally(() => running.delete(textId));
  running.set(textId, p);
  return p;
}

async function step(
  textId: string,
  accent: Accent,
  opts: { retry?: boolean },
): Promise<TextAudioStatus> {
  let text = await getText(textId);
  if (!text) return { phase: 'failed', local: 0, total: 0 };
  const have = await storedClips();
  const known = text.audio?.keys ?? [];
  const localOf = (ids: string[]) => ids.filter((id) => have.has(id)).length;
  if (text.audio?.readyAt && !opts.retry) {
    const s: TextAudioStatus = {
      phase: text.audio.failed ? 'partial' : 'ready',
      local: localOf(known),
      total: known.length,
    };
    setStatus(textId, s, []);
    return s;
  }
  const cfg = await loadConfig();
  if (!cfg) {
    const s: TextAudioStatus = { phase: 'nosync', local: localOf(known), total: known.length };
    setStatus(textId, s, []);
    return s;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const s: TextAudioStatus = { phase: 'offline', local: localOf(known), total: known.length };
    setStatus(textId, s, []);
    return s;
  }
  try {
    // No job yet, an accent change for the words, or a retry: submit what is missing.
    if (!text.audio || opts.retry) {
      setStatus(textId, { phase: 'checking', local: 0, total: 0 }, []);
      const units = (await unitsFor(text, accent)).filter((u) => !have.has(unitId(u)));
      const all = [...new Set([...(opts.retry ? known : []), ...units.map(unitId)])];
      if (!(await submit(cfg, text, units))) {
        await touchText(textId, {
          audio: { job: '', at: Date.now(), keys: all, readyAt: Date.now() },
        });
        const s: TextAudioStatus = { phase: 'ready', local: localOf(all), total: all.length };
        setStatus(textId, s, []);
        return s;
      }
      text = (await getText(textId))!;
      if (opts.retry) await touchText(textId, { audio: { ...text.audio!, keys: all } });
      text = (await getText(textId))!;
    }
    const audio = text.audio!;
    const rows = await rest<{ status: string; done: number; failed: number; total: number }[]>(
      cfg,
      `lb_tts_jobs?select=status,done,failed,total&id=eq.${audio.job}`,
    );
    const job = rows?.[0];
    if (!job) {
      // The job was cleaned up (older than 30 days) before every clip came down: start again.
      await touchText(textId, { audio: undefined });
      return step(textId, accent, {});
    }
    await download(cfg, audio.keys);
    const local = localOf(audio.keys);
    const total = audio.keys.length;
    const finished = job.status === 'done' || job.status === 'failed';
    let phase: AudioPhase;
    if (local >= total) phase = 'ready';
    else if (finished) phase = local ? 'partial' : 'failed';
    else if (Date.now() - audio.at > STUCK_MS) phase = 'slow';
    else phase = job.status === 'running' || job.done > 0 ? 'rendering' : 'queued';
    if (phase === 'ready' || phase === 'partial' || phase === 'failed')
      await touchText(textId, {
        audio: { ...audio, readyAt: Date.now(), failed: total - local },
      });
    const waiting =
      phase === 'queued' || phase === 'rendering' ? audio.keys.filter((id) => !have.has(id)) : [];
    if (!waiting.length) clearPending(audio.keys);
    const s: TextAudioStatus = {
      phase,
      local,
      total,
      ...(audio.dispatch !== undefined ? { dispatch: audio.dispatch } : {}),
    };
    setStatus(textId, s, waiting);
    return s;
  } catch {
    const s: TextAudioStatus = { phase: 'offline', local: localOf(known), total: known.length };
    setStatus(textId, s, []);
    return s;
  }
}

/** Phases that keep the open text polling. */
export const ACTIVE: AudioPhase[] = ['checking', 'queued', 'rendering', 'slow', 'offline'];

const POLL_MS = 5000;
const watching = new Map<string, number>();

/**
 * Keep a text's audio coming in the background, whatever screen is open, until it is ready or
 * failed (the speaker buttons elsewhere, a practice session for instance, wait for the same clips).
 */
export function watchTextAudio(
  textId: string,
  accent: Accent,
  opts: { retry?: boolean } = {},
): void {
  if (watching.has(textId) && !opts.retry) return;
  window.clearTimeout(watching.get(textId));
  watching.set(textId, 0);
  const run = async (retry: boolean) => {
    const s = await refreshTextAudio(textId, accent, { retry });
    if (ACTIVE.includes(s.phase) && watching.has(textId))
      watching.set(
        textId,
        window.setTimeout(() => void run(false), POLL_MS),
      );
    else watching.delete(textId);
  };
  void run(!!opts.retry);
}

/** At app start: pick up the texts whose audio was still on its way. */
export async function resumeTextAudio(userId: string, accent: Accent): Promise<void> {
  const { listTexts } = await import('@/data/texts');
  for (const x of await listTexts(userId as StoredText['userId']))
    if (x.audio && !x.audio.readyAt) watchTextAudio(x.id, accent);
}
