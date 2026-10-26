import kuromoji from 'kuromoji/build/kuromoji.js'
import type { IpadicFeatures, Tokenizer } from 'kuromoji'
import { createBrowserDictionary, type DictionaryQuery } from './japaneseDictionary.ts'
import { toHiragana } from './japaneseReading.ts'

let tokenizer: Promise<Tokenizer<IpadicFeatures>> | null = null
let dictionary: ReturnType<typeof createBrowserDictionary> | null = null
self.onmessage = async ({ data }: MessageEvent<{ id: number; kind?: 'lookup'; text: string; dicPath: string; dictionaryRoot: string; query: DictionaryQuery }>) => {
  try {
    if (data.kind === 'lookup') {
      dictionary ??= createBrowserDictionary(data.dictionaryRoot)
      const query = data.query
      if (query.word.base !== query.word.surface && tokenizer) {
        const tokens = (await tokenizer).tokenize(query.word.base)
        if (tokens.every(t => t.word_type === 'KNOWN' && t.reading) && tokens.map(t => t.surface_form).join('') === query.word.base) {
          query.baseReading = toHiragana(tokens.map(t => t.reading).join(''))
        }
      }
      self.postMessage({ id: data.id, result: await dictionary(query) })
      return
    }
    tokenizer ??= new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: data.dicPath }).build((error, built) => error ? reject(error) : resolve(built))
    })
    const built = await tokenizer
    self.postMessage({ id: data.id, result: built.tokenize(data.text) })
  } catch {
    if (data.kind !== 'lookup') tokenizer = null
    self.postMessage({ id: data.id, error: 'dictionary_unavailable' })
  }
}
