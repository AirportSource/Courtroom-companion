# Windows standalone build

_Added 2026-10-24 (D-062). Development mode (`uvicorn` + `npm run dev`) is unchanged; this is an additional path._

## What the user gets

`dist/CourtroomCompanion.exe`: a one-file Windows executable (about 27 MB, default build). The target PC needs **no** Python, Node.js, npm, Vite, repository or PowerShell script.

Double-click flow:
1. The bootloader unpacks to `%TEMP%\_MEI…` and starts the app in-process. There is no separate Python child server and no console (release build).
2. If an instance is already running, the second launch opens the existing URL and exits.
3. The app binds one loopback socket (`127.0.0.1` only, never `0.0.0.0`) on the remembered port, or an OS-chosen port on first launch. FastAPI/Uvicorn serves `/api/*` and the built frontend from that socket.
4. Once the server reports started, the default browser opens `http://127.0.0.1:<port>/`.
5. The page sends a heartbeat every 15 s. About 120 s after the last tab closes, the server shuts down cleanly. If no browser ever connects, it waits 600 s; a long tick gap (sleep/resume) restarts the window.

## Build machine prerequisites

- Windows 10/11 x64.
- Python 3.12+ (developed with 3.15.1) with the backend venv: `cd backend; py -m venv .venv; .venv\Scripts\pip install -r requirements-build.txt`. `requirements-build.txt` = runtime requirements + pinned `pyinstaller==6.22.3`.
- Node.js + npm (the script runs `npm ci` if `frontend/node_modules` is missing).

## Build command (from the repository root)

```
backend\.venv\Scripts\python.exe scripts\build_windows.py --mode release --onefile --smoke
```

Other variants:

| Flags | Output | Use |
|---|---|---|
| `--mode debug --onedir` | `dist/CourtroomCompanion-debug/CourtroomCompanion.exe` (+ `_internal/`) | Console visible, resources inspectable, Ctrl+C stops the server |
| `--mode release --onefile` | `dist/CourtroomCompanion.exe` | User-facing, no console |
| `--skip-frontend-build` | | Reuse the existing `frontend/dist` |
| `--with-original-soundtrack` | | **Personal build only**: also bundle the locally present OST (see below) |
| `--smoke` | | Launch the built exe against a temporary data dir with `--no-browser`; check `/api/health`, `/`, `/api/app/info`; stop it and fail if any process remains |

The script runs `npm run build`, copies `frontend/dist` into `build/frontend_stage`, prunes the soundtrack unless asked, and runs PyInstaller with `packaging/CourtroomCompanion.spec`. It fails loudly if a command fails or the output exe is running or locked. `dist/` and `build/` are git-ignored.

Launcher flags: `--no-browser` or `COURTROOM_NO_BROWSER=1` skips opening the browser (automation).

## Immutable resources vs mutable data (`backend/app/runtime/paths.py`)

| Kind | Development | Packaged (frozen) |
|---|---|---|
| Frontend build | `frontend/dist` (served only in desktop mode) | `_MEIPASS/frontend_dist` |
| Runtime assets (character packs, UI, SFX, ringtones…) | `frontend/public/assets` | `_MEIPASS/frontend_dist/assets` |
| Data root | `backend/.local` (unchanged) | `%LOCALAPPDATA%\CourtroomCompanion` |

Mutable-path precedence (first match wins): the store's own variable (`COURTROOM_OUTPUTS_DIR`, `COURTROOM_MUSIC_DIR`, `COURTROOM_CONVERSATION_RECORD_DIR`, `COURTROOM_LOG_DIR`), then `COURTROOM_CONFIG_DIR` as the base, then the frozen LocalAppData root, then the dev `backend/.local`. Resources: `COURTROOM_FRONTEND_DIST` / `COURTROOM_ASSETS_DIR`, then the bundle, then the repository. In a frozen build a mutable path that resolves inside the bundle raises an error, so nothing is ever written beside the exe or into `_MEI…`.

LocalAppData tree created by a packaged session:

```
%LOCALAPPDATA%\CourtroomCompanion\
├── config\provider-profiles.json        provider profiles (no secrets)
├── conversation-record\records.json     Conversation Record (D-058)
├── outputs\artifacts.json, files\<id>.text   generated files (D-052)
├── music\                               imported music (created on first import)
├── logs\courtroom-companion.log         rotating 1 MB × 3, redacted
└── instance\instance.json, preferred-port.json   live instance + remembered port
```

Browser settings (ringtone, volumes, music source, panels) stay in the browser's `localStorage`, which is per origin. The remembered port keeps the origin stable across restarts. If that port is ever taken, the app uses another port for the session and logs a warning that settings will appear reset. Delete `preferred-port.json` to re-pick.

## Credentials

API keys are never bundled. The exe uses the same OS CredentialStore (Windows Credential Manager via `keyring.backends.Windows.WinVaultKeyring`, confirmed in the packaged log). On a new PC, configure provider keys in Settings. Logs redact keys and authorization headers.

## Original soundtrack policy

`frontend/public/assets/music/original/` (Capcom OST, about 58 MB) is **not** part of the default build: the script removes it and `music/soundtrack.json` from the staged frontend. The default exe therefore offers Game music without tracks (it plays nothing); imported music and radio work normally. `--with-original-soundtrack` bundles the locally present files for the owner's own personal build only. Such an exe must not be redistributed. Other bundled runtime assets (sprites, SFX, UI) are third-party material documented in `ASSET_SOURCES.md`. Source folders (`docs/references`, `docs/sfx general`, `docs/original_tracks`, `docs/websites`) are never read by the build.

## Startup failures

Failures (no port, missing frontend, initialization error) are logged with a traceback. The release build shows a Windows message box naming the log file. The debug build prints to the console. The exit code is 1.

## Known limitations

- Force-killing the one-file bootloader (Task Manager) stops the server child cleanly (parent watch), but the bootloader cannot delete its `%TEMP%\_MEI…` folder. Normal shutdown via the heartbeat cleans it.
- No icon (no legitimate project icon exists), no installer, no code signing (SmartScreen may warn), no auto-update.
- Closing the browser does not stop the server immediately; it exits about 2 minutes later.
