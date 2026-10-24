import type { AnimationId, CharacterId, EmotionId, ReactionId, SoundId } from './manifestTypes.ts'
import type { SfxName } from './performance.ts'

/** One line of scripted (later: LLM-produced) dialogue. Purely logical IDs, no asset paths. */
export interface DialogueLine {
  /** Speaking character; omitted = the scene's active character. */
  speaker?: CharacterId
  emotion: EmotionId
  text: string
  /** Optional blip override for this line (a sound id from audio.json). */
  voice?: SoundId
  /** Optional explicit stable pose (logical animation id), e.g. chosen by the Character Director. */
  animation?: AnimationId
  /** Optional explicit one-shot reaction; null = none. Omitted = the emotion's own binding. */
  reaction?: ReactionId | null
  /** Semantic reaction sound (closed set); only ever set on a segment's first page. */
  sfx?: SfxName | null
}
