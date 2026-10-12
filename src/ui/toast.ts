import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'good' | 'warn';
  icon?: string;
}
interface ToastState {
  toasts: Toast[];
  push: (text: string, opts?: { tone?: Toast['tone']; icon?: string; ms?: number }) => void;
}
let toastSeq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (text, opts = {}) => {
    const id = ++toastSeq;
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id,
          text,
          ...(opts.tone ? { tone: opts.tone } : {}),
          ...(opts.icon ? { icon: opts.icon } : {}),
        },
      ],
    }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      opts.ms ?? 3200,
    );
  },
}));
export const toast = (text: string, opts?: { tone?: Toast['tone']; icon?: string; ms?: number }) =>
  useToasts.getState().push(text, opts);
