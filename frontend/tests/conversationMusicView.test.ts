import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enabledControls, showsPause } from '../src/components/conversationMusicView.ts'

test('pause glyph only while audible or loading', () => {
  assert.equal(showsPause('playing'), true)
  assert.equal(showsPause('loading'), true)
  for (const status of ['paused', 'blocked', 'idle', 'error'] as const) assert.equal(showsPause(status), false)
})

test('controls without a handler are disabled; theme needs an override as well', () => {
  const noop = () => {}
  assert.deepEqual(enabledControls({ title: 'x', status: 'playing' }), { prev: false, toggle: false, next: false, theme: false, list: false })
  assert.deepEqual(enabledControls({ title: 'x', status: 'playing', onToggle: noop, onPrev: noop, onNext: noop, onTheme: noop }),
    { prev: true, toggle: true, next: true, theme: false, list: false })
  assert.equal(enabledControls({ title: 'x', status: 'paused', overridden: true, onTheme: noop }).theme, true)
})

test('the track list needs a select handler and more than one track', () => {
  const track = (id: string) => ({ id, label: id, isTheme: false })
  const onSelect = () => {}
  assert.equal(enabledControls({ title: 'x', status: 'playing', tracks: [track('a'), track('b')] }).list, false)
  assert.equal(enabledControls({ title: 'x', status: 'playing', onSelect, tracks: [track('a')] }).list, false)
  assert.equal(enabledControls({ title: 'x', status: 'paused', onSelect, tracks: [track('a'), track('b')] }).list, true)
})
