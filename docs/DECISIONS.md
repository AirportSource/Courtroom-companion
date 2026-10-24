# Architectural Decisions — Courtroom Companion

_Rules: never rewrite a decision silently. When a decision changes, set its status to **Superseded by D-xxx**, keep the original text, and add a new entry explaining why._

Status values: **Accepted** · **Proposed** (not yet confirmed by the project owner) · **Open** (needs a decision) · **Superseded by D-xxx**

Entries D-001–D-007 were reconstructed on 2026-10-24 from the existing repository, Git history, `CLAUDE.md` and project skills; they record decisions already in effect rather than new ones.

---

## D-001 — Frontend stack: React + TypeScript + Vite
- **Status:** Accepted (pre-existing)
- **Date recorded:** 2026-10-24
- **Context:** `frontend/` was scaffolded with Vite (React 19, TypeScript 6, oxlint).
- **Decision:** Build the client as a React + TypeScript single-page app bundled by Vite. Lint with oxlint. Build = `tsc -b && vite build`.
- **Rationale:** Fast dev loop, typed domain models for manifests/contracts, static `public/` serving fits a sprite/audio asset library.

## D-002 — Runtime assets are tracked in Git
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Context:** Commit `662e89e` ("Stop tracking public folder") stopped tracking `frontend/public`. It was reversed by `2feab7d`/`f5209f9` (gitignore changes) and `69d03ab` ("Track frontend/public assets so collaborators can pull them").
- **Decision:** `frontend/public/` assets are committed to the repository.
- **Rationale:** Collaborators and other machines must be able to pull a working asset set. The earlier "don't track public" approach broke cross-machine sync.
- **Note:** The interim "do not track `frontend/public`" approach (commit `662e89e`) is considered superseded by this decision.

## D-003 — Character packs are data-driven
- **Status:** Accepted (pre-existing direction; manifest format still draft)
- **Date recorded:** 2026-10-24
- **Context:** `frontend/public/characters/maya/character.json` defines `id`, `displayName`, `defaultAnimation`, `animations{folder,fps,loop}`, `emotionMap`.
- **Decision:** Each character is a pack (folder + manifest). Application logic uses logical emotions; the pack maps emotion → animation. Generic renderer/audio/animation code must never hard-code Maya.
- **Rationale:** Supporting Phoenix, Edgeworth and custom characters should require only data/assets, not renderer rewrites.

## D-004 — Animation model: idle/talking loops plus one-shot reactions
- **Status:** Accepted (pre-existing direction)
- **Date recorded:** 2026-10-24
- **Decision:** Poses have `idle` and `talking` variants. Talking is driven by dialogue playback state (typewriter actively revealing), not guessed from text. One-shot reactions (`loop: false`, e.g. bow, shocked) interrupt and resolve to a stable idle. FPS lives in character data.
- **Rationale:** Matches Ace Attorney presentation; keeps timing configurable per character.

## D-005 — Centralized audio with separate categories
- **Status:** Accepted (pre-existing direction)
- **Date recorded:** 2026-10-24
- **Decision:** A single audio manager owns playback. Categories: dialogue blips, UI SFX, reaction/effect SFX, music. Music has independent volume, one active track, crossfades, and is never restarted if already playing.
- **Rationale:** Avoids duplicate playback on React re-renders and scattered `new Audio()` calls; respects autoplay policies in one place.

## D-006 — LLM proposes semantic intent; the app validates and executes
- **Status:** Accepted (pre-existing direction; schema not yet defined)
- **Date recorded:** 2026-10-24
- **Decision:** The LLM returns structured data (text + enumerated emotion/effect/music mood). It never supplies file paths or executable actions. Unknown values fall back safely. The renderer is LLM-vendor-agnostic.
- **Rationale:** Safety, robustness against malformed output, and swappable models.

## D-007 — Backend deferred
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Decision:** FastAPI/Ollama backend work is out of scope until explicitly requested. Frontend can be developed with scripted/mock dialogue first.
- **Rationale:** Presentation layer (rendering, animation, dialogue, audio) is the critical path and must be solid before integrating a model.

## D-008 — Runtime asset location convention
- **Status:** Open
- **Date recorded:** 2026-10-24
- **Context:** `CLAUDE.md` and the asset-pipeline skill prefer `frontend/public/assets/`. On disk, audio is under `public/assets/audio/`, but backgrounds (`public/backgrounds/`) and characters (`public/characters/`) are directly under `public/`.
- **Options:** (a) move backgrounds and characters under `public/assets/`; (b) accept the current split and document it as the convention.
- **Decision:** Not yet made. No assets were moved during initialization. Resolve before writing asset-loading code, so URLs are only written once.

## D-009 — Repository docs are the persistent project memory
- **Status:** Accepted
- **Date recorded:** 2026-10-24
- **Decision:** `docs/PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `ASSET_INVENTORY.md` and the append-only `SESSION_LOG.md` hold project-critical facts. They are updated at the end of every substantial task.
- **Rationale:** Work spans sessions and machines; conversation memory is not durable.
