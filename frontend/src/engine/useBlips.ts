import { useCallback, useRef } from 'react'
import { audioEngine } from './audioEngine.ts'
import type { SoundId } from './manifestTypes.ts'

/** Minimum gap between blips so fast text doesn't machine-gun. */
const MIN_BLIP_INTERVAL_MS = 60
const SILENT_CHAR = /[\s.,!?;:…'"“”‘’()[\]\-–—*~]/

/** Characters that trigger a blip: anything visible except punctuation. */
export function isBlipChar(char: string): boolean {
  return char.length > 0 && !SILENT_CHAR.test(char)
}

/**
 * Returns a per-character callback that plays `soundId` for voiced characters, throttled.
 * The sound itself is decoded once by the audio engine.
 */
export function useBlips(soundId: SoundId | null, volume: number, muted: boolean) {
  const lastBlipAt = useRef(0)
  return useCallback(
    (char: string) => {
      if (!soundId || muted || volume <= 0 || !isBlipChar(char)) return
      const now = performance.now()
      if (now - lastBlipAt.current < MIN_BLIP_INTERVAL_MS) return
      lastBlipAt.current = now
      audioEngine.play(soundId, volume)
    },
    [soundId, volume, muted],
  )
}
