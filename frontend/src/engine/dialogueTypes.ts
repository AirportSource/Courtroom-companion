import type { CharacterId, EmotionId, SoundId } from './manifestTypes.ts'

/** One line of scripted (later: LLM-produced) dialogue. Purely logical IDs, no asset paths. */
export interface DialogueLine {
  /** Speaking character; omitted = the scene's active character. */
  speaker?: CharacterId
  emotion: EmotionId
  text: string
  /** Optional blip override for this line (a sound id from audio.json). */
  voice?: SoundId
}
