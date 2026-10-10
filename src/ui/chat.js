/**
 * SHIA AI · Chat thread rendering + streaming
 *
 * Streaming auto-scroll rules:
 *   • While an answer streams, the view follows the bottom ONLY while the user
 *     is at (or near) the bottom.
 *   • Any touch, wheel, scrollbar drag or navigation key pauses following at
 *     once — the view stops jumping.
 *   • A small floating "نیچے جائیں" button appears while the user is away from
 *     the bottom; tapping it (or scrolling back to the end) resumes following.
 */

import { renderMarkdown, toPlainText } from '../lib/markdown.js';
import { extract, renderRefs } from '../lib/citations.js';
import { LOGO_SVG, qs, toast } from '../lib/dom.js';

const SUGGESTIONS = [
  'نمازِ شب کی فضیلت',
  'کافی جلد 2 باب 17 حدیث 14',
  'روزے کے بارے میں روایات',
  'وضو کا طریقہ — سیستانی فتویٰ',
  'اہل بیت ؑ سے محبت',
  'توبہ اور صبر',
];

export function renderWelcome(threadEl) {
  const wrap = document.createElement('div');
  wrap.className = 'welcome';
  wrap.innerHTML = `
    <div class="welcome__logo">${LOGO_SVG}</div>
    <h2 class="welcome__title">السلام علیکم — میں <em>شیعہ اے آئی</em> ہوں</h2>
    <p class="welcome__desc">
      میں آپ کے سوال کا جواب صرف مستند ڈیٹا بیس سے، آسان اور خوبصورت اردو میں دیتا ہوں:
      <b>Thaqalayn</b> کی احادیث (عربی متن، ترجمہ اور مکمل حوالہ) اور
      <b>سیستانی</b> کے فتاویٰ (مجتہد کے نام اور اصل ماخذ کے لنک کے ساتھ)۔
      جو مواد ڈیٹا بیس میں نہ ہو، میں اس کا جواب نہیں گھڑتا۔
    </p>
    <div class="chips"></div>`;
  const chips = wrap.querySelector('.chips');
  SUGGESTIONS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = s;
    b.style.animationDelay = `${0.08 * i + 0.15}s`;
    b.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('shai:suggest', { detail: s }));
    });
    chips.appendChild(b);
  });

  threadEl.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'thread__inner';
  inner.appendChild(wrap);
  threadEl.appendChild(inner);
}

export function ensureInner(threadEl) {
  let inner = threadEl.querySelector('.thread__inner');
  if (!inner) {
    threadEl.innerHTML = '';
    inner = document.createElement('div');
    inner.className = 'thread__inner';
    threadEl.appendChild(inner);
  }
  const welcome = inner.querySelector('.welcome');
  if (welcome) welcome.remove();
  return inner;
}

function toolsHtml() {
  return `
    <div class="msg__tools">
      <button class="tool" data-act="copy" type="button">کاپی</button>
      <button class="tool" data-act="retry" type="button">دوبارہ</button>
      <button class="tool" data-act="share" type="button">شیئر</button>
    </div>`;
}

export function addMessage(inner, { role, content, id }) {
  const msg = document.createElement('div');
  msg.className = `msg msg--${role === 'user' ? 'user' : 'ai'}`;
  msg.dataset.id = id;
  msg.dataset.role = role;

  const av = document.createElement('div');
  av.className = 'msg__av';
  av.innerHTML = role === 'user' ? '🧑' : LOGO_SVG;

  const body = document.createElement('div');
  body.className = 'msg__body';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'user') {
    bubble.textContent = content;
    bubble.lang = 'ur';
    bubble.dir = 'rtl';
  } else {
    const parsed = extract(content);
    bubble.innerHTML = `<div class="md" dir="rtl" lang="ur">${renderMarkdown(parsed.body, {
      msgId: id,
      refs: parsed.refs,
    })}<span class="caret"></span></div>`;
    const refsHtml = renderRefs(parsed.refs, id);
    if (refsHtml) bubble.insertAdjacentHTML('beforeend', refsHtml);
  }

  body.appendChild(bubble);
  msg.appendChild(av);
  msg.appendChild(body);
  inner.appendChild(msg);

  scrollToBottom();
  return { msg, bubble };
}

export function addTools(inner, msgEl, { onRetry }) {
  const body = msgEl.querySelector('.msg__body');
  if (!body || body.querySelector('.msg__tools')) return;
  body.insertAdjacentHTML('beforeend', toolsHtml());
  const tools = body.querySelector('.msg__tools');
  tools.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const bubble = msgEl.querySelector('.bubble');
    const raw = msgEl.dataset.raw || bubble?.innerText || '';
    if (btn.dataset.act === 'copy') {
      try {
        await navigator.clipboard.writeText(toPlainText(raw));
        toast('کاپی ہو گیا');
      } catch (_) {
        toast('کاپی نہیں ہو سکا');
      }
    } else if (btn.dataset.act === 'retry') {
      onRetry?.(msgEl);
    } else if (btn.dataset.act === 'share') {
      const text = toPlainText(raw);
      if (navigator.share) {
        try {
          await navigator.share({ title: 'شیعہ اے آئی', text });
        } catch (_) {
          /* cancelled */
        }
      } else {
        try {
          await navigator.clipboard.writeText(text);
          toast('شیئر کے لیے کاپی ہو گیا');
        } catch (__) {
          toast('شیئر دستیاب نہیں');
        }
      }
    }
  });
}

