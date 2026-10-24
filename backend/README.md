# Courtroom Companion — backend

FastAPI character service: provider-agnostic LLM gateway + deterministic Character Director.
Architecture: `../docs/LLM_ARCHITECTURE.md`, `../docs/CHARACTER_DIRECTOR.md`.

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # Windows
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest
```

The default provider is `fake` (offline, deterministic). Configure providers with
`COURTROOM_LLM_*` environment variables. Never put API keys in files committed to git.
