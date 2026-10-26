import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent } from 'react'
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
import { selectPresentation } from '../engine/presentationContext.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { paginate, sendChat, timelineToLines, type ChatResponse } from '../engine/performance.ts'
import { taskAcknowledgement } from '../engine/taskAcknowledgements.ts'
import { musicRuntime } from '../music/musicRuntime.ts'
import { startPhoneRinging, type PhoneRingingHandle } from '../artifacts/phoneRinging.ts'
import { playSemanticSfx, semanticSoundIds, sfxDiagnostic, SFX_EVENTS, type SfxDiagnostic, type SfxName } from '../engine/sfx.ts'
import { useReactionEffect } from '../engine/reactionEffect.ts'
import { nextPhase, waitingOverride, waitingPerformance, type Phase } from '../engine/presentation.ts'
import { useBlips } from '../engine/useBlips.ts'
import { useCharacterPlayback, useReactionGate } from '../engine/useCharacterAnimation.ts'
import { lengthSpeedFactor, useTypewriter } from '../engine/useTypewriter.ts'
import { graphemes } from '../engine/unicodeText.ts'
import { paginateDialogueLines } from '../engine/performance.ts'
import { useSettings } from '../settings/settings.ts'
import { cancelTurn } from '../artifacts/artifacts.ts'
import { ChatError } from '../engine/performance.ts'
import { generationFailureMessage } from '../engine/generation.ts'
import { ArtifactDeliveryOverlay } from '../artifacts/ArtifactDeliveryOverlay.tsx'
import { ConversationMusicStrip, type ConversationMusicImages } from '../components/ConversationMusicStrip.tsx'
import { useConversationMusicView } from '../components/conversationMusicAdapter.ts'
import { StatusMagnifier } from '../components/StatusMagnifier.tsx'
import { replySucceeded, statusMagnifierMode, STATUS_DONE_MS } from '../components/statusMagnifier.ts'
import {
  ARTIFACT_DONE_MS,
  ARTIFACT_SUMMON_AUTO_MS,
  ARTIFACT_SUMMON_MIN_MS,
  ARTIFACT_WORKING_MIN_MS,
  TASK_ACKNOWLEDGEMENT_HOLD_MS,
  artifactDeliveryReducer,
  initialArtifactDelivery,
} from '../artifacts/artifactDelivery.ts'
import type { GeneratedArtifact, TurnTask } from '../artifacts/artifacts.ts'
import { readEvidence, releaseEvidence, type EvidenceDraft } from '../evidence/evidence.ts'
import { PendingEvidence, PresentedEvidence } from '../evidence/EvidenceViews.tsx'
import { EvidencePresentationLifetime } from '../evidence/presentationLifetime.ts'
import { guessMessageLanguage, localizedName, type StringKey } from '../i18n/i18n.ts'
import { useT } from '../i18n/useT.ts'
import { useEventInbox, type Exclamation } from '../events/eventInbox.ts'
import { ExclamationBubble } from '../events/ExclamationBubble.tsx'
import { bubbleFor, EXCLAMATION_MS, isJapaneseVoice, preloadExclamations, type ExclamationImages } from '../events/exclamations.ts'
import { shoutSound } from '../engine/voices.ts'

interface ConversationScreenProps {
  character: LoadedCharacter
  presentationContext?: string
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
  /** Photo evidence icon (ui.images.court_record_photo), shown when a presented picture cannot be. */
  photoIcon?: UiImage | null
  /** Status magnifier (ui.images.status_magnifier_*): working while a request runs, checked on success (D-079). */
  statusWorking?: UiImage | null
  statusDone?: UiImage | null
  /** DS-scale Trilogy music-player sprites (ui.images.music_player_*) for the in-stage music strip. */
  musicImages?: ConversationMusicImages
  phoneIcon: UiImage | null
  onExit: () => void
  /** Native evidence frame (ui.images.evidence_frame) for file tiles, the summon and record slots. */
  evidenceFrame?: UiImage | null
  /** Original exclamation bubbles (ui.json exclamation_*), shown before some event lines. */
  exclamations?: ExclamationImages
  portraitFor: (characterId: string) => UiImage | null
  nameFor: (characterId: string) => string | null
  /** The in-conversation Record opened: load what it needs (every character's portrait). */
  onRecordOpen?: () => void
  /** Show temporary developer controls. */
  devTools: boolean
  onTaskChange?: (task: TurnTask | null) => void
}

