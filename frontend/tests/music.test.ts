// Music core tests: deterministic, no real audio. The engine runs against scripted fake
// sources, the Web Audio source against a fake AudioContext, and the original soundtrack
// manifest is validated against the real files in public/assets/music.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createBufferCache } from '../src/music/bufferCache.ts'
import { bakeLoopCrossfade, loopPosition, parseLoopMetadata, regionToSeconds, validateLoopRegion } from '../src/music/loopMath.ts'
import { MusicEngine } from '../src/music/MusicEngine.ts'
import {
  bgmPool,
  contextualPool,
  createOriginalTrackResolver,
  resolveProfileTrack,
  validateSoundtrackManifest,
  type SoundtrackManifest,
} from '../src/music/soundtrack.ts'
import type { MusicSource, MusicSourceKind, MusicTrack, SourceState, StartOptions } from '../src/music/types.ts'
import { createWebAudioSource, type DecodedTrack, type TrackResolver } from '../src/music/webAudioSource.ts'

const musicRoot = new URL('../public/assets/music/', import.meta.url)
const soundtrack: SoundtrackManifest = JSON.parse(readFileSync(new URL('soundtrack.json', musicRoot), 'utf8'))

// ---------------------------------------------------------------- loop maths

test('validateLoopRegion accepts a sane region and rejects malformed ones', () => {
  const ok = { startSample: 44100, endSample: 441000, sampleRate: 44100 }
  assert.deepEqual(validateLoopRegion(ok, 500000), { ok: true })
  const bad = (patch: object, duration?: number) => validateLoopRegion({ ...ok, ...patch }, duration).ok
  assert.equal(bad({ startSample: 1.5 }), false)
  assert.equal(bad({ endSample: Number.NaN }), false)
  assert.equal(bad({ startSample: -1 }), false)
  assert.equal(bad({ startSample: 441000 }), false)
  assert.equal(bad({ startSample: 500000 }), false)
  assert.equal(bad({}, 400000), false) // end beyond duration
  assert.equal(bad({ sampleRate: 0 }), false)
  assert.equal(bad({ sampleRate: -44100 }), false)
  assert.equal(bad({ endSample: 44100 + 44099 }), false) // shorter than 1 s
  assert.equal(bad({ crossfadeMs: -5 }), false)
})

test('regionToSeconds converts samples at the stated rate', () => {
  assert.deepEqual(regionToSeconds({ startSample: 48000, endSample: 480000, sampleRate: 48000 }), { start: 1, end: 10 })
})

test('loopPosition plays through to loopEnd then wraps inside the loop', () => {
  assert.equal(loopPosition(3, 2, 10), 3)
  assert.equal(loopPosition(10, 2, 10), 2)
  assert.equal(loopPosition(13, 2, 10), 5)
  assert.equal(loopPosition(27, 2, 10), 3)
})

test('bakeLoopCrossfade makes the end -> start jump continuous on a copy', () => {
  const rate = 1000
  const make = () => Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.05) + Math.sin(i * 0.31))
  const channel = make()
  const original = channel.slice()
  const start = 1000
  const end = 3000
  const fade = 200
  const [baked] = bakeLoopCrossfade([channel], start, end, fade)
  assert.deepEqual(channel, original, 'input must not be modified')
  // Last baked sample equals the sample right before loopStart, so the jump to x[start] is continuous.
  assert.ok(Math.abs(baked[end - 1] - original[start - 1]) < 1e-6)
  // The raw jump is discontinuous; the baked one has a step no bigger than the signal's own step.
  const rawJump = Math.abs(original[end - 1] - original[start])
  const bakedJump = Math.abs(baked[end - 1] - original[start])
  assert.ok(bakedJump < rawJump)
  assert.ok(bakedJump < 0.7)
  // Untouched outside the crossfade window.
  assert.equal(baked[end - fade - 1], original[end - fade - 1])
  assert.equal(baked[start + 5], original[start + 5])
  assert.equal(rate, 1000)
})

