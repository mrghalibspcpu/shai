/** Tiny DOM helpers + toast. */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, ev, fn, opts) {
  if (!el) return () => {};
  el.addEventListener(ev, fn, opts);
  return () => el.removeEventListener(ev, fn, opts);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer = null;
export function toast(message, { ms = 2600 } = {}) {
  const el = qs('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.remove('is-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => {
      el.hidden = true;
    }, 260);
  }, ms);
}

export const LOGO_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4l7.6 22.4L80 12.4 69.9 34.5 96 50 69.9 65.5 80 87.6 57.6 73.6 50 96l-7.6-22.4L20 87.6l10.1-22.1L4 50l26.1-15.5L20 12.4l22.4 14z"/></svg>`;

export function download(filename, text, type = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Open a link: native in-app browser inside the APK, new tab on the web.
 */
export async function openExternal(url) {
  try {
    const [{ Browser }, { Capacitor }] = await Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/core'),
    ]);
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url, presentationStyle: 'popover' });
      return;
    }
  } catch (_) {
    /* fall through to the browser */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
