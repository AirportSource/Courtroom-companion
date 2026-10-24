import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import { ArtifactPanel } from './artifacts/ArtifactPanel.tsx'
import type { TurnTask } from './artifacts/artifacts.ts'
import { CourtRecordView } from './components/CourtRecordView.tsx'
import { MusicDock } from './components/MusicDock.tsx'
import { PixelStage } from './components/PixelStage.tsx'
import { loadCourtRecord, type LoadedCourtRecord } from './courtRecord/courtRecord.ts'
import { TEST_CONVERSATION } from './dev/testConversation.ts'
import { audioEngine } from './engine/audioEngine.ts'
import {
  loadBackgrounds,
  loadCharacter,
  loadCharacterSummaries,
  loadAudio,
  loadUi,
} from './engine/manifestLoader.ts'
import type {
  Background,
  BackgroundId,
  CharacterId,
  CharacterSummary,
  LoadedCharacter,
  LoadedUi,
} from './engine/manifestTypes.ts'
import { loadSoundtrackManifest, type SoundtrackManifest } from './music/soundtrack.ts'
import { ImportLibraryPanel } from './music/imported/ImportLibraryPanel.tsx'
import { useImportLibrary } from './music/imported/useImportLibrary.ts'
import { musicRuntime, type MusicContext } from './music/musicRuntime.ts'
import { useMusicState, useMusicSync } from './music/useMusicSync.ts'
import { useSettings } from './settings/settings.ts'
import { AnimationTestScreen } from './screens/AnimationTestScreen.tsx'
import { CharacterSelectScreen } from './screens/CharacterSelectScreen.tsx'
import { ConversationScreen } from './screens/ConversationScreen.tsx'
import { LocationSelectScreen } from './screens/LocationSelectScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { TitleScreen } from './screens/TitleScreen.tsx'

const DEV_TOOLS = import.meta.env.DEV

type Screen = 'title' | 'characters' | 'locations' | 'settings' | 'conversation' | 'court-record' | 'animation-test'

interface Catalog {
  characters: CharacterSummary[]
  backgrounds: Background[]
  ui: LoadedUi
  /** Optional: music and the Court Record degrade to "unavailable" instead of blocking the app. */
  soundtrack: SoundtrackManifest | null
  courtRecord: LoadedCourtRecord | null
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & Catalog)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const EMPTY_UI: LoadedUi = { fonts: {}, images: {} }

/** Loads ui.json and applies its dialogue font to the stage via CSS variables.
 * UI assets are optional: on failure the CSS stand-ins and fallback font are used. */
async function loadAndApplyUi(): Promise<LoadedUi> {
  try {
    const ui = await loadUi()
    const font = ui.fonts.dialogue
    if (font) {
      const root = document.documentElement.style
      const bundledStack = [font.family, ...font.fallbackFamilies].map((family) => JSON.stringify(family)).join(', ')
      root.setProperty('--stage-font', `${bundledStack}, var(--stage-font-fallback)`)
      root.setProperty('--stage-font-size', `${font.pixelSize}px`)
      root.setProperty('--stage-letter-spacing', `${font.letterSpacing}px`)
      root.setProperty('--stage-word-spacing', `${font.wordSpacing}px`)
    }
    return ui
  } catch (error) {
    console.warn(`[ui] ${errorMessage(error)}; using CSS stand-ins and the fallback font`)
    return EMPTY_UI
  }
}

/** Optional catalog part: logs and yields null on failure. */
async function optional<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    console.warn(`[${label}] ${errorMessage(error)}`)
    return null
  }
}

async function loadCatalog(): Promise<Catalog> {
  const [characters, backgrounds, audio, ui, soundtrack, courtRecord] = await Promise.all([
    loadCharacterSummaries(),
    loadBackgrounds(),
    loadAudio(),
    loadAndApplyUi(),
    optional('music', () => loadSoundtrackManifest()),
    optional('court-record', async () => {
      const record = await loadCourtRecord()
      for (const warning of record.warnings) console.warn(`[court-record] ${warning}`)
      return record
    }),
  ])
  audioEngine.register(audio.sounds, audio.events)
  // Fetch menu sounds now; they decode as soon as the first gesture unlocks audio.
  audioEngine.preloadEvents()
  return { characters, backgrounds, ui, soundtrack, courtRecord }
}

function StageMessage({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <PixelStage>
      <p className={error ? 'stage-message stage-message-error' : 'stage-message'}>{text}</p>
    </PixelStage>
  )
}