test('bakeLoopCrossfade clamps to the material available', () => {
  const channel = new Float32Array(2000).fill(1)
  const [baked] = bakeLoopCrossfade([channel], 100, 1900, 5000) // only 100 samples exist before loopStart
  assert.equal(baked[1799], 1) // outside clamped window
  const [none] = bakeLoopCrossfade([channel], 0, 1900, 100) // nothing before start: unchanged
  assert.deepEqual(none, channel)
})

test('parseLoopMetadata turns malformed input into "no loop"', () => {
  const none = { region: null, confidence: null, provenance: 'none' }
  assert.deepEqual(parseLoopMetadata(null), none)
  assert.deepEqual(parseLoopMetadata('x'), none)
  assert.deepEqual(parseLoopMetadata({ startSample: 'a', endSample: 5, sampleRate: 44100 }), none)
  assert.deepEqual(parseLoopMetadata({ startSample: 100, endSample: 50, sampleRate: 44100 }), none)
  const good = parseLoopMetadata({ startSample: 0, endSample: 88200, sampleRate: 44100, confidence: 0.8, provenance: 'curated-analysis', note: 'n' })
  assert.deepEqual(good, {
    region: { startSample: 0, endSample: 88200, sampleRate: 44100 },
    confidence: 0.8,
    provenance: 'curated-analysis',
    note: 'n',
  })
  assert.equal(parseLoopMetadata({ startSample: 0, endSample: 88200, sampleRate: 44100, confidence: 7 }).confidence, null)
})

// ---------------------------------------------------------------- buffer cache

test('buffer cache dedupes in-flight loads, evicts LRU and does not cache failures', async () => {
  const cache = createBufferCache<{ bytes: number }>((v) => v.bytes, { maxEntries: 2, maxBytes: 1000 })
  let loads = 0
  const load = (bytes: number) => async () => {
    loads++
    return { bytes }
  }
  const [a1, a2] = await Promise.all([cache.get('a', load(10)), cache.get('a', load(10))])
  assert.equal(a1, a2)
  assert.equal(loads, 1)
  await cache.get('b', load(10))
  await cache.get('a', load(10)) // touch a: b is now least recent
  await cache.get('c', load(10))
  assert.equal(cache.has('b'), false)
  assert.equal(cache.has('a'), true)
  await assert.rejects(cache.get('bad', () => Promise.reject(new Error('x'))))
  assert.equal(cache.has('bad'), false)
  const small = createBufferCache<{ bytes: number }>((v) => v.bytes, { maxEntries: 10, maxBytes: 100 })
  await small.get('x', load(60))
  await small.get('y', load(60))
  assert.equal(small.size, 1) // byte budget evicted the older entry
})

// ---------------------------------------------------------------- fake engine sources

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

interface World {
  log: string[]
  live: number
  maxLive: number
}

interface Gate {
  promise: Promise<void>
  open(): void
}

function gate(): Gate {
  let open = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

interface FakeSource extends MusicSource {
  gates: Gate[]
  startSignals: AbortSignal[]
  volumes: number[]
  blockNext: boolean
  failNext: boolean
}

/** Scripted source: each start() waits on the next gate (if any) or finishes immediately. */
function fakeSource(kind: MusicSourceKind, world: World): FakeSource {
  const listeners = new Set<(s: SourceState) => void>()
  let state: SourceState = { status: 'idle', trackId: null, title: null, error: null }
  const set = (patch: Partial<SourceState>) => {
    state = { ...state, ...patch }
    for (const l of [...listeners]) l(state)
  }
  const fake: FakeSource = {
    kind,
    gates: [],
    startSignals: [],
    volumes: [],
    blockNext: false,
    failNext: false,
    getState: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    async start(trackId: string, options: StartOptions) {
      world.log.push(`start:${kind}:${trackId}`)
      fake.startSignals.push(options.signal)
      fake.volumes.push(options.volume)
      set({ status: 'loading', trackId, title: `T${trackId}`, error: null })
      const g = fake.gates.shift()
      if (g) {
        await Promise.race([g.promise, new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve()))])
      }
      if (options.signal.aborted) {
        set({ status: 'idle', trackId: null, title: null })
        return
      }
      if (fake.blockNext) {
        fake.blockNext = false
        set({ status: 'blocked', error: { code: 'autoplay_blocked', message: 'blocked' } })
        return
      }
      if (fake.failNext) {
        fake.failNext = false
        set({ status: 'error', error: { code: 'missing_file', message: 'gone' } })
        return
      }
      world.live++
      world.maxLive = Math.max(world.maxLive, world.live)
      set({ status: 'playing' })
    },
    pause() {
      if (state.status === 'playing') set({ status: 'paused' })
    },
    resume() {
      if (state.status === 'paused') set({ status: 'playing' })
    },
    async stop() {
      world.log.push(`stop:${kind}`)
      await Promise.resolve()
      if (state.status === 'playing' || state.status === 'paused') world.live--
      set({ status: 'idle', trackId: null, title: null, error: null })
    },
    setVolume(v) {
      world.log.push(`volume:${kind}:${v}`)
      fake.volumes.push(v)
    },
    dispose() {},
  }
  return fake
}

