# Asset expansion inventory

Mechanical inventory of the Ace Attorney asset archive that was staged for the Courtroom Companion asset expansion.

**Read-only source.** The archive root is `C:\Users\adria\Desktop\extract_assets_ace` (538 top-level files, 2 zips at the top level, zip members decoded in memory). Nothing was copied, moved, renamed or extracted into `frontend/public/`. Nothing in the source archive or the repo was modified by this inventory.

Per-file JSON and CSV (`inventory.json`, `inventory.csv`), the calibration script and the preview images are kept in the agent scratchpad (`scratchpad/inventory/`), not in the repo. Preview images are referenced by file name in the sections below.

This document is measurement only. It makes no architectural decision about what enters the runtime. See `docs/ASSET_EXPANSION_GAPS.md` for the list of open items.

## 1. Totals

| Scope | Files | Images | Audio | Zip | Other |
|---|---:|---:|---:|---:|---:|
| Archive, top-level files | 538 | 432 | 104 | 2 | 0 |
| Archive, zip members (2 zips) | 327 | 223 | 104 | 0 | 0 |
| Repo `frontend/public/assets/` | 386 | 291 | 76 | 0 | 19 |
| Repo `docs/references/` | 34 | 22 | 0 | 1 | 11 |
| Repo `docs/original_tracks/` | 38 | 0 | 38 | 0 | 0 |
| Repo `docs/sfx general/` | 116 | 0 | 116 | 0 | 0 |
| Repo zip members (`docs/references/music/*.zip`) | 38 | 0 | 38 | 0 | 0 |
| **All records hashed** | **1477** | **968** | **476** | **3** | **30** |

Archive top-level breakdown: 432 PNG, 104 MP3, 2 ZIP. Archive zip members: 223 PNG (Mobile HD Court Record evidence zip) and 104 MP3 (soundtrack zip). `__MACOSX/` resource-fork entries and `._*` files inside the evidence zip were skipped (not counted).

## 2. Folder totals (archive top level)

| Folder | Files | Kinds | Notes |
|---|---:|---|---|
| `characters` | 72 | 72 image | Character sheets (3DS 12, DS/DSi 26 Ace Attorney + 23 Justice for All, GBA 1, PC demo 1); loading.png; character_hd/ 8 PC HD sheets |
| `game_soundtrack` | 105 | 104 audio, 1 zip | Discs 1-3 (35/34/35 MP3) and the soundtrack zip (same 104 tracks, byte-identical) |
| `other assets/UI` | 73 | 73 image |  |
| `other assets/artbook` | 163 | 163 image |  |
| `other assets/courtroom` | 2 | 2 image |  |
| `other assets/courtroom_stance` | 2 | 2 image |  |
| `other assets/effects` | 1 | 1 image |  |
| `other assets/evidences` | 4 | 3 image, 1 zip |  |
| `other assets/gavel` | 1 | 1 image |  |
| `other assets/locations` | 1 | 1 image |  |
| `other assets/locations HD` | 110 | 110 image |  |
| `other assets/logos` | 1 | 1 image |  |
| `other assets/phrases_en_jap` | 1 | 1 image |  |
| `other assets/profiles` | 1 | 1 image |  |
| `police_extract` | 1 | 1 image | GBA font atlas |

`other assets/` subfolders: UI 73, artbook 163 (Characters 76, Illustrations 64, Misc 23), locations HD 110, locations 1, courtroom 2, courtroom_stance 2, effects 1, evidences 3 PNG + 1 zip, gavel 1, logos 1, phrases_en_jap 1, profiles 1.

## 3. Classification method and calibration

Every image was measured with Pillow + numpy: size, mode, alpha coverage, opaque/semi-transparent pixel fractions, colour counts (capped at 4096), border colour, and a gutter/band count for sheet detection. Classification uses evidence, not filenames alone:

- **DS palette**: at most 64 visible colours AND under 0.5% semi-transparent pixels.
- **HD evidence**: at least 1000 visible colours OR at least 2% semi-transparent pixels.
- **native_ds**: (max side <= 300 AND DS palette), OR (width is 256 or 512 AND at most 512 visible colours AND under 0.5% semi-alpha AND no HD evidence). This matches the DS screen width and the repo's DS backgrounds.
- **hd**: HD evidence AND not DS palette.
- **uncertain**: everything else. The `lean` column records whichever side the palette evidence points to (`ds` or `hd`), and the filename hint (DS/GBA vs 3DS/PC/Mobile) is recorded separately.

Calibration against the repo's existing native DS runtime assets (`frontend/public/assets/`):

