# Character Lore Builder

Turns reference documents into source-grounded character knowledge. Decisions: D-099 (lore
architecture), D-100 (PDF import and OCR), D-101 (analysis proposals), D-102 (approved overlay).
Status: Phases A-E done (B validated with real Tesseract; E verified in the browser with a scripted
model); F (real-model QA) not started. D-103 covers the Character Studio UI.

## Pack files and responsibilities

| File | Required | Holds |
|---|---|---|
| `character.json` | yes | identity metadata, animations, emotions, presentation, assets |
| `performance.json` | for "ready" | Director tuning, gestures, intensity, semantic SFX, event lines |
| `personality.md` | for "ready" | how the character behaves, speaks, disagrees; anti-caricature rules |
| `lore.md` | no | what the character canonically knows, from a narrative reference point |
| `speech_examples.md` | no | short original tone illustrations (never canon quotes) |

`lore.md` and `speech_examples.md` never change readiness. Missing or unreadable files only add a
warning.

### lore.md conventions
- First paragraph: `Narrative reference point: ...` (Iris: just after *Bridge to the Turnabout*).
- A source note with title, URL, licence (Ace Attorney Wiki: CC BY-SA), import date, and page
  references on each fact.
- `(derived)` for relations the source implies; `(outside this source)` for established canon the
  source does not cover; a final `## Uncertain or not covered` section.
- Original factual summaries only: no copied articles, no long dialogue quotations.

## Prompt composition

identity line -> `IDENTITY_RULES` -> personality -> `## Canonical memories` (`LORE_RULES` + lore)
-> speech examples -> language -> capabilities -> reply format/schema.

`LORE_RULES` uses three tiers:
1. confirmed facts are lived memories;
2. facts marked uncertain, derived, disputed or not covered stay uncertain;
3. anything absent is not a memory, and fictional memories are never invented to satisfy the
   roleplay.

It also corrects false user claims and knows nothing after the reference point.

## Context budget

- `context_size()` in `app/characters/prompt.py` reports the prompt, personality, lore and
  speech-example costs in `text_cost` units: ASCII counts 1, other characters 3, roughly 4 units
  per English token.
- Above `CHARACTER_CONTEXT_WARN_COST` (24,000), the service logs one warning per character.
- `lore.md` over 12,000 characters adds a load warning.
- Nothing is ever truncated, because identity facts must survive.
- Current figures (French prompt): Iris 15.7k (lore 6.5k), other packs 7-9k.
- A test keeps every real pack under budget in English, French and Japanese.

Future strategy, only when a real pack exceeds the budget:
1. Split lore into an always-loaded core: identity, narrative point, family, key relationships,
   central conflicts.
2. Move detailed facts into a local fact index, keyed by people, places and events.
3. Retrieve the few facts whose keys match the current message and recent history,
   deterministically, without embeddings.
4. Consider vector search only if measured document sizes justify it.

## PDF import and OCR (Phase B)

Code: `app/documents/` (`pdf.py`, `tesseract.py`, `jobs.py`) and `app/api/document_routes.py`.

How extraction works:
- **Page by page.** pypdf reads each page's native text first.
- **When a page goes to OCR.** Only pages with fewer than 25 letters/digits (`no_text_layer`), or
  with more than 20% junk characters (`unusable_text_layer`), are rendered with pypdfium2 (300 DPI
  grayscale PGM) and passed to Tesseract.
- **Forced re-OCR.** `forceOcr` re-OCRs chosen pages and keeps their `nativeText`.
- **What each page records.** `page`, `method` (text|ocr|none), `status`
  (ok|empty|ocr_required|failed|skipped), original `text`, `nativeText`, `ocrReason`, `confidence`
  (Tesseract word confidence, not factual accuracy), `error`, `warnings`.
- **Document summary.** Pages by outcome, character count, mean confidence, and document-level
  errors.
