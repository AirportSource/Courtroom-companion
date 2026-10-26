# Music — Courtroom Companion

_Created 2026-10-24 (music + Court Record milestone). Decisions: D-043 (engine), D-044 (built-in loops), D-045 (imports), D-046 (radio). Updated 2026-10-25 (asset expansion: Trilogy discs 2-3, batch loop analyser, conversation music controls)._

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

Two local-only sources (D-071: nothing here is in Git; `frontend/public/assets/music/original/*.mp3` is git-ignored, so the new files are covered by the existing rule):

1. **PWAA original soundtrack ZIP** (https://archive.org/details/pwaa-original-soundtrack, 38 files): the 25 original runtime tracks (`original/NN-slug.mp3`, 128 kbps, MPEG-1 Layer III, 44.1 kHz).
2. **Trilogy "Original Soundtrack Remastered"** (3 discs, 104 MP3, about 192 min, 44.1 kHz stereo, ID3 album "Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered", artist JTPaper; a ZIP of the same 104 files is byte-identical to the discs). Disc 1 = Ace Attorney (the same pieces as the PWAA OST but different encodes, up to about 1.2 s length difference, so it is **not** substituted for the 25 originals, whose loop points were measured on the PWAA encodes), **Disc 2 = Justice for All**, **Disc 3 = Trials and Tribulations**. Disc 1 also holds one extra track (28 "Unused Track", 1:42) that is not integrated.

`soundtrack.json` entries gained optional, backward-compatible fields: `disc` (2 or 3; absent = PWAA OST numbering), `game` (`aa1`, `jfa` or `tnt`), `shortTitle` (player display name), `loudnessLufs`, and `loopReason` (why a looping candidate has no loop). `number` is the track number within its source (the PWAA OST, or the Trilogy disc).

### File layout and installer

- Originals: `original/NN-slug.mp3` (unchanged). Trilogy: `original/d2-NN-slug.mp3` and `original/d3-NN-slug.mp3` (NN = number on the disc, slug from the ID3 title).
- `python scripts/install_ost.py <source>...` (stdlib only; each source is a zip or a folder; read-only; copies unchanged; `--dry-run` lists first):
  - `python scripts/install_ost.py pwaa-original-soundtrack.zip` installs the 25 originals;
  - `python scripts/install_ost.py <folder holding Disc 1/2/3, or the remastered zip>` installs the 59 Trilogy tracks of discs 2-3 (it skips the originals unless `--disc1-substitute`, which matches Disc 1 by title and warns that loops may be offset);
  - both can be given together: 84 runtime tracks, about 210 MB.
- Runtime never references the source location. `validate:assets` and the manifest tests treat a missing OST as a notice. A source group (PWAA zip, disc 2, disc 3) must be installed completely or not at all.

### Integrated set (84 runtime tracks + 19 manifest-only)

| Source | bgm | contextual | excluded (no file) |
|---|---:|---:|---:|
| PWAA OST (AA, Disc 1) | 16 | 9 | 9 |
| Trilogy Disc 2 (JFA) | 19 | 10 | 5 (ringtone, 2 jingles, victory, ending) |
| Trilogy Disc 3 (T&T) | 21 | 9 | 5 (opening, 2 jingles/stingers, victory, ending) |
| **Total** | **56** | **28** | **19** |

Policy as before: BGM-worthy themes are `bgm` (selectable, in the BGM pool); objection, pursuit, truth-revealed, psyche-lock, reminiscence and ending-like cues are `contextual` (selectable, never in the BGM pool); openings, endings, victories, jingles/stingers under about 20 s and the phone ringtone are `excluded`.

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

| Track | startSample | endSample | Seconds | Confidence | Origin |
|---|---|---|---|---|---|
| 03 Court Is Now in Session (AA) | 1076040 | 3193335 | 24.40 - 72.41 | 0.92 | batch v1 |
| 04 Cross-Examination: Moderato (AA) | 541680 | 2558119 | 12.28 - 58.01 | 0.96 | kept, FAILS re-measure |
| 08 Pursuit: Corner the Culprit (AA) | 370440 | 2064322 | 8.40 - 46.81 | 0.82 | kept (curated 2026-10-24) |
| 09 The Truth Revealed (AA) | 908460 | 2378804 | 20.60 - 53.94 | 0.98 | batch v1 |
| 11 Pursuit: Corner (Variation) (AA) | 443282 | 2136934 | 10.05 - 48.46 | 0.96 | batch v1 |
| 13 Initial Investigation (AA) | 101430 | 2218725 | 2.30 - 50.31 | 0.99 | kept (curated 2026-10-24) |
| 14 Maya Fey (AA) | 2270966 | 5528236 | 51.50 - 125.36 | 0.67 | batch v1 |
| 15 Detention Center (AA) | 17191 | 2134488 | 0.39 - 48.40 | 0.99 | kept, FAILS re-measure |
| 16 Dick Gumshoe (AA) | 2285466 | 4691546 | 51.82 - 106.38 | 0.98 | batch v1 |
| 17 Maya's Sorrow (AA) | 39690 | 5685810 | 0.90 - 128.93 | 0.80 | kept (curated 2026-10-24) |
| 18 Marvin Grossberg (AA) | 17566 | 1899605 | 0.40 - 43.07 | 0.99 | kept, FAILS re-measure |
| 20 The Two Faces of a Studio (AA) | 1175192 | 2660929 | 26.65 - 60.34 | 0.89 | batch v1 |
| 22 The DL-6 Incident (AA) | 418950 | 2889128 | 9.50 - 65.51 | 0.95 | batch v1 |
| 24 The Class Trial (AA) | 15892 | 1074540 | 0.36 - 24.37 | 0.98 | kept, FAILS re-measure |
| 29 The SL-9 Incident (AA) | 149940 | 1991086 | 3.40 - 45.15 | 0.99 | kept (curated 2026-10-24) |
| 30 Ema Skye (AA) | 61740 | 2179035 | 1.40 - 49.41 | 0.98 | kept (curated 2026-10-24) |
| 32 Jake Marshall (AA) | 149940 | 2097915 | 3.40 - 47.57 | 0.83 | kept (curated 2026-10-24) |
| D2 02 Court Is Now in Session (JFA) | 361620 | 2478356 | 8.20 - 56.20 | 0.98 | batch v1 |
| D2 04 Magic and Tricks (JFA) | 776160 | 3195360 | 17.60 - 72.46 | 0.91 | batch v1 |
| D2 05 Objection! (JFA) | 1571712 | 2982912 | 35.64 - 67.64 | 0.81 | batch v1 |
| D2 08 The Truth Revealed (JFA) | 1627720 | 3509320 | 36.91 - 79.58 | 0.96 | batch v1 |
| D2 13 Initial Investigation (JFA) | 44100 | 1737540 | 1.00 - 39.40 | 0.74 | batch v1 |
| D2 14 Maya Fey (JFA) | 2064558 | 4303644 | 46.82 - 97.59 | 0.76 | batch v1 |
| D2 15 Detention Center (JFA) | 4410 | 2615130 | 0.10 - 59.30 | 0.91 | batch v1 |
| D2 21 More Simple Folk (JFA) | 1199468 | 2659307 | 27.20 - 60.30 | 0.65 | batch v1 |
| D2 23 Shelly de Killer (JFA) | 4410 | 3499323 | 0.10 - 79.35 | 0.96 | batch v1 |
| D2 27 Hotline of Fate (JFA) | 707474 | 1554194 | 16.04 - 35.24 | 0.97 | batch v1 |
| D3 05 Objection! (T&T) | 1702994 | 4084395 | 38.62 - 92.62 | 0.83 | batch v1 |
| D3 11 Godot (T&T) | 1541994 | 4523405 | 34.97 - 102.57 | 0.96 | batch v1 |
| D3 16 Detention Center (T&T) | 26460 | 2713168 | 0.60 - 61.52 | 0.83 | batch v1 |
| D3 18 Luke Atmey (T&T) | 564292 | 4092292 | 12.80 - 92.80 | 0.97 | batch v1 |
| D3 21 Trés Bien (T&T) | 1853464 | 3970264 | 42.03 - 90.03 | 0.93 | batch v1 |
| D3 23 Furio Tigre (T&T) | 1253658 | 3194058 | 28.43 - 72.43 | 0.97 | batch v1 |
| D3 26 The View from Dusky Bridge (T&T) | 17640 | 9521640 | 0.40 - 215.91 | 0.97 | batch v1 |
| D3 28 Hazakura Temple (T&T) | 3434136 | 6898613 | 77.87 - 156.43 | 0.98 | batch v1 |

All are at sampleRate 44100 with provenance `curated-analysis` and `status: measured_not_auditioned` (35 loops; the table is regenerated from `soundtrack.json` on 2026-10-25 and supersedes the 2026-10-24 table, see the re-measure notes below). No loop is claimed to be an original Nintendo DS loop point or verified by listening.

## 2026-10-24 finishing pass

_Historical. The 2026-10-25 batch re-measure (below) supersedes the loop numbers and the "still `loop: null`" list of this section; five of its loops did not re-measure._

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

## 2026-10-25 asset expansion (worker D)

### Batch loop analyser (`scripts/analyse_loops.py`)

Offline, Python (numpy plus any ffmpeg: `pip install numpy imageio-ffmpeg`). It reads the **installed runtime MP3s** (never another location) and implements the D-044 metric validation unchanged. Usage: `python scripts/analyse_loops.py [--ids a,b] [--write] [--replace-if-better] [--jobs N] [--report out.json]`; `--gains [--write]` measures loudness only.

1. ffmpeg decodes to 44.1 kHz mono (all channels averaged). This was checked to be **sample-identical to Chrome's `decodeAudioData`** for the same MP3 (same length, correlation 1.0, offset 0), so loop samples carry over to the browser.
2. Candidate lags: 32 log bands plus 12 chroma per 4096-sample frame (hop 2048, about 46 ms), cosine similarity along every lag diagonal, the longest repeating run per lag at similarity thresholds 0.80, 0.70 and 0.60 (6 non-maximum-suppressed candidates each), lag at least 8 s.
3. Full-rate cross-correlation refines the lag; the start then slides from 1 s before to 25 s after the run start in 100 ms steps (a start at the top of the file lacks the decaying tail that precedes the loop end).
4. Metrics, identical to D-044: coverage (share of 3 s windows, 0.5 s stride, of the 10 ms RMS envelope after the seam whose NCC against the same window after the loop start is > 0.95, from the seam until 2 s before the fade), envelope identity (mean NCC) and seam (50 ms full-rate NCC after the jump, end refined by +-300 samples). Fade start = the last time the 1 s level is at least 60% of the body level.
5. Accepted only if coverage >= 0.70, envelope >= 0.92, seam >= 0.95, loop >= 8 s and at least 4 windows. confidence = coverage x envelope x seam. Ranking prefers loops up to 40 s (preference = confidence x (0.85 + 0.15 x min(1, length / 40 s))); ties keep the earliest start.
6. Existing curated loops are re-measured with the same code and are replaced only when the old one fails the thresholds or the new one is at least 0.05 confidence better; otherwise they are kept. A failing re-measure with no replacement keeps the loop and appends a note.

The analyser reproduced the documented metrics of the 10 first-pass loops (for example Initial Investigation 0.99, Jake Marshall 0.81, Ema Skye 0.98) but **could not reproduce the five added in the 2026-10-24 finishing pass**: Cross-Examination Moderato, Detention Center (guards), Marvin Grossberg, The Class Trial and Maya Fey 2001. Their documented coverage/envelope numbers do not hold under the same metric (coverage 0.00-0.31, envelope 0.65-0.91 at the stored samples). Their 50 ms seam correlation is fine (0.85-0.98): the jump is locally smooth, but the music after it is not a repeat of the loop start. Maya Fey 2001 was replaced by a passing candidate; the other four are kept unchanged (not overwritten) with an appended note and **need listening, or a decision to set them to `null`**.

Results (84 runtime tracks): **35 loops, 49 `loop: null`** (each null has a `loopReason`). Of the loops, 24 have confidence >= 0.90, 7 are 0.80-0.89 and 4 are 0.65-0.79. Methods: `lag-diagonal+xcorr-v1` for 25 (20 new tracks and 5 replacements) and `curated-chrome-analysis-v1` for the 10 unchanged 2026-10-24 loops (6 re-measure as passing and 4 fail, as listed above). Replaced because strictly better on re-measure: Court Is Now in Session (0.86 to 0.92), The Truth Revealed (0.77 to 0.98), Dick Gumshoe (0.86 to 0.98), The DL-6 Incident (0.89 to 0.95; same lag, rotated start) and Maya Fey 2001 (the failing 9.2 s motif replaced by a 73.9 s loop, confidence 0.67, borderline coverage 0.71). Tracks without a loop play to the end and restart (the existing fallback). Many null tracks are through-composed or vary on the second pass (Franziska, Miles, Larry, Pearl, the Pursuit variations). The nearest misses (seam 0.90-0.95: Allegro 2002, Initial Investigation 2002, Kurain Village) stay null because the thresholds are unchanged.

### Loop status field

`loop.status` (`measured_not_auditioned` or `auditioned`) and `loop.method` are optional and lenient in `parseLoopMetadata` (unknown values are dropped; old files without them still parse). **Every loop in the manifest is `measured_not_auditioned`.** A person who listens should set `auditioned`, or null the loop.

### Loudness

`python scripts/analyse_loops.py --gains --write` measures EBU R128 integrated loudness with ffmpeg and stores `loudnessLufs` plus a linear per-track `gain` aiming at -15 LUFS (sample peak kept under -1 dBFS when boosting, boost at most x2). The source spread was -20.5 to -6.8 LUFS (the PWAA tracks -17.0 to -12.1), so prev/next would otherwise jump up to 14 dB. Gains now range from 0.39 to about 1.4. Measured, not auditioned.

### Dev loop audition

In dev builds `MusicDock` shows a **Seam (-5s)** button while a track plays or is paused. It calls `MusicEngine.seek(loopEnd - 5 s)` so the wrap-around is heard within 5 s (the tooltip shows the loop region; the button reads "No loop" and is disabled for tracks without one). `seek()` and `getPlaybackInfo()` are optional members of the source contract (the Web Audio sources implement them, radio does not); `window.__ccMusic.engine.getPlaybackInfo()` also reports position, duration and loop in the console.

### Conversation music controls (D-081 proposal)

Precedence while a conversation is open (pure functions in `src/music/conversationMusic.ts`, unit tested):

1. a **live override** chosen in the conversation (prev, next, select, return to theme);
2. the **track fixed in Settings** (a Track other than the default entry);
3. the **character's theme**: the `soundtrack.json` profile `defaultTrack` for the conversation's character, then the `default` profile.

Override scope: one conversation session with one character. It survives while that conversation stays open and is dropped when the scene changes to a menu or the conversation character changes (the next conversation starts from Settings or the new character's theme). It is never persisted. It applies only while the Settings music source is "Game music" (imported tracks and Radio ignore it; "Off" stays off). Selecting what would play anyway clears the override; `resetToTheme()` selects the character theme.

Implementation: `conversationMusicStore.ts` (non-React store: override and loaded manifest); `useMusicSync` reads and reconciles it, so App needs no change and there is still exactly one playback path through the engine, which never restarts an unchanged track; `useConversationMusic(characterId, soundtrack?)` returns `{available, trackId, title, shortTitle, themeTrackId, baselineTrackId, isOverride, status, playing, trackList, next, prev, toggle, select, resetToTheme}`; `ConversationMusicControls.tsx` is a minimal unstyled component (className, labels and icons props, `data-music-*` state attributes, render-prop children). It is not mounted by the app; the UI owner places it. Ducking and the phone ringtone live in the engine and are unaffected.

### Character themes (profiles in `soundtrack.json`)

Existing profiles are unchanged (Maya, Gumshoe, Mia, default); Maya gained two alternatives. New: `phoenix_wright` Court Is Now in Session (his Objection! theme is contextual, and profiles require bgm tracks), `ema_skye` Ema Skye 2005, `miles_edgeworth` Triumphant Return - Miles Edgeworth (JFA 26), `franziska_von_karma` Triumphant Return - Franziska von Karma (JFA 30), `larry_butz` When Something Smells, It's Usually Me (T&T 19), `pearl_fey` Pearl Fey - With Pearly (JFA 24), `diego_armando` and `godot` Godot - The Fragrance of Darkness; That is Coffee (T&T 11). Data-only profiles for future characters: marvin_grossberg, damon_gant, jake_marshall, dahlia_hawthorne, shelly_de_killer, luke_atmey, mask_demasque, victor_kudo, furio_tigre, elise_deauxnim. Generic picks: calm/investigation = Initial Investigation and Further Investigation, courtroom = Court Is Now in Session, tension = Cross-Examination Allegro, Suspense, Hotline of Fate.

### Music-player UI assets (for the UI owner)

The `_b _f _g _k _l _s _t _u` suffixes of `other assets/UI/musicPlayer_*` are **interface languages, not games**. The "BGM" icon labels read: no suffix BGM, `b` Musica, `f` Musique, `g` Musik, `k` BGM, `l` Musica, `s` Simplified Chinese, `t` Traditional Chinese, `u` BGM. The ID3 album is the same on every disc, so it cannot map jackets to games.

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

## Original DS migration (D-088, 2026-10-26; supersedes expansion source totals)

Policy: pre-existing valid audio → preserve; expansion remaster additions → original DS replacements only with confident same-game mapping. 25 older runtime entries/audio hashes are unchanged, including current loops/gains. 55 of 59 expansion files replaced; 4 REVIEW remain untouched. IDs, character themes, MusicEngine, blips, SFX and ringtone behavior are unchanged.

Runtime: 28 byte-identical DS JFA MP3s plus 27 lossless FLAC derivatives of NCSF123 T&T PCM16 WAVs at native 32,728 Hz; no resampling/EQ/normalization during asset conversion. All 27 FLAC decoded PCM checks match their sources. Native-rate FLAC uses the existing browser decode path. New gains are unity; old remaster loudness values and loops were discarded. Superseded MP3s are preserved in ignored `backend/.local/audio-migration/remaster-backup/`, outside shipped assets.

Existing loop tooling ran **only** for the 55 replacements: 21 `measured_not_auditioned`, 34 `whole_file`, each with analysis/rejection evidence. Temporary 44.1 kHz mono analysis does not alter native-rate assets; sample metadata uses that analysis rate and the engine converts it to seconds. No audio was physically auditioned. Human seam/volume review remains necessary. KEEP/REVIEW loops were not recalculated.

Auditable per-ID classifications/mappings/hashes/backups: `scripts/data/ds_audio_migration.json`. Fresh analysis: `scripts/data/ds_loop_analysis.json`. Installation/replay: `scripts/migrate_ds_audio.py --help`; `--finalize-analysis scripts/data/ds_loop_analysis.json` verifies results (add `--write` to save statuses), `--verify-lossless` verifies PCM identity with the supplied source root and ffmpeg. The remaster installer skips DS-provenance entries. Runtime files remain git-ignored; Windows packaging still excludes original soundtrack unless explicitly included for a personal build.

REVIEW: bonus Prosecutor's Path; The Stolen Turnabout (two-part source); Recipe for Turnabout (unlabelled correspondence); Pursuit 2004 variation. Full implementation, browser playback/control/ducking results and limitations: [migration report](PRESENTATION_DS_MIGRATION.md).

## Structural loop pass (2026-10-26, worker B; supersedes the loop numbers of the DS migration above, not its audio)

**Problem.** After the original-DS migration (D-088) only 21 of 55 replacements had a loop and 34 played through to the end. The D-044 acceptance test compares the 10 ms RMS *envelope* of the second pass with the first at NCC > 0.95. The DS renders repeat musically but not waveform- or envelope-identically (reverb/LFO state, sub-millisecond timing; 1 s waveform NCC between passes is only 0.3-0.9 while chroma similarity is 0.95+), so almost every track failed it although most are clearly `[intro?] + loop body + repeat`.

**Method** (`scripts/analyse_loops_structural.py`, deterministic, evidence in `scripts/data/ds_loop_analysis_v2.json`; the older `analyse_loops.py` and `ds_loop_analysis.json` are kept as history):

1. 32 log-band + 12 chroma features per 46 ms frame (shared with `analyse_loops.py`).
2. Lag profile: for each lag from 6 s to 0.8 of the track, cosine self-similarity along the diagonal, smoothed over 0.7 s, thresholded at 0.72, gaps up to 1.5 s bridged; the longest repeated run `[r0, r1]` and its mean similarity. Ranking favours the longest, most similar repeat; loops shorter than `min(0.4 x track, 30 s)` are only accepted when flagged `short` (psyche_locks among the DS scope).
3. Lag refined at full rate (median of cross-correlations at six anchors inside the run).
4. Phase: the composition restarts at `s_k = r0 + k x lag`. Each k whose seam has at least 3 s of repeated material after it and whose end is not inside the closing fade is evaluated, and **the latest k whose seam is within 0.04 of the best is chosen**, so as much of the composition as possible plays before the first loop-back. The start snaps to a strong onset near `s_k` (just before the attack); the end is searched at full rate (+-300 samples).
5. Seam gate: 50 ms waveform NCC of the material after the jump against the render's own continuation at the loop end (`post`, must be >= 0.85; later phases also score 25% of the pre-seam NCC), stereo click ratio (`|step across the seam| / local sample step`, <= 3), level step within 4 dB of the natural step, repeat similarity >= 0.80 (>= 0.75 only when the repeated run covers a whole cycle; confidence x0.85). Start and end are then slid together (+-120 samples) to the lowest click ratio, preferring rising zero crossings.
6. Recorded per track: lag, repeat run, similarity, tail/body similarity, pre/post NCC, click ratio, level step, tempo and beats per loop (informational; the estimator is coarse), first-loop-back share, confidence (similarity x seam x support, capped at 0.95).

Units and decoder timeline: positions are stored in **44,100 Hz samples** with `sampleRate: 44100`, exactly like every earlier loop (the engine divides by `sampleRate`, so the native 32,728 Hz FLACs and the MP3s share one convention). ffmpeg's MP3 decode (encoder delay/padding handled the same way) was already shown sample-identical to Chrome's `decodeAudioData` (D-085); FLAC is resampled by ffmpeg and by Chrome to the context rate, and both map a time to within one sample at 44.1 kHz, which the zero-crossing alignment tolerates. Nothing was physically listened to.

**Results.** Scope: the 55 DS replacements and `maya_fey_turnabout_sisters_2001`. The other 24 pre-expansion tracks and the 4 REVIEW tracks were analysed for evidence only; their manifest entries stay untouched (D-088 preserves them).

| Group | Count | Result |
|---|---:|---|
| DS replacements, previously whole-file, now a structural loop | 30 | new `measured_not_auditioned` loops |
| DS replacements, previously a strict-v1 loop, replaced by a structural loop of the same period at a later phase | 20 | the first loop-back moves from 45-87% to 85-96% of the track; same repeat lag, lower click ratio |
| DS replacement kept: `initial_investigation_2002` | 1 | same period and phase as v2, the v1 seam is better (post NCC 1.00 against 0.91) |
| DS replacements that stay whole-file | 4 | reasons below |
| `maya_fey_turnabout_sisters_2001` (Maya/Mia default) | 1 | re-curated, see below |

Every new loop is `provenance: curated-analysis`, `status: measured_not_auditioned` (and `loopStatus` likewise); the notes say "Not an original DS loop point; not verified by listening". **No loop has been auditioned.**

Remaining whole-file DS tracks (the `loopReason` carries the text): `hotline_of_fate` (48 s; the strongest repeat, lag 19.2 s, runs 17 s at similarity 0.78, less than a whole cycle: insufficient repeated material, needs audition), `one_prosecutors_musings_until_we_meet_again` (56 s ending-style cue: non-looping), `turnabout_beginnings` (50 s: non-looping cue), `reminiscences_pure_pain` (a repeat exists but the post-seam NCC is 0.80 < 0.85: uncertain seam, needs audition).

### Turnabout Sisters 2001 (Maya and Mia default theme)

The track is 161.13 s. The composition has a 73.86 s period starting at the top of the file (self-similarity 0.87 for 0-80 s at lag 73.89; a third pass begins at 147.8 s and fades). The old loop (51.50-125.36 s) used the right period but a mid-cycle phase, so the first loop-back came at 78% of the track.

| | loopStart | loopEnd | length | first loop-back | post-seam NCC | click ratio | level step |
|---|---|---|---|---|---:|---:|---:|
| old (lag-diagonal+xcorr-v1) | 2,270,966 (51.50 s) | 5,528,236 (125.36 s) | 73.86 s | 77.8% | 0.977 | 0.58 | -1.6 dB |
| new (structural v2) | 3,260,773 (73.94 s) | 6,518,044 (147.80 s) | 73.86 s | 91.7% | 0.990 | 0.19 | +0.5 dB (natural step there: +0.6 dB) |

The new boundary is the second return of the composition's opening (0 s, 73.9 s, 147.8 s), so playback covers the whole first and second pass (22 s more material than before) before the first wrap, and every later wrap re-enters at the composition's own restart rather than at an arbitrary phrase position. The loop is exactly one period, the seam matches the render's own pass-to-pass continuation (post NCC 0.990, pre NCC 0.970), and start and end sit on matching rising zero crossings. Confidence 0.87 (repeat similarity 0.87 is the weakest ingredient: the second pass varies slightly in orchestration). Not auditioned.

### Loops written (samples at 44,100 Hz)

| Track id | startSample | endSample | Seconds | Length s | Back at | Sim. | Post NCC | Conf. |
|---|---|---|---|---:|---:|---:|---:|---:|
| maya_fey_turnabout_sisters_2001 | 3260773 | 6518044 | 73.94 - 147.80 | 73.9 | 92% | 0.87 | 0.99 | 0.87 |
| defendant_lobby_so_it_begins_again | 118517 | 1812494 | 2.69 - 41.10 | 38.4 | 46% | 0.95 | 0.91 | 0.91 |
| justice_for_all_court_is_now_in_session | 2143595 | 4261007 | 48.61 - 96.62 | 48.0 | 88% | 0.98 | 0.99 | 0.95 |
| cross_examination_moderato_2002 | 1760533 | 3489432 | 39.92 - 79.13 | 39.2 | 90% | 0.96 | 0.99 | 0.95 |
| magic_and_tricks | 2419410 | 4839405 | 54.86 - 109.74 | 54.9 | 92% | 0.88 | 0.96 | 0.79 |
| objection_2002 | 2171797 | 3583405 | 49.25 - 81.26 | 32.0 | 90% | 0.91 | 0.98 | 0.91 |
| cross_examination_allegro_2002 | 1956045 | 3922280 | 44.35 - 88.94 | 44.6 | 90% | 0.97 | 0.99 | 0.95 |
| pursuit_confront_the_culprit | 1732840 | 3144449 | 39.29 - 71.30 | 32.0 | 89% | 0.84 | 0.87 | 0.79 |
| the_truth_revealed_2002 | 1881659 | 3763803 | 42.67 - 85.35 | 42.7 | 85% | 0.96 | 1.00 | 0.95 |
| pursuit_confront_the_culprit_variation | 1464163 | 2875772 | 33.20 - 65.21 | 32.0 | 87% | 0.88 | 1.00 | 0.88 |
| psyche_locks | 1437210 | 2728427 | 32.59 - 61.87 | 29.3 | 77% | 0.90 | 0.97 | 0.81 |
| initial_investigation_2002 | 22050 | 1716025 | 0.50 - 38.91 | 38.4 | 45% | - | - | 0.98 |
| maya_fey_turnabout_sisters_2002 | 10184 | 2249825 | 0.23 - 51.02 | 50.8 | 46% | 0.84 | 0.95 | 0.84 |
| detention_center_the_security_cameras_elegy | 2611230 | 5222614 | 59.21 - 118.43 | 59.2 | 93% | 0.96 | 0.99 | 0.95 |
| kurain_village | 2140736 | 4144651 | 48.54 - 93.98 | 45.4 | 90% | 0.93 | 1.00 | 0.93 |
| reminiscences_fire_licked_scars | 3024320 | 6049261 | 68.58 - 137.17 | 68.6 | 93% | 0.97 | 0.99 | 0.95 |
| eccentrics | 2021024 | 4020802 | 45.83 - 91.17 | 45.3 | 91% | 0.90 | 1.00 | 0.90 |
| berry_big_circus | 24150 | 1791876 | 0.55 - 40.63 | 40.1 | 45% | 0.96 | 0.98 | 0.95 |
| more_simple_folk | 1503802 | 2964119 | 34.10 - 67.21 | 33.1 | 88% | 0.98 | 1.00 | 0.95 |
| shelly_de_killer_a_deadly_gentlemans_delight | 1752795 | 3500762 | 39.75 - 79.38 | 39.6 | 89% | 0.92 | 0.98 | 0.92 |
| pearl_fey_with_pearly | 1316476 | 2602180 | 29.85 - 59.01 | 29.2 | 84% | 0.92 | 0.96 | 0.92 |
| further_investigation_2002 | 2047890 | 4073171 | 46.44 - 92.36 | 45.9 | 91% | 0.96 | 0.99 | 0.95 |
| triumphant_return_miles_edgeworth | 1881800 | 3354754 | 42.67 - 76.07 | 33.4 | 88% | 0.93 | 0.96 | 0.93 |
| heart_of_the_investigation_2002 | 2255601 | 4373011 | 51.15 - 99.16 | 48.0 | 90% | 0.97 | 0.99 | 0.95 |
| reminiscences_ballad_of_the_steel_samurai | 2672759 | 5346174 | 60.61 - 121.23 | 60.6 | 93% | 0.96 | 1.00 | 0.95 |
| triumphant_return_franziska_von_karma | 1867678 | 3353498 | 42.35 - 76.04 | 33.7 | 88% | 0.87 | 0.91 | 0.79 |
| defendant_lobby_so_it_will_always_begin | 2303352 | 4255909 | 52.23 - 96.51 | 44.3 | 90% | 0.89 | 0.98 | 0.89 |
| trials_and_tribulations_court_is_now_in_session | 2816836 | 5633688 | 63.87 - 127.75 | 63.9 | 93% | 0.91 | 0.98 | 0.90 |
| cross_examination_moderato_2004 | 4220804 | 8441820 | 95.71 - 191.42 | 95.7 | 95% | 0.97 | 1.00 | 0.95 |
| objection_2004 | 2438967 | 4827934 | 55.31 - 109.48 | 54.2 | 92% | 0.86 | 1.00 | 0.86 |
| cross_examination_allegro_2004 | 3297029 | 6563887 | 74.76 - 148.84 | 74.1 | 94% | 0.94 | 0.99 | 0.94 |
| pursuit_catch_the_culprit | 2384922 | 4752461 | 54.08 - 107.77 | 53.7 | 87% | 0.93 | 0.99 | 0.93 |
| the_truth_revealed_2004 | 2491700 | 4998641 | 56.50 - 113.35 | 56.8 | 91% | 0.99 | 1.00 | 0.95 |
| pursuit_catch_the_culprit_variation | 2384851 | 4752390 | 54.08 - 107.76 | 53.7 | 91% | 0.94 | 0.98 | 0.94 |
| dahlia_hawthorne_the_visage_of_what_once_was | 3069732 | 6138891 | 69.61 - 139.20 | 69.6 | 93% | 0.96 | 1.00 | 0.95 |
| godot_the_fragrance_of_darkness_that_is_coffee | 3040210 | 6031028 | 68.94 - 136.76 | 67.8 | 93% | 0.96 | 1.00 | 0.95 |
| initial_investigation_2004 | 2425430 | 4822923 | 55.00 - 109.36 | 54.4 | 92% | 0.90 | 1.00 | 0.90 |
| lordly_tailor | 2724700 | 5435560 | 61.78 - 123.26 | 61.5 | 93% | 0.93 | 1.00 | 0.93 |
| detention_center_the_prisoners_elegy | 2694868 | 5390060 | 61.11 - 122.22 | 61.1 | 93% | 0.98 | 1.00 | 0.95 |
| mask_demasque_please_listen_to_meeeee | 233548 | 2053615 | 5.30 - 46.57 | 41.3 | 48% | 0.93 | 0.94 | 0.92 |
| luke_atmey_look_at_me | 2299787 | 4069392 | 52.15 - 92.28 | 40.1 | 90% | 0.98 | 1.00 | 0.95 |
| larry_butz_when_something_smells_its_usually_me | 2376196 | 4692812 | 53.88 - 106.41 | 52.5 | 92% | 0.97 | 1.00 | 0.95 |
| tres_bien | 2142055 | 4265582 | 48.57 - 96.73 | 48.2 | 86% | 0.97 | 1.00 | 0.95 |
| victor_kudo_martial_anthem_of_misery | 2004615 | 4016389 | 45.46 - 91.07 | 45.6 | 85% | 0.95 | 0.99 | 0.95 |
| furio_tigre_swingin_tiger | 2176897 | 4123463 | 49.36 - 93.50 | 44.1 | 90% | 0.88 | 1.00 | 0.88 |
| reminiscences_violetta_vitriol | 3503494 | 6984640 | 79.44 - 158.38 | 78.9 | 94% | 0.99 | 1.00 | 0.95 |
| reminiscences_the_view_from_dusky_bridge | 4766612 | 9533717 | 108.09 - 216.18 | 108.1 | 96% | 0.97 | 1.00 | 0.95 |
| hazakura_temple | 404552 | 3879937 | 9.17 - 87.98 | 78.8 | 50% | 0.97 | 1.00 | 0.95 |
| elise_deauxnim_a_gentle_melody | 3317500 | 6596570 | 75.23 - 149.58 | 74.4 | 94% | 0.97 | 0.97 | 0.95 |
| further_investigation_2004 | 2667139 | 5215325 | 60.48 - 118.26 | 57.8 | 86% | 0.93 | 1.00 | 0.93 |
| reminiscences_the_bitterness_of_truth | 3205056 | 6308778 | 72.68 - 143.06 | 70.4 | 93% | 0.91 | 0.99 | 0.91 |
| pursuit_corner_the_culprit_2004 | 282939 | 1981806 | 6.42 - 44.94 | 38.5 | 48% | 0.76 | 0.99 | 0.65 |

"Back at" is the share of the track heard before the first loop-back. `initial_investigation_2002` is the kept v1 loop (its v1 metrics are in `ds_loop_analysis.json`).

### Needs human listening first

`pursuit_corner_the_culprit_2004` (repeat similarity 0.76, confidence 0.65), `magic_and_tricks` and `pursuit_confront_the_culprit` (0.79), `triumphant_return_franziska_von_karma` (0.79), `maya_fey_turnabout_sisters_2002` (0.84, back at 46%), `psyche_locks` (flagged short, 29 s), `defendant_lobby_so_it_begins_again` (post NCC 0.91, back at 46%), and the default theme `maya_fey_turnabout_sisters_2001` itself. The dev **Seam (-5s)** button in `MusicDock` seeks to 5 s before `loopEnd`, so it works unchanged with every new point.

### Evidence-only recommendations (not applied)

The structural pass finds credible loops for pre-expansion KEEP tracks that currently have `loop: null` (`defendant_lobby_so_it_begins` 34.6-68.2 s, `tricks_and_deductions`, `objection_2001`, `cross_examination_allegro_2001`, `heart_of_the_investigation_2001` 52.9-104.9 s, `simple_folk`, `damon_gant_swimming_anyone`, `suspense`), for two REVIEW tracks (`bonus_prosecutors_path_miles_and_fran`, `pursuit_corner_the_culprit_2004_variation`), and a far later alternative for the four D-085 "fails re-measure" loops (`cross_examination_moderato_2001`, `detention_center_the_security_guards_elegy`, `marvin_grossberg_reckonings_and_regrets_of_an_aged_attorney`, `reminiscences_the_class_trial`). They are recorded in `ds_loop_analysis_v2.json` (`disposition: evidence only`) and await a decision, because D-088 preserves those entries byte for byte.

Reproduce: `python scripts/analyse_loops_structural.py --scope all --report scripts/data/ds_loop_analysis_v2.json` (add `--write` to store loops). The report's `previousLoop` fields record the manifest as it was before this pass; a re-run after `--write` would record the structural loops as "previous". Tests: `frontend/tests/musicLoops.test.ts` (ids/src snapshot in `frontend/tests/fixtures/soundtrack-ids-src.json`, ranges, status, reasons, Turnabout Sisters) and the adapted `frontend/tests/dsAudioMigration.test.ts` (which now reads `ds_loop_analysis_v2.json` and allows only the Maya 2001 loop to differ from its pre-expansion entry).

## Conversation strip track list (2026-10-26, D-097)

The music strip's list button opens a menu of every selectable soundtrack track (same pool and order as next/prev). Choosing one is the same live override as next/prev: it lasts for the conversation, is never saved, and the Theme button returns to the character's theme.
