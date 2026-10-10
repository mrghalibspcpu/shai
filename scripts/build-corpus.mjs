#!/usr/bin/env node
/**
 * SHAI · Offline hadith corpus builder
 * ─────────────────────────────────────────────────────────────
 * Ingests the full CC0-licensed **ThaqalaynData** dump
 * (https://github.com/narmafraz/ThaqalaynData — the data that drives
 * thaqalayn.net / thaqalayn.com) and writes the compact, sharded, on-device
 * corpus that SHAI searches and grounds itself in.
 *
 * What comes out (public/data/corpus/):
 *   manifest.json         sources, licence, per-collection stats, shard list
 *   index.json(.gz)       one lean row per record — enough to search + verify
 *   books/<shard>.json.gz full text (Arabic + English + Urdu + isnād)
 *
 * Nothing is fetched from the network: the builder is deterministic and
 * reproducible from a local checkout of the CC0 dataset.
 *
 *   THAQALAYN_DATA=/path/to/ThaqalaynData/books node scripts/build-corpus.mjs
 *
 * Env:
 *   THAQALAYN_DATA   books/ directory of a ThaqalaynData checkout
 *   CORPUS_AR_MAX    max Arabic chars kept per record   (default 1400)
 *   CORPUS_TR_MAX    max translation chars kept         (default 1200)
 *   CORPUS_NO_GZIP   1 → write plain .json instead of .json.gz
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { keywords } from '../src/lib/text.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/corpus');
const DATA = resolve(
  process.env.THAQALAYN_DATA ||
    process.argv.find((a) => a.startsWith('--data='))?.slice(7) ||
    join(ROOT, 'vendor/ThaqalaynData/books'),
);

const AR_MAX = Number(process.env.CORPUS_AR_MAX || 1400);
const TR_MAX = Number(process.env.CORPUS_TR_MAX || 1200);
const NO_GZIP = process.env.CORPUS_NO_GZIP === '1';

const IN_CI = process.env.GITHUB_ACTIONS === 'true';
const note = (m) => console.log(IN_CI ? `::notice title=corpus::${m}` : m);

if (!existsSync(DATA)) {
  console.error(`[corpus] ThaqalaynData books/ directory not found at ${DATA}`);
  console.error('[corpus] clone it first:  git clone --filter=blob:none --no-checkout https://github.com/narmafraz/ThaqalaynData.git /tmp/td && cd /tmp/td && git sparse-checkout set books && git checkout master');
  process.exit(1);
}

/* ──────────────────────────────────────────────────────────────
 * Collection ids on thaqalayn.com
 * ──────────────────────────────────────────────────────────────
 * Every verse file in ThaqalaynData carries its own canonical
 * `source_url` (https://thaqalayn.net/hadith/{c}/{b}/{ch}/{h}) for most books,
 * and that is always used verbatim. Three books (al-Kāfi, Tahdhīb al-Aḥkām,
 * al-Istibṣār) come from ghbook.ir and have no source_url:
 *
 *   • al-Kāfi — verified against the live site: collection id == volume, and
 *     the {book}/{chapter}/{hadith} numbers line up exactly
 *     (e.g. data al-kafi/1/2/17 → thaqalayn.com/chapter/1/2/17, 15 hadiths).
 *   • Tahdhīb / al-Istibṣār — id could NOT be verified here, so `link` is
 *     left as 0 and the app falls back to a Thaqalayn *search* link instead
 *     of inventing a deep link.
 */
const ID_RULES = {
  'al-kafi': (p) => ({ c: p[0], b: p[1], ch: p[2], h: p[3], link: 1 }),
};

/** Books we deliberately present under their own name (multi-volume fiqh). */
const NO_DEEP_LINK = new Set(['tahdhib-al-ahkam', 'al-istibsar']);

const EXTRA_META = {
  'al-kafi': { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī' },
  'tahdhib-al-ahkam': { en: 'Tahdhīb al-Aḥkām', ur: 'تہذیب الاحکام', author: 'Shaykh al-Ṭūsī' },
  'al-istibsar': { en: 'Al-Istibṣār', ur: 'الاستبصار', author: 'Shaykh al-Ṭūsī' },
};

/* ── text helpers ────────────────────────────────────────────── */

const clean = (s) =>
  String(s || '')
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

const clip = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

const jsonOf = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
};

