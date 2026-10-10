/**
 * SHIA AI · Bilingual lexicon
 * ─────────────────────────────────────────────────────────────
 * Users ask in Urdu; the dataset is Arabic (matan) and English (translation /
 * Sistani rulings). Each entry maps Urdu / Arabic terms to the English words
 * and Arabic roots that appear in the records, so a question like
 * "نماز شب کی فضیلت" can reach the records that say "night prayer" / "صلاة اللیل".
 *
 * This only WIDENS the search. It never invents content: every returned
 * record is still a verbatim row from the dataset.
 */

import { normText } from './text.js';

/** [urdu terms, english keywords, arabic terms] */
const RAW = [
  [['نماز', 'نمازیں', 'صلاۃ', 'صلوٰۃ', 'صلاه'], ['prayer', 'prayers', 'pray', 'salat'], ['صلاه']],
  [['نماز شب', 'تہجد', 'نافلہ شب'], ['night', 'tahajjud', 'nafilah'], ['تهجد', 'ليل']],
  [['روزہ', 'روزے', 'صوم', 'صیام'], ['fast', 'fasting', 'fasts', 'sawm'], ['صوم', 'صيام']],
  [['زکات', 'زکوٰۃ', 'زکوة'], ['zakat', 'zakah'], ['زكاه']],
  [['خمس'], ['khums'], ['خمس']],
  [['حج'], ['hajj', 'pilgrimage'], ['حج']],
  [['عمرہ', 'عمرۃ'], ['umrah', 'umra'], ['عمره']],
  [['وضو'], ['wudu', 'ablution', 'ablutions'], ['وضوء', 'وضو']],
  [['غسل', 'غسلِ جنابت'], ['ghusl', 'bath', 'washing'], ['غسل']],
  [['تیمم'], ['tayammum'], ['تيمم']],
  [['نجاست', 'نجس', 'ناپاک'], ['impure', 'impurity', 'najis', 'najasa'], ['نجس', 'نجاسه']],
  [['پاک', 'طہارت', 'طاہر'], ['pure', 'purity', 'purification', 'clean'], ['طاهر', 'طهاره']],
  [['پانی'], ['water'], ['ماء']],
  [['شراب', 'نشہ'], ['wine', 'intoxicant', 'intoxicating'], ['خمر']],
  [['سود', 'ربا'], ['interest', 'usury'], ['ربا']],
  [['قرض', 'قرضہ', 'قرض'], ['loan', 'debt'], ['دين']],
  [['نکاح', 'شادی'], ['marriage', 'marry', 'nikah'], ['نكاح']],
  [['طلاق'], ['divorce'], ['طلاق']],
  [['وراثت', 'میراث'], ['inheritance', 'inherit', 'inherited'], ['ميراث']],
  [['تقلید'], ['emulation', 'taqlid', 'follow'], ['تقليد']],
  [['مجتہد', 'مرجع', 'مرجعیت'], ['marja', 'mujtahid', 'emulation'], ['مرجع']],
  [['شب', 'رات'], ['night'], ['ليل']],
  [['فضیلت', 'فضائل', 'فضیلتیں', 'ثواب'], ['virtue', 'virtues', 'excellence', 'merit', 'reward'], ['فضل', 'ثواب']],
  [['گناہ', 'گناہوں', 'گناہ کبیرہ'], ['sin', 'sins', 'sinful'], ['ذنب', 'ذنوب']],
  [['ایمان والے', 'مؤمن', 'مومن'], ['believer', 'believers', 'faithful'], ['مؤمن', 'مومن']],
  [['کافر'], ['disbeliever', 'unbeliever', 'disbelievers'], ['كافر']],
  [['حلال', 'جائز', 'روا'], ['halal', 'lawful', 'permissible', 'permitted'], ['حلال', 'جائز']],
  [['حرام', 'ناجائز'], ['haram', 'unlawful', 'forbidden', 'prohibited'], ['حرام']],
  [['قبلہ'], ['qibla'], ['قبله']],
  [['امام', 'امامت', 'امامِ'], ['imam', 'imamate'], ['امام', 'امامه']],
  [['مہدی', 'مہدیؑ'], ['mahdi'], ['مهدي']],
  [['غیبت امام', 'غیبت'], ['occultation', 'ghayba'], ['غيبه']],
  [['قرآن', 'قرآنِ'], ['quran', 'qur'], ['قران', 'القران']],
  [['دعا', 'دعائیں', 'دعاء'], ['supplication', 'dua', 'invocation'], ['دعاء']],
  [['زیارت'], ['ziyarat', 'visitation', 'visit'], ['زياره']],
  [['توبہ'], ['repentance', 'repent', 'repentant'], ['توبه']],
  [['صبر'], ['patience', 'patient'], ['صبر']],
  [['ایمان'], ['faith', 'belief', 'believer'], ['ايمان']],
  [['عقل'], ['intellect', 'reason', 'intelligence'], ['عقل']],
  [['علم'], ['knowledge', 'learning', 'scholar'], ['علم']],
  [['حیا'], ['modesty', 'shame'], ['حياء']],
  [['تاریخ'], ['history'], ['تاريخ']],
  [['کمپیوٹر'], ['computer'], ['حاسوب']],
  [['جنت'], ['paradise', 'heaven'], ['جنه']],
  [['جہنم', 'دوزخ'], ['hell', 'fire'], ['جهنم', 'نار']],
  [['والدین', 'ماں', 'باپ'], ['parents', 'mother', 'father'], ['والدين']],
  [['ولایت', 'ولی'], ['wilayah', 'guardianship', 'walaya'], ['ولايه']],
  [['صدقہ'], ['charity', 'alms'], ['صدقه']],
  [['رزق'], ['sustenance', 'provision', 'livelihood'], ['رزق']],
  [['دوستی', 'دوست'], ['friend', 'friends', 'friendship'], ['صديق']],
  [['اہل بیت', 'اہلِ بیت', 'اہلبیت'], ['household', 'ahl'], ['اهل البيت']],
  [['قیامت'], ['resurrection', 'judgment'], ['القيامه']],
  [['شیعہ', 'شیعہ'], ['shia', 'shiah', 'shi'], ['شيعه']],
  [['محبت', 'محبّت'], ['love'], ['حب']],
  [['جھوٹ'], ['lie', 'lying', 'lies'], ['كذب']],
  [['سچ', 'صدق'], ['truth', 'truthful', 'honest'], ['صدق']],
  [['ثقلین'], ['weighty', 'thaqalayn', 'thaqalan'], ['الثقلين']],
];

/** normalised lookup: token → { en: Set, ar: Set } */
const INDEX = new Map();

for (const [urTerms, enTerms, arTerms] of RAW) {
  const en = enTerms.map((t) => normText(t)).filter(Boolean);
  const ar = arTerms.map((t) => normText(t)).filter(Boolean);
  for (const u of urTerms) {
    for (const tok of normText(u).split(' ').filter(Boolean)) {
      if (tok.length < 2) continue;
      const slot = INDEX.get(tok) || { en: new Set(), ar: new Set() };
      en.forEach((t) => slot.en.add(t));
      ar.forEach((t) => slot.ar.add(t));
      INDEX.set(tok, slot);
    }
  }
}

/** Expansion terms for one normalised query token (empty when unknown). */
export function expand(token) {
  const hit = INDEX.get(token);
  if (!hit) return { en: [], ar: [] };
  return { en: [...hit.en], ar: [...hit.ar] };
}

export const LEXICON_SIZE = INDEX.size;
