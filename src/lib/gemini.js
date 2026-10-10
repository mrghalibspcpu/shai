/**
 * SHAI · Google Gemini API client
 * ─────────────────────────────────────────────────────────────
 * • Streaming via  :streamGenerateContent?alt=sse
 * • Key validation via GET /v1beta/models
 * • Friendly, localised error messages (Urdu + English)
 * • Thought/reasoning parts are filtered out of the visible answer
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Preference order used when auto-selecting a model for a fresh API key. */
export const MODEL_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export class GeminiError extends Error {
  constructor(message, { status = 0, code = '', raw = '' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

export const normaliseKey = (k) => String(k ?? '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
export const isPlausibleKey = (k) => /^AIza[0-9A-Za-z_-]{20,}$/.test(normaliseKey(k));

/* ── Error translation ───────────────────────────────────────── */

const MESSAGES = [
  [
    400,
    /api[ _-]?key not valid|API key not valid/i,
    'API key غلط ہے',
    'براہِ کرم AI Studio سے نئی key لیں اور دوبارہ paste کریں۔',
  ],
  [
    403,
    /permission denied|leaked|disabled|consumers/i,
    'API key پر اجازت نہیں ملی',
    'یہ key disabled یا restricted ہو سکتی ہے۔ AI Studio میں نئی key بنائیں۔',
  ],
  [
    403,
    /quota|billing/i,
    'Quota ختم',
    'اس key کی حد مکمل ہو چکی ہے۔ کچھ دیر بعد کوشش کریں یا نئی key استعمال کریں۔',
  ],
  [429, /quota|rate|exceeded/i, 'درخواستوں کی حد سے تجاوز', 'کچھ لمحے انتظار کریں پھر دوبارہ کوشش کریں۔'],
  [404, /not found|not supported/i, 'ماڈل دستیاب نہیں', 'یہ ماڈل اس key پر دستیاب نہیں — ترتیبات میں دوسرا ماڈل منتخب کریں۔'],
  [500, /.*/i, 'Google کی جانب سے خرابی', 'سرور عارضی طور پر ناکام ہوا — دوبارہ کوشش کریں۔'],
  [503, /overloaded|unavailable/i, 'سروس مصروف ہے', 'تھوڑی دیر بعد دوبارہ کوشش کریں۔'],
];

export function friendlyError(err) {
  if (err instanceof GeminiError) {
    const raw = `${err.message} ${err.raw}`.trim();
    for (const [status, re, ur, hint] of MESSAGES) {
      if ((status === 0 || err.status === status) && re.test(raw)) {
        return { title: ur, hint, status: err.status };
      }
    }
    if (err.status === 429) return { title: 'درخواستوں کی حد سے تجاوز', hint: 'تھوڑا انتظار کریں۔', status: 429 };
    if (err.status === 0)
      return {
        title: 'نیٹ ورک سے رابطہ نہیں ہو سکا',
        hint: 'انٹرنیٹ کنکشن چیک کریں اور دوبارہ کوشش کریں۔',
        status: 0,
      };
    return {
      title: 'Gemini API میں خرابی',
      hint: `${err.message || 'نامعلوم خرابی'} (HTTP ${err.status})`,
      status: err.status,
    };
  }
  if (err?.name === 'AbortError') return { title: 'روک دیا گیا', hint: 'آپ نے جواب روک دیا۔', status: 0 };
  return {
    title: 'نیٹ ورک سے رابطہ نہیں ہو سکا',
    hint: 'انٹرنیٹ کنکشن چیک کریں اور دوبارہ کوشش کریں۔',
    status: 0,
  };
}

/* ── Low level ───────────────────────────────────────────────── */

async function request(path, { key, method = 'GET', body, signal, timeout = 0 } = {}) {
  const ctrl = timeout ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  const onAbort = signal ? () => ctrl?.abort() : null;
  if (signal && ctrl) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'GET' ? {} : { 'x-goog-api-key': key }),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : signal,
    });

    if (!res.ok) {
      let detail = '';
      let code = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || '';
        code = j?.error?.status || '';
      } catch (_) {
        /* ignore */
      }
      throw new GeminiError(detail || `HTTP ${res.status}`, {
        status: res.status,
        code,
        raw: detail,
      });
    }
    return res;
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (err?.name === 'AbortError') throw err;
    throw new GeminiError(err?.message || 'network error', { status: 0, raw: String(err) });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort && ctrl) signal.removeEventListener('abort', onAbort);
  }
}

/* ── Models ──────────────────────────────────────────────────── */

export async function listModels(key, { signal } = {}) {
  const res = await request(`/models?key=${encodeURIComponent(normaliseKey(key))}&pageSize=1000`, {
    method: 'GET',
    signal,
    timeout: 20000,
  });
  const data = await res.json();
  return (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      name: String(m.name || '').replace(/^models\//, ''),
      displayName: m.displayName || String(m.name || '').replace(/^models\//, ''),
      inputTokenLimit: m.inputTokenLimit || 0,
      outputTokenLimit: m.outputTokenLimit || 0,
    }));
}

