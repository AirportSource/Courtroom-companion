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
- [~] Prepare loopable music — 2026-10-24: 25 OST tracks + `soundtrack.json`; 15 metric-validated loops, 10 playable tracks remain `loop: null`; Maya now has a metric-validated loop. No loop verified by listening; see D-048 and `docs/MUSIC.md`.
- [~] Prepare UI assets
  - 2026-10-24: CSS stand-ins remain for the dialogue box, name plate, arrow and menu buttons; original title and menu-panel art are in use.
  - [~] Owner-supplied sources received: title sheet, exclamations, Igiari distribution, DotGothic16 source and miscellaneous background sheet. **Missing:** a text box / name plate / arrow source.
  - [x] `ui.json` manifest + validator coverage; title art, exclamations and font extracted — 2026-10-24
  - [x] Igiari WOFF2 is the primary stage/UI font at 16 px, measured by the live paginator — 2026-10-24 (D-037)
  - [x] Deterministic Japanese fallback — bundled DotGothic16 supplies Kanji after Igiari; system Japanese fonts are tertiary only — 2026-10-24 (D-038)
  - [x] Kanji/kana visual balance: DotGothic16 `size-adjust: 75%`, paginator-consistent — 2026-10-24 (D-051)
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
- [x] Music manager: one MusicEngine, Web Audio loop regions in samples, fades, single active source, no restart of same track, separate BGM volume/mute — 2026-10-24 (D-043)
- [x] Imported music: backend library, Web Worker auto-loop with confidence, preview/accept/adjust, crossfade fallback — 2026-10-24 (D-045); verified with a synthetic WAV, not yet with real user music
- [~] YouTube radio via the official IFrame Player — 2026-10-24 (D-046, D-048); official player test of current Lofi Girl candidate `EWrX250Zhko` returned error 150, preset is marked unavailable; generic video URL/ID remains configurable
- [ ] Manual by-ear loop validation of built-in tracks (Maya Fey, Initial Investigation, Cross-Examination Moderato, Suspense, a contextual track)
- [ ] MusicDirector (logical music intents → engine), not LLM-chosen paths
- [x] Character BGM only in the conversation scene; menus silent; leaving fades out — 2026-10-24 (D-050)
- [x] Semantic reaction SFX (director → `sfx_<name>` events, once per beat) + SFX volume/mute — 2026-10-24 (D-049); selection/timing reliability follow-up in D-054; WAVs still await by-ear approval
- [x] User typing blips (male), IME-safe and throttled — 2026-10-24 (D-049)
- [x] Discoverable import UX (button + drop zone, visible steps, readable failures, auto-open loop editor) — 2026-10-24

## Phase 5 — Conversation intelligence
- [x] Structured LLM contract — 2026-10-24: CharacterReply (multi-beat: text / emotion / intensity / reaction / gesture + settleEmotion), shared parse+validate+repair (D-033)
- [x] FastAPI backend — 2026-10-24: `/api/health`, `/api/characters/{id}/capabilities`, `/api/chat`; CharacterService; in-memory sessions
- [x] Provider-agnostic LLM gateway + adapter contract + FakeProvider — 2026-10-24 (D-033)
- [x] Character Director → PerformanceTimeline driving the existing dialogue/animation engines — 2026-10-24 (D-034)
- [x] Waiting/thinking performance while the reply is generated (data-driven, provider-independent) — 2026-10-24 (D-049)
- [x] Minimal chat UX in the conversation scene (input → waiting → performance → settle) — 2026-10-24
- [x] First real provider adapter: Ollama native HTTP API, JSON-Schema output, backend model discovery and Settings controls — 2026-10-24 (D-039)
- [x] Generic OpenAI-compatible provider: Chat Completions, native JSON Schema, backend-only secret state and Settings test flow — 2026-10-24 (D-040)
- [x] Persistent backend provider profiles, active selection, OS credential storage and environment fallback — 2026-10-24 (D-041); Windows-vault browser lifecycle verified with synthetic credentials
- [x] Native Anthropic Messages provider — existing profiles/CredentialStore, current native JSON output, shared schema/validation, profile Test Connection and compact Settings fields — 2026-10-24 (D-042); transport mocked, real-vault UI verified, live Claude generation pending a configured profile credential
- [ ] Streaming (metadata first, then text) — design only so far
- [ ] Conversation memory (in-memory 12-message history only so far)
- [ ] Effects/music intent in the contract (exclamations, music moods)

## Phase 5b — Court Record & Talk Options
- [x] Data-driven Court Record manifest + 3 native evidence icons + DS Court Record view (main menu + conversation overlay) — 2026-10-24 (D-047)
- [x] Generic Talk Options over the original talk-option panel; chosen topic returns as a normal chat message — 2026-10-24 (D-047)
- [ ] Profiles entries, more evidence, case logic / presenting evidence

