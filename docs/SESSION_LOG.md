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