| Repo group | n | Size range (px) | Visible colours | Semi-alpha % | Alpha coverage % | Classified |
|---|---:|---|---|---|---|---|
| characters/maya/* sprites + talking/reaction/idle | 102 | 76-158 x 146-162 | 15-15 | 0.0-0.0 | 45.76-69.57 | native_ds 102 |
| characters/mia/* sprites | 59 | 73-110 x 166-170 | 15-15 | 0.0-0.0 | 61.61-72.96 | native_ds 59 |
| characters/gumshoe/* sprites | 82 | 153-204 x 169-180 | 13-21 | 0.0-0.0 | 66.5-77.3 | native_ds 82 |
| characters/*/portraits (64x64) | 3 | 64-64 x 64-64 | 15-16 | 0.0-0.0 | 100.0-100.0 | native_ds 3 |
| backgrounds/*.png | 29 | 255-512 x 191-193 | 205-402 | 0.0-0.0 | 100.0-100.0 | native_ds 28, uncertain 1 |
| ui/ and court-record/ | 16 | 64-256 x 64-192 | 5-208 | 0.0-0.0 | 16.41-100.0 | native_ds 16 |
| docs/references/ DS-style sheets (maya fey, mia fey, dick gumshoe) | 3 | 1068-1336 x 2310-3273 | 23-43 | 0.0-0.0 | 100.0-100.0 | uncertain 3 |
| docs/references/courtroom-screens/ (256x192) | 5 | 256-256 x 192-192 | 14-49 | 0.0-0.0 | 100.0-100.0 | native_ds 5 |

Notes from calibration:

- Repo native DS sprites: 15 colours (Maya/Mia), 13-21 (Gumshoe), 0.0% semi-alpha, transparent backgrounds (alpha coverage ~45-75%).
- Repo native DS backgrounds: 255-512 px wide by 191-193 px tall, 205-402 colours, fully opaque RGB. The one background not classed native_ds is the 255-px-wide variant (outside the width rule).
- Nearest-neighbour upscale test (every aligned k x k block uniform, k=2..12): negative for every file tested, including the native Maya frame. So there is no block-scaling signature to use as evidence either way.
- Family that does not fit cleanly: the DS-era sheets in `characters/` (49 `DS _ DSi` files, plus 1 GBA and 1 PC demo sheet: 51 files, 689-1918 px wide, 548-3146 px tall, 20-192 visible colours, 0% semi-alpha, solid background). Their palette is DS-like, but their size is several times a DS sprite. The repo's own `docs/references/maya fey.png` (1180x3112, 23 colours) belongs to the same look. All 51 are classed `uncertain`: 47 with `lean=ds` (<=64 colours) and 4 with no lean (68-192 colours). Their native scale is not proven.
- Mobile HD evidence zip icons: 192x192 palette PNGs with 15-255 colours. DS evidence icons are not 192 px. The automated rule would call the <=64-colour ones native_ds. They are reclassified `uncertain` here.

Manual overrides (each is listed so it can be audited):

1. `other assets/locations/DS _ DSi ... Justice for All - Miscellaneous - Locations.png` (1029x1352, 4096+ colours): the automated rule says hd. It is a sheet of 28 DS-screen-sized location tiles (4 columns x 7 rows, 256x192 tiles, 1-px separator lines at the rows 193, 386, 579 ... and columns 257, 514, 771). Per-tile colour counts are about 215-370, in the same range as the repo's native backgrounds. Classified `native_ds` (sheet).
2. The 223 Mobile HD evidence zip icons: automated rule partly says native_ds. Reclassified `uncertain` (see above).
3. `police_extract/... Font.png` (128x3072, 2 colours): a 1-bit font atlas. Not a DS or HD question. Classified `uncertain`.

### Results after overrides

| Set | native_ds | hd | uncertain |
|---|---:|---:|---:|
| Archive top-level images (432) | 5 | 326 | 101 |
| Archive zip members (223) | 0 | 0 | 223 |
| Repo images (313) | 300 | 6 | 7 |

## 4. Characters

One row per archive character file. Platform and game come from the filename (`PLATFORM - GAME - Characters - NAME.png`). Frame count is not given for the DS sheets: gutter detection on their solid-colour background did not separate frames reliably, so only a visual description is given. 3DS sheets have no transparent gutters (single block). PC HD sheets have transparent gutters, so a grid estimate is available.

Portrait availability: the archive has no per-character portrait file. The only portrait-type image is `other assets/profiles/Game Boy Advance ... Character Profiles.png` (530x272, 271 colours). It is an unlabelled sheet of about 28 face portraits and cannot be mapped to names without a visual labelling pass. Artbook has HD art folders for Franziska von Karma, Godot, Maya Fey, Mia Fey, Miles Edgeworth, Pearl Fey, Phoenix Wright, and game-title folders for Justice for All, Phoenix Wright - Ace Attorney, Rise from the Ashes and Trials and Tribulations.

| Character | Source file (archive) | Platform / game | Class | Lean | Sheet / frames | Size (px) | Visible colours | Semi-alpha % | Alpha cov. % | Portrait/profile elsewhere |
|---|---|---|---|---|---|---|---|---|---|---|
| loading | `loading.png` | (no platform in filename) | native_ds | ds | single image (content not identified) | 244x258 | 31 | 0.0 | 100.0 | none per character; see profiles note |
| Angel Starr | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Angel Starr.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x3314 | 4096+ | 1.362 | 70.11 | none per character; see profiles note |
| Bikini | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Bikini.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x1800 | 4096+ | 0.93 | 76.67 | none per character; see profiles note |
| Dahlia Hawthorne | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Dahlia Hawthorne.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2498 | 4096+ | 12.554 | 74.62 | none per character; see profiles note |
| Elise Deauxnim | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Elise Deauxnim.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x803 | 2929 | 1.799 | 63.53 | none per character; see profiles note |
| Frank Sahwit | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Frank Sahwit.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2899 | 4096+ | 1.631 | 53.96 | none per character; see profiles note |
| Furio Tigre | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Furio Tigre.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2935 | 4096+ | 1.461 | 69.03 | none per character; see profiles note |
| Godot _ Diego Armando | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Godot _ Diego Armando.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x13884 | 4096+ | 2.042 | 53.69 | artbook HD art folder 'Godot' (not a portrait) |
| Iris | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Iris.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2709 | 4096+ | 1.204 | 81.15 | none per character; see profiles note |
| Jean Armstrong | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Jean Armstrong.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x6905 | 4096+ | 1.19 | 64.45 | none per character; see profiles note |
| Lisa Basil | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Lisa Basil.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2799 | 4096+ | 2.133 | 72.36 | none per character; see profiles note |
| Luke Atmey | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Luke Atmey.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x4104 | 4096+ | 1.468 | 63.18 | none per character; see profiles note |
| Victor Kudo | `3DS - Phoenix Wright_ Ace Attorney Trilogy - Characters - Victor Kudo.png` | 3DS - Phoenix Wright_ Ace Attorney Trilogy | hd | hd | single tall composite, no transparent gutters (frames not separated) | 1208x2293 | 4096+ | 1.566 | 60.65 | none per character; see profiles note |
| Angel Starr | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Angel Starr.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | - | multi-pose sheet on solid background (frames not counted) | 1150x2394 | 192 | 0.0 | 100.0 | none per character; see profiles note |
| April May | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - April May.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1180x1522 | 24 | 0.0 | 100.0 | none per character; see profiles note |
| Bellboy | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Bellboy.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 689x826 | 27 | 0.0 | 100.0 | none per character; see profiles note |
| Cody Hackins | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Cody Hackins.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1080x1451 | 40 | 0.0 | 100.0 | none per character; see profiles note |
| Damon Gant | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Damon Gant.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | - | multi-pose sheet on solid background (frames not counted) | 1370x2837 | 74 | 0.0 | 100.0 | none per character; see profiles note |
| Dee Vasquez | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Dee Vasquez.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1080x1614 | 24 | 0.0 | 100.0 | none per character; see profiles note |
| Ema Skye | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Ema Skye.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1130x2910 | 44 | 0.0 | 100.0 | none per character; see profiles note |
| Frank Sahwit | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Frank Sahwit.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1028x1283 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Jake Marshall | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Jake Marshall.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | - | multi-pose sheet on solid background (frames not counted) | 1459x2238 | 68 | 0.0 | 100.0 | none per character; see profiles note |
| Judge | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Judge.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1028x936 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Lana Skye | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Lana Skye.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1068x1747 | 37 | 0.0 | 100.0 | none per character; see profiles note |
| Larry Butz | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Larry Butz.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1290x3146 | 28 | 0.0 | 100.0 | none per character; see profiles note |
| Lotta Hart | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Lotta Hart.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1125x1317 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Manfred von Karma | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Manfred von Karma.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1300x2626 | 24 | 0.0 | 100.0 | none per character; see profiles note |
| Marvin Grossberg | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Marvin Grossberg.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 757x745 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Mike Meekins | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Mike Meekins.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1300x2329 | 35 | 0.0 | 100.0 | none per character; see profiles note |
| Miles Edgeworth | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Miles Edgeworth.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1439x1941 | 23 | 0.0 | 100.0 | artbook HD art folder 'Miles Edgeworth' (not a portrait) |
| Miles Edgeworth (in Court) | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Miles Edgeworth (in Court).png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1918x2028 | 26 | 0.0 | 100.0 | artbook HD art folder 'Miles Edgeworth' (not a portrait) |
| Penny Nichols | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Penny Nichols.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 846x548 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Phoenix Wright | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Phoenix Wright.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1544x2448 | 39 | 0.0 | 100.0 | artbook HD art folder 'Phoenix Wright' (not a portrait) |
| Redd White | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Redd White.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1890x1666 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Sal Manella | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Sal Manella.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1080x1428 | 24 | 0.0 | 100.0 | none per character; see profiles note |
| Wendy Oldbag | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Wendy Oldbag.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1080x965 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Will Powers | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Will Powers.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1080x834 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Winston Payne | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Winston Payne.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 992x620 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Yanni Yogi | `DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - Yanni Yogi.png` | DS _ DSi - Phoenix Wright_ Ace Attorney | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1085x2007 | 53 | 0.0 | 100.0 | none per character; see profiles note |
| Acro | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Acro.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1304x2116 | 55 | 0.0 | 100.0 | none per character; see profiles note |
| Adrian Andrews | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Adrian Andrews.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 693x2051 | 42 | 0.0 | 100.0 | none per character; see profiles note |
| Ben and Trillo | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Ben and Trillo.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1106x1620 | 24 | 0.0 | 100.0 | none per character; see profiles note |
| Dr. Hotti | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Dr. Hotti.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1068x908 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Franziska (Courtroom) | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Franziska (Courtroom).png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1562x2290 | 48 | 0.0 | 100.0 | none per character; see profiles note |
| Franziska von Karma | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Franziska von Karma.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 899x852 | 46 | 0.0 | 100.0 | artbook HD art folder 'Franziska von Karma' (not a portrait) |
| Ini Miney | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Ini Miney.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1055x1603 | 40 | 0.0 | 100.0 | none per character; see profiles note |
| Maggey Byrde | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Maggey Byrde.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1127x1316 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Matt Engarde | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Matt Engarde.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1137x2240 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Max Galactica | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Max Galactica.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1180x1194 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Maya (Courtroom) | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Maya (Courtroom).png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 750x863 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Mia (Courtroom) | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Mia (Courtroom).png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1068x2116 | 51 | 0.0 | 100.0 | none per character; see profiles note |
| Miles Edgeworth (Courtroom) | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Miles Edgeworth (Courtroom).png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1413x1751 | 26 | 0.0 | 100.0 | artbook HD art folder 'Miles Edgeworth' (not a portrait) |
| Moe | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Moe.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1134x1554 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Morgan Fey | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Morgan Fey.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1055x1459 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Pearl Fey | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Pearl Fey.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1051x1405 | 27 | 0.0 | 100.0 | artbook HD art folder 'Pearl Fey' (not a portrait) |
| Phoenix Wright | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Phoenix Wright.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1537x2185 | 56 | 0.0 | 100.0 | artbook HD art folder 'Phoenix Wright' (not a portrait) |
| Regina Berry | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Regina Berry.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 946x1650 | 26 | 0.0 | 100.0 | none per character; see profiles note |
| Richard Wellington | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Richard Wellington.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1354x1871 | 31 | 0.0 | 100.0 | none per character; see profiles note |
| Shelly de Killer | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Shelly de Killer.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | - | multi-pose sheet on solid background (frames not counted) | 798x1741 | 84 | 0.0 | 100.0 | none per character; see profiles note |
| Turner Grey | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Turner Grey.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1051x1105 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Wendy Oldbag | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Wendy Oldbag.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1001x1067 | 29 | 0.0 | 100.0 | none per character; see profiles note |
| Will Powers | `DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - Will Powers.png` | DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 864x942 | 23 | 0.0 | 100.0 | none per character; see profiles note |
| Maggey Byrde | `Game Boy Advance - Phoenix Wright_ Ace Attorney_ Justice for All _ Gyakuten Saiban 2 (JPN) - Characters - Maggey Byrde.png` | Game Boy Advance - Phoenix Wright_ Ace Attorney_ Justice for All _ Gyakuten Saiban 2 | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 752x625 | 20 | 0.0 | 100.0 | none per character; see profiles note |
| Young Mia | `PC _ Computer - Gyakuten Saiban 3 (JPN) (Demo) - Characters - Young Mia.png` | PC _ Computer - Gyakuten Saiban 3 (Demo) | uncertain | ds | multi-pose sheet on solid background (frames not counted) | 1447x1193 | 43 | 0.0 | 100.0 | none per character; see profiles note |
| Dahlia Hawthorne | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Dahlia Hawthorne.png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 2 cols x 7 rows (gutter estimate) | 3864x7244 | 4096+ | 20.892 | 35.25 | none per character; see profiles note |
| Diego Armando (Prosecutor Godot) | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Diego Armando (Prosecutor Godot).png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 3 rows (gutter estimate) | 5208x5208 | 4096+ | 5.255 | 35.58 | artbook HD art folder 'Godot' (not a portrait) |
| Mia Fey (Channeled by Maya) | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Mia Fey (Channeled by Maya).png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 5 cols x 1 rows (gutter estimate) | 5208x1736 | 4096+ | 1.132 | 43.22 | artbook HD art folder 'Mia Fey' (not a portrait) |
| Mia Fey (Channeled by Pearl) | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Mia Fey (Channeled by Pearl).png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, single block (gutter estimate) | 1728x1728 | 4096+ | 1.088 | 59.04 | artbook HD art folder 'Mia Fey' (not a portrait) |
| Phoenix Wright (Young) | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Phoenix Wright (Young).png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 4 cols x 2 rows (gutter estimate) | 5208x3472 | 4096+ | 0.931 | 52.21 | artbook HD art folder 'Phoenix Wright' (not a portrait) |
| Sal Manella | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Sal Manella.png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 2 cols x 3 rows (gutter estimate) | 3472x3472 | 4096+ | 0.958 | 43.88 | none per character; see profiles note |
| Viola Cadaverini | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Viola Cadaverini.png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 4 rows (gutter estimate) | 5140x4734 | 4096+ | 0.737 | 37.93 | none per character; see profiles note |
| Winston Payne | `character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Winston Payne.png` | PC - Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 3 rows (gutter estimate) | 3472x5208 | 4096+ | 1.35 | 39.04 | none per character; see profiles note |
| Dahlia Hawthorne | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Dahlia Hawthorne.png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 2 cols x 7 rows (gutter estimate) | 3864x7244 | 4096+ | 20.892 | 35.25 | none per character; see profiles note |
| Diego Armando (Prosecutor Godot) | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Diego Armando (Prosecutor Godot).png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 3 rows (gutter estimate) | 5208x5208 | 4096+ | 5.255 | 35.58 | artbook HD art folder 'Godot' (not a portrait) |
| Mia Fey (Channeled by Maya) | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Mia Fey (Channeled by Maya).png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 5 cols x 1 rows (gutter estimate) | 5208x1736 | 4096+ | 1.132 | 43.22 | artbook HD art folder 'Mia Fey' (not a portrait) |
| Mia Fey (Channeled by Pearl) | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Mia Fey (Channeled by Pearl).png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, single block (gutter estimate) | 1728x1728 | 4096+ | 1.088 | 59.04 | artbook HD art folder 'Mia Fey' (not a portrait) |
| Phoenix Wright (Young) | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Phoenix Wright (Young).png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 4 cols x 2 rows (gutter estimate) | 5208x3472 | 4096+ | 0.931 | 52.21 | artbook HD art folder 'Phoenix Wright' (not a portrait) |
| Sal Manella | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Sal Manella.png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 2 cols x 3 rows (gutter estimate) | 3472x3472 | 4096+ | 0.958 | 43.88 | none per character; see profiles note |
| Viola Cadaverini | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Viola Cadaverini.png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 4 rows (gutter estimate) | 5140x4734 | 4096+ | 0.737 | 37.93 | none per character; see profiles note |
| Winston Payne | `characters/character_hd/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Characters - Winston Payne.png` | PC Trilogy (HD sheet) | hd | hd | PC HD sheet, 3 cols x 3 rows (gutter estimate) | 3472x5208 | 4096+ | 1.35 | 39.04 | none per character; see profiles note |

Character coverage by platform (name-level, counted from filenames):

- **3DS**: 12 distinct names: Angel Starr, Bikini, Dahlia Hawthorne, Elise Deauxnim, Frank Sahwit, Furio Tigre, Godot _ Diego Armando, Iris, Jean Armstrong, Lisa Basil, Luke Atmey, Victor Kudo
- **DS/DSi**: 46 distinct names: Acro, Adrian Andrews, Angel Starr, April May, Bellboy, Ben and Trillo, Cody Hackins, Damon Gant, Dee Vasquez, Dr. Hotti, Ema Skye, Frank Sahwit, Franziska (Courtroom), Franziska von Karma, Ini Miney, Jake Marshall, Judge, Lana Skye, Larry Butz, Lotta Hart, Maggey Byrde, Manfred von Karma, Marvin Grossberg, Matt Engarde, Max Galactica, Maya (Courtroom), Mia (Courtroom), Mike Meekins, Miles Edgeworth, Miles Edgeworth (Courtroom), Miles Edgeworth (in Court), Moe, Morgan Fey, Pearl Fey, Penny Nichols, Phoenix Wright, Redd White, Regina Berry, Richard Wellington, Sal Manella, Shelly de Killer, Turner Grey, Wendy Oldbag, Will Powers, Winston Payne, Yanni Yogi
- **GBA**: 1 distinct names: Maggey Byrde
- **PC**: 9 distinct names: Dahlia Hawthorne, Diego Armando (Prosecutor Godot), Mia Fey (Channeled by Maya), Mia Fey (Channeled by Pearl), Phoenix Wright (Young), Sal Manella, Viola Cadaverini, Winston Payne, Young Mia

## 5. Locations

The HD set is a named-place set with `bgNNN` IDs and variant letters. The game or case is not labelled in the files, so it is not given here. The only native-DS location material is one sheet of 28 DS-scale tiles, plus the courtroom and effects backgrounds.

| Place (folder) | Files | Dimensions | Class | Sub-folders | Example IDs | Notes |
|---|---:|---|---|---|---|---|
| Blue Screens, Inc | 1 | 1920x1080 x1 | hd (1/1) | (root) | bg303 |  |
| Hazakura Temple | 51 | 1920x1080 x45, 3840x1080 x5, 1620x472 x1 | hd (51/51) | (root) | bg500, bg501, bg502, bg503, bg503b, bg503f ... | duplicate pair(s) present |
| KB Security | 10 | 1920x1080 x10 | hd (10/10) | (root) | bg204, bg204k, bg204s, bg204t, bg204u, bg205 ... | duplicate pair(s) present |
| Lordly Tailor | 19 | 3840x1080 x10, 1920x1080 x9 | hd (19/19) | (root) | bg200, bg200b, bg200f, bg200g, bg200k, bg200l ... |  |
| Mask☆DeMasque's Hideout | 1 | 1920x1080 x1 | hd (1/1) | (root) | bg203 |  |
| Tender Lender | 9 | 1920x1080 x9 | hd (9/9) | (root) | bg304, bg304b, bg304f, bg304g, bg304k, bg304l ... |  |
| Trés Bien | 10 | 3840x1080 x9, 1920x1080 x1 | hd (10/10) | (root) | bg300, bg300b, bg300f, bg300g, bg300k, bg300l ... |  |
| Vitamin Square | 9 | 1920x1080 x9 | hd (9/9) | (root) | bg302, bg302b, bg302f, bg302g, bg302k, bg302l ... |  |

Totals: 110 HD location files (1920x1080 or 3840x1080, except one 1620x472; 4096+ visible colours in all; semi-alpha at most 0.01% of pixels). Duplicate pairs inside the set: `Hazakura Temple/Inner Temple/bg507.png` = `bg507u.png`, `KB Security/CEO's Office/bg204s.png` = `bg204t.png`. Hazakura Temple also has one 1620x472 image (`bg54d.png`).

Native-DS and other location-type images:

| File | Dimensions | Class | Notes |
|---|---|---|---|
| `other assets/courtroom/DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Courtroom.png` | 1697x453 | uncertain | DS courtroom background strip |
| `other assets/courtroom/Mobile - Phoenix Wright_ Ace Attorney Trilogy HD - Miscellaneous - Courtrooms and Benches.png` | 8000x800 | hd | Mobile HD courtroom and benches strip (8000x800) |
| `other assets/courtroom_stance/DS _ DSi - Phoenix Wright_ Ace Attorney - Miscellaneous - Courtroom.png` | 256x474 | native_ds | DS-width (256 px) sprite sheet of courtroom cut-outs on a solid purple background |
| `other assets/courtroom_stance/DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Scenes - In Court.png` | 256x471 | native_ds | DS-width (256 px) sprite sheet of courtroom cut-outs on a solid purple background |
| `other assets/effects/DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Action Lines.png` | 716x238 | uncertain | DS action lines (12 colours) |
| `other assets/gavel/DS _ DSi - Phoenix Wright_ Ace Attorney - Scenes - Gavel Slam.png` | 1831x238 | uncertain | DS gavel scene strip |
| `other assets/locations/DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Miscellaneous - Locations.png` | 1029x1352 | native_ds | sheet of 28 DS-scale tiles (256x192 each); manual override to native_ds |

## 6. UI

### 6a. Investigation cursor (sheet, measured)

File: `other assets/UI/PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Investigation Cursor.png` (240x240 RGBA, 348 visible colours, 55% semi-alpha = antialiased, class hd). A 2 x 2 grid of 113 x 113 px sprites with 4 px margins and 8 px gutters. Bounding boxes (x0, y0, x1, y1), inclusive:

| Index | Sub-sprite | Box | Size | Preview |
|---|---|---|---|---|
| TL | blue magnifier | (4, 4, 116, 116) | 113x113 | `scratchpad/inventory/previews/cursor_full_240.png` (whole sheet) |
| TR | yellow magnifier | (124, 4, 236, 116) | 113x113 | same sheet |
| BL | blue magnifier + red check | (4, 124, 116, 236) | 113x113 | same sheet |
| BR | yellow magnifier + red check | (124, 124, 236, 236) | 113x113 | same sheet |

Preview crop of the whole sheet: `scratchpad/inventory/previews/cursor_sheet_preview.png`.

### 6b. Evidence frame (single frame, measured)

File: `other assets/UI/PC _ Computer - ... - Miscellaneous - Evidence Frame.png` (450x450 RGBA, 4 visible colours, 0% semi-alpha, 54.5% alpha coverage, class uncertain with lean ds). Only one variant exists in this file: a 354 x 354 opaque frame (box (48, 48, 401, 401), inclusive) centred in a 450 x 450 transparent canvas. The frame has blue corner brackets, a blue and white inner outline, and an opaque grey fill (centre pixel RGBA 190, 191, 188, 255). No other frame variants are in the archive UI folder. The evidence zip has no frame graphics, only item icons.

Preview: `scratchpad/inventory/previews/evidence_frame_sheet_preview.png` (composited on grey) and `scratchpad/inventory/previews/evidence_frame_full_450.png`.

### 6c. Music player and other UI pieces

| Family | Count | Sizes (px) | Class mix |
|---|---:|---|---|
| gallery / misc | 1 | 20x40 | {'hd': 1} |
| musicPlayer_Info*/InfoBGM* (info bars) | 4 | 408x68, 412x72, 472x72, 586x72 | {'uncertain': 4} |
| musicPlayer_LP* (record art) | 3 | 204x204, 512x512 | {'uncertain': 1, 'hd': 2} |
| other musicPlayer_* | 5 | 1920x1080, 28x44, 64x64, 770x314, 784x64 | {'hd': 4, 'uncertain': 1} |
| musicPlayer_icon_bgm_* | 9 | 72x176 | {'hd': 9} |
| musicPlayer_jacket* | 6 | 588x2888 | {'hd': 6} |
| musicPlayer_player_* (transport/repeat/shuffle/BGM buttons) | 36 | 72x142, 72x352 | {'uncertain': 35, 'native_ds': 1} |
| musicPlayer_taiho_* | 7 | 100x80, 128x128, 256x256, 256x384 | {'hd': 7} |

