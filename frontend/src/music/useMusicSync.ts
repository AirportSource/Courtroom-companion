import { useEffect, useSyncExternalStore } from 'react'
import { activeOverrideTrack, reconcileOverride } from './conversationMusic.ts'
import { conversationMusicStore } from './conversationMusicStore.ts'
import { useSettings } from '../settings/settings.ts'
import { musicRuntime, syncMusic, type MusicContext } from './musicRuntime.ts'
import type { SoundtrackManifest } from './soundtrack.ts'
import type { MusicEngineState } from './types.ts'

/**
 * Keeps the single MusicEngine in step with persisted music settings. Mounted once (App).
 * Volume/mute apply immediately; source/track changes go through the engine's serialized,
 * fade-out-before-start switching, so two BGM sources can never overlap. `context` says
 * whether a conversation is active: menus stay silent, leaving a conversation stops the music.
 */
export function useMusicSync(soundtrack: SoundtrackManifest | null, context: MusicContext): void {
  const scene = context.scene
  const characterId = context.scene === 'conversation' ? context.characterId : ''
  const audition = context.scene === 'menu' && context.audition === true
  const { settings } = useSettings()
  const { override } = useSyncExternalStore(conversationMusicStore.subscribe, conversationMusicStore.getSnapshot)
  const overrideTrackId = scene === 'conversation' ? activeOverrideTrack(override, characterId, soundtrack) : null
  const { musicSource, musicVolume, musicMuted, originalTrackId, importedTrackId, radioVideoId } = settings

  useEffect(() => {
    if (soundtrack) musicRuntime().setSoundtrack(soundtrack)
    conversationMusicStore.setSoundtrack(soundtrack)
  }, [soundtrack])

  // A live track choice lives only as long as this conversation (same scene, same character).
  useEffect(() => {
    const kept = reconcileOverride(conversationMusicStore.getSnapshot().override, scene, characterId)
    conversationMusicStore.setOverride(kept)
  }, [scene, characterId, override])

  useEffect(() => {
    const { engine } = musicRuntime()
    engine.setVolume(musicVolume)
    engine.setMuted(musicMuted)
  }, [musicVolume, musicMuted])

  useEffect(() => {
    const settingsForSync = { musicSource, musicVolume, musicMuted, originalTrackId, importedTrackId, radioVideoId }
    const current: MusicContext = scene === 'conversation' ? { scene, characterId, trackOverride: overrideTrackId } : { scene, audition }
    void syncMusic(musicRuntime().engine, settingsForSync, soundtrack, current)
    // Volume/mute are applied by the effect above; re-syncing on them would be a no-op anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicSource, originalTrackId, importedTrackId, radioVideoId, soundtrack, scene, characterId, audition, overrideTrackId])
}

/** Live engine state for UI (status line, Play-after-blocked button). */
export function useMusicState(): MusicEngineState {
  const { engine } = musicRuntime()
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getState(),
  )
}
