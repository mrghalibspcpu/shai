/**
 * SHIA AI · Client-side retrieval (RAG step 1)
 * ─────────────────────────────────────────────────────────────
 * Runs entirely on-device against the shipped dataset. For each question it
 * tries, in order:
 *
 *   1. LOCATOR  — an exact Thaqalayn id typed or pasted by the user
 *                 ("1/0/1/1", "الکافی جلد 2 باب 17 حدیث 14", a thaqalayn.com/hadith/… URL)
 *   2. MATAN    — the user pasted Arabic text that is literally in the dataset
 *   3. KEYWORD  — bilingual, IDF-weighted search over Arabic matan, English
 *                 translation, chapter titles, and Sistani rulings
 *
 * Whatever is returned is a verbatim dataset row. The LLM is only ever shown
 * these rows (see contextForPrompt) and may only translate / format them.
 * If nothing qualifies, `empty` is true and the app answers "not available"
 * without calling the model at all.
 */

import { normText, tokens, stem, hasArabicScript, STOPWORDS } from './text.js';
import { expand } from './lexicon.js';
import {
  hadithRecords,
  fatwaRecords,
  getHadith,
  datasetStatus,
  isReady,
} from './dataset.js';
import { COLLECTIONS } from './sources.js';

const DEPTH_K = {
  concise: { h: 3, f: 2 },
  balanced: { h: 4, f: 3 },
  detailed: { h: 6, f: 4 },
};

/** Minimum score a record needs to be shown at all (relative to the best hit). */
const MIN_SCORE = 2.5;
const REL_CUTOFF = 0.4;