Full per-file UI list (name, size, colours, class):

| File | Size | Visible colours | Semi-alpha % | Class | Dup group |
|---|---|---|---|---|---|
| PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Evidence Frame.png | 450x450 | 4 | 0.0 | uncertain | 1 |
| PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Investigation Cursor.png | 240x240 | 348 | 55.324 | hd | 1 |
| gallery_pager.png | 20x40 | 11 | 44.366 | hd | 1 |
| musicPlayer_InfoBGM_bg.png | 408x68 | 6 | 0.0 | uncertain | 1 |
| musicPlayer_InfoBGM_bg_.png | 412x72 | 5 | 0.0 | uncertain | 1 |
| musicPlayer_InfoBGM_bg_u.png | 586x72 | 5 | 0.0 | uncertain | 1 |
| musicPlayer_Info_bg.png | 472x72 | 5 | 0.0 | uncertain | 1 |
| musicPlayer_LP.png | 512x512 | 491 | 1.164 | uncertain | 1 |
| musicPlayer_LP_label.png | 204x204 | 1 | 3.03 | hd | 1 |
| musicPlayer_LP_label_decor.png | 204x204 | 1 | 100.0 | hd | 1 |
| musicPlayer_bg.png | 1920x1080 | 4096 | 0.0 | hd | 1 |
| musicPlayer_icon_bgm_.png | 72x176 | 2 | 24.104 | hd | 3 |
| musicPlayer_icon_bgm_b.png | 72x176 | 2 | 31.706 | hd | 2 |
| musicPlayer_icon_bgm_f.png | 72x176 | 2 | 30.679 | hd | 1 |
| musicPlayer_icon_bgm_g.png | 72x176 | 2 | 28.503 | hd | 1 |
| musicPlayer_icon_bgm_k.png | 72x176 | 2 | 24.104 | hd | 3 |
| musicPlayer_icon_bgm_l.png | 72x176 | 2 | 31.706 | hd | 2 |
| musicPlayer_icon_bgm_s.png | 72x176 | 2 | 57.902 | hd | 1 |
| musicPlayer_icon_bgm_t.png | 72x176 | 2 | 58.414 | hd | 1 |
| musicPlayer_icon_bgm_u.png | 72x176 | 2 | 24.104 | hd | 3 |
| musicPlayer_icon_note.png | 28x44 | 1 | 60.0 | hd | 1 |
| musicPlayer_jacket.png | 588x2888 | 4096 | 0.0 | hd | 1 |
| musicPlayer_jacket_.png | 588x2888 | 4096 | 5.56 | hd | 1 |
| musicPlayer_jacket_k.png | 588x2888 | 4096 | 5.554 | hd | 1 |
| musicPlayer_jacket_s.png | 588x2888 | 4096 | 5.524 | hd | 1 |
| musicPlayer_jacket_t.png | 588x2888 | 4096 | 5.528 | hd | 1 |
| musicPlayer_jacket_u.png | 588x2888 | 4096 | 5.398 | hd | 1 |
| musicPlayer_player_Album_Repeat.png | 72x142 | 492 | 0.0 | uncertain | 1 |
| musicPlayer_player_Album_Shuffle.png | 72x142 | 535 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat.png | 72x142 | 338 | 0.0 | uncertain | 3 |
| musicPlayer_player_All_Repeat_b.png | 72x142 | 375 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_f.png | 72x142 | 363 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_g.png | 72x142 | 347 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_k.png | 72x142 | 338 | 0.0 | uncertain | 3 |
| musicPlayer_player_All_Repeat_l.png | 72x142 | 335 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_s.png | 72x142 | 355 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_t.png | 72x142 | 360 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Repeat_u.png | 72x142 | 338 | 0.0 | uncertain | 3 |
| musicPlayer_player_All_Shuffle.png | 72x142 | 431 | 0.0 | uncertain | 3 |
| musicPlayer_player_All_Shuffle_b.png | 72x142 | 458 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_f.png | 72x142 | 446 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_g.png | 72x142 | 444 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_k.png | 72x142 | 431 | 0.0 | uncertain | 3 |
| musicPlayer_player_All_Shuffle_l.png | 72x142 | 428 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_s.png | 72x142 | 444 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_t.png | 72x142 | 446 | 0.0 | uncertain | 1 |
| musicPlayer_player_All_Shuffle_u.png | 72x142 | 431 | 0.0 | uncertain | 3 |
| musicPlayer_player_BGMSetting.png | 72x352 | 442 | 0.0 | uncertain | 1 |
| musicPlayer_player_BGMSetting_.png | 72x352 | 270 | 0.0 | uncertain | 3 |
| musicPlayer_player_BGMSetting_b.png | 72x352 | 360 | 0.0 | uncertain | 2 |
| musicPlayer_player_BGMSetting_f.png | 72x352 | 393 | 0.0 | uncertain | 1 |
| musicPlayer_player_BGMSetting_g.png | 72x352 | 318 | 0.0 | uncertain | 1 |
| musicPlayer_player_BGMSetting_k.png | 72x352 | 270 | 0.0 | uncertain | 3 |
| musicPlayer_player_BGMSetting_l.png | 72x352 | 360 | 0.0 | uncertain | 2 |
| musicPlayer_player_BGMSetting_s.png | 72x352 | 397 | 0.0 | uncertain | 1 |
| musicPlayer_player_BGMSetting_t.png | 72x352 | 400 | 0.0 | uncertain | 1 |
| musicPlayer_player_BGMSetting_u.png | 72x352 | 270 | 0.0 | uncertain | 3 |
| musicPlayer_player_Next.png | 72x142 | 126 | 0.0 | uncertain | 1 |
| musicPlayer_player_Pause.png | 72x142 | 9 | 0.0 | native_ds | 1 |
| musicPlayer_player_Play.png | 72x142 | 133 | 0.0 | uncertain | 1 |
| musicPlayer_player_Prev.png | 72x142 | 134 | 0.0 | uncertain | 1 |
| musicPlayer_player_Single.png | 72x142 | 262 | 0.0 | uncertain | 1 |
| musicPlayer_player_Single_Repeat.png | 72x142 | 408 | 0.0 | uncertain | 1 |
| musicPlayer_select_button.png | 770x314 | 298 | 24.454 | hd | 1 |
| musicPlayer_taiho_1.png | 256x256 | 1947 | 42.584 | hd | 1 |
| musicPlayer_taiho_2.png | 256x384 | 2772 | 31.829 | hd | 1 |
| musicPlayer_taiho_3.png | 256x384 | 2747 | 38.352 | hd | 1 |
| musicPlayer_taiho_4.png | 256x256 | 1640 | 30.151 | hd | 1 |
| musicPlayer_taiho_5.png | 128x128 | 143 | 7.598 | hd | 1 |
| musicPlayer_taiho_6.png | 256x256 | 1608 | 44.569 | hd | 1 |
| musicPlayer_taiho_car.png | 100x80 | 91 | 12.203 | hd | 1 |
| musicPlayer_tub.png | 784x64 | 57 | 0.542 | uncertain | 1 |
| musicPlayer_window.png | 64x64 | 4 | 73.047 | hd | 1 |

