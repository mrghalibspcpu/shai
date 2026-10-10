#!/usr/bin/env node
/**
 * SHAI · Library & grounding tests
 * ─────────────────────────────────────────────────────────────
 * Checks the guarantees the app relies on, using a small synthetic library:
 *   • Arabic normalisation / tokenisation
 *   • BM25 retrieval ranks the right record first
 *   • only retrieved ids are citable; others are rejected
 *   • citation URL and Arabic text come from the record, not the model
 *   • verification badge follows the record's status
 *   • keyword JSON parsing tolerates fences and junk
 *
 *   node scripts/library-test.mjs
 */

const { normaliseArabic, tokenize, buildIndex, useIndex, search, viewOf, contextBlock } = await import('../src/lib/library.js');
const { setCitationContext, extract, renderRefs } = await import('../src/lib/citations.js');
const { parseKeywords, sourceMap, retrievalBody } = await import('../src/lib/grounded.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name} ${detail ? `→ ${detail}` : ''}`);
  }
}

const records = [
  {
    i: 'al-kafi:2:1:1:1',
    t: 'ALKAFI-2.1.1.1',
    c: 'Al-Kafi, Vol. 2, Book 1, Chapter 1, Hadith 1',
    u: 'https://thaqalayn.net/hadith/2/1/1/1',
    s: 'verified',
    a: 'عَنْ أَبِي جَعْفَرٍ عليه السلام قَالَ الصَّلَاةُ عَمُودُ الدِّينِ',
    e: 'Abu Jafar (a.s.) said: Prayer is the pillar of religion.',
    b: 'al-kafi',
  },
  {
    i: 'al-kafi:2:1:1:2',
    t: 'ALKAFI-2.1.1.2',
    c: 'Al-Kafi, Vol. 2, Book 1, Chapter 1, Hadith 2',
    u: 'https://thaqalayn.net/hadith/2/1/1/2',
    s: 'unverified',
    a: 'قَالَ رَسُولُ اللَّهِ صلى الله عليه وآله الصَّوْمُ جُنَّةٌ',
    e: 'The Messenger of Allah said: Fasting is a shield.',
    b: 'al-kafi',
  },
  {
    i: 'quran:2:255',
    t: 'QURAN-2.255',
    c: 'Quran 2:255 (Ayat al-Kursi)',
    u: 'https://thaqalayn.net/quran/2/255',
    s: 'verified',
    a: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ',
    e: 'Allah! There is no god but He, the Living, the Self-subsisting.',
    b: 'quran',
  },
  {
    i: 'sahifa-sajjadiya:1:1',
    t: 'SAHIFA-1',
    c: 'Sahifa Sajjadiya, Dua 1',
    u: null,
    s: 'no-url',
    a: 'الْحَمْدُ لِلَّهِ الَّذِي لَيْسَ لِقَضَائِهِ دَافِعٌ',
    e: '',
    b: 'sahifa-sajjadiya',
  },
];

console.log('\n── Normalisation & tokens');
ok('harakat stripped', !/[\u064B-\u0652]/.test(normaliseArabic('الصَّلَاةُ')));
ok('alif/ta-marbuta unified', tokenize('صلاة').join() === tokenize('صلاه').join());
ok('definite article dropped', tokenize('الصلاة').includes('صلاه') || tokenize('الصلاة')[0] === 'صلاه');
ok('Arabic stopwords removed', !tokenize('في من على').length);
ok('English stopwords removed', !tokenize('the of and').length);

console.log('\n── Retrieval');
const idx = useIndex(buildIndex(records, { books: [] }));
const hits = search('الصلاة عمود الدين', { k: 3 });
ok('prayer query ranks prayer hadith first', hits[0]?.rec.i === 'al-kafi:2:1:1:1', hits[0]?.rec.i);
const hitsEn = search('fasting shield', { k: 3 });
ok('English query finds fasting hadith', hitsEn[0]?.rec.i === 'al-kafi:2:1:1:2', hitsEn[0]?.rec.i);
ok('unknown query returns nothing', search('بيسكويت', { k: 3 }).length === 0);
ok('book filter works', search('الصلاة', { k: 5, books: ['quran'] }).length === 0);
ok('index holds all records', idx.records.length === 4);

console.log('\n── Grounding: only retrieved ids are citable');
const map = sourceMap(hits.slice(0, 1));
setCitationContext(map);
const allowedId = 'al-kafi:2:1:1:1';
const rejectedId = 'al-kafi:2:1:1:99';
const raw = `جواب [S1] ہے۔\n\n\`\`\`refs\n[{"id":"${allowedId}"},{"id":"${rejectedId}"}]\n\`\`\``;
const { refs } = extract(raw);
ok('retrieved id accepted', refs[0]?.kind === 'library' && refs[0].allowed === true);
ok('invented id rejected', refs[1]?.allowed === false && refs[1]?.url === null);
ok('model-supplied url ignored', (() => {
  const r = extract(`\`\`\`refs\n[{"id":"${allowedId}","url":"https://evil.example/x"}]\n\`\`\``).refs[0];
  return r.url === 'https://thaqalayn.net/hadith/2/1/1/1';
})());
ok('url and arabic come from record', refs[0]?.url === records[0].u && refs[0]?.arabic === records[0].a);
ok('verified record shows verified badge', renderRefs(refs.slice(0, 1), 'm').includes('verified link'));
ok('rejected ref shows not-in-sources badge', renderRefs(refs.slice(1, 2), 'm').includes('مسترد'));

setCitationContext(sourceMap(search('الصوم جنة', { k: 3 })));
const unv = extract(`\`\`\`refs\n[{"id":"al-kafi:2:1:1:2"}]\n\`\`\``).refs[0];
ok('unverified record flagged, link still shown', unv.valid === false && renderRefs([unv], 'u').includes('not yet verified'));

const noUrl = (() => {
  setCitationContext(new Map([[records[3].i, viewOf(records[3])]]));
  return extract(`\`\`\`refs\n[{"id":"sahifa-sajjadiya:1:1"}]\n\`\`\``).refs[0];
})();
ok('no-url source has no link', noUrl.url === null && renderRefs([noUrl], 's').includes('no online link'));

setCitationContext(null);
ok('without context every library id is rejected', extract(`\`\`\`refs\n[{"id":"${allowedId}"}]\n\`\`\``).refs[0].allowed === false);

console.log('\n── Model-facing context & fallbacks');
const block = contextBlock(hits.slice(0, 1));
ok('context block carries id and source arabic', block.includes(`id=${allowedId}`) && block.includes(records[0].a.slice(0, 20)));
ok('context block states verification', block.includes('verification: verified'));
ok('keywords parsed from fenced JSON', parseKeywords('```json\n{"ar":["صلاة"],"en":["prayer"]}\n```').ar[0] === 'صلاة');
ok('keyword junk yields empty lists', parseKeywords('no json here').en.length === 0);
const local = retrievalBody(hits.slice(0, 2), { noKey: true });
ok('retrieval-only body lists refs block', local.includes('```refs') && local.includes('retrieval-only'));
ok('no-hit body says nothing found', retrievalBody([]).includes('کوئی روایت'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
