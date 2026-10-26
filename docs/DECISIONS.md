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

## D-039 — Ollama is the first real provider; selection is per request
- **Status:** Partially superseded by D-041 for provider selection/persistence; the Ollama adapter and shared pipeline remain accepted
- **Date:** 2026-10-24
- **Extends:** D-033. The provider contract, shared repair, CharacterService, CharacterDirector and paginator remain authoritative.
- **Decision:**
  - `OllamaProvider` is one thin native-HTTP adapter registered as `ollama`; Qwen, Gemma, Llama, Mistral and other installed names are models selected inside it, never separate providers.
  - Generation uses `POST /api/chat` with the configured model, shared messages, `stream: false`, `think: false`, generic options and the exact existing per-character JSON Schema in `format`. Only final `message.content` enters shared repair; thinking is discarded.
  - Discovery uses `GET /api/tags` through `GET /api/providers/ollama/models`. Test Connection uses a separate backend route and the same prompt/schema/gateway validation but never CharacterService session history.
  - The Settings screen persists provider, Ollama server and selected model. `/api/chat` accepts that explicit user selection and constructs a gateway for the turn while reusing the one service/history/director pipeline. Model output can never alter provider configuration.
  - Default Ollama URL is `http://localhost:11434`; trailing slashes are normalized. No API key exists for local Ollama. Browser code never contacts Ollama directly and backend responses never expose the configured base URL.
  - Ollama supports streaming, but application streaming remains disabled and the adapter always requests `stream: false`. Any future streaming API must extend the generic provider contract rather than add an Ollama-only presentation path.
  - Provider failures never silently switch to FakeProvider. Normal chat takes the existing character error-line path; Settings distinguishes unreachable, reachable/list-loaded, selected-model-missing, generation-failed and generation-succeeded states.
  - Generic generation timeout is 120 seconds for local cold starts; model discovery remains 10 seconds and the frontend waits slightly longer than backend generation.
- **Rationale:** per-request selection supports browser-local settings without global server mutation or duplicated services, while the adapter remains vendor-only transport code and every model receives identical character context and validation.

## D-040 — One generic OpenAI-compatible adapter with backend-only secrets
- **Status:** Partially superseded by D-041 for environment-only credential handling and browser key entry; the generic adapter remains accepted
- **Date:** 2026-10-24
- **Extends:** D-033 and D-039. The gateway, shared repair, CharacterService, CharacterDirector and paginator remain authoritative.
- **Decision:**
  - `OpenAICompatibleProvider` is one thin Chat Completions adapter registered as `openai_compatible`. Gemini, OpenAI, Qwen/DashScope, Kimi/Moonshot, LM Studio, vLLM, OpenRouter and future compatible endpoints are configurations, not provider subclasses.
  - Generation uses `POST {baseUrl}/chat/completions` with shared system/history messages, configured model, `stream: false`, generic temperature/token settings, and the exact existing per-character schema in `response_format.json_schema` with strict mode. Only `choices[0].message.content` enters shared repair.
  - The adapter does not retry without native structured output. Rejection is a typed safe failure; a later compatibility fallback must remain generic and keep the same shared schema/validation pipeline.
  - API keys are resolved server-side as `SecretStr`. `COURTROOM_LLM_API_KEY` is the default secret variable; `COURTROOM_LLM_API_KEY_ENV` may name another backend variable. Keys are never accepted from the browser, persisted in `localStorage`, logged or returned. Settings receives only a configured/not-configured boolean.
  - The history-free Test Connection distinguishes invalid URL, missing/auth-failed secret, rate limiting, model/request rejection, structured-output failure, timeout/unreachable endpoint, generic generation failure and success.
  - The editable Settings defaults are the requested Gemini configuration (`https://generativelanguage.googleapis.com/v1beta/openai/`, `gemini-3.8-flash`), but neither adapter logic nor character prompts special-case Gemini or Maya.
- **Rationale:** a single standards-shaped adapter supports multiple hosted services while keeping secrets and transport differences behind the existing provider boundary.

## D-041 — Backend provider profiles and a generic OS CredentialStore
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** D-039's per-request browser provider selection and D-040's environment-only secret UX. Gateway semantics, adapters, shared repair, CharacterService, CharacterReply, CharacterDirector, pagination and presentation remain authoritative.
- **Decision:**
  - A ProviderProfile holds a generated ID, name, provider type, validated URL/model, optional environment reference, generic generation settings and a backend-owned credential reference. It never contains a secret value.
  - One server-authoritative active profile is persisted with metadata at ignored `backend/.local/provider-profiles.json` (`COURTROOM_CONFIG_DIR` override). Safe writes use temporary files, fsync and atomic replace. One local backend process owns this file; thread mutations are locked.
  - CredentialStore exposes get/set/delete/exists. Python keyring maps it to native Windows Credential Manager, macOS Keychain or Linux Secret Service/KWallet; insecure/plaintext file backends are rejected. OS-specific code stays inside this adapter.
  - Resolve OS profile credential, then a configured environment variable, then missing. A transient private SecretStr is bound to the existing ProviderConfig; adapters retain their current interface. Environment-only deployments can seed a new profile directory from COURTROOM_LLM_*.
  - A local configuration API exposes CRUD, activation, duplication, credential set/replace/delete/status, model discovery and history-free Test Connection. Credential GET returns status only. Responses are not cached; validation errors never echo submitted values. Remote/cross-origin configuration access is rejected; Vite's local same-origin proxy is supported.
  - Settings uses a compact scrollable profile form. Password entry is transient, sent once to the backend, and cleared after save/cancel/switch. No secret or active-profile configuration is persisted in browser storage. Complete legacy endpoint/model metadata is imported once; incomplete migration snapshots are retained for recovery.
  - Duplicate profiles have independent credential references and copies made only inside the backend. Deletion removes the profile's OS entry; at least one profile must remain. Removing an OS key does not remove a separately configured environment fallback.
  - Adding Anthropic later requires its adapter/registry entry and profile type/credential-using type/form fields; it reuses the same credential mechanism. No Anthropic implementation is included here.
- **Rationale:** users can save several local/cloud configurations and switch or replace credentials without PowerShell edits or a backend restart, while retaining deterministic profile metadata, backend secret ownership and the existing conversation pipeline.

## D-042 — Native Anthropic Messages provider through the existing profile pipeline
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-033 and D-041. Provider/profile semantics, CredentialStore/security, shared reply repair, CharacterService, director and paginator remain authoritative.
- **Decision:**
  - Register one `AnthropicProvider` for native `POST https://api.anthropic.com/v1/messages`. Claude model names stay editable configuration. The adapter receives the selected model/resolved SecretStr and contains only HTTP translation, schema-dialect translation, final-content extraction and sanitized provider errors.
  - Pin native API version `2026-10-21` and use its documented Bearer authentication. Send the unchanged system character prompt separately from shared user/assistant history, `stream: false`, max_tokens and the existing timeout. This version removed sampling controls, so generic temperature is retained in profiles but is not sent to Anthropic.
  - Use GA native JSON output through `output_config.format`. The existing `reply_schema(character)` remains the sole contract. A mechanical copy projection moves unsupported numeric/length bounds into descriptions, following the native SDK transformation documented by Anthropic; no CharacterReply fields are redefined. The full original schema remains in the common prompt and bounds remain enforced by shared validation/director logic. Native rejection fails safely without a schema/provider fallback.
  - Extract only completed text blocks. Drop thinking/redacted-thinking/signatures entirely; reject refusals, truncated or intermediate/tool responses rather than showing them as character dialogue. Token counts and stop reason may remain separate metadata.
  - Extend profile types/credential-using types and the compact editor. Anthropic requires a model, uses the same OS credential reference/environment fallback, and has no editable base URL. Existing profile credential actions, activation and history-free Test Connection work without another endpoint/storage mechanism.
- **Evidence:** Anthropic's [native structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) describes the JSON Schema subset/projection; the [2026-10-21 migration guide](https://platform.claude.com/docs/en/api/migration-2026-10-21) documents the removed sampling parameters and current auth header. Mocked transport/profile tests and a real Windows-vault browser flow verify the integration; live Claude generation requires a configured real profile credential.
- **Rationale:** native Anthropic transport fits the existing provider boundary while preserving one character contract, one secret store and the same validated presentation path.

## D-043 — One generic MusicEngine with three sources
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-005 (central audio, separate categories) and D-019 (one AudioContext).
- **Decision:**
  - A single `MusicEngine` owns master BGM volume/mute, fades and source switching.
  - It drives sources through one `MusicSource` contract (`src/music/types.ts`): `original` and `imported` share one Web Audio implementation, and `radio` is the official YouTube player.
  - Requests are serialized. The previous source is fully stopped before the next starts, a switch during loading aborts silently, and the same track is never restarted.
  - Loop regions are canonical in samples, with their sample rate, and converted to seconds only at playback.
  - The engine knows no character, provider, LLM or file name. Which track is a character's or the default's lives only in `soundtrack.json` profiles. LLM output never chooses music, paths or URLs.
  - A future MusicDirector would issue the same logical `play(kind, trackId)` requests.
  - Music volume is independent from blip/SFX volume.
  - The music UI outside the logical stage lives in an App-level Music dock, like the chat bar (D-035).
- **Rationale:** one place guarantees "never two BGM sources" and respects autoplay rules. Sources stay swappable without touching the conversation pipeline.

