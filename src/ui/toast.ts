import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'good' | 'warn';
  icon?: string;
}
interface ToastState {
  /** The toast on screen (zero or one). */
  toasts: Toast[];
  push: (text: string, opts?: ToastOptions) => void;
}

export interface ToastOptions {
  tone?: Toast['tone'];
  icon?: string;
  ms?: number;
  /**
   * News that arrives by itself (a rival's nudge, the weekly recap) rather than feedback to a
   * tap. It waits its turn, and if feedback interrupts it, it is shown again right after.
   */
  announce?: boolean;
}

interface Pending extends Toast {
  ms: number;
  announce: boolean;
}

let toastSeq = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let current: Pending | null = null;
let queue: Pending[] = [];
const MAX_QUEUED = 3;

/** Same message again, or a new error while an error shows: the newer one takes its place. */
function supersedes(next: Pending, old: Pending): boolean {
  return next.text === old.text || (next.tone === 'warn' && old.tone === 'warn');
}

/**
 * One toast at a time, never stacked:
 *  - a repeated message or a new error replaces the one on screen and restarts its timer, so
 *    retrying a failing action shows one current message;
 *  - feedback to a tap shows at once; if it interrupts an announcement (a nudge), the
 *    announcement is shown again right after, so it is never lost;
 *  - an announcement that arrives while something shows waits its turn.
 */
export const useToasts = create<ToastState>((set) => {
  const show = (item: Pending | null) => {
    current = item;
    clearTimeout(hideTimer);
    if (!item) {
      set({ toasts: [] });
      return;
    }
    const { ms: _ms, announce: _a, ...visible } = item;
    set({ toasts: [visible] });
    hideTimer = setTimeout(() => show(queue.shift() ?? null), item.ms);
  };
  return {
    toasts: [],
    push: (text, opts = {}) => {
      const item: Pending = {
        id: ++toastSeq,
        text,
        ms: opts.ms ?? 3200,
        announce: opts.announce === true,
        ...(opts.tone ? { tone: opts.tone } : {}),
        ...(opts.icon ? { icon: opts.icon } : {}),
      };
      queue = queue.filter((q) => !supersedes(item, q));
      if (!current || supersedes(item, current)) {
        show(item);
      } else if (item.announce) {
        queue = [...queue, item].slice(-MAX_QUEUED);
      } else {
        if (current.announce) queue = [current, ...queue].slice(0, MAX_QUEUED);
        show(item);
      }
    },
  };
});

export const toast = (text: string, opts?: ToastOptions) => useToasts.getState().push(text, opts);
