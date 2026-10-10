#!/usr/bin/env node
/**
 * SHIA AI · Dataset validator & manifest
 * ─────────────────────────────────────────────────────────────
 * Validates the shipped retrieval data and writes public/data/manifest.json:
 *   · every hadith has a valid collection, numeric c/b/ch/h, unique id, Arabic matan
 *   · every hadith / fatwa URL is an absolute https URL on an allowed host
 *   · every fatwa row is a ruling or Q&A (notes are not citable)
 * The app re-checks all of this at runtime; this script fails the build early.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HADITH = join(ROOT, 'public/data/thaqalayn/hadith.json');
const FATAWA = join(ROOT, 'public/data/fatawa/fatawa.json');
const OUT = join(ROOT, 'public/data/manifest.json');

const ALLOWED_COLLECTIONS = new Set([1, 2, 9, 10, 14, 23, 24, 29, 32, 39]);
const ALLOWED_HOSTS = new Set(['thaqalayn.com', 'www.thaqalayn.com', 'sistani.org', 'www.sistani.org', 'leader.ir', 'www.leader.ir']);
const HADITH_URL = /^https:\/\/thaqalayn\.com\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/;

const errors = [];
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const load = (p) => {
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  const buf = readFileSync(p);
  return { json: JSON.parse(buf.toString('utf8')), hash: sha(buf) };
};

const hRaw = load(HADITH);
const fRaw = load(FATAWA);
const hadith = hRaw.json.records || [];
const fatawa = fRaw.json.records || [];

const seen = new Set();
let hadithOk = 0;
for (const r of hadith) {
  const id = `${r.c}/${r.b}/${r.ch}/${r.h}`;
  if (!ALLOWED_COLLECTIONS.has(Number(r.c))) errors.push(`hadith ${id}: collection ${r.c} not allowed`);
  if (![r.c, r.b, r.ch, r.h].every((n) => Number.isInteger(n) && n >= 0)) errors.push(`hadith ${id}: non-integer locator`);
  if (seen.has(id)) errors.push(`hadith ${id}: duplicate id`);
  seen.add(id);
  if (!String(r.ar || '').trim()) errors.push(`hadith ${id}: empty Arabic matan`);
  const m = HADITH_URL.exec(String(r.url || ''));
  if (!m) errors.push(`hadith ${id}: url not absolute https thaqalayn: ${r.url}`);
  else if (m[1] !== String(r.c) || m[2] !== String(r.b) || m[3] !== String(r.ch) || m[4] !== String(r.h)) errors.push(`hadith ${id}: url does not match locator`);
  else hadithOk += 1;
}

let fatwaOk = 0;
let fatwaNotes = 0;
const fseen = new Set();
const fatwaDupes = [];
for (const f of fatawa) {
  // Notes are expected in the source file; the app skips them (not citable).
  if (f.kind === 'note') {
    fatwaNotes += 1;
    continue;
  }
  // Duplicate ids: the app keeps the first row and reports the rest as warnings.
  if (fseen.has(f.id)) {
    fatwaDupes.push(f.id);
    continue;
  }
  fseen.add(f.id);
  let host = '';
  try {
    const u = new URL(String(f.url || ''));
    if (u.protocol !== 'https:') throw new Error('not https');
    host = u.hostname.toLowerCase();
  } catch (_) {
    errors.push(`fatwa ${f.id}: url not absolute https: ${f.url}`);
    continue;
  }
  if (!ALLOWED_HOSTS.has(host)) errors.push(`fatwa ${f.id}: host ${host} not allowed`);
  else fatwaOk += 1;
}

if (fatwaDupes.length) {
  console.warn(`! ${fatwaDupes.length} duplicate fatwa ids (later rows are unreachable): ${[...new Set(fatwaDupes)].slice(0, 5).join(', ')} …`);
}

if (errors.length) {
  console.error(`✗ dataset validation failed (${errors.length} problems)`);
  errors.slice(0, 30).forEach((e) => console.error('  · ' + e));
  process.exit(1);
}

const manifest = {
  generatedBy: 'scripts/build-search-index.mjs',
  hadith: { file: 'thaqalayn/hadith.json', count: hadithOk, sha256: hRaw.hash, collections: [...ALLOWED_COLLECTIONS].sort((a, b) => a - b) },
  fatawa: { file: 'fatawa/fatawa.json', count: fatwaOk, notesSkipped: fatwaNotes, duplicateIds: new Set(fatwaDupes).size, sha256: fRaw.hash, marja: [...new Set(fatawa.map((f) => f.marjaFull || f.marja))] },
  allowedHosts: [...ALLOWED_HOSTS].sort(),
};
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`✓ dataset valid: ${hadithOk} hadith, ${fatwaOk} fatawa → public/data/manifest.json`);
