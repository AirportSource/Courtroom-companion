# Asset expansion gaps

Mechanical gaps only. These are facts about the archive as measured, not decisions about what to use or how to rename. Source: `docs/ASSET_EXPANSION_INVENTORY.md` and its JSON (kept in the agent scratchpad). Archive: read-only, root described in the inventory document.

## 1. Characters with only one sheet, or no portrait

Every archive character file is a single sheet or single composite. The archive has no per-character portrait file. The only portrait-type image is one unlabelled GBA profile sheet (`other assets/profiles/`, about 28 faces, no names).

| Character (name only) | Platforms with a sheet | Sheet files | Portrait file | Artbook HD folder |
|---|---|---:|---|---|
| Acro | DS/DSi | 1 | none | no |
| Adrian Andrews | DS/DSi | 1 | none | no |
| Angel Starr | 3DS, DS/DSi | 2 | none | no |
| April May | DS/DSi | 1 | none | no |
| Bellboy | DS/DSi | 1 | none | no |
| Ben And Trillo | DS/DSi | 1 | none | no |
| Bikini | 3DS | 1 | none | no |
| Cody Hackins | DS/DSi | 1 | none | no |
| Dahlia Hawthorne | 3DS, PC-HD | 2 | none | no |
| Damon Gant | DS/DSi | 1 | none | no |
| Dee Vasquez | DS/DSi | 1 | none | no |
| Dr. Hotti | DS/DSi | 1 | none | no |
| Elise Deauxnim | 3DS | 1 | none | no |
| Ema Skye | DS/DSi | 1 | none | no |
| Frank Sahwit | 3DS, DS/DSi | 2 | none | no |
| Franziska | DS/DSi | 1 | none | no |
| Franziska Von Karma | DS/DSi | 1 | none | yes |
| Furio Tigre | 3DS | 1 | none | no |
| Godot | 3DS, PC-HD | 2 | none | yes |
| Ini Miney | DS/DSi | 1 | none | no |
| Iris | 3DS | 1 | none | no |
| Jake Marshall | DS/DSi | 1 | none | no |
| Jean Armstrong | 3DS | 1 | none | no |
| Judge | DS/DSi | 1 | none | no |
| Lana Skye | DS/DSi | 1 | none | no |
| Larry Butz | DS/DSi | 1 | none | no |
| Lisa Basil | 3DS | 1 | none | no |
| Lotta Hart | DS/DSi | 1 | none | no |
| Luke Atmey | 3DS | 1 | none | no |
| Maggey Byrde | DS/DSi, GBA | 2 | none | no |
| Manfred Von Karma | DS/DSi | 1 | none | no |
| Marvin Grossberg | DS/DSi | 1 | none | no |
| Matt Engarde | DS/DSi | 1 | none | no |
| Max Galactica | DS/DSi | 1 | none | no |
| Maya | DS/DSi | 1 | none | no |
| Mia | DS/DSi | 1 | none | no |
| Mia Fey | PC-HD | 2 | none | yes |
| Mike Meekins | DS/DSi | 1 | none | no |
| Miles Edgeworth | DS/DSi | 3 | none | yes |
| Moe | DS/DSi | 1 | none | no |
| Morgan Fey | DS/DSi | 1 | none | no |
| Pearl Fey | DS/DSi | 1 | none | yes |
| Penny Nichols | DS/DSi | 1 | none | no |
| Phoenix Wright | DS/DSi, PC-HD | 3 | none | yes |
| Redd White | DS/DSi | 1 | none | no |
| Regina Berry | DS/DSi | 1 | none | no |
| Richard Wellington | DS/DSi | 1 | none | no |
| Sal Manella | DS/DSi, PC-HD | 2 | none | no |
| Shelly De Killer | DS/DSi | 1 | none | no |
| Turner Grey | DS/DSi | 1 | none | no |
| Victor Kudo | 3DS | 1 | none | no |
| Viola Cadaverini | PC-HD | 1 | none | no |
| Wendy Oldbag | DS/DSi | 2 | none | no |
| Will Powers | DS/DSi | 2 | none | no |
| Winston Payne | DS/DSi, PC-HD | 2 | none | no |
| Yanni Yogi | DS/DSi | 1 | none | no |
| Young Mia | PC | 1 | none | no |

Name-level totals: 57 distinct character names across the archive sheets. 49 appear on only one platform (one sheet family), 8 appear on more than one.

Repo runtime comparison (not an archive gap, for context): `frontend/public/assets/characters/` has maya, mia and gumshoe, with portraits (64x64) for each. No archive character has a 64x64 portrait file.

## 2. HD-only assets with no native (DS) counterpart

Character sheets that exist only as HD (3DS, PC HD) and have no DS/DSi or GBA sheet under the same normalised name (the PC Gyakuten Saiban 3 demo sheet is not HD and is excluded):

- Bikini (3DS)
- Dahlia Hawthorne (3DS, PC-HD)
- Elise Deauxnim (3DS)
- Furio Tigre (3DS)
- Godot (3DS, PC-HD)
- Iris (3DS)
- Jean Armstrong (3DS)
- Lisa Basil (3DS)
- Luke Atmey (3DS)
- Mia Fey (PC-HD)
- Victor Kudo (3DS)
- Viola Cadaverini (PC-HD)

That is 12 names. Names with a DS/DSi sheet: 44. Names with a DS/DSi sheet and no HD sheet: 39.

Locations: all 110 files in `other assets/locations HD/` are HD (1920x1080 or 3840x1080). None has a native counterpart by name. The only native-scale location material is the 28-tile sheet (section 3).

Artbook: 163 HD-only images (2260x3200 RGB character art, illustrations, gallery UI). There are no native counterparts in the archive.

