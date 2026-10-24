# LLM Architecture — Courtroom Companion

_Provider-agnostic conversation layer (milestone 2026-10-24). See also `docs/CHARACTER_DIRECTOR.md`._

## Responsibilities (four layers)

| Layer | Decides | Where |
|---|---|---|
| **LLM** | **what** the character says (text + semantic intent per beat) | provider adapter → `CharacterReply` |
| **Character Director** | **how** the character performs it (pose, reaction, gesture, holds, settle) | `backend/app/director/` → `PerformanceTimeline` |
| **Dialogue paginator** | how that dialogue is **divided into DS-sized boxes** | `frontend/src/engine/performance.ts` (`paginate`, `wrapLines`) |
| **Presentation engine** | how each page is **rendered** (typewriter, blips, sprites, reactions) | existing React engine |

**beat ≠ dialogue page.** A beat is a semantic/emotional unit chosen by the model and directed
once. A page is a visual 3-line DS textbox. One beat may span several pages: every page keeps
the beat's emotion, pose and intensity, its reaction plays only on the first page, and the
director is never re-run for a page.

## Overview

```
React (ConversationScreen + ChatBar)
  │  POST /api/chat {character, message, sessionId}      (Vite dev proxy → :8000)
  ▼
FastAPI  backend/app/api/routes.py
  ▼
CharacterService  backend/app/characters/service.py
  │  CharacterRepository → CharacterProfile (character.json + performance.json + personality.md)
  │  prompt.py → system prompt + per-character JSON schema
  │  small in-memory history per (session, character)
  ▼
LLMGateway  backend/app/llm/gateway.py
  │  registry → provider adapter; timeout; exception isolation
  ▼
Provider adapter  backend/app/llm/providers/*.py   (only place with vendor code)
  ▼
RawCompletion (untrusted JSON/text)
  ▼
repair.py → validated CharacterReply   (shared parse + validate + repair)
  ▼
CharacterDirector  backend/app/director/director.py  → PerformanceTimeline
  ▼
JSON response {reply, performance, provider, warnings}
  ▼
frontend/src/engine/performance.ts → DialogueLine[] → existing dialogue / animation / blip engines
```

The renderer, animation engine, dialogue engine and character manifests are unaware of any
provider. Only adapters know vendor APIs.

## Provider adapter contract (`app/llm/base.py`)

```python
class LLMProvider(ABC):
    type: str                          # registry key, e.g. "ollama"
    capabilities: ProviderCapabilities # structured_output (native | json_instructed), streaming, tool_calling
    async def generate(self, request: GenerationRequest) -> RawCompletion
```

- `GenerationRequest`: `system_prompt`, `messages` (user/assistant turns), `response_schema`
  (JSON schema with this character's allowed IDs as enums), `settings` (temperature,
  max_tokens, timeout_s).
- `RawCompletion.content`: a JSON string, plain text, or an already-parsed dict.
- Adapters **must not** parse or validate, must not add personality rules, and must not
  include secrets in exceptions or logs. Raise `ProviderError` for vendor failures.
- The gateway (`LLMGateway.generate_reply`) is the conceptual
  `generate(messages, system_prompt, response_schema, settings) -> CharacterReply`. It wraps
  the adapter with a timeout, catches every exception, then runs the shared repair.

### Structured-output modes

| Mode | Meaning | Where |
|---|---|---|
| A — native | API enforces the JSON schema | adapter passes `response_schema` to the vendor |
| B — JSON instructed | model told to output JSON (system prompt includes the schema) | prompt.py, every provider |
| C — parse + validate + repair | fences, prose around JSON, bad types, unknown fields, missing fields | repair.py, every provider |
| D — safe fallback | nothing usable → the character's own `errorLine` | director |

### Adding a provider (onboarding)

1. Write `app/llm/providers/<name>.py` with an `LLMProvider` subclass that maps
   `GenerationRequest` → vendor call → `RawCompletion` (use `httpx.AsyncClient`; read the key
   via `config.resolve_api_key()`).
2. Register a factory in `DEFAULT_REGISTRY` (`gateway.py`).
3. Add adapter tests with a mocked HTTP transport (no real network in tests).
4. Nothing else changes: service, director, prompt, frontend and character packs stay as they are.

Recommended order: **Ollama** (local, no secrets, HTTP JSON; `format` supports JSON-schema
output), then **OpenAI-compatible** (one adapter covers OpenAI, Qwen/DashScope, Kimi/Moonshot,
LM Studio, vLLM, OpenRouter via `base_url`), then **Anthropic** (separate request shape;
JSON-instructed or tool-based structured output).

## CharacterReply schema (`app/llm/schemas.py`)

```json
{
  "beats": [
    { "text": "Hmm...", "emotion": "thinking", "intensity": 0.3, "reaction": null, "gesture": null },
    { "text": "Wait, WHAT?!", "emotion": "surprised", "intensity": 0.95, "reaction": "shocked" }
  ],
  "settleEmotion": "happy"
}
```

