import { useEffect, useSyncExternalStore } from 'react'
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
  const { musicSource, musicVolume, musicMuted, originalTrackId, importedTrackId, radioVideoId } = settings

  useEffect(() => {
    if (soundtrack) musicRuntime().setSoundtrack(soundtrack)
  }, [soundtrack])

  useEffect(() => {
    const { engine } = musicRuntime()
    engine.setVolume(musicVolume)
    engine.setMuted(musicMuted)
  }, [musicVolume, musicMuted])

  useEffect(() => {
    const settingsForSync = { musicSource, musicVolume, musicMuted, originalTrackId, importedTrackId, radioVideoId }
    const current: MusicContext = scene === 'conversation' ? { scene, characterId } : { scene, audition }
    void syncMusic(musicRuntime().engine, settingsForSync, soundtrack, current)
    // Volume/mute are applied by the effect above; re-syncing on them would be a no-op anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicSource, originalTrackId, importedTrackId, radioVideoId, soundtrack, scene, characterId, audition])
}

/** Live engine state for UI (status line, Play-after-blocked button). */
export function useMusicState(): MusicEngineState {
  const { engine } = musicRuntime()
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getState(),
  )
}
