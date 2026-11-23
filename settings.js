// settings.js — device-local settings. The Gemini API key lives ONLY in this browser's
// localStorage. It is never part of the code, the repo, logs or the memory export.

const KEY_STORAGE = 'aiBeing.geminiKey';
const MODEL_STORAGE = 'aiBeing.geminiModel';

// Free-tier text models (checked against the Gemini API docs, Nov 2026).
export const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fast, free tier)' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (smarter, free tier)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (free tier)' },
];
export const DEFAULT_MODEL = MODELS[0].id;

function read(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

export function getApiKey() {
  return (read(KEY_STORAGE) ?? '').trim();
}
export function hasApiKey() {
  return getApiKey().length > 0;
}
/** Returns false if the browser refused to store it (e.g. private mode). */
export function setApiKey(key) {
  const clean = String(key ?? '').trim();
  return write(KEY_STORAGE, clean ? clean : null);
}
export function clearApiKey() {
  write(KEY_STORAGE, null);
}

export function getModel() {
  const m = read(MODEL_STORAGE);
  return MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL;
}
export function setModel(id) {
  if (MODELS.some((x) => x.id === id)) write(MODEL_STORAGE, id);
}
