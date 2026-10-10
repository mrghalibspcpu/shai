#!/usr/bin/env node
/**
 * SHAI · Font pipeline
 * ─────────────────────────────────────────────────────────────
 * The Jameel Noori Nastaleeq TTF that ships in the repository root is
 * ~10.8 MB / 19,658 glyphs. Nastaleeq genuinely needs those ~19k ligature
 * glyphs to shape correctly (dropping `rlig` collapses it to 402 glyphs but
 * the result is no longer Nastaleeq), so the only safe win is:
 *
 *   1. drop every codepoint the app can never type (CJK, Cyrillic, Greek, …)
 *   2. re-compress with Brotli → WOFF2 (~5.3 MB, ~50 % smaller)
 *   3. load it with `font-display: swap` so first paint never blocks
 *
 * Requires Python + fonttools[brotli]  →  pip install fonttools brotli
 * If fonttools is missing the script exits successfully and keeps whatever
 * subset is already committed under src/assets/fonts/.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/assets/fonts');
const OUT = join(OUT_DIR, 'JameelNooriNastaleeq.woff2');

const CANDIDATES = [
  process.env.SHAI_FONT_SRC,
  join(ROOT, 'Jameel Noori Nastaleeq Regular.ttf'),
  join(ROOT, 'assets', 'Jameel Noori Nastaleeq Regular.ttf'),
  join(ROOT, 'assets-src', 'fonts', 'Jameel Noori Nastaleeq Regular.ttf'),
].filter(Boolean);

// Everything SHAI can ever render: Latin, Arabic-script (incl. Qur'anic marks,
// extended + presentation forms), general punctuation, currency, CJK-ish spaces.
const UNICODES = [
  'U+0000-00FF', // Basic Latin + Latin-1
  'U+0100-017F', // Latin Extended-A
  'U+2000-206F', // General punctuation (ZWNJ/ZWJ, quotes, dashes…)
  'U+20A0-20BF', // Currency symbols
  'U+0600-06FF', // Arabic
  'U+0750-077F', // Arabic Supplement
  'U+08A0-08FF', // Arabic Extended-A
  'U+FB50-FDFF', // Arabic Presentation Forms-A
  'U+FE70-FEFF', // Arabic Presentation Forms-B
  'U+FE00-FE0F', // Variation selectors
  'U+3000-303F', // CJK symbols & punctuation (ideographic space…)
].join(',');

const FEATURES = '*'; // keep every layout feature — Nastaleeq shaping depends on them

function findPython() {
  for (const cmd of [process.env.SHAI_PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(cmd, ['-c', 'import fontTools, brotli'], { stdio: 'ignore' });
    if (r.status === 0) return cmd;
  }
  return null;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

const src = CANDIDATES.find((p) => existsSync(p));

if (!src) {
  console.warn('[fonts] ⚠ source TTF not found — keeping the committed subset.');
  console.warn('[fonts]   expected: "Jameel Noori Nastaleeq Regular.ttf" in the repo root.');
  process.exit(0);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const py = findPython();
if (!py) {
  console.warn('[fonts] ⚠ fonttools/brotli not available (pip install fonttools brotli).');
  console.warn('[fonts]   keeping the committed subset at src/assets/fonts/.');
  process.exit(0);
}

console.log(`[fonts] source : ${src} (${mb(statSync(src).size)})`);

const tmpTtf = join(OUT_DIR, '.JameelNooriNastaleeq.subset.ttf');

const subsetArgs = [
  '-m',
  'fontTools.subset',
  src,
  `--output-file=${tmpTtf}`,
  `--unicodes=${UNICODES}`,
  `--layout-features=${FEATURES}`,
  '--no-hinting',
  '--glyph-names',
  '--symbol-cmap',
  '--legacy-cmap',
  '--name-IDs=1,2,4,6,16,17',
  '--drop-tables+=DSIG',
];

console.log('[fonts] subsetting…');
execFileSync(py, subsetArgs, { stdio: ['ignore', 'ignore', 'inherit'] });

console.log('[fonts] compressing to woff2…');
execFileSync(
  py,
  [
    '-c',
    [
      'from fontTools.ttLib import TTFont',
      `f = TTFont(${JSON.stringify(tmpTtf)})`,
      'f.flavor = "woff2"',
      `f.save(${JSON.stringify(OUT)})`,
    ].join('\n'),
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);

const before = statSync(src).size;
const after = statSync(OUT).size;
console.log(`[fonts] ✔ ${OUT.replace(ROOT + '/', '')} — ${mb(before)} → ${mb(after)}`);

try {
  const { unlinkSync } = await import('node:fs');
  unlinkSync(tmpTtf);
} catch (_) {
  /* best effort */
}

