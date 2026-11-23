# The Mycel

The Mycel (singular: a Mycel) are small round creatures with a pixel-screen face and a glowing
mushroom cap, the only living things in an empty early-2000s city at dusk.
Every in-game day a Mycel wakes up, walks to 3–4 places, reads books and articles,
learns one thing at a time, grows, and writes a short diary entry.

Plain HTML + ES modules + Three.js (vendored in `vendor/`), no build step.
Made for vertical (9:16) screen recordings, works in iPhone Safari.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A local server is required (ES modules and `fetch` do not work over `file://`).

## The Gemini brain (optional)

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

| Call | Returns |
| --- | --- |
| `decideNextAction(state)` | `{ action, target, thought (≤15 words), emotion }` |
| `read(location, state)` | one-sentence takeaway from an ~800-character chunk, stored as a learning |
| `writeDiary(day)` | 2–3 sentence diary entry, shown at the end of the day with **Copy caption** |

## Growth

Every stop adds a learning (reading takeaways at the library / internet café, observations
at the park / shop). Stages unlock by learnings:

| Learnings | Stage |
| --- | --- |
| 0 | Sprout (tiny cap) |
| 4 | Little Cap |
| 8 | Glow Spots |
| 14 | Tiny Mushrooms (sprouts on the shell) |
| 20 | True Colours (cap colour follows its favourite place) |
| 28 | Bloom |

## Sound

All audio is generated live with the Web Audio API (`audio.js`): no sound files, no samples, no music.

- **The Mycel:** soft chirps and coos; pitch and rhythm follow the emotion (curious, scared, excited, sad, thinking).
- **Colony hum:** a whisper + formant-choir drone that thickens with the number of Mycel (`audio.setColony(n)`).
- **Ambient pad:** slow, dark A-minor drone that gets eerier with the day number and the colony's awareness
  (`audio.setStory({ day, awareness })`): tritone, pitch drift, a thin high whine, sub rumble.
- **Events:** `audio.outage()`, `audio.rain(on)`, `audio.build()`, `audio.watcher()` (distorted glitch tone).
- **Settings → Sound:** volume, mute, and a sound test for the story features that are not in the game yet.
- Sound starts on the first tap (browser / iPhone rule). On iPhone it plays as media (`navigator.audioSession`
  plus a silent, generated audio element for older iOS), so the silent switch doesn't mute it and screen
  recordings include it.

## Memory

Saved in `localStorage` (`aiBeing.save.v1`). **Settings → Memory**: Export (JSON file),
Import (with confirmation), Reset.

## Controls

- **Start Day** / `Space`
- **Hide UI** / `H`: only the DAY counter and thoughts stay. Tap the top-right corner to show the UI again.
- **16:9 / 9:16** / `V` (9:16 is the default; on phones it fills the screen)
- **Diary** / `D`

## Reading material

`library/` and `internet/` hold `.txt` files listed in each folder's `index.json`.
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
| `main.js` | Boot, render loop, camera, day sequence |
| `brain.js` | Gemini calls, validation, fallback thoughts, reading, diary |
| `settings.js` | API key + model (device-local) |
| `audio.js` | Procedural sound (Web Audio API) |
| `memory.js` | Save state, growth stages, export / import |
| `world.js` | The city |
| `being.js` | A Mycel (3D model, face, growth) |
| `ui.js`, `style.css`, `index.html` | Overlay UI |

Three.js is MIT licensed (`vendor/three.LICENSE`).
