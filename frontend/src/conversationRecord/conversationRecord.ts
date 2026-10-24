// Pure helpers for the Conversation Record screen: paging, labels, scrolling and file availability.
import type { GeneratedArtifact } from '../artifacts/artifacts.ts'
import { TILE_GRID } from '../courtRecord/evidenceTile.ts'
import type { ConversationRecordEntry } from './api.ts'

export const RECORD_PAGE_SIZE = TILE_GRID.pageSize
/** Detail text uses the dialogue box's 15 px rhythm for 16 px glyphs (descenders and DotGothic16
 * kanji need it); scrolling always moves by whole lines. 8 lines = the 120 px body. */
export const DETAIL_LINE_HEIGHT = 15
export const DETAIL_VISIBLE_LINES = 8

/** Entries keep the server's order (newest first); repeated ids are dropped, nothing is re-sorted. */
export function orderedEntries(entries: readonly ConversationRecordEntry[]): ConversationRecordEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id))
}

export function recordPageCount(count: number): number {
  return Math.max(1, Math.ceil(count / RECORD_PAGE_SIZE))
}

export function recordPageOf(index: number): number {
  return Math.floor(Math.max(0, index) / RECORD_PAGE_SIZE)
}

/** Index to select after deleting `index` from a list that had `count` entries. */
export function selectionAfterDelete(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 2))
}

/** "2026-10-24 12:30" in UTC, so labels do not depend on the viewer's locale or time zone. */
export function formatEntryDate(createdAt: string): string {
  const time = Date.parse(createdAt)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') : ''
}

export function entryLabel(entry: Pick<ConversationRecordEntry, 'createdAt' | 'userText'>): string {
  const first = entry.userText.split(/\r?\n/).find((line) => line.trim()) ?? ''
  return [formatEntryDate(entry.createdAt), first.trim()].filter(Boolean).join(' · ')
}

export interface FileAvailability {
  id: string
  /** Display name when the artifact still exists. */
  name: string | null
  available: boolean
}

/**
 * Maps an entry's artifact ids onto the live artifact list. `null` (list not loaded yet) means
 * availability is unknown: files stay openable and the content route decides.
 */
export function mapFileAvailability(ids: readonly string[], artifacts: readonly GeneratedArtifact[] | null): FileAvailability[] {
  const byId = new Map((artifacts ?? []).map((artifact) => [artifact.id, artifact]))
  return ids.map((id) => {
    const artifact = byId.get(id)
    if (artifacts === null) return { id, name: null, available: true }
    return artifact && artifact.status === 'ready'
      ? { id, name: artifact.displayName, available: true } : { id, name: null, available: false }
  })
}

/** Largest scrollTop (a whole number of lines) for content of `contentHeight` in `viewportHeight`. */
export function maxScrollTop(contentHeight: number, viewportHeight: number, lineHeight = DETAIL_LINE_HEIGHT): number {
  const overflow = Math.max(0, contentHeight - viewportHeight)
  return Math.ceil(overflow / lineHeight) * lineHeight
}

/** Moves by `lines` whole lines from the current offset, snapped to the line grid and clamped. */
export function scrollByLines(scrollTop: number, lines: number, maxTop: number, lineHeight = DETAIL_LINE_HEIGHT): number {
  const snapped = Math.round(scrollTop / lineHeight) * lineHeight + lines * lineHeight
  return Math.min(Math.max(snapped, 0), Math.max(0, maxTop))
}

/** Wheel input: one notch = one line in the wheel direction. */
export function wheelLines(deltaY: number): number {
  return deltaY === 0 ? 0 : deltaY > 0 ? 1 : -1
}
