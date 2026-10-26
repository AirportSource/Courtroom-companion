// Semantic SFX: the director emits names; audio.json events `sfx_<name>` map them to sounds.
//
// Two layers (D-049 + character signature sounds):
// - the closed GLOBAL set below (surprise, shock, ...), the same for every character;
// - SIGNATURE sounds a character declares (performance.json `sfx.signature`, e.g. `whip`). They are
//   not hard-coded here: the audio manifest loader registers every `sfx_<id>` audio event that is
//   not a global name, so a director name is accepted only if it is global or an event audio.json
//   really defines. Anything else (unknown, malformed, a path) stays a silent no-op.
//
// Which concrete sound plays for a name (D-092): the active character's own candidates
// (character.json `semanticSounds`) -> the shared "everyone" pool (audio.json `semanticSounds`)
// -> the global event `sfx_<name>`. Within a pool, candidates rotate so the same file is not
// repeated back to back. WHEN a sound plays at all is decided by the director (cooldowns).
import { audioEngine } from './audioEngine.ts'

export const SFX_NAMES = [
  'surprise',
  'shock',
  'realization',
  'comic',
  'emphasis',
  'tension',
  'notification',
  'soft_transition',
  // Shared "everyone" categories (assets/most used sounds/everyone).
  'angry',
  'flabbergasted',
  'encouragement',
] as const
export type SfxName = (typeof SFX_NAMES)[number]

/** Shape of a signature id; the backend enforces the same pattern when loading performance.json. */
const SIGNATURE_ID = /^[a-z][a-z0-9_]{1,31}$/

/** semantic name → audio.json event id (global names, plus registered signature sounds). */
export const SFX_EVENTS: Readonly<Record<string, string>> = Object.fromEntries(
  SFX_NAMES.map((name) => [name, `sfx_${name}`]),
)
const events = SFX_EVENTS as Record<string, string>
const globalNames: ReadonlySet<string> = new Set(SFX_NAMES)

/**
 * Registers the signature sounds found in the audio manifest's event names (`sfx_<id>`).
 * Replaces any earlier registration; global names and malformed ids are ignored.
 */
export function registerSignatureSfx(audioEvents: Iterable<string>): string[] {
  for (const id of Object.keys(events)) if (!globalNames.has(id)) delete events[id]
  const registered: string[] = []
  for (const event of audioEvents) {
    if (!event.startsWith('sfx_')) continue
    const id = event.slice(4)
    if (!SIGNATURE_ID.test(id) || globalNames.has(id)) continue
    events[id] = event
    registered.push(id)
  }
  return registered
}

/** Whether `name` is a known semantic sound (global or registered signature). */
export function isKnownSfx(name: unknown): name is string {
  return typeof name === 'string' && Object.hasOwn(events, name)
}

export function sfxEvent(name: string): string | null {
  return Object.hasOwn(events, name) ? events[name] : null
}

interface EventPlayer {
  playEvent(event: string, volume?: number): boolean
  play?(id: string, volume?: number): boolean
}

/** Semantic name -> candidate sound ids. */
export type SemanticSoundPools = Readonly<Record<string, readonly string[]>>

let sharedPools: SemanticSoundPools = {}
/** Recently played sound ids per `characterId:name`, newest last. */
const recent = new Map<string, string[]>()

/** Registers the shared pools from audio.json (ids the audio manifest does not define are dropped). */
export function registerSemanticSounds(raw: unknown, knownSounds: ReadonlySet<string>): SemanticSoundPools {
  sharedPools = readSemanticSounds(raw, knownSounds)
  recent.clear()
  return sharedPools
}

/** Parses a `semanticSounds` table: only known names, only known sound ids, no empty pools. */
export function readSemanticSounds(raw: unknown, knownSounds?: ReadonlySet<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [name, ids] of Object.entries(raw)) {
    if (!isKnownSfx(name) || !Array.isArray(ids)) continue
    const pool = ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && (!knownSounds || knownSounds.has(id)))
    if (pool.length > 0) out[name] = [...new Set(pool)]
  }
  return out
}

/** Every sound id a character's pools and the shared pools can play (for preloading). */
export function semanticSoundIds(characterPools: SemanticSoundPools = {}): string[] {
  return [...new Set([...Object.values(sharedPools), ...Object.values(characterPools)].flat())]
}

