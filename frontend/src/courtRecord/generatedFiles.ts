import { parseArtifact, type GeneratedArtifact } from '../artifacts/artifacts.ts'

/** Generated records only: never merge the static evidence manifest into this list. */
export function orderedGeneratedFiles(records: readonly GeneratedArtifact[]): GeneratedArtifact[] {
  const unique = new Map<string, GeneratedArtifact>()
  for (const record of records) {
    const safe = parseArtifact(record)
    if (safe && !unique.has(safe.id)) unique.set(safe.id, safe)
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export const GENERATED_GRID = { columns: 3, rows: 2, cell: 64, pageSize: 6 } as const

export function generatedPageCount(count: number): number {
  return Math.max(1, Math.ceil(count / GENERATED_GRID.pageSize))
}

export function generatedMove(index: number, count: number, key: string): number {
  if (!count) return 0
  const current = Math.min(Math.max(index, 0), count - 1)
  switch (key) {
    case 'ArrowLeft': return Math.max(0, current - 1)
    case 'ArrowRight': return Math.min(count - 1, current + 1)
    case 'ArrowUp': return current >= GENERATED_GRID.columns ? current - GENERATED_GRID.columns : current
    case 'ArrowDown': return current + GENERATED_GRID.columns < count ? current + GENERATED_GRID.columns : current
    case 'PageUp': return Math.max(0, current - GENERATED_GRID.pageSize)
    case 'PageDown': return Math.min(count - 1, current + GENERATED_GRID.pageSize)
    case 'Home': return 0
    case 'End': return count - 1
    default: return current
  }
}
