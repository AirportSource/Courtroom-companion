import type { IpadicFeatures } from 'kuromoji'
import { createReadingAnalyzer } from './japaneseReading.ts'
import type { DictionaryQuery, Definition } from './japaneseDictionary.ts'

let worker: Worker | null = null
let serial = 0
const requests = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function fail(error: Error) {
  worker?.terminate()
  worker = null
  for (const request of requests.values()) { clearTimeout(request.timer); request.reject(error) }
  requests.clear()
}

function request<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./japaneseTokenizer.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
          const request = requests.get(data.id)
          if (!request) return
          clearTimeout(request.timer)
          requests.delete(data.id)
          if (data.error) request.reject(new Error('Japanese dictionary could not be loaded'))
          else request.resolve(data.result)
        }
        worker.onerror = event => { event.preventDefault(); fail(new Error('Japanese reading worker failed')) }
      }
      const id = ++serial
      const timer = setTimeout(() => fail(new Error('Japanese dictionary load timed out')), 30000)
      requests.set(id, { resolve: result => resolve(result as T), reject, timer })
      // Browserified path.join requires an origin-relative path, not an http:// URL.
      const dicPath = new URL(`${import.meta.env.BASE_URL}assets/kuromoji/`, window.location.href).pathname
      const dictionaryRoot = new URL(`${import.meta.env.BASE_URL}assets/jmdict/`, window.location.href).href
      worker.postMessage({ id, ...payload, dicPath, dictionaryRoot })
    } catch (error) { fail(error instanceof Error ? error : new Error('Japanese reading worker failed')); reject(error) }
  })
}

/** One lazy worker/tokenizer, shared initialization and a bounded page cache; no work when OFF. */
export const analyzeJapanese = createReadingAnalyzer(async () => ({ tokenize: text => request<IpadicFeatures[]>({text}) }))

const definitions = new Map<string, Promise<Definition | null>>()
export function lookupJapanese(query: DictionaryQuery): Promise<Definition | null> {
  if (query.word.properName) return Promise.resolve(null)
  const key = JSON.stringify([query.word.surface, query.word.base, query.word.reading, query.word.pos, query.language])
  let result = definitions.get(key)
  if (!result) {
    result = request<Definition | null>({kind:'lookup', query})
    definitions.set(key, result)
    if (definitions.size > 64) definitions.delete(definitions.keys().next().value!)
    void result.catch(() => { if (definitions.get(key) === result) definitions.delete(key) })
  }
  return result
}
