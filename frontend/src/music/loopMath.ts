// Pure loop-region maths: validation, sample -> seconds conversion, loop position tracking
// and the optional seam crossfade. No Web Audio types, so everything is unit-testable.
import type { LoopMetadata, LoopProvenance, LoopRegion } from './types.ts'

/** A loop shorter than this is treated as malformed metadata (it would stutter). */
export const MIN_LOOP_SECONDS = 1

export type LoopValidation = { ok: true } | { ok: false; reason: string }

export function validateLoopRegion(region: LoopRegion, durationSamples?: number): LoopValidation {
  const { startSample, endSample, sampleRate } = region
  if (!Number.isInteger(startSample) || !Number.isInteger(endSample)) {
    return { ok: false, reason: 'loop points must be integer sample positions' }
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return { ok: false, reason: 'sampleRate must be positive' }
  if (startSample < 0 || endSample < 0) return { ok: false, reason: 'loop points must not be negative' }
  if (startSample >= endSample) return { ok: false, reason: 'loopStart must be before loopEnd' }
  if (durationSamples !== undefined && endSample > durationSamples) {
    return { ok: false, reason: 'loopEnd is beyond the end of the audio' }
  }
  if ((endSample - startSample) / sampleRate < MIN_LOOP_SECONDS) {
    return { ok: false, reason: `loop is shorter than ${MIN_LOOP_SECONDS} second` }
  }
  if (region.crossfadeMs !== undefined && !(Number.isFinite(region.crossfadeMs) && region.crossfadeMs >= 0)) {
    return { ok: false, reason: 'crossfadeMs must be a non-negative number' }
  }
  return { ok: true }
}

export function regionToSeconds(region: LoopRegion): { start: number; end: number } {
  return { start: region.startSample / region.sampleRate, end: region.endSample / region.sampleRate }
}

/**
 * Playback position (seconds) after `elapsed` seconds of playing from 0 with the given loop.
 * Plays straight through to `loopEnd`, then wraps inside [loopStart, loopEnd).
 */
export function loopPosition(elapsed: number, loopStart: number, loopEnd: number): number {
  if (elapsed < loopEnd) return Math.max(0, elapsed)
  const length = loopEnd - loopStart
  return length > 0 ? loopStart + ((elapsed - loopStart) % length) : 0
}

/**
 * Returns a COPY of `channels` in which the samples just before `endSample` blend
 * (equal-power) into the samples just before `startSample`. When playback jumps from
 * endSample-1 to startSample, the signal is then continuous. The crossfade is clamped to
 * the material available (before the loop start, and half the loop length).
 */
export function bakeLoopCrossfade(
  channels: Float32Array[],
  startSample: number,
  endSample: number,
  crossfadeSamples: number,
): Float32Array[] {
  const copies = channels.map((channel) => channel.slice())
  const length = copies[0]?.length ?? 0
  const end = Math.min(endSample, length)
  const available = Math.min(startSample, Math.floor((end - startSample) / 2))
  const fade = Math.min(Math.floor(crossfadeSamples), available)
  if (fade <= 0) return copies
  for (const channel of copies) {
    for (let i = 0; i < fade; i++) {
      const t = ((i + 1) / fade) * (Math.PI / 2)
      const tail = end - fade + i
      const head = startSample - fade + i
      channel[tail] = (channel[tail] ?? 0) * Math.cos(t) + (channel[head] ?? 0) * Math.sin(t)
    }
  }
  return copies
}

const PROVENANCES: readonly LoopProvenance[] = ['curated-analysis', 'auto-detected', 'user-accepted', 'user-adjusted', 'none']

const NO_LOOP: LoopMetadata = { region: null, confidence: null, provenance: 'none' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads untrusted loop metadata. Anything malformed becomes "no loop" (never throws). */
export function parseLoopMetadata(raw: unknown): LoopMetadata {
  if (!isRecord(raw)) return { ...NO_LOOP }
  const { startSample, endSample, sampleRate, crossfadeMs, confidence, provenance, note } = raw
  if (typeof startSample !== 'number' || typeof endSample !== 'number' || typeof sampleRate !== 'number') {
    return { ...NO_LOOP }
  }
  const region: LoopRegion = { startSample, endSample, sampleRate }
  if (typeof crossfadeMs === 'number') region.crossfadeMs = crossfadeMs
  if (!validateLoopRegion(region).ok) return { ...NO_LOOP }
  const known = PROVENANCES.find((p) => p === provenance)
  return {
    region,
    confidence: typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null,
    provenance: known && known !== 'none' ? known : 'auto-detected', // unknown origin: claim the least
    ...(typeof note === 'string' ? { note } : {}),
  }
}
