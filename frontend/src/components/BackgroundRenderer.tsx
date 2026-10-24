import type { Background } from '../engine/manifestTypes.ts'

interface BackgroundRendererProps {
  background: Background | null
  stageWidth: number
  stageHeight: number
}

/** Draws a background at native resolution, centred on the stage (wide ones are cropped). */
export function BackgroundRenderer({ background, stageWidth, stageHeight }: BackgroundRendererProps) {
  if (!background) return null
  return (
    <img
      className="stage-layer"
      src={background.url}
      width={background.width}
      height={background.height}
      style={{
        left: Math.floor((stageWidth - background.width) / 2),
        top: Math.floor((stageHeight - background.height) / 2),
      }}
      alt=""
      draggable={false}
    />
  )
}
