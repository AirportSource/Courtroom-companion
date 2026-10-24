// Feature extraction for loop analysis. Everything is O(samples) or O(frames x FFT) and pure.
import { fft, fftPlan } from './fft.ts'

export const ANALYSIS_RATE = 11025
export const FRAME_SIZE = 1024
export const FRAME_HOP = 512
export const CHROMA_BINS = 12
export const BAND_EDGES_HZ = [60, 120, 250, 500, 1000, 2000, 3500, 5000, 5512]
export const FEATURE_DIMS = CHROMA_BINS + (BAND_EDGES_HZ.length - 1)

/** Box-average decimation: cheap anti-aliasing, good enough for feature/lag work. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x
  const length = Math.floor(x.length / factor)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k++) sum += x[base + k]!
    out[i] = sum / factor
  }
  return out
}

export function decimationFactor(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / ANALYSIS_RATE))
}

export function dbOf(rms: number): number {
  return 20 * Math.log10(rms + 1e-9)
}

export interface FeatureMatrix {
  /** frames x FEATURE_DIMS, each row centred and L2-normalised (zero row = silent frame). */
  data: Float32Array
  frames: number
  dims: number
  /** Samples of the decimated signal between frames (after pooling). */
  hop: number
  /** Window length of one frame in decimated samples. */
  window: number
  /** RMS level of each frame in dB (before normalisation). */
  levelDb: Float32Array
}

