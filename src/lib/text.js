/**
 * SHIA AI · Text normalisation for retrieval
 * ─────────────────────────────────────────────────────────────
 * Arabic matan, Urdu questions and English translations all need to be
 * compared on the same footing. This module folds them into one canonical
 * form (no harakat / tatweel, unified alef / yeh / kaf / heh, ASCII digits,
 * lower-case Latin without diacritics, punctuation removed).
 *
 * The same function is used for dataset records (at load time) and for the
 * user's query (at search time), so matching is symmetric.
 */

// Arabic harakat, Quranic annotation marks, tatweel, zero-width & bidi marks.
const STRIP_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const LETTER_MAP = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ى': 'ی', 'ي': 'ی', 'ئ': 'ی', 'ے': 'ی', 'ۓ': 'ی',
  'ك': 'ک', 'ګ': 'ک',
  'ة': 'ه', 'ۃ': 'ه', 'ہ': 'ه', 'ھ': 'ه',
  'ؤ': 'و',
  'ء': '',
};
const LETTER_RE = new RegExp(`[${Object.keys(LETTER_MAP).join('')}]`, 'g');

export function normText(input) {
  let s = String(input ?? '').normalize('NFC');
  s = s.replace(STRIP_RE, '');
  s = s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) & 0xf));
  s = s.replace(LETTER_RE, (ch) => LETTER_MAP[ch]);
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  s = s.toLowerCase();
  s = s.replace(/[ʿʾʼ‘’'`ʻ]/g, '');
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export const hasArabicScript = (s) => /[\u0600-\u06FF]/.test(s);

/** Tokens of a normalised string (single letters dropped, numbers kept). */
export function tokens(normalised) {
  return String(normalised || '')
    .split(' ')
    .filter((t) => t.length >= 2 || /\p{N}/u.test(t));
}

/** Light English stemmer: plural "s" only (enough for translation words). */
export function stem(t) {
  if (/^[a-z]+$/.test(t) && t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/* ── Stop-words (function words that carry no topical meaning) ── */

const STOP_RAW = [
  // Urdu
  'کا', 'کی', 'کے', 'کو', 'سے', 'میں', 'ہے', 'ہیں', 'ہو', 'ہوں', 'تھا', 'تھی', 'تھے', 'کیا', 'کیوں',
  'کیسے', 'کیسا', 'کون', 'کب', 'کہاں', 'اور', 'یا', 'پر', 'کہ', 'تو', 'بھی', 'نے', 'ہی', 'یہ', 'وہ',
  'کس', 'کر', 'کرنا', 'کریں', 'کرو', 'جو', 'جس', 'اس', 'ان', 'ایک', 'لیے', 'لئے', 'بارے', 'سوال',
  'مسئلہ', 'سیستانی', 'بتائیں', 'بتاؤ', 'بتاو', 'بیان', 'آپ', 'مجھے', 'ہم', 'میرے', 'سکتا', 'سکتی', 'جواب',
  'شرعی', 'حکم', 'حوالہ', 'ترجمہ', 'مستند', 'متعلق', 'دیں', 'دو', 'چاہیے', 'چاہئے', 'کیجیے', 'سکتے',
  'حدیث', 'احادیث', 'روایت', 'روایات', 'فتویٰ', 'فتوی', 'فتوا', 'مسائل',
  // Arabic
  'من', 'في', 'على', 'عن', 'الى', 'ان', 'ما', 'هو', 'هل', 'لا', 'و', 'ثم', 'قال', 'عليه', 'عليهم',
  'صلى', 'عليه', 'وآله', 'ع', 'ص',
  // English
  'the', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'are', 'be', 'do', 'does', 'can', 'what', 'why',
  'how', 'about', 'for', 'with', 'from', 'it', 'this', 'that', 'me', 'my', 'tell', 'explain', 'hadith',
  'narration', 'ruling', 'ruling', 'fatwa', 'say', 'said', 'please', 'give', 'show', 'find',
  'question', 'answer', 'sistani', 'ayatollah', 'marja', 'mujtahid',
  // greetings
  'سلام', 'علیکم', 'علیک', 'السلام', 'salam', 'assalamu', 'alaikum', 'alaykum', 'salaam',
];

export const STOPWORDS = new Set(STOP_RAW.map(normText).filter(Boolean));
