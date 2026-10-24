// Pure resolution of logical character state (emotion + talk mode + reaction) to a
// concrete animation clip, with safe fallbacks. No React, no DOM.
import type {
  AnimationClip,
  AnimationId,
  EmotionId,
  LoadedCharacter,
  ReactionId,
  TalkMode,
} from './manifestTypes.ts'

export interface ResolvedClip {
  clip: AnimationClip
  emotion: EmotionId
  animationId: AnimationId | null
  reactionId: ReactionId | null
  /** Which variant is actually playing (may differ from the requested mode on fallback). */
  variant: TalkMode | 'reaction'
  /** Human-readable fallbacks applied, empty when the request resolved exactly. */
  fallbacks: string[]
}

export function resolveEmotion(character: LoadedCharacter, requested: EmotionId): EmotionId {
  if (character.emotions[requested]) return requested
  if (character.emotions[character.fallbackEmotion]) return character.fallbackEmotion
  return character.defaultEmotion
}

function otherMode(mode: TalkMode): TalkMode {
  return mode === 'idle' ? 'talking' : 'idle'
}

export function resolveClip(
  character: LoadedCharacter,
  requestedEmotion: EmotionId,
  mode: TalkMode,
  playReaction: boolean,
): ResolvedClip | null {
  const fallbacks: string[] = []
  const emotion = resolveEmotion(character, requestedEmotion)
  if (emotion !== requestedEmotion) fallbacks.push(`emotion "${requestedEmotion}" → "${emotion}"`)

  const binding = character.emotions[emotion]
  if (playReaction && binding?.reaction) {
    const reaction = character.reactions[binding.reaction]
    if (reaction) {
      return {
        clip: reaction,
        emotion,
        animationId: binding.animation,
        reactionId: binding.reaction,
        variant: 'reaction',
        fallbacks,
      }
    }
  }

  const candidates: AnimationId[] = [binding?.animation]
    .concat(character.emotions[character.fallbackEmotion]?.animation)
    .concat(Object.keys(character.animations))
    .filter((id): id is AnimationId => typeof id === 'string')

  for (const animationId of candidates) {
    const animation = character.animations[animationId]
    if (!animation) continue
    if (animationId !== binding?.animation) fallbacks.push(`animation → "${animationId}"`)
    for (const variant of [mode, otherMode(mode)]) {
      const clip = animation[variant]
      if (!clip) continue
      if (variant !== mode) fallbacks.push(`${mode} unavailable → ${variant}`)
      return { clip, emotion, animationId, reactionId: null, variant, fallbacks }
    }
  }
  return null
}
