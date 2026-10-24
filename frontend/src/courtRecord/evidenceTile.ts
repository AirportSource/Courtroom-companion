// Pure geometry for the evidence tile: a native-size DS frame with a 64×64 content window.
import type { UiImage } from '../engine/manifestTypes.ts'

/** Logical size of the content window inside the frame (and of the frameless fallback tile). */
export const TILE_WINDOW = 64

export interface TileGeometry {
  /** Outer tile size in logical pixels. */
  size: { width: number; height: number }
  /** Top-left of the 64×64 content window inside the tile (integer). */
  window: { left: number; top: number }
  /** Top-left of the content image inside the window (integer, centred, may be negative if oversized). */
  content: { left: number; top: number }
  framed: boolean
}

const positive = (value: number): boolean => Number.isFinite(value) && value > 0

/**
 * Frame present: tile is the frame at native size, the window is centred in it. Frame absent (or
 * invalid): a plain 64×64 tile. Every coordinate is an integer so pixel art is never resampled.
 */
export function tileGeometry(frame: Pick<UiImage, 'width' | 'height'> | null | undefined,
  content: Pick<UiImage, 'width' | 'height'> | null | undefined): TileGeometry {
  const framed = !!frame && positive(frame.width) && positive(frame.height)
    && frame.width >= TILE_WINDOW && frame.height >= TILE_WINDOW
  const width = framed ? Math.round(frame.width) : TILE_WINDOW
  const height = framed ? Math.round(frame.height) : TILE_WINDOW
  const window = { left: Math.floor((width - TILE_WINDOW) / 2), top: Math.floor((height - TILE_WINDOW) / 2) }
  const cw = content && positive(content.width) ? Math.round(content.width) : TILE_WINDOW
  const ch = content && positive(content.height) ? Math.round(content.height) : TILE_WINDOW
  return { size: { width, height }, window,
    content: { left: Math.floor((TILE_WINDOW - cw) / 2), top: Math.floor((TILE_WINDOW - ch) / 2) }, framed }
}

/** Grid for 70×70 tiles on the 256×192 stage: 3 columns × 2 rows, centred, clear of header/footer. */
export const TILE_GRID = {
  columns: 3,
  rows: 2,
  pageSize: 6,
  tile: 70,
  gapX: 8,
  gapY: 3,
  originX: 15,
  originY: 17,
} as const

export function tileSlotOrigin(slot: number, tile: number = TILE_GRID.tile): { left: number; top: number } {
  return {
    left: TILE_GRID.originX + (slot % TILE_GRID.columns) * (tile + TILE_GRID.gapX),
    top: TILE_GRID.originY + Math.floor(slot / TILE_GRID.columns) * (tile + TILE_GRID.gapY),
  }
}
