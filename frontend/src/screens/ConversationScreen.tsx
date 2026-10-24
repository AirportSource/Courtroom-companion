import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ChatBar } from '../components/ChatBar.tsx'
import { GeneratedFilesCourtRecord } from '../courtRecord/GeneratedFilesCourtRecord.tsx'
import { ConversationRecordView } from '../conversationRecord/ConversationRecordView.tsx'
import { TalkOptions } from '../components/TalkOptions.tsx'
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
import { paginate, sendChat, timelineToLines, type ChatResponse } from '../engine/performance.ts'
import { taskAcknowledgement } from '../engine/taskAcknowledgements.ts'
import { musicRuntime } from '../music/musicRuntime.ts'
import { startPhoneRinging, type PhoneRingingHandle } from '../artifacts/phoneRinging.ts'
import { playSfx, SFX_EVENTS, type SfxName } from '../engine/sfx.ts'
import { nextPhase, waitingOverride, waitingPerformance, type Phase } from '../engine/presentation.ts'
import { useBlips } from '../engine/useBlips.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { useTypewriter } from '../engine/useTypewriter.ts'
import { useSettings } from '../settings/settings.ts'
import { cancelTurn } from '../artifacts/artifacts.ts'
import { ChatError } from '../engine/performance.ts'
import { generationFailureMessage } from '../engine/generation.ts'
import { ArtifactDeliveryOverlay } from '../artifacts/ArtifactDeliveryOverlay.tsx'
import {
  ARTIFACT_SUMMON_AUTO_MS,
  ARTIFACT_SUMMON_MIN_MS,
  ARTIFACT_WORKING_MIN_MS,
  TASK_ACKNOWLEDGEMENT_HOLD_MS,
  artifactDeliveryReducer,
  initialArtifactDelivery,
} from '../artifacts/artifactDelivery.ts'
import type { GeneratedArtifact, TurnTask } from '../artifacts/artifacts.ts'

interface ConversationScreenProps {
  character: LoadedCharacter
  background: Background | null
  /** Temporary scripted lines playable from the dev panel. */
  testScript: DialogueLine[]
  /** Backdrop for the Talk Options list (DS talk-option panel). */
  talkBackdrop: UiImage | null
  generatedArtifacts: GeneratedArtifact[]
  artifactsLoading: boolean
  artifactsError: string | null
  onArtifactsChanged: () => Promise<void>
  fileIcon: UiImage | null
  thinkerIcon: UiImage | null
  phoneIcon: UiImage | null
  onExit: () => void
  /** Native evidence frame (ui.images.evidence_frame) for file tiles, the summon and record slots. */
  evidenceFrame?: UiImage | null
  portraitFor: (characterId: string) => UiImage | null
  nameFor: (characterId: string) => string | null
  /** Show temporary developer controls. */
  devTools: boolean
  onTaskChange?: (task: TurnTask | null) => void
}

/** Stage overlays opened from the conversation; they own the keyboard while open. */
type Overlay = 'talk' | 'court-record' | 'conversation-record' | null
interface SfxPlaybackDiagnostic { name: string; event: string; played: boolean; reason: string; source: 'dialogue' | 'audition' }

