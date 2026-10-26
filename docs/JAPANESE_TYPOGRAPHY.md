# Japanese typography

## Runtime contract

Japanese (`html lang="ja"`, set by SettingsProvider) uses **DotGothic16 JP at native 16px** for kana, kanji, punctuation and Latin together. This browser family aliases the existing, unchanged DotGothic16 TTF; no duplicate binary or modified font is shipped. Other locales retain Igiari at 16px with their existing 75%-adjusted DotGothic16 fallback.

`ui/ui.json` declares both profiles. `loadUi()` finishes loading the bundled faces before App applies `stageFontProperties()` and shows the catalog. CSS selects the Japanese profile through `:root:lang(ja)`. Switching language needs no further font download or per-character font rule.

| Context | Rendering / measurement |
|---|---|
| Dialogue | DOM TypewriterText, explicit measured page line breaks; offscreen canvas measures the same computed CSS font stack |
| Menus, character names, settings, Court Record, evidence/file-ready overlays | DOM inside PixelStage, inheriting `--stage-font`; existing semantic sizes retained |
| Conversation Record detail | DOM with 8 rows; 16px rows/128px body for Japanese, existing 15px rows/120px body for other locales; JS scroll snapping uses the same locale grid |
| Generated-file content | DOM `pre`, intentionally compact monospace with the bundled Japanese family before generic monospace fallback |
| Developer panels / external controls | DOM, existing system/monospace styles; these are tooling text, not a bitmap stage renderer |

There is no runtime sprite-glyph font renderer. Backgrounds, sprites and image-based exclamation bubbles remain images and are unaffected.

## Fonts and fallbacks

| File under `frontend/public/assets/ui/fonts/` | Inspected coverage | Use and license |
|---|---|---|
| `Igiari.woff2` | 859 mapped code points; Latin/accented Latin, kana and punctuation; no kanji | Existing non-Japanese primary, Japanese secondary for missing symbols; Caveras / Cliff Modes, CC BY-NC-SA 3.0 |
| `DotGothic16-Regular.ttf` | 8,231 mapped code points, including 6,714 in the main CJK block; kana, full-width forms, numerals, accented Latin | Japanese primary at 16px; legacy fallback at effective 12px outside Japanese; SIL OFL 1.1 |

Japanese stack: `DotGothic16 JP → Igiari → Yu Gothic / YuGothic / Meiryo / Noto Sans JP / Noto Sans CJK JP → Verdana / Segoe UI / system-ui / sans-serif`. Common Japanese fixtures are verified against the actual bundled TTF cmap, so their coverage does not depend on a Windows font installation. FontFace loading is supported by the modern browsers targeted by Vite; browser QA used Chrome.

Rare characters absent from both bundled fonts use the explicit system fallback. Arbitrary Unicode coverage is not promised: U+FA11 (﨑), supplementary ideographs such as 𠮷, emoji and ideographic variation sequences may depend on installed fonts and may lose a requested glyph variant. They remain intact text; no substitutions or guessed glyph mappings are performed. Japanese content displayed while another interface language is selected keeps that locale's established font stack.

Both binaries are unchanged. SHA-256:

- Igiari: `02c1effcd76f86721ee266e51becf006950b199edde61bde1a6c703a8edb92c3`.
- DotGothic16: `155da8f318553c11d9dffc2affbc7c2114c6a46f9740bcf639ed5568af92be71`.

The runtime folder now includes `OFL-DotGothic16.txt` and `LICENSE-Igiari.txt`. DotGothic16 permits embedding/redistribution under OFL conditions; retain its notice/license. The existing Igiari license has noncommercial/share-alike restrictions and is not relicensed by this change. Review that restriction before commercial distribution. No new font binary was downloaded.

