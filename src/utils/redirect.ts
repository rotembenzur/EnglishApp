/**
 * GitHub Pages serves 404.html for deep links; it stores the intended path in
 * sessionStorage and redirects to the app shell. Restore that path here before
 * the router mounts.
 */
export function restoreRedirect(): void {
  try {
    const target = sessionStorage.getItem('lexbites.redirect');
    if (!target) return;
    sessionStorage.removeItem('lexbites.redirect');
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const clean = target.replace(/^\/+/, '');
    history.replaceState(null, '', `${base}/${clean}`);
  } catch {
    // sessionStorage can be unavailable in private mode; nothing to restore.
  }
}
