/**
 * SHAI · Thaqalayn source registry
 * ─────────────────────────────────────────────────────────────
 * Thaqalayn (thaqalayn.com — "thaqalyn.net" redirects to it) is the
 * canonical, openly-licensed Shia hadith library SHAI grounds itself in.
 *
 * Verified URL shapes (checked against the live site + its sitemap):
 *   Book     https://thaqalayn.com/book/{collection}
 *   Chapter  https://thaqalayn.com/chapter/{collection}/{book}/{chapter}
 *   Hadith   https://thaqalayn.com/hadith/{collection}/{book}/{chapter}/{hadith}
 *   Arabic   https://thaqalayn.com/ar/hadith/{collection}/{book}/{chapter}/{hadith}
 *   Quran    https://thaqalayn.com/quran/{surah}/{verse}
 *
 * `VALID_IDS` is the exact set of collection ids that exist in
 * thaqalayn.com/sitemap/books.xml — it is used to *reject* hallucinated
 * book ids before a link is ever rendered.
 */

export const THAQALAYN_BASE = 'https://thaqalayn.com';

/** Every collection id that actually exists on Thaqalayn. */
export const VALID_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
];

/** Titles / authors, keyed by collection id. */
export const COLLECTIONS = {
  1: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 1 },
  2: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 2 },
  3: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 3 },
  4: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 4 },
  5: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 5 },
  6: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 6 },
  7: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 7 },
  8: { en: 'Al-Kāfi', ur: 'الکافی', author: 'Shaykh Muḥammad b. Yaʿqūb al-Kulaynī', vol: 8 },

  9: {
    en: 'Muʿjam al-Aḥādīth al-Muʿtabara',
    ur: 'معجم الاحادیث المعتبرة',
    author: 'Shaykh Muḥammad Āṣif al-Muḥsinī',
  },
  10: { en: 'Al-Khiṣāl', ur: 'الخصال', author: 'Shaykh Muḥammad b. ʿAlī al-Ṣadūq' },
  11: { en: 'ʿUyūn akhbār al-Riḍā', ur: 'عیون اخبار الرضا', author: 'Shaykh al-Ṣadūq' },
  13: { en: 'Al-Amālī', ur: 'الامالی', author: 'Shaykh Muḥammad b. Muḥammad al-Mufīd' },
  14: { en: 'Al-Tawḥīd', ur: 'التوحید', author: 'Shaykh al-Ṣadūq' },
  17: { en: 'Kitāb al-Ḍuʿafāʾ', ur: 'کتاب الضعفاء', author: 'Aḥmad b. al-Ḥusayn al-Ghaḍāʾirī' },

  22: { en: 'Kitāb al-Ghayba', ur: 'کتاب الغیبة', author: 'Ibn Abī Zaynab al-Nuʿmānī' },
  23: { en: 'Thawāb al-Aʿmāl wa ʿiqāb al-Aʿmāl', ur: 'ثواب الاعمال', author: 'Shaykh al-Ṣadūq' },
  24: { en: 'Kāmil al-Ziyārāt', ur: 'کامل الزیارات', author: 'Shaykh Jaʿfar b. Muḥammad al-Qummī' },
  25: { en: 'Faḍāʾil al-Shīʿa', ur: 'فضائل الشیعة', author: 'Shaykh al-Ṣadūq' },
  26: { en: 'Ṣifāt al-Shīʿa', ur: 'صفات الشیعة', author: 'Shaykh al-Ṣadūq' },
  27: { en: 'Kitāb al-Ghayba', ur: 'کتاب الغیبة', author: 'Shaykh Muḥammad b. al-Ḥasan al-Ṭūsī' },
  28: { en: "Maʿānī al-Akhbār", ur: 'معانی الاخبار', author: 'Shaykh al-Ṣadūq' },
  29: { en: 'Al-Amālī', ur: 'الامالی', author: 'Shaykh al-Ṣadūq' },
  30: { en: 'Kitāb al-Muʾmin', ur: 'کتاب المؤمن', author: 'Ḥusayn b. Saʿīd al-Ahwāzī' },
  31: { en: 'Kitāb al-Zuhd', ur: 'کتاب الزھد', author: 'Ḥusayn b. Saʿīd al-Ahwāzī' },
  32: { en: 'Nahj al-Balāgha', ur: 'نہج البلاغہ', author: 'al-Sharīf al-Raḍī' },
  33: {
    en: 'Risālat al-Ḥuqūq',
    ur: 'رسالة الحقوق',
    author: 'Imam Zayn al-ʿĀbidīn (a.s)',
  },

  34: { en: 'Man Lā Yaḥḍuruh al-Faqīh', ur: 'من لا یحضرہ الفقیہ', author: 'Shaykh al-Ṣadūq', vol: 1 },
  35: { en: 'Man Lā Yaḥḍuruh al-Faqīh', ur: 'من لا یحضرہ الفقیہ', author: 'Shaykh al-Ṣadūq', vol: 2 },
  36: { en: 'Man Lā Yaḥḍuruh al-Faqīh', ur: 'من لا یحضرہ الفقیہ', author: 'Shaykh al-Ṣadūq', vol: 3 },
  37: { en: 'Man Lā Yaḥḍuruh al-Faqīh', ur: 'من لا یحضرہ الفقیہ', author: 'Shaykh al-Ṣadūq', vol: 4 },

  39: {
    en: 'Kamāl al-Dīn wa Tamām al-Niʿma',
    ur: 'کمال الدین و تمام النعمة',
    author: 'Shaykh al-Ṣadūq',
  },
  40: {
    en: 'Faḍāʾil al-Ashhur al-Thalātha',
    ur: 'فضائل الاشھر الثلاثة',
    author: 'Shaykh al-Ṣadūq',
  },

  41: { en: 'Tahdhīb al-Aḥkām', ur: 'تھذیب الاحکام', author: 'Shaykh al-Ṭūsī', vol: 1 },
  42: { en: 'Tahdhīb al-Aḥkām', ur: 'تھذیب الاحکام', author: 'Shaykh al-Ṭūsī', vol: 2 },
  43: { en: 'Tahdhīb al-Aḥkām', ur: 'تھذیب الاحکام', author: 'Shaykh al-Ṭūsī', vol: 3 },
  44: { en: 'Tahdhīb al-Aḥkām', ur: 'تھذیب الاحکام', author: 'Shaykh al-Ṭūsī', vol: 4 },

  45: {
    en: 'Al-Imāma wa’l-Tabṣira min al-Ḥayra',
    ur: 'الامامة والتبصرة من الحیرة',
    author: 'ʿAlī ibn Bābawayh',
  },
};

