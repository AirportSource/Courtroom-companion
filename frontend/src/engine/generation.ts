// Safe generation diagnostics, separate from character intent and presentation.
import { translator, type Language } from '../i18n/i18n.ts'

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

export function generationFailureMessage(error: string | null | undefined, diagnostics?: GenerationDiagnostics,
  language: Language = 'en'): string | null {
  const t = translator(language)
  const artifact = diagnostics?.workload === 'text_artifact'
  const saved = artifact ? t('generation.noPartialFile') : ''
  switch (error) {
    case 'output_token_limit': {
      const budget = diagnostics ? t('generation.budget', { tokens: diagnostics.maxOutputTokens }) : ''
      return t(artifact ? 'generation.outputLimitFile' : 'generation.outputLimit', { budget })
    }
    case 'context_window_exceeded':
      return t('generation.contextWindow', { saved })
    case 'artifact_too_large':
      return t('generation.artifactTooLarge')
    case 'provider_limit':
    case 'rate_limited':
      return t('generation.providerLimit', { saved })
    case 'provider_refused':
      return t('generation.refused', { saved })
    case 'attachment_unsupported':
      return t('generation.attachmentUnsupported')
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
