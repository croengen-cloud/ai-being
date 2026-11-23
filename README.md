# The Mycel

A god game in a bright forest clearing. The Mycel (singular: a Mycel) are small round mushroom
creatures with a pixel-screen face and a glowing cap. Day 1 starts with a single Mycel; it releases
spores, sprouts appear, and by nightfall there are 5–8 of them. Over the following days the colony
gathers berries, mushrooms, sticks and stones, chops trees, discovers and lights the old fire pit,
builds a storage pile and huts, crafts stone axes and spears, and from day 3 defends itself against
thorn beetles at night. If food runs out they get hungry, sad, start fighting, and can dissolve into spores.

Plain HTML + ES modules + Three.js (vendored in `vendor/`), no build step.
Made for vertical (9:16) screen recordings, works in iPhone Safari.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A local server is required (ES modules and `fetch` do not work over `file://`).

## Playing

- **Camera:** drag to pan, pinch / mouse wheel to zoom from a single Mycel's face (eye level) out to
  the whole clearing, twist two fingers to rotate. **Tap a Mycel** to follow it and see its card
  (name, personality, faction, friends, rivals). After a few seconds without input the **auto camera**
  follows the most interesting action; drama always wins and gets a close shot.
- **Speed:** 1× / 2× / 4× / pause. One day (day + night) takes about 2:45 at 1×: one day = one video.
- **Story pacing:** one main event at a time (one caption, the camera on it). Each day has 2–4
  **milestones** with a big banner and a sound: a tech tree (food → water → fire → tools → shelter →
  farming → weapons → symbols → awareness of the Watcher), social firsts (birth, leader, theft,
  betrayal, exile, victory) and **emotions**. The Mycel start with only neutral, hungry and sleepy;
  joy, curiosity, fear, trust, love, pride, anger, jealousy and grief must be learned, and only learned
  feelings show on their faces (the screens get brighter and more colourful as they learn).
- **HUD:** DAY, the AI BRAIN intelligence bar (IQ 0–100, jumps at every milestone), EMOTIONS x/12 and
  MYCEL. The colony grows slowly (3 by the end of day 1, then 1–3 a day, about 14 at most).
  Each day ends with a card: DAY N COMPLETE · IQ · MYCEL and a cliffhanger line.
- **Creator:** rain berries, rain, sunshine, light the fire, send thorn beetles, gift spores, send
  knowledge (a page from the reading material), or write a message to the colony as the Watcher.
- **Drama:** every Mycel has a personality (brave, greedy, shy, loyal, jealous, curious) and
  relationships (heart = friends, bolt = rivals). From about 15 Mycel, factions form around leaders
  (crown, tinted caps, banner at their camp). Jealous and greedy Mycel plot at night (whisper icon):
  raid the storage, wreck a hut, overthrow a leader. Each morning the hive mind decides which plots
  are discovered (without a key, a rule does). Scuffles are cartoon shoving with dust clouds; losers
  limp (bandage) and may be exiled to the forest edge until a friend brings them back.
  Creator extras: reveal a plot, start a rumor, give a gift to one faction.
- Icons over the heads show what each Mycel is doing (axe, berry, wood, stone, hammer, spear, fire,
  zzz, !). Emote bubbles pop up when their mood changes (happy, curious, scared, angry, sad, hungry, in love).

## The hive mind (Gemini, optional)

Open **Settings** and paste a Gemini API key (free tier, from Google AI Studio).

- The key is stored **only in your browser** (`localStorage`, key `aiBeing.geminiKey`).
  It is not in this repository, not in the memory export, and is only sent to
  `generativelanguage.googleapis.com` (header `x-goog-api-key`).
- Recommended: restrict the key in the Google Cloud console to HTTP referrers of the
  site you host it on (e.g. `https://<user>.github.io/*`).
- Without a key, or when Gemini fails (quota, timeout, bad answer), the Mycel uses its
  built-in thoughts. The game never waits forever (20 s timeout per call).
- About 8–10 requests per in-game day.

What Gemini does:

