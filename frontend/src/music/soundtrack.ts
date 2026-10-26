// Original soundtrack: manifest types, pure validator, pool selection and the TrackResolver
// that turns manifest entries into MusicTracks. Which track belongs to which character/profile
// lives only in the manifest data ("profiles"), never in code.
import { parseLoopMetadata } from './loopMath.ts'
import type { TrackResolver } from './webAudioSource.ts'
import type { MusicTrack } from './types.ts'

export type SoundtrackCategory = 'bgm' | 'contextual' | 'excluded'

/** Which game of the Trilogy a track belongs to (display grouping only). */
export type SoundtrackGame = 'aa1' | 'jfa' | 'tnt'

export const SOUNDTRACK_GAMES: readonly SoundtrackGame[] = ['aa1', 'jfa', 'tnt']

export const GAME_LABELS: Record<SoundtrackGame, string> = {
  aa1: 'Ace Attorney',
  jfa: 'Justice for All',
  tnt: 'Trials and Tribulations',
}

export interface SoundtrackTrackEntry {
  /** Track number within its source: the PWAA OST for entries without `disc`, otherwise within the Trilogy disc. */
  number: number
  /** Original expansion catalogue disc (2 or 3), retained as identity metadata after DS migration. */
  disc?: number
  game?: SoundtrackGame
  title: string
  /** Short display name for players (falls back to `title`). */
  shortTitle?: string
  /** Path relative to assets/music/. Absent for excluded tracks (no runtime file). */
  src?: string
  category: SoundtrackCategory
  tags: string[]
  /** Linear per-track gain (offline loudness matching toward -15 LUFS, see docs/MUSIC.md). */
  gain: number
  /** Integrated loudness measured offline (informational; `gain` is derived from it). */
  loudnessLufs?: number
  contextual: boolean
  /** Raw loop metadata (parsed leniently by parseLoopMetadata); null = no known loop. */
  loop: unknown
  /** Why a looping candidate has no loop (offline analysis result); informational. */
  loopReason?: string
  /** Physical audio provenance, independent of logical track ID/catalogue numbering. */
  audioProvenance?: 'original-ds-mp3' | 'original-ds-ncsf123-lossless'
  /** Whole-file/unmeasured state also exists when there is no loop object. */
  loopStatus?: 'unmeasured' | 'measured_not_auditioned' | 'whole_file'
}

export interface SoundtrackProfile {
  defaultTrack: string
  alternatives: string[]
}

export interface SoundtrackManifest {
  version: 1
  profiles: Record<string, SoundtrackProfile>
  tracks: Record<string, SoundtrackTrackEntry>
}

const CATEGORIES: readonly SoundtrackCategory[] = ['bgm', 'contextual', 'excluded']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural validation; returns human-readable errors (empty = valid). */
export function validateSoundtrackManifest(json: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(json)) return ['manifest must be an object']
  if (json.version !== 1) errors.push('version must be 1')
  const tracks = json.tracks
  if (!isRecord(tracks)) {
    errors.push('tracks must be an object')
    return errors
  }
  for (const [id, raw] of Object.entries(tracks)) {
    if (!isRecord(raw)) {
      errors.push(`${id}: must be an object`)
      continue
    }
    if (!Number.isInteger(raw.number)) errors.push(`${id}: number must be an integer`)
    if (raw.disc !== undefined && !(Number.isInteger(raw.disc) && (raw.disc as number) >= 1 && (raw.disc as number) <= 9)) errors.push(`${id}: disc must be a small positive integer`)
    if (raw.game !== undefined && !SOUNDTRACK_GAMES.some((g) => g === raw.game)) errors.push(`${id}: game must be one of ${SOUNDTRACK_GAMES.join(', ')}`)
    if (raw.shortTitle !== undefined && (typeof raw.shortTitle !== 'string' || raw.shortTitle === '')) errors.push(`${id}: shortTitle must be a non-empty string`)
    if (raw.loudnessLufs !== undefined && typeof raw.loudnessLufs !== 'number') errors.push(`${id}: loudnessLufs must be a number`)
    if (raw.loopReason !== undefined && typeof raw.loopReason !== 'string') errors.push(`${id}: loopReason must be a string`)
    if (typeof raw.title !== 'string' || raw.title === '') errors.push(`${id}: title is required`)
    const category = CATEGORIES.find((c) => c === raw.category)
    if (!category) errors.push(`${id}: category must be one of ${CATEGORIES.join(', ')}`)
    if (category === 'excluded' && raw.src !== undefined) errors.push(`${id}: excluded tracks must not have a src`)
    if (category && category !== 'excluded' && (typeof raw.src !== 'string' || raw.src === '')) errors.push(`${id}: src is required`)
    if (typeof raw.src === 'string' && (raw.src.startsWith('/') || raw.src.includes('..') || /\s/.test(raw.src))) {
      errors.push(`${id}: src must be a clean relative path`)
    }
    if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string')) errors.push(`${id}: tags must be a string array`)
    if (typeof raw.gain !== 'number' || !(raw.gain >= 0)) errors.push(`${id}: gain must be a non-negative number`)
    if (typeof raw.contextual !== 'boolean') errors.push(`${id}: contextual must be a boolean`)
    else if (raw.contextual !== (category === 'contextual')) errors.push(`${id}: contextual flag must match category`)
    if (raw.loop !== null && !isRecord(raw.loop)) errors.push(`${id}: loop must be null or an object`)
    else if (isRecord(raw.loop) && parseLoopMetadata(raw.loop).region === null) errors.push(`${id}: loop region is invalid`)
  }
  const profiles = json.profiles
  if (!isRecord(profiles)) {
    errors.push('profiles must be an object')
    return errors
  }
  for (const [name, raw] of Object.entries(profiles)) {
    if (!isRecord(raw) || typeof raw.defaultTrack !== 'string') {
      errors.push(`profile ${name}: defaultTrack is required`)
      continue
    }
    const referenced = [raw.defaultTrack, ...(Array.isArray(raw.alternatives) ? raw.alternatives : [])]
    for (const ref of referenced) {
      const entry = typeof ref === 'string' ? tracks[ref] : undefined
      if (!isRecord(entry)) errors.push(`profile ${name}: unknown track ${String(ref)}`)
      else if (entry.category !== 'bgm') errors.push(`profile ${name}: ${String(ref)} is not a bgm track`)
    }
  }
  return errors
}

