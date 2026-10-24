// Semantic SFX: the director emits names; audio.json events `sfx_<name>` map them to sounds.
import { audioEngine } from './audioEngine.ts'

export const SFX_NAMES = [
  'surprise',
  'shock',
  'realization',
  'comic',
  'emphasis',
  'tension',
  'notification',
  'soft_transition',
] as const
export type SfxName = (typeof SFX_NAMES)[number]

/** semantic name → audio.json event id */
export const SFX_EVENTS: Readonly<Record<SfxName, string>> = Object.fromEntries(
  SFX_NAMES.map((name) => [name, `sfx_${name}`]),
) as Record<SfxName, string>

export function sfxEvent(name: string): string | null {
  return Object.hasOwn(SFX_EVENTS, name) ? SFX_EVENTS[name as SfxName] : null
}

interface EventPlayer {
  playEvent(event: string, volume?: number): boolean
}

/** Play a semantic effect. Unknown names, mute and zero volume are silent no-ops. */
export function playSfx(name: string, volume: number, muted: boolean, player: EventPlayer = audioEngine): boolean {
  const event = sfxEvent(name)
  if (!event || muted || !(volume > 0)) return false
  return player.playEvent(event, volume)
}
