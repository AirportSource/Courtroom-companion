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

/**
 * Optional explicit performance for one line (e.g. from the Character Director): a specific
 * animation for the stable pose and an explicit reaction (null = none). Unknown IDs fall back
 * to the emotion's own binding.
 */
export interface PerformanceOverride {
  animation?: AnimationId
  reaction?: ReactionId | null
}

/** The reaction a line should play: explicit override if given, else the emotion's binding. */
export function resolveReactionId(
  character: LoadedCharacter,
  emotion: EmotionId,
  override?: PerformanceOverride,
): ReactionId | null {
  const requested =
    override && 'reaction' in override
      ? override.reaction
      : character.emotions[resolveEmotion(character, emotion)]?.reaction
  return requested && character.reactions[requested] ? requested : null
}

function otherMode(mode: TalkMode): TalkMode {
  return mode === 'idle' ? 'talking' : 'idle'
}

export function resolveClip(
  character: LoadedCharacter,
  requestedEmotion: EmotionId,
  mode: TalkMode,
  playReaction: boolean,
  override?: PerformanceOverride,
): ResolvedClip | null {
  const fallbacks: string[] = []
  const emotion = resolveEmotion(character, requestedEmotion)
  if (emotion !== requestedEmotion) fallbacks.push(`emotion "${requestedEmotion}" → "${emotion}"`)

  const binding = character.emotions[emotion]
  let stableAnimation = binding?.animation
  if (override?.animation) {
    if (character.animations[override.animation]) stableAnimation = override.animation
    else fallbacks.push(`animation "${override.animation}" unavailable → emotion default`)
  }

  const reactionId = resolveReactionId(character, emotion, override)
  if (playReaction && reactionId) {
    return {
      clip: character.reactions[reactionId],
      emotion,
      animationId: stableAnimation ?? null,
      reactionId,
      variant: 'reaction',
      fallbacks,
    }
  }

  const candidates: AnimationId[] = [stableAnimation]
    .concat(binding?.animation)
    .concat(character.emotions[character.fallbackEmotion]?.animation)
    .concat(Object.keys(character.animations))
    .filter((id): id is AnimationId => typeof id === 'string')

  for (const animationId of candidates) {
    const animation = character.animations[animationId]
    if (!animation) continue
    if (animationId !== stableAnimation) fallbacks.push(`animation → "${animationId}"`)
    for (const variant of [mode, otherMode(mode)]) {
      const clip = animation[variant]
      if (!clip) continue
      if (variant !== mode) fallbacks.push(`${mode} unavailable → ${variant}`)
      return { clip, emotion, animationId, reactionId: null, variant, fallbacks }
    }
  }
  return null
}