## Phase 5c — Archive, polish and robustness (2026-10-24)
- [x] Persistent Conversation Record (backend archive + DS grid/detail, artifact links), separate from LLM context — D-058
- [x] Dialogue output floor 4096, cross-provider truncation/context taxonomy, history context budget — D-059
- [x] Native evidence frame primitive (Court Record, summon, record) and collapsible secondary panels — D-060
- [x] Selectable ringtone presets (Phoenix default, Wellington, Godot) with Settings preview — D-061; loops not auditioned
- [ ] Listen to ringtone loops and record/artifact UX on real providers

## Phase 7 — Agents and events (D-067, plan and status in docs/AGENTS_AND_EVENTS.md)
- [x] Event inbox: characters speak without a user message; exclamation bubbles — 2026-10-25
- [x] Claude Code companion: hook script → events → character lines (installation pending owner consent)
- [x] Tool framework + reminders (phone rings when due)
- [x] Reading authorized folders
- [x] Web search (Brave/Tavily; key not configured yet)
- [x] Voiced shouts (EN/JA) and title intro (D-068/D-069): 12 objection voices, no immediate repeat

## Phase 6 — Voice input
- [ ] Microphone / Whisper

## Milestone 2 of 3 — Safe generated artifacts (D-052)
- [x] One shared, strict optional text-artifact action beside CharacterReply; all four providers reuse it
- [x] Bounded UTF-8 txt/md/py storage with opaque backing IDs, atomic publication, persistent metadata/receipts and safe display names
- [x] Local list/metadata/content/download/delete API; Python remains inert text
- [x] Turn working/ready/failed cues, duplicate coalescing, explicit cancellation, stable error performance and normal-chat regression coverage
- [x] Minimal out-of-stage Generated files panel: preview, full text, download, delete and reload/navigation persistence
- [x] Task-aware output cap: normal profile budget retained, explicit text-artifact requests use 16,384; separate Anthropic token/context/refusal diagnostics, fail-closed truncation and all-provider budget regression tests — 2026-10-24 (D-053)
- [x] Milestone 3: file-only generated-artifact Court Record, phone acknowledgement, summon box, semantic delivery SFX, buffered reply release and artifact inspector (D-055)

## Milestone 3 of 3 — Artifact delivery presentation
- [x] One authoritative frontend delivery state machine; backend artifacts remain the sole storage authority
- [x] Thinker working cue, bounded one-shot phone ring, explicit mouse/keyboard acknowledgement and deterministic summon/continue timing
- [x] Existing final CharacterReply is buffered and released once through the existing CharacterDirector, dialogue paginator and performance engine
- [x] Generated-file-only 3×2 square Court Record pages, stable creation ordering, keyboard/mouse selection, inspector, safe preview/download/delete
- [x] Temporary Thinker/phone presentation assets are not Court Record files; static/demo evidence remains separate
- [x] Milestone 2 Generated files panel is development-only; no duplicate production artifact library
- [x] Maya personality guidance keeps burgers and other recurring traits occasional and context-led without counters or keyword filters (D-056)
- [x] Browser FakeProvider flow: artifact → phone → acknowledgement → summon → existing reply; eight ordinary follow-up turns and 3×/4×/auto Court Record inspection
- [x] Presentation/audio correction: character-defined local task acknowledgement concurrent with existing provider work, fast-result gate, real Phoenix ringtone loop, scoped BGM duck/restore, Court Record browsing sounds and dev ringtone audition (D-057)

## Asset expansion milestone (2026-10-26, D-079–D-086)
- [x] Source archive inventory + gaps (`ASSET_EXPANSION_INVENTORY.md`, `ASSET_EXPANSION_GAPS.md`)
- [x] Character readiness, signature SFX, per-character isolation tests, behaviour framework
- [x] First wave: Edgeworth, Franziska, Larry, Pearl (native DS, ready after real-provider behaviour tests)
- [x] HD→DS location pipeline; 20 rooms installed (`bg_30`–`bg_49`)
- [~] HD→DS character pipeline — prototype passed review (Frank, Angel, Godot); no HD character integrated yet
- [x] Magnifier status grammar; native evidence frame kept (archive frame is a different design)
- [x] Trilogy soundtrack (84 runtime tracks), batch loop analyser, conversation music strip
- [ ] Listen to every `measured_not_auditioned` loop; decide the 4 flagged D-048 loops; loop the 49 `loop: null` tracks (incl. the 4 new character themes)
- [ ] Next character wave (Godot via HD pipeline; Phoenix, Ema, Manfred von Karma, Judge from native sheets)
- [ ] Official portraits from the GBA profile sheet; Franziska placement eyeball check

