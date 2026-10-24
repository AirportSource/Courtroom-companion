// Web Audio music source, shared by the original soundtrack and imported tracks.
//
// Pipeline per track:
//   fetch -> ArrayBuffer -> decodeAudioData -> AudioBuffer (LRU cache)
//   -> AudioBufferSourceNode -> trackGain (per-track) -> fadeGain (fades/pause click guard)
//   -> masterGain (effective master volume) -> destination
//
// Looping uses the explicit region (loopStart/loopEnd in seconds, derived from samples).
// No/invalid region: the whole buffer loops (play to the end, restart from 0).
// Invalid loop decision: the track still plays (whole-buffer loop), the state stays error-free,
// and an `invalid_loop` warning is recorded (getWarnings() + console.warn).
// Pause stops the buffer node and remembers the position; the shared AudioContext is never
// suspended because blips/SFX use it too.
import type { BufferCache } from './bufferCache.ts'
import { bakeLoopCrossfade, loopPosition, regionToSeconds, validateLoopRegion } from './loopMath.ts'
import type { MusicError, MusicErrorCode, MusicSource, MusicTrack, SourceState, StartOptions } from './types.ts'

export interface TrackResolver {
  /** Maps a logical track id to a playable track; null when unknown. Must not throw. */
  resolve(trackId: string, signal: AbortSignal): Promise<MusicTrack | null>
}

export interface DecodedTrack {
  buffer: AudioBuffer
}

export function decodedTrackBytes(track: DecodedTrack): number {
  return track.buffer.length * track.buffer.numberOfChannels * 4
}

export interface WebAudioDeps {
  /** The app-wide AudioContext (null until audio was unlocked by a gesture). */
  getContext(): AudioContext | null
  /** Optional: create/resume the shared context (safe to call outside a gesture, it just stays locked). */
  unlock?(): void
  cache: BufferCache<DecodedTrack>
  fetch?: typeof fetch
  /** Timer seam (tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

export interface WebAudioSource extends MusicSource {
  readonly kind: 'original' | 'imported'
  /** Non-fatal problems of the current track (e.g. invalid loop metadata). */
  getWarnings(): MusicError[]
}

/** Time allowed for a suspended context to resume before we call playback "blocked". */
const RESUME_WAIT_MS = 300
/** Short ramp used on pause/resume so cutting a waveform does not click. */
const PAUSE_RAMP_S = 0.03
/** MP3 decoders may report a few ms more than the analysed length. */
const DURATION_TOLERANCE_S = 0.05

