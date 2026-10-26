# Japanese Reading Assistant

## Offline names and definitions (26 October 2026)

The existing switch now enables readings **and** offline dictionary lookups. A small
definition-language selector offers Français (default) or English, persisted with the
existing settings. English UI explicitly prefers English; no machine translation occurs.
Definitions are requested only when a fully revealed word's popup opens. Missing entries
show readings alone; asset failures display a short status without disabling readings.

### Proper names

`src/data/japaneseProperNames.json` contains canonical surface, hiragana reading, English
display name, entity type, verification source, and optional alternative forms. It covers
the eight playable characters plus Phoenix Wright, Larry Butz and Godot, including the
short forms 成歩堂 and 御剣. Iris is **あやめ**, not a transliteration of “Iris”.
Sources are recorded per entry: stage/anime materials where available, with secondary
verification explicitly recorded for Pearl and English localization equivalences.

`properNames.ts` applies longest-match precedence over Kuromoji spans. Original UTF-16
offsets and grapheme boundaries remain intact across inserted line breaks. Honorifics
and configured occupational titles remain separate. Conservative token/compound boundaries
avoid replacing unrelated substrings; ambiguous kana-only names require isolation or an
honorific, so ordinary あやめの花 is not relabelled as a character. This may intentionally
miss a name in an unusual compound. Extend the JSON, not React character branches.

### JMdict data and licences

Input is the **full multilingual** official JMdict, snapshot **2026-10-26**, downloaded
on that date from `https://www.edrdg.org/pub/Nihongo/JMdict.gz`.
SHA-256: `9933853c7c5d66764b06553c2330f24bdabce9c3e0aff8edf769d8aafcb6d5d1`.
All **218,963 entries** retain English. **14,627 entries** also retain verified French.
This is complete English vocabulary coverage of this snapshot, not complete French coverage.
Other languages and example sentences are omitted.

EDRDG's licence expressly excludes non-English contributors' separate copyright.
Consequently French glosses are intersected by **entry ID and exact translation** with
the JMdict internationalization project's CC BY-SA 3.0 French data, pinned at commit
`97c1e221b512ef3874f89580995a733ed129a44f`, `jmdict/jmf/fr.jmf`.
SHA-256: `e27734682bd02e8b771c4899a3ff2a5f22f37409f93b85a8e6f6bd9b995d6e9e`.
If upstream merely appends a parenthetical usage note to a verified translation, the
licensed original translation is emitted (e.g. `preuve`, not `preuve (jur.)`).
Unverified older FJ glosses are excluded. French translation contributors are attributed
alongside EDRDG; the adapted dataset is CC BY-SA 4.0, a compatible later version.

Settings and every vocabulary popup link to the offline `assets/jmdict/NOTICE.html`.
The distribution includes EDRDG's statement, CC BY-SA 4.0 and 3.0 legal texts and the
French project's own licence statement. These apply to dictionary data, not application
code. The source URLs, snapshot, checksums, counts and per-shard hashes are recorded in
`manifest.json`. Upstream contributors do not endorse this application.

### Reproduce or refresh

Download the two explicitly selected sources to an ignored directory such as
`build/jmdict-source/`; never put source archives in root `assets/` or the runtime.
The original multilingual archive is about 22.2 MB. Use HTTPS with certificate validation;
the FTP host had a certificate mismatch during this run, so the official main host was used.
Run from the repository root (standard-library Python only):

```powershell
.\backend\.venv\Scripts\python.exe scripts/build_jmdict.py `
  --input build/jmdict-source/JMdict.gz `
  --sha256 9933853c7c5d66764b06553c2330f24bdabce9c3e0aff8edf769d8aafcb6d5d1 `
  --french build/jmdict-source/fr.jmf `
  --french-sha256 e27734682bd02e8b771c4899a3ff2a5f22f37409f93b85a8e6f6bd9b995d6e9e `
  --downloaded-on 2026-10-26