## D-044 — Built-in loops are curated offline from the OST MP3s; never claimed as DS loop points
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - The 25 non-excluded tracks are byte-identical runtime copies (D-002 applies: ~58 MB).
  - Loop metadata is curated offline and written into `soundtrack.json`; it is not computed at runtime. A loop is accepted only when post-seam musical coverage ≥ 0.70, envelope identity ≥ 0.92 and seam correlation ≥ 0.95 (method in `docs/MUSIC.md`). Provenance is `curated-analysis`, and the note states it is not an original DS loop point and was not verified by listening.
  - 10 tracks passed. The other 15, including the Maya default, keep `loop: null` (play through and restart) until corrected manually.
  - Built-in tracks never get an automatic crossfade.
  - Excluded tracks (01, 12, 21, 25, 26, 27, 28, 31, 34) are listed in the manifest without a runtime file and can never enter the BGM pool. The source files are untouched.
- **Rationale:** these are OST masters, not DS sequence data. Shipping only metric-validated loops, and honestly marking the rest, beats inventing loop points.
- **Open:** whether ~58 MB of MP3 should be committed normally or through Git LFS is the owner's call before committing.

## D-045 — Imported music stored by the local backend; automatic loop analysis in a Web Worker
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Imported files and `library.json` live in the git-ignored `backend/.local/music/`, behind `/api/music/imports`, which reuses the local/same-origin guard of D-041.
  - Uploads are raw streamed bodies, so no python-multipart dependency is needed. The size cap is 64 MB; type is checked by magic bytes, files get server-generated names, and IDs are strict with confined paths. No paths are returned and nothing is executed.
  - Loop detection is lightweight DSP: chroma/band features → lag-similarity runs → sample-level refinement → calibrated confidence. It runs in a Web Worker, with no LLM or ML.
  - A proposal is persisted as `auto-detected`; the user accepts (`user-accepted`) or adjusts (`user-adjusted`). Analysis never re-runs once a loop is stored.
  - A short baked crossfade is an opt-in fallback for imported low-confidence loops only.
- **Rationale:** the backend gives cleaner persistence and security than browser storage for large files. Worker analysis keeps the UI responsive.

## D-046 — Radio uses only the official YouTube IFrame Player, visible outside the DS stage
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - The Radio source is a real, visible 356×200 embedded player in the Music dock, controlled only through the IFrame API (play, pause, volume, state), with no overlays.
  - There is no download, extraction, proxying, scraping or hidden player.
  - The video ID is user configuration. The Lofi Girl preset is data and marked unverified: on 2026-10-24, embedding was refused for `jfKfPfyJRdk` (error 150).
  - Autoplay blocks become a "press Play" state recovered by a real click.
- **Rationale:** compliance with YouTube's embed terms, and preservation of the 256×192 DS layout.

## D-047 — Data-driven Court Record and generic Talk Options
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `assets/court-record/court-record.json` (v1) lists entries `{id, type: evidence|profile, name, description, asset{src,width,height}}` plus ordering. Source-sheet rectangles are recorded only as provenance data, never in components.
  - Icons are exact 64×64 slot-interior crops (frame excluded) from `evidences_profiles_full.png`, drawn at native size with nearest-neighbour scaling.
  - Uncertain identities get neutral IDs/names (`envelope_tied`, `cellphone_blue`); no case lore is invented.
  - `TalkOptions` is a generic list (label/enabled/isNew/order, deterministic sort, disabled skipped) over the existing `menu_talk_option` backdrop. The chosen topic returns to the conversation as an ordinary user message through the existing chat path. Sample topics are dev data and character-neutral.
  - No case logic or evidence correctness yet.
  - Validated by `npm run validate:assets` and pixel-identity tests.
- **Rationale:** adding evidence needs only data + PNG. The LLM never supplies UI assets or paths.

## D-048 — Music finishing: preserve evidence thresholds, update unavailable radio preset
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Keep the built-in loop acceptance thresholds from D-044 unchanged. A slower offline pass may search more phrase/window scales and refine at full sample resolution, but weak candidates stay out of `soundtrack.json`.
  - Add only candidates that pass coverage ≥0.70, envelope identity ≥0.92 and seam correlation ≥0.95. Added metric-validated loops for Cross-Examination Moderato, Maya Fey – Turnabout Sisters 2001, Detention Center, Marvin Grossberg and The Class Trial. No loop is claimed as an original Nintendo DS loop point or verified by listening.
  - The supplied current Lofi Girl candidate `EWrX250Zhko` was tested through the official IFrame API from the app origin and returned error 150. Keep it in preset metadata as unavailable, leave the generic YouTube implementation/configuration intact, and do not work around the refusal. Reset the retired saved preset ID to the current default.
- **Rationale:** finish built-in curation where the existing evidence is strong without treating approximate candidates as source-game data; report the blocked preset honestly.

## D-049 — Data-driven waiting pose, semantic beat SFX and typing blips
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-034 (Character Director) and D-028 (logical sound events). CharacterReply is unchanged.
- **Decision:**
  - The conversation phase is a pure state machine (`engine/presentation.ts` `nextPhase`: submit/response/error/cancel/finished → `input | waiting | performing`). Every request outcome leaves `waiting`, and it is provider-independent.
  - While waiting, the character performs its `character.json` `waiting` block (Maya: `thinking` / `thinking_side`) in idle mode, with no reaction and no talking. The idle loop keeps animating; invalid or missing data falls back to the default emotion. The asset validator checks the block.
  - The director attaches an optional semantic `sfx` to timeline segments, from the closed set `surprise, shock, realization, comic, emphasis, tension, notification, soft_transition`. The rules live in `performance.json` `sfx`:
    - a surviving reaction maps through `reactions`; otherwise `emotions` applies only at ≥ `minIntensity`;
    - suppressed reactions produce no sound;
    - at most one per segment and `maxPerReply` per reply;
    - deterministic, with no filenames and no character names in code.
  - The frontend maps a name to audio.json event `sfx_<name>`. Only a beat's first page carries it, and it plays once per line key, so pagination never replays it. Reaction SFX have their own SFX volume/mute settings.
  - Typing blips: the user's own text input plays audio.json event `user_typing` (→ `blip_male`). This comes only from `insertText` input with a voiced character: no modifiers, navigation, paste, deletions, whitespace or punctuation; silent during IME composition, one blip at commit; ≥ 60 ms gap. Blip volume/mute apply, and the input value is never touched.
- **Rationale:** the presentation reacts like the games without the model naming files, and without one-sound-per-page spam.

## D-050 — Character BGM belongs to the conversation scene
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-043. The engine stays character-independent.
- **Decision:**
  - `useMusicSync(soundtrack, context)` with `context = { scene: 'menu', audition? } | { scene: 'conversation', characterId }`.
  - Menus (title, settings, selection screens, Court Record) are silent unless a `menu` soundtrack profile exists (none yet, so future menu music remains possible) or the user explicitly presses Play in the music dock. That audition lasts until the next screen change.
  - The conversation plays the selected source. For Original, the chosen track wins, else `profiles[characterId]` (`maya_fey`), else `default`.
  - Leaving the scene fades the music out through the engine. Same-track requests are never restarted, and volume/mute are preserved.
- **Rationale:** the character's theme should mark entering the scene, not play over menus.

## D-051 — DotGothic16 fallback scaled with `size-adjust: 75%`
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-038 (DotGothic16 as the deterministic Kanji fallback). The Igiari primary font, 16 px size and 15 px line height are unchanged.
- **Decision:**
  - `ui.json` fallback entries may carry CSS font-metric descriptors (`sizeAdjust`, `ascentOverride`, `descentOverride`, `lineGapOverride`; validated percentages). They are applied when registering the FontFace.
  - DotGothic16 uses `sizeAdjust: "75%"` (12 px effective). Measured from the font tables, at 16 px the median kanji ink height was 15 px against 11 px for Igiari kana (ratio 1.36); at 75% it is about 11.2 px (ratio 1.02).
  - Because the descriptor lives on the same FontFace the paginator's canvas measurer uses, measurement and rendering stay identical. Chrome measured a kanji at 12 px.
  - Trade-off: DotGothic16 is only pixel-crisp at 16 px multiples, so kanji render slightly soft. No crisp size matches Igiari's height.
  - The about 0.9 px lower ink centre of kanji was accepted after visual review; no baseline hack was added.
- **Rationale:** balanced kanji and kana without shrinking the whole font or diverging from the paginator.

## D-052 — Safe generated text artifacts beside the character reply
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Keep CharacterReply unchanged. Derive one shared turn envelope from its existing schema with a separate optional strict `create_text_artifact {filename, format, content}` action. Reuse common dialogue repair, all providers, profile credentials and character context. Invalid actions cannot be repaired into broader operations.
  - CharacterService owns the validated action and completes backing/catalog publication before directing/delivering the one final acknowledgement. Failures use the existing character error line. File content/storage details never enter director input or assistant history.
  - Allow only inert UTF-8 txt/md/py, ≤64 KiB each, ≤200 files and ≤8 MiB backing content including orphan/interrupted files. Use backend-generated IDs, sanitized/unique display names, non-overwriting atomic backing publication and atomic metadata. No shell, subprocess, import/compile/execute, arbitrary paths or general tool dispatcher.
  - Persist metadata and hashed request receipts under ignored local outputs storage. Missing/changed content is unavailable; orphan/temp files remain inert; corrupt metadata is preserved for repair. One local backend worker owns the store.
  - Current chat supplies a requestId and uses local/same-origin task status/cancellation and duplicate coalescing. Cues `artifact_working` / `artifact_ready` are separate from CharacterReply; no ready state is published after failed/cancelled creation. Cancellation before the bounded atomic commit prevents creation; a completed commit remains honestly ready. Legacy chat/Test Connection remain dialogue-only.
  - Use a minimal plain-text Generated files panel outside the DS stage. Full phone/summon/evidence cinematic and final Court Record redesign are milestone 3.
