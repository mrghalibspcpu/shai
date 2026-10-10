/**
 * SHIA AI · Offline dataset (Thaqalayn hadith + Sistani fatawa)
 * ─────────────────────────────────────────────────────────────
 * Loads the two JSON indices shipped inside the app (public/data/…), validates
 * every row, and builds the lookups the retrieval engine and the citation
 * renderer depend on.
 *
 * Trust rules enforced here:
 *   • A hadith is only "real" if its collection / book / chapter / hadith
 *     numbers form a valid Thaqalayn id. Its URL is REBUILT from those numbers
 *     (absolute https://…/hadith/c/b/ch/h) — the stored string is never trusted.
 *   • A fatwa is only "real" if it has an allowed https source URL and text.
 *   • Nothing outside these records can ever be shown as a citation.
 */

import { hadithUrl, collection, isValidCollection, safeHref } from './sources.js';
import { normText, tokens, stem, hasArabicScript } from './text.js';

const HADITH_FILE = 'data/thaqalayn/hadith.json';
const FATAWA_FILE = 'data/fatawa/fatawa.json';

const state = {
  status: 'idle', // idle | loading | ready | error
  error: '',
  hadith: [],
  fatawa: [],
  hadithById: new Map(),
  fatwaById: new Map(),
  skipped: { hadith: 0, fatwa: 0, urlRebuilt: 0 },
  loading: null,
};

/* ── Row preparation ─────────────────────────────────────────── */

export function prepareHadith(r) {
  const c = Number(r?.c);
  const b = Number(r?.b);
  const ch = Number(r?.ch);
  const h = Number(r?.h);
  if (![c, b, ch, h].every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (!isValidCollection(c)) return null;
  const ar = String(r.ar || '').trim();
  if (!ar) return null;

  const meta = collection(c);
  const en = String(r.en || '').trim();
  const chapterTitle = String(r.chapterTitle || '').trim();
  const url = hadithUrl(c, b, ch, h);
  if (r.url && r.url !== url) state.skipped.urlRebuilt += 1;

  return {
    kind: 'hadith',
    id: `${c}/${b}/${ch}/${h}`,
    c,
    b,
    ch,
    h,
    volume: Number(r.volume) || meta?.vol || null,
    collectionEn: meta?.en || `Collection ${c}`,
    collectionUr: meta?.ur || `مجموعہ ${c}`,
    author: meta?.author || '',
    chapterTitle,
    ar,
    en,
    arN: normText(ar),
    grade: String(r.grade || '').trim(),
    grader: String(r.grader || '').trim(),
    url,
    words: new Set(
      normText(`${en} ${chapterTitle}`)
        .split(' ')
        .filter(Boolean)
        .map(stem)
    ),
  };
}

export function prepareFatwa(r) {
  if (!r || !['ruling', 'qa'].includes(r.kind)) return null; // "note" rows are not citable rulings
  const en = String(r.en || '').trim();
  const url = safeHref(r.url);
  if (!en || !url) return null;
  const marja = String(r.marjaFull || r.marja || '').trim();
  const textN = normText([en, r.book, r.marja, marja].join(' '));
  return {
    kind: 'fatwa',
    id: String(r.id || ''),
    type: r.kind,
    marja,
    marjaShort: String(r.marja || '').trim(),
    book: String(r.book || '').trim(),
    edition: String(r.edition || '').trim(),
    rulingNo: Number.isInteger(r.rulingNo) ? r.rulingNo : null,
    en,
    url,
    sourceName: (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch (_) {
        return 'sistani.org';
      }
    })(),
    textN,
    words: new Set(textN.split(' ').filter(Boolean).map(stem)),
  };
}

/* ── Install / load ──────────────────────────────────────────── */

