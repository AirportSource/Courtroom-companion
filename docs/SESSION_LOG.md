# Session Log — Courtroom Companion

_Append-only. Add a new dated entry at the bottom for each substantial session. Never edit or delete past entries; if an entry was wrong, add a correction in a later entry._

---

## 2026-10-24 — Project initialization audit

**Inspected**
- `git status`, branch (`main`, up to date with `origin/main`), log (7 commits, HEAD `69d03ab`), remote `origin`.
- Full repo tree; `CLAUDE.md`; all 11 skills in `.claude/skills/` (focused on repo-inspector, asset-pipeline, git-safety).
- `frontend/package.json`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `index.html`, `src/*`.
- Root `.gitignore` (only one in repo); README/LICENSE (both empty); `docs/` and `tests/` (only `.gitkeep`).
- Every file in `frontend/public/`: PNG dimensions and WAV headers read directly; SHA-1 duplicate check.
- `audio.json` and `character.json` validated programmatically against the filesystem.
- Tracked vs on-disk comparison (`git ls-files` vs `find`): identical, 168 files; `public/` is not git-ignored.

**Changed**
- Created persistent project docs. No code, assets, manifests or Git state were modified. Nothing committed.

**Files created**
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/ASSET_INVENTORY.md`
- `docs/SESSION_LOG.md`

**Important findings**
- Frontend is an unmodified Vite starter; the 4 component files are empty. `App.tsx` imports `src/assets/*`, which doesn't exist, so the build is expected to fail.
- Node.js/npm are not installed on this machine and `node_modules` is absent, so no build/lint was run.
- `character.json`: default animation points to `sprites/neutral_front` but the folder is `netural_front`; `side_idle` and `side_praying` folders don't exist; the manifest doesn't model `idle/`/`talking/` subfolders.
- Sprite structure: `smile_front` idle is nested in `talking/idle/`; `thinking_side` has no idle; `arms_open/talking/maya_frame_024 (1).png` has a different size (63×111 vs 94×107), so it may belong to another pose; frame-number gaps at 018 and 063–065.
- `audio.json` blip paths are wrong (`blips/female.wav` vs the actual `blips/blip_female/blipfemale.wav`, same for male).
- Asset location is split: audio is under `public/assets/`, but backgrounds and characters sit directly under `public/` (logged as Open decision D-008).
- No music, UI images or visual effect assets exist.
- 3 backgrounds have off-by-one sizes (19, 22, 24).
- Git history shows `frontend/public` was briefly untracked (`662e89e`) and then re-tracked (`69d03ab`), recorded as D-002.

**Unresolved issues**
- D-008 asset location convention: not decided yet.
- Need to visually confirm which pose frame 024 belongs to, and whether `clasped_hands_happy/talking` (8 frames) holds one sequence or two.
- Need to decide whether `thinking_side` gets an idle (e.g. reuse a talking frame) or stays talking-only with a fallback.
- `.claude/` and `CLAUDE.md` are untracked; the owner needs to decide whether to commit them.
- Install Node.js so a build/lint baseline can be established.

**Recommended next task**
Stabilize Maya's character assets: propose a rename/fix mapping for the issues above (folder typo, misnested idle, missing folders, suspect frame, filename spaces), get approval, apply it, then update `character.json` so every animation resolves to real idle/talking frame lists. Resolve D-008 first, since it affects where those files end up.

---

## 2026-10-24 — Fix production build (obsolete Vite demo imports)

**Inspected**
- `frontend/src/App.tsx`, `frontend/src/` tree, `frontend/public/` tree, and references to `hero`, `react.svg`, `vite.svg`, `icons.svg`, `favicon` across `frontend/`.
- Git history of the missing files (`git log --all --name-status`).
- Reproduced the failure: `npm run build` → 3× `UNRESOLVED_IMPORT` for `./assets/hero.png`, `./assets/react.svg`, `./assets/vite.svg` in `src/App.tsx`.

**Root cause**
- `App.tsx` is unchanged from the Vite scaffold (initial commit `8d9d664`). Commit `2c3e957` ("added assets") deleted `frontend/src/assets/{hero.png,react.svg,vite.svg}` plus `public/favicon.svg` and `public/icons.svg`, and added a copy of `hero.png` at `public/assets/hero.png`. The imports were left behind.
- These were Vite demo assets, not application dependencies. Their only users were the starter page's hero block and two link logos.

**Changed**
- `frontend/src/App.tsx`: removed the 3 imports, the `.hero` `<div>` (3 `<img>`), and the 2 logo `<img>` tags in the "Documentation" links (−10 lines, no additions). No placeholder files were created and no assets were touched.
- `docs/PROJECT_STATE.md`: frontend status, what works, phase.
- `docs/ROADMAP.md`: ticked the two Phase 0 build-baseline items.

**Validation**
- Node v24.22.1 / npm 11.19.1, from `C:\Program Files\nodejs`. It was not on the session `PATH`, so it was prepended manually.
- `npm run build`: **pass** (exit 0). tsc OK; vite 8.3.5 transformed 17 modules; output `dist/index.html` 0.47 kB, CSS 4.10 kB, JS 192.77 kB (60.46 kB gzip).
- `npm run lint`: **pass** (exit 0), no oxlint diagnostics.

**Unresolved issues**
- `frontend/package-lock.json` has uncommitted changes from the user's prior `npm install` (timestamp matches `node_modules`; transitive version bumps). Not caused by this change; left for the owner to commit or revert.
- Runtime-only 404s remain for `/favicon.svg` (index.html) and `/icons.svg` (App.tsx). `.hero` CSS and `public/assets/hero.png` are unused. All of these are starter-page leftovers, to be removed when the scene UI replaces `App.tsx`.

**Recommended next task**
Unchanged: stabilize Maya's character assets (resolve D-008 first).

---

## 2026-10-24 — Runtime asset stabilization & manifests

**Inspected**
- Docs, `CLAUDE.md`, skills (repo-inspector, asset-pipeline, character-engine, audio-engine, git-safety, testing).
- All files under `frontend/public/`. Searched `frontend/` code for asset path references and found none outside the manifests themselves.
- Built contact sheets of every Maya frame and all backgrounds (stdlib PNG decoder in the scratchpad) to resolve ambiguous groups visually.

**Changed**
- Moved `frontend/public/characters/` → `frontend/public/assets/characters/` and `frontend/public/backgrounds/` → `frontend/public/assets/backgrounds/` (`git mv`; D-010).
- Maya sprite fixes, all via `git mv` (D-013):
  - `netural_front` → `neutral_front`.
  - `smile_front/talking/idle/*` → `smile_front/idle/`.
  - `thinking_side/talking/047–050` → `thinking_side/idle/`.
  - `arms_open/idle/021` → `arms_open/talking/`.
  - `arms_open/talking/024` → `_unassigned/`.
  - `clasped_hands_happy/talking/066–069` → `clasped_hands_happy/talking_laugh/`.
  - `bow_polite/001–004` → `idle/` and `005–008` → `talking/`.
  - `shocked_panicked/*` → `shocked_panicked/reaction/`.
  - Stripped `" (1)"`/`" (2)"` from all 97 frame filenames.
- Rewrote `characters/maya/character.json` (schema v1, D-011) and `audio/audio.json` (schema v1, D-012).
- Created `characters/index.json`, `backgrounds/backgrounds.json`, `music/.gitkeep`, `ui/.gitkeep`.
- Removed `frontend/public/assets/hero.png` (`git rm`). It was byte-identical to the Vite scaffold blob `02251f4`, unreferenced, and is recoverable from history.
- Added `frontend/scripts/validate-assets.mjs` and the npm script `validate:assets` (D-014).
- Docs: rewrote PROJECT_STATE and ASSET_INVENTORY; updated ROADMAP; DECISIONS D-008 marked superseded, D-003 annotated, D-010 to D-014 added.

**Correction to the earlier entry**
- The initialization entry/inventory said 132 Maya frames. The actual count is 97 (verified at HEAD `8bf0937`).

**Process note**
- The first move attempt failed: Windows refused to rename `characters/` because a shell's cwd was inside it. Subsequent commands ran from `frontend/public/` and created empty stray folders there. Those were removed with `rmdir` (empty-only), and the moves were re-run with absolute paths. No files were lost; final state verified by count (97 frames + manifests).

**Validation**
- `npm run validate:assets`: **pass**, 144 referenced files, 0 errors.
- Negative test on a scratch copy with 4 injected faults (missing frame, bad emotion target, wrong bg width, stray file): all detected, exit 1.
- `npm run build`: **pass** (exit 0; 17 modules; `public/assets/**` copied into `dist/assets/`).
- `npm run lint`: **pass** (exit 0, no diagnostics).

**Unresolved / ambiguous**
- D-013 visual splits need confirmation in the renderer.
- Frame 024's true pose is unknown. `017` may really be `018`. Frames 063–065 are missing.
- `surprised` settles to neutral; there's no shocked hold loop.
- Talking fps hasn't been tuned.
- bg_18 has characters baked in. Background descriptions are guesses.
- No music, UI graphics or visual effects exist.
- Vite's `dist/assets/` is shared between bundles and public assets (no collision today).

**Recommended next task**
Phase 2: a typed manifest loader, then a minimal scene renderer (background + Maya idle/talking loop driven by logical emotion) to confirm the inferred splits by eye.

---

## 2026-10-24 — Phase 2A: typed manifest loading + minimal scene renderer

**Git**
- Pushed `0db92d6` (asset stabilization) to `origin/main` at the owner's request. Phase 2A work is **not committed**, per the brief.

**Inspected**
- Docs, `CLAUDE.md`, skills (repo-inspector, character-engine, animation-engine, react-ui, asset-pipeline, testing, debugging, git-safety, ace-attorney-behavior), `src/` (still the Vite starter plus 4 empty components), CSS.

**Created**
- `frontend/src/engine/manifestTypes.ts`
- `frontend/src/engine/manifestLoader.ts`
- `frontend/src/engine/characterResolver.ts`
- `frontend/src/engine/useClipPlayback.ts`
- `frontend/src/engine/useCharacterAnimation.ts`
- `frontend/src/engine/useStageScale.ts`
- `frontend/src/components/BackgroundRenderer.tsx`
- `frontend/src/components/DevPanel.tsx`

**Modified**
- `frontend/src/App.tsx`: starter replaced by manifest loading + `ScenePrototype`.
- `frontend/src/App.css`, `frontend/src/index.css`: starter styles replaced.
- `frontend/src/components/GameScene.tsx`, `CharacterSprite.tsx`: previously empty.
- Docs: PROJECT_STATE (rewritten), ROADMAP, DECISIONS (D-015 to D-017), SESSION_LOG.
- No manifests or assets were changed.

**Validation**
- `npm run validate:assets`: pass (144 files).
- `npm run build`: pass (26 modules, JS 200.54 kB / 63.34 kB gzip).
- `npm run lint`: pass, no diagnostics.
- Scratch resolver test (Node 24 type stripping against the real `character.json`): 46 checks pass. Covers all 13 emotions × modes, the reaction path and one-shot enforcement, settle after reaction, unknown emotion, missing talking variant, missing animation, missing reaction, and an empty character.
- Browser (Chrome, dev server on :5199):
  - renders at 6× integer scale;
  - the neutral idle loop wraps 009→012;
  - talking uses 013–016;
  - surprised plays shocked 1/6…6/6 once, then neutral in the current mode;
  - an IDLE toggle mid-reaction lands on neutral idle after the reaction;
  - all 24 emotion × mode combos resolve to the expected animation with no fallbacks;
  - 0 manifest warnings, 0 broken images, 0 console errors/warnings after reload.
- The dev server was stopped afterwards.

**New asset facts**
- None that change the inventory. Observation: Maya's sprites fill about 55% of the 192 px stage height (noted in PROJECT_STATE).

**Needs human visual confirmation (manifest NOT changed)**
- `thinking_side` idle 047–050 vs talking 051–054.
- `bow_polite` idle 001–004 vs talking 005–008. Is it really a bow?
- `arms_open` idle 017/019/020 vs talking 021–023. Is 021 a talking frame? Does the 3-frame loop look smooth?
- `clasped_hands_laugh` (idle shared with `clasped_hands_happy` 055–058, talking 066–069).
- `shocked` reaction 025–030: the recoil frames (025 is 109 px wide, offset left) and whether settling to neutral looks right.

**Recommended next task**
After visual confirmation: a dialogue box + typewriter that drives idle/talking from reveal state (removing the manual toggle). Then the dialogue blip engine.

---

## 2026-10-24 — Phase 2B: DS-style UI, typewriter dialogue, blips, menus

**External assets**
- Spriters Resource (`/ds_dsi/phoenixwrightaceattorney/` and asset pages 20859, 149780) returns HTTP 403 with `cf-mitigated: challenge` (Cloudflare) to WebFetch and plain curl.
- The challenge was not bypassed. Asset pages were identified via web search.
- **No external files were downloaded.** A manual checklist is in `docs/ASSET_SOURCES.md`.
- The owner's reference image (fan recreation, 1280×960 = 5× DS) was used for geometry only and not added to the repo.

**Implemented** (uncommitted, awaiting approval)
- Engine:
  - `audioEngine.ts`, `useTypewriter.ts`, `useBlips.ts`, `dialogueTypes.ts`, `stage.ts`;
  - loader additions: `loadCharacterSummaries`, `loadSounds`, `voice` on `LoadedCharacter`;
  - types: `AudioManifest`, `Sound`, `CharacterSummary`;
  - `useCharacterAnimation` split into gate + playback (D-018).
- Settings: `settings/settings.ts`, `settings/SettingsProvider.tsx`.
- Components:
  - new: `PixelStage`, `MenuList`;
  - filled (previously empty): `DialogueBox`, `TypewriterText`;
  - modified: `GameScene` (now on `PixelStage`, overlay children), `DevPanel` (back button).
- Screens: Title (press start + main menu), CharacterSelect, LocationSelect, Settings, Conversation, AnimationTest (former Phase 2A prototype).
- Dev: `dev/testConversation.ts` (8 lines incl. surprised reaction, long wrap test, male-blip line); `dev/ConversationDevPanel.tsx`.
- `App.tsx` rewritten as the screen state machine; `main.tsx` wraps App in `SettingsProvider`.
- CSS rewritten for stage UI; `index.html` title set to "Courtroom Companion".
- Docs: ASSET_SOURCES (new), PROJECT_STATE (rewritten), ROADMAP, DECISIONS D-018 to D-021, ASSET_INVENTORY note.
- No assets or manifests changed.

**Validation**
- `npm run validate:assets` pass (144) · `npm run build` pass (44 modules) · `npm run lint` pass.
- Scratch tests (not in the repo): resolver 46/46, punctuation pauses 5/5.
- Chrome (dev server :5199):
  - title, menu, character select (Maya with preview frame) and location select (live background preview) all render;
  - Enter launches the scene with a real background and the Maya idle loop;
  - each of 8 lines goes revealing (TALKING) → complete (IDLE) with the continue arrow;
  - surprised goes waiting (shocked reaction) → revealing → complete;
  - female blips by default, `blip_male` on line 7;
  - a probe across a whole line recorded 0 blips triggered by whitespace or punctuation;
  - one advance per click or Enter;
  - settings persist to localStorage; mute → 0 plays, unmute → 1;
  - resize gives integer scales (6× → 1× → 6×) and `image-rendering: pixelated` is confirmed;
  - 0 console errors or warnings, 0 failed requests (153 resources), 0 broken images;
  - the Animation Test screen still works.
- Note: during testing, trusted mouse clicks from the owner's own interaction were observed advancing lines in the test tab. Investigated by logging input events; not an app bug.

**Needs owner visual confirmation**
- The CSS stand-ins versus the real DS look.
- Font choice and size.
- Maya's scale relative to the dialogue box.
- The D-013 frame splits (still pending).

**Recommended next task**
After the owner downloads the sheets: slice the original UI graphics into `ui/`, add a `ui.json` manifest plus validator coverage, and swap the CSS stand-ins.

---

## 2026-10-24 — Presentation pass: jitter fix, render quality, pixel font, title art

**Reference files found in `docs/references/`** (owner-supplied, left unmodified)
- Title Screen sheet (Spriters Resource asset 20859, 502×388).
- `Exclamations.png` (265×662).
- `Ace-Attorney.ttf`.
- The textbox reference image.
- `courtroom_companion_claude_setup.zip` (setup bundle, not an asset).
- **Not found:** the five-panel miscellaneous background sheet described in the brief. The "Title Screen" sheet is a different one.

**Render-quality investigation (Maya "blocky")**
- Pipeline verified:
  - frames drawn at native size (e.g. 65×111);
  - no independent CSS sizing;
  - background and Maya share the 256×192 stage;
  - the whole stage is scaled as one unit;
  - `image-rendering: pixelated`.
- Root cause is the source PNGs: about 1,400 colours per frame and soft anti-aliased outlines, so they were resampled during extraction. Pixels were not modified, as instructed.
- Also, auto scale is 6× on a 2560 px window, so each source pixel is 6×6. Added a dev scale selector (1×/2×/3×/4×/auto) to judge DS-like composition.

**Jitter root cause and fix** (D-022)
- Frames are tightly cropped with lost sheet offsets, and the renderer centred each frame by its own width. The body shifted ±1 stage px (6 screen px) between frames.
- Fix: offsets come from registering each frame against its pose's first idle frame, using colour-tolerant matching on the lower half of the body.
  - `character.json` gained per-pose `canvas` and per-clip `offsets`; the change is additive (data otherwise identical).
  - The renderer anchors the canvas and draws each frame at its offset.
  - The shocked recoil (025–026) keeps natural placement; hold frames are registered.
- Mean silhouette-edge deviation: 0.331 → 0.248 px/frame (the integer optimum is 0.242). Residual wobble is in the resampled pixels.
- Validator: offsets/canvas checks. Negative test: 3 injected faults, all caught.

**UI assets created**
- `ui/title/title_screen.png`: exact crop of the sheet's top-left panel.
- `ui/exclamations/{objection,take_that,hold_it}.png`: background keyed to transparent.
- `ui/fonts/ace_attorney.ttf`: byte-identical copy.
- New `ui/ui.json` manifest, validated for files and PNG sizes.
- The Capcom licensing splash was deliberately not used.

**Code**
- New:
  - `dev/devDisplay.ts`, `dev/DevDisplayProvider.tsx`, `dev/DevDisplayControls.tsx`;
  - loader `loadUi` (FontFace registration);
  - types `CanvasSize`, `ReactionManifest`, `UiFont`, `UiImage`, `LoadedUi`.
- Modified:
  - `manifestLoader` (canvas/offsets with legacy fallback, ui);
  - `CharacterSprite` (canvas anchor + debug overlay);
  - `PixelStage` (scale override, `data-scale`);
  - `GameScene` (canvas prop);
  - `ConversationScreen` and `AnimationTestScreen` (pass canvas);
  - both dev panels (display controls);
  - `main.tsx` (`DevDisplayProvider`);
  - `App.tsx` (ui manifest, font CSS vars, title image);
  - `TitleScreen` (two phases: original art + prompt in its empty rows 165–180, then menu);
  - `App.css` / `index.css` (pixel-font metrics: 16 px, odd line heights, letter/word spacing; name plate 15 px; debug overlay styles);
  - `SettingsScreen` labels;
  - test script (long line fits 3 lines);
  - `validate-assets.mjs` (offsets/canvas, ui.json, fonts as media).
- Data: `character.json` (canvas/offsets), `ui/ui.json` (new).

**Validation**
- `validate:assets` pass (149) · `build` pass (47 modules) · `lint` pass.
- Chrome:
  - title art + blinking prompt → menu;
  - character select → location select → scene;
  - pixel font loaded (`document.fonts.check` true);
  - each of the 8 lines: TALKING while revealing → IDLE + arrow;
  - surprised: waiting (reaction) → revealing → complete;
  - female blips, and male blips via the dev override;
  - 0 blips on whitespace or punctuation (128 checked);
  - every line fits 3 lines;
  - fixed scales 1/2/3/4 and auto (6×) applied exactly;
  - `pixelated` confirmed;
  - 0 broken images, 0 failed requests (155), 0 console errors or warnings.
- Incident: Vite's watcher once cached an empty `App.tsx` read mid-write by a scripted edit (blank page, "no default export"). `touch` fixed it; the file and build were fine.

**Needs owner visual confirmation**
- Jitter: use the "canvas anchor" vs "per-frame centring (old)" toggle.
- Preferred display scale.
- Pixel-font sizing in the dialogue box (3 lines × 15 px) and the 15 px name plate.
- The title art in use, and whether to display the original PW logo at all.
- Hyphen/ellipsis fallback glyphs.

**Recommended next task**
Supply the five-panel miscellaneous background sheet. Cut it into `ui/menu/` and rebuild the menu screens on those panels. Then re-extract Maya's frames 1:1.

---

## 2026-10-24 — Native Maya re-extraction, render profile, menu SFX, engine tests

**Inputs found**
- `docs/references/maya fey.png` (1180×3112). The owner's note called it `maya-original-sheet.png`; this is the only Maya sheet present.
- `docs/sfx general/` (108 WAVs).
- **Still missing:** the five-panel miscellaneous menu sheet, and the prototype/original-game comparison screenshots the brief mentions.

**Diagnosis**
- The sheet was segmented into 142 sprites in 17 rows. All 102 frames of rows 1–13 share one 15-colour palette, and there's no pixel doubling, so it's native.
- Old runtime frames:
  - were 0.685–0.724× the sheet size;
  - width ratios varied per frame (63 vs 64, 65 vs 66 px), which was the jitter source;
  - had about 1,400 colours each;
  - matched their sheet row only after area resampling.
- **Proven to be resampled.**
- Native frames within a pose share an identical size, and their lower bodies match 1.000 under bottom-centre placement.

**Changes**
- Maya:
  - `git rm` of the 97 old frames;
  - 102 native 1:1 crops written (pixel-identical to the sheet, verified);
  - `character.json` regenerated with the same animation IDs, emotions and fps, and `render: {scale:1, offsetX:0, offsetY:0}`.
- Grouping per the sheet's "x Talk" brackets:
  - `arms_open` 4+4;
  - laugh talking = 7 frames;
  - shocked keeps the old 027/026 order, plus the "x2" hold;
  - frame 025 unassigned.
- Render profile (D-026): types, loader, validator, `CharacterSprite` (anchor + scale + offset), dev overrides (scale 1.0–2.0, X/Y, reset).
- Menu SFX (D-028):
  - `pageturn.wav` copied;
  - `audio.json` `events`;
  - `audioEngine.playEvent` with cooldown, with early fetch and decode on unlock;
  - `menuSounds.ts`;
  - `MenuList` sounds and PageUp/PageDown;
  - screen wiring.
- Bug found in browser and fixed: a stationary mouse pointer stole menu selection via `mouseenter`; `MenuList` now uses `mousemove`.
- Bug found in browser and fixed: duplicate React keys in the Animation Test filmstrip for repeated reaction frames.
- Dev panel: "Replay line" and "Replay line with male blip"; menu-sound test buttons; native/stage/CSS size readout; filmstrip thumbnails capped at 64 px.
- Tests (D-029): `frontend/tests/engine.test.ts`, `npm test`. `typewriterStateOf` extracted as a pure function.
- Docs: D-013 marked superseded, D-022 annotated, D-026 to D-029 added; ASSET_INVENTORY (native Maya section, older sections marked superseded); ASSET_SOURCES (Maya sheet as authoritative, SFX pack); PROJECT_STATE; ROADMAP.

**Validation**
- `validate:assets` pass (155) · `build` pass · `lint` pass · `npm test` 8/8.
- Chrome:
  - **Menu sounds:** cursor (`ui_select`), open (`ui_scroll`), cancel (`ui_cancel`), confirm (`ui_select_alt`), page (`ui_page`, via synthetic PageUp/PageDown; the automation tool's PageDown key doesn't reach the page) and start (`ui_jingle`).
  - **Animations:** all 12 stable emotions resolve in idle and talking with no fallbacks. Loops cycle through all frames (e.g. explaining 021–024, laugh 064–070). Surprised plays 027 → 026 → 028–031 ×2 → neutral idle.
  - **Jitter:** each clip renders at exactly one stage position in both alignment modes (laugh: 3 positions, the genuine head-bob). Neutral sits at (82, 31), 92×161.
  - **Dialogue:** female blips, male replay, arrow and name plate all work.
  - **Scaling:** 3×, 4× and auto checked.
  - **Errors:** 0 broken images, 0 failed requests (169), no console errors after the key fix.
- Interference noted again: someone was clicking in the test tab (male blips and cursor sounds I didn't trigger).

**Needs owner visual confirmation**
- Native Maya composition and scale.
- Shocked reaction order and frame 025.
- The 7-frame laugh.
- Menu sound choices and the fixed 0.5 menu volume.

**Recommended next task**
Supply the five-panel menu sheet, then rebuild the menu screens on those panels. Approve and commit the milestone.

---

## 2026-10-24 — Natural idle blink timing

- **Owner feedback:** idle blinking was too fast and unnatural (the 4-frame blink looped at 6 fps, every 0.67 s).
- Inspected the faces of all 12 idle clips: frame order is open → half → closed → half in every pose.
- Added optional `frameDurations` and `holdJitterMs` to clips (types, loader, validator, `frameDurationMs` in `useClipPlayback`). Maya's idle clips now use `[2600, 70, 90, 70]` + `holdJitterMs: 1800` (D-030).
- Added test "idle blinks…" (`npm test` 9/9).
- `validate:assets`, `build` and `lint` pass.
- Browser timeline (neutral idle, 9 s): open frame 4353 ms between blinks; blink frames measured ~80/98/80 ms (timer granularity); no console errors.
- **Owner to judge:** whether a 2.6–4.4 s blink interval feels right. Change `frameDurations[0]` / `holdJitterMs` in `character.json` to tune.

---

## 2026-10-24 — Original DS menu panels

- Found `docs/references/DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Miscellaneous.png` (1553×238, RGBA; dark-green background (2,66,15); credit "Sprite Sheet by TSP184").
- Located the five panels by non-background column runs. Each is exactly 256×192 at x = 23 / 302 / 581 / 860 / 1139, y = 23–214.
- Cropped to `frontend/public/assets/ui/menu/` with the owner's kebab-case names. Verified: no green on any edge, no label rows adjacent, 0 semi-transparent pixels, re-read identical. Registered in `ui.json` (validator covers files and dimensions).
- New `components/StageBackdrop.tsx`. Main menu → title-screen-discussion; character select → talk-option; settings → bottom-screen; location select unchanged (live preview).
- The blue CSS gradients are now the fallback only (`.title-screen-plain`, `.menu-screen-plain`).
- Fix: "press start" state moved to `App` (session flag). Previously, with audio still locked, returning to the title re-showed press start.
- **Validation:** `validate:assets` pass (160) · `build` pass · `lint` pass · `npm test` 9/9.
- **Chrome (real key presses):**
  - title art → main menu on the discussion panel (text readable) → Settings on bottom-screen → back to menu (no repeat press-start) → character select on talk-option → location preview → conversation on bg_02;
  - sounds: cursor, open, cancel, confirm, start all played;
  - blips, name plate fine;
  - 0 failed requests, 0 broken images, no console errors.

---

## 2026-10-24 — Overflow-aware menu label marquee

- **Added:** `components/useOverflowMarquee.ts` and `components/OverflowMarquee.tsx`. `MenuList` uses them for every label, tracks keyboard vs pointer input, and resets on mouse leave. CSS `.marquee` replaces the old ellipsis-only span rule (D-032).
- **Location list measurement:** 6 labels fit; 23 overflow by 6–111 stage px; overflowing ones get a `title`.
- **Chrome checks:**
  - **Short label:** no movement, no tooltip.
  - **Slight (8 px) and very long (111 px) labels:**
    - ~300 ms delay;
    - constant ~28 px/s (56 px in 1.97 s);
    - integer steps only;
    - ~0.9 s end pause, reset, loop.
  - **Box stability:** the button rect is identical throughout.
  - **Selection change mid-scroll:** the previous label resets to 0 immediately.
  - **Mouse:** hover selects and scrolls; mouse leave resets and stays reset.
  - **Keyboard:** afterwards, the selected label scrolls again.
  - **Resize:** 6× → 3× keeps the 56 px overflow and keeps scrolling.
  - **Reduced motion** (emulated `matchMedia`): a single jump 0 → 111 px at ~295 ms, with no intermediate frames.
  - **Console:** no errors.
- **Results:** `build`, `lint`, `npm test` 9/9 and `validate:assets` (160) all pass.
- **Not done:** no unit test for the hook (it needs a DOM, and there's no jsdom; it was verified in the browser instead).

---

## 2026-10-24 — LLM architecture: FastAPI backend, provider-agnostic gateway, Character Director

**Starting point:** commit `f208bf6` (owner-committed Phase 2B). Clean tree apart from the untracked `docs/sfx general/`.

**Environment**
- Python 3.15.1 only. Created `backend/.venv`.
- FastAPI 0.162, Pydantic 2.14, Uvicorn 0.54, pytest 9.1, httpx 0.28.
- `uvicorn[standard]` failed: its PyYAML has no 3.15 wheel. Plain uvicorn is used instead (documented in requirements.txt).

**Added**
- Backend:
  - `backend/app/{main.py, api/routes.py, llm/{schemas,base,config,repair,gateway}.py, llm/providers/fake.py, characters/{repository,prompt,service}.py, director/director.py}`;
  - tests `backend/tests/{conftest,test_director,test_llm,test_api}.py`;
  - `requirements*.txt`, `pyproject.toml` (pytest config), `README.md`.
- Character data: `frontend/public/assets/characters/maya/{performance.json, personality.md}`.
- Frontend:
  - `engine/performance.ts` (types, defensive parser, pagination, timeline → DialogueLine, `sendChat`);
  - `components/ChatBar.tsx`;
  - `ConversationScreen` rewritten around the input → waiting → performing → settle phases (same engines);
  - `resolveClip`/`useReactionGate`/`useCharacterPlayback` gained an optional `PerformanceOverride` (`resolveReactionId`);
  - `DialogueLine.animation`/`reaction`;
  - dev panel "Last AI reply", "Play test script" and trigger list;
  - Vite `/api` proxy;
  - 3 new frontend tests.
- Docs: `LLM_ARCHITECTURE.md`, `CHARACTER_DIRECTOR.md`, D-033 to D-035, ROADMAP, PROJECT_STATE, ASSET_INVENTORY note.
- `.gitignore`: venv, caches, `.env*`.

**Validation**
- Backend `pytest`: **59 passed**. Covers:
  - director rules on real Maya data and on a stoic mock character;
  - repair;
  - FakeProvider;
  - gateway (selection, unknown provider, exception, timeout, custom provider);
  - config secrets;
  - prompt/schema;
  - API integration.
- Frontend: `validate:assets` pass (160) · `build` pass · `lint` pass · `npm test` 12/12.
- Live (uvicorn :8000 + Vite :5199 proxy, Chrome, real typing):
  - **Message 1:** "Guess what happened today!" → thinking (`thinking_side` talk → idle) → surprised (`shocked` reaction once, then `neutral_front` talk → idle) → happy (`clasped_hands_happy`) → settled happy. 15 female blips; input re-enabled and focused.
  - **Message 2** (same session): thinking → excited + `arms_open` gesture → playful (`hand_mouth_giggle`).
  - **`#messy`:** unknown emotion, reaction and gesture handled; 5 notes; no crash.
  - **`#error`:** Maya's error line in her anxious pose.
  - No browser console errors. The backend log shows only the intended `#error` traceback; all requests returned 200.

**Recommended next task:** an Ollama provider adapter (local, no secrets; supports JSON-schema output), with mocked-HTTP adapter tests.

---

## 2026-10-24 — Dialogue pagination refinement (before committing the LLM milestone)

**Before:**
- `paginate(text, maxChars = 84)`: fixed character budget.
- Sentence break only for ASCII `". " "! " "? "` past a third of the window, otherwise the last space, otherwise a hard cut.
- No line wrapping or font metrics: the browser wrapped, so wide text could reach a hidden 4th line.
- No locale handling: Japanese was hard-cut at 84 characters.
- Already correct and kept: reaction on the first page only, pose and emotion preserved per page.

**After** (same functions, improved in place):
- `engine/dialogueLayout.ts`: shared geometry, canvas measurer from the real stage font, `gridMeasure` for tests.
- `wrapLines` and `paginate` use measured widths and emit explicit `\n`.
- Natural break priority: sentence → clause → comma → word → grapheme, with rhythm rules (half fill, or a third if the rest then fits one page; no < 6-grapheme orphans).
- `Intl.Segmenter` (cached). French no-break spaces respected. Japanese breaks between graphemes, with no line-initial `。、` and no spaces inserted.
- `DialogueBox` applies the same geometry constants.
- Performance: monotonic early exit and segmenter cache.
- FakeProvider gained `story`, `#french` and `#japanese` long replies.
- Dev-only `window.__ccPaginate`.

**Tests:**
- Frontend: 26 (14 pagination tests). Cases: geometry, short, exact fit / just over, sentences kept together, sentence boundaries, comma preference, early-comma rejection, word fallback, unbroken token, measurer influence, French, Japanese exact pages, no orphan, scale purity, and a beat spanning pages with reaction-once / pose / settle.
- Backend: 62 (3 new FakeProvider patterns validated).

**Browser** (FakeProvider via the live backend):
- **Story:** 3 beats → 6 pages, each a whole sentence or ending on a comma. The rendered line counts (via DOM ranges) equal the paginator's lines, with no X/Y overflow. `shocked` played once (page 4 of the 2-page anxious beat). Pose stable across a beat's pages. Click while revealing → page completed; click → next page. Settled in happy (`smile_front`).
- **French:** 2 pages, `!`/`?` kept attached.
- **Japanese:** first run exposed a "の。" orphan page. The rhythm rules were added, and the re-run gave 3 natural pages (break after 「…んだけど、」).
- **Scale:** identical pagination at 3× and auto (5×).
- **Console:** no errors.

---

## 2026-10-24 — Igiari stage/UI font integration

**Assets and configuration**
- Copied `docs/references/igiari/Igiari.woff2` unchanged to `frontend/public/assets/ui/fonts/Igiari.woff2`; SHA-256 matches: `02C1EFFCD76F86721EE266E51BECF006950B199EDDE61BDE1A6C703A8EDB92C3`.
- `ui.json` `fonts.dialogue`: family `Igiari`, 16 px, letter spacing 0, word spacing 0. It continues through the existing `--stage-font*` variables for dialogue, menus, nameplates, title fallback text and chat UI.
- Removed the superseded runtime `ace_attorney.ttf` after confirming its byte-identical source remains at `docs/references/Ace-Attorney.ttf`.
- Preserved the complete supplied Igiari distribution unmodified under `docs/references/igiari/` (EOT, OTF, SVG, TTF, WOFF, WOFF2, CSS, readme, licence).
- Temporary Kanji stack: `Yu Gothic`, `YuGothic`, `Meiryo`, `Noto Sans JP`, `Noto Sans CJK JP`, then general UI fallbacks. No Kanji font asset was added and no claim of authentic Japanese Kanji typography is made.

**Pagination and layout**
- The live path is unchanged: await `document.fonts`, read the effective stage font from CSS, measure it with canvas, and use the shared 242 px / three-line geometry.
- `gridMeasure` is now font-neutral and conservatively defaults to 18 px per non-space and 8 px per space, covering Igiari's widest encoded 16 px advance. Tests use an explicit compact synthetic grid where needed.
- Chrome loaded only `Igiari.woff2`; computed font was `16px Igiari, Yu Gothic, YuGothic, Meiryo, Noto Sans JP, Noto Sans CJK JP, Verdana, Segoe UI, system-ui, sans-serif`.
- Required English, French, kana, mixed Kanji and longer Japanese samples preserved every character, inserted no spaces, and produced no horizontal/vertical overflow or hidden fourth line. The long sample formed one natural three-line page.
- Hyphen, Unicode ellipsis and accented Latin measured from Igiari. Kana measured from Igiari; Kanji used the 16 px Japanese fallback.
- Maximum measured ink height was 15 px. The existing 15 px line height remains unchanged; screenshots showed no clipping or line overlap.
- The longer Japanese sample produced byte-identical page/line output at 3×, 4× and auto 5×. Menu items retained their 17 logical px height; long dev text remained clipped/marquee-managed inside its button.

**Validation**
- `npm.cmd run validate:assets`: pass, 160 referenced files.
- `npm.cmd test`: 27/27 pass (new conservative font-fallback test included).
- `npm.cmd run build`: pass, 55 modules.
- `npm.cmd run lint`: pass.
- No backend functionality, LLM provider/director behavior, Maya data or Maya sprites changed.

---

## 2026-10-24 — Deterministic DotGothic16 Kanji fallback

**Source, metadata and runtime asset**
- Preserved `docs/references/dotgothic16/DotGothic16-Regular.ttf` unchanged and copied it byte-for-byte to `frontend/public/assets/ui/fonts/DotGothic16-Regular.ttf`; both are 2,069,236 bytes with SHA-256 `155DA8F318553C11D9DFFC2AFFBC7C2114C6A46F9740BCF639ED5568AF92BE71`.
- Embedded metadata: family `DotGothic16` (`ドットゴシック16`), face Regular, style/weight Normal, version 1.101, SIL Open Font License 1.1, designer/manufacturer Fontworks Inc., copyright 2020 The DotGothic16 Project Authors. The supplied folder has no separate readme or licence file; no additional provenance is inferred.
- Inspected cmap: 8,231 mapped code points, including 95/95 printable ASCII, 96/96 Latin-1, 90/96 Hiragana, 94/96 Katakana and 6,714/20,992 CJK Unified Ideographs. Every glyph in the required Japanese samples is present.

**Loading, stack and measurement**
- Added DotGothic16 as the first bundled fallback inside the existing `ui.json` `fonts.dialogue` entry. Asset validation now checks nested font fallbacks.
- `loadUi()` loads Igiari and DotGothic16 together through `FontFace` and registers them only after both loads resolve. `App` then applies the one authoritative `--stage-font*` configuration; the existing paginator cannot run from the ready UI before both bundled faces are available.
- Effective stack: `Igiari, DotGothic16, "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP", Verdana, "Segoe UI", system-ui, sans-serif`. System Japanese fonts remain tertiary emergency fallbacks.
- Chromium canvas measurement with the computed stack matched Igiari exactly for kana and DotGothic16 exactly for a Kanji-only run. The mixed sentence `「今日は証拠を調べよう。」` therefore uses the intended per-glyph fallback while remaining one measured string.

**Browser and regression checks**
- Required kana-only, mixed, Kanji-heavy, long and dense Japanese samples preserved all characters, inserted no spaces, avoided line-initial punctuation, and had no horizontal/vertical overflow or hidden fourth line. The longest sample formed one natural three-line page.
- A three-line repeated-Kanji stress probe showed no clipping or visible overlap. Baselines and perceived height were compatible at the unchanged 16px font size and 15px shared line height.
- Pagination was identical at 3×, 4× and auto 5×. English stayed on one line; the French sample wrapped naturally to two lines with all words/accents intact. Menus remained visually coherent.

**Validation**
- `npm.cmd run validate:assets`: pass, 161 referenced files.
- `npm.cmd test`: 28/28 pass.
- `npm.cmd run build`: pass, 55 modules.
- `npm.cmd run lint`: pass.
- `git diff --check`: pass.
- No backend behavior, gateway/director/provider code, Maya assets or performance rules changed.

---

## 2026-10-24 — OllamaProvider, discovery and provider Settings

**Architecture**
- Added `backend/app/llm/providers/ollama.py` and registered `ollama` beside unchanged FakeProvider behavior. Qwen/Gemma/Llama/Mistral remain model strings inside Ollama.
- Native `POST /api/chat` sends shared system/history messages, configured model, `stream: false`, `think: false`, temperature/`num_predict`, and the exact existing per-character schema through `format`. The adapter extracts only final `message.content`; shared gateway repair and CharacterDirector remain unchanged.
- Provider errors have safe machine codes. No failure silently switches to FakeProvider. Optional Ollama duration/token metadata stays on `RawCompletion`, outside CharacterReply and presentation.
- Provider configuration validates/normalizes HTTP(S) base URLs, defaults Ollama to `http://localhost:11434`, requires no key, and uses a 120-second generic generation timeout for cold starts.

**Discovery, connection test and UI**
- Added backend-proxied `GET /api/providers/ollama/models` (`GET /api/tags`) and `POST /api/providers/ollama/test`. The latter performs tags discovery plus one provider-independent, schema-constrained greeting without touching CharacterService session history.
- `/api/chat` accepts explicit Fake/Ollama user configuration for the turn. CharacterService still owns the single history/prompt/director flow; model output cannot change configuration.
- Settings minimally adds Fake/Ollama, server, installed-model dropdown, Refresh Models and Test Connection. It distinguishes unreachable, reachable/list-loaded, selected-model-missing, generation failure and success. Normal controls remain unchanged in the scrollable 256×192 panel.
- Chromium verified Fake as the default, Ollama controls, default URL, clean unreachable message, and that the browser requested only `/api/providers/ollama/models` through Vite—never `localhost:11434` directly.

**Tests and local environment**
- Added mocked tests for registration/capabilities, chat translation, model/messages/`stream`/`think`/schema/options, custom URL, no auth, tags metadata, connection refusal, timeout, missing model, non-200, malformed/missing/empty output, thinking exclusion, gateway→Ollama→shared validation, history-free test endpoint, per-chat override and Fake regression.
- `ollama` executable was not found and the local API did not respond. No installed models were discoverable, no model was downloaded, and the optional real-model end-to-end test stopped there.
- Final validation: backend 79/79 tests (with one harmless pytest cache-path warning), frontend 28/28 tests, asset validation 161 referenced files / 0 errors, production build 56 modules, lint pass, and `git diff --check` pass.
- No Maya data/assets, CharacterDirector rules, paginator behavior or dialogue typography changed.

---

## 2026-10-24 — Generic OpenAI-compatible provider

**Architecture and secrets**
- Added one `OpenAICompatibleProvider` using `POST {baseUrl}/chat/completions`; Gemini and other compatible services remain configuration, not vendor-specific classes.
- Requests contain the shared system/history messages, configured model, `stream: false`, temperature/`max_tokens`, and the exact existing CharacterReply schema through strict `response_format.json_schema`. Only final `choices[0].message.content` enters shared validation/repair.
- Registered `openai_compatible` beside unchanged Fake and Ollama adapters. CharacterService, CharacterReply, CharacterDirector, measured paginator and presentation were not changed.
- Backend secrets use `SecretStr`; `COURTROOM_LLM_API_KEY` is the default variable and `COURTROOM_LLM_API_KEY_ENV` can name another. No key field or value crosses the frontend API or enters localStorage/logs/responses.

**API, Settings and failures**
- Added `GET /api/providers/openai-compatible/status` (boolean secret state only) and history-free `POST /api/providers/openai-compatible/test`.
- Test Connection distinguishes invalid URL, unconfigured/failed authentication, rate limit, model/request rejection, native-structured-output rejection or invalid output, timeout/unreachable, generic failure and success.
- Settings now offers Fake, Ollama and OpenAI Compatible. Compatible fields are editable base URL/model plus backend API-key status and Test Connection; defaults are the requested Gemini URL and `gemini-3.8-flash` without special-casing the adapter.
- Chromium verified the new panel, editable target values, backend-key-not-configured state, clean connection-test message, scrollable 256×192 layout, no console errors and no direct request to the configured cloud endpoint.

**Tests and environment**
- Added mocked tests for registration/capabilities; Bearer auth; custom path URL; model/messages/options/`stream`/exact schema; assistant extraction; metadata; missing secret; 401/403; 429; model/structured-output distinction; timeout/unreachable/non-200; malformed/missing/empty output; gateway shared validation; history-free API testing; secret redaction; and Fake/Ollama registry regressions.
- No `COURTROOM_LLM_API_KEY`, `GEMINI_API_KEY` or configured generic secret selector exists in this environment. No cloud call was made, and the optional real Gemini English/French/Japanese/personality/director/pagination smoke test was skipped cleanly.
- Final validation: backend 106/106 tests pass (one harmless pytest cache-path warning), frontend 28/28 tests pass, asset validation reports 161 referenced files / 0 errors, production build passes with 56 modules, lint passes cleanly, and `git diff --check` passes.

---

## 2026-10-24 — Provider profiles and OS credential management

**Implementation**
- Added `app/configuration/`: validated ProviderProfile metadata, atomic/locked local ProfileStore, ProfileManager resolution, and the provider-independent CredentialStore interface with a native-only Python keyring adapter. Installed keyring 25.7.0 and its runtime dependencies in the backend virtual environment.
- Metadata/active selection live in ignored `backend/.local/provider-profiles.json` (`COURTROOM_CONFIG_DIR` override); keys live in the OS vault or a referenced backend environment variable. Profile OS keys take precedence. Private transient SecretStr binding extends ProviderConfig without teaching adapters about persistence.
- Added local profile CRUD/activation/duplication, credential set/replace/delete/status, profile discovery and history-free Test Connection endpoints. Profile IDs/credential references are backend-generated. Duplicates have independent key entries; deletion retires the key. JSON errors never echo submitted values, responses are no-store, and configuration routes check local/same-origin access including Vite proxy forwarding.
- Chat now resolves the server's active profile for each turn. Stale per-request provider overrides receive 409. CharacterService/history, LLMGateway semantics, shared schema/repair, adapters, director, paginator, typography and Maya assets/rules were preserved. Blocking vault resolution runs in the backend thread pool.
- Settings now offers AI Profile, Add/Edit/Duplicate/Delete, relevant fields, Ollama discovery, password-based set/replace/removal and profile Test Connection. A fixed label/control grid and non-shrinking flex children retain normal scrolling without the earlier provider-row overlap. Complete legacy browser configuration is imported once and removed from browser storage; incomplete snapshots are retained for recovery. Environment-only initialization remains supported.
- Updated architecture/state/roadmap/setup docs and added D-041, marking only the relevant D-039/D-040 policies superseded. No Anthropic adapter was added; it will reuse this credential layer with an adapter/registry entry and profile type/form fields.

**OS and browser validation**
- Detected `keyring.backends.Windows.WinVaultKeyring`. A sandboxed write returned Windows error 1312 (no logon session); the approved normal-session probe successfully wrote/read/deleted a generated synthetic credential. No plaintext fallback was used.
- Browser-tested the real UI against a temporary backend and real Windows vault: create Gemini configuration, password entry/save, Configured state with input cleared, switch to Ollama and back with key retained, duplicate/delete with independent credentials, replace, remove, and clean missing-key Test Connection failure. Only synthetic temporary keys were used; no cloud generation was requested.
- Inspected 256×192 screenshots including configured key actions, edit fields and the scrolled Speed/Volume/Mute/Display/Test blip section. No row overlap or horizontal overflow. Logical row geometry was identical at 3×, 4× and auto 5×. No browser exceptions. Neither synthetic key appeared in local/session storage or any API response; write requests were the only key-bearing browser API calls.
- Temporary profiles/credentials and browser-check artifacts were cleaned up. Existing untracked `docs/sfx general/` and prior uncommitted provider work were preserved. No commit/push.

**Final checks**
- Backend: **137 passed** (`pytest -q -p no:cacheprovider`; cache disabled to avoid the pre-existing Windows cache-path warning). New deterministic tests use an injected in-memory keyring and mocked provider HTTP, including profile-scoped Ollama discovery/test and vault-unavailable API behavior.
- Frontend: **30 passed** (28 existing engine/font/pagination tests plus migration/storage/API coverage).
- `validate:assets`: **161 references, 0 errors**; build: **58 modules**, pass; lint: pass; `git diff --check`: pass.

---

## 2026-10-24 — Native Anthropic provider

**Inspected**
- CLAUDE.md and persistent docs, the committed profile/credential milestone (`feff9df`), adapter/config/registry, profile validation, profile Test Connection/chat, shared prompt/schema/repair, and the compact Settings form. Starting tree was clean except the existing untracked `docs/sfx general/`.
- Current official Anthropic Messages, structured-output and API-version documentation. API `2026-10-21` removes sampling parameters; native JSON output uses `output_config.format` and rejects several bounds present in the shared CharacterReply schema.

**Implemented**
- Added `app/llm/providers/anthropic.py`: fixed native Messages endpoint, current version/Bearer headers, unchanged common system/history context, configured model/max_tokens/timeout, and `stream: false`. No SDK dependency was needed.
- Native JSON grammar is derived mechanically from the existing schema, with unsupported bounds moved to descriptions. Original schema/prompt and the shared validator/director remain authoritative; no second response contract or reply repair was introduced.
- Only final text enters shared validation/history/presentation. Thinking/signatures/redacted thinking are discarded; refusals, truncation and unexpected intermediate/tool blocks fail safely. Typed sanitized errors cover auth, rate limit, model/configuration, schema rejection, timeout/unreachable, HTTP service errors and malformed/empty output.
- Registered Anthropic and extended profile/credential-using types. The editor adds Anthropic with model and existing credential controls, without a base-URL field. Existing CredentialStore, environment fallback, persistence/security and profile testing are reused unchanged. Updated architecture/state/roadmap/setup docs and added D-042.

**Verification**
- Backend: **192 tests passed**. New mocked tests cover registration, auth/version, system/history/model/settings mapping, schema projection/source preservation, final extraction, reasoning exclusion, malformed/empty/refused/truncated responses, HTTP/transport failures, native profile validation/env resolution, history-free connection outcomes, and active-profile chat through shared validation/director. Existing provider/profile/service/director regressions pass.
- Frontend: **31 tests passed**, including native profile metadata acceptance/save through the existing API plus all font/pagination/presentation regressions. Asset validation: **161 references, 0 errors**. Build: **58 modules**, pass. Lint and `git diff --check`: pass.
- Real Windows-vault browser flow used a temporary synthetic key: Add Anthropic, no base-URL field, save password with input cleared, switch away/back retaining Configured status, replace/remove, and clean missing-key Test Connection. Inspected 256×192 editor/key-actions/lower-settings screenshots: no row overlap, horizontal overflow or browser exceptions. No secret appeared in local/session storage or API responses. Temporary profile/key/artifacts were removed.
- No saved Anthropic profile/credential was configured for a real Claude smoke test. No cloud generation was requested; live English/French/Japanese/personality/multi-beat/director/pagination behavior remains unverified.
- No changes to CredentialStore/security, CharacterService, CharacterReply, CharacterDirector rules, paginator, fonts, Maya assets or performance rules. `docs/sfx general/` preserved. No commit/push.

---

## 2026-10-24 — Music system (original / imported / radio) and Court Record

**Process and models**
- Lead (integration, shared files, validation): Claude Opus 5.5, since the session model could not be switched. The requested lead model was Sonnet 5.5 medium.
- Four parallel workers, each with its own files and a definition under `.claude/agents/`:
  - music-core: Sonnet, medium;
  - music-import-loop: Sonnet, high;
  - youtube-radio: Sonnet, medium;
  - court-record-assets: Haiku, medium.
- The lead wrote the shared contract `src/music/types.ts` before the workers started. It owned settings, App, Settings/Conversation/Title screens, CSS, `main.py` registration, the validator and docs.

**Implemented**
- **MusicEngine (D-043):**
  - serialized, abortable source switching that never overlaps;
  - shared AudioContext with Web Audio loop regions in samples;
  - LRU buffer cache; fades; pause/resume; blocked→retry on unlock.
- **Soundtrack (D-044):**
  - 25 byte-identical OST runtime copies + `soundtrack.json` (16 bgm, 9 contextual, 9 excluded manifest-only);
  - Maya/default relation lives in profile data.
- **Built-in loops:**
  - decoded in Chrome at 44.1 kHz; analyser proposals plus an independent envelope-lag search;
  - scored on post-seam musical coverage, envelope identity and seam correlation;
  - 10 tracks accepted (table in `docs/MUSIC.md`), 15 left `loop: null`, including Maya Fey 2001;
  - no loop claimed as a DS loop point.
- **Imports (D-045):**
  - backend library in ignored `backend/.local/music/`, magic-byte typing, 64 MB cap, traversal-safe IDs;
  - Web Worker loop analyser with calibrated confidence;
  - loop editor with preview (BGM pauses meanwhile), accept and coarse/fine/sample nudges, and an opt-in crossfade.
- **Radio (D-046):**
  - official visible IFrame player in the out-of-stage Music dock;
  - configurable video ID with URL parsing; autoplay-blocked/unavailable/offline states.
- **Court Record (D-047):**
  - 3 evidence icons extracted 1:1 from `evidences_profiles_full.png` and verified pixel-identical;
  - data-driven manifest; DS Court Record view (main menu + conversation overlay; descriptions use the D-032 marquee);
  - generic Talk Options over the original talk-option panel, with the topic sent as a normal chat message.
- **Validator** extended to `soundtrack.json` and `court-record.json`, reusing the runtime TS validators.

**Browser verification (Chrome, dev servers)**
- Menus, Settings music rows, Court Record and Talk Options checked at integer scales 3×/4×/auto: no overlap, no horizontal overflow, pixelated rendering, dialogue box and fonts unchanged, no console errors.
- **Game music:** the profile default played. Initial Investigation's node received exactly loopStart 2.300 s / loopEnd 50.3112 s.
- **Switching:** Game → Radio during loading started 0 Web Audio nodes; Radio → Off left the engine null/idle.
- **Radio:** the Lofi preset `jfKfPfyJRdk` got YouTube error 150 (embedding refused), shown honestly, and the preset was marked unverified. YouTube's sample video `M7lc1UVf-VE` played in the visible player and persisted.
- **Imports:** a synthetic WAV was uploaded with a hostile filename (sanitised). The loop was auto-detected at 2.001–10.001 s at 93 %, accepted (persisted `user-accepted`) and played with that loop. Fake MP3 → 415, traversal ID → 404, no paths in responses. The test upload was deleted.
- **Not done:** no audio was heard. Loop quality is metric-validated only.

**Found and fixed during integration**
- Settings allow-list test updated for the music fields.
- Dev HMR could leave an orphaned music engine; the runtime is now disposed on hot reload and exposed as `window.__ccMusic` in dev.
- Loop preview overlapped BGM; added `onPreviewChange`, so the host pauses and resumes only what it paused.
- Court Record descriptions were truncated; they now use the existing marquee.
- music-core's placeholder "all loops null" test replaced by a provenance test.

**Final checks**
- Backend pytest: 252 passed (60 new). Frontend `npm test`: 149 passed (118 new).
- `validate:assets`: 189 files, 0 errors. Build: pass (92 modules + 13.7 kB worker). Lint: pass. `git diff --check`: pass.
- Nothing committed or pushed. Untracked source folders (`docs/original_tracks/`, `docs/references/music|court-record/`, `docs/references/evidence.png`, `docs/sfx general/`, `docs/websites/`) were left alone.

---

## 2026-10-24 — Music finishing pass

**Radio preset**
- Replaced stale Lofi Girl ID `jfKfPfyJRdk` with the supplied current candidate `EWrX250Zhko`; official oEmbed returned the expected stream title.
- Tested from the app origin through YouTube's official IFrame API. The player returned error 150 (embedding disabled). Preset metadata and Radio UI now show it unavailable; the generic URL/ID path remains intact, with no workaround. Old saved preset selections reset to the current candidate.

**Built-in loop review**
- Decoded all 15 previously-null runtime tracks in Chrome at 44.1 kHz, downmixed all channels to mono, and ran the existing analyser. Maya and Cross-Examination Moderato also received a slower offline search across 1×/2×/4×/8× feature windows, 4–64 s periods and three similarity levels, with full-sample lag refinement and the same D-044 acceptance thresholds.
- Added metric-validated loop metadata for Cross-Examination Moderato, Maya Fey – Turnabout Sisters 2001, Detention Center, Marvin Grossberg and The Class Trial. Existing accepted loops were preserved. Maya's top three candidates and Cross-Examination's alternatives, metrics and dispositions are recorded in `docs/MUSIC.md`.
- Ten playable tracks still have `loop: null`; excluded manifest-only tracks remain null by design. No audio was auditioned and no point is claimed to be an original Nintendo DS loop point.

**Validation**
- Frontend: 182 tests passed; asset validation passed (196 references, 0 errors); production build passed (97 modules); lint passed; `git diff --check` passed.
- Temporary analysis script/report were removed. No commit or push.

---

## 2026-10-24 — Milestone 1 of 3: character presentation and audio UX

**Process and models**
- Lead (integration of ConversationScreen/App/Settings/MusicDock/validator/docs and browser validation): Claude Opus 5.5. The session model could not be switched to the requested Sonnet 5.5 medium.
- Workers: character-performance (Sonnet, high), audio-ux (Sonnet, medium), typography-validation (Haiku, default effort).
- A separate concurrent session ran a music finishing pass in the same tree. It added D-048, five more built-in loops (including Maya Fey 2001) and the `EWrX250Zhko` preset (error 150). Its edits were kept, and this milestone's decisions were numbered D-049–D-051 after it.

**Implemented**
- **Waiting/thinking pose (D-049):** pure `nextPhase` machine plus `character.json` `waiting` (Maya `thinking_side`); the validator checks the block.
- **Semantic beat SFX (D-049):** director `Segment.sfx` from `performance.json` rules → frontend audio.json `sfx_<name>`, first page only, once per line key. 7 curated byte-identical WAVs; new SFX vol/mute settings.
- **Typing blips (D-049):** `user_typing` event → `blip_male`, `insertText`-only, IME-safe, 60 ms throttle, blip volume/mute.
- **Kanji scale (D-051):** ui.json FontFace descriptors with DotGothic16 `sizeAdjust: "75%"`, chosen from TTF-table metrics (kanji ink 15 → about 11.2 px against kana 11 px).
- **Import UX:** button + drop zone, formats/limit visible, step strip (Selected → Checking → Uploading → Analysing loop → Ready), human-readable failures, the new track auto-selected with its loop editor open, loop state per row, library open by default when Imported is selected.
- **BGM lifecycle (D-050):** a scene context; menus silent (future `menu` profile supported), the conversation plays the character profile (`profiles.maya_fey`), leaving fades out, and a dock Play on a menu auditions until the next screen change.

**Browser verification (Chrome, isolated backend on 8010 with a scratch config, FakeProvider only)**
- **Music:** the menu and location select stayed idle; entering the conversation played Maya Fey 2001.
- **Typing:** typing gave one male blip per voiced character at human pace. Modifier/navigation keys gave none, and the input value was unchanged.
- **Waiting:** submitting showed the thinking pose animating through its blink cycle (048 → 049 → 050 → 051).
- **Errors:** `#error` left waiting into the in-character error line and then input.
- **Japanese:** the `#japanese` reply showed balanced kanji/kana on three lines with the arrow reserved. The paginator measured a kanji at 12 px with DotGothic16 `sizeAdjust=75%`, and all test sentences fit in three lines.
- **SFX:** the shocked beat played `fx_shock` exactly once across all pages.
- **Import:** a fake .mp3 gave "Could not import not-audio.mp3: The browser could not decode this audio file."; a synthetic WAV went through every step to "Ready" with a 93 % candidate at 2.001–10.001 s.
- The user's own dev servers (8000/5173, real profile config) were found running and were not touched or used for chat.
- **Not done:** no audio heard (SFX choices and loops unauditioned); the `#timeout` waiting → error path was interrupted by an HMR reload from the concurrent session (covered by unit tests).

**Final checks**
- Backend 259 passed. Frontend 182 passed. `validate:assets` 196 / 0 errors. Build 97 modules. Lint and `git diff --check` pass.
- No commit or push.

---

## 2026-10-24 — Milestone 2 of 3: safe generated text artifacts

**Repository safety**
- Read CLAUDE.md and persistent docs; inspected status and recent commits before edits. Starting HEAD `178fda9`; captured SHA-256 baseline for 303 already-modified/untracked files in ignored local audit storage. All starting work is treated as user-owned. Codex listed only the current agent; pre-existing Claude processes were present, so filesystem hashes/file sets were also checked for unexpected writes.
- Source/reference folders and archives were preserved. No add/stage, commit, push, stash, reset, revert, branch switch or history operation. Detailed starting inventory, newly created files, this milestone's edits to existing files and concurrency findings: `docs/MILESTONE_2_CHANGE_AUDIT.md`.

**Implementation**
- Added `app/artifacts/`: one strict txt/md/py action, schema derived from the existing reply schema, bounded UTF-8 store with server UUIDs, atomic file/catalog publication, safe duplicate display names, persistent receipts and corrupt/missing/orphan handling. Python remains inert text.
- Shared gateway parsing and CharacterService associate an optional action with a conversation turn; CharacterReply, director rules, paginator, providers' HTTP translation, profile credentials and milestone 1 presentation rules are preserved. One model generation supplies both the final acknowledgement and optional action; actions/content stay outside assistant history.
- Added local metadata/text/download/delete and turn status/cancel routes, duplicate request coalescing, semantic working/ready/failed cues and an out-of-stage text panel. Legacy dialogue-only calls and provider connection tests cannot create files. No milestone 3 phone/summon/cinematic flow was added.

**Verification**
- Mocked all four provider transports through shared validation → safe persistence → director. Deterministic coverage includes hostile/Unicode names, UTF-8 byte limits, disallowed action fields, no Python execution, publication failures, reload/receipts, missing/changed/orphan/corrupt storage, cancellation before POST/during generation/at action checkpoint, simultaneous duplicates, local access, safe download and secret/path redaction.
- Chrome with an isolated Fake backend/config verified txt/md/py creation, duplicate name suffixes, semantic cue order, one final paginated response, thinking while waiting, cancellation returning to input, provider error performance, normal chat with no artifacts, navigation/reload persistence, preview/download/delete and no content in browser storage. Logical stage remained 256×192; screenshots inspected; no browser exceptions. A cancellation-response race found in the browser was corrected and the complete flow rerun successfully.
- Final **complete integrated suite against the combined working tree**: backend **309 passed / 1 skipped** (Windows developer symlink privilege unavailable); frontend **188 passed**; assets **196 references / 0 errors**; build **100 modules**, pass; lint clean; `git diff --check` pass. All earlier provider/service/director, typography, paginator, audio/music, waiting and Court Record tests run with the new tests.
- Final baseline/hash/file-set audit found **no unexpected concurrent modifications** outside the declared milestone files. HEAD stayed `178fda9`; nothing was staged. Browser fixture scripts, dedicated backend/Vite processes, scratch config/output files and Chrome profile were removed; ignored audit snapshot/results/screenshots remain for review. Source archives and all unrelated starting work were preserved.

---

## 2026-10-24 — Anthropic artifact truncation and shared output budgets

- Starting HEAD was the owner's checkpoint `5fd307a`; only untracked source/reference folders and OST runtime copies remained. The interrupted earlier staging turn ran no commands here. No source/archive was staged, deleted or rewritten, and no commit/push was performed.
- Inspected actual active profile metadata without reading/printing its credential: Anthropic / claude-sonnet-5-5, max_tokens **600**, timeout **120 s**. The adapter sent that exact saved budget for both chat and artifacts; shared validation previously capped max_tokens at 8,192. Verified current official stop-reason documentation.
- Added provider-independent expected workload and shared per-request budget copying. Normal dialogue retains its configured cap (600 in the inspected profile), explicit text-artifact requests use **16,384**, and the following normal turn returns to 600. Saved profiles, timeouts, byte limits, CharacterReply, validation/storage, director and paginator are preserved. Workload estimates only affect headroom, never action authorization; unrecognized phrasing may keep the conservative budget. No extra model generation or retry was added.
- Anthropic now reports output_token_limit versus context_window_exceeded separately; refusal/end_turn also remain distinct. Exhaustion is rejected before extraction/repair, even when returned JSON looks complete, so no partial artifact, artifact_ready or hidden/partial assistant history can appear. Separate safe generation diagnostics and distinct chat/Settings messages carry the requested cap and stop reason.
- Final full combined-tree checks: **345 backend passed / 1 skipped** (existing Windows symlink privilege skip); **190 frontend passed**; assets **196 / 0 errors**; build **101 modules**, pass; lint clean; git diff check pass. New tests mock all four provider adapters, assert actual wire budgets/immutability, test both complete-looking and partial truncated output, and save a larger completed file exactly once.
- No paid/live cloud generation was requested and no OS-vault credential was read. The active saved profile budget remains 600; the artifact budget is transient application policy.

---

## 2026-10-24 — Semantic Maya reaction-SFX reliability audit

- Traced LLM `Beat` values through CharacterDirector segments, `timelineToLines`, ConversationScreen's line-keyed SFX effect, `playSfx`, audio.json events, preloaded WAVs and the shared AudioContext. Reaction/SFX event order is before typewriter reveal; pagination assigns the event only to page 1. React StrictMode effect replay was not guarded by the prior event cooldown, so a line-key guard now ensures one request per beat.
- Root cause: Maya's `surprised` emotion inferred the visual `shocked` reaction, whose 0.46 effective reaction threshold and 5.2-second cross-reply cooldown also suppressed its mapped sound. The SFX `surprised` emotion fallback was therefore unreachable on that path. Explicit replies were only schema-allowed to name `shocked`; the fallback `maxPerReply` cap could also silence later emotion-only beats.
- Added shared prompt/schema semantic intents (`shock`, `surprise`, `realization`, `comic`, `emphasis`) and data mappings without provider-specific guidance. Explicit mapped sounds bypass emotion fallback thresholds and the fallback SFX cap, while the visual reaction retains its original intensity/cooldown/per-reply gates. Emotion-only thresholds: surprised .55, excited .60, playful .70, happy .70; anxious/neutral/calm/thinking stay silent.
- Added per-beat director selection/suppression notes; dev-only actual event outcome display and five-sound audition controls. WAV byte headers and semantic manifest mappings are tested. The supplied package still uses distinct shock, surprise, realization, comic and emphasis WAVs.
- Fixture review: FakeProvider has several explicit `shocked` cases (realization/worried/story), while French and Japanese samples only emit `surprised` + intensity. No persisted real-provider development CharacterReply was found in the repository, so actual cloud-provider reaction frequency cannot be claimed from these fixtures.
- No sprite, audio asset, provider, artifact, paginator, or performance presentation architecture was changed. Final validation: backend 351 passed / 1 existing Windows symlink skip; frontend 191 passed; asset validation 196 / 0 errors; build 101 modules; lint clean; `git diff --check` pass. No browser speakers were used to audition the samples; the dev panel now has controls for listening on the developer's machine.

---

## 2026-10-24 — Milestone 3 artifact delivery and generated-file Court Record

- Read `CLAUDE.md` and persistent project docs before editing. Starting Git state contained substantial user-owned modifications from earlier provider, output-budget, SFX, music, and artifact work plus untracked source/reference archives. All were preserved. Source/reference folders were not rewritten. Existing port 5199 was already occupied by a user's dev process; this run used isolated ports 5203 (Vite), 8012 (FakeProvider FastAPI) and Chrome CDP 9236 instead. The existing process was not touched. No additional unexpected concurrent write was observed.
- Model allocation: lead GPT-6.1-Sol / High; evidence-flow GPT-6.1-Sol / High; Court Record UI GPT-6.1-Sol / Medium; asset-reference GPT-6-Luna / Medium. The requested model assignments were supported and used as specified. The lead integrated shared `App`/`ConversationScreen` changes and reviewed all workstreams.
- Added a frontend-only delivery reducer. It consumes milestone 2 task/artifact results, uses a temporary Thinker cue during `artifact_working`, rings once when ready, waits for mouse/keyboard acknowledgement, shows a bounded summon, refreshes the existing artifact list, then releases the same buffered performance. Failure/cancellation show no phone/summon. Navigation/reload does not delete persisted files or replay the entire sequence.
- The generated-file Court Record reads from existing artifact list/read/download/delete endpoints, with six 64×64 square slots per 3×2 page, stable creation/ID order, empty/selected states, keyboard/mouse operation, pagination, safe inspector preview/download/delete, and no filesystem path. Static/demo evidence remains separate. The old Generated files panel is behind dev tools only.
- Native file icon: exact 64×64 crop from owner-supplied `docs/references/evidence.png` (same pixels as `envelope_tied`); source image left unchanged. Runtime manifest key `court_record_file_document`. Added byte-identical owner-supplied `phone_cut.wav`, `evidence_start.wav`, `evidence_finish.wav`. `phone_ring` reuses existing short `phonebeep.wav`; the full ringtone was not copied. Asset source/rights limits are in `ASSET_SOURCES.md`.
- Response buffering: one FakeProvider `#artifact-py` POST created `hello_maya.py`; final “All done! Your file is ready below.” was absent in the phone and summon states and appeared only after Continue. The dev last-reply diagnostic was also empty before release. Presentation code makes no API call; only the original request and existing task-status polling occurred. After release it used the ordinary performance/timeline/paginator path. Court Record preview showed inert Python text and download used only the opaque artifact ID; no Run/Execute action exists.
- Follow-up conversation: eight unrelated prompts were sent through FakeProvider; replies varied across greeting, family story, teasing, concern and realization fixtures, with no burger references. Since FakeProvider is deterministic and does not interpret the character prompt, this is not evidence of real-model adherence. `personality.md` now retains burgers and other Maya quirks but says they are occasional, context-led traits; no counters/filters or prompt architecture changes were added.
- Visual inspection: 256×192 stage at native/1× and captured 3×, 4×, and auto. The Court Record stays crisp with nearest-neighbour sprites and no horizontal overflow. The summon shows a readable filename/message and file icon. A nameplate collision was found when the Court Record overlay opened; the existing dialogue box is now hidden for that overlay. At 3×/4× auto selected 4× in the enlarged viewport. No typography, dialogue geometry, pagination, music or performance rule was changed.
- Automated frontend state-machine tests cover ready, duplicate ready, acknowledgement, summon, response buffer/release, failure and cancellation. Court Record tests cover derived entries/order, grid page movement/selection, empty/fallback/metadata behavior. Existing milestone 1/2 tests remain part of the complete run.
- Personality changed: `frontend/public/assets/characters/maya/personality.md`. No Maya sprites or performance rules changed.
- Validation: final counts are recorded below after the complete combined tree run. No real cloud-provider call was made; FakeProvider was used first and only. No provider credential was read or logged. No commit, push or staging occurred.

---

## 2026-10-24 — Artifact phone/acknowledgement and Court Record audio correction

- Preflight captured Git status, recent commits and content hashes before edits. The existing modified/untracked work, including `docs/references/courtroom-screens/`, was present in this task's baseline and preserved. That reference directory was reported as newly observed at the preceding milestone's final scan; no current source/reference archive was changed. No subagents were spawned for this focused pass, and no unexpected writes outside the declared correction paths were detected.
- Inspected the phone sources. Phoenix, Wellington and Godot MP3s have separate embedded ID3 titles. Selected the title-identified Phoenix recording, not the unlabeled `phone1.wav` or notification beep; copied its MP3 bytes unchanged to `audio/effects/phoenix_ringtone.mp3`. Offline spectral/sample analysis supplied a native loop region; see `ASSET_SOURCES.md` for metadata, SHA-256, seam metrics and provenance limits. No original DS loop claim or by-ear identification is made.
- Added semantic `phone_ring_loop` with reference-counted, cancellable event-loop leases in the existing audio engine. Duplicate acquisitions share one native source; releasing pending work prevents late decode playback. Phase exit, answer, cancellation/navigation/unmount stop the loop; volume changes update its gain without restarting it. Existing `phone_answer`/cut and evidence effects stay mapped as before.
- Added scoped MusicEngine duck leases: factor 0.12, 220 ms down / 350 ms restore. Original/imported tracks use a separate GainNode; radio uses bounded native-player volume ramps that preserve stop fades. User volume/mute, track/source and fade automation are not replaced. SFX mute releases attenuation while retaining the silent native loop; unmute updates it without a second source.
- Exposed the existing pre-generation workload estimate as advisory `expectedWorkload` in turn status. It cannot authorize an artifact and does not change provider requests, CharacterReply or storage. The browser starts the existing chat request once, then uses the hint to present a local character-defined acknowledgement concurrently. Maya's character manifest supplies four EN/FR/JA variants and a happy pose. Known document locale selects copy; there is no new language detector. No model call or history entry is added for acknowledgement.
- Extended the existing reducer with task acknowledgement and a minimum 350 ms working display. The local line uses the existing measured paginator, typewriter, animation and blips, holds 500 ms after typing, then changes to thinking/Thinker. Ready responses arriving early remain buffered. Failures finish the acknowledgement then release the existing error; cancellation returns to input without phone/summon. The original final performance is released after the existing summon.
- Restored Court Record ordinary menu sounds: cursor move, page, confirm/open/action, and cancel/back/close. Mouse and keyboard share the same handlers; movement sound has a 140 ms cadence cap. No delivery/evidence sound is used for browsing.
- Isolated FakeProvider Chrome checks on ports 8013/5204/CDP 9237 verified acknowledgement → working → phone → summon → final response; one POST per prompt; native ringing persisted for >22 seconds across its loop with one source; actual gains 0.80 → 0.096 → 0.80; answer stopped the source once; BGM never restarted. Follow-up checks covered mute preservation, provider failure, cancellation while work was pending, navigation during ringing, mouse/keyboard Court Record sounds, and dev audition start/stop. No browser exceptions were recorded. A Vite audio-module HMR reset during development required a full page reload; final checks used fresh pages after code settled.
- Listening was unavailable. Browser decoding/playback events, native-source count, real GainNode values and visual acknowledgement were checked; acoustic balance/loop approval remains a human check. Dev builds include a 45-second ringtone audition and Stop, including temporary BGM ducking, hidden during active turns and cleaned on unmount.
- Final combined-tree validation: **353 backend passed / 1 existing Windows symlink privilege skip; 216 frontend passed; assets 201 references / 0 errors; production build 110 modules; lint clean; `git diff --check` passed.** Existing provider/profile/credential, artifact persistence/cancellation, CharacterDirector, measured pagination/Japanese, typing/reaction SFX and music/import/radio regressions were included.
- No staging, commit or push. Temporary browser/server configuration, generated test files and analysis harnesses were isolated under ignored local storage and removed after validation; the owner's existing local outputs/configuration were preserved.

---

## 2026-10-24 — Conversation Record, evidence frame, collapsible panels, ringtones, token budgets

**Process and models**
- Lead: Claude Opus 5.5 (medium), covering architecture, contracts, shared integration (App, ConversationScreen, TitleScreen, settings, main.py, validator), review, browser validation and docs.
- Workers: conversation-history (Sonnet, high), token-budget (Sonnet, high), ui-polish (Sonnet, medium), audio-settings (Sonnet, medium), asset-reference (Haiku, default effort). No Opus workers. conversation-history needed one respawn after a spawn lock race.

**Implemented** (D-058 to D-061; see DECISIONS)
- **Backend:**
  - `app/conversation_record/` + routes;
  - capture in the chat route after a successful turn;
  - `llm/budgets.py`, `llm/errors.py`, `characters/context.py`;
  - provider stop-reason normalization.
- **Frontend:**
  - `EvidenceTile`, `ConversationRecordView` + API;
  - `CollapsiblePanel`;
  - `engine/ringtones.ts` + Settings ringtone row;
  - generation failure messages;
  - manifest `courtRecordPortrait`.
- **Assets:** evidence frame, Maya record portrait, Wellington/Godot ringtones.
- **Lead fixes during review:**
  - The record detail view used a 12 px line grid that clipped 16 px glyph descenders ("Mava Fev", "hello_maya.pv"); it is now 15 px everywhere.
  - The summon icon now renders at native 64×64 inside the frame instead of 48 px.
  - Character packs load once on demand for record portraits.
  - The conversation-record test now injects its store through `create_app`.

**Browser validation** (isolated backend on 8010 with a scratch config and a scratch FakeProvider wrapper for `#trunc`/`#ctx`; Vite 5180; the user's servers on 8000/5173 were untouched)
- **A, history:**
  - three exchanges (EN/FR/JA) gave three records, and a replayed requestId added none;
  - the grid showed framed Maya portraits;
  - details covered Japanese and long-text scrolling;
  - records persisted across a page reload and a backend restart;
  - no paths in responses.
- **B, artifact:**
  - the phone rang;
  - the summon showed the framed native icon;
  - exactly one record was linked to `hello_maya.py`;
  - after the file was deleted, the record showed "File no longer available".
- **C, panels:** all start collapsed; expanding persists `expandedPanels`; no horizontal overflow.
- **D, ringtones:**
  - Godot and Phoenix previews played one native loop each;
  - Stop and leaving Settings both stopped them;
  - with Godot selected, the real phone flow played the Godot loop with the duck at 0.12;
  - answering stopped it and restored 1.0 with Maya's track still playing;
  - menus and Settings stayed silent, and the conversation started Maya's BGM.
- **E, failures:**
  - `#trunc` (valid JSON with a `max_tokens` stop) and `#ctx` produced no file, no cues and no record;
  - failure classes were `output_truncated` (16,384 artifact budget) and `context_window_exceeded` (4,096 dialogue budget);
  - the chat showed the specific output-limit message, and no ringtone or summon appeared.
- **Not done:** no audio was heard. Normal UI flows keep the lists in sync; lists only go stale after changes made outside the UI, and Refresh syncs them.

**Final checks**
- Backend 405 passed, 1 skipped. Frontend 244 passed.
- `validate:assets` 205 / 0 errors. Build 120 modules. Lint, `tsc` and `git diff --check` pass. No secrets found.
- Scratch configs and launchers were deleted.
- `backend/.local/outputs` holds two files from 20:15 that were not created by this session (likely the user's own server); they were left untouched.
- No commit or push.

## 2026-10-24 — Fresh clone setup, scaling, dropdown lists, typing pace (D-062)

- Fresh clone on a new machine at `D:\Projets\Courtroom_companion\Courtroom-companion`. Backend `.venv` created with `requirements-dev.txt`; frontend `npm ci`. Backend on :8000, Vite on :5173.
- **Music "could not be decoded":** `frontend/public/assets/music/original/` (25 OST MP3s) was never committed (D-044 open item), so Vite answered with `index.html`. The owner's Downloads only held the general SFX zip (110 WAVs, no music), so no track could be restored. Fetches that return HTML now report "Audio file … is missing".
- Settings → Scale (`Pixel` / `Fit`, default Fit); native dropdown lists use the system font; typing speed scales with reply length (×1 to ×2).
- **Checks:** frontend 243 passed, 1 failed (`every runtime src exists on disk`: the 25 MP3s are absent; it also fails without these changes). `tsc -b`, lint and build pass. In the browser pane: Pixel = ×3 and Fit = ×3.80 for the same viewport; the Scale row renders. The pane draws native popups at half size, so the dropdown list's new font was confirmed in computed styles, not by eye. Typing pace was not timed in the browser.
- No commit or push.

## 2026-10-24 — OST MP3s restored on the fresh clone

- Source: owner-supplied `ace-attorney-original-soundtrack.zip` (88 MB, 38 entries). The 25 runtime tracks were matched by OST number to the `soundtrack.json` `src` names and copied into `frontend/public/assets/music/original/`; none missing, no ambiguous duplicates.
- **Checks:** `validate:assets` 205 / 0 errors (loop regions fit the files). Frontend 244 passed, 0 failed. In the browser, three tracks decoded at 44.1 kHz (14: 161.1 s, 03: 108.9 s, 33: 124.1 s), and entering a conversation made the music dock show "Maya Fey - Turnabout Sisters 2001" playing. Not heard by ear.
- The folder is untracked; no commit or push.

## 2026-10-24 — Themed dropdowns and conversation buttons (D-063)

- New `components/StageSelect.tsx`; 7 stage `<select>`s replaced (SettingsScreen, ProviderProfilesPanel). The dev panel's select (outside the stage) is unchanged. The D-062 `option` font rule was removed.
- Talk / Court Record / Record restyled like the chat bar.
- Looked for original button/list graphics: none in `docs/references` or `frontend/public/assets/ui`. spriters-resource.com returned a bot check in the browser pane and 403 to a direct fetch, so nothing was downloaded.
- **Checks:** frontend 244 passed, 0 failed; lint 0 warnings; build OK; `validate:assets` 205 / 0 errors. In the browser pane: Settings pickers render DS-styled; Soundtrack track opened inside the stage; ↓ + Enter changed the track and refocused the trigger; Enter reopened; Escape closed the panel and stayed in Settings. The owner's track choice was changed by the test and restored. Conversation buttons render in the DS frame with a blue hover.
- No commit or push.

## 2026-10-24 — Dick Gumshoe and Mia Fey (D-064)

- Extracted both owner-supplied sheets with the D-027 method (82 Gumshoe frames, 59 Mia frames), built packs under `frontend/public/assets/characters/{gumshoe,mia}/` (character.json, performance.json, personality.md, sprites, stand-in portrait), registered them in `characters/index.json` and added soundtrack profiles. Source sheets copied to `docs/references/`.
- Character select: fixed list height for preview entries (`MenuList.rowHeight`).
- **Checks:** `validate:assets` 348 / 0 errors. Backend loads all three characters without warnings; 406 passed. Frontend 244 passed; `tsc`, lint 0, build OK. The real `CharacterDirector` with sample replies: Gumshoe embarrassed → `head_scratch` + `worried` + comic SFX, determined → `fired_up`; Mia surprised → `surprised` + surprise SFX, gesture `hand_on_chin` honoured, serious SFX suppressed below 0.85. Browser: all three in the character select with previews; Mia's conversation scene renders her idle pose. Head-scratch frames composited on their canvas keep the body fixed.
- **Not done:** no live model conversation (the active profile is a real external provider, so no message was sent); poses and blink orders were judged from contact sheets, not watched in motion for every pose.
- No commit or push.

## 2026-10-24 — "Present evidence" v1 (D-065)

- Backend: `app/llm/attachments.py` (validation, prompt text, vendor formatting), `ChatMessage.attachments`, evidence through `CharacterService.chat` and `/api/chat`, `attachment_unsupported` mapping in the Anthropic / OpenAI-compatible / Ollama adapters, offline Fake reply. Tests: `tests/test_evidence.py` (20).
- Frontend: `src/evidence/` (evidence.ts, EvidenceViews.tsx, evidence.css), drop zone + Present button + pending chip + in-stage presented box in `ConversationScreen`, `ChatBar` `allowEmpty`/`submitLabel`, readable 422 messages in `sendChat`, `attachment_unsupported` message. Tests: `tests/evidence.test.ts` (5).
- **Checks:** backend 426 passed; frontend 249 passed; `tsc`, lint 0, build OK; `validate:assets` 348 / 0. End to end on an isolated pair (backend :8001 with `COURTROOM_CONFIG_DIR` in the scratchpad and the Fake provider, Vite :5174), so the owner's active profile was untouched: dropped text file → chip, "Present!", Mia's thinking pose, box slid in, reply named the file; PNG → thumbnail chip and the photo in the evidence frame during thinking (held with `#timeout`, then cancelled cleanly); `.zip` refused before sending; binary bytes named `.txt` refused by the server with its reason.
- **Not done:** no real provider was called, so actual image/PDF reading by Claude, GPT or Gemini is unverified; the evidence sound was not heard.
- No commit or push.

## 2026-10-24 — Interface languages (D-066)

- Frontend: i18n module, `language` setting (+ `<html lang>`), translated player-facing screens, localized names (`names` in character.json), localized talk topics, evidence/model-failure messages, `ChatError.code` for translated evidence rejections, conversation buttons kept on one line (Japanese line breaks).
- Backend: `language` on `/api/chat`, prompt language section, `GenerationRequest.language`, translated Fake texts and keywords, translated error lines in the director, profile `names` / `error_texts`.
- Character data: names for all languages, it/es acknowledgements, `errorLine.translations`; Gumshoe's French acknowledgement now says "Tektiv". Maya's manifest was edited textually (5 lines) to keep its hand formatting.
- **Checks:** backend 436 passed (10 new in `test_i18n.py`); frontend 254 passed (5 new in `i18n.test.ts`); `tsc`, lint 0, build OK; `validate:assets` 348 / 0. Browser (main instance, no message sent): language picker lists the 5 languages in their own scripts; switching to 日本語 translated Settings, the music dock, the main menu, the character select (綾里真宵 / 糸鋸圭介) and the conversation controls; the pane was reset to English afterwards.
- **Not done:** no real model call in another language; French/Italian/Spanish screens were not each inspected visually (covered by the completeness test).
- No commit or push.

## 2026-10-25 — Agents and events (D-067) and voiced shouts (D-068)

- Wrote `docs/AGENTS_AND_EVENTS.md` (handoff plan + status) before implementing; roadmap Phase 7.
- Implemented the event inbox, exclamation bubbles, Claude Code hook + installer, tool framework with reminders, authorized folders and web search, Settings → Tools, voiced shouts and the title intro.
- Voices: the owner supplied `3DS - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Sound Effects.zip` (113 WAVs named by archive offset). Candidates were found by duration/pitch and transcribed offline (faster-whisper "small", scratchpad venv); the owner labelled speakers on a local audition page. 12 clips installed (see D-068).
- **Checks:** backend 449 passed (test_events 5, test_tools 8 new); frontend 259 passed; `tsc`, lint 0, build OK; `validate:assets` 360 / 0. End to end: hook payload piped into the script → Mia's "Objection!" bubble + 「異議あり！テストが失敗しているわ…」 in the main instance; isolated Fake instance (:8001/:5174): Settings → Tools panel, `#folder`, `#read notes.txt`, `#remind` → phone + reminder line one minute later; title intro shows the bubble and preloads the shout voices.
- **Not done:** hook not installed in `~/.claude/settings.json` (owner consent); no real web search key; voices not heard by me; Phoenix JA objection unidentified.
- No commit or push.

## 2026-10-25 — Title shout was silent; Claude Code hook installed

- **Bug:** the title shout never played. The click is the first gesture: `audioEngine.unlock()` creates a suspended context and only then starts decoding, so the immediate `play()` returned false silently (reproduced: 0 plays, context running and 5 voices decoded two seconds later).
- **Fix:** `audioEngine.playWhenReady(id, volume, maxWaitMs = 800)` / `playEventWhenReady` wait for the resume and decode, then play (dropped if later than 800 ms). Used by the title intro and event exclamations. Verified on a fresh load: first click → `voice_ja_edgeworth_objection` played once.
- **Claude Code hook installed** in `~/.claude/settings.json` with the owner's consent: 5 async groups added next to the 12 existing hooks, all other settings unchanged (checked by computation before and after), backup `settings.json.bak-2026-10-24T23-03-23-641Z`. Live check: a test command in this session produced a `tests_passed` event from project `frontend`.

## 2026-10-25 — Wider title draw (D-069)

- The owner kept hearing the same shouts: with "Shouts: Japanese" only Mia and Edgeworth were installed. On request: title draws from all objection voices in both languages, no immediate repeat; installed Mia's 2nd English take, five "other" voices and Phoenix's Japanese objection (identified by the owner on a 4-clip page: 0xB29A0).
- **Checks:** `validate:assets` 367 / 0; frontend 260 passed (title draw test); three fresh loads played three different voices (`voice_en_mia_take2_objection`, `voice_en_edgeworth_objection`, `voice_en_mia_objection`).

## 2026-10-25 — Japanese bubbles mechanism (D-070)

- Bubble choice follows the voice language (`events/exclamations.ts` `bubbleFor`, `isJapaneseVoice`); title and conversation wired; test added (frontend 261 passed). Waiting for the owner's 「異議あり！」 image file.

- 2026-10-25: Japanese 「異議あり！」 bubble added from the owner's `igiari.jpeg` (converted to the DS bubble format). Browser: 4 title draws — Japanese voices showed `objection_ja.png`, English voices `objection.png`.

## 2026-10-25 — Prepare the push to AirportSource (D-071)

- Owner on a friend's PC wants everything on their own GitHub (AirportSource, public repo), directly on `main`, commits as `Adriano. P <122989996+AirportSource@users.noreply.github.com>` (repo-local config). The `gh` CLI on this PC is signed in to the friend's account (read-only on the repo), so the owner signs in for the push and the access is removed afterwards.
- OST excluded (`.gitignore`), `scripts/install_ost.py` + download link (README, MUSIC.md); validator/test tolerate a clone without the OST (simulated by moving the folder out: validate 343 / 0 with a notice, music tests 38 passed). Root README written (setup, OST, AI profiles, Claude Code hook, checks, credits).

## 2026-10-25 — Subscription profiles (D-072)

- Owner asked to use a Claude or ChatGPT/Codex subscription in Settings, in addition to the API. Added the `claude_code` and `codex` profile types (backend provider, profile validation, gateway registry, Settings panel with install/login help and error messages) and 9 tests (`test_subscription_cli.py`).
- **Live check (Claude):** isolated backend :8001 with a "Claude (abonnement)" profile (haiku). Test Connection → `generation_succeeded` in 3.5 s. Mia answered in French and the `reminder_create` tool worked ("Rappelle-moi dans 30 minutes…" → pending reminder "Relire le contrat"). Verified that `--setting-sources ""` keeps the user's Claude Code hooks from firing.
- **Not verified:** Codex CLI is not installed on this PC (simulated tests only). The Settings panel was not checked visually.
- **Checks:** backend 458 passed; frontend 261 passed / 2 skipped; `tsc`, lint 0, build OK; `validate:assets` 368 / 0.