/* ── walk ────────────────────────────────────────────────────── */

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/* ── translation extraction ──────────────────────────────────── */

/**
 * English/Urdu come from two places:
 *   1. `verse.translations["en.sarwar"]` — human translations, inline.
 *   2. the sibling `<id>.en.json` / `<id>.ur.json` file — AI translation
 *      (`ai.chunks`) plus, occasionally, a named human translation.
 * A human translation always wins over a machine one.
 */
const HUMAN_PREFERENCE = {
  en: [
    'en.sarwar',
    'en.sayed-ali-raza',
    'en.sayed-ali-raza-rizvi',
    'en.bilal-muhammad',
    'en.qarai',
    'en.mulla-asgharali-m-m-jaffer',
    'en.bab-ul-qaim-publications',
    'en.william-c-chittick',
    'en.pickthall',
    'en.sahih',
    'en.ahmedali',
  ],
  ur: [],
};

function bestHuman(inline, fileJson, lang) {
  const found = new Map();
  const collect = (obj) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (!k.startsWith(`${lang}.`) || k.endsWith('.ai')) continue;
      const text = clean((Array.isArray(v) ? v : [v]).join(' '));
      if (text.length > 20 && !found.has(k)) found.set(k, text);
    }
  };
  collect(inline);
  collect(fileJson);
  if (!found.size) return null;
  for (const pref of HUMAN_PREFERENCE[lang] || []) {
    if (found.has(pref)) return { text: found.get(pref), by: pref };
  }
  const [by, text] = [...found][0];
  return { text, by };
}

function pickTranslation(file, verse, lang) {
  const inline = verse.translations || {};
  const j = existsSync(file) ? jsonOf(file) : null;
  const human = bestHuman(inline, j, lang);
  if (human) return human;
  const ai = j?.ai || j?.[`${lang}.ai`];
  if (ai) {
    const chunks = Array.isArray(ai.chunks) ? ai.chunks : [];
    const text = clean(chunks.join(' '));
    if (text) return { text, by: `${lang}.ai` };
  }
  return { text: '', by: '' };
}

/* ── main ────────────────────────────────────────────────────── */

const bookSlugs = readdirSync(DATA).filter((n) => {
  if (n === 'complete') return false;
  try {
    return statSync(join(DATA, n)).isDirectory();
  } catch (_) {
    return false;
  }
});

note(`ThaqalaynData: ${DATA}`);
note(`books: ${bookSlugs.length}`);

/** Grading carried over from the earlier thaqalayn.com crawl (if present). */
const legacyGrades = new Map();
const legacyPath = join(ROOT, 'data/legacy/thaqalayn-crawl-1502.json');
if (existsSync(legacyPath)) {
  const legacy = jsonOf(legacyPath);
  for (const r of legacy?.records || []) {
    if (r.grade || r.grader) legacyGrades.set(r.id, { grade: r.grade || '', grader: r.grader || '' });
  }
  note(`legacy gradings loaded: ${legacyGrades.size}`);
}

const records = [];
const collections = new Map();
const stats = { verse: 0, skipped: 0, withEn: 0, withUr: 0, withIsnad: 0, linked: 0 };

