import { useEffect, useState, type ReactNode } from 'react'
import './App.css'
import { PixelStage } from './components/PixelStage.tsx'
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
import { AnimationTestScreen } from './screens/AnimationTestScreen.tsx'
import { CharacterSelectScreen } from './screens/CharacterSelectScreen.tsx'
import { ConversationScreen } from './screens/ConversationScreen.tsx'
import { LocationSelectScreen } from './screens/LocationSelectScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { TitleScreen } from './screens/TitleScreen.tsx'

const DEV_TOOLS = import.meta.env.DEV

type Screen = 'title' | 'characters' | 'locations' | 'settings' | 'conversation' | 'animation-test'

interface Catalog {
  characters: CharacterSummary[]
  backgrounds: Background[]
  ui: LoadedUi
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

async function loadCatalog(): Promise<Catalog> {
  const [characters, backgrounds, audio, ui] = await Promise.all([
    loadCharacterSummaries(),
    loadBackgrounds(),
    loadAudio(),
    loadAndApplyUi(),
  ])
  audioEngine.register(audio.sounds, audio.events)
  // Fetch menu sounds now; they decode as soon as the first gesture unlocks audio.
  audioEngine.preloadEvents()
  return { characters, backgrounds, ui }
}

function StageMessage({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <PixelStage>
      <p className={error ? 'stage-message stage-message-error' : 'stage-message'}>{text}</p>
    </PixelStage>
  )
}

function App() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [screen, setScreen] = useState<Screen>('title')
  // "Press start" is shown once per session; later returns go straight to the main menu.
  const [titleStarted, setTitleStarted] = useState(false)
  const [characterId, setCharacterId] = useState<CharacterId | null>(null)
  const [backgroundId, setBackgroundId] = useState<BackgroundId | null>(null)
  const [loaded, setLoaded] = useState<Record<CharacterId, LoadedCharacter>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

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
          onExit={toTitle}
          devTools={DEV_TOOLS}
        />
      ))
    case 'animation-test':
      return requireCharacter((c) => (
        <AnimationTestScreen character={c} backgrounds={catalog.backgrounds} onExit={toTitle} />
      ))
  }
}

export default App