- **Rationale:** explicit small-file creation can fit the existing conversation boundary without giving generated text execution privileges or coupling providers to filesystem/presentation behavior. Full details and limits: `docs/ARTIFACTS.md`.

## D-053 — Shared workload output budgets and distinct truncation failures
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Normal dialogue preserves the configured output budget (default/inspected active Sonnet 5.5 profile: 600 tokens). Explicit artifact work gets a transient 16,384-token cap via shared `OutputWorkload` / gateway budget policy. Raise the shared settings ceiling from 8,192 to 16,384 to admit it; do not change saved profile budgets or automatically select model maximums.
  - CharacterService estimates workload before the single response using advisory explicit-creation hints. The estimate affects budget only; it cannot authorize artifact creation, choose a path, change credentials or bypass action validation. Unknown phrasing stays on the normal budget. Schema capability alone is not evidence of artifact intent.
  - Adapters remain thin: Anthropic/OpenAI-compatible use request max_tokens, Ollama maps it to num_predict, Fake receives the same request settings/workload. No provider has artifact-specific budget logic.
  - Distinguish Anthropic max_tokens (`output_token_limit`), model_context_window_exceeded (`context_window_exceeded`), refusal and end_turn before parsing. Exhaustion never persists partial files or emits artifact_ready, even for parseable returned JSON. No continuation/retry is added. Report bounded workload/budget/stop-reason diagnostics separately from CharacterReply/performance and distinguish the two exhaustion causes in chat and Settings.
- **Evidence:** mocked actual adapter payloads verify 600 → 16,384 → 600; integration tests prove no file/ready state for truncation and one file for larger completed output. Anthropic's [stop-reason documentation](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) distinguishes output cap from context-window exhaustion.
- **Rationale:** small dialogue and file content need different headroom, while the existing artifact contract/storage/security boundary stays authoritative.

## D-054 — Explicit semantic reactions take priority over inferred SFX gates
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the semantic-SFX selection/suppression details of D-049; all other D-049 presentation and typing decisions remain.
- **Decision:**
  - Keep the existing data-driven CharacterDirector and audio-event system. `performance.json` may map explicit semantic reaction values (`shock`, `surprise`, `realization`, `comic`, `emphasis`) separately from visual reaction IDs. The shared reply schema exposes these configured semantic values to every provider.
  - An explicit mapped semantic reaction selects its intended SFX without the emotion fallback threshold or fallback sound cap. Visual one-shots retain their existing intensity threshold, cross-reply cooldown and per-reply cap; an explicit sound still fires with the beat's starting pose if the visual reaction is held back.
  - Emotion-only fallback thresholds are per-character data: Maya uses surprised 0.55, excited 0.60, playful 0.70 and happy 0.70. Ordinary anxious/neutral/calm/thinking emotions are silent unless explicitly mapped.
  - Record per-beat selection/suppression diagnostics in the existing director notes. Development UI adds recent actual audio-event outcomes and manual audition controls; production UI stays unchanged.
  - SFX remains on only the first page of a beat and is guarded by its line key, including React development effect replay. Runtime WAV event names and source mappings are unchanged.
- **Evidence:** deterministic director tests cover explicit sounds, moderate surprise fallback, low anxious silence, cooldown behavior and per-reply caps; frontend tests verify page-one-only playback and RIFF/WAVE mappings for shock, surprise, realization, comic and emphasis.
- **Rationale:** the prior shared path conflated a visual surprised pose with a semantic sound and applied the visual reaction cooldown to audible explicit intent. Explicit intent is already a deliberate model choice; emotion-only fallback remains selective.

## D-055 — Artifact delivery is a frontend presentation over the existing artifact store
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Keep milestone 2 `GeneratedArtifact` storage, IDs, API, receipt, cancellation and provider-independent action authoritative. The Court Record is a derived view and never persists a second copy/catalog.
  - Use one turn-scoped frontend reducer: `idle → artifact-working → waiting-for-phone-acknowledgement → evidence-summon → response-release → idle`, with failed/cancelled terminal presentation states reset by the next turn. Duplicate/stale ready, acknowledgement and timer events do not start another sequence.
  - Reuse Maya's thinking state. `artifact_working` maps to a temporary Thinker visual; the ready artifact maps to a bounded phone notification requiring user acknowledgement. The summon displays the existing native file icon, safe display name, and deterministic copy.
  - Buffer the final response already returned by the one chat request; after summon release it through the existing performance/timeline and paginator. No model call is made for notification text or after acknowledgement.
  - Add semantic `phone_ring`, `phone_answer`, `evidence_reveal`, `evidence_added` events in `audio.json`; reuse the existing brief phone beep for ring and distinct one-shots for answer/reveal/add. Later Court Record visits do not replay delivery effects.
  - Generated-file Court Record has six fixed 64×64 slots per 3×2 page, stable createdAt/ID order, selection, pagination, and an inspector using existing read/download/delete endpoints. Thinker, phone and static/demo evidence are not generated files. The old Generated files panel stays dev-only.
  - A reload or navigation interruption does not replay the entire cinematic. Persisted artifacts remain listed; task cancellation uses existing milestone 2 behavior and never deletes a committed artifact.
- **Evidence:** frontend reducer and Court Record tests plus an isolated FakeProvider browser run completed artifact creation → phone → acknowledgement → summon → one buffered reply, then read/download inspection by opaque ID. Logical 256×192 stage was inspected at 1×, 3×, 4× and auto. No second `/api/chat` request was made by presentation.
- **Rationale:** theatrics are presentation state, while generated data and safe persistence remain provider-independent and durable.

## D-056 — Maya's recurring quirks stay occasional and context-led
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Keep Maya's fondness for burgers/food and other traits in `personality.md`, but describe them as occasional interests rather than catchphrases.
  - Prioritize the user's current topic and Maya's relevant emotional response. Encourage variation across food, spirit medium, Phoenix/Nick, mystery and supernatural references, with recent dialogue context informing repetition.
  - Do not implement keyword censoring, trait counters or provider-specific prompt logic.
- **Evidence:** an isolated eight-turn deterministic FakeProvider conversation showed playful fixture variety and no burger lines. This verifies the follow-up test run only; FakeProvider does not assess whether a real LLM obeys personality guidance.
- **Rationale:** retain character identity without reducing Maya to a rotating reference gag.

## D-057 — Character task acknowledgements and scoped phone ringing/mix control
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** D-055's short notification-beep phone policy. Artifact persistence, response buffering and Court Record view architecture are preserved.
- **Decision:**
  - Expose the service's existing advisory `expectedWorkload` in turn status before the single provider call. It permits presentation acknowledgement, never action authorization. Only validated artifact data still creates files or emits ready.
  - Put local task acknowledgement copy/locale variants and pose in the character pack. Reuse the existing measured dialogue/typewriter path, rotate short variants and preserve Maya's anti-caricature guidance. The current document locale is used; there is no new language detector. No acknowledgement model request or conversation-history turn is added.
  - Extend the existing delivery reducer with `task-acknowledgement` and a minimum 350 ms working gate. A fast final result waits for acknowledgement completion (500 ms after typing) and the working gate before phone; failures finish the line then release the original error response. Cancellation ends presentation promptly.
  - `phone_ring_loop` uses the supplied MP3 identified by embedded title **Ringtone (Phoenix Wright)**. Its audio bytes stay unchanged; a measured manifest region loops natively until answer or cleanup. Audio event leases share one source and reject late pending-decode work after release. Preserve the existing phone-answer/cut event.
  - A scoped MusicEngine attenuation lease multiplies current BGM by 0.12, with 220 ms attack / 350 ms restore. A separate Web Audio gain preserves master/mute and track fades; radio uses bounded official-player volume ramps. Release restores current settings, not saved old values, and never restarts a track.
  - Court Record browsing uses existing cursor/confirm/cancel/page menu sounds with a 140 ms movement-sound cadence. Delivery sounds never play during ordinary browsing. Dev builds expose a 45-second ringtone audition with Stop and cleanup.
- **Evidence:** deterministic loop ownership/cleanup, duck preservation/ramp, acknowledgement order/failure, workload single-call and Court Record-feedback tests. An isolated Chrome/FakeProvider run held one native ringtone source across a loop, measured 0.80 → 0.096 → 0.80 BGM gain, and stopped the ringtone on answer without a track restart. Acoustic listening was unavailable.
- **Rationale:** acknowledgement, delivery timing and temporary mix changes belong in generic presentation/audio layers while the existing artifact, provider and conversation contracts stay authoritative.

## D-058 — Persistent Conversation Record, separate from LLM context
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - The backend keeps a user-facing archive of completed turns at `<COURTROOM_CONVERSATION_RECORD_DIR | COURTROOM_CONFIG_DIR | backend/.local>/conversation-record/records.json` (git-ignored). The document is versioned and written atomically under a lock, with opaque 32-hex IDs.
  - Public entry: `{ id, characterId, createdAt, userText, assistantText, artifactIds }`. `assistantText` is the directed, visible reply. Hidden reasoning, prompts, raw provider payloads, file content, credentials and paths are never stored.
  - Caps: 5,000 entries (oldest pruned deterministically), user text 2,000 characters, reply 20,000, at most 8 artifact IDs. A corrupt file is preserved as `records.corrupt-*.json`, and the store starts empty.
  - Capture happens once, server-side, in the chat route after `service.chat` succeeds, inside the shielded `TurnRegistry` job. A hashed requestId receipt makes replays idempotent. Failures, cancellations, Test Connection, acknowledgements, phone/summon cues, beats and pages create nothing.
  - Routes: `GET/DELETE /api/conversation-record[/{id}]`, plus clear-all requiring `{confirm: true}`. All are behind the local/same-origin guard with `no-store`. The list is ordered newest first.
  - The archive is never sent to a provider. LLM history keeps its own in-memory window (D-059).
  - The frontend `ConversationRecordView` is an in-stage DS screen and overlay. It shows one framed portrait slot per turn (`character.json` `courtRecordPortrait`, looked up per character id) and a detail view with YOU / character / FILES on the 15 px line grid. Artifacts open through the existing safe read/download API, and a deleted file shows "File no longer available". It uses ordinary menu sounds only.