interface Settle {
  emotion: string
  animation?: string
}
interface ActiveRequest {
  id: string
  controller: AbortController
  cancelRequested: boolean
  acknowledgement: Promise<void> | null
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
  character, background, testScript, talkBackdrop, generatedArtifacts, artifactsLoading, artifactsError,
  onArtifactsChanged, fileIcon, thinkerIcon, phoneIcon, onExit, devTools, onTaskChange,
  evidenceFrame = null, portraitFor, nameFor,
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
  const [sfxPlayback, setSfxPlayback] = useState<SfxPlaybackDiagnostic[]>([])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [delivery, dispatchDelivery] = useReducer(artifactDeliveryReducer, undefined, initialArtifactDelivery)
  const [currentTask, setCurrentTask] = useState<TurnTask | null>(null)
  const currentTaskRef = useRef<TurnTask | null>(null)
  const [summonCanAdvance, setSummonCanAdvance] = useState(false)
  const activeRequest = useRef<ActiveRequest | null>(null)
  const pendingReply = useRef<{ turnId: string; lines: DialogueLine[]; settle?: Settle; response?: ChatResponse } | null>(null)
  const acknowledgementSequence = useRef(0)
  const stopRinging = useRef<PhoneRingingHandle | null>(null)
  const deliverySounds = useRef(new Set<string>())
  const releasedTurns = useRef(new Set<string>())
  const summonFinishStarted = useRef(new Set<string>())
  const revealTimer = useRef<number | null>(null)
  const playedSfxLineKey = useRef<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
  // Until the first backend workload snapshot, hold the current idle pose. An artifact hint
  // presents local acknowledgement before thinking; ordinary dialogue still waits normally.
  const thinking = waiting && (currentTask?.expectedWorkload !== undefined || delivery.phase === 'artifact-working')
  const emotion = line?.emotion ?? (thinking ? waitingPerformance(character).emotion : settle.emotion)
  const override: PerformanceOverride = line
    ? overrideFor(line)
    : thinking
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
    if (lineSfx && playedSfxLineKey.current !== lineKey) {
      playedSfxLineKey.current = lineKey
      const played = playSfx(lineSfx, volume, muted)
      if (devTools) {
        const lastDiagnostic = audioEngine.getRecentEventDiagnostics().at(-1)
        const diagnostic = lastDiagnostic?.event === SFX_EVENTS[lineSfx] ? lastDiagnostic : null
        setSfxPlayback((events) => [...events.slice(-9), {
          name: lineSfx, event: SFX_EVENTS[lineSfx], played,
          reason: muted ? 'muted' : volume <= 0 ? 'zero volume' : diagnostic?.reason ?? 'play request rejected',
          source: 'dialogue',
        }])
      }
    }
  }, [lineKey, lineSfx, devTools])

  const auditionSfx = useCallback(async (name: SfxName) => {
    audioEngine.unlock()
    const event = SFX_EVENTS[name]
    const ready = await audioEngine.prepareEvent(event)
    const { volume, muted } = sfxSettings.current
    const played = ready && playSfx(name, volume, muted)
    const lastDiagnostic = audioEngine.getRecentEventDiagnostics().at(-1)
    const diagnostic = lastDiagnostic?.event === event ? lastDiagnostic : null
    setSfxPlayback((events) => [...events.slice(-9), {
      name, event, played,
      reason: muted ? 'muted' : volume <= 0 ? 'zero volume' : diagnostic?.reason ?? (ready ? 'play request rejected' : 'WAV failed to load/decode'),
      source: 'audition',
    }])
  }, [])

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

  const playDeliverySound = useCallback((turnId: string, event: string) => {
    const key = `${turnId}:${event}`
    if (deliverySounds.current.has(key)) return
    deliverySounds.current.add(key)
    if (!settings.sfxMuted && settings.sfxVolume > 0) audioEngine.playEvent(event, settings.sfxVolume)
  }, [settings.sfxMuted, settings.sfxVolume])

  useEffect(() => {
    if (delivery.phase !== 'waiting-for-phone-acknowledgement') return
    const { volume, muted } = sfxSettings.current
    const stop = startPhoneRinging(audioEngine, musicRuntime().engine, muted ? 0 : volume)
    stopRinging.current = stop
    return () => { stop(); if (stopRinging.current === stop) stopRinging.current = null }
  }, [delivery.phase, delivery.turnId])

  useEffect(() => {
    stopRinging.current?.setVolume(settings.sfxMuted ? 0 : settings.sfxVolume)
  }, [settings.sfxMuted, settings.sfxVolume])

  const acknowledgePhone = useCallback(() => {
    const turnId = delivery.turnId
    if (!turnId || delivery.phase !== 'waiting-for-phone-acknowledgement') return
    stopRinging.current?.()
    stopRinging.current = null
    audioEngine.unlock()
    setSummonCanAdvance(false)
    playDeliverySound(turnId, 'phone_answer')
    dispatchDelivery({ type: 'phone-acknowledged', turnId })
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => playDeliverySound(turnId, 'evidence_reveal'), 220)
  }, [delivery.phase, delivery.turnId, playDeliverySound])

  const finishSummon = useCallback(async () => {
    const turnId = delivery.turnId
    if (!turnId || delivery.phase !== 'evidence-summon' || summonFinishStarted.current.has(turnId)) return
    summonFinishStarted.current.add(turnId)
    await onArtifactsChanged()
    if (!mounted.current) return
    playDeliverySound(turnId, 'evidence_added')
    dispatchDelivery({ type: 'summon-finished', turnId })
  }, [delivery.phase, delivery.turnId, onArtifactsChanged, playDeliverySound])

  const exitConversation = useCallback(() => {
    stopRinging.current?.()
    // If the atomic save finished but the scene is interrupted before presentation completes,
    // make the already-persisted artifact visible in the next Court Record view without replay.
    if (delivery.artifact || currentTask?.state === 'artifact-ready') void onArtifactsChanged()
    onExit()
  }, [currentTask?.state, delivery.artifact, onArtifactsChanged, onExit])

  useEffect(() => {
    if (delivery.phase !== 'artifact-working' || !delivery.turnId) return
    const turnId = delivery.turnId
    const timer = window.setTimeout(() => dispatchDelivery({ type: 'working-presented', turnId }), ARTIFACT_WORKING_MIN_MS)
    return () => window.clearTimeout(timer)
  }, [delivery.phase, delivery.turnId])

  useEffect(() => {
    if (delivery.phase !== 'evidence-summon' || !delivery.turnId) return
    const minTimer = window.setTimeout(() => setSummonCanAdvance(true), ARTIFACT_SUMMON_MIN_MS)
    const autoTimer = window.setTimeout(() => { void finishSummon() }, ARTIFACT_SUMMON_AUTO_MS)
    return () => {
      window.clearTimeout(minTimer)
      window.clearTimeout(autoTimer)
    }
  }, [delivery.phase, delivery.turnId, finishSummon])

  useEffect(() => () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
  }, [])

  // The only release point for an artifact turn: the already-buffered timeline enters the
  // existing line queue after the reducer observes both response-buffered and summon-finished.
  useEffect(() => {
    const turnId = delivery.turnId
    if (delivery.phase !== 'response-release' || !turnId || releasedTurns.current.has(turnId)) return
    const buffered = pendingReply.current
    if (!buffered || buffered.turnId !== turnId) return
    releasedTurns.current.add(turnId)
    if (buffered.response) setLastResponse(buffered.response)
    play(buffered.lines, buffered.settle)
    pendingReply.current = null
  }, [delivery.phase, delivery.turnId, play])

  const submit = useCallback(
    async (message: string) => {
      if (activeRequest.current || phase !== 'input') return
      const request: ActiveRequest = { id: crypto.randomUUID(), controller: new AbortController(), cancelRequested: false, acknowledgement: null }
      activeRequest.current = request
      pendingReply.current = null
      deliverySounds.current.clear()
      releasedTurns.current.clear()
      summonFinishStarted.current.clear()
      dispatchDelivery({ type: 'reset' })
      setSummonCanAdvance(false)
      const initialTask: TurnTask = { id: request.id, state: 'working', cue: null, artifactId: null, error: null, cues: [] }
      currentTaskRef.current = initialTask
      setCurrentTask(initialTask)
      audioEngine.unlock()
      setChatError(null)
      setLastShown(null)
      setLastResponse(null)
      setPhase((current) => nextPhase(current, 'submit'))
      const layoutPromise = dialogueTextLayout()
      const acknowledgeTask = (turnId: string) => {
        if (request.acknowledgement) return
        const local = taskAcknowledgement(character, 'artifact', document.documentElement.lang || 'en', acknowledgementSequence.current++)
        dispatchDelivery({ type: 'begin', turnId })
        dispatchDelivery({ type: local ? 'acknowledgement' : 'working', turnId })
        request.acknowledgement = layoutPromise.then((layout) => {
          if (activeRequest.current !== request || request.controller.signal.aborted || !local) return
          play(paginate(local.text, layout).map((text) => ({ ...local, text })))
        }).catch(() => dispatchDelivery({ type: 'acknowledgement-finished', turnId }))
      }
      const acceptTask = (task: TurnTask) => {
        if (activeRequest.current !== request) return
        currentTaskRef.current = task
        setCurrentTask(task)
        onTaskChange?.(task)
        if (task.expectedWorkload === 'text_artifact' || task.cues.includes('artifact_working')) acknowledgeTask(task.id)
        if (task.cues.includes('artifact_working') || task.cue === 'artifact_working') {
          dispatchDelivery({ type: 'begin', turnId: task.id })
          dispatchDelivery({ type: 'working', turnId: task.id })
        }
        if (task.state === 'failed' && request.acknowledgement) {
          if (task.error === 'cancelled') dispatchDelivery({ type: 'cancelled', turnId: task.id })
          else dispatchDelivery({ type: 'failed', turnId: task.id, error: task.error ?? undefined })
        }
      }
      try {
        const [response, layout] = await Promise.all([
          sendChat({ character: character.id, message, sessionId, requestId: request.id }, 135_000, {
            signal: request.controller.signal,
            onTask: acceptTask,
          }),
          layoutPromise,
        ])
        if (activeRequest.current !== request || request.controller.signal.aborted) return
        if (response.task) acceptTask(response.task)
        await request.acknowledgement
        if (activeRequest.current !== request || request.controller.signal.aborted) return
        const generationError = generationFailureMessage(response.task?.error, response.generation)
        if (generationError) {
          setChatError(generationError)
        } else if (response.task?.error === 'invalid_artifact_action') {
          setChatError('The file instruction was rejected. Use .txt, .md or .py with nonempty UTF-8 text up to 64 KiB.')
        } else if (response.task?.error?.startsWith('artifact_')) {
          setChatError('The file could not be saved. Review generated-file storage and try again.')
        }
        const replyLines = timelineToLines(response.performance, layout)
        if (response.task?.state === 'artifact-ready' && response.task.artifactId) {
          const artifact = response.artifacts?.find((item) => item.id === response.task?.artifactId && item.status === 'ready')
          if (artifact) {
            pendingReply.current = { turnId: response.task.id, lines: replyLines, settle: response.performance.settle, response }
            dispatchDelivery({ type: 'begin', turnId: response.task.id })
            dispatchDelivery({ type: 'working', turnId: response.task.id })
            dispatchDelivery({ type: 'ready', turnId: response.task.id, artifact })
            dispatchDelivery({ type: 'response-buffered', turnId: response.task.id })
            return
          }
        }
        if (request.acknowledgement) {
          pendingReply.current = { turnId: request.id, lines: replyLines, settle: response.performance.settle, response }
          if (response.task?.error) dispatchDelivery({ type: 'failed', turnId: request.id, error: response.task.error })
          dispatchDelivery({ type: 'response-buffered', turnId: request.id, withoutArtifact: true })
        } else {
          setLastResponse(response)
          play(replyLines, response.performance.settle)
        }
      } catch (error) {
        if (activeRequest.current !== request) return
        const task: TurnTask = { id: request.id, state: 'failed', cue: null, artifactId: null,
          error: request.cancelRequested || request.controller.signal.aborted ? 'cancelled' : 'request_failed',
          cues: currentTaskRef.current?.cues ?? [] }
        currentTaskRef.current = task
        setCurrentTask(task)
        onTaskChange?.(task)
        if (request.acknowledgement) {
          if (task.error === 'cancelled') dispatchDelivery({ type: 'cancelled', turnId: request.id })
          else dispatchDelivery({ type: 'failed', turnId: request.id, error: task.error ?? undefined })
        }
        if (request.cancelRequested || request.controller.signal.aborted || (error instanceof ChatError && error.cancelled)) {
          setPhase('input')
          return
        }
        setChatError(error instanceof Error ? error.message : String(error))
        const errorLines = [{ text: "I couldn't finish that request. Please try again.", emotion: character.defaultEmotion, reaction: null }]
        if (request.acknowledgement) {
          await request.acknowledgement
          if (activeRequest.current !== request) return
          pendingReply.current = { turnId: request.id, lines: errorLines }
          dispatchDelivery({ type: 'response-buffered', turnId: request.id, withoutArtifact: true })
        } else play(errorLines)
      } finally {
        if (activeRequest.current === request) activeRequest.current = null
      }
    },
    [
      character,
      sessionId,
      play,
      onTaskChange,
      phase,
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

  const finishAcknowledgement = useCallback(() => {
    if (delivery.phase !== 'task-acknowledgement' || !delivery.turnId) return
    setLastShown(null)
    setPhase('waiting')
    dispatchDelivery({ type: 'acknowledgement-finished', turnId: delivery.turnId })
  }, [delivery.phase, delivery.turnId])

  useEffect(() => {
    if (delivery.phase !== 'task-acknowledgement' || typewriter.state !== 'complete'
      || !line || position.index + 1 < lines.length) return
    const timer = window.setTimeout(finishAcknowledgement, TASK_ACKNOWLEDGEMENT_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [delivery.phase, typewriter.state, line, position.index, lines.length, finishAcknowledgement])

  const advance = useCallback(() => {
    audioEngine.unlock()
    if (!line) return
    if (typewriter.state === 'revealing') {
      typewriter.skip()
    } else if (typewriter.state === 'complete') {
      if (position.index + 1 < lines.length) {
        setPosition(({ index, pass }) => ({ index: index + 1, pass }))
      } else {
        if (delivery.phase === 'task-acknowledgement') { finishAcknowledgement(); return }
        setLastShown(line)
        setPhase((current) => nextPhase(current, 'finished'))
        if (delivery.phase === 'response-release' && delivery.turnId) {
          dispatchDelivery({ type: 'response-finished', turnId: delivery.turnId })
        } else if (delivery.phase === 'failed' || delivery.phase === 'cancelled') {
          dispatchDelivery({ type: 'reset' })
        }
      }
    }
  }, [line, typewriter, position.index, lines.length, delivery.phase, delivery.turnId, finishAcknowledgement])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlay) return
      if (event.target instanceof HTMLElement && event.target.closest('.dev-panel, input, textarea, button, select')) {
        return
      }
      if (['artifact-working', 'waiting-for-phone-acknowledgement', 'evidence-summon'].includes(delivery.phase)) return
      if (['Enter', ' ', 'z', 'Z'].includes(event.key)) {
        event.preventDefault()
        advance()
      } else if (event.key === 'Escape') {
        playMenuSound('menu_cancel')
        exitConversation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, exitConversation, overlay, delivery.phase])

  // A chosen topic is returned to the conversation as an ordinary user message.
  const chooseTopic = (option: TalkOption) => {
    setOverlay(null)
    void submit(option.label)
  }

  const shown = line ?? lastShown

  return (
    <div className="app-layout" data-artifact-phase={delivery.phase}>
      <div className="scene-column">
        <GameScene
          background={background}
          characterFrame={animation.frame}
          characterCanvas={animation.resolved?.clip.canvas ?? null}
          characterAnchor={character.anchor}
          characterRender={character.render}
          onClick={overlay || ['artifact-working', 'waiting-for-phone-acknowledgement', 'evidence-summon'].includes(delivery.phase)
            ? undefined : advance}
        >
          {shown && overlay !== 'court-record' && overlay !== 'conversation-record' && (
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
          {overlay === 'court-record' && (
            <GeneratedFilesCourtRecord artifacts={generatedArtifacts} loading={artifactsLoading} error={artifactsError}
              onClose={() => setOverlay(null)} onRefresh={onArtifactsChanged} onArtifactsChanged={() => { void onArtifactsChanged() }}
              fileIcon={fileIcon} evidenceFrame={evidenceFrame} />
          )}
          {overlay === 'conversation-record' && (
            <ConversationRecordView onClose={() => setOverlay(null)} evidenceFrame={evidenceFrame}
              portraitFor={portraitFor} nameFor={nameFor} />
          )}
          <ArtifactDeliveryOverlay state={delivery}
            workingIcon={thinkerIcon ? <img src={thinkerIcon.url} width={48} height={48} alt="" /> : undefined}
            phoneIcon={phoneIcon ? <img src={phoneIcon.url} width={48} height={48} alt="" /> : undefined}
            evidenceIcon={fileIcon
              // Native size inside the native frame window (no rescaling of the 64×64 icon).
              ? <img src={fileIcon.url} width={evidenceFrame ? fileIcon.width : 48} height={evidenceFrame ? fileIcon.height : 48} alt="" />
              : <span aria-hidden="true">FILE</span>}
            evidenceFrame={evidenceFrame}
            canAdvance={summonCanAdvance} onPhoneAcknowledge={acknowledgePhone}
            onSummonAdvance={() => { void finishSummon() }} />
        </GameScene>
        <div className="conversation-actions">
          {(waiting || delivery.phase === 'task-acknowledgement') && currentTask?.state === 'working'
            && <button type="button" onClick={() => void cancel()}>Cancel request</button>}
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('talk') }}>Talk</button>
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('court-record') }}>Court Record</button>
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('conversation-record') }}>Record</button>
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
          onAuditionSfx={(name) => { void auditionSfx(name) }}
          sfxPlayback={sfxPlayback}
          canAuditionRingtone={phase === 'input' && delivery.phase === 'idle'}
          onExit={exitConversation}
        />
      )}
    </div>
  )
}
