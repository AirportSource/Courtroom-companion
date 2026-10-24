import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeLoop } from './analyzeLoop.ts'
import type { AudioBufferLike } from './analyzeLoop.ts'
import {
  acceptLoop,
  candidateToLoop,
  confidenceLabel,
  formatSeconds,
  loopValidity,
  metadataToLoop,
  nudge,
  parseSeconds,
  proposalMetadata,
  sameLoop,
  setCrossfade,
  shouldAutoAnalyse,
} from './loopEditorState.ts'
import type { EditorLoop, NudgeStep, NudgeTarget } from './loopEditorState.ts'
import { startLoopPreview } from './previewLoop.ts'
import type { LoopPreview } from './previewLoop.ts'
import type { AnalysisResult, LoopCandidate } from './types.ts'
import type { LoopMetadata } from '../types.ts'
import './loop-editor.css'

/** An AudioBuffer (or anything shaped like one). */
export type LoopEditorBuffer = AudioBufferLike

export interface LoopEditorProps {
  title: string
  /** Decoded track; null while it is still loading. */
  buffer: LoopEditorBuffer | null
  /** The persisted loop (null when none). A stored loop is shown as-is and never re-analysed. */
  loop: LoopMetadata | null
  /** Shared AudioContext used for the preview only; null disables Preview Loop. */
  audioContext: AudioContext | null
  /** Persist the user's decision (user-accepted / user-adjusted). */
  onAccept(metadata: LoopMetadata): void
  /** Persist a fresh automatic proposal (auto-detected) so playback can use it at once. */
  onProposal?(metadata: LoopMetadata): void
  /** Preview started/stopped, so the host can pause background music meanwhile. */
  onPreviewChange?(active: boolean): void
  /** Test seam: defaults to the Web Worker client. */
  analyse?: (buffer: LoopEditorBuffer, signal: AbortSignal, onProgress: (fraction: number, stage: string) => void) => Promise<AnalysisResult>
}

type Phase = { name: 'idle' } | { name: 'analysing'; fraction: number; stage: string } | { name: 'failed'; message: string }

const STEPS: { step: NudgeStep; label: string; title: string }[] = [
  { step: 'coarse', label: '100 ms', title: 'Coarse: 100 ms' },
  { step: 'fine', label: '5 ms', title: 'Fine: 5 ms' },
  { step: 'sample', label: '1 smp', title: 'One sample' },
]

const defaultAnalyse: NonNullable<LoopEditorProps['analyse']> = (buffer, signal, onProgress) => analyzeLoop(buffer, { onProgress }, signal)