- **Rationale:** users can revisit exchanges and linked files without growing or changing the model's context.

## D-059 — Dialogue output floor, normalized truncation taxonomy and history context budget
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** D-053's "normal dialogue preserves the configured budget (600)". The rest of D-053 remains.
- **Root causes of the reported "600 token overflow":**
  - The 600-token normal budget was too small for structured multi-beat replies, which reach about 2.7k tokens in worst-case Japanese.
  - Reasoning models spend hidden tokens from the same cap.
  - OpenAI-compatible (`finish_reason: length`) and Ollama (`done_reason: length`) truncation was not detected, so cut-off JSON could be shown as plain dialogue.
- **Decision:**
  - Dialogue requests use `max(profile max_tokens, 4096)` (`DIALOGUE_MIN_OUTPUT_TOKENS`). Artifacts keep 16,384 tokens, which covers about 48 KiB of dense code and about 64 KiB of prose and stays within common OpenAI-compatible output limits. A completed file over 64 KiB is `artifact_too_large`. Saved profiles are not rewritten and no model maximum is looked up.
  - Stop reasons are normalized across providers. Any `max_tokens` or `model_context_window_exceeded` result is rejected by the gateway before parsing, even when the body is valid JSON.
  - `generation.failureClass` groups public codes (`output_truncated`, `context_window_exceeded`, `artifact_too_large`, `provider_limit`, `unknown_provider_error`); existing public codes are unchanged. Chat shows specific messages, such as "The model reached its output limit (N tokens) before finishing the file. Incomplete output was discarded. No partial file was saved."
  - Ollama reports `length` for both output and context exhaustion; `eval_count` below the budget is classified as context.
  - LLM history is fitted at request time (`characters/context.py`): script-aware cost, 8,000 per entry (clipped with a marker), 16,000 in total, oldest whole messages dropped first, always starting with a user message. Nothing is summarized, and the Conversation Record is never included.
- **Evidence:** 27 backend taxonomy tests covering three providers × dialogue/artifact × truncation/context: no file, no ready cue, no artifact, history unchanged. Browser runs with a scratch provider stub reproduced both failures through the real chat API and UI.

## D-060 — Native evidence frame primitive and collapsible secondary panels
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `ui/court-record/evidence_frame.png` is the native 70×70 evidence-tile border, with exact source pixels and a transparent 64×64 window. It is registered as `ui.json` `evidence_frame`.
  - One `EvidenceTile` primitive draws it at native size, puts 64×64 content in the window, and shows selection outside the frame.
  - It is used by the generated-file Court Record (3×2 grid of 70 px tiles), the artifact summon (native-size file icon; state machine unchanged) and the Conversation Record. The static demo evidence view keeps its existing 64 px layout.
  - `CollapsiblePanel` (`id`, `title`, persisted in settings `expandedPanels`, accessible button header, collapsed bodies unmounted or `hidden` + `inert`) groups out-of-stage panels: Generated files (dev), Dialogue dev tools, Music / Radio, and Imported library / loop editor.
  - All panels start collapsed. The radio panel is forced open while the radio plays or loads, so the official YouTube player is always visible when it produces sound.
- **Rationale:** a DS-faithful look with native pixels, and a tidy page that prioritizes the stage.

## D-061 — Data-driven phone ringtone presets
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-057. Phone flow, single-source lease, ducking and cleanup are unchanged.
- **Decision:**
  - `audio.json` `ringtones: { default: "phoenix", items: { phoenix, wellington, godot } }`. Each item names a sound with a native loop region.
  - Sources are byte-identical Sound BOX ringtone MP3s identified by embedded ID3 tags (Ringtone (Phoenix Wright) 2-11, Ringtone (Richard Wellington) 2-02, Ringtone (Godot) 3-34).
  - Settings stores `ringtoneId`. Unknown or empty ids fall back to the default. The phone reads the selection at ring time, so no restart is needed. Selection happens in `acquireRingtone`, with no UI branches.
  - Settings provides Ringtone + Preview + Stop. Preview uses the same shared loop lease, does not duck BGM, stops after 20 s, and stops on selection change or when Settings unmounts.
  - Lazily loaded ringtone events are not preloaded at startup.
  - The validator checks that the default exists and that items reference real sounds.
- **Evidence:** ringtone tests, plus a Chrome run in which Godot was selected and the real artifact phone flow played the Godot loop (2.000–38.001 s) as one source with BGM ducked to 0.12. Answering stopped it and restored 1.0 without a track restart. Loops were measured offline and not auditioned.

