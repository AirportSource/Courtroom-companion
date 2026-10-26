// Tiny external store for the conversation's live music override and the loaded soundtrack manifest.
// Not persisted (see conversationMusic.ts for the scope). Kept outside React so useMusicSync (App),
// useConversationMusic (conversation UI) and tests share one source of truth.
import type { TrackOverride } from './conversationMusic.ts'
import type { SoundtrackManifest } from './soundtrack.ts'

export interface ConversationMusicSnapshot {
  override: TrackOverride | null
  soundtrack: SoundtrackManifest | null
}

let snapshot: ConversationMusicSnapshot = { override: null, soundtrack: null }
const listeners = new Set<() => void>()

function publish(next: ConversationMusicSnapshot): void {
  snapshot = next
  for (const listener of [...listeners]) listener()
}

export const conversationMusicStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: (): ConversationMusicSnapshot => snapshot,
  setOverride(override: TrackOverride | null): void {
    const a = snapshot.override
    if (a === override || (a && override && a.characterId === override.characterId && a.trackId === override.trackId)) return
    publish({ ...snapshot, override })
  },
  setSoundtrack(soundtrack: SoundtrackManifest | null): void {
    if (snapshot.soundtrack !== soundtrack) publish({ ...snapshot, soundtrack })
  },
  /** Test helper. */
  reset(): void {
    publish({ override: null, soundtrack: null })
  },
}
