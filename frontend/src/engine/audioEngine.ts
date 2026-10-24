// Central audio service (D-005, D-019). One AudioContext for the app.
// Sounds are fetched early (no context needed) and decoded once the context exists; each
// play is a short-lived buffer source, so overlapping one-shots never recreate media
// elements. Browsers keep audio locked until a user gesture: unlock() must be called from one.
// Logical events (e.g. "menu_cursor") map to sound ids through audio.json "events".
import type { Sound, SoundId } from './manifestTypes.ts'

/** Minimum gap between two plays of the same event (held keys must not machine-gun). */
const EVENT_COOLDOWN_MS = 70

class AudioEngine {
  private context: AudioContext | null = null
  private readonly sounds = new Map<SoundId, Sound>()
  private readonly events = new Map<string, SoundId>()
  private readonly encoded = new Map<SoundId, Promise<ArrayBuffer | null>>()
  private readonly decoding = new Set<SoundId>()
  private readonly buffers = new Map<SoundId, AudioBuffer>()
  private readonly lastEventAt = new Map<string, number>()
  /** Number of times each sound actually started (diagnostics / dev testing). */
  readonly playCounts = new Map<SoundId, number>()

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

  /** Create/resume the audio context. Call from a user gesture handler. */
  unlock(): void {
    if (!this.context) this.context = new AudioContext()
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
    this.preload([...this.events.values()])
  }

  private decode(id: SoundId): void {
    const context = this.context
    const pending = this.encoded.get(id)
    if (!context || !pending || this.buffers.has(id) || this.decoding.has(id)) return
    this.decoding.add(id)
    pending
      // decodeAudioData detaches its input, so decode a copy of the fetched bytes.
      .then((data) => (data ? context.decodeAudioData(data.slice(0)) : null))
      .then((buffer) => {
        if (buffer) this.buffers.set(id, buffer)
      })
      .catch(() => console.warn(`[audio] could not decode sound "${id}"`))
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
    if (!id) return false
    const now = performance.now()
    if (now - (this.lastEventAt.get(event) ?? -Infinity) < EVENT_COOLDOWN_MS) return false
    this.lastEventAt.set(event, now)
    return this.play(id, volume)
  }
}

export const audioEngine = new AudioEngine()

if (import.meta.env?.DEV) {
  Object.assign(window, { __ccAudio: audioEngine })
}
