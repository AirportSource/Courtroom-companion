// Loop analyser tests on deterministic synthetic signals (no audio files, no Web Audio).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeLoopPcm, calibrate, recommendCrossfade } from '../src/music/loop/analyzer.ts'
import { ncc, refineSeam } from '../src/music/loop/refine.ts'
import { describeConfidence, HIGH_CONFIDENCE, LOW_CONFIDENCE, qualityOf } from '../src/music/loop/types.ts'
import { concat, fadeOut, introBodyFade, lcg, noise, renderNotes } from './loopSignals.ts'

const SR = 22050

test('intro + repeated body x2 + fade-out: finds the body period and excludes intro and fade', () => {
  const { pcm, introSamples, bodySamples } = introBodyFade(SR)
  const result = analyzeLoopPcm(pcm, SR)
  assert.ok(result.ok)
  const best = result.candidates[0]!
  const ms = (value: number) => Math.round((value / 1000) * SR)
  assert.ok(Math.abs(best.endSample - best.startSample - bodySamples) <= ms(5), 'period within 5 ms')
  assert.ok(Math.abs(best.startSample - introSamples) <= ms(60), `start near the end of the intro (${best.startSample} vs ${introSamples})`)
  assert.ok(best.endSample <= introSamples + 2 * bodySamples + ms(60), 'loop ends before the fade-out')
  assert.ok(best.endSample <= result.info.usableEndSample, 'loop end is inside the usable body')
  assert.ok(result.info.fadeOutSamples > 0, 'the fade-out is detected')
  assert.ok(best.confidence >= HIGH_CONFIDENCE && best.quality === 'high')
  assert.equal(best.recommendedCrossfadeMs, 0)
  assert.ok(result.info.tempoBpm !== null && Math.abs(result.info.tempoBpm - 120) < 3, `tempo ${result.info.tempoBpm}`)
})

test('refineSeam lands on the sample-accurate lag for a phase-offset sinusoid mix', () => {
  const period = 15435 // 0.7 s at 22.05 kHz: every partial completes a whole number of cycles
  const partials = [
    { cycles: 200, amplitude: 0.3, phase: 0.4 },
    { cycles: 453, amplitude: 0.25, phase: 2.1 },
    { cycles: 911, amplitude: 0.2, phase: 4.0 },
    { cycles: 1777, amplitude: 0.15, phase: 5.3 },
  ]
  const x = new Float32Array(period * 8)
  for (let n = 0; n < x.length; n++) {
    let v = 0
    for (const p of partials) v += p.amplitude * Math.sin((2 * Math.PI * p.cycles * n) / period + p.phase)
    x[n] = v
  }
  const start = 20000
  for (const offset of [-37, -5, 1, 23, 61]) {
    const refined = refineSeam(x, SR, start, start + period + offset)
    assert.equal(refined.endSample - refined.startSample, period, `offset ${offset}`)
    assert.ok(refined.correlation > 0.9999)
    assert.equal(refined.nudge, 0, 'an exact repeat needs no waveform nudge')
  }
  assert.ok(ncc(x, start, start + period, 4096) > 0.9999)
})

test('refineSeam walks a repetition back to its exact start', () => {
  const { pcm, introSamples, bodySamples } = introBodyFade(SR)
  const refined = refineSeam(pcm, SR, introSamples + 30000, introSamples + 30000 + bodySamples + 41, { walkBack: true, nudge: false })
  assert.equal(refined.endSample - refined.startSample, bodySamples)
  assert.ok(Math.abs(refined.startSample - introSamples) <= 40, `${refined.startSample} vs ${introSamples}`)
})

test('white noise has no loop: failure or low confidence, never a confident claim', () => {
  const result = analyzeLoopPcm(noise(3, 60, SR), SR)
  if (result.ok) assert.ok(result.candidates.every((c) => c.confidence < LOW_CONFIDENCE))
  else assert.equal(result.reason, 'no_repetition')
})

test('music that never repeats is not given a confident loop', () => {
  const result = analyzeLoopPcm(renderNotes(9, 80, SR), SR)
  if (result.ok) assert.ok(result.candidates.every((c) => c.confidence < LOW_CONFIDENCE))
  else assert.equal(result.reason, 'no_repetition')
})

test('silence is a typed failure', () => {
  const result = analyzeLoopPcm(new Float32Array(SR * 30), SR)
  assert.ok(!result.ok && result.reason === 'silent')
})

test('too-short audio is a typed failure', () => {
  const result = analyzeLoopPcm(renderNotes(1, 5, SR), SR)
  assert.ok(!result.ok && result.reason === 'too_short')
})

test('invalid input is a typed failure, never an exception', () => {
  for (const bad of [analyzeLoopPcm(new Float32Array(0), SR), analyzeLoopPcm(new Float32Array(1000), 0), analyzeLoopPcm(new Float32Array(1000), Number.NaN)]) {
    assert.ok(!bad.ok && bad.reason === 'invalid_input')
  }
})

