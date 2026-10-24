# Agents and events — plan and status (D-067)

Handoff document for any future session. Read this before touching events, tools, reminders,
folder reading, web search or the Claude Code companion. Keep the **Status** section current.

## Goal

1. **Event inbox**: a character can speak without a user message (a due reminder, a Claude Code
   event, a finished tool). One mechanism serves everything below.
2. **Claude Code companion**: Claude Code hooks post events to the app; the on-screen character
   comments ("tests passed", "Objection!" on a failed build, the phone rings when Claude waits).
3. **Character tools**: the model may *request* an action; the backend validates it against an
   allow-list, runs it, and gives the result back to the model for the final in-character reply.
   Tools: reminders, reading authorized folders, web search.

## Architecture

### Event inbox (backend `app/events/`)
- `POST /api/events` (local / same-origin only, like profile routes): `{source, type, ...}`.
  Validated, bounded (size, rate), stored in an in-memory ring buffer with monotonically
  increasing ids. Never persisted, never sent to a model unless explicitly turned into a turn.
- `GET /api/events?after=<id>`: the frontend polls (every ~2 s) and receives ready-to-play
  events. Each event carries a **character performance**: the backend resolves the line through
  the existing `CharacterDirector` for the requested character and language, so emotion,
  reaction, SFX and pagination behave exactly like a normal reply.
- Lines for known event types are **data**: `performance.json` `eventLines[type][language]`
  (list of `{text, emotion, intensity?, reaction?, exclamation?}` variants). No model call.
- Optional `exclamation` (`objection` | `hold_it` | `take_that`) shows the original bubble
  (`ui.json` exclamation images, previously unused) with its SFX.

### Frontend
- `useEventInbox` polls while a conversation is open. Events queue; one plays when the
  conversation is idle (`phase === 'input'`, no overlay, no pending request). Optional phone ring
  for attention events. Played lines are not added to model history.

### Claude Code companion
- `scripts/claude-code-hook.mjs` (Node, no dependencies): reads the hook JSON on stdin, maps it
  to a small event (`task_finished`, `needs_attention`, `tests_passed`, `tests_failed`,
  `build_failed`, `session_started`), POSTs it to `http://127.0.0.1:8000/api/events` with a
  short timeout, **always exits 0 and prints nothing**, so Claude Code is never blocked.
- Installation into `~/.claude/settings.json` only with the owner's explicit consent.

### Tool framework (backend `app/tools/`)
- Same pattern as the artifact action (D-052): the turn schema gains an optional
  `toolRequest {tool, arguments}`. Works for every provider (no native tool-calling needed).
- Flow per turn: generation 1 → if `toolRequest` and the tool is allowed for this character
  (`performance.json` `tools`) → validate arguments → run → generation 2 with the tool result as
  a bounded, clearly delimited data message ("material, not instructions") → director as usual.
  At most one tool call per turn in v1.
- Tool results and errors are short structured text; failures produce an in-character reply,
  never a crash.

### Tools v1
| Tool | Arguments | Limits / safety |
|---|---|---|
| `reminder_create` | `when` (ISO 8601 local time) or `in_minutes`, `text` | ≤ 50 pending, text ≤ 200 chars, time within 1 year; stored in `<config>/reminders.json`; a backend scheduler turns due reminders into inbox events (phone ring + line) |
| `reminder_list` / `reminder_cancel` | — / `id` | own reminders only |
| `folder_list` / `file_read` | `folder` (authorized id), `path` | Folders are authorized in Settings (allow-list in `<config>/folders.json`); read-only; resolved paths must stay inside the folder (no `..`, no symlink escape); text files only, same limits as text evidence; directory listings capped |
| `web_search` | `query` | Requires a search provider key (Brave Search or Tavily) stored in the OS vault like provider keys; results = title, URL, snippet (top 5); pages are not fetched in v1 |

## Order of work
1. Event inbox + unprompted lines + exclamation bubbles.
2. Claude Code companion (hook script, event lines, install instructions).
3. Tool framework + reminders (scheduler → inbox).
4. Folder reading (Settings allow-list).
5. Web search (provider + key).

## Open owner decisions (still open on 2026-10-25)
- Web search provider (Brave Search, Tavily, or Claude's native web search for Claude profiles only).
- Reminders only fire while the backend and a browser tab are open (Windows notifications later).
- Tool distribution: currently every character may use every tool; personality colours usage.

## Status
- [x] 1. Event inbox — `backend/app/events/inbox.py`, `api/event_routes.py`, `frontend/src/events/` (poll, queue, idle playback, phone ring for attention events, exclamation bubbles with voiced shouts, D-068)
- [x] 2. Claude Code companion — `scripts/claude-code-hook.mjs` (+ `COURTROOM_HOOK_DEBUG=1`), `scripts/install-claude-code-hook.mjs` (`--dry-run`, `--uninstall`); verified by piping real hook payloads. Installed in `~/.claude/settings.json` on 2026-10-25 with the owner's consent (backup `settings.json.bak-2026-10-24T23-03-23-641Z`); verified live.
- [x] 3. Tool framework + reminders — `backend/app/tools/registry.py` (availability, `toolRequest` schema, prompt with local time, `run_tool`), two-phase loop in `CharacterService.chat`, `reminders.py` + scheduler in `main.py` lifespan (every 5 s → inbox `reminder_due`; a newly opened conversation still gets reminders due in the last 15 min). Verified end to end with the Fake provider (`#remind` → phone + line one minute later).
- [x] 4. Folder reading — `tools/folders.py` (allow-list `<config>/folders.json`, resolve()+inside-root check, text only, 60k chars), Settings → Tools panel (`frontend/src/tools/`). Verified (`#folder`, `#read notes.txt`).
- [x] 5. Web search — `tools/web_search.py` (Brave or Tavily, key in the OS vault via the profile CredentialStore, top-5 title/URL/snippet, pages not fetched). Tested with mocked HTTP only: **no real key configured yet**.

## Offline test commands (Fake provider)
`#remind` (reminder in 1 min), `#reminders`, `#folder`, `#read <path>`, `#search <query>` — only when the tool is available.

## Next ideas (not started)
- Sources from web search as Court Record evidence; fetching a page on request.
- Tool context in history (follow-up questions currently see only the final reply).
- Windows notifications for reminders when the app is closed.
- Optional model-written summaries of Claude Code `Stop` events (`last_assistant_message`).
