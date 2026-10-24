// Central audio service (D-005, D-019). One AudioContext for the app.
// Sounds are fetched early (no context needed) and decoded once the context exists; each
// one-shot play is a short-lived buffer source; sustained semantic loops use cancellable shared
// source leases. Browsers keep audio locked until a user gesture: unlock() must be called from one.
// Logical events (e.g. "menu_cursor") map to sound ids through audio.json "events".
import type { Sound, SoundId } from './manifestTypes.ts'

/** Minimum gap between two plays of the same event (held keys must not machine-gun). */
const EVENT_COOLDOWN_MS = 70

export interface AudioLoopHandle { stop(): void; setVolume(volume: number): void }
interface EventLoop {
  leases: Map<symbol, number>
  source: AudioBufferSourceNode | null
  gain: GainNode | null
}

export class AudioEngine {
  private context: AudioContext | null = null
  private readonly sounds = new Map<SoundId, Sound>()
  private readonly events = new Map<string, SoundId>()
  private readonly encoded = new Map<SoundId, Promise<ArrayBuffer | null>>()
  private readonly decoding = new Map<SoundId, Promise<void>>()
  private readonly buffers = new Map<SoundId, AudioBuffer>()
  private readonly unlockListeners = new Set<() => void>()
  private readonly lastEventAt = new Map<string, number>()
  private readonly loops = new Map<string, EventLoop>()
  /** Number of times each sound actually started (diagnostics / dev testing). */
  readonly playCounts = new Map<SoundId, number>()
  private readonly recentEventDiagnostics: { event: string; soundId: SoundId | null; played: boolean; reason: string }[] = []

  private recordEvent(event: string, soundId: SoundId | null, played: boolean, reason: string): void {
    if (!import.meta.env?.DEV) return
    this.recentEventDiagnostics.push({ event, soundId, played, reason })
    if (this.recentEventDiagnostics.length > 30) this.recentEventDiagnostics.shift()
  }

  getRecentEventDiagnostics(): ReadonlyArray<{ event: string; soundId: SoundId | null; played: boolean; reason: string }> {
    return this.recentEventDiagnostics
  }

  register(sounds: Sound[], events: Record<string, SoundId> = {}): void {
    for (const sound of sounds) this.sounds.set(sound.id, sound)
    for (const [event, soundId] of Object.entries(events)) this.events.set(event, soundId)
  }

  getSounds(category?: string): Sound[] {
    return [...this.sounds.values()].filter((s) => category === undefined || s.category === category)
  }

  getEvents(): [string, SoundId][] {
    return [...this.events.entries()]
  }

  get unlocked(): boolean {
    return this.context?.state === 'running'
  }

  /** The shared AudioContext (null until the first unlock()). Music shares it (D-019). */
  getContext(): AudioContext | null {
    return this.context
  }

  get activeLoopCount(): number { return [...this.loops.values()].filter((loop) => loop.source).length }

