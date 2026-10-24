// Development-only Phase 2A asset/animation inspector (manual emotion + idle/talking control).
import { useState } from 'react'
import { DevPanel } from '../components/DevPanel.tsx'
import { GameScene } from '../components/GameScene.tsx'
import type {
  Background,
  BackgroundId,
  EmotionId,
  LoadedCharacter,
  TalkMode,
} from '../engine/manifestTypes.ts'
import { useCharacterAnimation } from '../engine/useCharacterAnimation.ts'

interface AnimationTestScreenProps {
  character: LoadedCharacter
  backgrounds: Background[]
  onExit: () => void
}

export function AnimationTestScreen({ character, backgrounds, onExit }: AnimationTestScreenProps) {
  const [emotion, setEmotion] = useState<EmotionId>(character.defaultEmotion)
  const [mode, setMode] = useState<TalkMode>('idle')
  // Bumped on every emotion selection so reactions replay even for the same emotion.
  const [playId, setPlayId] = useState(0)
  const [backgroundId, setBackgroundId] = useState<BackgroundId | null>(backgrounds[0]?.id ?? null)

  const { resolved, frame, frameIndex } = useCharacterAnimation(character, emotion, mode, playId)
  const background = backgrounds.find((bg) => bg.id === backgroundId) ?? null

  const selectEmotion = (next: EmotionId) => {
    setEmotion(next)
    setPlayId((id) => id + 1)
  }

  return (
    <div className="app-layout">
      <GameScene
        background={background}
        characterFrame={frame}
        characterCanvas={resolved?.clip.canvas ?? null}
        characterAnchor={character.anchor}
        characterRender={character.render}
      />
      <DevPanel
        character={character}
        emotion={emotion}
        onEmotionChange={selectEmotion}
        mode={mode}
        onModeChange={setMode}
        backgrounds={backgrounds}
        backgroundId={backgroundId}
        onBackgroundChange={setBackgroundId}
        resolved={resolved}
        frameIndex={frameIndex}
        onExit={onExit}
      />
    </div>
  )
}