## D-062 — Stage scaling choice, native dropdown lists, length-aware typing speed
- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** D-017 (integer scaling is now one of two modes, no longer the only one). The 256×192 logical layout, `image-rendering: pixelated` and pagination are unchanged.
- **Decision:**
  - Settings → Scale: `Pixel` (largest whole factor, the old behaviour) or `Fit` (largest fractional factor that fits, frame width snapped to whole CSS pixels). Stored as `stageScaling`; default `fit`. The dev panel's fixed 1×–4× overrides still win over both.
  - Native `<select>` lists inside the stage are drawn by the browser in screen pixels, outside the stage transform, so they rendered with the logical stage font. `option`/`optgroup` inside `.scene-stage` now use the system UI font at 14 px. The closed control keeps the stage look.
  - Typing speed per reply = Settings speed × `lengthSpeedFactor(total reply characters)`: 1 up to 120 characters, then √(chars / 120), capped at 2. Every page of one reply uses the same pace.
  - A music fetch that returns `text/html` (the dev server's SPA fallback for an absent file) is reported as `missing_file` instead of `decode_failed`.
- **Rationale:** the owner asked for a larger, scalable stage that stays faithful to the DS composition, readable dropdown lists, and dialogue pacing that follows reply length. `Pixel` remains available for the sharpest pixel art: in `Fit` the sprite pixels are slightly uneven in width.

## D-063 — DS stage picker replaces native selects; themed conversation actions
- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** the native-dropdown bullet of D-062 (system font on `option`).
- **Decision:**
  - Every `<select>` inside the stage (Settings: music source, soundtrack track, imported track, ringtone; AI profiles: profile, provider type, model) is a `StageSelect`. The closed control is a DS-framed button with the value (ellipsis) and a downward triangle. Opening it portals a panel into `.scene-stage`: dimmed stage, name-plate heading, and a `MenuList` with the same frames, keyboard, sounds and label marquee as the menus.
  - Escape/Backspace/X close only the panel (window capture-phase listener), so Settings' Escape-to-back does not fire. A 400 ms guard stops Space's keyup from reopening the panel after a Space selection.
  - The soundtrack list is flattened: Default, then background tracks, then event tracks (the "Background music"/"Event music" group headings are gone).
  - Talk / Court Record / Record use the chat bar's DS frame and 2× stage font; hover/focus uses the selected-menu-entry colours.
  - Still CSS stand-ins: no original DS button or list graphics are in the repository. The Spriters Resource pages are behind a bot check and could not be fetched automatically.
- **Rationale:** the owner asked for the dropdowns and the conversation buttons to match the other DS assets. A native popup cannot be themed and is drawn outside the scaled stage.

## D-064 — Dick Gumshoe and Mia Fey character packs
- **Status:** Accepted
- **Date:** 2026-10-24
- **Extends:** D-027 (extraction method), D-022 (canvas/offsets), D-048/D-049 (director, waiting pose, semantic SFX). No engine code is character-specific; both packs are data only.
- **Sources:** `docs/references/dick gumshoe.png` (1336×2310, 43 colours) and `docs/references/mia fey.png` (1068×3273, 36 colours), owner-supplied DS sheets, both "Ripped by Shoda. Credit appreciated". Same background (181,165,213) as Maya's sheet.
- **Extraction (D-027 method):** 8-connected components of non-background pixels, exact bounding-box crop, background and neighbouring sprites transparent, no other pixel change. Frames named `<prefix>_frame_NNN` in sheet reading order. Gumshoe: all 82 sprites (11 rows). Mia: rows 1–8 only (59 sprites, y < 1645); rows 9–16 show Mia channelled through Maya's body and are not used.
- **Grouping:** idle = columns 1–4, talking = columns 5–8, per the ripper's "x Talk" brackets; idle clips use Maya's blink timing (2600/70/90/70 ms, 1800 ms jitter).
  - Gumshoe: `neutral_front` (idle 1–4, talk 7–14), `worried`, `happy_grin`, `thinking_aside` (row 5 idle + row 6 talk), `confused` (idle 36/35/37/35, uncertain blink order; talk 42–45), `fired_up`, `sad_down`, `side_profile`, `laughing` (75–76 ×3, 77–78 ×3 per sheet; talk 79–82); reaction `head_scratch` (54, 55, 56–57 ×3 per sheet, 58). Frames 5–6 (row 1 "x2") are unassigned. The sheet has no shocked pose, so `surprised` maps to `confused` without a reaction.
  - Mia: `arms_crossed`, `hand_on_chin`, `confident_smile`, `amused_laugh` (row 4 has no talk frames; it talks with the row-3 frames of the same tilted pose), `turn_aside`, `serious_front`, `surprised`, `sad_worried`. No reaction one-shots.
- **Placement:** each pose's frames are registered against its first frame by the best horizontal shift of the lower-body silhouette (bottom 40 %, bottoms aligned); the canvas is the union. Results are 0–3 px except the head scratch, whose raised-arm frames place the body at x=58. Its canvas is widened to 271 px so the body is centred, as in Maya's shocked reaction, avoiding a jump into and out of the reaction.
- **Data per character** (same schema as Maya): the 13 shared emotions (so providers and the fake provider stay compatible) plus Gumshoe `embarrassed` (head scratch + worried), `determined`, `suspicious` and Mia `serious`, `determined`; own gestures, intensity variants, aliases, SFX thresholds, waiting pose, error line, EN/FR/JA artifact acknowledgements, voice (Gumshoe `blip_male`, Mia `blip_female`) and `personality.md`. Director: Gumshoe expressiveness 0.95 (quick pose changes, lower reaction threshold), Mia 0.5 (longer holds, fewer sounds).
- **Music profiles:** `dick_gumshoe` → track 16 (his theme); `mia_fey` → "Turnabout Sisters 2001" (the Fey sisters' theme). An explicit track chosen in Settings still overrides profiles.
- **Portraits:** stand-ins, 64×64 crops of each character's first neutral frame on Maya's portrait grey (120,120,120). The official profile sheet (`docs/references/court-record/evidences_profiles_full.png`) is not on this machine; replace them with its 1:1 tiles when available.
- **Also:** `MenuList` gained `rowHeight`; the character select shows 2 entries of 48 px (40 px preview) and scrolls, instead of clipping at 4 × 19 px.

## D-065 — "Present evidence": user files analysed by the character (v1)
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - `POST /api/chat` accepts an optional `evidence: {name, data}` (base64). `message` may then be empty; without evidence an empty message is still rejected.
  - The server decides the kind from the bytes, never from the name or MIME type (`backend/app/llm/attachments.py`): PNG/JPEG/GIF/WebP by signature (≤ 5 MB), PDF by `%PDF-` (≤ 10 MB), otherwise UTF-8 (BOM allowed) or Windows-1252 text without binary control characters (≤ 100,000 characters / 400 KB). Anything else → HTTP 422 `{code: evidence_invalid | evidence_too_large | evidence_unsupported, message}`. File names are reduced to a printable basename (≤ 120 chars).
  - **Text** is inlined in the user message between `<<<EVIDENCE name` / `EVIDENCE>>>` markers (an end marker inside the file is neutralised), after a header telling the model the content is material to examine, not instructions. Every provider, including Fake and Ollama, can read it.
  - **Images/PDFs** become `ChatMessage.attachments` (excluded from `model_dump()`, so no adapter can forward them unformatted). Anthropic: `image` / `document` blocks. OpenAI-compatible: `image_url` data URL / `file` part. Ollama: `images`; PDFs refused before the call. A 4xx file rejection (Ollama: 400/500) while attachments are present maps to the new code `attachment_unsupported`; the frontend explains which models can read which files. Without attachments, existing error codes are unchanged.
  - History: text evidence stays in history (bounded by the existing `fit_history` clipping) so follow-up questions can refer to it; images/PDFs are sent once, later turns only see a one-line summary. The Conversation Record stores `question` + `[Evidence: name]`. Replays of a request id include the file hash in the fingerprint.
  - Fake provider: acknowledges evidence by name, explicitly without analysing it (offline test mode).
  - Frontend: drop a file on the conversation column or press **Present** (file picker); a chip shows the pending file (thumbnail or type badge, size, remove); the chat field becomes an optional question and the button reads **Present!**. Sending plays `evidence_reveal` (SFX volume/mute) and shows the file in the native evidence frame at the stage's top-left, sliding in, while the character thinks; it leaves when the reply starts. Client-side checks mirror the server limits; pre-send rejections are shown separately from reply errors.
- **Rationale:** the owner asked for a module where a dropped file is analysed by the active model through the character. The Court Record "present" metaphor fits the game; server-side sniffing and explicit per-vendor formatting keep untrusted files from reaching providers in an unexpected shape.
- **Not in v1:** Word/Excel, PDF text extraction for non-Claude providers, several files at once, presenting files from the generated-file Court Record.

## D-066 — Interface languages: English, French, Japanese, Italian, Spanish
- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision:**
  - Settings → Language (`language`: en/fr/ja/it/es), default = first supported browser language, else English. It sets `<html lang>`, which the dialogue paginator (Intl.Segmenter) and task acknowledgements already use.
  - `frontend/src/i18n/`: `strings.ts` (English reference + 4 translations), `i18n.ts` (`translate`, `localizedName`, `detectLanguage`), `useT.ts`. A test requires every language to define every key with identical `{placeholders}`.
  - Translated: title and main menu, character/location select, Settings labels, music dock, conversation buttons/placeholders/errors, evidence UI and messages, model-failure messages (`generationFailureMessage(…, language)`), artifact delivery, Conversation Record, generated-file Court Record, the sample Talk topics. Not translated: developer panels, the AI-profile configuration block, background descriptions, OST track titles.
  - Character names: optional `names` in character.json (frontend loader and backend profile). Maya 綾里真宵, Mia 綾里千尋, Gumshoe 糸鋸圭介 (ja) and Dick Tektiv (fr, his French localization name); Italian and Spanish keep the English names (no localized names are recorded for those languages).
  - `POST /api/chat` takes `language` (default en). The system prompt gains a `## Language` section: always reply in that language unless the user explicitly asks otherwise, plus the character's name in that language when it differs.
  - Offline Fake provider: `fake_i18n.py` translates the beat texts of the standard patterns and the evidence acknowledgement (same emotions/reactions/gestures), with a few keywords per language. Error lines: `performance.json` `errorLine.translations`; the director picks them by language. Acknowledgement lines gain it/es for all three characters.
- **Rationale:** the owner asked for the five languages with matching placeholder texts and character names in each language.

## D-067 — Agents and events: inbox, Claude Code companion, character tools
- **Status:** Accepted (implemented 2026-10-25; plan, status and next ideas in `docs/AGENTS_AND_EVENTS.md`)
- **Decision:**
  - Event inbox: `POST /api/events` / `GET /api/events?after&character&language` (local only), in-memory ring buffer (100, 60/min), event types `task_finished`, `needs_attention`, `tests_passed`, `tests_failed`, `build_failed`, `session_started`, `reminder_due`. Lines are character data (`performance.json` `eventLines[type][lang]`, optional `exclamation`), performed through the normal director; no model call. `after=0` returns only the cursor (plus reminders due in the last 15 min). The frontend polls every 2 s and plays events when the conversation is idle; attention events ring the phone first.
  - Claude Code companion: `scripts/claude-code-hook.mjs` (async command hook, exec form `node <script>`, silent, exit 0, 1.5 s timeout) maps `SessionStart`, `Stop`, `Notification` (permission/idle/input), `PostToolUse`/`PostToolUseFailure` on Bash (test/build commands) to events. `scripts/install-claude-code-hook.mjs` merges into `~/.claude/settings.json` with a backup, idempotent, `--dry-run`/`--uninstall`; not run without the owner's consent.
  - Tools: optional `toolRequest {tool, arguments}` in the structured reply (all providers), one call per turn, server-side validation, result returned as delimited data for a second tool-free generation. Groups: reminders (always), folders (if any folder is authorized), web_search (if a provider and key exist); `performance.json` `tools` may restrict groups. Response field `tool: {name, ok}`.
  - Settings → Tools: authorize/remove folders, choose Brave/Tavily and set/remove the key (vault), list/cancel reminders.
- **Rationale:** the owner asked for both the Claude Code companion and real character tools, with an allow-list and in-game confirmation for sensitive actions; the folder allow-list is that confirmation.
- **Limits:** reminders fire only while the backend and a tab are open; tool output is not kept in history; web search uses snippets only.

## D-068 — Voiced shouts and the title intro
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:**
  - `audio.json` `voices[phrase][language][speaker]` → sound id; clips in `audio/voices/<lang>/<speaker>_<phrase>.wav` (category `dialogue`). Installed (owner-labelled): EN Phoenix/Mia/Edgeworth objection + hold_it, Phoenix/Mia take_that; JA Mia/Edgeworth objection, Phoenix/Mia hold_it. Source archive has no French voices.
  - Settings → Shouts: Japanese (default) or English, independent of the interface language.
  - Title: after "press start", a random `objection` shout from Phoenix/Mia/Edgeworth in the shout language (falls back to the other language, then to the generic SFX), the original Objection bubble, a 1 s freeze, a 450 ms fade to black, then the menu fades in. Bubbles and voices are preloaded.
  - Characters may declare `voice.shout` (Mia = `mia`); event exclamations then use that voice, else the generic `exclamation_*` SFX (`exclamation_objection` → the existing objection.wav, hold_it/take_that → `fx_emphasis`).
- **Open:** Phoenix's Japanese 「異議あり！」 is one of the unlabelled clips `0x8D0E0`, `0xB29A0`, `0x4F840`, `0xA3040` of the 3DS archive; until identified, the Japanese title shout is Mia or Edgeworth.

## D-069 — Title draw uses every objection voice
- **Status:** Accepted
- **Date:** 2026-10-25
- **Amends:** D-068 (title speakers limited to Phoenix/Mia/Edgeworth in the shout language).
- **Decision:** at the owner's request the title draws from every installed `objection` voice in every language (12: EN Phoenix, Mia, Mia take 2, Edgeworth, guest_m1–m3; JA Phoenix, Mia, Edgeworth, guest_f1, guest_m4) and never repeats the previous title shout (`localStorage` `courtroom-companion.last-title-shout`). The Shouts setting still chooses the language of character exclamations. `guest_*` are clips the owner labelled "other man/woman" (characters not identified). Phoenix's Japanese objection is `0xB29A0`, identified by the owner. Resolves the D-068 open item.

## D-070 — Japanese exclamation bubbles for Japanese shouts
- **Status:** Accepted (objection asset added 2026-10-25; hold_it/take_that Japanese bubbles still absent)
- **Date:** 2026-10-25
- **Decision:** optional `ui.json` images `exclamation_objection_ja` (「異議あり！」), `exclamation_hold_it_ja` (「待った！」), `exclamation_take_that_ja` (「くらえ！」). The title shows the Japanese objection bubble when the drawn voice is `voice_ja_*`; conversation exclamations use the Japanese bubble when the character's voice is Japanese, or, for characters without a voice, when the interface language is Japanese. Missing Japanese images fall back to the English bubble.
- **Asset:** `ui/exclamations/objection_ja.png` from the owner's `igiari.jpeg` (kept in `docs/references/`): exterior black flood-filled to transparent, cropped, scaled to fit 256×192 (230×192, centred), colours snapped to the English bubble's palette.

## D-071 — The OST stays out of Git; installer script and download link
- **Status:** Accepted
- **Date:** 2026-10-25
- **Resolves:** the D-044 open item (normal Git vs LFS).
- **Decision:** the repository is public, so the owner chose not to redistribute the Capcom OST. `frontend/public/assets/music/original/*.mp3` is git-ignored; the README and `docs/MUSIC.md` point to https://archive.org/details/pwaa-original-soundtrack (VBR MP3 ZIP) and `scripts/install_ost.py` (stdlib only) installs the 25 runtime tracks by OST number. `validate:assets` and the music test accept a clone with no OST installed (notice only) but still require every track once any is present. Other Capcom assets (sprites, SFX, voices, bubbles) stay in the repository as before.

## D-072 — Subscription profiles: Claude (Claude Code) and ChatGPT (Codex CLI)
- **Status:** Accepted (Claude verified live; Codex covered by simulated tests only)
- **Date:** 2026-10-25
- **Decision:** two new profile types, `claude_code` and `codex`, use the owner's own plan instead of an API key by running the official CLI that is installed and logged in on the machine (`backend/app/llm/providers/subscription_cli.py`).
  - `claude_code` runs `claude -p --output-format json --json-schema <CharacterReply schema> --system-prompt <prompt> --tools "" --setting-sources "" --no-session-persistence [--model m]` and passes the conversation as text on stdin. It reads `structured_output`. `--bare` is not used because it forces API-key auth.
  - `codex` runs `codex exec - --output-schema <file> -o <file> --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config [-m m]`. The schema is converted to OpenAI strict mode: every property is required, optional ones become nullable, and unsupported bounds are removed (the shared validation keeps them).
  - Each call is one turn with no tools, no saved session and no user settings, run from an empty temp folder. API-key variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CODEX_API_KEY`, `OPENAI_API_KEY`) are removed from the child environment so the plan is billed, not an API account. `COURTROOM_HOOK_DISABLED=1` makes our Claude Code hook (D-067) ignore these runs.
  - Profiles take no base URL and no key; the model is optional (empty = the CLI's default). Executables are found on PATH (npm wrappers are resolved to the real binary) or set with `COURTROOM_CLAUDE_BIN` / `COURTROOM_CODEX_BIN`.
  - Error codes: `cli_not_installed`, `auth_not_configured` (not logged in), `rate_limited` (plan limit), `context_window_exceeded`, `timeout`, `provider_error`.
- **Limits:** ~~text evidence only~~ (superseded by D-076: images and PDFs pass through); each reply has the latency of a CLI start (about 3–6 s with haiku here); usage counts against the plan's limits. Use stays within each provider's terms for personal use of one's own subscription.

## D-073 — Reply language follows the user; file turns acknowledge first; stage and evidence fixes
- **Status:** Accepted
- **Date:** 2026-10-25
- **Amends:** D-066 (the character always replied in the interface language), D-057 (acknowledgement before thinking), D-065 (presented evidence box).
- **Decision:**
  - **Language:** the interface language is only a display choice. The prompt tells the model to reply in the language of the user's latest message, to use a language the user asks for, and to fall back to the interface language only when the message has no clear language ("ok", an emoji). It also lists the character's names in the other languages. The subscription transcript (D-072) ends with a reminder that its English framing does not set the reply language; without it Haiku answered French messages in English. The local task acknowledgement uses `guessMessageLanguage(message, interfaceLanguage)` (frontend, common-word scoring, Japanese script detection).
  - **File turns:** the advisory request heuristic (`artifacts/workload.py`) also recognises polite French forms ("est-ce que tu peux me faire…", "tu pourrais me préparer…", "j'aimerais un fichier…"), Italian and Spanish requests. So the local "I'm on it" line plays before thinking instead of nothing. The artifact contract tells the model that its beats are performed after the file is delivered: speak about the finished result, never announce the work or repeat an acknowledgement.
  - **Stage scale:** while a request runs, Cancel takes the Present button's slot instead of adding a fifth button; the extra button wrapped the action row onto a second line, which shrank the stage from ×3 to ×2 during thinking. The English label became "Cancel".
  - **Presented evidence:** an in-stage card with the dialogue box's double frame, the photo cropped to fill the 64×64 window (`object-fit: cover`, no letterbox bars), and the name in a nameplate strip that scrolls long names (OverflowMarquee). The Court Record tile frame is no longer used for this card.
- **Scope:** shared app code. Character packs (Maya's included) are unchanged.

## D-074 — Localized slang; nothing under the scene may change its height
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:**
  - The language rule asks the model to render nicknames, slang, interjections and catchphrases with natural equivalents in the reply language (no "pal" in French). Gumshoe's `personality.md` lists his equivalents: FR "mon vieux" / "l'ami", "Euh..."; JA 〜ッス, アンタ; IT "amico"; ES "colega".
  - The pending evidence chip and the error lines (reply error, rejected file) now live in a fixed slot to the right of the Talk / Court Record / Record / Present buttons (`.conversation-status`). It takes the free width, never wraps onto its own line, and its content is out of flow, so it is exactly as tall as the buttons. Before, they were rows under the scene: the chip (64 px) and a long error (about 100 px) appeared and disappeared during a turn and changed the stage scale (×3 ↔ ×2 in Pixel mode, continuous changes in Fit mode) for every character. `ChatBar` no longer renders errors.

## D-075 — Presented pictures: the original image, else the game's photo icon
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** the evidence card and the pending chip show the user's own image whenever the browser can display it. If it cannot (broken or unreadable file: the `<img>` fails to load), the game's photo evidence icon (`ui.json` `court_record_photo`, a 64×64 crop from the owner's evidence sheet) takes its place, drawn as pixel art at native size. The type badge is the last fallback when that icon is missing. Text files and PDFs keep the document icon with a type badge.
- **Rationale:** the owner asked for the photo icons from the game files, then preferred the original image when possible, with the photo asset as the replacement.
- **Attach-time check (same day):** `contentMatchesKind` checks an image's or PDF's first bytes with the server's signatures when the file is attached. A renamed or garbage file is refused at once with "This image/PDF can't be read: the file is damaged or isn't really…" (5 languages), instead of being sent and rejected as "Unsupported file". A file with a valid header that the browser still cannot draw (truncated) is accepted, and the photo icon stands in for it.

## D-076 — Subscription profiles read presented images and PDFs
- **Status:** Accepted (Claude verified live; Codex covered by simulated tests only)
- **Date:** 2026-10-25
- **Amends:** D-072 (subscription modes refused images and PDFs).
- **Decision:**
  - `claude_code` now always runs `claude -p --input-format stream-json --output-format stream-json --verbose …`. The turn is one stdin line `{"type":"user","message":{"role":"user","content":…}}`. The content is the transcript string, or, when the current turn carries evidence, the same image/document blocks the Anthropic adapter builds (`anthropic_message`) followed by the transcript. The reply is the last `type: "result"` event (`structured_output`).
  - `codex` writes each presented image to the run's temp folder and passes it as `--image <file>`. A PDF still raises `attachment_unsupported` for Codex.
- **Verified:**
  - Haiku through the owner's subscription named the colours of a test PNG and read the suspect's name in a test PDF.
  - In the app, Gumshoe recognised the Japanese National Police Agency logo from the owner's downloaded image and read 警察庁 correctly.

## D-077 — Presented pictures fit whole; Mia's turn_aside realigned
- **Status:** Accepted
- **Date:** 2026-10-25
- **Amends:** D-073 (presented photo cropped with `object-fit: cover`).
- **Decision:**
  - A presented picture is shown whole (`object-fit: contain`) over a blurred, darkened `cover` copy of itself, in the stage card and in the pending chip. Cropping a wide picture to a square showed only its middle: the owner's 373×135 police logo looked "hyper zoomed". The blurred fill avoids the letterbox bars the owner disliked.
  - Mia's `turn_aside` clip: canvas 92 → 124 px wide and every frame offset x +32, so the centred canvas moves the figure 16 px right. Its head and neck were at stage x≈114 while her other poses sit at x≈128–134 (measured on rows from the top of the figure), so she jumped left whenever she settled into that pose. They are now at x≈130, like `serious_front`. Pixels are unchanged.

## D-078 — Conversation Record: select several entries or delete all
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:**
  - The Record header has a **Select** button (Done while active). In selection mode, a click or Enter/Space toggles a check on a tile (check box in its corner; unchecked tiles are dimmed), and the footer shows "{n} selected".
  - **Delete** removes the checked entries; **Delete all** removes every entry. Both ask for confirmation in the footer line ("Delete 2 selected?" / "Delete all 59 entries?", Cancel / Delete). Esc cancels the confirmation, then leaves selection mode.
  - Server: `POST /api/conversation-record/delete {ids}` removes several entries in one atomic write (unknown ids skipped, returns `{deleted}`). Delete all reuses `DELETE /api/conversation-record {confirm: true}`.
  - Single-entry delete in the detail view is unchanged; its labels are now translated (5 languages).

## D-079 — Asset expansion: source archive boundary and native-first extraction
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** the owner's new archive (`extract_assets_ace`, 538 files + 327 zip members; inventory in `ASSET_EXPANSION_INVENTORY.md`, gaps in `ASSET_EXPANSION_GAPS.md`) is read-only source material. Nothing in the runtime references it; files are copied into `frontend/public/assets/` only when integrated. Distribution policy is unchanged (D-071): sprites, backgrounds, UI and SFX stay in the repository as before; soundtrack MP3s stay git-ignored and are installed locally by `scripts/install_ost.py`.
- **Native first:** the archive's DS/DSi sheets (49 AA1/JFA sheets: solid background, 26–48 colours, 0 % semi-alpha) are native-resolution rips like the Maya sheet (D-027), so characters that have one are cut 1:1 (`scripts/extract_ds_character.py`), never converted. The HD→DS pipeline is reserved for characters that exist only as HD (3DS/PC Trilogy) art.

## D-080 — Character readiness
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** `character.json` `readiness` is `asset-only` | `partial` | `ready`, capped by the files present (`ready` needs `personality.md` and `performance.json`; absent value is derived). The backend refuses chat for non-ready packs (`CharacterNotReadyError`, 404 with the reason); `COURTROOM_ALLOW_PARTIAL_CHARACTERS=1` allows `partial` for development. Production menus list `ready` only; dev builds also list `partial` with `[WIP]`; `asset-only` is never listed. Optional `group` (aa1/aa2/…) orders the character menu.

## D-081 — Character signature SFX
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** `performance.json` `sfx.signature` declares character-own sounds (`id`, triggering `reactions`/`emotions`, `minIntensity`, `cooldownTurns`, `maxPerReply`), played as audio event `sfx_<id>`. Resolution: signature (eligible and out of cooldown) → explicit semantic sound → emotion fallback → none. The cooldown is counted in replies in `DirectorState`, kept per (session, character) by `CharacterService`; stateless callers (inbox event lines) pass `signatures=False`. No character id appears in presentation code; the frontend accepts a sound only if it is global or an `sfx_<id>` event in `audio.json`. First use: Franziska's whip (`whip.wav`, copied from `docs/sfx general/sfx-whip.wav`), min intensity 0.85, cooldown 5 replies.

## D-082 — Character isolation and behaviour framework
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** the system prompt is built from the active pack only; history and director state are keyed per (session, character), so switching characters carries no persona or private history (tests over every ready pack). New characters follow `docs/CHARACTER_BEHAVIOR_FRAMEWORK.md`, which generalises the Maya lesson (D-056): answer the subject → react in character → keep speech style → quirks occasionally → theatre/SFX only when warranted. First wave: Miles Edgeworth, Franziska von Karma, Larry Butz, Pearl Fey (native DS sprites). No cross-character memory system was added.

## D-083 — HD → DS location and character conversion
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision (locations):** `scripts/convert_hd_locations_to_ds.py` profile **B** after stop-gate review: centre 4:3 crop of 1920×1080 plates (panoramas 3840×1080 keep full width → 683×192), AREA downscale by 1/5.625, adaptive softening only when high-frequency energy is above the measured DS range, 224-colour median-cut + k-means palette with light ordered dither, opaque RGB. Mean SSIM vs the area-downscaled source 0.989; no sharpening or contrast change (measurements did not justify it). No HD plate matches an existing DS room, so the comparison is distribution-level. 20 rooms (Trilogy T&T places; `_u` English-signage variants preferred; other suffixes are localisations) are installed as `bg_30`–`bg_49`.
- **Decision (characters):** `scripts/convert_hd_characters_to_ds.py` uses one platform scale (3DS sheets 0.71 DS px per HD px, measured on Frank Sahwit/Angel Starr DS↔3DS pairs, ±3.5 %), one anchor and one shared palette per animation, binary alpha, animation-level union bounds (no per-frame autocrop). Default profile B (20 colours); A (32) for fine detail such as Godot's vest and visor. PC Trilogy sheets are part atlases without assembly data and are not convertible into talking animations. Only the prototype (Frank, Angel, Godot) was converted; no HD character is in the runtime yet.

## D-084 — Unified status grammar
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** one indicator for pending work: a 28×28 DS-scale blue magnifier (top-right of the stage, from the archive investigation cursor, exact 4× box reduction, binary alpha) while a request, artifact generation or tool loop runs; the red-checked magnifier for 750 ms after success; nothing on failure/cancel. Artifacts gain an `artifact-done` phase: acknowledgement → blue → check → phone → summon → reply. It replaces the Thinker prop; the character keeps its waiting pose. The archive evidence frame is a different (Trilogy) design, so the native 70×70 DS frame stays.

## D-085 — Trilogy soundtrack, batch loop analysis, conversation music
- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision:** the archive soundtrack is the 3-disc Trilogy remaster. Discs 2–3 are installed as `original/d2-NN-*` / `d3-NN-*` (git-ignored); disc 1 does not replace the 25 PWAA encodes. 84 runtime tracks, 19 manifest-only. `scripts/analyse_loops.py` re-implements the D-044 metrics; loops carry `method` and `status: "measured_not_auditioned"`, unloopable tracks `loop: null` with a `loopReason`; per-track gain normalises toward −15 LUFS. Re-measurement showed the five D-048 finishing-pass loops do not reproduce their documented metrics: Maya's was replaced by a passing loop, the other four are kept and flagged for listening (D-048 is not rewritten).
- **Conversation music policy:** live override > Settings fixed track > character theme (`soundtrack.json` profile = character id). The override lasts for that conversation with that character, is never persisted, and applies only to the Game-music source. A compact in-stage strip (note tab above the dialogue box; downscaled Trilogy music-player icons) offers prev / play-pause / next / back-to-theme.

## D-086 — First-wave readiness, saved-file history note, whip tuning
- **Status:** Accepted
- **Date:** 2026-10-26
- **Decision:** after real-provider behaviour tests (10 unrelated turns each, Anthropic Sonnet 5.5) and a Maya→Edgeworth→Franziska→Maya isolation run, Edgeworth, Franziska, Larry and Pearl are `ready`: they answered every subject, showed no catchphrase spam or cross-character bleed, and stayed recognisable. QA found that a character later disowned a file it had saved, because the stored assistant history held only the reply JSON; the history entry now ends with `[File saved and delivered to the user: <name>]` when a turn saved an artifact (affects every character, including Maya). Franziska's whip never fired in 25 natural replies, so `angry` is now a trigger and the threshold is 0.8; the 5-reply cooldown is unchanged. The dev `[WIP]` marker is now a prefix so truncated names keep it.

## D-087 — Identity and explicit presentation context
- **Status:** Accepted
- **Date:** 2026-10-26
- **Decision:** optional `defaultPresentation` and `presentationGroups` extend existing character packs. The app explicitly requests conversation; inspector can select courtroom independently of background. Requested group → default group → legacy pack. Selected-group stable poses remain isolated; group reactions override shared reactions. The existing semantic resolver/player receives a view of the same character ID. Miles and Franziska get discussion groups; courtroom assets, personality, voices, history and director semantics are retained. WebP sources are decoded/composited to explicit PNG frames with original timing and fixed canvas; no browser-controlled animated image playback.
- **Evidence:** 11 new presentation tests, deterministic extraction verification, Chrome scales/context switching. Details: `PRESENTATION_DS_MIGRATION.md`.

## D-088 — Selective original DS audio migration
- **Status:** Accepted; human listening pending
- **Date:** 2026-10-26
- **Decision:** preserve the current bytes and entire manifest metadata of all 25 pre-expansion runtime tracks. Of 59 expansion remaster imports, 55 have explicit same-game mappings: 28 DS JFA MP3 byte copies and 27 NCSF123 T&T WAV→lossless FLAC derivatives at native 32,728 Hz. Four uncertain mappings remain untouched. Logical IDs and profiles remain unchanged. Exactly 55 superseded remasters are SHA-verified local backups outside runtime. Replacement gains are unity, with remaster normalization/loops discarded. Existing analyser ran only on replacements: 21 measured-not-auditioned loops, 34 whole-file fallbacks. No human listening claim. Source folders are read-only. Full evidence: `scripts/data/ds_audio_migration.json`, `scripts/data/ds_loop_analysis.json`.
- **Packaging:** existing whole-directory runtime asset copy/exclusion handles the added frames and FLAC; no packaging rewrite or EXE rebuild.

## D-089 — Targeted native presentation and preview lifetime corrections
- **Status:** Accepted
- **Date:** 2026-10-26
- **Decision:** preserve current architecture/presentation groups. Franziska gets an optional generic `selectionPreview` asset, exact native front-facing record portrait, and existing DS whip pixels on a transparent256×192 canvas with authored per-frame durations totaling1500ms. A single deterministic PCM cue contains whip0ms→whack400ms, preserving signature anti-spam without JS timers. Ready phone reuses `EvidenceTile`. Submitted evidence preview is owned by request ID and released on completion/error/cancel/navigation/unmount independently of pending attachments; stale completions cannot release newer previews.
- **Limits:** the reference GIF has no valid frame delays, so exact DS timing is not claimed; human listening remains pending. See `TARGETED_CORRECTIONS.md`.

## D-090 — Meaningful realization, Pearl scoring and unmapped font safety
- **Status:** Accepted; official font integration awaiting mapping
- **Date:** 2026-10-26
- **Decision:** keep existing semantic sound vocabulary. Meaningful understanding/useful-detail uptake may request realization without theatrical intensity; duplicate explicit realization is capped at one per reply, with other explicit semantics preserved. The event now uses supplied lightbulb WAV instead of the different realization WAV. Pearl-specific thresholds add soft-transition and comic cues while ordinary/sensitive beats remain quiet. No keyword/random trigger system. The supplied font PNG has custom glyph order and no Unicode map; keep Igiari +75% DotGothic16 until an authoritative map or mapped font is available, rather than displaying incorrectly mapped kanji.

## D-091 — Complete whip effect; conversation never shows courtroom side sprites
- **Status:** Accepted; human listening pending
- **Date:** 2026-10-26
- **Root cause of the missing effect:** the D-089 pass inspected the reference `assets/other assets/whip/whip effect gif.gif` and deliberately did not import it (opaque black substrate, zero delays), so only Franziska's body frames played. Separately, `emotions.angry.reaction = whip_crack` made the body whip play on angry beats while the whip sound was gated by the signature rules, so partial whips (body without sound) were possible. The root `assets/` folder was not part of the problem: no runtime path ever pointed there.
- **Decision:** a reaction can declare an `effect` (character.json): a full-stage overlay clip, an optional `backdrop` (colour layer, opaque then fading out) and sound `cues` (audio events), all timed from the reaction start by one pure schedule (`engine/reactionEffect.ts`) and one timer chain that clears on completion, key change or unmount. The GIF is decoded deterministically (`scripts/extract_whip_effect.py`: composited frames, black to alpha, x0.8 to 256x192, binary alpha, shared 32-colour palette) into `characters/franziska/effects/whip_slash/` (20 frames). Timing is inferred (40 ms per frame; the GIF has no valid delays). Cues: `whip_swing` (sfx-whip) at 300 ms, `whip_impact` (sfx-whack) at 440 ms, again at 700/840 ms for the second lash.
- **Signature ownership:** `sfx.signature[].performs` names the reaction the signature is performed with. When the signature fires, the director sets that reaction and no separate sound (the cues carry it); when it is not eligible the reaction is dropped, so the whip is always complete or absent. Angry is an emotion, not a whip: no emotion binding implies `whip_crack`.
- **Conversation vs courtroom (owner feedback):** conversation must never use courtroom side-view sprites. Presentation groups can set `inheritReactions: false` (Franziska, Edgeworth conversation groups), so the shared courtroom reactions are not available in conversation. Franziska's conversation `whip_crack` shows a black screen with the slash, then fades (1100 to 2000 ms, ease-in) back to her front-facing angry pose, like eyes opening again. The courtroom group keeps the side-view whip body with the same overlay and cues.
- The previous compound `effects/whip_crack.wav` stays on disk and registered as `fx_whip`, but is no longer a semantic event.

## D-092 — Shared semantic SFX library and frequency model
- **Status:** Accepted; human listening pending
- **Date:** 2026-10-26
- **Decision:** global names gain `angry`, `flabbergasted`, `encouragement`; source categories map by alias (`scared`->shock, `insightful`->realization, `you_can_do_it`->encouragement). Every character with an `sfx` block may request the shared names explicitly (character tables add/override; `null` removes). Concrete sound resolution is frontend presentation: character.json `semanticSounds` -> audio.json `semanticSounds` (shared pools) -> global event `sfx_<name>`; pools rotate so a file never repeats back to back.
- **Frequency (director, deterministic, no randomness):** explicit model requests are strong matches (only the one-realization-per-reply cap applies); emotion fallbacks obey per-emotion thresholds, `maxPerReply`, optional `fallbackCooldownTurns`, optional `categoryCooldownTurns`, and a drought allowance (`droughtTurns`, `droughtBonus`) that lowers thresholds after silent replies. Defaults keep previous behaviour for packs that do not opt in.
- **Pearl root cause:** live Pearl replies sit at intensity 0.3-0.6, while every Pearl threshold started at 0.65 and anxious/embarrassed/determined/angry had no mapping, so nearly nothing fired. Thresholds now follow her range (0.5-0.6), with fallback cooldown 1, category cooldown 1, drought 3. Pearl: comic -> meow/badum, shock -> shock2, angry -> smack.
- Maya: comic pool meow/badum, anxious->shock at 0.75, playful 0.65, drought 4. Realization stays model-driven with clearer prompt guidance (corrections, clarifications, missing pieces, deductions).

## D-093 — Structural loop pass for DS-original tracks
- **Status:** Accepted; not auditioned
- **Date:** 2026-10-26
- **Decision:** the D-044 envelope test rejected DS renders that repeat musically but not waveform-identically. A structural analyser (`scripts/analyse_loops_structural.py`, evidence `scripts/data/ds_loop_analysis_v2.json`) finds the repeat lag from chroma self-similarity, prefers the latest musically valid phase that passes a seam gate, and slides points to low-click positions. 51 of 55 DS replacements now loop (4 whole-file with reasons). Turnabout Sisters 2001 moves from 51.50-125.36 s (77.8% heard before the first loop-back) to 73.94-147.80 s (91.7%), the composition's own second return. All new loops are `measured_not_auditioned`. Pre-expansion and REVIEW entries are untouched (evidence only). `scripts/migrate_ds_audio.py --finalize-analysis` still asserts the v1 results and is out of date.

## D-094 — The whip is part of Franziska's repertoire; conversation lash starts at once
- **Status:** Accepted; live-model frequency not yet measured
- **Date:** 2026-10-26
- **Owner feedback:** the black screen arrived before the whip was used; the whip must be part of the character (impatience, anger, shyness/fluster, frustration, being pestered or made to repeat herself), balanced with her classic poses, as in the games.
- **Timing:** the conversation whip now starts the black backdrop, the first slash frame and the swing sound together (0 ms); impacts at 140/540 ms, second swing at 400 ms; fade 800-1700 ms. The courtroom version keeps its 300 ms body wind-up.
- **Triggers:** signatures accept `emotionMinIntensities`; Franziska's whip fires on angry >= 0.65 and embarrassed >= 0.6 (aliases: impatient, frustrated, exasperated, fed_up -> angry; shy, bashful, flustered -> embarrassed), on emphasis >= 0.75, and whenever the model requests `whip_crack` itself (repetition, pestering, wasted time), at any intensity. Cooldown 3 silent replies (was 5), max one per reply. Her personality tells the model when to lash and when to stay classic; never at real distress.
- **Balance evidence:** live recordings show her provoked replies at angry 0.6-0.85 / embarrassed 0.45-0.65, calm ones never angry. A 12-turn provocation replay gives 3 whips and 9 classic beats; calm or mild beats (angry 0.6, serious, explaining, playful, sad) stay classic.

## D-095 — File requests recognised wherever the verb is
- **Status:** Accepted
- **Date:** 2026-10-26
- **Problem (owner):** for file requests the character often thought first, then acknowledged and delivered, so the phone felt pointless. The local acknowledgement (shown before the model call ends) only plays when `artifacts/workload.py` recognises a file request. Its rule required the creation verb at the start of a sentence, so the owner's real request "I need you to find the best police academies in France on the internet and generate an md file to save them" was classed as dialogue: no acknowledgement, the model thought, then the reply arrived with the file.
- **Decision:** two extra recognition paths, used only when no how-to, explanation, negation or past-work marker is present: (1) a creation verb anywhere with a file target ("... and generate an md file"); (2) an explicit output format on its own ("as a markdown file", "into a file", "dans un fichier", "sous forme de fichier", "in un file", "en un archivo"). Existing request rules and negatives are unchanged; 19 new positive and 9 new negative cases. The owner's recorded history now has the file turn detected and no false positives.

## D-096 — Background foreground layers; seated characters in the detention center
- **Status:** Accepted
- **Date:** 2026-10-26
- **Problem (owner):** in the detention center (bg_03) characters stood in front of the visitor window; they should sit behind it, belly and waist hidden by the glass frame and counter.
- **Decision:** backgrounds may declare `foreground` (a same-size layer drawn above the character, below effects and UI) and `characterOffsetY` (extra downward shift for that room). bg_03 gets `background_03_foreground.png`, cut 1:1 from the plate by `scripts/make_background_foreground.py` (frame x 0-13 and 240-255, sill/frame/counter from y 153), and `characterOffsetY: 20`, chosen from a contact sheet of all seven characters (waist hidden, shoulders and chest visible, chair back visible behind them). Generic: any room can opt in; others are unchanged.

## D-097 — Track list in the conversation music strip
- **Status:** Accepted
- **Date:** 2026-10-26
- **Decision:** the strip keeps prev / play-pause / next / theme and gains a list button that opens an in-stage track menu (stage pixels, DS frame, above the strip; not a native OS select, which would leave the pixel style). It lists the same selectable pool as next/prev, in player order, with the game suffix; the current track is marked and scrolled into view with keyboard focus, the character's theme is starred. Picking a track uses the existing `select` override policy (no new playback path); arrow keys move, Enter picks, Escape closes the list only. Labels in EN/FR/JA/IT/ES.
