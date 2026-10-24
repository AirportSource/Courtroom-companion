# Project State — Courtroom Companion

_Last updated: 2026-10-24 (local provider profiles and OS credential management). Source of truth is the filesystem; update this file when the actual state changes._

## Summary

Courtroom Companion is an Ace Attorney-style conversational interface with a complete presentation and local chat loop:

title → main menu → character select → location select → conversation scene

In the scene, the React client sends a message to the FastAPI backend. The server resolves its active saved provider profile and OS-vault/environment credential into the existing gateway configuration. The gateway supports deterministic `FakeProvider`, native-HTTP `OllamaProvider`, and one generic Chat-Completions `OpenAICompatibleProvider`; validated semantic beats pass through the same data-driven Character Director and measured paginator before the existing typewriter, reaction, animation and blip engines play them. The temporary test script remains available from the dev panel.

**Original UI assets, partly in.** The owner manually supplied:
- the original title-screen sheet (now the "press start" art);
- the exclamation bubbles (extracted, not yet used);
- the complete Igiari distribution by Caveras (now the primary stage/UI font via its WOFF2 build at 16 px);
- DotGothic16 Regular (now the bundled deterministic fallback for Kanji).

The text box, name plate, continue arrow and menu buttons are still CSS stand-ins. Original DS menu panels are in use. Details are in `docs/ASSET_SOURCES.md`.

**Maya now uses native DS sprites** (D-027). All 102 frames are re-extracted 1:1 from the authoritative sheet `docs/references/maya fey.png` (15-colour palette). The old frames were proven to be 0.69× resampled copies, which caused the muddy look, the per-frame width rounding (the real jitter source) and the "too small" composition.

At native size and render scale 1 (D-026), Maya is 146–162 px tall on the 192 px stage, head around y=31, continuing behind the dialogue box, like the DS game. Within each pose all frames draw at a single stage position; only genuine motion (laugh head-bob, reaction recoil) moves. The canvas/offset architecture (D-022) is kept.

**Menu SFX** play through logical events in `audio.json` (D-028).

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
- `npm run validate:assets`: pass (161). `npm run build`: pass (58 modules). `npm run lint`: pass. `npm test`: 30/30. Verified 2026-10-24.
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
- **Providers:** **FakeProvider** (deterministic, offline), **OllamaProvider** (native `/api/chat`, local/no key, JSON Schema via `format`), and **OpenAICompatibleProvider** (`POST {baseUrl}/chat/completions`, backend Bearer secret, JSON Schema via `response_format`). Gemini and other compatible services are configurations, not provider classes.
- **CharacterRepository:** reads capabilities from the frontend character packs (`character.json` + new `performance.json` + `personality.md`).
- **CharacterDirector:** deterministic, data-driven anti-overacting rules → `PerformanceTimeline`.
- **Configuration:** `app/configuration/profiles.py` contains validated ProviderProfile metadata, an atomic local ProfileStore and ProfileManager resolution. Ignored `backend/.local/provider-profiles.json` holds profiles and the active ID; `COURTROOM_CONFIG_DIR` can override the directory. `credentials.py` isolates Python keyring and accepts native OS vaults only. This Windows machine uses `keyring.backends.Windows.WinVaultKeyring`; env references remain a fallback. D-041 supersedes per-request browser configuration and environment-only credential UX.
- **API:** existing health/capabilities/chat and legacy discovery/test routes, plus local profile CRUD/activation/duplication, credential set/delete/status, profile model discovery and Test Connection. Chat uses the server's active profile; old `provider` request overrides receive 409. Test generation bypasses conversation history.
- **Tests:** `pytest`, 137 passing. Provider transports and credential backends are mocked; normal tests require neither a real OS vault, local model nor cloud key. Tests cover secret redaction, profile lifecycle/reload, env resolution, safe writes, migration, profile-scoped discovery/testing and active-profile chat.
- **Local environment check:** `ollama` command not found and `http://localhost:11434/api/tags` did not respond. No installed models could be queried, so no real-model end-to-end smoke test was possible and no model was downloaded.
- **Gemini environment check:** neither `COURTROOM_LLM_API_KEY`, `GEMINI_API_KEY`, nor a configured generic secret selector is present. The requested real Gemini smoke test was therefore skipped without making a cloud request.

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

- **Original DS UI graphics:** the title art, pixel font and menu panels (D-031) are in. The text box, name plate, continue arrow and menu buttons are still CSS stand-ins.
- No music, no effect SFX wiring, no exclamation bubbles or screen effects (bubble images are extracted but not used yet).
- Ollama and generic OpenAI-compatible providers plus local profile/credential management are implemented. No Anthropic adapter yet; no application streaming; no persistent memory.
- The chat UX is minimal (single input under the scene, no history view).
- One character on screen. Wide backgrounds are centre-cropped (no panning).
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

## Current development phase

**Phase 5d — provider profiles and OS credentials implemented and validated.** The provider architecture, typography and Ollama milestones are committed; OpenAI-compatible, Settings layout and profile/credential work remain uncommitted.

## Immediate next objective

1. Review the combined uncommitted provider/profile milestone after approval.
2. Configure a real cloud key through Settings when a live model smoke test is desired; the OS-vault browser test used synthetic credentials and made no cloud request.
3. Next provider: Anthropic adapter/registration and profile form fields, reusing CredentialStore. Application streaming remains a later generic gateway/API milestone.
