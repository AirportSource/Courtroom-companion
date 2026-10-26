# Presentation contexts and selective DS audio migration

2026-10-26. Integration milestone; prior expansion work retained. This report supersedes the expansion's runtime audio source/loop totals, without rewriting its historical records.

## Repository safety

Initial read-only Git inspection found 47 changed tracked files (46 modified and the already-deleted `start-dev.ps1`), plus untracked expansion packs, scripts, tests, documentation and reference assets. No reset, clean, checkout-over-changes, staging, commit or push was performed. Source archive files were read only. Local soundtrack derivatives remain ignored by Git.

## Presentation

Both Miles and Franziska originally had only their courtroom-oriented animation set exposed as their companion presentation. Their default idle therefore used an angled courtroom pose.

Character identity is separate from presentation context. `miles_edgeworth` and `franziska_von_karma` retain their IDs, personality, voice, performance semantics, history and theme mapping. Optional `defaultPresentation` and `presentationGroups` extend the existing character schema. Groups contain animations and optional emotions, reactions, placement and waiting pose. The application explicitly requests `conversation`; the animation inspector can select `conversation` or `courtroom` independently of its background.

Resolution: requested group → declared default group → legacy animations. `selectPresentation` projects the selected visual data onto the same loaded character, before the existing semantic resolver. Stable animations stay within the active group; unavailable director poses fall back through that group's emotions. Active-group reactions take priority over shared character reactions. Unique group clip keys restart the existing deterministic animation player on context changes. There is no second animation engine and no character-specific React branch. Maya requires no migration.

