/**
 * SHAI · On-device hadith corpus (offline retrieval)
 * ─────────────────────────────────────────────────────────────
 * The whole Shia corpus — 52k+ aḥādīth from 23 books plus the Qurʾān, with
 * Arabic matn, isnād, English and Urdu — ships inside the app as a sharded,
 * gzipped index under `data/corpus/` (built by `scripts/build-corpus.mjs` from
 * the CC0 ThaqalaynData dump).
 *
 * Nothing here touches the network beyond reading those local assets:
 *
 *   manifest.json       book list, shard map, licence/provenance
 *   index.json(.gz)     one lean row per record + a keyword signature
 *   books/*.json(.gz)   full text, loaded lazily and only when a hit needs it
 *
 * Retrieval is a BM25-flavoured inverted index over normalised Arabic / Urdu /
 * English tokens (see `lib/text.js`), built lazily so app start-up is never
 * blocked. The top hits are injected into the system prompt as *grounding*,
 * which is what makes the "never invent a hadith" rule enforceable: the model
 * is handed the exact ids it is allowed to cite.
 */

import { tokenize, normalize } from './text.js';

const state = {
  base: 'data/corpus',
  manifest: null,
  index: null,
  loading: null,
  inverted: null, // Map<token, number[]>
  building: null,
  shards: new Map(), // shard name → records[]
  order: [], // LRU order of shard names
  failed: false,
};

const SHARD_CACHE = 8;

/* ── gzip-aware fetch ────────────────────────────────────────── */

async function gunzip(buffer) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream unavailable');
  }
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buffer]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  if (!url.endsWith('.gz')) return res.json();
  return JSON.parse(await gunzip(await res.arrayBuffer()));
}

/* ── lifecycle ───────────────────────────────────────────────── */

/**
 * Load manifest + index. Safe to call repeatedly; resolves to `false` when the
 * corpus is missing or the runtime cannot inflate it (the app keeps working,
 * just without local grounding).
 */
export function initCorpus({ base } = {}) {
  if (base) state.base = base.replace(/\/+$/, '');
  if (state.loading) return state.loading;
  state.loading = (async () => {
    try {
      state.manifest = await fetchJson(`${state.base}/manifest.json`);
      state.index = await fetchJson(`${state.base}/${state.manifest.index}`);
      if (!state.index?.count) throw new Error('empty index');
      return true;
    } catch (err) {
      state.failed = true;
      state.manifest = null;
      state.index = null;
      if (typeof console !== 'undefined') console.warn('[corpus] unavailable:', err?.message || err);
      return false;
    }
  })();
  return state.loading;
}

export const corpusReady = () => Boolean(state.index);
export const corpusFailed = () => state.failed;
export function corpusStats() {
  if (!state.manifest) return null;
  return {
    count: state.manifest.count,
    hadith: state.manifest.hadith,
    quran: state.manifest.quran,
    books: state.manifest.books?.length || 0,
    urdu: state.manifest.translations?.ur || 0,
    english: state.manifest.translations?.en || 0,
    linked: state.manifest.linked || 0,
    sources: state.manifest.sources || [],
  };
}
export const corpusBooks = () => state.manifest?.books || [];

/** Row accessor helpers — the index is column-oriented on purpose. */
const row = (i) => {
  const idx = state.index;
  if (!idx || i < 0 || i >= idx.count) return null;
  return {
    i,
    id: idx.id[i],
    slug: idx.slugs[idx.s[i]],
    title: idx.titles[idx.ti[i]] || '',
    grade: idx.g[i] || '',
    link: idx.lk[i],
    ref: idx.p[i],
  };
};

/* ── inverted index ──────────────────────────────────────────── */

async function buildInverted() {
  if (state.inverted) return state.inverted;
  if (state.building) return state.building;
  state.building = (async () => {
    const idx = state.index;
    const map = new Map();
    const yieldEvery = 4000;
    for (let i = 0; i < idx.count; i += 1) {
      const kws = idx.k[i];
      if (kws) {
        for (const tok of kws.split(' ')) {
          if (!tok) continue;
          const list = map.get(tok);
          if (list) {
            if (list[list.length - 1] !== i) list.push(i);
          } else {
            map.set(tok, [i]);
          }
        }
      }
      if (i % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
    }
    state.inverted = map;
    return map;
  })();
  return state.building;
}

/* ── search ──────────────────────────────────────────────────── */

/**
 * Rank the corpus against a free-text query in Urdu, Arabic or English.
 * @returns {Promise<Array<{i:number,id:string,score:number,title:string,slug:string,grade:string,ref:string,link:number}>>}
 */
export async function searchCorpus(query, { k = 8, slug = null, minScore = 0.6 } = {}) {
  if (!(await initCorpus())) return [];
  const map = await buildInverted();
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];

  const N = state.index.count;
  const scores = new Map();
  for (const tok of q) {
    const postings = map.get(tok);
    if (!postings) continue;
    const idf = Math.log(1 + (N - postings.length + 0.5) / (postings.length + 0.5));
    // Very common tokens add noise; very rare ones are the signal.
    const weight = idf * (postings.length > N * 0.2 ? 0.35 : 1);
    for (const i of postings) scores.set(i, (scores.get(i) || 0) + weight);
  }
  if (!scores.size) return [];

  const hits = [];
  for (const [i, score] of scores) {
    if (score < minScore) continue;
    const r = row(i);
    if (!r) continue;
    if (slug && r.slug !== slug) continue;
    hits.push({ ...r, score });
  }
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  return hits.slice(0, k);
}