Status icons, menus and cursors other than the investigation cursor: none identified in the archive beyond the musicPlayer and gallery pieces above. The `other assets/UI` folder has no separate menu or status-icon sheet.

## 7. Audio

### 7a. Soundtrack discs (archive `game_soundtrack/`, 104 MP3, 44.1 kHz stereo)

#### Disc 1: 35 tracks, 61.5 min total, bitrate 112-225 kbps

| # | File | Duration | kbps | ID3 title | Album | Track tag | Artist | Disc tag | Tag status |
|---:|---|---:|---:|---|---|---|---|---|---|
| 01 | 01. Phoenix Wright Ace Attorney - Opening.mp3 | 0:40 | 178 | Phoenix Wright: Ace Attorney - Opening | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 01 | JTPaper | - | partial |
| 02 | 02. Defendant Lobby - So it Begins.mp3 | 1:17 | 162 | Defendant Lobby - So it Begins | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 02 | JTPaper | - | partial |
| 03 | 03. Phoenix Wright Ace Attorney - Court is Now in Session.mp3 | 1:48 | 186 | Phoenix Wright: Ace Attorney - Court is Now in Session | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 03 | JTPaper | - | partial |
| 04 | 04. Cross-Examination - Moderato 2001.mp3 | 1:44 | 199 | Cross-Examination - Moderato 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 04 | JTPaper | - | partial |
| 05 | 05. Tricks and Deductions.mp3 | 2:32 | 187 | Tricks and Deductions | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 05 | JTPaper | - | partial |
| 06 | 06. Phoenix Wright - Objection! 2001.mp3 | 1:13 | 194 | Phoenix Wright - Objection! 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 06 | JTPaper | - | partial |
| 07 | 07. Cross-Examination - Allegro 2001.mp3 | 2:06 | 203 | Cross-Examination - Allegro 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 07 | JTPaper | - | partial |
| 08 | 08. Pursuit - Corner the Culprit.mp3 | 1:36 | 191 | Pursuit - Corner the Culprit | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 08 | JTPaper | - | partial |
| 09 | 09. The Truth Revealed 2001.mp3 | 1:19 | 185 | The Truth Revealed 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 09 | JTPaper | - | partial |
| 10 | 10. Suspense.mp3 | 1:32 | 207 | Suspense | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 10 | JTPaper | - | partial |
| 11 | 11. Pursuit - Corner the Culprit (Variation).mp3 | 1:30 | 195 | Pursuit - Corner the Culprit (Variation) | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 11 | JTPaper | - | partial |
| 12 | 12. Jingle - There's No Stopping Here.mp3 | 0:05 | 112 | Jingle - There's No Stopping Here | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 12 | JTPaper | - | partial |
| 13 | 13. Initial Investigation 2001.mp3 | 1:50 | 225 | Initial Investigation 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 13 | JTPaper | - | partial |
| 14 | 14. Maya Fey - Turnabout Sisters 2001.mp3 | 2:41 | 185 | Maya Fey - Turnabout Sisters 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 14 | JTPaper | - | partial |
| 15 | 15. Detention Center - The Security Guards' Elegy.mp3 | 1:49 | 168 | Detention Center - The Security Guards' Elegy | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 15 | JTPaper | - | partial |
| 16 | 16. Dick Gumshoe - That's Detective Gumshoe, Pal!.mp3 | 2:01 | 197 | Dick Gumshoe - That's "Detective Gumshoe," Pal! | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 16 | JTPaper | - | partial |
| 17 | 17. Reminiscences - Maya's Sorrow.mp3 | 2:33 | 189 | Reminiscences - Maya's Sorrow | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 17 | JTPaper | - | partial |
| 18 | 18. Marvin Grossberg - Reckonings and Regrets of an Aged Attorney.mp3 | 1:37 | 178 | Marvin Grossberg - Reckonings and Regrets of an Aged Attorney | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 18 | JTPaper | - | partial |
| 19 | 19. Simple Folk.mp3 | 1:08 | 196 | Simple Folk | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 19 | JTPaper | - | partial |
| 20 | 20. Reminiscences - The Two Faces of a Studio.mp3 | 1:20 | 174 | Reminiscences - The Two Faces of a Studio | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 20 | JTPaper | - | partial |
| 21 | 21. The Steel Samurai Warrior of Neo Olde Tokyo.mp3 | 2:01 | 191 | The Steel Samurai: Warrior of Neo Olde Tokyo | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 21 | JTPaper | - | partial |
| 22 | 22. Reminiscences - The DL-6 Incident.mp3 | 2:04 | 186 | Reminiscences - The DL-6 Incident | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 22 | JTPaper | - | partial |
| 23 | 23. Heart of the Investigation 2001.mp3 | 1:59 | 175 | Heart of the Investigation 2001 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 23 | JTPaper | - | partial |
| 24 | 24. Reminiscences - The Class Trial.mp3 | 1:13 | 187 | Reminiscences - The Class Trial | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 24 | JTPaper | - | partial |
| 25 | 25. Victory! - Our First Win.mp3 | 1:53 | 175 | Victory! - Our First Win | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 25 | JTPaper | - | partial |
| 26 | 26. Phoenix Wright Ace Attorney - Ending.mp3 | 2:19 | 181 | Phoenix Wright: Ace Attorney - Ending | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 26 | JTPaper | - | partial |
| 27 | 27. The Ballad of Turnabout Sisters.mp3 | 1:53 | 186 | The Ballad of Turnabout Sisters | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 27 | JTPaper | - | partial |
| 28 | 28. Unused Track.mp3 | 1:42 | 196 | Unused Track | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 28 | JTPaper | - | partial |
| 29 | 29. Rise from the Ashes - Opening.mp3 | 0:36 | 132 | Rise from the Ashes - Opening | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 29 | JTPaper | - | partial |
| 30 | 30. Reminiscences - The SL-9 Incident.mp3 | 1:38 | 176 | Reminiscences - The SL-9 Incident | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 30 | JTPaper | - | partial |
| 31 | 31. Ema Skye - Turnabout Sisters 2005.mp3 | 1:49 | 181 | Ema Skye - Turnabout Sisters 2005 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 31 | JTPaper | - | partial |
| 32 | 32. The Blue Badger - I Want to Protect You.mp3 | 1:21 | 136 | The Blue Badger - I Want to Protect You | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 32 | JTPaper | - | partial |
| 33 | 33. Jake Marshall - Renegade Sheriff.mp3 | 1:44 | 177 | Jake Marshall - Renegade Sheriff | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 33 | JTPaper | - | partial |
| 34 | 34. Damon Gant - Swimming, Anyone.mp3 | 2:03 | 196 | Damon Gant - Swimming, Anyone? | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 34 | JTPaper | - | partial |
| 35 | 35. Rise from the Ashes - Ending.mp3 | 4:34 | 188 | Rise from the Ashes - Ending | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 35 | JTPaper | - | partial |

