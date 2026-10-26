import type { ReactNode } from 'react'
import type { Background, CanvasSize, CharacterAnchor, CharacterRender, SpriteFrame } from '../engine/manifestTypes.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../engine/stage.ts'
import { BackgroundRenderer } from './BackgroundRenderer.tsx'
import { CharacterSprite } from './CharacterSprite.tsx'
import { PixelStage } from './PixelStage.tsx'

interface GameSceneProps {
  background: Background | null
  characterFrame: SpriteFrame | null
  characterCanvas: CanvasSize | null
  characterAnchor: CharacterAnchor
  characterRender: CharacterRender
  /** One-shot reaction overlay frame (D-091), drawn above the character; null = none. */
  effectFrame?: SpriteFrame | null
  /** Canvas of the overlay clip, centred on the stage. */
  effectCanvas?: CanvasSize | null
  /** Full-stage reaction backdrop (e.g. black fading back to the scene), below the overlay. */
  effectBackdrop?: { color: string; state: 'on' | 'fade'; fadeMs: number } | null
  onClick?: () => void
  /** UI layered above the scene (dialogue box etc.). */
  children?: ReactNode
}

/** Scene layers, back to front: background → character → background foreground (counter, glass
 * frame) → reaction effect → overlay UI, all in stage pixels. */
export function GameScene({
  background,
  characterFrame,
  characterCanvas,
  characterAnchor,
  characterRender,
  effectFrame = null,
  effectCanvas = null,
  effectBackdrop = null,
  onClick,
  children,
}: GameSceneProps) {
  const effectCanvasSize = effectCanvas ?? { width: STAGE_WIDTH, height: STAGE_HEIGHT }
  // A room can seat characters lower (detention center: behind the counter, D-096).
  const roomOffsetY = background?.characterOffsetY ?? 0
  const render = roomOffsetY ? { ...characterRender, offsetY: characterRender.offsetY + roomOffsetY } : characterRender
  return (
    <PixelStage onClick={onClick}>
      <BackgroundRenderer background={background} stageWidth={STAGE_WIDTH} stageHeight={STAGE_HEIGHT} />
      <CharacterSprite
        frame={characterFrame}
        canvas={characterCanvas}
        anchor={characterAnchor}
        render={render}
        stageWidth={STAGE_WIDTH}
        stageHeight={STAGE_HEIGHT}
      />
      <BackgroundRenderer background={background} stageWidth={STAGE_WIDTH} stageHeight={STAGE_HEIGHT} layer="foreground" />
      {effectBackdrop && (
        <div
          className="stage-effect stage-effect-backdrop"
          style={{
            backgroundColor: effectBackdrop.color,
            // Opaque, then a slow ease-in fade: the scene comes back like eyes opening again.
            opacity: effectBackdrop.state === 'fade' ? 0 : 1,
            transition: effectBackdrop.state === 'fade' ? `opacity ${effectBackdrop.fadeMs}ms ease-in` : 'none',
          }}
          data-testid="reaction-backdrop"
        />
      )}
      {effectFrame && (
        <img
          className="stage-layer stage-effect"
          src={effectFrame.url}
          width={effectFrame.width}
          height={effectFrame.height}
          style={{
            left: Math.floor((STAGE_WIDTH - effectCanvasSize.width) / 2) + effectFrame.x,
            top: Math.floor((STAGE_HEIGHT - effectCanvasSize.height) / 2) + effectFrame.y,
            width: effectFrame.width,
            height: effectFrame.height,
          }}
          alt=""
          draggable={false}
          data-testid="reaction-effect"
        />
      )}
      {children}
    </PixelStage>
  )
}
