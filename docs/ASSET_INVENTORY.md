# Asset Inventory — Courtroom Companion

_Regenerated 2026-10-24 after runtime asset stabilization, from files that actually exist on disk (PNG dimensions and WAV headers read from the files). Nothing here is hypothetical. Regenerate whenever assets are added, removed, renamed or reorganized, and run `npm run validate:assets`._

> **Correction:** the 2026-10-24 initialization version of this file said "132 Maya sprite frames". The real count was, and is, **97** (verified against `git ls-tree HEAD` at `8bf0937`). No frames were lost.

All paths are relative to `frontend/public/assets/`. Browser URL = `/assets/` + path. No path contains spaces.

Totals: 97 Maya sprite frames (96 used + 1 unassigned) · 29 backgrounds · 2 blips · 4 dialogue SFX · 4 effect SFX · 8 UI SFX · 0 music · 0 UI graphics · 0 visual effects · 4 manifests. No byte-identical duplicate media files.

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

| Reaction id | Folder | Frames | fps | Sizes | Note |
|---|---|---|---|---|---|
| `shocked` | `shocked_panicked/reaction/` | 025–030 | 10 | 109×111, 74×108, 56×105 ×4 | recoil (arms up) → "O" mouth hold |

## Maya — unassigned

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
