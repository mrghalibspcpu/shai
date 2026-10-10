/**
 * SHAI · Settings sheet
 */

import { validateKey, MODEL_PRIORITY, isPlausibleKey } from '../lib/gemini.js';
import { qs, toast, download } from '../lib/dom.js';
import {
  getSettings,
  setSettings,
  getApiKey,
  setApiKey,
  clearApiKey,
  getConversations,
  wipeAll,
} from '../lib/storage.js';

export function initSettings({ onChange, onChangeKey, onWipe }) {
  const overlay = qs('#settings');
  const modelSel = qs('#st-model');
  const keyInput = qs('#st-key');
  const statusBox = qs('#st-status');
  let settings = null;

  function status(title, hint, kind = 'ok') {
    statusBox.hidden = false;
    statusBox.className = `alert alert--${kind}`;
    statusBox.innerHTML = `<strong>${title}</strong><div>${hint || ''}</div>`;
  }

  function fillModels(list) {
    const names = Array.from(new Set([...MODEL_PRIORITY, ...(list || []), settings?.model]));
    modelSel.innerHTML = names
      .filter(Boolean)
      .map((n) => `<option value="${n}">${n}</option>`)
      .join('');
    modelSel.value = settings.model;
  }

  async function load() {
    settings = await getSettings();
    fillModels(settings.availableModels);
    qs('#st-depth').value = settings.depth;
    qs('#st-script').value = settings.script;
    qs('#st-size').value = settings.fontSize;
    qs('#st-arabic').checked = settings.showArabic !== false;
    qs('#st-strict').checked = settings.strictGrading !== false;
    keyInput.value = (await getApiKey()) || '';
    statusBox.hidden = true;
  }

  async function commit(patch = {}) {
    settings = { ...settings, ...patch };
    await setSettings(settings);
    onChange?.(settings);
  }

  qs('#st-close')?.addEventListener('click', () => {
    overlay.hidden = true;
  });
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  qs('#st-eye')?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  modelSel?.addEventListener('change', () => commit({ model: modelSel.value }));
  qs('#st-depth')?.addEventListener('change', (e) => commit({ depth: e.target.value }));
  qs('#st-script')?.addEventListener('change', (e) => commit({ script: e.target.value }));
  qs('#st-size')?.addEventListener('input', (e) => commit({ fontSize: Number(e.target.value) }));
  qs('#st-arabic')?.addEventListener('change', (e) => commit({ showArabic: e.target.checked }));
  qs('#st-strict')?.addEventListener('change', (e) => commit({ strictGrading: e.target.checked }));

  qs('#st-save-key')?.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      status('Key خالی ہے', 'براہِ کرم key درج کریں۔', 'err');
      return;
    }
    if (!isPlausibleKey(key)) {
      status('فارمیٹ درست نہیں', 'Gemini کی key "AIza…" سے شروع ہوتی ہے۔', 'err');
      return;
    }
    status('جانچا جا رہا ہے…', '', 'warn');
    const res = await validateKey(key);
    if (!res.ok) {
      status(res.error?.title || 'Key درست نہیں', res.error?.hint || '', 'err');
      return;
    }
    await setApiKey(key);
    const next = await getSettings();
    next.model = res.model;
    next.availableModels = res.models?.map((m) => m.name);
    await setSettings(next);
    settings = next;
    fillModels(next.availableModels);
    status('Key تصدیق ہو گئی ✓', `ماڈل: ${res.model}`, 'ok');
    toast('API key محفوظ ہو گئی');
    onChangeKey?.(key);
  });

  qs('#st-test-key')?.addEventListener('click', async () => {
    const key = (await getApiKey()) || keyInput.value.trim();
    if (!key) {
      status('کوئی key محفوظ نہیں', 'پہلے key درج کریں۔', 'err');
      return;
    }
    status('جانچا جا رہا ہے…', '', 'warn');
    const res = await validateKey(key);
    status(
      res.ok ? 'Key درست ہے ✓' : res.error?.title || 'Key درست نہیں',
      res.ok ? `دستیاب ماڈلز: ${res.models.length}` : res.error?.hint || '',
      res.ok ? 'ok' : 'err'
    );
  });

  qs('#st-remove-key')?.addEventListener('click', async () => {
    await clearApiKey();
    keyInput.value = '';
    status('Key حذف ہو گئی', 'دوبارہ سوال پوچھنے پر setup دکھایا جائے گا۔', 'warn');
    onChangeKey?.('');
  });

  qs('#st-export')?.addEventListener('click', async () => {
    const convs = await getConversations();
    const payload = {
      app: 'SHAI',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      conversations: convs,
    };
    const ok = download(
      `shai-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
    toast(ok ? 'ڈاؤن لوڈ شروع ہو گیا' : 'ڈاؤن لوڈ ممکن نہیں');
  });

  qs('#st-wipe')?.addEventListener('click', async () => {
    if (!confirm('کیا واقعی تمام ڈیٹا (key، گفتگویں، ترتیبات) مٹا دیں؟')) return;
    await wipeAll();
    toast('سب ڈیٹا مٹا دیا گیا');
    onWipe?.();
    setTimeout(() => location.reload(), 700);
  });

  return {
    async open() {
      await load();
      overlay.hidden = false;
    },
    close() {
      overlay.hidden = true;
    },
    refresh: load,
    get settings() {
      return settings;
    },
  };
}