function engineWith(): { engine: MusicEngine; world: World; original: FakeSource; imported: FakeSource } {
  const world: World = { log: [], live: 0, maxLive: 0 }
  const engine = new MusicEngine({ fadeInMs: 10, fadeOutMs: 10, volume: 0.5 })
  const original = fakeSource('original', world)
  const imported = fakeSource('imported', world)
  engine.registerSource(original)
  engine.registerSource(imported)
  return { engine, world, original, imported }
}

test('engine plays a track and does not restart the same track', async () => {
  const { engine, world } = engineWith()
  await engine.play('original', 'a')
  assert.equal(engine.getState().status, 'playing')
  assert.equal(engine.getState().title, 'Ta')
  await engine.play('original', 'a')
  await engine.play('original', 'a')
  assert.deepEqual(world.log.filter((l) => l.startsWith('start')), ['start:original:a'])
  await engine.play('original', 'b')
  assert.deepEqual(world.log.filter((l) => l.startsWith('start')), ['start:original:a', 'start:original:b'])
})

test('engine stops the old source before starting the new one', async () => {
  const { engine, world } = engineWith()
  await engine.play('original', 'a')
  await engine.switchSource('imported', 'x')
  assert.deepEqual(world.log.filter((l) => !l.startsWith('volume')), ['start:original:a', 'stop:original', 'start:imported:x'])
  assert.equal(world.maxLive, 1)
  assert.equal(engine.getState().source, 'imported')
})

test('racing requests never produce two audible sources and only the last wins', async () => {
  const { engine, world, original, imported } = engineWith()
  original.gates.push(gate()) // first request hangs while loading
  const first = engine.play('original', 'a')
  await flush()
  const second = engine.play('imported', 'b')
  const third = engine.play('original', 'c')
  const fourth = engine.play('imported', 'd')
  await Promise.all([first, second, third, fourth])
  assert.equal(world.maxLive, 1)
  assert.equal(engine.getState().source, 'imported')
  assert.equal(engine.getState().trackId, 'd')
  assert.equal(engine.getState().status, 'playing')
  assert.equal(engine.getState().error, null)
  assert.equal(original.startSignals[0].aborted, true)
  assert.equal(imported.getState().status, 'playing')
  assert.equal(original.getState().status, 'idle')
  // superseded requests that never ran are not started at all
  assert.ok(!world.log.includes('start:original:c'))
  assert.ok(!world.log.includes('start:imported:b'))
})

test('switching while loading aborts the old load cleanly (no error state)', async () => {
  const { engine, original } = engineWith()
  const errors: unknown[] = []
  engine.subscribe((s) => {
    if (s.error) errors.push(s.error)
  })
  original.gates.push(gate())
  const slow = engine.play('original', 'slow')
  await flush()
  assert.equal(engine.getState().status, 'loading')
  const quick = engine.play('imported', 'q')
  await Promise.all([slow, quick])
  assert.equal(original.startSignals[0].aborted, true)
  assert.equal(engine.getState().trackId, 'q')
  assert.equal(engine.getState().status, 'playing')
  assert.deepEqual(errors, [])
})

