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

## Task-aware output budgets (D-053)

The old path used the saved normal-chat budget for every turn: the inspected Claude Sonnet 5.5 profile had `max_tokens: 600`, and Anthropic transmitted exactly 600 for both conversation and files. The shared settings validator also capped configurable output at 8,192.

> **Updated by D-059:** dialogue now uses `max(profile budget, 4096)`, every provider's truncation/context stop is normalized and rejected before parsing, and `generation.failureClass` classifies failures. The paragraph below records the D-053 state.

CharacterService now supplies a provider-independent `OutputWorkload` to the gateway. `dialogue` preserves the configured normal budget (default/current inspected profile: **600**); `text_artifact` uses a transient **16,384-token** budget. The shared validator permits that bounded value. Saved profile settings, normal defaults, temperature, timeouts and artifact byte limits are unchanged. This is a request cap, not a command to produce 16k tokens or a model-maximum lookup.

Because action intent is only confirmed after the existing single model response, the service makes an advisory budget estimate for explicit file/script/document creation requests (including common English/French/Japanese forms and Fake fixtures). This is not an action authorization or an artifact detector: only the existing strictly validated model action creates a file. An artifact-capable schema alone does not raise ordinary chat's budget. Unrecognized/implicit phrasing can still receive the normal budget; incomplete responses fail safely rather than being salvaged or automatically retried. A future planner can communicate the same workload without changing providers.

Anthropic maps `max_tokens` to `output_token_limit` and `model_context_window_exceeded` to `context_window_exceeded`; refusal stays `provider_refused`, and `end_turn` permits normal validation. Both exhaustion cases reject all returned content before JSON/action parsing, even if it is parseable: no file, working/ready artifact cue, partial assistant history or continuation call is produced. The output-limit diagnostic includes the actual requested budget; the context diagnostic explains that shortening input/history is necessary rather than merely raising output tokens. Chat and profile Test Connection show distinct messages.

The API returns separate safe `generation` diagnostics (`workload`, `maxOutputTokens`, optional `stopReason`), outside CharacterReply/performance. No hidden reasoning or provider secrets are included. Ollama/OpenAI-compatible already map the same request settings to `num_predict` / `max_tokens`; Fake receives the same workload/settings. Mocked wire tests verify 600 → 16,384 → 600 across all four providers and a larger completed artifact saved exactly once.

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

Status snapshots retain the semantic cue sequence, so a fast file write is still observable without introducing artificial animation delays. The frontend polls while waiting and consumes the final snapshot. The frontend owns the delivery presentation state machine; the backend remains unaware of Thinker/phone assets and animation timing.

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

## Delivery presentation and Court Record (D-055)

`frontend/src/artifacts/artifactDelivery.ts` is the authoritative presentation reducer. Its successful path is `idle → task-acknowledgement → artifact-working → waiting-for-phone-acknowledgement → evidence-summon → response-release → idle`. Ready metadata and the single final response can arrive during acknowledgement; they remain buffered. Failure finishes a started acknowledgement and releases the existing error response without a phone/summon. Cancellation immediately returns to input. Turn IDs reject stale/duplicate events; phone acknowledgement and summon completion are one-shot transitions. Presentation state does not change the artifact store.

The service publishes its existing advisory `expectedWorkload` in turn status before calling the provider. `text_artifact` allows a local character-defined acknowledgement while that original provider call is running; it is not artifact authorization or a ready cue. If intent is only known from the validated result, the same local sequence still gates that result. `character.json.taskAcknowledgements.artifact` supplies emotion and short locale-specific lines. Variants rotate in session; the known document locale selects copy (English fallback). No message-keyword detector, model call, history entry, or hardcoded character line is added. Copy is paginated and typed through the existing dialogue renderer. On completion it holds for 500 ms, then enters thinking/Thinker for at least 350 ms, even for a fast provider.

