#!/usr/bin/env node
/**
 * SHIA AI · Thaqalayn hadith index builder
 * ─────────────────────────────────────────────────────────────
 * Crawls thaqalayn.com (the domain thaqalyn.net resolves to), pulls the hadith
 * pages for the configured collections, and writes a compact JSON index that
 * the app ships and searches **offline, on-device**.
 *
 * This index is the only source of truth for the zero-hallucination engine:
 * the model is only ever shown records that really exist here, so it cannot
 * invent a matan, a book, a chapter or a URL.
 *
 *   node scripts/build-hadith-index.mjs [--sample 3]
 *
 * Env:
 *   HADITH_COLLECTIONS    csv of collection ids
 *   HADITH_PER_COLLECTION max hadiths per collection
 *   HADITH_CONCURRENCY    parallel fetches
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* Legacy thaqalayn.com crawl — kept outside public/ so it never ships in the
 * app bundle; scripts/build-corpus.mjs reads the gradings out of it.        */
const OUT_DIR = join(ROOT, 'data/legacy/thaqalayn');

const BASE = 'https://thaqalayn.com';
const UA = 'SHIA-AI-IndexBuilder/1.0 (+https://github.com/mrghalibspcpu/shai)';
const IN_CI = process.env.GITHUB_ACTIONS === 'true';

/** Visible in `gh run view` even when the log archive is unreachable. */
const note = (msg) => console.log(IN_CI ? `::notice title=hadith-index::${msg}` : msg);

const COLLECTIONS = (process.env.HADITH_COLLECTIONS || '1,2,9,10,14,23,24,29,32,39')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const PER_COLLECTION = Number(process.env.HADITH_PER_COLLECTION || 60);
const CONCURRENCY = Number(process.env.HADITH_CONCURRENCY || 6);
const SAMPLE = Number(process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : 0);

/* ── fetch ───────────────────────────────────────────────────── */

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

/* ── text cleanup ────────────────────────────────────────────── */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

const decode = (s) =>
  String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

/** Drop private-use glyphs (Thaqalayn renders ﷺ / (a.s) through the PUA). */
const stripPua = (s) => String(s || '').replace(/[-]/g, ' ');

function htmlToText(html) {
  let h = String(html || '');
  h = h.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  h = h.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|h1|h2|h3|h4|h5|li|tr|section|article)>/gi, '\n');
  h = h.replace(/<[^>]+>/g, ' ');
  return stripPua(decode(h))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const AR = /[؀-ۿ]/;
const ratio = (s, re) => {
  const letters = String(s || '').replace(/[\s\d]/g, '');
  if (!letters.length) return 0;
  return (letters.match(new RegExp(re.source, 'g')) || []).length / letters.length;
};

/** Site chrome that must never be mistaken for hadith content. */
const BOILERPLATE =
  /read shia hadith|get the app for ios|cookie preferences|privacy policy|support us|customize cookies|save preferences|thaqalayn, now on mobile|everything on the web|app store|google play|new\s*new/i;

