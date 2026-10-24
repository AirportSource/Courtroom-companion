import { useCallback, useEffect, useRef, useState } from 'react'
import { MenuList, type MenuItem } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import type { UiImage } from '../engine/manifestTypes.ts'
import { useT } from '../i18n/useT.ts'
import { ExclamationBubble } from '../events/ExclamationBubble.tsx'
import { isJapaneseVoice, preloadExclamations } from '../events/exclamations.ts'
import { allShouts, pickShout } from '../engine/voices.ts'
import { useSettings } from '../settings/settings.ts'

/** The last title shout, so the next session opens with a different voice (D-068). */
const LAST_SHOUT_KEY = 'courtroom-companion.last-title-shout'
const readLastShout = (): string | null => { try { return localStorage.getItem(LAST_SHOUT_KEY) } catch { return null } }
const writeLastShout = (sound: string): void => { try { localStorage.setItem(LAST_SHOUT_KEY, sound) } catch { /* private mode */ } }
/** The title art freezes under the Objection bubble, then fades to black, then the menu fades in. */
export const TITLE_FREEZE_MS = 1000
export const TITLE_FADE_MS = 450

interface TitleScreenProps {
  /** Original title art from ui.json; the CSS logo is used when absent. */
  titleImage: UiImage | null
  /** Original DS panel behind the main menu (ui.json); CSS gradient fallback when absent. */
  menuBackground: UiImage | null
  /** Original Objection bubble (ui.json exclamation_objection) shown during the intro shout. */
  objectionImage?: UiImage | null
  /** Japanese bubble 「異議あり！」, shown when the drawn shout is a Japanese voice (D-070). */
  objectionImageJa?: UiImage | null
  /** Whether "press start" was already passed this session (owned by the app). */
  started: boolean
  onPressStart: () => void
  onStart: () => void
  onSettings: () => void
  /** Present when a Court Record manifest loaded. */
  onCourtRecord?: () => void
  onConversationRecord?: () => void
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
  objectionImage = null,
  objectionImageJa = null,
  started,
  onPressStart,
  onStart,
  onSettings,
  onCourtRecord,
  onConversationRecord,
  onAnimationTest,
}: TitleScreenProps) {
  const t = useT()
  const { settings } = useSettings()
  // Intro after "press start": a random voiced "Igiari!" with the bubble (title art frozen), a fade
  // to black, then the menu fades in. Falls back to the plain Objection SFX without voice files.
  const [intro, setIntro] = useState<'idle' | 'shout' | 'fade'>('idle')
  const [japaneseShout, setJapaneseShout] = useState(false)
  const introStarted = useRef(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])
  useEffect(() => {
    if (started) return
    audioEngine.preload(allShouts('objection'))
    preloadExclamations([objectionImage, objectionImageJa])
  }, [started, objectionImage, objectionImageJa])

  const start = useCallback(() => {
    if (introStarted.current) return
    introStarted.current = true
    audioEngine.unlock()
    // Every installed "Objection!" (English and Japanese, all speakers), never twice in a row.
    const shout = pickShout(allShouts('objection'), readLastShout())
    if (shout) writeLastShout(shout)
    setJapaneseShout(isJapaneseVoice(shout))
    if (!settings.sfxMuted) {
      // First gesture of the session: the context is only now resuming, so wait for it.
      if (shout) void audioEngine.playWhenReady(shout, settings.sfxVolume)
      else void audioEngine.playEventWhenReady('exclamation_objection', settings.sfxVolume)
    }
    setIntro('shout')
    timers.current.push(window.setTimeout(() => setIntro('fade'), TITLE_FREEZE_MS))
    timers.current.push(window.setTimeout(onPressStart, TITLE_FREEZE_MS + TITLE_FADE_MS))
  }, [settings.sfxMuted, settings.sfxVolume, onPressStart])

  useEffect(() => {
    if (started) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, start])

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
              alt={t('title.alt')}
              draggable={false}
            />
            {/* Rows 165–180 of the original art are empty black: the prompt sits there. */}
            {intro === 'idle' && <p className="title-press-start title-press-start-art">{t('title.pressStart')}</p>}
          </>
        ) : (
          <div className="title-screen title-screen-plain">
            <TitleLogo />
            {intro === 'idle' && <p className="title-press-start">{t('title.pressStart')}</p>}
          </div>
        )}
        {intro !== 'idle' && <ExclamationBubble kind="objection"
          image={(japaneseShout ? objectionImageJa : null) ?? objectionImage} />}
        {intro === 'fade' && <div className="stage-fade stage-fade-out" style={{ animationDuration: `${TITLE_FADE_MS}ms` }} />}
      </PixelStage>
    )
  }

  const items: MenuItem[] = [
    { id: 'start', label: t('title.start'), sound: 'menu_open' },
    { id: 'settings', label: t('title.settings'), sound: 'menu_open' },
    ...(onCourtRecord ? [{ id: 'court-record', label: t('title.courtRecord'), sound: 'menu_open' as const }] : []),
    ...(onConversationRecord ? [{ id: 'conversation-record', label: t('title.conversationRecord'), sound: 'menu_open' as const }] : []),
  ]
  if (onAnimationTest) {
    items.push({ id: 'animation-test', label: t('title.animationTest'), dev: true, sound: 'menu_open' })
  }

  const select = (id: string) => {
    if (id === 'start') onStart()
    else if (id === 'settings') onSettings()
    else if (id === 'court-record') onCourtRecord?.()
    else if (id === 'conversation-record') onConversationRecord?.()
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
      {intro === 'fade' && <div className="stage-fade stage-fade-in" style={{ animationDuration: `${TITLE_FADE_MS}ms` }} />}
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
