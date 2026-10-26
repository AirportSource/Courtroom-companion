// Conversation music policy (pure functions; no React, no Web Audio, no character names).
//
// Precedence for the original (game) soundtrack while a conversation is open:
//
//   1. a LIVE override chosen in the conversation (prev / next / select / "return to theme");
//   2. the track fixed in Settings ("Track" other than the default entry);
//   3. the character's preferred theme (soundtrack.json profile `defaultTrack`, then `default`).
//
// Scope of a live override (decision D-081): it belongs to ONE conversation session with ONE
// character. It persists while that conversation stays open (also across pauses, track changes by the
// engine, settings volume changes ...) and is dropped when the player leaves the conversation scene
// or the conversation character changes: the next conversation starts again from Settings / the
// character's theme. It is never written to persisted settings, so it cannot leak into later sessions.
// The override only applies while the Settings source is "Game music"; imported tracks and Radio ignore it.
import {
  resolveProfileTrack,
  selectablePool,
  trackListLabel,
  trackShortTitle,
  type SoundtrackGame,
  type SoundtrackManifest,
} from './soundtrack.ts'

export interface TrackOverride {
  characterId: string
  trackId: string
}

export interface ConversationTrackItem {
  id: string
  /** Full OST title. */
  title: string
  /** Short display name for the player. */
  shortTitle: string
  /** Short name with the game suffix, for lists that mix games. */
  label: string
  game?: SoundtrackGame
  category: string
  /** The preferred theme of the current character. */
  isTheme: boolean
  /** Either the Settings-fixed track or the theme: what plays without a live override. */
  isBaseline: boolean
}

/** True when `trackId` can be played from the built-in soundtrack (bgm or contextual, with a file). */
export function isSelectableTrack(manifest: SoundtrackManifest | null, trackId: string | null | undefined): trackId is string {
  if (!manifest || !trackId || !Object.hasOwn(manifest.tracks, trackId)) return false
  const track = manifest.tracks[trackId]
  return track.src !== undefined && (track.category === 'bgm' || track.category === 'contextual')
}

/** The character's preferred theme, or the `default` profile / first bgm track when it has none. */
export function themeTrackFor(manifest: SoundtrackManifest | null, characterId: string | null): string | null {
  return manifest ? resolveProfileTrack(manifest, characterId || null) : null
}

/** What plays without a live override: the Settings-fixed track when valid, otherwise the theme. */
export function baselineTrackFor(manifest: SoundtrackManifest | null, characterId: string | null, settingsTrackId: string): string | null {
  return isSelectableTrack(manifest, settingsTrackId) ? settingsTrackId : themeTrackFor(manifest, characterId)
}

/** The override that applies to this conversation, or null (other character, stale or unknown track). */
export function activeOverrideTrack(override: TrackOverride | null, characterId: string | null, manifest: SoundtrackManifest | null): string | null {
  if (!override || override.characterId !== (characterId ?? '')) return null
  return isSelectableTrack(manifest, override.trackId) ? override.trackId : null
}

export function effectiveTrackFor(
  manifest: SoundtrackManifest | null,
  characterId: string | null,
  settingsTrackId: string,
  override: TrackOverride | null,
): string | null {
  return activeOverrideTrack(override, characterId, manifest) ?? baselineTrackFor(manifest, characterId, settingsTrackId)
}

/** Keep the override only while the same conversation (scene + character) is open. */
export function reconcileOverride(
  override: TrackOverride | null,
  scene: 'menu' | 'conversation',
  characterId: string | null,
): TrackOverride | null {
  if (!override) return null
  return scene === 'conversation' && override.characterId === (characterId ?? '') ? override : null
}

/**
 * Next override after the player picks `trackId`. Picking what already plays without an override
 * clears the override (no needless "manual" state). An unknown track leaves the override unchanged.
 */
export function overrideAfterSelect(
  manifest: SoundtrackManifest | null,
  characterId: string,
  settingsTrackId: string,
  current: TrackOverride | null,
  trackId: string,
): TrackOverride | null {
  if (!isSelectableTrack(manifest, trackId)) return current
  if (trackId === baselineTrackFor(manifest, characterId, settingsTrackId)) return null
  return { characterId, trackId }
}

/** Circular step through `ids`. An unknown `current` starts at the first (next) or last (previous) entry. */
export function stepTrack(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null
  const at = current === null ? -1 : ids.indexOf(current)
  if (at === -1) return delta > 0 ? ids[0] : ids[ids.length - 1]
  return ids[(at + delta + ids.length) % ids.length]
}

/** Ordered, selectable list for the player UI. */
export function buildTrackList(
  manifest: SoundtrackManifest | null,
  characterId: string | null,
  settingsTrackId: string,
): ConversationTrackItem[] {
  if (!manifest) return []
  const theme = themeTrackFor(manifest, characterId)
  const baseline = baselineTrackFor(manifest, characterId, settingsTrackId)
  return selectablePool(manifest).map((id) => {
    const entry = manifest.tracks[id]
    return {
      id,
      title: entry.title,
      shortTitle: trackShortTitle(entry),
      label: trackListLabel(entry),
      ...(entry.game ? { game: entry.game } : {}),
      category: entry.category,
      isTheme: id === theme,
      isBaseline: id === baseline,
    }
  })
}
