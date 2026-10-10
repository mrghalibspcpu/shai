/**
 * SHAI · Chat thread rendering + streaming
 */

import { renderMarkdown, toPlainText } from '../lib/markdown.js';
import { extract, renderRefs, setCitationContext } from '../lib/citations.js';
import { LOGO_SVG, qs, toast } from '../lib/dom.js';

const SUGGESTIONS = [
  'نمازِ شب کی فضیلت کیا ہے؟',
  'حدیثِ ثقلین کی تشریح',
  'امام مہدی عجل اللہ فرجہ کی غیبت پر مستند روایات',
  'زیارتِ عاشورا کی سند اور فضیلت',
  'روزہ دار کے لیے احادیث',
  'اہل بیت ؑ سے محبت کی علامات',
];

export function renderWelcome(threadEl) {
  const wrap = document.createElement('div');
  wrap.className = 'welcome';
  wrap.innerHTML = `
    <div class="welcome__logo">${LOGO_SVG}</div>
    <h2 class="welcome__title">السلام علیکم — میں <em>SHAI</em> ہوں</h2>
    <p class="welcome__desc">
      میں آپ کے سوال کا جواب مستند شیعی احادیث، قرآنی آیات اور ادعیہ کی روشنی میں
      آسان اور خوبصورت اردو میں دیتا ہوں — ہر بات کے ساتھ
      <b>Thaqalayn</b> کا براہِ راست حوالہ۔
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
          await navigator.share({ title: 'SHAI', text });
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
    // Each saved answer carries the sources it was grounded on; restore them
    // so its citations resolve the same way they did live.
    setCitationContext(m.sources?.length ? new Map(m.sources) : null);
    const { msg } = addMessage(inner, { role: m.role, content: m.content, id });
    msg.dataset.raw = m.content;
    if (m.role === 'assistant') {
      msg.dataset.refs = JSON.stringify(extract(m.content).refs);
    }
  });
  setCitationContext(null);
  scrollToBottom();
}

export function clearThread(threadEl) {
  threadEl.innerHTML = '';
}

export function scrollToBottom(smooth = true) {
  const t = qs('#thread');
  if (!t) return;
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
