import type { UiImage } from '../engine/manifestTypes.ts'

/** A full-stage UI image (e.g. an original DS menu panel) drawn at native size at (0, 0). */
export function StageBackdrop({ image }: { image: UiImage | null }) {
  if (!image) return null
  return (
    <img
      className="stage-layer"
      src={image.url}
      width={image.width}
      height={image.height}
      style={{ left: 0, top: 0 }}
      alt=""
      draggable={false}
    />
  )
}