The ready phone state acquires one shared `phone_ring_loop` source and a scoped MusicEngine attenuation lease. It uses the metadata-identified Phoenix ringtone rather than the notification beep. Native buffer looping uses the manifest's analyzed start/end seconds without repeated timers or source creation. Answering stops it immediately, restores the mix, and requests the existing `phone_answer`. Cleanup also runs on cancellation, leaving state, navigation and unmount; an abandoned pending decode cannot start a late ringtone. BGM ducks to 12% through a separate gain (220 ms attack, 350 ms restore), preserving user volume, mute, fade automation, source and track. Radio uses its existing native volume API with bounded ramps.

The summon requests `evidence_reveal`, shows the native file icon, sanitized display name, and deterministic “Added to the Court Record.” line. Continue is gated for at least 1.2 seconds and otherwise auto-completes at 2.5 seconds. `evidence_added` is requested when the artifact list refresh completes and the presentation is ready to release. Sounds resolve through `audio/audio.json`: `phone_ring_loop → fx_phone_ring`, `phone_answer → fx_phone_answer`, `evidence_reveal → fx_evidence_reveal`, and `evidence_added → fx_evidence_added`. Delivery effects do not replay on dialogue pagination or later Court Record visits.

After summon, the already-buffered result is sent through existing `play()` → `timelineToLines` → CharacterDirector-driven performance and normal paginator. This preserves the single generation and existing dialogue/reaction-SFX paths. During working/phone/summon/release, conflicting submission and navigation controls are disabled without clearing typed input. Navigating away cancels only an active task through the existing milestone 2 cancellation path. If the artifact has committed, it remains stored. Reload does not replay a pending cinematic; the artifact is simply listed.

`GeneratedFilesCourtRecord` is a view over `GET /api/artifacts` and existing content/download/delete routes. One ready artifact maps to one square file slot; it does not copy file content or persist a second catalog. Six fixed 64×64 slots form a 3×2 page with stable `createdAt` then ID ordering, empty and selected slots, mouse selection, keyboard navigation and pagination. The inspector reads by opaque ID and displays safe metadata plus inert text; download and delete use the existing API. Missing artifacts have a safe unavailable state. Python is never executed. Thinker, phone and existing static/demo evidence are excluded from this generated-file grid.

The previous out-of-stage Generated files panel is retained only behind development tools, avoiding two user-facing artifact libraries while preserving debug access. No artifact payload is stored in browser localStorage/sessionStorage. Character BGM remains scene-scoped and is not restarted by presentation phases.

Court Record browsing uses existing `menu_cursor` (movement), `menu_page` (cross-page movement), `menu_confirm` (open/action), and `menu_cancel` (back/close) events for mouse and keyboard. Movement audio has a 140 ms cadence limit. It never uses delivery/evidence effects. The dev panel offers a bounded 45-second ringtone audition with Stop so a developer can hear the tune, loop seam and duck/restore mix; it is removed while a conversation turn is active and cleans up on unmount.

## Verification

Deterministic backend tests use temporary storage and mocked provider HTTP. They cover all four adapters, action/schema separation, normal-chat regression, hostile filenames, Unicode/byte limits, persistence and receipts, missing/orphaned/corrupt storage, failed publication, cancellation races, local access, inert Python/downloads and secret/path redaction. Frontend state-machine tests cover duplicate ready/acknowledgement events, failure, cancellation, buffered release and timer bounds; Court Record tests cover ordering, slots, pagination, selection and derived views. A FakeProvider browser run created a `.py` file and completed phone → summon → response release and inspector preview/download without a second chat POST. Eight additional deterministic FakeProvider turns had no burger references; FakeProvider does not evaluate personality-prompt adherence. Windows may skip the real-symlink filesystem test when developer symlink privilege is unavailable; the containment logic remains exercised normally.

Run the full combined tree with backend `python -m pytest -q -p no:cacheprovider`, frontend `npm test`, `npm run validate:assets`, `npm run build`, `npm run lint`, and `git diff --check`. Current session results and file ownership are recorded in `SESSION_LOG.md` and `MILESTONE_2_CHANGE_AUDIT.md`.
