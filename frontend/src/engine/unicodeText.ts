/** Shared user-perceived character boundaries for pagination, reveal and measurement. */
const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Conservative fallback for older embedded browsers: marks, IVS, emoji/ZWJ and flags. */
export function fallbackGraphemes(text: string): string[] {
  const result: string[] = []
  let regionalRun = 0
  for (const point of text) {
    const regional = /\p{Regional_Indicator}/u.test(point)
    const previous = result.at(-1)
    if (previous && (/^[\p{Mark}\p{Emoji_Modifier}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u{E0020}-\u{E007F}]$/u.test(point)
      || point === '\u200D' || previous.endsWith('\u200D')
      || (regional && regionalRun % 2 === 1) || (point === '\n' && previous === '\r'))) {
      result[result.length - 1] += point
    } else result.push(point)
    regionalRun = regional ? regionalRun + 1 : 0
  }
  return result
}

export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), ({ segment }) => segment) : fallbackGraphemes(text)
}

export function revealSteps(text: string): { char: string; start: number; end: number }[] {
  let offset = 0
  return graphemes(text).map((char) => {
    const start = offset
    offset += char.length
    return { char, start, end: offset }
  })
}

/** UTF-16 offsets retained as the reveal API, but only complete graphemes may be revealed. */
export function revealParts(text: string, requestedOffset: number): [string, string] {
  let end = 0
  for (const cluster of graphemes(text)) {
    if (end + cluster.length > requestedOffset) break
    end += cluster.length
  }
  return [text.slice(0, end), text.slice(end)]
}
