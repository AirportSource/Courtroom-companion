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
- [~] Prepare UI assets
  - 2026-10-24: CSS stand-ins remain for the dialogue box, name plate, arrow and menu buttons; original title and menu-panel art are in use.
  - [~] Owner-supplied sources received: title sheet, exclamations, Igiari distribution, DotGothic16 source and miscellaneous background sheet. **Missing:** a text box / name plate / arrow source.
  - [x] `ui.json` manifest + validator coverage; title art, exclamations and font extracted — 2026-10-24
  - [x] Igiari WOFF2 is the primary stage/UI font at 16 px, measured by the live paginator — 2026-10-24 (D-037)
  - [x] Deterministic Japanese fallback — bundled DotGothic16 supplies Kanji after Igiari; system Japanese fonts are tertiary only — 2026-10-24 (D-038)
  - [~] Authentic Japanese typography — DotGothic16 is visually compatible but is not claimed to be the original Ace Attorney Kanji font
  - [x] Menu panels from the miscellaneous sheet → `ui/menu/`, used as menu backgrounds — 2026-10-24 (D-031)
  - [ ] Replace the remaining CSS stand-ins (text box, name plate, arrow, menu buttons)
- [x] Decide and apply runtime asset location convention — 2026-10-24, everything under `frontend/public/assets/` (D-010)
- [x] Manifest validation script — 2026-10-24, `npm run validate:assets` (D-014)

## Phase 2 — Scene & character rendering
- [x] Typed manifest loader — 2026-10-24 (characters + backgrounds; audio manifest typed when the audio manager arrives)
- [x] React scene renderer — 2026-10-24: background → character → dialogue overlay on a 256×192 integer-scaled stage. Wide-background panning not done.
- [~] Character animation engine — 2026-10-24: single timer per character, manifest fps/loop, one-shot reactions with settle. Still to come: multi-character, transitions.
- [x] Idle/talking state handling — 2026-10-24: driven by typewriter reveal state (dev toggle remains in the Animation Test screen)
- [x] Frame splits confirmed by the original sheet's "x Talk" brackets — 2026-10-24 (D-027). Remaining by-eye items: shocked order, unassigned frame 025
- [x] Sprite jitter fix: canvas + per-frame offsets (D-022), with dev A/B toggle, debug overlay and 1–4×/auto scale — 2026-10-24
- [x] Re-extract Maya frames 1:1 from the original sheet — 2026-10-24: 102 native frames from `maya fey.png` (D-027); fixes muddiness, jitter and scale
- [x] Generic character render profile (scale/offset in manifest) + dev overrides — 2026-10-24 (D-026); Maya = native 1/0/0
- [ ] Extract sheet rows 14–17 (side poses) as new animations when needed
- [x] Start / main menu, character select (from index.json), location select (from backgrounds.json), settings screen — 2026-10-24 (CSS-styled; original title/menu art pending)

## Phase 3 — Dialogue
- [x] Typewriter dialogue — 2026-10-24: waiting/revealing/complete, punctuation pauses, skip, advance, continue indicator
- [x] Dialogue blip engine — 2026-10-24: voice from the character manifest, per-line and dev overrides, voiced characters only, 60 ms throttle
- [~] Classic DS dialogue box + name plate — layout and behaviour done; original graphics pending (see Phase 1 UI assets)
- [ ] Dialogue source abstraction (script / later LLM) and text colour markup
- [x] Emotion mapping — 2026-10-24: logical emotion → animation/reaction via character pack, fallback chain in `characterResolver.ts`

## Phase 4 — Audio
- [~] Audio manager — 2026-10-24: central Web Audio engine, decode-once, gesture unlock, blip volume/mute. Still to come: effect SFX wiring and per-category volumes.
- [x] Menu/navigation SFX via logical events (cursor/confirm/cancel/open/page/save/start) — 2026-10-24 (D-028)
- [x] Lightweight engine tests (`npm test`, node:test) — 2026-10-24 (D-029)
- [x] Settings: text speed, blip volume, mute, fullscreen — 2026-10-24
- [ ] Music manager and crossfade (single active track, no restart of same track)

## Phase 5 — Conversation intelligence
- [x] Structured LLM contract — 2026-10-24: CharacterReply (multi-beat: text / emotion / intensity / reaction / gesture + settleEmotion), shared parse+validate+repair (D-033)
- [x] FastAPI backend — 2026-10-24: `/api/health`, `/api/characters/{id}/capabilities`, `/api/chat`; CharacterService; in-memory sessions
- [x] Provider-agnostic LLM gateway + adapter contract + FakeProvider — 2026-10-24 (D-033)
- [x] Character Director → PerformanceTimeline driving the existing dialogue/animation engines — 2026-10-24 (D-034)
- [x] Minimal chat UX in the conversation scene (input → waiting → performance → settle) — 2026-10-24
- [x] First real provider adapter: Ollama native HTTP API, JSON-Schema output, backend model discovery and Settings controls — 2026-10-24 (D-039)
- [x] Generic OpenAI-compatible provider: Chat Completions, native JSON Schema, backend-only secret state and Settings test flow — 2026-10-24 (D-040)
- [x] Persistent backend provider profiles, active selection, OS credential storage and environment fallback — 2026-10-24 (D-041); Windows-vault browser lifecycle verified with synthetic credentials
- [x] Native Anthropic Messages provider — existing profiles/CredentialStore, current native JSON output, shared schema/validation, profile Test Connection and compact Settings fields — 2026-10-24 (D-042); transport mocked, real-vault UI verified, live Claude generation pending a configured profile credential
- [ ] Streaming (metadata first, then text) — design only so far
- [ ] Conversation memory (in-memory 12-message history only so far)
- [ ] Effects/music intent in the contract (exclamations, music moods)

## Phase 6 — Voice input
- [ ] Microphone / Whisper
