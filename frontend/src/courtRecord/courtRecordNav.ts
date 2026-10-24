// Pure navigation and layout for the Court Record screen. Everything is in logical stage pixels
// (256×192) and nothing here touches the DOM, so the rules are unit-tested directly.

export type CourtRecordTab = 'evidence' | 'profiles'

export const COURT_RECORD_TABS: readonly CourtRecordTab[] = ['evidence', 'profiles']

export type GridDirection = 'up' | 'down' | 'left' | 'right'

/**
 * Icon grid at native size: 64 px icons, 3 columns by 2 visible rows, centred horizontally above
 * the detail panel (which starts at y = 156). Rows scroll when there are more entries.
 */
export const GRID = {
  columns: 3,
  rows: 2,
  cell: 64,
  gapX: 8,
  gapY: 4,
  originX: 24,
  originY: 20,
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(index, 0), count - 1)
}

export function gridRowCount(count: number): number {
  return Math.ceil(count / GRID.columns)
}

/** Top-left logical position of the cell at (column, row) within the visible grid. */
export function cellOrigin(column: number, row: number): { x: number; y: number } {
  return {
    x: GRID.originX + column * (GRID.cell + GRID.gapX),
    y: GRID.originY + row * (GRID.cell + GRID.gapY),
  }
}

/** Arrow-key movement inside the grid. Clamped at the edges (no wrap). */
export function gridMove(index: number, count: number, direction: GridDirection): number {
  if (count <= 0) return 0
  const current = clampIndex(index, count)
  const last = count - 1
  switch (direction) {
    case 'left':
      return Math.max(0, current - 1)
    case 'right':
      return Math.min(last, current + 1)
    case 'up':
      return current - GRID.columns >= 0 ? current - GRID.columns : current
    case 'down':
      return current + GRID.columns <= last ? current + GRID.columns : current
  }
}

/** PageUp/PageDown: moves by one full visible page of cells, clamped. */
export function pageMove(index: number, count: number, direction: 'prev' | 'next'): number {
  if (count <= 0) return 0
  const step = GRID.columns * GRID.rows
  const current = clampIndex(index, count)
  return direction === 'next' ? Math.min(count - 1, current + step) : Math.max(0, current - step)
}

export function cycleTab(current: CourtRecordTab, direction: 'prev' | 'next'): CourtRecordTab {
  const tabs = COURT_RECORD_TABS
  const step = direction === 'next' ? 1 : tabs.length - 1
  return tabs[(tabs.indexOf(current) + step) % tabs.length]
}

/**
 * First visible row for a scrolling window of `visible` rows over `total` rows, moving as little
 * as possible from `previousStart` so the `selected` row stays on screen.
 */
export function scrollStart(selected: number, previousStart: number, visible: number, total: number): number {
  if (total <= visible) return 0
  let start = previousStart
  if (selected < start) start = selected
  else if (selected >= start + visible) start = selected - visible + 1
  return Math.min(Math.max(start, 0), total - visible)
}
