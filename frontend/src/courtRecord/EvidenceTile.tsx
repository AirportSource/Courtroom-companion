import { useState, type ReactNode } from 'react'
import type { UiImage } from '../engine/manifestTypes.ts'
import { tileGeometry, TILE_WINDOW } from './evidenceTile.ts'
import './court-record.css'

export interface EvidenceTileProps {
  /** Native evidence frame (ui.images.evidence_frame). Missing or failing to load = plain tile. */
  frame?: UiImage | null
  /** Icon or portrait drawn at native size, centred in the 64×64 window. */
  image?: UiImage | null
  /** Custom window content instead of `image` (fitted to 64×64). */
  children?: ReactNode
  /** Cursor drawn outside the frame; frame pixels are never altered. */
  selected?: boolean
  /** Empty slot: frame with an empty window. */
  empty?: boolean
  onImageError?: () => void
}

/** Purely visual tile; interactive wrappers (buttons) are supplied by the caller. */
export function EvidenceTile({ frame = null, image = null, children, selected = false, empty = false,
  onImageError }: EvidenceTileProps) {
  const [failedFrame, setFailedFrame] = useState<string | null>(null)
  const usable = frame && failedFrame !== frame.url ? frame : null
  const geo = tileGeometry(usable, image)
  const className = ['ev-tile', geo.framed ? 'ev-tile--framed' : 'ev-tile--plain', selected && 'ev-tile--selected',
    empty && 'ev-tile--empty'].filter(Boolean).join(' ')
  return (
    <span className={className} style={{ width: geo.size.width, height: geo.size.height }} aria-hidden="true">
      <span className="ev-tile__window" style={{ left: geo.window.left, top: geo.window.top, width: TILE_WINDOW, height: TILE_WINDOW }}>
        {!empty && (children ?? (image ? <img className="ev-tile__image" src={image.url} alt="" draggable={false}
          width={image.width} height={image.height} style={{ left: geo.content.left, top: geo.content.top }}
          onError={onImageError} /> : null))}
      </span>
      {usable && <img className="ev-tile__frame" src={usable.url} alt="" draggable={false}
        width={usable.width} height={usable.height} onError={() => setFailedFrame(usable.url)} />}
    </span>
  )
}
