/**
 * Saved texts (טקסטים) and the priority their words get in regular sessions after practice.
 * Texts are local to the phone and travel in export/import; they are not synced.
 */
import type { UserId, UserWord } from '@/engine/types';
import { db, getKv, setKv, type StoredText } from './db';

const DAY = 86_400_000;
/** How long a practiced text's words go first in regular sessions. */
export const PRIORITY_DAYS = 4;

export async function listTexts(userId: UserId): Promise<StoredText[]> {
  const rows = await db.texts.where('userId').equals(userId).toArray();
  return rows.sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt));
}

export function getText(id: string): Promise<StoredText | undefined> {
  return db.texts.get(id);
}

export async function saveText(t: StoredText): Promise<void> {
  await db.texts.put({ ...t, updatedAt: Date.now() });
}

export async function deleteText(id: string): Promise<void> {
  await db.texts.delete(id);
}

export async function touchText(id: string, patch: Partial<StoredText>): Promise<void> {
  await db.texts.update(id, patch);
}

const priorityKey = (userId: UserId) => `priority:${userId}`;

/** Lemma ids that go first in regular sessions until their time runs out. */
export async function priorityWords(userId: UserId, now = Date.now()): Promise<Set<number>> {
  const map = await getKv<Record<string, number>>(priorityKey(userId), {});
  return new Set(
    Object.entries(map)
      .filter(([, until]) => until > now)
      .map(([id]) => Number(id)),
  );
}

export async function boostWords(userId: UserId, ids: readonly number[], now = Date.now()) {
  const map = await getKv<Record<string, number>>(priorityKey(userId), {});
  const next: Record<string, number> = {};
  for (const [id, until] of Object.entries(map)) if (until > now) next[id] = until;
  for (const id of ids) next[String(id)] = now + PRIORITY_DAYS * DAY;
  await setKv(priorityKey(userId), next);
}

/** A text's word counts: marked, and learned among them (first typing answer, or known). */
export function textProgress(text: StoredText, words: Map<number, UserWord>) {
  const learned = text.marked.filter((id) => {
    const w = words.get(id);
    return !!w && (!!w.learnedAt || w.state === 'known');
  }).length;
  return { learned, total: text.marked.length };
}
