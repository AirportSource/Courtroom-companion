// Loop editor pure logic: nudges, clamping, validity, accept provenance, labels and the preview excerpt.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acceptLoop,
  candidateToLoop,
  confidenceLabel,
  formatSeconds,
  loopValidity,
  metadataToLoop,
  nudge,
  parseSeconds,
  proposalMetadata,
  sameLoop,
  setCrossfade,
  shouldAutoAnalyse,
  stepSamples,
} from '../src/music/loop/loopEditorState.ts'
import type { EditorLoop } from '../src/music/loop/loopEditorState.ts'
import { buildPreviewExcerpt } from '../src/music/loop/previewLoop.ts'
import type { LoopCandidate } from '../src/music/loop/types.ts'

const SR = 44100
const DURATION = SR * 60
const base: EditorLoop = { startSample: SR * 5, endSample: SR * 45, sampleRate: SR, crossfadeMs: 0 }

const candidate: LoopCandidate = {
  startSample: base.startSample,
  endSample: base.endSample,
  sampleRate: SR,
  confidence: 0.62,
  quality: 'medium',
  recommendedCrossfadeMs: 10,
  scores: { similarity: 1, coverage: 1, refinement: 1, seam: 1, margin: 1, beat: 1, level: 1 },
  seam: { jump: 0, jumpRatio: 0, slopeMismatch: 0, correlation: 1 },
}

test('nudge steps are 100 ms, 5 ms and 1 sample in both directions', () => {
  assert.equal(stepSamples('coarse', SR), 4410)
  assert.equal(stepSamples('fine', SR), 221)
  assert.equal(stepSamples('sample', SR), 1)
  assert.equal(nudge(base, 'start', 1, 'coarse', DURATION).startSample, base.startSample + 4410)
  assert.equal(nudge(base, 'end', -1, 'fine', DURATION).endSample, base.endSample - 221)
  assert.equal(nudge(base, 'end', 1, 'sample', DURATION).endSample, base.endSample + 1)
  assert.equal(nudge(base, 'start', -1, 'sample', DURATION).startSample, base.startSample - 1)
})

test('nudges are clamped to the audio and a minimum loop length', () => {
  assert.equal(nudge({ ...base, startSample: 100 }, 'start', -1, 'coarse', DURATION).startSample, 0)
  assert.equal(nudge({ ...base, endSample: DURATION - 10 }, 'end', 1, 'coarse', DURATION).endSample, DURATION)
  const tight = { ...base, startSample: 0, endSample: SR + 5 }
  assert.equal(nudge(tight, 'end', -1, 'coarse', DURATION).endSample, SR, 'never shorter than 1 s')
  assert.equal(nudge({ ...tight, endSample: SR + 5 }, 'start', 1, 'coarse', DURATION).startSample, 5)
  for (const step of ['coarse', 'fine', 'sample'] as const) {
    for (const target of ['start', 'end'] as const) {
      for (const direction of [-1, 1] as const) {
        const moved = nudge(base, target, direction, step, DURATION)
        assert.ok(loopValidity(moved, DURATION).ok)
      }
    }
  }
})

test('validity reports bad regions instead of throwing', () => {
  assert.ok(loopValidity(base, DURATION).ok)
  assert.ok(!loopValidity({ ...base, endSample: base.startSample }, DURATION).ok)
  assert.ok(!loopValidity({ ...base, endSample: DURATION + 1 }, DURATION).ok)
  assert.ok(!loopValidity({ ...base, startSample: 1.5 }, DURATION).ok)
})

test('crossfade is bounded by 100 ms, the loop and the audio before the start', () => {
  assert.equal(setCrossfade(base, 40).crossfadeMs, 40)
  assert.equal(setCrossfade(base, 5000).crossfadeMs, 100)
  assert.equal(setCrossfade(base, -3).crossfadeMs, 0)
  assert.equal(setCrossfade(base, Number.NaN).crossfadeMs, 0)
  assert.equal(setCrossfade({ ...base, startSample: 0 }, 40).crossfadeMs, 0, 'no audio before the start to fade from')
  assert.equal(setCrossfade({ ...base, startSample: 441 }, 40).crossfadeMs, 10)
})