/** Ids that exist on Thaqalayn but whose title we have not pinned down. */
const UNNAMED = [12, 38];

/** Names of the 114 surahs (used for Quran citations). */
const SURAHS = [
  'Al-Fātiḥa','Al-Baqara','Āli ʿImrān','An-Nisāʾ','Al-Māʾida','Al-Anʿām','Al-Aʿrāf','Al-Anfāl','At-Tawba','Yūnus',
  'Hūd','Yūsuf','Ar-Raʿd','Ibrāhīm','Al-Ḥijr','An-Naḥl','Al-Isrāʾ','Al-Kahf','Maryam','Ṭā Hā',
  'Al-Anbiyāʾ','Al-Ḥajj','Al-Muʾminūn','An-Nūr','Al-Furqān','Ash-Shuʿarāʾ','An-Naml','Al-Qaṣaṣ','Al-ʿAnkabūt','Ar-Rūm',
  'Luqmān','As-Sajda','Al-Aḥzāb','Sabaʾ','Fāṭir','Yā Sīn','Aṣ-Ṣāffāt','Ṣād','Az-Zumar','Ghāfir',
  'Fuṣṣilat','Ash-Shūrā','Az-Zukhruf','Ad-Dukhān','Al-Jāthiya','Al-Aḥqāf','Muḥammad','Al-Fatḥ','Al-Ḥujurāt','Qāf',
  'Adh-Dhāriyāt','Aṭ-Ṭūr','An-Najm','Al-Qamar','Ar-Raḥmān','Al-Wāqiʿa','Al-Ḥadīd','Al-Mujādila','Al-Ḥashr','Al-Mumtaḥana',
  'Aṣ-Ṣaff','Al-Jumuʿa','Al-Munāfiqūn','At-Taghābun','Aṭ-Ṭalāq','At-Taḥrīm','Al-Mulk','Al-Qalam','Al-Ḥāqqa','Al-Maʿārij',
  'Nūḥ','Al-Jinn','Al-Muzzammil','Al-Muddaththir','Al-Qiyāma','Al-Insān','Al-Mursalāt','An-Nabaʾ','An-Nāziʿāt','ʿAbasa',
  'At-Takwīr','Al-Infiṭār','Al-Muṭaffifīn','Al-Inshiqāq','Al-Burūj','Aṭ-Ṭāriq','Al-Aʿlā','Al-Ghāshiya','Al-Fajr','Al-Balad',
  'Ash-Shams','Al-Layl','Aḍ-Ḍuḥā','Ash-Sharḥ','At-Tīn','Al-ʿAlaq','Al-Qadr','Al-Bayyina','Az-Zalzala','Al-ʿĀdiyāt',
  'Al-Qāriʿa','At-Takāthur','Al-ʿAṣr','Al-Humaza','Al-Fīl','Quraysh','Al-Māʿūn','Al-Kawthar','Al-Kāfirūn','An-Naṣr',
  'Al-Masad','Al-Ikhlāṣ','Al-Falaq','An-Nās',
];

