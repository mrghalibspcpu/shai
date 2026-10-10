/**
 * SHAI · Sources drawer — the catalogue SHAI is allowed to cite from.
 */

import { COLLECTIONS, VALID_IDS, collection, bookUrl } from '../lib/sources.js';
import { qs } from '../lib/dom.js';
import { openExternal } from '../lib/dom.js';

export function initSources() {
  const overlay = qs('#sources');
  const list = qs('#sr-list');

  const rows = VALID_IDS.map((id) => {
    const meta = collection(id) || { en: `Thaqalayn Collection ${id}`, author: 'Thaqalayn', vol: null };
    const vol = meta.vol ? ` · Vol. ${meta.vol}` : '';
    return `
      <a class="sr" href="${bookUrl(id)}" target="_blank" rel="noopener noreferrer" data-url="${bookUrl(id)}">
        <span class="sr__id">${id}</span>
        <span class="sr__main">
          <span class="sr__name">${meta.en}${vol}</span>
          <span class="sr__author">${meta.author || ''}</span>
        </span>
        <span class="sr__go">↗</span>
      </a>`;
  }).join('');

  list.innerHTML = rows;

  list.addEventListener('click', (e) => {
    const a = e.target.closest('.sr');
    if (!a) return;
    e.preventDefault();
    openExternal(a.dataset.url);
  });

  qs('#sr-close')?.addEventListener('click', () => {
    overlay.hidden = true;
  });
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  return {
    open() {
      overlay.hidden = false;
    },
    close() {
      overlay.hidden = true;
    },
  };
}

export const COLLECTION_COUNT = Object.keys(COLLECTIONS).length;
