# Project State — Courtroom Companion

_Last updated: 2026-10-25 (agents, events, tools, voiced shouts, D-067/D-068). Source of truth is the filesystem; update this file when the actual state changes._

## Summary

Courtroom Companion is an Ace Attorney-style conversational interface with a complete presentation and local chat loop:

title → main menu → character select → location select → conversation scene

In the scene, the React client sends a message to the FastAPI backend. The server resolves its active saved provider profile and OS-vault/environment credential into the existing gateway configuration. The gateway supports deterministic `FakeProvider`, native-HTTP `OllamaProvider`, one generic Chat-Completions `OpenAICompatibleProvider`, and native Messages `AnthropicProvider`; validated semantic beats pass through the same data-driven Character Director and measured paginator before the existing typewriter, reaction, animation and blip engines play them. The temporary test script remains available from the dev panel.

**Original UI assets, partly in.** The owner manually supplied:
- the original title-screen sheet (now the "press start" art);
- the exclamation bubbles (extracted, not yet used);
- the complete Igiari distribution by Caveras (now the primary stage/UI font via its WOFF2 build at 16 px);
- DotGothic16 Regular (now the bundled deterministic fallback for Kanji).

The text box, name plate, continue arrow and menu buttons are still CSS stand-ins. Original DS menu panels are in use. Details are in `docs/ASSET_SOURCES.md`.

**Maya now uses native DS sprites** (D-027). All 102 frames are re-extracted 1:1 from the authoritative sheet `docs/references/maya fey.png` (15-colour palette). The old frames were proven to be 0.69× resampled copies, which caused the muddy look, the per-frame width rounding (the real jitter source) and the "too small" composition.

At native size and render scale 1 (D-026), Maya is 146–162 px tall on the 192 px stage, head around y=31, continuing behind the dialogue box, like the DS game. Within each pose all frames draw at a single stage position; only genuine motion (laugh head-bob, reaction recoil) moves. The canvas/offset architecture (D-022) is kept.

**Menu SFX** play through logical events in `audio.json` (D-028).

**Music (D-043–D-048, details in `docs/MUSIC.md`).**
- One MusicEngine drives three sources: original OST (25 tracks, Web Audio loop regions), imported music (local backend library + Web Worker auto-loop) and YouTube radio (official visible IFrame player).
- Settings: Music source / Track / BGM vol / Mute BGM. The out-of-stage Music dock holds status, Play/Pause, the radio player and the import library.
- 15 built-in tracks have metric-validated loops; 10 playable tracks remain `loop: null`. Maya now has a metric-validated loop; no loop has been verified by ear. The current Lofi Girl candidate `EWrX250Zhko` is marked unavailable after official IFrame error 150.

**Presentation and audio UX (D-049–D-051).**
- While a reply is generated, Maya holds her data-driven thinking pose (`thinking_side`, animated idle).
- Strong beats play one semantic reaction SFX (director `sfx` → audio.json `sfx_<name>`), once on the first page, with their own SFX volume/mute. Explicit semantic SFX bypass emotion fallback and visual-reaction suppression; visual one-shots retain their existing limits. Emotion fallbacks use per-emotion thresholds and ordinary anxious/neutral/calm states remain silent. Dev builds show selection/suppression and per-event playback status, with audition controls.
- The user's typing plays male blips (IME-safe, throttled).
- Character BGM starts only in the conversation scene; menus are silent.
- DotGothic16 kanji are scaled to 75% so they match Igiari kana.
- The import panel opens by default with visible steps.

**Agents and events (D-067, D-068).** Characters speak without a message (Claude Code hook events, due reminders) with original exclamation bubbles and voiced shouts; they can use tools (reminders, authorized folders, web search) through a validated two-phase loop; the title opens with a random voiced "Igiari!". Status and next steps: `docs/AGENTS_AND_EVENTS.md`.

