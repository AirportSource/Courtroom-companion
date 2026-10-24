# Music — Courtroom Companion

_Created 2026-10-24 (music + Court Record milestone). Decisions: D-043 (engine), D-044 (built-in loops), D-045 (imports), D-046 (radio)._

## Architecture

```
useMusicSync (App)  ── persisted settings ──►  musicRequestFor()  ──►  MusicEngine (one instance)
                                                                     ├─ WebAudioSource 'original'  ← soundtrack.json resolver
                                                                     ├─ WebAudioSource 'imported'  ← backend library resolver
                                                                     └─ YouTubeRadioSource 'radio' ← official IFrame Player
```

- `src/music/types.ts`: shared contracts (`MusicSource`, `LoopRegion` in **samples**, `LoopMetadata`, provenance, error codes).
- `MusicEngine.ts`: play/pause/resume/stop/switchSource/volume/mute/fade/retry. Every request bumps a generation, aborts the previous AbortController and joins one serial queue. The previous source is always fully stopped (faded) before the next `start()`, so two BGM sources can never be audible. A switch during loading aborts silently (`aborted` is never shown as an error). The same track is never restarted. The engine knows no character, provider or file name; a future MusicDirector would send the same logical `play(kind, trackId)` requests.
- `webAudioSource.ts`: fetch → ArrayBuffer → `decodeAudioData` → AudioBuffer → AudioBufferSourceNode (`loop`, `loopStart/loopEnd` = samples ÷ sampleRate) → track gain → fade gain → master gain → temporary duck gain. It shares the single `audioEngine` AudioContext and never suspends it, so blips and SFX are unaffected. Pause stops the node and remembers the position; resume restarts inside the loop. Before the first gesture the state is `blocked`, and `audioEngine.onUnlock` retries.
- `bufferCache.ts`: lazy LRU (3 decoded tracks / 160 MB), with in-flight dedupe. Nothing is decoded at startup.
- `loopMath.ts`: region validation, sample→seconds, equal-power crossfade baking into a buffer copy, lenient metadata parsing. Malformed loop metadata plays the whole buffer and records an `invalid_loop` warning.
- `musicRuntime.ts` / `useMusicSync.ts`: lead wiring and the pure settings → request mapping. In dev builds the runtime is exposed as `window.__ccMusic` and disposed on HMR.
- `components/MusicDock.tsx`: out-of-stage bar (status, Play after a block, Pause). It keeps the official YouTube player mounted and visible while Radio is selected, and hosts the import library.
- Settings (in-stage): Music source (Game music / Imported / Radio / Off), Track, BGM vol, Mute BGM. Blip volume is separate and unchanged in behaviour (renamed "Blip vol").

## Temporary phone attenuation (D-057)

`MusicEngine.acquireDuck(factor, attackMs, releaseMs)` returns an idempotent release function. Multiple leases use the lowest factor. It never writes the user's volume/mute or issues play/stop requests. Original/imported sources apply it through an independent duck GainNode, so master changes and existing track/pause fades remain independent. The radio source uses the official player's volume control with a bounded cancellable ramp, multiplying its existing stop-fade level rather than replacing it.

While the delivery phone rings, the scoped factor is **0.12** with **220 ms** attack and **350 ms** restoration. At configured volume 0.80, effective master output is 0.096 while ringing. Current settings are applied on release, including volume/mute changes during the ring; no stale volume snapshot is restored. Source changes inherit the active factor, and disposal clears attenuation leases. All phone exits/unmounts release their lease.

## Original soundtrack

The source is `docs/references/music/pwaa-original-soundtrack.zip`, extracted unchanged in `docs/original_tracks/` (untracked). The 25 runtime copies are byte-identical, MPEG-1 Layer III, 44.1 kHz, 128 kbps, in `frontend/public/assets/music/original/`. Manifest: `assets/music/soundtrack.json`.

