import { useDevDisplay } from '../dev/devDisplay.ts'
import type { CanvasSize, CharacterAnchor, CharacterRender, SpriteFrame } from '../engine/manifestTypes.ts'

interface CharacterSpriteProps {
  frame: SpriteFrame | null
  /** Canvas of the clip the frame belongs to. */
  canvas: CanvasSize | null
  anchor: CharacterAnchor
  /** Character render profile from the manifest (scale + anchor offset). */
  render: CharacterRender
  stageWidth: number
  stageHeight: number
}

/**
 * Draws one sprite frame. The clip's canvas, not the individual frame, is anchored:
 * its bottom-centre sits on the stage's bottom-centre shifted by the render offsets, and
 * the frame is drawn at its offset inside the canvas. Everything is scaled by the render
 * scale around that anchor and snapped to whole stage pixels. Nothing here is specific to
 * one character: placement comes from the manifest (and temporary dev overrides).
 */
export function CharacterSprite({ frame, canvas, anchor, render, stageWidth, stageHeight }: CharacterSpriteProps) {
  const { display } = useDevDisplay()
  if (!frame) return null

  const override = display.character
  const scale = override.scale ?? render.scale
  const offsetX = override.offsetX ?? render.offsetX
  const offsetY = override.offsetY ?? render.offsetY

  const box =
    display.alignment === 'canvas' && canvas ? canvas : { width: frame.width, height: frame.height }
  const inCanvasX = box === canvas ? frame.x : 0
  const inCanvasY = box === canvas ? frame.y : 0

  // Anchor point in stage pixels, then the scaled canvas hangs from it.
  const anchorX = (anchor.horizontal === 'center' ? Math.floor(stageWidth / 2) : 0) + offsetX
  const anchorY = (anchor.vertical === 'bottom' ? stageHeight : 0) + offsetY
  const canvasWidth = Math.round(box.width * scale)
  const canvasHeight = Math.round(box.height * scale)
  const canvasLeft = anchorX - Math.floor(canvasWidth / 2)
  const canvasTop = anchorY - canvasHeight
  const left = canvasLeft + Math.round(inCanvasX * scale)
  const top = canvasTop + Math.round(inCanvasY * scale)
  const width = Math.round(frame.width * scale)
  const height = Math.round(frame.height * scale)

  return (
    <>
      <img
        className="stage-layer"
        src={frame.url}
        width={width}
        height={height}
        style={{ left, top, width, height }}
        alt=""
        draggable={false}
      />
      {display.debugOverlay && (
        <div className="sprite-debug" aria-hidden="true">
          <div
            className="sprite-debug-canvas"
            style={{ left: canvasLeft, top: canvasTop, width: canvasWidth, height: canvasHeight }}
          />
          <div className="sprite-debug-frame" style={{ left, top, width, height }} />
          <div className="sprite-debug-baseline" style={{ top: anchorY - 1 }} />
          <div className="sprite-debug-anchor" style={{ left: anchorX - 1, top: anchorY - 3 }} />
        </div>
      )}
    </>
  )
}
