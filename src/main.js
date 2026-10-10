/**
 * SHAI · Shia Hadith AI — application entry
 */

import './styles/main.css';

import { buildSystemInstruction } from './lib/prompt.js';
import { streamGenerate, friendlyError, normaliseKey } from './lib/gemini.js';
import { extract, setCitationContext } from './lib/citations.js';
import { prepareTurn } from './lib/grounded.js';
import { qs, qsa, on, toast, sleep, openExternal } from './lib/dom.js';
import {
  getSettings,
  setSettings,
  getApiKey,
  setApiKey,
  getConversations,
  setConversations,
  getActiveId,
  setActiveId,
  DEFAULT_SETTINGS,
} from './lib/storage.js';
import { initOnboarding } from './ui/onboarding.js';
import { initSettings } from './ui/settings.js';
import { initSources } from './ui/sources.js';
import {
  renderWelcome,
  ensureInner,
  addMessage,
  addTools,
  updateAiMessage,
  removeMessage,
  showThinking,
  showError,
  renderHistory,
  clearThread,
  scrollToBottom,
  escapeHtml,
} from './ui/chat.js';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Must match --urdu-size in src/styles/tokens.css */
const DEFAULT_FONT_SIZE = 19;

/* ── App state ───────────────────────────────────────────────── */
const state = {
  settings: { ...DEFAULT_SETTINGS },
  apiKey: '',
  conversations: [],
  activeId: null,
  busy: false,
  controller: null,
};

/* ── Theme / typography ──────────────────────────────────────── */
function applySettings(s = state.settings) {
  state.settings = { ...state.settings, ...s };
  const root = document.documentElement;
  root.dataset.script = state.settings.script || 'nastaleeq';
  // Only pin the size when the user moved the slider — otherwise leave the
  // responsive :root value (and its small-screen media query) in charge.
  const size = Number(state.settings.fontSize);
  if (!size || size === DEFAULT_FONT_SIZE) root.style.removeProperty('--urdu-size');
  else root.style.setProperty('--urdu-size', `${size}px`);
  const name = qs('#model-name');
  if (name) name.textContent = state.settings.model || 'gemini-2.5-flash';
}

/** Warm the Nastaleeq face in the background; never block first paint. */
async function warmFonts() {
  if (state.settings.script !== 'nastaleeq') return;
  if (!('fonts' in document)) return;
  try {
    await Promise.race([
      document.fonts.load("1em 'Jameel Noori Nastaleeq'"),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
    document.documentElement.classList.add('fonts-ready');
  } catch (_) {
    /* fallback stack stays in place */
  }
}

/* ── Conversation helpers ────────────────────────────────────── */

function current() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function titleFrom(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || 'نئی گفتگو';
}

async function persist() {
  await setConversations(state.conversations);
}

function renderSidebar() {
  const list = qs('#conv-list');
  if (!list) return;
  const sorted = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!sorted.length) {
    list.innerHTML = `<p style="padding:10px 12px;color:var(--faint);font-size:14px;line-height:1.8;">
      ابھی کوئی گفتگو محفوظ نہیں۔</p>`;
    return;
  }
  list.innerHTML = sorted
    .map(
      (c) => `
      <div class="conv ${c.id === state.activeId ? 'is-active' : ''}" data-id="${c.id}" role="button" tabindex="0">
        <span class="conv__title">${escapeHtml(c.title || 'نئی گفتگو')}</span>
        <button class="conv__del" type="button" data-del="${c.id}" aria-label="حذف کریں">✕</button>
      </div>`
    )
    .join('');

  qsa('.conv', list).forEach((el) => {
    el.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        deleteConversation(del.dataset.del);
        return;
      }
      openConversation(el.dataset.id);
    });
  });
}

async function newConversation({ render = true } = {}) {
  state.activeId = uid();
  await setActiveId(state.activeId);
  if (render) {
    clearThread(qs('#thread'));
    renderWelcome(qs('#thread'));
    renderSidebar();
    qs('#input')?.focus();
  }
}

async function openConversation(id) {
  state.activeId = id;
  await setActiveId(id);
  const conv = current();
  clearThread(qs('#thread'));
  if (!conv || !conv.messages?.length) {
    renderWelcome(qs('#thread'));
  } else {
    renderHistory(ensureInner(qs('#thread')), conv.messages);
  }
  renderSidebar();
  closeSidebar();
  qs('#input')?.focus();
}

async function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  await persist();
  if (state.activeId === id) {
    const next = [...state.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (next) await openConversation(next.id);
    else await newConversation();
  } else {
    renderSidebar();
  }
  toast('گفتگو حذف ہو گئی');
}

async function touchConversation(title) {
  let conv = current();
  if (!conv) {
    conv = { id: state.activeId || uid(), title: 'نئی گفتگو', messages: [], updatedAt: Date.now() };
    state.activeId = conv.id;
    state.conversations.push(conv);
    await setActiveId(conv.id);
  }
  if (title) conv.title = title;
  conv.updatedAt = Date.now();
  await persist();
  renderSidebar();
  return conv;
}