for (const slug of bookSlugs) {
  const bookFile = join(DATA, `${slug}.json`);
  const book = jsonOf(bookFile)?.data || {};
  const titles = book.titles || {};
  const extra = EXTRA_META[slug] || {};
  const meta = {
    slug,
    en: extra.en || titles.en || slug,
    ar: titles.ar || '',
    ur: extra.ur || titles.ar || '',
    author: extra.author || book.author?.en || '',
    kind: slug === 'quran' ? 'quran' : 'hadith',
    count: 0,
    collections: new Set(),
  };

  let n = 0;
  for (const file of walk(join(DATA, slug))) {
    const base = file.slice(file.lastIndexOf('/') + 1);
    if (!/^\d+\.json$/.test(base)) continue;
    const j = jsonOf(file);
    if (!j || j.kind !== 'verse_detail') continue;

    const data = j.data || {};
    const verse = data.verse || {};
    const rel = relative(join(DATA, slug), file).replace(/\\/g, '/');
    const parts = rel
      .replace(/\.json$/, '')
      .split('/')
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));

    const arabic = clean((Array.isArray(verse.text) ? verse.text : [verse.text]).join(' '));
    const isnad = clean(
      ((verse.narrator_chain?.parts) || [])
        .map((p) => p?.text)
        .filter(Boolean)
        .join(' '),
    );

    const stem = file.slice(0, -5);
    const en = pickTranslation(`${stem}.en.json`, verse, 'en');
    const ur = pickTranslation(`${stem}.ur.json`, verse, 'ur');

    if (!arabic && !en.text && !ur.text) {
      stats.skipped += 1;
      continue;
    }

    /* canonical id: the data's own source_url wins */
    let ref = null;
    const su = data.source_url || verse.source_url || '';
    const m = String(su).match(/\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)/);
    if (m) {
      ref = { c: +m[1], b: +m[2], ch: +m[3], h: +m[4], link: 1 };
    } else if (ID_RULES[slug]) {
      ref = ID_RULES[slug](parts);
    }
    const link = ref ? (NO_DEEP_LINK.has(slug) ? 0 : ref.link) : 0;

    const chapterTitle = clean(data.chapter_title?.en || data.chapter_title?.ar || '');
    const chapterTitleAr = clean(data.chapter_title?.ar || '');
    const ai = verse.ai || {};

    const id = ref
      ? `${ref.c}/${ref.b}/${ref.ch}/${ref.h}`
      : slug === 'quran'
        ? `quran/${parts[0]}/${parts[1]}`
        : `${slug}:${parts.join('/')}`;

    const legacy = legacyGrades.get(id);

    records.push({
      i: records.length,
      id,
      /** positional path inside ThaqalaynData — the record's true unique key */
      sp: parts.join('/'),
      slug,
      c: ref ? ref.c : null,
      vol: slug === 'quran' ? parts[0] : parts[0] ?? null,
      b: ref ? ref.b : parts.length > 3 ? parts[1] : null,
      ch: ref ? ref.ch : slug === 'quran' ? parts[0] : parts[parts.length - 2] ?? null,
      h: ref ? ref.h : slug === 'quran' ? parts[1] : parts[parts.length - 1] ?? null,
      t: chapterTitle,
      ta: chapterTitleAr,
      ar: clip(arabic, AR_MAX),
      en: clip(en.text, TR_MAX),
      ur: clip(ur.text, TR_MAX),
      is: clip(isnad, 400),
      enBy: en.by,
      urBy: ur.by,
      g: legacy?.grade || '',
      gd: legacy?.grader || '',
      ct: ai.content_type || '',
      tp: (ai.topics || []).slice(0, 4),
      tg: (ai.tags || []).slice(0, 4),
      link,
    });

    n += 1;
    stats.verse += 1;
    if (en.text) stats.withEn += 1;
    if (ur.text) stats.withUr += 1;
    if (isnad) stats.withIsnad += 1;
    if (link) stats.linked += 1;
    if (ref) meta.collections.add(ref.c);
  }

  meta.count = n;
  meta.collections = [...meta.collections].sort((a, b) => a - b);
  collections.set(slug, meta);
  note(`${slug.padEnd(28)} ${String(n).padStart(6)} records`);
}

/* Records that never had a canonical source_url get their positional
   reference from the data path so the printed citation is still exact. */
for (const r of records) {
  if (r.c !== null || r.slug === 'quran') continue;
  const pp = r.sp.split('/').map(Number);
  if (pp.length >= 4) [r.vol, r.b, r.ch, r.h] = pp.slice(0, 4);
  else if (pp.length === 3) {
    r.vol = pp[0];
    r.b = null;
    r.ch = pp[1];
    r.h = pp[2];
  }
}

/* ── id integrity ──────────────────────────────────────────────
 * The dataset's own `source_url` is authoritative for most books, but it is
 * demonstrably wrong for a few (Man Lā Yaḥḍuruh al-Faqīh points every volume
 * at collection 34, producing duplicate ids). A citation that resolves to two
 * different aḥādīth is worse than no link at all, so any book whose
 * source_urls collide is demoted to a local, unlinked reference — the book,
 * volume, chapter and hadith number are still exact, they just link to a
 * Thaqalayn *search* instead of a deep link.
 * ───────────────────────────────────────────────────────────── */

