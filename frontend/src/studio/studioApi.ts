// Character Studio client (Character Lore Builder, D-100..D-103): PDF extraction, lore analysis,
// approval and the approved-knowledge overlay. Every response is parsed defensively: the backend
// is trusted, but a malformed body must degrade to a readable error, never crash the screen.

export type ExtractionState = 'queued' | 'extracting' | 'ocr_running' | 'complete' | 'ocr_required' | 'failed' | 'cancelled'
export type AnalysisState = 'analyzing' | 'review_required' | 'failed' | 'cancelled'
export type ReviewStatus = 'proposed' | 'needs_review' | 'rejected'

export interface OcrStatus {
  available: boolean
  version?: string
  languages: string[]
  supported: Record<string, string>
  missingDefaultLanguages: string[]
  error?: { code: string; message: string }
  installHint?: string
}

export interface ExtractedPage {
  page: number
  method: 'text' | 'ocr' | 'none'
  status: 'ok' | 'empty' | 'ocr_required' | 'failed' | 'skipped'
  text: string
  nativeText: string
  ocrReason: string | null
  confidence: number | null
  error: string | null
  warnings: string[]
}

export interface ExtractionSummary {
  pageCount: number
  textPages: number[]
  ocrPages: number[]
  emptyPages: number[]
  ocrRequiredPages: number[]
  failedPages: number[]
  skippedPages: number[]
  textChars: number
  meanOcrConfidence: number | null
}

export interface ExtractionJob {
  id: string
  character: string
  sourceName: string
  state: ExtractionState
  progress: { pagesDone: number; pagesTotal: number }
  error: { code: string; message: string } | null
  extraction?: { summary: ExtractionSummary; errors: { code: string; message: string }[]; pages: ExtractedPage[] }
}

export interface CleanedDocument {
  license: string | null
  url: string | null
  pages: { page: number; text: string }[]
  removed: { page: number; text: string; rule: string }[]
}

export interface EvidenceCheck { status: string; page: number | null; score: number }
export interface SupportingReference { pages: number[]; evidence: string }

export interface ProposedFact {
  id: string
  category: string
  subject: string
  predicate: string
  object: string | null
  description: string
  basis: 'explicit' | 'interpretation' | 'inferred' | 'uncertain'
  sourcePages: number[]
  evidence: string
  evidenceCheck: EvidenceCheck
  reviewStatus: ReviewStatus
  flags: string[]
  alsoSupportedBy: SupportingReference[]
  matchesExisting: string[]
}

export interface ProposedTrait {
  id: string
  trait: string
  guidance: string
  kind: string
  sourcePages: number[]
  evidence: string
  evidenceCheck: EvidenceCheck
  reviewStatus: ReviewStatus
  flags: string[]
  alsoSupportedBy: SupportingReference[]
  alreadyDescribed: boolean
}

export interface Conflict {
  id: string
  kind: 'direct_contradiction' | 'timeline_conflict' | 'source_uncertainty' | 'duplicate_assertion' | 'complementary'
  factId: string
  existing: string
  otherFactId: string | null
  note: string
}

export interface LoreProposal {
  id: string
  characterId: string
  characterName: string
  narrativeReference: string | null
  source: { name: string; pageCount: number; pagesAnalyzed: number[]; excludedPages: number[]; license: string | null; url: string | null }
  provider: { type: string; model: string | null; remote: boolean }
  summary: { chunks: number; chunksFailed: number; facts: number; needsReview: number; rejected: number; duplicatesMerged: number; conflicts: number; traits: number }
  facts: ProposedFact[]
  rejectedFacts: ProposedFact[]
  traits: ProposedTrait[]
  rejectedTraits: ProposedTrait[]
  conflicts: Conflict[]
  comparison: { recovered: string[]; notRecovered: string[]; newFactIds: string[] }
  warnings: string[]
}

export interface AnalysisJob {
  id: string
  character: string
  state: AnalysisState
  progress: { chunksDone: number; chunksTotal: number }
  error: { code: string; message: string } | null
  proposal: LoreProposal | null
}

export interface ApprovedItem {
  id: string
  description?: string
  trait?: string
  guidance?: string
  basis?: string
  provenance: { sourceDocument: string; sourcePages: number[]; evidence: string; approvedAt: string; edited: boolean }
}