**Languages (D-066).** English, French, Japanese, Italian and Spanish: interface, character names (e.g. 綾里真宵, Dick Tektiv), offline replies and the model's reply language follow Settings → Language.

**Present evidence (D-065).** In a conversation, drop a file on the scene or press Present: text/code (every model), images (vision models) and PDFs (Claude; OpenAI file input) go to the active model with an optional question, and the character answers in its own way. The file is shown in the DS evidence frame while the character thinks.

**Court Record (D-047).** Data-driven evidence/profile manifest with 3 native evidence icons. Its DS view is reachable from the main menu and from a conversation overlay. Generic Talk Options sit over the original talk-option panel.

**Generated text artifacts (D-052, milestone 2) and delivery (D-055/D-057).** The shared conversation turn may propose one strict `create_text_artifact` action beside the unchanged CharacterReply. The backend saves inert UTF-8 `.txt` / `.md` / `.py` content under opaque IDs in ignored `backend/.local/outputs/`; it remains the only artifact store. The frontend buffers that one final response through `idle → task-acknowledgement → artifact-working → waiting-for-phone-acknowledgement → evidence-summon → response-release → idle`; failure/cancellation do not summon. A file-only Court Record is a view over artifact metadata/content APIs, while Thinker and phone are temporary presentation cues. Python is never executed/imported/compiled. The old Generated files panel is now dev-only. See `docs/ARTIFACTS.md`.

**Maya personality tuning (D-056).** Food/burger references remain part of Maya's personality, but personality guidance now prioritizes the user's subject and discourages repetitive trait callbacks. No keyword censor or counter was added. A deterministic eight-turn FakeProvider follow-up showed varied playful fixture replies and no burger references; real-provider adherence was not tested.

**Artifact presentation/audio correction (D-057).** Character-defined acknowledgement variants are typed while the original provider request runs. The existing backend workload estimate is exposed as advisory turn metadata; no frontend action detector or second provider request is added. Fast results wait through acknowledgement and a short working gate. Phone readiness now starts the metadata-identified Phoenix ringtone as one native loop until answer/interruption; scoped 12% BGM ducking uses 220/350 ms ramps without changing configured volume or restarting the track. Court Record browsing uses ordinary move/confirm/back/page sounds; the dev panel has a bounded ringtone audition. See `ARTIFACTS.md` and `MUSIC.md`.

**Output budgets (D-053).** Normal chat keeps the selected profile's budget (inspected Sonnet 5.5 profile: 600). Explicit text-artifact requests receive an advisory service workload and a transient 16,384-token cap through the shared gateway. Anthropic output-token exhaustion, context-window exhaustion and refusal have distinct diagnostics/UI messages; truncated output never reaches artifact validation/storage and never emits ready. No saved budget, model maximum, automatic retry or artifact architecture change is involved.

**Conversation Record, frame, panels, ringtones and budgets (D-058–D-061).**
- Completed turns are archived server-side (git-ignored `conversation-record/records.json`, one idempotent record per turn, artifact IDs only). They are browsable from the title menu and from a conversation "Record" overlay as framed character-portrait slots with a scrollable detail view. The archive is never sent to the LLM.
- Evidence tiles use the native 70×70 frame.
- Out-of-stage panels are collapsible and start collapsed; the radio panel stays open while it plays.
- Settings offers Phoenix (default), Richard Wellington and Godot ringtones with Preview/Stop; the phone uses the selection at ring time.
- Dialogue has a 4096-token output floor. Truncation and context-window errors are detected and distinguished on every provider. LLM history is fitted to a deterministic size budget.

**Engine tests** run with `npm test` (D-029).

## Current architecture