/** Chroma + spectral-shape features. Sqrt magnitudes keep them invariant to gain (fades). */
export function computeFeatures(
  x: Float32Array,
  rate: number,
  pool: number,
  onProgress?: (fraction: number) => void,
): FeatureMatrix {
  const frames = Math.max(0, Math.floor((x.length - FRAME_SIZE) / FRAME_HOP) + 1)
  const plan = fftPlan(FRAME_SIZE)
  const window = new Float64Array(FRAME_SIZE)
  for (let i = 0; i < FRAME_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME_SIZE)
  const binCount = FRAME_SIZE / 2
  const chromaOf = new Int8Array(binCount).fill(-1)
  const bandOf = new Int8Array(binCount).fill(-1)
  for (let k = 1; k < binCount; k++) {
    const hz = (k * rate) / FRAME_SIZE
    if (hz >= 150 && hz <= 3520) chromaOf[k] = (((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12)
    for (let b = 0; b < BAND_EDGES_HZ.length - 1; b++) {
      if (hz >= BAND_EDGES_HZ[b]! && hz < BAND_EDGES_HZ[b + 1]!) bandOf[k] = b
    }
  }
  const raw = new Float32Array(frames * FEATURE_DIMS)
  const levelDb = new Float32Array(frames)
  const re = new Float64Array(FRAME_SIZE)
  const im = new Float64Array(FRAME_SIZE)
  const chroma = new Float64Array(CHROMA_BINS)
  const bands = new Float64Array(BAND_EDGES_HZ.length - 1)
  for (let f = 0; f < frames; f++) {
    const base = f * FRAME_HOP
    let energy = 0
    for (let i = 0; i < FRAME_SIZE; i++) {
      const v = x[base + i]!
      energy += v * v
      re[i] = v * window[i]!
      im[i] = 0
    }
    levelDb[f] = dbOf(Math.sqrt(energy / FRAME_SIZE))
    fft(plan, re, im)
    chroma.fill(0)
    bands.fill(0)
    for (let k = 1; k < binCount; k++) {
      const mag = Math.sqrt(Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!))
      const c = chromaOf[k]!
      if (c >= 0) chroma[c]! += mag
      const b = bandOf[k]!
      if (b >= 0) bands[b]! += mag
    }
    normaliseInto(raw, f * FEATURE_DIMS, chroma)
    normaliseInto(raw, f * FEATURE_DIMS + CHROMA_BINS, bands)
    if (onProgress && (f & 255) === 0) onProgress(f / frames)
  }
  const pooled = poolFrames(raw, levelDb, frames, pool)
  return {
    data: finaliseRows(pooled.data, pooled.levelDb),
    frames: pooled.frames,
    dims: FEATURE_DIMS,
    hop: FRAME_HOP * pool,
    window: FRAME_SIZE + FRAME_HOP * (pool - 1),
    levelDb: pooled.levelDb,
  }
}

function normaliseInto(out: Float32Array, offset: number, values: Float64Array): void {
  let norm = 0
  for (let i = 0; i < values.length; i++) norm += values[i]! * values[i]!
  norm = Math.sqrt(norm)
  if (norm < 1e-9) return
  for (let i = 0; i < values.length; i++) out[offset + i] = values[i]! / norm
}

function poolFrames(
  data: Float32Array,
  levelDb: Float32Array,
  frames: number,
  pool: number,
): { data: Float32Array; levelDb: Float32Array; frames: number } {
  if (pool <= 1) return { data, levelDb, frames }
  const count = Math.floor(frames / pool)
  const out = new Float32Array(count * FEATURE_DIMS)
  const levels = new Float32Array(count)
  for (let p = 0; p < count; p++) {
    let maxLevel = -Infinity
    for (let k = 0; k < pool; k++) {
      const f = p * pool + k
      maxLevel = Math.max(maxLevel, levelDb[f]!)
      for (let d = 0; d < FEATURE_DIMS; d++) out[p * FEATURE_DIMS + d]! += data[f * FEATURE_DIMS + d]! / pool
    }
    levels[p] = maxLevel
  }
  return { data: out, levelDb: levels, frames: count }
}

/** Centre rows on the mean of the non-silent frames, then L2-normalise (silent rows stay zero). */
function finaliseRows(data: Float32Array, levelDb: Float32Array): Float32Array {
  const frames = levelDb.length
  let peak = -Infinity
  for (let f = 0; f < frames; f++) peak = Math.max(peak, levelDb[f]!)
  const floor = peak - 55
  const mean = new Float64Array(FEATURE_DIMS)
  let count = 0
  for (let f = 0; f < frames; f++) {
    if (levelDb[f]! < floor) continue
    count++
    for (let d = 0; d < FEATURE_DIMS; d++) mean[d]! += data[f * FEATURE_DIMS + d]!
  }
  for (let d = 0; d < FEATURE_DIMS; d++) mean[d]! /= Math.max(1, count)
  for (let f = 0; f < frames; f++) {
    const base = f * FEATURE_DIMS
    if (levelDb[f]! < floor) {
      data.fill(0, base, base + FEATURE_DIMS)
      continue
    }
    let norm = 0
    for (let d = 0; d < FEATURE_DIMS; d++) {
      const v = data[base + d]! - mean[d]!
      data[base + d] = v
      norm += v * v
    }
    norm = Math.sqrt(norm)
    if (norm < 1e-6) data.fill(0, base, base + FEATURE_DIMS)
    else for (let d = 0; d < FEATURE_DIMS; d++) data[base + d]! /= norm
  }
  return data
}

export interface Envelope {
  /** Level in dB per block. */
  db: Float32Array
  blockSeconds: number
}

/** RMS level per block of the decimated signal. */
export function levelEnvelope(x: Float32Array, rate: number, blockSeconds = 0.1): Envelope {
  const block = Math.max(1, Math.round(rate * blockSeconds))
  const count = Math.floor(x.length / block)
  const db = new Float32Array(count)
  for (let b = 0; b < count; b++) {
    let sum = 0
    for (let i = 0; i < block; i++) {
      const v = x[b * block + i]!
      sum += v * v
    }
    db[b] = dbOf(Math.sqrt(sum / block))
  }
  return { db, blockSeconds: block / rate }
}

export interface Usable {
  startBlock: number
  /** Exclusive end block of the musical body (before trailing silence and fade-out). */
  endBlock: number
  fadeBlocks: number
  peakDb: number
  typicalDb: number
  silent: boolean
}

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] ?? -120
}

