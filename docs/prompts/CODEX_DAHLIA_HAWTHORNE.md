# Courtroom Companion — Add Dahlia Hawthorne
## Codex agent prompt

Repository: `C:\Users\adria\Documents\GitHub\Courtroom-companion`

Add **Dahlia Hawthorne** (Trials and Tribulations) as a new, fully playable conversation character,
built the same way as Miles Edgeworth, Franziska von Karma, Larry Butz and Pearl Fey. Follow the
existing architecture; do not invent a new one.

---

## 0. Hard rules (read first)

- Do NOT stage, commit, push, reset, clean or rewrite history. Do not use `git add .`.
- Preserve every existing working-tree change. Check `git status --short` before and after.
- The root `assets/` folder is **read-only source material**. Never modify, move or delete it.
  Never reference it at runtime. Anything the browser needs is converted deterministically into
  `frontend/public/assets/` and referenced through the manifests.
- No absolute Windows paths, `file://` URLs or paths into root `assets/` in any runtime manifest
  (the asset validator rejects them).
- Never generate new artwork with image AI. Only convert the supplied sprites.
- Never hard-code Dahlia (or any character) in React components, the renderer, the audio engine
  or the CharacterDirector. Everything character-specific lives in her pack.
- Never kill processes you did not start (no `taskkill /IM chrome.exe`, no killing all `node`).
  Stop your own servers by PID.
