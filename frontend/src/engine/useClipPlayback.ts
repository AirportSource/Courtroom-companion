import { useEffect, useRef, useState } from 'react'
import type { AnimationClip } from './manifestTypes.ts'

/**
 * How long frame `index` stays on screen: its manifest duration, else 1000/fps. The first
 * frame gets a random 0..holdJitterMs extra so idle blinks don't fall on a fixed rhythm.
 */
export function frameDurationMs(clip: AnimationClip, index: number, random: () => number = Math.random): number {
  const base = clip.frames[index]?.durationMs ?? 1000 / clip.fps
  return index === 0 && clip.holdJitterMs > 0 ? base + random() * clip.holdJitterMs : base
}

/**
 * Plays one clip and returns the current frame index. This is the only animation timer:
 * one timeout chain per mounted character, restarted from frame 0 whenever the clip or
 * `restartKey` changes, and cleared on change or unmount. Non-looping clips hold their
 * last frame for one frame duration, then call onComplete once.
 */
export function useClipPlayback(
  clip: AnimationClip | null,
  restartKey: string,
  onComplete?: () => void,
): number {
  const [position, setPosition] = useState({ clip, restartKey, index: 0 })
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  useEffect(() => {
    if (!clip || clip.frames.length === 0) return
    let index = 0
    let timer = 0
    const tick = () => {
      if (index + 1 < clip.frames.length) {
        index += 1
      } else if (clip.loop) {
        index = 0
      } else {
        onCompleteRef.current?.()
        return
      }
      setPosition({ clip, restartKey, index })
      timer = window.setTimeout(tick, frameDurationMs(clip, index))
    }
    timer = window.setTimeout(tick, frameDurationMs(clip, 0))
    return () => window.clearTimeout(timer)
  }, [clip, restartKey])

  // A new clip always starts at frame 0, even before its first tick.
  return position.clip === clip && position.restartKey === restartKey ? position.index : 0
}