- **Limits.**
  - 30 MB, enforced while streaming the upload.
  - 80 pages.
  - 90 s OCR per page.
  - 600 s per document; pages not reached in time are reported as `skipped`, never hidden.
  - At most 2 running jobs and 8 retained jobs.
- **Safety.**
  - The PDF header is sniffed, so a renamed file is rejected.
  - The upload name must end in `.pdf`; only its last component is kept, and only for display.
  - Nothing is written from the upload except temporary page images, which are deleted.
  - The API is local same-origin only, and responses are `no-store`.
  - Document text is never logged and is held in memory only until the job is discarded.

### API
- `GET /api/documents/ocr`: availability, version, discovery source, installed languages. No paths.
- `POST /api/documents/extractions?character=<id>&languages=eng+fra[&forceOcr=1,3]`. The body is
  the raw PDF, and `X-Filename` carries the percent-encoded name. Returns 202 with the job.
- `GET /api/documents/extractions/{id}[?pages=false]`: state (`queued`, `extracting`,
  `ocr_running`, `complete`, `ocr_required`, `failed`, `cancelled`), progress, extraction.
- `DELETE /api/documents/extractions/{id}`: cancel and forget.

### Tesseract discovery (first match wins)
1. `COURTROOM_TESSERACT_PATH`. If it points at a missing file, that is an error, not a fallback.
2. Bundled `<resource root>/tesseract/tesseract.exe`, plus `tessdata/` beside it. In development
   the resource root is the repository.
3. `tesseract` on PATH.
4. `%ProgramFiles%\Tesseract-OCR`, `%LOCALAPPDATA%\Programs\Tesseract-OCR`.

Nothing is ever downloaded or installed.

When something is missing:
- Missing Tesseract: pages needing OCR become `ocr_required` with `tesseract_missing`, and text
  pages still extract.
- Missing language data: `language_data_missing`, naming the missing `.traineddata` files.

### Installing Tesseract on Windows (owner / users)
- Install Tesseract 5.x. The UB Mannheim installer is the usual Windows build, and the official
  project publishes source only.
- It needs `eng.traineddata` and `fra.traineddata`. `jpn.traineddata` is optional, for Japanese.
- The repository's untracked `tesseract/` folder holds the 5.5.3 **source tree**: no executable and
  no language data, so it is not usable as-is. A Windows binary build plus `tessdata/` placed there
  would be discovered as the bundled copy.

### Real OCR validation (2026-10-26, Tesseract 5.5.3 at `C:\Program Files\Tesseract-OCR`)
- Discovered via the standard-install rule; eng, fra, jpn installed.
- Iris.pdf: 8 pages, no text layer; all 8 OCR'd in ~22 s; mean confidence 91.9 (87.5-95.5).
  Article prose is clean and names are correct (Iris, Dahlia Hawthorne, Phoenix Wright, Hazakura
  Temple, Sister Bikini, Morgan Fey, Miles Edgeworth, Doug Swallow, Larry Butz).
- Fixed: Tesseract merged the infobox column into body lines. `parse_tsv` now splits a line at gaps
  wider than 2.5 line heights and writes each block's columns separately. Body sentences are now
  intact, but infobox fragments still sit between body paragraphs.
- Added: pages with sparse text (< 200 letters/digits) plus image XObjects are OCR'd
  (`sparse_text_with_images`), covering browser prints with a text header over an image body.
- Remaining, unfixable at OCR level: the print cut the last line of some pages, so a half line is
  garbled. Grey epigraph quotes are dropped, the Japanese name is garbled under `eng`, and a few
  words fuse ("aresult").

### Licences
- pypdf: BSD-3-Clause.
- pypdfium2 and PDFium: BSD-3-Clause / Apache-2.0.
- Tesseract: Apache-2.0.
- tessdata models: Apache-2.0.
- PyMuPDF was not used (AGPL or commercial).
- Imported wiki text: Ace Attorney Wiki content is CC BY-SA. Keep attribution (title, URL, date)
  in derived lore, and do not redistribute imported PDFs.

