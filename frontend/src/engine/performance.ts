// Client side of the backend contract: types for the Character Director's PerformanceTimeline,
// a defensive parser (the response is untrusted data), and conversion into the existing
// dialogue engine's DialogueLine format. No rendering, no provider knowledge.
import type { TextLayout } from './dialogueLayout.ts'
import type { DialogueLine } from './dialogueTypes.ts'

export interface PerformanceSegment {
  text: string
  emotion: string
  /** Logical animation id from the character manifest. */
  animation: string
  intensity: number
  reaction: string | null
  gesture: string | null
  estimatedMs: number
}

export interface PerformanceTimeline {
  characterId: string
  segments: PerformanceSegment[]
  settle: { emotion: string; animation: string }
  notes: string[]
}

export interface ChatResponse {
  performance: PerformanceTimeline
  provider: { type: string; model: string | null }
  warnings: string[]
}

const ID = /^[a-z0-9_]{1,64}$/

function asId(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null
}

/** Validates the shape of a /api/chat response; drops anything malformed. */
export function parseChatResponse(raw: unknown): ChatResponse {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const perf = (typeof body.performance === 'object' && body.performance !== null ? body.performance : {}) as Record<
    string,
    unknown
  >
  const segments: PerformanceSegment[] = (Array.isArray(perf.segments) ? perf.segments : []).flatMap((s) => {
    if (typeof s !== 'object' || s === null) return []
    const seg = s as Record<string, unknown>
    const text = typeof seg.text === 'string' ? seg.text.trim() : ''
    const emotion = asId(seg.emotion)
    const animation = asId(seg.animation)
    if (!text || !emotion || !animation) return []
    return [
      {
        text,
        emotion,
        animation,
        intensity: typeof seg.intensity === 'number' ? seg.intensity : 0.5,
        reaction: asId(seg.reaction),
        gesture: asId(seg.gesture),
        estimatedMs: typeof seg.estimatedMs === 'number' ? seg.estimatedMs : 0,
      },
    ]
  })
  if (segments.length === 0) throw new Error('the reply contained no playable lines')
  const settleRaw = (typeof perf.settle === 'object' && perf.settle !== null ? perf.settle : {}) as Record<string, unknown>
  const last = segments[segments.length - 1]
  const provider = (typeof body.provider === 'object' && body.provider !== null ? body.provider : {}) as Record<
    string,
    unknown
  >
  return {
    performance: {
      characterId: typeof perf.characterId === 'string' ? perf.characterId : '',
      segments,
      settle: {
        emotion: asId(settleRaw.emotion) ?? last.emotion,
        animation: asId(settleRaw.animation) ?? last.animation,
      },
      notes: Array.isArray(perf.notes) ? perf.notes.filter((n): n is string => typeof n === 'string') : [],
    },
    provider: {
      type: typeof provider.type === 'string' ? provider.type : 'unknown',
      model: typeof provider.model === 'string' ? provider.model : null,
    },
    warnings: Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : [],
  }
}

// ---- Dialogue pagination ---------------------------------------------------------------------
//
// beat ≠ page. A director segment (one semantic beat) is split into DS dialogue-box pages that
// (1) physically fit: every line is measured with the real font metrics in logical stage px and
// a page keeps at most `layout.lineWidths.length` lines. The paginator decides the line breaks
// itself (pages carry explicit "\n"), so the browser never re-wraps into a hidden 4th line;
// (2) break naturally: whole sentences first, then strong clause boundaries, then commas, then
// words, then graphemes, never leaving a stubby page just to fill the box.

/** Characters that must not start a line (punctuation hanging after a word). */
const NO_LINE_START = new Set([...'!?.,;:)]}»…、。，．！？：；）」』】〉》ー々'])
/** Characters that must not end a line (opening brackets/quotes). */
const NO_LINE_END = new Set([...'([{«「『【〈《'])
const CJK = /[぀-ヿ㐀-鿿豈-﫿＀-￯]/
const STRONG_CLAUSE = /[;:—–；：]/
const SOFT_CLAUSE = /[,、，]/
/** Ordinary breakable whitespace (no-break spaces, used before French ?!:;, are excluded). */
const BREAKABLE_SPACE = /[ \t\n]/

const segmenters = new Map<string, Intl.Segmenter>()

