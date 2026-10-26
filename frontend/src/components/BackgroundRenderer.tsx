import type { Background } from '../engine/manifestTypes.ts'

interface BackgroundRendererProps {
  background: Background | null
  stageWidth: number
  stageHeight: number
  /** Draw the background's foreground layer (in front of the character) instead of the plate. */
  layer?: 'plate' | 'foreground'
}

/** Draws a background at native resolution, centred on the stage (wide ones are cropped). */
export function BackgroundRenderer({ background, stageWidth, stageHeight, layer = 'plate' }: BackgroundRendererProps) {
  const src = layer === 'foreground' ? background?.foregroundUrl : background?.url
  if (!background || !src) return null
  return (
    <img
      className={layer === 'foreground' ? 'stage-layer stage-foreground' : 'stage-layer'}
      src={src}
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