- **bgm (16):** 02, 03, 04, 05, 07, 10, 13, 14, 15, 16, 18, 19, 23, 30, 32, 33.
- **contextual (9):** 06, 08, 09, 11, 17, 20, 22, 24, 29. Never in the BGM pool.
- **excluded (9, manifest only, no runtime file):** 01, 12, 21, 25, 26, 27, 28, 31, 34.
- Profile `default` → Maya Fey – Turnabout Sisters 2001, alternative Initial Investigation 2001 (data only).

### Built-in loop methodology (D-044)

These are OST master MP3s, not DS sequence data. **No loop here is an original DS loop point.**

1. Decode each track in Chrome at 44,100 Hz (the file rate, so no resampling) and run the shipped analyser for proposals.
2. Independently search the 10 ms RMS envelope for the longest strongly repeating lag, and refine the lag at full rate by cross-correlation.
3. Score every candidate from either method on:
   - **coverage**: share of 3 s envelope windows after the seam whose NCC is > 0.95, from the seam until 2 s before the fade;
   - **envelope identity**: mean of those NCCs;
   - **seam**: 50 ms full-rate NCC after the jump, with the end refined by ±300 samples.
4. Re-score with the start slid later at the same lag. A start at the very top of the file lacks the decaying tail that precedes the loop end.
5. Accept only when coverage ≥ 0.70, envelope ≥ 0.92 and seam ≥ 0.95. Confidence = coverage × envelope × seam.

Exact sample-identity was **not** available, even for the best tracks. Second passes of these recordings are musically identical but not bit-identical (sub-millisecond timing/encoding differences), so the criteria above are musical rather than bit-exact.

| Track | startSample | endSample | Seconds | Confidence |
|---|---|---|---|---|
| 03 Court is Now in Session | 546840 | 2664135 | 12.400 – 60.411 | 0.79 |
| 04 Cross-Examination Moderato | 541680 | 2558119 | 12.283 – 58.007 | 0.96 |
| 08 Pursuit – Corner the Culprit | 370440 | 2064322 | 8.400 – 46.810 | 0.82 |
| 09 The Truth Revealed 2001 | 366030 | 1836374 | 8.300 – 41.641 | 0.74 |
| 13 Initial Investigation 2001 | 101430 | 2218725 | 2.300 – 50.311 | 0.99 |
| 14 Maya Fey – Turnabout Sisters 2001 | 3285850 | 3693182 | 74.509 – 83.746 | 0.88 |
| 15 Detention Center – The Security Guards' Elegy | 17191 | 2134488 | 0.390 – 48.401 | 0.99 |
| 16 Dick Gumshoe | 149940 | 2556020 | 3.400 – 57.960 | 0.92 |
| 17 Reminiscences – Maya's Sorrow | 39690 | 5685810 | 0.900 – 128.930 | 0.80 |
| 18 Marvin Grossberg | 17566 | 1899605 | 0.398 – 43.075 | 0.99 |
| 22 Reminiscences – DL-6 Incident | 39690 | 2509868 | 0.900 – 56.913 | 0.95 |
| 24 Reminiscences – The Class Trial | 15892 | 1074540 | 0.360 – 24.366 | 0.98 |
| 29 Reminiscences – SL-9 Incident | 149940 | 1991086 | 3.400 – 45.149 | 0.99 |
| 30 Ema Skye – Turnabout Sisters 2005 | 61740 | 2179035 | 1.400 – 49.411 | 0.98 |
| 32 Jake Marshall – Renegade Sheriff | 149940 | 2097915 | 3.400 – 47.572 | 0.83 |

All are at sampleRate 44100 with provenance `curated-analysis`. The 5 added during the 2026-10-24 finishing pass meet the unchanged metric thresholds; they have not been verified by listening. No loop is claimed to be an original Nintendo DS loop point.

## 2026-10-24 finishing pass