/** Replace the content of an in-flight AI bubble (called on every chunk). */
export function updateAiMessage(msgEl, raw, { done = false } = {}) {
  const bubble = msgEl.querySelector('.bubble');
  if (!bubble) return;
  const id = msgEl.dataset.id || 'm';
  const parsed = extract(raw);

  const md = bubble.querySelector('.md');
  const html = renderMarkdown(parsed.body, { msgId: id, refs: parsed.refs });
  if (md) {
    md.innerHTML = done ? html : `${html}<span class="caret"></span>`;
  } else {
    bubble.innerHTML = `<div class="md" dir="rtl" lang="ur">${done ? html : `${html}<span class="caret"></span>`}</div>`;
  }

  const existing = bubble.querySelector('.refs');
  if (existing) existing.remove();
  const refsHtml = renderRefs(parsed.refs, id);
  if (refsHtml) bubble.insertAdjacentHTML('beforeend', refsHtml);

  msgEl.dataset.raw = raw;
  if (done) msgEl.dataset.refs = JSON.stringify(parsed.refs);
}

export function removeMessage(msgEl) {
  msgEl?.remove();
}

export function showThinking(inner) {
  const msg = document.createElement('div');
  msg.className = 'msg msg--ai';
  msg.innerHTML = `
    <div class="msg__av">${LOGO_SVG}</div>
    <div class="msg__body">
      <div class="bubble"><span class="thinking"><i></i><i></i><i></i></span></div>
    </div>`;
  inner.appendChild(msg);
  scrollToBottom();
  return msg;
}

export function showError(inner, { title, hint, onRetry, onChangeKey }) {
  const msg = document.createElement('div');
  msg.className = 'msg msg--ai';
  msg.innerHTML = `
    <div class="msg__av">${LOGO_SVG}</div>
    <div class="msg__body">
      <div class="bubble">
        <div class="err">
          <strong>${escapeHtml(title)}</strong>
          <div>${escapeHtml(hint || '')}</div>
          <div class="err__acts">
            <button class="btn btn--soft" data-act="retry" type="button">دوبارہ کوشش کریں</button>
            <button class="btn btn--ghost" data-act="key" type="button">API Key تبدیل کریں</button>
          </div>
        </div>
      </div>
    </div>`;
  msg.querySelector('[data-act="retry"]').addEventListener('click', () => {
    msg.remove();
    onRetry?.();
  });
  msg.querySelector('[data-act="key"]').addEventListener('click', () => onChangeKey?.());
  inner.appendChild(msg);
  scrollToBottom();
  return msg;
}

export function renderHistory(inner, messages) {
  messages.forEach((m, i) => {
    const id = `h${i}-${m.ts || i}`;
    const { msg } = addMessage(inner, { role: m.role, content: m.content, id });
    msg.dataset.raw = m.content;
    if (m.role === 'assistant') {
      msg.dataset.refs = JSON.stringify(extract(m.content).refs);
    }
  });
  scrollToBottom();
}

export function clearThread(threadEl) {
  threadEl.innerHTML = '';
}

/* ── Scroll follow / pause ───────────────────────────────────── */

const BOTTOM_PX = 56;
const scroll = { following: true, streaming: false, bound: false };

export const isAtBottom = (t) => t.scrollHeight - t.scrollTop - t.clientHeight <= BOTTOM_PX;

function syncScrollButton() {
  const t = qs('#thread');
  const btn = qs('#scroll-bottom');
  if (!t || !btn) return;
  // Show whenever the user is away from the end (paused or simply scrolled up).
  btn.hidden = isAtBottom(t);
}

/** Pause following (user touched / scrolled while an answer is streaming). */
function pauseFollow() {
  if (!scroll.streaming) return;
  scroll.following = false;
  syncScrollButton();
}

/** Resume following and jump to the newest content. */
export function resumeFollow({ smooth = true } = {}) {
  scroll.following = true;
  scrollToBottom(smooth, { force: true });
  // The jump happens on the next frame; re-check the button after it lands.
  requestAnimationFrame(() => syncScrollButton());
  syncScrollButton();
}

/** Attach the pause / resume behaviour once. */
export function initScrollGuard() {
  const t = qs('#thread');
  const btn = qs('#scroll-bottom');
  if (!t || scroll.bound) return;
  scroll.bound = true;

  const pause = () => pauseFollow();
  t.addEventListener('touchstart', pause, { passive: true });
  t.addEventListener('touchmove', pause, { passive: true });
  t.addEventListener('wheel', pause, { passive: true });
  t.addEventListener('pointerdown', pause, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'ArrowUp', 'Home', ' '].includes(e.key) && document.activeElement !== qs('#input')) pauseFollow();
  });

  t.addEventListener(
    'scroll',
    () => {
      // Only a return to the bottom re-enables following; programmatic scrolls
      // land at the bottom anyway, so they never turn the pause off by mistake.
      if (isAtBottom(t)) scroll.following = true;
      syncScrollButton();
    },
    { passive: true }
  );

  btn?.addEventListener('click', () => resumeFollow({ smooth: true }));
}

export function setStreaming(on) {
  scroll.streaming = !!on;
  if (on) scroll.following = true;
  syncScrollButton();
}

/** Called on every streamed chunk: keep the newest text in view if following. */
export function followIfNeeded() {
  const t = qs('#thread');
  if (!t || !scroll.following) return;
  try {
    t.scrollTo({ top: t.scrollHeight, behavior: 'instant' });
  } catch (_) {
    t.scrollTop = t.scrollHeight;
  }
  syncScrollButton();
}

export function scrollToBottom(smooth = true, { force = false } = {}) {
  const t = qs('#thread');
  if (!t) return;
  if (!force && !scroll.following) return;
  requestAnimationFrame(() => {
    if (typeof t.scrollTo === 'function') {
      try {
        t.scrollTo({ top: t.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
        return;
      } catch (_) {
        /* fall through */
      }
    }
    t.scrollTop = t.scrollHeight;
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
