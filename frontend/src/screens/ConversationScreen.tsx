import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatBar } from '../components/ChatBar.tsx'
import { CourtRecordView } from '../components/CourtRecordView.tsx'
import { TalkOptions } from '../components/TalkOptions.tsx'
import type { LoadedCourtRecord } from '../courtRecord/courtRecord.ts'
import type { TalkOption } from '../courtRecord/talkOptions.ts'
import { DEV_TALK_TOPICS } from '../dev/talkTopics.ts'
import { DialogueBox } from '../components/DialogueBox.tsx'
import { GameScene } from '../components/GameScene.tsx'
import { ConversationDevPanel } from '../dev/ConversationDevPanel.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import type { PerformanceOverride } from '../engine/characterResolver.ts'
import { dialogueTextLayout } from '../engine/dialogueLayout.ts'
import type { DialogueLine } from '../engine/dialogueTypes.ts'
import type { Background, LoadedCharacter, SoundId, UiImage } from '../engine/manifestTypes.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { sendChat, timelineToLines, type ChatResponse } from '../engine/performance.ts'
import { playSfx } from '../engine/sfx.ts'
import { nextPhase, waitingOverride, waitingPerformance, type Phase } from '../engine/presentation.ts'
import { useBlips } from '../engine/useBlips.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { useTypewriter } from '../engine/useTypewriter.ts'
import { useSettings } from '../settings/settings.ts'
import { cancelTurn, type TurnTask } from '../artifacts/artifacts.ts'
import { ChatError } from '../engine/performance.ts'

interface ConversationScreenProps {
  character: LoadedCharacter
  background: Background | null
  /** Temporary scripted lines playable from the dev panel. */
  testScript: DialogueLine[]
  /** Court Record data (null when its manifest failed to load). */
  courtRecord: LoadedCourtRecord | null
  /** Backdrop for the Talk Options list (DS talk-option panel). */
  talkBackdrop: UiImage | null
  onExit: () => void
  /** Show temporary developer controls. */
  devTools: boolean
  onTaskChange?: (task: TurnTask | null) => void
}

