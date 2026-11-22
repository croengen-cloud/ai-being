# AI Being — Phase 1

An empty early-2000s (PS2/Dreamcast-era) city at dusk, and a glowing AI being —
the only living thing in it — that explores it day by day.
Plain ES modules + Three.js from a CDN (import map), no build step.

Look: box buildings with procedural window textures, street lamps, traffic lights,
crosswalks, neon signs, wires and fences; purple-orange sky with a big moon, distance
fog, low internal resolution (480p, 640p in 9:16) scaled up with hard pixels. No shadow
maps or post-processing, so it stays light on normal hardware. The camera follows the
being in third person (wide street shot when idle, behind it while walking, close-up when
it thinks).

## Run

```bash
cd ai-being
python3 -m http.server 8000
# open http://localhost:8000
```

A local server is required (ES modules and `fetch` of the txt files don't work over `file://`).

## Controls

- **Start Day** / `Space`: the being wakes up, visits 3–4 places and goes home.
- **9:16** / `V`: vertical canvas for TikTok recording (also `?vertical=1` in the URL).
- `H`: hide the buttons for a clean recording.
- **Diary** / `D`: everything it thought and read.
- **Reset**: deletes the save (localStorage key `aiBeing.save.v1`).

## Files

| File | Purpose |
| --- | --- |
| `main.js` | Boot, render loop, third-person camera, save/load, day sequence |
| `world.js` | City, buildings, street props, navigation graph, sky, fog, time of day (dusk → night) |
| `being.js` | The mushroom bot: pixel-screen face (neutral, curious, happy, sad, scared, thinking, sleep), legs, glowing cap and its growth |
| `brain.js` | `decideNextAction(state)` — scripted now, Ollama-ready for Phase 2 |
| `ui.js` | Day counter, thought bubble, labels, banner, diary |
| `library/`, `internet/` | Reading material (`index.json` lists the txt files) |

## Growth

The cap starts tiny on Day 1. Every place visited adds knowledge: the cap grows, gains
glowing spots, and small mushrooms sprout from the shell. From ~5 visits on, the cap
colour shifts towards the being's strongest interest (library violet, café cyan, park
mint, shop pink); the spots take the second-strongest.

## Phase 2 (prepared)

`brain.js` has `BRAIN_CONFIG.mode`, `buildPrompt(state)` and a stub
`decideWithOllama()` for `http://localhost:11434/api/generate`. Set the mode to
`'ollama'` once that is implemented; failures fall back to the script.
To add reading material, drop a `.txt` into `library/` or `internet/` and list it in `index.json`.
