// Character pack readiness (character.json `readiness`), shared by the loader and the menus.
//
// - "asset-only": sprites/portraits exist, no personality or director data. Never listed.
// - "partial":    some behaviour data is missing. Listed in development builds only, with a marker.
// - "ready":      personality.md + performance.json complete and validated. Listed everywhere.
//
// The frontend cannot see personality.md / performance.json, so a missing or unknown value is
// treated conservatively as "partial". (The backend derives the level from the files.)
import type { CharacterSummary } from './manifestTypes.ts'

export const READINESS_LEVELS = ['asset-only', 'partial', 'ready'] as const
export type Readiness = (typeof READINESS_LEVELS)[number]

export function readReadiness(raw: unknown): Readiness {
  return typeof raw === 'string' && (READINESS_LEVELS as readonly string[]).includes(raw) ? (raw as Readiness) : 'partial'
}

/** Optional pack grouping (e.g. the game a character comes from: "aa1"). Used to order menus. */
export function readGroup(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^[a-z0-9_]{1,16}$/.test(raw) ? raw : undefined
}

/** Production lists only ready characters; development also lists partial ones; asset-only never. */
export function isListable(readiness: Readiness, dev: boolean): boolean {
  return readiness === 'ready' || (dev && readiness === 'partial')
}

/** Filters and orders summaries for menus: registered order, grouped by `group` (stable). */
export function listableCharacters(summaries: readonly CharacterSummary[], dev: boolean): CharacterSummary[] {
  const groups: string[] = []
  for (const summary of summaries) if (summary.group && !groups.includes(summary.group)) groups.push(summary.group)
  const rank = (summary: CharacterSummary) => (summary.group ? groups.indexOf(summary.group) : groups.length)
  return summaries
    .filter((summary) => isListable(summary.readiness, dev))
    .map((summary, order) => ({ summary, order }))
    .sort((a, b) => rank(a.summary) - rank(b.summary) || a.order - b.order)
    .map(({ summary }) => summary)
}
