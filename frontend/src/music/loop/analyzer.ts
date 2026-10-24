// Automatic loop detection on mono PCM. Pure and deterministic: no DOM, no Web Audio, no clock.
//
// Pipeline (N = samples, n = feature frames ~ N / 2048 at 44.1 kHz, d = 20 feature dims):
//   1. decimate to ~11 kHz (box average)                                          O(N)
//   2. level envelope -> leading silence, trailing silence, trailing fade-out      O(N)
//   3. chroma + spectral-shape frames (1024-pt FFT, ~46 ms hop), gain invariant     O(n log)
//   4. tempo from onset-flux autocorrelation (weak prior only)                      O(N)
//   5. lag scan: for every lag L >= minLoop, cosine similarity of frame t vs t+L,
//      keep the longest high-similarity diagonal run ("what plays after the loop end
//      continues like what plays after the loop start")                             O(n^2 d / 2) worst case
//   6. non-maximum suppression over lags -> a dozen candidates
//   7. sample-level refinement (refine.ts): cross-correlate to the exact lag, walk the
//      match back to the exact start, then a <= 2 ms common nudge for waveform continuity
//   8. rank (similarity, coverage, beat grid, end position, level match, fade/silence
//      penalties, multiples of a shorter equally good loop demoted) and calibrate confidence.
// Measured: ~1 s for a 3 minute 44.1 kHz track in Node (see tests/loopAnalyzer.test.ts).
import { computeFeatures, decimate, decimationFactor, estimateTempo, findUsable, levelEnvelope } from './features.ts'
import type { FeatureMatrix, Tempo } from './features.ts'
import { findBodyStart, nudgeSeam, refineLag, seamMetrics } from './refine.ts'
import { qualityOf } from './types.ts'
import type { AnalysisResult, AnalyzeOptions, LoopCandidate, LoopScores } from './types.ts'

const MIN_DURATION_SECONDS = 12
const TAU = 0.5 // frame similarity that counts as "repeats"
const BRIDGE_SECONDS = 0.15 // short rests inside a repetition do not end the run
const MAX_FRAMES = 5000 // longer tracks pool frames to bound the O(n^2) lag scan
const SHORTLIST = 10

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

interface LagRun {
  lag: number // frames
  start: number // first frame of the run
  end: number // last frame of the run (inclusive)
  similarity: number // mean frame similarity over the run, bridged frames counting as 0
  value: number // ranking value of the lag scan
}

function similarityScore(mean: number): number {
  return clamp01((mean - 0.45) / (0.92 - 0.45))
}

function scanLags(
  feat: FeatureMatrix,
  hopSeconds: number,
  firstFrame: number,
  lagMin: number,
  onProgress: (fraction: number) => void,
): LagRun[] {
  const { data, frames, dims } = feat
  const bridge = Math.max(1, Math.round(BRIDGE_SECONDS / hopSeconds))
  const runs: LagRun[] = []
  const lagMax = frames - firstFrame - 3
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const lagSeconds = lag * hopSeconds
    const reference = Math.min(lagSeconds, 20)
    const minRun = Math.max(3, Math.ceil(Math.max(4, 0.5 * reference) / hopSeconds))
    const last = frames - lag
    if (last - firstFrame < minRun) break
    let runStart = -1
    let lastGood = -1
    let sum = 0
    const found: { best: LagRun | null } = { best: null }
    const close = () => {
      const length = lastGood - runStart + 1
      if (runStart < 0 || length < minRun) return
      const similarity = sum / length
      const coverage = clamp01((length * hopSeconds) / reference)
      const value = similarityScore(similarity) * (0.55 + 0.45 * coverage)
      if (coverage >= 0.5 && (!found.best || value > found.best.value)) found.best = { lag, start: runStart, end: lastGood, similarity, value }
    }
    for (let t = firstFrame; t < last; t++) {
      let dot = 0
      const a = t * dims
      const b = (t + lag) * dims
      for (let k = 0; k < dims; k++) dot += data[a + k]! * data[b + k]!
      if (dot >= TAU) {
        if (runStart < 0) {
          runStart = t
          sum = 0
        }
        sum += dot
        lastGood = t
      } else if (runStart >= 0 && t - lastGood > bridge) {
        close()
        runStart = -1
      }
    }
    if (runStart >= 0) close()
    if (found.best) runs.push(found.best)
    if ((lag & 63) === 0) onProgress((lag - lagMin) / Math.max(1, lagMax - lagMin))
  }
  return runs
}

