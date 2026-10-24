# Roadmap — Courtroom Companion

_Checkbox roadmap. Tick items only when verified working. Notes under items record status/blockers._

Legend: `[ ]` not started · `[~]` in progress / partially present · `[x]` done and verified

## Phase 0 — Project initialization
- [x] Audit repository and create persistent docs (`docs/*.md`) — 2026-10-24
- [x] Install Node.js on the dev machine and confirm `npm run build`, `npm run lint` baseline — 2026-10-24, both pass
- [x] Remove obsolete Vite demo-asset imports from `App.tsx` so the build passes — 2026-10-24 (starter page itself still to be replaced by the scene UI)

## Phase 1 — Asset stabilization
- [x] Stabilize character assets — 2026-10-24
  - Maya: 12 idle/talking animations, 1 one-shot reaction, 13 emotions; schema v1 manifest (D-011). Visually inferred splits still to confirm by eye in the renderer (D-013); frame 024 unassigned.
- [x] Stabilize backgrounds — 2026-10-24
  - `backgrounds.json` with `bg_01`…`bg_29` and validated dimensions. Semantic names are still descriptions only; bg_18 has characters baked in.
- [x] Stabilize SFX — 2026-10-24
  - `audio.json` v1 (D-012): 18 sounds in `blip` / `dialogue` / `effect` / `ui`, blip paths fixed.
- [ ] Prepare loopable music
  - No music files exist. `assets/music/` folder reserved.
- [ ] Prepare UI assets
  - No dialogue box / nameplate / continue-arrow / font assets exist. `assets/ui/` folder reserved.
- [x] Decide and apply runtime asset location convention — 2026-10-24, everything under `frontend/public/assets/` (D-010)
- [x] Manifest validation script — 2026-10-24, `npm run validate:assets` (D-014)

## Phase 2 — Scene & character rendering
- [ ] Typed manifest loader (TS types + runtime validation for characters/backgrounds/audio manifests)
- [ ] React scene renderer (background + character + dialogue layers, pixel-perfect scaling)
- [ ] Character animation engine (one controller per character, data-driven fps/loop)
- [ ] Idle/talking state handling (talking driven by dialogue playback state)

## Phase 3 — Dialogue
- [ ] Typewriter dialogue (punctuation pauses, skip/advance, continue indicator)
- [ ] Dialogue blip engine (throttled, per-character blip)
- [ ] Emotion mapping (logical emotion → animation via character pack, safe `neutral` fallback)

## Phase 4 — Audio
- [ ] Audio manager (central service; blip / UI / effect categories; volume & mute)
- [ ] Music manager and crossfade (single active track, no restart of same track)

## Phase 5 — Conversation intelligence
- [ ] Structured LLM contract (strict schema, enumerated emotions/effects/music moods, validation)
- [ ] FastAPI backend _(out of scope until explicitly requested)_
- [ ] Ollama/Qwen integration _(out of scope until explicitly requested)_
- [ ] Conversation memory

## Phase 6 — Voice input
- [ ] Microphone / Whisper
