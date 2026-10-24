import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MAX_EXPANDED_PANELS, isPanelExpanded, panelBodyMode, setPanelExpanded, togglePanel } from '../src/components/collapsiblePanel.ts'

const SAFE_ID = /^[A-Za-z0-9_-]{0,64}$/

test('panels are collapsed by default and toggle through the persisted list', () => {
  assert.equal(isPanelExpanded([], 'dev-generated-files'), false)
  const open = togglePanel([], 'dev-generated-files')
  assert.deepEqual(open, ['dev-generated-files'])
  assert.equal(isPanelExpanded(open, 'dev-generated-files'), true)
  assert.deepEqual(togglePanel(open, 'dev-generated-files'), [])
})

test('default-expanded panels persist an explicit collapse', () => {
  assert.equal(isPanelExpanded([], 'p', true), true)
  const closed = togglePanel([], 'p', true)
  assert.deepEqual(closed, ['off_p'])
  assert.equal(isPanelExpanded(closed, 'p', true), false)
  assert.deepEqual(togglePanel(closed, 'p', true), [])
})

test('other panels are untouched, tokens stay settings-safe and the list is bounded', () => {
  assert.deepEqual(setPanelExpanded(['a', 'b'], 'a', false), ['b'])
  assert.deepEqual(setPanelExpanded(['a'], 'a', true), ['a'])
  assert.ok(SAFE_ID.test(togglePanel([], 'music-radio', true)[0]))
  let list: string[] = []
  for (let i = 0; i < 50; i++) list = setPanelExpanded(list, `p${i}`, true)
  assert.equal(list.length, MAX_EXPANDED_PANELS)
  assert.equal(list.at(-1), 'p49')
})

test('collapsed bodies are omitted, or hidden when they must stay mounted', () => {
  assert.equal(panelBodyMode(true, false), 'render')
  assert.equal(panelBodyMode(true, true), 'render')
  assert.equal(panelBodyMode(false, false), 'omit')
  assert.equal(panelBodyMode(false, true), 'hidden')
})

test('CollapsiblePanel renders its body only through panelBodyMode and exposes ARIA wiring', () => {
  const source = readFileSync(new URL('../src/components/CollapsiblePanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /mode !== 'omit' &&/)
  assert.match(source, /aria-expanded=\{expanded\}/)
  assert.match(source, /aria-controls=\{bodyId\}/)
  assert.match(source, /inert=\{mode === 'hidden'\}/)
})

test('the radio section stays visible while radio plays', () => {
  const dock = readFileSync(new URL('../src/components/MusicDock.tsx', import.meta.url), 'utf8')
  assert.match(dock, /id="music-radio"[^>]*keepMounted[^>]*locked=\{radioActive\}/)
  assert.match(dock, /state\.status === 'playing' \|\| state\.status === 'loading'/)
})
