import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { levelOf } from '@/engine/ability';
import { computeStreak, levelForXp } from '@/engine/game';
import { createRng, hashString, pick } from '@/engine/rng';
import { dueWords, minutesFor } from '@/engine/session';
import { newWordsLeft, suggestCapChange } from '@/engine/selection';
import { retentionSince } from '@/engine/stats';
import type { WordContent } from '@/engine/types';
import { db, getKv } from '@/data/db';
import { allDaily, downloadBackup, reviewsFor } from '@/data/repo';
import { getContent, loadInventory } from '@/content/inventory';
import { levelTitle, relTime, t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { isFemale, otherUser, snapshot } from '@/state/rival';
import { useSync } from '@/sync/engine';
import { Bar, Bidi, Button, En, Ring, Speak } from '@/ui/kit';
import { toast } from '@/ui/toast';
import {
  BoltIcon,
  ChevronIcon,
  FlameIcon,
  GearIcon,
  HeadphonesIcon,
  MountainIcon,
  RepeatIcon,
  SwordsIcon,
} from '@/ui/icons';
import { SyncDot } from '@/ui/SyncDot';
import { USER_EMOJI } from './ProfilePicker';

const DAY = 86_400_000;

export function Home() {
  const nav = useNavigate();
  const profile = useApp((s) => s.profile)!;
  const words = useApp((s) => s.words);
  const today = useApp((s) => s.today);
  const updateSettings = useApp((s) => s.updateSettings);
  const userId = profile.id;
  const now = Date.now();
  const due = useMemo(() => dueWords([...words.values()], now).length, [words, now]);
  const goal = profile.settings.dailyGoal;
  const xpToday = today?.xp ?? 0;
  const newLeft = newWordsLeft(profile.settings.newPerDay, today?.newWords ?? 0);

  const daily = useLive(() => allDaily(userId), [userId]);
  const streak = useMemo(() => computeStreak(daily ?? [], todayKey()), [daily]);
  const totalXp = useMemo(() => (daily ?? []).reduce((a, d) => a + d.xp, 0), [daily]);
  const lvl = levelForXp(totalXp);

  const [resumable, setResumable] = useState(false);
  useEffect(() => {
    void getKv<{ index: number; plan: unknown[]; startedAt: number } | null>(
      `session:${userId}`,
      null,
    ).then((s) =>
      setResumable(!!s && s.index < s.plan.length && Date.now() - s.startedAt < 12 * 3600_000),
    );
  }, [userId]);

  const capSuggestion = useLive(async () => {
    const since = Date.now() - 7 * DAY;
    const r = retentionSince(await reviewsFor(userId, since), since);
    return suggestCapChange({
      cap: profile.settings.newPerDay,
      retention7d: r.rate,
      reviews7d: r.n,
      dueCount: due,
    });
  }, [userId, due, profile.settings.newPerDay]);
  const [capDismissed, setCapDismissed] = useState(false);

  const syncConfigured = useSync((s) => s.configured);
  const needsExport = useLive(async () => {
    if (syncConfigured) return false;
    const last = await getKv<number>('lastExportAt', 0);
    const first = await db.reviews.where('userId').equals(userId).first();
    return !!first && Date.now() - Math.max(last, first.at) > 5 * DAY;
  }, [userId, syncConfigured]);

  const hour = new Date().getHours();
  const ability = profile.ability;

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-2xl">
          {USER_EMOJI[userId]}
        </span>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">{t.home.greeting(profile.name, hour)}</h1>
          <p className="text-xs text-ink-3">
            {levelTitle(lvl.level)} · {t.stats.level_n(lvl.level)}
          </p>
        </div>
        <SyncDot />
        <Link
          to="/settings"
          aria-label={t.common.settings}
          className="tap grid place-items-center rounded-full text-ink-2"
        >
          <GearIcon />
        </Link>
      </header>

      {!ability && (
        <div className="card flex items-center gap-4 p-5">
          <div className="flex-1">
            <p className="font-bold">{t.home.noLevelYet}</p>
          </div>
          <Button onClick={() => nav('/placement')}>{t.home.placementCta}</Button>
        </div>
      )}

      <div className="card flex items-center gap-5 p-5">
        <Ring value={xpToday} max={goal} size={112}>
          <div className="text-2xl font-black leading-none" dir="ltr">
            {xpToday}
          </div>
          <div className="text-[11px] text-ink-3" dir="ltr">
            / {goal} XP
          </div>
        </Ring>
        <div className="flex flex-1 flex-col gap-2">
          <p className="text-sm font-semibold text-ink-2">
            {xpToday >= goal ? `${t.home.goalDone} ✓` : t.home.goal}
          </p>
          <div className="flex items-center gap-2">
            <FlameIcon className={streak.current > 0 ? 'text-warn' : 'text-ink-3'} size={26} />
            <span className="text-2xl font-black">{streak.current}</span>
            <span className="text-sm text-ink-2">{t.home.streak}</span>
          </div>
          <p className="text-xs text-ink-3">
            {t.home.record(streak.record)}
            {streak.freezes > 0 && ` · 🧊 ${t.home.freezes(streak.freezes)}`}
          </p>
        </div>
      </div>

      <RivalCard />

      {resumable && (
        <button
          type="button"
          onClick={() => nav('/session/resume')}
          className="card tap flex items-center gap-3 border border-accent/30 p-4 text-start"
        >
          <span className="text-xl">⏯️</span>
          <span className="flex-1 font-semibold">{t.home.resume}</span>
          <span className="font-bold text-accent">{t.home.resumeYes}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => nav(ability ? '/session/learn' : '/placement')}
        className="tap flex items-center gap-4 rounded-[1.5rem] bg-accent p-5 text-start text-accent-ink shadow-[0_14px_30px_-14px_var(--c-accent)] transition active:scale-[0.98]"
      >
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 text-3xl">
          ✨
        </span>
        <span className="flex-1">
          <span className="block text-2xl font-extrabold">{t.home.learn}</span>
          <span className="block text-sm opacity-90">{t.home.learnSub(due, newLeft)}</span>
        </span>
        <ChevronIcon size={26} />
      </button>

      <div className="grid grid-cols-2 gap-3">
        <ModeButton
          icon={<RepeatIcon />}
          label={t.home.review}
          sub={due ? String(due) : undefined}
          to="/session/review"
          disabled={!words.size}
        />
        <ModeButton
          icon={<MountainIcon />}
          label={t.home.hard}
          to="/session/hard"
          disabled={words.size < 5}
        />
        <ModeButton
          icon={<BoltIcon />}
          label={t.home.speed}
          to="/session/speed"
          disabled={words.size < 8}
        />
        <ModeButton
          icon={<HeadphonesIcon />}
          label={t.home.listening}
          to="/session/listening"
          disabled={!words.size}
        />
        <ModeButton icon={<SwordsIcon />} label={t.home.duel} to="/rivalry" />
        <ModeButton
          icon={<span className="text-lg">🐉</span>}
          label={t.home.boss}
          to="/session/boss"
          disabled={words.size < 30}
        />
      </div>

      <p className="text-center text-sm text-ink-3">
        {due ? t.home.queue(due, minutesFor(due)) : t.home.queueEmpty} · {t.home.newLeft(newLeft)}
      </p>

      {capSuggestion && !capDismissed && (
        <div className="card flex flex-col gap-3 p-4">
          <p className="text-sm font-medium">
            {capSuggestion.direction === 'up'
              ? t.home.capUp(capSuggestion.to)
              : t.home.capDown(capSuggestion.to)}
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1 py-2"
              onClick={() => {
                void updateSettings({ newPerDay: capSuggestion.to });
                setCapDismissed(true);
              }}
            >
              {t.home.capYes}
            </Button>
            <Button variant="ghost" className="py-2" onClick={() => setCapDismissed(true)}>
              {t.home.capNo}
            </Button>
          </div>
        </div>
      )}

      {needsExport && (
        <div className="card flex items-center gap-3 border border-warn/40 p-4">
          <p className="flex-1 text-sm">{t.home.exportNudge}</p>
          <Button
            variant="soft"
            className="py-2"
            onClick={() => void downloadBackup().then(() => toast('✓'))}
          >
            {t.home.exportNow}
          </Button>
        </div>
      )}

      {ability && <LevelCard theta={ability.theta} />}
      <WordOfDay />
      <Together />
    </div>
  );
}

function ModeButton({
  icon,
  label,
  sub,
  to,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string | undefined;
  to: string;
  disabled?: boolean;
}) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => nav(to)}
      className="card tap flex items-center gap-3 p-4 text-start transition active:scale-[0.98] disabled:opacity-40"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="flex-1 text-sm font-semibold leading-tight">{label}</span>
      {sub && (
        <span className="rounded-pill bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">
          {sub}
        </span>
      )}
    </button>
  );
}

