import { useEffect } from 'react'
import { MenuList, type MenuItem } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import type { UiImage } from '../engine/manifestTypes.ts'

interface TitleScreenProps {
  /** Original title art from ui.json; the CSS logo is used when absent. */
  titleImage: UiImage | null
  /** Original DS panel behind the main menu (ui.json); CSS gradient fallback when absent. */
  menuBackground: UiImage | null
  /** Whether "press start" was already passed this session (owned by the app). */
  started: boolean
  onPressStart: () => void
  onStart: () => void
  onSettings: () => void
  /** Present when a Court Record manifest loaded. */
  onCourtRecord?: () => void
  /** Development-only entry; omitted in production builds. */
  onAnimationTest?: () => void
}

/**
 * Two phases, mirroring the DS where the title art sits on the top screen and the menu on
 * the touch screen: (1) title art + "press start", (2) main menu. The first interaction is
 * also the user gesture that unlocks browser audio.
 */
export function TitleScreen({
  titleImage,
  menuBackground,
  started,
  onPressStart,
  onStart,
  onSettings,
  onCourtRecord,
  onAnimationTest,
}: TitleScreenProps) {
  const start = () => {
    audioEngine.unlock()
    onPressStart()
  }

  useEffect(() => {
    if (started) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        audioEngine.unlock()
        onPressStart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, onPressStart])

  if (!started) {
    return (
      <PixelStage onClick={start}>
        {titleImage ? (
          <>
            <img
              className="stage-layer"
              src={titleImage.url}
              width={titleImage.width}
              height={titleImage.height}
              style={{ left: 0, top: 0 }}
              alt="Title screen"
              draggable={false}
            />
            {/* Rows 165–180 of the original art are empty black: the prompt sits there. */}
            <p className="title-press-start title-press-start-art">Click or press Enter</p>
          </>
        ) : (
          <div className="title-screen title-screen-plain">
            <TitleLogo />
            <p className="title-press-start">Click or press Enter</p>
          </div>
        )}
      </PixelStage>
    )
  }

  const items: MenuItem[] = [
    { id: 'start', label: 'Start Conversation', sound: 'menu_open' },
    { id: 'settings', label: 'Settings', sound: 'menu_open' },
    ...(onCourtRecord ? [{ id: 'court-record', label: 'Court Record', sound: 'menu_open' as const }] : []),
  ]
  if (onAnimationTest) {
    items.push({ id: 'animation-test', label: 'Asset / Animation Test', dev: true, sound: 'menu_open' })
  }

  const select = (id: string) => {
    if (id === 'start') onStart()
    else if (id === 'settings') onSettings()
    else if (id === 'court-record') onCourtRecord?.()
    else if (id === 'animation-test') onAnimationTest?.()
  }

  return (
    <PixelStage>
      <StageBackdrop image={menuBackground} />
      <div className={menuBackground ? 'title-screen' : 'title-screen title-screen-plain'}>
        <TitleLogo />
        <div className="title-menu">
          <MenuList items={items} onSelect={select} />
        </div>
      </div>
    </PixelStage>
  )
}

function TitleLogo() {
  return (
    <div className="title-logo">
      <span className="title-logo-top">Courtroom</span>
      <span className="title-logo-bottom">Companion</span>
    </div>
  )
}
