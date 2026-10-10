#!/usr/bin/env node
/**
 * SHAI · Self-test
 * ─────────────────────────────────────────────────────────────
 * Runs the whole client-side pipeline in a jsdom DOM:
 *   sources → citations → markdown → chat rendering → prompt → gemini errors
 *
 *   npm i --no-save jsdom && node scripts/self-test.mjs
 */

import { JSDOM } from 'jsdom';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name} ${detail ? `→ ${detail}` : ''}`);
  }
}
const eq = (name, actual, expected) =>
  ok(name, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);

function section(title) {
  console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`);
}

/* ── DOM ─────────────────────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><html dir="rtl"><body><div id="thread"></div><div id="toast"></div></body></html>', {
  url: 'https://shai.local/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

/* ── 1 · Sources ─────────────────────────────────────────────── */
section('1 · Thaqalayn source registry');
const S = await import('../src/lib/sources.js');

eq('hadith URL', S.hadithUrl(1, 2, 17, 14), 'https://thaqalayn.com/hadith/1/2/17/14');
eq('chapter URL', S.chapterUrl(9, 3, 38), 'https://thaqalayn.com/chapter/9/3/38');
eq('book URL', S.bookUrl(32), 'https://thaqalayn.com/book/32');
eq('arabic URL', S.hadithUrlAr(1, 2, 17, 14), 'https://thaqalayn.com/ar/hadith/1/2/17/14');
eq('quran URL', S.quranUrl(2, 255), 'https://thaqalayn.com/quran/2/255');
eq('surah name', S.surahName(2), 'Al-Baqara');
eq('surah name 114', S.surahName(114), 'An-Nās');
ok('valid collection 1', S.isValidCollection(1));
ok('valid collection 45', S.isValidCollection(45));
ok('INVALID collection 15 rejected', !S.isValidCollection(15));
ok('INVALID collection 99 rejected', !S.isValidCollection(99));
eq('collection title', S.collection(9).en, 'Muʿjam al-Aḥādīth al-Muʿtabara');
eq('collection volume', S.collection(8).vol, 8);

const p1 = S.parsePath('1/2/17/14');
ok('parsePath valid', p1.valid === true);
eq('parsePath url', p1.url, 'https://thaqalayn.com/hadith/1/2/17/14');
const pBad = S.parsePath('99/2/17/14');
ok('parsePath flags unknown collection', pBad.valid === false);
ok('parsePath rejects junk', S.parsePath('not-a-path') === null);

/* ── 2 · Citations ───────────────────────────────────────────── */
section('2 · Citation extraction');
const C = await import('../src/lib/citations.js');

const SAMPLE = `نمازِ شب بندے کو اللہ کے قرب تک پہنچانے والی عبادت ہے۔ [1]

## فضیلتِ نمازِ شب

1. **اللہ کا قرب:** امام صادق علیہ السلام فرماتے ہیں [1]

\`\`\`ar
عَلَيْكُمْ بِصَلَاةِ اللَّيْلِ
\`\`\`
\`\`\`tr
رات کی نماز کو لازم پکڑو۔
\`\`\`

\`\`\`q
وَمِنَ اللَّيْلِ فَتَهَجَّدْ بِهِ
17:79
\`\`\`

\`\`\`refs
[
  {"path":"1/3/83/10","grading":"Sahih","grader":"Allama Majlisi","title":"Excellence of the night prayer"},
  {"surah":17,"verse":79,"title":"The Night Journey"}
]
\`\`\`
`;

