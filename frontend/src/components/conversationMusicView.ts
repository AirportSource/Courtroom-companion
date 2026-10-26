/**
 * What the in-stage conversation music strip needs (D-079). Engine-free and presentation-only:
 * the data/actions come from an adapter (conversationMusicAdapter.ts today; Worker D's
 * `useConversationMusic` when it lands). A missing handler renders its button disabled.
 */
export type ConversationMusicStatus = 'playing' | 'paused' | 'loading' | 'blocked' | 'idle' | 'error'

export interface ConversationMusicView {
  /** Short track title; scrolls inside the strip when long (D-032). */
  title: string
  status: ConversationMusicStatus
  /** The listener chose a track instead of the character's theme (enables the "theme" reset). */
  overridden?: boolean
  onToggle?: () => void
  onPrev?: () => void
  onNext?: () => void
  onTheme?: () => void
  /** Every selectable track, in player order, for the track-list menu. */
  tracks?: ConversationMusicTrack[]
  /** The track that should be playing now (highlighted in the list). */
  currentTrackId?: string | null
  /** Jump straight to a track (same override policy as next/prev). */
  onSelect?: (trackId: string) => void
}

export interface ConversationMusicTrack {
  id: string
  /** Short name with the game suffix, for a list that mixes games. */
  label: string
  /** The current character's theme (starred in the list). */
  isTheme: boolean
}

/** Play shows while stopped/blocked/loading-failed; Pause only while audible or loading. */
export function showsPause(status: ConversationMusicStatus): boolean {
  return status === 'playing' || status === 'loading'
}

export type MusicControl = 'prev' | 'toggle' | 'next' | 'theme' | 'list'

/** Which controls are usable right now (a control without a handler is disabled). */
export function enabledControls(view: ConversationMusicView): Record<MusicControl, boolean> {
  return {
    prev: Boolean(view.onPrev),
    toggle: Boolean(view.onToggle),
    next: Boolean(view.onNext),
    theme: Boolean(view.onTheme) && view.overridden === true,
    // A list is only worth opening with something to choose between.
    list: Boolean(view.onSelect) && (view.tracks?.length ?? 0) > 1,
  }
}
