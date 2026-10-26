// Maps Worker D's useConversationMusic (src/music/) onto the strip's ConversationMusicView.
// Playback policy lives entirely in src/music; this file only adapts names and visibility.
import { useConversationMusic } from '../music/useConversationMusic.ts'
import type { ConversationMusicView } from './conversationMusicView.ts'

/** null when the player has nothing to control (source is not Game music, or Off): the tab is hidden. */
export function useConversationMusicView(characterId: string): ConversationMusicView | null {
  const music = useConversationMusic(characterId)
  if (!music.available) return null
  return {
    title: music.shortTitle || music.title,
    // `playing` is true only for the effective track; the engine may be playing another one briefly.
    status: music.playing ? 'playing' : music.status === 'playing' ? 'loading' : music.status,
    overridden: music.isOverride,
    onToggle: music.toggle,
    onPrev: music.prev,
    onNext: music.next,
    onTheme: music.resetToTheme,
    tracks: music.trackList.map(({ id, label, isTheme }) => ({ id, label, isTheme })),
    currentTrackId: music.trackId,
    onSelect: music.select,
  }
}
