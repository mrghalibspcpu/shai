/**
 * SHAI · Citation extraction & rendering
 * ─────────────────────────────────────────────────────────────
 * The model is instructed to end every answer with a fenced ```refs block
 * holding a JSON array. That gives us *structured* citations we can validate
 * against the Thaqalayn registry before we ever render a link — the core
 * anti-hallucination safeguard of the app.
 *
 * Accepted shapes (most → least preferred):
 *   1. ```refs … json array … ```
 *   2. Inline thaqalayn:1/2/17/14 tokens
 *   3. Inline quran:2/255 tokens
 */

import { parsePath, collection, quranUrl, surahName } from './sources.js';


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

/* ── Library ids (grounded mode) ─────────────────────────────
 * In grounded mode the model may cite ONLY the ids of the sources retrieved
 * for that turn ([S1], [S2] …). `setCitationContext` receives that map. Any
 * other id is rejected and shown as not-in-sources; the URL and Arabic text
 * always come from the source record, never from the model. */

let contextMap = null;

/** @param {Map<string, object>|null} map  id → view (see library.js viewOf) */
export function setCitationContext(map) {
  contextMap = map instanceof Map ? map : null;
}

const LIB_ID = /^[a-z][a-z0-9-]*:\d+(?::\d+)*$/i;

function normaliseLibraryRef(id, raw, index) {
  const n = Number(raw.n ?? index + 1) || index + 1;
  const rec = contextMap?.get(id);
  if (!rec) {
    return {
      kind: 'library',
      n,
      id,
      valid: false,
      allowed: false,
      status: 'rejected',
      url: null,
      title: id,
      titleUr: id,
      tag: '',
      arabic: '',
      english: '',
      chapterTitle: '',
      grading: null,
      grader: '',
      note: '',
    };
  }
  return {
    kind: 'library',
    n,
    id,
    valid: rec.verified === true,
    allowed: true,
    status: rec.status,
    url: rec.url || null,
    title: rec.citation || id,
    titleUr: rec.citation || id,
    tag: rec.tag || '',
    arabic: rec.arabic || '',
    english: rec.english || '',
    chapterTitle: '',
    grading: null,
    grader: '',
    note: raw.note && typeof raw.note === 'string' ? raw.note : '',
  };
}

/** Coerce a single raw ref object into a normalised citation record. */
export function normaliseRef(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const libId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (LIB_ID.test(libId)) return normaliseLibraryRef(libId, raw, index);
  const src = {
    path: raw.path || raw.id || raw.ref || '',
    collection: raw.collection ?? raw.c ?? raw.book_id,
    book: raw.book ?? raw.b,
    chapter: raw.chapter ?? raw.ch,
    hadith: raw.hadith ?? raw.h,
    surah: raw.surah ?? raw.sura,
    verse: raw.verse ?? raw.ayah,
    grading: raw.grading ?? raw.grade ?? raw.hukm,
    grader: raw.grader ?? raw.muhaddith,
    title: raw.title ?? raw.chapter_title ?? raw.topic,
    note: raw.note ?? raw.remark,
    arabic: raw.arabic ?? raw.matan,
    q: raw.q,
  };

  // ── Hadith citation ────────────────────────────────────────
  let p = parsePath(src.path);
  if (!p && [src.collection, src.book, src.chapter, src.hadith].every((v) => v != null && v !== '')) {
    p = parsePath(`${src.collection}/${src.book}/${src.chapter}/${src.hadith}`);
  }

  if (p) {
    const meta = collection(p.collection);
    const vol = meta?.vol ? ` · Vol. ${meta.vol}` : '';
    return {
      kind: 'hadith',
      n: Number(raw.n ?? index + 1) || index + 1,
      path: p,
      valid: p.valid,
      title: [meta?.en || `Collection ${p.collection}`, vol, `Book ${p.book}`, `Ch. ${p.chapter}`, `Hadith ${p.hadith}`]
        .filter(Boolean)
        .join(' · '),
      titleUr: [meta?.ur || `مجموعہ ${p.collection}`, meta?.vol ? `جلد ${meta.vol}` : '', `کتاب ${p.book}`, `باب ${p.chapter}`, `حدیث ${p.hadith}`]
        .filter(Boolean)
        .join(' · '),
      author: meta?.author || '',
      chapterTitle: src.title || '',
      grading: gradingInfo(src.grading),
      grader: src.grader || '',
      note: src.note || '',
      arabic: src.arabic || '',
    };
  }

  // ── Quran citation ─────────────────────────────────────────
  const s = Number(src.surah ?? src.q);
  const v = Number(src.verse);
  if (Number.isFinite(s) && s >= 1 && s <= 114) {
    const url = quranUrl(s, Number.isFinite(v) ? v : null);
    const name = surahName(s) || `Surah ${s}`;
    return {
      kind: 'quran',
      n: Number(raw.n ?? index + 1) || index + 1,
      valid: true,
      surah: s,
      verse: Number.isFinite(v) ? v : null,
      url,
      title: Number.isFinite(v) ? `${name} · ${s}:${v}` : `${name} · Surah ${s}`,
      titleUr: Number.isFinite(v) ? `سورہ ${name} · ${s}:${v}` : `سورہ ${name}`,
      chapterTitle: src.title || '',
      grading: null,
      grader: '',
      note: src.note || '',
      arabic: src.arabic || '',
    };
  }

  // ── Free-text citation (no verifiable id) ──────────────────
  if (src.title || src.note || src.q) {
    return {
      kind: 'text',
      n: Number(raw.n ?? index + 1) || index + 1,
      valid: false,
      title: src.title || src.q || src.note || 'حوالہ',
      titleUr: src.title || src.q || src.note || 'حوالہ',
      chapterTitle: '',
      grading: gradingInfo(src.grading),
      grader: src.grader || '',
      note: src.note && src.note !== src.title ? src.note : '',
      arabic: src.arabic || '',
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
      if (arr) refs = arr.map(normaliseRef).filter(Boolean).map((r, i) => ({ ...r, n: i + 1 }));
    }
  }

  if (!refs.length) {
    const found = [];
    for (const mm of body.matchAll(INLINE_PATH)) {
      const p = parsePath(mm[1]);
      if (p) found.push(normaliseRef({ path: p.path }, found.length));
    }
    for (const mm of body.matchAll(INLINE_QURAN)) {
      found.push(normaliseRef({ surah: mm[1], verse: mm[2] }, found.length));
    }
    refs = found;
  }

  // Remove any literal "thaqalayn:" / "quran:" tokens that leaked into prose.
  body = body.replace(INLINE_PATH, '').replace(INLINE_QURAN, '');

  return { body: body.replace(/\n{3,}/g, '\n\n').trimEnd(), refs, streaming };
}