test('accepting an unchanged proposal is user-accepted, any edit is user-adjusted', () => {
  const proposal = candidateToLoop(candidate)
  assert.equal(proposal.crossfadeMs, 10)
  const accepted = acceptLoop(proposal, proposal, candidate.confidence)
  assert.equal(accepted.provenance, 'user-accepted')
  assert.equal(accepted.confidence, 0.62)
  assert.deepEqual(accepted.region, { startSample: base.startSample, endSample: base.endSample, sampleRate: SR, crossfadeMs: 10 })
  const edited = acceptLoop(nudge(proposal, 'end', 1, 'sample', DURATION), proposal, candidate.confidence)
  assert.equal(edited.provenance, 'user-adjusted')
  assert.equal(edited.confidence, null)
  assert.equal(acceptLoop({ ...proposal, crossfadeMs: 0 }, proposal, 0.62).provenance, 'user-adjusted')
  assert.equal(acceptLoop(proposal, null, null).provenance, 'user-adjusted')
  assert.ok(!('crossfadeMs' in acceptLoop({ ...proposal, crossfadeMs: 0 }, null, null).region!))
})

test('proposals persist as auto-detected and analysis is skipped once any loop is stored', () => {
  const stored = proposalMetadata(candidate)
  assert.equal(stored.provenance, 'auto-detected')
  assert.equal(stored.confidence, 0.62)
  assert.equal(shouldAutoAnalyse(null), true)
  assert.equal(shouldAutoAnalyse({ region: null, confidence: null, provenance: 'none' }), true)
  assert.equal(shouldAutoAnalyse(stored), false)
  assert.equal(shouldAutoAnalyse(acceptLoop(base, base, 0.9)), false)
  assert.equal(shouldAutoAnalyse(acceptLoop(base, null, null)), false)
  assert.ok(sameLoop(metadataToLoop(stored)!, candidateToLoop(candidate)))
  assert.equal(metadataToLoop({ region: null, confidence: null, provenance: 'none' }), null)
})

test('seconds are shown with three decimals and parsed to whole samples', () => {
  assert.equal(formatSeconds(66150, 22050), '3.000')
  assert.equal(formatSeconds(1, 44100), '0.000')
  assert.equal(parseSeconds('3.0005', 44100), 132322)
  assert.equal(parseSeconds(' 1,5 ', 1000), 1500)
  for (const bad of ['', 'abc', '-1', 'NaN', 'Infinity']) assert.equal(parseSeconds(bad, 44100), null)
})

test('confidence labels are honest and never claim perfection', () => {
  assert.deepEqual(
    [0.95, 0.8, 0.79, 0.5, 0.49, 0].map((c) => confidenceLabel(c).label),
    ['High confidence', 'High confidence', 'Medium confidence', 'Medium confidence', 'Low confidence', 'Low confidence'],
  )
  assert.equal(confidenceLabel(1.5).percent, 99)
  assert.equal(confidenceLabel(0.624).percent, 62)
  assert.ok(confidenceLabel(0.3).advice.toLowerCase().includes('uncertain'))
  assert.ok(!confidenceLabel(0.99).advice.toLowerCase().includes('perfect'))
})

test('preview excerpt joins the last seconds before the end to the first seconds after the start', () => {
  const sr = 1000
  const x = Float32Array.from({ length: 60 * sr }, (_, i) => i / (60 * sr))
  const loop: EditorLoop = { startSample: 10 * sr, endSample: 50 * sr, sampleRate: sr, crossfadeMs: 0 }
  const { channels, seamIndex } = buildPreviewExcerpt([x], loop, 4, 3)
  assert.equal(seamIndex, 4 * sr)
  assert.equal(channels[0]!.length, 7 * sr)
  assert.equal(channels[0]![100], x[46 * sr + 100], 'pre-roll comes from before the loop end')
  assert.equal(channels[0]![seamIndex - 1], x[50 * sr - 1])
  assert.equal(channels[0]![seamIndex + 100], x[10 * sr + 100], 'then the loop start follows the seam')
  assert.equal(x[46 * sr], Math.fround(46 / 60), 'the source is never modified')
})

test('preview crossfade blends the end with the audio before the start, ending exactly on it', () => {
  const sr = 1000
  const x = new Float32Array(60 * sr).fill(0.2)
  x.fill(1, 9 * sr, 10 * sr)
  const loop: EditorLoop = { startSample: 10 * sr, endSample: 50 * sr, sampleRate: sr, crossfadeMs: 100 }
  const { channels, seamIndex } = buildPreviewExcerpt([x], loop, 4, 2)
  const out = channels[0]!
  assert.ok(Math.abs(out[seamIndex - 1]! - 1) < 1e-6, 'the last crossfaded sample equals the material before the start')
  assert.ok(out[seamIndex - 100]! > 0.2 && out[seamIndex - 100]! < 1.0)
  assert.equal(out[seamIndex - 200], Math.fround(0.2), 'untouched before the crossfade')
})
