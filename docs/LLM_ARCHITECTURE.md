# LLM Architecture — Courtroom Companion

_Provider-agnostic conversation layer with FakeProvider, OllamaProvider, OpenAICompatibleProvider and local provider profiles / OS credentials (2026-10-24). See also `docs/CHARACTER_DIRECTOR.md`._

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
  │  ProfileManager → active ProviderProfile + CredentialStore → existing ProviderConfig
  │  new gateway for this turn, using the existing registry
  ▼
CharacterService  backend/app/characters/service.py
  │  CharacterRepository → CharacterProfile (character.json + performance.json + personality.md)
  │  prompt.py → system prompt + per-character JSON schema
  │  small in-memory history per (session, character)
  ▼
LLMGateway  backend/app/llm/gateway.py
  │  registry → provider adapter; timeout; exception isolation
  ▼
Provider adapter  backend/app/llm/providers/*.py   (Fake, Ollama or OpenAI-compatible; only place with vendor code)
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
- `RawCompletion.content`: a JSON string, plain text, or an already-parsed dict. Optional
  transport timing/token metadata stays separate and is never part of `CharacterReply`.
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
   via `config.resolve_api_key()`, which already handles a resolved profile credential or env fallback).
2. Register a factory in `DEFAULT_REGISTRY` (`gateway.py`).
3. Add adapter tests with a mocked HTTP transport (no real network in tests).
4. For a new native provider, extend the profile provider type, credential-using type set and
   relevant Settings form fields. Reuse CredentialStore; no provider gets its own key storage.
   Service, director, prompts, paginator and character packs require no changes.

Implemented providers: **Ollama** (local, no secrets, native HTTP JSON and JSON Schema through
`format`) and one generic **OpenAI-compatible** adapter (Chat Completions plus
`response_format.json_schema`). Gemini, OpenAI, Qwen/DashScope, Kimi/Moonshot, LM Studio,
vLLM and OpenRouter are configurations of that adapter, not new provider classes. Next:
**Anthropic** (separate request shape; JSON-instructed or tool-based structured output).

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
| GET | `/api/providers/ollama/models?baseUrl=…` | Backend-proxied `/api/tags`; installed model metadata |
| POST | `/api/providers/ollama/test` | Tags + schema-constrained generation test, with no conversation history |
| GET | `/api/providers/openai-compatible/status` | Boolean backend API-key configuration state; never the key or env name |
| POST | `/api/providers/openai-compatible/test` | Schema-constrained Chat Completions test, with no conversation history |
| POST | `/api/chat` | `{character, message (1–2000), sessionId?}` → `{reply, performance, provider, warnings}` |
| GET / POST | `/api/provider-profiles` | List metadata/status or create a profile |
| PUT / DELETE | `/api/provider-profiles/{id}` | Edit metadata or delete profile and its stored key |
| POST | `/api/provider-profiles/{id}/activate` | Persist the one server-authoritative active profile |
| POST | `/api/provider-profiles/{id}/duplicate` | Independent profile and OS credential reference |
| GET / PUT / DELETE | `/api/provider-profiles/{id}/credential` | Boolean status / set-or-replace / remove; GET never returns a key |
| GET | `/api/provider-profiles/{id}/models` | Ollama discovery for this saved profile |
| POST | `/api/provider-profiles/{id}/test` | Shared schema generation using profile configuration/credential, with no history |
| POST | `/api/provider-profiles/import-legacy` | Idempotent import of old non-secret browser settings |

`reply` is the validated semantic reply (or null on provider failure). `performance` is the
director's resolved timeline. Chat never returns credentials or endpoint URLs. Profile management
returns editable, validated endpoint metadata and credential references/status, never key values.

`/api/chat` uses the backend's active saved profile. The old per-request `provider` object is
rejected with HTTP 409 so a stale client cannot override the active selection. The profile is
resolved once for the turn; switching affects the next turn without replacing CharacterService
or its history/director state. Provider configuration never comes from model output.

The older Ollama and compatible-provider discovery/test routes remain for compatibility with
existing integrations. Settings now uses profile-scoped testing and discovery.

## Provider profiles and credentials (`app/configuration/`)

`ProfileDraft` / `ProviderProfile` contain `id` (server-generated UUID hex), `name`,
`providerType`, optional `baseUrl` / `model`, optional backend-owned `credentialRef`, optional
`apiKeyEnv` (environment variable name only), and `generationSettings` (the existing generic
temperature, token and timeout settings). Network profiles require a valid URL and model.
Fake has no network/credential configuration; local Ollama needs no key. Unknown/extra input
fields and unsupported provider types are rejected. Credential references are scoped to their
profile, e.g. `courtroom:profile:<uuid>`, never accepted as arbitrary browser input.

`ProfileStore` persists versioned metadata, the active profile ID and a one-time migration flag
at **`backend/.local/provider-profiles.json`**. `COURTROOM_CONFIG_DIR` overrides the directory.
`backend/.local/` is git-ignored. Writes use a same-directory temporary file, flush/fsync and
atomic replace; failed writes preserve the previous in-memory and on-disk catalog. Corrupt
existing data is reported and never silently overwritten. A thread lock serializes mutations;
run one local backend worker (cross-process concurrent writers are not supported).

`CredentialStore` exposes `get`, `set`, `delete` and `exists`. `KeyringCredentialStore` uses
Python `keyring` under service name `Courtroom Companion`, selecting only native Windows
Credential Manager (`keyring.backends.Windows.WinVaultKeyring`), macOS Keychain, Linux Secret
Service or KWallet implementations. Plaintext/third-party file fallbacks are rejected. Missing,
locked or unavailable OS storage produces a sanitized error; there is no local plaintext key
file. Tests inject an in-memory keyring backend and never access a real user vault.

Resolution is **profile OS credential → configured environment reference → missing key**. If
the OS vault is unavailable, an available env secret still works. `ProfileManager.resolve`
binds a transient `SecretStr` to a private, non-serialized `ProviderConfig` attribute; adapters
still call `resolve_api_key()` and know nothing about profiles, persistence or UI.

Duplication copies a stored key inside the backend to a new independent reference. Removing
or replacing that key cannot alter the source profile. Profile deletion removes its OS entry;
the last profile cannot be deleted. Removing an OS key leaves an explicitly configured env
fallback usable, and Settings shows when that fallback supplies the configured state.

Settings offers a profile dropdown and Add/Edit/Duplicate/Delete, using a scrollable fixed-label
form inside the unchanged 256×192 stage. Password entry exists only as transient component state;
one PUT sends the new key to the local backend, then success clears/removes the input. Switching,
cancelling and unmounting also discard the entry. Existing keys are never redisplayed. JSON
validation responses omit submitted values so invalid requests cannot echo a secret. Profile
responses use `Cache-Control: no-store`; the local configuration API rejects remote hosts and
cross-origin browser access while supporting the same-origin Vite proxy. Normal access logs
contain method/path/status, never request bodies or Authorization values.

First use seeds a profile from a valid `COURTROOM_LLM_*` configuration (Fake by default). The
frontend imports complete legacy Ollama/compatible settings once and preserves a non-Fake
environment default. It then removes migrated AI metadata from browser storage; only display/
audio preferences and a migration marker remain. Incomplete legacy entries remain available
as migration snapshots, with a warning, until corrected; a saved Ollama recovery uses the old
server as the editor default. Saved profiles are authoritative afterward. For independent CI/
headless configuration, use a separate `COURTROOM_CONFIG_DIR`; env-only secrets still work.

## Provider configuration and secrets (`app/llm/config.py`)

`ProviderConfig` separates **type**, **base_url**, **model**, **credentials**
(`api_key_env` plus an optional private resolved credential) and **settings**. It is a transient
adapter configuration, not the persisted profile or a browser response model.

Environment variables (server only):

| Variable | Example |
|---|---|
| `COURTROOM_LLM_PROVIDER` | `fake` (default), `ollama`, or `openai_compatible`; later `anthropic` |
| `COURTROOM_LLM_BASE_URL` | `http://localhost:11434` or an OpenAI-compatible API prefix |
| `COURTROOM_LLM_MODEL` | installed/hosted model ID |
| `COURTROOM_LLM_API_KEY` | default backend-only secret used by `openai_compatible` |
| `COURTROOM_LLM_API_KEY_ENV` | optional override naming another server environment variable, e.g. `GEMINI_API_KEY` |
| `COURTROOM_LLM_TEMPERATURE` / `_MAX_TOKENS` / `_TIMEOUT_S` | generation settings |
| `COURTROOM_ASSETS_DIR` | override the character-pack root |
| `COURTROOM_CONFIG_DIR` | local profile metadata directory; default `backend/.local` |

Secret handling:
- Keys live in the OS vault or backend environment, are resolved at call time into
  `SecretStr`, and never appear in responses, logs, profile files or the frontend bundle.
- `.env` / `.env.*` are git-ignored (`.env.example` allowed for documentation).
- The local Settings credential endpoint writes through CredentialStore. A hosted secrets
  manager can later implement that same interface without changing adapters.

Base URLs are trimmed and trailing slashes removed; only HTTP(S) URLs without embedded
credentials, query strings or fragments are accepted. Ollama defaults to
`http://localhost:11434`. It requires no API key. OpenAI-compatible requests resolve
`COURTROOM_LLM_API_KEY` by default; `COURTROOM_LLM_API_KEY_ENV` can name a different backend
environment variable without exposing its value.

## OllamaProvider

`backend/app/llm/providers/ollama.py` uses Ollama's native API:

- `POST /api/chat`: system prompt plus shared history, configured model, `stream: false`,
  `think: false`, generic temperature/token options, and the exact per-character
  `reply_schema(profile)` object in `format`.
- `GET /api/tags`: installed-model discovery. Courtroom Companion returns name/model,
  parameter size, quantization level and byte size when Ollama provides them. It lists models
  without claiming every installed model is suitable for chat or structured output.
- Only `message.content` becomes `RawCompletion.content`. `message.thinking` is ignored and is
  never validated, stored in conversation memory or rendered. Ollama duration/token fields may
  be retained as adapter metadata, separate from `CharacterReply`.

Ollama transport failures are typed and sanitized: unreachable server, timeout, missing model,
non-success HTTP, malformed JSON, missing `message.content`, and empty output. The gateway never
falls back to FakeProvider. Normal chat uses the existing character error-line performance on a
provider failure; discovery/test endpoints return bounded status information without Python
tracebacks or upstream response bodies.

The Settings screen edits backend provider profiles with server URL and selected model.
The browser calls only the Courtroom Companion backend. Refresh distinguishes reachability and
model-list loading; Test Connection distinguishes a missing selected model, structured generation
failure and success. Its generated reply goes through the shared schema/repair path but bypasses
CharacterService sessions, so it cannot pollute normal history.

## OpenAICompatibleProvider

`backend/app/llm/providers/openai_compatible.py` uses the standard non-streaming Chat
Completions request at `POST {baseUrl}/chat/completions`:

- `Authorization: Bearer <backend secret>`; `SecretStr` comes from profile credential
  resolution on the server (OS vault first, configured environment reference second).
- Shared system prompt and history, configured model, `stream: false`, temperature and
  `max_tokens`.
- The exact existing per-character schema as
  `response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`.
- Only `choices[0].message.content` becomes `RawCompletion.content`; usage and finish reason
  remain optional provider metadata outside `CharacterReply`.

The adapter never changes or retries the schema. An endpoint that rejects native structured
output fails with `structured_output_unsupported`; a schema-shaped response that still fails
shared validation becomes `invalid_reply`. A later compatibility fallback can be added at the
generic provider layer without changing CharacterReply, CharacterService or the director.

Typed, sanitized failures distinguish missing backend secret, 401/403 authentication, 429 rate
limit, model/request rejection, structured-output rejection, timeout/unreachable server,
non-success HTTP, malformed response and empty content. No upstream body, key or traceback is
returned to the browser. Normal chat keeps the established character error-line behavior and
never falls back to FakeProvider.

Settings persists profile metadata on the backend. It displays Configured / Not configured,
allows password-based set/replace and removal, and runs a history-free profile Test Connection
through the shared prompt, schema and gateway repair. No key enters `localStorage`.

Gemini is the requested target configuration, not adapter logic:

```text
base URL = https://generativelanguage.googleapis.com/v1beta/openai/
model    = gemini-3.8-flash
secret   = COURTROOM_LLM_API_KEY (or COURTROOM_LLM_API_KEY_ENV=GEMINI_API_KEY)
```

## Streaming (design only)

Not implemented at application level. Ollama and OpenAI-compatible endpoints advertise streaming
capability, but both adapters always send `stream: false`. A future provider-generic streaming
mode would:

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

### Local Ollama startup (Windows PowerShell)

```powershell
# Install Ollama separately, then start it if the desktop/service is not already running.
ollama serve

# In another terminal, inspect locally installed models.
ollama list

# Only when the user explicitly chooses to download one:
ollama pull <model-name>

# Start Courtroom Companion's backend (defaults to FakeProvider).
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# Start the frontend in another terminal, then choose Ollama in Settings,
# refresh models, select one, and test the connection.
cd frontend
npm run dev
```

Alternatively make Ollama the server default before starting Uvicorn:

```powershell
$env:COURTROOM_LLM_PROVIDER = 'ollama'
$env:COURTROOM_LLM_BASE_URL = 'http://localhost:11434'
$env:COURTROOM_LLM_MODEL = '<installed-model-name>'
$env:COURTROOM_LLM_TIMEOUT_S = '120'
```

The app never downloads a model automatically. Cold starts use a 120-second backend generation
timeout and a slightly longer frontend wait, while model discovery keeps a short timeout.

### OpenAI-compatible / Gemini configuration (Windows PowerShell)

Preferred local workflow: start the backend and frontend with the Setup commands above, open
Settings → Add → OpenAI Compatible, enter a name/base URL/model, and Save Profile. Choose Set
API Key, enter it in the password field, and Save API Key. Test Connection and select profiles
from the dropdown. No environment edits or backend restart are needed for profile/key changes.

For environment-only usage instead, start the backend with a backend-only secret:

```powershell
$env:COURTROOM_LLM_API_KEY = '<api-key>'
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Then choose OpenAI Compatible in Settings. The supplied starter configuration is
`https://generativelanguage.googleapis.com/v1beta/openai/` with `gemini-3.8-flash`, and both
fields remain editable for other compatible services.

To reuse a vendor-specific environment variable without copying its value:

```powershell
$env:COURTROOM_LLM_API_KEY_ENV = 'GEMINI_API_KEY'
```

To seed the compatible provider as the initial profile in a new config directory:

```powershell
$env:COURTROOM_LLM_PROVIDER = 'openai_compatible'
$env:COURTROOM_LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
$env:COURTROOM_LLM_MODEL = 'gemini-3.8-flash'
$env:COURTROOM_LLM_API_KEY = '<api-key>'
```

Python 3.12+. On Python 3.15, install `uvicorn` without the `[standard]` extra (its
PyYAML dependency has no 3.15 wheel yet).

On Windows run the backend in the normal logged-in user session to access Credential Manager.
An isolated sandbox may return OS error 1312 (no logon session); this is not a reason to use
plaintext storage. Use env fallback for headless/sandbox operation. The milestone's real vault
probe and browser lifecycle succeeded in the normal Windows session with synthetic credentials;
normal tests require no OS vault, Ollama instance or cloud key.
