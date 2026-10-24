# Asset Inventory — Courtroom Companion

_Updated 2026-10-24 after the Igiari + DotGothic16 stage/UI font integration, from files that actually exist on disk. Nothing here is hypothetical. Regenerate whenever assets are added, removed, renamed or reorganized, and run `npm run validate:assets`._

> **Correction:** the 2026-10-24 initialization version of this file said "132 Maya sprite frames". The real count was, and is, **97** (verified against `git ls-tree HEAD` at `8bf0937`). No frames were lost.

All paths are relative to `frontend/public/assets/`. Browser URL = `/assets/` + path. No path contains spaces.

Current totals: 102 Maya sprite frames (101 assigned + 1 unassigned) · 29 backgrounds · 2 blips · 4 dialogue SFX · 4 effect SFX · 9 UI SFX · 2 runtime fonts · 9 UI images · 0 music · 5 manifests. `npm run validate:assets` reports 161 referenced files.

---

## Manifests

| File | Purpose | Validation |
|---|---|---|
| `characters/index.json` | Character registry: `maya_fey` → `maya/character.json` | ✅ |
| `characters/maya/character.json` | Maya pack (schema v1): 12 animations, 1 reaction, 13 emotions | ✅ all 97 frames referenced |
| `backgrounds/backgrounds.json` | 29 backgrounds `bg_01`…`bg_29` with real dimensions | ✅ dimensions match PNG headers |
| `audio/audio.json` | 18 sounds in categories `blip`, `dialogue`, `effect`, `ui` | ✅ |

Validated by `frontend/scripts/validate-assets.mjs` (`npm run validate:assets`). It fails on missing files, whitespace in paths, unknown cross-references, background size mismatches, and any media file under `assets/` that no manifest references.

---

## Maya — conversational animations

> **Superseded 2026-10-24** by the native re-extraction; see "Maya — native re-extraction" at the end of this file.

Folder: `characters/maya/sprites/`. All frames are 8-bit RGBA PNG named `maya_frame_NNN.png`. NNN is the original source frame number, kept for traceability.

| Animation id | Folder | idle frames | talking frames | fps | Frame size(s) |
|---|---|---|---|---|---|
| `neutral_front` | `neutral_front/` | 009–012 | 013–016 | 6 | 65–66×111 |
| `smile_front` | `smile_front/` | 039–042 | 043–046 | 7 | 63–64×112 |
| `excited_front` | `excited_front/` | 078–081 | 082–085 | 9 | 66–67×110 |
| `thinking_side` | `thinking_side/` | 047–050 † | 051–054 † | 6 | 64×107 |
| `sad_crying` | `sad_crying/` | 031–034 | 035–038 | 6 | 65–66×100 |
| `necklace_anxious` | `necklace_anxious/` | 070–073 | 074–077 | 7 | 75×110 |
| `hand_mouth_giggle` | `hand_mouth_giggle/` | 086–089 | 090–093 | 7 | 63–64×110 |
| `clasped_hands_happy` | `clasped_hands_happy/` | 055–058 | 059–062 | 8 | 65–66×107–108 |
| `clasped_hands_laugh` | `clasped_hands_happy/` | 055–058 (shared) | `talking_laugh/` 066–069 | 8 | 65–66×108 |
| `arms_open` | `arms_open/` | 017, 019, 020 | 021 †, 022, 023 | 8 | 94–95×107 |
| `bow_polite` | `bow_polite/` | 001–004 † | 005–008 † | 6 | 55×108 |
| `three_quarter` | `three_quarter_idle/` | 094–097 | 098–101 | 6 | 67–68×109 |

† Split inferred visually (mouth closed vs moving) plus the 4+4 numbering pattern. See DECISIONS D-013.

All 12 animations have both idle and talking variants.

## Maya — one-shot reactions

> **Superseded 2026-10-24** by the native re-extraction; see "Maya — native re-extraction" at the end of this file.

| Reaction id | Folder | Frames | fps | Sizes | Note |
|---|---|---|---|---|---|
| `shocked` | `shocked_panicked/reaction/` | 025–030 | 10 | 109×111, 74×108, 56×105 ×4 | recoil (arms up) → "O" mouth hold |