test('candidates are sorted by confidence, bounded, integral and inside the audio', () => {
  const body = renderNotes(4, 20, SR)
  const pcm = concat(body, body, body)
  const result = analyzeLoopPcm(pcm, SR, { maxCandidates: 5 })
  assert.ok(result.ok)
  assert.ok(result.candidates.length >= 2, 'the one-body and two-body loops are both offered')
  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i]!
    assert.ok(c.confidence >= 0 && c.confidence < 1)
    assert.ok(Number.isInteger(c.startSample) && Number.isInteger(c.endSample))
    assert.ok(c.startSample >= 0 && c.endSample <= pcm.length && c.endSample > c.startSample)
    assert.equal(c.sampleRate, SR)
    assert.equal(c.quality, qualityOf(c.confidence))
    if (i > 0) assert.ok(c.confidence <= result.candidates[i - 1]!.confidence)
    for (const score of Object.values(c.scores)) assert.ok(score >= 0 && score <= 1)
  }
  const first = result.candidates[0]!
  assert.ok(Math.abs(first.endSample - first.startSample - body.length) <= 110, 'the shortest repeating unit wins ties')
})

test('imperfect repeats lower the confidence and a crossfade is recommended', () => {
  const next = lcg(77)
  const body = renderNotes(8, 20, SR)
  const dirty = Float32Array.from(body, (v) => v + 0.25 * (next() * 2 - 1))
  const clean = analyzeLoopPcm(concat(body, body, body), SR)
  const noisyRepeat = analyzeLoopPcm(concat(body, dirty, body), SR)
  assert.ok(clean.ok)
  const cleanBest = clean.candidates[0]!
  assert.equal(cleanBest.recommendedCrossfadeMs, 0)
  if (noisyRepeat.ok) {
    const worst = noisyRepeat.candidates[0]!
    assert.ok(worst.confidence < cleanBest.confidence, 'noise in one repeat lowers confidence')
    if (worst.quality !== 'high') assert.ok(worst.recommendedCrossfadeMs >= 10)
  }
})

test('crossfade policy and calibration are monotonic and honest', () => {
  assert.equal(recommendCrossfade('high', 1), 0)
  assert.equal(recommendCrossfade('medium', 1), 10)
  assert.equal(recommendCrossfade('low', 1), 25)
  assert.equal(recommendCrossfade('low', 0.2), 40)
  const perfect = { similarity: 1, coverage: 1, refinement: 1, seam: 1, margin: 1, beat: 1, level: 1 }
  const best = calibrate(perfect)
  assert.ok(best >= HIGH_CONFIDENCE && best < 1, 'capped below certainty')
  assert.ok(calibrate({ ...perfect, refinement: 0.3 }) < best)
  assert.ok(calibrate({ ...perfect, similarity: 0.1 }) < LOW_CONFIDENCE, 'one very weak component cannot hide')
  assert.ok(calibrate(perfect, true) < best, 'a loop that starts in silence is distrusted')
  assert.equal(qualityOf(0.8), 'high')
  assert.equal(qualityOf(0.79), 'medium')
  assert.equal(qualityOf(0.5), 'medium')
  assert.equal(qualityOf(0.49), 'low')
  assert.notEqual(describeConfidence(0.9), describeConfidence(0.3))
  assert.ok(!/\bperfect\b/i.test(describeConfidence(0.95)), 'never claims perfection')
})

test('analysis is deterministic', () => {
  const { pcm } = introBodyFade(SR)
  assert.deepEqual(analyzeLoopPcm(pcm, SR), analyzeLoopPcm(pcm, SR))
})

test('a fade-out that overlaps the last repeat is not treated as a confident loop end', () => {
  const intro = renderNotes(31, 2, SR, 0.15)
  const body = renderNotes(32, 18, SR)
  const pcm = concat(intro, body, fadeOut(body), new Float32Array(SR))
  const result = analyzeLoopPcm(pcm, SR)
  if (result.ok) {
    for (const c of result.candidates) assert.ok(c.endSample <= result.info.durationSamples)
    assert.ok(result.candidates.every((c) => c.confidence < 0.99))
  } else {
    assert.ok(['no_repetition', 'too_short'].includes(result.reason))
  }
})

test('3-minute 44.1 kHz track is analysed well inside a few seconds', () => {
  const sr = 44100
  const body = renderNotes(6, 85, sr)
  const pcm = concat(renderNotes(5, 6, sr, 0.15), body, body, fadeOut(body.subarray(0, 6 * sr)))
  assert.ok(pcm.length / sr > 180)
  const stages: string[] = []
  const started = performance.now()
  const result = analyzeLoopPcm(pcm, sr, {
    onProgress: (_fraction, stage) => {
      if (stages.at(-1) !== stage) stages.push(stage)
    },
  })
  const elapsed = performance.now() - started
  console.log(`# analysis of ${(pcm.length / sr).toFixed(0)} s at ${sr} Hz took ${elapsed.toFixed(0)} ms`)
  assert.ok(result.ok)
  assert.ok(Math.abs(result.candidates[0]!.endSample - result.candidates[0]!.startSample - body.length) <= 110)
  assert.ok(elapsed < 6000, `took ${elapsed} ms`)
  assert.ok(stages.length >= 4 && stages.at(-1) === 'Done')
})
