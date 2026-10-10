#!/usr/bin/env node
/**
 * SHIA AI · Thaqalayn hadith index builder
 * ─────────────────────────────────────────────────────────────
 * Crawls thaqalayn.com (which is what thaqalyn.net resolves to), pulls every
 * hadith page for the configured collections, and writes a compact JSON index
 * that the app ships and searches **offline, on-device**.
 *
 * This index is the single source of truth for the zero-hallucination engine:
 * the model is only ever shown records that really exist here.
 *
 *   node scripts/build-hadith-index.mjs [--sample 3]
 *
 * Env:
 *   HADITH_COLLECTIONS   csv of collection ids  (default: major collections)
 *   HADITH_PER_COLLECTION  max hadiths per collection (default 60)
 *   HADITH_CONCURRENCY   parallel fetches (default 6)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/data/thaqalayn');

const BASE = 'https://thaqalayn.com';
const UA = 'SHIA-AI-IndexBuilder/1.0 (+https://github.com/mrghalibspcpu/shai)';

const COLLECTIONS = (process.env.HADITH_COLLECTIONS || '1,2,9,10,14,23,24,29,32,39')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const PER_COLLECTION = Number(process.env.HADITH_PER_COLLECTION || 60);
const CONCURRENCY = Number(process.env.HADITH_CONCURRENCY || 6);
const SAMPLE = Number(process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : 0);

/* ── helpers ─────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' },
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch (_) {
      /* retry */
    }
    await sleep(400 * (i + 1));
  }
  return null;
}

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
};

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function htmlToText(html) {
  let h = String(html || '');
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  h = h.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|h1|h2|h3|h4|li|tr)>/gi, '\n');
  h = h.replace(/<[^>]+>/g, ' ');
  return decode(h)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const AR = /[؀-ۿ]/;
const ratio = (s, re) => {
  const letters = s.replace(/[\s\d]/g, '');
  if (!letters.length) return 0;
  return (letters.match(new RegExp(re.source, 'g')) || []).length / letters.length;
};

/* ── JSON-LD extraction ──────────────────────────────────────── */

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch (_) {
      /* ignore malformed */
    }
  }
  return out;
}

function deepFind(node, pred, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  if (pred(node)) return node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = deepFind(v, pred, seen);
    if (hit) return hit;
  }
  return null;
}

