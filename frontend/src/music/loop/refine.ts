// Sample-level seam refinement. Runs only AFTER musical alignment has chosen a candidate:
//   1. refineLag      cross-correlation of the music after the seam against the music after the start
//   2. findBodyStart  walk the match backwards to the exact point where the repetition begins
//   3. nudgeSeam      tiny common shift of both points to the least audible waveform seam
// Costs: refineLag ~ (search / decimation) x window (coarse) + (2 x decimation) x window (fine).
import { decimate, decimationFactor } from './features.ts'
import type { SeamMetrics } from './types.ts'

/** Normalised cross-correlation of x[a..a+len) and x[b..b+len); -1 when out of range or silent. */
export function ncc(x: Float32Array, a: number, b: number, len: number): number {
  if (len <= 0 || a < 0 || b < 0 || a + len > x.length || b + len > x.length) return -1
  let dot = 0
  let ea = 0
  let eb = 0
  for (let i = 0; i < len; i++) {
    const u = x[a + i]!
    const v = x[b + i]!
    dot += u * v
    ea += u * u
    eb += v * v
  }
  const denom = Math.sqrt(ea * eb)
  return denom < 1e-12 ? -1 : dot / denom
}

interface Decimated {
  data: Float32Array
  factor: number
  prefix: Float64Array
}

const decimatedCache = new WeakMap<Float32Array, Decimated>()

function decimatedOf(x: Float32Array, sampleRate: number): Decimated {
  const cached = decimatedCache.get(x)
  if (cached) return cached
  const factor = decimationFactor(sampleRate)
  const data = decimate(x, factor)
  const prefix = new Float64Array(data.length + 1)
  for (let i = 0; i < data.length; i++) prefix[i + 1] = prefix[i]! + data[i]! * data[i]!
  const entry = { data, factor, prefix }
  decimatedCache.set(x, entry)
  return entry
}

export interface LagRefinement {
  /** Refined distance end - start, in samples. */
  lag: number
  /** NCC of the window after `position` against the window `lag` later. */
  correlation: number
}

/**
 * Finds the lag near `lagApprox` (within +/- radius samples) that best aligns the window starting
 * at `position` with the window starting `lag` samples later. Coarse search on the decimated signal
 * (with sliding energies), then an exact search at full rate around the coarse peak.
 */
