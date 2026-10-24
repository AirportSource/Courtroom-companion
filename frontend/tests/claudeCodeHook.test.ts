import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error -- plain ESM helper script outside the frontend (no type declarations)
import { toEvent } from '../../scripts/claude-code-hook.mjs'
// @ts-expect-error -- plain ESM helper script outside the frontend (no type declarations)
import { HOOK_EVENTS, withOurHooks, withoutOurHooks } from '../../scripts/install-claude-code-hook.mjs'

const base = { cwd: 'D:\\Projets\\my-app', session_id: 's', transcript_path: 't' }

test('hook input maps to app events', () => {
  assert.deepEqual(toEvent({ ...base, hook_event_name: 'Stop', stop_hook_active: false }), { type: 'task_finished', project: 'my-app' })
  assert.equal(toEvent({ ...base, hook_event_name: 'Stop', stop_hook_active: true }), null)
  assert.equal(toEvent({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' })?.type, 'needs_attention')
  assert.equal(toEvent({ ...base, hook_event_name: 'Notification', notification_type: 'auth_success' }), null)
  assert.equal(toEvent({ ...base, hook_event_name: 'SessionStart', source: 'startup' })?.type, 'session_started')
  assert.equal(toEvent({ ...base, hook_event_name: 'SessionStart', source: 'compact' }), null)
  const bash = (command: string) => ({ ...base, tool_name: 'Bash', tool_input: { command } })
  assert.equal(toEvent({ ...bash('npm test'), hook_event_name: 'PostToolUse' })?.type, 'tests_passed')
  assert.equal(toEvent({ ...bash('.venv/Scripts/python -m pytest -q'), hook_event_name: 'PostToolUse' })?.type, 'tests_passed')
  assert.equal(toEvent({ ...bash('ls -la'), hook_event_name: 'PostToolUse' }), null)
  assert.equal(toEvent({ ...bash('npm test'), hook_event_name: 'PostToolUseFailure', error: 'Exit code 1' })?.type, 'tests_failed')
  assert.equal(toEvent({ ...bash('npm run build'), hook_event_name: 'PostToolUseFailure', error: 'Exit code 2' })?.type, 'build_failed')
  assert.equal(toEvent({ ...bash('npm test'), hook_event_name: 'PostToolUseFailure', is_interrupt: true }), null)
  assert.equal(toEvent({ ...base, tool_name: 'Edit', hook_event_name: 'PostToolUseFailure' }), null)
  assert.equal(toEvent(null), null)
})

test('installer adds async hooks next to existing ones, idempotently, and removes only its own', () => {
  const existing = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }
  const installed = withOurHooks(existing, '/repo/scripts/claude-code-hook.mjs')
  assert.equal(installed.model, 'x')
  assert.equal(installed.hooks.Stop.length, 2)
  assert.equal(installed.hooks.Stop[0].hooks[0].command, 'echo done')
  for (const event of Object.keys(HOOK_EVENTS)) {
    const ours = installed.hooks[event].at(-1).hooks[0]
    assert.deepEqual([ours.command, ours.async, ours.args[0]], ['node', true, '/repo/scripts/claude-code-hook.mjs'])
  }
  assert.equal(installed.hooks.Stop.at(-1).matcher, undefined) // Stop does not support matchers
  assert.equal(installed.hooks.PostToolUseFailure.at(-1).matcher, 'Bash')
  assert.deepEqual(withOurHooks(installed, '/repo/scripts/claude-code-hook.mjs'), installed)
  assert.deepEqual(withoutOurHooks(installed), existing)
  assert.deepEqual(withoutOurHooks(withOurHooks({})), {})
})
