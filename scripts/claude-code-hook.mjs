#!/usr/bin/env node
// Claude Code hook → Courtroom Companion event inbox (D-067).
//
// Register it as an *async* command hook (see scripts/install-claude-code-hook.mjs). It reads the
// hook JSON on stdin, maps it to a small app event and POSTs it to the local backend. It never
// prints anything and always exits 0, so it cannot block or alter Claude Code. Override the URL with
// COURTROOM_EVENTS_URL (default http://127.0.0.1:8000/api/events).
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const TEST_COMMAND = /\b(pytest|npm (run )?test|yarn test|pnpm (run )?test|vitest|jest|go test|cargo test|dotnet test|mvn test|gradle(w)? test|node --test|phpunit|rspec)\b/
const BUILD_COMMAND = /\b(npm run build|yarn build|pnpm (run )?build|vite build|tsc( -b)?\b|cargo build|go build|dotnet build|mvn (package|install)|gradle(w)? build|make)\b/
const ATTENTION = new Set(['permission_prompt', 'idle_prompt', 'agent_needs_input', 'elicitation_dialog'])

/** Hook input → `{type, project, text}` or null when the event is not worth a line. */
export function toEvent(input) {
  if (typeof input !== 'object' || input === null) return null
  const project = typeof input.cwd === 'string' ? basename(input.cwd).slice(0, 80) : ''
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
  switch (input.hook_event_name) {
    case 'SessionStart':
      return ['startup', 'resume'].includes(input.source) ? { type: 'session_started', project } : null
    case 'Stop':
      // stop_hook_active: Claude is continuing because of another Stop hook; not a real finish.
      return input.stop_hook_active ? null : { type: 'task_finished', project }
    case 'Notification':
      return ATTENTION.has(input.notification_type) ? { type: 'needs_attention', project } : null
    case 'PostToolUse':
      return input.tool_name === 'Bash' && TEST_COMMAND.test(command) ? { type: 'tests_passed', project } : null
    case 'PostToolUseFailure':
      if (input.tool_name !== 'Bash' || input.is_interrupt) return null
      if (TEST_COMMAND.test(command)) return { type: 'tests_failed', project }
      if (BUILD_COMMAND.test(command)) return { type: 'build_failed', project }
      return null
    default:
      return null
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  // Set by Courtroom Companion's own headless Claude Code runs (subscription provider, D-072).
  if (process.env.COURTROOM_HOOK_DISABLED) return
  try {
    const event = toEvent(JSON.parse(await readStdin()))
    if (!event) return
    await fetch(process.env.COURTROOM_EVENTS_URL ?? 'http://127.0.0.1:8000/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'claude-code', ...event }),
      signal: AbortSignal.timeout(1500),
    })
  } catch (error) {
    // App closed, malformed input, timeout: stay silent, never disturb Claude Code.
    // COURTROOM_HOOK_DEBUG=1 reports the reason on stderr (never stdout) for troubleshooting.
    if (process.env.COURTROOM_HOOK_DEBUG) process.stderr.write(`courtroom hook: ${error}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
  process.exit(0)
}