```

The script verifies both input hashes, limits decompressed input, rejects external/nested
XML entities and parses only the expected internal JMdict tags. It preserves lexical IDs,
spellings/readings and their restrictions, priority/usage tags, inherited POS and sense
restrictions. Output is deterministic JSON plus gzip with a fixed timestamp. Runtime output
is constrained to `frontend/public/assets/jmdict/`. No network runs during npm build.
For updates, download a new official snapshot, review/pin its checksum/date and French
source revision, rerun preprocessing and the dictionary tests. Refresh before releases;
hosted builds should refresh at least monthly per EDRDG's published update guidance.

### Loading, lookup and packaging

The 256 FNV-1a shards total **30,511,121 compressed bytes** (108,795,452 expanded bytes,
including entries repeated under alternate written/reading keys). Browser lookup loads
one shard for an exact headword, not the whole expanded dataset. The existing worker
performs fetch, SHA-256 verification, gzip decompression, JSON parsing and sense filtering.
At most 16 shard promises and 64 recent lookup promises are cached; failures are evicted.
The manifest is shared lazily. OFF startup loads neither tokenizer nor definition data.

`japaneseDictionary.ts` matches base/surface, exact kana reading, POS, reading-to-spelling
restrictions and sense restrictions. Inflected forms use Kuromoji's actual base-form
reading; if it cannot be obtained, no meaning is guessed. Proper names bypass JMdict.
French is preferred when compatible French senses exist; otherwise English is used.
Up to three candidate senses (three glosses each) are shown, explicitly labelled as
possible meanings. Additional senses remain counted; this is not contextual disambiguation.

Assets use `<Vite BASE_URL>assets/jmdict/`. The `.json.gz.bin` extension intentionally
avoids automatic HTTP gzip decoding; the worker performs exactly one decompression.
Vite copies the entire public directory into dist and the existing Windows packaging
copies dist unchanged. No global package, backend, API, CDN or LLM is involved.
The Windows executable itself is not rebuilt by this milestone.

### Enhancement verification

**396 frontend tests passed, zero failed**; TypeScript, lint, production build,
asset validation (1,074 referenced files) and whitespace checks passed. New tests verify
all 256 shard checksums, real FR/EN glosses, reading/sense restrictions, homographs,
inflections, invalid/missing assets, retry/cache behavior and actual Kuromoji name spans.

Actual Iris conversation QA used `この証拠を調べてください。`,
`今日の裁判は大変でしたね。`, `「異議あり！」` and
`御剣検事は事件を調査しています。`. Additional worker checks used
`成歩堂さんは証拠を調べています。` and `この事件を調べました。`.
Hover/click, keyboard/Escape, reveal gating, punctuation, unchanged page text, ON/OFF
and English bypass passed. Screenshots at 1x, 3x and auto show readable in-bounds
popups, including `証拠 / しょうこ / preuve` and `御剣 / みつるぎ / Miles Edgeworth`.
There were no application runtime exceptions. Mobile hardware was not tested.

Local observations: cold tokenizer setup **2.89 s**, largest observed animation frame
gap **12.3 ms**; uncached definition lookups **23–82 ms**, cached lookups **0–1 ms**.
The non-root `/reading-test/` production check measured the first definition at **41 ms**,
repeated lookup below **1 ms**, and byte-identical production dictionary assets.
Blocking a JMdict shard caused definition failure while fresh reading analysis continued;
unblocking allowed a successful retry. Worker heap usage was not separately measured.
All QA-owned Vite/Chrome processes were stopped; no backend server was started.

## Use

Settings → **Japanese Reading Assistant** (日本語の読み方サポート). Default OFF; persisted by the existing settings store, including its provider-migration path. Labels and failure messages cover EN/FR/JA/IT/ES. The assistant activates only when the selected dialogue/interface language is Japanese and the page contains kanji. Japanese quotations inside an English/French answer do not activate it.

Hover a fully revealed kanji word for 220ms, or click/tap it, to see the original word and its hiragana reading. Tab focuses eligible words; Enter/Space pins a popup and Escape closes it. Hover popups dismiss after a 180ms exit grace period so the pointer can enter the popup. Clicked popups stay until closed, another word is selected, or the user clicks elsewhere. Word clicks/activation do not also advance dialogue; ordinary scene clicks keep their original behavior. Turning the feature off or leaving Japanese removes the interactive renderer/popups immediately.

## Architecture and alignment

- `DialogueBox` selects `JapaneseReadingText` only when the preference and Japanese locale are active. OFF retains the original `TypewriterText` path.
- Analysis is per **complete paginated page**, never per reveal frame. Paginator-inserted newlines are removed for morphology, then an explicit UTF-16 position map restores their original locations. A compound such as `証\n拠` can still be recognized as 証拠.
- Kuromoji's `word_position` is not treated as a JavaScript string offset. Ordered surface matching against the analysis text provides offsets; original whitespace, punctuation, supplementary characters and line breaks remain in the rendered text. Misalignment fails safely to ordinary dialogue.
- Only known words containing Han characters and a usable reading become targets. Grapheme-boundary checks prevent token spans from splitting a combining/variation sequence. Gaps and unknown words remain ordinary text. No individual-kanji reading fallback is guessed.
- Text is partitioned into inline spans without replacing its content. Unrevealed portions keep `TypewriterText`'s hidden layout. A word becomes interactive only when its entire display range is visible. Analysis completion and reveal ticks cannot alter the measured page boundaries.
- Known auxiliary inflections following a kanji verb/adjective are joined using their actual readings: 調べ + まし + た → 調べました / しらべました. Base form and POS are retained internally, not presented as definitions.
- The existing typewriter timer, grapheme reveal, character animation, blips, reaction/SFX scheduling and pagination algorithm are unchanged by this feature.

Katakana readings are converted to hiragana only in the popup. Conversion preserves small/voiced kana, prolonged marks, punctuation and mixed text; the original dialogue is never rewritten.

## Initialization and performance

Reuses the installed `kuromoji@0.1.2` and `@types/kuromoji@0.1.3`; no dependency installation or alternative tokenizer was required.

`japaneseTokenizer.ts` creates one lazy module worker. The worker initializes one shared Kuromoji tokenizer and handles all subsequent requests. Request IDs isolate asynchronous responses, and abandoned components ignore late results. `createReadingAnalyzer()` deduplicates concurrent analysis and caches up to 64 pages. Disabling does not discard an already loaded dictionary; its idle worker can be reused for the next Japanese conversation. OFF at startup creates no worker and requests no dictionaries.

The worker was introduced after a measured main-thread initialization stalled animation for about **582ms**. The follow-up worker trace showed a largest measured frame gap of about **6ms** during first initialization on this machine (not a hardware-independent guarantee). Dictionary loading can still take a few seconds, during which normal dialogue remains visible and animated.

Network/initialization/worker errors and a 30-second timeout return a localized, noninteractive status message; normal dialogue continues. Failed workers terminate and failed cache entries are removed. Turning OFF/ON retries on demand. Corrupt dictionary data cannot crash ConversationScreen.

## Assets, Vite and Windows

`scripts/kuromojiAssets.ts` serves an allowlist of dictionary files during development and emits them during every production build:

`<Vite BASE_URL>assets/kuromoji/{base,check,cc,tid,tid_pos,tid_map,unk,unk_pos,unk_map,unk_char,unk_compat,unk_invoke}.dat.gz`

The 12 gzip files total **17,791,956 bytes**. All are needed by the installed dictionary. They remain sourced from the pinned npm package; no root `assets/` source files, CDN, global packages, developer-home paths or arbitrary node_modules routes are used. The production worker and client wrapper are separate hashed assets and remain lazy.

Kuromoji's browser loader performs its own gzip decompression. Serve these files as raw gzip bytes **without `Content-Encoding: gzip`**. Vite preview otherwise labels `.gz` files as HTTP-compressed content; the plugin's preview handler deliberately serves the emitted dictionary files raw. Other HTTP hosts must honor the same contract. The non-root `/reading-test/` production smoke test verifies a working worker, 12 local requests, real readings and byte-identical emitted dictionaries.

`scripts/build_windows.py` builds and copies the entire frontend `dist` into the standalone staging directory, so the dictionary, worker and notices are included automatically. The existing Starlette static-file path was checked: HTTP 200, no Content-Encoding, original gzip magic bytes retained. **A Windows executable was not rebuilt or launched; packaged-executable QA remains unverified.**

## Popup layout

The compact popup is portalled into the existing `.scene-stage`, outside the clipped dialogue text. Its surface/reading use the native Japanese font, 144 logical px width, bounded height and stage colors. Pointer coordinates are converted through the stage scale; placement is rounded to whole logical pixels and clamped inside 256x192. Words remain inline, so their highlights do not add padding, border width or wrapping changes. Checked in the actual conversation renderer at 1x, 3x and auto.

## Accuracy and definitions

Verified dictionary examples: 証拠 → しょうこ; 今日 → きょう; 調べました → しらべました. Morphology is contextual but not infallible. Names outside the override list, fictional places, homographs, rare compounds and page-edge context can produce wrong readings or segmentation. The data-driven override layer described above corrects listed names without React rules.

Definitions now come from the offline JMdict assets described above. Kuromoji/IPADIC supplies morphology, not definitions. POS labels are not shown as translations, and no definitions are invented.

## Licenses

The asset plugin copies the installed package's **`LICENSE-2.0.txt`** (Kuromoji, Apache 2.0) and **`NOTICE.md`** into `dist/assets/kuromoji/`. NOTICE includes the `mecab-ipadic-2.7.0-20070801` NAIST/ICOT copyright, redistribution conditions and warranty notices. Both are emitted unchanged and must accompany redistribution. These dictionary terms are distinct from Kuromoji's code license. JMdict has the additional notices described above; no font binary was added.

## Verification and change inventory

`tests/japaneseReading.test.ts` covers conversion, opt-in/locale gating, persistence/migration, concurrent initialization/cache/retry, popup bounds, Vite allowlisting/raw gzip/emitted notices, and real installed-dictionary analysis. The real integration case includes mixed Court Record text, Japanese punctuation, supplementary characters, a compound across a layout newline, conjugation and missing/unknown readings.

Browser QA used the actual Iris ConversationScreen with controlled local developer dialogue (no LLM/backend request): the four supplied sample sentences, hover/click, keyboard/Escape, partial-word reveal, unchanged page text, click-to-advance, ON/OFF, saved preference after reload, English bypass and dictionary failure. The tokenizer made 12 initial dictionary requests and none on subsequent tested pages. There were zero application runtime exceptions. Mobile hardware was not separately tested; touch uses the same click/tap activation path.

Final validation: **396 frontend tests passed, 0 failed**; TypeScript, lint, production build and `git diff --check` passed. Existing asset validation: **1074 references, 0 errors**; dictionary tests additionally verify the generated JMdict assets. Backend code was unaffected; no backend suite was required. The exact settings-storage expectation includes the reading preferences without weakening credential/migration assertions.

Ignored QA evidence lives in `build/reading-qa/`: `browser-report.json`, `production-report.json`, popup screenshots and the dictionary-failure screenshot. Each runner checks port availability, owns its isolated browser profile, and terminates its own server/browser trees in finally. No FastAPI server was started.

Added: this document; `scripts/kuromojiAssets.ts`; `src/reading/{japaneseReading,japaneseTokenizer,japaneseTokenizer.worker}.ts`, `kuromoji-browser.d.ts`, `JapaneseReadingText.tsx`, `reading.css`; `tests/japaneseReading.test.ts`.

Modified: `vite.config.ts`, `components/DialogueBox.tsx`, `settings/settings.ts`, `screens/SettingsScreen.tsx`, `i18n/strings.ts`, and the settings-persistence expectation in `tests/providerProfiles.test.ts`. The installed dependency changes in package.json/package-lock.json predate this task and were preserved. Existing Lore Builder, typography, backend, character packs and source archive work remains untouched. Nothing was staged, committed or pushed.
