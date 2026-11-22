# AI Being — Phase 1

A tiny low-poly district with a glowing AI being that explores it day by day.
Plain ES modules + Three.js from a CDN (import map), no build step.

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
| `main.js` | Boot, render loop, save/load, day sequence |
| `world.js` | District, buildings, paths (navigation graph), lighting, time of day |
| `being.js` | The being: mesh, walking, blinking, evolution visuals |
| `brain.js` | `decideNextAction(state)` — scripted now, Ollama-ready for Phase 2 |
| `ui.js` | Day counter, thought bubble, labels, banner, diary |
| `library/`, `internet/` | Reading material (`index.json` lists the txt files) |

## Phase 2 (prepared)

`brain.js` has `BRAIN_CONFIG.mode`, `buildPrompt(state)` and a stub
`decideWithOllama()` for `http://localhost:11434/api/generate`. Set the mode to
`'ollama'` once that is implemented; failures fall back to the script.
To add reading material, drop a `.txt` into `library/` or `internet/` and list it in `index.json`.
