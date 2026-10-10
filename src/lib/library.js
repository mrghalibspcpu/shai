/**
 * SHAI · On-device library & retrieval
 * ─────────────────────────────────────────────────────────────
 * Loads the per-book shards produced by scripts/build-library.mjs and answers
 * search queries with a small BM25-style inverted index. The retrieved records
 * are the ONLY sources the model may cite in a given turn.
 *
 * Record shape (compact):
 *   { i: id, t: tag, c: citation_en, u: url|null, s: status, a: arabic, e: english, b: book }
 */

const BASE = 'data/library/';

let loading = null;
let state = null; // { records, byId, postings, df, avgLen, books }

/* ── Text normalisation ──────────────────────────────────────── */

// Stopwords are stored in normalised form so they match normalised tokens.
const STOP_AR = new Set(
  (
    'في من على عن إلى الى ان أن إن ما لا لم لن هو هي هم هن ذلك تلك هذا هذه التي الذي الذين ' +
    'و او أو ثم ب ل ك يا قد كان كانت يكون اذا إذا لو فإن فان قال قالا قالت عليه عليها عليهم ' +
    'عليهما عنه عنها له لها لهم منه منها بعد قبل كل بين حتى ايضا أيضا مع ولا ولم ولن'
  )
    .split(/\s+/)
    .map((w) => normaliseArabic(w).trim())
);

const STOP_EN = new Set(
  'a an the of and or in on at to for from by with is are was were be as that this it its his her their who which what when where how do does did not no yes'.split(
    ' '
  )
);

/** Arabic: strip harakat/tatweel, unify alif/ya/ta-marbuta/hamza forms. */
export function normaliseArabic(s) {
  return String(s || '')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
    .replace(/\u0649/g, 'ي')
    .replace(/\u0629/g, 'ه')
    .replace(/\u0624/g, 'و')
    .replace(/\u0626/g, 'ي')
    .replace(/[^\u0621-\u063A\u0641-\u064A\u0660-\u0669a-zA-Z0-9\s]/g, ' ');
}

/** Light Arabic stemming: drop the definite article and common conjunction prefixes. */
function stemAr(w) {
  let x = w;
  if (x.length > 4 && x.startsWith('ال')) x = x.slice(2);
  else if (x.length > 3 && (x.startsWith('وال') || x.startsWith('بال') || x.startsWith('لل') || x.startsWith('فال'))) {
    x = x.replace(/^(وال|بال|فال|لل)/, '');
  }
  return x;
}

export function tokenize(text) {
  const out = [];
  const norm = normaliseArabic(text).toLowerCase();
  for (const raw of norm.split(/\s+/)) {
    if (!raw) continue;
    const isArabic = /[\u0621-\u064A]/.test(raw);
    if (isArabic) {
      if (raw.length < 2 || STOP_AR.has(raw)) continue;
      const w = stemAr(raw);
      if (w.length >= 2 && !STOP_AR.has(w)) out.push(w);
    } else {
      if (raw.length < 2 || STOP_EN.has(raw)) continue;
      out.push(raw);
    }
  }
  return out;
}

/* ── Loading ─────────────────────────────────────────────────── */

async function fetchJson(path) {
  const res = await fetch(BASE + path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`library: ${path} → HTTP ${res.status}`);
  return res.json();
}

/** Load every shard once and build the inverted index. Safe to call repeatedly. */
export function loadLibrary() {
  if (!loading) {
    loading = (async () => {
      const manifest = await fetchJson('manifest.json');
      const shards = await Promise.all(manifest.books.map((b) => fetchJson(`${b.slug}.json`).then((recs) => [b.slug, recs])));
      const records = [];
      for (const [slug, recs] of shards) {
        for (const r of recs) records.push({ ...r, b: slug });
      }
      state = buildIndex(records, manifest);
      return state;
    })().catch((err) => {
      loading = null; // allow a retry later
      throw err;
    });
  }
  return loading;
}

/** Build index from in-memory records (also used by tests). */
export function buildIndex(records, manifest = { books: [] }) {
  const byId = new Map();
  const postings = new Map(); // token → array of doc indices (one entry per occurrence)
  const docLen = new Float32Array(records.length);
  records.forEach((rec, idx) => {
    byId.set(rec.i, rec);
    const toks = tokenize(`${rec.a} ${rec.e || ''} ${rec.c || ''}`);
    docLen[idx] = Math.max(1, toks.length);
    for (const t of toks) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push(idx);
    }
  });
  let total = 0;
  for (const l of docLen) total += l;
  return {
    records,
    byId,
    postings,
    docLen,
    avgLen: records.length ? total / records.length : 1,
    books: manifest.books || [],
  };
}

export const isLoaded = () => !!state;

/** Install a prebuilt index as the active one (used by tests and by loadLibrary). */
export function useIndex(idx) {
  state = idx;
  return idx;
}

export function getRecord(id) {
  return state?.byId.get(String(id)) || null;
}

/**
 * BM25 search over the loaded library.
 * @param {string} query  Arabic/English keywords (Urdu sentences should be turned into keywords first)
 * @param {{k?: number, books?: string[]}} opts
 * @returns {Array<{rec: object, score: number, terms: string[]}>}
 */
export function search(query, { k = 8, books = null } = {}) {
  if (!state) throw new Error('library not loaded');
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const N = state.records.length;
  const K1 = 1.2;
  const B = 0.75;
  const scores = new Map();
  const matched = new Map();
  for (const t of terms) {
    const p = state.postings.get(t);
    if (!p) continue;
    // Ignore near-universal tokens: they add cost and no signal.
    if (p.length > N * 0.35) continue;
    const df = p.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    // Count occurrences per doc (postings hold one entry per occurrence).
    const tf = new Map();
    for (const d of p) tf.set(d, (tf.get(d) || 0) + 1);
    for (const [d, f] of tf) {
      const rec = state.records[d];
      if (books && !books.includes(rec.b)) continue;
      const norm = K1 * (1 - B + (B * state.docLen[d]) / state.avgLen);
      const s = idf * ((f * (K1 + 1)) / (f + norm));
      scores.set(d, (scores.get(d) || 0) + s);
      if (!matched.has(d)) matched.set(d, new Set());
      matched.get(d).add(t);
    }
  }
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([d, score]) => ({ rec: state.records[d], score, terms: [...matched.get(d)] }));
  return ranked;
}

/** Shape a record for display and for the prompt. Never adds fields the source lacks. */
export function viewOf(rec) {
  return {
    id: rec.i,
    tag: rec.t || '',
    citation: rec.c || '',
    url: rec.u || null,
    status: rec.s || 'unverified',
    verified: rec.s === 'verified',
    arabic: rec.a || '',
    english: rec.e || '',
    book: rec.b || '',
  };
}

/** Compact text block of retrieved sources for the model. Matn comes from the source record. */
export function contextBlock(hits) {
  return hits
    .map((h, i) => {
      const v = viewOf(h.rec);
      return [
        `[S${i + 1}] id=${v.id}`,
        `citation: ${v.citation}`,
        `verification: ${v.verified ? 'verified' : 'not verified'}`,
        v.english ? `english: ${v.english.slice(0, 1200)}` : 'english: (none in source)',
        `arabic: ${v.arabic.slice(0, 1200)}`,
      ].join('\n');
    })
    .join('\n\n');
}
