// Pure state for the import flow shown in the library panel: which step a file is in, and how a
// stored track's loop state is worded. No React, no audio.
import { confidenceLabel } from '../loop/loopEditorState.ts'
import type { ImportedTrackRecord } from './importApi.ts'

export type ImportStep = 'selected' | 'checking' | 'uploading' | 'analysing' | 'ready' | 'failed'

/** Ordered steps of a successful import, for the step list. */
export const IMPORT_STEPS: readonly { step: Exclude<ImportStep, 'failed'>; label: string }[] = [
  { step: 'selected', label: 'Selected' },
  { step: 'checking', label: 'Checking' },
  { step: 'uploading', label: 'Uploading' },
  { step: 'analysing', label: 'Analysing loop' },
  { step: 'ready', label: 'Ready' },
]

export interface ImportStatus {
  fileName: string
  step: ImportStep
  /** Last step reached before a failure (so the UI can show where it stopped). */
  failedAt: Exclude<ImportStep, 'failed' | 'ready'> | null
  trackId: string | null
  /** Result of the automatic loop analysis once the import is ready. */
  loop: 'candidate' | 'none' | null
  confidence: number | null
  /** Human-readable failure reason, or why no loop was found. */
  message: string | null
}

export type ImportEvent =
  | { type: 'select'; fileName: string }
  | { type: 'checking' }
  | { type: 'uploading' }
  | { type: 'uploaded'; trackId: string }
  | { type: 'analysing' }
  | { type: 'candidate'; confidence: number }
  | { type: 'no_candidate'; reason?: string }
  | { type: 'failed'; message: string }

export function reduceImportStatus(state: ImportStatus | null, event: ImportEvent): ImportStatus | null {
  if (event.type === 'select') {
    return { fileName: event.fileName, step: 'selected', failedAt: null, trackId: null, loop: null, confidence: null, message: null }
  }
  if (!state || state.step === 'failed') return state
  switch (event.type) {
    case 'checking':
      return { ...state, step: 'checking' }
    case 'uploading':
      return { ...state, step: 'uploading' }
    case 'uploaded':
      return { ...state, trackId: event.trackId }
    case 'analysing':
      return { ...state, step: 'analysing' }
    case 'candidate':
      return { ...state, step: 'ready', loop: 'candidate', confidence: event.confidence }
    case 'no_candidate':
      return { ...state, step: 'ready', loop: 'none', message: event.reason ?? null }
    case 'failed': {
      const at = state.step === 'ready' ? 'analysing' : state.step
      return { ...state, step: 'failed', failedAt: at, message: event.message }
    }
  }
}

/** One-line description of the current step. */
export function describeImportStatus(status: ImportStatus): string {
  switch (status.step) {
    case 'selected': return `Selected ${status.fileName}`
    case 'checking': return `Checking ${status.fileName}...`
    case 'uploading': return `Uploading ${status.fileName}...`
    case 'analysing': return `Analysing the loop of ${status.fileName}...`
    case 'failed': return `Could not import ${status.fileName}: ${status.message ?? 'unknown problem'}`
    case 'ready':
      if (status.loop === 'candidate') return `${status.fileName} is ready. A loop candidate was found, review it below.`
      return `${status.fileName} is ready. No loop found${status.message ? ` (${status.message})` : ''}; it plays through, then restarts.`
  }
}

/** True while a file is still moving through the pipeline. */
export function isImportBusy(status: ImportStatus | null): boolean {
  return !!status && status.step !== 'ready' && status.step !== 'failed'
}

export type LoopStateKind = 'missing' | 'analysing' | 'none' | 'automatic' | 'accepted' | 'adjusted'

export interface LoopState {
  kind: LoopStateKind
  label: string
}

/** Loop state of a library track: No loop / Automatic (not reviewed) N% / Accepted / Adjusted. */
export function loopStateOf(track: ImportedTrackRecord, analysing: boolean): LoopState {
  if (!track.available) return { kind: 'missing', label: 'File missing' }
  if (analysing) return { kind: 'analysing', label: 'Analysing loop...' }
  const loop = track.loop
  if (!loop?.region) return { kind: 'none', label: 'No loop' }
  if (loop.provenance === 'user-accepted') return { kind: 'accepted', label: 'Loop accepted' }
  if (loop.provenance === 'user-adjusted') return { kind: 'adjusted', label: 'Loop adjusted' }
  const percent = typeof loop.confidence === 'number' ? ` ${confidenceLabel(loop.confidence).percent}%` : ''
  return { kind: 'automatic', label: `Automatic (not reviewed)${percent}` }
}
