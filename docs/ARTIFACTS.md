# Generated text artifacts — milestone 2 of 3

The application can save small `.txt`, `.md` and `.py` files proposed by any existing LLM provider. Python is stored and downloaded as UTF-8 text; the application never executes, imports or compiles it. JSON is intentionally outside this initial allowlist.

## Turn contract and ownership

`CharacterReply`, the director, paginator and existing presentation machine retain their contracts. An artifact-capable conversation uses a shared turn envelope: the existing `beats` / `settleEmotion` plus an optional, separate `artifactAction`:

```json
{
  "beats": [{"text": "Your file is ready below.", "emotion": "happy", "intensity": 0.4}],
  "settleEmotion": "happy",
  "artifactAction": {
    "type": "create_text_artifact",
    "filename": "hello.py",
    "format": "py",
    "content": "print('Hello')\n"
  }
}
```

`app/artifacts/contracts.py` derives the envelope from the existing character reply schema. The existing character prompt, personality and capabilities are reused with one provider-independent artifact instruction. The model decides whether an explicitly requested saved file is appropriate; ordinary conversation omits/nulls the action. No frontend keyword detector or extra model call is used.

The shared gateway first strictly validates the action (`extra=forbid`, strict types), then uses the existing dialogue parse/repair. Invalid actions are never repaired into filesystem operations. File content stays out of CharacterReply, director input and assistant history. A valid action is handled by CharacterService before its final reply is directed/delivered. Failure replaces the model's success acknowledgement with the existing character error-line performance.

Providers only transport the shared schema through their existing structured-output mechanism. The native Anthropic schema projection remains the existing generic projection. No provider owns storage or character/task behavior. Profile Test Connection still uses the dialogue-only schema and cannot create files.

For offline demonstration, Fake supports explicit `#artifact-txt`, `#artifact-md`, `#artifact-py` fixtures. Its ordinary messages and existing test triggers retain their behavior. Real providers interpret explicit requests such as “Create a Python script called hello_maya.py that prints Hello from Maya.”

## Storage and limits

- Default: `backend/.local/outputs/`; follows `COURTROOM_CONFIG_DIR`, or a backend operator can set `COURTROOM_OUTPUTS_DIR`. `.local` is already ignored by Git.
- Backing names are server UUIDs: `files/<id>.text`, regardless of display extension. Neither browser nor model selects a path.
- `artifacts.json` holds versioned metadata, content hashes and hashed request receipts. Public metadata includes `id`, `displayName`, `extension`, `mimeType`, `createdAt`, `sizeBytes`, `status` (`ready` / `missing`) and a ≤1,000-character `contentPreview`. Internal hashes/paths/receipts are not returned.
- Maximum: **64 KiB UTF-8 per file**, **200 catalogued files**, **8 MiB total backing content** (including orphan/interrupted files), **2,000 persistent request receipts**. Limits fail clearly; content is never truncated into a different file. Empty/whitespace-only, NUL and invalid-Unicode content are rejected.
- Display names discard path components, control/bidi characters and Windows-forbidden characters, normalize Unicode, protect reserved Windows names and cap length. A suffix must match the declared format; unsupported extensions are rejected. Duplicates become `script.py`, `script-2.py`, etc. Display names do not address backing storage.
- Files are flushed/fsynced into a temporary file, then published with a non-overwriting hard link. The catalog is flushed/fsynced and atomically replaced. Publication failure rolls back the new backing file; existing metadata and files remain intact. One local backend worker owns storage; a thread lock serializes operations.
- Interrupted writes/orphaned backing files are inert: they are neither automatically registered nor served. A missing or changed backing file is marked `missing` and cannot be read/downloaded. Deleting such an entry cleans its metadata. Corrupt metadata is preserved and puts this store into a readable error state requiring repair; it is never silently overwritten or used to guess files.
- Request receipts survive backend restart and prevent a repeated request from writing another file. Deleting a file retains its receipt so a retry cannot silently recreate it. If the backend restarts, generation itself may run again, but the same request cannot overwrite or duplicate the committed file. Turn-status/history caches remain in memory.