/** Stage overlays opened from the conversation; they own the keyboard while open. */
type Overlay = 'talk' | 'court-record' | null

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
export function ConversationScreen({
  character, background, testScript, courtRecord, talkBackdrop, onExit, devTools, onTaskChange,
}: ConversationScreenProps) {
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
  const [overlay, setOverlay] = useState<Overlay>(null)
  const activeRequest = useRef<{ id: string; controller: AbortController; cancelRequested: boolean } | null>(null)
  useEffect(() => () => {
    activeRequest.current?.controller.abort()
    activeRequest.current = null
    onTaskChange?.(null)
  }, [onTaskChange])

  const performing = phase === 'performing'
  const line = performing ? lines[position.index] : undefined
  const lineKey = line ? `${position.pass}:${position.index}` : `settle:${position.pass}`
  // While the reply is generated the character holds its data-driven thinking pose (idle loop,
  // never talking, never a reaction); any request outcome leaves it through nextPhase.
  const waiting = phase === 'waiting'
  const emotion = line?.emotion ?? (waiting ? waitingPerformance(character).emotion : settle.emotion)
  const override: PerformanceOverride = line
    ? overrideFor(line)
    : waiting
      ? waitingOverride(character)
      : { ...(settle.animation ? { animation: settle.animation } : {}), reaction: null }

  const voice = voiceOverride ?? line?.voice ?? character.voice.blip ?? null
  useEffect(() => {
    if (voice) audioEngine.preload([voice])
  }, [voice])
  const onReveal = useBlips(voice, settings.blipVolume, settings.blipsMuted)

  // A reaction plays first; text waits until it has finished.
  // Beat SFX (D-048): only a beat's first page carries `sfx`, and it fires once per line key,
  // so paging forward or re-rendering never replays it. Volume is read at that moment.
  const sfxSettings = useRef({ volume: settings.sfxVolume, muted: settings.sfxMuted })
  useEffect(() => {
    sfxSettings.current = { volume: settings.sfxVolume, muted: settings.sfxMuted }
  })
  const lineSfx = line?.sfx ?? null
  useEffect(() => {
    const { volume, muted } = sfxSettings.current
    if (lineSfx) playSfx(lineSfx, volume, muted)
  }, [lineKey, lineSfx])

  const gate = useReactionGate(character, emotion, lineKey, override)
  const typewriter = useTypewriter(line?.text ?? '', lineKey, Boolean(line) && !gate.pending, settings.textSpeed, onReveal)
  const mode = line && typewriter.state === 'revealing' ? 'talking' : 'idle'
  const animation = useCharacterPlayback(character, emotion, mode, gate, override)

  const play = useCallback((next: DialogueLine[], nextSettle?: Settle) => {
    if (next.length === 0) return
    setLines(next)
    setSettle(nextSettle ?? { emotion: next[next.length - 1].emotion, animation: next[next.length - 1].animation })
    setPosition(({ pass }) => ({ index: 0, pass: pass + 1 }))
    setPhase((current) => (current === 'waiting' ? nextPhase(current, 'response') : 'performing'))
  }, [])

  const submit = useCallback(
    async (message: string) => {
      if (activeRequest.current) return
      const request = { id: crypto.randomUUID(), controller: new AbortController(), cancelRequested: false }
      activeRequest.current = request
      audioEngine.unlock()
      setChatError(null)
      setPhase((current) => nextPhase(current, 'submit'))
      onTaskChange?.({ id: request.id, state: 'working', cue: null, artifactId: null, error: null, cues: [] })
      try {
        const [response, layout] = await Promise.all([
          sendChat({ character: character.id, message, sessionId, requestId: request.id }, 135_000, {
            signal: request.controller.signal,
            onTask: (task) => { if (activeRequest.current === request) onTaskChange?.(task) },
          }),
          dialogueTextLayout(),
        ])
        if (activeRequest.current !== request || request.controller.signal.aborted) return
        setLastResponse(response)
        if (response.task?.error === 'invalid_artifact_action') {
          setChatError('The file instruction was rejected. Use .txt, .md or .py with nonempty UTF-8 text up to 64 KiB.')
        } else if (response.task?.error?.startsWith('artifact_')) {
          setChatError('The file could not be saved. Review generated-file storage and try again.')
        }
        play(timelineToLines(response.performance, layout), response.performance.settle)
      } catch (error) {
        if (activeRequest.current !== request) return
        onTaskChange?.({ id: request.id, state: 'failed', cue: null, artifactId: null,
          error: request.cancelRequested || request.controller.signal.aborted ? 'cancelled' : 'request_failed', cues: [] })
        if (request.cancelRequested || request.controller.signal.aborted || (error instanceof ChatError && error.cancelled)) {
          setPhase((current) => nextPhase(current, 'cancel'))
          return
        }
        setChatError(error instanceof Error ? error.message : String(error))
        play([{ text: "I couldn't finish that request. Please try again.", emotion: character.defaultEmotion, reaction: null }])
      } finally {
        if (activeRequest.current === request) activeRequest.current = null
      }
    },
    [
      character.id,
      character.defaultEmotion,
      sessionId,
      play,
      onTaskChange,
    ],
  )

  const cancel = async () => {
    const request = activeRequest.current
    if (!request) return
    request.cancelRequested = true
    const task = await cancelTurn(request.id)
    if (activeRequest.current !== request) return
    if (task) onTaskChange?.(task)
    // The atomic save may already have completed; let that final response finish coherently.
    if (task && (task.state === 'artifact-ready' || task.state === 'idle')) return
    request.controller.abort()
  }

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
        setPhase((current) => nextPhase(current, 'finished'))
      }
    }
  }, [line, typewriter, position.index, lines.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlay) return
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
  }, [advance, onExit, overlay])

  // A chosen topic is returned to the conversation as an ordinary user message.
  const chooseTopic = (option: TalkOption) => {
    setOverlay(null)
    void submit(option.label)
  }

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
          onClick={overlay ? undefined : advance}
        >
          {shown && (
            <DialogueBox
              speakerName={character.displayName}
              text={shown.text}
              visibleCount={line ? typewriter.visibleCount : shown.text.length}
              showContinue={Boolean(line) && typewriter.state === 'complete'}
            />
          )}
          {overlay === 'talk' && (
            <TalkOptions options={DEV_TALK_TOPICS} onSelect={chooseTopic} onCancel={() => setOverlay(null)}
              backdrop={talkBackdrop} />
          )}
          {overlay === 'court-record' && courtRecord && (
            <CourtRecordView record={courtRecord} onClose={() => setOverlay(null)} />
          )}
        </GameScene>
        <div className="conversation-actions">
          {waiting && <button type="button" onClick={() => void cancel()}>Cancel request</button>}
          <button type="button" disabled={phase !== 'input' || overlay !== null}
            onClick={() => { playMenuSound('menu_open'); setOverlay('talk') }}>Talk</button>
          {courtRecord && (
            <button type="button" disabled={overlay !== null}
              onClick={() => { playMenuSound('menu_open'); setOverlay('court-record') }}>Court Record</button>
          )}
        </div>
        <ChatBar
          placeholder={`Say something to ${character.displayName}…`}
          disabled={phase !== 'input'}
          waiting={phase === 'waiting'}
          waitingLabel={`${character.displayName} is thinking…`}
          error={chatError}
          onSubmit={submit}
          typingBlip={{ volume: settings.blipVolume, muted: settings.blipsMuted }}
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
