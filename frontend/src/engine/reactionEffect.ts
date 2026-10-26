// One-shot reaction effects (D-091): a stage overlay animation, an optional full-stage backdrop
// (e.g. black that fades back to the scene) and sound cues declared on a reaction in
// character.json (`effect`), timed from the moment the reaction starts. One pure schedule and one
// timer chain per play, so sounds stay tied to the effect's frames instead of timers scattered
// through components.
import { useEffect, useRef, useState } from 'react'
import type { ReactionEffect, SpriteFrame } from './manifestTypes.ts'

export type BackdropState = 'on' | 'fade' | 'off'

export type EffectStep =
  | { atMs: number; kind: 'cue'; event: string }
  | { atMs: number; kind: 'overlay'; frame: number | null }
  | { atMs: number; kind: 'backdrop'; state: BackdropState }

const KIND_ORDER = { cue: 0, backdrop: 1, overlay: 2 } as const

/** Every step of an effect, sorted by time; the last overlay / backdrop steps clear them. */
export function effectSchedule(effect: ReactionEffect): EffectStep[] {
  const steps: EffectStep[] = effect.cues.map((cue) => ({ atMs: cue.atMs, kind: 'cue', event: cue.event }))
  const overlay = effect.overlay
  if (overlay && overlay.frames.length > 0) {
    let at = effect.overlayStartMs
    overlay.frames.forEach((frame, index) => {
      steps.push({ atMs: at, kind: 'overlay', frame: index })
      at += frame.durationMs ?? 1000 / overlay.fps
    })
    steps.push({ atMs: at, kind: 'overlay', frame: null })
  }
  const backdrop = effect.backdrop
  if (backdrop) {
    steps.push({ atMs: 0, kind: 'backdrop', state: 'on' })
    steps.push({ atMs: backdrop.fadeStartMs, kind: 'backdrop', state: 'fade' })
    steps.push({ atMs: backdrop.fadeStartMs + backdrop.fadeMs, kind: 'backdrop', state: 'off' })
  }
  // Stable: at equal times cues fire first, then the backdrop, then the overlay changes.
  return steps
    .map((step, order) => ({ step, order }))
    .sort((a, b) => a.step.atMs - b.step.atMs || KIND_ORDER[a.step.kind] - KIND_ORDER[b.step.kind] || a.order - b.order)
    .map(({ step }) => step)
}

/** Total length of an effect: its last step. */
export function effectDurationMs(effect: ReactionEffect): number {
  return effectSchedule(effect).reduce((end, step) => Math.max(end, step.atMs), 0)
}

export interface ReactionEffectView {
  /** Overlay frame on screen, or null. */
  frame: SpriteFrame | null
  /** Backdrop layer: opaque ('on'), fading out over `fadeMs` ('fade'), or null when gone. */
  backdrop: { color: string; state: 'on' | 'fade'; fadeMs: number } | null
}

const NOTHING: ReactionEffectView = { frame: null, backdrop: null }

/**
 * Runs `effect` once per `playKey` (null = not playing). Cues call `onCue(event)`. Changing the
 * key, the effect or unmounting cancels pending steps and clears overlay and backdrop, so nothing
 * outlives its play.
 */
export function useReactionEffect(
  effect: ReactionEffect | undefined,
  playKey: string | null,
  onCue: (event: string) => void,
): ReactionEffectView {
  const [shown, setShown] = useState<{ key: string; frame: number | null; backdrop: BackdropState } | null>(null)
  const onCueRef = useRef(onCue)
  useEffect(() => {
    onCueRef.current = onCue
  })

  useEffect(() => {
    if (!effect || playKey === null) return
    const steps = effectSchedule(effect)
    const started = performance.now()
    let next = 0
    let timer = 0
    let frame: number | null = null
    let backdrop: BackdropState = 'off'
    const run = () => {
      const elapsed = performance.now() - started
      let changed = false
      while (next < steps.length && steps[next].atMs <= elapsed + 1) {
        const step = steps[next++]
        if (step.kind === 'cue') onCueRef.current(step.event)
        else if (step.kind === 'overlay') { frame = step.frame; changed = true }
        else { backdrop = step.state; changed = true }
      }
      if (changed) setShown(frame === null && backdrop === 'off' ? null : { key: playKey, frame, backdrop })
      if (next < steps.length) timer = window.setTimeout(run, Math.max(0, steps[next].atMs - (performance.now() - started)))
    }
    run()
    return () => {
      window.clearTimeout(timer)
      setShown(null)
    }
  }, [effect, playKey])

  if (!effect || !shown || shown.key !== playKey) return NOTHING
  return {
    frame: shown.frame === null ? null : (effect.overlay?.frames[shown.frame] ?? null),
    backdrop: effect.backdrop && shown.backdrop !== 'off'
      ? { color: effect.backdrop.color, state: shown.backdrop, fadeMs: effect.backdrop.fadeMs }
      : null,
  }
}