function LevelCard({ theta }: { theta: number }) {
  const lvl = levelOf(theta);
  return (
    <Link to="/stats" className="card flex items-center gap-4 p-4">
      <div className="text-3xl font-black text-accent" dir="ltr">
        {lvl.band}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex justify-between text-xs text-ink-3">
          <span>{t.home.level}</span>
          {lvl.next && <span dir="ltr">{lvl.next}</span>}
        </div>
        <Bar value={lvl.progress} max={1} />
      </div>
    </Link>
  );
}

export function RivalCard({ compact = false }: { compact?: boolean }) {
  const me = useApp((s) => s.userId)!;
  const rivalId = otherUser(me);
  const configured = useSync((s) => s.configured);
  const data = useLive(async () => Promise.all([snapshot(me), snapshot(rivalId)]), [me, rivalId]);
  const [mine, rival] = data ?? [];
  const female = isFemale(rivalId);
  const status = (() => {
    if (!rival) return '';
    if (rival.presence?.inSession && Date.now() - rival.presence.lastSeenAt < 10 * 60_000)
      return t.rival.inSession(rival.name, female);
    if ((rival.today?.xp ?? 0) > 0) return t.rival.trainedToday(rival.name, female);
    return t.rival.notYet(rival.name, female);
  })();
  const diff = (mine?.weekXp ?? 0) - (rival?.weekXp ?? 0);

  return (
    <Link
      to="/rivalry"
      className="card flex flex-col gap-3 overflow-hidden p-4"
      style={{ background: 'linear-gradient(135deg, var(--c-card) 55%, var(--c-rival-soft))' }}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-rival-soft text-2xl">
          {USER_EMOJI[rivalId]}
        </span>
        <div className="flex-1">
          <p className="font-bold" style={{ color: 'var(--c-rival)' }}>
            {rival?.name ?? ''}
          </p>
          <p className="text-xs text-ink-2">
            <Bidi>{configured ? status : t.rival.noSync}</Bidi>
          </p>
        </div>
        {configured && rival && rival.lastActivity > 0 && (
          <span className="text-[11px] text-ink-3">
            {t.rival.lastSeen(relTime(rival.lastActivity))}
          </span>
        )}
      </div>
      {configured ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat value={rival?.today?.newWords ?? 0} label={t.rival.wordsToday} />
            <Stat value={rival?.today?.xp ?? 0} label={t.rival.xpToday} />
            <Stat value={rival?.streak ?? 0} label={t.rival.streak} icon="🔥" />
          </div>
          {!compact && (
            <p className="text-center text-xs font-semibold text-ink-2">
              {diff > 0 ? t.rival.leading(diff) : diff < 0 ? t.rival.trailing(-diff) : t.rival.tied}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-ink-3">{t.rival.noSyncBody}</p>
      )}
    </Link>
  );
}

function Stat({ value, label, icon }: { value: number; label: string; icon?: string }) {
  return (
    <div className="rounded-xl bg-bg-2/60 px-2 py-2">
      <div className="text-lg font-black" dir="ltr">
        {icon}
        {value}
      </div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

/** Shared by both users: seeded by date, a little above the pair's level. */
function WordOfDay() {
  const profile = useApp((s) => s.profile);
  const [word, setWord] = useState<WordContent | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const inv = await loadInventory();
      const date = todayKey();
      const rival = profile ? await db.users.get(otherUser(profile.id)) : undefined;
      const thetas = [profile?.ability?.theta, rival?.ability?.theta].filter(
        (x): x is number => typeof x === 'number',
      );
      const center = thetas.length
        ? Math.round(thetas.reduce((a, b) => a + b, 0) / thetas.length / 5) * 5
        : 45;
      const pool = inv.lemmas.filter(
        (l) => l.tier === 'A' && l.kind === 'word' && l.d >= center && l.d <= center + 12,
      );
      const fallback = inv.lemmas.filter((l) => l.tier === 'A' && l.kind === 'word');
      const list = pool.length ? pool : fallback;
      if (!list.length) return;
      const l = pick(
        createRng(hashString(`wotd:${date}:${center}`)),
        list.sort((a, b) => a.id - b.id),
      );
      const c = await getContent(l.id);
      if (alive) setWord(c);
    })();
    return () => {
      alive = false;
    };
  }, [profile]);
  if (!word) return null;
  const s = word.sentences[0];
  return (
    <Link to={`/word/${word.lemmaId}`} className="card flex flex-col gap-2 p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-3">{t.home.wordOfDay}</p>
      <div className="flex items-center gap-3">
        <En className="flex-1 text-3xl font-bold">{word.lemma}</En>
        <span onClick={(e) => e.preventDefault()}>
          <Speak
            text={word.lemma}
            urls={{
              ...(word.audioUrl ? { us: word.audioUrl } : {}),
              ...(word.audioUrlUk ? { uk: word.audioUrlUk } : {}),
            }}
            isWord
          />
        </span>
      </div>
      <p className="text-lg font-semibold text-ink-2">{word.hebrew.join(' · ')}</p>
      {s && (
        <p className="text-sm text-ink-2">
          <En>{s.en}</En>
        </p>
      )}
    </Link>
  );
}

function Together() {
  const me = useApp((s) => s.userId)!;
  const configured = useSync((s) => s.configured);
  const total = useLive(async () => {
    const [a, b] = await Promise.all([snapshot(me), snapshot(otherUser(me))]);
    return a.totalWords + b.totalWords;
  }, [me]);
  if (!configured || !total) return null;
  return (
    <p className="text-center text-sm font-semibold text-ink-2">🤝 {t.home.together(total)}</p>
  );
}
