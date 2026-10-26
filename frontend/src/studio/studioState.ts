// Character Studio workflow rules (D-103), kept pure for tests: stage labels, review selection,
// conflict/duplicate acknowledgement and the approval payload sent to the backend.

import type {
  AnalysisState, ApprovalPayload, Conflict, ExtractionState, LoreProposal, ProposedFact, ProposedTrait,
} from './studioApi.ts'

export type Stage =
  | 'Ready' | 'Extracting' | 'OCR running' | 'OCR required' | 'Extraction complete'
  | 'Analyzing' | 'Review required' | 'Applied' | 'Failed' | 'Cancelled'

/** The one stage shown to the user. A stage is never reported before the backend says so. */
export function stageOf(extraction: ExtractionState | null, analysis: AnalysisState | null, applied: boolean): Stage {
  if (applied) return 'Applied'
  if (analysis) {
    return ({ analyzing: 'Analyzing', review_required: 'Review required', failed: 'Failed', cancelled: 'Cancelled' } as const)[analysis]
  }
  if (!extraction) return 'Ready'
  return ({
    queued: 'Extracting', extracting: 'Extracting', ocr_running: 'OCR running', complete: 'Extraction complete',
    ocr_required: 'OCR required', failed: 'Failed', cancelled: 'Cancelled',
  } as const)[extraction]
}

export const isExtractionFinal = (state: ExtractionState) => ['complete', 'ocr_required', 'failed', 'cancelled'].includes(state)
export const isAnalysisFinal = (state: AnalysisState) => state !== 'analyzing'

/** Progress text from real counters only ("3/8 pages"); nothing when the total is unknown. */
export function progressText(done: number, total: number, unit: string): string {
  return total > 0 ? `${Math.min(done, total)}/${total} ${unit}` : ''
}

const BLOCKING: Conflict['kind'][] = ['direct_contradiction', 'timeline_conflict']

export function conflictsFor(proposal: LoreProposal, factId: string): Conflict[] {
  return proposal.conflicts.filter((conflict) => conflict.factId === factId)
}

export function blockingConflicts(proposal: LoreProposal, factId: string): Conflict[] {
  return conflictsFor(proposal, factId).filter((conflict) => BLOCKING.includes(conflict.kind))
}

/** Why an item can only be approved with an explicit acknowledgement, or null. */
export function acknowledgementReason(proposal: LoreProposal, item: ProposedFact | ProposedTrait): string | null {
  if ('predicate' in item) {
    const blocking = blockingConflicts(proposal, item.id)
    if (blocking.length) return `Conflicts with: ${blocking.map((c) => c.existing).join(' / ')}`
    if (item.matchesExisting.length) return 'Already stated in the built-in lore.'
    return null
  }
  return item.alreadyDescribed ? 'Already described in the built-in personality.' : null
}

export interface ReviewState {
  selected: string[]
  edits: Record<string, string>
  acknowledged: string[]
}

export const emptyReview = (): ReviewState => ({ selected: [], edits: {}, acknowledged: [] })

export function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on ? (list.includes(value) ? list : [...list, value]) : list.filter((entry) => entry !== value)
}

/** Items the user would most likely keep: proposed, well grounded, no conflict, not already known. */
export function suggestedSelection(proposal: LoreProposal): string[] {
  return [...proposal.facts, ...proposal.traits]
    .filter((item) => item.reviewStatus === 'proposed' && acknowledgementReason(proposal, item) === null)
    .map((item) => item.id)
}

export interface PayloadResult {
  payload: ApprovalPayload
  /** Problems that must be fixed before applying (empty = ready). */
  problems: string[]
}

export function buildApprovalPayload(proposal: LoreProposal, review: ReviewState): PayloadResult {
  const facts = new Set(proposal.facts.map((f) => f.id))
  const traits = new Set(proposal.traits.map((t) => t.id))
  const items = new Map<string, ProposedFact | ProposedTrait>([...proposal.facts, ...proposal.traits].map((i) => [i.id, i]))
  const selected = review.selected.filter((id) => items.has(id))
  const problems: string[] = []
  if (!selected.length) problems.push('Select at least one fact or trait.')
  for (const id of selected) {
    const reason = acknowledgementReason(proposal, items.get(id)!)
    if (reason && !review.acknowledged.includes(id)) problems.push(`${id}: acknowledge before approving (${reason})`)
  }
  const edits: Record<string, string> = {}
  for (const [id, text] of Object.entries(review.edits)) {
    if (!selected.includes(id)) continue
    const original = items.get(id)!
    const before = 'predicate' in original ? original.description : original.guidance
    if (!text.trim()) problems.push(`${id}: edited text cannot be empty`)
    else if (text.trim() !== before.trim()) edits[id] = text.trim()
  }
  return {
    payload: {
      factIds: selected.filter((id) => facts.has(id)),
      traitIds: selected.filter((id) => traits.has(id)),
      edits,
      acknowledge: review.acknowledged.filter((id) => selected.includes(id)),
    },
    problems,
  }
}

export function describeEvidence(check: { status: string; page: number | null; score: number }): string {
  switch (check.status) {
    case 'verified': return `Quote found on p.${check.page}`
    case 'fuzzy': return `Close match on p.${check.page} (${Math.round(check.score * 100)}%)`
    case 'other_page': return `Quote found on p.${check.page}, not the cited page`
    case 'invalid_page': return 'Cited page does not exist'
    default: return 'Quote not found in the document'
  }
}

export const BASIS_LABEL: Record<ProposedFact['basis'], string> = {
  explicit: 'stated by the source', interpretation: 'interpretation', inferred: 'inferred', uncertain: 'uncertain in the source',
}

/** The consent text for sending a document to a remote provider. */
export function consentText(provider: { type?: unknown; model?: unknown } | undefined, sourceName: string, pages: number): string {
  const name = [provider?.type, provider?.model].filter((part) => typeof part === 'string' && part).join(' / ') || 'the active provider'
  return `${name} is a remote service. Analysing will send the cleaned text of ${pages} page(s) of "${sourceName}" to it. `
    + 'Text recognition (OCR) already ran on this computer. Continue only if you accept sending this document.'
}
