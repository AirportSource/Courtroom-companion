import { useCallback, useEffect, useRef, useState } from 'react'

export type TypewriterState = 'waiting' | 'revealing' | 'complete'

/** Base delay per character at speed 1×, in ms. */
const BASE_CHAR_MS = 30

/**
 * Extra pause (ms at 1×) after the character at `index`. Punctuation only pauses when it
 * ends a word, so "W-Wait" and "?!" don't stutter; consecutive dots ("...") pause briefly.
 */
export function pauseAfter(text: string, index: number): number {
  const char = text[index]
  const next = text[index + 1]
  if (char === '.' && next === '.') return 120
  if (next !== undefined && !/\s/.test(next)) return 0
  if ('.!?…'.includes(char)) return 350
  if (',;:'.includes(char)) return 180
  return 0
}

/** State of a line given how many characters are revealed and whether reveal may run. */
export function typewriterStateOf(count: number, length: number, active: boolean): TypewriterState {
  if (count >= length) return 'complete'
  if (!active && count === 0) return 'waiting'
  return 'revealing'
}

export interface Typewriter {
  state: TypewriterState
  visibleCount: number
  /** Reveal the whole line immediately. */
  skip: () => void
}

/**
 * Progressive text reveal for one line. `lineKey` identifies the line instance: a new key
 * restarts from zero. Nothing is revealed until `active` is true (e.g. while a reaction
 * plays). One pending timeout at a time; cleared on any change or unmount.
 * `onReveal` is called once per revealed character (used for blips).
 */
export function useTypewriter(
  text: string,
  lineKey: string,
  active: boolean,
  speed: number,
  onReveal?: (char: string) => void,
): Typewriter {
  const [progress, setProgress] = useState({ lineKey, count: 0 })
  const count = progress.lineKey === lineKey ? progress.count : 0
  const onRevealRef = useRef(onReveal)
  useEffect(() => {
    onRevealRef.current = onReveal
  })

  useEffect(() => {
    if (!active || count >= text.length) return
    const factor = 1 / Math.max(speed, 0.1)
    const pause = count > 0 ? pauseAfter(text, count - 1) : 0
    const timer = window.setTimeout(() => {
      setProgress({ lineKey, count: count + 1 })
      onRevealRef.current?.(text[count])
    }, (BASE_CHAR_MS + pause) * factor)
    return () => window.clearTimeout(timer)
  }, [active, count, text, lineKey, speed])

  const skip = useCallback(() => setProgress({ lineKey, count: text.length }), [lineKey, text])

  return { state: typewriterStateOf(count, text.length, active), visibleCount: count, skip }
}