export function LoopEditor({ title, buffer, loop, audioContext, onAccept, onProposal, onPreviewChange, analyse = defaultAnalyse }: LoopEditorProps) {
  const stored = metadataToLoop(loop)
  const [candidates, setCandidates] = useState<LoopCandidate[]>([])
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState<EditorLoop | null>(stored)
  const [proposal, setProposal] = useState<EditorLoop | null>(stored)
  const [confidence, setConfidence] = useState<number | null>(loop?.confidence ?? null)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [adjusting, setAdjusting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const previewChange = useRef(onPreviewChange)
  useEffect(() => {
    previewChange.current = onPreviewChange
  })
  useEffect(() => {
    if (!previewing) return
    previewChange.current?.(true)
    return () => previewChange.current?.(false)
  }, [previewing])
  const [saved, setSaved] = useState(false)
  const preview = useRef<LoopPreview | null>(null)
  const abort = useRef<AbortController | null>(null)
  const proposalCallback = useRef(onProposal)
  useEffect(() => {
    proposalCallback.current = onProposal
  }, [onProposal])

  const stopPreview = useCallback(() => {
    preview.current?.stop()
    preview.current = null
    setPreviewing(false)
  }, [])

  const runAnalysis = useCallback(async () => {
    if (!buffer) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setPhase({ name: 'analysing', fraction: 0, stage: 'Starting' })
    const result = await analyse(buffer, controller.signal, (fraction, stage) => {
      if (!controller.signal.aborted) setPhase({ name: 'analysing', fraction, stage })
    })
    if (controller.signal.aborted) return
    if (!result.ok) {
      setPhase({ name: 'failed', message: result.message })
      return
    }
    const best = result.candidates[0]
    setCandidates(result.candidates)
    setSelected(0)
    if (best) {
      const next = candidateToLoop(best)
      setDraft(next)
      setProposal(next)
      setConfidence(best.confidence)
      proposalCallback.current?.(proposalMetadata(best))
    }
    setSaved(false)
    setPhase({ name: 'idle' })
  }, [analyse, buffer])

  // First open of a track without a stored loop: analyse once. A stored loop is never recomputed.
  const autoStarted = useRef<unknown>(null)
  useEffect(() => {
    if (!buffer || autoStarted.current === buffer || !shouldAutoAnalyse(loop)) return
    autoStarted.current = buffer
    void runAnalysis()
  }, [buffer, loop, runAnalysis])

  useEffect(
    () => () => {
      abort.current?.abort()
      preview.current?.stop()
      preview.current = null
    },
    [],
  )

  const durationSamples = buffer?.length ?? 0
  const sampleRate = draft?.sampleRate ?? buffer?.sampleRate ?? 44100
  const validity = draft && buffer ? loopValidity(draft, durationSamples) : null
  const label = confidence !== null ? confidenceLabel(confidence) : null
  const edited = draft !== null && proposal !== null && !sameLoop(draft, proposal)

  const change = (next: EditorLoop) => {
    stopPreview()
    setDraft(next)
    setSaved(false)
  }
  const pick = (index: number) => {
    const candidate = candidates[index]
    if (!candidate) return
    stopPreview()
    setSelected(index)
    const next = candidateToLoop(candidate)
    setDraft(next)
    setProposal(next)
    setConfidence(candidate.confidence)
    setSaved(false)
  }
  const togglePreview = () => {
    if (previewing) return stopPreview()
    if (!audioContext || !buffer || !draft || !validity?.ok) return
    void audioContext.resume?.()
    preview.current = startLoopPreview(audioContext, buffer, draft, { onEnded: () => setPreviewing(false) })
    setPreviewing(true)
  }
  const accept = () => {
    if (!draft || !validity?.ok) return
    stopPreview()
    onAccept(acceptLoop(draft, proposal, confidence))
    setSaved(true)
  }
  const nudgeBy = (target: NudgeTarget, direction: -1 | 1, step: NudgeStep) => {
    if (draft) change(nudge(draft, target, direction, step, durationSamples))
  }
  const setPoint = (target: NudgeTarget, text: string) => {
    const samples = parseSeconds(text, sampleRate)
    if (!draft || samples === null) return
    change(target === 'start' ? { ...draft, startSample: samples } : { ...draft, endSample: samples })
  }

  const analysing = phase.name === 'analysing'
  return (
    <section className="loop-editor" aria-label={`Loop for ${title}`}>
      <h3 className="loop-editor__title">{title}</h3>

      {analysing && (
        <p className="loop-editor__status" role="status">
          Analysing: {phase.stage} ({Math.round(phase.fraction * 100)}%)
        </p>
      )}
      {phase.name === 'failed' && (
        <p className="loop-editor__error" role="alert">
          No automatic loop: {phase.message}
        </p>
      )}
      {!buffer && <p className="loop-editor__status">Loading the audio...</p>}

      {draft ? (
        <>
          <dl className="loop-editor__points">
            <div>
              <dt>{edited || !proposal ? 'Loop Start' : 'Automatic Loop Start'}</dt>
              <dd>
                <input
                  className="loop-editor__time"
                  aria-label="Loop start in seconds"
                  inputMode="decimal"
                  key={`s${draft.startSample}`}
                  defaultValue={formatSeconds(draft.startSample, sampleRate)}
                  onBlur={(event) => setPoint('start', event.currentTarget.value)}
                />{' '}
                s
              </dd>
            </div>
            <div>
              <dt>{edited || !proposal ? 'Loop End' : 'Automatic Loop End'}</dt>
              <dd>
                <input
                  className="loop-editor__time"
                  aria-label="Loop end in seconds"
                  inputMode="decimal"
                  key={`e${draft.endSample}`}
                  defaultValue={formatSeconds(draft.endSample, sampleRate)}
                  onBlur={(event) => setPoint('end', event.currentTarget.value)}
                />{' '}
                s
              </dd>
            </div>
          </dl>

          {label ? (
            <p className="loop-editor__confidence" data-quality={label.quality}>
              <strong>
                {label.percent}% - {label.label}
              </strong>
              <span>{label.advice}</span>
            </p>
          ) : (
            <p className="loop-editor__confidence" data-quality="none">
              <strong>Set by you</strong>
              <span>No measured confidence for a hand-edited loop. Listen to the seam.</span>
            </p>
          )}
          {validity && !validity.ok && (
            <p className="loop-editor__error" role="alert">
              {validity.reason}
            </p>
          )}

          {candidates.length > 1 && (
            <label className="loop-editor__row">
              Candidate
              <select value={selected} onChange={(event) => pick(Number(event.target.value))}>
                {candidates.map((candidate, index) => (
                  <option key={`${candidate.startSample}-${candidate.endSample}`} value={index}>
                    {formatSeconds(candidate.startSample, candidate.sampleRate)} to {formatSeconds(candidate.endSample, candidate.sampleRate)} s ({Math.round(candidate.confidence * 100)}%)
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="loop-editor__row">
            <label>
              <input
                type="checkbox"
                checked={draft.crossfadeMs > 0}
                onChange={(event) => change(setCrossfade(draft, event.target.checked ? candidates[selected]?.recommendedCrossfadeMs || 20 : 0))}
              />{' '}
              Short crossfade at the seam
            </label>
            {draft.crossfadeMs > 0 && (
              <label>
                <input
                  className="loop-editor__ms"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.crossfadeMs}
                  onChange={(event) => change(setCrossfade(draft, Number(event.target.value)))}
                />{' '}
                ms
              </label>
            )}
          </div>

          <div className="loop-editor__actions">
            <button type="button" onClick={togglePreview} disabled={!audioContext || !buffer || !validity?.ok}>
              {previewing ? 'Stop preview' : 'Preview Loop'}
            </button>
            <button type="button" onClick={accept} disabled={!validity?.ok}>
              Accept
            </button>
            <button type="button" aria-expanded={adjusting} onClick={() => setAdjusting((value) => !value)}>
              Adjust
            </button>
            <button type="button" onClick={() => void runAnalysis()} disabled={!buffer || analysing}>
              Analyse again
            </button>
          </div>
          {saved && (
            <p className="loop-editor__status" role="status">
              Loop saved{edited ? ' (adjusted)' : ''}.
            </p>
          )}

          {adjusting && (
            <div className="loop-editor__adjust">
              {(['start', 'end'] as const).map((target) => (
                <fieldset key={target}>
                  <legend>{target === 'start' ? 'Loop start' : 'Loop end'}</legend>
                  {STEPS.map(({ step, label: stepLabel, title: stepTitle }) => (
                    <span key={step} className="loop-editor__nudge" title={stepTitle}>
                      <button type="button" aria-label={`${target} earlier by ${stepLabel}`} onClick={() => nudgeBy(target, -1, step)}>
                        -
                      </button>
                      <span>{stepLabel}</span>
                      <button type="button" aria-label={`${target} later by ${stepLabel}`} onClick={() => nudgeBy(target, 1, step)}>
                        +
                      </button>
                    </span>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </>
      ) : (
        !analysing &&
        buffer && (
          <div className="loop-editor__actions">
            <button type="button" onClick={() => void runAnalysis()}>
              Find loop automatically
            </button>
          </div>
        )
      )}
    </section>
  )
}
