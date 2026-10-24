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