/* ── Lookups ─────────────────────────────────────────────────── */

export function collection(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const meta = COLLECTIONS[n];
  if (meta) return { id: n, ...meta };
  if (UNNAMED.includes(n)) {
    return { id: n, en: `Thaqalayn Collection ${n}`, ur: `مجموعہ ${n}`, author: 'Thaqalayn', unnamed: true };
  }
  return null;
}

export function isValidCollection(id) {
  return VALID_IDS.includes(Number(id));
}

export function surahName(n) {
  const i = Number(n);
  return i >= 1 && i <= 114 ? SURAHS[i - 1] : null;
}

/* ── URL builders ────────────────────────────────────────────── */

export const bookUrl = (c) => `${THAQALAYN_BASE}/book/${c}`;
export const chapterUrl = (c, b, ch) => `${THAQALAYN_BASE}/chapter/${c}/${b}/${ch}`;
export const hadithUrl = (c, b, ch, h) => `${THAQALAYN_BASE}/hadith/${c}/${b}/${ch}/${h}`;
export const hadithUrlAr = (c, b, ch, h) => `${THAQALAYN_BASE}/ar/hadith/${c}/${b}/${ch}/${h}`;
export const quranUrl = (surah, verse) =>
  verse ? `${THAQALAYN_BASE}/quran/${surah}/${verse}` : `${THAQALAYN_BASE}/quran/${surah}`;
export const searchUrl = (q) => `${THAQALAYN_BASE}/search?q=${encodeURIComponent(q)}`;

/**
 * Parse "collection/book/chapter/hadith" (the compact citation path SHAI asks
 * the model to emit) and validate it against the registry.
 */
export function parsePath(path) {
  if (typeof path !== 'string') return null;
  const m = path.trim().match(/^(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,4})\s*\/\s*(\d{1,4})$/);
  if (!m) return null;
  const [, c, b, ch, h] = m.map(Number);
  return {
    collection: c,
    book: b,
    chapter: ch,
    hadith: h,
    path: `${c}/${b}/${ch}/${h}`,
    valid: isValidCollection(c),
    url: hadithUrl(c, b, ch, h),
    urlAr: hadithUrlAr(c, b, ch, h),
    chapterLink: chapterUrl(c, b, ch),
    bookLink: bookUrl(c),
  };
}

/** Human-readable label for a parsed path, e.g. "Al-Kāfi · Vol. 1 · Book 2 · Ch. 17 · Hadith 14". */
export function labelForPath(p, { ur = false } = {}) {
  if (!p) return '';
  const meta = collection(p.collection);
  const title = meta ? (ur ? meta.ur : meta.en) : `Collection ${p.collection}`;
  const parts = [title];
  if (meta?.vol) parts.push(ur ? `جلد ${meta.vol}` : `Vol. ${meta.vol}`);
  parts.push(ur ? `کتاب ${p.book}` : `Book ${p.book}`);
  parts.push(ur ? `باب ${p.chapter}` : `Ch. ${p.chapter}`);
  parts.push(ur ? `حدیث ${p.hadith}` : `Hadith ${p.hadith}`);
  return parts.join(ur ? ' · ' : ' · ');
}

/**
 * A compact, newline-separated catalogue injected into the system prompt so the
 * model can only cite ids that really exist.
 */
export function catalogueForPrompt() {
  const lines = VALID_IDS.map((id) => {
    const m = collection(id);
    if (!m) return `${id} = Thaqalayn Collection ${id}`;
    const vol = m.vol ? ` Vol.${m.vol}` : '';
    return `${id} = ${m.en}${vol} — ${m.author}`;
  });
  return lines.join('\n');
}

/* ── Absolute-URL policy ─────────────────────────────────────── */

/**
 * Hosts the app is allowed to link to. Anything else (custom protocols such as
 * `thaqalayn:24/…`, relative paths, unknown domains) is dropped, so a link can
 * only ever be an absolute https URL on a known authentic source.
 */
export const ALLOWED_HOSTS = [
  'thaqalayn.com',
  'www.thaqalayn.com',
  'thaqalyn.net',
  'www.thaqalyn.net',
  'sistani.org',
  'www.sistani.org',
  'leader.ir',
  'www.leader.ir',
];

/**
 * Returns a normalised absolute https URL for an allowed host, or '' otherwise.
 * `safeHref('thaqalayn:24/1/2')` → '' ; `safeHref('https://thaqalayn.com/hadith/1/2/17/14')` → same URL.
 */
export function safeHref(url) {
  const raw = String(url ?? '').trim();
  if (!raw || !/^https:\/\//i.test(raw)) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return '';
    if (!ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) return '';
    return u.href;
  } catch (_) {
    return '';
  }
}
