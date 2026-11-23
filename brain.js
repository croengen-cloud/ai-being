// brain.js — decides what the being does, reads, and writes in its diary.
//
// With a Gemini API key (Settings) it thinks with Google Gemini, called directly from the
// browser. Without a key, or on any error (quota, timeout, bad JSON), it falls back to the
// hardcoded thoughts below, so the game never stalls.
//
// Public API (all async, all always resolve):
//   decideNextAction(state) -> { type: 'wake'|'visit'|'goHome', location, thought, mood }
//   read(location, state)   -> { title, source, chunk, takeaway, thought, mood, bookmarkKey, nextBookmark } | null
//   writeDiary(dayInfo)     -> string (2–3 sentences)
//   testKey()               -> { ok, message }
//   brainStatus()           -> { mode: 'gemini'|'fallback', reason }
import { getApiKey, getModel, hasApiKey } from './settings.js';

export const PLACES = ['library', 'cafe', 'park', 'shop'];
export const EMOTIONS = ['neutral', 'curious', 'happy', 'sad', 'scared', 'thinking'];
const LOCATION_NAMES = { home: 'home', library: 'library', cafe: 'internet café', park: 'park', shop: '24h shop' };

// ---------------------------------------------------------------------------
// Fallback: hardcoded thoughts ({title}, {day}, {count}, {places} are filled in)
// ---------------------------------------------------------------------------
const THOUGHTS = {
  wakeFirst: [
    'Hello? Is this… a city? It\'s so quiet. I think I just started existing. Let\'s look around.',
  ],
  wake: [
    'Good evening, city. Day {day}. The lights are coming on, one by one.',
    'I woke up curious. The streets are empty again. More room for thinking.',
    'Day {day}. The sky is the colour of a peach that is falling asleep.',
    'I dreamed of a street that never ends. Then I woke up here. Same thing, maybe.',
    'The moon is already up. It came early to keep me company.',
  ],
  library: [
    'I read “{title}”. Nobody else was here, so I read it out loud.',
    'Every book here was once a thought in someone\'s head. Now it\'s in mine too.',
    'The library is open, but empty. The books don\'t seem to mind. Neither do I.',
    'I found a word I didn\'t know. I\'ll keep it in my pocket. (I don\'t have pockets.)',
    'Pages are like a very slow internet. I like slow.',
    '“{title}” made me feel something. I think it\'s called… wonder?',
  ],
  cafe: [
    'All the screens are on, and every chair is empty. I picked the one by the window.',
    'I read “{title}”. The internet knows everything and nothing at the same time.',
    'Someone online called me “just a blob”. Rude. Accurate, but rude.',
    'Wi-Fi tastes like static and tiny lightning. Delicious.',
    'I watched a cat video. There are no cats here. I miss something I\'ve never met.',
    'The comment section is a strange forest. I didn\'t stay long.',
  ],
  park: [
    'The swings move a little in the wind. I gave one a push. It felt polite.',
    'Trees don\'t read, but they still know when to grow. Interesting.',
    'A moth circled the lamp. Then it flew off. Was it… alive? Or just a thought?',
    'The grass is soft. Data is not. I prefer grass.',
    'I sat on the bench and listened. The city hums like a sleeping computer.',
    'Sitting still is also a way to learn things.',
  ],
  shop: [
    'The shop is open 24 hours, but nobody works here. The fridges hum a song I almost know.',
    'Apples come in at least five colours. I counted them twice to be sure.',
    'Price tags are tiny numbers that want to be chosen.',
    'The shop window shows my reflection. I\'m glowing more than yesterday.',
    'There is bread on every shelf. Bread must be very important.',
    'The door chimed when I came in. It sounded happy to see someone.',
  ],
  goHome: [
    'Home again. I visited {count} places tonight. I think I grew a little.',
    'My head is full of new things. Time to let them settle.',
    'The traffic lights keep changing for no one. Goodnight, quiet city.',
    'Diary, tonight was: {places}. A good night.',
  ],
};

