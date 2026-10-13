/**
 * Activate the waiting service worker and reload into the new version.
 *
 * vite-plugin-pwa reloads only when Workbox reports the takeover as an update of this page's own
 * install. On iPhone the new version is usually found already waiting when the app is reopened
 * (Workbox calls that "external"), so its reload never ran: the new worker took over silently and
 * the page stayed on the old version until the app was closed. Here the waiting worker is told to
 * skip waiting directly, the native controllerchange event triggers the reload, and a fallback
 * reload runs in case that event never arrives.
 */
export async function applyUpdate(
  reg: ServiceWorkerRegistration | undefined,
  reload: () => void = () => window.location.reload(),
  fallbackMs = 2500,
): Promise<void> {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    reload();
  };
  const waiting = reg?.waiting;
  if (!waiting) {
    once();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', once, { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(once, fallbackMs);
}
