import { useCallback, useState, useSyncExternalStore } from 'react'
import { LOFI_GIRL_PRESET } from './presets.ts'
import { radioStatusText } from './radioStatus.ts'
import type { YouTubeRadioSource } from './youtubeRadioSource.ts'
import { PLAYER_HEIGHT, PLAYER_WIDTH } from './youtubeRadioSource.ts'
import { parseYouTubeVideoId } from './youtubeUrl.ts'
import './radio-panel.css'

export interface RadioPanelProps {
  source: YouTubeRadioSource
  videoId: string
  onVideoIdChange(id: string): void
  /** Called from a real user gesture (Play button); the lead starts/resumes the radio. */
  onPlay(): void
  /** Collapses the panel visually; the player element stays mounted. */
  visible: boolean
}

export function RadioPanel({ source, videoId, onVideoIdChange, onPlay, visible }: RadioPanelProps) {
  const state = useSyncExternalStore(source.subscribe, source.getState)
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
  )
  const [draft, setDraft] = useState(videoId)
  const [message, setMessage] = useState<string | null>(null)
  const hostRef = useCallback((el: HTMLDivElement | null) => source.attach(el), [source])

  const apply = () => {
    const id = parseYouTubeVideoId(draft)
    if (!id) {
      setMessage('Not a valid YouTube video URL or 11-character ID.')
      return
    }
    setMessage(null)
    setDraft(id)
    onVideoIdChange(id)
  }
  const reset = () => {
    setMessage(null)
    setDraft(LOFI_GIRL_PRESET.videoId)
    onVideoIdChange(LOFI_GIRL_PRESET.videoId)
  }
  const showPlay = state.status === 'blocked' || state.status === 'paused'

  return (
    <section className="radio-panel" data-collapsed={!visible} aria-label="YouTube radio">
      <div
        ref={hostRef}
        className="radio-panel__player"
        style={{ width: PLAYER_WIDTH, height: PLAYER_HEIGHT }}
      />
      <p className="radio-panel__status" role="status">
        {radioStatusText(state, online)}
      </p>
      {!LOFI_GIRL_PRESET.available && videoId === LOFI_GIRL_PRESET.videoId && (
        <p className="radio-panel__error" role="status">
          Lofi Girl preset unavailable: {LOFI_GIRL_PRESET.unavailableReason} Enter another embeddable video URL or ID.
        </p>
      )}
      {showPlay && (
        <button type="button" className="radio-panel__button" onClick={onPlay}>
          Play
        </button>
      )}
      <form
        className="radio-panel__form"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <label className="radio-panel__label">
          Video URL or ID
          <input
            className="radio-panel__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="radio-panel__button">
          Apply
        </button>
        <button type="button" className="radio-panel__button" onClick={reset} disabled={!LOFI_GIRL_PRESET.available}>
          {LOFI_GIRL_PRESET.available ? 'Reset to Lofi Girl preset' : 'Lofi Girl preset unavailable'}
        </button>
      </form>
      {message && (
        <p className="radio-panel__error" role="alert">
          {message}
        </p>
      )}
      <p className="radio-panel__attribution">Playing via the official YouTube player</p>
    </section>
  )
}