export function refineLag(
  x: Float32Array,
  sampleRate: number,
  position: number,
  lagApprox: number,
  radius: number,
  windowSamples: number,
): LagRefinement {
  const dec = decimatedOf(x, sampleRate)
  const { data, factor, prefix } = dec
  const window = Math.max(64, Math.min(windowSamples, x.length - position - (lagApprox + radius) - 1))
  let coarseLag = Math.round(lagApprox / factor)
  if (factor > 1) {
    const p = Math.round(position / factor)
    const w = Math.floor(window / factor)
    const r = Math.ceil(radius / factor)
    let a2 = prefix[Math.min(data.length, p + w)]! - prefix[Math.min(data.length, p)]!
    a2 = Math.max(a2, 1e-12)
    let best = -Infinity
    for (let lag = coarseLag - r; lag <= coarseLag + r; lag++) {
      if (lag <= 0 || p + lag + w > data.length || p + w > data.length) continue
      let dot = 0
      for (let i = 0; i < w; i++) dot += data[p + i]! * data[p + lag + i]!
      const b2 = prefix[p + lag + w]! - prefix[p + lag]!
      const score = b2 < 1e-12 ? -1 : dot / Math.sqrt(a2 * b2)
      if (score > best) {
        best = score
        coarseLag = lag
      }
    }
  }
  const centre = factor > 1 ? coarseLag * factor : Math.round(lagApprox)
  const span = factor > 1 ? factor + 2 : radius
  let bestLag = centre
  let bestScore = -1
  for (let lag = centre - span; lag <= centre + span; lag++) {
    const score = ncc(x, position, position + lag, window)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return { lag: bestLag, correlation: bestScore }
}

const BLOCK_SECONDS = 0.01
const MATCH_RESIDUAL = 0.45

/**
 * Relative residual energy of x[a..a+len) against x[a+lag..): 0 identical, ~1 unrelated.
 * -1 when both blocks are (nearly) silent compared with `reference` (mean energy per sample).
 */
function residual(x: Float32Array, a: number, lag: number, len: number, reference: number): number {
  if (a < 0 || a + lag + len > x.length) return 1
  let e1 = 0
  let e2 = 0
  let diff = 0
  for (let i = 0; i < len; i++) {
    const u = x[a + i]!
    const v = x[a + lag + i]!
    e1 += u * u
    e2 += v * v
    const d = u - v
    diff += d * d
  }
  const total = e1 + e2
  return total < 0.02 * reference * len || total < 1e-10 * len ? -1 : diff / total
}

/**
 * Walks backwards from `position` (inside a verified repetition) to where the repetition starts,
 * in 10 ms blocks and then 0.5 ms steps. Quiet blocks (below -17 dB of the repetition's level)
 * neither extend nor continue the walk past a mismatch, so decaying tails cannot fake a match.
 */
export function findBodyStart(x: Float32Array, sampleRate: number, position: number, lag: number, floor = 0): number {
  const block = Math.max(16, Math.round(sampleRate * BLOCK_SECONDS))
  const probe = Math.min(Math.round(sampleRate * 0.5), x.length - position)
  let reference = 0
  for (let i = 0; i < probe; i++) reference += x[position + i]! * x[position + i]!
  reference /= Math.max(1, probe)
  let earliest = position
  let t = position
  let misses = 0
  while (t - block >= floor) {
    const r = residual(x, t - block, lag, block, reference)
    if (r >= 0 && r < MATCH_RESIDUAL) {
      earliest = t - block
      misses = 0
    } else if (r >= 0 && ++misses >= 2) break
    t -= block
  }
  return locateBoundary(x, lag, earliest, block, floor)
}

/**
 * Change-point search around `near`: the start u that makes the samples before u mismatch their
 * lagged copy and the samples after u match it (per-sample residual r in 0-1, 0 = identical).
 */
function locateBoundary(x: Float32Array, lag: number, near: number, block: number, floor: number): number {
  const from = Math.max(floor, near - block)
  const to = near + (block >> 1)
  const span = block
  const lo = Math.max(0, from - span)
  const hi = Math.min(x.length - lag, to + span)
  if (hi - lo < 2 * span) return near
  const prefix = new Float64Array(hi - lo + 1)
  for (let i = lo; i < hi; i++) {
    const u = x[i]!
    const v = x[i + lag]!
    const total = u * u + v * v
    const r = total < 1e-10 ? 0.5 : Math.min(1, ((u - v) * (u - v)) / total)
    prefix[i - lo + 1] = prefix[i - lo]! + r
  }
  let best = near
  let bestCost = Infinity
  for (let u = from; u <= to; u++) {
    const a = Math.max(lo, u - span)
    const b = Math.min(hi, u + span)
    const cost = (u - a) - (prefix[u - lo]! - prefix[a - lo]!) + (prefix[b - lo]! - prefix[u - lo]!)
    if (cost < bestCost) {
      bestCost = cost
      best = u
    }
  }
  return best
}

function meanStep(x: Float32Array, centre: number, radius: number): number {
  let sum = 0
  let n = 0
  for (let i = Math.max(1, centre - radius); i < Math.min(x.length, centre + radius); i++) {
    sum += Math.abs(x[i]! - x[i - 1]!)
    n++
  }
  return n > 0 ? sum / n : 0
}

/** Waveform discontinuity of the jump end -> start. Needs end >= 2 and start >= 1. */
export function seamMetrics(x: Float32Array, sampleRate: number, start: number, end: number): SeamMetrics {
  const radius = Math.max(8, Math.round(sampleRate * 0.01))
  // The source's own step across the end point (x[end-1] -> x[end]) is as natural as a seam gets.
  const natural = end < x.length ? Math.abs(x[end]! - x[end - 1]!) : 0
  const step = Math.max(meanStep(x, start, radius), natural) + 1e-6
  const jump = Math.abs(x[end - 1]! - x[start]!)
  const slopeBefore = x[end - 1]! - x[end - 2]!
  const slopeAfter = x[start + 1]! - x[start]!
  const window = Math.min(Math.round(sampleRate * 0.5), x.length - end, x.length - start)
  return {
    jump,
    jumpRatio: jump / step,
    slopeMismatch: Math.abs(slopeBefore - slopeAfter) / step,
    correlation: Math.max(0, ncc(x, start, end, window)),
  }
}

function seamCost(x: Float32Array, start: number, end: number, step: number): number {
  const jump = (x[end - 1]! - x[start]!) / step
  const slope = (x[end - 1]! - x[end - 2]! - (x[start + 1]! - x[start]!)) / step
  return jump * jump + 0.5 * slope * slope
}

/**
 * Shifts BOTH points by the same small amount (<= 2 ms) when that clearly lowers the waveform
 * discontinuity. The loop length is untouched, so musical alignment is preserved.
 */
export function nudgeSeam(x: Float32Array, sampleRate: number, start: number, end: number): { start: number; end: number; shift: number } {
  const radius = Math.max(4, Math.round(sampleRate * 0.002))
  const step = meanStep(x, start, Math.max(8, Math.round(sampleRate * 0.01))) + 1e-6
  const here = seamCost(x, start, end, step)
  // Already as smooth as the source's own continuation (exact repeat): leave it alone.
  if (end + 2 <= x.length && here <= 1.5 * seamCost(x, end, end, step) + 1) return { start, end, shift: 0 }
  let bestShift = 0
  let bestCost = here
  for (let shift = -radius; shift <= radius; shift++) {
    const s = start + shift
    const e = end + shift
    if (s < 2 || e < 2 || e + 2 > x.length) continue
    const cost = seamCost(x, s, e, step) + 0.01 * Math.abs(shift) / radius
    if (cost < bestCost) {
      bestCost = cost
      bestShift = shift
    }
  }
  // Only move for a clear improvement; an already natural seam stays where musical alignment put it.
  if (bestShift === 0 || bestCost > here * 0.5 || here < 1.5) return { start, end, shift: 0 }
  return { start: start + bestShift, end: end + bestShift, shift: bestShift }
}

export interface SeamRefinement {
  startSample: number
  endSample: number
  correlation: number
  nudge: number
  seam: SeamMetrics
}

export interface RefineSeamOptions {
  /** Lag search radius in ms (default 80). */
  searchMs?: number
  /** Correlation window after the seam in ms (default 500). */
  windowMs?: number
  /** Walk the repetition back to its exact start (default false: keep the given start). */
  walkBack?: boolean
  /** Apply the small common waveform nudge (default true). */
  nudge?: boolean
}

/**
 * Aligns `endApprox` to the exact sample at which the music after it repeats the music after
 * `startApprox`, optionally extends the start back to where the repetition begins, then nudges.
 */
export function refineSeam(
  x: Float32Array,
  sampleRate: number,
  startApprox: number,
  endApprox: number,
  options: RefineSeamOptions = {},
): SeamRefinement {
  const radius = Math.round(((options.searchMs ?? 80) / 1000) * sampleRate)
  const windowSamples = Math.round(((options.windowMs ?? 500) / 1000) * sampleRate)
  const { lag, correlation } = refineLag(x, sampleRate, startApprox, endApprox - startApprox, radius, windowSamples)
  let start = startApprox
  if (options.walkBack) start = findBodyStart(x, sampleRate, startApprox, lag)
  let end = start + lag
  let nudge = 0
  if (options.nudge !== false && start >= 2 && end + 2 <= x.length) {
    const nudged = nudgeSeam(x, sampleRate, start, end)
    start = nudged.start
    end = nudged.end
    nudge = nudged.shift
  }
  end = Math.min(end, x.length)
  return { startSample: start, endSample: end, correlation, nudge, seam: seamMetrics(x, sampleRate, Math.max(1, start), Math.max(2, end)) }
}