export interface SfxResolution {
  requested: string
  character: string | null
  /** Candidate from the character's own pool, the shared pool, and the global event. */
  characterCandidate: string | null
  sharedCandidate: string | null
  globalEvent: string | null
  /** What plays: a sound id from a pool, or the global event. */
  final: { kind: 'sound' | 'event'; id: string } | null
  source: 'character' | 'shared' | 'global' | null
  reason: string
}

function rotate(pool: readonly string[], key: string): string {
  // The first candidate not among the last (pool size - 1) plays: a fixed round robin, so a pool
  // never repeats a file while it has another one.
  const history = recent.get(key) ?? []
  const avoid = new Set(history.slice(-(pool.length - 1) || history.length))
  return pool.find((id) => !avoid.has(id)) ?? pool[0]
}

/** Resolves a semantic name for a character without playing it (also used by the dev panel). */
export function resolveSfx(name: string, characterId: string | null = null, characterPools: SemanticSoundPools = {}): SfxResolution {
  const key = `${characterId ?? '*'}:${name}`
  const own = Object.hasOwn(characterPools, name) ? characterPools[name] : []
  const shared = Object.hasOwn(sharedPools, name) ? sharedPools[name] : []
  const characterCandidate = own.length ? rotate(own, key) : null
  const sharedCandidate = shared.length ? rotate(shared, key) : null
  const globalEvent = sfxEvent(name)
  const base = { requested: name, character: characterId, characterCandidate, sharedCandidate, globalEvent }
  if (!isKnownSfx(name)) return { ...base, final: null, source: null, reason: 'unknown semantic sound' }
  if (characterCandidate) return { ...base, final: { kind: 'sound', id: characterCandidate }, source: 'character', reason: 'character-specific' }
  if (sharedCandidate) return { ...base, final: { kind: 'sound', id: sharedCandidate }, source: 'shared', reason: 'shared pool' }
  if (globalEvent) return { ...base, final: { kind: 'event', id: globalEvent }, source: 'global', reason: 'global event' }
  return { ...base, final: null, source: null, reason: 'no sound mapped' }
}

/**
 * Play a semantic effect, preferring the character's own sounds, then the shared pool, then the
 * global event. Unknown names, mute and zero volume are silent no-ops. Returns the resolution with
 * `played` so callers can show why something stayed silent.
 */
export function playSemanticSfx(
  name: string, volume: number, muted: boolean,
  characterId: string | null = null, characterPools: SemanticSoundPools = {}, player: EventPlayer = audioEngine,
): SfxResolution & { played: boolean } {
  const resolution = resolveSfx(name, characterId, characterPools)
  if (!resolution.final) return { ...resolution, played: false }
  if (muted || !(volume > 0)) return { ...resolution, played: false, reason: muted ? 'muted' : 'zero volume' }
  const { kind, id } = resolution.final
  const played = kind === 'sound' && player.play ? player.play(id, volume) : player.playEvent(kind === 'event' ? id : `sfx_${name}`, volume)
  if (played && kind === 'sound') {
    const key = `${characterId ?? '*'}:${name}`
    recent.set(key, [...(recent.get(key) ?? []), id].slice(-4))
  }
  return { ...resolution, played, reason: played ? resolution.reason : 'playback did not start (locked, not decoded or cooldown)' }
}

/** One dev-panel line: what was asked, what each layer offered, what played and why. */
export interface SfxDiagnostic {
  name: string
  character: string | null
  characterCandidate: string | null
  sharedCandidate: string | null
  final: string | null
  played: boolean
  reason: string
  source: 'dialogue' | 'audition' | 'effect'
}

export function sfxDiagnostic(result: SfxResolution & { played: boolean }, source: SfxDiagnostic['source']): SfxDiagnostic {
  return {
    name: result.requested, character: result.character, characterCandidate: result.characterCandidate,
    sharedCandidate: result.sharedCandidate, final: result.final?.id ?? null, played: result.played,
    reason: result.played ? `${result.reason} (${result.source})` : result.reason, source,
  }
}

/** Play a semantic effect through its global event. Unknown names, mute and zero volume are silent no-ops. */
export function playSfx(name: string, volume: number, muted: boolean, player: EventPlayer = audioEngine): boolean {
  const event = sfxEvent(name)
  if (!event || muted || !(volume > 0)) return false
  return player.playEvent(event, volume)
}
