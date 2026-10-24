// Source-independent music engine. It owns the master volume/mute, the fade timings and the
// guarantee that at most one source is audible. It knows nothing about characters, LLMs or
// file names: callers (UI today, a future MusicDirector later) send logical requests
// `play(kind, trackId)` / `switchSource(kind | 'off', trackId?)`.
//
// Single-source guarantee: every request bumps a generation counter, aborts the previous
// request's AbortController and is appended to a promise chain. A run first awaits
// `stop()` on the previously active source, and only then calls `start()` on the target, so
// two sources are never started concurrently, even with racing requests. A request that was
// superseded before it ran is skipped; one superseded while loading is aborted and its
// outcome ('aborted') is never published as an error.
import type { MusicEngineState, MusicError, MusicSource, MusicSourceKind, MusicSourceSetting, SourceState } from './types.ts'

export interface MusicEngineOptions {
  fadeInMs?: number
  fadeOutMs?: number
  volume?: number
  muted?: boolean
  /** Track to use when switchSource() gets no track id (e.g. a persisted per-source choice). */
  defaultTrack?: (kind: MusicSourceKind) => string | null
}

export const DEFAULT_FADE_IN_MS = 600
export const DEFAULT_FADE_OUT_MS = 500

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export class MusicEngine {
  private readonly sources = new Map<MusicSourceKind, MusicSource>()
  private readonly unsubscribe = new Map<MusicSourceKind, () => void>()
  private readonly listeners = new Set<(state: MusicEngineState) => void>()
  private readonly fadeInMs: number
  private readonly fadeOutMs: number
  private readonly defaultTrack: (kind: MusicSourceKind) => string | null
  private readonly lastTrack = new Map<MusicSourceKind, string>()
  private state: MusicEngineState
  private generation = 0
  private controller: AbortController | null = null
  private queue: Promise<void> = Promise.resolve()
  /** The source that may currently be audible (started and not yet stopped). */
  private audible: MusicSource | null = null
  /** Generation allowed to publish source state (older, aborted starts stay silent). */
  private publishGeneration = 0
  private lastRequest: { kind: MusicSourceKind; trackId: string } | null = null
  private readonly ducks = new Map<symbol, number>()

  constructor(options: MusicEngineOptions = {}) {
    this.fadeInMs = options.fadeInMs ?? DEFAULT_FADE_IN_MS
    this.fadeOutMs = options.fadeOutMs ?? DEFAULT_FADE_OUT_MS
    this.defaultTrack = options.defaultTrack ?? (() => null)
    this.state = {
      source: null,
      status: 'idle',
      trackId: null,
      title: null,
      error: null,
      volume: clamp01(options.volume ?? 0.7),
      muted: options.muted ?? false,
    }
  }

  registerSource(source: MusicSource): void {
    this.unsubscribe.get(source.kind)?.()
    this.sources.set(source.kind, source)
    source.setDucking?.(this.duckFactor, 0)
    this.unsubscribe.set(
      source.kind,
      source.subscribe((sourceState) => this.onSourceState(source, sourceState)),
    )
  }

  getState(): MusicEngineState {
    return this.state
  }

  subscribe(listener: (state: MusicEngineState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Effective mix level: master, mute and temporary duck; track gains/fades remain separate. */
  get effectiveVolume(): number {
    return this.baseVolume * this.duckFactor
  }

  private get baseVolume(): number { return this.state.muted ? 0 : this.state.volume }
  get duckFactor(): number { return Math.min(1, ...this.ducks.values()) }

  /** A scoped mix lease. Releasing it restores current user settings, never an old snapshot. */
  acquireDuck(factor: number, attackMs = 200, releaseMs = 350): () => void {
    const key = Symbol('music duck')
    this.ducks.set(key, clamp01(factor))
    this.applyDucking(attackMs)
    return () => {
      if (!this.ducks.delete(key)) return
      this.applyDucking(releaseMs)
    }
  }

  /** Play `trackId` from `kind`. A track that is already loading/playing/paused is left alone. */
  play(kind: MusicSourceKind, trackId: string): Promise<void> {
    const s = this.state
    const live = s.status === 'loading' || s.status === 'playing' || s.status === 'paused'
    if (live && s.source === kind && s.trackId === trackId) return this.queue
    return this.request(kind, trackId)
  }

  /** Select the active source ('off' stops music). Without a track id, uses the remembered/default one. */
  switchSource(kind: MusicSourceSetting, trackId?: string): Promise<void> {
    if (kind === 'off') return this.stop(true)
    const id = trackId ?? this.lastTrack.get(kind) ?? this.defaultTrack(kind)
    if (id === null || id === undefined) {
      // Selecting a source with nothing to play: stop whatever else is audible and wait.
      return this.stop(false, kind)
    }
    return this.play(kind, id)
  }

  /** Stop playback. The source selection is kept unless `clearSource` (switchSource('off')). */
  stop(clearSource = false, keepSource: MusicSourceKind | null = null): Promise<void> {
    const mine = this.supersede()
    this.lastRequest = null
    this.setState({ source: clearSource ? null : (keepSource ?? this.state.source), status: 'idle', trackId: null, title: null, error: null })
    return this.enqueue(mine, async () => {
      await this.stopAudible()
    })
  }

  pause(): void {
    if (this.state.status === 'playing') this.activeSource()?.pause()
  }

  resume(): void {
    if (this.state.status === 'paused') this.activeSource()?.resume()
  }

  /** User-gesture replay after 'blocked' (or a failed load). */
  retry(): Promise<void> {
    const last = this.lastRequest
    if (!last || (this.state.status !== 'blocked' && this.state.status !== 'error')) return this.queue
    return this.request(last.kind, last.trackId)
  }

  setVolume(volume: number): void {
    this.setState({ volume: clamp01(volume) })
    this.applyVolume()
  }

  setMuted(muted: boolean): void {
    this.setState({ muted })
    this.applyVolume()
  }

  dispose(): void {
    this.ducks.clear()
    this.supersede()
    for (const off of this.unsubscribe.values()) off()
    this.unsubscribe.clear()
    for (const source of this.sources.values()) source.dispose()
    this.sources.clear()
    this.listeners.clear()
  }

  // ---- internals ----

  private activeSource(): MusicSource | null {
    return this.state.source ? (this.sources.get(this.state.source) ?? null) : null
  }

  private applyVolume(): void {
    const source = this.activeSource()
    if (source) source.setVolume(source.setDucking ? this.baseVolume : this.effectiveVolume)
  }

  private applyDucking(rampMs: number): void {
    for (const source of this.sources.values()) source.setDucking?.(this.duckFactor, Math.max(0, rampMs))
    if (!this.activeSource()?.setDucking) this.applyVolume()
  }

  /** Invalidate every earlier request; returns the new generation. */
  private supersede(): number {
    this.controller?.abort()
    this.controller = null
    return ++this.generation
  }

  private request(kind: MusicSourceKind, trackId: string): Promise<void> {
    const mine = this.supersede()
    const controller = new AbortController()
    this.controller = controller
    this.lastRequest = { kind, trackId }
    this.lastTrack.set(kind, trackId)
    this.setState({ source: kind, status: 'loading', trackId, title: null, error: null })
    return this.enqueue(mine, async () => {
      const target = this.sources.get(kind)
      // Fade out and fully stop whichever source is audible before starting the target.
      await this.stopAudible()
      if (mine !== this.generation) return
      if (!target) {
        this.fail({ code: 'unavailable', message: `Music source "${kind}" is not available` })
        return
      }
      this.audible = target
      this.publishGeneration = mine
      try {
        target.setDucking?.(this.duckFactor, 0)
        await target.start(trackId, { volume: target.setDucking ? this.baseVolume : this.effectiveVolume, fadeInMs: this.fadeInMs, signal: controller.signal })
      } catch (error) {
        // Sources should report failures through state; this is the safety net.
        if (mine === this.generation) this.fail({ code: 'unknown', message: error instanceof Error ? error.message : 'Music source failed' })
      }
    })
  }

  /** Append a run to the serial chain; skipped when already superseded before it begins. */
  private enqueue(mine: number, run: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      if (mine !== this.generation) return
      await run()
    })
    this.queue = next.catch(() => {})
    return this.queue
  }

  private async stopAudible(): Promise<void> {
    const leaving = this.audible
    if (!leaving) return
    try {
      await leaving.stop({ fadeOutMs: this.fadeOutMs })
    } catch {
      // a failing stop must not wedge the queue
    }
    if (this.audible === leaving) this.audible = null
  }

  private fail(error: MusicError): void {
    this.setState({ status: 'error', error })
  }

  private onSourceState(source: MusicSource, sourceState: SourceState): void {
    // Only the source selected by the latest request may drive the public state.
    if (this.publishGeneration !== this.generation || this.state.source !== source.kind) return
    if (this.state.trackId === null) return // stopped/idle: ignore trailing events
    if (sourceState.trackId !== null && sourceState.trackId !== this.state.trackId) return // event of an older track
    this.setState({ status: sourceState.status, title: sourceState.title, error: sourceState.error })
  }

  private setState(patch: Partial<MusicEngineState>): void {
    const next = { ...this.state, ...patch }
    const changed = (Object.keys(next) as (keyof MusicEngineState)[]).some((key) => next[key] !== this.state[key])
    if (!changed) return
    this.state = next
    for (const listener of [...this.listeners]) listener(this.state)
  }
}
