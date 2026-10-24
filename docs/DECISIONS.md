# Architectural Decisions — Courtroom Companion

_Rules: never rewrite a decision silently. When a decision changes, set its status to **Superseded by D-xxx**, keep the original text, and add a new entry explaining why._

Status values: **Accepted** · **Proposed** (not yet confirmed by the project owner) · **Open** (needs a decision) · **Superseded by D-xxx**

Entries D-001–D-007 were reconstructed on 2026-10-24 from the existing repository, Git history, `CLAUDE.md` and project skills; they record decisions already in effect rather than new ones.

---

## D-001 — Frontend stack: React + TypeScript + Vite
- **Status:** Accepted (pre-existing)
- **Date recorded:** 2026-10-24
- **Context:** `frontend/` was scaffolded with Vite (React 19, TypeScript 6, oxlint).
- **Decision:** Build the client as a React + TypeScript single-page app bundled by Vite. Lint with oxlint. Build = `tsc -b && vite build`.
- **Rationale:** Fast dev loop, typed domain models for manifests/contracts, static `public/` serving fits a sprite/audio asset library.

## D-002 — Runtime assets are tracked in Git
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Context:** Commit `662e89e` ("Stop tracking public folder") stopped tracking `frontend/public`. It was reversed by `2feab7d`/`f5209f9` (gitignore changes) and `69d03ab` ("Track frontend/public assets so collaborators can pull them").
- **Decision:** `frontend/public/` assets are committed to the repository.
- **Rationale:** Collaborators and other machines must be able to pull a working asset set. The earlier "don't track public" approach broke cross-machine sync.
- **Note:** The interim "do not track `frontend/public`" approach (commit `662e89e`) is considered superseded by this decision.

## D-003 — Character packs are data-driven
- **Status:** Accepted (pre-existing direction). The draft manifest *format* described below is superseded by D-011; the principle stands.
- **Date recorded:** 2026-10-24
- **Context:** `frontend/public/characters/maya/character.json` defines `id`, `displayName`, `defaultAnimation`, `animations{folder,fps,loop}`, `emotionMap`.
- **Decision:** Each character is a pack (folder + manifest). Application logic uses logical emotions; the pack maps emotion → animation. Generic renderer/audio/animation code must never hard-code Maya.
- **Rationale:** Supporting Phoenix, Edgeworth and custom characters should require only data/assets, not renderer rewrites.

## D-004 — Animation model: idle/talking loops plus one-shot reactions
- **Status:** Accepted (pre-existing direction)
- **Date recorded:** 2026-10-24
- **Decision:** Poses have `idle` and `talking` variants. Talking is driven by dialogue playback state (typewriter actively revealing), not guessed from text. One-shot reactions (`loop: false`, e.g. bow, shocked) interrupt and resolve to a stable idle. FPS lives in character data.
- **Rationale:** Matches Ace Attorney presentation; keeps timing configurable per character.

## D-005 — Centralized audio with separate categories
- **Status:** Accepted (pre-existing direction)
- **Date recorded:** 2026-10-24
- **Decision:** A single audio manager owns playback. Categories: dialogue blips, UI SFX, reaction/effect SFX, music. Music has independent volume, one active track, crossfades, and is never restarted if already playing.
- **Rationale:** Avoids duplicate playback on React re-renders and scattered `new Audio()` calls; respects autoplay policies in one place.

## D-006 — LLM proposes semantic intent; the app validates and executes
- **Status:** Accepted (pre-existing direction; schema not yet defined)
- **Date recorded:** 2026-10-24
- **Decision:** The LLM returns structured data (text + enumerated emotion/effect/music mood). It never supplies file paths or executable actions. Unknown values fall back safely. The renderer is LLM-vendor-agnostic.
- **Rationale:** Safety, robustness against malformed output, and swappable models.

## D-007 — Backend deferred
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Decision:** FastAPI/Ollama backend work is out of scope until explicitly requested. Frontend can be developed with scripted/mock dialogue first.
- **Rationale:** Presentation layer (rendering, animation, dialogue, audio) is the critical path and must be solid before integrating a model.