export class SoundtrackError extends Error {}

/** Fetch + validate the soundtrack manifest (assets/music/soundtrack.json). */
export async function loadSoundtrackManifest(baseUrl: string = `${import.meta.env.BASE_URL}assets/music/`, fetchFn: typeof fetch = fetch): Promise<SoundtrackManifest> {
  const response = await fetchFn(`${baseUrl}soundtrack.json`)
  if (!response.ok) throw new SoundtrackError(`soundtrack.json: HTTP ${response.status}`)
  const json: unknown = await response.json().catch(() => {
    throw new SoundtrackError('soundtrack.json: invalid JSON')
  })
  const errors = validateSoundtrackManifest(json)
  if (errors.length > 0) throw new SoundtrackError(`soundtrack.json: ${errors.join('; ')}`)
  return json as SoundtrackManifest
}

/** Ids of the primary background-music pool: category "bgm" only (no contextual, no excluded). */
export function bgmPool(manifest: SoundtrackManifest): string[] {
  return Object.entries(manifest.tracks)
    .filter(([, t]) => t.category === 'bgm' && t.src !== undefined)
    .map(([id]) => id)
}

/** Ids of contextual cues (reminiscences, pursuit, objection ...), never part of the BGM pool. */
export function contextualPool(manifest: SoundtrackManifest): string[] {
  return Object.entries(manifest.tracks)
    .filter(([, t]) => t.category === 'contextual' && t.src !== undefined)
    .map(([id]) => id)
}

/** Ids a player may select: the bgm pool, then contextual cues, in manifest (disc) order. Excluded tracks never. */
export function selectablePool(manifest: SoundtrackManifest): string[] {
  return Object.entries(manifest.tracks)
    .filter(([, t]) => (t.category === 'bgm' || t.category === 'contextual') && t.src !== undefined)
    .map(([id]) => id)
}

/** Short title for players; falls back to the full title. */
export function trackShortTitle(entry: Pick<SoundtrackTrackEntry, 'title' | 'shortTitle'>): string {
  return entry.shortTitle && entry.shortTitle !== '' ? entry.shortTitle : entry.title
}

/** "Short title (Game)" for lists where the same short title exists in several games. */
export function trackListLabel(entry: Pick<SoundtrackTrackEntry, 'title' | 'shortTitle' | 'game'>): string {
  const short = trackShortTitle(entry)
  const game = entry.game && entry.game !== 'aa1' ? ` (${entry.game === 'jfa' ? 'JFA' : 'T&T'})` : entry.game === 'aa1' ? ' (AA)' : ''
  return `${short}${game}`
}

/** Default track for a profile name, falling back to the "default" profile, then the pool. */
export function resolveProfileTrack(manifest: SoundtrackManifest, profile?: string | null): string | null {
  const chosen = (profile ? manifest.profiles[profile] : undefined) ?? manifest.profiles.default
  if (chosen && manifest.tracks[chosen.defaultTrack]?.src) return chosen.defaultTrack
  return bgmPool(manifest)[0] ?? null
}

export function createOriginalTrackResolver(manifest: SoundtrackManifest, baseUrl: string = `${import.meta.env.BASE_URL}assets/music/`): TrackResolver {
  return {
    resolve(trackId) {
      const entry = Object.hasOwn(manifest.tracks, trackId) ? manifest.tracks[trackId] : undefined
      if (!entry || entry.category === 'excluded' || !entry.src) return Promise.resolve(null)
      const track: MusicTrack = {
        id: trackId,
        title: entry.title,
        source: 'original',
        url: `${baseUrl}${entry.src}`,
        category: entry.category,
        tags: entry.tags,
        gain: entry.gain,
        loop: parseLoopMetadata(entry.loop),
        contextual: entry.contextual,
      }
      return Promise.resolve(track)
    },
  }
}