/* ── JSON-LD ─────────────────────────────────────────────────── */

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch (_) {
      /* malformed */
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
  [/mutabar|mu(ʾ|')?tabar|معتبر/i, 'Mutabar'],
  [/sahih|صحيح|صحیح/i, 'Sahih'],
  [/hasan|حسن/i, 'Hasan'],
  [/muwath?thaq|موثق/i, 'Muwaththaq'],
  [/qawi(yy)?|قوي|قوی/i, 'Qawi'],
  [/mursal|مرسل/i, 'Mursal'],
  [/da(ʾ|')?if|ضعيف|ضعیف|majhul|مجهول/i, 'Daif'],
];

const parseGrade = (text) => {
  for (const [re, label] of GRADES) if (re.test(String(text || ''))) return label;
  return '';
};

/* ── page parser ─────────────────────────────────────────────── */

function headings(html) {
  const out = [];
  for (const m of html.matchAll(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = stripPua(decode(String(m[2]).replace(/<[^>]+>/g, ' ')))
      .replace(/\s+/g, ' ')
      .trim();
    if (t) out.push({ tag: m[1].toLowerCase(), text: t, at: m.index });
  }
  return out;
}

const COLLECTION_NAMES =
  /^(al[- ]kāfi|al[- ]kafi|kitāb|muʿjam|nahj|man lā|kāmil|kamāl|thawāb|al[- ]khiṣāl|ʿuyūn|al[- ]tawḥīd|al[- ]amālī|faḍā|ṣifāt|risālat|tahdhīb|al[- ]imāma|hadith|chapter|book)\b/i;

function pickChapterTitle(html, text) {
  // The chapter title is the heading that sits immediately before the
  // breadcrumb line   {Collection}|Volume N|Book N|Chapter N
  const crumbAt = text.search(/Volume\s*\d+/i);
  const hs = headings(html);
  if (crumbAt !== -1 && hs.length) {
    const before = hs.filter((h) => h.at < crumbAt);
    if (before.length) {
      const last = before[before.length - 1].text;
      if (last.length > 3 && !/^Hadith\s*#?\d+$/i.test(last)) return last;
    }
  }
  // Otherwise: first heading that is neither the collection name nor a nav item
  for (const h of hs) {
    const t = h.text;
    if (t.length < 8) continue;
    if (COLLECTION_NAMES.test(t)) continue;
    if (/^Hadith\s*#?\d+$/i.test(t)) continue;
    if (/the comprehensive shia library|support/i.test(t)) continue;
    return t;
  }
  return '';
}

function parsePage(html, url) {
  const parts = url.match(/\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!parts) return null;
  const [, c, b, ch, h] = parts.map(Number);

  const text = htmlToText(html);

  // ── JSON-LD (grading + grader + canonical reference)
  let canonical = '';
  let citation = [];
  let about = [];
  let jsonld = false;
  for (const block of jsonLdBlocks(html)) {
    const node = deepFind(
      block,
      (n) => n && !Array.isArray(n) && Array.isArray(n.identifier) && n.identifier.some((x) => String(x).includes('thaqalayn:hadith'))
    );
    if (!node) continue;
    jsonld = true;
    canonical = (node.identifier || []).find((x) => /,/.test(String(x))) || '';
    citation = Array.isArray(node.citation) ? node.citation.filter((x) => typeof x === 'string') : [];
    about = Array.isArray(node.about) ? node.about : [];
    for (const p of Array.isArray(node.additionalProperty) ? node.additionalProperty : []) {
      if (p?.name === 'Grading' && p?.value) citation.push(String(p.value));
      if (p?.name === 'Canonical reference' && p?.value) canonical = canonical || String(p.value);
    }
    break;
  }

  const chapterTitle = pickChapterTitle(html, text);

  // ── volume from the breadcrumb
  const volMatch = text.match(/Volume\s*(\d+)/i);
  const volume = volMatch ? Number(volMatch[1]) : null;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // ── Arabic matan = longest predominantly-Arabic line
  const arLines = lines.filter((l) => l.length > 12 && ratio(l, AR) > 0.5 && !BOILERPLATE.test(l));
  const arabic = arLines.length ? arLines.sort((x, y) => y.length - x.length)[0] : '';

  // ── English translation: the numbered "[x/y] Source: …" line
  let english = '';
  const numRe = new RegExp(`^${h}\\s*[.\\u06D4]\\s+(\\[[^\\]]*\\]\\s*)?(.{40,})$`);
  for (const l of lines) {
    const m = l.match(numRe);
    if (m && ratio(m[2], /[A-Za-z]/) > 0.45 && !BOILERPLATE.test(l)) {
      english = m[2];
      break;
    }
  }
  if (!english) {
    const candidates = lines.filter(
      (l) => l.length > 90 && ratio(l, /[A-Za-z]/) > 0.62 && !BOILERPLATE.test(l) && !/\|Volume\s*\d+/i.test(l)
    );
    if (candidates.length) english = candidates.sort((x, y) => y.length - x.length)[0];
  }

  // ── grading
  const gradeSource = [...citation, ...about.map((a) => `${a?.name || ''} ${a?.description || ''}`)].join(' | ');
  let grade = parseGrade(gradeSource);
  if (!grade) {
    const chip = html.match(/>(صحيح|صحیح|حسن|معتبر|موثق|ضعيف|ضعیف|مرسل|قوي)<\/[^>]+>/i);
    if (chip) grade = parseGrade(chip[1]);
    else grade = parseGrade(lines.filter((l) => /grade|grader|معتبر|صحيح|ضعيف/i.test(l)).join(' '));
  }
  const graderMatch = gradeSource.match(/grader:\s*([^;|]+)/i);
  const grader = (graderMatch ? graderMatch[1] : '').trim();

  if (!arabic && !english) return null;

  const clean = (s) => s.replace(/^\[[^\]]*\]\s*/, '').replace(/^[\d]+\s*[.]\s*/, '').replace(/\s{2,}/g, ' ').trim();

  return {
    id: `${c}/${b}/${ch}/${h}`,
    c, b, ch, h,
    volume,
    chapterTitle,
    ar: clean(arabic).slice(0, 1500),
    en: clean(english).slice(0, 2400),
    grade,
    grader,
    canonical,
    jsonld,
    url,
  };
}

/* ── main ────────────────────────────────────────────────────── */

async function main() {
  note(`collections ${COLLECTIONS.join(',')} · max ${PER_COLLECTION}/collection`);

  const idxXml = await get(`${BASE}/sitemap-index.xml`);
  if (!idxXml) throw new Error('could not read sitemap-index.xml');
  const maps = [...idxXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => /\/sitemap\/hadith-\d+\.xml/.test(u));
  note(`sitemaps: ${maps.length}`);

  const wanted = new Map();
  const seenUrl = new Set();
  for (const map of maps) {
    const xml = await get(map);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      // skip the Arabic-mirror URLs (/ar/hadith/…) — same record, different skin
      if (/\/ar\/hadith\//.test(u)) continue;
      const mm = u.match(/\/hadith\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (!mm) continue;
      const c = Number(mm[1]);
      if (!COLLECTIONS.includes(c)) continue;
      if (seenUrl.has(u)) continue;
      const key = `${c}/${mm[2]}`;
      if (!wanted.has(key)) wanted.set(key, []);
      const arr = wanted.get(key);
      if (arr.length < PER_COLLECTION) {
        arr.push(u);
        seenUrl.add(u);
      }
    }
  }

  const urls = [...wanted.values()].flat();
  note(`fetching ${urls.length} hadith pages`);

  const byId = new Map();
  let done = 0;
  let queue = [...urls];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const html = await get(url);
      if (html) {
        const rec = parsePage(html, url);
        if (rec) {
          const prev = byId.get(rec.id);
          // prefer the richest version of a duplicated record
          if (!prev || (prev.en ? 0 : 1) < (rec.en ? 0 : 1) || rec.en.length > prev.en.length) byId.set(rec.id, rec);
        }
      }
      done += 1;
      await sleep(110);
    }
  });
  await Promise.all(workers);

  const records = [...byId.values()].sort((a, b) => a.c - b.c || a.b - b.b || a.ch - b.ch || a.h - b.h);

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    source: 'thaqalayn.com',
    canonicalBase: 'https://thaqalayn.com',
    alias: 'thaqalyn.net (redirects to thaqalayn.com)',
    builtFrom: 'sitemap + hadith pages',
    collections: [...new Set(records.map((r) => r.c))].sort((a, b) => a - b),
    count: records.length,
    records,
  };
  const file = join(OUT_DIR, 'hadith.json');
  writeFileSync(file, JSON.stringify(payload));

  const n = (p) => records.filter(p).length;
  note(`records=${records.length} ar=${n((r) => r.ar)} en=${n((r) => r.en)} graded=${n((r) => r.grade)} chapter=${n((r) => r.chapterTitle)} jsonld=${n((r) => r.jsonld)}`);

  if (SAMPLE) {
    console.log('\n──────── SAMPLES ────────');
    for (const r of records.slice(0, SAMPLE)) {
      console.log(
        `\n# ${r.id} [${r.grade || '—'}${r.grader ? ' / ' + r.grader : ''}] vol=${r.volume}\n` +
          `chapter : ${r.chapterTitle}\n` +
          `ar      : ${r.ar.slice(0, 170)}\n` +
          `en      : ${r.en.slice(0, 210)}\n` +
          `url     : ${r.url}`
      );
    }
  }
}

main().catch((err) => {
  console.error('[hadith] FAILED', err);
  process.exit(1);
});
