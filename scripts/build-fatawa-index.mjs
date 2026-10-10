#!/usr/bin/env node
/**
 * SHIA AI · Fatawa index builder
 * ─────────────────────────────────────────────────────────────
 * Crawls the official English fiqh manuals published by the office of
 * Grand Ayatollah Sayyid Ali al-Husayni al-Sistani and turns each numbered
 * ruling into a searchable record that always carries its absolute source URL.
 *
 * Sources (HTML, chapter-per-page, stable URLs):
 *   https://www.sistani.org/english/book/48/  →  "Islamic Laws" (4th ed.)
 *   https://www.sistani.org/english/book/46/  →  "A Code of Practice For Muslims in the West"
 *
 * Nothing is paraphrased: the ruling text is copied verbatim, so the model can
 * only translate/format it — never invent it.
 *
 *   node scripts/build-fatawa-index.mjs [--sample 3]
 *
 * Env:
 *   FATAWA_BOOKS        csv of book ids (default 48,46)
 *   FATAWA_MAX_CHAPTERS max chapters per book (default 140)
 *   FATAWA_CONCURRENCY  parallel fetches (default 4)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/data/fatawa');

const UA = 'SHIA-AI-IndexBuilder/1.0 (+https://github.com/mrghalibspcpu/shai)';

const BOOKS = (process.env.FATAWA_BOOKS || '48,46')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const BOOK_META = {
  48: { marja: 'Grand Ayatollah Sayyid Ali al-Husayni al-Sistani', title: 'Islamic Laws', edition: '4th English edition (2023)' },
  46: { marja: 'Grand Ayatollah Sayyid Ali al-Husayni al-Sistani', title: 'A Code of Practice For Muslims in the West', edition: '' },
};

const MAX_CHAPTERS = Number(process.env.FATAWA_MAX_CHAPTERS || 140);
const CONCURRENCY = Number(process.env.FATAWA_CONCURRENCY || 4);
const SAMPLE = Number(process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch (_) {
      /* retry */
    }
    await sleep(500 * (i + 1));
  }
  return null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
const decode = (s) =>
  String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const stripTags = (h) => decode(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Pull the main content region of a sistani.org page. */
function mainHtml(html) {
  const m =
    html.match(/<div[^>]+class="[^"]*(?:entry-content|book-content|post-content|content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<nav)/i) ||
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return m ? m[1] : html;
}

function chapterLinks(html, bookId) {
  const out = new Map();
  for (const m of html.matchAll(/href="([^"]*\/english\/book\/(\d+)\/(\d+)\/[^"]*)"/gi)) {
    const [, href, b, id] = m;
    if (Number(b) !== bookId) continue;
    const label = stripTags('');
    void label;
    if (!out.has(id)) out.set(id, href.startsWith('http') ? href : `https://www.sistani.org${href}`);
  }
  return [...out.entries()].map(([id, url]) => ({ id: Number(id), url }));
}

const SITE_TAIL =
  /\s*[-|–—]\s*(Islamic Laws|A Code of Practice[^-|–—]*)\s*([-|–—]\s*)?(The Official Website.*)?$/i;

function pageTitle(html) {
  const region = mainHtml(html);
  const m =
    region.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    region.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
    region.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  let t = m ? stripTags(m[1]) : '';
  if (!t) {
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    t = tm ? stripTags(tm[1]) : '';
  }
  t = t.replace(SITE_TAIL, '').trim();
  t = t.replace(/\s*[-|–—]\s*The Official Website.*$/i, '').trim();
  if (/^The Official Website/i.test(t) || /^Books$/i.test(t)) t = '';
  return t.slice(0, 120);
}

const FATWA_BOILERPLATE =
  /the official website of the office|a code of practice for mus|read more|download file|search in:|^books$/i;

/**
 * Split chapter HTML into rulings. "Islamic Laws" numbers them "Ruling 123.",
 * the Code of Practice uses plain numbered paragraphs.
 */