const parsed = C.extract(SAMPLE);
eq('refs extracted', parsed.refs.length, 2);
ok('refs block stripped from body', !parsed.body.includes('```refs'));
ok('json not leaked into body', !parsed.body.includes('"grading"'));
eq('ref 1 is hadith', parsed.refs[0].kind, 'hadith');
eq('ref 1 verified', parsed.refs[0].valid, true);
eq('ref 1 url', parsed.refs[0].path.url, 'https://thaqalayn.com/hadith/1/3/83/10');
eq('ref 1 grading class', parsed.refs[0].grading.cls, 'sahih');
eq('ref 2 is quran', parsed.refs[1].kind, 'quran');
eq('ref 2 url', parsed.refs[1].url, 'https://thaqalayn.com/quran/17/79');
ok('not streaming when fence closed', parsed.streaming === false);

const partial = C.extract('جواب جاری ہے…\n\n```refs\n[{"path":"1/2/17/14"');
ok('mid-stream refs hidden', !partial.body.includes('1/2/17/14') && partial.streaming === true);

const inlineOnly = C.extract('یہ روایت thaqalayn:24/2/79/12 میں ملتی ہے۔');
eq('inline thaqalayn token parsed', inlineOnly.refs.length, 1);
eq('inline token url', inlineOnly.refs[0].path.url, 'https://thaqalayn.com/hadith/24/2/79/12');
ok('inline token removed from prose', !inlineOnly.body.includes('thaqalayn:24/2/79/12'));

const bogus = C.extract('```refs\n[{"path":"99/2/17/14"}]\n```');
eq('hallucinated id still parsed', bogus.refs.length, 1);
eq('hallucinated id marked unverified', bogus.refs[0].valid, false);

const refsHtml = C.renderRefs(parsed.refs, 'm1');
ok('renderRefs has section', refsHtml.includes('class="refs"'));
ok('renderRefs has hadith link', refsHtml.includes('https://thaqalayn.com/hadith/1/3/83/10'));
ok('renderRefs has quran link', refsHtml.includes('https://thaqalayn.com/quran/17/79'));
ok('renderRefs anchors match cite markers', refsHtml.includes('id="m1-ref-1"'));
ok('renderRefs escapes XSS', !C.renderRefs([{ n: 1, kind: 'text', title: '<img src=x onerror=alert(1)>', valid: false, chapterTitle: '', note: '' }], 'm2').includes('<img'));

/* ── 3 · Markdown ────────────────────────────────────────────── */
section('3 · Markdown renderer');
const M = await import('../src/lib/markdown.js');

