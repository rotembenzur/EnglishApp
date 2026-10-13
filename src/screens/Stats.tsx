import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { levelOf } from '@/engine/ability';
import { BANDS } from '@/engine/difficulty';
import { BADGES, computeStreak, levelForXp } from '@/engine/game';
import { dayKey } from '@/engine/rng';
import {
  accuracyByType,
  activityByDay,
  dueForecast,
  recallAfterGap,
  retentionSince,
} from '@/engine/stats';
import type { ReviewRecord, UserId } from '@/engine/types';
import { db } from '@/data/db';
import { loadInventory } from '@/content/inventory';
import { USER_NAMES } from '@/data/repo';
import { t } from '@/i18n/he';
import { todayKey, useApp } from '@/state/app';
import { useLive } from '@/state/live';
import { Bar, Header, Section } from '@/ui/kit';
import { Ltr } from '@/ui/bidi';

const DAY = 86_400_000;

export function Stats() {
  const { user } = useParams();
  const nav = useNavigate();
  const me = useApp((s) => s.userId)!;
  const userId = (user === 'rotem' || user === 'noa' ? user : me) as UserId;
  const readOnly = userId !== me;

  const data = useLive(async () => {
    const [profile, words, reviews, daily, inv] = await Promise.all([
      db.users.get(userId),
      db.userWords.where('userId').equals(userId).toArray(),
      db.reviews.where('userId').equals(userId).toArray(),
      db.dailyStats.where('userId').equals(userId).toArray(),
      loadInventory(),
    ]);
    return { profile, words, reviews, daily, inv };
  }, [userId]);

  const derived = useMemo(() => {
    if (!data) return null;
    const { words, reviews, daily, inv, profile } = data;
    const now = Date.now();
    const tz = new Date().getTimezoneOffset();
    const byBand = new Map<string, number>(BANDS.map((b) => [b, 0]));
    for (const w of words) {
      if (w.state === 'ignored') continue;
      const b = inv.byId.get(w.lemmaId)?.band;
      if (b) byBand.set(b, (byBand.get(b) ?? 0) + 1);
    }
    const weeks: { label: string; rate: number; n: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const end = now - i * 7 * DAY;
      const r = retentionSince(
        reviews.filter((x) => x.at < end),
        end - 7 * DAY,
      );
      weeks.push({ label: shortDate(dayKey(end - 7 * DAY, tz)), rate: r.rate, n: r.n });
    }
    const activity = activityByDay(reviews, (ts) => dayKey(ts, tz));
    const minutes = new Map(daily.map((d) => [d.date, Math.round(d.ms / 60000)]));
    const totalXp = daily.reduce((a, d) => a + d.xp, 0);
    return {
      profile,
      byBand,
      weeks,
      recall: recallAfterGap(reviews),
      activity,
      minutes,
      byType: accuracyByType(
        reviews.filter((r: ReviewRecord) => r.purpose !== 'probe' && r.purpose !== 'verify'),
      ),
      forecast: dueForecast(words, now, 14),
      totalWords: words.filter((w) => w.state !== 'ignored' && w.state !== 'known').length,
      learned: words.filter((w) => w.learnedAt).length,
      totalXp,
      level: levelForXp(totalXp).level,
      streak: computeStreak(daily, todayKey()),
      reviews: reviews.length,
      thetaHistory: profile?.thetaHistory ?? [],
    };
  }, [data]);

  if (!derived) return <Header title={t.stats.title} />;
  const ability = derived.profile?.ability;
  const lvl = ability ? levelOf(ability.theta) : null;
  return (
    <div className="flex flex-col gap-6 pb-10">
      <Header
        title={readOnly ? t.stats.rivalView(USER_NAMES[userId]) : t.stats.title}
        {...(readOnly ? { onBack: () => nav(-1) } : {})}
      />
      <div className="flex flex-col gap-6 px-4">
        {lvl && ability && (
          <div className="card flex items-center gap-4 p-5">
            <span className="text-5xl font-black text-accent" dir="ltr">
              {lvl.band}
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <Bar value={lvl.progress} max={1} />
              <p className="text-xs text-ink-3">
                {t.stats.theta}:{' '}
                <Ltr>
                  {ability.theta.toFixed(1)} ± {ability.sigma.toFixed(1)}
                </Ltr>
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Tile label={t.stats.totalWords} value={derived.totalWords} />
          <Tile label={t.stats.totalLearned} value={derived.learned} />
          <Tile label={t.stats.totalXp} value={derived.totalXp} />
          <Tile
            label={t.stats.recall7}
            value={derived.recall ? `${Math.round(derived.recall.rate * 100)}%` : '—'}
          />
        </div>

        <Section title={t.stats.abilityOverTime}>
          <LineChart points={derived.thetaHistory.map(([x, y]) => [x, y])} min={0} max={100} />
        </Section>

        <Section title={t.stats.knownByBand}>
          <div className="card flex items-end gap-2 p-4">
            {[...derived.byBand.entries()].map(([b, n]) => {
              const max = Math.max(1, ...derived.byBand.values());
              return (
                <div key={b} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] text-ink-3" dir="ltr">
                    {n}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-accent"
                    style={{ height: `${6 + (n / max) * 80}px` }}
                  />
                  <span className="text-[11px] font-bold" dir="ltr">
                    {b}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={t.stats.retention}>
          <div className="card flex items-end gap-1.5 p-4">
            {derived.weeks.map((w) => (
              <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-ink-3" dir="ltr">
                  {w.n ? `${Math.round(w.rate * 100)}%` : ''}
                </span>
                <div
                  className={`w-full rounded-t-md ${w.rate >= 0.85 ? 'bg-good' : 'bg-warn'}`}
                  style={{ height: `${4 + w.rate * 70}px`, opacity: w.n ? 1 : 0.2 }}
                />
                <span className="text-[10px] text-ink-3" dir="ltr">
                  {w.label}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t.stats.heatmap}>
          <Heatmap activity={derived.activity} />
        </Section>

        <Section title={t.stats.minutes}>
          <MiniBars
            values={lastDays(14).map((d) => derived.minutes.get(d) ?? 0)}
            labels={lastDays(14).map((d) => d.slice(8))}
          />
        </Section>

        <Section title={t.stats.byType}>
          <div className="card flex flex-col gap-3 p-4">
            {Object.entries(derived.byType).length === 0 && (
              <p className="text-sm text-ink-3">{t.stats.notEnough}</p>
            )}
            {Object.entries(derived.byType).map(([type, v]) => (
              <div key={type} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-ink-2">{t.stats.types[type] ?? type}</span>
                <Bar value={v.ok} max={v.n} className="flex-1" />
                <span className="w-12 text-end text-xs text-ink-3" dir="ltr">
                  {Math.round((v.ok / v.n) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t.stats.forecast}>
          <MiniBars
            values={derived.forecast}
            labels={derived.forecast.map((_, i) => (i === 0 ? t.common.today : String(i)))}
          />
        </Section>

        <Section
          title={t.stats.badgesCount(
            Object.keys(derived.profile?.badges ?? {}).length,
            BADGES.length,
          )}
        >
          <div className="grid grid-cols-4 gap-2">
            {BADGES.map((b) => {
              const got = !!derived.profile?.badges[b.id];
              return (
                <div
                  key={b.id}
                  title={t.badges[b.id]?.[1]}
                  className={`card flex flex-col items-center gap-1 p-2 text-center ${got ? '' : 'opacity-30 grayscale'}`}
                >
                  <span className="text-2xl">{b.icon}</span>
                  <span className="text-[10px] leading-tight">{t.badges[b.id]?.[0]}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

/** "2026-10-05" as "5.10", the way dates are written in Hebrew. */
function shortDate(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)}.${Number(m)}`;
}

function lastDays(n: number): string[] {
  const tz = new Date().getTimezoneOffset();
  return Array.from({ length: n }, (_, i) => dayKey(Date.now() - (n - 1 - i) * DAY, tz));
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-2xl font-black" dir="ltr">
        {typeof value === 'number' ? value.toLocaleString('he-IL') : value}
      </span>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}

/** Bars over time. Like every time axis in the app, time runs right to left (spec 8.3). */
function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="card flex items-end gap-1 p-4">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[9px] text-ink-3">{v || ''}</span>
          <div
            className="w-full rounded-t-sm bg-accent"
            style={{ height: `${2 + (v / max) * 64}px`, opacity: v ? 1 : 0.2 }}
          />
          <span className="text-[9px] text-ink-3">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Heatmap of the last 26 weeks. Time runs right to left like the other charts: the oldest week on
 * the right, this week on the left, scrolled into view.
 */
function Heatmap({ activity }: { activity: Map<string, number> }) {
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // In RTL the scroll origin is the right edge; the far left (this week) is the most negative.
    const el = pane.current;
    if (el) el.scrollLeft = -el.scrollWidth;
  }, []);
  const tz = new Date().getTimezoneOffset();
  const weeks = 26;
  const today = new Date();
  const start = Date.now() - ((weeks - 1) * 7 + today.getDay()) * DAY;
  const cells: { key: string; n: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { key: string; n: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const ts = start + (w * 7 + d) * DAY;
      const key = dayKey(ts, tz);
      col.push({ key, n: ts > Date.now() ? -1 : (activity.get(key) ?? 0) });
    }
    cells.push(col);
  }
  const level = (n: number) => (n <= 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4);
  return (
    <div ref={pane} className="card overflow-x-auto p-4">
      <div className="flex gap-[3px]">
        {cells.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((c) => (
              <div
                key={c.key}
                title={`${c.key}: ${Math.max(0, c.n)}`}
                className="h-[11px] w-[11px] rounded-[3px]"
                style={{
                  background:
                    c.n < 0
                      ? 'transparent'
                      : level(c.n) === 0
                        ? 'var(--c-line)'
                        : 'var(--c-accent)',
                  opacity: c.n < 0 ? 0 : level(c.n) === 0 ? 1 : 0.25 + level(c.n) * 0.19,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ points, min, max }: { points: [number, number][]; min: number; max: number }) {
  if (points.length < 2) return <p className="card p-4 text-sm text-ink-3">{t.stats.notEnough}</p>;
  const W = 320;
  const H = 120;
  const xs = points.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ys = points.map((p) => p[1]);
  const lo = Math.max(min, Math.floor(Math.min(...ys) - 5));
  const hi = Math.min(max, Math.ceil(Math.max(...ys) + 5));
  // Time runs right to left: the first point on the right, today on the left.
  const px = (x: number) => W - 10 - ((x - x0) / Math.max(1, x1 - x0)) * (W - 20);
  const py = (y: number) => H - 10 - ((y - lo) / Math.max(1, hi - lo)) * (H - 20);
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`)
    .join(' ');
  return (
    <div className="card p-4">
      <svg
        direction="ltr"
        viewBox={`0 0 ${W} ${H}`}
        className="h-32 w-full"
        role="img"
        aria-label={t.stats.abilityOverTime}
      >
        <path
          d={d}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x={W - 4} y="12" fontSize="10" fill="var(--c-ink-3)" textAnchor="end">
          {hi}
        </text>
        <text x={W - 4} y={H - 2} fontSize="10" fill="var(--c-ink-3)" textAnchor="end">
          {lo}
        </text>
      </svg>
    </div>
  );
}