#### Disc 2: 34 tracks, 57.7 min total, bitrate 88-216 kbps

| # | File | Duration | kbps | ID3 title | Album | Track tag | Artist | Disc tag | Tag status |
|---:|---|---:|---:|---|---|---|---|---|---|
| 01 | 01. Defendant Lobby - So it Begins Again.mp3 | 1:31 | 195 | Defendant Lobby - So it Begins Again | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 01 | JTPaper | - | partial |
| 02 | 02. Justice for All - Court is Now in Session.mp3 | 1:48 | 202 | Justice for All - Court is Now in Session | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 02 | JTPaper | - | partial |
| 03 | 03. Cross-Examination - Moderato 2002.mp3 | 1:30 | 186 | Cross-Examination - Moderato 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 03 | JTPaper | - | partial |
| 04 | 04. Magic and Tricks.mp3 | 2:00 | 196 | Magic and Tricks | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 04 | JTPaper | - | partial |
| 05 | 05. Phoenix Wright - Objection! 2002.mp3 | 1:34 | 199 | Phoenix Wright - Objection! 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 05 | JTPaper | - | partial |
| 06 | 06. Cross-Examination - Allegro 2002.mp3 | 1:41 | 203 | Cross-Examination - Allegro 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 06 | JTPaper | - | partial |
| 07 | 07. Pursuit - Confront the Culprit.mp3 | 1:22 | 204 | Pursuit - Confront the Culprit | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 07 | JTPaper | - | partial |
| 08 | 08. The Truth Revealed 2002.mp3 | 1:38 | 193 | The Truth Revealed 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 08 | JTPaper | - | partial |
| 09 | 09. Ringtone (Phoenix Wright).mp3 | 1:50 | 88 | Ringtone (Phoenix Wright) | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 09 | JTPaper | - | partial |
| 10 | 10. Pursuit - Confront the Culprit (Variation).mp3 | 1:16 | 204 | Pursuit - Confront the Culprit (Variation) | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 10 | JTPaper | - | partial |
| 11 | 11. Jingle - There's No Sleeping Tonight.mp3 | 0:05 | 157 | Jingle - There's No Sleeping Tonight | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 11 | JTPaper | - | partial |
| 12 | 12. Psyche-Locks.mp3 | 1:45 | 185 | Psyche-Locks | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 12 | JTPaper | - | partial |
| 13 | 13. Initial Investigation 2002.mp3 | 1:29 | 193 | Initial Investigation 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 13 | JTPaper | - | partial |
| 14 | 14. Maya Fey - Turnabout Sisters 2002.mp3 | 1:53 | 200 | Maya Fey - Turnabout Sisters 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 14 | JTPaper | - | partial |
| 15 | 15. Detention Center - The Security Camera's Elegy.mp3 | 2:10 | 147 | Detention Center - The Security Camera's Elegy | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 15 | JTPaper | - | partial |
| 16 | 16. Kurain Village.mp3 | 1:46 | 179 | Kurain Village | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 16 | JTPaper | - | partial |
| 17 | 17. Reminiscences - Fire-Licked Scars.mp3 | 2:29 | 197 | Reminiscences - Fire-Licked Scars | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 17 | JTPaper | - | partial |
| 18 | 18. Eccentrics.mp3 | 1:42 | 188 | Eccentrics | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 18 | JTPaper | - | partial |
| 19 | 19. Fabulous!.mp3 | 0:15 | 178 | Fabulous! | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 19 | JTPaper | - | partial |
| 20 | 20. Berry Big Circus.mp3 | 1:32 | 195 | Berry Big Circus | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 20 | JTPaper | - | partial |
| 21 | 21. More Simple Folk.mp3 | 1:19 | 198 | More Simple Folk | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 21 | JTPaper | - | partial |
| 22 | 22. Reminiscences - Pure Pain.mp3 | 2:29 | 196 | Reminiscences - Pure Pain | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 22 | JTPaper | - | partial |
| 23 | 23. Shelly de Killer - A Deadly Gentleman's Delight.mp3 | 1:31 | 180 | Shelly de Killer - A Deadly Gentleman's Delight | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 23 | JTPaper | - | partial |
| 24 | 24. Pearl Fey - With Pearly.mp3 | 1:10 | 211 | Pearl Fey - With Pearly | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 24 | JTPaper | - | partial |
| 25 | 25. Further Investigation 2002.mp3 | 1:45 | 187 | Further Investigation 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 25 | JTPaper | - | partial |
| 26 | 26. Triumphant Return - Miles Edgeworth.mp3 | 1:29 | 189 | Triumphant Return - Miles Edgeworth | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 26 | JTPaper | - | partial |
| 27 | 27. Hotline of Fate.mp3 | 0:51 | 216 | Hotline of Fate | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 27 | JTPaper | - | partial |
| 28 | 28. Heart of the Investigation 2002.mp3 | 1:52 | 203 | Heart of the Investigation 2002 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 28 | JTPaper | - | partial |
| 29 | 29. Reminiscences - Ballad of The Steel Samurai.mp3 | 2:13 | 184 | Reminiscences - Ballad of The Steel Samurai | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 29 | JTPaper | - | partial |
| 30 | 30. Triumphant Return - Franziska von Karma.mp3 | 1:26 | 190 | Triumphant Return - Franziska von Karma | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 30 | JTPaper | - | partial |
| 31 | 31. Victory! - Another Win.mp3 | 2:04 | 196 | Victory! - Another Win | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 31 | JTPaper | - | partial |
| 32 | 32. Justice for All - Ending.mp3 | 5:18 | 196 | Justice for All - Ending | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 32 | JTPaper | - | partial |
| 33 | 33. One Prosecutor's Musings - Until We Meet Again.mp3 | 0:58 | 175 | One Prosecutor's Musings - Until We Meet Again | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 33 | JTPaper | - | partial |
| 34 | 34. BONUS - Prosecutor's Path ~ Miles and Fran.flac.mp3 | 1:46 | 180 | BONUS - Prosecutor's Path ~ Miles and Fran.flac | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 34 | JTPaper | - | partial |