/* ── Sidebar (mobile) ────────────────────────────────────────── */
function openSidebar() {
  qs('#sidebar')?.classList.add('is-open');
  const s = qs('#scrim');
  if (s) s.hidden = false;
}
function closeSidebar() {
  qs('#sidebar')?.classList.remove('is-open');
  const s = qs('#scrim');
  if (s) s.hidden = true;
}

/* ── Sending ─────────────────────────────────────────────────── */

function historyFor(conv) {
  return (conv?.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      content: m.content,
    }));
}

async function run(question, { retryFrom = null } = {}) {
  if (state.busy) return;
  // No key is fine: the turn falls back to retrieval-only (see grounded.js).
  const key = normaliseKey(await getApiKey());

  const thread = qs('#thread');
  const inner = ensureInner(thread);
  const conv = await touchConversation(retryFrom ? current()?.title : titleFrom(question));

  // Snapshot the history BEFORE the new question is appended — the question is
  // sent separately as `message`, so it must not appear twice.
  const history = historyFor(conv);

  if (!retryFrom) {
    conv.messages.push({ role: 'user', content: question, ts: Date.now() });
    addMessage(inner, { role: 'user', content: question, id: `u${Date.now()}` });
    await persist();
  } else {
    // Drop everything after (and including) the previous assistant reply.
    const idx = conv.messages.findIndex((m) => m.ts === retryFrom);
    if (idx >= 0) conv.messages = conv.messages.slice(0, idx);
    qsa('.msg--ai', inner).forEach((el) => {
      if (el.dataset.ts === String(retryFrom)) el.remove();
    });
    await persist();
  }

  const thinking = showThinking(inner);
  const pill = qs('#model-pill');
  pill?.classList.add('is-busy');

  state.busy = true;
  state.controller = new AbortController();
  setSendState(true);

  const msgId = `a${Date.now()}`;
  let raw = '';
  let aiEl = null;

  let turn = null;
  try {
    turn = await prepareTurn(question, {
      apiKey: key,
      model: state.settings.model,
      signal: state.controller.signal,
    });
    // Only the sources retrieved for this turn may be cited (see citations.js).
    setCitationContext(turn.contextMap);

    const stream =
      turn.mode === 'local'
        ? (async function* localReply() {
            yield turn.body;
          })()
        : streamGenerate({
            apiKey: key,
            model: state.settings.model,
            system: buildSystemInstruction(state.settings),
            history,
            message: turn.message,
            signal: state.controller.signal,
          });

    let first = true;
    for await (const chunk of stream) {
      if (state.controller.signal.aborted) break;
      raw += chunk;
      if (first) {
        thinking.remove();
        aiEl = addMessage(inner, { role: 'assistant', content: raw, id: msgId }).msg;
        aiEl.dataset.ts = String(Date.now());
        first = false;
      } else {
        updateAiMessage(aiEl, raw);
      }
      maybeAutoScroll();
    }
  } catch (err) {
    thinking.remove();
    if (aiEl) removeMessage(aiEl);
    const info = String(err?.message || '').startsWith('library:')
      ? { title: 'ڈیٹا لوڈ نہیں ہوا', hint: 'لائبریری کی فائلیں نہیں ملیں۔ npm run build:library چلائیں۔' }
      : friendlyError(err);
    showError(inner, {
      title: info.title,
      hint: info.hint,
      onRetry: () => run(question, { retryFrom: null }),
      onChangeKey: () => settingsUi?.open(),
    });
    state.busy = false;
    setSendState(false);
    pill?.classList.remove('is-busy');
    return;
  }

  thinking.remove();
  if (!aiEl) {
    // No text arrived at all
    showError(inner, {
      title: 'خالی جواب',
      hint: 'ماڈل نے کوئی متن نہیں لکھا — دوبارہ کوشش کریں۔',
      onRetry: () => run(question),
      onChangeKey: () => settingsUi?.open(),
    });
  } else {
    updateAiMessage(aiEl, raw, { done: true });
    addTools(inner, aiEl, {
      onRetry: () => run(question, { retryFrom: aiEl.dataset.ts }),
    });
    const refs = extract(raw).refs;
    conv.messages.push({ role: 'assistant', content: raw, ts: Date.now(), refs, sources: turn?.sources || [] });
    await persist();
  }

  state.busy = false;
  state.controller = null;
  setSendState(false);
  pill?.classList.remove('is-busy');
  scrollToBottom();
}

function maybeAutoScroll() {
  const t = qs('#thread');
  if (!t) return;
  const dist = t.scrollHeight - t.scrollTop - t.clientHeight;
  if (dist < 320) t.scrollTop = t.scrollHeight;
}

function setSendState(busy) {
  const send = qs('#btn-send');
  const stop = qs('#btn-stop');
  const input = qs('#input');
  if (send) send.hidden = busy;
  if (stop) stop.hidden = !busy;
  if (input) input.disabled = false;
}

function stop() {
  state.controller?.abort();
  state.busy = false;
  setSendState(false);
  qs('#model-pill')?.classList.remove('is-busy');
  toast('روک دیا گیا');
}

