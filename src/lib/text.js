/**
 * SHAI · Arabic / Urdu / English text normalisation + tokenising
 * ─────────────────────────────────────────────────────────────
 * Shared by the offline corpus builder (`scripts/build-corpus.mjs`) and the
 * on-device search (`src/lib/corpus.js`), so a query typed in Urdu matches the
 * same normalised form that was indexed at build time.
 *
 * The rules are deliberately lossy: diacritics, tatweel and zero-width
 * joiners are dropped and letter variants are unified (أ/إ/آ → ا, ى → ي,
 * ة → ه, Urdu ٹ/ڈ/ڑ/ں/ے/ڪ → their Arabic counterparts). Search only — the
 * original text is always what gets displayed.
 */

/** Quranic harakat, tanwin, superscript alef, tatweel, ZWJ/ZWNJ and marks. */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\uFEFF]/g;

/** Letter variants unified so that Urdu and Arabic spellings collide. */
const UNIFY = [
  [/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, '\u0627'], // آ أ إ ٱ ٲ ٳ → ا
  [/[\u0649\u0626\u0624]/g, '\u064A'],                   // ى ئ ؤ → ي
  [/[\u0629\u06C3]/g, '\u0647'],                         // ة ۃ → ه
  [/[\u06A9\u06AA\u06AB]/g, '\u0643'],                   // ک ڪ ڪ → ك
  [/[\u0679\u067A\u067B\u067C\u067D]/g, '\u062A'],       // ٹ ٺ ٻ ټ ٽ → ت
  [/[\u0688\u0689\u068A\u068B\u068C\u068D]/g, '\u062F'], // ڈ ډ ڊ ڋ ڌ ڍ → د
  [/[\u0691\u0692\u0693]/g, '\u0631'],                   // ڑ ړ ړ → ر
  [/[\u06BA\u06BB\u06BC]/g, '\u0646'],                   // ں ں ڼ → ن
  [/[\u06D2\u06D3]/g, '\u064A'],                         // ے ۓ → ي
  [/[\u06AF\u06B0\u06B1]/g, '\u062C'],                   // گ ڳ ڴ → ج
  [/[\u067E\u067F\u0680]/g, '\u0628'],                   // پ ڀ ڃ → ب
  [/[\u0686\u0687]/g, '\u062C'],                         // چ ڇ → ج
  [/[\u06CC\u063D]/g, '\u064A'],                         // ی → ي
];

const ARABIC_URDU = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Strip diacritics / marks and unify letter variants. */
export function normalize(s) {
  let t = String(s || '').replace(DIACRITICS, '');
  for (const [re, to] of UNIFY) t = t.replace(re, to);
  return t.toLowerCase();
}

/** Function words that carry no retrieval signal in Arabic, Urdu or English. */
const RAW_STOPWORDS = `

ال وفي من على عن إلى ان أن إن ما لا لم لن هو هي هم هما نحن الذي التي الذين اللاتي هذا هذه ذلك تلك ثم او أو و ف قد كل بعض اي أي كما مثل بين عند حتى اما أما كان كانت يكون تكون قد عن مع بين
قال قالت قالوا قلت يقول يقولون فقلت فقال وقالوا حدثنا اخبرنا أخبرنا حدثني اخبرني روي روى سمعت رأيت عنهما عنهم عليهم عليه عليها
الله رب العزة جل جلاله تعالى عز وجل سبحانه
كا كي كه كى ہے ہیں تھا تھی تھے تھاں اور سے میں کو کہ یہ وہ ان کا ایک پر تا کر ہو نے جو نہ ہی بھی تب جب تک
the of and to a an in that it is was be are for on with as at by from he she they his her their this these those there here said say says not no but or if then than so such
`.split(/\s+/).filter(Boolean);

/**
 * Built *after* normalisation so that a stopword written with ى / ک / ہ still
 * matches the folded form the indexer produces.
 */
export const STOPWORDS = new Set(RAW_STOPWORDS.map((w) => normalize(w)));


/**
 * Split into searchable tokens. Arabic/Urdu words are kept as whole words
 * (a light suffix strip keeps plurals and possessives colliding); Latin words
 * are lowercased.
 *
 * @param {string} s
 * @returns {string[]} tokens in order of appearance, duplicates kept
 */
export function tokenize(s) {
  const norm = normalize(s);
  const out = [];

  // Arabic-Indic digits, the Arabic comma/semicolon/question mark and the Urdu
  // full stop all live inside the Arabic block — strip them first so they can
  // never be indexed as if they were letters.
  const stripped = norm.replace(/[\u0600-\u060F\u061B\u061C\u061E\u061F\u0660-\u066F\u06D4\u06F0-\u06F9]/g, ' ');

  // Two passes keep Urdu and English apart, so an Urdu query never matches
  // inside an English word (and vice versa).
  const AR_RUN = /[\u0621-\u064A\u066E-\u06D3\u06D5-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]{2,}/g;
  const EN_RUN = /[a-z]{3,}/g;

  let m;
  while ((m = AR_RUN.exec(stripped))) {
    let tok = m[0];
    if (STOPWORDS.has(tok)) continue;
    // Light affix trimming. Single-letter prefixes (و ف ب ل) are deliberately
    // NOT stripped: in this dataset Arabic prefixes are space-separated, and
    // stripping them would mutilate Urdu words such as وفاداری / بیان.
    tok = tok.replace(/^(وال|فال|بال|كال|لل)/, '') || tok;
    if (tok.length > 4) tok = tok.replace(/^ال/, '');
    if (tok.length > 4) tok = tok.replace(/(ات|ين|ون|ان|ها|هم|هن|كم|كن|ية)$/, '') || tok;
    if (tok.length < 2 || STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  while ((m = EN_RUN.exec(stripped))) {
    let tok = m[0];
    if (STOPWORDS.has(tok)) continue;
    if (tok.endsWith('ing') && tok.length > 6) tok = tok.slice(0, -3);
    else if (tok.endsWith('ed') && tok.length > 5) tok = tok.slice(0, -2);
    else if (tok.endsWith('s') && !tok.endsWith('ss') && tok.length > 4) tok = tok.slice(0, -1);
    if (STOPWORDS.has(tok) || tok.length < 3) continue;
    out.push(tok);
  }
  return out;
}

/** Unique, order-preserving token list — what actually gets indexed. */
export function keywords(s) {
  const seen = new Set();
  for (const t of tokenize(s)) seen.add(t);
  return [...seen];
}