/** Greedy peak picking over lags: strongest first, no two within `separation` frames. */
function pickPeaks(runs: LagRun[], separation: number): LagRun[] {
  const sorted = runs.slice().sort((a, b) => b.value - a.value || a.lag - b.lag)
  const picked: LagRun[] = []
  for (const run of sorted) {
    if (picked.length >= SHORTLIST) break
    if (picked.every((other) => Math.abs(other.lag - run.lag) > separation)) picked.push(run)
  }
  return picked
}

function meanDb(db: Float32Array, blockSeconds: number, fromSeconds: number, toSeconds: number): number {
  const a = Math.max(0, Math.floor(fromSeconds / blockSeconds))
  const b = Math.min(db.length, Math.ceil(toSeconds / blockSeconds))
  if (b <= a) return -120
  let sum = 0
  for (let i = a; i < b; i++) sum += db[i]!
  return sum / (b - a)
}

/** Snaps to the strongest onset (energy rise) within +/- radius samples, else keeps the position. */
function snapToOnset(dec: Float32Array, position: number, radius: number): number {
  const block = 64
  const from = Math.max(block, position - radius)
  const to = Math.min(dec.length - block, position + radius)
  const rises: number[] = []
  let bestRise = 0
  let bestAt = position
  for (let t = from; t <= to; t += block >> 1) {
    let before = 0
    let after = 0
    for (let i = 0; i < block; i++) {
      before += Math.abs(dec[t - block + i]!)
      after += Math.abs(dec[t + i]!)
    }
    const rise = after - before
    rises.push(Math.abs(rise))
    if (rise > bestRise) {
      bestRise = rise
      bestAt = t
    }
  }
  const median = rises.slice().sort((a, b) => a - b)[rises.length >> 1] ?? 0
  return bestRise > 3 * median + 1e-6 ? bestAt : position
}

interface Refined {
  run: LagRun
  startSample: number
  endSample: number
  lag: number
  scores: LoopScores
  seam: ReturnType<typeof seamMetrics>
  adjusted: number
  hardDrop: boolean
  silentStart: boolean
}

function relatedByMultiple(a: number, b: number): boolean {
  const ratio = a > b ? a / b : b / a
  return Math.abs(ratio - Math.round(ratio)) < 0.03 * Math.round(ratio) && Math.round(ratio) >= 2
}

