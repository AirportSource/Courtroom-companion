import { useCallback, useEffect, useState } from 'react'
import { DialogueBox } from '../components/DialogueBox.tsx'
import { GameScene } from '../components/GameScene.tsx'
import { ConversationDevPanel } from '../dev/ConversationDevPanel.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import type { DialogueLine } from '../engine/dialogueTypes.ts'
import type { Background, LoadedCharacter, SoundId } from '../engine/manifestTypes.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { useBlips } from '../engine/useBlips.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { useTypewriter } from '../engine/useTypewriter.ts'
import { useSettings } from '../settings/settings.ts'

interface ConversationScreenProps {
  character: LoadedCharacter
  background: Background | null
  script: DialogueLine[]
  onExit: () => void
  /** Show temporary developer controls. */
  devTools: boolean
}

/**
 * Plays a dialogue script with one on-screen character. Per line:
 * reaction (if the emotion has one) → TALKING while text reveals with blips → IDLE + continue
 * indicator. Click / Enter / Space skips the reveal, then advances. Esc leaves.
 */
export function ConversationScreen({ character, background, script, onExit, devTools }: ConversationScreenProps) {
  const { settings } = useSettings()
  const [position, setPosition] = useState({ index: 0, pass: 0 })
  const [voiceOverride, setVoiceOverride] = useState<SoundId | null>(null)

  const line = script[position.index] ?? { emotion: character.defaultEmotion, text: '' }
  const lineKey = `${position.pass}:${position.index}`

  const voice = voiceOverride ?? line.voice ?? character.voice.blip ?? null
  useEffect(() => {
    if (voice) audioEngine.preload([voice])
  }, [voice])
  const onReveal = useBlips(voice, settings.blipVolume, settings.blipsMuted)

  // A reaction (e.g. "surprised") plays first; text waits until it has finished.
  const gate = useReactionGate(character, line.emotion, lineKey)
  const typewriter = useTypewriter(line.text, lineKey, !gate.pending, settings.textSpeed, onReveal)
  const mode = typewriter.state === 'revealing' ? 'talking' : 'idle'
  const animation = useCharacterPlayback(character, line.emotion, mode, gate)

  const advance = useCallback(() => {
    audioEngine.unlock()
    if (typewriter.state === 'revealing') {
      typewriter.skip()
    } else if (typewriter.state === 'complete' && script.length > 0) {
      setPosition(({ index, pass }) =>
        index + 1 < script.length ? { index: index + 1, pass } : { index: 0, pass: pass + 1 },
      )
    }
  }, [typewriter, script.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('.dev-panel')) return
      if (['Enter', ' ', 'z', 'Z'].includes(event.key)) {
        event.preventDefault()
        advance()
      } else if (event.key === 'Escape') {
        playMenuSound('menu_cancel')
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, onExit])

  return (
    <div className="app-layout">
      <GameScene
        background={background}
        characterFrame={animation.frame}
        characterCanvas={animation.resolved?.clip.canvas ?? null}
        characterAnchor={character.anchor}
        characterRender={character.render}
        onClick={advance}
      >
        <DialogueBox
          speakerName={character.displayName}
          text={line.text}
          visibleCount={typewriter.visibleCount}
          showContinue={typewriter.state === 'complete'}
        />
      </GameScene>
      {devTools && (
        <ConversationDevPanel
          lineNumber={position.index + 1}
          lineCount={script.length}
          line={line}
          typewriterState={typewriter.state}
          animation={animation}
          background={background}
          render={character.render}
          voice={voice}
          voiceOverride={voiceOverride}
          onVoiceOverrideChange={setVoiceOverride}
          onRestart={() => setPosition(({ pass }) => ({ index: 0, pass: pass + 1 }))}
          onReplayLine={(forced) => {
            setVoiceOverride(forced)
            setPosition(({ index, pass }) => ({ index, pass: pass + 1 }))
          }}
          onExit={onExit}
        />
      )}
    </div>
  )
}