test('volume, mute and master volume survive source switches', async () => {
  const { engine, original, imported } = engineWith()
  await engine.play('original', 'a')
  assert.equal(original.volumes.at(-1), 0.5)
  engine.setVolume(0.8)
  assert.equal(original.volumes.at(-1), 0.8)
  engine.setMuted(true)
  assert.equal(original.volumes.at(-1), 0)
  assert.equal(engine.getState().volume, 0.8) // master volume itself is untouched
  await engine.switchSource('imported', 'x')
  assert.equal(imported.volumes[0], 0) // still muted on the new source
  engine.setMuted(false)
  assert.equal(imported.volumes.at(-1), 0.8)
  engine.setVolume(7)
  assert.equal(engine.getState().volume, 1)
  engine.setVolume(-3)
  assert.equal(engine.getState().volume, 0)
})

test('pause and resume only act while playing / paused', async () => {
  const { engine } = engineWith()
  engine.pause()
  assert.equal(engine.getState().status, 'idle')
  await engine.play('original', 'a')
  engine.pause()
  assert.equal(engine.getState().status, 'paused')
  engine.resume()
  assert.equal(engine.getState().status, 'playing')
  engine.resume() // already playing: no-op
  assert.equal(engine.getState().status, 'playing')
})

test('blocked playback is resumed by retry()', async () => {
  const { engine, original, world } = engineWith()
  original.blockNext = true
  await engine.play('original', 'a')
  assert.equal(engine.getState().status, 'blocked')
  assert.equal(engine.getState().error?.code, 'autoplay_blocked')
  await engine.retry()
  assert.equal(engine.getState().status, 'playing')
  assert.equal(engine.getState().error, null)
  assert.equal(world.maxLive, 1)
  await engine.retry() // nothing to retry while playing
  assert.equal(world.log.filter((l) => l.startsWith('start')).length, 2)
})

test('source errors are surfaced and playing the same track again retries it', async () => {
  const { engine, original } = engineWith()
  original.failNext = true
  await engine.play('original', 'a')
  assert.equal(engine.getState().status, 'error')
  assert.equal(engine.getState().error?.code, 'missing_file')
  await engine.play('original', 'a')
  assert.equal(engine.getState().status, 'playing')
})

test('unregistered source, stop, off and default track', async () => {
  const world: World = { log: [], live: 0, maxLive: 0 }
  const engine = new MusicEngine({ fadeInMs: 0, fadeOutMs: 0, defaultTrack: (kind) => (kind === 'original' ? 'dflt' : null) })
  engine.registerSource(fakeSource('original', world))
  await engine.play('radio', 'v')
  assert.equal(engine.getState().status, 'error')
  assert.equal(engine.getState().error?.code, 'unavailable')
  await engine.switchSource('original')
  assert.equal(engine.getState().trackId, 'dflt')
  assert.equal(engine.getState().status, 'playing')
  await engine.stop()
  assert.equal(engine.getState().status, 'idle')
  assert.equal(engine.getState().source, 'original')
  assert.equal(world.live, 0)
  await engine.play('original', 'z')
  await engine.switchSource('off')
  assert.equal(engine.getState().source, null)
  assert.equal(engine.getState().status, 'idle')
  assert.equal(world.live, 0)
})

test('engine notifies subscribers only on real changes', async () => {
  const { engine } = engineWith()
  let calls = 0
  const off = engine.subscribe(() => calls++)
  engine.setVolume(0.5) // unchanged
  assert.equal(calls, 0)
  engine.setVolume(0.6)
  assert.equal(calls, 1)
  off()
  engine.setVolume(0.7)
  assert.equal(calls, 1)
})

// ---------------------------------------------------------------- Web Audio source (fake context)

class FakeParam {
  value: number
  constructor(value = 1) {
    this.value = value
  }
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v
  }
  linearRampToValueAtTime(v: number) {
    this.value = v
  }
  setTargetAtTime(v: number) {
    this.value = v
  }
}