export function analyzeLoopPcm(pcm: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): AnalysisResult {
  const progress = options.onProgress ?? (() => {})
  if (!(pcm instanceof Float32Array) || pcm.length === 0 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    return { ok: false, reason: 'invalid_input', message: 'The audio could not be analysed (invalid samples or sample rate).' }
  }
  const duration = pcm.length / sampleRate
  if (duration < MIN_DURATION_SECONDS) {
    return { ok: false, reason: 'too_short', message: `This track is too short (${duration.toFixed(1)} s) to look for a loop. At least ${MIN_DURATION_SECONDS} s are needed.` }
  }
  const factor = decimationFactor(sampleRate)
  const rate = sampleRate / factor
  progress(0.02, 'Preparing')
  const dec = decimate(pcm, factor)

  const envelope = levelEnvelope(dec, rate)
  const usable = findUsable(envelope)
  if (usable.silent) return { ok: false, reason: 'silent', message: 'The track is silent, so there is nothing to loop.' }
  const startSeconds = usable.startBlock * envelope.blockSeconds
  const endSeconds = usable.endBlock * envelope.blockSeconds
  const usableSeconds = endSeconds - startSeconds
  const minLoopSeconds = Math.max(options.minLoopSeconds ?? 8, (options.minLoopFraction ?? 0.25) * usableSeconds)
  if (usableSeconds < MIN_DURATION_SECONDS || usableSeconds < minLoopSeconds + 4) {
    return { ok: false, reason: 'too_short', message: 'The musical part of this track is too short to contain a repeating loop.' }
  }
  const info = {
    durationSamples: pcm.length,
    usableStartSample: Math.round(startSeconds * sampleRate),
    usableEndSample: Math.min(pcm.length, Math.round(endSeconds * sampleRate)),
    fadeOutSamples: Math.round(usable.fadeBlocks * envelope.blockSeconds * sampleRate),
    tempoBpm: null as number | null,
  }

  progress(0.05, 'Analysing the music')
  const frameCount = Math.floor((dec.length - 1024) / 512) + 1
  const pool = Math.max(1, Math.ceil(frameCount / MAX_FRAMES))
  const feat = computeFeatures(dec, rate, pool, (f) => progress(0.05 + 0.3 * f, 'Analysing the music'))
  const hopSeconds = feat.hop / rate
  const hopOriginal = feat.hop * factor
  const windowOriginal = feat.window * factor
  progress(0.4, 'Finding the beat')
  const tempo: Tempo = estimateTempo(dec, rate)
  info.tempoBpm = tempo.bpm !== null && tempo.strength > 0.1 ? Math.round(tempo.bpm * 10) / 10 : null

  progress(0.45, 'Searching for repetition')
  const firstFrame = Math.max(0, Math.floor(startSeconds / hopSeconds) - 1)
  const lagMin = Math.max(2, Math.ceil(minLoopSeconds / hopSeconds))
  const runs = scanLags(feat, hopSeconds, firstFrame, lagMin, (f) => progress(0.45 + 0.35 * f, 'Searching for repetition'))
  const shortlist = pickPeaks(runs, Math.max(2, Math.round(0.2 / hopSeconds)))
  if (shortlist.length === 0) {
    return { ok: false, reason: 'no_repetition', message: 'No repeating section was found. Set the loop by hand or play the track without a loop.' }
  }

  progress(0.82, 'Refining the loop points')
  const levelNote = (seconds: number, span: number) => meanDb(envelope.db, envelope.blockSeconds, seconds, seconds + span)
  const refined: Refined[] = []
  for (const run of shortlist) {
    const lagApprox = Math.round(run.lag * hopOriginal)
    const runSamples = (run.end - run.start + 1) * hopOriginal
    const frameStart = run.start * hopOriginal
    const inset = windowOriginal + Math.min(0.1 * runSamples, 2 * sampleRate)
    const position = Math.round(frameStart + inset)
    const correlationWindow = Math.round(Math.min(0.5 * sampleRate, 0.3 * runSamples))
    if (position + lagApprox + correlationWindow + hopOriginal * 2 > pcm.length) continue
    const aligned = refineLag(pcm, sampleRate, position, lagApprox, Math.round(1.6 * hopOriginal), correlationWindow)
    const lag = aligned.lag
    const floor = Math.max(0, info.usableStartSample - Math.round(0.05 * sampleRate))
    const fallback = snapToOnset(dec, Math.round(((frameStart + windowOriginal / 2) / factor)), Math.round(hopOriginal / factor)) * factor
    let start = findBodyStart(pcm, sampleRate, position, lag, floor)
    if (start > fallback + hopOriginal) start = fallback // imperfect repeats: trust the feature boundary
    let end = start + lag
    if (end > pcm.length || start < 0 || end < 3) continue
    const nudged = nudgeSeam(pcm, sampleRate, start, end)
    start = nudged.start
    end = nudged.end
    const seam = seamMetrics(pcm, sampleRate, start, end)

    // --- scores -------------------------------------------------------------------------------
    const startSec = start / sampleRate
    const endSec = end / sampleRate
    const lagSec = lag / sampleRate
    const before = levelNote(Math.max(0, endSec - 0.5), 0.5)
    const after = levelNote(startSec, 0.5)
    const level = clamp01(1 - Math.abs(before - after) / 20)
    const silentStart = after < usable.typicalDb - 30
    const hardDrop = before < usable.typicalDb - 25 || endSec > endSeconds + 2
    const beatPeriod = tempo.strength > 0.1 && tempo.periodSeconds > 0 ? tempo.periodSeconds : 0
    let beat = 0.5
    if (beatPeriod > 0) {
      const beats = lagSec / beatPeriod
      beat = clamp01(1 - Math.abs(beats - Math.round(beats)) / Math.max(0.15, 0.008 * beats))
    }
    const scores: LoopScores = {
      similarity: similarityScore(run.similarity),
      coverage: clamp01(((run.end - run.start + 1) * hopSeconds) / Math.min(lagSec, 20)),
      refinement: clamp01((seam.correlation - 0.35) / 0.6),
      seam: clamp01(1 - (Math.max(0, seam.jumpRatio - 2) + 0.5 * Math.max(0, seam.slopeMismatch - 4)) / 8),
      margin: 1,
      beat,
      level,
    }
    const endPosition = clamp01((endSec - startSeconds) / Math.max(1e-6, usableSeconds))
    let adjusted = run.value + 0.04 * (beat - 0.5) + 0.03 * endPosition - 0.15 * (1 - level)
    if (endSec > endSeconds + 0.5) adjusted -= 0.15
    if (silentStart) adjusted -= 0.3
    if (hardDrop) adjusted -= 1
    refined.push({ run, startSample: start, endSample: end, lag, scores, seam, adjusted, hardDrop, silentStart })
  }

  // Demote an N-times-longer loop when a shorter one is about as good (it is the same loop repeated).
  for (const a of refined) {
    for (const b of refined) {
      if (a !== b && a.lag > b.lag && relatedByMultiple(a.lag, b.lag) && b.adjusted >= a.adjusted - 0.03) a.adjusted -= 0.05
    }
  }
  refined.sort((a, b) => b.adjusted - a.adjusted || a.lag - b.lag)
  const kept: Refined[] = []
  for (const item of refined) {
    if (item.hardDrop) continue
    if (kept.some((other) => Math.abs(other.lag - item.lag) < 0.05 * sampleRate && Math.abs(other.startSample - item.startSample) < 0.5 * sampleRate)) continue
    kept.push(item)
  }
  if (kept.length === 0) {
    return { ok: false, reason: 'no_repetition', message: 'The repeating sections found do not end in a usable place (silence or a fade-out). Set the loop by hand.' }
  }

  const top = kept[0]!
  const rival = kept.slice(1).find((item) => Math.abs(item.lag - top.lag) > 0.1 * sampleRate && !relatedByMultiple(item.lag, top.lag))
  top.scores.margin = rival ? 0.4 + 0.6 * clamp01((top.adjusted - rival.adjusted) / Math.max(0.1, top.adjusted) / 0.2) : 1
  for (const other of kept.slice(1)) other.scores.margin = 0.4

  const candidates: LoopCandidate[] = kept.slice(0, options.maxCandidates ?? 3).map((item) => {
    const confidence = calibrate(item.scores, item.silentStart)
    const quality = qualityOf(confidence)
    return {
      startSample: item.startSample,
      endSample: item.endSample,
      sampleRate,
      confidence,
      quality,
      recommendedCrossfadeMs: recommendCrossfade(quality, item.scores.seam),
      scores: item.scores,
      seam: item.seam,
    }
  })
  candidates.sort((a, b) => b.confidence - a.confidence || a.endSample - b.endSample)
  progress(1, 'Done')
  return { ok: true, sampleRate, candidates, info }
}

const WEIGHTS: Record<'similarity' | 'coverage' | 'refinement' | 'seam' | 'margin', number> = {
  similarity: 0.4,
  coverage: 0.1,
  refinement: 0.25,
  seam: 0.1,
  margin: 0.15,
}

/**
 * Weighted geometric mean of the evidence scores (a single weak component drags the result down),
 * scaled by loudness continuity. Capped below 1: this is evidence, not proof.
 */
export function calibrate(scores: LoopScores, silentStart = false): number {
  let logSum = 0
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) logSum += WEIGHTS[key] * Math.log(Math.max(0.02, scores[key]))
  let confidence = Math.exp(logSum) * (0.5 + 0.5 * scores.level)
  if (silentStart) confidence *= 0.5
  return Math.round(Math.min(0.99, Math.max(0, confidence)) * 1000) / 1000
}

/** Short baked crossfade for imperfect seams only; a high-confidence loop needs none. */
export function recommendCrossfade(quality: 'high' | 'medium' | 'low', seamScore: number): number {
  if (quality === 'high') return seamScore < 0.7 ? 5 : 0
  if (quality === 'medium') return 10
  return seamScore < 0.5 ? 40 : 25
}
