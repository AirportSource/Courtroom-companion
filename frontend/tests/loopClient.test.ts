// Loop analysis client: downmix, progress, abort and failure handling with an injected fake worker.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AnalysisMessage, AnalysisRequest } from '../src/music/loop/analysis.worker.ts'
import { analyzeLoopPcm } from '../src/music/loop/analyzer.ts'
import { analyzeLoop, downmixToMono } from '../src/music/loop/analyzeLoop.ts'
import type { AnalysisWorkerLike, AudioBufferLike } from '../src/music/loop/analyzeLoop.ts'
import { introBodyFade } from './loopSignals.ts'

const SR = 22050

function bufferOf(...channels: Float32Array[]): AudioBufferLike {
  return { sampleRate: SR, length: channels[0]!.length, numberOfChannels: channels.length, getChannelData: (c) => channels[c]! }
}

class FakeWorker implements AnalysisWorkerLike {
  onmessage: ((event: { data: AnalysisMessage }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  terminated = false
  requests: AnalysisRequest[] = []
  mode: 'run' | 'hang' | 'crash'
  constructor(mode: 'run' | 'hang' | 'crash') {
    this.mode = mode
  }
  postMessage(message: AnalysisRequest): void {
    this.requests.push(message)
    if (this.mode === 'hang') return
    if (this.mode === 'crash') {
      queueMicrotask(() => this.onerror?.({}))
      return
    }
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: 'progress', fraction: 0.5, stage: 'Searching' } })
      this.onmessage?.({ data: { type: 'result', result: analyzeLoopPcm(message.pcm, message.sampleRate, message.options) } })
    })
  }
  terminate(): void {
    this.terminated = true
  }
}

test('downmix averages channels into a new array and leaves the buffer untouched', () => {
  const left = Float32Array.from([1, 0.5, -1])
  const right = Float32Array.from([0, 0.5, 1])
  const mono = downmixToMono(bufferOf(left, right))
  assert.deepEqual(Array.from(mono), [0.5, 0.5, 0])
  assert.deepEqual(Array.from(left), [1, 0.5, -1])
  assert.deepEqual(Array.from(downmixToMono(bufferOf(left))), [1, 0.5, -1])
})

test('analyzeLoop returns the worker result, forwards progress and terminates the worker', async () => {
  const { pcm, bodySamples } = introBodyFade(SR)
  const worker = new FakeWorker('run')
  const progress: string[] = []
  const result = await analyzeLoop(bufferOf(pcm.slice()), { onProgress: (_f, stage) => progress.push(stage) }, undefined, () => worker)
  assert.ok(result.ok)
  assert.ok(Math.abs(result.candidates[0]!.endSample - result.candidates[0]!.startSample - bodySamples) <= 110)
  assert.deepEqual(progress, ['Searching'])
  assert.ok(worker.terminated)
  assert.equal(worker.requests[0]!.sampleRate, SR)
})

test('abort resolves with a typed failure and terminates a busy worker', async () => {
  const worker = new FakeWorker('hang')
  const controller = new AbortController()
  const pending = analyzeLoop(bufferOf(new Float32Array(SR * 20)), {}, controller.signal, () => worker)
  controller.abort()
  const result = await pending
  assert.ok(!result.ok && result.reason === 'aborted')
  assert.ok(worker.terminated)
  const already = await analyzeLoop(bufferOf(new Float32Array(10)), {}, controller.signal, () => worker)
  assert.ok(!already.ok && already.reason === 'aborted')
})

test('worker crash and factory failure become typed failures, never exceptions', async () => {
  const crashed = await analyzeLoop(bufferOf(new Float32Array(SR * 20)), {}, undefined, () => new FakeWorker('crash'))
  assert.ok(!crashed.ok && crashed.reason === 'worker_failed')
  const broken = await analyzeLoop(bufferOf(new Float32Array(SR * 20)), {}, undefined, () => {
    throw new Error('no workers here')
  })
  assert.ok(!broken.ok && broken.reason === 'worker_failed')
  const unsupported = await analyzeLoop(bufferOf(new Float32Array(SR * 20)))
  assert.ok(!unsupported.ok && unsupported.reason === 'worker_failed', 'no Worker in Node')
})
