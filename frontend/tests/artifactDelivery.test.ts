import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARTIFACT_SUMMON_AUTO_MS, ARTIFACT_SUMMON_MIN_MS, artifactDeliveryReducer as reduce,
  initialArtifactDelivery } from '../src/artifacts/artifactDelivery.ts'
import type { ArtifactDeliveryState } from '../src/artifacts/artifactDelivery.ts'
import type { GeneratedArtifact } from '../src/artifacts/artifacts.ts'

const turnId = 'a'.repeat(32)
const artifact: GeneratedArtifact = { id: 'b'.repeat(32), displayName: 'opening_notes.md', extension: 'md',
  mimeType: 'text/markdown', createdAt: '2026-10-24T12:00:00Z', sizeBytes: 48, status: 'ready', contentPreview: 'Notes' }
const scoped = <T extends 'working' | 'response-buffered' | 'phone-acknowledged' | 'summon-finished' | 'cancelled' | 'response-finished'>(type: T) => ({ type, turnId })
const begin = () => reduce(initialArtifactDelivery(), { type: 'begin', turnId })
const ready = (state: ArtifactDeliveryState) => reduce(state, { type: 'ready', turnId, artifact })
const phoneWait = () => ready(reduce(reduce(begin(), scoped('working')), { type: 'working-presented', turnId }))

test('ready waits for explicit phone acknowledgement before releasing the buffered response', () => {
  let state = reduce(begin(), scoped('working'))
  assert.equal(state.phase, 'artifact-working')
  state = reduce(state, scoped('response-buffered'))
  assert.equal(state.phase, 'artifact-working')
  state = ready(state)
  assert.equal(state.phase, 'artifact-working')
  state = reduce(state, { type: 'working-presented', turnId })
  assert.equal(state.phase, 'waiting-for-phone-acknowledgement')
  // A timer cannot bypass acknowledgement, even when the response is already buffered.
  assert.equal(reduce(state, scoped('summon-finished')), state)
  state = reduce(state, scoped('phone-acknowledged'))
  assert.equal(state.phase, 'evidence-summon')
  assert.equal(state.artifact?.displayName, artifact.displayName)
  state = reduce(state, scoped('summon-finished'))
  assert.equal(state.phase, 'response-release')
  assert.equal(reduce(state, scoped('response-buffered')), state)
  assert.equal(reduce(state, scoped('summon-finished')), state)
  assert.deepEqual(reduce(state, scoped('response-finished')), initialArtifactDelivery())
})

test('summon completion waits for the original response when metadata arrives first', () => {
  let state = phoneWait()
  state = reduce(state, scoped('phone-acknowledged'))
  state = reduce(state, scoped('summon-finished'))
  assert.equal(state.phase, 'evidence-summon')
  assert.equal(state.summonFinished, true)
  assert.equal(reduce(state, scoped('summon-finished')), state)
  state = reduce(state, scoped('response-buffered'))
  assert.equal(state.phase, 'response-release')
})

test('duplicate ready, repeated working and double acknowledgement do not replay transitions', () => {
  let state = phoneWait()
  assert.equal(ready(state), state)
  assert.equal(reduce(state, scoped('working')), state)
  state = reduce(state, scoped('phone-acknowledged'))
  assert.equal(reduce(state, scoped('phone-acknowledged')), state)
  assert.equal(ready(state), state)
  assert.equal(reduce(state, scoped('working')), state)
})

test('cancelled turns cannot revive; failed turns can release their error response but never summon', () => {
  for (const phase of ['cancelled', 'failed'] as const) {
    const terminal = reduce(phoneWait(), { type: phase, turnId })
    assert.equal(terminal.phase, phase)
    assert.equal(terminal.artifact, null)
    for (const event of [scoped('phone-acknowledged'), scoped('summon-finished'), scoped('working')]) {
      assert.equal(reduce(terminal, event), terminal)
    }
    assert.equal(ready(terminal), terminal)
    assert.equal(reduce(terminal, { ...scoped('response-buffered'), withoutArtifact: true }).phase,
      phase === 'failed' ? 'response-release' : 'cancelled')
  }
})

test('a fast artifact result waits behind local acknowledgement and a visible working gate', () => {
  let state = reduce(begin(), { type: 'acknowledgement', turnId })
  state = ready(state)
  state = reduce(state, scoped('response-buffered'))
  assert.equal(state.phase, 'task-acknowledgement')
  assert.equal(state.responseBuffered, true)
  assert.equal(reduce(state, scoped('phone-acknowledged')), state)
  state = reduce(state, { type: 'acknowledgement-finished', turnId })
  assert.equal(state.phase, 'artifact-working')
  state = reduce(state, { type: 'working-presented', turnId })
  assert.equal(state.phase, 'waiting-for-phone-acknowledgement')
  assert.equal(reduce(state, { type: 'acknowledgement-finished', turnId }), state)
})

test('provider failure during acknowledgement finishes that line then releases only the error reply', () => {
  let state = reduce(begin(), { type: 'acknowledgement', turnId })
  state = reduce(state, { type: 'failed', turnId, error: 'timeout' })
  state = reduce(state, { ...scoped('response-buffered'), withoutArtifact: true })
  assert.equal(state.phase, 'task-acknowledgement')
  assert.equal(state.artifact, null)
  state = reduce(state, { type: 'acknowledgement-finished', turnId })
  assert.equal(state.phase, 'response-release')
  assert.equal(state.error, 'timeout')
})

test('stale events from an abandoned turn cannot affect a replacement turn', () => {
  const state = reduce(phoneWait(), { type: 'begin', turnId: 'c'.repeat(32) })
  assert.equal(state.phase, 'idle')
  assert.equal(state.artifact, null)
  for (const event of [scoped('working'), scoped('response-buffered'), scoped('phone-acknowledged'),
    scoped('summon-finished'), scoped('cancelled'), scoped('response-finished'), { type: 'failed' as const, turnId }]) {
    assert.equal(reduce(state, event), state)
  }
  assert.equal(ready(state), state)
  assert.equal(reduce(state, { type: 'begin', turnId: state.turnId! }), state)
})

test('ordinary dialogue can release directly; missing files never start delivery', () => {
  const state = begin()
  assert.equal(reduce(state, { type: 'ready', turnId, artifact: { ...artifact, status: 'missing' } }), state)
  assert.equal(reduce(state, scoped('phone-acknowledged')), state)
  assert.equal(reduce(state, scoped('response-finished')), state)
  assert.equal(reduce(state, scoped('response-buffered')).phase, 'response-release')
  assert.equal(reduce(initialArtifactDelivery(), scoped('working')).phase, 'idle')
})

test('summon has a readable minimum and bounded automatic completion contract', () => {
  assert.ok(ARTIFACT_SUMMON_MIN_MS >= 1200)
  assert.ok(ARTIFACT_SUMMON_AUTO_MS > ARTIFACT_SUMMON_MIN_MS)
  assert.ok(ARTIFACT_SUMMON_AUTO_MS <= 3000)
})
