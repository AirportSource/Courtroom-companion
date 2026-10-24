import type { GeneratedArtifact } from './artifacts.ts'

export const ARTIFACT_SUMMON_MIN_MS = 1200
export const ARTIFACT_SUMMON_AUTO_MS = 2500
export const TASK_ACKNOWLEDGEMENT_HOLD_MS = 500
export const ARTIFACT_WORKING_MIN_MS = 350

export type ArtifactDeliveryPhase =
  | 'idle'
  | 'task-acknowledgement'
  | 'artifact-working'
  | 'waiting-for-phone-acknowledgement'
  | 'evidence-summon'
  | 'response-release'
  | 'failed'
  | 'cancelled'

export interface ArtifactDeliveryState {
  phase: ArtifactDeliveryPhase
  turnId: string | null
  artifact: GeneratedArtifact | null
  responseBuffered: boolean
  summonFinished: boolean
  error: string | null
  workingPresented: boolean
  responseWithoutArtifact: boolean
}

export type ArtifactDeliveryEvent =
  | { type: 'begin'; turnId: string }
  | { type: 'reset' }
  | { type: 'acknowledgement'; turnId: string }
  | { type: 'acknowledgement-finished'; turnId: string }
  | { type: 'working-presented'; turnId: string }
  | { type: 'working'; turnId: string }
  | { type: 'ready'; turnId: string; artifact: GeneratedArtifact }
  | { type: 'response-buffered'; turnId: string; withoutArtifact?: boolean }
  | { type: 'phone-acknowledged'; turnId: string }
  | { type: 'summon-finished'; turnId: string }
  | { type: 'failed'; turnId: string; error?: string }
  | { type: 'cancelled'; turnId: string }
  | { type: 'response-finished'; turnId: string }

export function initialArtifactDelivery(): ArtifactDeliveryState {
  return { phase: 'idle', turnId: null, artifact: null, responseBuffered: false, summonFinished: false, error: null,
    workingPresented: false, responseWithoutArtifact: false }
}

/**
 * A presentation gate for the single response already requested by the caller.
 * Entering phone-wait, summon and response-release are the one-shot boundaries
 * for ring, answer/reveal and timeline release respectively. No effects occur here.
 * The caller validates ready metadata, buffers the response and owns all timers.
 */
export function artifactDeliveryReducer(state: ArtifactDeliveryState, event: ArtifactDeliveryEvent): ArtifactDeliveryState {
  if (event.type === 'reset') return initialArtifactDelivery()
  if (event.type === 'begin') {
    if (state.turnId === event.turnId) return state
    return { ...initialArtifactDelivery(), turnId: event.turnId }
  }
  // A late poll, response or timer belonging to an abandoned turn is harmless.
  if (!state.turnId || event.turnId !== state.turnId) return state
  if (event.type === 'response-finished') return state.phase === 'response-release' ? initialArtifactDelivery() : state
  if (state.phase === 'cancelled' || state.phase === 'response-release') return state
  if (event.type === 'cancelled') return { ...state, phase: 'cancelled', artifact: null }
  if (event.type === 'failed') return { ...state, phase: state.phase === 'task-acknowledgement' ? state.phase : 'failed',
    artifact: null, error: event.error ?? 'request_failed' }
  if (state.phase === 'failed' && event.type !== 'response-buffered') return state

  switch (event.type) {
    case 'acknowledgement':
      return state.phase === 'idle' ? { ...state, phase: 'task-acknowledgement' } : state
    case 'acknowledgement-finished':
      if (state.phase !== 'task-acknowledgement') return state
      return { ...state, phase: state.responseBuffered && state.responseWithoutArtifact ? 'response-release'
        : state.error ? 'failed' : 'artifact-working' }
    case 'working-presented':
      return state.phase === 'artifact-working' ? { ...state, workingPresented: true,
        phase: state.artifact ? 'waiting-for-phone-acknowledgement' : state.phase } : state
    case 'working':
      return state.phase === 'idle' ? { ...state, phase: 'artifact-working' } : state
    case 'ready':
      if (!['idle', 'task-acknowledgement', 'artifact-working'].includes(state.phase) || state.artifact
        || state.error || event.artifact.status !== 'ready') return state
      return { ...state, phase: state.phase === 'task-acknowledgement' ? state.phase
        : state.workingPresented ? 'waiting-for-phone-acknowledgement' : 'artifact-working', artifact: event.artifact }
    case 'response-buffered':
      if (state.responseBuffered) return state
      return { ...state, responseBuffered: true, responseWithoutArtifact: !!event.withoutArtifact,
        phase: state.phase !== 'task-acknowledgement' && (state.phase === 'idle' || state.phase === 'failed'
          || (event.withoutArtifact && state.phase === 'artifact-working')
          || (state.phase === 'evidence-summon' && state.summonFinished)) ? 'response-release' : state.phase }
    case 'phone-acknowledged':
      return state.phase === 'waiting-for-phone-acknowledgement' ? { ...state, phase: 'evidence-summon' } : state
    case 'summon-finished':
      if (state.phase !== 'evidence-summon' || state.summonFinished) return state
      return { ...state, summonFinished: true, phase: state.responseBuffered ? 'response-release' : state.phase }
  }
}