class SourceFailure extends Error {
  readonly code: MusicErrorCode
  constructor(code: MusicErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

interface ActiveChain {
  context: AudioContext
  buffer: AudioBuffer
  loop: { start: number; end: number } | null
  node: AudioBufferSourceNode | null
  trackGain: GainNode
  fadeGain: GainNode
  masterGain: GainNode
  /** Context time at which `node` started, and the track position it started from. */
  startedAt: number
  base: number
  pausedAt: number | null
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
}

/** Rejects with an AbortError-like when `signal` aborts first; never leaves the original unhandled. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {})
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function createWebAudioSource(kind: 'original' | 'imported', resolver: TrackResolver, deps: WebAudioDeps): WebAudioSource {
  const sleep = deps.sleep ?? defaultSleep
  const listeners = new Set<(state: SourceState) => void>()
  let state: SourceState = { status: 'idle', trackId: null, title: null, error: null }
  let warnings: MusicError[] = []
  let generation = 0
  let volume = 1
  let chain: ActiveChain | null = null
  let disposed = false

  function setState(next: Partial<SourceState>): void {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener(state)
  }

  function fail(code: MusicErrorCode, message: string): void {
    setState({ status: 'error', error: { code, message } })
  }

  function teardown(target: ActiveChain | null): void {
    if (!target) return
    try {
      target.node?.stop()
    } catch {
      // already stopped
    }
    for (const node of [target.node, target.trackGain, target.fadeGain, target.masterGain]) node?.disconnect()
    target.node = null
  }

  /** Create + start a buffer node at `offset` seconds into the track. */
  function startNode(target: ActiveChain, offset: number, rampIn: number): void {
    const { context } = target
    const node = context.createBufferSource()
    node.buffer = target.buffer
    node.loop = true
    if (target.loop) {
      node.loopStart = target.loop.start
      node.loopEnd = target.loop.end
    }
    node.connect(target.trackGain)
    const now = context.currentTime
    target.fadeGain.gain.cancelScheduledValues(now)
    if (rampIn > 0) {
      target.fadeGain.gain.setValueAtTime(0, now)
      target.fadeGain.gain.linearRampToValueAtTime(1, now + rampIn)
    } else {
      target.fadeGain.gain.setValueAtTime(1, now)
    }
    node.start(0, offset)
    target.node = node
    target.startedAt = now
    target.base = offset
    target.pausedAt = null
  }

  function position(target: ActiveChain): number {
    const elapsed = target.base + (target.context.currentTime - target.startedAt)
    const loop = target.loop ?? { start: 0, end: target.buffer.duration }
    return loopPosition(elapsed, loop.start, loop.end)
  }

  async function ensureRunning(): Promise<AudioContext | null> {
    let context = deps.getContext()
    if (!context) {
      deps.unlock?.()
      context = deps.getContext()
    }
    if (!context) return null
    if (context.state === 'running') return context
    // Inside a user gesture resume() settles quickly; outside it stays pending, so cap the wait.
    await Promise.race([context.resume().catch(() => {}), sleep(RESUME_WAIT_MS)])
    return (context.state as AudioContextState) === 'running' ? context : null
  }

  async function load(track: MusicTrack, context: AudioContext): Promise<DecodedTrack> {
    return deps.cache.get(track.url, async () => {
      let response: Response
      try {
        response = await (deps.fetch ?? fetch)(track.url)
      } catch {
        throw new SourceFailure('network', `Could not fetch "${track.title}"`)
      }
      if (response.status === 404) throw new SourceFailure('missing_file', `Audio file for "${track.title}" is missing`)
      if (!response.ok) throw new SourceFailure('network', `Fetching "${track.title}" failed (HTTP ${response.status})`)
      let bytes: ArrayBuffer
      try {
        bytes = await response.arrayBuffer()
      } catch {
        throw new SourceFailure('network', `Download of "${track.title}" was interrupted`)
      }
      try {
        return { buffer: await context.decodeAudioData(bytes) }
      } catch {
        throw new SourceFailure('decode_failed', `"${track.title}" could not be decoded`)
      }
    })
  }

  /** Copy of the buffer with the seam crossfade baked in, at the buffer's own sample rate. */
  function bakeBuffer(context: AudioContext, buffer: AudioBuffer, loop: { start: number; end: number }, crossfadeMs: number): AudioBuffer {
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
    const rate = buffer.sampleRate
    const baked = bakeLoopCrossfade(channels, Math.round(loop.start * rate), Math.round(loop.end * rate), Math.round((crossfadeMs / 1000) * rate))
    const copy = context.createBuffer(buffer.numberOfChannels, buffer.length, rate)
    baked.forEach((data, c) => copy.copyToChannel(data as Float32Array<ArrayBuffer>, c))
    return copy
  }

  function planLoop(track: MusicTrack, buffer: AudioBuffer): { loop: { start: number; end: number } | null; crossfadeMs: number } {
    const region = track.loop.region
    if (!region) return { loop: null, crossfadeMs: 0 }
    const duration = Math.floor((buffer.duration + DURATION_TOLERANCE_S) * region.sampleRate)
    const check = validateLoopRegion(region, duration)
    if (!check.ok) {
      const warning: MusicError = { code: 'invalid_loop', message: `Loop of "${track.title}" ignored: ${check.reason}` }
      warnings = [...warnings, warning]
      console.warn(`[music] ${warning.message}`)
      return { loop: null, crossfadeMs: 0 }
    }
    const seconds = regionToSeconds(region)
    return { loop: { start: seconds.start, end: Math.min(seconds.end, buffer.duration) }, crossfadeMs: region.crossfadeMs ?? 0 }
  }

  async function stopInternal(fadeOutMs: number): Promise<void> {
    generation++ // cancels any in-flight start()
    const leaving = chain
    chain = null
    if (!leaving) {
      if (state.status !== 'idle') setState({ status: 'idle', trackId: null, title: null, error: null })
      return
    }
    setState({ status: 'idle', trackId: null, title: null, error: null })
    if (leaving.node && fadeOutMs > 0) {
      const now = leaving.context.currentTime
      leaving.fadeGain.gain.cancelScheduledValues(now)
      leaving.fadeGain.gain.setValueAtTime(leaving.fadeGain.gain.value, now)
      leaving.fadeGain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000)
      await sleep(fadeOutMs)
    }
    teardown(leaving)
  }

