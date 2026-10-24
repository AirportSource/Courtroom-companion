# Project State — Courtroom Companion

_Last updated: 2026-10-24 (runtime asset stabilization & manifests). Source of truth is the filesystem; update this file when the actual state changes._

## Summary

Courtroom Companion is an Ace Attorney-style conversational interface. The repository now contains **a normalized runtime asset library with validated manifests** and the Vite + React + TypeScript starter page (build/lint green). No game feature (renderer, animation, dialogue, audio playback) is implemented yet.

## Current architecture

```
Courtroom-companion/
├── CLAUDE.md                 # project rules for Claude Code
├── .claude/skills/           # 11 project skills
├── .gitignore                # Vite default ignore rules (root-level only)
├── README.md, LICENSE        # empty (0 bytes)
├── docs/                     # persistent project memory (this folder)
├── tests/                    # empty (.gitkeep only)
└── frontend/                 # Vite + React 19 + TypeScript 6 app
    ├── index.html            # scaffold; title "frontend"; links missing /favicon.svg
    ├── package.json          # scripts: dev, build, lint, validate:assets, preview
    ├── scripts/
    │   └── validate-assets.mjs   # manifest ↔ filesystem validator (Node, no deps)
    ├── src/
    │   ├── main.tsx, App.tsx # Vite starter page (to be replaced by the scene UI)
    │   ├── App.css, index.css
    │   └── components/       # 4 placeholder files, all 0 bytes
    └── public/
        └── assets/           # ALL runtime assets (decision D-010)
            ├── characters/
            │   ├── index.json            # character id → manifest path
            │   └── maya/
            │       ├── character.json    # schema v1 character pack
            │       └── sprites/<pose>/{idle,talking,reaction,...}/maya_frame_NNN.png
            ├── backgrounds/
            │   ├── backgrounds.json      # bg_NN → file + dimensions
            │   └── background_NN_WxH.png
            ├── audio/
            │   ├── audio.json            # sound id → category + file
            │   └── {blips,dialogue,menu_ui}/...
            ├── music/                    # empty (.gitkeep), no music exists yet
            └── ui/                       # empty (.gitkeep), no UI graphics exist yet
```

Runtime URL of any asset = `/assets/<folder>/<manifest-relative path>`. Paths inside a manifest are relative to that manifest's directory.

Planned layers (not yet present): scene renderer, animation controller, typewriter + blip engine, central audio/music manager, LLM contract, FastAPI backend, Ollama/Qwen.

## Manifests (all validated by `npm run validate:assets`)

| Manifest | Exposes |
|---|---|
| `assets/characters/index.json` | `characters: { <characterId>: <manifest path> }` |
| `assets/characters/maya/character.json` | `emotions` → `animations` (each with `idle` + `talking` frame lists) and optional one-shot `reactions`; `voice.blip` → audio sound id; `defaultEmotion`, `fallbackEmotion`, `anchor`, `unassignedFrames` |
| `assets/backgrounds/backgrounds.json` | `backgrounds: { bg_NN: { src, width, height, description, notes? } }` |
| `assets/audio/audio.json` | `categories` (`blip`, `dialogue`, `effect`, `ui`); `sounds: { <id>: { category, src } }` |

No music manifest (no music assets). No UI manifest (no UI graphics).

The future renderer consumes logical IDs only (emotion, animation, sound id, background id). Physical filenames exist only inside manifests.

## Frontend status

- Node.js v24.22.1 / npm 11.19.1 at `C:\Program Files\nodejs`. It may need prepending to a shell's `PATH` on this machine.
- `npm run build`: **pass**. `npm run lint`: **pass**. `npm run validate:assets`: **pass** (144 referenced files, 0 errors). Verified 2026-10-24.
- Scaffold leftovers that don't break the build: `/favicon.svg` and `/icons.svg` are referenced but don't exist (runtime 404s), and the `.hero` CSS is unused.
- The four component files exist but are empty.

## Backend status

No backend code exists. FastAPI/Ollama is out of scope until explicitly requested.

## What already works

- Build, lint and asset validation all pass.
- Every runtime asset lives under `frontend/public/assets/` and is referenced by exactly one manifest category. The validator fails on unreferenced media.
- Maya: 12 conversational animations (all with idle + talking), 1 one-shot reaction (`shocked`), 13 logical emotions.
- 18 sounds in 4 categories, 29 backgrounds with verified dimensions.
- No filenames contain spaces.

## What is incomplete

- No working UI: scene, character renderer, dialogue box, typewriter, blips and audio manager are all unimplemented.
- No music assets, no UI graphics, no visual-effect graphics.
- No TypeScript types for the manifests yet. Those belong with the loader/renderer work.
- No unit tests or test runner (validation is a script only).
- README and LICENSE are empty.

## Known problems / ambiguities

1. **Visually inferred frame splits** (D-013). `thinking_side`, `bow_polite` and `arms_open` frame 021 were assigned to idle/talking by mouth shape plus the consistent 4-idle + 4-talking numbering pattern. Confirm by eye in the running renderer.
2. **Frame 024** (`sprites/_unassigned/maya_frame_024.png`) is a front-facing, arms-down frame that doesn't match `arms_open`. Listed in `unassignedFrames`; not used by any animation.
3. **`arms_open` has only 3 idle + 3 talking frames.** Frame 018 is missing; `maya_frame_017` was originally named `017 (2)`, so it may actually be 018.
4. **Frames 063–065 are missing.** `clasped_hands_laugh` reuses `clasped_hands_happy` idle frames (055–058, eyes-closed smile) as its idle.
5. **`surprised`** plays the `shocked` reaction (025–030) and then settles to `neutral_front`. There is no shocked talking/idle loop. Frames 027–030 could serve as a "shocked hold" if wanted later.
6. **`bow_polite`** is a steady leaning pose with idle/talking frames, not an animated bow. It was formerly modelled as a one-shot.
7. **Talking fps** copies each pose's previous single fps value. It hasn't been tuned.
8. Frame sizes vary slightly within a pose, so the renderer must anchor frames (`anchor: "bottom-center"`).
9. `background_18` has characters baked in. Backgrounds 19, 22 and 24 are 1 px off the standard size.
10. Audio filenames keep source typos (`typwriter.wav`) and the `dialogue/shock/` folder holds `effect`-category sounds. Logical IDs hide both from the engine.
11. Background `description` fields are visual guesses from thumbnails.
12. Vite emits its hashed bundles into `dist/assets/`, the same folder `public/assets/` is copied into. There is no collision today; `build.assetsDir` could be changed if one ever appears.
13. README/LICENSE empty; `index.html` title is "frontend".

## Current development phase

**Phase 1 — Asset stabilization.** Character, background and SFX assets are stable and have manifests. Music and UI assets don't exist yet.

## Immediate next objective

Start Phase 2 with a typed manifest loader (TypeScript types + fetch/validate for `characters/index.json`, `character.json`, `backgrounds.json`, `audio.json`). Then build a minimal scene renderer that shows a background and Maya's idle loop, which also lets the inferred frame splits be checked by eye.
