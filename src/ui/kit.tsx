/** Small shared UI building blocks. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { playSentence, playWord, unlockAudio } from '@/audio/speech';
import { useApp } from '@/state/app';
import { BackIcon, SpeakerIcon } from './icons';
import { toast, useToasts } from './toast';
import { isPending, usePendingClips } from '@/audio/pending';
import { createPortal } from 'react-dom';
import { He, Ltr } from './bidi';
import { hasHebrew } from '@/i18n/bidi';
import { t as strings } from '@/i18n/he';

/** English content inside the RTL layout. */
export function En({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`en ${className}`}>
      {children}
    </span>
  );
}

export function Ring({
  value,
  max,
  size = 120,
  stroke = 12,
  color = 'var(--c-accent)',
  track = 'var(--c-line)',
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring-progress absolute inset-0" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.2,0.9,0.3,1)' }}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

export function Bar({
  value,
  max,
  color = 'var(--c-accent)',
  className = '',
}: {
  value: number;
  max: number;
  color?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div
      className={`h-2 overflow-hidden rounded-pill bg-line ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-pill transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

type BtnVariant = 'primary' | 'soft' | 'ghost' | 'outline' | 'danger';
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary:
      'bg-accent text-accent-ink shadow-[0_6px_20px_-8px_var(--c-accent)] active:scale-[0.98]',
    soft: 'bg-accent-soft text-accent active:scale-[0.98]',
    ghost: 'text-ink-2 hover:bg-card-2',
    outline: 'border border-line bg-card text-ink active:scale-[0.98]',
    danger: 'bg-bad-soft text-bad active:scale-[0.98]',
  };
  return (
    <button
      type="button"
      className={`tap inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold transition disabled:opacity-40 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Speaker button: tap plays, long press plays slowly (spec 5.3). */
export function Speak({
  text,
  urls,
  isWord = false,
  size = 'md',
  className = '',
  label = strings.common.play,
}: {
  text: string;
  urls?: { us?: string; uk?: string };
  isWord?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}) {
  const settings = useApp((s) => s.profile?.settings);
  // A natural clip for a saved text is on its way: say so instead of using the system voice.
  const pending = usePendingClips((s) =>
    isPending(s.pending, text, isWord ? 'word' : 'sentence', settings?.accent ?? 'us'),
  );
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  const [playing, setPlaying] = useState(false);
  const play = async (slow: boolean) => {
    unlockAudio();
    if (pending) {
      toast(strings.textAudio.preparing, { icon: '⏳' });
      return;
    }
    setPlaying(true);
    const opts = {
      accent: settings?.accent ?? 'us',
      ...(settings?.voiceURI ? { voiceURI: settings.voiceURI } : {}),
      rate: settings?.speechRate ?? 0.95,
      slow,
    };
    try {
      if (isWord) await playWord(text, urls ?? {}, opts);
      else await playSentence(text, opts);
    } finally {
      setPlaying(false);
    }
  };
  const dims =
    size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-9 w-9 min-h-0 min-w-0' : 'h-11 w-11';
  return (
    <button
      type="button"
      aria-label={pending ? `${label}, ${strings.textAudio.preparingLabel}` : label}
      data-pending={pending ? '1' : undefined}
      className={`tap grid shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition active:scale-95 ${dims} ${playing ? 'animate-pulse-soft' : ''} ${pending ? 'border-2 border-dashed border-accent/60 opacity-70' : ''} ${className}`}
      onPointerDown={() => {
        longFired.current = false;
        timer.current = window.setTimeout(() => {
          longFired.current = true;
          void play(true);
        }, 450);
      }}
      onPointerUp={() => {
        if (timer.current) window.clearTimeout(timer.current);
        if (!longFired.current) void play(false);
      }}
      onPointerLeave={() => {
        if (timer.current) window.clearTimeout(timer.current);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void play(e.shiftKey);
        }
      }}
    >
      <SpeakerIcon size={size === 'lg' ? 28 : size === 'sm' ? 16 : 20} />
    </button>
  );
}

/** Bottom sheet modal. */
export function Sheet({
  open,
  onClose,
  children,
  title,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Always visible under the scrolling content (the sheet's main action). */
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portaled to <body> so no transformed ancestor can trap it under the tab bar. The overlay
  // covers the visual viewport (src/ui/viewport.ts), so with the iOS keyboard open the panel sits
  // right above it; the panel never grows past that area and scrolls inside.
  return createPortal(
    <div
      className="fixed inset-x-0 z-[55] flex items-end justify-center"
      style={{ top: 'var(--vv-top, 0px)', height: 'var(--vv-h, 100dvh)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label={strings.common.close}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="relative flex max-h-full w-full max-w-md animate-fade-up flex-col rounded-t-[1.75rem] bg-card"
        style={{ maxHeight: 'calc(var(--vv-h, 100dvh) - var(--sat) - 0.5rem)' }}
        data-testid="sheet-panel"
      >
        <div className="scroll-pane min-h-0 flex-1 p-5 pb-3">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-pill bg-line" />
          {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
          {children}
        </div>
        {footer && (
          <div
            className="shrink-0 border-t border-line/60 px-5 pt-3"
            style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}
          >
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0" style={{ height: 'calc(var(--sab) + 0.5rem)' }} />}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ paddingTop: 'calc(var(--sat) + 12px)' }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="card pointer-events-auto flex max-w-md animate-fade-up items-center gap-2 px-4 py-3 text-sm font-medium"
        >
          {t.icon && <span className="text-lg">{t.icon}</span>}
          <He>{t.text}</He>
        </div>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export function Crowns({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`} aria-label={strings.word.crownsLabel(n)}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < n ? 'text-warn' : 'text-line'} aria-hidden>
          ♛
        </span>
      ))}
    </span>
  );
}

/** Screen header with a back button (mirrors in RTL). */
export function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-bg/90 px-2 py-2 backdrop-blur">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.common.back}
          className="tap grid place-items-center rounded-full text-ink-2"
        >
          <BackIcon />
        </button>
      )}
      <h1 className="flex-1 truncate px-2 text-xl font-bold">
        {title && !hasHebrew(title) ? <Ltr className="en">{title}</Ltr> : title}
      </h1>
      {right}
    </header>
  );
}