#### Disc 3: 35 tracks, 72.6 min total, bitrate 142-211 kbps

| # | File | Duration | kbps | ID3 title | Album | Track tag | Artist | Disc tag | Tag status |
|---:|---|---:|---:|---|---|---|---|---|---|
| 01 | 01. Trials and Tribulations - Opening.mp3 | 1:18 | 164 | Trials and Tribulations - Opening | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 01 | JTPaper | - | partial |
| 02 | 02. Defendant Lobby - So it Will Always Begin.mp3 | 1:39 | 181 | Defendant Lobby - So it Will Always Begin | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 02 | JTPaper | - | partial |
| 03 | 03. Trials and Tribulations - Court is Now in Session.mp3 | 2:30 | 199 | Trials and Tribulations - Court is Now in Session | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 03 | JTPaper | - | partial |
| 04 | 04. Cross-Examination - Moderato 2004.mp3 | 3:28 | 196 | Cross-Examination - Moderato 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 04 | JTPaper | - | partial |
| 05 | 05. Phoenix Wright - Objection! 2004.mp3 | 1:59 | 204 | Phoenix Wright - Objection! 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 05 | JTPaper | - | partial |
| 06 | 06. Cross-Examination - Allegro 2004.mp3 | 2:45 | 195 | Cross-Examination - Allegro 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 06 | JTPaper | - | partial |
| 07 | 07. Pursuit - Catch the Culprit.mp3 | 2:01 | 201 | Pursuit - Catch the Culprit | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 07 | JTPaper | - | partial |
| 08 | 08. The Truth Revealed 2004.mp3 | 2:09 | 194 | The Truth Revealed 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 08 | JTPaper | - | partial |
| 09 | 09. Pursuit - Catch the Culprit (Variation).mp3 | 1:49 | 205 | Pursuit - Catch the Culprit (Variation) | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 09 | JTPaper | - | partial |
| 10 | 10. Dahlia Hawthorne - The Visage of What Once Was.mp3 | 2:19 | 181 | Dahlia Hawthorne - The Visage of What Once Was | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 10 | JTPaper | - | partial |
| 11 | 11. Godot - The Fragrance of Darkness; That is Coffee.mp3 | 2:30 | 176 | Godot - The Fragrance of Darkness; That is Coffee | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 11 | JTPaper | - | partial |
| 12 | 12. Jingle - There's No Going Back.mp3 | 0:05 | 142 | Jingle - There's No Going Back | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 12 | JTPaper | - | partial |
| 13 | 13. Initial Investigation 2004.mp3 | 2:03 | 195 | Initial Investigation 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 13 | JTPaper | - | partial |
| 14 | 14. The Stolen Turnabout.mp3 | 1:28 | 199 | "The Stolen Turnabout" | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 14 | JTPaper | - | partial |
| 15 | 15. Lordly Tailor.mp3 | 2:20 | 191 | Lordly Tailor | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 15 | JTPaper | - | partial |
| 16 | 16. Detention Center - The Prisoner's Elegy.mp3 | 2:14 | 142 | Detention Center - The Prisoner's Elegy | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 16 | JTPaper | - | partial |
| 17 | 17. Mask☆DeMasque - Please Listen to Meeeee!.mp3 | 1:42 | 189 | Mask☆DeMasque - Please Listen to Meeeee! | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 17 | JTPaper | - | partial |
| 18 | 18. Luke Atmey - Look at Me.mp3 | 1:48 | 199 | Luke Atmey - Look at Me | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 18 | JTPaper | - | partial |
| 19 | 19. Larry Butz - When Something Smells, It's Usually Me.mp3 | 1:57 | 191 | Larry Butz - When Something Smells, It's Usually Me | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 19 | JTPaper | - | partial |
| 20 | 20. Recipe for Turnabout.mp3 | 0:40 | 191 | "Recipe for Turnabout" | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 20 | JTPaper | - | partial |
| 21 | 21. Trés Bien.mp3 | 1:45 | 193 | Trés Bien | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 21 | JTPaper | - | partial |
| 22 | 22. Victor Kudo - Martial Anthem of Misery.mp3 | 1:40 | 185 | Victor Kudo - Martial Anthem of Misery | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 22 | JTPaper | - | partial |
| 23 | 23. Furio Tigre - Swingin' Tiger.mp3 | 1:47 | 211 | Furio Tigre - Swingin' Tiger | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 23 | JTPaper | - | partial |
| 24 | 24. Reminiscences - Violetta Vitriol.mp3 | 2:46 | 193 | Reminiscences - Violetta Vitriol | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 24 | JTPaper | - | partial |
| 25 | 25. Turnabout Beginnings.mp3 | 0:51 | 182 | "Turnabout Beginnings" | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 25 | JTPaper | - | partial |
| 26 | 26. Reminiscences - The View from Dusky Bridge.mp3 | 3:53 | 172 | Reminiscences - The View from Dusky Bridge | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 26 | JTPaper | - | partial |
| 27 | 27. Bridge to the Turnabout.mp3 | 0:18 | 149 | "Bridge to the Turnabout" | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 27 | JTPaper | - | partial |
| 28 | 28. Hazakura Temple.mp3 | 2:58 | 178 | Hazakura Temple | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 28 | JTPaper | - | partial |
| 29 | 29. Elise Deauxnim - A Gentle Melody.mp3 | 2:40 | 184 | Elise Deauxnim - A Gentle Melody | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 29 | JTPaper | - | partial |
| 30 | 30. Further Investigation 2004.mp3 | 2:10 | 195 | Further Investigation 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 30 | JTPaper | - | partial |
| 31 | 31. Reminiscences - The Bitterness of Truth.mp3 | 2:37 | 201 | Reminiscences - The Bitterness of Truth | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 31 | JTPaper | - | partial |
| 32 | 32. Pursuit - Corner the Culprit 2004.mp3 | 1:34 | 202 | Pursuit - Corner the Culprit 2004 | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 32 | JTPaper | - | partial |
| 33 | 33. Pursuit - Corner the Culprit 2004 (Variation).mp3 | 1:56 | 164 | Pursuit - Corner the Culprit 2004 (Variation) | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 33 | JTPaper | - | partial |
| 34 | 34. Victory! - An Eternal Win.mp3 | 2:41 | 195 | Victory! - An Eternal Win | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 34 | JTPaper | - | partial |
| 35 | 35. Trials and Tribulations - Ending.mp3 | 3:57 | 185 | Trials and Tribulations - Ending | Phoenix Wright: Ace Attorney Trilogy Original Soundtrack Remastered | 35 | JTPaper | - | partial |

