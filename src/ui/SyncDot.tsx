import { Link } from 'react-router-dom';
import { t } from '@/i18n/he';
import { useSync } from '@/sync/engine';

/** Unobtrusive sync status: green synced, grey offline/off, orange pending (spec 9.3). */
export function SyncDot() {
  const status = useSync((s) => s.status);
  const color =
    status === 'ok'
      ? 'bg-good'
      : status === 'pending' || status === 'syncing'
        ? 'bg-warn'
        : status === 'error'
          ? 'bg-bad'
          : 'bg-ink-3';
  const label =
    status === 'ok'
      ? t.sync.synced
      : status === 'pending' || status === 'syncing'
        ? t.sync.pending
        : status === 'off'
          ? t.sync.off
          : status === 'error'
            ? t.settings.syncStatus.error
            : t.sync.offline;
  return (
    <Link
      to="/settings#sync"
      className="tap grid place-items-center"
      aria-label={label}
      title={label}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${color} ${status === 'syncing' ? 'animate-pulse-soft' : ''}`}
      />
    </Link>
  );
}