## Maya — unassigned

> **Superseded 2026-10-24** by the native re-extraction; see "Maya — native re-extraction" at the end of this file.

| File | Size | Reason |
|---|---|---|
| `sprites/_unassigned/maya_frame_024.png` | 63×111 | Front-facing, arms-down pose. Was misfiled in `arms_open/talking`. |

Missing source frame numbers: 018, 063, 064, 065.

## Maya — emotion map

| Emotion | Resolves to |
|---|---|
| neutral _(default, fallback)_ | `neutral_front` |
| happy | `smile_front` |
| excited | `excited_front` |
| thinking | `thinking_side` |
| surprised | reaction `shocked` → then `neutral_front` |
| sad | `sad_crying` |
| anxious | `necklace_anxious` |
| playful | `hand_mouth_giggle` |
| grateful | `clasped_hands_happy` |
| laughing | `clasped_hands_laugh` |
| explaining | `arms_open` |
| polite | `bow_polite` |
| relaxed | `three_quarter` |

Voice: `blip_female`. Anchor: `bottom-center`.

---

## Backgrounds

Folder: `backgrounds/`. 29 files, 8-bit RGB PNG. Descriptions are visual notes from thumbnails, not canonical names.

| ID | File | Size | Description |
|---|---|---|---|
| bg_01 | background_01_256x192.png | 256×192 | dim blue office / reception at night |
| bg_02 | background_02_512x192.png | 512×192 | dark office with sofa and desk |
| bg_03 | background_03_256x192.png | 256×192 | detention center visitor room with guard |
| bg_04 | background_04_256x192.png | 256×192 | warm room with flowers, table and window |
| bg_05 | background_05_256x192.png | 256×192 | ornate office with painting and bookshelves |
| bg_06 | background_06_256x192.png | 256×192 | bright office with plant and window |
| bg_07 | background_07_256x192.png | 256×192 | gold-decorated office with painting |
| bg_08 | background_08_256x192.png | 256×192 | apartment kitchen and dining table |
| bg_09 | background_09_256x192.png | 256×192 | street outside a building with truck |
| bg_10 | background_10_256x192.png | 256×192 | park entrance with WELCOME sign |
| bg_11 | background_11_512x192.png | 512×192 | street with bicycle and cafe tables |
| bg_12 | background_12_256x192.png | 256×192 | film studio with camera and chalk outline |
| bg_13 | background_13_512x192.png | 512×192 | yard behind buildings |
| bg_14 | background_14_256x192.png | 256×192 | staff room with posters and table |
| bg_15 | background_15_256x192.png | 256×192 | park path with bare trees and stone sign |
| bg_16 | background_16_256x192.png | 256×192 | lakeside with benches and vending machine |
| bg_17 | background_17_256x192.png | 256×192 | boat rental hut |
| bg_18 | background_18_256x192.png | 256×192 | men in black suits ⚠ characters baked in |
| bg_19 | background_19_512x193.png | 512×193 ⚠ | lake shore with car |
| bg_20 | background_20_256x192.png | 256×192 | open-plan office with desks |
| bg_21 | background_21_256x192.png | 256×192 | tatami room with low table |
| bg_22 | background_22_255x192.png | 255×192 ⚠ | subway platform with train |
| bg_23 | background_23_512x192.png | 512×192 | garage with car |
| bg_24 | background_24_256x191.png | 256×191 ⚠ | long corridor with cells or lockers |
| bg_25 | background_25_256x192.png | 256×192 | executive office with red curtains |
| bg_26 | background_26_256x192.png | 256×192 | police station entrance |
| bg_27 | background_27_256x192.png | 256×192 | hallway with cacti and cabinets |
| bg_28 | background_28_512x192.png | 512×192 | dark locker room |
| bg_29 | background_29_512x192.png | 512×192 | hall with pipe organ |

Wide (512 px, pannable): bg_02, 11, 13, 19, 23, 28, 29.

---

## Audio

Folder: `audio/`. All mono PCM WAV. Files unchanged this session; only `audio.json` was rewritten.

