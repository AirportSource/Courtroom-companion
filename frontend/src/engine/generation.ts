// Safe generation diagnostics, separate from character intent and presentation.
export interface GenerationDiagnostics {
  workload: 'dialogue' | 'text_artifact'
  maxOutputTokens: number
  stopReason?: 'max_tokens' | 'model_context_window_exceeded' | 'end_turn' | 'refusal' | 'stop_sequence'
  failureClass?: FailureClass
}

export type FailureClass = 'output_truncated' | 'context_window_exceeded' | 'artifact_too_large' | 'provider_limit' | 'unknown_provider_error'
const FAILURE_CLASSES: string[] = ['output_truncated', 'context_window_exceeded', 'artifact_too_large', 'provider_limit', 'unknown_provider_error']

const STOP_REASONS = ['max_tokens', 'model_context_window_exceeded', 'end_turn', 'refusal', 'stop_sequence']

export function parseGeneration(raw: unknown): GenerationDiagnostics | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if ((d.workload !== 'dialogue' && d.workload !== 'text_artifact')
    || typeof d.maxOutputTokens !== 'number' || !Number.isInteger(d.maxOutputTokens)
    || d.maxOutputTokens < 16 || d.maxOutputTokens > 16384) return null
  return { workload: d.workload, maxOutputTokens: d.maxOutputTokens,
    ...(typeof d.stopReason === 'string' && STOP_REASONS.includes(d.stopReason)
      ? { stopReason: d.stopReason as GenerationDiagnostics['stopReason'] } : {}),
    ...(typeof d.failureClass === 'string' && FAILURE_CLASSES.includes(d.failureClass)
      ? { failureClass: d.failureClass as FailureClass } : {}) }
}

export function generationFailureMessage(error: string | null | undefined, diagnostics?: GenerationDiagnostics): string | null {
  const artifact = diagnostics?.workload === 'text_artifact'
  const saved = artifact ? ' No partial file was saved.' : ''
  switch (error) {
    case 'output_token_limit': {
      const budget = diagnostics ? ` (${diagnostics.maxOutputTokens} tokens)` : ''
      const what = artifact ? 'file' : 'reply'
      return `The model reached its output limit${budget} before finishing the ${what}. Incomplete output was discarded.${saved}`
    }
    case 'context_window_exceeded':
      return `The conversation is too large for this model's context window. Shorten the conversation or input; increasing the output budget alone will not fix this.${saved}`
    case 'artifact_too_large':
      return 'The generated file is larger than the 64 KiB limit. Ask for a smaller file or split it. No file was saved.'
    case 'provider_limit':
    case 'rate_limited':
      return `The provider's rate, quota or request-size limit was reached. Wait a moment or check the account, then try again.${saved}`
    case 'provider_refused':
      return `The provider declined the generation request.${saved}`
    default:
      return null
  }
}

/** Technical code/reason line for dev/status diagnostics. */
export function generationDiagnosticLine(error: string | null | undefined, diagnostics?: GenerationDiagnostics): string | null {
  if (!diagnostics) return null
  const parts = [`${diagnostics.workload}`, `budget ${diagnostics.maxOutputTokens}`]
  if (diagnostics.stopReason) parts.push(`stop ${diagnostics.stopReason}`)
  if (diagnostics.failureClass) parts.push(`class ${diagnostics.failureClass}`)
  if (error) parts.push(`code ${error}`)
  return `generation: ${parts.join(' · ')}`
}
