import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { revealSteps } from './unicodeText.ts'

export type TypewriterState = 'waiting' | 'revealing' | 'complete'

/** Base delay per character at speed 1×, in ms. */
const BASE_CHAR_MS = 30

/** Locale timing policy; Latin locales retain their existing whitespace-aware pacing. */
export const PUNCTUATION_TIMING = {
  ja: { sentence: '。！？…', clause: '、，', closers: '」』）】', sentenceMs: 350, clauseMs: 180 },
} as const

/**
 * Extra pause (ms at 1×) after the character at `index`. Punctuation only pauses when it
 * ends a word, so "W-Wait" and "?!" don't stutter; consecutive dots ("...") pause briefly.
 */
export function pauseAfter(text: string, index: number, locale = 'en'): number {
  const char = text[index]
  const next = text[index + 1]
  const policy = locale.split('-')[0] === 'ja' ? PUNCTUATION_TIMING.ja : null
  if (policy) {
    if (policy.sentence.includes(char) && !(policy.sentence + policy.closers).includes(next ?? '\0')) return policy.sentenceMs
    if (policy.closers.includes(char) && /[。！？…][」』）】]*$/.test(text.slice(0, index))
      && !policy.closers.includes(next ?? '\0')) return policy.sentenceMs
    if (policy.clause.includes(char)) return policy.clauseMs
  }
  if (char === '.' && next === '.') return 120
  if (next !== undefined && !/\s/.test(next)) return 0
  if ('.!?…'.includes(char)) return 350
  if (',;:'.includes(char)) return 180
  return 0
}

/** Replies up to this many characters (about two pages) type at the chosen speed. */
const LENGTH_SPEEDUP_FROM = 120
/** Upper bound of the length speed-up, so long replies stay readable. */
const LENGTH_SPEEDUP_MAX = 2

/**
 * Reveal-speed multiplier for a whole reply of `chars` characters: 1 for short replies,
 * growing with the square root of the length beyond that, capped at LENGTH_SPEEDUP_MAX.
 * Long answers therefore take less time per character without short ones feeling rushed.
 */
export function lengthSpeedFactor(chars: number): number {
  if (chars <= LENGTH_SPEEDUP_FROM) return 1
  return Math.min(LENGTH_SPEEDUP_MAX, Math.sqrt(chars / LENGTH_SPEEDUP_FROM))
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
  locale = 'en',
): Typewriter {
  const [progress, setProgress] = useState({ lineKey, count: 0 })
  const count = progress.lineKey === lineKey ? progress.count : 0
  const clusters = useMemo(() => revealSteps(text), [text])
  const onRevealRef = useRef(onReveal)
  useEffect(() => {
    onRevealRef.current = onReveal
  })

  useEffect(() => {
    if (!active || count >= text.length) return
    const factor = 1 / Math.max(speed, 0.1)
    const pause = count > 0 ? pauseAfter(text, count - 1, locale) : 0
    const next = clusters.find((cluster) => cluster.start >= count)
    if (!next) return
    const timer = window.setTimeout(() => {
      setProgress({ lineKey, count: next.end })
      onRevealRef.current?.(next.char)
    }, (BASE_CHAR_MS + pause) * factor)
    return () => window.clearTimeout(timer)
  }, [active, count, text, clusters, lineKey, speed, locale])

  const skip = useCallback(() => setProgress({ lineKey, count: text.length }), [lineKey, text])

  return { state: typewriterStateOf(count, text.length, active), visibleCount: count, skip }
}
