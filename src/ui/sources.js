/**
 * SHAI · Sources drawer — the library SHAI is grounded in.
 * ─────────────────────────────────────────────────────────────
 * Two layers are shown:
 *   1. the offline corpus that actually ships inside the app (book by book,
 *      with real record counts), and
 *   2. the Thaqalayn collection ids the model is allowed to cite.
 */

import { COLLECTIONS, VALID_IDS, collection, bookUrl, searchUrl } from '../lib/sources.js';
import { corpusStats, corpusBooks } from '../lib/corpus.js';
import { qs, openExternal } from '../lib/dom.js';

const nf = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** First verified thaqalayn.com collection id for a book slug. */
function bookLink(book) {
  const id = (book.collections || [])[0];
  if (id) return bookUrl(id);
  return searchUrl(book.en || book.slug);
}

function statsBlock(stats) {
  if (!stats) {
    return `<div class="sr-stats"><p class="drawer__sub">آف لائن لائبریری لوڈ ہو رہی ہے…</p></div>`;
  }
  return `
    <div class="sr-stats">
      <div class="sr-stat"><b>${nf(stats.hadith)}</b><span>احادیث و روایات</span></div>
      <div class="sr-stat"><b>${nf(stats.quran)}</b><span>قرآنی آیات</span></div>
      <div class="sr-stat"><b>${stats.books}</b><span>کتب</span></div>
      <div class="sr-stat"><b>${nf(stats.urdu)}</b><span>اردو تراجم</span></div>
    </div>`;
}

function bookRows(books) {
  if (!books.length) {
    const rows = VALID_IDS.map((id) => {
      const meta = collection(id) || { en: `Thaqalayn Collection ${id}`, author: 'Thaqalayn', vol: null };
      const vol = meta.vol ? ` · Vol. ${meta.vol}` : '';
      return `
      <a class="sr" href="${bookUrl(id)}" data-url="${bookUrl(id)}">
        <span class="sr__id">${id}</span>
        <span class="sr__main">
          <span class="sr__name">${esc(meta.en)}${vol}</span>
          <span class="sr__author">${esc(meta.author || '')}</span>
        </span>
        <span class="sr__go">↗</span>
      </a>`;
    }).join('');
    return rows;
  }

  return [...books]
    .sort((a, b) => b.count - a.count)
    .map((b) => {
      const ids = (b.collections || []).join('، ');
      return `
      <a class="sr" href="${bookLink(b)}" data-url="${bookLink(b)}">
        <span class="sr__id">${b.count ? nf(b.count) : '—'}</span>
        <span class="sr__main">
          <span class="sr__name">${esc(b.ur || b.en)}</span>
          <span class="sr__author">${esc(b.author || b.en)}${ids ? ` · Thaqalayn ${ids}` : ''}</span>
        </span>
        <span class="sr__go">↗</span>
      </a>`;
    })
    .join('');
}

export function initSources() {
  const overlay = qs('#sources');
  const list = qs('#sr-list');
  const stats = qs('#sr-stats');

  const render = () => {
    const s = corpusStats();
    if (stats) stats.innerHTML = statsBlock(s);
    if (list) list.innerHTML = bookRows(corpusBooks());
  };

  render();

  list?.addEventListener('click', (e) => {
    const a = e.target.closest('.sr');
    if (!a) return;
    e.preventDefault();
    openExternal(a.dataset.url);
  });

  qs('#sr-close')?.addEventListener('click', () => {
    if (overlay) overlay.hidden = true;
  });
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  return {
    open() {
      render();
      if (overlay) overlay.hidden = false;
    },
    close() {
      if (overlay) overlay.hidden = true;
    },
    refresh: render,
  };
}

export const COLLECTION_COUNT = Object.keys(COLLECTIONS).length;
