import type { AudioLoopHandle } from '../engine/audioEngine.ts'
import { acquireRingtone } from '../engine/ringtones.ts'
import { readStoredSettings } from '../settings/settings.ts'

export const PHONE_DUCK_FACTOR = 0.12
export const PHONE_DUCK_MS = 220
export const PHONE_RESTORE_MS = 350
export type PhoneRingingHandle = (() => void) & { setVolume(volume: number): void }

/** A scoped semantic audio/mix lease. Every exit path uses the same idempotent release. */
export function startPhoneRinging(
  audio: { acquireEventLoop(event: string, volume: number): AudioLoopHandle },
  music: { acquireDuck(factor: number, attackMs: number, releaseMs: number): () => void },
  volume: number,
  /** Settings ringtone id; read at ring time so a changed choice applies without a restart. */
  ringtoneId: string = readStoredSettings().ringtoneId,
): PhoneRingingHandle {
  const ring = acquireRingtone(audio, ringtoneId, volume)
  const duck = () => music.acquireDuck(PHONE_DUCK_FACTOR, PHONE_DUCK_MS, PHONE_RESTORE_MS)
  let restore = volume > 0 ? duck() : null
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    ring.stop()
    restore?.()
    restore = null
  }
  return Object.assign(stop, { setVolume(next: number) {
    if (stopped) return
    ring.setVolume(next)
    if (next > 0 && !restore) restore = duck()
    else if (next <= 0) { restore?.(); restore = null }
  } })
}