| Pack | Conversation source | Courtroom preservation |
|---|---|---|
| Miles | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Miles Edgeworth.png`, seven discussion poses, 56 PNGs | Existing `(in Court).png` derivatives retained; prior animations/emotions/waiting copied into courtroom group |
| Franziska | Ten animated WebPs in the supplied `characters/Franziska` set; `Normal_Forward` idle/talking default, plus mocking, pointing, disdain and crying | Existing in-court derivatives retained; courtroom group preserves prior presentation |

All ten Franziska inputs are actual animated WebP, 256×192, with 4–28 frames each (130 total); no GIF or APNG was found. `extract_animated_character_assets.py` uses Pillow/libwebp's sequential, composited visible frames and writes explicit PNGs with original frame durations. Reports retain source hashes, alpha bounds, loop metadata and RIFF ANMF blend/disposal flags. No screenshots, redraw, interpolation, resizing or per-frame trimming are used. Franziska keeps the full 256×192 canvas and baseline y=192. Miles uses fixed pose canvases and offsets; measured lower-body registration residual is zero for every idle/talk frame across all seven poses. The extractor's `--verify` path passed exact source-pixel/decode, timing and report comparisons.

Franziska's `whip_crack` stays a shared reaction and remains available from conversation anger. Signature SFX, anger threshold and five-reply cooldown are unchanged. The CharacterDirector continues to emit semantic IDs, never asset paths.

## Selective audio migration

| Classification | Count | Result |
|---|---:|---|
| KEEP | 25 | Pre-expansion runtime audio, entire current manifest entries, gains and loops preserved byte-for-byte/value-for-value |
| Expansion imports identified | 59 | Established from Git manifest delta and recorded source provenance |
| REPLACE | 55 | 28 Justice for All MP3 byte copies; 27 Trials and Tribulations lossless FLAC derivatives |
| REVIEW | 4 | Original expansion entries and files left untouched |
| Fresh measured loops | 21 | `measured_not_auditioned` |
| Whole-file fallbacks | 34 | No accepted candidate; per-track reason retained |

The initially supplied `game_soundtrack/convert/wav` location was reorganized externally during inspection. Final read-only sources were the game-labelled `Phoenix Wright - Ace Attorney Justice for All` MP3 folder and `Phoenix Wright - Ace Attorney Trials and Tribulations/wav`. The latter contains NCSF123 native/default stereo PCM16 renders at 32,728 Hz. FLAC preserves their samples and native rate without resampling. The JFA MP3s are copied unchanged. Runtime remains compatible with the existing Web Audio decoder; old MP3s are not converted. Replacement gains are unity; old remaster loudness measurements and loop points are discarded. No EQ, effects, denoising or aggressive normalization was applied.

`scripts/data/ds_audio_migration.json` is the exact per-ID mapping and preservation audit: pre-migration full entries and SHA-256, action/confidence/reason, relative source, source SHA-256, replacement path and SHA-256, loop/audition disposition. Every logical track ID, catalogue title/game metadata and character profile survives. Confidently migrated entries no longer reference their remaster files. Exactly 55 superseded remasters were SHA-verified and moved out of runtime to ignored `backend/.local/audio-migration/remaster-backup/`; each audit entry records its backup path. No source files or KEEP/REVIEW files were moved or modified. Four REVIEW entries remain runtime remaster references:

- `bonus_prosecutors_path_miles_and_fran`: bonus arrangement absent from original JFA sources.
- `the_stolen_turnabout`: two DS opening parts; correspondence/arrangement needs listening.
- `recipe_for_turnabout`: no confidently labelled DS render.
- `pursuit_corner_the_culprit_2004_variation`: the available PW1 variation is not assumed to be the 2004 variation.

The existing `analyse_loops.py` ran only on the 55 replacement IDs. `scripts/data/ds_loop_analysis.json` records all measured results. Acceptance requires repeated-segment evidence plus coverage ≥0.70, envelope identity ≥0.92, seam correlation ≥0.95, adequate duration and enough comparison windows. Analysis decodes a temporary 44.1 kHz mono representation; it does not change the native-rate runtime file. Loop metadata records its 44.1 kHz analysis timebase, which the player converts to seconds. No old track was remeasured. No loop was physically auditioned; every new loop still requires human listening. Whole-file playback is used for rejected candidates.

The remaster installer skips entries carrying DS provenance so a subsequent archive install cannot overwrite the migrated defaults. Distribution/packaging rules remain unchanged: Vite copies runtime assets into `dist`; the Windows builder copies that tree and excludes `assets/music/original` plus the soundtrack manifest unless `--with-original-soundtrack` is explicitly selected. No packaging code change or EXE rebuild is needed.

## Files attributable to this milestone

Code: `frontend/src/engine/manifestTypes.ts`, `frontend/src/engine/manifestLoader.ts`, `frontend/src/engine/presentationContext.ts` (new), `frontend/src/App.tsx`, `frontend/src/screens/ConversationScreen.tsx`, `frontend/src/screens/AnimationTestScreen.tsx`, `frontend/src/music/soundtrack.ts`, `frontend/scripts/validate-assets.mjs`, `.gitignore`.

Tests: `frontend/tests/presentationContext.test.ts` (new), `frontend/tests/dsAudioMigration.test.ts` (new), `frontend/tests/music.test.ts`, `frontend/tests/conversationMusic.test.ts`.

Runtime manifests: `frontend/public/assets/characters/edgeworth/character.json`, `frontend/public/assets/characters/franziska/character.json`, `frontend/public/assets/music/soundtrack.json`. Extraction metadata: `frontend/public/assets/characters/conversation-extraction.json` and ten `franziska/conversation/*/source.json` files.

Character assets: 56 added PNGs under `frontend/public/assets/characters/edgeworth/conversation/`, 130 under `frontend/public/assets/characters/franziska/conversation/`; zero removed. Exact frame lists are in the manifests and extraction reports. Audio assets: 55 added `frontend/public/assets/music/original/ds-*` files (28 `.mp3`, 27 `.flac`); 55 old remasters moved to the verified local backup, zero KEEP/REVIEW files altered. Exact old/new/backup paths are in the migration audit. All 27 FLAC derivatives were decoded and proved sample-identical to their source WAVs.

Scripts: new `scripts/extract_animated_character_assets.py`, `scripts/build_conversation_presentations.py`, `scripts/migrate_ds_audio.py`; updated `scripts/install_ost.py`; new `scripts/data/ds_audio_migration.json`, `scripts/data/ds_loop_analysis.json`. Existing loop analyser reused.

Persistent docs: this report, `PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `ASSET_INVENTORY.md`, `ASSET_SOURCES.md`, `CHARACTER_DIRECTOR.md`, `MUSIC.md`, `SESSION_LOG.md`.

## Integration QA

| Check | Result |
|---|---|
| Backend `python -m pytest -q` | 593 passed, 2 skipped; existing Starlette deprecation warning |
| Frontend `npm.cmd test` | 321 passed, 0 failed |
| `npm.cmd run validate:assets` | 986 referenced files, 0 errors |
| TypeScript `tsc -b` | Passed as the first production-build step |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed, 147 modules; Vite emitted a non-failing plugin timing notice |
| `git diff --check` | Passed |

Chrome development-app QA followed Maya → Miles → Franziska → Maya. Conversation screenshots were captured at 3×, 4× and auto; Miles and Franziska screenshots at all three scales were inspected, as were Maya, courtroom and whip samples. The selected conversation frames are front-facing; expected scale/baseline and face visibility are intact. Idle/talking resolution and conversation → courtroom → conversation transitions use the correct assets. Maya's frame and placement before/after switching are identical. Frame alignment is additionally verified by the source-pixel/registration checks; exhaustive subjective motion review is still a human task.

Dialogue blip calls successfully started for Maya (female), Miles (male), Franziska (female), and Maya again. A typed input started the male user-typing blip. Shared Franziska `whip_crack` rendered in conversation, and its mapped sound successfully started. Backend tests cover its anger trigger, cooldown, per-character/per-session isolation and global SFX fallback. No blip or AudioEngine redesign occurred.

Live music-strip checks passed: character theme, next, previous, pause, play and return-to-theme. Direct MusicEngine playback/decode spot checks passed for the preserved Maya theme, migrated Miles theme, Godot, Cross-Examination Moderato 2004, Objection 2002 and Larry. Ringtone ducking changed effective BGM volume from 0.3 to 0.036 and restored 0.3 without changing the track. Settings fixed/default precedence and manual selection are covered by deterministic tests. All four new character profile IDs still resolve to the same logical themes. Browser presentation run recorded no runtime exceptions. QA scripts/screenshots/reports are kept in ignored `backend/.local/presentation-qa/` and adjacent scratch files.

Remaining: human listening for all 55 migrated tracks, especially the 21 measured loop seams and relative playback volume; resolution of the four REVIEW mappings; optional full-motion aesthetic review of the discussion-to-shared-whip transition (retained courtroom whip has a different pose/scale). No audio was physically listened to, no loop is marked auditioned, no live LLM evaluation or Windows EXE rebuild was performed in this milestone. Character personality/prompts and provider architecture were outside the change.
