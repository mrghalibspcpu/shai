/* SHAI - شیعہ حدیث AI
 * Static, offline-capable reader for Shia hadith collections.
 * No backend: data lives in data/*.json.gz and is cached by the service worker.
 */
(() => {
  'use strict';

  const VIEW = document.getElementById('view');
  const DATA = 'data/';
  const PAGE = 40;
  const KEY_BM = 'shai.bookmarks';
  const KEY_SET = 'shai.settings';
  const KEY_NOTICE = 'shai.notice.v1';

  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? def : JSON.parse(v);
      } catch (_) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* storage full / private mode */ }
    }
  };

  let settings = Object.assign({ font: 22, theme: 'light' }, store.get(KEY_SET, {}));
  let bookmarks = store.get(KEY_BM, []);
  let indexData = null;
  const bookCache = new Map();
  const hadithCtx = new Map(); // id -> { h, book, bookName, ci, num }
  let routeId = 0;
  let deferredInstall = null;

  /* ---------- helpers ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const urNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

  // Normalise Arabic/Urdu text for search: strip diacritics & tatweel, unify letter forms.
  function norm(s) {
    return String(s || '')
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C\u200D]/g, '')
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/[ىي]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[هة]/g, 'ہ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  const chapterName = (c, i) => (c.title && (c.title.ar || c.title.ur || c.title.en)) || `باب ${urNum(i + 1)}`;
  const refOf = (id) => id.split(':').slice(1).join(':');

  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--fs', settings.font + 'px');
  }

  function setTab(name) {
    document.querySelectorAll('.tabbar a').forEach((a) =>
      a.classList.toggle('active', a.dataset.tab === name));
  }

  const loader = (msg = 'لوڈ ہو رہا ہے…') => `<div class="loader">${esc(msg)}</div>`;

  function showError(err) {
    VIEW.innerHTML = `<div class="card error">
      <p>کچھ مسئلہ ہوا: ${esc(err && err.message ? err.message : err)}</p>
      <p class="muted">انٹرنیٹ چیک کریں اور دوبارہ کوشش کریں۔</p>
      <button data-action="retry">دوبارہ کوشش کریں</button></div>`;
  }

  /* ---------- data ---------- */

  async function readGz(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ڈیٹا نہیں ملا (HTTP ${res.status})`);
    const enc = (res.headers.get('content-encoding') || '').toLowerCase();
    if (enc.includes('gzip')) return res.json(); // server already decoded it
    if (!('DecompressionStream' in window)) {
      throw new Error('یہ براؤزر نیا نہیں ہے؛ براہِ کرم Chrome یا Safari کو اپڈیٹ کریں');
    }
    return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
  }

  async function getIndex() {
    if (!indexData) {
      const res = await fetch(DATA + 'index.json');
      if (!res.ok) throw new Error('کتابوں کی فہرست نہیں ملی');
      indexData = await res.json();
    }
    return indexData;
  }

  function getBook(id) {
    if (!bookCache.has(id)) {
      const p = readGz(`${DATA}${encodeURIComponent(id)}.json.gz`).catch((e) => {
        bookCache.delete(id);
        throw e;
      });
      bookCache.set(id, p);
    }
    return bookCache.get(id);
  }

  /* ---------- routing ---------- */

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, query = ''] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch (_) { return p; }
    });
    return { parts, params: new URLSearchParams(query) };
  }

  async function route() {
    const { parts, params } = parseRoute();
    const [head, a, b] = parts;
    try {
      if (!head || head === 'books') { setTab('books'); return await renderBooks(); }
      if (head === 'book' && a) {
        setTab('books');
        return b === undefined ? await renderBook(a) : await renderChapter(a, Number(b));
      }
      if (head === 'search') { setTab('search'); return await renderSearch(params.get('q') || '', params.get('b') || 'all'); }
      if (head === 'bookmarks') { setTab('bm'); return await renderBookmarks(); }
      if (head === 'about') { setTab('about'); return await renderAbout(); }
      VIEW.innerHTML = `<div class="empty">یہ صفحہ نہیں ملا۔ <a href="#/books">ہوم پر جائیں</a></div>`;
    } catch (err) {
      showError(err);
    }
  }

  /* ---------- views ---------- */

  async function renderBooks() {
    const my = ++routeId;
    VIEW.innerHTML = loader();
    const idx = await getIndex();
    if (my !== routeId) return;
    const noticeHidden = store.get(KEY_NOTICE, false);
    VIEW.innerHTML = `
      ${noticeHidden ? '' : `<div class="notice" role="note">
        <strong>اہم:</strong> اردو ترجمے اور خلاصے AI سے تیار کیے گئے ہیں۔ دینی مسائل میں مستند علماء سے رجوع کریں۔
        <br><button data-action="dismiss-notice">سمجھ گیا</button></div>`}
      <section class="hero">
        <h1>شیعہ حدیث AI</h1>
        <p>معتبر شیعہ کتب کا مطالعہ، تلاش اور بُک مارک، اردو اور عربی متن کے ساتھ۔</p>
        <form class="search-form" data-search-form>
          <input name="q" type="search" placeholder="اردو یا عربی میں تلاش کریں…" required>
          <input type="hidden" name="b" value="all">
          <button type="submit">تلاش</button>
        </form>
      </section>
      <div class="grid">
        ${idx.books.map((b) => `
          <a class="card book" href="#/book/${esc(b.id)}">
            <div class="book-ar">${esc(b.title.ar)}</div>
            <div class="book-ur">${esc(b.title.ur)}</div>
            <div class="meta">${urNum(b.hadith_count.toLocaleString('en-US'))} احادیث · ${urNum(b.chapter_count)} ابواب</div>
          </a>`).join('')}
      </div>`;
  }

  async function renderBook(id) {
    const my = ++routeId;
    VIEW.innerHTML = loader();
    const book = await getBook(id);
    if (my !== routeId) return;
    const count = book.chapters.reduce((n, c) => n + c.hadith.length, 0);
    VIEW.innerHTML = `
      <nav class="crumb"><a href="#/books">کتابیں</a> / <span>${esc(book.title.ur || book.title.en)}</span></nav>
      <header class="page-head">
        <h1 class="ar-title">${esc(book.title.ar)}</h1>
        <h2>${esc(book.title.ur)}</h2>
        <p class="muted">${urNum(count.toLocaleString('en-US'))} احادیث · ${urNum(book.chapters.length)} ابواب</p>
      </header>
      <input class="filter" type="search" placeholder="ابواب میں تلاش…" data-filter aria-label="ابواب میں تلاش">
      <ol class="chapters" data-chapters>
        ${book.chapters.map((c, i) => `
          <li data-text="${esc(norm([c.title.ar, c.title.ur, c.title.en, `باب ${i + 1}`].filter(Boolean).join(' ')))}">
            <a href="#/book/${esc(id)}/${i}">
              <span class="ch-title">${esc(chapterName(c, i))}</span>
              <small>${urNum(c.hadith.length)}</small>
            </a>
          </li>`).join('')}
      </ol>`;
  }

  async function renderChapter(id, ci) {
    const my = ++routeId;
    VIEW.innerHTML = loader();
    const book = await getBook(id);
    if (my !== routeId) return;
    const c = book.chapters[ci];
    if (!c) throw new Error('باب نہیں ملا');
    const bookName = book.title.ur || book.title.en;
    VIEW.innerHTML = `
      <nav class="crumb"><a href="#/books">کتابیں</a> / <a href="#/book/${esc(id)}">${esc(bookName)}</a> / <span>${esc(chapterName(c, ci))}</span></nav>
      <header class="page-head">
        <h1>${esc(chapterName(c, ci))}</h1>
        ${c.title && c.title.ur ? `<h2>${esc(c.title.ur)}</h2>` : ''}
        <p class="muted">${urNum(c.hadith.length)} احادیث</p>
      </header>
      <div class="paged"></div>`;
    const ctxBase = { book: id, bookName, ci, label: chapterName(c, ci) };
    mountPaged(VIEW.querySelector('.paged'), c.hadith.map((h, k) => ({ h, ...ctxBase, num: k + 1 })));
    if (ci > 0 || ci < book.chapters.length - 1) {
      // Prev / next chapter navigation
      const nav = document.createElement('div');
      nav.className = 'paged-nav';
      nav.style.cssText = 'display:flex;gap:8px;justify-content:space-between;margin-top:8px';
      nav.innerHTML = `
        ${ci < book.chapters.length - 1 ? `<a class="btn" href="#/book/${esc(id)}/${ci + 1}">اگلا باب ←</a>` : '<span></span>'}
        ${ci > 0 ? `<a class="btn" href="#/book/${esc(id)}/${ci - 1}">→ پچھلا باب</a>` : '<span></span>'}`;
      VIEW.appendChild(nav);
    }
  }

  function cardHTML(item) {
    const { h, book, bookName, ci, num } = item;
    hadithCtx.set(h.id, item);
    const saved = bookmarks.some((b) => b.id === h.id);
    return `
      <article class="card hadith" data-id="${esc(h.id)}">
        <div class="hd">
          ${num != null ? `<span class="num">${urNum(num)}</span>` : ''}
          <span class="bk">${esc(bookName || '')}</span>
          <span class="ref">${esc(refOf(h.id))}</span>
          <button class="icon ${saved ? 'on' : ''}" data-action="bm" data-id="${esc(h.id)}"
            aria-pressed="${saved}" aria-label="بُک مارک">${saved ? '★' : '☆'}</button>
        </div>
        ${h.ar ? `<p class="ar" lang="ar">${esc(h.ar)}</p>` : ''}
        ${h.ur ? `<p class="ur" lang="ur">${esc(h.ur)}</p>` : ''}
        ${h.s ? `<details class="sum"><summary>خلاصہ</summary><p class="ur">${esc(h.s)}</p></details>` : ''}
        <div class="ft">
          ${book ? `<a href="#/book/${esc(book)}/${ci}">باب دیکھیں</a>` : ''}
          <button data-action="copy" data-id="${esc(h.id)}">کاپی</button>
          <button data-action="share" data-id="${esc(h.id)}">شیئر</button>
        </div>
      </article>`;
  }

  // Renders items in pages of PAGE to keep the DOM light on phones.
  function mountPaged(container, items) {
    container.innerHTML = `<div class="list"></div><div class="more-wrap"></div>`;
    const list = container.querySelector('.list');
    const state = { items, n: 0 };
    container._state = state;
    if (!items.length) {
      list.innerHTML = `<div class="empty">کوئی حدیث نہیں ملی۔</div>`;
      return;
    }
    appendPage(container);
  }

  function appendPage(container) {
    const state = container._state;
    const list = container.querySelector('.list');
    const next = state.items.slice(state.n, state.n + PAGE);
    list.insertAdjacentHTML('beforeend', next.map(cardHTML).join(''));
    state.n += next.length;
    const more = container.querySelector('.more-wrap');
    more.innerHTML = state.n < state.items.length
      ? `<button class="more" data-action="more">مزید دکھائیں (${urNum(state.n)} / ${urNum(state.items.length)})</button>`
      : '';
  }

  async function renderSearch(q, scope) {
    const my = ++routeId;
    const idx = await getIndex();
    if (my !== routeId) return;
    VIEW.innerHTML = `
      <header class="page-head"><h1>تلاش</h1><p class="muted">اردو یا عربی متن میں تلاش کریں</p></header>
      <form class="search-form" data-search-form>
        <input name="q" type="search" value="${esc(q)}" placeholder="لفظ یا جملہ لکھیں…" required>
        <select name="b" aria-label="کتاب منتخب کریں">
          <option value="all">تمام کتب</option>
          ${idx.books.map((b) => `<option value="${esc(b.id)}">${esc(b.title.ur)}</option>`).join('')}
        </select>
        <button type="submit">تلاش</button>
      </form>
      <div class="status" id="sr-status"></div>
      <div class="paged" id="sr-results"></div>`;
    VIEW.querySelector('select[name="b"]').value = scope;
    const status = (msg) => { const el = document.getElementById('sr-status'); if (el) el.textContent = msg; };
    const qn = norm(q);
    if (!qn) { status('کچھ لکھ کر تلاش کریں۔'); return; }

    const targets = scope === 'all' ? idx.books : idx.books.filter((b) => b.id === scope);
    const LIMIT = 500;
    const results = [];
    for (let bi = 0; bi < targets.length && results.length < LIMIT; bi++) {
      const meta = targets[bi];
      status(`تلاش جاری ہے… (${urNum(bi + 1)}/${urNum(targets.length)}) ${meta.title.ur}`);
      const book = await getBook(meta.id);
      if (my !== routeId) return;
      const bookName = book.title.ur || book.title.en;
      for (let ci = 0; ci < book.chapters.length && results.length < LIMIT; ci++) {
        const c = book.chapters[ci];
        for (let k = 0; k < c.hadith.length; k++) {
          const h = c.hadith[k];
          if (norm(h.ur + ' ' + h.ar + ' ' + (h.s || '')).includes(qn)) {
            results.push({ h, book: meta.id, bookName, ci, label: chapterName(c, ci), num: null });
            if (results.length >= LIMIT) break;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
    if (my !== routeId) return;
    status(results.length
      ? `${urNum(results.length)} نتائج${results.length >= LIMIT ? ' (پہلے ' + urNum(LIMIT) + ')' : ''}`
      : 'کوئی نتیجہ نہیں ملا۔');
    mountPaged(document.getElementById('sr-results'), results);
  }

  async function renderBookmarks() {
    const my = ++routeId;
    VIEW.innerHTML = `<header class="page-head"><h1>محفوظ احادیث</h1><p class="muted">★ کے نشان والی احادیث یہاں نظر آئیں گی</p></header><div class="paged"></div>`;
    if (my !== routeId) return;
    const idx = await getIndex();
    const names = Object.fromEntries(idx.books.map((b) => [b.id, b.title.ur]));
    const items = bookmarks.map((b) => ({
      h: { id: b.id, ar: b.ar, ur: b.ur, s: b.s },
      book: b.book, bookName: names[b.book] || b.book, ci: b.ci, label: '', num: null
    }));
    if (!items.length) {
      VIEW.querySelector('.paged').innerHTML = `<div class="empty">ابھی کوئی حدیث محفوظ نہیں کی گئی۔<br>کسی حدیث پر ☆ دبائیں۔</div>`;
      return;
    }
    mountPaged(VIEW.querySelector('.paged'), items);
  }

  async function renderAbout() {
    const my = ++routeId;
    const idx = await getIndex();
    if (my !== routeId) return;
    const total = idx.books.reduce((n, b) => n + b.hadith_count, 0);
    VIEW.innerHTML = `
      <header class="page-head"><h1>ایپ کے بارے میں</h1></header>
      <div class="card">
        <h3>SHAI - شیعہ حدیث AI</h3>
        <p>اس ایپ میں ${urNum(idx.books.length)} معتبر شیعہ کتب کی ${urNum(total.toLocaleString('en-US'))} احادیث عربی اور اردو ترجمے کے ساتھ موجود ہیں۔ ایپ آف لائن بھی کام کرتی ہے۔</p>
        <p><strong>ماخذ:</strong> <a href="https://github.com/narmafraz/ThaqalaynData" target="_blank" rel="noopener">ThaqalaynData</a> (CC0 - عوامی ملکیت)۔</p>
        <p><strong>اہم:</strong> اردو ترجمے اور خلاصے AI سے تیار کیے گئے ہیں اور ان کی مکمل تصدیق نہیں ہوئی۔ عربی متن کو ہی بنیادی حوالہ سمجھیں اور شرعی مسائل میں مستند علماء سے رجوع کریں۔</p>
      </div>
      <div class="card">
        <h3>ترتیبات</h3>
        <div class="setting">
          <label for="font-size">متن کا سائز</label>
          <input id="font-size" type="range" min="16" max="34" step="1" value="${settings.font}" data-setting="font">
        </div>
        <div class="setting">
          <span>تھیم</span>
          <button class="btn" data-action="theme">${settings.theme === 'dark' ? 'روشن تھیم' : 'گہری تھیم'}</button>
        </div>
      </div>
      <div class="card">
        <h3>موبائل پر انسٹال کریں</h3>
        <div class="setting">
          <span>ہوم اسکرین پر شامل کریں</span>
          <button class="btn" data-action="install">انسٹال</button>
        </div>
        <p id="install-help" class="muted">
          Android (Chrome): مینو (⋮) → "Install app" یا "Add to Home screen"۔<br>
          iPhone (Safari): شیئر (↑) → "Add to Home Screen"۔
        </p>
      </div>`;
  }

  /* ---------- actions ---------- */

  function isSaved(id) { return bookmarks.some((b) => b.id === id); }

  function toggleBookmark(id) {
    const i = bookmarks.findIndex((b) => b.id === id);
    if (i >= 0) {
      bookmarks.splice(i, 1);
      toast('بُک مارک ہٹا دیا گیا');
    } else {
      const ctx = hadithCtx.get(id);
      if (!ctx) return;
      bookmarks.unshift({ id, book: ctx.book, ci: ctx.ci, ar: ctx.h.ar, ur: ctx.h.ur, s: ctx.h.s || '', at: Date.now() });
      toast('بُک مارک محفوظ ہو گیا');
    }
    store.set(KEY_BM, bookmarks);
    document.querySelectorAll(`.hadith[data-id="${CSS.escape(id)}"] button[data-action="bm"]`).forEach((btn) => {
      const on = isSaved(id);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '★' : '☆';
    });
    if (parseRoute().parts[0] === 'bookmarks') route();
  }

  function hadithText(id) {
    const ctx = hadithCtx.get(id);
    if (!ctx) return '';
    const { h, bookName } = ctx;
    return [h.ur, h.ar, `— ${bookName} (${refOf(h.id)})`].filter(Boolean).join('\n\n');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (__) { /* ignore */ }
      ta.remove();
    }
    toast('کاپی ہو گیا');
  }

  async function shareText(id) {
    const text = hadithText(id);
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'SHAI - شیعہ حدیث AI', text }); return; }
      catch (_) { /* user cancelled or unsupported: fall through to copy */ }
    }
    copyText(text);
  }

  function setTheme(t) {
    settings.theme = t;
    store.set(KEY_SET, settings);
    applySettings();
  }

  /* ---------- events ---------- */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'bm') toggleBookmark(el.dataset.id);
    else if (action === 'copy') copyText(hadithText(el.dataset.id));
    else if (action === 'share') shareText(el.dataset.id);
    else if (action === 'more') appendPage(el.closest('.paged'));
    else if (action === 'retry') route();
    else if (action === 'dismiss-notice') { store.set(KEY_NOTICE, true); const n = el.closest('.notice'); if (n) n.remove(); }
    else if (action === 'theme') { setTheme(settings.theme === 'dark' ? 'light' : 'dark'); if (parseRoute().parts[0] === 'about') route(); }
    else if (action === 'install') {
      if (deferredInstall) {
        deferredInstall.prompt();
        deferredInstall.userChoice.finally(() => { deferredInstall = null; });
      } else {
        toast('براؤزر مینو سے "Add to Home screen" چنیں');
      }
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-search-form]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    const q = String(fd.get('q') || '').trim();
    const b = String(fd.get('b') || 'all');
    if (!q) return;
    location.hash = `#/search?q=${encodeURIComponent(q)}&b=${encodeURIComponent(b)}`;
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-filter]')) {
      const q = norm(e.target.value);
      document.querySelectorAll('[data-chapters] > li').forEach((li) => {
        li.hidden = q !== '' && !li.dataset.text.includes(q);
      });
    } else if (e.target.matches('[data-setting="font"]')) {
      settings.font = Number(e.target.value);
      store.set(KEY_SET, settings);
      applySettings();
    }
  });

  window.addEventListener('hashchange', route);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    toast('ایپ انسٹال ہو گئی');
  });

  /* ---------- boot ---------- */

  applySettings();
  if (!location.hash) location.replace('#/books');
  route();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }
})();