## Lifecycle, cancellation and duplicate requests

The existing `POST /api/chat` accepts an optional opaque `requestId`. The current UI sends one ID per user submission. Artifact-capable calls require the existing local/same-origin access check. Legacy callers without that ID keep the dialogue-only contract.

`TurnRegistry` coalesces simultaneous identical request IDs and caches up to 256 recent turn results. A conflicting reuse is rejected. Provider resolution/generation happens once for an active cached turn; UI status/presentation changes only poll the turn and never re-call the model.

States are `idle`, `working`, `artifact-ready`, `failed`. A request starts working with no artifact cue while the normal thinking pose runs. Only a validated artifact action emits `artifact_working`. Successful file/catalog publication emits `artifact_ready` and releases the one final performance. Normal chat finishes idle with no artifact cues or artifacts. Provider/validation/storage failures finish failed with no ready cue.

Status snapshots retain the semantic cue sequence, so a fast file write is still observable without introducing artificial animation delays. The frontend polls while waiting and consumes the final snapshot. The optional Thinker/phone mappings and final summon/Court Record cinematic are deferred to milestone 3; this milestone adds no such delivery flow.

Cancellation is explicit, including a tombstone if cancellation reaches the backend before the POST. Cancellation while the provider runs or at the pre-write checkpoint prevents creation/history updates. The bounded synchronous file commit is a cancellation boundary: once committed, cancellation returns the actual completed status rather than claiming the file was cancelled. Leaving the screen/timeout also requests cancellation; if the server cannot be reached, cancellation is best effort and the persistent library can reveal an already-completed file on reload. All UI outcomes leave waiting. Deleted/missing artifacts invalidate a cached ready turn.

## Local API

| Method | Path | Result |
|---|---|---|
| GET | `/api/artifacts` | Metadata list; no directory browsing |
| GET | `/api/artifacts/{id}` | Metadata/status |
| GET | `/api/artifacts/{id}/content` | JSON `{id, content}` containing inert text |
| GET | `/api/artifacts/{id}/download` | Attachment, always served as plain text |
| DELETE | `/api/artifacts/{id}` | Delete by opaque ID |
| GET | `/api/chat/turns/{requestId}` | Semantic state/cues, never hidden model output |
| DELETE | `/api/chat/turns/{requestId}` | Cancel or return already-completed state |

All these routes reuse the provider/music local/same-origin guard and no-store responses. Downloads use a sanitized RFC 5987 name, `nosniff` and a sandbox CSP. No endpoint returns real server paths or reads a secret back. There is no direct arbitrary-file upload/write endpoint, general tool dispatcher, executable action, shell, subprocess or filesystem browser.

## Minimal frontend

An out-of-stage Generated files panel lists persistent metadata and provides plain `<pre>` previews, View full text, Download, Refresh and Delete. JSX escapes the text; Markdown/HTML/Python are never evaluated. It remains available through navigation and reloads from the backend. No artifact payload is stored in browser localStorage/sessionStorage. The existing 256×192 scene, fonts, waiting animation, SFX, music and Court Record are reused without a redesign.

## Verification

Deterministic tests use temporary storage and mocked provider HTTP. They cover all four adapters, action/schema separation, normal-chat regression, hostile filenames, Unicode/byte limits, persistence and receipts, missing/orphaned/corrupt storage, failed publication, cancellation races, local access, inert Python/downloads and secret/path redaction. Windows may skip the real-symlink filesystem test when developer symlink privilege is unavailable; the containment logic remains exercised normally.

Run the full combined tree with backend `python -m pytest -q -p no:cacheprovider`, frontend `npm test`, `npm run validate:assets`, `npm run build`, `npm run lint`, and `git diff --check`. Current session results and file ownership are recorded in `SESSION_LOG.md` and `MILESTONE_2_CHANGE_AUDIT.md`.
