import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { audioEngine } from '../engine/audioEngine.ts'
import { useSettings } from '../settings/settings.ts'
import {
  activeOverrideTrack,
  baselineTrackFor,
  buildTrackList,
  effectiveTrackFor,
  overrideAfterSelect,
  stepTrack,
  themeTrackFor,
  type ConversationTrackItem,
} from './conversationMusic.ts'
import { conversationMusicStore } from './conversationMusicStore.ts'
import { musicRuntime } from './musicRuntime.ts'
import type { SoundtrackManifest } from './soundtrack.ts'
import type { PlaybackStatus } from './types.ts'
import { useMusicState } from './useMusicSync.ts'

export interface ConversationMusic {
  /** False when the player has nothing to control: Settings source is not "Game music" or no soundtrack is loaded. */
  available: boolean
  /** Track that should be playing now (override > Settings track > character theme), or null. */
  trackId: string | null
  title: string
  shortTitle: string
  /** The character's preferred theme and the track that plays without a live override. */
  themeTrackId: string | null
  baselineTrackId: string | null
  /** A live choice differs from what Settings/the theme would play. */
  isOverride: boolean
  status: PlaybackStatus
  /** The effective track is audibly playing. */
  playing: boolean
  trackList: ConversationTrackItem[]
  next(): void
  prev(): void
  /** Play/pause; also the user-gesture retry after an autoplay block or a failed load. */
  toggle(): void
  select(trackId: string): void
  /** Return to the character's theme (clears the override when the theme is also the baseline). */
  resetToTheme(): void
}

/**
 * Conversation music controls (policy in conversationMusic.ts). The sound itself is driven by
 * useMusicSync (mounted once in App), which reads the override from the shared store, so this hook
 * only edits the override and pauses/resumes the engine: there is no second playback path, no
 * restart of an unchanged track and no interference with ducking or the phone ringtone.
 * `soundtrack` defaults to the manifest App already loaded.
 */
export function useConversationMusic(characterId: string, soundtrack?: SoundtrackManifest | null): ConversationMusic {
  const { settings } = useSettings()
  const snapshot = useSyncExternalStore(conversationMusicStore.subscribe, conversationMusicStore.getSnapshot)
  const manifest = soundtrack ?? snapshot.soundtrack
  const engineState = useMusicState()
  const settingsTrack = settings.originalTrackId
  const available = settings.musicSource === 'original' && manifest !== null

  const trackId = available ? effectiveTrackFor(manifest, characterId, settingsTrack, snapshot.override) : null
  const baselineTrackId = available ? baselineTrackFor(manifest, characterId, settingsTrack) : null
  const themeTrackId = available ? themeTrackFor(manifest, characterId) : null
  const isOverride = available && activeOverrideTrack(snapshot.override, characterId, manifest) !== null
    && trackId !== baselineTrackId
  const trackList = useMemo(
    () => (available ? buildTrackList(manifest, characterId, settingsTrack) : []),
    [available, manifest, characterId, settingsTrack],
  )
  const ids = useMemo(() => trackList.map((item) => item.id), [trackList])
  const entry = trackId && manifest ? manifest.tracks[trackId] : undefined

  const select = useCallback((id: string) => {
    if (!available) return
    const next = overrideAfterSelect(manifest, characterId, settingsTrack, conversationMusicStore.getSnapshot().override, id)
    conversationMusicStore.setOverride(next)
  }, [available, manifest, characterId, settingsTrack])

  const step = useCallback((delta: 1 | -1) => {
    const current = effectiveTrackFor(manifest, characterId, settingsTrack, conversationMusicStore.getSnapshot().override)
    const target = stepTrack(ids, current, delta)
    if (target) select(target)
  }, [ids, manifest, characterId, settingsTrack, select])

  const toggle = useCallback(() => {
    const { engine } = musicRuntime()
    const state = engine.getState()
    audioEngine.unlock() // a real click: allowed to start audio
    if (state.status === 'playing') engine.pause()
    else if (state.status === 'paused') engine.resume()
    else if (state.status === 'blocked' || state.status === 'error') void engine.retry()
    else if (trackId) void engine.play('original', trackId)
  }, [trackId])

  const resetToTheme = useCallback(() => {
    if (themeTrackId) select(themeTrackId)
  }, [themeTrackId, select])

  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  return {
    available,
    trackId,
    title: entry?.title ?? '',
    shortTitle: entry ? (entry.shortTitle ?? entry.title) : '',
    themeTrackId,
    baselineTrackId,
    isOverride,
    status: engineState.status,
    playing: engineState.status === 'playing' && engineState.source === 'original' && engineState.trackId === trackId,
    trackList,
    next,
    prev,
    toggle,
    select,
    resetToTheme,
  }
}
