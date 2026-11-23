// memory.js — the colony's save state (localStorage), export / import.
// Saved at the end of each day. A day interrupted by a reload restarts from its morning.

const SAVE_KEY = 'aiBeing.save.v1'; // storage key kept from v1; the data itself is versioned
const MAX_ENTRIES = 2000;
const MAX_LEARNINGS = 500;

export function defaultState() {
  return {
    version: 3,
    day: 1,
    colony: null, // snapshot from Colony.serialize(); null = fresh start with one Mycel
    diaryEntries: [], // { day, text, events: [..], population, at }
    learnings: [], // { day, title, source, takeaway, at }
    bookmarks: {}, // "folder/file" -> next chunk index
    creatorLog: [], // { day, action, text }
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, d = 0) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

function normalizeColony(c) {
  if (!isObj(c)) return null;
  return {
    day: Math.max(1, int(c.day, 1)),
    mycel: Array.isArray(c.mycel) ? c.mycel.filter(isObj).slice(0, 60).map((m) => ({
      name: str(m.name, 12), color: int(m.color, 0x9b6dff), age: int(m.age, 60), tool: ['axe', 'spear'].includes(m.tool) ? m.tool : null,
    })) : [],
    resources: { food: int(c.resources?.food), wood: int(c.resources?.wood), stone: int(c.resources?.stone) },
    fallenTrees: Array.isArray(c.fallenTrees) ? c.fallenTrees.map((x) => int(x)).slice(0, 50) : [],
    storageBuilt: !!c.storageBuilt,
    huts: Array.isArray(c.huts) ? c.huts.filter(isObj).slice(0, 20).map((h) => ({ slot: int(h.slot), progress: Math.min(1, num(h.progress)), built: !!h.built })) : [],
    fire: { discovered: !!c.fire?.discovered, lit: !!c.fire?.lit, fuel: Math.min(1, Math.max(0, num(c.fire?.fuel))) },
    discoveries: Array.isArray(c.discoveries) ? c.discoveries.map((d) => str(d, 20)).slice(0, 30) : [],
    awareness: Math.min(1, Math.max(0, num(c.awareness))),
  };
}

/** Bring any stored / imported object into the current shape (drops unknown fields). */
export function normalize(raw) {
  const s = defaultState();
  if (!isObj(raw)) return s;
  const fromCity = (raw.version ?? 1) < 3; // the old night-city game: keep diary + learnings, restart the colony
  s.day = fromCity ? 1 : Math.max(1, int(raw.day, 1));
  s.colony = fromCity ? null : normalizeColony(raw.colony);
  if (Array.isArray(raw.diaryEntries)) {
    s.diaryEntries = raw.diaryEntries.filter(isObj).slice(-MAX_ENTRIES).map((d) => ({
      day: Math.max(1, int(d.day, 1)), text: str(d.text, 800),
      events: Array.isArray(d.events) ? d.events.map((e) => str(e, 200)).slice(0, 30) : [],
      population: int(d.population), at: str(d.at, 40), legacy: fromCity || !!d.legacy,
    }));
  }
  if (Array.isArray(raw.learnings)) {
    s.learnings = raw.learnings.filter(isObj).slice(-MAX_LEARNINGS).map((l) => ({
      day: Math.max(1, int(l.day, 1)), title: str(l.title, 120), source: str(l.source, 160), takeaway: str(l.takeaway), at: str(l.at, 40),
    })).filter((l) => l.takeaway);
  }
  if (isObj(raw.bookmarks)) for (const [k, v] of Object.entries(raw.bookmarks)) s.bookmarks[str(k, 120)] = int(v);
  if (Array.isArray(raw.creatorLog)) {
    s.creatorLog = raw.creatorLog.filter(isObj).slice(-200).map((c) => ({ day: Math.max(1, int(c.day, 1)), action: str(c.action, 20), text: str(c.text, 200) }));
  }
  return s;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? normalize(JSON.parse(raw)) : defaultState();
    // drop anything logged for the unfinished current day
    s.diaryEntries = s.diaryEntries.filter((d) => d.legacy || d.day < s.day);
    s.creatorLog = s.creatorLog.filter((c) => c.day < s.day);
    return s;
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function clearState() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Export file contents. Contains only the memory, never settings or the API key. */
export function exportState(state) {
  return JSON.stringify({ app: 'ai-being', format: 3, exportedAt: new Date().toISOString(), state }, null, 2);
}

/** Parse an export file. Throws with a readable message if it is not one of ours. */
export function importState(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('File is too large or empty.');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('This is not a valid JSON file.'); }
  if (!isObj(obj) || obj.app !== 'ai-being' || !isObj(obj.state)) throw new Error('This is not a Mycel memory file.');
  return normalize(obj.state);
}
