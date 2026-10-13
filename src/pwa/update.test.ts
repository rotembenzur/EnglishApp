import { applyUpdate } from './update';
import { toast, useToasts } from '@/ui/toast';

function fakeServiceWorker() {
  const listeners: (() => void)[] = [];
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    value: { addEventListener: (_: string, fn: () => void) => listeners.push(fn) },
  });
  return { fireControllerChange: () => listeners.forEach((fn) => fn()) };
}

describe('update prompt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tells the waiting worker to take over and reloads once it does', async () => {
    const sw = fakeServiceWorker();
    const posted: unknown[] = [];
    const reg = { waiting: { postMessage: (m: unknown) => posted.push(m) } };
    const reload = vi.fn();
    await applyUpdate(reg as unknown as ServiceWorkerRegistration, reload);
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
    sw.fireControllerChange();
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the takeover event never arrives (iOS)', async () => {
    fakeServiceWorker();
    const reload = vi.fn();
    const reg = { waiting: { postMessage: () => undefined } };
    await applyUpdate(reg as unknown as ServiceWorkerRegistration, reload);
    vi.advanceTimersByTime(2600);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads right away when the new version already took over', async () => {
    fakeServiceWorker();
    const reload = vi.fn();
    await applyUpdate({ waiting: null } as unknown as ServiceWorkerRegistration, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
  });
  const onScreen = () => useToasts.getState().toasts.map((t) => t.text);

  it('replaces a repeated message instead of stacking it', () => {
    toast('נשלח');
    toast('נשלח');
    toast('נשלח');
    expect(onScreen()).toEqual(['נשלח']);
    vi.advanceTimersByTime(3300);
    expect(onScreen()).toEqual([]);
  });

  it('replaces an error with the next error', () => {
    toast('השליחה לא הצליחה (403 BadJwtToken)', { tone: 'warn' });
    toast('השליחה לא הצליחה (410 Unregistered)', { tone: 'warn' });
    expect(onScreen()).toEqual(['השליחה לא הצליחה (410 Unregistered)']);
    vi.advanceTimersByTime(3300);
    expect(onScreen()).toEqual([]);
  });

  it('shows tap feedback at once and brings an interrupted nudge back right after', () => {
    toast('רתם שלח לך 👋', { ms: 5000, announce: true });
    toast('מחובר');
    expect(onScreen()).toEqual(['מחובר']);
    vi.advanceTimersByTime(3300);
    expect(onScreen()).toEqual(['רתם שלח לך 👋']);
    vi.advanceTimersByTime(5100);
    expect(onScreen()).toEqual([]);
  });

  it('lets an announcement wait while feedback shows', () => {
    toast('ההתראות פועלות');
    toast('נועה שלחה לך 🔥', { ms: 5000, announce: true });
    expect(onScreen()).toEqual(['ההתראות פועלות']);
    vi.advanceTimersByTime(3300);
    expect(onScreen()).toEqual(['נועה שלחה לך 🔥']);
  });

  it('restarts the timer when a message is replaced', () => {
    toast('a');
    vi.advanceTimersByTime(3000);
    toast('a');
    vi.advanceTimersByTime(1000);
    expect(onScreen()).toEqual(['a']);
  });
});