## D-008 — Runtime asset location convention
- **Status:** Superseded by D-010 (2026-10-24). The owner chose option (a).
- **Date recorded:** 2026-10-24
- **Context:** `CLAUDE.md` and the asset-pipeline skill prefer `frontend/public/assets/`. On disk, audio is under `public/assets/audio/`, but backgrounds (`public/backgrounds/`) and characters (`public/characters/`) are directly under `public/`.
- **Options:** (a) move backgrounds and characters under `public/assets/`; (b) accept the current split and document it as the convention.
- **Decision:** Not yet made. No assets were moved during initialization. Resolve before writing asset-loading code, so URLs are only written once.

## D-009 — Repository docs are the persistent project memory
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Decision:** `docs/PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `ASSET_INVENTORY.md` and the append-only `SESSION_LOG.md` hold project-critical facts. They are updated at the end of every substantial task.
- **Rationale:** Work spans sessions and machines; conversation memory is not durable.

## D-010 — All runtime assets live under `frontend/public/assets/`
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** D-008
- **Decision:** Runtime assets live in `frontend/public/assets/{characters,backgrounds,audio,music,ui}/`. Backgrounds and characters were moved there with `git mv` (history preserved). Empty `music/` and `ui/` are held by `.gitkeep`.
- **Rationale:** The project owner chose this layout. It gives one predictable root (`/assets/...`) for every runtime URL and matches `CLAUDE.md` and the asset-pipeline skill.

## D-011 — Character pack manifest schema v1
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the draft `character.json` format (`animations{folder,fps,loop}` + `emotionMap`) referenced in D-003.
- **Decision:**
  - `characters/index.json` maps character id → manifest path.
  - `character.json`: `schemaVersion`, `id`, `displayName`, `anchor`, `voice.blip` (audio sound id), `defaultEmotion`, `fallbackEmotion`.
  - `animations.<id>` holds conversational loops and must have both `idle` and `talking`, each with `{fps, loop, frames[]}`.
  - `reactions.<id>` holds one-shots `{fps, loop:false, frames[]}`.
  - `emotions.<emotion>` is `{ animation, reaction? }`. If a reaction is present it plays first, then the animation takes over.
  - `unassignedFrames[]` lists real files that are deliberately unused.
  - All paths are relative to the manifest's directory.
- **Rationale:**
  - Browsers can't list directories, so frames must be enumerated explicitly.
  - The old `folder` pointers couldn't express idle/talking.
  - Looping conversation poses and one-shot reactions need different lifecycles (D-004).
  - The renderer consumes only logical IDs, and nothing in the schema is Maya-specific.

## D-012 — Audio manifest schema v1
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the original nested `audio.json` (`blips/dialogue/shock/ui` with camelCase keys and broken blip paths).
- **Decision:** `audio.json` has `categories` (`blip`, `dialogue`, `effect`, `ui`) and a flat `sounds.<snake_case_id> = {category, src}`. Shock/impact sounds are category `effect`, even though they physically sit in `dialogue/shock/`. Audio files were not renamed. Music gets its own manifest once music assets exist.
- **Rationale:**
  - The audio-engine skill separates blip, UI, effect and music.
  - Flat logical IDs decouple the engine from folder layout and source-file typos.
  - Not moving the WAVs kept the change minimal.

## D-013 — Visually inferred idle/talking splits for unsplit sprite groups
- **Status:** Superseded by D-027 (2026-10-24). The original sheet's "x Talk" brackets confirmed the thinking and polite splits. They corrected `arms_open` (4+4, not 3+3) and the laugh (7 frames, not 4).
- **Date:** 2026-10-24
- **Context:** Several groups were unsplit or misfiled: `thinking_side` (all 8 frames in `talking/`), `bow_polite` (8 flat frames), `arms_open` frame 021 (filed as idle), frames 066–069 (mixed into `clasped_hands_happy/talking`), and frame 024 (a different pose inside `arms_open/talking`).
- **Decision:**
  - Frames were re-filed based on contact-sheet inspection (mouth closed vs moving, eyes open vs closed). Every other pose follows a sequential "4 idle then 4 talking" numbering pattern, and these splits follow it too.
  - 066–069 (eyes-closed laughing) became `clasped_hands_laugh`.
  - 024 moved to `sprites/_unassigned/`.
  - `bow_polite` is now a conversational pose rather than a one-shot.
  - Shocked frames moved to `shocked_panicked/reaction/`.
  - `" (1)"`/`" (2)"` suffixes were stripped from all filenames. Original frame numbers were kept.
- **Rationale:** Every pose now has usable idle and talking loops, and every file is URL-safe. All moves are `git mv`, so this is reversible if the visual judgement proves wrong.

## D-014 — Manifest validation script
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:** `frontend/scripts/validate-assets.mjs` (`npm run validate:assets`, plain Node, no dependencies) fails on any of the following:
  - a missing file;
  - whitespace in a path;
  - an unknown emotion, animation, reaction or blip reference;
  - a background with the wrong declared dimensions;
  - an unreferenced media file under `public/assets/`.

  Run it after any asset change.
- **Rationale:** The asset-pipeline skill requires every manifest path to be validated. The unreferenced-file check keeps manifests and the inventory honest.

## D-015 — Phase 2A engine structure
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `src/engine/` holds character-independent logic: manifest types, a loader with runtime shape validation, a **pure** resolver, and hooks.
  - `src/components/` holds generic renderers plus a temporary `DevPanel`.
  - Logical IDs are plain `string` types. The valid sets live only in the manifests.
  - Manifest paths are resolved against the manifest's URL (respects Vite `BASE_URL`).
- **Rationale:** Keeps Maya and filenames out of React. The resolver can be tested without a DOM. It also matches the character-engine and react-ui skills.

## D-016 — Animation lifecycle: one timer per character, reactions are always one-shot
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `useClipPlayback` is the only animation timer: one `setTimeout` chain per rendered character. It restarts from frame 0 when the clip changes (or when a reaction is replayed) and is cleared on change or unmount.
  - Frame duration = `1000 / fps` from the manifest.
  - A non-looping clip holds its last frame for one frame duration, then completes.
  - The loader forces `loop: false` on reactions. A `loop: true` reaction can't loop forever; it produces a warning instead.
  - Selecting an emotion bumps a play counter. If the emotion has a reaction, the reaction plays once and then settles into the emotion's stable animation in the **current** talk mode. Mode changes during a reaction apply after it finishes.
- **Rationale:** This follows the animation-engine skill: no scattered intervals, deterministic cleanup, and reactions that always resolve to a stable state.

## D-017 — Rendering: 256×192 logical stage, integer scaling, preload active character
- **Status:** Accepted (prototype)
- **Date:** 2026-10-24
- **Decision:**
  - The scene is a 256×192 logical stage, scaled as a whole by the largest integer factor that fits (fractional only below 1×). It uses `image-rendering: pixelated`.
  - Sprites and backgrounds are drawn at native size with whole-pixel offsets. Characters are anchored bottom-centre; backgrounds are centred, so wide ones are cropped.
  - All frames of the loaded character are decoded once at load and kept referenced. Other characters and backgrounds aren't preloaded.
- **Rationale:** Crisp pixel art without distortion. Decoding about 100 small frames up front removes flicker at negligible cost. Preloading per clip can replace this if character packs grow large.

## D-018 — Dialogue engine drives the existing animation engine
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `useCharacterAnimation` is split into `useReactionGate` (has this line's reaction finished?) and `useCharacterPlayback` (resolve + play). The convenience wrapper keeps the Phase 2A API.
  - `useTypewriter(text, lineKey, active, speed, onReveal)` has states `waiting` (inactive, nothing shown), `revealing` and `complete`. Exactly one pending timeout exists at a time.
  - Punctuation pauses apply only when the punctuation ends a word.
  - `skip()` reveals the whole line.
  - The conversation scene sets `active = !gate.pending` and `mode = revealing ? talking : idle`. One `lineKey` per line instance (index + pass) restarts both the reaction and the typewriter.
  - Unrevealed text is rendered invisibly so wrapping never jumps.
- **Rationale:** The brief and D-004 require talking to be driven by dialogue playback, not a second animation implementation. Reactions playing before text matches Ace Attorney pacing.

## D-019 — Web Audio engine; blips from character voice, throttled
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - There is a single `audioEngine` (one `AudioContext`). Each sound is fetched and decoded once and played via short-lived `AudioBufferSourceNode`s. In-flight and failed decodes are tracked, so there are no duplicate fetches or retry storms.
  - The context is created/resumed on a user gesture: "press start" on the title, plus any conversation input.
  - Blip voice precedence: dev override → `line.voice` → `character.voice.blip` (manifest). There is no character-specific code.
  - Blips play only for voiced characters (no whitespace or punctuation), at least 60 ms apart.
  - Volume and mute come from settings.
- **Rationale:** Decoded buffers avoid recreating media elements and handle rapid overlapping one-shots. Throttling avoids machine-gun playback at fast text speeds. Gesture unlock respects autoplay policy.

## D-020 — Every screen is a 256×192 DS stage; CSS stand-ins until original UI graphics arrive
- **Status:** Accepted (stand-ins are provisional)
- **Date:** 2026-10-24
- **Decision:**
  - Title, menus, settings and the scene all render inside `PixelStage` at DS logical resolution with integer scaling.
  - Dialogue geometry follows the owner's reference (÷5): name plate 48×13 at y=133 attached above a 256×48 box at y=144, grey outer border, dark interior, blue-grey plate.
  - Because Spriters Resource blocked automated download, frame, plate, arrow, title and menu buttons are CSS stand-ins, clearly documented in ASSET_SOURCES.md. Text is always live React text.
  - Screen flow: title (press start) → main menu → character select (from `characters/index.json`) → location select (from `backgrounds.json`) → conversation. Settings sit off the main menu.
- **Rationale:** Keeps DS proportions and crispness everywhere. Nothing is invented and passed off as original. Swapping in the originals later is a styling change, not a structural one.

## D-021 — Developer tools are gated by `import.meta.env.DEV`
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:** The "Asset / Animation Test" menu entry, the conversation dev panel (voice override, state readout) and the `window.__ccAudio` hook exist only in dev builds. The test script in `src/dev/` is temporary and is the only dialogue source until the LLM contract exists.
- **Rationale:** Keeps dev tooling clearly separate from the user-facing flow.

## D-022 — Sprite canvas + per-frame offsets in the character manifest (fixes jitter)
- **Status:** Accepted. The *architecture* stands; the registration-derived offset *values* below are superseded by D-027. The true root cause was resampled source frames.
- **Date:** 2026-10-24
- **Context:** Maya's frames were extracted cropped to their own bounding boxes, so the shared canvas offsets of the original sheet were lost. Frames of one pose differ by ±1 px in width and in where the body sits inside the crop. The renderer centred **each frame independently** (`floor((256 − w) / 2)`), so the body jumped ±1 stage px (6 screen px at 6×) between frames.
- **Decision:**
  - Optional manifest fields: `animations.<id>.canvas {width, height}` (shared by idle and talking), `reactions.<id>.canvas`, and per-clip `offsets: [[x, y], …]` parallel to `frames`.
  - The renderer anchors the **canvas** bottom-centre on the stage and draws each frame at its offset inside it. Clips without this data fall back to the old per-frame centring.
  - Offsets were computed by registering every frame against the first idle frame of its pose. The score was colour-tolerant pixel agreement over the **lower half of the body** (the part that should not move in idle/talking loops), searching ±2 px.
  - Result: every offset is 0–1 px horizontal. Vertical offsets only preserve the existing bottom alignment.
  - For the `shocked` reaction, the hold frames 027–030 are registered against 027, while the recoil frames 025–026 keep bottom-centre placement because that motion is real.
  - Source PNG pixels are untouched. The validator checks offsets (count, non-negative integers, frame fits the canvas).
- **Evidence:** mean silhouette-edge deviation from the pose reference (all rows of the lower 75 %) went from **0.331 px/frame → 0.248 px/frame**, against a best achievable integer placement of 0.242. Worst pose (`clasped_hands_happy`) 0.571 → 0.276.
- **Residual:** about 0.25 px of outline wobble remains, because the frame PNGs themselves were resampled during extraction (~1,400 colours per 65×111 frame; the DS background has 224). Only a clean re-extraction can remove it.
- **Rationale:** This is the "explicit offsets in animation metadata" option, the smallest change that keeps source pixels intact and gives a stable logical anchor.

## D-023 — Pixel font rendered on its native grid
- **Status:** Superseded by D-037 for the runtime font choice; the native-grid and manifest-metric principles remain accepted
- **Date:** 2026-10-24
- **Decision:**
  - Stage text uses the owner-supplied "Ace Attorney" FontStruct font (non-commercial licence), declared in `ui/ui.json` and loaded through the `FontFace` API, so no path appears in CSS.
  - Its glyphs sit on a 64-unit grid (1024 upm), so **16 px = one font pixel per stage pixel**.
  - `letterSpacing: -0.1875px` cancels the font's built-in extra 12-unit advance, keeping every glyph on whole pixels.
  - `wordSpacing: 3px` widens the 2 px space glyph.
  - Line heights are odd (15/13/31 px) so half-leading is a whole pixel.
  - Dialogue fits 3 lines of about 30 characters, as on the DS.
- **Rationale:** Crisp, authentic text at any integer scale. The metrics live in the manifest with the font.

## D-024 — `ui/ui.json` manifest; title is a two-phase DS-style flow
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - UI fonts and images are registered in `ui/ui.json` (logical ids, dimensions validated).
  - The title screen first shows the original title art (`title_screen`, unmodified crop) with "Click or press Enter" placed in its empty black rows 165–180. It then shows the main menu, mirroring the DS split between top-screen title and bottom-screen menu.
  - The Capcom "Licensed by Nintendo" splash is deliberately not used.
- **Rationale:** Authentic presentation where original assets exist, without implying official licensing.

## D-025 — Dev display options: scale override, alignment A/B, debug overlay
- **Status:** Accepted (temporary dev tooling)
- **Date:** 2026-10-24
- **Decision:** The dev panels offer stage scale 1×/2×/3×/4×/auto, alignment "canvas anchor" vs "per-frame centring (old)" for A/B comparison, and a debug overlay: canvas bounds (cyan), frame bounds (magenta), anchor (yellow) and baseline (green). These persist in `localStorage` in dev builds only; production always uses auto/canvas/off.
- **Rationale:** Lets the owner judge DS-like composition at smaller scales and verify the jitter fix visually.

## D-026 — Generic character render profile
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `character.json` may define `render: { scale, offsetX, offsetY }`. The renderer anchors the clip canvas's bottom-centre at stage (128 + offsetX, 192 + offsetY) and scales the sprite by `scale` around that anchor, snapped to whole stage pixels. Defaults are 1/0/0, and the validator checks the values.
  - Temporary dev overrides: scale 1.0/1.25/1.5/1.75/2.0, X/Y steppers and reset. Non-integer scales are flagged as distorting pixel art.
  - **Maya: `scale 1, offsetX 0, offsetY 0`.** With native frames she is 146–162 px tall on the 192 px stage, head around y=31, body continuing behind the dialogue box. That is the DS's own composition, so no magnification is needed.
- **Rationale:** "Maya too small" was caused by the 0.69× resampled frames, not by layout. The profile still lets future characters (Phoenix, Edgeworth) be tuned through data alone.

## D-027 — Maya re-extracted 1:1 from the authoritative original sheet
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the previous Maya PNGs (from an unknown, resampled rip) and the D-022 offset values.
- **Source:** `docs/references/maya fey.png` (1180×3112; ripped by Shoda), the authoritative Maya source.
- **Evidence the old frames were resampled:**
  1. **Dimensions:** they were non-integer 0.685–0.724× of the sheet sprites, with height ratios constant per row but width ratios varying per frame (rounding).
  2. **Palette:** the sheet uses exactly 15 colours across all 102 frames; the old frames had about 1,400 each.
  3. **Sheet is native:** 2×2 uniform-block share is about 0.51 at every phase (no pixel doubling).
  4. **Content:** every old frame matched its sheet row only after area-resampling, and frames within a row became indistinguishable.
- **Extraction:**
  - Each sprite is a connected component of non-background pixels. Exact bounding-box crop, with the sheet background (181,165,213) turned transparent and no other change.
  - Verified pixel-identical to the sheet for all 102 files; no semi-transparent pixels.
  - Rows 1–13 extracted; rows 14–17 (additional side poses) not used yet.
  - Names `maya_frame_001`…`102` follow sheet reading order. Old numbers could not be mapped frame by frame.
- **Grouping:**
  - Idle = columns 1–4 and talking = columns 5–8, per the ripper's "x Talk" brackets.
  - `arms_open` now 4+4.
  - `clasped_hands_laugh` talking = the 7-frame row-9 laugh.
  - `shocked` reaction keeps the previous order (arms-wide, then fists; uncertain), then the "x2"-annotated hold (frames 028–031) played twice.
  - The standing frame 025 stays unassigned (uncertain).
- **Alignment:** within each pose the native frames are pixel-identical on the lower body under bottom-centre placement (lower-body match 1.000). Canvases are the pose's max frame size, with offsets = bottom-centre placement. Only genuine motion remains: laugh head-bob, reaction recoil.
- **Rationale:** it fixes muddiness, jitter and scale at the source, without touching engine code.

## D-028 — Logical menu sound events
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `audio.json` has an `events` map: `menu_cursor` → `ui_select`, `menu_confirm` → `ui_select_alt`, `menu_cancel` → `ui_cancel`, `menu_open` → `ui_scroll`, `menu_page` → `ui_page`, `menu_save` → `ui_save`, `menu_start` → `ui_jingle`.
  - Components call `playMenuSound(event)` (`engine/menuSounds.ts`) and `audioEngine.playEvent` applies a 70 ms per-event cooldown against held-key spam.
  - `MenuList`: cursor on move (keyboard, and mouse *movement* only, so a resting pointer can't steal selection); confirm/open/start per item; cancel on back; page on PageUp/PageDown.
  - Settings play confirm or cancel. Leaving a conversation plays cancel.
  - Sounds are fetched at startup and decoded on the first gesture, so no `AudioContext` is created before user interaction.
  - `menu_save` is mapped but there is no save feature yet; it's testable from the dev panel.
  - Menu volume is fixed at 0.5; there is no UI volume setting yet.
- **Rationale:** components never name sound files, and remapping is a data change.

## D-029 — Lightweight engine tests with Node's built-in runner
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:** `npm test` runs `node --test tests/*.test.ts` (Node 24 strips TypeScript natively; no new dependencies). It covers emotion resolution and fallbacks against the real manifest, reaction one-shot/settle, typewriter states (`typewriterStateOf`), punctuation pauses, blip character rules, canvas/offset presence, and that every menu event maps to an existing sound.
- **Rationale:** cheap regression coverage of pure engine logic without adding a framework.

## D-030 — Per-frame timing for natural idle blinks
- **Status:** Accepted
- **Date:** 2026-10-24
- **Context:** Every Maya idle clip is one blink: eyes open → half → closed → half. Played as a loop at 6 fps, she blinked every 0.67 s, which the owner found too fast and unnatural.
- **Decision:**
  - Clips may define `frameDurations` (ms per frame, parallel to `frames`; overrides fps) and `holdJitterMs` (random extra 0..N ms on the first frame of each loop). The validator checks both.
  - `frameDurationMs()` in `useClipPlayback.ts` is the single timing rule; it's pure and unit-tested.
  - All 12 Maya idle clips: `[2600, 70, 90, 70]` + `holdJitterMs: 1800`, i.e. eyes open for 2.6–4.4 s, then a ~230 ms blink. Talking clips keep fps timing.
- **Rationale:** DS-like blinking at irregular intervals, defined in data, with no character-specific code.

## D-031 — Original DS panels as menu backgrounds
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Five 256×192 panels from the TSP184 "Backgrounds – Miscellaneous" sheet are registered in `ui.json`. A generic `StageBackdrop` draws a panel at (0, 0) behind the existing menu UI.
  - Assignments: main menu → `title-screen-discussion`; character select → `talk-option` (the game's "who to talk to" screen); settings → `bottom-screen` (touch-screen panel); location select keeps its live preview of the highlighted location; `top-screen` and `cross-examination-start` stay unused.
  - The former blue CSS gradients (`.title-screen`, `.menu-screen`) remain only as a `-plain` fallback when a panel is missing. A translucent dark gradient over the panels keeps headings and hints readable.
  - "Press start" is now a session flag held by `App`, not inferred from the audio-unlock state, so returning to the title always shows the menu.
- **Rationale:** an authentic DS look from original assets, with labels kept as live UI and no rewrite of navigation.

## D-032 — Overflow-aware label marquee in DS menus
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Menu buttons keep their fixed DS width. Labels render in a clipped viewport (`.marquee`, ellipsis at rest).
  - `useOverflowMarquee` measures `scrollWidth − clientWidth` (re-measured on resize, font load and activation). Only when that is > 0 and the label is active does it step the viewport's `scrollLeft` in **whole stage pixels**: constant 28 px/s (longer labels take proportionally longer), 300 ms start delay, 0.9 s end pause, reset, 0.6 s pause, loop. Only the text moves; the button never changes.
  - **Active:**
    - with keyboard input, the selected item;
    - with the mouse, only the item under the pointer (leaving resets it immediately);
    - on touch, the selected item.
  - **Reduced motion:** no animation; after the delay the end of the label is shown in one step.
  - Overflowing labels always carry `title` = full text, and the full text stays in the DOM.
  - Applied once in `MenuList` (main menu, character select, location select and any future list). Dialogue text is unaffected.
- **Rationale:** keeps DS proportions while making every label readable without blur (no fractional transforms).

## D-033 — Provider-agnostic LLM gateway with a strict multi-beat CharacterReply
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes/extends:** D-006 (principle kept; the concrete schema is now defined), D-007 (backend now in scope).
- **Decision:**
  - The Python FastAPI backend lives in `backend/app/`.
  - Vendor code exists only in provider adapters (`app/llm/providers/`), implementing `LLMProvider.generate(GenerationRequest) -> RawCompletion`.
  - `LLMGateway` selects the adapter from a registry using `ProviderConfig` (type / base_url / model / `api_key_env` / settings), applies a timeout, isolates exceptions, then runs one shared parse/validate/repair step (`repair.py`) into `CharacterReply` (1–8 beats: text, emotion, intensity 0–1, optional reaction, optional gesture; optional settleEmotion).
  - Only `FakeProvider` (deterministic, offline, with test triggers) is implemented.
  - Secrets are referenced by env-var name, resolved server-side as `SecretStr`, and never returned or logged; `.env*` is git-ignored.
- **Rationale:**
  - Users can bring any model without touching the service, director, frontend or character packs.
  - Validation is identical for every provider, whatever its structured-output capability.

## D-034 — Character Director between the model and the presentation engine
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - A deterministic `CharacterDirector` turns `CharacterReply` into a logical `PerformanceTimeline`: segments of text, emotion, animation ID, intensity, reaction, gesture and estimated duration, plus a settle pose and notes.
  - Inputs come only from character data: `character.json` plus a new optional `performance.json` (director settings scaled by expressiveness, gestures with compatible emotions, intensity variants, aliases, error line) and `personality.md` (prompt only). The director contains no character names.
  - Rules: fallbacks for unknown IDs; gesture compatibility; intensity variants; merging redundant beats; minimum pose hold; reaction threshold, per-reply cap and cross-reply cooldown; settle resolution; the error line when there's no usable reply.
  - The frontend plays segments as `DialogueLine`s with `animation`/`reaction` overrides through the **existing** resolver, reaction gate, typewriter and blips (`resolveClip(..., override)`), paginating long text to the 3-line box.
- **Rationale:** the LLM expresses intent, while the character's data decides a valid, natural performance. The renderer stays unaware of models.

## D-035 — Vite proxy for the API; chat UX outside the pixel stage
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - The Vite dev/preview server proxies `/api` to the backend (`COURTROOM_API_URL`, default `http://127.0.0.1:8000`), so there's no CORS and no backend URL in the bundle.
  - The chat input is a plain HTML form under the scene (pixel font at 2× grid). Its phases are input → waiting → performing → settle.
  - The conversation's keyboard handler ignores form controls.
  - The scripted test conversation remains available from the dev panel.
- **Rationale:** a minimal, reliable prototype UX that keeps the DS stage itself free of web-form chrome.

## D-036 — Measured, natural dialogue pagination (beat ≠ page)
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the first paginator in `performance.ts` (fixed 84-character pages, ASCII sentence/space search, browser-side wrapping).
- **Decision:**
  - `paginate`/`wrapLines` (same module, improved in place) measure every line in logical stage px with the real stage font (canvas measurer built from the CSS-applied font after it loads). They use the shared dialogue geometry in `engine/dialogueLayout.ts`, which `DialogueBox` also applies: 242px width, 3 × 15px lines, last line reduced by 8px for the continue arrow, 1px safety.
  - Pages carry explicit line breaks.
  - Break preference: sentence (`Intl.Segmenter`) → clause → comma (with rhythm thresholds) → word (no small orphans) → grapheme.
  - Locale handling: no-break spaces, no line-initial closing punctuation, CJK grapheme breaks.
  - Reactions only on a segment's first page.
- **Rationale:** text must physically fit the DS box at every display scale, and page breaks should read like an Ace Attorney conversation rather than a character counter.

## D-037 — Igiari is the primary stage/UI font; Kanji uses a temporary system fallback
- **Status:** Partially superseded by D-038 for the Kanji fallback; the Igiari choice remains accepted
- **Date:** 2026-10-24
- **Supersedes:** D-023's choice of the David Fens "Ace Attorney" font. D-023's native-grid and manifest-driven metric principles remain in force.
- **Decision:**
  - The unmodified `docs/references/igiari/Igiari.woff2` is copied byte-for-byte to `frontend/public/assets/ui/fonts/Igiari.woff2` and registered as `fonts.dialogue` in `ui.json`.
  - The single stage/UI font configuration is `family: Igiari`, `pixelSize: 16`, `letterSpacing: 0`, `wordSpacing: 0`; it continues to flow through the existing `--stage-font*` variables.
  - Igiari supplies Latin, kana and Japanese punctuation but no Kanji. The temporary fallback chain is `Yu Gothic`, `YuGothic`, `Meiryo`, `Noto Sans JP`, `Noto Sans CJK JP`, then the existing general UI fallbacks. This provides readable Kanji but is not presented as authentic Ace Attorney Japanese typography.
  - The complete original distribution (readme, licence and all supplied formats) stays unmodified under `docs/references/igiari/`. The former runtime `ace_attorney.ttf` is removed; its byte-identical source remains at `docs/references/Ace-Attorney.ttf`.
  - Measured pagination remains unchanged: the loaded effective CSS stack is read after `document.fonts`, measured with canvas, and paired with the shared three-line geometry. The fixed-grid fallback uses conservative 16px Igiari bounds (18px non-space, 8px space).
  - The existing 15px dialogue line height remains: browser measurements found a maximum 15px ink height and no clipping, overlap, overflow or hidden fourth line in the required Latin/kana/Kanji samples.
- **Rationale:** Igiari has broader relevant glyph coverage (including `-`, `…`, accented Latin and kana), ships in an efficient WOFF2 format, and can replace the stage font without redesigning the manifest loader or paginator. Explicitly documenting the Kanji limitation avoids overstating authenticity.

## D-038 — DotGothic16 is the bundled deterministic Kanji fallback
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** D-037's temporary system-first Kanji fallback only. Igiari remains the primary font and D-036's paginator architecture is unchanged.
- **Decision:**
  - Preserve the supplied source unchanged at `docs/references/dotgothic16/DotGothic16-Regular.ttf` and copy it byte-for-byte to `frontend/public/assets/ui/fonts/DotGothic16-Regular.ttf`.
  - Declare DotGothic16 as `fonts.dialogue.fallbacks[0]` in `ui.json`. The existing loader loads Igiari and every bundled fallback together through `FontFace`; only after all loads resolve are the faces registered and the single `--stage-font*` configuration applied.
  - The effective stack is `Igiari`, `DotGothic16`, then `Yu Gothic`, `YuGothic`, `Meiryo`, `Noto Sans JP`, `Noto Sans CJK JP`, Verdana, `Segoe UI`, `system-ui`, sans-serif. System Japanese fonts are tertiary emergency fallbacks, not the primary Kanji path.
  - The existing canvas paginator reads and measures that exact computed stack. There is no second paginator, character-count path or Kanji width special case; the shared 256×192 geometry and three-line limit remain unchanged.
  - Keep the 16px stage size and 15px shared dialogue line height: browser stress checks showed clean baseline alignment, three visible lines, no clipping or overlap, and scale-independent pagination.
  - DotGothic16 is a deterministic, visually compatible fallback, not a claim about the original Ace Attorney Kanji font.
- **Metadata basis:** the supplied TTF embeds family `DotGothic16`, Regular/Normal style, version 1.101, copyright 2020 The DotGothic16 Project Authors, and SIL Open Font License 1.1. No separate local readme/licence was supplied, so no additional provenance is asserted.
- **Rationale:** bundling the first Kanji fallback makes rendering and canvas pagination deterministic across machines while retaining system fonts as a safety net.
