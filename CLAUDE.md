# Courtroom Companion — Claude Code Project Instructions

## Always-on rules

- Treat the actual repository filesystem as the source of truth.
- Before broad edits, inspect existing architecture and relevant manifests.
- Never invent asset filenames or paths.
- Runtime assets are expected under `frontend/public/assets/` unless the repository establishes a different current convention.
- Preserve generic architecture: do not hard-code Maya into reusable renderer/audio/animation components.
- Do not delete or overwrite untracked game assets.
- Search references before moving or renaming files.
- Prefer small, testable changes.
- Run relevant existing checks after code changes.
- Do not commit, push, force-reset, or rewrite Git history unless explicitly requested.
- The FastAPI/Ollama backend is out of scope until explicitly requested.

## Project direction

Courtroom Companion is an Ace Attorney-style conversational interface:
- React + TypeScript + Vite frontend;
- character packs with logical emotion -> animation mapping;
- idle/talking sprite animation;
- typewriter dialogue with character blips;
- SFX and music managed centrally;
- later, a structured LLM response contract and local LLM backend.

## Useful project skills

Claude may load the appropriate project skill automatically. They can also be invoked explicitly:

- `/repo-inspector`
- `/asset-pipeline`
- `/character-engine`
- `/animation-engine`
- `/audio-engine`
- `/react-ui`
- `/llm-contract`
- `/testing`
- `/debugging`
- `/git-safety`
- `/ace-attorney-behavior`

## Persistent project memory

The repository documentation is the persistent memory of this project.

At the beginning of a substantial task, read when relevant:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/ASSET_INVENTORY.md`

At the end of every substantial completed task:

1. Update `docs/PROJECT_STATE.md` if the actual project state changed.
2. Update roadmap checkboxes/status if milestones changed.
3. Record important architectural decisions in `docs/DECISIONS.md`.
4. Update `docs/ASSET_INVENTORY.md` when assets are added, removed, renamed or reorganized.
5. Append a concise entry to `docs/SESSION_LOG.md`.

Do not rely on conversation memory for project-critical facts when they can be recorded in the repository.

Never silently rewrite historical decisions or session-log entries.