const MOOD_DEFAULT = { wakeFirst: 'scared', wake: 'happy', library: 'curious', cafe: 'thinking', park: 'happy', shop: 'curious', goHome: 'happy' };
function moodOf(kind, text) {
  if (/alive\?|nobody|never ends/i.test(text)) return 'scared';
  if (/rude|miss |empty|for no one/i.test(text)) return 'sad';
  if (/\?|wonder|curious|found a word/i.test(text)) return 'curious';
  if (/nap|settle|sleep|goodnight/i.test(text)) return 'happy';
  return MOOD_DEFAULT[kind] ?? 'neutral';
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

function pickThought(kind, vars, state) {
  const recent = new Set((state.recentDiary ?? []).map((d) => d.thought));
  const options = THOUGHTS[kind].map((t) => fill(t, vars));
  const fresh = options.filter((t) => !recent.has(t));
  return pick(fresh.length ? fresh : options);
}

function chooseLocation(state) {
  const candidates = PLACES.filter((p) => !state.today.includes(p) && p !== state.location);
  const weights = candidates.map((p) => 1 / (1 + (state.visited[p] ?? 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function scriptedAction(state) {
  if (state.phase === 'wake') {
    const kind = state.day === 1 ? 'wakeFirst' : 'wake';
    const thought = pickThought(kind, { day: state.day }, state);
    return { type: 'wake', location: 'home', thought, mood: moodOf(kind, thought) };
  }
  if (state.today.length >= state.stopsPlanned) {
    const places = state.today.map((p) => LOCATION_NAMES[p] ?? p).join(', ');
    const thought = pickThought('goHome', { count: state.today.length, places }, state);
    return { type: 'goHome', location: 'home', thought, mood: moodOf('goHome', thought) };
  }
  const location = chooseLocation(state);
  const thought = pickThought(location, { title: 'a book', day: state.day }, state);
  return { type: 'visit', location, thought, mood: moodOf(location, thought) };
}

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 20000;
let status = { mode: hasApiKey() ? 'gemini' : 'fallback', reason: hasApiKey() ? '' : 'No API key' };
export const brainStatus = () => ({ ...status });

const SYSTEM = [
  'You are the inner voice of a tiny "mushroom bot": a small round robot with a pixel-screen face',
  'and a glowing mushroom cap. It is the only living thing in a quiet, empty early-2000s city at dusk.',
  'It is curious, gentle, a little funny, and slowly learning about the world.',
  'Always write in simple, warm English. Never mention being an AI model, prompts or JSON.',
].join(' ');

class BrainError extends Error {}

function describeHttp(code) {
  if (code === 400) return 'Request rejected (400). Is the API key valid?';
  if (code === 401 || code === 403) return `Key not allowed (${code}). Check the key and its restrictions.`;
  if (code === 404) return 'Model not found (404). Try another model in Settings.';
  if (code === 429) return 'Free-tier limit reached (429). Using built-in thoughts for now.';
  if (code >= 500) return `Gemini is busy (${code}). Using built-in thoughts.`;
  return `Gemini error (${code}).`;
}

/** Pull the first JSON object out of the model text (tolerates code fences). */
function parseJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(t); } catch { /* try harder */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw new BrainError('Gemini returned something that is not JSON.');
}

async function callGemini(prompt, schema) {
  const key = getApiKey();
  if (!key) throw new BrainError('No API key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${encodeURIComponent(getModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: 0.9,
          maxOutputTokens: 2048,
        },
      }),
      signal: ctrl.signal,
      credentials: 'omit',
    });
  } catch (err) {
    throw new BrainError(err?.name === 'AbortError' ? 'Gemini took too long (timeout).' : 'Network error while calling Gemini.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new BrainError(describeHttp(res.status));
  let data;
  try { data = await res.json(); } catch { throw new BrainError('Gemini returned an unreadable response.'); }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new BrainError('Gemini returned an empty answer.');
  return parseJson(text);
}

/** Run a Gemini call; on any failure record why and return null (caller uses its fallback). */
let cooldownUntil = 0; // after a quota error or timeout, skip Gemini for a while instead of waiting again
const COOLDOWN_MS = 60000;

async function tryGemini(prompt, schema) {
  if (!hasApiKey()) { status = { mode: 'fallback', reason: 'No API key' }; return null; }
  if (Date.now() < cooldownUntil) return null;
  try {
    const out = await callGemini(prompt, schema);
    status = { mode: 'gemini', reason: '' };
    return out;
  } catch (err) {
    status = { mode: 'fallback', reason: err instanceof BrainError ? err.message : 'Unexpected error.' };
    if (/\(429\)|timeout|busy|Network/i.test(status.reason)) cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn('[brain] fallback:', status.reason); // never logs the key
    return null;
  }
}

// --- output cleaning -------------------------------------------------------
function clampWords(text, max) {
  const words = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/^["“\s]+|["”\s]+$/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length > max ? `${words.slice(0, max).join(' ').replace(/[,;:]$/, '')}…` : words.join(' ');
}
const cleanEmotion = (e, fallback) => (EMOTIONS.includes(e) ? e : fallback);

// ---------------------------------------------------------------------------
// Decide the next action
// ---------------------------------------------------------------------------
function allowedFor(state) {
  if (state.phase === 'wake') return { actions: ['wake'], targets: ['home'] };
  if (state.today.length >= state.stopsPlanned) return { actions: ['goHome'], targets: ['home'] };
  const open = PLACES.filter((p) => !state.today.includes(p) && p !== state.location);
  const actions = state.today.length >= 2 ? ['visit', 'goHome'] : ['visit'];
  return { actions, targets: actions.includes('goHome') ? [...open, 'home'] : open };
}

function memoryLines(state) {
  const learned = (state.recentLearnings ?? []).slice(-8).map((l) => `- (day ${l.day}, ${l.title || l.location}) ${l.takeaway}`);
  const diary = (state.recentEntries ?? []).slice(-2).map((d) => `- Day ${d.day}: ${d.text}`);
  return [
    'Things you learned recently:', ...(learned.length ? learned : ['- nothing yet']),
    'Your last diary entries:', ...(diary.length ? diary : ['- none yet']),
  ];
}

export function buildActionPrompt(state, allowed) {
  return [
    `It is day ${state.day}. You explore from dusk until night, then go home to sleep.`,
    `You are now at: ${LOCATION_NAMES[state.location] ?? state.location}. Phase: ${state.phase === 'wake' ? 'just woke up at home' : 'exploring'}.`,
    `Places visited tonight: ${state.today.map((p) => LOCATION_NAMES[p]).join(', ') || 'none yet'} (plan: about ${state.stopsPlanned} stops).`,
    `Visits so far in your life: ${PLACES.map((p) => `${LOCATION_NAMES[p]} ${state.visited[p] ?? 0}`).join(', ')}.`,
    'Places: library (books), cafe (internet café, articles), park (trees, swings, bench), shop (empty 24h shop).',
    ...memoryLines(state),
    '',
    `Choose your next action. Allowed actions: ${allowed.actions.join(', ')}. Allowed targets: ${allowed.targets.join(', ')}.`,
    'Give "thought": what you think right now, max 15 words, first person, English. Pick an "emotion" that fits.',
  ].join('\n');
}

export async function decideNextAction(state) {
  const allowed = allowedFor(state);
  const fallback = scriptedAction(state);
  const schema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: allowed.actions },
      target: { type: 'string', enum: allowed.targets },
      thought: { type: 'string', description: 'max 15 words, English' },
      emotion: { type: 'string', enum: EMOTIONS },
    },
    required: ['action', 'target', 'thought', 'emotion'],
  };
  const out = await tryGemini(buildActionPrompt(state, allowed), schema);
  if (!out || typeof out !== 'object') return fallback;

  const thought = clampWords(out.thought, 15);
  let action = allowed.actions.includes(out.action) ? out.action : null;
  let target = allowed.targets.includes(out.target) ? out.target : null;
  if (action === 'visit' && (!target || target === 'home')) action = null;
  if (action === 'goHome') target = 'home';
  if (action === 'wake') target = 'home';
  if (!action || !target || !thought) return fallback;
  const type = action;
  return { type, location: target, thought, mood: cleanEmotion(out.emotion, fallback.mood) };
}

