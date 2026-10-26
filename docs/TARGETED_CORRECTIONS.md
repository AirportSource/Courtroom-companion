# Targeted character and presentation corrections

2026-10-26. This pass preserves the existing expansion, presentation groups and original DS soundtrack migration. No commit, push, staging, reset or clean was performed.

## Work ownership

| Worker | Scope and result |
|---|---|
| A — GPT-6.1-Sol High | Franziska native whip timing/composition, compound whip/whack cue, front-facing profile portrait, centered thumbnail asset; actual lightbulb audio mapping |
| B — GPT-6-Astra Medium | Request-scoped uploaded-image preview ownership and cleanup; native frame around ready phone |
| C — GPT-6-Astra Medium | Pearl-specific semantic mappings/thresholds and quiet-case coverage |
| D — GPT-6-Luna Medium | Meaningful realization prompt guidance and narrow per-reply duplicate-realization suppression |
| E — GPT-6.1-Sol Medium | Font source inspection; no safe Unicode mapping found and no font changes made |
| Lead — GPT-6.1-Sol | Generic thumbnail lookup/validation, integration review, browser checks, full validation and persistent documentation |

## Root causes and chosen assets

**Franziska whip.** The old one-shot had eight native DS frames at uniform 10 fps (800 ms) on a 344×133 canvas. Its timing was not authored, and the large canvas placed/clipped it indirectly on a 256×192 stage. All ten discussion WebPs, both supplied DS sheets, existing native strike frames, `other assets/effects/whip effect.png` and `whip effect gif.gif` were inspected. The GIF is an opaque-black 400×240 HD cyan slash effect with 20 zero-delay frames and two swipes; it supplies no authoritative timing and is not imported. The native frame alpha itself did not reproduce an opaque black screen during inspection, so that specific original symptom is not attributed to a proven black substrate.

The corrected one-shot composes the existing native pixels 1:1 onto transparent 256×192 frames, preserving body registration and native white whip streaks. Frame durations are **100, 100, 100, 100, 250, 200, 200, 450 ms** (1500 ms). This is deliberate DS-style single-strike pacing, not a claim of exact GIF timing. Existing frames and courtroom/discussion groups remain. A deterministic compound WAV plays supplied `docs/sfx general/sfx-whip.wav` at 0 ms and `sfx-whack.wav` at the 400 ms strike (sample 8820 at 22,050 Hz). Whack is converted to the existing mono PCM16 cue format, with only a uniform peak-preserving gain where bandlimited conversion would otherwise overshoot; no soundtrack conversion occurs. One semantic event plays the compound cue, so there is no delayed JavaScript timer to leak into another scene. Existing five-reply signature cooldown and one-per-reply signature limit remain. `sprites/whip_crack/timed/source.json` records source hashes, placement, timing, cue offset and gains.

**Franziska selection.** The menu's square `object-fit: cover` preview was using a 256×192 conversation frame with asymmetric transparent padding. The new 170×170 transparent square copies the 128×170 native body at centered x=21 without resampling. Optional `selectionPreview` lets any pack supply menu art independently of conversation assets; absent/empty values preserve the current default-presentation/legacy idle fallback.

**Franziska Journal portrait.** The old 64×64 stand-in was a side-facing sprite crop. The replacement is an exact native crop **[643,75,707,139]** from `other assets/evidences/DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Miscellaneous - Evidence.png`. It is front-facing and retains the current record layout. The nearby `491690.png` contains HD evidence objects, not the desired portrait, and was excluded. Only the specifically superseded portrait was replaced; courtroom sprites were not changed.

**Phone.** The overlay already received `evidenceFrame`, but the phone branch rendered a plain prop and ignored it. It now uses the existing `EvidenceTile` and native 70×70 `ui/court-record/evidence_frame.png`, matching evidence presentation. Ringtone, duck lease, answer action and artifact state-machine transitions are unchanged.

**Uploaded image lifetime.** `presented` was set only on attachment sends and hidden during replies without clearing it. Any later `waiting` phase exposed the stale image again. `EvidencePresentationLifetime` now owns the submitted preview by request ID, separately from the next pending attachment. Accepted response, error, confirmed cancellation, navigation and unmount release it idempotently; stale completions cannot release a newer preview. Revoking a local blob URL does not remove the encoded request payload.

**Lightbulb.** Two causes: semantic instructions limited every reaction sound to a “genuinely theatrical” moment, and the realization event selected `sfx-realization.wav` instead of the requested `sfx-lightbulb.wav`. The existing semantic `realization` event now maps to a byte-identical lightbulb copy, while the old realization asset remains. Prompt guidance includes meaningful understanding/useful-detail uptake, with quiet routine acknowledgments and no keyword trigger. Duplicate explicit realization sounds are limited to one per reply; other explicit semantic behavior remains intact. Actual provider adherence/frequency was not measured with live model calls.

**Pearl.** Her SFX configuration only had a surprise emotion fallback. Strong positive beats now use `soft_transition` (happy ≥0.72, excited ≥0.65, grateful ≥0.78), playful/laughing beats use `comic` at ≥0.72, and surprise retains ≥0.65. Explicit celebration/gasp/comic intents are available; realization remains supported. Ordinary lower-intensity happy, neutral, anxious and sensitive beats stay quiet. The existing one-fallback-per-reply cap remains; pre-existing explicit semantic overrides still bypass that general fallback cap. No random selection, new character logic or new audio system was added.

## Font finding and remaining dependency