const md = M.renderMarkdown(parsed.body, { msgId: 'm1', refs: parsed.refs });
ok('h2 rendered', md.includes('<h2>'));
ok('ordered list rendered', md.includes('<ol>') && md.includes('<li>'));
ok('bold rendered', md.includes('<strong>'));
ok('arabic block rendered', md.includes('class="ar-block"'));
ok('arabic block not double-wrapped', !md.includes('ar-block" lang="ar" dir="rtl"><span class="ar-inline"'));
ok('quran block rendered', md.includes('class="q-block"'));
ok('quran ref link rendered', md.includes('https://thaqalayn.com/quran/17/79'));
ok('translation block rendered', md.includes('class="tr-block"'));
ok('citation marker anchored', md.includes('href="#m1-ref-1"'));
ok('no raw markers left', !/^##\s/m.test(md));
ok('XSS escaped', !M.renderMarkdown('<script>alert(1)</script>').includes('<script>'));

const nested = M.renderMarkdown('- ایک\n  - دو\n    - تین\n- چار');
ok('nested bullet list', (nested.match(/<ul>/g) || []).length >= 2);
const tbl = M.renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
ok('table rendered', tbl.includes('<table>') && tbl.includes('<th>a</th>'));
const code = M.renderMarkdown('```js\nconst x = 1 < 2;\n```');
ok('code block escaped', code.includes('<pre>') && code.includes('&lt;'));

/* ── 4 · Chat rendering (jsdom) ──────────────────────────────── */
section('4 · Chat rendering');
const CH = await import('../src/ui/chat.js');
const thread = document.getElementById('thread');
const inner = CH.ensureInner(thread);
const { msg } = CH.addMessage(inner, { role: 'assistant', content: SAMPLE, id: 'zz' });
ok('message added', !!msg);
ok('bubble has md', !!msg.querySelector('.md'));
const refLinks = msg.querySelectorAll('.refs a.ref__link[href^="https://thaqalayn.com"]');
ok('reference links rendered', refLinks.length >= 3, `found ${refLinks.length}`);
ok('all links open safely', Array.from(refLinks).every((a) => a.rel.includes('noopener')));
CH.updateAiMessage(msg, SAMPLE, { done: true });
ok('streaming caret removed when done', !msg.querySelector('.caret'));
ok('plain text strips refs block', !CH.escapeHtml('').includes('script') && !M.toPlainText(SAMPLE).includes('"grading"'));

/* ── 5 · Prompt ──────────────────────────────────────────────── */
section('5 · System prompt');
const { buildSystemInstruction } = await import('../src/lib/prompt.js');
const sys = buildSystemInstruction({ depth: 'balanced', showArabic: true, strictGrading: true });
ok('persona present', sys.includes('SHAI'));
ok('urdu output enforced', sys.includes('اردو'));
ok('anti-hallucination rule present', sys.includes('Zero Hallucination'));
ok('refs contract present', sys.includes('```refs'));
ok('catalogue embedded', sys.includes('Al-Kāfi') && sys.includes('45 ='));
ok('catalogue has every valid id', S.VALID_IDS.every((id) => sys.includes(`${id} =`)));
ok('depth respected', buildSystemInstruction({ depth: 'detailed' }).includes('تفصیلی'));
const noAr = buildSystemInstruction({ showArabic: false });
ok('arabic can be disabled', noAr.includes('عربی متن شامل نہ کریں'));
ok('disabled prompt drops ```ar contract', !noAr.includes('```ar'));
ok('enabled prompt keeps ```ar contract', sys.includes('```ar'));
ok('no unresolved template holes', !/\$\{(?!msgId)/.test(sys) || !sys.includes('${'));

/* ── 6 · Gemini client ───────────────────────────────────────── */
section('6 · Gemini client');
const G = await import('../src/lib/gemini.js');
ok('plausible key accepted', G.isPlausibleKey('AIzaSyD-1234567890abcdefghijklmnopqrst'));
ok('random string rejected', !G.isPlausibleKey('hello world'));
ok('key is trimmed', G.normaliseKey('  AIzaSyD-1234567890abcdefghijklmnopqrst  ') === 'AIzaSyD-1234567890abcdefghijklmnopqrst');
eq('best model prefers 2.5 flash', G.bestModel([{ name: 'gemini-1.5-flash' }, { name: 'gemini-2.5-flash' }]), 'gemini-2.5-flash');
eq('best model falls back', G.bestModel([{ name: 'gemini-1.5-flash-8b' }]), 'gemini-1.5-flash-8b');
const e403 = G.friendlyError(new G.GeminiError('API key not valid', { status: 400 }));
ok('400 maps to invalid key (ur)', e403.title.includes('API key'));
const eNet = G.friendlyError(new G.GeminiError('offline', { status: 0 }));
ok('offline mapped', eNet.title.length > 0);

/* ── 7 · Storage round-trip ──────────────────────────────────── */
section('7 · Storage');
const ST = await import('../src/lib/storage.js');
await ST.store.set('__test', { a: 1, b: 'اردو' });
const back = await ST.store.get('__test');
ok('storage round-trip', back && back.a === 1 && back.b === 'اردو');
await ST.store.remove('__test');
eq('storage remove', await ST.store.get('__test', null), null);
const defs = await ST.getSettings();
eq('default model', defs.model, 'gemini-2.5-flash');

/* ── Result ──────────────────────────────────────────────────── */
console.log(`\n\x1b[1m${fail === 0 ? '\x1b[32mALL GREEN' : '\x1b[31mFAILURES'}\x1b[0m — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
