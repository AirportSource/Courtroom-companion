import { useRef, type ReactNode } from 'react'
import { useDevDisplay } from '../dev/devDisplay.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../engine/stage.ts'
import { useStageScale } from '../engine/useStageScale.ts'

interface PixelStageProps {
  children: ReactNode
  onClick?: () => void
  label?: string
}

/**
 * A 256×192 logical-pixel surface. Everything inside (background, sprites, UI) shares this
 * coordinate system and the whole surface is scaled as one unit, by the largest whole factor
 * that fits ("auto") or by a fixed factor chosen in the dev panel.
 */
export function PixelStage({ children, onClick, label }: PixelStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const autoScale = useStageScale(viewportRef, STAGE_WIDTH, STAGE_HEIGHT)
  const { display } = useDevDisplay()
  const scale = display.scale === 'auto' ? autoScale : display.scale

  return (
    <div className="scene-viewport" ref={viewportRef}>
      <div
        className="scene-frame"
        style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}
        onClick={onClick}
        aria-label={label}
      >
        <div
          className="scene-stage"
          data-scale={scale}
          style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