```
frontend/src/
├── main.tsx                      # StrictMode → SettingsProvider → App
├── App.tsx                       # catalog loading + screen state machine
├── App.css, index.css            # stage UI (logical px), menus, dev panels; palette vars
├── engine/                       # character-independent logic
│   ├── manifestTypes.ts          # manifest + resolved types (characters, backgrounds, audio)
│   ├── manifestLoader.ts         # index/summaries/characters/backgrounds/sounds loaders
│   ├── characterResolver.ts      # PURE emotion+mode(+reaction) → clip, with fallbacks
│   ├── useClipPlayback.ts        # the single animation timer
│   ├── useCharacterAnimation.ts  # useReactionGate + useCharacterPlayback (+ convenience wrapper)
│   ├── useTypewriter.ts          # waiting/revealing/complete, punctuation pauses, skip
│   ├── useBlips.ts               # per-character blip callback: voiced chars only, 60 ms throttle
│   ├── audioEngine.ts            # one AudioContext, decode-once buffers, unlock on gesture
│   ├── dialogueTypes.ts          # DialogueLine { speaker?, emotion, text, voice? }
│   ├── dialogueLayout.ts         # shared dialogue geometry + live browser font measurer
│   ├── performance.ts            # API contract validation + natural measured pagination
│   ├── stage.ts                  # 256×192 logical stage constants
│   └── useStageScale.ts          # integer scaling via ResizeObserver
├── settings/
│   ├── settings.ts               # Settings type, defaults, context, localStorage helpers
│   └── SettingsProvider.tsx
├── components/
│   ├── PixelStage.tsx            # scaled 256×192 surface used by every screen (auto or dev-fixed scale)
│   ├── CharacterSprite.tsx       # canvas anchored bottom-centre, frame drawn at its offset; debug overlay
│   ├── GameScene.tsx             # background → character → overlay children
│   ├── BackgroundRenderer.tsx
│   ├── DialogueBox.tsx           # name plate + box + continue arrow (CSS stand-ins)
│   ├── TypewriterText.tsx        # revealed text + invisible remainder (stable wrapping)
│   ├── MenuList.tsx              # DS-style keyboard/mouse menu
│   └── DevPanel.tsx              # Phase 2A animation inspector panel (dev)
├── screens/
│   ├── TitleScreen.tsx           # press start (unlocks audio) + main menu
│   ├── CharacterSelectScreen.tsx # generated from characters/index.json
│   ├── LocationSelectScreen.tsx  # generated from backgrounds.json, live preview
│   ├── SettingsScreen.tsx        # speed / volume / mute / fullscreen / test blip
│   ├── ConversationScreen.tsx    # dialogue engine driving the character
│   └── AnimationTestScreen.tsx   # Phase 2A inspector (dev only)
└── dev/
    ├── testConversation.ts       # TEMPORARY 8-line test script
    ├── ConversationDevPanel.tsx  # TEMPORARY voice override, state readout (dev only)
    ├── devDisplay.ts, DevDisplayProvider.tsx  # scale / alignment / overlay options (dev only)
    └── DevDisplayControls.tsx    # 1×–4×/auto, canvas vs per-frame, overlay, native-size readout
```

Added 2026-10-24 (music + Court Record):
- `src/music/`: `types.ts` contracts, `MusicEngine`, `webAudioSource`, `bufferCache`, `loopMath`, `soundtrack`, `musicRuntime` + `useMusicSync`, `radio/` (IFrame API source + panel), `imported/` (library API, resolver, panel), `loop/` (analyser, worker, editor).
- `src/courtRecord/`: manifest loader/validator, navigation and talk-option helpers, CSS.
- `components/`: `MusicDock`, `CourtRecordView`, `TalkOptions`.
- `dev/talkTopics.ts`: sample topics.
- `App.tsx` gains an app shell (screen + Music dock) and a `court-record` screen.
- Backend: `app/music/` + `app/api/music_routes.py`.

### Conversation data flow

```
line (emotion, text, voice?)
  → useReactionGate(lineKey)            reaction pending?
  → useTypewriter(active = !pending)    waiting | revealing | complete  (+ onReveal(char))
  → mode = revealing ? talking : idle
  → useCharacterPlayback → resolveClip → useClipPlayback → frame
onReveal(char) → useBlips(voice) → audioEngine.play()
voice = dev override ?? line.voice ?? character.voice.blip
```

