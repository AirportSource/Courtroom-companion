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
import { audioEngine } from '../engine/audioEngine.ts'
import { useReactionEffect } from '../engine/reactionEffect.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { selectPresentation } from '../engine/presentationContext.ts'

interface AnimationTestScreenProps {
  character: LoadedCharacter
  backgrounds: Background[]
  onExit: () => void
}

export function AnimationTestScreen({ character: sourceCharacter, backgrounds, onExit }: AnimationTestScreenProps) {
  const [presentationContext, setPresentationContext] = useState('conversation')
  const character = selectPresentation(sourceCharacter, presentationContext)
  const [emotion, setEmotion] = useState<EmotionId>(character.defaultEmotion)
  const [mode, setMode] = useState<TalkMode>('idle')
  // Bumped on every emotion selection so reactions replay even for the same emotion.
  const [playId, setPlayId] = useState(0)
  const [backgroundId, setBackgroundId] = useState<BackgroundId | null>(backgrounds[0]?.id ?? null)

  // Optional explicit reaction (e.g. Franziska's whip), replayed on every click; null = the
  // emotion's own binding.
  const [reaction, setReaction] = useState<string | null>(null)
  const override = reaction ? { reaction } : undefined
  const gate = useReactionGate(character, emotion, `${character.id}:${emotion}:${reaction ?? ''}:${playId}`, override)
  const { resolved, frame, frameIndex } = useCharacterPlayback(character, emotion, mode, gate, override)
  const effect = resolved?.variant === 'reaction' ? resolved.clip.effect : undefined
  const effectView = useReactionEffect(effect, effect ? gate.playKey : null, (event) => {
    audioEngine.unlock()
    audioEngine.playEvent(event, 1)
  })
  const background = backgrounds.find((bg) => bg.id === backgroundId) ?? null

  const selectEmotion = (next: EmotionId) => {
    setEmotion(next)
    setReaction(null)
    setPlayId((id) => id + 1)
  }
  const playReaction = (id: string) => {
    audioEngine.unlock()
    setReaction(id)
    setPlayId((n) => n + 1)
  }

  return (
    <div className="app-layout">
      <label>Presentation <select value={presentationContext} onChange={(event) => {
        setPresentationContext(event.target.value)
        setPlayId((id) => id + 1)
      }}>
        {[...new Set(['conversation', 'courtroom', ...Object.keys(sourceCharacter.presentationGroups ?? {})])].map((context) =>
          <option key={context} value={context}>{context}</option>)}
      </select></label>
      <div className="animation-test-stage">
      <GameScene
        background={background}
        characterFrame={frame}
        characterCanvas={resolved?.clip.canvas ?? null}
        characterAnchor={character.anchor}
        characterRender={character.render}
        effectFrame={effectView.frame}
        effectCanvas={effect?.overlay?.canvas ?? null}
        effectBackdrop={effectView.backdrop}
      />
      <div className="dev-buttons" aria-label="Play reaction">
        {Object.keys(character.reactions).map((id) => (
          <button key={id} type="button" onClick={() => playReaction(id)}>
            ⚡{id}{character.reactions[id].effect ? ' ✦' : ''}
          </button>
        ))}
      </div>
      </div>
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
