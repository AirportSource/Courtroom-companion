# Courtroom Companion — backend

FastAPI character service: provider-agnostic LLM gateway + deterministic Character Director.
Architecture: `../docs/LLM_ARCHITECTURE.md`, `../docs/CHARACTER_DIRECTOR.md`.

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # Windows
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest
```

The default provider is `fake` (offline, deterministic). Ollama is also available through the
Settings screen or `COURTROOM_LLM_PROVIDER=ollama`, `COURTROOM_LLM_BASE_URL` (default
`http://localhost:11434`) and `COURTROOM_LLM_MODEL`. Start Ollama separately with `ollama serve`
and inspect installed models with `ollama list`; the app never downloads models. Ollama needs no
API key. Never put provider API keys in files committed to git.

Settings → AI Profile manages backend profiles (Add, Edit, Duplicate, Delete) and activates one
for chat. Configure an OpenAI-compatible profile's base URL/model, Save Profile, then Set API Key.
The password is sent once to the local backend and stored through Python keyring in the OS vault;
only Configured / Not configured returns. Run the backend in your normal Windows login session
for Windows Credential Manager access. No restart is needed to switch profiles or replace keys.

Metadata lives in ignored `backend/.local/provider-profiles.json` (override the directory with
`COURTROOM_CONFIG_DIR`). Use one backend worker. Complete old non-secret browser settings are
imported once; active profile metadata is then server-authoritative. Chat now accepts only
character/message/session data; stale per-turn provider overrides receive HTTP 409.

Environment-only operation remains supported: a new configuration directory is seeded from
`COURTROOM_LLM_*`, and cloud profiles can use `COURTROOM_LLM_API_KEY` or an `apiKeyEnv` reference
such as `GEMINI_API_KEY`. OS credentials take precedence. No plaintext credential-file fallback
exists if the vault is unavailable. Gemini's compatible URL is
`https://generativelanguage.googleapis.com/v1beta/openai/`; model `gemini-3.8-flash`.