## Frontend status

- Igiari is the primary stage/UI font: WOFF2, 16 px, zero added letter/word spacing. Bundled DotGothic16 is the deterministic first fallback, especially for Kanji; Japanese/system sans-serif fonts are tertiary emergency fallbacks. DotGothic16 is visually compatible but is not claimed to be the original Ace Attorney Kanji font (D-037, D-038).
- Final combined-tree checks: asset validation 201 references / 0 errors; build 110 modules + analysis worker; lint clean; frontend tests 216 passed; backend tests 353 passed / 1 skipped (Windows symlink privilege). Verified 2026-10-24 after the phone/acknowledgement audio correction.
- Dimensions: stage 256×192. Maya frames are native 55–109 px wide × 100–112 px tall, drawn at native size and scaled only with the whole stage (e.g. neutral talking frame 65×111 → 390×666 CSS px at auto 6×, 260×444 at 4×). Backgrounds are 256×192 (or 512 wide, centre-cropped).
- Verified in Chrome (dev server):
  - full menu flow;
  - each line: TALKING while revealing → IDLE + arrow when complete;
  - surprised: `waiting` (reaction) → revealing → complete;
  - female blips by default, male blips on line 7 or via dev override;
  - zero blips triggered by whitespace or punctuation;
  - one advance per click or Enter;
  - settings persist and mute is honoured;
  - integer rescaling (6× → 1× → 6×);
  - no console errors, no failed requests or broken images.
- Dev-only UI (Asset/Animation Test entry, conversation dev panel) is hidden when `import.meta.env.DEV` is false. The code is still bundled but unreachable. The `window.__ccAudio` debug hook is stripped in production.
- Launch: `cd frontend` then `npm run dev`.
- Browser font/pagination checks: Igiari WOFF2 and DotGothic16 TTF both loaded before measurement; kana metrics matched Igiari and Kanji-only metrics matched DotGothic16. English, French, kana, mixed Kanji and longer Japanese samples fit without clipping, overlap or hidden lines; hyphen, ellipsis and accented Latin remain in Igiari. Pagination is identical at 3×, 4× and auto 5×. The existing 15 px line height remains valid.
- `npm test`: 28 engine tests (node:test, no dependencies), all passing.
- Settings manages backend AI profiles: select/activate, Add/Edit/Duplicate/Delete, provider-specific fields, Ollama discovery and a history-free profile Test Connection. Cloud password entry is transient, cleared after save, and never persisted in browser storage. The scrollable 256×192 form has a fixed label column, constrained controls and non-shrinking rows; Speed/Volume/Mute/Display/Test blip remain in normal scroll order. Real Windows-vault browser checks passed for save, switch away/back, replace, remove, missing-key failure, and no secrets in storage/responses.

## Backend status