const idCount = new Map();
for (const r of records) idCount.set(r.id, (idCount.get(r.id) || 0) + 1);
const collided = new Set();
for (const r of records) {
  if (idCount.get(r.id) > 1) collided.add(r.slug);
}
if (collided.size) {
  let fixed = 0;
  for (const r of records) {
    if (!collided.has(r.slug)) continue;
    r.id = `${r.slug}:${r.sp}`;
    r.c = null;
    r.link = 0;
    const pp = r.sp.split('/').map(Number);
    if (pp.length >= 4) [r.vol, r.b, r.ch, r.h] = pp.slice(0, 4);
    else if (pp.length === 3) [r.vol, r.ch, r.h] = [pp[0], pp[1], pp[2]], (r.b = null);
    else if (pp.length === 2) [r.ch, r.h] = pp, (r.vol = null), (r.b = null);
    fixed += 1;
  }
  note(`source_url unreliable for: ${[...collided].join(', ')} — ${fixed} records demoted to local references`);
}
const dupeCheck = new Set();
for (const r of records) {
  if (dupeCheck.has(r.id)) throw new Error(`duplicate record id after normalisation: ${r.id}`);
  dupeCheck.add(r.id);
}
/* `linked` must describe what actually ships, not what pass 1 hoped for. */
stats.linked = records.filter((r) => r.link).length;
stats.unlinked = records.length - stats.linked;

/* ── sort ────────────────────────────────────────────────────── */
records.sort((a, b) => {
  if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
  const ap = [a.vol, a.b, a.ch, a.h].map((x) => x ?? 0);
  const bp = [b.vol, b.b, b.ch, b.h].map((x) => x ?? 0);
  for (let k = 0; k < 4; k += 1) if (ap[k] !== bp[k]) return ap[k] - bp[k];
  return a.id < b.id ? -1 : 1;
});
records.forEach((r, i) => {
  r.i = i;
});

/* ── keyword signatures (what the on-device search actually indexes) ── */
/* Pass 1: document frequency. Pass 2: keep the rarest N tokens per record,
   so the shipped index stays small while staying discriminative.          */

const KW_PER_DOC = Number(process.env.CORPUS_KW || 36);
const DF_MAX_RATIO = 0.35;

const searchable = (r) =>
  `${r.t} ${r.ta} ${r.tp.join(' ')} ${r.tg.join(' ')} ${r.ct} ${r.ar.slice(0, 1200)} ${r.ur.slice(0, 900)} ${r.en.slice(0, 700)}`;

note('building keyword index (df pass)…');
const df = new Map();
for (const r of records) {
  for (const t of new Set(keywords(searchable(r)))) df.set(t, (df.get(t) || 0) + 1);
}
const maxDf = Math.max(4, Math.floor(records.length * DF_MAX_RATIO));
let vocab = 0;
let dropped = 0;
for (const [t, n] of df) {
  if (n > maxDf || n < 1) {
    df.delete(t);
    dropped += 1;
  } else vocab += 1;
}
note(`vocabulary=${vocab} (dropped ${dropped} too-common/rare tokens, max df=${maxDf})`);

note('building keyword index (doc pass)…');
const kRows = new Array(records.length);
for (const r of records) {
  const toks = [...new Set(keywords(searchable(r)))].filter((t) => df.has(t));
  // rarest first → the first tokens are the most informative
  toks.sort((a, b) => df.get(a) - df.get(b));
  kRows[r.i] = toks.slice(0, KW_PER_DOC).join(' ');
}

/* ── write ───────────────────────────────────────────────────── */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'books'), { recursive: true });

const writeMaybeGz = (file, obj) => {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const target = NO_GZIP ? file : `${file}.gz`;
  writeFileSync(target, NO_GZIP ? text : gzipSync(Buffer.from(text), { level: 9 }));
  return { raw: text.length, name: target.slice(target.lastIndexOf('/') + 1) };
};

/* Chapter titles repeat constantly — store each one once and reference it. */
const titleTable = [];
const titleAt = new Map();
const titleIdx = new Array(records.length);
for (const r of records) {
  let at = titleAt.get(r.t);
  if (at === undefined) {
    at = titleTable.length;
    titleTable.push(r.t);
    titleAt.set(r.t, at);
  }
  titleIdx[r.i] = at;
}
/* Same for book slugs. */
const slugTable = [...new Set(records.map((r) => r.slug))];
const slugAt = new Map(slugTable.map((s2, i) => [s2, i]));