function segment(text: string, granularity: 'grapheme' | 'sentence', locale?: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const key = `${locale ?? ''}|${granularity}`
    let segmenter = segmenters.get(key)
    if (!segmenter) segmenters.set(key, (segmenter = new Intl.Segmenter(locale, { granularity })))
    return [...segmenter.segment(text)].map((s) => s.segment)
  }
  if (granularity === 'grapheme') return [...text]
  return text.match(/[^.!?。！？]+[.!?。！？]*\s*|.+$/g) ?? [text]
}

/** String offsets at grapheme boundaries (excluding 0). */
function graphemeEnds(text: string, locale?: string): number[] {
  const ends: number[] = []
  let offset = 0
  for (const g of segment(text, 'grapheme', locale)) ends.push((offset += g.length))
  return ends
}

/** Offsets where a line may break (the line ends before the offset). */
function lineBreakOpportunities(text: string, locale?: string): number[] {
  const graphemes = segment(text, 'grapheme', locale)
  const breaks: number[] = []
  let offset = 0
  for (let i = 0; i < graphemes.length - 1; i++) {
    offset += graphemes[i].length
    const prev = graphemes[i]
    const next = graphemes[i + 1]
    if (NO_LINE_START.has(next) || NO_LINE_END.has(prev)) continue
    if (BREAKABLE_SPACE.test(prev) && !BREAKABLE_SPACE.test(next)) breaks.push(offset)
    else if ((CJK.test(prev) || CJK.test(next)) && !BREAKABLE_SPACE.test(next)) breaks.push(offset)
    else if (/[—–]/.test(prev)) breaks.push(offset)
  }
  breaks.push(text.length)
  return breaks
}

/**
 * Greedy line wrapping with measured widths. Returns trimmed lines; may return more lines
 * than the layout allows (callers check). Unbreakable runs are split at grapheme boundaries.
 */
export function wrapLines(text: string, layout: TextLayout): string[] {
  const lines: string[] = []
  const opportunities = lineBreakOpportunities(text, layout.locale)
  const graphemes = graphemeEnds(text, layout.locale)
  let start = 0
  while (start < text.length) {
    while (start < text.length && BREAKABLE_SPACE.test(text[start])) start++
    if (start >= text.length) break
    const width = layout.lineWidths[Math.min(lines.length, layout.lineWidths.length - 1)]
    const fits = (end: number) => layout.measure(text.slice(start, end).trimEnd()) <= width
    let end = 0
    for (const b of opportunities) {
      if (b <= start) continue
      if (fits(b)) end = b
      else break
    }
    if (!end) {
      // No word break fits: take the longest run of whole graphemes (at least one).
      for (const g of graphemes) {
        if (g <= start) continue
        if (!end || fits(g)) end = g
        else break
      }
    }
    lines.push(text.slice(start, end).trim())
    start = end
  }
  return lines
}

function fitsPage(text: string, layout: TextLayout): boolean {
  return wrapLines(text, layout).length <= layout.lineWidths.length
}

/** Offsets just after a punctuation match (and following spaces), inside the text. */
function offsetsAfter(text: string, pattern: RegExp): number[] {
  const offsets: number[] = []
  for (let i = 0; i < text.length - 1; i++) {
    if (!pattern.test(text[i])) continue
    let j = i + 1
    while (j < text.length && BREAKABLE_SPACE.test(text[j])) j++
    if (j < text.length) offsets.push(j)
  }
  return offsets
}

/** A page break must not leave fewer graphemes than this behind (avoids "の。" / "that?" orphans). */
const MIN_TAIL_GRAPHEMES = 6

/**
 * Splits an over-long sentence into a page-sized head and a tail. In order of preference:
 * 1. a strong clause boundary, then a comma, if the head is at least half of what a plain
 *    word break would fit (rhythm over fill);
 * 2. a clause boundary or comma with a head of at least a third, when everything after it
 *    fits on one more page (ending on the comma costs no extra page);
 * 3. the furthest word break (or whole graphemes for unbroken runs), backing off so the
 *    remainder isn't a tiny orphan.
 */
