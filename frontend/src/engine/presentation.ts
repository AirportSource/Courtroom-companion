// Conversation presentation state: a tiny pure state machine plus the character's data-driven
// "waiting" pose. No React, no DOM, no provider knowledge, so it is trivially testable.
import { resolveEmotion } from './characterResolver.ts'
import type { PerformanceOverride } from './characterResolver.ts'
import type { AnimationId, EmotionId, LoadedCharacter } from './manifestTypes.ts'

export type Phase = 'input' | 'waiting' | 'performing'
export type PresentationState = 'idle' | 'waiting' | 'performing'
/**
 * submit   - the user sent a message
 * response - a playable reply arrived
 * error    - the request failed (the error line is performed like a reply, or input is restored)
 * cancel   - the request was abandoned (timeout, abort, leaving the screen)
 * finished - the last dialogue page was dismissed
 */
export type PhaseEvent = 'submit' | 'response' | 'error' | 'cancel' | 'finished'

/** Never returns a state that cannot be left: waiting always ends on response/error/cancel. */
export function nextPhase(phase: Phase, event: PhaseEvent): Phase {
  switch (event) {
    case 'submit':
      return phase === 'input' ? 'waiting' : phase
    case 'response':
      return phase === 'waiting' ? 'performing' : phase
    case 'error':
      // A failed request still gets the character's error line, performed like any reply.
      return phase === 'waiting' ? 'performing' : phase
    case 'cancel':
      return phase === 'waiting' ? 'input' : phase
    case 'finished':
      return phase === 'performing' ? 'input' : phase
  }
}

export function presentationState(phase: Phase): PresentationState {
  return phase === 'input' ? 'idle' : phase
}

export interface WaitingPerformance {
  emotion: EmotionId
  animation: AnimationId
}

/** Parses a character.json `waiting` block; anything invalid falls back to the default emotion. */
export function readWaiting(
  raw: unknown,
  emotions: Record<EmotionId, { animation: AnimationId }>,
  animations: Record<AnimationId, unknown>,
  defaultEmotion: EmotionId,
): WaitingPerformance | null {
  if (typeof raw !== 'object' || raw === null) return null
  const block = raw as Record<string, unknown>
  const emotion = typeof block.emotion === 'string' && emotions[block.emotion] ? block.emotion : defaultEmotion
  const animation =
    typeof block.animation === 'string' && animations[block.animation] ? block.animation : emotions[emotion]?.animation
  return animation ? { emotion, animation } : null
}

/** What the character does while waiting: its own `waiting` block, else the default emotion. */
export function waitingPerformance(character: LoadedCharacter): WaitingPerformance {
  if (character.waiting) return character.waiting
  const emotion = resolveEmotion(character, character.defaultEmotion)
  return { emotion, animation: character.emotions[emotion]?.animation ?? '' }
}

/** The idle (never talking, never a reaction) override for `waitingPerformance`. */
export function waitingOverride(character: LoadedCharacter): PerformanceOverride {
  const { animation } = waitingPerformance(character)
  return { animation, reaction: null }
}
