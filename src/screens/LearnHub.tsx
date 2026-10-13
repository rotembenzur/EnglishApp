import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { dueWords, minutesFor, MODE_MIN, modePoolSize } from '@/engine/session';
import { newWordsLeft } from '@/engine/selection';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { Header } from '@/ui/kit';
import { Ltr } from '@/ui/bidi';
import {
  BoltIcon,
  ChevronIcon,
  HeadphonesIcon,
  MountainIcon,
  RepeatIcon,
  SwordsIcon,
} from '@/ui/icons';

export function LearnHub() {
  const nav = useNavigate();
  const profile = useApp((s) => s.profile)!;
  const words = useApp((s) => s.words);
  const today = useApp((s) => s.today);
  const due = useMemo(() => dueWords([...words.values()], Date.now()).length, [words]);
  const left = newWordsLeft(profile.settings.newPerDay, today?.newWords ?? 0, today?.bonusNew);
  const list = useMemo(() => [...words.values()], [words]);
  const practice = modePoolSize('review', list);
  const items: {
    key: string;
    label: string;
    icon: React.ReactNode;
    to: string;
    badge?: string;
    min?: number;
    /** Pool the minimum applies to (default: learned words). */
    pool?: number;
  }[] = [
    {
      key: 'learn',
      label: t.home.learn,
      icon: <span className="text-xl">✨</span>,
      to: profile.ability ? '/session/learn' : '/placement',
      badge: left ? `+${left}` : undefined,
    },
    {
      key: 'review',
      label: t.home.review,
      icon: <RepeatIcon />,
      to: '/session/review',
      badge: due ? String(due) : undefined,
      min: due ? 0 : MODE_MIN.review,
    },
    {
      key: 'hard',
      label: t.home.hard,
      icon: <MountainIcon />,
      to: '/session/hard',
      min: MODE_MIN.hard,
    },
    {
      key: 'speed',
      label: t.home.speed,
      icon: <BoltIcon />,
      to: '/session/speed',
      min: MODE_MIN.speed,
      pool: modePoolSize('speed', list),
    },
    {
      key: 'listening',
      label: t.home.listening,
      icon: <HeadphonesIcon />,
      to: '/session/listening',
      min: MODE_MIN.listening,
    },
    {
      key: 'boss',
      label: t.home.boss,
      icon: <span className="text-xl">🐉</span>,
      to: '/session/boss',
      min: MODE_MIN.boss,
    },
    { key: 'duel', label: t.home.duel, icon: <SwordsIcon />, to: '/session/duel' },
    { key: 'read', label: t.read.title, icon: <span className="text-xl">📖</span>, to: '/read' },
    {
      key: 'confusables',
      label: t.confusables.title,
      icon: <span className="text-xl">🔀</span>,
      to: '/confusables',
    },
  ];
  return (
    <div className="flex flex-col gap-4 pb-8">
      <Header title={t.tabs.learn} />
      <div className="flex flex-col gap-3 px-4">
        <p className="text-sm text-ink-3">
          {due ? t.home.queue(due, minutesFor(due)) : t.home.queueEmpty}
        </p>
        {items.map((it) => {
          const disabled = (it.min ?? 0) > (it.pool ?? practice);
          return (
            <button
              key={it.key}
              type="button"
              disabled={disabled}
              onClick={() => nav(it.to)}
              className="card tap flex items-center gap-4 p-4 text-start transition active:scale-[0.98] disabled:opacity-40"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                {it.icon}
              </span>
              <span className="flex flex-1 flex-col">
                <span className="font-bold">{it.label}</span>
                <span className="text-xs text-ink-3">{t.learnHub[it.key]}</span>
              </span>
              {it.badge && (
                <Ltr className="rounded-pill bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">
                  {it.badge}
                </Ltr>
              )}
              <ChevronIcon className="text-ink-3" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