function splitOverlong(text: string, layout: TextLayout): [string, string] {
  // Offsets are ascending and fitting is monotonic (a longer prefix never fits better),
  // so stop at the first prefix that overflows.
  const fitting = (offsets: number[]) => {
    const fits: number[] = []
    for (const o of offsets) {
      if (o <= 0) continue
      if (!fitsPage(text.slice(0, o).trim(), layout)) break
      fits.push(o)
    }
    return fits
  }
  const split = (o: number): [string, string] => [text.slice(0, o).trim(), text.slice(o).trim()]
  const words = fitting(lineBreakOpportunities(text, layout.locale).filter((o) => o < text.length))
  const graphemes = fitting(graphemeEnds(text, layout.locale).filter((o) => o < text.length))
  const breaks = words.length ? words : graphemes
  const furthest = breaks.at(-1) ?? graphemeEnds(text, layout.locale)[0]
  const clauses = [STRONG_CLAUSE, SOFT_CLAUSE].map((pattern) => fitting(offsetsAfter(text, pattern)))

  for (const candidates of clauses) {
    const clause = candidates.filter((o) => o >= furthest / 2).at(-1)
    if (clause) return split(clause)
  }
  for (const candidates of clauses) {
    const clause = candidates.filter((o) => o >= furthest / 3 && fitsPage(text.slice(o).trim(), layout)).at(-1)
    if (clause) return split(clause)
  }
  const tailGraphemes = (o: number) => segment(text.slice(o).trim(), 'grapheme', layout.locale).length
  const unorphaned = breaks.filter((o) => tailGraphemes(o) >= MIN_TAIL_GRAPHEMES).at(-1)
  return split(tailGraphemes(furthest) < MIN_TAIL_GRAPHEMES && unorphaned ? unorphaned : furthest)
}

/**
 * Splits text into dialogue-box pages that fit `layout` (lines joined with "\n"). Whole
 * sentences stay together whenever they fit; a page never ends mid-sentence just to use the
 * remaining space.
 */
export function paginate(text: string, layout: TextLayout): string[] {
  const normalized = text.replace(/[ \t\r\n]+/g, ' ').trim()
  if (!normalized) return []
  const pages: string[] = []
  let current = ''
  const flush = () => {
    if (current.trim()) pages.push(wrapLines(current.trim(), layout).join('\n'))
    current = ''
  }
  for (const sentence of segment(normalized, 'sentence', layout.locale)) {
    if (fitsPage((current + sentence).trim(), layout)) {
      current += sentence
      continue
    }
    flush()
    let rest = sentence.trim()
    while (rest && !fitsPage(rest, layout)) {
      const [head, tail] = splitOverlong(rest, layout)
      pages.push(wrapLines(head, layout).join('\n'))
      rest = tail
    }
    // Keep the sentence's own trailing whitespace (none in Japanese, a space in English).
    current = rest ? rest + (sentence.match(/\s*$/)?.[0] ?? '') : ''
  }
  flush()
  return pages
}

/**
 * Timeline -> existing dialogue lines (one per page). Every page of a segment keeps the
 * director's emotion and pose; the segment's reaction plays only on its first page, so
 * advancing pages never re-triggers it. The director is not re-run.
 */
export function timelineToLines(timeline: PerformanceTimeline, layout: TextLayout): DialogueLine[] {
  return timeline.segments.flatMap((segment) =>
    paginate(segment.text, layout).map((page, i) => ({
      emotion: segment.emotion,
      text: page,
      animation: segment.animation,
      reaction: i === 0 ? segment.reaction : null,
    })),
  )
}

export class ChatError extends Error {}

export type ChatProviderSelection =
  | { type: 'fake' }
  | { type: 'ollama'; baseUrl: string; model: string }

/** POST /api/chat (proxied to the backend by Vite in development). */
export async function sendChat(
  request: { character: string; message: string; sessionId: string; provider?: ChatProviderSelection },
  timeoutMs = 135_000,
): Promise<ChatResponse> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    if (!response.ok) throw new ChatError(`the server answered ${response.status}`)
    return parseChatResponse(await response.json())
  } catch (error) {
    if (error instanceof ChatError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new ChatError('the server took too long')
    throw new ChatError(error instanceof Error ? error.message : 'could not reach the server')
  } finally {
    window.clearTimeout(timer)
  }
}

if (import.meta.env?.DEV) {
  // Dev-only: paginate arbitrary text with the live dialogue layout (browser checks).
  void import('./dialogueLayout.ts').then(({ dialogueTextLayout }) => {
    Object.assign(window, {
      __ccPaginate: async (text: string, locale?: string) => paginate(text, await dialogueTextLayout(locale)),
    })
  })
}
