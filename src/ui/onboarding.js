/**
 * شیعہ اے آئی · Frictionless 2-step API-key onboarding
 *
 * Any key that passes the shape check (AIza… or AQ… — no prefix restriction) is
 * validated live against the Gemini API and then SAVED, which is what activates
 * the chat interface.
 */

import { validateKey, isPlausibleKey, MODEL_PRIORITY } from '../lib/gemini.js';
import { qs, qsa, toast } from '../lib/dom.js';
import { setApiKey, getSettings, setSettings } from '../lib/storage.js';

export function initOnboarding({ onReady }) {
  const overlay = qs('#onboarding');
  const input = qs('#api-key');
  const btn = qs('#btn-validate');
  const label = qs('#btn-validate-label');
  const spin = qs('#btn-validate-spin');
  const errBox = qs('#ob-error');
  const steps = qsa('.step', overlay);
  let busy = false;

  /* Auto-advance the step checklist when the user follows the deep links. */
  qsa('[data-step-link]', overlay).forEach((a) => {
    a.addEventListener('click', () => {
      const n = Number(a.dataset.stepLink);
      steps[n - 1]?.classList.add('is-done');
      steps[n]?.classList.add('is-current');
      // Coming back from AI Studio: put the caret straight in the field.
      setTimeout(() => input?.focus(), 400);
    });
  });

  qs('#ob-skip')?.addEventListener('click', () => {
    if (busy) return;
    overlay.hidden = true;
  });

  qs('#btn-eye')?.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  input?.addEventListener('input', () => {
    errBox.hidden = true;
    steps[2]?.classList.toggle('is-current', isPlausibleKey(input.value));
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      btn?.click();
    }
  });

  function showError(title, hint) {
    errBox.hidden = false;
    errBox.className = 'alert alert--err';
    errBox.innerHTML = `<strong>${title}</strong><div>${hint || ''}</div>`;
  }

  async function save() {
    if (busy) return;
    const key = (input.value || '').trim();
    if (!key) {
      showError('Key درج کریں', 'پہلے https://aistudio.google.com/app/apikey سے key حاصل کریں۔');
      input.focus();
      return;
    }
    if (!isPlausibleKey(key)) {
      showError(
        'Key کا فارمیٹ درست نہیں',
        'Gemini key صرف حروف، اعداد اور - _ . پر مشتمل ہوتی ہے — "AIza…" اور "AQ…" دونوں قبول ہیں۔ AI Studio سے دوبارہ کاپی کریں۔'
      );
      input.focus();
      return;
    }

    busy = true;
    btn.disabled = true;
    spin.hidden = false;
    label.textContent = 'جانچا جا رہا ہے…';
    errBox.hidden = true;

    const result = await validateKey(key);

    busy = false;
    btn.disabled = false;
    spin.hidden = true;
    label.textContent = 'محفوظ کریں اور جاری رکھیں';

    if (!result.ok) {
      showError(result.error?.title || 'Key درست نہیں', result.error?.hint || '');
      return;
    }

    // A validated key is always stored on this device — that is what unlocks chat.
    await setApiKey(key);

    const settings = await getSettings();
    settings.model = result.model;
    settings.availableModels = result.models?.map((m) => m.name) || MODEL_PRIORITY;
    await setSettings(settings);

    steps.forEach((s) => s.classList.add('is-done'));
    errBox.hidden = false;
    errBox.className = 'alert alert--ok';
    errBox.innerHTML = `<strong>Key تصدیق ہو گئی ✓</strong><div>منتخب ماڈل: <code>${result.model}</code></div>`;

    await new Promise((r) => setTimeout(r, 620));
    overlay.hidden = true;
    toast('شیعہ اے آئی تیار ہے — اب آپ سوال پوچھ سکتے ہیں');
    onReady?.({ key, model: result.model, models: result.models });
  }

  btn?.addEventListener('click', save);

  return {
    open(prefill = '') {
      overlay.hidden = false;
      errBox.hidden = true;
      steps.forEach((s, i) => {
        s.classList.remove('is-done', 'is-current');
        if (i === 0) s.classList.add('is-current');
      });
      if (prefill) input.value = prefill;
      setTimeout(() => input?.focus(), 260);
    },
    close() {
      overlay.hidden = true;
    },
    get isOpen() {
      return !overlay.hidden;
    },
  };
}
