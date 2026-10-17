/**
 * iOS keyboard and viewport (0.10.0). The keyboard shrinks only the visual viewport: a sheet pinned
 * to the bottom of the layout viewport slides under it, together with its buttons, and 100dvh does
 * not change. After the keyboard closes, WebKit can also leave the page scrolled, which pushes the
 * content under the tab bar until the next reload.
 *
 * This keeps two CSS variables in step with the visual viewport (--vv-h, --vv-top; sheets use them
 * to stay inside the visible area), marks <html data-keyboard> while the keyboard is up (the
 * bottom safe-area padding is then 0) and scrolls the page back when the keyboard closes.
 */

const editable = (el: Element | null) =>
  !!el &&
  (el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio'].includes(el.type)) ||
    (el as HTMLElement).isContentEditable);

export function installViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  const root = win.document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const h = vv ? vv.height : win.innerHeight;
    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    root.style.setProperty('--vv-h', `${Math.round(h)}px`);
    root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    // The keyboard covers the home indicator area: no safe-area padding while it is up.
    if (vv && win.innerHeight - vv.height > 120) root.setAttribute('data-keyboard', '');
    else root.removeAttribute('data-keyboard');
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(apply);
  };
  const onFocusOut = () => {
    win.setTimeout(() => {
      if (editable(win.document.activeElement)) return;
      const se = win.document.scrollingElement;
      if (win.scrollY || (se && se.scrollTop)) win.scrollTo(0, 0);
      apply();
    }, 120);
  };
  apply();
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  win.document.addEventListener('focusout', onFocusOut);
  return () => {
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    win.document.removeEventListener('focusout', onFocusOut);
  };
}
