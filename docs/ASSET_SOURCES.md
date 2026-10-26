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
| Settings pickers | CSS `StageSelect` (`.stage-select`, panel reuses `.menu-item`), D-063 | Original DS list/selection graphics, if a sheet is found |
| Conversation actions (Talk / Court Record / Record) | CSS (`.conversation-actions button`, chat-bar frame), D-063 | Original DS touch-screen buttons (e.g. the Court Record tab), if a sheet is found |
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


## Court Record UI icon and delivery SFX (2026-10-24)

| Logical asset / event | Runtime | Source | Origin and rights | Notes |
|---|---|---|---|---|
| `court_record_file_document` | `ui/court-record/file_document.png` | `docs/references/evidence.png` (1008×711) | Owner-supplied evidence sheet; download page not recorded. Ace Attorney imagery © Capcom; no separate licence supplied. | Exact 64×64 RGB crop at (x=75, y=4), matching the existing `envelope_tied` runtime pixels. Pixel identity verified. The enlarged `court-record/file_document.png` remains an unchanged identification reference. Registered in `ui/ui.json`. |
| `court_record_photo` | `ui/court-record/evidence_photo.png` | Owner-supplied evidence sheet `assets.png` (1008×711, the Shoda evidence sheet: "Ripped by Shoda. No credit needed.", credited anyway). Ace Attorney imagery © Capcom. | Exact 64×64 RGB crop at (x=795, y=504): a black-and-white photo with a white border, right block, third row, fifth cell. The cell frame sits right outside the crop on both sides (checked). Registered in `ui/ui.json`; it stands in for a presented picture the browser cannot display (D-075). |
| `evidence_reveal` (`fx_evidence_reveal`) | `audio/effects/evidence_start.wav` | `docs/sfx general/evidence_start.wav` | Owner-supplied SFX pack; source page not recorded. Ace Attorney SFX (c) Capcom; no separate licence supplied. | Byte-identical copy; mono PCM, 32,728 Hz, 16-bit, 0.115 s. |
| `evidence_added` (`fx_evidence_added`) | `audio/effects/evidence_finish.wav` | `docs/sfx general/evidence_finish.wav` | Same owner-supplied SFX pack; (c) Capcom; no separate licence supplied. | Byte-identical copy; mono PCM, 32,728 Hz, 16-bit, 0.164 s. Separate cue from reveal. |
| `phone_ring` (`fx_notification`) | Reuses `audio/effects/phonebeep.wav` | `docs/sfx general/sfx-phonebeep.wav` | Same owner-supplied SFX pack; (c) Capcom; no separate licence supplied. | Existing runtime file is byte-identical to source; reused as a short 0.188 s phone cue. Full 11.601 s `phone1.wav` ringtone was not copied. |
| `phone_answer` (`fx_phone_answer`) | `audio/effects/phone_cut.wav` | `docs/sfx general/phone_cut.wav` | Same owner-supplied SFX pack; (c) Capcom; no separate licence supplied. | Byte-identical copy; mono PCM, 32,728 Hz, 16-bit, 0.100 s. |

All supplied reference files and source-pack files were left unchanged. These runtime assets remain third-party copyrighted material; this record documents provenance and does not grant redistribution rights.

### Phoenix ringtone (D-057)

Runtime `audio/effects/phoenix_ringtone.mp3` is byte-identical to owner-supplied `docs/sfx general/2-11 Ringtone (Phoenix Wright).mp3` (730,044 bytes; SHA-256 `c448482137d52264df796592571252ec85cd2eb31f68fcfe9de4905b1e500506`). Selection uses its embedded ID3 title **Ringtone (Phoenix Wright)**, album **Phoenix Wright: Ace Attorney Sound BOX**, album artist **Capcom**, artist/composer **Akemi Kimura**, year **2012**, disc **2**, track **11**. The supplied Wellington and Godot MP3s have distinct corresponding embedded titles. This is more specific evidence than filenames; no by-ear identification is claimed.

ID3 COMMENT/WWW fields name `www.sittingonclouds.net`, and ORGANIZATION names Suleputer; these are supplied metadata, not independently verified download provenance. No separate redistribution licence was supplied; the existing Capcom rights caveat applies. No source file was rewritten or transcoded.

The 24.504-second decoded recording has a repeating musical passage near 18.86 seconds. Offline spectral matching (cosine similarity about 0.992 on a one-second window), full-sample refinement and seam analysis selected a loop from 55,209 to 672,405 samples at the 32,728 Hz analysis decode rate, stored as seconds in `audio.json`. The measured left-channel sample jump is 0.0142 full scale (about 0.404 of nearby sample steps). This is analysis of this recording, not a Nintendo DS loop claim; listening approval remains pending. The unknown `phone1.wav` was not relabelled as Phoenix, and the full source archive remains outside runtime.