The built-in pass decoded all 15 previously-null runtime tracks in Chrome at 44,100 Hz, downmixed every channel to mono (matching the importer), and ran the shipped analyzer. Maya and Cross-Examination Moderato also received a slower multi-scale offline search: feature windows pooled at 1×/2×/4×/8× (about 93–418 ms), lag periods from 4–64 s sampled at about 90 ms, and feature similarity thresholds 0.50/0.60/0.70. Promising boundaries were refined with full-sample cross-correlation and a ≤2 ms common seam nudge. Post-seam envelope checks compare 3 s RMS-envelope windows at 0.5 s strides through 2 s before the fade. The existing acceptance thresholds were unchanged: coverage ≥0.70, envelope identity ≥0.92, seam correlation ≥0.95. Confidence is their product.

### Maya Fey – Turnabout Sisters 2001: best three candidates

Coverage is the share of feature windows across the proposed loop that match the next pass at cosine ≥0.50; similarity is their mean cosine. Jump smoothness is the 0.5 s full-rate seam correlation (higher is smoother); `jumpRatio` is the sample jump relative to nearby step size. Confidence uses the established post-seam envelope coverage × envelope identity × seam correlation score.

| start sample / time | end sample / time | repeat coverage | similarity | jump smoothness | confidence |
|---|---|---:|---:|---:|---:|
| 1,657,968 / 37.596 s | 2,065,070 / 46.827 s | 0.955 | 0.850 | 0.852 (jumpRatio 0.107) | 0.715 |
| **3,285,850 / 74.509 s** | **3,693,182 / 83.746 s** | **0.914** | **0.833** | **0.970 (jumpRatio 0.269)** | **0.882** |
| 25,542 / 0.579 s | 432,644 / 9.811 s | 0.929 | 0.834 | 0.920 (jumpRatio 0.004) | 0.807 |

The second candidate meets all existing thresholds (post-seam coverage 0.931, envelope identity 0.9773, seam 0.9700), so it is now the curated loop. The other two remain analysis-only. None is claimed as an original DS loop point or ear-verified.

### Cross-Examination – Moderato 2001: best three candidates

| start sample / time | end sample / time | repeat coverage | similarity | jump smoothness | confidence | disposition |
|---|---|---:|---:|---:|---:|---|
| 27,244 / 0.618 s | 2,043,713 / 46.343 s | 0.993 | 0.942 | 0.617 (jumpRatio 0.298) | 0.616 | rejected: seam |
| 16,490 / 0.374 s | 352,602 / 7.996 s | 0.780 | 0.701 | 0.974 (jumpRatio 1.164) | 0.969 | retained as a candidate only; under 8 s |
| **541,680 / 12.283 s** | **2,558,119 / 58.007 s** | **0.720** | **0.672** | **0.966 (jumpRatio 0.015)** | **0.962** | **curated loop** |

The selected long candidate meets the unchanged thresholds (post-seam coverage 1.000 over 66 windows, envelope identity 0.9958, seam 0.9664). The 7.996 s alternative also scores well, but was not selected because it is a short motif; no global/runtime threshold was changed.

**Still `loop: null` among playable tracks:** 02 Defendant Lobby – So It Begins; 05 Tricks and Deductions; 06 Phoenix Wright – Objection! 2001; 07 Cross-Examination – Allegro 2001; 10 Suspense; 11 Pursuit – Corner the Culprit (Variation); 19 Simple Folk; 20 Reminiscences – The Two Faces of a Studio; 23 Heart of the Investigation 2001; 33 Damon Gant – Swimming, Anyone.

**Excluded manifest-only tracks** continue to have `loop: null` by design: 01, 12, 21, 25, 26, 27, 28, 31 and 34. They have no runtime audio file.

**Listening:** no listening was performed. Every loop is metric-validated, not ear-validated. Manual listening remains desirable, especially for Maya, Cross-Examination Moderato, Initial Investigation and Suspense.

## Imported music (D-045)

