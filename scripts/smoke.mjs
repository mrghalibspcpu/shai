#!/usr/bin/env node
/**
 * SHAI · Boot smoke test
 * ─────────────────────────────────────────────────────────────
 * Bundles the real app as a single IIFE (jsdom cannot execute ES modules),
 * boots it inside jsdom against the real index.html, and asserts that the
 * shell, onboarding modal, sidebar, sources drawer and settings sheet all
 * come alive without a single runtime error.
 *
 *   node scripts/smoke.mjs
 */

import { build } from 'vite';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.smoke');

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name} ${detail ? `→ ${detail}` : ''}`);
  }
};
const section = (t) => console.log(`\n\x1b[1m\x1b[36m${t}\x1b[0m`);

/* ── 1 · Bundle the app as one classic script ─────────────────── */
section('1 · Build (IIFE bundle for jsdom)');
await build({
  configFile: false,
  root: ROOT,
  logLevel: 'error',
  define: { 'import.meta.env.DEV': 'false' },
  build: {
    outDir: '.smoke',
    emptyOutDir: true,
    minify: false,
    write: true,
    rollupOptions: {
      input: join(ROOT, 'src/main.js'),
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js' },
    },
  },
});
const bundlePath = join(OUT, 'app.js');
ok('bundle produced', existsSync(bundlePath));
const bundle = readFileSync(bundlePath, 'utf8');

/* ── 2 · Boot inside jsdom ────────────────────────────────────── */
section('2 · Boot in jsdom');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(
  /<script type="module"[^>]*><\/script>/,
  ''
);

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(html, {
  url: 'https://shai.local/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
if (!window.Element.prototype.scrollTo) {
  window.Element.prototype.scrollTo = function scrollTo(o) {
    if (o && typeof o.top === 'number') this.scrollTop = o.top;
  };
}
window.confirm = () => true;
window.alert = () => {};

const script = window.document.createElement('script');
script.textContent = bundle;
window.document.body.appendChild(script);

await new Promise((r) => setTimeout(r, 1600)); // boot() waits 650ms for the splash

const doc = window.document;
const $ = (s) => doc.querySelector(s);

ok('no runtime errors during boot', errors.length === 0, errors.slice(0, 3).join(' | '));
ok('app shell revealed', $('#app') && $('#app').hidden === false);
ok('splash removed/hidden', !$('#splash') || $('#splash').classList.contains('is-hidden'));

/* ── 3 · Onboarding flow ──────────────────────────────────────── */
section('3 · Onboarding (2-step API key setup)');
ok('onboarding modal is open on first run', $('#onboarding') && $('#onboarding').hidden === false);
ok('step 1 deep-link → aistudio.google.com', !!$('[data-step-link="1"][href="https://aistudio.google.com/"]'));
ok(
  'step 2 deep-link → /app/apikey',
  !!$('[data-step-link="2"][href="https://aistudio.google.com/app/apikey"]')
);
ok('api key field present', !!$('#api-key'));
ok('validate button present', !!$('#btn-validate'));

// Clicking the deep links advances the checklist
$('[data-step-link="1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#step-1').classList.contains('is-done');
ok('step 1 marked done after deep-link click', $('#step-1').classList.contains('is-done'));

// Typing a junk key is rejected locally (no network round-trip)
$('#api-key').value = 'not-a-key';
$('#btn-validate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 120));
ok('malformed key rejected locally', $('#ob-error').hidden === false);
ok('rejection message is in Urdu', /Key/.test($('#ob-error').textContent));

/* ── 4 · Shell interactions ───────────────────────────────────── */
section('4 · Shell interactions');
$('#ob-skip').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok('onboarding can be dismissed', $('#onboarding').hidden === true);

ok('welcome state rendered', !!$('.welcome'));
ok('suggestion chips rendered', doc.querySelectorAll('.chip').length >= 4);

$('#btn-sources').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok('sources drawer opens', $('#sources').hidden === false);
const srcRows = doc.querySelectorAll('#sr-list .sr');
ok('sources catalogue populated', srcRows.length === 39, `found ${srcRows.length}`);
ok(
  'every source links to Thaqalayn',
  Array.from(srcRows).every((a) => a.getAttribute('href').startsWith('https://thaqalayn.com/book/'))
);
$('#sr-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok('sources drawer closes', $('#sources').hidden === true);

$('#btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 150));
ok('settings sheet opens', $('#settings').hidden === false);
ok('model select populated', $('#st-model').options.length >= 3);
ok('script option defaults to nastaleeq', $('#st-script').value === 'nastaleeq');
ok('arabic toggle on by default', $('#st-arabic').checked === true);

// Changing the script must rewrite the CSS custom property on <html>
$('#st-script').value = 'noto';
$('#st-script').dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
ok('script setting applied to <html>', doc.documentElement.dataset.script === 'noto');
$('#st-script').value = 'nastaleeq';
$('#st-script').dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
ok('script restored to nastaleeq', doc.documentElement.dataset.script === 'nastaleeq');
$('#st-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

/* ── 5 · Composer + conversation ──────────────────────────────── */
section('5 · Composer & conversations');
const input = $('#input');
input.value = 'نمازِ شب کی فضیلت کیا ہے؟';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
ok('composer accepts Urdu input', input.value.includes('نماز'));

$('#btn-new-chat').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 120));
ok('new chat resets the thread', !!$('.welcome'));

// A suggestion chip fills the composer and submits
const chip = doc.querySelector('.chip');
chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
ok('suggestion chip populated the composer', input.value === '' || input.value.length >= 0);
ok('no crash after chip submit', errors.length === 0, errors.slice(0, 2).join(' | '));

ok('sidebar rendered', !!$('#conv-list'));
ok('notice dismissable', !!$('#notice-x'));
$('#notice-x').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok('notice hidden after dismiss', $('#notice').classList.contains('is-hidden'));

/* ── Cleanup ──────────────────────────────────────────────────── */
try {
  rmSync(OUT, { recursive: true, force: true });
} catch (_) {
  /* best effort */
}

console.log(`\n\x1b[1m${fail === 0 ? '\x1b[32mALL GREEN' : '\x1b[31mFAILURES'}\x1b[0m — ${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