const GRADES = [
  [/sahih|صحيح|صحیح/i, 'Sahih'],
  [/mutabar|mu(ʾ|')?tabar|معتبر/i, 'Mutabar'],
  [/hasan|حسن/i, 'Hasan'],
  [/muwath?thaq|موثق/i, 'Muwaththaq'],
  [/qawi(yy)?|قوي/i, 'Qawi'],
  [/da(ʾ|')?if|ضعيف|ضعیف/i, 'Daif'],
  [/mursal|مرسل/i, 'Mursal'],
];

function parseGrade(text) {
  for (const [re, label] of GRADES) if (re.test(text)) return label;
  return '';
}

/* ── hadith page parser ──────────────────────────────────────── */

function parsePage(html, url) {
  const parts = url.match(/\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!parts) return null;
  const [, c, b, ch, h] = parts.map(Number);

  const text = htmlToText(html);
  const blocks = jsonLdBlocks(html);

  let name = '';
  let canonical = '';
  let citation = [];
  let about = [];

  for (const block of blocks) {
    const node = deepFind(block, (n) => n && !Array.isArray(n) && Array.isArray(n.identifier) && n.identifier.some((x) => String(x).includes('thaqalayn:hadith')));
    if (node) {
      name = typeof node.name === 'string' ? node.name : '';
      canonical = (node.identifier || []).find((x) => /,/.test(String(x))) || '';
      citation = Array.isArray(node.citation) ? node.citation.filter((x) => typeof x === 'string') : [];
      about = Array.isArray(node.about) ? node.about : [];
      const ap = Array.isArray(node.additionalProperty) ? node.additionalProperty : [];
      for (const p of ap) if (p?.name === 'Grading' && p?.value) citation.push(String(p.value));
      break;
    }
  }

  // ── chapter title: from JSON-LD name, else the first heading, else the h1/h2
  let chapterTitle = name.replace(/\s*[-–—|].*$/, '').trim();
  if (!chapterTitle) {
    const h = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h) chapterTitle = decode(h[1].replace(/<[^>]+>/g, ' ')).trim();
  }
  chapterTitle = chapterTitle.replace(/^\s*Hadith\s*#?\d+.*$/i, '').trim();

  // ── body lines
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let arabic = '';
  let english = '';

  // Arabic matan = longest line that is predominantly Arabic script
  const arLines = lines.filter((l) => l.length > 12 && ratio(l, AR) > 0.55);
  if (arLines.length) arabic = arLines.sort((a, b) => b.length - a.length)[0];

  // English translation = the numbered line ("3. [3/3] Usul al-Kafi: …")
  const numRe = new RegExp(`^${h}\\s*[.\\u06D4]\\s+(.+)$`);
  for (const l of lines) {
    const m = l.match(numRe);
    if (m && m[1].length > 40 && ratio(m[1], /[A-Za-z]/) > 0.4) {
      english = m[1];
      break;
    }
  }
  if (!english) {
    const candidates = lines.filter(
      (l) => l.length > 80 && ratio(l, /[A-Za-z]/) > 0.62 && !/cookie|privacy|support|app store|google play/i.test(l)
    );
    if (candidates.length) english = candidates.sort((a, b) => b.length - a.length)[0];
  }

  // ── grading
  const gradeSource = [...citation, ...about.map((a) => `${a?.name || ''} ${a?.description || ''}`)].join(' | ');
  let grade = parseGrade(gradeSource);
  if (!grade) {
    const chip = html.match(/>(صحيح|صحیح|حسن|معتبر|موثق|ضعيف|ضعیف|مرسل|قوي)<\/[^>]+>/i);
    if (chip) grade = parseGrade(chip[1]);
    else {
      const near = lines.filter((l) => /grade|grader|reference|معتبر|صحيح/i.test(l)).join(' ');
      grade = parseGrade(near);
    }
  }

  // ── grader
  const graderMatch = gradeSource.match(/grader:\s*([^;|]+)/i) || gradeSource.match(/reference:\s*([^;|]+);\s*grader/i);
  const grader = (graderMatch ? graderMatch[1] : '').trim();

  if (!arabic && !english) return null;

  // tidy the "[3/3]" style source tag that Thaqalayn prefixes
  const clean = (s) =>
    s.replace(/^\[[^\]]*\]\s*/, '').replace(/\s{2,}/g, ' ').trim();

  return {
    id: `${c}/${b}/${ch}/${h}`,
    c, b, ch, h,
    chapterTitle,
    ar: clean(arabic).slice(0, 1400),
    en: clean(english).slice(0, 2400),
    grade,
    grader,
    canonical,
    url,
  };
}

/* ── main ────────────────────────────────────────────────────── */

async function main() {
  console.log(`[hadith] collections: ${COLLECTIONS.join(', ')} · ≤${PER_COLLECTION} each`);

  const idxXml = await get(`${BASE}/sitemap-index.xml`);
  if (!idxXml) throw new Error('could not read sitemap-index.xml');
  const maps = [...idxXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => /\/sitemap\/hadith-\d+\.xml/.test(u));
  console.log(`[hadith] sitemaps: ${maps.length}`);

  const wanted = new Map(); // collection -> urls
  for (const map of maps) {
    const xml = await get(map);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      const mm = u.match(/\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (!mm) continue;
      const c = Number(mm[1]);
      if (!COLLECTIONS.includes(c)) continue;
      const key = `${c}/${mm[2]}`;
      if (!wanted.has(key)) wanted.set(key, []);
      const arr = wanted.get(key);
      if (arr.length < PER_COLLECTION) arr.push(u);
    }
  }

  const urls = [...wanted.values()].flat();
  console.log(`[hadith] fetching ${urls.length} hadith pages…`);

  const records = [];
  let done = 0;
  let queue = [...urls];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const html = await get(url);
      if (html) {
        const rec = parsePage(html, url);
        if (rec) records.push(rec);
      }
      done += 1;
      if (done % 25 === 0) console.log(`[hadith] ${done}/${urls.length} … ${records.length} parsed`);
      await sleep(120);
    }
  });
  await Promise.all(workers);

  records.sort((a, b) => a.c - b.c || a.b - b.b || a.ch - b.ch || a.h - b.h);

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    source: 'thaqalayn.com',
    canonicalBase: 'https://thaqalayn.com',
    alias: 'thaqalyn.net',
    builtFrom: 'sitemap + hadith pages',
    collections: [...new Set(records.map((r) => r.c))].sort((a, b) => a - b),
    count: records.length,
    records,
  };
  const file = join(OUT_DIR, 'hadith.json');
  writeFileSync(file, JSON.stringify(payload));
  console.log(`[hadith] ✔ ${records.length} records → ${file.replace(ROOT + '/', '')}`);

  const withGrade = records.filter((r) => r.grade).length;
  const withAr = records.filter((r) => r.ar).length;
  console.log(`[hadith]   arabic: ${withAr}  ·  graded: ${withGrade}  ·  english: ${records.filter((r) => r.en).length}`);

  if (SAMPLE) {
    console.log('\n──────── SAMPLES ────────');
    for (const r of records.slice(0, SAMPLE)) {
      console.log(
        `\n# ${r.id}  [${r.grade || '—'}${r.grader ? ' / ' + r.grader : ''}]\n` +
          `chapter : ${r.chapterTitle}\n` +
          `ar      : ${r.ar.slice(0, 180)}\n` +
          `en      : ${r.en.slice(0, 220)}\n` +
          `url     : ${r.url}`
      );
    }
  }
}

main().catch((err) => {
  console.error('[hadith] FAILED', err);
  process.exit(1);
});
