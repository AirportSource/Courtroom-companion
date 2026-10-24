# Project State — Courtroom Companion

_Last updated: 2026-10-24 (build fix: obsolete Vite demo imports removed). Source of truth is the filesystem; update this file when the actual state changes._

## Summary

Courtroom Companion is an Ace Attorney-style conversational interface. As of this audit the repository contains **a raw asset library and an unmodified Vite + React + TypeScript scaffold**. No game feature is implemented yet.

## Current architecture

```
Courtroom-companion/
├── CLAUDE.md                 # project rules for Claude Code (untracked)
├── .claude/skills/           # 11 project skills (untracked)
├── .gitignore                # Vite default ignore rules (root-level only)
├── README.md                 # empty (0 bytes)
├── LICENSE                   # empty (0 bytes)
├── docs/                     # persistent project memory (this folder)
├── tests/                    # empty (.gitkeep only)
└── frontend/                 # Vite + React 19 + TypeScript 6 app
    ├── index.html            # scaffold; title "frontend"; links missing /favicon.svg
    ├── package.json          # scripts: dev, build (tsc -b && vite build), lint (oxlint), preview
    ├── vite.config.ts        # default: react() plugin only
    ├── tsconfig*.json        # project references (app + node)
    ├── .oxlintrc.json        # react, typescript, oxc plugins
    ├── src/
    │   ├── main.tsx          # StrictMode root → App
    │   ├── App.tsx           # Vite starter page, minus obsolete demo-asset imports
    │   ├── App.css, index.css# starter styles
    │   └── components/       # 4 placeholder files, all 0 bytes
    │       ├── CharacterSprite.tsx
    │       ├── DialogueBox.tsx
    │       ├── GameScene.tsx
    │       └── TypewriterText.tsx
    └── public/
        ├── assets/
        │   ├── hero.png      # Vite scaffold image, not a game asset
        │   └── audio/        # blips, dialogue SFX, UI SFX + audio.json manifest
        ├── backgrounds/      # 29 PNG backgrounds
        └── characters/
            └── maya/         # character.json + sprites/<pose>/{idle,talking}/
```

Planned layers (not yet present): scene renderer, animation controller, typewriter + blip engine, central audio/music manager, LLM contract, FastAPI backend, Ollama/Qwen.

## Frontend status

- Toolchain declared: React `^19.2.8`, Vite `^8.2.2`, TypeScript `~6.0.2`, `@vitejs/plugin-react ^6.1.0`, oxlint `^1.79.0`.
- Node.js v24.22.1 / npm 11.19.1 are installed at `C:\Program Files\nodejs`. On this machine that directory may be missing from a shell's `PATH`; prepend it if `node` isn't found.
- `node_modules` is installed. `package-lock.json` has uncommitted changes from that `npm install` (transitive version bumps, not made by any code change).
- **`npm run build` passes** (tsc + vite; 17 modules; `dist/` is git-ignored). **`npm run lint` (oxlint) passes** with no diagnostics. Verified 2026-10-24.
- Earlier build failure (fixed): `App.tsx` imported `./assets/hero.png`, `react.svg` and `vite.svg`, which were deleted in commit `2c3e957`. They were Vite demo assets only, so the imports and the JSX that used them were removed. No placeholder files were created.
- Remaining scaffold leftovers that don't break the build: `index.html` links `/favicon.svg` and `App.tsx` uses `/icons.svg#…`. Neither file exists, so both give runtime 404s only. `App.css` still holds `.hero` styles that nothing uses. `frontend/public/assets/hero.png` is an unused copy of the demo image. All of this goes away when the starter page is replaced by the scene UI.
- The four component files exist but are empty.

## Backend status

No backend code exists. FastAPI/Ollama is out of scope until explicitly requested (see `CLAUDE.md`).

## What already works