function App() {
  const [artifactTask, setArtifactTask] = useState<TurnTask | null>(null)
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [screen, setScreen] = useState<Screen>('title')
  // "Press start" is shown once per session; later returns go straight to the main menu.
  const [titleStarted, setTitleStarted] = useState(false)
  const [characterId, setCharacterId] = useState<CharacterId | null>(null)
  const [backgroundId, setBackgroundId] = useState<BackgroundId | null>(null)
  const [loaded, setLoaded] = useState<Record<CharacterId, LoadedCharacter>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const soundtrack = catalog.status === 'ready' ? catalog.soundtrack : null
  // Character BGM belongs to the conversation scene only (D-049): menus stay silent unless the
  // user explicitly auditions music from the dock; leaving the scene fades the music out.
  const [auditionScreen, setAuditionScreen] = useState<Screen | null>(null)
  const audition = auditionScreen === screen // ends by itself on the next screen change
  const setAudition = () => setAuditionScreen(screen)
  const musicContext = useMemo<MusicContext>(
    () => (screen === 'conversation' && characterId
      ? { scene: 'conversation', characterId }
      : { scene: 'menu', audition }),
    [screen, characterId, audition],
  )
  useMusicSync(soundtrack, musicContext)
  const { update: updateSettings } = useSettings()
  const pausedForPreview = useRef(false)
  const music = useMusicState()
  const { engine, importApi, importedResolver } = musicRuntime()
  const importLibrary = useImportLibrary({
    api: importApi,
    getContext: () => audioEngine.getContext(),
    // A saved loop or deleted file must not be served from the resolver's short cache.
    onChange: () => importedResolver.invalidate(),
  })

  useEffect(() => {
    let cancelled = false
    loadCatalog().then(
      (result) => {
        if (!cancelled) setCatalog({ status: 'ready', ...result })
      },
      (error: unknown) => {
        if (!cancelled) setCatalog({ status: 'error', message: errorMessage(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Load (once) the full character pack for the current selection.
  useEffect(() => {
    if (catalog.status !== 'ready' || !characterId || loaded[characterId]) return
    const summary = catalog.characters.find((c) => c.id === characterId)
    if (!summary) return
    let cancelled = false
    loadCharacter(summary.manifestUrl).then(
      (character) => {
        if (!cancelled) setLoaded((current) => ({ ...current, [characterId]: character }))
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [catalog, characterId, loaded])

  if (catalog.status === 'loading') return <StageMessage text="Loading…" />
  if (catalog.status === 'error') return <StageMessage text={`Failed to load assets: ${catalog.message}`} error />

  const toTitle = () => setScreen('title')
  const character = characterId ? loaded[characterId] : undefined
  const background = catalog.backgrounds.find((bg) => bg.id === backgroundId) ?? null

  const requireCharacter = (render: (c: LoadedCharacter) => ReactNode) => {
    if (loadError) return <StageMessage text={`Failed to load character: ${loadError}`} error />
    return character ? render(character) : <StageMessage text="Loading character…" />
  }

  return (
    <div className="app-shell">
      <div className="app-shell-screen">{renderScreen()}</div>
      <MusicDock
        soundtrack={soundtrack}
        onAudition={setAudition}
        importPanel={
          <ImportLibraryPanel
            library={importLibrary}
            api={importApi}
            audioContext={audioEngine.getContext()}
            playingId={music.source === 'imported' ? music.trackId : null}
            onPlay={(id) => {
              audioEngine.unlock()
              setAudition()
              updateSettings({ musicSource: 'imported', importedTrackId: id })
            }}
            // A loop preview must never overlap the background music.
            onPreviewChange={(active) => {
              if (active) {
                pausedForPreview.current = engine.getState().status === 'playing'
                engine.pause()
              } else if (pausedForPreview.current) {
                pausedForPreview.current = false
                engine.resume()
              }
            }}
          />
        }
      />
      <ArtifactPanel task={artifactTask} />
    </div>
  )

  function renderScreen(): ReactNode {
  if (catalog.status !== 'ready') return null
  switch (screen) {
    case 'title':
      return (
        <TitleScreen
          titleImage={catalog.ui.images.title_screen ?? null}
          menuBackground={catalog.ui.images.menu_title_discussion ?? null}
          started={titleStarted}
          onPressStart={() => setTitleStarted(true)}
          onStart={() => setScreen('characters')}
          onSettings={() => setScreen('settings')}
          onCourtRecord={catalog.courtRecord ? () => setScreen('court-record') : undefined}
          onAnimationTest={
            DEV_TOOLS
              ? () => {
                  setCharacterId((id) => id ?? catalog.characters[0]?.id ?? null)
                  setScreen('animation-test')
                }
              : undefined
          }
        />
      )
    case 'characters':
      return (
        <CharacterSelectScreen
          characters={catalog.characters}
          selectedId={characterId}
          onSelect={(id) => {
            setLoadError(null)
            setCharacterId(id)
            setScreen('locations')
          }}
          onBack={toTitle}
          backdrop={catalog.ui.images.menu_talk_option ?? null}
        />
      )
    case 'locations':
      return (
        <LocationSelectScreen
          backgrounds={catalog.backgrounds}
          selectedId={backgroundId}
          onSelect={(id) => {
            setBackgroundId(id)
            setScreen('conversation')
          }}
          onBack={() => setScreen('characters')}
        />
      )
    case 'settings':
      return (
        <SettingsScreen
          previewBlip={audioEngine.getSounds('blip')[0]?.id ?? null}
          testCharacterId={catalog.characters[0]?.id ?? null}
          soundtrack={catalog.soundtrack}
          importedTracks={importLibrary.tracks.filter((track) => track.available)}
          onBack={toTitle}
          backdrop={catalog.ui.images.menu_bottom_screen ?? null}
        />
      )
    case 'conversation':
      return requireCharacter((c) => (
        <ConversationScreen
          key={c.id}
          character={c}
          background={background}
          testScript={TEST_CONVERSATION}
          courtRecord={catalog.courtRecord}
          talkBackdrop={catalog.ui.images.menu_talk_option ?? null}
          onExit={toTitle}
          devTools={DEV_TOOLS}
          onTaskChange={setArtifactTask}
        />
      ))
    case 'court-record':
      return catalog.courtRecord ? (
        <PixelStage>
          <CourtRecordView record={catalog.courtRecord} onClose={toTitle} backdrop={catalog.ui.images.menu_bottom_screen ?? null} />
        </PixelStage>
      ) : null
    case 'animation-test':
      return requireCharacter((c) => (
        <AnimationTestScreen character={c} backgrounds={catalog.backgrounds} onExit={toTitle} />
      ))
  }
  }
}

export default App