| Call | When | Returns |
| --- | --- | --- |
| `planDay(summary)` | once each morning | `{ goal, priorities, event, thought, watcherMessage }` |
| `writeDiary(summary)` | each evening | 2–3 sentence diary entry, shown with **Copy caption** |
| `read(folder, state)` | Creator → Send knowledge | one-sentence takeaway from an ~800-character chunk |

Individual Mycel do not call Gemini: they follow simple rules (`colony.js`) weighted by the day's priorities.

## Sound

All audio is generated live with the Web Audio API (`audio.js`): no sound files, no samples, no music.

- **The Mycel:** every emotion has its own sound (happy trill, curious chirp, scared squeak, angry buzz,
  sad whimper, hungry grumble, love coo), quieter when far from the camera.
- **Colony hum:** whisper + formant choir that thickens with the population and follows the group mood.
- **Ambient pad:** warm by day, darker at night, eerier as days pass and the colony's awareness grows.
- **World:** axe chops, falling trees, spore puffs, building knocks, fire crackle near the fire, rain,
  thorn-beetle drone, and a distorted glitch tone for messages to and from the Watcher.
- **Settings → Sound:** volume and mute.
- Sound starts on the first tap (browser / iPhone rule). On iPhone it plays as media, so the silent
  switch doesn't mute it and screen recordings include it.

## Memory

Saved in `localStorage` (`aiBeing.save.v1`) at the end of each day. **Settings → Memory**: Export (JSON file),
Import (with confirmation), Reset. Saves from the old night-city version keep their diary; the colony starts fresh.

## Keys

`H` hide UI (tap the top-right corner to bring it back) · `V` 9:16 / 16:9 · `S` speed · `C` auto camera · `D` diary

## Reading material

`library/` and `internet/` hold the reading material for **Send knowledge**: `.txt` files listed in each folder's `index.json`.
A header block ending with a `---` line is skipped when reading.

Public-domain samples:

- Lewis Carroll, *Alice's Adventures in Wonderland*, Chapter I (1865)
- Sara Cone Bryant, *Stories to Tell to Children* (1918), selection
- NASA Science, *Earth's Moon: Facts* (excerpt, U.S. government work)
- NASA Science, *Our Sun: Facts* (excerpt, U.S. government work)

The other texts were written for this project.

## Files

| File | Purpose |
| --- | --- |
| `main.js` | Boot, render loop, day cycle, creator actions |
| `forest.js` | The clearing: terrain, stream, trees, bushes, items, fire pit, storage, huts, light, spores |
| `colony.js` | Simulation: needs, tasks, building, crafting, spores, threats, events, scuffles |
| `progress.js` | Tech tree, learned emotions, firsts, IQ |
| `director.js` | One main event at a time, milestone pacing, midday crisis, nudges |
| `social.js` | Personalities, relationships, factions, plots, exile, reconciliation |
| `assets.js` | Model library: CC0 GLB models from `assets/models/manifest.json`, procedural fallbacks |
| `effects.js` | Wind sway, water shader, smoke, fireflies, leaves, butterflies, bloom, adaptive quality |
| `mycel.js` | Instanced rendering of the Mycel, emote bubbles, task icons, sprouts, beetles |
| `camera.js` | God-view camera with touch controls and auto camera |
| `icons.js` | Pixel faces, emote bubbles and task icons drawn on canvases |
| `brain.js` | Hive mind: Gemini calls, validation, rule-based fallbacks, reading, diary |
| `settings.js` | API key + model (device-local) |
| `audio.js` | Procedural sound (Web Audio API) |
| `memory.js` | Save state (end of each day), export / import |
| `ui.js`, `style.css`, `index.html` | Overlay UI |

Three.js is MIT licensed (`vendor/three.LICENSE`).

## Models

Without model files the world uses built-in low-poly models. To use a CC0 pack (for example the
Kenney Nature Kit), put the `.glb` files into `assets/models/` and list them in
`assets/models/manifest.json`, e.g. `{ "files": ["tree_oak.glb", "rock_largeA.glb"] }`. The kind
(tree, pine, bush, flower, grass, reed, lily, rock, stone, log, stump, mushroom) is guessed from the
Kenney file name, or given explicitly: `{ "file": "my_tree.glb", "kind": "tree" }`. Models are scaled
to fit and drawn instanced.
