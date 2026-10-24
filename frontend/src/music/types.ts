// Shared music contracts (lead-owned). Every music source, the engine, the soundtrack
// manifest and the import library speak these types; nothing here knows a character,
// a provider or a file name. Loop boundaries are canonical in SAMPLES at the stated
// sample rate (the rate the audio was analysed at); players convert to seconds.

export type MusicSourceKind = 'original' | 'imported' | 'radio'

/** Settings-level choice. 'off' means no BGM source is active. */
export type MusicSourceSetting = MusicSourceKind | 'off'

/** Where a loop region came from. Never claim more certainty than the method gives. */
export type LoopProvenance =
  | 'curated-analysis' // built-in track: offline analysis accepted against documented metric thresholds (see note)
  | 'auto-detected' // imported track: automatic proposal, not yet accepted
  | 'user-accepted' // imported track: automatic proposal accepted unchanged
  | 'user-adjusted' // loop edited by the user
  | 'none' // no loop known: plays to the end, then restarts from 0

export interface LoopRegion {
  /** Inclusive loop start, in samples at `sampleRate`. */
  startSample: number
  /** Exclusive loop end, in samples at `sampleRate`. Must be > startSample. */
  endSample: number
  /** Sample rate the sample positions refer to. */
  sampleRate: number
  /** Optional short crossfade baked at the seam (fallback for imperfect audio only). */
  crossfadeMs?: number
}

export interface LoopMetadata {
  region: LoopRegion | null
  /** 0–1, or null when unknown. Honest estimate, never a guarantee. */
  confidence: number | null
  provenance: LoopProvenance
  note?: string
}

/** Track descriptor common to every Web Audio source (original + imported). */
export interface MusicTrack {
  id: string
  title: string
  source: Exclude<MusicSourceKind, 'radio'>
  /** Resolved URL the browser fetches (never chosen by an LLM). */
  url: string
  category: string
  tags: string[]
  /** Linear per-track gain (1 = unchanged). */
  gain: number
  loop: LoopMetadata
  contextual: boolean
}

export type PlaybackStatus =
  | 'idle' // nothing selected / stopped
  | 'loading' // fetching / decoding / player boot
  | 'playing'
  | 'paused'
  | 'blocked' // autoplay blocked: needs a user-initiated play
  | 'error'

export type MusicErrorCode =
  | 'missing_file'
  | 'decode_failed'
  | 'unsupported_codec'
  | 'invalid_loop'
  | 'network'
  | 'unavailable' // e.g. YouTube video unavailable / livestream ended
  | 'api_unavailable' // e.g. YouTube IFrame API failed to load
  | 'autoplay_blocked'
  | 'aborted' // superseded by a newer request (not shown as a user error)
  | 'unknown'

export interface MusicError {
  code: MusicErrorCode
  message: string
}

export interface SourceState {
  status: PlaybackStatus
  trackId: string | null
  title: string | null
  error: MusicError | null
}

export interface StartOptions {
  /** Linear 0–1 effective volume (master × mute already applied by the engine). */
  volume: number
  fadeInMs?: number
  /** Aborted when the engine supersedes this request (source switched while loading). */
  signal: AbortSignal
}

/**
 * One music source. The MusicEngine guarantees at most one source is audible: it always
 * awaits `stop()` on the previous source before `start()` on the next. Sources must never
 * reject with unhandled promises; failures are reported through state (status 'error').
 */
export interface MusicSource {
  readonly kind: MusicSourceKind
  getState(): SourceState
  subscribe(listener: (state: SourceState) => void): () => void
  /** Load (lazily) and play `trackId`. Resolves once playing, blocked, aborted or failed. */
  start(trackId: string, options: StartOptions): Promise<void>
  pause(): void
  resume(): void
  /** Stop playback (optionally fading out) and release per-track resources. */
  stop(options?: { fadeOutMs?: number }): Promise<void>
  /** Linear 0–1 effective volume. */
  setVolume(volume: number): void
  dispose(): void
}

export interface MusicEngineState {
  source: MusicSourceKind | null
  status: PlaybackStatus
  trackId: string | null
  title: string | null
  error: MusicError | null
  /** Master BGM volume 0–1 (independent from blip/SFX volume). */
  volume: number
  muted: boolean
}
