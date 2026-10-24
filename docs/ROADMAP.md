# Roadmap — Courtroom Companion

_Checkbox roadmap. Tick items only when verified working. Notes under items record status/blockers._

Legend: `[ ]` not started · `[~]` in progress / partially present · `[x]` done and verified

## Phase 0 — Project initialization
- [x] Audit repository and create persistent docs (`docs/*.md`) — 2026-10-24
- [x] Install Node.js on the dev machine and confirm `npm run build`, `npm run lint` baseline — 2026-10-24, both pass
- [x] Remove obsolete Vite demo-asset imports from `App.tsx` so the build passes — 2026-10-24 (starter page itself still to be replaced by the scene UI)

## Phase 1 — Asset stabilization
- [~] Stabilize character assets
  - Maya: 12 sprite groups exist; manifest has 3 broken folder refs, `netural_front` typo, misnested `smile_front` idle, `thinking_side` lacks idle, suspect frame `024`. See PROJECT_STATE "Known problems".
- [~] Stabilize backgrounds
  - 29 PNGs exist; no manifest, no semantic IDs, 3 off-by-one sizes.
- [~] Stabilize SFX
  - Blips, dialogue and UI SFX exist; `audio.json` blip paths broken; effect vs dialogue SFX categories not separated.
- [ ] Prepare loopable music
  - No music files exist.
- [ ] Prepare UI assets
  - No dialogue box / nameplate / continue-arrow / font assets exist.
- [ ] Decide and apply runtime asset location convention (see DECISIONS D-008)

## Phase 2 — Scene & character rendering
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