### Evidence frame, Maya record portrait and ringtone presets (added 2026-10-24, D-058/D-060/D-061)

All are owner-supplied Capcom material; sources stay untracked in `docs/`.

| Logical asset | Runtime file | Source | Notes |
|---|---|---|---|
| `evidence_frame` (ui.json) | `ui/court-record/evidence_frame.png` (70×70 RGBA) | `docs/references/court-record/evidences_profiles_full.png`, tile at x=1, y=1 (sheet note "Ripped by Shoda. No credit needed.", credited anyway) | Border rows/cols 0–2 and 67–69 kept exactly (804 px, 0 mismatches); 64×64 interior made transparent. The ring is identical in 17 of 19 checked tiles; tiles at (937,1) and (511,72) differ slightly. |
| Maya `courtRecordPortrait` | `characters/maya/portraits/court_record.png` (64×64 RGB) | same sheet, profile tile origin (866,1), rect x=869 y=4 64×64 | 1:1, 0 differences. Identified by black hair, bangs and topknot; Mia Fey's look-alike portrait has brown hair. |
| **Dick Gumshoe sprites** (82 frames, `characters/gumshoe/sprites/**/gumshoe_frame_001–082.png`) | `frontend/public/assets/characters/gumshoe/` | `docs/references/dick gumshoe.png` (1336×2310; SHA-256 4f6aa056e9f4e599d9c4c1fb7ae5cd0c6a389df3fbb667d545f72dbc75c1c1e8), owner-supplied as `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Dick Gumshoe.png` (The Spriters Resource naming; page URL not recorded) | © Capcom. Sheet note: "Ripped by Shoda. Credit appreciated." | Exact component crops (D-027/D-064), background (181,165,213) transparent, no other change. |
| **Mia Fey sprites** (59 frames, `characters/mia/sprites/**/mia_frame_001–059.png`) | `frontend/public/assets/characters/mia/` | `docs/references/mia fey.png` (1068×3273; SHA-256 841c6f5e6f553eb8e01d6fe03500418833b9de062e7b3826293caa12dea89cdd), owner-supplied as `Mia Fey.png` (download page not recorded) | © Capcom. Sheet note: "Ripped by Shoda. Credit appreciated." | Rows 1–8 only (Mia's own body), exact component crops, background transparent. Rows 9–16 (Mia channelled by Maya) unused. |
| Gumshoe / Mia `courtRecordPortrait` | `characters/{gumshoe,mia}/portraits/court_record.png` (64×64) | Crops of each sheet's first neutral frame (top 64 rows, centred; Mia shifted 6 px left) on (120,120,120) | Stand-ins, not the official profile tiles (D-064). |
| Ringtone `wellington` | `audio/effects/wellington_ringtone.mp3` (619,634 B) | `docs/sfx general/2-02 Ringtone (Richard Wellington).mp3` | Byte-identical. ID3: "Ringtone (Richard Wellington)", Akemi Kimura, *Phoenix Wright: Ace Attorney Sound BOX* disc 2 track 2. Loop 1.000–8.380136 s measured offline, not auditioned. |
| Ringtone `godot` | `audio/effects/godot_ringtone.mp3` (2,638,708 B) | `docs/sfx general/3-34 Ringtone (Godot).mp3` | Byte-identical. ID3: "Ringtone (Godot)", Sound BOX disc 3 track 34 (composer Noriyuki Iwadare; the artist tag reads "Ringtone"). The decoded length is 102.5 s; the large ID3 tag holds artwork. Loop 2.000–38.000680 s measured offline, not auditioned. |
| Ringtone `phoenix` (existing default) | `audio/effects/phoenix_ringtone.mp3` | `docs/sfx general/2-11 Ringtone (Phoenix Wright).mp3` | Re-verified byte-identical (SHA-256 c4484821…). |

### Voiced shouts (added 2026-10-25, D-068)

| Asset | Runtime file | Source | Notes |
|---|---|---|---|
| 12 shout clips (`voice_<lang>_<speaker>_<phrase>`) | `frontend/public/assets/audio/voices/{en,ja}/*.wav` (32,728 Hz mono 16-bit, ~1.3 s) | Owner-supplied `3DS - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Sound Effects.zip` (113 WAVs named by archive offset; The Spriters/Sounds Resource naming, page not recorded) | © Capcom. Byte-identical copies. Offsets: EN Phoenix 0x23B8A0/0x241A00/0x259F80, Mia 0x2600E0/0x284920/0x278660, Edgeworth 0x272500/0x26C3A0; JA Mia 0x1411E0/0x1A99E0, Phoenix hold_it 0x9CD00, Edgeworth 0x1B5C20. Phrase/language from offline transcription, speaker from the owner's listening. |

Additional shout clips (2026-10-25, D-069), same archive, byte-identical: EN `mia_take2` 0x27E7C0, `guest_m1` 0x247B60, `guest_m2` 0x24DCC0, `guest_m3` 0x253E20; JA `phoenix` 0xB29A0, `guest_f1` 0x1A38C0, `guest_m4` 0x495A0 (all `objection`; guests are unidentified trilogy characters labelled by ear).

| `exclamation_objection_ja` (ui.json) | `ui/exclamations/objection_ja.png` (256×192 RGBA, 12 colours) | Owner-supplied `igiari.jpeg` (512×512 JPEG, black background; copy in `docs/references/igiari.jpeg`; origin not recorded) | © Capcom. Not pixel-identical: exterior black made transparent (flood fill from the edges), cropped, LANCZOS-scaled to 230×192 and centred, colours snapped to the English bubble's palette (D-070). |

## Asset expansion archive (received 2026-10-25)

The owner's collection `extract_assets_ace` (kept outside the repository; read-only source, D-079) contains Spriters Resource rips (DS/DSi AA1/JFA character sheets, credited in-sheet to their rippers, e.g. "Ripped by Shoda"; 3DS and PC Trilogy HD sheets), Trilogy HD location plates, Trilogy UI (investigation cursor, evidence frame, music player), the Trilogy "Original Soundtrack Remastered" (3 discs, 104 MP3) and artbook scans. All © Capcom. Derived runtime files: the four new character packs, `bg_30`–`bg_49`, `ui/status/*`, `ui/music-player/*`, and the locally installed disc 2/3 MP3s (not in Git). Download URLs of the individual rips were not recorded by the owner.

## 2026-10-26 discussion sprites and DS audio provenance

Read-only owner archive `extract_assets_ace`: Miles discussion uses the AA1 DS/DSi `Miles Edgeworth.png` sheet, separate from `(in Court).png`. Franziska uses ten actual animated WebPs from `characters/Franziska`, including Normal_Forward idle/talking. All are © Capcom; individual download URLs remain unrecorded. Explicit PNG derivatives preserve native source pixels/compositing/timing; source hashes and blend/disposal metadata are in extraction reports.

The supplied `game_soundtrack/convert/wav` folder moved externally during work. Final sources: game-labelled Justice for All MP3s (28 exact copies) and Trials and Tribulations `wav` NCSF123 native/default renders (27 sample-identical FLAC derivatives, 32,728 Hz stereo). No source modification, resampling, effects or remastering. Only 55 confidently mapped expansion additions replaced; 25 older valid tracks and 4 uncertain imports preserved. Relative per-track source provenance/hashes are in `scripts/data/ds_audio_migration.json`, never absolute source paths in runtime manifests. See [report](PRESENTATION_DS_MIGRATION.md).

## Targeted corrections (2026-10-26)

All owner archive inputs remain read-only. Franziska profile is exact native JFA Evidence.png crop[643,75,707,139]; 491690.png was inspected and excluded because it contains HD evidence objects. Selection preview copies the existing native discussion pixels into a centered square. Whip uses retained native DS strike frames composed1:1 onto transparent stage canvases; the HD cyan slash GIF/PNG were inspected and excluded (GIF opaque black,20 zero-delay frames). No exact GIF timing claim.

Compound cue sources are owner-supplied `docs/sfx general/sfx-whip.wav` and `sfx-whack.wav`; impact begins400ms after swing. Lightbulb is a byte-identical copy of `docs/sfx general/sfx-lightbulb.wav`, replacing only the realization event mapping. Source transforms/hashes/gains in `characters/franziska/sprites/whip_crack/timed/source.json`.

Only font material found: GBA GS3(JPN) Font.png atlas in `police_extract`, custom glyph order without a character map. Not imported; no authenticity claim is made for the existing DotGothic16 fallback. [Full report](TARGETED_CORRECTIONS.md).

## Repository source folder `assets/` (2026-10-26)

Root `assets/` is read-only source material, never served at runtime; the validator rejects machine paths and paths into it. Used this pass: `other assets/whip/whip effect gif.gif` (whip overlay, timing inferred) and `most used sounds/{everyone,maya,pearl}` (3 new byte copies, the rest already present). `whip effect.png` (HD layered shapes) was inspected and not used.