/* ── Export ──────────────────────────────────────────────────── */
function exportCurrent() {
  const conv = current();
  if (!conv || !conv.messages.length) {
    toast('برآمد کرنے کے لیے کوئی گفتگو نہیں');
    return;
  }
  const lines = [
    `# ${conv.title}`,
    '',
    `_SHAI · ${new Date(conv.updatedAt || Date.now()).toLocaleString()}_`,
    '',
  ];
  for (const m of conv.messages) {
    lines.push(m.role === 'user' ? `## سوال` : `## جواب`, '', m.content, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shai-${conv.title.slice(0, 30).replace(/[^\wء-ی]+/g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('محفوظ ہو گیا');
}

/* ── Boot ────────────────────────────────────────────────────── */

let onboarding = null;
let settingsUi = null;
let sourcesUi = null;

async function boot() {
  state.settings = await getSettings();
  state.apiKey = await getApiKey();
  state.conversations = await getConversations();
  state.activeId = await getActiveId();

  applySettings(state.settings);

  // Splash → app
  await sleep(650);
  qs('#splash')?.classList.add('is-hidden');
  const app = qs('#app');
  if (app) app.hidden = false;
  setTimeout(() => qs('#splash')?.remove(), 700);

  // Wire up UI modules
  onboarding = initOnboarding({
    onReady: async ({ model, models }) => {
      state.apiKey = await getApiKey();
      state.settings = await getSettings();
      state.settings.model = model;
      state.settings.availableModels = models?.map((m) => m.name);
      applySettings(state.settings);
      await setSettings(state.settings);
      qs('#input')?.focus();
    },
  });

  settingsUi = initSettings({
    onChange: (s) => applySettings(s),
    onChangeKey: async (k) => {
      state.apiKey = k;
      if (!k) onboarding?.open();
    },
    onWipe: () => {},
  });

  sourcesUi = initSources();

  // Notice
  if (state.settings.noticeDismissed) qs('#notice')?.classList.add('is-hidden');
  on(qs('#notice-x'), 'click', async () => {
    qs('#notice')?.classList.add('is-hidden');
    state.settings.noticeDismissed = true;
    await setSettings(state.settings);
  });

  // Topbar
  on(qs('#btn-menu'), 'click', () => {
    if (qs('#sidebar').classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  on(qs('#scrim'), 'click', closeSidebar);
  on(qs('#btn-new-chat'), 'click', () => newConversation());
  on(qs('#btn-settings'), 'click', () => settingsUi.open());
  on(qs('#btn-sources'), 'click', () => sourcesUi.open());
  on(qs('#model-pill'), 'click', () => settingsUi.open());
  on(qs('#btn-export'), 'click', exportCurrent);
  on(qs('#btn-clear'), 'click', async () => {
    if (!confirm('موجودہ گفتگو صاف کر دیں؟')) return;
    const conv = current();
    if (conv) {
      conv.messages = [];
      conv.title = 'نئی گفتگو';
      await persist();
    }
    clearThread(qs('#thread'));
    renderWelcome(qs('#thread'));
    renderSidebar();
  });

  // Composer
  const input = qs('#input');
  const autosize = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  };
  on(input, 'input', autosize);
  on(input, 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  on(qs('#btn-send'), 'click', submit);
  on(qs('#btn-stop'), 'click', stop);

  // Suggestion chips
  on(window, 'shai:suggest', (e) => {
    if (input) input.value = e.detail;
    autosize();
    input?.focus();
    submit();
  });

  // Links inside the thread open in the in-app browser when native
  on(qs('#thread'), 'click', async (e) => {
    const a = e.target.closest('a[href^="http"]');
    if (!a) return;
    const isNativeCap = window.Capacitor?.isNativePlatform?.();
    if (!isNativeCap) return; // default browser behaviour is fine on web
    if (a.target === '_blank') {
      e.preventDefault();
      await openExternal(a.href);
    }
  });

  // Restore or start a conversation
  const conv = current();
  if (conv && conv.messages?.length) renderHistory(ensureInner(qs('#thread')), conv.messages);
  else renderWelcome(qs('#thread'));
  renderSidebar();

  qs('#build-tag').textContent = `SHAI v1.0.0 · ${state.settings.model}`;

  // Android hardware back button
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      const overlay = qsa('.overlay').find((o) => !o.hidden);
      if (overlay) {
        overlay.hidden = true;
        return;
      }
      if (qs('#sidebar')?.classList.contains('is-open')) {
        closeSidebar();
        return;
      }
      if (canGoBack) history.back();
      else App.exitApp?.();
    });
  } catch (_) {
    /* web */
  }

  // First run?
  if (!state.apiKey) {
    setTimeout(() => onboarding.open(), 400);
  } else {
    qs('#input')?.focus();
  }

  warmFonts();
}

function submit() {
  const input = qs('#input');
  const text = (input?.value || '').trim();
  if (!text || state.busy) return;
  input.value = '';
  input.style.height = 'auto';
  run(text);
}

boot().catch((err) => {
  console.error('[SHAI] boot failed', err);
  qs('#splash')?.classList.add('is-hidden');
  const app = qs('#app');
  if (app) app.hidden = false;
});
