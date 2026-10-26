import { toHiragana, type ReadingWord } from './japaneseReading.ts'

// Compact shard tuples mirror scripts/build_jmdict.py; restrictions are not discarded.
type Kanji = [text: string, info: string[], priority: string[]]
type Reading = [text: string, restrict: string[], noKanji: boolean, info: string[], priority: string[]]
type Sense = [kanji: string[], reading: string[], pos: string[], misc: string[], field: string[], dialect: string[], notes: string[], en: string[], fr: string[]]
export type DictionaryEntry = [id: string, kanji: Kanji[], readings: Reading[], senses: Sense[]]
export interface Definition {
  base: string
  language: 'fr' | 'en'
  senses: { id: string; glosses: string[]; tags: string[]; notes: string[] }[]
  totalSenses: number
}
export interface DictionaryQuery { word: ReadingWord; baseReading?: string; language: 'fr' | 'en' }

export function dictionaryShard(text: string): string {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0)!, 16777619) >>> 0
  return (value % 256).toString(16).padStart(2, '0')
}

function validEntry(entry: unknown): entry is DictionaryEntry {
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string')
  return Array.isArray(entry) && entry.length === 4 && typeof entry[0] === 'string' && /^\d+$/.test(entry[0])
    && Array.isArray(entry[1]) && entry[1].every(k => Array.isArray(k) && k.length === 3 && typeof k[0] === 'string' && strings(k[1]) && strings(k[2]))
    && Array.isArray(entry[2]) && entry[2].every(r => Array.isArray(r) && r.length === 5 && typeof r[0] === 'string' && strings(r[1]) && typeof r[2] === 'boolean' && strings(r[3]) && strings(r[4]))
    && Array.isArray(entry[3]) && entry[3].every(s => Array.isArray(s) && s.length === 9 && s.every(strings))
}

function compatiblePos(pos: string, tags: string[]) {
  if (!tags.length || tags.includes('unc')) return true
  if (pos === '動詞') return tags.some(tag => /^v(?:[1-5]|s|k|n|r)/.test(tag))
  if (pos === '形容詞') return tags.some(tag => tag.startsWith('adj'))
  if (pos === '名詞') return tags.some(tag => tag === 'n' || tag.startsWith('n-') || tag === 'vs' || tag.startsWith('adj-na') || tag === 'pn')
  return true
}

/** Bounded, shared shard promises. Failed assets are evicted, so a later popup can retry. */
export function createDictionary(load: (shard: string) => Promise<unknown>) {
  const cache = new Map<string, Promise<Record<string, unknown>>>()
  const shard = (key: string) => {
    const name = dictionaryShard(key)
    let result = cache.get(name)
    if (!result) {
      result = load(name).then(data => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JMdict shard')
        return data as Record<string, unknown>
      })
      cache.set(name, result)
      if (cache.size > 16) cache.delete(cache.keys().next().value!)
      void result.catch(() => { if (cache.get(name) === result) cache.delete(name) })
    }
    return result
  }
  return async ({word, baseReading, language}: DictionaryQuery): Promise<Definition | null> => {
    if (word.properName || !word.known) return null
    const base = word.base && word.base !== '*' ? word.base : word.surface
    // Inflected readings must be resolved by Kuromoji for the base form, never guessed.
    const reading = base === word.surface ? word.reading : baseReading
    if (!reading) return null
    const data = await shard(base)
    const entries = Object.hasOwn(data, base) ? data[base] : []
    if (!Array.isArray(entries) || !entries.every(validEntry)) throw new Error('Invalid JMdict entries')
    const matches = entries.flatMap(entry => {
      const written = entry[1].find(k => k[0] === base)
      const kana = entry[2].filter(r => toHiragana(r[0]) === reading && (!written || !r[2]) && (!r[1].length || r[1].includes(base)))
      if (!kana.length || (entry[1].length && !written)) return []
      return entry[3].filter(s => (!s[0].length || s[0].includes(base))
        && (!s[1].length || kana.some(r => s[1].includes(r[0]))) && compatiblePos(word.pos, s[2]))
        .map(s => ({id: entry[0], sense: s}))
    })
    const chosen = language === 'fr' && matches.some(m => m.sense[8].length) ? 'fr' : 'en'
    const senses = matches.filter(m => m.sense[chosen === 'fr' ? 8 : 7].length)
    if (!senses.length) return null
    return {base, language: chosen, totalSenses: senses.length, senses: senses.slice(0,3).map(({id,sense}) => ({
      id, glosses: sense[chosen === 'fr' ? 8 : 7].slice(0,3), tags: [...sense[3], ...sense[4], ...sense[5]], notes: sense[6],
    }))}
  }
}

export function createBrowserDictionary(root: string) {
  let manifest: Promise<{ schemaVersion: number; files: Record<string, {sha256: string}> }> | null = null
  return createDictionary(async shard => {
    manifest ??= fetch(`${root}manifest.json`).then(async response => {
      if (!response.ok) throw new Error('JMdict manifest unavailable')
      const data = await response.json()
      if (data?.schemaVersion !== 1 || !data.files || typeof data.files !== 'object') throw new Error('Unsupported JMdict manifest')
      return data
    }).catch(error => { manifest = null; throw error })
    const name = `${shard}.json.gz.bin`, info = (await manifest).files[name]
    if (!info || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Invalid JMdict shard metadata')
    const response = await fetch(`${root}${name}`)
    if (!response.ok) throw new Error('JMdict shard unavailable')
    const bytes = await response.arrayBuffer()
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('')
    if (digest !== info.sha256) throw new Error('JMdict checksum mismatch')
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).json()
  })
}