### Dialogue blips (`blip`)
| ID | File | Format | Duration |
|---|---|---|---|
| blip_female | blips/blip_female/blipfemale.wav | 8-bit 16364 Hz | 0.053 s |
| blip_male | blips/blip_male/blipmale.wav | 8-bit 16364 Hz | 0.052 s |

### Dialogue SFX (`dialogue`)
| ID | File | Format | Duration |
|---|---|---|---|
| sfx_assertive | dialogue/assertive/objection.wav | 16-bit 21819 Hz | 1.325 s |
| sfx_cute | dialogue/cute/meow.wav | 16-bit 21819 Hz | 0.854 s |
| sfx_idea | dialogue/idea/lightbulb.wav | 8-bit 16364 Hz | 0.935 s |
| sfx_realization | dialogue/realization/realization.wav | 8-bit 16364 Hz | 1.188 s |

### Effect / impact SFX (`effect`)
| ID | File | Format | Duration |
|---|---|---|---|
| fx_damage | dialogue/shock/damage2.wav | 8-bit 15768 Hz | 0.925 s |
| fx_smack | dialogue/shock/smack.wav | 8-bit 15768 Hz | 0.464 s |
| fx_stab | dialogue/shock/stab2.wav | 16-bit 21819 Hz | 0.602 s |
| fx_whack | dialogue/shock/whack.wav | 16-bit 21819 Hz | 0.459 s |

### UI SFX (`ui`)
| ID | File | Format | Duration |
|---|---|---|---|
| ui_cancel | menu_ui/cancel.wav | 8-bit 16364 Hz | 0.148 s |
| ui_evidence | menu_ui/evidenceshoop.wav | 16-bit 21819 Hz | 0.161 s |
| ui_save | menu_ui/saveblip.wav | 8-bit 16364 Hz | 0.488 s |
| ui_scroll | menu_ui/scroll.wav | 16-bit 21819 Hz | 0.097 s |
| ui_select | menu_ui/selectblip.wav | 8-bit 16364 Hz | 0.070 s |
| ui_select_alt | menu_ui/selectblip2.wav | 8-bit 16364 Hz | 0.237 s |
| ui_jingle | menu_ui/selectjingle.wav | 8-bit 16364 Hz | 1.591 s |
| ui_typewriter | menu_ui/typwriter.wav _(sic)_ | 8-bit 16364 Hz | 0.184 s |

### Music
**None.** `music/` exists with only `.gitkeep`.

---

## Visual effects
**None.** No flash, shake or speech-bubble graphics.

## UI graphics
**None.** `ui/` exists with only `.gitkeep`. The Vite demo `hero.png` was removed (byte-identical to the scaffold image, unreferenced, recoverable from Git).

Referenced-but-missing scaffold files (not game assets): `/favicon.svg` (index.html), `/icons.svg` (App.tsx).

---

## Update 2026-10-24 (Phase 2B)

No runtime assets were added, removed or renamed. `ui/` and `music/` still hold only `.gitkeep`. All UI graphics are CSS stand-ins pending manual download of the original sheets; see `docs/ASSET_SOURCES.md`, which also records the provenance status of the existing assets.

Runtime usage of existing assets:
- `audio.json` `blip_female` is used as Maya's voice (`voice.blip` in `character.json`).
- `blip_male` is used by test line 7 and the dev voice override.
- No other sounds are played yet.

---

## Update 2026-10-24 (presentation pass)

### New UI assets (`frontend/public/assets/ui/`, manifest `ui/ui.json`)

> **Font row superseded 2026-10-24:** the original presentation pass used `ace_attorney.ttf`; the current Igiari runtime font is recorded at the end of this inventory.

| ID | File | Size | Notes |
|---|---|---|---|
| `title_screen` | `title/title_screen.png` | 256×192 | Original DS title art (crop of the owner-supplied Spriters Resource sheet, 208 colours) |
| `exclamation_objection` | `exclamations/objection.png` | 256×192 | Transparent background; not used at runtime yet |
| `exclamation_take_that` | `exclamations/take_that.png` | 256×192 | Transparent background; not used at runtime yet |
| `exclamation_hold_it` | `exclamations/hold_it.png` | 256×190 | Transparent background; not used at runtime yet |
| font `dialogue` | `fonts/ace_attorney.ttf` | — | "Ace Attorney" (David Fens, FontStruct, non-commercial licence); 16 px grid. No `-` or `…` glyphs. |