  /** One source per semantic event, with cancellable leases even while fetch/decode is pending. */
  acquireEventLoop(event: string, volume = 1): AudioLoopHandle {
    let loop = this.loops.get(event)
    const fresh = !loop
    if (!loop) {
      loop = { leases: new Map(), source: null, gain: null }
      this.loops.set(event, loop)
    }
    const current = loop
    const lease = Symbol(event)
    const clamp = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
    current.leases.set(lease, clamp(volume))
    const updateVolume = () => {
      if (current.gain) current.gain.gain.value = Math.max(0, ...current.leases.values())
    }
    updateVolume()
    if (fresh) void this.prepareEvent(event).then((ready) => {
      if (this.loops.get(event) !== current || !current.leases.size) return
      const id = this.events.get(event)
      const context = this.context
      const buffer = id ? this.buffers.get(id) : null
      if (!ready || !context || !buffer || !id) {
        this.recordEvent(event, id ?? null, false, 'loop audio unavailable')
        return
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const region = this.sounds.get(id)?.loop
      if (region && region.startSeconds >= 0 && region.endSeconds <= buffer.duration && region.endSeconds > region.startSeconds) {
        source.loopStart = region.startSeconds
        source.loopEnd = region.endSeconds
      }
      current.gain = context.createGain()
      updateVolume()
      source.connect(current.gain).connect(context.destination)
      current.source = source
      source.start()
      this.playCounts.set(id, (this.playCounts.get(id) ?? 0) + 1)
      this.recordEvent(event, id, true, 'loop started')
    }).catch(() => this.recordEvent(event, this.events.get(event) ?? null, false, 'loop audio unavailable'))

    return {
      setVolume: (next) => { if (current.leases.has(lease)) { current.leases.set(lease, clamp(next)); updateVolume() } },
      stop: () => {
        if (!current.leases.delete(lease)) return
        if (current.leases.size) { updateVolume(); return }
        if (this.loops.get(event) === current) this.loops.delete(event)
        try { current.source?.stop() } catch { /* source already stopped */ }
        current.source?.disconnect()
        current.gain?.disconnect()
        current.source = null
        current.gain = null
        this.recordEvent(event, this.events.get(event) ?? null, false, 'loop stopped')
      },
    }
  }

  /** Called whenever the shared context becomes (or already is) running after a gesture. */
  onUnlock(listener: () => void): () => void {
    this.unlockListeners.add(listener)
    return () => this.unlockListeners.delete(listener)
  }

  /** Create/resume the audio context. Call from a user gesture handler. */
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext()
      this.context.addEventListener('statechange', () => {
        if (this.context?.state === 'running') for (const listener of [...this.unlockListeners]) listener()
      })
    }
    if (this.context.state === 'suspended') void this.context.resume()
    for (const id of this.encoded.keys()) this.decode(id)
  }

  /** Fetch sounds ahead of use; they are decoded as soon as audio is unlocked. */
  preload(ids: SoundId[]): void {
    for (const id of ids) {
      const sound = this.sounds.get(id)
      if (!sound || this.encoded.has(id)) continue
      this.encoded.set(
        id,
        fetch(sound.url)
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.arrayBuffer()
          })
          .catch(() => {
            console.warn(`[audio] could not load sound "${id}"`)
            return null
          }),
      )
      this.decode(id)
    }
  }

  preloadEvents(): void {
    // Alternative ringtones are large and fetched on demand (prepareEvent), not at startup.
    this.preload([...this.events].filter(([event]) => !event.startsWith('ringtone:')).map(([, id]) => id))
  }

  private decode(id: SoundId): Promise<void> | null {
    const context = this.context
    const pending = this.encoded.get(id)
    if (this.buffers.has(id)) return Promise.resolve()
    const inFlight = this.decoding.get(id)
    if (inFlight) return inFlight
    if (!context || !pending) return null
    const job = pending
      // decodeAudioData detaches its input, so decode a copy of the fetched bytes.
      .then((data) => (data ? context.decodeAudioData(data.slice(0)) : null))
      .then((buffer) => {
        if (buffer) this.buffers.set(id, buffer)
      })
      .catch(() => console.warn(`[audio] could not decode sound "${id}"`))
      .finally(() => this.decoding.delete(id))
    this.decoding.set(id, job)
    return job
  }

  /** Ensure mapped audio is fetched and decoded after an audio-unlocking gesture. */
  async prepareEvent(event: string): Promise<boolean> {
    const id = this.events.get(event)
    if (!id) return false
    if (!this.encoded.has(id)) this.preload([id])
    const context = this.context
    if (!context) return false
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running') return false
    await (this.decode(id) ?? Promise.resolve())
    return this.buffers.has(id)
  }

  /** Play a decoded sound. Returns false (silently) if audio is locked or not loaded yet. */
  play(id: SoundId, volume = 1): boolean {
    const context = this.context
    if (!context || context.state !== 'running' || volume <= 0) return false
    const buffer = this.buffers.get(id)
    if (!buffer) {
      this.preload([id])
      return false
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = Math.min(1, volume)
    source.connect(gain).connect(context.destination)
    source.start()
    this.playCounts.set(id, (this.playCounts.get(id) ?? 0) + 1)
    return true
  }

  /** Play the sound mapped to a logical event, with a per-event cooldown. */
  playEvent(event: string, volume = 1): boolean {
    const id = this.events.get(event)
    if (!id) {
      this.recordEvent(event, null, false, 'event is not mapped')
      return false
    }
    const now = performance.now()
    if (now - (this.lastEventAt.get(event) ?? -Infinity) < EVENT_COOLDOWN_MS) {
      this.recordEvent(event, id, false, 'event cooldown')
      return false
    }
    const played = this.play(id, volume)
    const context = this.context
    const reason = played ? 'started' : volume <= 0 ? 'zero volume'
      : !context || context.state !== 'running' ? 'audio context is locked'
        : !this.buffers.has(id) ? 'audio is not decoded yet' : 'playback did not start'
    this.recordEvent(event, id, played, reason)
    if (played) this.lastEventAt.set(event, now)
    return played
  }
}

export const audioEngine = new AudioEngine()

if (import.meta.env?.DEV) {
  Object.assign(window, { __ccAudio: audioEngine })
}
