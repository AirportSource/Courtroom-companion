# Asset Inventory — Courtroom Companion

_Generated 2026-10-24 from files that actually exist on disk (PNG dimensions and WAV headers read directly from the files). Nothing here is hypothetical. Regenerate/update whenever assets are added, removed, renamed or reorganized._

All paths are relative to `frontend/public/`. Browser URL = `/` + path (spaces must be URL-encoded as `%20`).

Totals: 132 Maya sprite frames · 29 backgrounds · 2 blips · 8 dialogue/shock SFX · 8 UI SFX · 0 music · 0 UI images · 0 visual effects · 2 manifests · 1 scaffold image. No byte-identical duplicate files were found.

---

## Manifests

| File | Purpose | Validation |
|---|---|---|
| `characters/maya/character.json` | Maya character pack (14 animations, 11 emotions) | 3 of 14 animation folders missing (see below) |
| `assets/audio/audio.json` | Audio logical IDs → files (paths relative to `assets/audio/`) | 16 of 18 entries resolve; both blip entries broken |

No background manifest, music manifest or UI manifest exists.

---

## Maya sprite groups

Folder: `characters/maya/sprites/`. All frames are 8-bit RGBA PNG. Filenames follow `maya_frame_NNN (1).png` (one is `(2)`).

| Pose folder | idle | talking | Flat (no split) | Frame # range | Frame size(s) | Referenced by manifest animation |
|---|---|---|---|---|---|---|
| `arms_open` | 4 | 3 | – | idle 017(2),019–021 · talk 022–024 | 94–95×107; **024 is 63×111** | `arms_open` |
| `bow_polite` | – | – | 8 | 001–008 | 55×108 | `polite_bow` (loop: false) |
| `clasped_hands_happy` | 4 | **8** | – | idle 055–058 · talk 059–062, 066–069 | 65–66×107–108 | `happy_clasped` |
| `excited_front` | 4 | 4 | – | idle 078–081 · talk 082–085 | 66–67×110 | `excited` |
| `hand_mouth_giggle` | 4 | 4 | – | idle 086–089 · talk 090–093 | 63–64×110 | `giggle` |
| `necklace_anxious` | 4 | 4 | – | idle 070–073 · talk 074–077 | 75×110 | `anxious` |
| `netural_front` _(sic)_ | 4 | 4 | – | idle 009–012 · talk 013–016 | 65–66×111 | **none** — manifest says `neutral_front` |
| `sad_crying` | 4 | 4 | – | idle 031–034 · talk 035–038 | 65–66×100 | `sad` |
| `shocked_panicked` | – | – | 6 | 025–030 | 109×111, 74×108, 56×105 (×4) | `surprised` (loop: false) |
| `smile_front` | 4 ⚠ | 4 | – | idle 039–042 · talk 043–046 | 63–64×112 | `happy_idle` |
| `thinking_side` | **0** | 8 | – | talk 047–054 | 64×107 | `thinking` |
| `three_quarter_idle` | 4 | 4 | – | idle 094–097 · talk 098–101 | 67–68×109 | `three_quarter_idle` |

⚠ `smile_front` idle frames are at `smile_front/talking/idle/`, nested inside `talking/`.

**Groups with both idle and talking variants (correctly placed):** `arms_open`, `clasped_hands_happy`, `excited_front`, `hand_mouth_giggle`, `necklace_anxious`, `netural_front`, `sad_crying`, `three_quarter_idle` (8).
**Has both, but misnested:** `smile_front`.
**Talking only:** `thinking_side`.
**One-shot / flat:** `bow_polite`, `shocked_panicked`.

**Manifest animations with no folder on disk:** `neutral_idle` → `sprites/neutral_front` (typo mismatch), `side_idle` → `sprites/side_idle`, `side_praying` → `sprites/side_praying`.

**Frame number gaps across the full 001–101 sequence:** 018, 063, 064, 065.

### Maya emotion map (from `character.json`)

| Emotion | Animation | Resolves? |
|---|---|---|
| neutral | neutral_idle | ❌ folder missing (typo) |
| happy | happy_idle | ⚠ idle misnested |
| excited | excited | ✅ |
| thinking | thinking | ⚠ no idle |
| surprised | surprised | ✅ (one-shot) |
| sad | sad | ✅ |
| anxious | anxious | ✅ |
| playful | giggle | ✅ |
| grateful | happy_clasped | ✅ |
| explaining | arms_open | ⚠ suspect frame 024 |
| polite | polite_bow | ✅ (one-shot) |

