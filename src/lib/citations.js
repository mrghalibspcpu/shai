/**
 * SHIA AI · Citation extraction & rendering
 * ─────────────────────────────────────────────────────────────
 * The model ends every answer with a fenced ```refs block that lists the IDs
 * of the records it used. Each ID is resolved against the on-device dataset
 * (dataset.js). Only a resolved record produces a card:
 *   • the book / chapter / hadith numbers, grade and English text come from the
 *     dataset row, not from the model;
 *   • the link is the dataset URL (absolute https://…), never a model string;
 *   • an ID that is not in the dataset is discarded.
 *
 * Accepted shapes (most → least preferred):
 *   1. ```refs … [{"id":"1/0/1/1"}, {"id":"sistani-48-2119-18"}] … ```
 *   2. ```refs … [{"surah":2,"verse":255}] … ```   (Qurʾān, no dataset needed)
 *   3. Inline "thaqalayn:c/b/ch/h" and "quran:s/v" tokens (legacy) — same rules.
 */

import { parsePath, quranUrl, surahName, chapterUrl, bookUrl, hadithUrlAr, safeHref } from './sources.js';
import { getHadith, getFatwa } from './dataset.js';

const INLINE_PATH = /thaqalayn:\s*(\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*\d{1,4}\s*\/\s*\d{1,4})/gi;
const INLINE_QURAN = /quran:\s*(\d{1,3})\s*\/\s*(\d{1,3})/gi;