Totals: 104 tracks, 3.20 hours (191.7 min). Every archive track has a title, album, track number and artist, but no disc number tag (so `tag_status` is `partial`).

Duplicates: the soundtrack zip holds the same 104 MP3s as Discs 1-3, byte-identical (104 SHA-256 groups). The zip is not an extra set of tracks.

### 7b. Repo audio (already in the repo; for reference)

- `docs/original_tracks/` (38 MP3, 44.1 kHz, 116-250 kbps, full ID3). These are 34 distinct tracks (the Disc 1 set): four track titles appear twice under two filename spellings (`_` vs `-`, e.g. `01. Phoenix Wright- Ace...` and `01. Phoenix Wright_ Ace...`). They are not byte-identical to the archive discs. 34 of the 104 archive tracks match one of them by ID3 title; the duration differs by at most 1.17 s (median 0.43 s).
- `docs/references/music/pwaa-original-soundtrack.zip` (38 MP3, 66.4 min, full ID3). All 38 members are byte-identical to files in `docs/original_tracks/`.
- `docs/sfx general/`: 113 WAV + 3 MP3 ringtones. The WAVs have no ID3-style tags (they are not MP3). 32 of these hashes also appear in `frontend/public/assets/`.

### 7c. Voice clips and other audio

No voice clips are in the archive (the archive audio is only the 104 soundtrack MP3s). The SFX count is the repo's `docs/sfx general/` set: 113 WAV files plus 3 ringtone MP3s.

