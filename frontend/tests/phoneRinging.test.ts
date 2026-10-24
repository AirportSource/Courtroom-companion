import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { AudioEngine } from '../src/engine/audioEngine.ts'
import { PHONE_DUCK_FACTOR, PHONE_DUCK_MS, PHONE_RESTORE_MS, startPhoneRinging } from '../src/artifacts/phoneRinging.ts'

class Node {
  stops = 0; starts = 0; loop = false; loopStart = 0; loopEnd = 0
  gain = { value: 1 }
  connect(next: unknown) { return next }
  disconnect() {}
  start() { this.starts++ }
  stop() { this.stops++ }
}
class Context {
  state = 'running'; currentTime = 0; destination = {}
  sources: Node[] = []
  decode: Promise<unknown> = Promise.resolve({ duration: 30 })
  addEventListener() {}
  resume() { return Promise.resolve() }
  decodeAudioData() { return this.decode }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node }
  createGain() { return new Node() }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function setup(t: TestContext) {
  const context = new Context()
  const old = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return context } } })
  t.after(() => { if (old) Object.defineProperty(globalThis, 'AudioContext', old); else Reflect.deleteProperty(globalThis, 'AudioContext') })
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
  const audio = new AudioEngine()
  audio.register([{ id: 'ring', category: 'effect', url: '/ring.mp3', loop: { startSeconds: 1.5, endSeconds: 20.5 } }], { phone_ring_loop: 'ring' })
  audio.unlock()
  return { audio, context }
}

test('ready ringing uses one native repeating source; duplicate leases cannot overlap it', async (t) => {
  const { audio, context } = setup(t)
  const first = audio.acquireEventLoop('phone_ring_loop', 0.7)
  const duplicate = audio.acquireEventLoop('phone_ring_loop', 0.7)
  await flush()
  assert.equal(context.sources.length, 1)
  assert.equal(audio.activeLoopCount, 1)
  assert.equal(context.sources[0].loop, true)
  assert.deepEqual([context.sources[0].loopStart, context.sources[0].loopEnd], [1.5, 20.5])
  context.currentTime = 80 // browser's native loop continues; no timer or new source required
  assert.equal(audio.activeLoopCount, 1)
  duplicate.stop()
  assert.equal(context.sources[0].stops, 0)
  first.stop(); first.stop()
  assert.equal(context.sources[0].stops, 1)
  assert.equal(audio.activeLoopCount, 0)
})

test('cancellation/unmount and effect replay during decode never start a stale ringtone', async (t) => {
  const { audio, context } = setup(t)
  let decoded = () => {}
  context.decode = new Promise((resolve) => { decoded = () => resolve({ duration: 30 }) })
  const abandoned = audio.acquireEventLoop('phone_ring_loop', 1)
  abandoned.stop()
  const replay = audio.acquireEventLoop('phone_ring_loop', 1)
  await flush(); decoded(); await flush()
  assert.equal(context.sources.length, 1)
  replay.stop()
  assert.equal(audio.activeLoopCount, 0)
})

test('SFX volume/mute changes retain the same loop and restore the mix while silent', async (t) => {
  const { audio, context } = setup(t)
  const gains: number[] = []
  const music = { acquireDuck(factor: number) { gains.push(factor); return () => { gains.push(1) } } }
  const stop = startPhoneRinging(audio, music, 0.8)
  await flush()
  stop.setVolume(0.4)
  stop.setVolume(0)
  assert.deepEqual(gains, [0.12, 1])
  stop.setVolume(0.5)
  assert.equal(context.sources.length, 1)
  assert.deepEqual(gains, [0.12, 1, 0.12])
  stop()
  assert.deepEqual(gains, [0.12, 1, 0.12, 1])
})

test('answer, cancellation and navigation cleanup stop ringing and release the duck exactly once', async (t) => {
  const { audio, context } = setup(t)
  for (const _reason of ['answer', 'cancel', 'navigation', 'unmount']) {
    const gains: number[] = []
    const music = { acquireDuck(factor: number, attack: number, restore: number) {
      assert.deepEqual([factor, attack, restore], [PHONE_DUCK_FACTOR, PHONE_DUCK_MS, PHONE_RESTORE_MS])
      gains.push(factor)
      return () => { gains.push(1) }
    } }
    const stop = startPhoneRinging(audio, music, 0.8)
    await flush()
    assert.equal(audio.activeLoopCount, 1)
    stop(); stop()
    assert.deepEqual(gains, [0.12, 1])
    assert.equal(audio.activeLoopCount, 0)
  }
  assert.equal(context.sources.length, 4)
  assert.ok(context.sources.every((source) => source.stops === 1))
})
