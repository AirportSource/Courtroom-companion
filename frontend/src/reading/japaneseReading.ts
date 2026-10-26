import type { IpadicFeatures } from 'kuromoji'
import { graphemes } from '../engine/unicodeText.ts'
import { properNameMatches } from './properNames.ts'

export interface ReadingWord {
  surface: string
  start: number
  end: number
  reading: string
  base: string
  pos: string
  known: boolean
  properName?: { english?: string; entityType: string; source: string }
}

export const containsKanji = (text: string): boolean => /\p{Script=Han}/u.test(text)
export const readingEnabled = (enabled: boolean, language: string): boolean => enabled && language.split('-')[0] === 'ja'

/** Conversion changes the popup only. NFD also handles ヷ/ヸ/ヹ/ヺ as voiced kana. */
export function toHiragana(text: string): string {
  return text.normalize('NFD').replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).normalize('NFC')
}

/** Remove paginator-inserted line breaks for analysis, retaining UTF-16 positions in the page. */
export function analysisText(text: string): { text: string; positions: number[] } {
  const positions: number[] = []
  let joined = ''
  for (let i = 0; i < text.length; i++) if (text[i] !== '\n') { joined += text[i]; positions.push(i) }
  return { text: joined, positions }
}

/** Kuromoji positions are not UTF-16 offsets; match ordered surfaces and retain all gaps. */
export function alignReadings(page: string, raw: IpadicFeatures[]): ReadingWord[] {
  const source = analysisText(page)
  const boundaries = new Set([0])
  let offset = 0
  for (const cluster of graphemes(page)) boundaries.add(offset += cluster.length)
  const words: ReadingWord[] = []
  const tokenEdges = new Set([0, page.length])
  let cursor = 0
  const tokens: IpadicFeatures[] = []
  for (let i = 0; i < raw.length; i++) {
    const token = { ...raw[i] }
    // Preserve a kanji verb's contextual inflection (調べ + まし + た), using actual readings only.
    if (containsKanji(token.surface_form) && ['動詞', '形容詞'].includes(token.pos) && token.reading) {
      while (raw[i + 1]?.word_type === 'KNOWN' && raw[i + 1].pos === '助動詞' && raw[i + 1].reading) {
        const suffix = raw[++i]
        token.surface_form += suffix.surface_form
        token.reading += suffix.reading
      }
    }
    tokens.push(token)
  }
  for (const token of tokens) {
    const surface = token.surface_form
    if (!surface) continue
    const at = source.text.indexOf(surface, cursor)
    if (at < 0) throw new Error('Japanese reading alignment failed')
    cursor = at + surface.length
    const start = source.positions[at]
    const end = source.positions[cursor - 1] + 1
    tokenEdges.add(start); tokenEdges.add(end)
    const reading = token.reading ? toHiragana(token.reading) : ''
    if (token.word_type !== 'KNOWN' || !containsKanji(surface) || !/^[\p{Script=Hiragana}\p{Mark}ー]+$/u.test(reading)
      || !boundaries.has(start) || !boundaries.has(end)) continue
    words.push({ surface, start, end, reading, base: token.basic_form, pos: token.pos, known: true })
  }
  const names = properNameMatches(source.text, source.positions, tokenEdges, boundaries).map(({entry, surface, start, end}) => ({
    surface, start, end, reading: entry.reading, base: entry.surface, pos: '固有名詞', known: true,
    properName: { english: entry.english, entityType: entry.entityType, source: entry.source },
  }))
  return [...words.filter(word => !names.some(name => word.start < name.end && word.end > name.start)), ...names].sort((a,b) => a.start-b.start)
}

export interface WordRect { left: number; top: number; bottom: number }
export function popupPosition(word: WordRect, width: number, height: number, stageWidth = 256, stageHeight = 192) {
  return {
    left: Math.round(Math.max(2, Math.min(stageWidth - width - 2, word.left))),
    top: Math.round(Math.max(2, Math.min(stageHeight - height - 2, word.top >= height + 5 ? word.top - height - 3 : word.bottom + 3))),
  }
}

export function createReadingAnalyzer(load: () => Promise<{ tokenize(text: string): IpadicFeatures[] | Promise<IpadicFeatures[]> }>) {
  let pending: ReturnType<typeof load> | null = null
  const cache = new Map<string, Promise<ReadingWord[]>>()
  return (page: string): Promise<ReadingWord[]> => {
    const cached = cache.get(page)
    if (cached) return cached
    if (!pending) pending = load().catch(error => { pending = null; throw error })
    const result = pending.then(async tokenizer => alignReadings(page, await tokenizer.tokenize(analysisText(page).text)))
    cache.set(page, result)
    if (cache.size > 64) cache.delete(cache.keys().next().value!)
    void result.catch(() => { if (cache.get(page) === result) cache.delete(page) })
    return result
  }
}