/** Leading silence, trailing silence and a trailing fade-out, from the block level envelope. */
export function findUsable(env: Envelope): Usable {
  const { db } = env
  const peakDb = percentile(Array.from(db), 0.95)
  const none: Usable = { startBlock: 0, endBlock: db.length, fadeBlocks: 0, peakDb, typicalDb: peakDb, silent: true }
  if (db.length === 0 || peakDb < -75) return none
  const floor = peakDb - 45
  let startBlock = 0
  while (startBlock < db.length && db[startBlock]! < floor) startBlock++
  let endBlock = db.length
  while (endBlock > startBlock && db[endBlock - 1]! < floor) endBlock--
  if (endBlock - startBlock < 2) return none
  const body = Array.from(db.subarray(startBlock, endBlock))
  const typicalDb = percentile(body, 0.6)
  // Smooth over ~0.5 s, then walk back while the level stays well below the typical level.
  const width = Math.max(1, Math.round(0.5 / env.blockSeconds))
  const smooth = (index: number): number => {
    let sum = 0
    let n = 0
    for (let i = Math.max(startBlock, index - width + 1); i <= index; i++) {
      sum += db[i]!
      n++
    }
    return sum / Math.max(1, n)
  }
  let fadeStart = endBlock
  while (fadeStart > startBlock + width && smooth(fadeStart - 1) < typicalDb - 6) fadeStart--
  const fadeBlocks = endBlock - fadeStart
  const fadeSeconds = fadeBlocks * env.blockSeconds
  const drop = fadeBlocks > 0 ? smooth(fadeStart + 1) - smooth(endBlock - 1) : 0
  const isFade = fadeSeconds >= 1 && drop >= 6
  return {
    startBlock,
    endBlock: isFade ? fadeStart : endBlock,
    fadeBlocks: isFade ? fadeBlocks : 0,
    peakDb,
    typicalDb,
    silent: false,
  }
}

export interface Tempo {
  bpm: number | null
  periodSeconds: number
  strength: number
}

/** Beat period from the autocorrelation of an onset (positive log-energy flux) envelope. */
export function estimateTempo(x: Float32Array, rate: number): Tempo {
  const none: Tempo = { bpm: null, periodSeconds: 0, strength: 0 }
  const block = Math.max(1, Math.round(rate * 0.0116))
  const blockSeconds = block / rate
  const count = Math.floor(x.length / block)
  if (count < 200) return none
  const flux = new Float32Array(count)
  let previous = 0
  for (let b = 0; b < count; b++) {
    let sum = 0
    for (let i = 0; i < block; i++) {
      const v = x[b * block + i]!
      sum += v * v
    }
    const level = Math.log1p(1000 * Math.sqrt(sum / block))
    flux[b] = Math.max(0, level - previous)
    previous = level
  }
  let mean = 0
  for (let b = 0; b < count; b++) mean += flux[b]!
  mean /= count
  for (let b = 0; b < count; b++) flux[b]! -= mean
  const lo = Math.floor(0.3 / blockSeconds)
  const hi = Math.ceil(1.0 / blockSeconds)
  const limit = Math.min(count - 1, hi * 4)
  const ac = new Float64Array(limit + 1)
  for (let lag = 0; lag <= limit; lag++) {
    let sum = 0
    for (let b = 0; b + lag < count; b++) sum += flux[b]! * flux[b + lag]!
    ac[lag] = sum / (count - lag)
  }
  if (ac[0]! <= 1e-12) return none
  let best = -Infinity
  let bestLag = 0
  for (let lag = lo; lag <= hi; lag++) {
    const score = ac[lag]! + 0.5 * (ac[lag * 2] ?? 0) + 0.25 * (ac[lag * 4] ?? 0)
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  if (bestLag === 0 || best <= 0) return none
  const a = ac[bestLag - 1]!
  const b = ac[bestLag]!
  const c = ac[bestLag + 1]!
  const denom = a - 2 * b + c
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
  const periodSeconds = (bestLag + shift) * blockSeconds
  return { bpm: 60 / periodSeconds, periodSeconds, strength: Math.max(0, Math.min(1, ac[bestLag]! / ac[0]!)) }
}