function extractRulings(html, { url, bookId, chapterTitle, itemId }) {
  const region = mainHtml(html);
  const text = decode(
    region
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h1|h2|h3|h4|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  const out = [];
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 25);

  let current = null;
  const flush = () => {
    if (current && current.text.length > 40) out.push(current);
    current = null;
  };

  for (const line of lines) {
    if (/^(introduction|foreword|translator|editor|preface|appendix|glossary|works consulted)/i.test(line)) continue;
    if (FATWA_BOILERPLATE.test(line)) continue;
    const rm = line.match(/^Ruling\s+(\d+)\s*[.*]?\s*(.*)$/i);
    const nm = line.match(/^(\d{1,4})\s*[.)]\s+(.{40,})$/);
    if (rm) {
      flush();
      current = { no: Number(rm[1]), text: rm[2].trim(), kind: 'ruling' };
    } else if (nm) {
      flush();
      current = { no: Number(nm[1]), text: nm[2].trim(), kind: 'ruling' };
    } else if (/^(?:Q|Question)\s*[:\-]/i.test(line)) {
      flush();
      current = { no: null, text: line, kind: 'qa' };
    } else if (current) {
      if (FATWA_BOILERPLATE.test(line)) continue;
      current.text += ` ${line}`;
    } else if (line.length > 90) {
      current = { no: null, text: line, kind: 'note' };
    }
  }
  flush();

  return out
    .filter((r) => r.text.length > 60 && !FATWA_BOILERPLATE.test(r.text.slice(0, 120)))
    .slice(0, 120)
    .map((r, i) => ({
      id: `sistani-${bookId}-${itemId}-${r.no ?? i}`,
      marja: 'Sayyid Ali al-Sistani',
      marjaFull: BOOK_META[bookId]?.marja || 'Sayyid Ali al-Sistani',
      book: BOOK_META[bookId]?.title || `Book ${bookId}`,
      edition: BOOK_META[bookId]?.edition || '',
      chapter: chapterTitle,
      rulingNo: r.no,
      kind: r.kind,
      en: r.text.replace(/\s+/g, ' ').trim().slice(0, 2200),
      url,
    }));
}

/* ── main ────────────────────────────────────────────────────── */

async function main() {
  const all = [];

  for (const bookId of BOOKS) {
    const indexUrl = `https://www.sistani.org/english/book/${bookId}/`;
    const idx = await get(indexUrl);
    if (!idx) {
      console.error(`[fatawa] ✖ could not read ${indexUrl}`);
      continue;
    }
    const links = chapterLinks(idx, bookId).slice(0, MAX_CHAPTERS);
    console.log(`[fatawa] book ${bookId}: ${links.length} chapters`);

    let queue = [...links];
    let done = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        const html = await get(item.url);
        if (html) {
          const title = pageTitle(html);
          const recs = extractRulings(html, { url: item.url, bookId, chapterTitle: title, itemId: item.id });
          all.push(...recs);
        }
        done += 1;
        if (done % 20 === 0) console.log(`[fatawa] book ${bookId}: ${done}/${links.length} · ${all.length} rulings`);
        await sleep(150);
      }
    });
    await Promise.all(workers);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    sources: BOOKS.map((b) => ({
      id: b,
      marja: BOOK_META[b]?.marja,
      title: BOOK_META[b]?.title,
      url: `https://www.sistani.org/english/book/${b}/`,
    })),
    note: 'Rulings copied verbatim from the official English editions. Always shown with their absolute source URL.',
    count: all.length,
    records: all,
  };
  const file = join(OUT_DIR, 'fatawa.json');
  writeFileSync(file, JSON.stringify(payload));
  console.log(`[fatawa] ✔ ${all.length} rulings → ${file.replace(ROOT + '/', '')}`);

  if (SAMPLE) {
    console.log('\n──────── SAMPLES ────────');
    for (const r of all.slice(0, SAMPLE)) {
      console.log(`\n# ${r.id}\nbook   : ${r.book}\nchapter: ${r.chapter}\nen     : ${r.en.slice(0, 220)}\nurl    : ${r.url}`);
    }
  }
}

main().catch((err) => {
  console.error('[fatawa] FAILED', err);
  process.exit(1);
});
