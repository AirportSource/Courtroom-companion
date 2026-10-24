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
