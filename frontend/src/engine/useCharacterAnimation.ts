import { useState } from 'react'
import { resolveClip, resolveEmotion, type ResolvedClip } from './characterResolver.ts'
import type { EmotionId, LoadedCharacter, SpriteFrame, TalkMode } from './manifestTypes.ts'
import { useClipPlayback } from './useClipPlayback.ts'

export interface CharacterAnimationState {
  resolved: ResolvedClip | null
  frame: SpriteFrame | null
  frameIndex: number
}

export interface ReactionGate {
  /** True while the emotion's one-shot reaction for this play has not finished yet. */
  pending: boolean
  playKey: string
  complete: () => void
}

/**
 * Tracks whether the current emotion's reaction still has to play. Each distinct `playKey`
 * (a new dialogue line, a new emotion selection) plays the reaction once. Exposed separately
 * so callers such as the dialogue engine can wait for a reaction before revealing text.
 */
export function useReactionGate(
  character: LoadedCharacter,
  emotion: EmotionId,
  playKey: string,
): ReactionGate {
  const [doneKey, setDoneKey] = useState<string | null>(null)
  const binding = character.emotions[resolveEmotion(character, emotion)]
  const hasReaction = Boolean(binding?.reaction && character.reactions[binding.reaction])
  return {
    pending: hasReaction && doneKey !== playKey,
    playKey,
    complete: () => setDoneKey(playKey),
  }
}

/**
 * Plays a character: resolves emotion + talk mode (+ pending reaction) to a clip and runs it.
 * After a reaction completes, the emotion's stable loop takes over in the current mode.
 */
export function useCharacterPlayback(
  character: LoadedCharacter,
  emotion: EmotionId,
  mode: TalkMode,
  gate: ReactionGate,
): CharacterAnimationState {
  const resolved = resolveClip(character, emotion, mode, gate.pending)
  const clip = resolved?.clip ?? null
  // Reactions restart on every new play; stable loops keep running across replays.
  const restartKey = resolved?.variant === 'reaction' ? gate.playKey : ''
  const frameIndex = useClipPlayback(clip, restartKey, () => {
    if (resolved?.variant === 'reaction') gate.complete()
  })

  return {
    resolved,
    frame: clip ? (clip.frames[frameIndex] ?? clip.frames[0]) : null,
    frameIndex,
  }
}

/**
 * Convenience for callers that drive a character directly (e.g. the animation test screen):
 * a reaction replays every time `playId` changes.
 */
export function useCharacterAnimation(
  character: LoadedCharacter,
  emotion: EmotionId,
  mode: TalkMode,
  playId: number,
): CharacterAnimationState {
  const gate = useReactionGate(character, emotion, `${character.id}:${emotion}:${playId}`)
  return useCharacterPlayback(character, emotion, mode, gate)
}
