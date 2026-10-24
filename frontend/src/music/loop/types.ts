// Result contracts of the automatic loop analyser. Positions are SAMPLES at `sampleRate`, the
// rate of the analysed audio (they map one-to-one onto the shared LoopRegion in ../types.ts).

export type LoopQuality = 'high' | 'medium' | 'low'

/** Confidence thresholds. "high" means strong evidence, never a guarantee. */
export const HIGH_CONFIDENCE = 0.8
export const LOW_CONFIDENCE = 0.5

export function qualityOf(confidence: number): LoopQuality {
  return confidence >= HIGH_CONFIDENCE ? 'high' : confidence >= LOW_CONFIDENCE ? 'medium' : 'low'
}

/** Each score is 0-1 (1 = best); the confidence is their weighted geometric mean, then penalised. */
export interface LoopScores {
  /** Feature (chroma + spectral shape) similarity of the music after the seam vs after the start. */
  similarity: number
  /** How much of one loop length verifiably repeats. */
  coverage: number
  /** Normalised cross-correlation of the waveforms after refinement. */
  refinement: number
  /** Waveform continuity at the jump (click risk). */
  seam: number
  /** Lead over the runner-up distinct candidate (1 when it is the only one). */
  margin: number
  /** Loop length is a whole number of beats (weak prior, never decisive). */
  beat: number
  /** Loudness match between loop end and loop start (a fade or a drop lowers it). */
  level: number
}

export interface SeamMetrics {
  /** |x[end-1] - x[start]| in full-scale units. */
  jump: number
  /** jump relative to the typical sample-to-sample step nearby (about 1 for a natural seam). */
  jumpRatio: number
  /** |slope before - slope after| relative to the typical step. */
  slopeMismatch: number
  /** Normalised cross-correlation of the 0.5 s after the seam against 0.5 s after the start. */
  correlation: number
}

export interface LoopCandidate {
  startSample: number
  endSample: number
  sampleRate: number
  /** Calibrated 0-1; see qualityOf for the label thresholds. */
  confidence: number
  quality: LoopQuality
  /** 0 for high quality; a short baked crossfade for imperfect seams. */
  recommendedCrossfadeMs: number
  scores: LoopScores
  seam: SeamMetrics
}

export interface AnalysisInfo {
  durationSamples: number
  /** First sample that is clearly not silence. */
  usableStartSample: number
  /** End of the musical body: before the trailing silence and fade-out. */
  usableEndSample: number
  fadeOutSamples: number
  tempoBpm: number | null
}

export type AnalysisFailureReason =
  | 'invalid_input'
  | 'too_short'
  | 'silent'
  | 'no_repetition'
  | 'aborted' // client side: the caller cancelled
  | 'worker_failed' // client side: no Web Worker, or it crashed

export type AnalysisResult =
  | { ok: true; sampleRate: number; candidates: LoopCandidate[]; info: AnalysisInfo }
  | { ok: false; reason: AnalysisFailureReason; message: string }

export interface AnalyzeOptions {
  /** Maximum candidates returned (default 3). */
  maxCandidates?: number
  /** Shortest loop considered, seconds (default 8). */
  minLoopSeconds?: number
  /** Shortest loop as a fraction of the usable musical body (default 0.25). */
  minLoopFraction?: number
  onProgress?: (fraction: number, stage: string) => void
}

/** Plain-language advice for a candidate; honest about uncertainty. */
export function describeConfidence(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE) return 'Strong repetition found. Preview it to be sure; no loop is guaranteed seamless.'
  if (confidence >= LOW_CONFIDENCE) return 'Probable loop. Check the seam by ear; a short crossfade can hide small mismatches.'
  return 'Uncertain loop. Treat it as a rough guess, adjust it by ear, and consider a crossfade.'
}