class FakeNode {
  connect(node: unknown) {
    return node
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1)
}

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  startedWith: [number, number] | null = null
  stopped = false
  start(when: number, offset: number) {
    this.startedWith = [when, offset]
  }
  stop() {
    this.stopped = true
  }
}

class FakeBuffer {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly data: Float32Array[]
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.data = Array.from({ length: channels }, () => new Float32Array(length))
  }
  get duration() {
    return this.length / this.sampleRate
  }
  getChannelData(c: number) {
    return this.data[c]
  }
  copyToChannel(source: Float32Array, c: number) {
    this.data[c].set(source)
  }
}

class FakeContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resumeWorks = false
  suspendCalls = 0
  sources: FakeBufferSource[] = []
  gains: FakeGain[] = []
  created: FakeBuffer[] = []
  decodeFails = false
  decodeBuffer = new FakeBuffer(1, 44100 * 20, 44100)
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBufferSource() {
    const s = new FakeBufferSource()
    this.sources.push(s)
    return s
  }
  createBuffer(channels: number, length: number, rate: number) {
    const b = new FakeBuffer(channels, length, rate)
    this.created.push(b)
    return b
  }
  decodeAudioData() {
    return this.decodeFails ? Promise.reject(new Error('bad data')) : Promise.resolve(this.decodeBuffer)
  }
  resume() {
    if (this.resumeWorks) {
      this.state = 'running'
      return Promise.resolve()
    }
    return new Promise<void>(() => {}) // locked: never settles without a gesture
  }
  suspend() {
    this.suspendCalls++
    return Promise.resolve()
  }
}

function makeTrack(patch: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: 't',
    title: 'Test Track',
    source: 'original',
    url: '/assets/music/t.mp3',
    category: 'bgm',
    tags: [],
    gain: 1,
    loop: { region: null, confidence: null, provenance: 'none' },
    contextual: false,
    ...patch,
  }
}