### Standalone build implications
- pypdf is pure Python.
- pypdfium2 ships `pdfium.dll` in `pypdfium2_raw`. pyinstaller-hooks-contrib provides hooks for
  it, but the next Windows build must verify that the DLL is collected.
- Tesseract is not bundled yet. Bundling means shipping `tesseract.exe`, its DLLs and `tessdata/`
  under `tesseract/` in the bundle, with Apache-2.0 notices. Until then, users install it themselves
  and the app reports `tesseract_missing` with install instructions.

## Testing

- Deterministic tests (`tests/test_documents.py`) build PDFs in code (`tests/pdf_fixtures.py`) and
  use a fake OCR engine or runner.
- Covered cases: text, image-only, mixed, empty, corrupt, non-PDF, boilerplate, French accents,
  Japanese TSV parsing, missing Tesseract, missing language data, OCR failure/timeout, document
  deadline, cancellation, discovery order, jobs and API.
- Real-Tesseract tests skip unless an executable is discovered. They need Pillow (a dev-only
  dependency, already in the venv).

### Known environmental limitation
`tests/test_subscription_cli.py::test_run_cli_works_on_a_selector_event_loop` spawns `python.exe`.
It failed during the Phase A/B sessions because the sandbox then forbade child processes, and the
subscription CLI provider reported `cli_not_installed`. It passed again in the Phase C run once
spawning was allowed. It is deliberately left unchanged; do not weaken it to make restricted runs
green.

Also in the sandbox: pytest cannot use the system temp directory, so run it with
`--basetemp=<writable dir> -p no:cacheprovider`.

## Lore analysis (Phase C, D-101)

Code: `app/lore/` (`cleaning.py`, `grounding.py`, `merge.py`, `schemas.py`, `service.py`,
`jobs.py`), `generate_structured()` in `app/llm/gateway.py`, and routes in `document_routes.py`.

Pipeline: extraction -> clean -> chunk -> per-chunk LLM call -> strict validation -> grounding ->
dedup -> conflicts and comparison -> `LoreProposal`. Nothing is written to character files.

1. **Cleaning** (deterministic, reversible)
   - Rules:
     - `site_chrome`: UI lines (sign-in, menus);
     - `repeated`: lines on at least half the pages (minimum 3);
     - `page_furniture`: date stamps, bare URLs, `n/m` counters;
     - `ocr_noise`: fewer than 3 letters;
     - `footer_widget`: everything after a site-footer marker.
   - Every removed line is listed with its rule, and the original extraction is untouched.
   - The licence ("CC-BY-SA") and the source URL are captured as metadata.
   - Sections come from the document's own Contents list, or from short title-case lines followed
     by a substantial paragraph.
2. **Chunking**
   - Whole paragraphs, in page order, are grouped into chunks of about 6,000 characters. Every
     chunk begins with `[Page N | Section: ...]` markers.
   - Limits:
     - 60,000 source characters: whole pages beyond it are excluded and reported;
     - 12 chunks;
     - 150 facts;
     - 900 s per analysis;
     - 8,192 output tokens per chunk.
   - The Iris article gives 3 chunks.
3. **LLM call**
   - Uses the active provider profile through `generate_structured`: same adapters, timeout,
     truncation guard and failure isolation as chat, at temperature 0.2. The conversation
     `CharacterReply` contract and the Director are untouched.
   - The prompt marks the document as untrusted data, wraps it in `<document>` (a closing tag
     inside the text is defused), and forbids outside knowledge, invented quotes and absolute
     directives.
4. **Validation**
   - `ModelChunkOutput` is strict Pydantic: unknown keys, bad categories and over-long fields are
     rejected.
   - A failed chunk is reported, and the other chunks continue.
   - The provider schema is hand-written so that OpenAI strict mode, Anthropic native format and
     Ollama `format` all accept it.