/** Install already-parsed JSON (used by the loader and by the self-test). */
export function installDataset({ hadith = {}, fatawa = {} } = {}) {
  state.skipped = { hadith: 0, fatwa: 0, urlRebuilt: 0 };
  state.hadith = [];
  state.hadithById = new Map();
  for (const r of hadith.records || []) {
    const rec = prepareHadith(r);
    if (!rec) {
      state.skipped.hadith += 1;
      continue;
    }
    if (state.hadithById.has(rec.id)) continue; // duplicate row
    state.hadithById.set(rec.id, rec);
    state.hadith.push(rec);
  }

  state.fatawa = [];
  state.fatwaById = new Map();
  for (const r of fatawa.records || []) {
    const rec = prepareFatwa(r);
    if (!rec || !rec.id) {
      state.skipped.fatwa += 1;
      continue;
    }
    if (state.fatwaById.has(rec.id)) continue;
    state.fatwaById.set(rec.id, rec);
    state.fatawa.push(rec);
  }

  state.status = state.hadith.length || state.fatawa.length ? 'ready' : 'error';
  state.error = state.status === 'error' ? 'dataset is empty' : '';
  matanCache.clear();
  return datasetStatus();
}

async function fetchJson(relPath) {
  const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/';
  const res = await fetch(new URL(relPath, base).href, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return res.json();
}

/** Load both indices once. Safe to call many times. Never throws. */
export function loadDataset() {
  if (state.loading) return state.loading;
  state.status = 'loading';
  state.loading = (async () => {
    try {
      const [hadith, fatawa] = await Promise.all([fetchJson(HADITH_FILE), fetchJson(FATAWA_FILE)]);
      installDataset({ hadith, fatawa });
    } catch (err) {
      state.status = 'error';
      state.error = String(err?.message || err);
    }
    return datasetStatus();
  })();
  return state.loading;
}

/* ── Accessors ───────────────────────────────────────────────── */

export function datasetStatus() {
  return {
    status: state.status,
    error: state.error,
    hadithCount: state.hadith.length,
    fatwaCount: state.fatawa.length,
    skipped: { ...state.skipped },
  };
}

export const isReady = () => state.status === 'ready';
export const hadithRecords = () => state.hadith;
export const fatwaRecords = () => state.fatawa;
export const getHadith = (id) => state.hadithById.get(String(id)) || null;
export const getFatwa = (id) => state.fatwaById.get(String(id)) || null;

/* ── Matan → record (used to attach exact metadata to Arabic cards) ── */

const matanCache = new Map();
const MAX_CACHE = 300;

/**
 * Find the dataset hadith whose Arabic matan matches `text` (the Arabic block
 * the model wrote). Strict: exact containment first, then a high token-overlap
 * test. Returns null when no record is close enough — the caller must then show
 * the card as UNVERIFIED with no link.
 */
export function findHadithByMatan(text) {
  if (!state.hadith.length) return null;
  const n = normText(text);
  if (n.length < 12 || !hasArabicScript(n)) return null;
  if (matanCache.has(n)) return matanCache.get(n);

  let hit = null;
  // 1) The record's text contains the block (block is a fragment / whole copy).
  let key = n.length > 60 ? n.slice(0, 60).replace(/\s+\S*$/, '') : n;
  if (key.length >= 12) hit = state.hadith.find((r) => r.arN.includes(key)) || null;

  // 2) The block contains the record's opening (model added extra words).
  if (!hit) {
    hit = state.hadith.find((r) => r.arN.length >= 40 && n.includes(r.arN.slice(0, 40))) || null;
  }

  // 3) Strong token overlap (≥ 80% of the block's words appear in the record).
  if (!hit) {
    const toks = tokens(n).filter((t) => t.length >= 3);
    if (toks.length >= 5) {
      let best = null;
      let bestScore = 0;
      for (const r of state.hadith) {
        let found = 0;
        for (const t of toks) if (r.arN.includes(t)) found += 1;
        const score = found / toks.length;
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }
      if (bestScore >= 0.8) hit = best;
    }
  }

  if (matanCache.size >= MAX_CACHE) matanCache.clear();
  matanCache.set(n, hit);
  return hit;
}