/** Pick the best model this key can actually use. */
export function bestModel(models) {
  const names = new Set(models.map((m) => m.name));
  for (const candidate of MODEL_PRIORITY) if (names.has(candidate)) return candidate;
  const flash = models
    .map((m) => m.name)
    .filter((n) => /flash/i.test(n) && !/-lite$/.test(n))
    .sort();
  return flash[0] || models[0]?.name || DEFAULT_MODEL;
}

/**
 * Validate an API key.
 * @returns {Promise<{ok:boolean, model?:string, models?:Array, error?:object}>}
 */
export async function validateKey(key, { signal } = {}) {
  const clean = normaliseKey(key);
  if (!clean) return { ok: false, error: { title: 'Key خالی ہے', hint: 'براہِ کرم API key درج کریں۔' } };
  if (!isPlausibleKey(clean))
    return {
      ok: false,
      error: {
        title: 'Key کا فارمیٹ درست نہیں',
        hint: 'Gemini کی key عموماً "AIza…" سے شروع ہوتی ہے۔ AI Studio سے دوبارہ کاپی کریں۔',
      },
    };

  try {
    const models = await listModels(clean, { signal });
    if (!models.length) {
      return {
        ok: false,
        error: {
          title: 'کوئی ماڈل دستیاب نہیں',
          hint: 'یہ key Gemini API تک رسائی نہیں رکھتی۔ AI Studio میں Generative Language API enable کریں۔',
        },
      };
    }
    return { ok: true, model: bestModel(models), models };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

/* ── Streaming generation ────────────────────────────────────── */

const SAFETY = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

function partsText(content) {
  return (content?.parts || [])
    .filter((p) => p && !p.thought) // never surface reasoning traces
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
}

/**
 * Stream an answer token-by-token.
 * @yields {string} incremental text
 */
export async function* streamGenerate({
  apiKey,
  model = DEFAULT_MODEL,
  system = '',
  history = [],
  message,
  temperature = 0.2,
  maxOutputTokens = 8192,
  signal,
}) {
  const key = normaliseKey(apiKey);
  const contents = [
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'model') && m.content)
      .map((m) => ({ role: m.role, parts: [{ text: String(m.content) }] })),
    { role: 'user', parts: [{ text: String(message) }] },
  ];

  const payload = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: {
      temperature,
      topP: 0.92,
      topK: 40,
      maxOutputTokens,
      candidateCount: 1,
    },
    safetySettings: SAFETY,
  };

  const url = `/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
    key
  )}`;

  const res = await request(url, { method: 'POST', body: payload, signal });

  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    const text = partsText(data?.candidates?.[0]?.content);
    if (text) yield text;
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let sawText = false;

  const handleLine = function* (line) {
    if (!line.startsWith('data:')) return;
    const json = line.slice(5).trim();
    if (!json || json === '[DONE]') return;
    let payload;
    try {
      payload = JSON.parse(json);
    } catch (_) {
      return;
    }

    const blocked = payload?.promptFeedback?.blockReason;
    if (blocked) {
      throw new GeminiError(`Response blocked: ${blocked}`, {
        status: 200,
        code: blocked,
        raw: blocked,
      });
    }

    const candidate = payload?.candidates?.[0];
    const text = partsText(candidate?.content);
    if (text) {
      sawText = true;
      yield text;
    }
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
      throw new GeminiError('Response blocked by safety filters', {
        status: 200,
        code: candidate.finishReason,
        raw: candidate.finishReason,
      });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of chunk.split('\n')) yield* handleLine(line);
      }
      // Some proxies separate events with a bare \n
      if (!buffer.includes('\n\n') && buffer.includes('\n') && /^data:/m.test(buffer)) {
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        for (const line of parts) yield* handleLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) yield* handleLine(line);
    }
  } finally {
    try {
      reader.cancel();
    } catch (_) {
      /* already closed */
    }
  }

  if (!sawText) {
    throw new GeminiError('خالی جواب — ماڈل نے کچھ نہیں لکھا', { status: 200, raw: 'empty' });
  }
}

/** Non-streaming fallback (used by "regenerate" on flaky connections). */
export async function generate({ apiKey, model = DEFAULT_MODEL, system = '', history = [], message, temperature = 0.2, maxOutputTokens = 8192, signal }) {
  const key = normaliseKey(apiKey);
  const contents = [
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'model') && m.content)
      .map((m) => ({ role: m.role, parts: [{ text: String(m.content) }] })),
    { role: 'user', parts: [{ text: String(message) }] },
  ];
  const res = await request(
    `/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      signal,
      body: {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: { temperature, topP: 0.92, topK: 40, maxOutputTokens, candidateCount: 1 },
        safetySettings: SAFETY,
      },
    }
  );
  const data = await res.json();
  return partsText(data?.candidates?.[0]?.content) || '';
}
