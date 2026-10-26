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

const COMMON_WORDS: Record<Exclude<Language, 'ja'>, Set<string>> = {
  en: new Set('the a an is are and i you can could please what how for with me my it this that file of to'.split(' ')),
  fr: new Set("le la les un une des est et je tu peux pourrais pour avec moi mon ma ce cette c'est est-ce que qu'il pas fichier de du j'aimerais bonjour salut".split(' ')),
  it: new Set('il lo la gli le un una è e io tu puoi potresti per con mi mio mia questo che di del ciao grazie'.split(' ')),
  es: new Set('el la los las un una es y yo tú puedes podrías para con me mi este esta que de del archivo hola gracias'.split(' ')),
}

/**
 * Best guess of the language a chat message is written in (D-073), for the few lines the app
 * says locally (task acknowledgements); `fallback` (the interface language) when unclear.
 */
export function guessMessageLanguage(text: string, fallback: Language): Language {
  if (/[぀-ヿ一-鿿]/.test(text)) return 'ja'
  const words = text.toLowerCase().replace(/[’]/g, "'").match(/[\p{L}'-]+/gu) ?? []
  const scores = Object.entries(COMMON_WORDS).map(([language, common]) => ({
    language: language as Language,
    score: words.filter((word) => common.has(word)).length
      + (language === 'es' && /[ñ¿¡]/.test(text) ? 2 : 0) + (language === 'fr' && /[çêœ]/.test(text) ? 2 : 0),
  })).sort((a, b) => b.score - a.score)
  return scores[0].score > 0 && scores[0].score > scores[1].score ? scores[0].language : fallback
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

/** A location's label in this language, falling back to its English description then id. */
export function localizedLocationName(
  location: { id: string; description: string; names?: Partial<Record<string, string>> },
  language: Language,
): string {
  return (location.names?.[language] ?? location.names?.en ?? location.description) || location.id
}

export type { StringKey }
