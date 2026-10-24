// Voiced shouts (D-068): audio.json `voices` maps phrase → language → speaker → sound id, e.g.
// voices.objection.ja.phoenix = "voice_ja_phoenix_objection". Used by the title screen and by
// character exclamations; everything falls back to the plain exclamation SFX when absent.
import type { SoundId } from './manifestTypes.ts'

export type ShoutPhrase = 'objection' | 'hold_it' | 'take_that'
export type ShoutLanguage = 'ja' | 'en'
export type VoiceCatalog = Partial<Record<ShoutPhrase, Partial<Record<string, Record<string, SoundId>>>>>

const PHRASES: readonly ShoutPhrase[] = ['objection', 'hold_it', 'take_that']
const ID = /^[a-z0-9_]{1,40}$/

let catalog: VoiceCatalog = {}
export const setVoiceCatalog = (next: VoiceCatalog): void => { catalog = next }
export const getVoiceCatalog = (): VoiceCatalog => catalog

/** Keeps only known phrases, two-letter languages, simple speaker ids and existing sounds. */
export function parseVoices(raw: unknown, knownSounds: Set<string>): VoiceCatalog {
  const out: VoiceCatalog = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const phrase of PHRASES) {
    const byLanguage = (raw as Record<string, unknown>)[phrase]
    if (typeof byLanguage !== 'object' || byLanguage === null) continue
    for (const [language, bySpeaker] of Object.entries(byLanguage)) {
      if (!/^[a-z]{2}$/.test(language) || typeof bySpeaker !== 'object' || bySpeaker === null) continue
      for (const [speaker, sound] of Object.entries(bySpeaker)) {
        if (!ID.test(speaker) || typeof sound !== 'string' || !knownSounds.has(sound)) continue
        ;((out[phrase] ??= {})[language] ??= {})[speaker] = sound
      }
    }
  }
  return out
}

/** A speaker's shout in the preferred language, else in any other language. */
export function shoutSound(phrase: ShoutPhrase, language: ShoutLanguage, speaker: string,
  voices: VoiceCatalog = catalog): SoundId | null {
  const byLanguage = voices[phrase] ?? {}
  return byLanguage[language]?.[speaker] ?? Object.values(byLanguage).find((bySpeaker) => bySpeaker?.[speaker])?.[speaker] ?? null
}

/** A random speaker among `speakers` who has this shout (preferred language first). */
export function randomShout(phrase: ShoutPhrase, language: ShoutLanguage, speakers: readonly string[],
  random: () => number = Math.random, voices: VoiceCatalog = catalog): { speaker: string; sound: SoundId } | null {
  const available = speakers.flatMap((speaker) => {
    const sound = shoutSound(phrase, language, speaker, voices)
    return sound ? [{ speaker, sound }] : []
  })
  return available.length ? available[Math.floor(random() * available.length) % available.length] : null
}

/** Every voice of a phrase, all languages and speakers (the title draw, D-068). */
export function allShouts(phrase: ShoutPhrase, voices: VoiceCatalog = catalog): SoundId[] {
  return Object.values(voices[phrase] ?? {}).flatMap((bySpeaker) => Object.values(bySpeaker ?? {}))
}

/** A random sound from `sounds`, never `last` again when another one exists. */
export function pickShout(sounds: readonly SoundId[], last: SoundId | null,
  random: () => number = Math.random): SoundId | null {
  const pool = sounds.length > 1 ? sounds.filter((sound) => sound !== last) : [...sounds]
  return pool.length ? pool[Math.floor(random() * pool.length) % pool.length] : null
}
