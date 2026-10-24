// Application wiring for music (lead-owned): ONE MusicEngine with the three sources, plus
// the pure mapping from persisted settings to an engine request. Screens never talk to a
// source directly; settings changes and user gestures go through `syncMusic` / the engine.
import { audioEngine } from '../engine/audioEngine.ts'
import type { Settings } from '../settings/settings.ts'
import { createImportApi, type ImportApi } from './imported/importApi.ts'
import { createImportedResolver, type ImportedResolver } from './imported/importedResolver.ts'
import { MusicEngine } from './MusicEngine.ts'
import { DEFAULT_RADIO_VIDEO_ID } from './radio/presets.ts'
import { createYouTubeRadioSource, type YouTubeRadioSource } from './radio/youtubeRadioSource.ts'
import { createOriginalTrackResolver, resolveProfileTrack, type SoundtrackManifest } from './soundtrack.ts'
import type { MusicSourceKind } from './types.ts'
import { createDefaultWebAudioDeps } from './webAudioDeps.ts'
import { createWebAudioSource, type TrackResolver } from './webAudioSource.ts'

export type MusicSettings = Pick<Settings,
  'musicSource' | 'musicVolume' | 'musicMuted' | 'originalTrackId' | 'importedTrackId' | 'radioVideoId'>

export type MusicRequest = { kind: 'off' } | { kind: MusicSourceKind; trackId: string | null }

/**
 * Where the app is, as far as music cares. Character BGM belongs to conversations only.
 * `audition` (menu only) means the player pressed Play on a track in the music dock, so the
 * selected source plays even outside a conversation.
 */
export type MusicContext = { scene: 'menu'; audition?: boolean } | { scene: 'conversation'; characterId: string }

/** Soundtrack profile that menu screens may play (absent today: menus are silent). */
export const MENU_PROFILE = 'menu'

/**
 * Settings + scene → desired engine request (pure). The soundtrack profile supplies the default
 * original track (per character, then `default`); nothing here names a character or a file.
 */
export function musicRequestFor(
  settings: MusicSettings,
  manifest: SoundtrackManifest | null,
  context: MusicContext = { scene: 'conversation', characterId: '' },
): MusicRequest {
  if (settings.musicSource === 'off') return { kind: 'off' }
  if (context.scene === 'menu' && !context.audition) {
    const menu = manifest?.profiles[MENU_PROFILE]
    if (settings.musicSource === 'original' && menu && manifest.tracks[menu.defaultTrack]?.src) {
      return { kind: 'original', trackId: menu.defaultTrack }
    }
    return { kind: 'off' }
  }
  switch (settings.musicSource) {
    case 'original': {
      const chosen = settings.originalTrackId
      const valid = manifest && chosen && manifest.tracks[chosen]?.src ? chosen : null
      const profile = context.scene === 'conversation' && context.characterId ? context.characterId : null
      return { kind: 'original', trackId: valid ?? (manifest ? resolveProfileTrack(manifest, profile) : null) }
    }
    case 'imported':
      return { kind: 'imported', trackId: settings.importedTrackId || null }
    case 'radio':
      return { kind: 'radio', trackId: settings.radioVideoId || DEFAULT_RADIO_VIDEO_ID }
  }
}

export interface MusicRuntime {
  engine: MusicEngine
  radio: YouTubeRadioSource
  importApi: ImportApi
  importedResolver: ImportedResolver
  setSoundtrack(manifest: SoundtrackManifest): void
  dispose(): void
}

/** Resolver that defers to whichever resolver is installed later (manifest/library load async). */
function deferredResolver(): { resolver: TrackResolver; install(next: TrackResolver): void } {
  let current: TrackResolver | null = null
  return {
    resolver: { resolve: (id, signal) => (current ? current.resolve(id, signal) : Promise.resolve(null)) },
    install: (next) => {
      current = next
    },
  }
}

function createMusicRuntime(): MusicRuntime {
  const deps = createDefaultWebAudioDeps()
  const original = deferredResolver()
  const importApi = createImportApi()
  const importedResolver = createImportedResolver(importApi)
  const engine = new MusicEngine()
  const radio = createYouTubeRadioSource()
  engine.registerSource(createWebAudioSource('original', original.resolver, deps))
  engine.registerSource(createWebAudioSource('imported', importedResolver, deps))
  engine.registerSource(radio)
  // Music requested before the first gesture reports 'blocked'; replay it once audio unlocks.
  const offUnlock = audioEngine.onUnlock(() => void engine.retry())
  return {
    engine,
    radio,
    importApi,
    importedResolver,
    setSoundtrack: (manifest) => original.install(createOriginalTrackResolver(manifest)),
    dispose: () => {
      offUnlock()
      engine.dispose()
    },
  }
}

let runtime: MusicRuntime | null = null

/** The app-wide music runtime (created lazily on first use; no audio work at import time). */
export function musicRuntime(): MusicRuntime {
  if (!runtime) {
    runtime = createMusicRuntime()
    // Dev-only inspection hook, like window.__ccAudio (stripped from production builds).
    if (import.meta.env?.DEV) Object.assign(window, { __ccMusic: runtime })
  }
  return runtime
}

// Dev hot reload re-evaluates this module: dispose the old engine so it can never stay audible.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    runtime?.dispose()
    runtime = null
  })
}

/** Apply settings to the engine. Same track already playing is not restarted (engine rule). */
export function syncMusic(
  engine: MusicEngine,
  settings: MusicSettings,
  manifest: SoundtrackManifest | null,
  context: MusicContext = { scene: 'conversation', characterId: '' },
): Promise<void> {
  engine.setVolume(settings.musicVolume)
  engine.setMuted(settings.musicMuted)
  const request = musicRequestFor(settings, manifest, context)
  if (request.kind === 'off') return engine.switchSource('off')
  if (request.trackId === null) return engine.stop(false, request.kind)
  return engine.play(request.kind, request.trackId)
}