- Frontend toolchain baseline: `npm run build` and `npm run lint` both pass (the starter page renders; no game features yet).
- Asset files are committed and tracked in Git (168 tracked files; tracked set == on-disk set, excluding `.claude/` and `CLAUDE.md`). Collaborators can pull them (commit `69d03ab`).
- 16 of 18 `audio.json` entries resolve to real files.
- Maya has a draft character manifest with a logical `emotionMap` (11 emotions) → animation IDs, with per-animation `fps` and `loop` — the intended data-driven direction.
- 9 of Maya's 12 sprite groups have a complete `idle/` + `talking/` split.

## What is incomplete

- No working UI: scene, character renderer, dialogue box, typewriter, blips, audio manager are all unimplemented.
- Character manifest does not model the `idle/` / `talking/` sub-structure; `folder` points to the pose root, so frame lists cannot be resolved as written.
- No music assets at all.
- No UI image assets (dialogue box, nameplate, arrow, fonts).
- No visual effect assets (flash, shake overlays, "Objection!" bubbles) — only SFX.
- No background manifest.
- No tests, no test runner configured.
- README and LICENSE are empty.

## Current asset organization

See `docs/ASSET_INVENTORY.md` for the full verified list.

- Audio: `frontend/public/assets/audio/{blips,dialogue,menu_ui}/` with manifest `audio.json`.
- Backgrounds: `frontend/public/backgrounds/` (**not** under `assets/`).
- Characters: `frontend/public/characters/<id>/` (**not** under `assets/`), with `character.json` and `sprites/<pose>/{idle,talking}/maya_frame_NNN (1).png`.

## Known problems

Manifest/path errors:
1. `character.json` `neutral_idle.folder = "sprites/neutral_front"` but the folder on disk is **`netural_front`** (typo). The default animation therefore points to a missing folder.
2. `character.json` defines `side_idle` and `side_praying`; **no such folders exist**.
3. `audio.json` blips point to `blips/female.wav` and `blips/male.wav`; actual files are `blips/blip_female/blipfemale.wav` and `blips/blip_male/blipmale.wav`.

Sprite structure problems:
4. `smile_front` idle frames are nested at `smile_front/talking/idle/` instead of `smile_front/idle/`.
5. `thinking_side` has only `talking/` (8 frames, 047–054); no `idle/`.
6. `bow_polite` (8 frames) and `shocked_panicked` (6 frames) are flat (no idle/talking split) — consistent with their `loop: false` one-shot role, but this needs to be an explicit convention.
7. `arms_open/talking/maya_frame_024 (1).png` is 63×111 while all other `arms_open` frames are 94–95×107 → likely a misplaced frame from another pose. Needs visual check.
8. Frame-number gaps: `018` missing (arms_open has `017 (2)`), `063–065` missing (clasped_hands_happy talking jumps 062 → 066). `clasped_hands_happy/talking` has 8 frames vs 4 elsewhere — may contain two sequences.
9. Filenames contain spaces and parentheses (`maya_frame_009 (1).png`) — require URL encoding and are fragile.
10. Frame dimensions vary slightly within a pose (e.g. 65 vs 66 px wide), so rendering must anchor frames (e.g. bottom-centre) rather than assume identical sizes.

Other:
11. Asset location convention is split: audio under `public/assets/`, backgrounds and characters directly under `public/`. `CLAUDE.md` expects `frontend/public/assets/`.
12. `audio.json` groups `shock` as a top-level category while the files live under `dialogue/shock/`; dialogue SFX vs effect SFX categories are not yet distinguished as the audio-engine skill recommends.
13. Typo in filename `menu_ui/typwriter.wav` (manifest references it consistently, so it works).
14. Three backgrounds have off-by-one dimensions: `background_19_512x193`, `background_22_255x192`, `background_24_256x191`.
15. Backgrounds are numbered only; no semantic names/IDs.
16. `.claude/` and `CLAUDE.md` are untracked.

## Current development phase

**Phase 0 complete; entering Phase 1 (asset stabilization).** Docs are in place and the build/lint baseline is green. No features implemented yet.

## Immediate next objective

Stabilize Maya's character assets and manifest (roadmap item "stabilize character assets"): propose a rename/fix mapping for problems 1–10, get approval, apply minimal changes, and make every `character.json` entry resolve to real idle/talking frame lists. See `docs/ROADMAP.md`.
