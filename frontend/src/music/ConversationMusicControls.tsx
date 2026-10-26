import type { ReactNode } from 'react'
import type { SoundtrackManifest } from './soundtrack.ts'
import { useConversationMusic, type ConversationMusic } from './useConversationMusic.ts'

export interface ConversationMusicLabels {
  group: string
  prev: string
  next: string
  play: string
  pause: string
  theme: string
  select: string
}

const DEFAULT_LABELS: ConversationMusicLabels = {
  group: 'Conversation music',
  prev: 'Previous track',
  next: 'Next track',
  play: 'Play music',
  pause: 'Pause music',
  theme: 'Return to the character theme',
  select: 'Choose a track',
}

export interface ConversationMusicControlsProps {
  /** Character the conversation is with (soundtrack.json profile key). */
  characterId: string
  soundtrack?: SoundtrackManifest | null
  /** Styling hooks only: the component brings no CSS. State is also exposed as data-* attributes. */
  className?: string
  buttonClassName?: string
  selectClassName?: string
  titleClassName?: string
  /** Replace the default (English) accessible labels, e.g. with translated strings. */
  labels?: Partial<ConversationMusicLabels>
  /** Button contents (default: plain text glyphs). Lets the host use native-asset icons. */
  icons?: Partial<Record<'prev' | 'next' | 'play' | 'pause' | 'theme', ReactNode>>
  /** Show the track picker (default true). */
  showSelect?: boolean
  /** Render nothing when the Settings source is not "Game music" (default true). */
  hideWhenUnavailable?: boolean
  /** Receives the hook state so a host can add its own pieces next to the stock controls. */
  children?: (music: ConversationMusic) => ReactNode
}

/**
 * Minimal, unstyled conversation music controls on top of useConversationMusic.
 * Not mounted by the app yet: the UI owner places it and styles it with native assets.
 */
export function ConversationMusicControls({
  characterId,
  soundtrack,
  className,
  buttonClassName,
  selectClassName,
  titleClassName,
  labels,
  icons,
  showSelect = true,
  hideWhenUnavailable = true,
  children,
}: ConversationMusicControlsProps) {
  const music = useConversationMusic(characterId, soundtrack)
  const text = { ...DEFAULT_LABELS, ...labels }
  if (!music.available && hideWhenUnavailable) return null
  return (
    <div
      className={className}
      role="group"
      aria-label={text.group}
      data-music-playing={music.playing}
      data-music-override={music.isOverride}
      data-music-status={music.status}
    >
      <span className={titleClassName} title={music.title}>{music.shortTitle}</span>
      <button type="button" className={buttonClassName} aria-label={text.prev} disabled={!music.available} onClick={music.prev}>
        {icons?.prev ?? '|<'}
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={music.playing ? text.pause : text.play}
        aria-pressed={music.playing}
        disabled={!music.available}
        onClick={music.toggle}
      >
        {music.playing ? (icons?.pause ?? 'II') : (icons?.play ?? '>')}
      </button>
      <button type="button" className={buttonClassName} aria-label={text.next} disabled={!music.available} onClick={music.next}>
        {icons?.next ?? '>|'}
      </button>
      {showSelect && (
        <select
          className={selectClassName}
          aria-label={text.select}
          value={music.trackId ?? ''}
          disabled={!music.available}
          onChange={(event) => music.select(event.target.value)}
        >
          {music.trackList.map((item) => (
            <option key={item.id} value={item.id} title={item.title}>{item.label}</option>
          ))}
        </select>
      )}
      {music.isOverride && (
        <button type="button" className={buttonClassName} aria-label={text.theme} onClick={music.resetToTheme}>
          {icons?.theme ?? 'Theme'}
        </button>
      )}
      {children?.(music)}
    </div>
  )
}