Provenance is recorded in `docs/ASSET_SOURCES.md`. Original source files stay in `docs/references/` (untracked).

`npm run validate:assets` now covers `ui.json` (files and PNG dimensions). Fonts count as media for the unreferenced-file check. Total referenced files: **149**.

### Maya manifest additions (D-022)

> **Superseded 2026-10-24** by the native re-extraction; see "Maya — native re-extraction" at the end of this file.

Each animation now has a `canvas` and each clip an `offsets` list. Frames and pixels are unchanged.

| Animation | Canvas | Animation | Canvas |
|---|---|---|---|
| neutral_front | 66×111 | clasped_hands_happy | 66×107 |
| smile_front | 64×112 | clasped_hands_laugh | 66×108 |
| excited_front | 67×110 | arms_open | 95×107 |
| thinking_side | 65×107 | bow_polite | 56×108 |
| sad_crying | 66×100 | three_quarter | 68×109 |
| necklace_anxious | 76×110 | reaction `shocked` | 109×111 |
| hand_mouth_giggle | 64×110 | | |

### New finding: Maya frames were resampled before import

> **Resolved 2026-10-24**: confirmed against the original sheet and re-extracted 1:1; see the end of this file.

Each Maya frame contains about **1,400 distinct colours** (e.g. `maya_frame_009.png`: 1,392 in 65×111 px). Backgrounds have about 224, and the title art 208. Magnified crops show soft, anti-aliased outlines (a purple halo around the hair), which points to resampling or filtering during extraction. That's why Maya looks blockier and muddier than the original sheet when magnified, and why ±0.25 px of outline wobble remains after the jitter fix. It can't be fixed in the renderer. **Recommended:** re-extract Maya's frames 1:1 from the original sheet, without scaling, and keep the sheet's canvas offsets.

---

## Maya — native re-extraction (2026-10-24, current)

Source: `docs/references/maya fey.png` (1180×3112, 15-colour palette; ripped by Shoda), the authoritative Maya sheet. Frames are exact 1:1 crops with the background turned transparent. Pixel-identical to the sheet: 102/102. Manifest `characters/maya/character.json` (D-026/D-027).

| Animation | Sheet row | idle frames | talking frames | Native size | Canvas |
|---|---|---|---|---|---|
| bow_polite | 1 | 001–004 | 005–008 | 76×157 | 76×157 |
| neutral_front | 2 | 009–012 | 013–016 | 92×161 | 92×161 |
| arms_open | 3 | 017–020 | 021–024 | 137×156 | 137×156 |
| sad_crying | 5 | 032–035 | 036–039 | 93×146 | 93×146 |
| smile_front | 6 | 040–043 | 044–047 | 89×162 | 89×162 |
| thinking_side | 7 | 048–051 | 052–055 | 90×155 | 90×155 |
| clasped_hands_happy | 8 | 056–059 | 060–063 | 92×156 | 92×156 |
| clasped_hands_laugh | 8 + 9 | 056–059 (shared) | 064–070 (7-frame laugh) | 92×156–160 | 92×160 |
| necklace_anxious | 10 | 071–074 | 075–078 | 107×160 | 107×160 |
| excited_front | 11 | 079–082 | 083–086 | 94×160 | 94×160 |
| hand_mouth_giggle | 12 | 087–090 | 091–094 | 89×160 | 89×160 |
| three_quarter | 13 | 095–098 | 099–102 | 95×159 | 95×159 |

The `three_quarter` folder is still named `three_quarter_idle/`.

**Idle timing (D-030):** every idle clip is a blink (open → half → closed → half), timed `[2600, 70, 90, 70]` ms with `holdJitterMs: 1800`.

**Reaction `shocked`** (row 4): 027 (158×161, arms wide) → 026 (106×157, fists) → hold 028–031 (78×152) ×2, as annotated "x2" on the sheet. That's 10 steps at 10 fps on a 158×161 canvas.