export interface CharacterKnowledge {
  characterId: string
  facts: ApprovedItem[]
  traits: ApprovedItem[]
  sources: { name: string; license: string | null; url: string | null }[]
  updatedAt: string | null
  contextSize: { promptCost: number; loreCost: number; budgetCost: number; overBudget: boolean } | null
}

export interface ApprovalResult {
  approved: string[]
  skipped: { id: string; reason: string }[]
  knowledge: CharacterKnowledge
}

/** A request the server refused, with its machine-readable code (e.g. remote_consent_required). */
export class StudioError extends Error {
  code: string
  status: number
  detail: Record<string, unknown>

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [])
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
const list = <T>(value: unknown, parse: (item: Record<string, unknown>) => T): T[] =>
  (Array.isArray(value) ? value.filter(isObject).map(parse) : [])
const errorOf = (value: unknown) => (isObject(value) ? { code: str(value.code), message: str(value.message) } : null)

export function errorFromResponse(status: number, body: unknown): StudioError {
  const detail = isObject(body) ? body.detail : null
  if (typeof detail === 'string') return new StudioError(status, `http_${status}`, detail)
  if (Array.isArray(detail)) return new StudioError(status, 'invalid_request', 'The request was rejected as invalid.')
  if (isObject(detail)) {
    return new StudioError(status, str(detail.code, `http_${status}`), str(detail.message, `The server answered ${status}.`), detail)
  }
  return new StudioError(status, `http_${status}`, `The server answered ${status}.`)
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { ...init, cache: 'no-store' })
  } catch {
    throw new StudioError(0, 'unreachable', 'The backend is unreachable. Is it running?')
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw errorFromResponse(response.status, body)
  return body
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export function parseOcrStatus(raw: unknown): OcrStatus {
  const body = isObject(raw) ? raw : {}
  return {
    available: body.available === true,
    version: typeof body.version === 'string' ? body.version : undefined,
    languages: strs(body.languages),
    supported: isObject(body.supported) ? Object.fromEntries(Object.entries(body.supported).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
    missingDefaultLanguages: strs(body.missingDefaultLanguages),
    error: errorOf(body.error) ?? undefined,
    installHint: typeof body.installHint === 'string' ? body.installHint : undefined,
  }
}

const EXTRACTION_STATES: ExtractionState[] = ['queued', 'extracting', 'ocr_running', 'complete', 'ocr_required', 'failed', 'cancelled']

export function parseExtractionJob(raw: unknown): ExtractionJob {
  const body = isObject(raw) ? raw : {}
  const progress = isObject(body.progress) ? body.progress : {}
  const extraction = isObject(body.extraction) ? body.extraction : null
  const summary = extraction && isObject(extraction.summary) ? extraction.summary : {}
  return {
    id: str(body.id),
    character: str(body.character),
    sourceName: str(body.sourceName),
    state: EXTRACTION_STATES.includes(body.state as ExtractionState) ? body.state as ExtractionState : 'failed',
    progress: { pagesDone: num(progress.pagesDone), pagesTotal: num(progress.pagesTotal) },
    error: errorOf(body.error),
    extraction: extraction ? {
      summary: {
        pageCount: num(summary.pageCount), textPages: nums(summary.textPages), ocrPages: nums(summary.ocrPages),
        emptyPages: nums(summary.emptyPages), ocrRequiredPages: nums(summary.ocrRequiredPages),
        failedPages: nums(summary.failedPages), skippedPages: nums(summary.skippedPages),
        textChars: num(summary.textChars), meanOcrConfidence: typeof summary.meanOcrConfidence === 'number' ? summary.meanOcrConfidence : null,
      },
      errors: list(extraction.errors, (e) => ({ code: str(e.code), message: str(e.message) })),
      pages: list(extraction.pages, (p) => ({
        page: num(p.page), method: (['text', 'ocr', 'none'].includes(p.method as string) ? p.method : 'none') as ExtractedPage['method'],
        status: (['ok', 'empty', 'ocr_required', 'failed', 'skipped'].includes(p.status as string) ? p.status : 'failed') as ExtractedPage['status'],
        text: str(p.text), nativeText: str(p.nativeText), ocrReason: typeof p.ocrReason === 'string' ? p.ocrReason : null,
        confidence: typeof p.confidence === 'number' ? p.confidence : null, error: typeof p.error === 'string' ? p.error : null,
        warnings: strs(p.warnings),
      })),
    } : undefined,
  }
}

export function parseCleaned(raw: unknown): CleanedDocument {
  const body = isObject(raw) ? raw : {}
  return {
    license: typeof body.license === 'string' ? body.license : null,
    url: typeof body.url === 'string' ? body.url : null,
    pages: list(body.pages, (p) => ({ page: num(p.page), text: str(p.text) })),
    removed: list(body.removed, (r) => ({ page: num(r.page), text: str(r.text), rule: str(r.rule) })),
  }
}

const check = (value: unknown): EvidenceCheck => {
  const body = isObject(value) ? value : {}
  return { status: str(body.status, 'not_found'), page: typeof body.page === 'number' ? body.page : null, score: num(body.score) }
}
const refs = (value: unknown) => list(value, (r) => ({ pages: nums(r.pages), evidence: str(r.evidence) }))
const review = (value: unknown): ReviewStatus => (value === 'proposed' || value === 'needs_review' ? value : 'rejected')

const fact = (f: Record<string, unknown>): ProposedFact => ({
  id: str(f.id), category: str(f.category), subject: str(f.subject), predicate: str(f.predicate),
  object: typeof f.object === 'string' ? f.object : null, description: str(f.description),
  basis: (['explicit', 'interpretation', 'inferred', 'uncertain'].includes(f.basis as string) ? f.basis : 'uncertain') as ProposedFact['basis'],
  sourcePages: nums(f.sourcePages), evidence: str(f.evidence), evidenceCheck: check(f.evidenceCheck),
  reviewStatus: review(f.reviewStatus), flags: strs(f.flags), alsoSupportedBy: refs(f.alsoSupportedBy),
  matchesExisting: strs(f.matchesExisting),
})

const trait = (t: Record<string, unknown>): ProposedTrait => ({
  id: str(t.id), trait: str(t.trait), guidance: str(t.guidance), kind: str(t.kind), sourcePages: nums(t.sourcePages),
  evidence: str(t.evidence), evidenceCheck: check(t.evidenceCheck), reviewStatus: review(t.reviewStatus), flags: strs(t.flags),
  alsoSupportedBy: refs(t.alsoSupportedBy), alreadyDescribed: t.alreadyDescribed === true,
})

const CONFLICT_KINDS: Conflict['kind'][] = ['direct_contradiction', 'timeline_conflict', 'source_uncertainty', 'duplicate_assertion', 'complementary']

export function parseProposal(raw: unknown): LoreProposal | null {
  if (!isObject(raw)) return null
  const source = isObject(raw.source) ? raw.source : {}
  const provider = isObject(raw.provider) ? raw.provider : {}
  const summary = isObject(raw.summary) ? raw.summary : {}
  const comparison = isObject(raw.comparison) ? raw.comparison : {}
  return {
    id: str(raw.id), characterId: str(raw.characterId), characterName: str(raw.characterName),
    narrativeReference: typeof raw.narrativeReference === 'string' ? raw.narrativeReference : null,
    source: {
      name: str(source.name), pageCount: num(source.pageCount), pagesAnalyzed: nums(source.pagesAnalyzed),
      excludedPages: nums(source.excludedPages), license: typeof source.license === 'string' ? source.license : null,
      url: typeof source.url === 'string' ? source.url : null,
    },
    provider: { type: str(provider.type), model: typeof provider.model === 'string' ? provider.model : null, remote: provider.remote === true },
    summary: {
      chunks: num(summary.chunks), chunksFailed: num(summary.chunksFailed), facts: num(summary.facts), needsReview: num(summary.needsReview),
      rejected: num(summary.rejected), duplicatesMerged: num(summary.duplicatesMerged), conflicts: num(summary.conflicts), traits: num(summary.traits),
    },
    facts: list(raw.facts, fact), rejectedFacts: list(raw.rejectedFacts, fact),
    traits: list(raw.traits, trait), rejectedTraits: list(raw.rejectedTraits, trait),
    conflicts: list(raw.conflicts, (c) => ({
      id: str(c.id), kind: (CONFLICT_KINDS.includes(c.kind as Conflict['kind']) ? c.kind : 'complementary') as Conflict['kind'],
      factId: str(c.factId), existing: str(c.existing), otherFactId: typeof c.otherFactId === 'string' ? c.otherFactId : null, note: str(c.note),
    })),
    comparison: { recovered: strs(comparison.recovered), notRecovered: strs(comparison.notRecovered), newFactIds: strs(comparison.newFactIds) },
    warnings: strs(raw.warnings),
  }
}

export function parseAnalysisJob(raw: unknown): AnalysisJob {
  const body = isObject(raw) ? raw : {}
  const progress = isObject(body.progress) ? body.progress : {}
  const state = ['analyzing', 'review_required', 'failed', 'cancelled'].includes(body.state as string) ? body.state as AnalysisState : 'failed'
  return {
    id: str(body.id), character: str(body.character), state,
    progress: { chunksDone: num(progress.chunksDone), chunksTotal: num(progress.chunksTotal) },
    error: errorOf(body.error), proposal: parseProposal(body.proposal),
  }
}

const provenance = (value: unknown): ApprovedItem['provenance'] => {
  const body = isObject(value) ? value : {}
  return { sourceDocument: str(body.sourceDocument), sourcePages: nums(body.sourcePages), evidence: str(body.evidence),
    approvedAt: str(body.approvedAt), edited: body.edited === true }
}

export function parseKnowledge(raw: unknown): CharacterKnowledge {
  const body = isObject(raw) ? raw : {}
  const size = isObject(body.contextSize) ? body.contextSize : null
  return {
    characterId: str(body.characterId),
    facts: list(body.facts, (f) => ({ id: str(f.id), description: str(f.description), basis: str(f.basis), provenance: provenance(f.provenance) })),
    traits: list(body.traits, (t) => ({ id: str(t.id), trait: str(t.trait), guidance: str(t.guidance), provenance: provenance(t.provenance) })),
    sources: list(body.sources, (s) => ({ name: str(s.name), license: typeof s.license === 'string' ? s.license : null, url: typeof s.url === 'string' ? s.url : null })),
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    contextSize: size ? { promptCost: num(size.promptCost), loreCost: num(size.loreCost), budgetCost: num(size.budgetCost), overBudget: size.overBudget === true } : null,
  }
}

export const studioApi = {
  ocrStatus: async () => parseOcrStatus(await request('/api/documents/ocr')),
  startExtraction: async (file: File, character: string, languages: string[], forceOcr: number[] = []) => {
    const params = new URLSearchParams({ character, languages: languages.join('+') })
    if (forceOcr.length) params.set('forceOcr', forceOcr.join(','))
    return parseExtractionJob(await request(`/api/documents/extractions?${params}`, {
      method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/pdf' },
    }))
  },
  extraction: async (id: string) => parseExtractionJob(await request(`/api/documents/extractions/${encodeURIComponent(id)}`)),
  discardExtraction: async (id: string) => { await request(`/api/documents/extractions/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  cleaned: async (id: string) => parseCleaned(await request(`/api/documents/extractions/${encodeURIComponent(id)}/cleaned`)),
  startAnalysis: async (extractionId: string, allowRemote: boolean, excludePages: number[]) => parseAnalysisJob(
    await request(`/api/documents/extractions/${encodeURIComponent(extractionId)}/analysis`, json('POST', { allowRemote, excludePages }))),
  analysis: async (id: string) => parseAnalysisJob(await request(`/api/documents/analyses/${encodeURIComponent(id)}`)),
  discardAnalysis: async (id: string) => { await request(`/api/documents/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  approve: async (analysisId: string, payload: ApprovalPayload): Promise<ApprovalResult> => {
    const body = await request(`/api/documents/analyses/${encodeURIComponent(analysisId)}/approval`, json('POST', payload))
    const result = isObject(body) ? body : {}
    return { approved: strs(result.approved), skipped: list(result.skipped, (s) => ({ id: str(s.id), reason: str(s.reason) })),
      knowledge: parseKnowledge(result.knowledge) }
  },
  knowledge: async (character: string) => parseKnowledge(await request(`/api/characters/${encodeURIComponent(character)}/knowledge`)),
  removeItem: async (character: string, itemId: string) => parseKnowledge(await request(
    `/api/characters/${encodeURIComponent(character)}/knowledge/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })),
  factoryReset: async (character: string) => {
    const body = await request(`/api/characters/${encodeURIComponent(character)}/knowledge?confirm=true`, { method: 'DELETE' })
    return parseKnowledge(isObject(body) ? body.knowledge : null)
  },
  exportUrl: (character: string) => `/api/characters/${encodeURIComponent(character)}/knowledge/export`,
}

export interface ApprovalPayload {
  factIds: string[]
  traitIds: string[]
  edits: Record<string, string>
  acknowledge: string[]
}