function libraryBadge(r) {
  if (!r.allowed) {
    return '<span class="tag tag--warn" title="یہ حوالہ اس سوال کے لیے دیے گئے ماخذوں میں نہیں تھا">ماخذ میں موجود نہیں — مسترد</span>';
  }
  if (r.status === 'verified') {
    return '<span class="tag tag--sahih" title="لنک کی live صفحے پر تصدیق ہو چکی ہے">verified link</span>';
  }
  if (r.status === 'no-url') {
    return '<span class="tag tag--warn" title="اس ماخذ کا کوئی online لنک دستیاب نہیں">no online link</span>';
  }
  const why = r.status === 'mismatch' ? 'لنک پر متن مختلف ملا' : 'لنک ابھی خودکار طور پر تصدیق نہیں ہوا';
  return `<span class="tag tag--warn" title="${esc(why)}">${r.status === 'mismatch' ? 'mismatch' : 'not yet verified'}</span>`;
}

/** Render the Reference (Hawalajat) section. */
export function renderRefs(refs, messageId = '') {
  if (!refs?.length) return '';

  const items = refs
    .map((r) => {
      const id = `${messageId}-ref-${r.n}`;
      const badge =
        r.kind === 'library'
          ? libraryBadge(r)
          : r.valid
          ? '<span class="tag tag--sahih">id ok · متن غیر تصدیق شدہ</span>'
          : '<span class="tag tag--warn" title="اس حوالے کی شناخت خودکار طور پر تصدیق نہیں ہو سکی">unverified</span>';

      const gradeTag = r.grading
        ? `<span class="tag tag--${r.grading.cls || 'warn'}">${esc(r.grading.label)}</span>`
        : '';

      const kindTag =
        r.kind === 'quran'
          ? '<span class="tag tag--quran">Qurʾān</span>'
          : r.kind === 'hadith'
          ? `<span class="tag">Hadith</span>`
          : '<span class="tag">Reference</span>';

      let links = '';
      if (r.kind === 'library') {
        links = r.url
          ? `<a class="ref__link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">↗ ماخذ کا صفحہ (live)</a>`
          : '';
      } else if (r.kind === 'hadith') {
        links = `
          <a class="ref__link" href="${r.path.url}" target="_blank" rel="noopener noreferrer">↗ Hadith on Thaqalayn</a>
          <a class="ref__link ref__link--ghost" href="${r.path.chapterLink}" target="_blank" rel="noopener noreferrer">Chapter</a>
          <a class="ref__link ref__link--ghost" href="${r.path.bookLink}" target="_blank" rel="noopener noreferrer">Book</a>
          <a class="ref__link ref__link--ghost" href="${r.path.urlAr}" target="_blank" rel="noopener noreferrer">عربی</a>`;
      } else if (r.kind === 'quran') {
        links = `<a class="ref__link" href="${r.url}" target="_blank" rel="noopener noreferrer">↗ Āyah on Thaqalayn</a>`;
      }

      const author = r.author ? `<span class="tag">${esc(r.author)}</span>` : '';
      const chapter = r.chapterTitle ? `<div class="ref__note">${esc(r.chapterTitle)}</div>` : '';
      const note = r.note ? `<div class="ref__note">${esc(r.note)}</div>` : '';
      const srcText =
        r.kind === 'library' && r.allowed
          ? `${r.arabic ? `<div class="ref__ar" dir="rtl" lang="ar">${esc(r.arabic)}</div>` : ''}${
              r.english ? `<div class="ref__note" dir="ltr">${esc(r.english)}</div>` : ''
            }`
          : '';
      const path =
        r.kind === 'library'
          ? `<div class="ref__path">${esc(r.id)}${r.tag ? ` · ${esc(r.tag)}` : ''}</div>`
          : r.kind === 'hadith'
          ? `<div class="ref__path">thaqalayn:${esc(r.path.path)}</div>`
          : r.kind === 'quran'
          ? `<div class="ref__path">quran:${r.surah}/${r.verse ?? ''}</div>`
          : '';

      return `
      <li class="ref" id="${id}">
        <span class="ref__n">${r.n}</span>
        <div class="ref__main">
          <div class="ref__book">${esc(r.titleUr || r.title)}</div>
          <div class="ref__meta">
            ${kindTag}${gradeTag}${author}${badge}
            ${r.grader ? `<span class="tag">${esc(r.grader)}</span>` : ''}
          </div>
          ${chapter}
          ${srcText}
          ${note}
          <div class="ref__acts">${links}</div>
          ${path}
        </div>
      </li>`;
    })
    .join('');

  return `
  <section class="refs" dir="rtl">
    <div class="refs__title">حوالہ جات <small>References · Thaqalayn</small></div>
    <ol class="refs__list">${items}</ol>
  </section>`;
}