const asciiDigits = (s) => String(s ?? '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) & 0xf));

/* ── Locator parsing ─────────────────────────────────────────── */

/** Collection-name aliases → ids. Built from the registry, plus common spellings. */
const NAME_TO_IDS = (() => {
  const map = new Map();
  const add = (name, id) => {
    const key = normText(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const [id, m] of Object.entries(COLLECTIONS)) {
    add(m.en, Number(id));
    add(m.ur, Number(id));
  }
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    add('کافی', id);
    add('kafi', id);
    add('الکافی', id);
  }
  return map;
})();

/**
 * Parse a locator from the raw query.
 * @returns {null | {kind:'id', c, b, ch, h} | {kind:'labelled', c?:number, b?:number, ch?:number, h:number, vol?:number}}
 */
export function parseLocator(raw) {
  const q = asciiDigits(raw);

  // "c/b/ch/h" (also matches the numbers inside a thaqalayn.com/hadith/… URL)
  const m = q.match(/(?<!\d)(\d{1,3})\s*[/:\-.]\s*(\d{1,3})\s*[/:\-.]\s*(\d{1,4})\s*[/:\-.]\s*(\d{1,4})(?!\d)/);
  if (m) return { kind: 'id', c: +m[1], b: +m[2], ch: +m[3], h: +m[4] };

  // Labelled form: "کافی جلد 2 کتاب 1 باب 17 حدیث 14", "Kafi vol 2 chapter 17 hadith 14"
  const hm = q.match(/(?:حدیث|hadith|hadees|(?<![a-z])h\.?|#)\s*(?:نمبر|no\.?)?\s*(\d{1,4})/i);
  if (!hm) return null;
  const chm = q.match(/(?:باب|(?<![a-z])chapter|(?<![a-z])ch\.?)\s*(\d{1,4})/i);
  const bm = q.match(/(?:کتاب|(?<![a-z])book)\s*(\d{1,3})/i);
  const vm = q.match(/(?:جلد|(?<![a-z])vol\.?|volume)\s*(\d{1,3})/i);
  if (!chm && !bm) return null; // a bare hadith number is not specific enough

  const norm = ` ${normText(raw)} `;
  let ids = null;
  for (const [name, set] of NAME_TO_IDS) {
    if (name && norm.includes(` ${name} `)) {
      ids = ids || new Set();
      set.forEach((id) => ids.add(id));
    }
  }
  if (ids && vm) {
    const want = Number(vm[1]);
    const byVol = [...ids].filter((id) => COLLECTIONS[id]?.vol === want || id === want);
    if (byVol.length) ids = new Set(byVol);
  }

  return {
    kind: 'labelled',
    c: ids ? [...ids] : null,
    b: bm ? Number(bm[1]) : null,
    ch: chm ? Number(chm[1]) : null,
    h: Number(hm[1]),
  };
}

function findByLocator(loc) {
  if (loc.kind === 'id') {
    const rec = getHadith(`${loc.c}/${loc.b}/${loc.ch}/${loc.h}`);
    return rec ? [rec] : [];
  }
  return hadithRecords().filter(
    (r) =>
      (!loc.c || loc.c.includes(r.c)) &&
      (loc.b == null || r.b === loc.b) &&
      (loc.ch == null || r.ch === loc.ch) &&
      r.h === loc.h
  );
}

/* ── Keyword scoring ─────────────────────────────────────────── */

/** Letters that only Urdu uses (ہ ھ ک ے ں ٹ ڈ ڑ ۃ گ چ پ ژ). */
const URDU_ONLY_RE = /[ٹڈڑںےۓھگچپژہۃک]/;

/** Normalised tokens of the words that contain Urdu-only letters. */
function urduTokenSet(raw) {
  const set = new Set();
  for (const w of String(raw).split(/\s+/)) {
    if (URDU_ONLY_RE.test(w)) tokens(normText(w)).forEach((t) => set.add(t));
  }
  return set;
}

function buildTerms(qn, urduSet = new Set()) {
  const base = tokens(qn).filter((t) => !STOPWORDS.has(t));
  const terms = new Map(); // key → {t, ar, w}
  const put = (t, ar, w) => {
    if (!t) return;
    const key = `${ar ? 'a' : 'e'}:${t}`;
    const prev = terms.get(key);
    if (!prev || prev.w < w) terms.set(key, { t, ar, w });
  };
  for (const tok of base) {
    // An Urdu word is never matched against the Arabic text directly (a Urdu
    // word can accidentally be a substring of an Arabic word); it only reaches
    // the dataset through the bilingual lexicon.
    const isUrdu = urduSet.has(tok);
    const ar = hasArabicScript(tok);
    if (!isUrdu) put(ar ? tok : stem(tok), ar, 1);
    const ex = expand(tok);
    ex.en.forEach((e) => put(stem(e), false, 0.8));
    ex.ar.forEach((a) => put(a, true, 0.8));
  }
  return [...terms.values()];
}

/** Arabic terms match at a word start, allowing the usual clitic prefixes (ال، و، ب …). */
const AR_PREFIX = '(?:^| )(?:[وبلفكس]?ال|[وبلفكس])?';
const termRegex = (t) => new RegExp(`${AR_PREFIX}${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/**
 * Score every candidate against the terms.
 *
 * • Only query words the corpus knows about count as evidence (unknown words
 *   are ignored instead of matching by accident).
 * • With two or more known query concepts, a record must cover at least half
 *   of them; with one, it must match that one.
 * • Score = Σ idf(term) · (0.5 + 0.5 · coverage), so records that address more
 *   of the question rank first.
 */
function rank(candidates, terms, { arField, enField }) {
  const N = candidates.length || 1;
  const arRe = terms.map((t) => (t.ar ? termRegex(t.t) : null));

  const hits = candidates.map((rec) => {
    const set = new Set();
    const hay = arField(rec);
    const words = enField(rec);
    terms.forEach((term, i) => {
      if (term.ar) {
        if (hay && arRe[i].test(hay)) set.add(i);
      } else if (words.has(term.t)) {
        set.add(i);
      }
    });
    return set;
  });

  const df = terms.map(() => 0);
  hits.forEach((set) => set.forEach((i) => (df[i] += 1)));
  const idf = df.map((d) => Math.log(1 + N / (1 + d)));

  // Concepts the corpus recognises: an original query word with any hit, or an
  // original word whose lexicon expansion hits something.
  const knownOrig = terms.filter((t, i) => t.w === 1 && df[i] > 0).length;

  const scored = [];
  hits.forEach((set, idx) => {
    if (!set.size) return;
    let score = 0;
    let origHit = 0;
    let expHit = 0;
    set.forEach((i) => {
      score += terms[i].w * idf[i];
      if (terms[i].w === 1) origHit += 1;
      else expHit += 1;
    });
    if (knownOrig >= 2) {
      if (origHit < Math.ceil(knownOrig / 2)) return;
    } else if (knownOrig === 1) {
      if (origHit < 1) return;
    } else if (expHit < 2) {
      return; // only lexicon hits: require at least two of them
    }
    const coverage = knownOrig ? origHit / knownOrig : 0;
    scored.push({ record: candidates[idx], score: score * (0.5 + 0.5 * coverage) });
  });

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((s) => s.score >= MIN_SCORE && s.score >= top * REL_CUTOFF);
}

const hadithAr = (r) => r.arN;
const hadithEn = (r) => r.words;
const fatwaAr = () => '';
const fatwaEn = (r) => r.words;

/* ── Public API ──────────────────────────────────────────────── */

/**
 * @returns {{
 *   query:string, route:'locator'|'matan'|'keyword'|'none', empty:boolean,
 *   reason:string, hadith:Array<{record:object, score:number}>,
 *   fatwa:Array<{record:object, score:number}>, dataset:object
 * }}
 */
export function retrieve(query, { depth = 'balanced' } = {}) {
  const k = DEPTH_K[depth] || DEPTH_K.balanced;
  const dataset = datasetStatus();
  const out = {
    query: String(query ?? '').trim(),
    route: 'none',
    empty: true,
    reason: '',
    hadith: [],
    fatwa: [],
    dataset,
  };
  if (!out.query) return { ...out, reason: 'no-content' };
  if (!isReady()) return { ...out, reason: 'dataset-unavailable' };

  // 1 · Locator
  const loc = parseLocator(out.query);
  if (loc) {
    const recs = findByLocator(loc);
    if (recs.length) {
      out.route = 'locator';
      out.hadith = recs.slice(0, Math.max(k.h, 5)).map((record) => ({ record, score: 100 }));
      out.empty = false;
      return out;
    }
    out.route = 'locator';
    out.reason = 'locator-not-found';
    return out;
  }

  // 2 · Pasted matan
  const qn = normText(out.query);
  if (hasArabicScript(qn) && qn.length >= 20) {
    const key = qn.length > 80 ? qn.slice(0, 80).replace(/\s+\S*$/, '') : qn;
    const recs = hadithRecords().filter((r) => r.arN.includes(key));
    if (recs.length) {
      out.route = 'matan';
      out.hadith = recs.slice(0, k.h).map((record) => ({ record, score: 100 }));
      out.empty = false;
      return out;
    }
  }

  // 3 · Keyword search
  const terms = buildTerms(qn, urduTokenSet(out.query));
  if (!terms.length) {
    // Words were given, but none of them is a recognised concept → not available.
    const hasContent = tokens(qn).some((t) => !STOPWORDS.has(t));
    return { ...out, reason: hasContent ? 'no-match' : 'no-content' };
  }
  const hadith = rank(hadithRecords(), terms, { arField: hadithAr, enField: hadithEn }).slice(0, k.h);
  const fatwa = rank(fatwaRecords(), terms, { arField: fatwaAr, enField: fatwaEn }).slice(0, k.f);

  out.route = 'keyword';
  out.hadith = hadith;
  out.fatwa = fatwa;
  out.empty = !hadith.length && !fatwa.length;
  out.reason = out.empty ? 'no-match' : '';
  return out;
}

/**
 * Text block injected into the system instruction. Contains ONLY verbatim
 * dataset fields. Returns '' when nothing was retrieved.
 */
export function contextForPrompt(retr) {
  const lines = [];
  retr.hadith.forEach(({ record: r }, i) => {
    lines.push(
      `[H${i + 1}] ID=${r.id} | Collection=${r.collectionEn} (${r.collectionUr}) | Author=${r.author || '—'} | Volume=${r.volume ?? '—'} | Book=${r.b} | Chapter=${r.ch}${r.chapterTitle ? ` "${r.chapterTitle}"` : ''} | Hadith=${r.h} | Grade=${r.grade || 'not stated'}${r.grader ? ` (${r.grader})` : ''} | URL=${r.url}`
    );
    lines.push(`MATAN_AR (exact): ${r.ar}`);
    lines.push(`TRANSLATION_EN (exact): ${r.en || 'not available in dataset'}`);
    lines.push('');
  });
  retr.fatwa.forEach(({ record: f }, i) => {
    lines.push(
      `[F${i + 1}] ID=${f.id} | Mujtahid=${f.marja} | Book=${f.book} | Ruling=${f.rulingNo ?? '—'} | Type=${f.type} | URL=${f.url}`
    );
    lines.push(`TEXT_EN (exact): ${f.en}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

/** Refs the model should cite when it emits none — exactly the retrieved ids. */
export function fallbackRefs(retr) {
  return [
    ...retr.hadith.map(({ record: r }) => ({ id: r.id })),
    ...retr.fatwa.map(({ record: f }) => ({ id: f.id })),
  ];
}
