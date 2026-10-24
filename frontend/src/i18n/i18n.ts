// Interface language (D-066). The chosen language also becomes <html lang>, which the dialogue
// paginator and task acknowledgements already read, and is sent with each chat turn so the model
// (and the offline provider) replies in it.
import { EN, ES, FR, IT, JA, type StringKey, type Strings } from './strings.ts'

export type Language = 'en' | 'fr' | 'ja' | 'it' | 'es'

/** Selector entries, each in its own language. */
export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' },
  { value: 'it', label: 'Italiano' },
  { value: 'es', label: 'Español' },
]

export const STRINGS: Record<Language, Strings> = { en: EN, fr: FR, ja: JA, it: IT, es: ES }

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in STRINGS
}

/** First supported browser language (e.g. "fr-CA" → fr), else English. */
export function detectLanguage(preferred: readonly string[] = globalThis.navigator?.languages ?? []): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string

export function translate(language: Language, key: StringKey, vars: Record<string, string | number> = {}): string {
  const text = STRINGS[language]?.[key] ?? EN[key]
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function translator(language: Language): Translate {
  return (key, vars) => translate(language, key, vars)
}

/** A character's name in this language (character.json `names`), else its displayName. */
export function localizedName(character: { displayName: string; names?: Partial<Record<string, string>> }, language: Language): string {
  return character.names?.[language] ?? character.displayName
}

export type { StringKey }
