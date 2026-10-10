#!/usr/bin/env node
/**
 * SHAI · Library shard builder
 * ─────────────────────────────────────────────────────────────
 * Converts the verified-source data repository (thaqalayn-hadith-data) into
 * compact, per-book JSON shards that the app loads and searches ON-DEVICE.
 *
 *   node scripts/build-library.mjs                 # default source path
 *   LIBRARY_SRC=/path/to/thaqalayn-hadith-data node scripts/build-library.mjs
 *   node scripts/build-library.mjs --books quran,nahj-al-balagha
 *
 * Rules enforced here (these are the grounding guarantees of the app):
 *   • Arabic matn (`a`) and English (`e`) are copied ONLY from the source JSON.
 *   • `u` (URL) is copied ONLY from the source record; it is never built from
 *     a model's output.
 *   • `s` (link status) is one of: verified | mismatch | unverified | no-url.
 *     It comes from the record's own `link_status` or from
 *     curated/<book>.link-checks.json. Anything else is `unverified`.
 *
 * Output: public/data/library/manifest.json + public/data/library/<book>.json
 * The output directory is git-ignored (generated, ~70 MB for all books).
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.env.LIBRARY_SRC || join(ROOT, '..', 'thaqalayn-hadith-data'));
const OUT = join(ROOT, 'public/data/library');

const argBooks = process.argv.includes('--books')
  ? process.argv[process.argv.indexOf('--books') + 1].split(',').map((s) => s.trim())
  : null;

const SKIP = new Set(['meta.json', 'validation.json', 'summary.json', 'link-report.json', 'verified-citations.json']);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function englishOf(text = {}) {
  // Prefer the first English translation key in source order (en, en_qarai, en_hubeali, …).
  const keys = Object.keys(text).filter((k) => k === 'en' || k.startsWith('en_'));
  for (const k of keys) if (text[k]) return String(text[k]).trim();
  return '';
}

const STATUS = new Set(['verified', 'mismatch', 'unverified', 'no-url']);

function curatedChecks(book) {
  const p = join(SRC, 'curated', `${book}.link-checks.json`);
  if (!existsSync(p)) return {};
  try {
    return readJson(p).checks || {};
  } catch (_) {
    return {};
  }
}

function bookDirs() {
  const base = join(SRC, 'books');
  return readdirSync(base)
    .filter((d) => statSync(join(base, d)).isDirectory())
    .filter((d) => !argBooks || argBooks.includes(d));
}

function recordFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .map((f) => join(dir, f))
    .sort();
}

function compact(rec, checks) {
  const id = String(rec.id || '');
  const chk = checks[id];
  let status = rec.link_status || (chk && chk.status) || 'unverified';
  if (!STATUS.has(status)) status = 'unverified';
  if (!rec.url) status = 'no-url';
  const ar = rec.text?.ar || '';
  if (!id || !ar) return null;
  return {
    i: id,
    t: rec.ref?.tag || '',
    c: rec.ref?.citation_en || rec.ref?.tag || id,
    u: rec.url || null,
    s: status,
    a: ar,
    e: englishOf(rec.text),
  };
}

mkdirSync(OUT, { recursive: true });
const manifest = { generated: new Date().toISOString(), source: basename(SRC), books: [], total: 0, verified: 0 };

for (const book of bookDirs()) {
  const dir = join(SRC, 'books', book);
  const checks = curatedChecks(book);
  const out = [];
  let skipped = 0;
  for (const f of recordFiles(dir)) {
    const data = readJson(f);
    if (!Array.isArray(data)) continue;
    for (const rec of data) {
      const c = compact(rec, checks);
      if (c) out.push(c);
      else skipped += 1;
    }
  }
  if (!out.length) continue;
  // Quran is a single file; some hadith books have a single record file too.
  const seen = new Set();
  const dedup = out.filter((r) => (seen.has(r.i) ? false : seen.add(r.i)));
  writeFileSync(join(OUT, `${book}.json`), JSON.stringify(dedup));
  const verified = dedup.filter((r) => r.s === 'verified').length;
  manifest.books.push({ slug: book, count: dedup.length, verified, skipped });
  manifest.total += dedup.length;
  manifest.verified += verified;
  console.log(`${book.padEnd(34)} records=${String(dedup.length).padStart(6)} verified=${verified}`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\nTotal records=${manifest.total} verified=${manifest.verified} → ${OUT}`);