- **Backend** `app/music/` + `app/api/music_routes.py` (registered in `main.py`), under `/api/music/imports`, local/same-origin only, `no-store`.
- **Storage:** `backend/.local/music/` (git-ignored; override with `COURTROOM_MUSIC_DIR`, or it follows `COURTROOM_CONFIG_DIR`). Files are stored as `<uuid-hex>.<ext>` with an atomic `library.json`.
- **Upload checks:**
  - streamed raw body with a hard 64 MB cap (413);
  - type decided by magic bytes, never by name (415);
  - title sanitised (paths, control characters and reserved names stripped);
  - strict 32-hex IDs, and resolved paths confined to the audio folder;
  - nothing ever executed;
  - no filesystem path or original filename returned;
  - at most 200 tracks;
  - corrupt index recovered.
- **Frontend:**
  - `importApi.ts` pre-checks the file and test-decodes it, which settles FLAC support for the browser in use;
  - `importedResolver.ts` serves the engine;
  - `useImportLibrary.ts` + `ImportLibraryPanel.tsx` + `LoopEditor.tsx` provide the UI;
  - a proposal is saved as `auto-detected`; Accept saves `user-accepted`, and nudging saves `user-adjusted`;
  - once a loop is stored, analysis is not re-run.
- **Loop editor:** start/end in seconds (3 decimals), confidence % with an honest label, Preview (background music pauses while it plays), Accept, Adjust with 100 ms, 5 ms and 1-sample nudges, a candidate list, an optional short crossfade, and Analyse again.

### Automatic loop analyser (`src/music/loop/`, Web Worker)

Mono downmix on the main thread, then everything else in `analysis.worker.ts`. Pipeline:
1. Decimate to ~11 kHz.
2. Level envelope → leading silence, trailing silence and fade-out.
3. 12 chroma bins + 8 band energies per 1024-point FFT frame (~46 ms hop).
4. Tempo from onset-flux autocorrelation (a weak prior only).
5. Lag scan: the longest high-similarity diagonal run of frame t against t+L. O(n²·d/2) on frames; tracks over 5000 frames are pooled.
6. Non-maximum suppression.
7. Sample-level refinement: exact-lag cross-correlation → walk back to the body start → a ≤ 2 ms common nudge for waveform continuity (zero-crossing style only after musical alignment).
8. Ranking and calibration.

**Confidence** = weighted geometric mean of similarity 0.40, refinement 0.25, margin 0.15, coverage 0.10 and seam 0.10, × (0.5 + 0.5 × level match), halved for a silent start, capped at 0.99. Labels: high ≥ 0.80, medium ≥ 0.50, low < 0.50. Recommended crossfade: 0 ms high, 10 ms medium, 25–40 ms low. Failures are typed (`too_short`, `silent`, `no_repetition`, `worker_failed`, `aborted`).

**Measured:** in Chrome, 0.3–0.8 s per 1–2.7 min OST track in the worker (decode 0.2–0.55 s). A synthetic 2 s intro + 3 × 8 s phrase WAV was detected at 2.001–10.001 s, 93 %.

The analyser's own confidence was **not** reliable on the OST: Defendant Lobby → "no repetition" although a strong repeat exists, and Maya → a 92 s candidate whose second pass cannot fully exist. That is why built-in loops are curated rather than auto-analysed at runtime.

## YouTube radio (D-046)

- Official IFrame Player API only, in a real visible 356×200 player in the Music dock outside the DS stage, never overlaid.
- Volume, play, pause and state go through the API; autoplay-blocked → "press Play", recovered by a real click.
- Errors 2/100/101/150/153/5, livestream ended, API unavailable and offline map to honest states.
- No download, scraping, proxying or extraction; a static test asserts it.
- The video ID is configuration (`radioVideoId` setting; a URL or 11-character ID).
- The current configurable Lofi Girl candidate is `EWrX250Zhko` (official oEmbed title matched on 2026-10-24), but the official IFrame API returned error 150 for the app origin. The preset is explicitly unavailable; the generic URL/ID input remains available for other embeddable videos. No workaround is used. Old saved preset ID `jfKfPfyJRdk` is reset to the current default.
- The playback path was verified with YouTube's IFrame API sample video `M7lc1UVf-VE` (playing, persisted).