## Presentation and original DS audio integration (2026-10-26)

- [x] Explicit presentation groups, generic fallback and unchanged identity (D-087).
- [x] Miles discussion sheet and Franziska composited animated-source frames; courtroom sets retained.
- [x] Preserve 25 older tracks; replace 55 of 59 expansion imports with confidently mapped DS originals (D-088).
- [x] Fresh scoped loop analysis: 21 measured loops / 34 whole-file fallbacks; audited backup of superseded remasters.
- [x] Browser context/character switching, scales, blips, whip, player and ducking regression; automated checks pass.
- [ ] Human audition of all migrated audio and the 21 new loop seams; review relative volume.
- [ ] Resolve 4 uncertain mappings listed in [migration report](PRESENTATION_DS_MIGRATION.md).
- [ ] Optional full-motion review of shared whip transition; no further presentation implementation is pending.

The previous expansion's 35-loop/49-null totals above are historical; use the migration report/audit for the current source and loop disposition. Pre-existing loops were deliberately not recalculated.

## Targeted correction pass (2026-10-26)

- [x] Franziska native whip composition/timing and sequenced impact cue; cooldown preserved.
- [x] Centered selection preview and front-facing native Journal portrait.
- [x] Native phone evidence frame and request-scoped uploaded-image lifetime/cleanup.
- [x] Restrained Pearl positive/playful SFX and meaningful lightbulb realization guidance/mapping.
- [x] Full validation and browser regression; DS soundtrack unchanged by hash.
- [ ] Obtain mapped official kanji font or authoritative glyph-to-Unicode table for supplied custom-order atlas; current font stack preserved.
- [ ] Human listening for Franziska impact timing, Pearl cue fit and lightbulb mix. Supplied GIF has zero delays, so exact timing remains uncertain.

Details: [targeted correction report](TARGETED_CORRECTIONS.md). The earlier Franziska selection/profile checks are now completed; historical milestone entries remain intact.

### Whip effect, loops and semantic SFX (2026-10-26, D-091-D-093)
- [x] Reference whip GIF converted; reaction effect overlay + cues; whip complete or absent.
- [x] Conversation whip = black screen + slash, fade back to front pose; no courtroom side sprites in conversation.
- [x] Shared SFX library, character pools, frequency model; Pearl calibrated.
- [x] Structural loop pass: 51/55 DS tracks loop; Turnabout Sisters later loop.
- [ ] Human listening: whip/whack timing, new loops (esp. Turnabout Sisters, pursuit 2004, psyche locks), Pearl cue fit.
- [ ] Decide on v2 loop evidence for pre-expansion/REVIEW tracks and the 4 questionable loops; update `migrate_ds_audio.py --finalize-analysis`.

- [x] D-094: conversation whip starts with the lash; whip triggers balanced with classic emotions.
- [ ] Measure Franziska's live whip frequency in a real conversation (with an isolated `COURTROOM_CONFIG_DIR`).

## Iris (2026-10-26, D-098)

- [x] Rejected uncommitted Dahlia pack removed surgically (soundtrack entry kept).
- [x] Iris: replace every active 3DS-derived visual with the supplied 16-file pixel-art GIF set; no scaling, recolouring or rejected-source fallback.
- [x] Six normal-outfit poses, 48 native-pixel frames, GIF timing/blinks/talking motion, portrait and preview; hooded poses inventoried but source-only.
- [x] Preserve personality, five-language lines, ten-emotion contract and restrained SFX; keep the pack `ready`.
- [x] Deterministic 50-file rebuild, focused source/manifest tests, and 1x/3x contact-sheet QA.
- [ ] Optional: a ten-turn real-model session with Iris (isolated `COURTROOM_CONFIG_DIR`), and an Iris theme if a fitting track is imported later.

## Content milestone completion (2026-10-26)

- [x] Three supplied 256x192 locations selectable, localized and validated (`bg_50`–`bg_52`).
- [x] Phone evidence exterior matte transparent; handset details/frame/placement preserved; regression test added.
- [x] Full backend/frontend checks and focused browser QA passed; exact counts in PROJECT_STATE.
- [ ] Character Platform Stabilization P0: explicitly deferred to a future session.

## Experimental emotional realism prototype (2026-10-26)

- [x] Optional validated Iris/Franziska boundary profiles, prompt integration and conversation-safe capabilities.
- [x] Automated isolation/contract/artifact regressions and reproducible multi-turn evaluation pack.
- [ ] Complete real-LLM behavioral evaluation and refinement; automated checks do not establish emotional realism.