Evidence icons: the 223 Mobile HD evidence icons have no native counterpart in the archive. No repo `court-record/` image matches these icons by name or SHA-256.

## 3. Locations without a native version

- The HD set (8 places with files, 110 files) has no native-DS version of the same named place in the archive. The one native-scale sheet (`other assets/locations/DS _ DSi ... Locations.png`) holds 28 tiles of 256x192 with **no labels**. Mapping its tiles to the HD place names is a visual step that has not been done.
- The DS courtroom background (`other assets/courtroom/DS _ DSi ... Courtroom.png`, 1697x453) is a strip, not a single screen-sized background.
- The Mobile HD courtroom and benches image (8000x800) is the only other courtroom-scale location art.
- Game or case for each HD place is not labelled in the files.
- `other assets/locations HD/Atmey Detective Agency/` exists but is an empty folder (0 files). It has no image and is not counted.

## 4. Missing or unusable audio metadata

- The 104 archive soundtrack MP3s have title, album, track number and artist, but **no disc number** (the disc is only known from the folder name). `tag_status` is `partial` for all 104.
- Cover art (APIC frames) was not checked for any track.
- `Disc 2/34. BONUS - Prosecutor's Path ~ Miles and Fran.flac.mp3` has `.flac` in its filename and title. The file is an MP3. The name is inconsistent with its content.
- `docs/sfx general/` WAVs (113 files) have no tags (WAV files do not carry ID3 here). Their durations (0.02-11.6 s) and sample rates (10512-44100 Hz) vary widely. Sample-rate normalisation is a later decision, not measured here.
- `docs/original_tracks/` has four track titles appearing twice under `_` and `-` filename spellings (38 files, 34 distinct tracks).
- `Disc 1/28. Unused Track.mp3` has no counterpart in `docs/original_tracks/`.

## 5. Unlabelled files

- `characters/loading.png` (244x258): content not identified; no name in the filename.
- `other assets/evidences/491690.png` (960x1280): numeric filename, content not identified.
- `other assets/profiles/Game Boy Advance ... Character Profiles.png` (530x272): about 28 unlabelled faces. No names. A visual labelling pass is needed before any mapping.
- `other assets/artbook/Characters/*/characterNNN.png` (76) and `Illustrations/*/visualNNN.png` (64): numbered, no captions in the archive. The folder names give the character or game, not the image content.
- `other assets/evidences/Mobile ... Evidence.zip`: 223 PNG item icons with ID-only names (`0_it004.png` ... `ita00e.png`, `@rs15`). The contact sheet shows evidence objects, but there is no name mapping. The `0_` / `1_` / `2_` prefixes are not explained. The zip also holds 224 `__MACOSX/` and `._` resource-fork entries (skipped).
- `other assets/UI/musicPlayer_*_<suffix>.png`: the one-letter suffixes (`_b`, `_f`, `_g`, `_k`, `_l`, `_s`, `_t`, `_u`, `_`) are not explained. They look like locale or state variants, not verified. Several are byte-identical (for example `musicPlayer_player_All_Repeat`, `_k` and `_u`).
- `other assets/UI/musicPlayer_taiho_1..6`, `taiho_car`, `musicPlayer_LP*`: purpose not labelled in the archive.
- `other assets/logos/` and `phrases_en_jap/`: 3DS HOME menu and exclamation sheets; no per-item names.
- `police_extract/... Font.png` (128x3072, 2 colours): a font atlas; no glyph map in the archive.
- Repo-side unlabelled: `docs/references/` has `Ace-Attorney.ttf`, `dotgothic16/`, `igiari/` (font families), `evidence_summon.png`, `evidence_outline_template.png` and others; no metadata.

## 6. Corrupted or unreadable files

- Files that failed to decode or parse: **0** (no read errors, no unreadable images, no corrupt zip members).
- `d['summary']['errors']` (JSON): 0.
- Evidence zip entries: 447 total, 224 resource-fork (`__MACOSX/`, `._*`) entries skipped, 1 directory entries.
- Zip files: 2 in the archive (soundtrack zip, evidence zip). The repo has 1 zip (`docs/references/music/pwaa-original-soundtrack.zip`).

## 7. Could not classify (DS vs HD)

Archive and zip images classed `uncertain` after overrides: **324** of 655.

| Group | Count | Why it is uncertain |
|---|---:|---|
| DS-era character sheets (solid background, DS-like palette, size several times a DS sprite) | 51 | palette-style but not a clear native size, or a mix of signals |
| other assets (courtroom strips, effects, evidence, GBA profile, PWAA gallery) | 6 | palette-style but not a clear native size, or a mix of signals |
| musicPlayer UI pieces (72x142 / 72x352 buttons, 9-500 colours, 0% semi-alpha) | 41 | palette-style but not a clear native size, or a mix of signals |
| artbook gallery UI pieces | 2 | palette-style but not a clear native size, or a mix of signals |
| Mobile HD evidence zip icons (192 px palette icons; native size not confirmed) | 223 | palette-style but not a clear native size, or a mix of signals |
| GBA font atlas (2 colours) | 1 | palette-style but not a clear native size, or a mix of signals |

## 8. Items that were not measured

- Frame counts for the DS-era character sheets (solid background; gutter detection did not separate frames). A visual or connected-component pass is needed.
- Frame counts for 3DS character sheets (no transparent gutters; single block).
- PC HD character sheets: the grid estimate from gutters is approximate (2x7 to 5x1 depending on sheet).
- Evidence icon names (no mapping). Artbook image content (no captions).
- Music track ID3 album art (APIC frames) not checked.
- Sheet sprite bounding boxes for everything except the investigation cursor and the evidence frame.