function webSource(options: { track?: MusicTrack | null; status?: number; fetchThrows?: boolean } = {}) {
  const context = new FakeContext()
  let fetches = 0
  const cache = createBufferCache<DecodedTrack>(() => 1)
  const track = options.track === undefined ? makeTrack() : options.track
  const resolver: TrackResolver = { resolve: () => Promise.resolve(track) }
  const fakeFetch = (() => {
    fetches++
    if (options.fetchThrows) return Promise.reject(new TypeError('offline'))
    const status = options.status ?? 200
    return Promise.resolve({ ok: status < 400, status, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  }) as unknown as typeof fetch
  const source = createWebAudioSource('original', resolver, {
    getContext: () => context as unknown as AudioContext,
    cache,
    fetch: fakeFetch,
    sleep: () => Promise.resolve(),
  })
  return { source, context, fetchCount: () => fetches }
}

const startOptions = (volume = 0.5, fadeInMs = 0): StartOptions => ({ volume, fadeInMs, signal: new AbortController().signal })

test('web audio source builds the chain and applies the loop region in seconds', async () => {
  const { source, context } = webSource({
    track: makeTrack({
      gain: 0.8,
      loop: { region: { startSample: 44100 * 2, endSample: 44100 * 12, sampleRate: 44100 }, confidence: 0.9, provenance: 'curated-analysis' },
    }),
  })
  await source.start('t', startOptions(0.5))
  const node = context.sources[0]
  assert.equal(source.getState().status, 'playing')
  assert.equal(node.loop, true)
  assert.equal(node.loopStart, 2)
  assert.equal(node.loopEnd, 12)
  assert.deepEqual(node.startedWith, [0, 0])
  assert.equal(context.gains[0].gain.value, 0.8) // track gain
  assert.equal(context.gains[2].gain.value, 0.5) // master volume
  source.setVolume(0.25)
  assert.equal(context.gains[2].gain.value, 0.25)
  assert.deepEqual(source.getWarnings(), [])
})

test('track without loop metadata loops the whole buffer', async () => {
  const { source, context } = webSource()
  await source.start('t', startOptions())
  assert.equal(context.sources[0].loop, true)
  assert.equal(context.sources[0].loopEnd, 0)
})

test('invalid loop metadata plays without loop points and records an invalid_loop warning', async () => {
  const { source, context } = webSource({
    track: makeTrack({ loop: { region: { startSample: 900000, endSample: 800000, sampleRate: 44100 }, confidence: null, provenance: 'auto-detected' } }),
  })
  await source.start('t', startOptions())
  assert.equal(source.getState().status, 'playing')
  assert.equal(source.getState().error, null)
  assert.equal(context.sources[0].loopEnd, 0)
  assert.equal(source.getWarnings()[0]?.code, 'invalid_loop')
})

test('loop crossfade is baked into a copy; the cached buffer is untouched', async () => {
  const { source, context } = webSource({
    track: makeTrack({ loop: { region: { startSample: 44100 * 2, endSample: 44100 * 12, sampleRate: 44100, crossfadeMs: 100 }, confidence: null, provenance: 'user-adjusted' } }),
  })
  context.decodeBuffer.data[0].fill(1)
  context.decodeBuffer.data[0].fill(-1, 44100 * 2 - 4410, 44100 * 2)
  await source.start('t', startOptions())
  assert.equal(context.created.length, 1)
  assert.equal(context.sources[0].buffer, context.created[0])
  assert.equal(context.decodeBuffer.data[0][44100 * 12 - 1], 1)
  assert.ok(Math.abs(context.created[0].data[0][44100 * 12 - 1] + 1) < 1e-5)
})

test('suspended context reports blocked and a later start succeeds', async () => {
  const { source, context } = webSource()
  context.state = 'suspended'
  await source.start('t', startOptions())
  assert.equal(source.getState().status, 'blocked')
  assert.equal(source.getState().error?.code, 'autoplay_blocked')
  assert.equal(context.sources.length, 0)
  context.resumeWorks = true // user gesture happened
  await source.start('t', startOptions())
  assert.equal(source.getState().status, 'playing')
  assert.equal(source.getState().error, null)
})

test('missing context is blocked, not an error', async () => {
  const source = createWebAudioSource('original', { resolve: () => Promise.resolve(makeTrack()) }, { getContext: () => null, cache: createBufferCache<DecodedTrack>(() => 1), sleep: () => Promise.resolve() })
  await source.start('t', startOptions())
  assert.equal(source.getState().status, 'blocked')
})

test('file, network and decode failures map to error codes', async () => {
  const missing = webSource({ status: 404 })
  await missing.source.start('t', startOptions())
  assert.equal(missing.source.getState().error?.code, 'missing_file')
  const server = webSource({ status: 500 })
  await server.source.start('t', startOptions())
  assert.equal(server.source.getState().error?.code, 'network')
  const offline = webSource({ fetchThrows: true })
  await offline.source.start('t', startOptions())
  assert.equal(offline.source.getState().error?.code, 'network')
  const corrupt = webSource()
  corrupt.context.decodeFails = true
  await corrupt.source.start('t', startOptions())
  assert.equal(corrupt.source.getState().status, 'error')
  assert.equal(corrupt.source.getState().error?.code, 'decode_failed')
  const unknown = webSource({ track: null })
  await unknown.source.start('nope', startOptions())
  assert.equal(unknown.source.getState().error?.code, 'missing_file')
})

test('aborting while loading ends idle without an error', async () => {
  const { source } = webSource()
  const controller = new AbortController()
  const pending = source.start('t', { volume: 1, signal: controller.signal })
  controller.abort()
  await pending
  assert.equal(source.getState().status, 'idle')
  assert.equal(source.getState().error, null)
})

test('pause stops the node and resume restarts at the remembered position without suspending the context', async () => {
  const { source, context } = webSource({
    track: makeTrack({ loop: { region: { startSample: 44100 * 2, endSample: 44100 * 12, sampleRate: 44100 }, confidence: null, provenance: 'curated-analysis' } }),
  })
  await source.start('t', startOptions())
  context.currentTime = 5
  source.pause()
  assert.equal(source.getState().status, 'paused')
  assert.equal(context.sources[0].stopped, true)
  context.currentTime = 100 // time passing while paused must not advance the position
  source.resume()
  assert.equal(source.getState().status, 'playing')
  assert.equal(context.sources.length, 2)
  assert.deepEqual(context.sources[1].startedWith, [0, 5])
  context.currentTime = 100 + 9 // 5 + 9 = 14 -> wraps into the loop: 2 + (14 - 2) % 10 = 4
  source.pause()
  source.resume()
  assert.equal(context.sources[2].startedWith?.[1], 4)
  assert.equal(context.suspendCalls, 0)
})

test('stop releases the chain; the decoded buffer is cached across starts', async () => {
  const { source, context, fetchCount } = webSource()
  await source.start('t', startOptions())
  await source.stop()
  assert.equal(context.sources[0].stopped, true)
  assert.equal(source.getState().status, 'idle')
  await source.start('t', startOptions())
  assert.equal(fetchCount(), 1)
})

test('engine + web audio source: same track not restarted, switch replaces the node', async () => {
  const { source, context } = webSource()
  const engine = new MusicEngine({ fadeInMs: 0, fadeOutMs: 0 })
  engine.registerSource(source)
  await engine.play('original', 't')
  await engine.play('original', 't')
  assert.equal(context.sources.length, 1)
  assert.equal(engine.getState().status, 'playing')
  await engine.play('original', 'u')
  assert.equal(context.sources.length, 2)
  assert.equal(context.sources[0].stopped, true)
})

// ---------------------------------------------------------------- original soundtrack manifest

test('real soundtrack.json is valid', () => {
  assert.deepEqual(validateSoundtrackManifest(soundtrack), [])
})

test('validateSoundtrackManifest reports structural problems', () => {
  assert.ok(validateSoundtrackManifest(null).length > 0)
  const broken = {
    version: 1,
    profiles: { default: { defaultTrack: 'missing', alternatives: [] } },
    tracks: {
      a: { number: 1, title: 'A', src: 'original/a.mp3', category: 'excluded', tags: [], gain: 1, contextual: false, loop: null },
      b: { number: 2, title: 'B', category: 'bgm', tags: [], gain: 1, contextual: false, loop: null },
      c: { number: 3, title: 'C', src: 'x y.mp3', category: 'bgm', tags: [], gain: 1, contextual: false, loop: { startSample: 5, endSample: 1, sampleRate: 44100 } },
    },
  }
  const errors = validateSoundtrackManifest(broken).join('\n')
  assert.match(errors, /a: excluded tracks must not have a src/)
  assert.match(errors, /b: src is required/)
  assert.match(errors, /c: src must be a clean relative path/)
  assert.match(errors, /c: loop region is invalid/)
  assert.match(errors, /profile default: unknown track missing/)
})

test('curated categories: 16 bgm, 9 contextual, 9 excluded', () => {
  const byCategory = (c: string) => Object.values(soundtrack.tracks).filter((t) => t.category === c)
  assert.equal(byCategory('bgm').length, 16)
  assert.equal(byCategory('contextual').length, 9)
  assert.equal(byCategory('excluded').length, 9)
  const numbers = (c: string) => byCategory(c).map((t) => t.number).sort((a, b) => a - b)
  assert.deepEqual(numbers('bgm'), [2, 3, 4, 5, 7, 10, 13, 14, 15, 16, 18, 19, 23, 30, 32, 33])
  assert.deepEqual(numbers('contextual'), [6, 8, 9, 11, 17, 20, 22, 24, 29])
  assert.deepEqual(numbers('excluded'), [1, 12, 21, 25, 26, 27, 28, 31, 34])
})

test('bgm pool excludes contextual and excluded tracks', () => {
  const pool = bgmPool(soundtrack)
  assert.equal(pool.length, 16)
  for (const id of pool) assert.equal(soundtrack.tracks[id].category, 'bgm')
  const contextual = contextualPool(soundtrack)
  assert.equal(contextual.length, 9)
  for (const id of contextual) assert.ok(!pool.includes(id))
  for (const [id, track] of Object.entries(soundtrack.tracks)) {
    if (track.category === 'excluded') {
      assert.ok(!pool.includes(id) && !contextual.includes(id), `${id} must not be playable`)
      assert.equal(track.src, undefined)
    }
  }
})

test('every runtime src exists on disk with a clean lowercase name', () => {
  for (const [id, track] of Object.entries(soundtrack.tracks)) {
    if (!track.src) continue
    assert.ok(existsSync(new URL(track.src, musicRoot)), `${id}: ${track.src} missing`)
    assert.match(track.src, /^original\/[0-9]{2}-[a-z0-9-]+\.mp3$/)
  }
})

// Curated loops come only from documented OST analysis (docs/MUSIC.md); tracks that failed the
// acceptance thresholds stay null rather than receiving an invented loop.
const CURATED_LOOPS = [
  'court_is_now_in_session', 'pursuit_corner_the_culprit', 'the_truth_revealed_2001', 'initial_investigation_2001',
  'dick_gumshoe_thats_detective_gumshoe_pal', 'reminiscences_mayas_sorrow', 'reminiscences_the_dl_6_incident',
  'reminiscences_the_sl_9_incident', 'ema_skye_turnabout_sisters_2005', 'jake_marshall_renegade_sheriff',
  'cross_examination_moderato_2001', 'maya_fey_turnabout_sisters_2001', 'detention_center_the_security_guards_elegy',
  'marvin_grossberg_reckonings_and_regrets_of_an_aged_attorney', 'reminiscences_the_class_trial',
]

test('loop metadata is not invented: only analysed tracks carry honest curated loops', () => {
  for (const [id, track] of Object.entries(soundtrack.tracks)) {
    if (!CURATED_LOOPS.includes(id)) {
      assert.equal(track.loop, null, `${id} has no validated loop`)
      continue
    }
    assert.ok(track.src, `${id}: loops only on runtime tracks`)
    const raw = track.loop as Record<string, unknown>
    const meta = parseLoopMetadata(raw)
    assert.ok(meta.region, `${id}: valid region`)
    assert.equal(meta.provenance, 'curated-analysis')
    assert.equal(meta.region.sampleRate, 44100)
    assert.ok(meta.confidence !== null && meta.confidence > 0 && meta.confidence <= 1)
    assert.match(String(raw.note), /Not an original DS loop point/)
  }
  // Maya's loop is metric-validated, not verified by listening or claimed as a DS loop point.
  const mayaLoop = parseLoopMetadata(soundtrack.tracks.maya_fey_turnabout_sisters_2001.loop)
  assert.ok(mayaLoop.region)
  assert.match(mayaLoop.note ?? '', /Not an original DS loop point; not verified by listening/)
})

test('profile resolution lives in data and falls back to the default profile', () => {
  assert.equal(resolveProfileTrack(soundtrack, 'default'), 'maya_fey_turnabout_sisters_2001')
  assert.equal(resolveProfileTrack(soundtrack, 'someone-else'), 'maya_fey_turnabout_sisters_2001')
  assert.equal(resolveProfileTrack(soundtrack), 'maya_fey_turnabout_sisters_2001')
  assert.deepEqual(soundtrack.profiles.default.alternatives, ['initial_investigation_2001'])
})

test('original track resolver builds URLs and refuses excluded / unknown tracks', async () => {
  const resolver = createOriginalTrackResolver(soundtrack, '/assets/music/')
  const signal = new AbortController().signal
  const track = await resolver.resolve('maya_fey_turnabout_sisters_2001', signal)
  assert.equal(track?.url, '/assets/music/original/14-maya-fey-turnabout-sisters-2001.mp3')
  assert.equal(track?.source, 'original')
  assert.deepEqual(track?.loop, parseLoopMetadata(soundtrack.tracks.maya_fey_turnabout_sisters_2001.loop))
  assert.equal(await resolver.resolve('phoenix_wright_ace_attorney_opening', signal), null)
  assert.equal(await resolver.resolve('__proto__', signal), null)
  assert.equal((await resolver.resolve('objection_2001', signal))?.contextual, true)
})