/** Stage overlays opened from the conversation; they own the keyboard while open. */
type Overlay = 'talk' | 'court-record' | 'conversation-record' | null
type SfxPlaybackDiagnostic = SfxDiagnostic

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

/** Server evidence rejections shown in the interface language. */
const EVIDENCE_ERRORS: Record<string, StringKey> = {
  evidence_unsupported: 'evidence.unsupported',
  evidence_invalid: 'evidence.invalid',
}
const TOO_LARGE: Record<EvidenceDraft['kind'], StringKey> = {
  text: 'evidence.tooLargeText', image: 'evidence.tooLargeImage', pdf: 'evidence.tooLargePdf',
}
const TALK_LABELS: Record<string, StringKey> = {
  small_talk: 'talk.smallTalk', about_today: 'talk.aboutToday', the_case: 'talk.theCase', something_new: 'talk.somethingNew',
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
  character: sourceCharacter, presentationContext = 'conversation', background, testScript, talkBackdrop, generatedArtifacts, artifactsLoading, artifactsError,
  onArtifactsChanged, fileIcon, photoIcon = null, statusWorking = null, statusDone = null, musicImages, phoneIcon, onExit, devTools, onTaskChange,
  evidenceFrame = null, portraitFor, nameFor, exclamations = {}, onRecordOpen,
}: ConversationScreenProps) {
  const character = useMemo(() => selectPresentation(sourceCharacter, presentationContext), [sourceCharacter, presentationContext])
  const { settings } = useSettings()
  const t = useT()
  const musicView = useConversationMusicView(character.id)
  const characterName = localizedName(character, settings.language)
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
  // A reply just succeeded without a file: the checked magnifier shows for STATUS_DONE_MS.
  const [doneFlash, setDoneFlash] = useState(false)
  useEffect(() => {
    if (!doneFlash) return
    const timer = window.setTimeout(() => setDoneFlash(false), STATUS_DONE_MS)
    return () => window.clearTimeout(timer)
  }, [doneFlash])
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
  // Evidence (D-065): the file waiting to be presented with the next message, the one on screen
  // while the character examines it, and drag-and-drop feedback.
  const [evidence, setEvidence] = useState<EvidenceDraft | null>(null)
  const [presented, setPresented] = useState<EvidenceDraft | null>(null)
  const [presentationLifetime] = useState(() => new EvidencePresentationLifetime())
  const finishEvidence = useCallback((turnId: string) => {
    if (presentationLifetime.finish(turnId) && mounted.current) setPresented(null)
  }, [presentationLifetime])
  const [dragging, setDragging] = useState(false)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const evidenceInput = useRef<HTMLInputElement>(null)
  const evidenceFiles = useRef({ evidence })
  useEffect(() => { evidenceFiles.current = { evidence } })
  useEffect(() => () => {
    releaseEvidence(evidenceFiles.current.evidence)
    presentationLifetime.clear()
  }, [presentationLifetime])
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
  // Character-specific and shared semantic sounds are not all audio events, so preload them here.
  const characterSounds = character.semanticSounds
  useEffect(() => {
    audioEngine.preload(semanticSoundIds(characterSounds))
  }, [characterSounds])
  useEffect(() => {
    const { volume, muted } = sfxSettings.current
    if (lineSfx && playedSfxLineKey.current !== lineKey) {
      playedSfxLineKey.current = lineKey
      const result = playSemanticSfx(lineSfx, volume, muted, character.id, characterSounds)
      if (devTools) setSfxPlayback((events) => [...events.slice(-9), sfxDiagnostic(result, 'dialogue')])
    }
  }, [lineKey, lineSfx, devTools, character.id, characterSounds])

  const auditionSfx = useCallback(async (name: SfxName) => {
    audioEngine.unlock()
    await audioEngine.prepareEvent(SFX_EVENTS[name])
    const { volume, muted } = sfxSettings.current
    const result = playSemanticSfx(name, volume, muted, character.id, characterSounds)
    setSfxPlayback((events) => [...events.slice(-9), sfxDiagnostic(result, 'audition')])
  }, [character.id, characterSounds])

  const gate = useReactionGate(character, emotion, lineKey, override)
  // Every page of a reply types at the same pace, set by the reply's total length.
  const replyChars = useMemo(() => lines.reduce((total, page) => total + graphemes(page.text).length, 0), [lines])
  const textSpeed = settings.textSpeed * lengthSpeedFactor(replyChars)
  const typewriter = useTypewriter(line?.text ?? '', lineKey, Boolean(line) && !gate.pending, textSpeed, onReveal, settings.language)
  const mode = line && typewriter.state === 'revealing' ? 'talking' : 'idle'
  const animation = useCharacterPlayback(character, emotion, mode, gate, override)
  // A reaction's one-shot effect (overlay + sound cues) runs from the reaction's start and is
  // cancelled with it (D-091).
  const reactionEffect = animation.resolved?.variant === 'reaction' ? animation.resolved.clip.effect : undefined
  const effectView = useReactionEffect(reactionEffect, reactionEffect ? gate.playKey : null, (event) => {
    const { volume, muted } = sfxSettings.current
    const played = !muted && volume > 0 && audioEngine.playEvent(event, volume)
    if (devTools) {
      setSfxPlayback((events) => [...events.slice(-9), {
        name: event, character: character.id, characterCandidate: null, sharedCandidate: null, final: event,
        played, reason: muted ? 'muted' : volume <= 0 ? 'zero volume' : played ? 'reaction effect cue' : 'playback did not start',
        source: 'effect',
      }])
    }
  })

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
    presentationLifetime.clear()
    setPresented(null)
    // If the atomic save finished but the scene is interrupted before presentation completes,
    // make the already-persisted artifact visible in the next Court Record view without replay.
    if (delivery.artifact || currentTask?.state === 'artifact-ready') void onArtifactsChanged()
    onExit()
  }, [currentTask?.state, delivery.artifact, onArtifactsChanged, onExit, presentationLifetime])

  useEffect(() => {
    if (delivery.phase !== 'artifact-working' || !delivery.turnId) return
    const turnId = delivery.turnId
    const timer = window.setTimeout(() => dispatchDelivery({ type: 'working-presented', turnId }), ARTIFACT_WORKING_MIN_MS)
    return () => window.clearTimeout(timer)
  }, [delivery.phase, delivery.turnId])

  // The checked magnifier beat between the saved file and the phone.
  useEffect(() => {
    if (delivery.phase !== 'artifact-done' || !delivery.turnId) return
    const turnId = delivery.turnId
    const timer = window.setTimeout(() => dispatchDelivery({ type: 'done-presented', turnId }), ARTIFACT_DONE_MS)
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
      setDoneFlash(false)
      const initialTask: TurnTask = { id: request.id, state: 'working', cue: null, artifactId: null, error: null, cues: [] }
      currentTaskRef.current = initialTask
      setCurrentTask(initialTask)
      audioEngine.unlock()
      setChatError(null)
      setEvidenceError(null)
      setLastShown(null)
      setLastResponse(null)
      setPhase((current) => nextPhase(current, 'submit'))
      const shownEvidence = evidence
      setPresented(presentationLifetime.begin(request.id, shownEvidence))
      if (shownEvidence) {
        setEvidence(null)
        if (!settings.sfxMuted) audioEngine.playEvent('evidence_reveal', settings.sfxVolume)
      }
      const layoutPromise = dialogueTextLayout()
      const acknowledgeTask = (turnId: string) => {
        if (request.acknowledgement) return
        // In the language the user wrote in, like the reply; the interface language when unclear (D-073).
        const local = taskAcknowledgement(character, 'artifact', guessMessageLanguage(message, settings.language), acknowledgementSequence.current++)
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
          sendChat({ character: character.id, message, sessionId, requestId: request.id, language: settings.language,
            ...(shownEvidence ? { evidence: { name: shownEvidence.name, data: shownEvidence.data } } : {}) }, 135_000, {
            signal: request.controller.signal,
            onTask: acceptTask,
          }),
          layoutPromise,
        ])
        if (activeRequest.current !== request || request.controller.signal.aborted) return
        finishEvidence(request.id)
        if (response.task) acceptTask(response.task)
        await request.acknowledgement
        if (activeRequest.current !== request || request.controller.signal.aborted) return
        const generationError = generationFailureMessage(response.task?.error, response.generation, settings.language)
        if (generationError) {
          setChatError(generationError)
        } else if (response.task?.error === 'invalid_artifact_action') {
          setChatError(t('chat.fileRejected'))
        } else if (response.task?.error?.startsWith('artifact_')) {
          setChatError(t('chat.fileNotSaved'))
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
          if (replySucceeded(response.task, generationError)) setDoneFlash(true)
          if (response.task?.error) dispatchDelivery({ type: 'failed', turnId: request.id, error: response.task.error })
          dispatchDelivery({ type: 'response-buffered', turnId: request.id, withoutArtifact: true })
        } else {
          setLastResponse(response)
          if (replySucceeded(response.task, generationError)) setDoneFlash(true)
          play(replyLines, response.performance.settle)
        }
      } catch (error) {
        finishEvidence(request.id)
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
        const code = error instanceof ChatError ? error.code : null
        const known = code === 'evidence_too_large' && shownEvidence ? TOO_LARGE[shownEvidence.kind] : code ? EVIDENCE_ERRORS[code] : undefined
        setChatError(known ? t(known) : error instanceof Error ? error.message : String(error))
        const errorLines = [{ text: t('chat.requestFailedLine'), emotion: character.defaultEmotion, reaction: null }]
        if (request.acknowledgement) {
          await request.acknowledgement
          if (activeRequest.current !== request) return
          pendingReply.current = { turnId: request.id, lines: errorLines }
          dispatchDelivery({ type: 'response-buffered', turnId: request.id, withoutArtifact: true })
        } else play(errorLines)
      } finally {
        finishEvidence(request.id)
        if (activeRequest.current === request) activeRequest.current = null
      }
    },
    [
      character,
      sessionId,
      play,
      onTaskChange,
      phase,
      evidence,
      presentationLifetime,
      finishEvidence,
      settings.sfxMuted,
      settings.sfxVolume,
      settings.language,
      t,
    ],
  )

  const attachEvidence = useCallback((file: File | undefined) => {
    if (!file) return
    readEvidence(file, settings.language).then((draft) => {
      if (!mounted.current) return releaseEvidence(draft)
      setEvidence((previous) => { releaseEvidence(previous); return draft })
      setEvidenceError(null)
      setChatError(null) // e.g. the server's reason for rejecting the previous file
      playMenuSound('menu_open')
    }, (error: unknown) => {
      playMenuSound('menu_cancel')
      setEvidenceError(error instanceof Error ? error.message : String(error))
    })
  }, [settings.language])
  // Event inbox (D-067): Claude Code events and due reminders, performed when the character is idle.
  const inbox = useEventInbox(character.id, settings.language)
  const [exclamation, setExclamation] = useState<{ kind: Exclamation; japanese: boolean } | null>(null)
  const eventBusy = useRef(false)
  useEffect(() => preloadExclamations(Object.values(exclamations)), [exclamations])
  const nextEvent = inbox.queue[0]
  useEffect(() => {
    if (!nextEvent || eventBusy.current || phase !== 'input' || overlay !== null || activeRequest.current) return
    eventBusy.current = true
    const timers: number[] = []
    let stopRing: (() => void) | null = null
    const later = (ms: number, run: () => void) => { timers.push(window.setTimeout(run, ms)) }
    const { sfxVolume, sfxMuted } = settings
    later(0, () => {
      inbox.take()
      let delay = 0
      if (nextEvent.attention) {
        stopRing = startPhoneRinging(audioEngine, musicRuntime().engine, sfxMuted ? 0 : sfxVolume)
        delay = 1800
        later(delay, () => { stopRing?.(); stopRing = null })
      }
      if (nextEvent.exclamation) {
        const kind = nextEvent.exclamation
        later(delay, () => {
          // The character's own voiced shout when audio.json has it (D-068), else the generic SFX.
          const voice = character.voice.shout ? shoutSound(kind, settings.shoutLanguage, character.voice.shout) : null
          // Japanese voice (or, without one, a Japanese interface) → Japanese bubble (D-070).
          setExclamation({ kind, japanese: voice ? isJapaneseVoice(voice) : settings.language === 'ja' })
          if (!sfxMuted) {
            if (voice) void audioEngine.playWhenReady(voice, sfxVolume)
            else void audioEngine.playEventWhenReady(`exclamation_${kind}`, sfxVolume)
          }
        })
        delay += EXCLAMATION_MS
        later(delay, () => setExclamation(null))
      }
      later(delay, () => {
        void dialogueTextLayout().then((layout) => {
          eventBusy.current = false
          if (!mounted.current) return
          play(timelineToLines(nextEvent.performance, layout), nextEvent.performance.settle)
        })
      })
    })
    return () => {
      // Leaving the conversation (or a new turn) cancels a pending event presentation.
      if (!mounted.current) {
        timers.forEach((timer) => window.clearTimeout(timer))
        stopRing?.()
      }
    }
  }, [nextEvent, phase, overlay, settings, inbox, play, character.voice.shout])

  const removeEvidence = () => {
    playMenuSound('menu_cancel')
    setEvidence((previous) => { releaseEvidence(previous); return null })
  }
  const filesDragged = (event: DragEvent) => event.dataTransfer.types.includes('Files')

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
    finishEvidence(request.id)
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
      if (['artifact-working', 'artifact-done', 'waiting-for-phone-acknowledgement', 'evidence-summon'].includes(delivery.phase)) return
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
      <div
        className="scene-column"
        onDragEnter={(event) => { if (filesDragged(event) && !waiting) setDragging(true) }}
        onDragOver={(event) => { if (filesDragged(event) && !waiting) event.preventDefault() }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          if (!filesDragged(event)) return
          event.preventDefault()
          setDragging(false)
          if (!waiting) attachEvidence(event.dataTransfer.files[0])
        }}
      >
        {dragging && <div className="evidence-drop">{t('evidence.drop')}</div>}
        <GameScene
          background={background}
          characterFrame={animation.frame}
          characterCanvas={animation.resolved?.clip.canvas ?? null}
          characterAnchor={character.anchor}
          characterRender={character.render}
          effectFrame={effectView.frame}
          effectCanvas={reactionEffect?.overlay?.canvas ?? null}
          effectBackdrop={effectView.backdrop}
          onClick={overlay || ['artifact-working', 'artifact-done', 'waiting-for-phone-acknowledgement', 'evidence-summon'].includes(delivery.phase)
            ? undefined : advance}
        >
          {shown && overlay !== 'court-record' && overlay !== 'conversation-record' && (
            <DialogueBox
              speakerName={characterName}
              text={shown.text}
              visibleCount={line ? typewriter.visibleCount : shown.text.length}
              showContinue={Boolean(line) && typewriter.state === 'complete'}
            />
          )}
          {overlay === 'talk' && (
            <TalkOptions options={DEV_TALK_TOPICS.map((option) => ({ ...option, label: t(TALK_LABELS[option.id] ?? 'talk.smallTalk') }))}
              onSelect={chooseTopic} onCancel={() => setOverlay(null)}
              backdrop={talkBackdrop} />
          )}
          {overlay === 'court-record' && (
            <GeneratedFilesCourtRecord artifacts={generatedArtifacts} loading={artifactsLoading} error={artifactsError}
              onClose={() => setOverlay(null)} onRefresh={onArtifactsChanged} onArtifactsChanged={() => { void onArtifactsChanged() }}
              fileIcon={fileIcon} evidenceFrame={evidenceFrame} />
          )}
          {overlay === 'conversation-record' && (
            <ConversationRecordView onClose={() => setOverlay(null)} evidenceFrame={evidenceFrame}
              portraitFor={portraitFor} nameFor={nameFor} onOpen={onRecordOpen} />
          )}
          {/* The presented file stays on screen while the character thinks, then leaves with the reply. */}
          {presented && waiting && <PresentedEvidence evidence={presented} fileIcon={fileIcon} photoIcon={photoIcon} />}
          {exclamation && <ExclamationBubble kind={exclamation.kind}
            image={bubbleFor(exclamations, exclamation.kind, exclamation.japanese)} />}
          <StatusMagnifier working={statusWorking} done={statusDone} label={t('chat.thinking', { name: characterName })}
            mode={statusMagnifierMode({ running: waiting && currentTask?.state === 'working', doneFlash,
              deliveryPhase: delivery.phase, halted: currentTask?.state === 'failed' })} />
          {musicView && musicImages && overlay === null && delivery.phase === 'idle' && (
            <ConversationMusicStrip view={musicView} images={musicImages}
              labels={{ open: t('music.stripOpen'), close: t('music.stripClose'), prev: t('music.stripPrev'),
                next: t('music.stripNext'), theme: t('music.stripTheme'), list: t('music.stripList'),
                play: t('music.play'), pause: t('music.pause') }} />
          )}
          <ArtifactDeliveryOverlay state={delivery}
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
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'artifact-done', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('talk') }}>{t('chat.talk')}</button>
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'artifact-done', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('court-record') }}>{t('chat.courtRecord')}</button>
          <button type="button" disabled={phase !== 'input' || overlay !== null
            || ['artifact-working', 'artifact-done', 'waiting-for-phone-acknowledgement', 'evidence-summon', 'response-release'].includes(delivery.phase)}
            onClick={() => { playMenuSound('menu_open'); setOverlay('conversation-record') }}>{t('chat.record')}</button>
          {/* While a request runs, Cancel takes Present's place (Present is unavailable then), so the
              row never gains a button, wraps, and shrinks the stage to a smaller scale. */}
          {(waiting || delivery.phase === 'task-acknowledgement') && currentTask?.state === 'working'
            ? <button type="button" onClick={() => void cancel()}>{t('chat.cancelRequest')}</button>
            : <button type="button" disabled={phase === 'waiting' || overlay !== null}
              title={t('chat.presentTitle')}
              onClick={() => evidenceInput.current?.click()}>{t('chat.present')}</button>}
          <input ref={evidenceInput} type="file" hidden onChange={(event) => {
            attachEvidence(event.target.files?.[0])
            event.target.value = ''
          }} />
          {/* Fixed-height slot beside the buttons for the file about to be presented and for errors.
              Rows that appeared under the scene changed its height and so the stage scale mid-turn. */}
          <div className="conversation-status">
            {evidence
              ? <PendingEvidence evidence={evidence} photoIcon={photoIcon} onRemove={removeEvidence} disabled={phase === 'waiting'} />
              : (evidenceError || chatError) && (
                <p className="conversation-status-error" role="alert">
                  {evidenceError ?? t('chat.replyError', { error: chatError ?? '' })}
                </p>
              )}
          </div>
        </div>
        <ChatBar
          placeholder={t(evidence ? 'chat.askAboutEvidence' : 'chat.placeholder', { name: characterName })}
          allowEmpty={Boolean(evidence)}
          submitLabel={t(evidence ? 'chat.presentSubmit' : 'chat.send')}
          disabled={phase !== 'input'}
          waiting={phase === 'waiting'}
          waitingLabel={t('chat.thinking', { name: characterName })}
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
          onPlayTestScript={() => {
            void dialogueTextLayout(settings.language).then((layout) => {
              if (mounted.current) play(paginateDialogueLines(testScript, layout))
            })
          }}
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
