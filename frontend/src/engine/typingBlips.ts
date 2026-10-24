// Blips for the player's own typing (pure; the sound itself is the audio.json event passed in).
// Only text-producing input blips: modifiers, arrows, Home/End, F-keys, Tab, Escape, paste and
// deletions never reach here because they are not `insertText` input events. IME composition is
// silent until it commits (one blip at compositionend). Never reads or alters the input value.
import { isBlipChar } from './useBlips.ts'

/** Never faster than this, so a held key or fast typing can't overlap blips into a buzz. */
export const TYPING_BLIP_MIN_GAP_MS = 60

export interface TypingInput {
  inputType: string
  data: string | null
  isComposing: boolean
}

export interface TypingBlipConfig {
  volume: number
  muted: boolean
}

/** True when this input event is a typed visible character (not whitespace/punctuation). */
export function isTypedBlip(input: TypingInput): boolean {
  if (input.isComposing || input.inputType !== 'insertText' || !input.data) return false
  return [...input.data].some(isBlipChar)
}

/** True when a finished IME composition committed at least one voiced character. */
export function isCommittedBlip(data: string | null | undefined): boolean {
  return !!data && [...data].some(isBlipChar)
}

export interface TypingBlipper {
  onInput(input: TypingInput, config: TypingBlipConfig): boolean
  onCompositionEnd(data: string | null | undefined, config: TypingBlipConfig): boolean
}

/** Throttled player. `play` is e.g. `(v) => audioEngine.playEvent('user_typing', v)`. */
export function createTypingBlipper(
  play: (volume: number) => void,
  now: () => number = () => performance.now(),
  minGapMs: number = TYPING_BLIP_MIN_GAP_MS,
): TypingBlipper {
  let last = -Infinity
  const fire = (config: TypingBlipConfig): boolean => {
    if (config.muted || !(config.volume > 0)) return false
    const t = now()
    if (t - last < minGapMs) return false
    last = t
    play(config.volume)
    return true
  }
  return {
    onInput: (input, config) => isTypedBlip(input) && fire(config),
    onCompositionEnd: (data, config) => isCommittedBlip(data) && fire(config),
  }
}