  const source: WebAudioSource = {
    kind,
    getState: () => state,
    getWarnings: () => warnings,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async start(trackId: string, options: StartOptions): Promise<void> {
      const { signal } = options
      const mine = ++generation
      const stale = () => disposed || signal.aborted || mine !== generation
      volume = clamp01(options.volume)
      warnings = []
      teardown(chain) // a source never plays two tracks; the engine normally stopped us already
      chain = null
      setState({ status: 'loading', trackId, title: null, error: null })
      try {
        const track = await abortable(resolver.resolve(trackId, signal), signal)
        if (stale()) throw new SourceFailure('aborted', 'superseded')
        if (!track) throw new SourceFailure('missing_file', `Unknown track "${trackId}"`)
        setState({ title: track.title })
        const context = await abortable(ensureRunning(), signal)
        if (stale()) throw new SourceFailure('aborted', 'superseded')
        if (!context) {
          setState({ status: 'blocked', error: { code: 'autoplay_blocked', message: 'Browser blocked audio until you interact with the page' } })
          return
        }
        const decoded = await abortable(load(track, context), signal)
        if (stale()) throw new SourceFailure('aborted', 'superseded')

        const plan = planLoop(track, decoded.buffer)
        const buffer =
          plan.loop && plan.crossfadeMs > 0 ? bakeBuffer(context, decoded.buffer, plan.loop, plan.crossfadeMs) : decoded.buffer
        const trackGain = context.createGain()
        trackGain.gain.value = Number.isFinite(track.gain) && track.gain >= 0 ? track.gain : 1
        const fadeGain = context.createGain()
        const masterGain = context.createGain()
        masterGain.gain.value = volume
        trackGain.connect(fadeGain)
        fadeGain.connect(masterGain)
        masterGain.connect(context.destination)
        const next: ActiveChain = { context, buffer, loop: plan.loop, node: null, trackGain, fadeGain, masterGain, startedAt: 0, base: 0, pausedAt: null }
        startNode(next, 0, Math.max(0, options.fadeInMs ?? 0) / 1000)
        chain = next
        setState({ status: 'playing', error: null })
      } catch (error) {
        if (disposed || mine !== generation) return // a newer start()/stop() owns the state now
        if (isAbort(error) || (error instanceof SourceFailure && error.code === 'aborted')) {
          // Superseded by the engine: never surfaced as an error.
          setState({ status: 'idle', trackId: null, title: null, error: null })
        } else if (error instanceof SourceFailure) {
          fail(error.code, error.message)
        } else {
          fail('unknown', error instanceof Error ? error.message : 'Unexpected music error')
        }
      }
    },

    pause() {
      const current = chain
      if (!current || !current.node || state.status !== 'playing') return
      const at = position(current)
      const now = current.context.currentTime
      current.fadeGain.gain.cancelScheduledValues(now)
      current.fadeGain.gain.setValueAtTime(current.fadeGain.gain.value, now)
      current.fadeGain.gain.linearRampToValueAtTime(0, now + PAUSE_RAMP_S)
      try {
        current.node.stop(now + PAUSE_RAMP_S)
      } catch {
        // already stopped
      }
      current.node = null
      current.pausedAt = at
      setState({ status: 'paused' })
    },

    resume() {
      const current = chain
      if (!current || state.status !== 'paused' || current.pausedAt === null) return
      startNode(current, current.pausedAt, PAUSE_RAMP_S)
      setState({ status: 'playing' })
    },

    stop(options) {
      return stopInternal(Math.max(0, options?.fadeOutMs ?? 0))
    },

    setVolume(next) {
      volume = clamp01(next)
      if (!chain) return
      const now = chain.context.currentTime
      chain.masterGain.gain.cancelScheduledValues(now)
      chain.masterGain.gain.setTargetAtTime(volume, now, 0.015)
    },

    dispose() {
      disposed = true
      generation++
      teardown(chain)
      chain = null
      listeners.clear()
    },
  }
  return source
}
