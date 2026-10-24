import type { UiImage } from '../engine/manifestTypes.ts'
import type { Exclamation } from './eventInbox.ts'
import './exclamation.css'

const ALT: Record<Exclamation, string> = { objection: 'Objection!', hold_it: 'Hold it!', take_that: 'Take that!' }

/**
 * Original full-screen exclamation bubble (ui.json `exclamation_*`, native 256×192) with the DS
 * shake. Falls back to a CSS caption when the image is missing.
 */
export function ExclamationBubble({ kind, image }: { kind: Exclamation; image: UiImage | null }) {
  return (
    <div className="exclamation" role="img" aria-label={ALT[kind]}>
      {image
        ? <img className="exclamation-image" src={image.url} width={image.width} height={image.height} alt="" draggable={false} />
        : <span className="exclamation-fallback">{ALT[kind]}</span>}
    </div>
  )
}
