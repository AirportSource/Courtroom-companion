# Asset Sources & Provenance — Courtroom Companion

_Record the origin of every external asset. Never remove attribution or source metadata. Ace Attorney characters, art, audio and UI are © Capcom. They are third-party copyrighted material; this repository does not own them and makes no claim to them._

---

## External assets in the repository

All were downloaded **manually by the owner** and placed in `docs/references/` (kept unmodified there for provenance). Runtime copies or cut-outs were made by Claude on 2026-10-24.

| Logical asset (ui.json id) | Runtime file | Source file (docs/references/) | Source | Credit / licence | Purpose |
|---|---|---|---|---|---|
| `title_screen` | `frontend/public/assets/ui/title/title_screen.png` (256×192) | `DS _ DSi - Phoenix Wright_ Ace Attorney - Miscellaneous - Title Screen.png` (502×388) | The Spriters Resource, DS/DSi "Phoenix Wright: Ace Attorney" → Miscellaneous → Title Screen: https://www.spriters-resource.com/ds_dsi/phoenixwrightaceattorney/asset/20859/ | © Capcom. Sheet note: "Ripped By Badassbill. Please Give Credit If Used." | Title-screen art. Exact crop of the sheet's top-left panel (x 1–256, y 1–192; 1 px white sheet border excluded); pixels unchanged. |
| `exclamation_objection` | `ui/exclamations/objection.png` (256×192) | `Exclamations.png` (265×662) | Owner-supplied sheet; source page not recorded. Sheet note credits Capcom and ripper Trish Rowdy (trishrowdy.deviantart.com) | © Capcom. "Give credit if used." (ripper: Trish Rowdy) | "Objection!" bubble for a future effects milestone. Cropped to content; sheet background (153,217,234) made transparent; no other pixel changes. |
| `exclamation_take_that` | `ui/exclamations/take_that.png` (256×192) | same | same | same | "Take that!" bubble (future) |
| `exclamation_hold_it` | `ui/exclamations/hold_it.png` (256×190) | same | same | same | "Hold it!" bubble (future). The content is 190 rows; not padded. |
| **Maya Fey sprites** (all 102 frames in `characters/maya/sprites/`) | `frontend/public/assets/characters/maya/sprites/**/maya_frame_001–102.png` | `maya fey.png` (1180×3112) — **authoritative Maya source** | Owner-supplied sheet. The download page was not recorded; the sheet layout matches a Spriters Resource DS "Phoenix Wright: Ace Attorney" character sheet, but that is unconfirmed. | © Capcom. Sheet note: "Ripped by Shoda. Please give credit." | Exact 1:1 crops of rows 1–13 (each sprite's bounding box); background (181,165,213) made transparent; no other pixel changes. Replaces the earlier resampled frames (D-027). The owner's note called this file `maya-original-sheet.png`; the actual filename is `maya fey.png`. |
| `ui_page` sound | `frontend/public/assets/audio/menu_ui/pageturn.wav` | `docs/sfx general/sfx-pageturn.wav` (byte-identical copy) | Owner-supplied SFX pack `docs/sfx general/` (108 WAVs); source not recorded | © Capcom (Ace Attorney SFX) | Menu page-turn (`menu_page` event). The pack's selectblip, selectblip2, cancel, scroll, saveblip, selectjingle, blipfemale and blipmale are byte-identical to files already in `audio/`, so those are reused. |
| `menu_title_discussion`, `menu_bottom_screen`, `menu_top_screen`, `menu_cross_examination_start`, `menu_talk_option` | `frontend/public/assets/ui/menu/{title-screen-discussion,bottom-screen,top-screen,cross-examination-start,talk-option}.png` (each 256×192) | `DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Miscellaneous.png` (1553×238) | The Spriters Resource, DS/DSi "Phoenix Wright: Ace Attorney" → Backgrounds → Miscellaneous (filename indicates the page; exact URL not recorded) | © Capcom. Sheet note: "Miscellaneous Sprite Sheet by TSP184. No need to credit me." (credited anyway) | Exact 256×192 crops at sheet x = 23 / 302 / 581 / 860 / 1139, y = 23 (panel interiors only; dark-green sheet background (2,66,15), labels and credit box excluded). Pixels unchanged and verified identical. Main menu, character select and settings backgrounds. |
| `dialogue` font | `frontend/public/assets/ui/fonts/Igiari.woff2` (57,724 bytes; byte-identical copy) | Complete distribution in `docs/references/igiari/` | FontStruct creator page and Caveras website recorded in the supplied readme: http://fontstruct.com/fontstructors/caveras · http://www.caveras.net | **Igiari by Caveras / Cliff Modes**, © 2014; Creative Commons Attribution-NonCommercial-ShareAlike 3.0 (`license.txt`). Based on Capcom's Ace Attorney main text pixel font. | Primary stage/UI font at 16 px. Latin, kana and Japanese punctuation are present; no Kanji. Runtime uses WOFF2; the full original distribution is preserved unmodified as required by its redistribution note. |
| `dialogue` bundled fallback | `frontend/public/assets/ui/fonts/DotGothic16-Regular.ttf` (2,069,236 bytes; byte-identical copy) | `docs/references/dotgothic16/DotGothic16-Regular.ttf` | No separate provenance file was supplied. Embedded copyright metadata names The DotGothic16 Project Authors and records `https://github.com/fontworks-fonts/DotGothic16/`; designer/manufacturer: Fontworks Inc. | Embedded metadata: **SIL Open Font License 1.1**, with `https://scripts.sil.org/OFL`; copyright 2020 The DotGothic16 Project Authors. The local reference folder contains no separate licence/readme. | Deterministic first fallback for glyphs absent from Igiari, especially Kanji. Visually compatible with the project; not claimed to be the original Ace Attorney Kanji font. |
| Former `dialogue` font | — (runtime copy removed 2026-10-24) | `docs/references/Ace-Attorney.ttf` | FontStruct: http://fontstruct.com/fontstructions/show/875083 (URL from the font's own metadata) | "Ace Attorney" by **David Fens**, © 2013, **FontStruct Non-Commercial License** (from font metadata) | Preserved as a source/reference font. Superseded at runtime by Igiari (D-037). |

Not copied to runtime (kept in `docs/references/` only):
- The Capcom / "Licensed by Nintendo" splash and the loose logo parts on the title sheet. **Deliberately unused**: showing a licensing splash in this fan project would misrepresent it as licensed.
- The exclamations sheet's credit block.
- `courtroom_companion_claude_setup.zip`: the project's Claude setup bundle (CLAUDE.md + skills), not an asset.

### Miscellaneous background sheet: received 2026-10-24

The five-panel sheet is now in `docs/references/` and extracted (see the table above).

---

## Stand-ins currently used instead of original graphics

These are **CSS/React approximations**, not original assets. They should be replaced once the originals above are available.

| UI element | Current implementation | Replace with |
|---|---|---|
| Dialogue box frame | CSS (`.dialogue-box`): grey outer border, dark interior | Original DS text box graphic (sheet #2 or #4) |
| Name plate | CSS (`.dialogue-nameplate`): blue-grey plate | Original name plate graphic |
| Continue indicator | CSS triangle (`.dialogue-continue`), 2-step nudge | Original arrow sprite |
| Title logo | **Replaced 2026-10-24** for the "press start" phase by the original title art (`title_screen`). The menu phase keeps the styled "Courtroom Companion" text. | — |
| Menu screens | **Replaced 2026-10-24** by the original DS panels (title-screen-discussion / talk-option / bottom-screen). The blue gradient is only a fallback if they fail to load. | — |
| Menu buttons | CSS (`.menu-item`) | Original button graphics, if a sheet is found |
| Font | **Replaced 2026-10-24** by Igiari (16 px), with bundled DotGothic16 as the deterministic Kanji fallback. Igiari supplies `-`, `…`, accented Latin, kana and Japanese punctuation. | The stack is complete and deterministic for the tested Japanese text, but DotGothic16 is not claimed to be the original Ace Attorney Kanji font. |

### Igiari distribution and bundled Kanji fallback

The source package is preserved unchanged in `docs/references/igiari/`: EOT, OTF, SVG, TTF, WOFF, WOFF2, `webfont.css`, `readme.txt` and `license.txt`. The supplied readme says redistributed font files must be accompanied by the other archive files. Runtime serves only the byte-identical WOFF2 copy; the complete source distribution remains with the repository.

Igiari contains no Kanji. The manifest therefore loads and registers the bundled DotGothic16 TTF before applying the stage stack. DotGothic16 is the first fallback after Igiari; `Yu Gothic`, `YuGothic`, `Meiryo`, `Noto Sans JP` and `Noto Sans CJK JP` remain tertiary emergency fallbacks. The supplied DotGothic16 file maps 8,231 Unicode code points, including 6,714 code points in the CJK Unified Ideographs block and every character in the milestone's Japanese test text. That is useful inspected coverage, not a claim of complete Japanese coverage or authentic Ace Attorney Kanji typography.

## Visual references (not stored in the repository)

| Reference | Origin | Use |
|---|---|---|
| `_random_ace_attorney_ds_textbox_recreation_by_rapbattleeditor0510_deg24mu-fullview.png` (1280×960) | Supplied by the owner from their Downloads folder. The filename indicates a fan recreation by "rapbattleeditor0510" (DeviantArt-style naming). | Geometry and colour reference only. Its 1280×960 size is exactly 5× the DS screen, so dimensions ÷5 gave the stand-in layout: name plate 48×13 at y=133, box 256×48 at y=144. A copy exists **untracked** at `docs/references/_random_ace_attorney_ds_textbox_recreation_by_rapbattleeditor0510_deg24mu-fullview.png` (placed by the owner). It is third-party fan art, so the owner decides whether to commit it; if committed, keep this attribution. Not used at runtime. |

---

## Pre-existing assets (added before provenance tracking)

Added by the owner in commit `2c3e957` ("added assets"); the original download sources were **not recorded**.

| Assets | Location | Apparent origin |
|---|---|---|
| ~~Maya Fey sprite frames (97)~~ | removed 2026-10-24 | Were resampled copies (~0.69×) of an unknown rip; replaced by the 1:1 extraction from `maya fey.png` (see above). |
| Backgrounds (29) | `frontend/public/assets/backgrounds/` | Ace Attorney series locations (© Capcom). Source unknown. |
| Blips, dialogue/effect/UI SFX (18) | `frontend/public/assets/audio/` | Ace Attorney series sound effects (© Capcom). Source unknown. |

If the owner remembers the sources, add them here.

---

## Music and Court Record sources (received 2026-10-24)

All are third-party copyrighted material (© Capcom), supplied manually by the owner. Source files stay **untracked** in `docs/` and must not be committed without the owner's decision. Runtime copies are listed below.

| Logical asset | Runtime file(s) | Source file | Source | Credit / licence | Purpose |
|---|---|---|---|---|---|
| Original soundtrack (25 non-excluded tracks, `music/soundtrack.json`) | `frontend/public/assets/music/original/NN-<kebab-title>.mp3` (byte-identical copies) | `docs/references/music/pwaa-original-soundtrack.zip` (38 entries, 34 distinct tracks; the `-`/`:`/`_` name variants are byte-identical duplicates), extracted unchanged to `docs/original_tracks/` | Owner-supplied "Phoenix Wright: Ace Attorney" OST MP3 set. Download page not recorded. `docs/websites/sounds_sites.txt` lists an owner bookmark to The Sounds Resource (3DS Trilogy); it is not confirmed as the source of this zip. | © Capcom | Game-music BGM/contextual source. The 9 excluded tracks have no runtime copy. Loop points are project analysis of the OST (D-044), not DS data. |
| Evidence `thinker_statue`, `envelope_tied`, `cellphone_blue` | `frontend/public/assets/court-record/evidence/{thinker_statue,envelope_tied,cellphone_blue}.png` (64×64 RGB each) | `docs/references/court-record/evidences_profiles_full.png` (1008×711) | Owner-supplied evidence/profile sheet; download page not recorded | © Capcom. Sheet note: "Ripped by Shoda. No credit needed." (credited anyway) | Exact 1:1 crops of each tile's 64×64 slot interior: x,y = (430,4), (75,4), (288,501). Pixels unchanged; the grey slot background is kept. Verified 4096/4096 px identical each. |
| — | — | `docs/references/evidence.png` (1008×711) | Same sheet | same | Pixel-identical RGB to `evidences_profiles_full.png`. It differs only by sRGB/gAMA/cHRM/pHYs chunks, so the chunk-free copy was used. |
| — | — | `docs/references/court-record/penseur.png`, `file_document.png`, `phone.png` | Owner-supplied enlarged crops | © Capcom | **Identification references only**, never runtime assets. |
| `menu_talk_option` (already in runtime since D-031) | `ui/menu/talk-option.png` | `docs/references/court-record/under_screen_background.png` (274×217 screenshot with label/border) | Owner-supplied | © Capcom | Re-verified 0-pixel-difference against this screenshot's 256×192 interior at (10,14). Reused as the Talk Options backdrop; no duplicate asset. |

Not used: `docs/sfx general/` (unrelated to this milestone, untracked).

### Semantic reaction SFX (added 2026-10-24, D-049)

Byte-identical copies (verified with `cmp`) from the owner-supplied pack `docs/sfx general/` (source not recorded; © Capcom Ace Attorney SFX). Chosen by name and duration; **not listened to**.

| Event | Sound id | Runtime file | Source file |
|---|---|---|---|
| `sfx_surprise` | `fx_surprise` | `audio/effects/shock.wav` (20,364 B) | `sfx-shock.wav` |
| `sfx_shock` | `fx_shock` | `audio/effects/supershock.wav` (43,980 B) | `sfx-supershock.wav` |
| `sfx_realization` | `sfx_realization` (existing) | `audio/dialogue/realization/realization.wav` | pre-existing runtime sound |
| `sfx_comic` | `fx_comic` | `audio/effects/badum.wav` (48,956 B) | `sfx-badum.wav` |
| `sfx_emphasis` | `fx_emphasis` | `audio/effects/deskslam.wav` (30,924 B) | `sfx-deskslam.wav` |
| `sfx_tension` | `fx_tension` | `audio/effects/dramapound.wav` (7,200 B) | `sfx-dramapound.wav` |
| `sfx_notification` | `fx_notification` | `audio/effects/phonebeep.wav` (8,236 B) | `sfx-phonebeep.wav` |
| `sfx_soft_transition` | `fx_soft_transition` | `audio/effects/swoop.wav` (3,992 B) | `sfx-swoop.wav` |
