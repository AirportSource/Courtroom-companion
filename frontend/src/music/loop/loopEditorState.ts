// Pure state logic of the loop editor: nudge maths, clamping, validity, labels and the mapping
// to the shared LoopMetadata. No React, no Web Audio, so it is unit-testable in Node.
import { MIN_LOOP_SECONDS, validateLoopRegion } from '../loopMath.ts'
import type { LoopMetadata, LoopProvenance } from '../types.ts'
import { describeConfidence, HIGH_CONFIDENCE, LOW_CONFIDENCE, qualityOf } from './types.ts'
import type { LoopCandidate, LoopQuality } from './types.ts'

/** The loop being edited. Samples are canonical; seconds are display only. */
export interface EditorLoop {
  startSample: number
  endSample: number
  sampleRate: number
  /** 0 = no crossfade. */
  crossfadeMs: number
}

export type NudgeTarget = 'start' | 'end'
export type NudgeStep = 'coarse' | 'fine' | 'sample'

export const MAX_CROSSFADE_MS = 100

/** Step sizes: +/-100 ms, +/-5 ms, +/-1 sample. */
export function stepSamples(step: NudgeStep, sampleRate: number): number {
  if (step === 'sample') return 1
  return Math.max(1, Math.round(sampleRate * (step === 'coarse' ? 0.1 : 0.005)))
}

const minLength = (sampleRate: number): number => Math.ceil(MIN_LOOP_SECONDS * sampleRate)

/** Moves one loop point, clamped so the loop stays inside the audio and at least 1 s long. */
export function nudge(loop: EditorLoop, target: NudgeTarget, direction: -1 | 1, step: NudgeStep, durationSamples: number): EditorLoop {
  const delta = direction * stepSamples(step, loop.sampleRate)
  const min = minLength(loop.sampleRate)
  if (target === 'start') {
    const startSample = Math.min(Math.max(0, loop.startSample + delta), loop.endSample - min)
    return { ...loop, startSample: Math.max(0, startSample) }
  }
  const endSample = Math.max(Math.min(durationSamples, loop.endSample + delta), loop.startSample + min)
  return { ...loop, endSample: Math.min(durationSamples, endSample) }
}

export function setCrossfade(loop: EditorLoop, crossfadeMs: number): EditorLoop {
  const bounded = Number.isFinite(crossfadeMs) ? Math.min(MAX_CROSSFADE_MS, Math.max(0, crossfadeMs)) : 0
  // The seam crossfade needs audio before the start and at most half the loop.
  const available = Math.min(loop.startSample, Math.floor((loop.endSample - loop.startSample) / 2))
  const limitMs = (available / loop.sampleRate) * 1000
  return { ...loop, crossfadeMs: Math.round(Math.min(bounded, limitMs) * 10) / 10 }
}

export type LoopValidity = { ok: true } | { ok: false; reason: string }

export function loopValidity(loop: EditorLoop, durationSamples: number): LoopValidity {
  return validateLoopRegion(toRegion(loop), durationSamples)
}

export function toRegion(loop: EditorLoop) {
  return {
    startSample: loop.startSample,
    endSample: loop.endSample,
    sampleRate: loop.sampleRate,
    ...(loop.crossfadeMs > 0 ? { crossfadeMs: loop.crossfadeMs } : {}),
  }
}

export function candidateToLoop(candidate: LoopCandidate, useCrossfade = candidate.recommendedCrossfadeMs > 0): EditorLoop {
  return {
    startSample: candidate.startSample,
    endSample: candidate.endSample,
    sampleRate: candidate.sampleRate,
    crossfadeMs: useCrossfade ? candidate.recommendedCrossfadeMs : 0,
  }
}

export function metadataToLoop(metadata: LoopMetadata | null | undefined): EditorLoop | null {
  const region = metadata?.region
  if (!region) return null
  return { startSample: region.startSample, endSample: region.endSample, sampleRate: region.sampleRate, crossfadeMs: region.crossfadeMs ?? 0 }
}

export function sameLoop(a: EditorLoop, b: EditorLoop): boolean {
  return a.startSample === b.startSample && a.endSample === b.endSample && a.sampleRate === b.sampleRate && a.crossfadeMs === b.crossfadeMs
}

/** Accepting an unchanged proposal is 'user-accepted'; any edit makes it 'user-adjusted'. */
export function acceptLoop(draft: EditorLoop, proposal: EditorLoop | null, confidence: number | null): LoopMetadata {
  const unchanged = proposal !== null && sameLoop(draft, proposal)
  const provenance: LoopProvenance = unchanged ? 'user-accepted' : 'user-adjusted'
  return {
    region: toRegion(draft),
    confidence: unchanged ? confidence : null, // an edited loop has no measured confidence
    provenance,
  }
}

/** Metadata persisted for a fresh automatic proposal (not yet reviewed by the user). */
export function proposalMetadata(candidate: LoopCandidate): LoopMetadata {
  return { region: toRegion(candidateToLoop(candidate)), confidence: candidate.confidence, provenance: 'auto-detected' }
}

/** Analysis runs only when no loop is known; an accepted, adjusted or stored loop is never recomputed. */
export function shouldAutoAnalyse(loop: LoopMetadata | null | undefined): boolean {
  return !loop?.region
}

export function formatSeconds(samples: number, sampleRate: number): string {
  return (samples / sampleRate).toFixed(3)
}

/** Parses seconds typed by the user into whole samples; null for anything not a finite number >= 0. */
export function parseSeconds(text: string, sampleRate: number): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? Math.round(value * sampleRate) : null
}

export interface ConfidenceLabel {
  percent: number
  quality: LoopQuality
  label: string
  advice: string
}

/** Honest wording: the label states evidence strength, never that the loop is perfect. */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  const percent = Math.round(Math.min(0.99, Math.max(0, confidence)) * 100)
  const quality = qualityOf(confidence)
  const label = quality === 'high' ? 'High confidence' : quality === 'medium' ? 'Medium confidence' : 'Low confidence'
  return { percent, quality, label, advice: describeConfidence(confidence) }
}

export { HIGH_CONFIDENCE, LOW_CONFIDENCE }