`backend/` (FastAPI, Python 3.12+; developed on 3.15.1 in `backend/.venv`):
- **LLM gateway:** a provider-agnostic adapter contract, a registry, timeouts and exception isolation. The shared parse/validate/repair step produces a strict `CharacterReply`.
- **Providers:** **FakeProvider** (deterministic, offline), **OllamaProvider** (native `/api/chat`, local/no key, JSON Schema via `format`), **OpenAICompatibleProvider** (`POST {baseUrl}/chat/completions`, JSON Schema via `response_format`), and **AnthropicProvider** (native `/v1/messages`, API `2026-10-21`, JSON output via `output_config.format`). Gemini/compatible services and Claude model variants remain model/endpoint configuration, not provider subclasses. Anthropic projects the existing schema into the documented grammar subset; full bounds remain in the shared prompt/validation/director. Only final text enters shared repair; hidden thinking is discarded.
- **CharacterRepository:** reads capabilities from the frontend character packs (`character.json` + new `performance.json` + `personality.md`).
- **CharacterDirector:** deterministic, data-driven anti-overacting rules → `PerformanceTimeline`.
- **Configuration:** `app/configuration/profiles.py` contains validated ProviderProfile metadata, an atomic local ProfileStore and ProfileManager resolution. Ignored `backend/.local/provider-profiles.json` holds profiles and the active ID; `COURTROOM_CONFIG_DIR` can override the directory. `credentials.py` isolates Python keyring and accepts native OS vaults only. This Windows machine uses `keyring.backends.Windows.WinVaultKeyring`; env references remain a fallback. D-041 supersedes per-request browser configuration and environment-only credential UX.
- **API:** existing health/capabilities/chat and legacy discovery/test routes, plus local profile CRUD/activation/duplication, credential set/delete/status, profile model discovery and Test Connection. Chat uses the server's active profile; old `provider` request overrides receive 409. Test generation bypasses conversation history.
- **Artifacts/tasks:** `app/artifacts/` owns a strict action, bounded atomic ArtifactStore and in-memory TurnRegistry; `api/artifact_routes.py` reuses local/same-origin protection. Current chat includes requestId and a separate task/artifacts result. Legacy dialogue-only callers and provider connection tests cannot create files. Records/content survive restart; receipts prevent duplicate writes; incomplete/missing/corrupt storage fails safely. No general tool calling or code execution was added.
- **Tests:** `pytest`, 353 passed / 1 skipped (real symlink creation requires Windows privilege). Provider transports and credential backends are mocked; normal tests require neither a real OS vault, local model nor cloud key. Tests also cover artifact action/storage/API validation, all four providers, no execution, atomic failure/rollback, receipts, cancellation/duplicates, workload budgets, early advisory workload status, distinct stop reasons and normal-chat/presentation regressions.
- **Local environment check:** `ollama` command not found and `http://localhost:11434/api/tags` did not respond. No installed models could be queried, so no real-model end-to-end smoke test was possible and no model was downloaded.
- **Gemini environment check:** neither `COURTROOM_LLM_API_KEY`, `GEMINI_API_KEY`, nor a configured generic secret selector is present. The requested real Gemini smoke test was therefore skipped without making a cloud request.
- **Anthropic check:** no saved Anthropic profile/credential was configured, so real Claude multilingual/personality/director/pagination generation could not be exercised. The 256×192 Settings flow was verified against the real Windows vault with a temporary synthetic key: no base URL, key save/switch/retain/replace/remove, clean missing-key test, no storage/response leakage or overlap. No cloud call was made.

See `docs/LLM_ARCHITECTURE.md` and `docs/CHARACTER_DIRECTOR.md`. Start with `cd backend; .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000`. The Vite dev server proxies `/api`.

## What already works

- Phase 2A, intact: typed manifest loading, emotion resolver with fallbacks, idle/talking loops, one-shot reactions, pixel-perfect integer scaling, asset validation.
- Screen flow with keyboard (↑/↓, Enter/Space/Z, Esc/Backspace/X) and mouse.
- Character and location menus are generated from manifests; any character added to `characters/index.json` appears automatically.
- AI dialogue is paginated into DS textboxes with real font metrics and natural sentence/clause breaks, locale-aware (EN/FR/JA tested); beat != page (D-036).
- Long menu labels stay inside fixed DS-width buttons and scroll horizontally (whole-pixel steps) when selected or hovered; reduced motion uses a static reveal (D-032).
- Typewriter:
  - reveal speed from settings;
  - punctuation pauses: sentence end 350 ms, comma 180 ms, ellipsis dots 120 ms (at 1×);
  - skip-to-end, then advance;
  - restart on a new line;
  - one timer at a time, cleaned up.
- Blips:
  - Web Audio, decoded once;
  - voiced characters only;
  - 60 ms minimum spacing;
  - volume and mute from settings;
  - audio unlocks on the first user gesture (press start).
