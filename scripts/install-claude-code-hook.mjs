#!/usr/bin/env node
// Adds (or removes) the Courtroom Companion hooks in a Claude Code settings file (D-067).
//
//   node scripts/install-claude-code-hook.mjs --dry-run      show the resulting file, change nothing
//   node scripts/install-claude-code-hook.mjs                install into ~/.claude/settings.json
//   node scripts/install-claude-code-hook.mjs --uninstall    remove only our hooks
//   node scripts/install-claude-code-hook.mjs --settings <path>   use another settings file
//
// Existing hooks and settings are kept; a timestamped backup is written before any change, and
// running it twice adds nothing. Hooks are async command hooks: Claude Code never waits for them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOOK_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'claude-code-hook.mjs')
const MARKER = 'claude-code-hook.mjs'

/** Event → matcher ('' = no matcher, for events that do not support one). */
export const HOOK_EVENTS = {
  SessionStart: 'startup|resume',
  Stop: '',
  Notification: 'permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog',
  PostToolUse: 'Bash',
  PostToolUseFailure: 'Bash',
}

const ours = (group) => (group?.hooks ?? []).some((hook) => JSON.stringify(hook).includes(MARKER))

export function withoutOurHooks(settings) {
  const next = structuredClone(settings)
  for (const event of Object.keys(next.hooks ?? {})) {
    next.hooks[event] = next.hooks[event].filter((group) => !ours(group))
    if (next.hooks[event].length === 0) delete next.hooks[event]
  }
  if (next.hooks && Object.keys(next.hooks).length === 0) delete next.hooks
  return next
}

export function withOurHooks(settings, script = HOOK_SCRIPT) {
  const next = withoutOurHooks(settings)
  next.hooks ??= {}
  for (const [event, matcher] of Object.entries(HOOK_EVENTS)) {
    const group = { hooks: [{ type: 'command', command: 'node', args: [script], async: true, timeout: 5 }] }
    if (matcher) group.matcher = matcher
    ;(next.hooks[event] ??= []).push(group)
  }
  return next
}

function main(argv) {
  const at = argv.indexOf('--settings')
  const path = at >= 0 ? resolve(argv[at + 1]) : join(homedir(), '.claude', 'settings.json')
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const next = argv.includes('--uninstall') ? withoutOurHooks(current) : withOurHooks(current)
  const text = JSON.stringify(next, null, 2) + '\n'
  if (argv.includes('--dry-run')) {
    process.stdout.write(text)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) copyFileSync(path, `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  writeFileSync(path, text, 'utf8')
  console.log(`${argv.includes('--uninstall') ? 'Removed' : 'Installed'} Courtroom Companion hooks in ${path}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
