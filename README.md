# Courtroom Companion

An Ace Attorney (Nintendo DS) style conversational companion: AI-driven characters (Maya Fey, Mia Fey,
Dick Gumshoe) with native DS sprites, typewriter dialogue, blips, music and courtroom flourishes.

- **Frontend:** React + TypeScript + Vite (`frontend/`)
- **Backend:** FastAPI (`backend/`): provider-agnostic LLM gateway (Fake, Ollama, OpenAI-compatible,
  Anthropic, Claude/ChatGPT subscriptions) + deterministic Character Director
- **Languages:** English, French, Japanese, Italian, Spanish
- **Features:** present evidence (text, images, PDF), character tools (reminders, authorized folders,
  web search), event inbox and a Claude Code companion, voiced "Objection!" / 「異議あり！」 shouts

Project memory and decisions live in `docs/` (start with `docs/PROJECT_STATE.md`).

## Setup (Windows)

Requirements: Python 3.12+, Node.js 22+.

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
```

```bash
cd frontend
npm ci
```

### Original soundtrack (not included)

The OST MP3s are © Capcom and are not stored in this repository. Download the **VBR MP3 ZIP**
(38 files, about 84 MB) from https://archive.org/details/pwaa-original-soundtrack, then:

```bash
python scripts/install_ost.py path/to/pwaa-original-soundtrack.zip
```

The app runs without it; only "Game music" stays silent. Imported music and the radio still work.

## Run

Backend (port 8000):

```bash
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Frontend (port 5173, proxies `/api` to the backend):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

## Connect an AI

In the app: **Settings → AI Profile**. Add a profile (Anthropic, OpenAI-compatible such as OpenAI or
Gemini, or Ollama), save it, then **Set API Key** (stored in the OS credential vault, never in a file)
and **Test Connection**.

To use your own **Claude** or **ChatGPT** subscription instead of an API key, install and log in to the
official CLI once (`npm install -g @anthropic-ai/claude-code` then `claude login`, or
`npm install -g @openai/codex` then `codex login`), then add a **Claude (subscription)** or
**ChatGPT / Codex (subscription)** profile. No key is needed; usage counts against your plan. These
modes read text evidence only (images and PDFs need an API profile).

The built-in **Fake** profile works offline for testing; offline test commands
include `#remind`, `#reminders`, `#folder`, `#read <path>`, `#search <query>`, `#artifact-md`.

## Claude Code companion (optional)

Characters can comment on Claude Code activity (task finished, tests passed/failed, waiting for you):

```bash
node scripts/install-claude-code-hook.mjs --dry-run
```

Run it without `--dry-run` to add async hooks to `~/.claude/settings.json` (existing hooks are kept,
a backup is written; `--uninstall` removes them). Details: `docs/AGENTS_AND_EVENTS.md`.

## Checks

```bash
cd frontend
npm test
npm run lint
npm run build
npm run validate:assets
```

```bash
cd backend
.venv/Scripts/python -m pytest
```

## Credits

Characters, sprites, music, sound effects and voice clips are © Capcom (Phoenix Wright: Ace Attorney),
used for a personal, non-commercial fan project. Sprite sheets ripped by Shoda; other sources and credits
are listed in `docs/ASSET_SOURCES.md`. Fonts: Igiari (Caveras) and DotGothic16 (see their licences).
