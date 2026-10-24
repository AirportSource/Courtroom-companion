// Promise client for the loop analysis worker. Downmixes on the main thread (one cheap pass),
// transfers the mono copy to the worker, reports progress, and supports abort.
// Never throws: every problem is a typed AnalysisResult failure.
import type { AnalysisMessage, AnalysisRequest } from './analysis.worker.ts'
import type { AnalysisResult, AnalyzeOptions } from './types.ts'

/** The slice of the Worker API the client uses (lets tests inject a fake). */
export interface AnalysisWorkerLike {
  postMessage(message: AnalysisRequest, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: { data: AnalysisMessage }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export type AnalysisWorkerFactory = () => AnalysisWorkerLike

export interface AudioBufferLike {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export function defaultWorkerFactory(): AnalysisWorkerLike {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }) as unknown as AnalysisWorkerLike
}

/** Average of all channels into a new mono array (the buffer's own data is never modified). */
export function downmixToMono(buffer: AudioBufferLike): Float32Array {
  const mono = new Float32Array(buffer.length)
  const channels = buffer.numberOfChannels
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < mono.length; i++) mono[i]! += data[i]!
  }
  if (channels > 1) for (let i = 0; i < mono.length; i++) mono[i]! /= channels
  return mono
}

const failure = (reason: 'aborted' | 'worker_failed', message: string): AnalysisResult => ({ ok: false, reason, message })

export function analyzeLoop(
  buffer: AudioBufferLike,
  options: AnalyzeOptions = {},
  signal?: AbortSignal,
  createWorker: AnalysisWorkerFactory = defaultWorkerFactory,
): Promise<AnalysisResult> {
  if (signal?.aborted) return Promise.resolve(failure('aborted', 'Analysis cancelled.'))
  if (typeof Worker === 'undefined' && createWorker === defaultWorkerFactory) {
    return Promise.resolve(failure('worker_failed', 'Background analysis is not supported in this browser.'))
  }
  return new Promise<AnalysisResult>((resolve) => {
    let worker: AnalysisWorkerLike | null = null
    let settled = false
    const finish = (result: AnalysisResult) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.terminate() // also stops a busy, synchronous analysis
      }
      resolve(result)
    }
    const onAbort = () => finish(failure('aborted', 'Analysis cancelled.'))
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const pcm = downmixToMono(buffer)
      worker = createWorker()
      worker.onmessage = (event) => {
        const message = event.data
        if (message.type === 'progress') options.onProgress?.(message.fraction, message.stage)
        else finish(message.result)
      }
      worker.onerror = () => finish(failure('worker_failed', 'The loop analysis worker failed.'))
      const { maxCandidates, minLoopSeconds, minLoopFraction } = options
      worker.postMessage(
        { pcm, sampleRate: buffer.sampleRate, options: { maxCandidates, minLoopSeconds, minLoopFraction } },
        [pcm.buffer],
      )
    } catch {
      finish(failure('worker_failed', 'The loop analysis could not be started.'))
    }
  })
}
