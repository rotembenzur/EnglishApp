import { NavLink } from 'react-router-dom';
import { t } from '@/i18n/he';

const tabs = [
  { to: '/', label: t.tabs.home, icon: HomeIcon, end: true },
  { to: '/learn', label: t.tabs.learn, icon: LearnIcon, end: false },
  { to: '/words', label: t.tabs.words, icon: WordsIcon, end: false },
  { to: '/rivalry', label: t.tabs.rivalry, icon: RivalryIcon, end: false },
  { to: '/stats', label: t.tabs.stats, icon: StatsIcon, end: false },
] as const;

export function TabBar() {
  return (
    <nav
      aria-label="ניווט ראשי"
      className="shrink-0 border-t border-line bg-card/95 backdrop-blur"
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <ul className="mx-auto flex h-[var(--tabbar-h)] max-w-md items-stretch justify-around px-1">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-3 hover:text-ink-2'
                }`
              }
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </svg>
  );
}
function LearnIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5" />
    </svg>
  );
}
function WordsIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function RivalryIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}
function StatsIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