- Settings persisted in `localStorage` (guarded with try/catch).

## What is incomplete

- **Original DS UI graphics:** the title art, pixel font and menu panels (D-031) are in. The text box, name plate, continue arrow, menu buttons, Settings pickers and conversation action buttons are still CSS stand-ins (pickers and actions DS-themed in D-063).
- **OST MP3s are local-only:** `music/original/` (25 files) is untracked in Git. On this machine it was restored on 2026-10-24 from the owner's `ace-attorney-original-soundtrack.zip`; a fresh clone needs the same copy until D-044 (Git vs LFS) is decided.
- Music: 10 playable tracks remain `loop: null` (list in `docs/MUSIC.md`); built-in loops are not ear-verified. Lofi Girl `EWrX250Zhko` refuses embedding (error 150); users can enter another embeddable video. No MusicDirector.
- Semantic reaction SFX are wired through the director and audio event manifest; the selected WAVs still await by-ear approval. Exclamation bubbles and screen effects remain unwired (bubble images are extracted but not used yet).
- The original static Court Record retains three demo evidence entries; the generated-file Court Record is separate and contains only generated artifacts. Talk topics are static dev samples; no case logic.
- Ollama, generic OpenAI-compatible and native Anthropic providers plus local profile/credential management are implemented. No application streaming or persistent memory yet.
- The chat UX is minimal (single input under the scene, no history view).
- Three selectable characters (Maya Fey, Dick Gumshoe, Mia Fey; D-064), one on screen at a time. Gumshoe and Mia use stand-in portraits. Wide backgrounds are centre-cropped (no panning).
- Sheet rows 14–17 (Maya side poses) are not extracted yet.

## Known problems / ambiguities

1. **Shocked reaction order** (arms-wide then fists) is kept from the old rip and is uncertain. Frame 025 (standing, worried) is unassigned. Confirm by eye.
2. **Laugh clip:** `clasped_hands_laugh` talking is now the full 7-frame row-9 laugh (was 4). Confirm it reads well as "laughing while talking".
3. **Japanese font authenticity caveat:** Igiari has kana and Japanese punctuation but no Kanji. Bundled DotGothic16 now provides deterministic Kanji coverage before the tertiary system fallbacks, but it is not claimed to be the original Ace Attorney Kanji font.
4. Talking fps is untuned. `surprised` settles to neutral (no shocked hold loop).
5. bg_18 has characters baked in. Three backgrounds are 1 px off-size. Descriptions are guesses.
6. Vite `dist/assets/` is shared between bundles and public assets (no collision today).
7. Dev-only code is unreachable in production but still bundled.
8. The download sources of the backgrounds and audio, and the page URL of the Maya sheet, were never recorded (ASSET_SOURCES).
9. Menu SFX play at a fixed volume of 0.5 (no UI volume setting yet).
10. Vite's file watcher occasionally cached a half-written file during scripted edits; touching the file fixes it (dev-only).

11. Settings → Scale `Fit` (default, D-062) makes sprite pixels slightly uneven in width; `Pixel` keeps them exact.

## Current development phase

**Phase 5h — milestone 3 of 3 (artifact presentation and file-only Court Record) is implemented in the current uncommitted working tree.** Milestone 2 remains authoritative for artifacts and storage. The task-aware budget/truncation fix and Maya quirk-variety guidance are preserved. Current results are in `SESSION_LOG.md`. No commit or push was performed.

## Immediate next objective

0. **Agents and events (Phase 7):** follow `docs/AGENTS_AND_EVENTS.md` (plan, order, safety rules, status checkboxes).

1. Decide whether the ~58 MB of OST MP3s belong in Git normally or via LFS (D-044).
2. Listen across loop boundaries of the curated tracks and correct the unlooped ones (start with Maya Fey).
3. Add a configured Anthropic profile for a real live smoke test; no cloud call was made during this milestone.
4. Application streaming remains a later generic gateway/API milestone.
