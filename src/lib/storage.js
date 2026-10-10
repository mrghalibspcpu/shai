/**
 * SHAI · Persistence
 * ─────────────────────────────────────────────────────────────
 * Capacitor Preferences is used everywhere: on Android it writes to
 * SharedPreferences (survives WebView cache clears), on the web it falls back
 * to localStorage. Nothing ever leaves the device.
 */

import { Preferences } from '@capacitor/preferences';

const P = 'shai.';

async function read(key) {
  try {
    const { value } = await Preferences.get({ key: P + key });
    return value ?? null;
  } catch (_) {
    try {
      return localStorage.getItem(P + key);
    } catch (__) {
      return null;
    }
  }
}

async function write(key, value) {
  try {
    await Preferences.set({ key: P + key, value });
  } catch (_) {
    try {
      localStorage.setItem(P + key, value);
    } catch (__) {
      /* storage full / private mode */
    }
  }
}

export const store = {
  async get(key, fallback = null) {
    const raw = await read(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  },
  set: (key, value) => write(key, typeof value === 'string' ? value : JSON.stringify(value)),
  async remove(key) {
    try {
      await Preferences.remove({ key: P + key });
    } catch (_) {
      try {
        localStorage.removeItem(P + key);
      } catch (__) {
        /* ignore */
      }
    }
  },
};

/* ── Settings ────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  model: 'gemini-2.5-flash',
  depth: 'balanced',
  script: 'nastaleeq',
  fontSize: 19,
  showArabic: true,
  strictGrading: true,
  noticeDismissed: false,
};

export const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await store.get('settings', {})) });
export const setSettings = (s) => store.set('settings', s);

/* ── API key ─────────────────────────────────────────────────── */

export const getApiKey = () => store.get('apiKey', '');
export const setApiKey = (k) => store.set('apiKey', String(k ?? '').trim());
export const clearApiKey = () => store.remove('apiKey');

/* ── Conversations ───────────────────────────────────────────── */

export const getConversations = () => store.get('conversations', []);
export const setConversations = (list) => store.set('conversations', list);
export const getActiveId = () => store.get('activeId', null);
export const setActiveId = (id) => store.set('activeId', id);

export async function wipeAll() {
  for (const k of ['apiKey', 'settings', 'conversations', 'activeId', 'notice']) {
    await store.remove(k);
  }
}