**Unassigned:** `_unassigned/maya_frame_025.png` (89×162, row 4 col 1: standing, worried, arms down).

**Not extracted:** sheet rows 14–17 (40 frames of additional side-facing poses, several with "x Talk" groups). They're available for future poses such as the `side_idle` / `side_praying` names in the original draft manifest.

Old resampled frames (97, ~0.69× size, ~1,400 colours each) were removed with `git rm`; they remain in history at `0db92d6`.

### Audio additions

- `audio/menu_ui/pageturn.wav` (sound `ui_page`): mono, 21819 Hz, 16-bit, 0.412 s.
- `audio.json` `events`: 7 logical menu events (D-028).
- The other menu SFX in `docs/sfx general/` are byte-identical to the existing `menu_ui/` files, so they're reused, not duplicated.

Totals: 155 referenced runtime files (102 Maya + 29 backgrounds + 19 audio + 5 UI).

### UI menu panels (2026-10-24)

Source: `docs/references/DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Miscellaneous.png` (1553×238, by TSP184). All crops are 256×192 at y = 23.

| ui.json id | File (`ui/menu/`) | Sheet x | Colours | Used on |
|---|---|---|---|---|
| `menu_title_discussion` | `title-screen-discussion.png` | 23 | 14 | Main menu |
| `menu_bottom_screen` | `bottom-screen.png` | 302 | 49 | Settings |
| `menu_top_screen` | `top-screen.png` | 581 | 42 | (registered, unused) |
| `menu_cross_examination_start` | `cross-examination-start.png` | 860 | 14 | (registered, unused; future effects) |
| `menu_talk_option` | `talk-option.png` | 1139 | 15 | Character select |

Filenames use kebab-case as specified by the owner (other assets use snake_case). Total referenced runtime files: **161**.

### Character pack data (2026-10-24, LLM milestone)

`characters/maya/performance.json` (director settings, 7 gestures, intensity variants for happy/excited/laughing, aliases, error line) and `characters/maya/personality.md` (character bible). They're data, not media, so they aren't counted by the unreferenced-media check. The backend validates every reference against `character.json` and a test asserts zero warnings.

### Igiari + DotGothic16 stage/UI stack (2026-10-24, current)

| ui.json id | Runtime file | Size | Configuration | Coverage note |
|---|---|---:|---|---|
| `dialogue` | `ui/fonts/Igiari.woff2` | 57,724 bytes | `Igiari`, 16 px, letter spacing 0, word spacing 0 | Latin, kana and Japanese punctuation; no Kanji |
| `dialogue.fallbacks[0]` | `ui/fonts/DotGothic16-Regular.ttf` | 2,069,236 bytes | `DotGothic16`, Regular; first bundled fallback | 8,231 mapped code points; 6,714 CJK Unified Ideographs; all milestone test glyphs present |

The runtime Igiari WOFF2 SHA-256 is `02C1EFFCD76F86721EE266E51BECF006950B199EDDE61BDE1A6C703A8EDB92C3`, identical to `docs/references/igiari/Igiari.woff2`. The complete nine-file source distribution remains unmodified under `docs/references/igiari/`.

The runtime DotGothic16 TTF SHA-256 is `155DA8F318553C11D9DFFC2AFFBC7C2114C6A46F9740BCF639ED5568AF92BE71`, identical to `docs/references/dotgothic16/DotGothic16-Regular.ttf`. Embedded metadata reports family `DotGothic16` (`ドットゴシック16` in Japanese), face/style `Regular` / `Normal`, version 1.101, and SIL Open Font License 1.1. No separate licence or readme was supplied in that reference folder.

The former runtime `ui/fonts/ace_attorney.ttf` was removed so the asset validator has no orphaned media. Its byte-identical source remains at `docs/references/Ace-Attorney.ttf` (SHA-256 `04DF2EEABE29CB5EB1B7537A0E1288FE6BEC8B9524BF6BCE50C03104C8B8DCBC`). The effective stack is Igiari → bundled DotGothic16 → Japanese/system sans-serif emergency fallbacks.
