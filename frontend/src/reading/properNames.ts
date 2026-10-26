import data from '../data/japaneseProperNames.json' with { type: 'json' }

export interface ProperName {
  surface: string; reading: string; english?: string; entityType: string; source: string
  alternativeForms?: string[]; match?: string
}
const forms = (data.entries as ProperName[]).flatMap(entry => [entry.surface, ...(entry.alternativeForms ?? [])]
  .map(surface => ({ entry, surface }))).sort((a, b) => b.surface.length - a.surface.length)

export function containsProperName(text: string): boolean {
  return forms.some(({ surface }) => text.includes(surface))
}

/** Conservative lexical boundaries: do not replace a substring inside an unrelated compound. */
export function properNameMatches(text: string, positions: number[], edges: Set<number>, graphemeEdges: Set<number>) {
  const found = []
  for (let at = 0; at < text.length;) {
    const match = forms.find(({ entry, surface }) => {
      if (!text.startsWith(surface, at)) return false
      const start = positions[at], end = positions[at + surface.length - 1] + 1
      if (!edges.has(start) || !edges.has(end) || !graphemeEdges.has(start) || !graphemeEdges.has(end)) return false
      const before = Array.from(text.slice(0, at)).at(-1) ?? ''
      const after = text.slice(at + surface.length)
      if (/[\p{Script=Han}\p{Script=Latin}\p{Number}]/u.test(before)) return false
      if (/^[\p{Script=Latin}\p{Number}]/u.test(after)) return false
      if (/^\p{Script=Han}/u.test(after) && !data.titleSuffixes.some(title => after.startsWith(title))) return false
      if (entry.match === 'isolated-or-honorific' && !/^(?:さん|さま|様|ちゃん|くん|君|$|[\s、。！？」』）])/u.test(after)) return false
      return true
    })
    if (!match) { at += String.fromCodePoint(text.codePointAt(at)!).length; continue }
    found.push({ entry: match.entry, surface: match.surface, start: positions[at], end: positions[at + match.surface.length - 1] + 1 })
    at += match.surface.length
  }
  return found
}
