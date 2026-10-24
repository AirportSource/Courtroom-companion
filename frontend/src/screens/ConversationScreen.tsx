import { useCallback, useEffect, useState } from 'react'
import { ChatBar } from '../components/ChatBar.tsx'
import { DialogueBox } from '../components/DialogueBox.tsx'
import { GameScene } from '../components/GameScene.tsx'
import { ConversationDevPanel } from '../dev/ConversationDevPanel.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import type { PerformanceOverride } from '../engine/characterResolver.ts'
import { dialogueTextLayout } from '../engine/dialogueLayout.ts'
import type { DialogueLine } from '../engine/dialogueTypes.ts'
import type { Background, LoadedCharacter, SoundId } from '../engine/manifestTypes.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { sendChat, timelineToLines, type ChatResponse } from '../engine/performance.ts'
import { useBlips } from '../engine/useBlips.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { useTypewriter } from '../engine/useTypewriter.ts'
import { useSettings } from '../settings/settings.ts'

interface ConversationScreenProps {
  character: LoadedCharacter
  background: Background | null
  /** Temporary scripted lines playable from the dev panel. */
  testScript: DialogueLine[]
  onExit: () => void
  /** Show temporary developer controls. */
  devTools: boolean
}

type Phase = 'input' | 'waiting' | 'performing'

interface Settle {
  emotion: string
  animation?: string
}

function overrideFor(line: DialogueLine): PerformanceOverride {
  return {
    ...(line.animation ? { animation: line.animation } : {}),
    ...(line.reaction !== undefined ? { reaction: line.reaction } : {}),
  }
}

/**
 * Conversation with one on-screen character. The user types a message; the backend's
 * Character Director returns a performance timeline that is played through the existing
 * dialogue engine, line by line: reaction (if any) → TALKING while text reveals with blips →
 * IDLE + continue indicator. Click / Enter / Space skips, then advances. After the last line
 * the character settles into the director's end pose and the input comes back. Esc leaves.
 */
export function ConversationScreen({ character, background, testScript, onExit, devTools }: ConversationScreenProps) {
  const { settings } = useSettings()
  const [sessionId] = useState(() => crypto.randomUUID())
  const [phase, setPhase] = useState<Phase>('input')
  const [lines, setLines] = useState<DialogueLine[]>([])
  const [position, setPosition] = useState({ index: 0, pass: 0 })
  const [settle, setSettle] = useState<Settle>({ emotion: character.defaultEmotion })
  const [lastShown, setLastShown] = useState<DialogueLine | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null)
  const [voiceOverride, setVoiceOverride] = useState<SoundId | null>(null)

  const performing = phase === 'performing'
  const line = performing ? lines[position.index] : undefined
  const lineKey = line ? `${position.pass}:${position.index}` : `settle:${position.pass}`
  const emotion = line?.emotion ?? settle.emotion
  const override: PerformanceOverride = line
    ? overrideFor(line)
    : { ...(settle.animation ? { animation: settle.animation } : {}), reaction: null }

  const voice = voiceOverride ?? line?.voice ?? character.voice.blip ?? null
  useEffect(() => {
    if (voice) audioEngine.preload([voice])
  }, [voice])
  const onReveal = useBlips(voice, settings.blipVolume, settings.blipsMuted)

  // A reaction plays first; text waits until it has finished.
  const gate = useReactionGate(character, emotion, lineKey, override)
  const typewriter = useTypewriter(line?.text ?? '', lineKey, Boolean(line) && !gate.pending, settings.textSpeed, onReveal)
  const mode = line && typewriter.state === 'revealing' ? 'talking' : 'idle'
  const animation = useCharacterPlayback(character, emotion, mode, gate, override)

  const play = useCallback((next: DialogueLine[], nextSettle?: Settle) => {
    if (next.length === 0) return
    setLines(next)
    setSettle(nextSettle ?? { emotion: next[next.length - 1].emotion, animation: next[next.length - 1].animation })
    setPosition(({ pass }) => ({ index: 0, pass: pass + 1 }))
    setPhase('performing')
  }, [])

  const submit = useCallback(
    async (message: string) => {
      audioEngine.unlock()
      setChatError(null)
      setPhase('waiting')
      try {
        if (settings.aiProvider === 'ollama' && !settings.ollamaModel) {
          throw new Error('select an Ollama model in Settings first')
        }
        const provider =
          settings.aiProvider === 'ollama'
            ? { type: 'ollama' as const, baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel }
            : { type: 'fake' as const }
        const [response, layout] = await Promise.all([
          sendChat({ character: character.id, message, sessionId, provider }),
          dialogueTextLayout(),
        ])
        setLastResponse(response)
        play(timelineToLines(response.performance, layout), response.performance.settle)
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error))
        setPhase('input')
      }
    },
    [character.id, sessionId, play, settings.aiProvider, settings.ollamaBaseUrl, settings.ollamaModel],
  )

  const advance = useCallback(() => {
    audioEngine.unlock()
    if (!line) return
    if (typewriter.state === 'revealing') {
      typewriter.skip()
    } else if (typewriter.state === 'complete') {
      if (position.index + 1 < lines.length) {
        setPosition(({ index, pass }) => ({ index: index + 1, pass }))
      } else {
        setLastShown(line)
        setPhase('input')
      }
    }
  }, [line, typewriter, position.index, lines.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('.dev-panel, input, textarea, button, select')) {
        return
      }
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

  const shown = line ?? lastShown

  return (
    <div className="app-layout">
      <div className="scene-column">
        <GameScene
          background={background}
          characterFrame={animation.frame}
          characterCanvas={animation.resolved?.clip.canvas ?? null}
          characterAnchor={character.anchor}
          characterRender={character.render}
          onClick={advance}
        >
          {shown && (
            <DialogueBox
              speakerName={character.displayName}
              text={shown.text}
              visibleCount={line ? typewriter.visibleCount : shown.text.length}
              showContinue={Boolean(line) && typewriter.state === 'complete'}
            />
          )}
        </GameScene>
        <ChatBar
          placeholder={`Say something to ${character.displayName}…`}
          disabled={phase !== 'input'}
          waiting={phase === 'waiting'}
          waitingLabel={`${character.displayName} is thinking…`}
          error={chatError}
          onSubmit={submit}
        />
      </div>
      {devTools && (
        <ConversationDevPanel
          lineNumber={position.index + 1}
          lineCount={lines.length}
          line={line ?? { emotion: settle.emotion, text: '', animation: settle.animation }}
          phase={phase}
          typewriterState={typewriter.state}
          animation={animation}
          background={background}
          render={character.render}
          voice={voice}
          voiceOverride={voiceOverride}
          onVoiceOverrideChange={setVoiceOverride}
          lastResponse={lastResponse}
          onPlayTestScript={() => play(testScript)}
          onReplayLine={(forced) => {
            if (!lines.length) return
            setVoiceOverride(forced)
            setPosition(({ index, pass }) => ({ index: performing ? index : lines.length - 1, pass: pass + 1 }))
            setPhase('performing')
          }}
          onExit={onExit}
        />
      )}
    </div>
  )
}
