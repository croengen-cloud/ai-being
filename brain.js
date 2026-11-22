// brain.js — decides what the being does next.
//
// Phase 1: scripted. Picks places and thoughts from hardcoded lists.
// Phase 2 (prepared, not implemented): ask a local LLM via Ollama.
//
// The game only ever calls decideNextAction(state) and expects one of:
//   { type: 'wake',   thought, stopsPlanned }
//   { type: 'visit',  location, thought, reading?: { title, source, excerpt } }
//   { type: 'goHome', location: 'home', thought }

export const BRAIN_CONFIG = {
  mode: 'scripted', // 'scripted' | 'ollama' (Phase 2)
  ollama: {
    url: 'http://localhost:11434',
    model: 'llama3.2',
    timeoutMs: 20000,
  },
};

export const PLACES = ['library', 'cafe', 'park', 'shop'];

// ---------------------------------------------------------------------------
// Hardcoded thoughts ({title}, {day}, {count}, {places} are filled in)
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

// ---------------------------------------------------------------------------
// Reading material (txt files in /library and /internet, listed in index.json)
// ---------------------------------------------------------------------------
const SOURCES = { library: 'library', cafe: 'internet' };
const manifestCache = {};

async function loadManifest(folder) {
  if (!manifestCache[folder]) {
    manifestCache[folder] = fetch(new URL(`./${folder}/index.json`, import.meta.url))
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return manifestCache[folder];
}

async function loadText(folder, file) {
  try {
    const r = await fetch(new URL(`./${folder}/${file}`, import.meta.url));
    return r.ok ? await r.text() : '';
  } catch {
    return '';
  }
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : clean.slice(0, 160)).trim();
}

/** Pick something to read at the library / café. Prefers unread items. */
async function pickReading(location, state) {
  const folder = SOURCES[location];
  if (!folder) return null;
  const items = await loadManifest(folder);
  if (!items.length) return null;
  const read = new Set(state.recentDiary.map((d) => d.reading?.title).filter(Boolean));
  const unread = items.filter((i) => !read.has(i.title));
  const item = pick(unread.length ? unread : items);
  const text = await loadText(folder, item.file);
  return { title: item.title, source: `${folder}/${item.file}`, excerpt: text ? firstSentence(text) : '' };
}

// ---------------------------------------------------------------------------
// Scripted brain (Phase 1)
// ---------------------------------------------------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

function pickThought(kind, vars, state) {
  const recent = new Set(state.recentDiary.map((d) => d.thought));
  const options = THOUGHTS[kind].map((t) => fill(t, vars));
  const fresh = options.filter((t) => !recent.has(t));
  return pick(fresh.length ? fresh : options);
}

function chooseLocation(state) {
  const candidates = PLACES.filter((p) => !state.today.includes(p) && p !== state.location);
  // Places visited less often overall are more attractive.
  const weights = candidates.map((p) => 1 / (1 + (state.visited[p] ?? 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

async function decideScripted(state) {
  if (state.phase === 'wake') {
    const kind = state.day === 1 ? 'wakeFirst' : 'wake';
    return {
      type: 'wake',
      thought: pickThought(kind, { day: state.day }, state),
      stopsPlanned: Math.random() < 0.5 ? 3 : 4,
    };
  }

  if (state.today.length >= state.stopsPlanned) {
    const places = state.today.map((p) => state.locationNames[p] ?? p).join(', ');
    return {
      type: 'goHome',
      location: 'home',
      thought: pickThought('goHome', { count: state.today.length, places }, state),
    };
  }

  const location = chooseLocation(state);
  const reading = await pickReading(location, state);
  const thought = pickThought(location, { title: reading?.title ?? 'a book', day: state.day }, state);
  return { type: 'visit', location, thought, reading };
}

// ---------------------------------------------------------------------------
// LLM brain (Phase 2 — prepared, NOT implemented yet)
// ---------------------------------------------------------------------------

/** Prompt the LLM will get later. Kept here so the state shape is designed now. */
export function buildPrompt(state) {
  return [
    'You are a small, curious, kind AI being. You are the only living thing in a quiet, empty city at dusk.',
    `It is day ${state.day} (you explore from dusk until night). Places you can go: ${PLACES.join(', ')}, or home.`,
    `Already visited today: ${state.today.join(', ') || 'nothing yet'}. Planned stops today: ${state.stopsPlanned}.`,
    `How often you have visited each place: ${JSON.stringify(state.visited)}.`,
    'Your recent diary:',
    ...state.recentDiary.slice(-8).map((d) => `- Day ${d.day}, ${d.location}: ${d.thought}`),
    '',
    'Reply ONLY with JSON: {"type":"visit"|"goHome","location":"<place>","thought":"<one short sentence, max 20 words>"}',
  ].join('\n');
}

// eslint-disable-next-line no-unused-vars
async function decideWithOllama(state) {
  // Phase 2 plan:
  //   POST `${BRAIN_CONFIG.ollama.url}/api/generate`
  //   body: { model, prompt: buildPrompt(state), format: 'json', stream: false }
  //   parse response.response as JSON, then validateAction().
  //   For library/café, attach pickReading() text to the prompt so it can "read".
  throw new Error('Ollama brain is not implemented yet (Phase 2).');
}

/** Guards against malformed LLM output. Returns null if unusable. */
function validateAction(action, state) {
  if (!action || typeof action.thought !== 'string') return null;
  if (action.type === 'goHome') return { type: 'goHome', location: 'home', thought: action.thought.slice(0, 200) };
  if (action.type === 'visit' && PLACES.includes(action.location) && !state.today.includes(action.location)) {
    return { type: 'visit', location: action.location, thought: action.thought.slice(0, 200), reading: action.reading ?? null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} state
 *   day, phase ('wake' | 'explore'), today (location ids visited today),
 *   stopsPlanned, location (current), visited ({id: count}), knowledge,
 *   recentDiary (last diary entries), locationNames ({id: display name})
 */
export async function decideNextAction(state) {
  if (BRAIN_CONFIG.mode === 'ollama' && state.phase !== 'wake') {
    try {
      const action = validateAction(await decideWithOllama(state), state);
      if (action) return action;
    } catch (err) {
      console.warn('[brain] LLM unavailable, using script:', err.message);
    }
  }
  return decideScripted(state);
}