5. **Grounding**
   - Evidence is normalised (NFKC, case, quotes and dashes, line-end hyphenation) before matching.
   - Outcomes:
     - `verified`: substring on a cited page, or across a page break;
     - `fuzzy`: at least 0.85 of the evidence contained, in order, in a window up to 1.5x longer
       (tolerates interleaved captions); below 0.95 it needs review;
     - `other_page`: page corrected, review required;
     - `not_found` or `invalid_page`: rejected.
   - Basis `explicit` can be `proposed`. `interpretation`, `inferred` and `uncertain` are always
     `needs_review` and labelled.
   - Limitation: grounding proves the quote exists, not that it supports the claim. Unsupported
     interpretations rely on review and conflict detection.
6. **Dedup**
   - Entities are resolved through aliases, titles ("Sister") and unique surnames or first names.
     Only short capitalised names count as full names.
   - Predicates are mapped through synonyms, and symmetric relations count in either direction.
   - Facts without an object merge only when their descriptions are near-identical.
   - Merged evidence is kept in `alsoSupportedBy`.
7. **Conflicts**
   - `direct_contradiction`: a single-valued family (upbringing, guardian, birthplace, parents,
     birth year) with a different value, against another new fact or a lore line.
   - `timeline_conflict`: different years.
   - `source_uncertainty`: the claim matches the lore's "Uncertain" section, or basis is uncertain.
   - `duplicate_assertion`: at least 0.6 of the fact's words are in a lore line plus its section,
     with the character's own name ignored.
   - `complementary`: at least 0.3.
   - Deeper semantic contradictions are left to Phase D's human review.
8. **Personality**
   - Traits are separate from facts and grounded the same way.
   - `inferred_tendency` needs review.
   - Guidance containing always/never/constantly is flagged `absolute_directive`; long quoted
     passages are flagged `quoted_dialogue`.
   - `alreadyDescribed` is set when `personality.md` already covers the trait.
   - Speech examples are never generated.

### API
- `GET /api/documents/extractions/{id}/cleaned`: cleaned pages plus removed lines and their rules.
- `POST /api/documents/extractions/{id}/analysis`, body
  `{"allowRemote": false, "excludePages": []}` (unknown fields return 422). Returns 202 with an
  analysis job.
  - 409 `remote_consent_required` when the active provider is remote: Anthropic, the CLI
    providers, or Ollama/OpenAI-compatible on a non-loopback host. The UI must ask the user before
    retrying with `allowRemote: true`.
  - 409 `no_provider`, `extraction_not_ready` or `no_text`.
- `GET /api/documents/analyses/{id}`: state (`analyzing` -> `review_required` | `failed` |
  `cancelled`), chunk progress, and the proposal (camelCase).
- `DELETE /api/documents/analyses/{id}`: cancel and forget.

Proposal fields:
- `characterId`, `narrativeReference`, `source` (name, sha256, pages analysed/excluded, licence,
  URL), `provider` (type, model, remote), `summary`;
- `facts` / `rejectedFacts`: category, subject/predicate/object, description, basis, source pages,
  evidence, `evidenceCheck`, `reviewStatus`, flags, `alsoSupportedBy`, `matchesExisting`;
- `traits` / `rejectedTraits`;
- `conflicts`;
- `comparison`: recovered / not recovered lore lines, new fact ids;
- `warnings`.

### Iris pilot (deterministic)
- Run on the real OCR text of Iris.pdf, with scripted model output (24 facts, 7 traits, including
  deliberate bad claims).
- Facts:
  - 21 facts kept, 4 of them needing review;
  - the fabricated quote and the outside-source "Mia is Maya's sister" were rejected (not found);
  - a wrong page was corrected to page 4;
  - the caption-interleaved quotation was matched fuzzily (0.98);
  - Dahlia/Iris twins stated twice were merged across alias and page.
- Conflicts: an unsupported "grew up in Kurain Village" interpretation was flagged as a
  contradiction, both with the new "raised at Hazakura Temple" fact and with the existing lore.
- Comparison: 13 existing lore lines recovered.
- Traits: the absolute "always apologises" trait was flagged; the "archaic dialect" speech claim
  was rejected.