const index = {
  v: 2,
  count: records.length,
  /** unique chapter titles, referenced by `ti` */
  titles: titleTable,
  /** unique book slugs, referenced by `s` */
  slugs: slugTable,
  id: records.map((r) => r.id),
  s: records.map((r) => slugAt.get(r.slug)),
  ti: titleIdx,
  g: records.map((r) => r.g),
  lk: records.map((r) => r.link),
  /** packed positional reference: volume/book/chapter/hadith */
  p: records.map((r) => [r.vol ?? 0, r.b ?? 0, r.ch ?? 0, r.h ?? 0].join('/')),
  k: kRows,
};
const idxInfo = writeMaybeGz(join(OUT, 'index.json'), index);
kRows.length = 0;

/** Keep every shard small so the phone only parses what it actually needs. */
const SHARD_MAX = 6 * 1024 * 1024; // ~6 MB of JSON text

function shardKey(r) {
  if (r.slug === 'al-kafi' || r.slug === 'man-la-yahduruhu-al-faqih' || r.slug === 'tahdhib-al-ahkam') {
    return `${r.slug}-${r.vol}`;
  }
  if (r.slug === 'al-istibsar') return `al-istibsar-${r.vol}`;
  return r.slug;
}

const grouped = new Map();
for (const r of records) {
  const key = shardKey(r);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(r);
}

const shardInfo = {};
let rawTotal = 0;
for (const [key, list] of grouped) {
  const size = JSON.stringify(list).length;
  const parts = Math.max(1, Math.ceil(size / SHARD_MAX));
  const per = Math.ceil(list.length / parts);
  for (let p = 0; p < parts; p += 1) {
    const slice = list.slice(p * per, (p + 1) * per);
    if (!slice.length) continue;
    const name = parts === 1 ? key : `${key}.${p + 1}`;
    const res = writeMaybeGz(join(OUT, 'books', `${name}.json`), {
      shard: name,
      from: slice[0].i,
      to: slice[slice.length - 1].i,
      records: slice,
    });
    shardInfo[name] = {
      file: `books/${res.name}`,
      n: slice.length,
      bytes: res.raw,
      from: slice[0].i,
      to: slice[slice.length - 1].i,
    };
    rawTotal += res.raw;
  }
  grouped.set(key, null);
}

const manifest = {
  v: 1,
  builtAt: new Date().toISOString(),
  count: records.length,
  hadith: records.filter((r) => r.slug !== 'quran').length,
  quran: records.filter((r) => r.slug === 'quran').length,
  books: [...collections.values()].map((c) => ({
    slug: c.slug,
    en: c.en,
    ar: c.ar,
    ur: c.ur,
    author: c.author,
    kind: c.kind,
    count: c.count,
    collections: c.collections,
  })),
  translations: { en: stats.withEn, ur: stats.withUr },
  linked: stats.linked,
  vocab,
  stats,
  index: idxInfo.name,
  shards: shardInfo,
  sources: [
    {
      name: 'ThaqalaynData',
      url: 'https://github.com/narmafraz/ThaqalaynData',
      licence: 'CC0-1.0 (public domain)',
      note: 'The dataset that drives thaqalayn.net / thaqalayn.com — Arabic matn, isnād and translations.',
    },
    {
      name: 'thaqalayn.com crawl',
      url: 'https://thaqalayn.com',
      licence: 'site content',
      note: 'Grading (Sahih / Hasan / Muwaththaq / Daif / Mursal / Mutabar) and grader names, carried over from the earlier index.',
    },
  ],
  aiTranslations:
    'Translations marked en.ai / ur.ai are the machine translations that ship inside the CC0 dataset — an aid to reading, not a scholarly translation.',
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

/* ── report ──────────────────────────────────────────────────── */

const files = [join(OUT, 'manifest.json'), join(OUT, idxInfo.name), ...Object.values(shardInfo).map((s) => join(OUT, s.file))];
const onDisk = files.reduce((a, f) => a + statSync(f).size, 0);

note(`records=${records.length} (hadith=${manifest.hadith}, quran=${manifest.quran})`);
note(`english=${stats.withEn} urdu=${stats.withUr} isnad=${stats.withIsnad} deep-links=${stats.linked}`);
note(`shards=${Object.keys(shardInfo).length} json=${(rawTotal / 1e6).toFixed(1)}MB on-disk=${(onDisk / 1e6).toFixed(1)}MB`);
console.log(JSON.stringify({ count: records.length, onDiskMB: +(onDisk / 1e6).toFixed(1), rawMB: +(rawTotal / 1e6).toFixed(1) }));