Primary provenance: [Fontworks repository](https://github.com/fontworks-fonts/DotGothic16), [upstream OFL](https://github.com/fontworks-fonts/DotGothic16/blob/master/OFL.txt), and the original local Igiari distribution in `docs/references/igiari/`.

## Layout, Unicode and reveal

- All geometry stays in the 256x192 logical stage. Dialogue keeps three lines and the existing 241/241/233px usable widths (including safety/continue-arrow reserve).
- Japanese uses a 16px row, 49px text interior, 51px bordered box and bottom-anchored 64px dialogue assembly. Other locales retain the original 15px row/46px interior/48px box/61px assembly. The Japanese nameplate accommodates the native face.
- Native full-width advances are 16px and ASCII advances are normally 8px in DotGothic16. Production measurement uses actual canvas font metrics, not a Unicode-width heuristic. Canvas and dialogue disable kerning; dialogue disables ligatures. Measurement waits with a Japanese coverage sample, not the Font Loading API's default Latin-only sample.
- Pagination retains its sentence/clause preference, then legal CJK breaks and finally whole graphemes for oversized unbroken runs. Closing punctuation/small kana cannot normally start a line; opening brackets, including full-width `（`, cannot normally end one. This is basic kinsoku, not a complete JLREQ engine. An individual cluster wider than a pathological viewport must overflow rather than split or loop.
- ASCII layout whitespace continues to normalize as before; U+3000 ideographic spaces and no-break spaces are preserved. Dialogue uses `white-space: pre`, so the browser does not independently rewrap the visible/hidden reveal spans into a fourth line.
- `unicodeText.ts` supplies grapheme segmentation via Intl.Segmenter. Its conservative old-browser fallback retains combining marks, variation selectors, emoji modifiers, ZWJ sequences, regional-indicator flags and CRLF. It is not a complete replacement for every UAX #29 rule; current supported browsers use Intl.Segmenter.
- The reveal API still uses UTF-16 offsets, but advances only to whole-grapheme boundaries. Blip callbacks receive a complete cluster. Reply-length speed calculation counts graphemes. Existing blip throttling, audio and SFX policy are unchanged. Japanese clause punctuation pauses without requiring spaces; trailing closing quotes share the punctuation pause. Latin punctuation pacing remains unchanged.

Punctuation timing is configured in `useTypewriter.ts` by the `PUNCTUATION_TIMING` locale policy; ConversationScreen supplies the selected language. The Japanese policy does not alter pacing in other locales. Developer conversation scripts now pass through measured pagination too; subsequent pages suppress repeated reaction/SFX cues.

Pixel mode uses integer stage scales; QA covered 1x/2x/3x/4x and auto in pixel mode. The existing optional fractional fit mode can soften text, as it can all stage graphics. Compact generated-file metadata/code retains its intentionally small sizes and cannot promise native 16px pixel strokes.

## Original atlas feasibility gate

**ORIGINAL GLYPH MAPPING: NOT FOUND. Path B implemented.**

Read-only input:

`assets/police_extract/Game Boy Advance - Phoenix Wright_ Ace Attorney_ Trials and Tribulations _ Gyakuten Saiban 3 (JPN) - Miscellaneous - Font.png`

The PNG is 128x3072 RGBA, arranged in 8 columns by 192 rows of 16x16 cells (1,536 slots, 1,534 with non-background pixels). This is an image-cell count, not a verified count of encoded/unique characters. Ink widths vary inside the cells; the image alone does not establish advances or other font metrics. The filename identifies a GBA GS3 rip, not a verified Nintendo DS font. PNG metadata is empty.

The bounded local investigation checked the supplied directory, font/encoding-related archive filenames, extraction scripts and the previous targeted-correction findings. No companion cmap, .tbl, .fnt, NFTR, script decoder/index table or game font metadata was found. The visible Latin/kana/kanji sections use custom ordering; Unicode, Shift-JIS and game-specific IDs cannot be assigned from their positions. No OCR or appearance-based assignment was used. Original artwork provenance/redistribution permission is also unverified. The atlas stays outside runtime.

A future original-font migration requires an authoritative character-index map and metrics, verified against encoded source strings, plus a redistribution decision. It can then replace the Japanese profile while retaining the Unicode/pagination tests and defined missing-glyph fallback.

## Verification and maintenance

Reusable fixtures: `frontend/tests/fixtures/japaneseText.ts`. They cover the supplied hiragana/katakana/kanji samples, mixed Court Record sentence, 2026-10-26 date, full-width Latin/numerals, Japanese brackets/punctuation, ideographic spaces, decomposed dakuten/handakuten/accent, IVS, supplementary ideograph, ZWJ emoji and flags. Tests in `japaneseTypography.test.ts` also inspect real TTF coverage and locale-specific record scrolling. Existing Japanese tests retain coverage of the legacy non-Japanese fallback profile.

Chrome QA used actual GameScene/DialogueBox/TypewriterText/useTypewriter components with Maya, Iris and Edgeworth, the same kanji+mixed sample on each, and all five scales (15 combinations). Every fixture/page was rendered; the long fixture produced 10 pages. Checks found no horizontal overflow or box overflow; the live reveal returned 14 complete Unicode clusters. Before/after screenshots, native-scale captures and the actual Japanese title/menu/settings and synthetic Conversation Record detail were inspected. Runtime exception count: zero. No live LLM request was used.

Scratch evidence: ignored `build/typography-qa/`, including `browser-report.json`, `before-mixed-stack-3x.png`, `character-{0,1,2}-{1,3,4}x.png`, `japanese-main-menu.png`, `japanese-settings.png`, `japanese-record-detail.png`. Temporary frontend QA entry files were removed. The QA runner tracks its own process trees and stops Vite/Chrome in finally; ports 5327/9267 were verified closed.

Final checks: frontend **374 passed, 0 failed**; TypeScript, lint, production build and diff whitespace check passed; asset validation **1074 referenced files, 0 errors**. Backend contracts were unaffected, so backend tests were not rerun.

Typography change set: `frontend/public/assets/ui/ui.json`; the two runtime font license notices; `src/App.tsx`, `App.css`, `index.css`; `components/{DialogueBox,TypewriterText}.tsx`; `engine/{fontMetrics,dialogueLayout,performance,useTypewriter,unicodeText}.ts`; `screens/ConversationScreen.tsx`; the three Conversation Record files; generated-file Court Record CSS; Japanese fixture/tests; this document. Pre-existing Lore Builder, personality, backend and shared documentation changes were left untouched.

Integration: these changes coexist uncommitted on `feat/character-lore-builder` in the original checkout. No branch/worktree/staging/commit/push operation was performed. Review the typography frontend diff and this document separately from the pre-existing backend/lore/personality/shared-doc changes. When ready, the owner can select these paths into a typography commit and integrate the branch through their normal review process; do not discard or bulk-stage the Lore Builder work.
