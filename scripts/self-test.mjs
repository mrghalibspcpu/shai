#!/usr/bin/env node
/**
 * SHIA AI · Self-test
 * ─────────────────────────────────────────────────────────────
 * Exercises the client-side pipeline in a jsdom DOM against the REAL shipped
 * dataset (public/data/…):
 *   URL policy → text normalisation → dataset validation → retrieval
 *   → citations → markdown (hadith cards) → system prompt → chat scroll guard
 *   → API-key validation → Gemini errors → storage
 *
 *   npm run test:unit
 */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
const section = (title) => console.log(`\n\x1b[1m\x1b[36m${title}\x1b[0m`);

/* ── DOM (needed by chat / markdown / onboarding modules) ─────── */
const dom = new JSDOM(
  '<!doctype html><html dir="rtl"><body><div id="thread"></div><button id="scroll-bottom" hidden></button><textarea id="input"></textarea><div id="toast"></div></body></html>',
  { url: 'https://shia-ai.local/', pretendToBeVisual: true }
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

/* ── 1 · URL policy ──────────────────────────────────────────── */
section('1 · Absolute URL policy');
const S = await import('../src/lib/sources.js');

eq('hadith URL is absolute', S.hadithUrl(1, 0, 1, 1), 'https://thaqalayn.com/hadith/1/0/1/1');
eq('chapter URL', S.chapterUrl(9, 3, 38), 'https://thaqalayn.com/chapter/9/3/38');
eq('book URL', S.bookUrl(32), 'https://thaqalayn.com/book/32');
eq('quran URL', S.quranUrl(2, 255), 'https://thaqalayn.com/quran/2/255');
eq('safeHref keeps allowed https', S.safeHref('https://thaqalayn.com/hadith/1/0/1/1'), 'https://thaqalayn.com/hadith/1/0/1/1');
eq('safeHref keeps sistani.org', S.safeHref('https://www.sistani.org/english/book/48/2119/'), 'https://www.sistani.org/english/book/48/2119/');
eq('safeHref rejects thaqalayn: protocol', S.safeHref('thaqalayn:24/1/2/3'), '');
eq('safeHref rejects relative', S.safeHref('/hadith/1/0/1/1'), '');
eq('safeHref rejects http', S.safeHref('http://thaqalayn.com/hadith/1/0/1/1'), '');
eq('safeHref rejects foreign host', S.safeHref('https://evil.example/hadith/1/0/1/1'), '');
eq('safeHref rejects javascript:', S.safeHref('javascript:alert(1)'), '');
ok('thaqalyn.net is an allowed host', S.ALLOWED_HOSTS.includes('thaqalyn.net'));

/* ── 2 · Text normalisation & keys ───────────────────────────── */
section('2 · Text normalisation');
const T = await import('../src/lib/text.js');
eq('harakat removed', T.normText('عَلَيْكُمْ'), 'علیکم');
eq('alef/yeh unified', T.normText('إِبْرَاهِيمَ'), 'ابراهیم');
eq('urdu heh unified with arabic heh', T.normText('ہ'), T.normText('ه'));
eq('latin diacritics stripped', T.normText('Al-Kāfi'), 'al kafi');
eq('urdu digits to ascii', T.normText('۱۷/۱۴'), '17 14');
ok('stopword list excludes content words', !T.STOPWORDS.has(T.normText('نماز')));

const G = await import('../src/lib/gemini.js');
ok('AIza key accepted', G.isPlausibleKey('AIzaSyD-1234567890abcdefghijklmnopqrst'));
ok('AQ key accepted (new format)', G.isPlausibleKey('AQ.Ab8RN6K1234567890abcdefghijklmnopqrstuvwx'));
ok('AQ key with plain alnum accepted', G.isPlausibleKey('AQabcdefghijklmnopqrstuvwxyz0123456789'));
ok('key with spaces rejected', !G.isPlausibleKey('AQ abcdefghijklmnopqrstuvwxyz0123'));
ok('too-short key rejected', !G.isPlausibleKey('AQ123'));
ok('random sentence rejected', !G.isPlausibleKey('hello world this is not a key'));
eq('key is trimmed', G.normaliseKey('  AQ.Ab8RN6K1234567890abcdefghijklm  '), 'AQ.Ab8RN6K1234567890abcdefghijklm');

/* ── 3 · Dataset ─────────────────────────────────────────────── */
section('3 · Dataset index');
const DS = await import('../src/lib/dataset.js');
const hadithJson = JSON.parse(readFileSync(join(ROOT, 'public/data/thaqalayn/hadith.json'), 'utf8'));
const fatawaJson = JSON.parse(readFileSync(join(ROOT, 'public/data/fatawa/fatawa.json'), 'utf8'));
const st = DS.installDataset({ hadith: hadithJson, fatawa: fatawaJson });
ok('dataset ready', st.status === 'ready', st.error);
ok('hadith records loaded', st.hadithCount >= 1000, `got ${st.hadithCount}`);
ok('fatawa rulings/Q&A loaded', st.fatwaCount >= 500, `got ${st.fatwaCount}`);
ok('every hadith URL is absolute https', DS.hadithRecords().every((r) => /^https:\/\/thaqalayn\.com\/hadith\/\d+\/\d+\/\d+\/\d+$/.test(r.url)));
ok('every fatwa URL is an allowed https source', DS.fatwaRecords().every((f) => S.safeHref(f.url) === f.url));
ok('no fatwa "note" rows are citable', DS.fatwaRecords().every((f) => f.type === 'ruling' || f.type === 'qa'));
const rec = DS.getHadith('1/0/1/1');
ok('record 1/0/1/1 resolves', !!rec);
eq('record collection name', rec?.collectionEn, 'Al-Kāfi');
eq('record URL rebuilt from ids', rec?.url, 'https://thaqalayn.com/hadith/1/0/1/1');
const badRow = DS.prepareHadith({ c: 15, b: 1, ch: 1, h: 1, ar: 'نص', en: 'x' });
ok('unknown collection rejected', badRow === null);
const tampered = DS.prepareHadith({ c: 1, b: 0, ch: 1, h: 1, ar: 'نص', en: 'x', url: 'thaqalayn:1/0/1/1' });
eq('stored URL string is never trusted', tampered?.url, 'https://thaqalayn.com/hadith/1/0/1/1');
ok('fatwa with foreign URL rejected', DS.prepareFatwa({ id: 'x', kind: 'ruling', en: 'a', url: 'https://evil.example/a' }) === null);

/* ── 4 · Retrieval ───────────────────────────────────────────── */
section('4 · Retrieval (RAG step 1)');
const R = await import('../src/lib/search.js');

const byId = R.retrieve('1/0/1/1');
eq('locator route for c/b/ch/h', byId.route, 'locator');
eq('locator returns exact record', byId.hadith[0]?.record.id, '1/0/1/1');
ok('locator result not empty', !byId.empty);

const fromUrl = R.retrieve('https://thaqalayn.com/hadith/2/3/1/14');
eq('thaqalayn.com hadith URL is parsed as locator', fromUrl.hadith[0]?.record.id, '2/3/1/14');

const labelled = R.retrieve('Al-Kafi vol 2 book 3 chapter 1 hadith 14');
eq('labelled locator finds the record', labelled.hadith[0]?.record.id, '2/3/1/14');
eq('labelled locator returns only that record', labelled.hadith.length, 1);

const missing = R.retrieve('99/1/1/1');
ok('unknown collection id → empty', missing.empty);
eq('unknown locator reason', missing.reason, 'locator-not-found');

const arabic = DS.getHadith('1/0/1/1').ar.slice(0, 90);
const matan = R.retrieve(arabic);
eq('pasted matan route', matan.route, 'matan');
eq('pasted matan record', matan.hadith[0]?.record.id, '1/0/1/1');

const kw = R.retrieve('نمازِ شب کی فضیلت');
ok('keyword search returns hadith for Urdu concept', kw.hadith.length > 0, `route=${kw.route}`);
ok('keyword results are dataset rows', kw.hadith.every((h) => DS.getHadith(h.record.id) === h.record));
ok('keyword results obey depth cap', R.retrieve('نماز', { depth: 'concise' }).hadith.length <= 3);

const sist = R.retrieve('روزے کے بارے میں سیستانی فتویٰ');
ok('fatwa retrieval returns Sistani rulings', sist.fatwa.length > 0 && sist.fatwa.every((f) => f.record.kind === 'fatwa'));

const nothing = R.retrieve('ہوائی جہاز');
ok('unknown topic → empty (no guessing)', nothing.empty, `reason=${nothing.reason}`);
eq('unknown topic reason', nothing.reason, 'no-match');
eq('greeting is not a search', R.retrieve('السلام علیکم').reason, 'no-content');
ok('empty query handled', R.retrieve('   ').empty);

const ctx = R.contextForPrompt(byId);
ok('context carries exact matan', ctx.includes('MATAN_AR (exact): ' + DS.getHadith('1/0/1/1').ar));
ok('context carries absolute URL', ctx.includes('URL=https://thaqalayn.com/hadith/1/0/1/1'));
ok('context carries ID', ctx.includes('ID=1/0/1/1'));
eq('no records → empty context', R.contextForPrompt(nothing), '');
eq('fallback refs are the retrieved ids', R.fallbackRefs(byId)[0]?.id, '1/0/1/1');

/* ── 5 · Citations ───────────────────────────────────────────── */
section('5 · Citation resolution');
const C = await import('../src/lib/citations.js');

const SAMPLE = `نمازِ شب کی فضیلت ہے۔ [1]

\`\`\`ar
عَلَيْكُمْ بِصَلَاةِ اللَّيْلِ
\`\`\`

\`\`\`refs
[{"id":"2/3/1/14"},{"id":"99/2/17/14"},{"surah":17,"verse":79,"title":"Tahajjud"}]
\`\`\``;
const parsed = C.extract(SAMPLE);
eq('valid refs kept, hallucinated id dropped', parsed.refs.length, 2);
eq('first ref is hadith', parsed.refs[0].kind, 'hadith');
eq('hadith ref URL from dataset', parsed.refs[0].url, 'https://thaqalayn.com/hadith/2/3/1/14');
ok('hadith ref carries grading from dataset', !!parsed.refs[0].grading?.label, JSON.stringify(parsed.refs[0].grading));
eq('second ref is quran', parsed.refs[1].kind, 'quran');
ok('refs block stripped from body', !parsed.body.includes('```refs') && !parsed.body.includes('99/2/17/14'));

const allowedOnly = (() => {
  C.setAllowedRefIds(['1/0/1/1']);
  const r = C.extract('```refs\n[{"id":"2/3/1/14"},{"id":"1/0/1/1"}]\n```').refs;
  C.setAllowedRefIds(null);
  return r;
})();
eq('citations limited to retrieved ids', allowedOnly.length, 1);
eq('the allowed id is the one kept', allowedOnly[0]?.id, '1/0/1/1');

const fatwaRef = C.extract('```refs\n[{"id":"sistani-48-2119-18"}]\n```').refs[0];
eq('fatwa ref kind', fatwaRef?.kind, 'fatwa');
eq('fatwa link is the sistani.org record URL', fatwaRef?.url, 'https://www.sistani.org/english/book/48/2119/');
ok('fatwa names the mujtahid', JSON.stringify(fatwaRef).includes('Sistani'));

const inlineOk = C.extract('یہ روایت thaqalayn:2/3/1/14 میں ہے۔');
eq('legacy inline token resolved via dataset', inlineOk.refs[0]?.url, 'https://thaqalayn.com/hadith/2/3/1/14');
ok('custom protocol token removed from prose', !inlineOk.body.includes('thaqalayn:2/3/1/14'));
ok('inline unknown token dropped', C.extract('متن thaqalayn:24/2/79/12 ختم').refs.length === 0);

const refsHtml = C.renderRefs(parsed.refs, 'm1');
ok('renderRefs shows absolute link', refsHtml.includes('href="https://thaqalayn.com/hadith/2/3/1/14"'));
ok('renderRefs never prints thaqalayn: protocol', !/thaqalayn:\d/.test(refsHtml));
ok('renderRefs fatwa card shows source link', C.renderRefs(C.extract('```refs\n[{"id":"sistani-48-2119-18"}]\n```').refs, 'm3').includes('https://www.sistani.org/english/book/48/2119/'));
ok('renderRefs escapes markup', !C.renderRefs([{ n: 1, kind: 'text', title: '<img src=x onerror=alert(1)>', valid: false, chapterTitle: '', note: '' }], 'm2').includes('<img'));

/* ── 6 · Markdown & hadith cards ─────────────────────────────── */
section('6 · Markdown · hadith cards');
const M = await import('../src/lib/markdown.js');

const arBlock = '```ar\n' + DS.getHadith('1/0/1/1').ar.slice(0, 120) + '\n```';
const mdCard = M.renderMarkdown(arBlock, { msgId: 'k' });
ok('matched Arabic block gets a hadith card', mdCard.includes('class="hcard"'));
ok('card shows book name and hadith number', mdCard.includes('Al-Kāfi') && mdCard.includes('Hadith #1'));
ok('card shows chapter', mdCard.includes('Chapter 1') && mdCard.includes('Introduction'));
ok('card link button uses dataset URL', mdCard.includes('href="https://thaqalayn.com/hadith/1/0/1/1"'));
ok('card shows exact dataset matan', mdCard.includes(DS.getHadith('1/0/1/1').ar.slice(0, 40)));

const unknownAr = M.renderMarkdown('```ar\nهذا نص غير موجود في قاعدة البيانات أبدا\n```', { msgId: 'u' });
ok('unmatched Arabic block flagged unverified', unknownAr.includes('hcard--warn') && unknownAr.includes('ar-block--unverified'));
ok('unverified block has no thaqalayn link', !unknownAr.includes('thaqalayn.com'));

const badLink = M.renderMarkdown('[اس لنک](thaqalayn:24/1/2/3) اور [بیرونی](https://evil.example/x)');
ok('custom-protocol markdown link not rendered as anchor', !badLink.includes('href="thaqalayn:'));
ok('foreign-host markdown link not rendered', !badLink.includes('evil.example'));
const goodLink = M.renderMarkdown('[تھقلین](https://thaqalayn.com/hadith/1/0/1/1)');
ok('allowed markdown link kept', goodLink.includes('href="https://thaqalayn.com/hadith/1/0/1/1"'));
ok('XSS escaped', !M.renderMarkdown('<script>alert(1)</script>').includes('<script>'));
ok('quran ref line links absolute', M.renderMarkdown('```q\nوَمِنَ اللَّيْلِ\n17:79\n```').includes('https://thaqalayn.com/quran/17/79'));

/* ── 7 · System prompt ───────────────────────────────────────── */
section('7 · System prompt');
const P = await import('../src/lib/prompt.js');
const sys = P.buildSystemInstruction({ depth: 'balanced', showArabic: true }, byId);
ok('persona is Shia AI', sys.includes('شیعہ اے آئی (Shia AI)'));
ok('no legacy SHAI persona', !sys.includes('SHAI'));
ok('records injected into context', sys.includes('ID=1/0/1/1') && sys.includes('URL=https://thaqalayn.com/hadith/1/0/1/1'));
ok('model told not to write URLs', sys.includes('URL مت لکھیں'));
ok('model told to translate only retrieved text', sys.includes('صرف دیے گئے ریکارڈز'));
ok('refs contract uses ids', sys.includes('"id"') && sys.includes('```refs'));
ok('arabic contract present when enabled', sys.includes('```ar'));
ok('arabic contract dropped when disabled', P.buildSystemInstruction({ showArabic: false }, byId) !== sys);
ok('fatwa mujtahid disclaimer present', sys.includes('مجتہد') && sys.includes('فتویٰ'));
ok('no unresolved template holes', !/\$\{/.test(sys));

/* ── 8 · Chat rendering + streaming scroll guard ─────────────── */
section('8 · Chat rendering & scroll guard');
const CH = await import('../src/ui/chat.js');
const thread = document.getElementById('thread');
const inner = CH.ensureInner(thread);
const { msg } = CH.addMessage(inner, { role: 'assistant', content: '', id: 'zz' });
ok('message added', !!msg);
CH.updateAiMessage(msg, SAMPLE, { done: true });
ok('hadith card rendered inside bubble', !!msg.querySelector('.hcard'));
ok('unverified Arabic block shown as warning card', !!msg.querySelector('.hcard--warn'));
ok('reference links are absolute', Array.from(msg.querySelectorAll('a')).filter((a) => /thaqalayn|sistani/.test(a.href)).every((a) => a.href.startsWith('https://')));
ok('streaming caret removed when done', !msg.querySelector('.caret'));

// Scroll guard: give the thread a real geometry so "at bottom" is meaningful.
const scrollBtn = document.getElementById('scroll-bottom');
let scrollTopVal = 0;
Object.defineProperty(thread, 'scrollHeight', { configurable: true, get: () => 1000 });
Object.defineProperty(thread, 'clientHeight', { configurable: true, get: () => 300 });
Object.defineProperty(thread, 'scrollTop', { configurable: true, get: () => scrollTopVal, set: (v) => (scrollTopVal = v) });
CH.initScrollGuard();
CH.initScrollGuard(); // idempotent
CH.setStreaming(true);
scrollTopVal = 700; // user is at the bottom
CH.followIfNeeded();
eq('follows the bottom while at the end', scrollTopVal, 1000);

scrollTopVal = 200; // user scrolls up by touching
thread.dispatchEvent(new dom.window.Event('touchstart', { bubbles: true }));
ok('touch pauses following', CH.isAtBottom(thread) === false);
scrollTopVal = 200;
CH.followIfNeeded();
eq('streamed text does NOT yank the view while paused', scrollTopVal, 200);
ok('scroll-to-bottom button shown while paused', scrollBtn.hidden === false);

scrollBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
eq('button resumes and jumps to newest text', scrollTopVal, 1000);
ok('button hidden after resuming', scrollBtn.hidden === true);

scrollTopVal = 100;
thread.dispatchEvent(new dom.window.Event('wheel', { bubbles: true }));
CH.setStreaming(false);
CH.setStreaming(true); // a new stream starts following again
CH.followIfNeeded();
eq('new stream follows again', scrollTopVal, 1000);

/* ── 9 · Gemini error mapping ────────────────────────────────── */
section('9 · Gemini client');
const e400 = G.friendlyError(new G.GeminiError('API key not valid', { status: 400 }));
ok('400 maps to invalid key (ur)', e400.title.includes('API key'));
const eNet = G.friendlyError(new G.GeminiError('offline', { status: 0 }));
ok('offline mapped', eNet.title.length > 0);
eq('best model prefers 2.5 flash', G.bestModel([{ name: 'gemini-1.5-flash' }, { name: 'gemini-2.5-flash' }]), 'gemini-2.5-flash');

/* ── 10 · Storage (API key persistence) ──────────────────────── */
section('10 · Storage');
const ST = await import('../src/lib/storage.js');
await ST.store.set('__test', { a: 1, b: 'اردو' });
const back = await ST.store.get('__test');
ok('storage round-trip', back && back.a === 1 && back.b === 'اردو');
await ST.store.remove('__test');
eq('storage remove', await ST.store.get('__test', null), null);
await ST.setApiKey('  AQ.Ab8RN6K1234567890abcdefghijklm  ');
eq('AQ key saved trimmed', await ST.getApiKey(), 'AQ.Ab8RN6K1234567890abcdefghijklm');
await ST.clearApiKey();
eq('key cleared', await ST.getApiKey(), '');
const defs = await ST.getSettings();
eq('default model', defs.model, 'gemini-2.5-flash');

/* ── Result ──────────────────────────────────────────────────── */
console.log(`\n\x1b[1m${fail === 0 ? '\x1b[32mALL GREEN' : '\x1b[31mFAILURES'}\x1b[0m — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