| Field | Rule |
|---|---|
| `beats` | 1–8 at contract level. Director limits per character (Maya: 3). |
| `text` | 1–600 chars, plain dialogue |
| `emotion` | semantic ID; unknown → character fallback |
| `intensity` | float 0.0–1.0, default 0.5 (repair also accepts "low/medium/high" and 0–10 scales) |
| `reaction` | optional one-shot ID; unknown → ignored |
| `gesture` | optional physical-expression ID; unknown or incompatible → ignored |
| `settleEmotion` | optional stable end emotion; unknown → stay in the last pose |

IDs are normalized to `^[a-z0-9_]{1,40}$`. Anything else (paths, URLs, markup) is discarded.
The model never names files, paths, URLs, components, CSS or actions. Its output is untrusted data.

## Character capabilities and personality

`CharacterRepository` reads the same pack the frontend renders from
(`frontend/public/assets/characters/<id>/`):

- `character.json`: emotions (→ animation, optional reaction), animations, reactions.
- `performance.json` (optional): director settings, gestures (→ animation + compatible
  emotions), intensity variants, emotion/reaction aliases, error line. Every reference is
  validated against `character.json`.
- `personality.md` (optional): the character bible, inserted into the system prompt.

`GET /api/characters/{id}/capabilities` exposes the logical summary. A new character pack
(Phoenix, Edgeworth…) needs only data: no code changes.

Model intelligence vs character: the base model comes from the provider config, while the
character layer (personality, capabilities, director settings) comes from the pack. Claude,
GPT, Qwen or Kimi + Maya all use the same Maya layer.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{status, provider: {type, model, capabilities}, characters}` |
| GET | `/api/characters/{id}/capabilities` | emotions, fallback, reactions, gestures |
| POST | `/api/chat` | `{character, message (1–2000), sessionId?}` → `{reply, performance, provider, warnings}` |

`reply` is the validated semantic reply (or null on provider failure). `performance` is the
director's resolved timeline. No credentials or base URLs are ever returned.

## Provider configuration and secrets (`app/llm/config.py`)

`ProviderConfig` separates **type**, **base_url**, **model**, **credentials**
(`api_key_env`: the *name* of an environment variable, never the key) and **settings**.

Environment variables (server only):

| Variable | Example |
|---|---|
| `COURTROOM_LLM_PROVIDER` | `fake` (default) / later `ollama`, `openai_compatible`, `openai`, `anthropic` |
| `COURTROOM_LLM_BASE_URL` | `http://localhost:11434` |
| `COURTROOM_LLM_MODEL` | `qwen2.5:7b` |
| `COURTROOM_LLM_API_KEY_ENV` | `OPENAI_API_KEY` (the backend reads the key from that variable) |
| `COURTROOM_LLM_TEMPERATURE` / `_MAX_TOKENS` / `_TIMEOUT_S` | generation settings |
| `COURTROOM_ASSETS_DIR` | override the character-pack root |

Secret handling:
- Keys live only in the backend process environment, are resolved at call time into
  `SecretStr`, and never appear in responses, logs or the frontend bundle.
- `.env` / `.env.*` are git-ignored (`.env.example` allowed for documentation).
- **Future:** a per-user "bring your own key" settings screen should store keys in the OS
  credential store (Windows Credential Manager / macOS Keychain via `keyring`) or, for
  hosted deployments, a secrets manager. The frontend would send a key once to a
  backend endpoint that stores it there. Keys are never kept in browser storage or
  committed config.

## Streaming (design only)

Not implemented. A future streaming mode would:

1. Ask the model for metadata first (beats' emotion/intensity/reaction), validate it, and
   start the reaction/pose.
2. Stream each beat's text as server-sent events (`/api/chat/stream`), feeding the existing
   typewriter, which already reveals text progressively.
3. Fall back to the non-streaming path when a provider lacks streaming or the metadata
   fails validation.

The adapter contract would gain an optional `async def stream(...) -> AsyncIterator[...]`
advertised via `capabilities.streaming`.

## Conversation memory (design only)

`CharacterService` keeps the last 12 messages per (session, character) in memory, with no
persistence. Future memory (summaries, long-term facts, retrieval) plugs in where the service
builds the message list, before `gateway.generate_reply`, without touching providers or the
director.

## Safety

Model output is untrusted. It can only produce dialogue text and IDs that are validated
against the character's capabilities. It cannot touch the filesystem, run commands, choose
URLs, asset paths, React components or CSS. The frontend re-validates the response shape
(`parseChatResponse`) before playing it.

## Setup

```
# backend (from repo root)
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest

# frontend (separate terminal)
cd frontend
npm run dev        # proxies /api → http://127.0.0.1:8000
```

Python 3.12+. On Python 3.15, install `uvicorn` without the `[standard]` extra (its
PyYAML dependency has no 3.15 wheel yet).