- **No real model was run.** Extraction quality with a real LLM is unverified.

### Real-model attempt (2026-10-26, local Ollama)
- The only installed model was `qwen3:4b` (Q4). Ollama loaded it with a 4,096-token context and
  partial GPU offload.
- A 6,000-character chunk plus the instructions is about 2,700 tokens, leaving roughly 1,400 for
  the JSON answer.
- No chunk finished in 10 minutes, so the run was stopped. No proposal quality was measured.
- Follow-up: the Ollama adapter does not send `num_ctx`. Analysis with Ollama needs a larger
  window, smaller chunks, or a larger model.
- The owner plans to test with the Claude subscription provider instead. It is remote, so the
  request needs `allowRemote: true`.

## Approved knowledge overlay (Phase D, D-102)

Code: `app/lore/knowledge.py` (store and rendering), `app/lore/approval.py` (review decisions),
`app/api/knowledge_routes.py`, and `CharacterRepository.knowledge_store()`.

- **Storage:** `<data root>/character-knowledge/<character id>/knowledge.json`.
  - Frozen Windows build: `%LOCALAPPDATA%\CourtroomCompanion\character-knowledge`.
  - Development: `backend/.local/character-knowledge`.
  - Overridable through `COURTROOM_CONFIG_DIR`.
  - Character ids are validated (`^[a-z][a-z0-9_]{0,63}$`) and must resolve inside the root.
  - Writes are atomic (temporary file, then replace).
  - At most 300 items per character.
- **Contents:** approved facts and traits with full provenance (source document, sha256, pages,
  evidence, proposal id, approval time, whether the user edited the text), plus the source list
  (name, licence, URL).
- **Merge precedence (deterministic, append-only):**
  - Effective `lore` is the pack's `lore.md`, then `## Approved additions (user-imported sources)`
    (inferred facts labelled `derived`, interpretations labelled `source interpretation`, each
    with its citation), then `## Approved uncertain additions`.
  - Effective `personality` is the pack's `personality.md`, then
    `## Approved personality notes (user-imported sources)`.
  - Items are ordered by approval time, then id.
  - Built-in text is never removed or rewritten. Readiness is computed from the pack alone.
  - A pack without `lore.md` gains a canonical-memories section from the overlay.
- **Safety:**
  - Model-written text is flattened to one plain line (no headings, lists or quotes, at most 500
    characters) before it can reach a system prompt.
  - A corrupt overlay, or one written for another character, is ignored with a warning; the
    built-in character still loads.
- **Approval rules:**
  - Only the items listed in the request are applied; everything else stays out.
  - Rejected items can never be approved.
  - Facts in a `direct_contradiction` or `timeline_conflict` return 409 unless listed in
    `acknowledge`.
  - Restatements of built-in lore or personality are skipped unless acknowledged; items already
    approved are skipped.
  - `edits` replace the model's wording.
- **Reload:** every change invalidates the cached profile, so the next chat turn uses it.

### API
- `POST /api/documents/analyses/{id}/approval`, body
  `{"factIds": [], "traitIds": [], "edits": {"f3": "text"}, "acknowledge": []}`.
  - Returns `{approved, skipped: [{id, reason}], knowledge}`.
  - Errors: 422 `rejected_item`, `unknown_item`, `empty_edit` or `nothing_selected`; 409
    `unacknowledged_conflict` or `analysis_not_ready`.
- `GET /api/characters/{id}/knowledge`: approved items, sources, rendered additions, context size.
- `DELETE /api/characters/{id}/knowledge/items/{itemId}`: remove one item. Unused sources are
  dropped, and the file is deleted once empty.
- `DELETE /api/characters/{id}/knowledge?confirm=true`: factory reset. The prompt becomes
  byte-identical to the built-in one.
- `GET /api/characters/{id}/knowledge/export`: effective lore and personality as Markdown, for an
  explicit developer export. Nothing is written into the pack.

