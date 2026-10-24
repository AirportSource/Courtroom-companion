// Web Worker host for the loop analyser: keeps the multi-hundred-millisecond DSP off the UI thread.
// Protocol: main -> worker AnalysisRequest, worker -> main AnalysisMessage (progress*, then result).
import { analyzeLoopPcm } from './analyzer.ts'
import type { AnalysisResult, AnalyzeOptions } from './types.ts'

export interface AnalysisRequest {
  pcm: Float32Array
  sampleRate: number
  options: Pick<AnalyzeOptions, 'maxCandidates' | 'minLoopSeconds' | 'minLoopFraction'>
}

export type AnalysisMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'result'; result: AnalysisResult }

interface WorkerScope {
  onmessage: ((event: { data: AnalysisRequest }) => void) | null
  postMessage(message: AnalysisMessage): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const { pcm, sampleRate, options } = event.data
  try {
    const result = analyzeLoopPcm(pcm, sampleRate, {
      ...options,
      onProgress: (fraction, stage) => scope.postMessage({ type: 'progress', fraction, stage }),
    })
    scope.postMessage({ type: 'result', result })
  } catch {
    scope.postMessage({ type: 'result', result: { ok: false, reason: 'worker_failed', message: 'The loop analysis failed unexpectedly.' } })
  }
}