/* ── shard loading ───────────────────────────────────────────── */

function shardFor(i) {
  const shards = state.manifest?.shards || {};
  for (const [name, info] of Object.entries(shards)) {
    if (i >= info.from && i <= info.to) return name;
  }
  return null;
}

async function loadShard(name) {
  if (!name) return [];
  if (state.shards.has(name)) {
    state.order = [...state.order.filter((n) => n !== name), name];
    return state.shards.get(name);
  }
  const info = state.manifest.shards[name];
  if (!info) return [];
  const data = await fetchJson(`${state.base}/${info.file}`);
  state.shards.set(name, data.records || []);
  state.order.push(name);
  while (state.order.length > SHARD_CACHE) {
    const drop = state.order.shift();
    state.shards.delete(drop);
  }
  return state.shards.get(name) || [];
}

/** Full records (Arabic / English / Urdu / isnād) for index positions. */
export async function getRecords(indices) {
  if (!(await initCorpus())) return [];
  const byShard = new Map();
  for (const i of indices) {
    const name = shardFor(i);
    if (!name) continue;
    if (!byShard.has(name)) byShard.set(name, []);
    byShard.get(name).push(i);
  }
  const out = [];
  for (const [name, list] of byShard) {
    try {
      const records = await loadShard(name);
      const from = state.manifest.shards[name].from;
      for (const i of list) {
        const rec = records[i - from];
        if (rec && rec.i === i) out.push(rec);
      }
    } catch (_) {
      /* a missing shard must not sink the whole answer */
    }
  }
  out.sort((a, b) => a.i - b.i);
  return out;
}

/* ── citation lookups ────────────────────────────────────────── */

let idMap = null;

/** Exact-id lookup, e.g. `lookup("1/2/17/14")` → index row or null. */
export function lookup(id) {
  if (!state.index) return null;
  if (!idMap) {
    idMap = new Map();
    for (let i = 0; i < state.index.count; i += 1) idMap.set(state.index.id[i], i);
  }
  const i = idMap.get(String(id).trim());
  if (i === undefined) return null;
  const r = row(i);
  return { ...r, book: bookMeta(r.slug) };
}

/** Book metadata for a slug. */
export function bookMeta(slug) {
  return (state.manifest?.books || []).find((b) => b.slug === slug) || null;
}

/* ── grounding ───────────────────────────────────────────────── */

const trim = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
};

function describe(rec) {
  const meta = bookMeta(rec.slug);
  const name = meta?.en || rec.slug;
  const [vol, b, ch, h] = String(rec.ref || '').split('/').map(Number);
  if (rec.slug === 'quran') return `Qurʾān · Sūrah ${ch} · Āyah ${h}`;
  const parts = [name];
  if (vol) parts.push(`Vol. ${vol}`);
  if (b) parts.push(`Book ${b}`);
  if (ch) parts.push(`Ch. ${ch}`);
  if (h) parts.push(`Ḥadīth ${h}`);
  return parts.join(' · ');
}

/**
 * Retrieve + format the local evidence for a question.
 * @returns {Promise<{block:string, hits:Array, used:number}>}
 */
export async function grounding(query, { k = 6, chars = 900 } = {}) {
  const hits = await searchCorpus(query, { k });
  if (!hits.length) return { block: '', hits: [], used: 0 };
  const records = await getRecords(hits.map((h) => h.i));
  if (!records.length) return { block: '', hits: [], used: 0 };

  const lines = [];
  records.forEach((rec, n) => {
    const meta = bookMeta(rec.slug);
    const head =
      rec.slug === 'quran'
        ? `قرآن · سورہ ${rec.ch} · آیت ${rec.h}`
        : `${meta?.ur || rec.slug}${rec.vol ? ` · جلد ${rec.vol}` : ''}${rec.b ? ` · کتاب ${rec.b}` : ''}${rec.ch ? ` · باب ${rec.ch}` : ''}${rec.h ? ` · حدیث ${rec.h}` : ''}`;
    const grade = rec.g ? ` · درجہ: ${rec.g}${rec.gd ? ` (${rec.gd})` : ''}` : '';
    const cite = rec.slug === 'quran' ? `quran:${rec.ch}/${rec.h}` : `thaqalayn:${rec.id}`;
    lines.push(
      [
        `### [${n + 1}] ${head}${grade}`,
        `id: ${rec.id}`,
        rec.t ? `باب: ${rec.t}` : '',
        rec.ar ? `AR: ${trim(rec.ar, chars)}` : '',
        rec.ur ? `UR: ${trim(rec.ur, chars)}` : '',
        rec.en ? `EN: ${trim(rec.en, Math.round(chars * 0.7))}` : '',
        `cite: ${cite}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });

  const block = lines.join('\n\n');
  return { block, hits, used: records.length, describe };
}

/** Human-readable reference for a record (used by the UI + tests). */
export function describeRecord(rec) {
  return describe(rec);
}

/** Normalised form of a query — exported for tests. */
export const normaliseQuery = normalize;