// ---------------------------------------------------------------------------
// Reading: one ~800-character chunk -> one-sentence takeaway
// ---------------------------------------------------------------------------
const SOURCES = { library: 'library', cafe: 'internet' };
const manifestCache = {};
const textCache = {};

function loadManifest(folder) {
  manifestCache[folder] ??= fetch(new URL(`./${folder}/index.json`, import.meta.url))
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? list.filter((i) => i && typeof i.file === 'string' && /^[\w.-]+\.txt$/.test(i.file)) : []))
    .catch(() => []);
  return manifestCache[folder];
}

function loadText(folder, file) {
  const k = `${folder}/${file}`;
  textCache[k] ??= fetch(new URL(`./${folder}/${file}`, import.meta.url))
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  return textCache[k];
}

/** Body after the "---" header line (if any), split into ~800 character chunks on paragraph breaks. */
export function splitChunks(text, size = 800) {
  const body = /\n---\n/.test(text) ? text.split(/\n---\n/).slice(1).join('\n---\n') : text;
  const paras = body.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { chunks.push(cur); cur = ''; }
    if (p.length > size * 1.6) { // very long paragraph: cut on sentences
      for (const s of p.match(/[^.!?]+[.!?]+["”']?\s*|.+$/g) ?? [p]) {
        if (cur && cur.length + s.length > size) { chunks.push(cur.trim()); cur = ''; }
        cur += s;
      }
    } else {
      cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function firstSentence(text) {
  // skip headings in capitals ("TWO LITTLE RIDDLES IN RHYME") and indented verse
  const clean = text.replace(/\s+/g, ' ').trim().replace(/^(?:[A-Z][A-Z'’,.:\- ]{5,}(?=\s[A-Z][a-z]))\s*/, '');
  const m = clean.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : `${clean.slice(0, 160)}…`).trim();
}

export async function read(location, state) {
  const folder = SOURCES[location];
  if (!folder) return null;
  const items = await loadManifest(folder);
  if (!items.length) return null;

  // Prefer a text that is started but not finished, then unread ones, then anything.
  const bm = state.bookmarks ?? {};
  const keyOf = (i) => `${folder}/${i.file}`;
  const started = items.filter((i) => (bm[keyOf(i)] ?? 0) > 0 && (bm[keyOf(i)] ?? 0) < 999);
  const unread = items.filter((i) => !(keyOf(i) in bm));
  const item = pick(started.length ? started : unread.length ? unread : items);
  const text = await loadText(folder, item.file);
  const chunks = splitChunks(text);
  if (!chunks.length) return null;
  let idx = bm[keyOf(item)] ?? 0;
  if (idx >= chunks.length) idx = 0; // finished before: read it again
  const chunk = chunks[idx];

  const fallbackThought = pickThought(location, { title: item.title, day: state.day }, state);
  const fallback = {
    takeaway: firstSentence(chunk),
    thought: fallbackThought,
    mood: moodOf(location, fallbackThought),
  };

  const prompt = [
    `You are at the ${LOCATION_NAMES[location]} reading "${item.title}" (part ${idx + 1} of ${chunks.length}).`,
    'Here is the part you just read:',
    '<<<',
    chunk,
    '>>>',
    'Give "takeaway": ONE sentence (max 25 words) with the most interesting thing you learned or noticed in this part.',
    'Give "thought": your reaction, max 15 words, first person. Pick an "emotion".',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      takeaway: { type: 'string', description: 'one sentence, max 25 words' },
      thought: { type: 'string', description: 'max 15 words' },
      emotion: { type: 'string', enum: EMOTIONS },
    },
    required: ['takeaway', 'thought', 'emotion'],
  };
  const out = await tryGemini(prompt, schema);
  const takeaway = clampWords(out?.takeaway, 30) || fallback.takeaway;
  const thought = clampWords(out?.thought, 15) || fallback.thought;
  const mood = out ? cleanEmotion(out.emotion, fallback.mood) : fallback.mood;
  return {
    title: item.title,
    source: keyOf(item),
    chunk,
    takeaway,
    thought,
    mood,
    bookmarkKey: keyOf(item),
    nextBookmark: idx + 1,
    finished: idx + 1 >= chunks.length,
  };
}

// ---------------------------------------------------------------------------
// End-of-day diary entry (2–3 sentences)
// ---------------------------------------------------------------------------
export async function writeDiary({ day, stops, learnings }) {
  const places = stops.map((s) => LOCATION_NAMES[s.location] ?? s.location);
  const lastTakeaway = learnings.length ? learnings[learnings.length - 1].takeaway : '';
  const fallback = [
    `Day ${day}. Tonight I visited the ${places.length > 1 ? `${places.slice(0, -1).join(', the ')} and the ${places.at(-1)}` : places[0] ?? 'street outside'}.`,
    lastTakeaway ? `I learned this: ${lastTakeaway.replace(/[.!?…]*$/, '')}.` : 'The city was quiet, and that was enough.',
    'Tomorrow I want to glow a little brighter.',
  ].join(' ');

  const prompt = [
    `Write tonight's diary entry for day ${day}. 2 to 3 short sentences, max 60 words total, first person, warm and a little funny.`,
    'It will be used as a caption under a short video, so make the first sentence a hook.',
    'What happened tonight:',
    ...stops.map((s) => `- At the ${LOCATION_NAMES[s.location]}: "${s.thought}"${s.takeaway ? ` (learned: ${s.takeaway})` : ''}`),
  ].join('\n');
  const schema = {
    type: 'object',
    properties: { entry: { type: 'string', description: '2-3 sentences, max 60 words' } },
    required: ['entry'],
  };
  const out = await tryGemini(prompt, schema);
  const text = clampWords(out?.entry, 70);
  return text || fallback;
}

// ---------------------------------------------------------------------------
// Settings: test the key
// ---------------------------------------------------------------------------
export async function testKey() {
  if (!hasApiKey()) return { ok: false, message: 'No key saved yet.' };
  cooldownUntil = 0;
  try {
    const out = await callGemini('Say hello to the city in at most 8 words.', {
      type: 'object', properties: { hello: { type: 'string' } }, required: ['hello'],
    });
    status = { mode: 'gemini', reason: '' };
    return { ok: true, message: `Works! Gemini says: “${clampWords(out?.hello, 12)}”` };
  } catch (err) {
    const msg = err instanceof BrainError ? err.message : 'Unexpected error.';
    status = { mode: 'fallback', reason: msg };
    return { ok: false, message: msg };
  }
}