const GRADING_MAP = [
  [/sahih|صحیح|صحيح/i, { cls: 'sahih', label: 'Ṣaḥīḥ' }],
  [/mu(ʾ|')?tabar|معتبر/i, { cls: 'sahih', label: 'Muʿtabar' }],
  [/hasan|حسن/i, { cls: 'hasan', label: 'Ḥasan' }],
  [/muwath?thaq|موثق/i, { cls: 'hasan', label: 'Muwaththaq' }],
  [/qawi(yy)?|قوی/i, { cls: 'hasan', label: 'Qawī' }],
  [/da(ʾ|')?if|ضعیف|ضعيف|majhul|مجهول/i, { cls: 'daif', label: 'Ḍaʿīf' }],
  [/mursal|مرسل/i, { cls: 'daif', label: 'Mursal' }],
];

export function gradingInfo(raw) {
  const g = String(raw || '').trim();
  if (!g) return null;
  for (const [re, info] of GRADING_MAP) if (re.test(g)) return { ...info, raw: g };
  return { cls: '', label: g, raw: g };
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Urdu display name for a mujtahid, when we have one. */
export function marjaUrdu(marja = '') {
  if (/sistani/i.test(marja)) return 'آیت اللہ العظمیٰ سید علی حسینی سیستانی';
  return '';
}

/* ── Dataset-backed reference builders ───────────────────────── */

function hadithRef(rec, n) {
  const vol = rec.volume ? ` · Vol. ${rec.volume}` : '';
  const volUr = rec.volume ? ` · جلد ${rec.volume}` : '';
  return {
    kind: 'hadith',
    n,
    valid: true,
    id: rec.id,
    url: rec.url,
    path: {
      path: rec.id,
      url: rec.url,
      urlAr: hadithUrlAr(rec.c, rec.b, rec.ch, rec.h),
      chapterLink: chapterUrl(rec.c, rec.b, rec.ch),
      bookLink: bookUrl(rec.c),
    },
    title: `${rec.collectionEn}${vol} · Book ${rec.b} · Ch. ${rec.ch} · Hadith #${rec.h}`,
    titleUr: `${rec.collectionUr}${volUr} · کتاب ${rec.b} · باب ${rec.ch} · حدیث #${rec.h}`,
    author: rec.author,
    chapterTitle: rec.chapterTitle,
    grading: gradingInfo(rec.grade),
    grader: rec.grader,
    note: '',
    arabic: rec.ar,
  };
}

function fatwaRef(f, n) {
  return {
    kind: 'fatwa',
    n,
    valid: true,
    id: f.id,
    url: f.url,
    marja: f.marja,
    marjaUr: marjaUrdu(f.marja),
    book: f.book,
    rulingNo: f.rulingNo,
    text: f.en,
    sourceName: f.sourceName,
    grading: null,
    grader: '',
    note: '',
  };
}

/**
 * While an answer is being generated, the set of record IDs retrieval actually
 * supplied. A citation to any other (even valid) record is discarded, so the
 * model cannot attach an unrelated source. `null` = no restriction (history).
 */
let allowedIds = null;
export function setAllowedRefIds(ids) {
  allowedIds = ids ? new Set(ids) : null;
}

/** Coerce one raw ref object into a normalised citation, or null if unverifiable. */
export function normaliseRef(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const n = Number(raw.n ?? index + 1) || index + 1;

  // ── 1 · Dataset id (hadith or fatwa): the only way to cite those ──
  const id = raw.id != null ? String(raw.id).trim() : '';
  if (id) {
    if (allowedIds && !allowedIds.has(id)) return null;
    const fatwa = getFatwa(id);
    if (fatwa) return fatwaRef(fatwa, n);
    const hadith = getHadith(id);
    if (hadith) return hadithRef(hadith, n);
    return null; // not in the dataset → never shown
  }

  // ── 2 · Legacy "c/b/ch/h" path, resolved against the dataset ──
  const pathStr = raw.path || raw.ref || '';
  const p = parsePath(pathStr);
  if (p) {
    if (allowedIds && !allowedIds.has(p.path)) return null;
    const rec = getHadith(p.path);
    return rec ? hadithRef(rec, n) : null;
  }

  // ── 3 · Qurʾān ──
  const s = Number(raw.surah ?? raw.q);
  const v = Number(raw.verse);
  if (Number.isFinite(s) && s >= 1 && s <= 114) {
    const url = quranUrl(s, Number.isFinite(v) ? v : null);
    const name = surahName(s) || `Surah ${s}`;
    return {
      kind: 'quran',
      n,
      valid: true,
      surah: s,
      verse: Number.isFinite(v) ? v : null,
      url,
      title: Number.isFinite(v) ? `${name} · ${s}:${v}` : `${name} · Surah ${s}`,
      titleUr: Number.isFinite(v) ? `سورہ ${name} · ${s}:${v}` : `سورہ ${name}`,
      chapterTitle: String(raw.title || ''),
      grading: null,
      grader: '',
      note: String(raw.note || ''),
      arabic: '',
    };
  }

  // ── 4 · Free-text reference: shown, but explicitly unverified, never linked ──
  if (raw.title || raw.note) {
    const label = String(raw.title || raw.note);
    return {
      kind: 'text',
      n,
      valid: false,
      title: label,
      titleUr: label,
      chapterTitle: '',
      grading: null,
      grader: '',
      note: '',
      arabic: '',
    };
  }
  return null;
}

/** Try hard to read a JSON array out of whatever the model emitted. */
function tryParseJsonArray(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed?.refs ? parsed.refs : null;
  } catch (_) {
    /* fall through to line-by-line */
  }
  const out = [];
  for (const line of trimmed.split('\n')) {
    const l = line.trim().replace(/,$/, '');
    if (!l || !l.startsWith('{')) continue;
    try {
      out.push(JSON.parse(l));
    } catch (_) {
      /* skip malformed line */
    }
  }
  return out.length ? out : null;
}

/**
 * Split a (possibly still-streaming) answer into visible markdown + citations.
 * @returns {{ body: string, refs: Array, streaming: boolean }}
 */
export function extract(raw) {
  const text = String(raw || '');
  const start = text.search(/```refs/i);
  let body = text;
  let refs = [];
  let streaming = false;

  if (start !== -1) {
    const after = text.slice(start);
    const close = after.indexOf('```', 7); // 7 = length of the "```refs" opener
    if (close === -1) {
      // Still streaming — hide the half-written block entirely.
      streaming = true;
      body = text.slice(0, start);
    } else {
      const nl = after.indexOf('\n');
      const inner = nl === -1 ? '' : after.slice(nl + 1, close);
      body = text.slice(0, start) + after.slice(close + 3);
      const arr = tryParseJsonArray(inner);
      if (arr) refs = arr.map(normaliseRef).filter(Boolean);
    }
  }

  if (!refs.length) {
    const found = [];
    for (const mm of body.matchAll(INLINE_PATH)) {
      const r = normaliseRef({ path: mm[1].replace(/\s+/g, '') }, found.length);
      if (r) found.push(r);
    }
    for (const mm of body.matchAll(INLINE_QURAN)) {
      const r = normaliseRef({ surah: mm[1], verse: mm[2] }, found.length);
      if (r) found.push(r);
    }
    refs = found;
  }
  refs = refs.map((r, i) => ({ ...r, n: i + 1 }));

  // Remove any literal "thaqalayn:" / "quran:" tokens that leaked into prose.
  body = body.replace(INLINE_PATH, '').replace(INLINE_QURAN, '');

  return { body: body.replace(/\n{3,}/g, '\n\n').trimEnd(), refs, streaming };
}

/** Render the Reference (Hawalajat) section. */
export function renderRefs(refs, messageId = '') {
  if (!refs?.length) return '';

  const items = refs
    .map((r) => {
      const id = `${messageId}-ref-${r.n}`;
      const link = (href, label, ghost = false) =>
        safeHref(href)
          ? `<a class="ref__link${ghost ? ' ref__link--ghost' : ''}" href="${esc(safeHref(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : '';

      if (r.kind === 'fatwa') {
        const who = r.marjaUr ? `${esc(r.marjaUr)} <small>${esc(r.marja)}</small>` : esc(r.marja);
        return `
      <li class="ref ref--fatwa" id="${id}">
        <span class="ref__n">${r.n}</span>
        <div class="ref__main">
          <div class="ref__book">${who}</div>
          <div class="ref__meta">
            <span class="tag tag--fatwa">فتویٰ · Fatwa</span>
            <span class="tag">${esc(r.book)}</span>
            ${r.rulingNo != null ? `<span class="tag">Ruling ${esc(r.rulingNo)}</span>` : ''}
          </div>
          <blockquote class="ref__text" dir="ltr" lang="en">${esc(r.text)}</blockquote>
          <div class="ref__acts">${link(r.url, `↗ ${esc(r.sourceName || 'sistani.org')} پر فتویٰ دیکھیں`)}</div>
          <div class="ref__path">${esc(r.url)}</div>
        </div>
      </li>`;
      }

      if (r.kind === 'hadith') {
        const gradeTag = r.grading
          ? `<span class="tag tag--${r.grading.cls || 'warn'}">${esc(r.grading.label)}</span>`
          : '<span class="tag">درجہ درج نہیں</span>';
        return `
      <li class="ref" id="${id}">
        <span class="ref__n">${r.n}</span>
        <div class="ref__main">
          <div class="ref__book">${esc(r.titleUr)}</div>
          <div class="ref__meta">
            <span class="tag">Hadith</span>${gradeTag}
            ${r.author ? `<span class="tag">${esc(r.author)}</span>` : ''}
            ${r.grader ? `<span class="tag">${esc(r.grader)}</span>` : ''}
            <span class="tag tag--sahih">verified id</span>
          </div>
          ${r.chapterTitle ? `<div class="ref__note">${esc(r.chapterTitle)}</div>` : ''}
          <div class="ref__acts">
            ${link(r.url, '↗ Hadith on Thaqalayn')}
            ${link(r.path.chapterLink, 'Chapter', true)}
            ${link(r.path.bookLink, 'Book', true)}
          </div>
          <div class="ref__path">${esc(r.url)}</div>
        </div>
      </li>`;
      }

      const badge =
        r.valid
          ? '<span class="tag tag--sahih">verified id</span>'
          : '<span class="tag tag--warn" title="اس حوالے کی شناخت خودکار طور پر تصدیق نہیں ہو سکی">unverified</span>';
      const kindTag = r.kind === 'quran' ? '<span class="tag tag--quran">Qurʾān</span>' : '<span class="tag">Reference</span>';
      const links = r.kind === 'quran' ? link(r.url, '↗ Āyah on Thaqalayn') : '';
      const path = r.kind === 'quran' ? `<div class="ref__path">${esc(r.url)}</div>` : '';
      return `
      <li class="ref" id="${id}">
        <span class="ref__n">${r.n}</span>
        <div class="ref__main">
          <div class="ref__book">${esc(r.titleUr || r.title)}</div>
          <div class="ref__meta">${kindTag}${badge}</div>
          ${r.chapterTitle ? `<div class="ref__note">${esc(r.chapterTitle)}</div>` : ''}
          ${r.note ? `<div class="ref__note">${esc(r.note)}</div>` : ''}
          <div class="ref__acts">${links}</div>
          ${path}
        </div>
      </li>`;
    })
    .join('');

  return `
  <section class="refs" dir="rtl">
    <div class="refs__title">حوالہ جات <small>References · Thaqalayn · sistani.org</small></div>
    <ol class="refs__list">${items}</ol>
  </section>`;
}
