import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ImportedTrackRecord } from '../src/music/imported/importApi.ts'
import {
  describeImportStatus, isImportBusy, loopStateOf, reduceImportStatus,
  type ImportEvent, type ImportStatus,
} from '../src/music/imported/importStatus.ts'

const run = (events: ImportEvent[]): ImportStatus | null => events.reduce<ImportStatus | null>(reduceImportStatus, null)

test('success with a loop candidate walks every step', () => {
  const steps: string[] = []
  let state: ImportStatus | null = null
  const events: ImportEvent[] = [
    { type: 'select', fileName: 'song.mp3' }, { type: 'checking' }, { type: 'uploading' },
    { type: 'uploaded', trackId: 'abc' }, { type: 'analysing' }, { type: 'candidate', confidence: 0.8 },
  ]
  for (const event of events) {
    state = reduceImportStatus(state, event)
    steps.push(state!.step)
  }
  assert.deepEqual(steps, ['selected', 'checking', 'uploading', 'uploading', 'analysing', 'ready'])
  assert.equal(state!.trackId, 'abc')
  assert.equal(state!.loop, 'candidate')
  assert.match(describeImportStatus(state!), /loop candidate/)
  assert.equal(isImportBusy(state), false)
})

test('no loop found is still a successful import, with the reason', () => {
  const state = run([
    { type: 'select', fileName: 'a.wav' }, { type: 'checking' }, { type: 'uploading' },
    { type: 'uploaded', trackId: 'x' }, { type: 'analysing' }, { type: 'no_candidate', reason: 'too short' },
  ])!
  assert.equal(state.step, 'ready')
  assert.equal(state.loop, 'none')
  assert.match(describeImportStatus(state), /No loop found \(too short\)/)
})

test('failure keeps the step it stopped at and a readable reason; later events are ignored', () => {
  const state = run([
    { type: 'select', fileName: 'bad.flac' }, { type: 'checking' },
    { type: 'failed', message: 'This browser cannot play FLAC.' }, { type: 'uploading' },
  ])!
  assert.equal(state.step, 'failed')
  assert.equal(state.failedAt, 'checking')
  assert.equal(describeImportStatus(state), 'Could not import bad.flac: This browser cannot play FLAC.')
  assert.equal(run([{ type: 'checking' }]), null)
  assert.equal(reduceImportStatus(state, { type: 'select', fileName: 'next.mp3' })!.step, 'selected')
})

const track = (loop: ImportedTrackRecord['loop'], available = true): ImportedTrackRecord => ({
  id: 'a', title: 'T', format: 'mp3', mime: 'audio/mpeg', sizeBytes: 1, createdAt: '', available, loop,
})
const region = { startSample: 0, endSample: 100000, sampleRate: 44100 }

test('library loop state wording', () => {
  assert.equal(loopStateOf(track(null), false).label, 'No loop')
  assert.equal(loopStateOf(track(null), true).kind, 'analysing')
  assert.equal(loopStateOf(track(null, false), false).kind, 'missing')
  assert.equal(loopStateOf(track({ region, confidence: 0.79, provenance: 'auto-detected' }), false).label, 'Automatic (not reviewed) 79%')
  assert.equal(loopStateOf(track({ region, confidence: 0.9, provenance: 'user-accepted' }), false).label, 'Loop accepted')
  assert.equal(loopStateOf(track({ region, confidence: null, provenance: 'user-adjusted' }), false).label, 'Loop adjusted')
})