The supplied source tree contains one font atlas: `police_extract/Game Boy Advance - Phoenix Wright_ Ace Attorney_ Trials and Tribulations _ Gyakuten Saiban 3 (JPN) - Miscellaneous - Font.png`, 128×3072 RGBA, eight 16-pixel columns and 192 rows. It has custom glyph ordering and no embedded Unicode mapping. No TTF/OTF/WOFF, .fnt or accompanying mapping file was found. It cannot safely become a kanji fallback by assigning codepoints from grid positions; that would display incorrect characters. An authoritative glyph-index-to-Unicode table or the intended mapped font is still needed. A possible external translation-toolkit map was not obtained or verified and is not used.

**No new official font was integrated.** Existing Igiari for Latin/kana and 75%-scaled DotGothic16 fallback remain unchanged. This retains current visual coherence and pagination, but DotGothic16 remains a substitute rather than an authentic DS kanji font. A text question asking for an alternate local font path was sent; no alternate path was available during this pass.

## Exact changed files

Code/data already present:

- `backend/app/characters/prompt.py`
- `backend/app/director/director.py`
- `frontend/public/assets/audio/audio.json`
- `frontend/public/assets/characters/franziska/character.json`
- `frontend/public/assets/characters/franziska/portraits/court_record.png`
- `frontend/public/assets/characters/pearl/performance.json`
- `frontend/scripts/validate-assets.mjs`
- `frontend/src/artifacts/ArtifactDeliveryOverlay.tsx`
- `frontend/src/artifacts/ArtifactDeliveryOverlay.css`
- `frontend/src/engine/manifestLoader.ts`
- `frontend/src/engine/manifestTypes.ts`
- `frontend/src/screens/ConversationScreen.tsx`
- `frontend/tests/characterPlatform.test.ts`
- `frontend/tests/sfx.test.ts`

New code/tests/scripts:

- `frontend/src/evidence/presentationLifetime.ts`
- `frontend/tests/evidencePresentation.test.ts`
- `frontend/tests/selectionPreview.test.ts`
- `backend/tests/test_pearl_sfx.py`
- `backend/tests/test_lightbulb_sfx.py`
- `scripts/correct_franziska_assets.py`
- `scripts/test_franziska_correction.py`

New runtime assets:

- `frontend/public/assets/characters/franziska/portraits/selection.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_000.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_001.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_002.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_003.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_004.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_005.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_006.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/frame_007.png`
- `frontend/public/assets/characters/franziska/sprites/whip_crack/timed/source.json`
- `frontend/public/assets/audio/effects/whip_crack.wav`
- `frontend/public/assets/audio/effects/lightbulb.wav`

Docs: this report, `PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `ASSET_INVENTORY.md`, `ASSET_SOURCES.md`, `CHARACTER_DIRECTOR.md`, `SESSION_LOG.md`. All earlier valid character/audio assets are retained except the explicitly superseded front-facing record portrait.

## Validation and manual/browser inspection

| Check | Result |
|---|---|
| Full backend suite | **629 passed, 2 skipped**; existing Starlette deprecation warning |
| Full frontend suite | **327 passed**, no failures/skips |
| Source/asset-specific Python checks | **4 passed** |
| Asset validator | **997 referenced files, 0 errors** |
| TypeScript / lint / production build | Passed; 148 modules, non-failing Vite timing notice |
| `git diff --check` | Passed |
| DS audio protection | Soundtrack manifest, both migration audits and all **84** runtime files have unchanged hashes |

Chrome QA used an isolated page with deterministic API fixtures for the final end-to-end checks; no live LLM evaluation was performed. Evidence was present during its own request, absent after the response, its blob URL revoked, and absent during the next unrelated request. Phone screenshot shows the native frame; one ringing loop and duck factor 0.12 were observed, then zero loops/factor 1 after answering (effective BGM 0.25 →0.03 →0.25). Journal screenshot shows the front-facing portrait. The dedicated selection preview is centered and native-pixel rendered.

Whip playback was inspected frame-by-frame in source contact sheets and in the app: transparent background, original scene remains visible, the timed sequence plays once before dialogue and returns to the discussion pose. The compound cue starts once; tests verify unchanged whip samples, the following whack and its exact 400 ms offset. No opaque-black full-screen animation was observed in the corrected runtime.

Pearl excited/playful/quiet and Maya understood fixtures were passed through the actual Director: `soft_transition`, `comic`, silence, and `realization`, respectively. The corresponding browser audio events successfully started, and realization resolved to `fx_lightbulb`. Anti-spam and explicit-override behavior are covered by deterministic tests. This is decode/playback validation, **not physical listening**. Human listening remains recommended for the 400 ms impact timing, Pearl's cue fit and lightbulb volume/context. Exact GIF timing and subjective game feel are not certified.

The unchanged Japanese font stack loaded successfully. Kana, kanji-heavy and mixed Latin/Japanese samples all paginated within their live measured line limits (241/241/233 logical pixels); a mixed-kanji dialogue screenshot showed no clipping. This verifies preservation of the existing rendering, not integration of the unmapped atlas. Scratch fixtures, timing traces and screenshots are in ignored `backend/.local/targeted-correction-qa/`.

Cleanup: the dedicated QA Chrome instance (PID28964, CDP9241) was closed through `Browser.close`; the Vite task (listener PID6968, port5207) was interrupted through its own exec session. Both ports were verified closed. Normal browser instances were not stopped.
