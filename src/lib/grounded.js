/**
 * SHAI · Grounded turn preparation
 * ─────────────────────────────────────────────────────────────
 * For one user question:
 *   1. Load the on-device library (once).
 *   2. Build search terms: the question itself + Arabic/English keywords.
 *      Keywords come from Gemini when a key is present (search terms only;
 *      Gemini is NOT asked for matn, references or URLs). Without a key we
 *      search with the question words alone (retrieval-only mode).
 *   3. Retrieve the top sources. Only these ids may be cited this turn.
 *   4. If there is a key and at least one source, the model answers from the
 *      sources. Otherwise the reply is built locally from the sources.
 */

import { search, loadLibrary, viewOf, contextBlock, tokenize } from './library.js';
import { generate, normaliseKey } from './gemini.js';
import { KEYWORD_INSTRUCTION } from './prompt.js';

export const TOP_K = 6;

/** Parse the JSON object the keyword prompt returns; tolerate code fences and junk. */
export function parseKeywords(text) {
  const clean = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) return { ar: [], en: [] };
  try {
    const obj = JSON.parse(m[0]);
    const pick = (a) => (Array.isArray(a) ? a.map((x) => String(x)).filter((x) => x.trim()).slice(0, 8) : []);
    return { ar: pick(obj.ar), en: pick(obj.en) };
  } catch (_) {
    return { ar: [], en: [] };
  }
}

/** Ask Gemini for search keywords only. Returns empty lists on any failure. */
export async function extractKeywords({ apiKey, model, question, signal }) {
  try {
    const out = await generate({
      apiKey,
      model,
      system: KEYWORD_INSTRUCTION,
      message: question,
      temperature: 0,
      maxOutputTokens: 256,
      signal,
    });
    return parseKeywords(out);
  } catch (_) {
    return { ar: [], en: [] };
  }
}

/** Turn retrieved hits into a map id → view, the only set the model may cite. */
export function sourceMap(hits) {
  const m = new Map();
  for (const h of hits) m.set(h.rec.i, viewOf(h.rec));
  return m;
}

/** Local, model-free answer listing the retrieved sources (used without a key or with no hits). */
export function retrievalBody(hits, { noKey = false } = {}) {
  if (!hits.length) {
    return 'دیے گئے ماخذ میں اس سوال سے متعلق کوئی روایت یا آیت نہیں ملی۔ سوال کو مختلف الفاظ میں لکھ کر دوبارہ کوشش کریں۔';
  }
  const lines = hits.map((h, i) => {
    const v = viewOf(h.rec);
    return `- [S${i + 1}] ${v.citation}${v.verified ? '' : ' (ابھی تصدیق شدہ نہیں)'}`;
  });
  const intro = noKey
    ? 'Gemini API key شامل نہیں، اس لیے یہ **retrieval-only** جواب ہے: صرف وہ ماخذ دکھائے جا رہے ہیں جو آپ کے سوال کے الفاظ سے ملے۔ اردو تشریح کے لیے Settings میں key شامل کریں۔'
    : 'ان ماخذ میں سے متعلقہ حوالے یہ ہیں:';
  const refs = hits.map((h) => ({ id: h.rec.i }));
  return `${intro}\n\n${lines.join('\n')}\n\n\`\`\`refs\n${JSON.stringify(refs, null, 1)}\n\`\`\``;
}

/**
 * Prepare everything for one turn.
 * @returns {Promise<{mode: 'model'|'local', message?: string, body?: string, hits: Array, contextMap: Map, sources: Array}>}
 */
export const LEGACY_NOTE =
  '> ⚠️ **لائبریری دستیاب نہیں ہے۔** یہ جواب ماڈل کی اپنی یادداشت سے ہے، اس لیے اس کے حوالے **تصدیق شدہ نہیں** ہیں۔ براہِ کرم ہر حوالہ خود کھول کر متن دیکھ لیں۔';

export async function prepareTurn(question, { apiKey = '', model, signal } = {}) {
  const key = normaliseKey(apiKey);
  try {
    await loadLibrary();
  } catch (_) {
    // Library not bundled (e.g. CI APK build): answer without grounding, clearly labelled.
    if (!key) {
      return {
        mode: 'local',
        body: 'لائبریری دستیاب نہیں اور Gemini API key بھی شامل نہیں۔ Settings میں key شامل کریں۔',
        hits: [],
        contextMap: new Map(),
        sources: [],
      };
    }
    return { mode: 'legacy', message: question, hits: [], contextMap: new Map(), sources: [] };
  }
  let terms = question;
  if (key) {
    const kw = await extractKeywords({ apiKey: key, model, question, signal });
    terms = [question, ...kw.ar, ...kw.en].join(' ');
  }
  const hits = search(terms, { k: TOP_K });
  const contextMap = sourceMap(hits);
  const sources = [...contextMap.entries()];

  if (!key || !hits.length) {
    return { mode: 'local', body: retrievalBody(hits, { noKey: !key }), hits, contextMap, sources };
  }
  const message = `${contextBlock(hits)}\n\n════════\nصارف کا سوال: ${question}`;
  return { mode: 'model', message, hits, contextMap, sources };
}

export { tokenize };