- Never use the owner's real AI profile or data for tests. A backend started from the repo in dev
  mode stores data in `backend/.local` (the owner's profiles and Conversation Record). For any
  isolated backend set `COURTROOM_CONFIG_DIR` to a scratch folder and use the fake provider
  (`COURTROOM_LLM_PROVIDER=fake`). Real-model behaviour tests only with the owner's explicit OK.
- Shell pitfall seen on this machine: backslashes in inline heredocs can be mangled (a regex `\b`
  became a backspace). Write regex-heavy patches to a file and run them, then grep the result.
- Never claim you listened to audio or watched an animation you only measured. Say "not auditioned".

---

## 1. Read the current state first

Read: `CLAUDE.md`, `docs/PROJECT_STATE.md`, `docs/DECISIONS.md` (especially D-026, D-027, D-048,
D-079–D-097), `docs/CHARACTER_BEHAVIOR_FRAMEWORK.md`, `docs/CHARACTER_DIRECTOR.md`,
`docs/ASSET_INVENTORY.md`, `docs/ASSET_SOURCES.md`, `docs/ASSET_EXPANSION_INVENTORY.md`,
`docs/ASSET_EXPANSION_GAPS.md`, `docs/MUSIC.md`, `docs/PRESENTATION_DS_MIGRATION.md`,
`docs/TARGETED_CORRECTIONS.md`.

Study one complete recent pack as the template: `frontend/public/assets/characters/pearl/`
(`character.json`, `performance.json`, `personality.md`, `sprites/`, `portraits/`), plus
`franziska/` for presentation groups, signature effects and `selectionPreview`.

Then run and keep the output:

    git status --short
    git diff --stat

---

## 2. Source assets for Dahlia (inspect, do not trust filenames blindly)

- `assets/characters/3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Dahlia Hawthorne.png`
  - 1208x2498, 3DS Trilogy (HD), a single tall composite **without transparent gutters**.
  - **Main source.** Its poses are front-facing witness/conversation poses: check that visually.
- `assets/characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Dahlia Hawthorne.png`
  - 3864x7244 PC Trilogy HD sheet.
  - PC sheets are **part atlases** (separate body, heads and mouths, with no assembly data). They
    cannot become talking animations. Use them only for reference or a portrait crop if clearly
    better.
- `assets/other assets/artbook/Characters/Trials and Tribulations/` may contain Dahlia artwork.
  Reference only; never runtime sprites.
- `assets/other assets/profiles/` and `assets/other assets/evidences/` may contain a native
  front-facing profile portrait. Prefer an exact native crop for the 64x64 Court Record portrait,
  as was done for Franziska (D-089).
- There is **no native DS sheet** for Dahlia. Unlike the first wave (cut 1:1 by
  `scripts/extract_ds_character.py`), she must go through the HD→DS character converter.

Report what each source actually contains: the poses, their frame counts, and which are
idle/talking/one-shot.

---

## 3. Sprite conversion (HD → DS, D-083)

Use the existing converter, `scripts/convert_hd_characters_to_ds.py`. Do not write a new pipeline.
Dependencies are in `scripts/requirements-assets.txt` (Pillow, numpy, scipy); install them in a
scratch virtualenv.

1. **Inventory:**

       python scripts/convert_hd_characters_to_ds.py SHEET --list --overview <scratch>/dahlia_overview.png

   Look at the overview and identify each frame index by eye.

2. **Convert** with the 3DS platform scale (0.71, measured on characters that exist in both DS and
   HD), profile B (20 colours) by default:

       python scripts/convert_hd_characters_to_ds.py SHEET --out <scratch>/dahlia --name dahlia \
              --platform 3ds --profile B --anim idle=… --anim talk=… [--shared-palette]

   - Use profile A (32 colours) only if fine detail breaks (it was needed for Godot's visor).
   - Keep the converter's guarantees: one fixed scale, one anchor and palette per animation, binary
     alpha, frames cropped together (no jitter), no sharpening.

3. **Contact sheet before installing.** Composite the converted frames on two or three real
   backgrounds next to an existing DS character (Maya or Mia) at 1x and 3x. Check:
   - head height and body scale are consistent with the DS cast;
   - no halo or semi-transparent edges;
   - no frame-to-frame drift;
   - the mouth moves only on talking frames.

   Fix the scale or offsets in the manifest (`render.scale`, `offsetX`, `offsetY`, canvas
   `offsets`), never by editing pixels.

4. Install the runtime frames under `frontend/public/assets/characters/dahlia/sprites/<animation>/…`
   with deterministic names. Record provenance (source file, SHA-256, frame indices, scale,
   profile) in a `source.json` next to the frames or in the docs.

5. **No side views in conversation.** Conversation mode must never show courtroom side-view
   sprites (D-091). If the sheet contains any side or bench poses:
   - put them in a `presentationGroups.courtroom` group;
   - give `presentationGroups.conversation` `"inheritReactions": false`, so courtroom reactions
     cannot leak into conversation.

   If every pose is front-facing, a single legacy pack, like Pearl's, is fine.

6. **Portraits:**
   - `portraits/court_record.png`: exactly 64x64, square, front-facing. Prefer a native crop;
     otherwise a 1:1 crop from the converted idle frame.
   - `selectionPreview` (optional): a centred square crop for the character menu, if the default
     idle frame sits off-centre.

---

## 4. Character pack files

Create `frontend/public/assets/characters/dahlia/` with the same structure as Pearl.

### 4.1 `character.json`

Match Pearl's keys and conventions:

- `schemaVersion`
- `id`: `"dahlia_hawthorne"`. This must stay exactly that: the soundtrack profile already uses it.
- `displayName`: `"Dahlia Hawthorne"`.
- `names`: names per interface language. Japanese name: 美柳ちなみ; check the official localised
  names for FR/IT/ES and use the English name where no localisation exists.
- `anchor`, `render`.
- `voice.blip`: `"blip_female"`.
- `courtRecordPortrait`: `{ src, width: 64, height: 64 }`.
- `waiting`: the thinking pose held while a reply is generated.
- `taskAcknowledgements.artifact`: short in-character "I'm on it" lines for file requests, in
  en/fr/ja/it/es.
- `defaultEmotion`, `fallbackEmotion`, `animations` (idle + talking, `frameDurations`,
  `holdJitterMs` for natural blinks), `reactions` (one-shots), `emotions` (emotion → animation
  [+ reaction]), `unassignedFrames` (any converted frames not used).
- `readiness`: start at `"partial"`.
- `group`: `"aa3"`.
- Optional `semanticSounds` (see §6).

Map at least these emotions:

| Covered | Emotions |
|---|---|
| Must have | neutral, happy, thinking, surprised, sad, anxious, playful, explaining, polite, relaxed, serious, angry, embarrassed |
| Add where a pose exists | grateful, laughing, determined, crying |

Every emotion must point to a real animation. Use `fallbackEmotion` rather than duplicating poses
badly.

### 4.2 `performance.json`

Copy the structure of Pearl's and Franziska's files:

- `director`: expressiveness, max beats/reactions per reply, reaction cooldown and threshold, pose
  hold, `msPerChar`.
- `sfx` (§6).
- `gestures`, `intensityVariants`, `emotionAliases` (shy, flustered, worried, scared, smug,
  teasing, sarcastic, irritated… mapped to her real emotions), `reactionAliases`.
- `errorLine` with translations.
- `eventLines` for `task_finished`, `needs_attention`, `tests_passed`, `tests_failed`,
  `build_failed`, `session_started` and `reminder_due`. Each needs en/fr/ja/it/es variants with
  emotion and intensity; `reminder_due` must contain `{text}`.

### 4.3 `personality.md`

Follow `docs/CHARACTER_BEHAVIOR_FRAMEWORK.md`. The priority order is:
1. answer the user's actual subject;
2. react emotionally in character;
3. speech style;
4. quirks only occasionally;
5. theatrics and SFX only when they fit.

Dahlia's character:
- a sweet, demure, almost angelic surface: soft-spoken and polite;
- underneath, a cold, calculating, manipulative core that shows through in small, chilling ways;
- she plays the fragile victim, uses honeyed pet names, and turns contemptuous when crossed;
- her parasol and butterfly motifs may appear occasionally, never as a catchphrase spam.

Constraints:
- She stays a fictional companion: she helps correctly and never encourages real harm,
  manipulation of real people, self-harm or crime.
- Her menace is flavour, not instructions. She drops the act when the user is genuinely upset.
- Never mention being an AI, prompts, files of this app or "sprites".
- Keep replies dialogue-box short, usually one or two beats.

---

## 5. Registration and readiness

- Register her in `frontend/public/assets/characters/index.json`: `"dahlia_hawthorne": "dahlia/character.json"`.
- Keep `readiness: "partial"` until the behaviour checks in §8 pass. Only then set `"ready"`.
  Partial packs are listed with `[WIP]` and refused for chat unless
  `COURTROOM_ALLOW_PARTIAL_CHARACTERS=1` is set (dev only).
- The backend (`CharacterRepository`) must load her pack with **no warnings**. Every emotion,
  alias, gesture and reaction must exist.

---

## 6. Sounds

- **Music:** `soundtrack.json` already has the profile `dahlia_hawthorne` with default track
  `dahlia_hawthorne_the_visage_of_what_once_was` (a DS-original FLAC). Do not change the soundtrack
  or its loops. Only check that the profile key matches her id, that her theme plays in a
  conversation and that the strip's track list (D-097) marks it with ★.
- **Semantic SFX (D-092):**
  - She can use the shared sounds through explicit reactions: surprise, shock, realization, comic,
    emphasis, angry, flabbergasted, encouragement, plus the aliases scared, insightful and
    you_can_do_it.
  - Add emotion fallbacks with thresholds calibrated to her expected intensity range. Look at how
    Pearl was calibrated: thresholds were too high and nothing fired.
  - Use `fallbackCooldownTurns` / `categoryCooldownTurns` / `droughtTurns` so she is alive but never
    plays a sound on every line.
  - Optional `semanticSounds` in `character.json` for character-specific picks. Use only existing
    sound ids from `audio.json`; reuse sounds by hash before adding any new file.
- **Signature (optional):** only if it fits and stays rare (D-081/D-091). It goes in
  `performance.json` `sfx.signature` with cooldown ≥ 3 replies and at most one per reply. A
  signature with a visual must use `performs` with a reaction `effect` (overlay + cues), so it is
  always complete or absent.

---

## 7. Automated checks (all must pass; never weaken an existing test)

Run from the repo:

- Backend: `backend\.venv\Scripts\python.exe -m pytest -q` (use `--basetemp=<scratch>` if the
  default temp folder is not writable).
- Frontend: `npm test`, `npx tsc -b`, `npm run lint`, `npm run validate:assets`, `npm run build`
  (in `frontend/`).
- `git diff --check`.

Add focused tests where useful, following the existing ones:

- `backend/tests/test_character_platform.py`:
  - all registered packs load with no warnings;
  - complete packs are fully localised;
  - signatures stay rare and are never in event lines.
- A test that Dahlia's emotions all resolve and her soundtrack profile exists.

---

## 8. Behaviour checks before `ready`

1. **Deterministic first.** Run CharacterDirector simulations with representative fake replies
   (calm, happy, sad user, provocation, file request, realization). Check that:
   - poses and reactions resolve;
   - sounds fire in a balanced way: several in ten replies, not every line;
   - nothing in her performance is partial.
2. **Real-model run, only with the owner's OK** and an isolated `COURTROOM_CONFIG_DIR`.
   - Ten unrelated turns: a greeting, a joke, grief, disagreement, a file request, a tech question,
     good news, frustration, a follow-up, goodbye.
   - Check that she:
     - answers every subject;
     - stays recognisable;
     - doesn't spam pet names or butterflies;
     - drops the act for real distress;
     - never borrows Maya's or Pearl's habits.
   - Then do a Maya → Dahlia → Maya isolation run in one session: no memory or persona bleed, and
     Conversation Record entries labelled with the right character.

---

## 9. Browser QA (mandatory)

Run your own Vite server on a free port in your own tab. A backend is only needed for chat, and
it must be isolated.

- Character select shows her with a centred preview.
- In a conversation:
  - idle and talking animate at 1x/2x/3x/4x/auto;
  - no clipping or jitter;
  - head height is close to Maya and Mia;
  - the dialogue box doesn't hide her face.
- In the detention center (bg_03) she sits behind the glass: counter and frame in front, waist
  hidden (D-096).
- The Court Record and Journal portrait is front-facing.
- Her blip plays.
- The theme plays and loops. That's measured only; say "not auditioned".
- The animation test screen lists her emotions and reactions; conversation shows no side sprites.

---

## 10. Documentation (append; never rewrite history)

Update:
- `docs/DECISIONS.md`: a new D-0xx entry for Dahlia's pack, sources, conversion profile/scale,
  readiness evidence and limits.
- `docs/ASSET_INVENTORY.md` and `docs/ASSET_SOURCES.md`: runtime files, provenance, hashes,
  scripts and arguments used.
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md` (checkbox) and `docs/SESSION_LOG.md` (a concise entry
  with checks and anything not verified).
- `docs/CHARACTER_BEHAVIOR_FRAMEWORK.md`, only if you learned something reusable.

---

## 11. Final report

Report each of these:

1. Sources inspected and what they contain.
2. Frames chosen per animation.
3. Conversion command lines, scale and profile.
4. Contact-sheet result and any manifest placement tweaks.
5. Portrait source.
6. Emotions, reactions and aliases mapped.
7. Personality summary.
8. SFX settings and why.
9. Readiness status and evidence.
10. Test counts: backend, frontend, validate, tsc, lint, build, diff-check.
11. Browser QA done and not done.
12. Exact files added or changed.
13. Limitations, including the things not auditioned or not watched.

Nothing staged, committed or pushed.