Proposals still live only in memory: an unapproved proposal is lost on restart, and only approved
items persist.

## Character Studio UI (Phase E, D-103)

Entry: **Settings -> Character Studio -> Open (advanced)**. The Studio is its own app screen
outside the 256x192 DS stage, a scrollable panel in the app palette. It is a developer/advanced
panel, so its content is English only, following the `strings.ts` convention. Only the Settings
row is translated into the 5 languages.

Code:
- `frontend/src/studio/studioApi.ts`: typed client with defensive parsers; server refusals become
  `StudioError` with their code.
- `frontend/src/studio/studioState.ts`: pure workflow rules (stage labels, suggested selection,
  acknowledgement gating, approval payload, consent text).
- `frontend/src/studio/CharacterStudio.tsx` and `character-studio.css`.

Workflow:
1. **Character and document**
   - Choose the character.
   - The local OCR status line shows the Tesseract version and installed languages, or the
     missing-Tesseract message.
   - Choose OCR languages; uninstalled ones are disabled.
   - Pick a PDF, then **Extract text**.
2. **Extraction**
   - The stage badge and "n/m pages" come only from the backend's counters (Extracting ->
     OCR running -> Extraction complete / OCR required / Failed). Cancel and Start over are
     available.
   - Per-page table: read by (text layer / OCR with confidence), status, **Use** (exclude pages
     from analysis), **Re-OCR** (re-extract with forced OCR on chosen pages), and cleaned plus
     original text.
   - The removed lines are listed with their rules, and the licence is shown.
3. **Analyse**
   - Uses the active provider.
   - When the backend answers `remote_consent_required`, a consent box names the provider, the
     document and the number of pages, and says that OCR ran locally. Nothing is sent until
     **Send and analyse**.
   - Chunk progress comes from the backend.
4. **Review**
   - Summary, narrative reference point and warnings are shown.
   - Each fact or trait card shows the claim, review badge, verbatim evidence with its check
     ("Quote found on p.3", "Close match 98%", "found on p.4, not the cited page"), basis or kind,
     flags, merged pages and conflicts.
   - **Edit** opens a textarea; the edit is recorded as `edited`.
   - **Select suggested** pre-ticks only items that are proposed, conflict-free and new.
   - Items that conflict or restate built-in knowledge need **Approve anyway**; otherwise
     **Apply** is disabled and the reason is listed.
   - Rejected items and the comparison with current lore sit in collapsed sections.
5. **Approved knowledge**
   - Approved items with provenance, each with **Remove**.
   - Context-budget line.
   - **View effective lore** opens the Markdown export.
   - **Factory reset…** has an inline confirmation.
   - **Talk to {name}** opens the normal location -> conversation flow.

### Browser verification (2026-10-26)
- Setup: isolated QA backend (temporary data directory, real Tesseract, scripted model reported as
  remote) and a Vite dev server, both started and stopped by the agent.
- Path: Title -> Options -> "Atelier des personnages" (French UI) -> Studio -> Iris + Iris.pdf.
- Extraction: live "OCR running 1/8 pages", then 8/8 OCR pages, confidence 92.6, 150 lines
  cleaned, licence CC-BY-SA.
- Analysis: pages 7-8 excluded; the consent box showed "6 page(s)"; Send and analyse produced a
  review of 21 facts (4 need review), 6 traits, 2 + 1 rejected and 4 conflicts.
- Review:
  - suggested selection = 5 new, conflict-free items;
  - ticking the Kurain Village contradiction disabled Apply and stated the reason;
  - an edit plus a needs-review fact applied 7 items;
  - the export showed them, with the edited wording and citations;
  - the overlay file appeared only in the QA data folder, and the pack files were unchanged.
- Approved knowledge: Remove went from 7 to 6 items; factory reset (confirmed) restored the
  built-in context cost (15,750); Talk to Iris opened location selection.
- Console: the only error was the expected 409 consent response.
- Not covered: keyboard-only walkthrough and the narrow-window layout beyond the CSS media rule.