## 8. Other assets

| Folder | Files | Description | Class mix |
|---|---:|---|---|
| artbook/Characters | 76 | 2260x3200 (72) and 3200x3200 (4) HD RGB art, named folders per character (Franziska von Karma 4, Godot 4, Justice for All 9, Maya Fey 6, Mia Fey 8, Miles Edgeworth 5, Pearl Fey 4, Phoenix Wright 7, Phoenix Wright - Ace Attorney 15, Rise from the Ashes 6, Trials and Tribulations 8) | hd 76 |
| artbook/Illustrations | 64 | Chibi Characters 22, Justice for All 8, Phoenix Wright 13, Rise from the Ashes 6, Trials and Tribulations 15; 1920x1080 and 720x1080 backgrounds, 2588x3200 and 1704x2300 art | hd 64 |
| artbook/Misc | 23 | gallery UI (buttons, thumbnails, titles) and two 1920x1080 backgrounds | hd 21, uncertain 2 |
| courtroom | 2 | DS courtroom background strip (1697x453, 614 colours) and Mobile HD courtrooms and benches (8000x800) | uncertain 1, hd 1 |
| courtroom_stance | 2 | DS courtroom cut-outs, 256 px wide (256x474, 256x471) | native_ds 2 |
| effects | 1 | DS action lines, 716x238, 12 colours | uncertain 1 |
| gavel | 1 | DS gavel slam scene strip, 1831x238 | uncertain 1 |
| logos | 1 | 3DS HOME menu icons and banners (520x656) | hd 1 |
| phrases_en_jap | 1 | 3DS exclamations (1000x486) | hd 1 |
| profiles | 1 | GBA character profile portrait sheet (530x272, unlabelled faces) | uncertain 1 |
| evidences | 3 PNG + 1 zip | 491690.png (960x1280, 4096 colours, 13.5% semi-alpha, numeric name); DS JFA evidence (995x569, 2182 colours, 0% semi-alpha); GBA evidence (860x340, 327 colours); Mobile HD Court Record evidence zip (223 PNG icons, see 8a) | hd 2, uncertain 1 |
| police_extract | 1 | GBA Trials and Tribulations font atlas (128x3072, 2 colours) |  |
| characters/loading.png | 1 | 244x258 palette image, content not identified | native_ds 1 |

### 8a. Evidence zip (Mobile HD Court Record evidence)

The zip has 223 PNGs plus 224 `__MACOSX` / `._` resource-fork entries (skipped). The PNGs are numbered item icons: `0_it004.png` to `0_it11a.png` (with `1_*` and `2_*` duplicates), `0_ita009` to `ita004`-style names, and `@rs15`, `@rs18`, `@rs19`. Sizes: most are 192x192 palette PNGs; others are 64x64, 96x96, 128x64, 128x192, 224x192, 384x224 and similar. A contact sheet is at `scratchpad/inventory/previews/evidence_zip_icons_contact_sheet.png`. The icons look like evidence objects (phones, letters, keys, a camera, a gun). None of the filenames carry a name.

Size counts: 192x192 x214, 64x64 x1, 384x224 x1, 128x64 x1, 224x192 x1, 128x192 x1, 96x96 x1, 164x72 x1, 60x96 x1, 48x28 x1.

## 9. Duplicate summary

- Records hashed: 1477 (archive top-level 538, archive zip members 327, repo 574, repo zip members 38).
- Unique SHA-256 values: 1166. Duplicate groups: 269 covering 580 files. Surplus copies: 311. **Overall duplicate rate: 21.1% of all records.**
- Inside the archive (top-level plus zip members, 865 records): 119 duplicate groups, 123 surplus copies, **archive duplicate rate 14.2%**. Of these, 104 groups are the soundtrack zip duplicating the disc MP3s, and 15 are small internal duplicates (e.g. `UI/musicPlayer_player_All_Repeat*` variants, `locations HD` bg507/bg507u, the evidence zip `0_it009.png` = `1_it009.png`).
- Archive files byte-identical to any file in the repo (`frontend/public/assets/`, `docs/references/`, `docs/original_tracks/`, `docs/sfx general/`): **0**. The archive is new by bytes.
- Repo duplicates for reference: 150 repo-internal groups (for example `frontend/public/assets/` audio that also sits in `docs/sfx general/`: 32 groups).
- Same-content, different-encode pairs (not byte-identical, so not counted above): 34 archive Disc 1 tracks vs the `docs/original_tracks/` set, matched by ID3 title. Durations differ by at most 1.17 s; bitrates differ (archive 88-225 kbps, repo 116-250 kbps). Both are 44.1 kHz.

## 10. Files used by this inventory

- `scratchpad/inventory/inventory.json` (all records: per-file path, size, SHA-256, format, image metrics, classification with evidence, audio tags, duplicate group size)
- `scratchpad/inventory/inventory.csv` (the same, flat)
- `scratchpad/inventory/build_inventory.py`, `subsprites.py`, `analyze*.py`, `make_docs.py` (scripts)
- Previews: `scratchpad/inventory/previews/` (cursor, evidence frame, DS and HD character samples, DS courtroom stance, DS locations tile sheet, evidence zip contact sheet, GBA profile sheet, repo native Maya frame)