`three_quarter_idle` exists on disk and in `animations` but is not mapped to any emotion.

---

## Backgrounds

Folder: `backgrounds/`. 29 files, all 8-bit RGB PNG. Filename encodes dimensions.

| Size | Files |
|---|---|
| 256×192 (single screen) | 01, 03, 04, 05, 06, 07, 08, 09, 10, 12, 14, 15, 16, 17, 18, 20, 21, 25, 26, 27 |
| 512×192 (wide / panning) | 02, 11, 13, 23, 28, 29 |
| Off-by-one | `background_19_512x193.png`, `background_22_255x192.png`, `background_24_256x191.png` |

Full filenames: `background_NN_WxH.png` for NN = 01…29 as listed above. No semantic names or logical IDs yet.

---

## Audio

Folder: `assets/audio/`. All mono PCM WAV.

### Dialogue blips

| File | Format | Duration | `audio.json` entry |
|---|---|---|---|
| `blips/blip_female/blipfemale.wav` | 8-bit, 16364 Hz | 0.053 s | `blips.female` → `blips/female.wav` ❌ wrong path |
| `blips/blip_male/blipmale.wav` | 8-bit, 16364 Hz | 0.052 s | `blips.male` → `blips/male.wav` ❌ wrong path |

### Dialogue / reaction SFX

| File | Format | Duration | `audio.json` entry |
|---|---|---|---|
| `dialogue/assertive/objection.wav` | 16-bit, 21819 Hz | 1.325 s | `dialogue.assertive` |
| `dialogue/cute/meow.wav` | 16-bit, 21819 Hz | 0.854 s | `dialogue.cute` |
| `dialogue/idea/lightbulb.wav` | 8-bit, 16364 Hz | 0.935 s | `dialogue.idea` |
| `dialogue/realization/realization.wav` | 8-bit, 16364 Hz | 1.188 s | `dialogue.realization` |

### Shock / impact effect SFX

Stored under `dialogue/shock/` but grouped as top-level `shock` in `audio.json`.

| File | Format | Duration | `audio.json` entry |
|---|---|---|---|
| `dialogue/shock/damage2.wav` | 8-bit, 15768 Hz | 0.925 s | `shock.damage` |
| `dialogue/shock/smack.wav` | 8-bit, 15768 Hz | 0.464 s | `shock.smack` |
| `dialogue/shock/stab2.wav` | 16-bit, 21819 Hz | 0.602 s | `shock.stab` |
| `dialogue/shock/whack.wav` | 16-bit, 21819 Hz | 0.459 s | `shock.whack` |

### UI SFX

| File | Format | Duration | `audio.json` entry |
|---|---|---|---|
| `menu_ui/cancel.wav` | 8-bit, 16364 Hz | 0.148 s | `ui.cancel` |
| `menu_ui/evidenceshoop.wav` | 16-bit, 21819 Hz | 0.161 s | `ui.evidence` |
| `menu_ui/saveblip.wav` | 8-bit, 16364 Hz | 0.488 s | `ui.save` |
| `menu_ui/scroll.wav` | 16-bit, 21819 Hz | 0.097 s | `ui.scroll` |
| `menu_ui/selectblip.wav` | 8-bit, 16364 Hz | 0.070 s | `ui.select` |
| `menu_ui/selectblip2.wav` | 8-bit, 16364 Hz | 0.237 s | `ui.selectAlt` |
| `menu_ui/selectjingle.wav` | 8-bit, 16364 Hz | 1.591 s | `ui.jingle` |
| `menu_ui/typwriter.wav` _(sic)_ | 8-bit, 16364 Hz | 0.184 s | `ui.typewriter` |

### Music

**None.** No music files exist.

---

## Visual effects

**None.** No flash/shake overlays, speech-bubble ("Objection!") images or other effect graphics exist.

## UI assets

**None** for the game UI (no dialogue box, nameplate, continue arrow, or pixel font).

Non-game file present: `assets/hero.png` (343×361, Vite scaffold image). Referenced-but-missing scaffold files: `/favicon.svg` (index.html), `/icons.svg` (App.tsx), `src/assets/{hero.png,react.svg,vite.svg}` (App.tsx).
