import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactDeliveryPhase } from '../src/artifacts/artifactDelivery.ts'
import { replySucceeded, statusMagnifierMode as mode, STATUS_DONE_MS } from '../src/components/statusMagnifier.ts'

const base = { running: false, doneFlash: false, deliveryPhase: 'idle' as ArtifactDeliveryPhase }

test('ordinary request: blue while pending, checked briefly on success, then nothing', () => {
  assert.equal(mode(base), 'hidden')
  assert.equal(mode({ ...base, running: true }), 'working')
  assert.equal(mode({ ...base, doneFlash: true }), 'done')
  assert.ok(STATUS_DONE_MS >= 600 && STATUS_DONE_MS <= 900)
})

test('artifact flow: acknowledgement and generation are blue, saved is checked, phone and summon own the stage', () => {
  const phase = (deliveryPhase: ArtifactDeliveryPhase, running = true) => mode({ ...base, running, deliveryPhase })
  assert.equal(phase('task-acknowledgement'), 'working')
  assert.equal(phase('artifact-working'), 'working')
  assert.equal(phase('artifact-done'), 'done')
  assert.equal(phase('waiting-for-phone-acknowledgement'), 'hidden')
  assert.equal(phase('evidence-summon'), 'hidden')
  assert.equal(phase('response-release', false), 'hidden')
})

test('failure and cancel never show a check and hide the magnifier', () => {
  for (const deliveryPhase of ['failed', 'cancelled'] as const) {
    assert.equal(mode({ running: true, doneFlash: true, deliveryPhase }), 'hidden')
  }
  // A failure still finishing its acknowledgement line is halted, not working.
  assert.equal(mode({ running: true, doneFlash: false, deliveryPhase: 'task-acknowledgement', halted: true }), 'hidden')
  assert.equal(mode({ running: false, doneFlash: true, deliveryPhase: 'idle', halted: true }), 'hidden')
})

test('only an error-free reply is a success', () => {
  assert.equal(replySucceeded({ error: null }, null), true)
  assert.equal(replySucceeded(undefined, null), true)
  assert.equal(replySucceeded({ error: 'artifact_write_failed' }, null), false)
  assert.equal(replySucceeded({ error: null }, 'Output limit reached'), false)
})
