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
  onClick?: () => void
  /** UI layered above the scene (dialogue box etc.). */
  children?: ReactNode
}

/** Scene layers, back to front: background → character → overlay UI, all in stage pixels. */
export function GameScene({
  background,
  characterFrame,
  characterCanvas,
  characterAnchor,
  characterRender,
  onClick,
  children,
}: GameSceneProps) {
  return (
    <PixelStage onClick={onClick}>
      <BackgroundRenderer background={background} stageWidth={STAGE_WIDTH} stageHeight={STAGE_HEIGHT} />
      <CharacterSprite
        frame={characterFrame}
        canvas={characterCanvas}
        anchor={characterAnchor}
        render={characterRender}
        stageWidth={STAGE_WIDTH}
        stageHeight={STAGE_HEIGHT}
      />
      {children}
    </PixelStage>
  )
}
