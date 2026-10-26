import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  errorFromResponse, parseAnalysisJob, parseExtractionJob, parseKnowledge, parseOcrStatus, type LoreProposal,
} from '../src/studio/studioApi.ts'
import {
  acknowledgementReason, buildApprovalPayload, consentText, describeEvidence, emptyReview, progressText, stageOf,
  suggestedSelection, toggle,
} from '../src/studio/studioState.ts'

const check = { status: 'verified', page: 1, score: 1 }
const fact = (id: string, extra: Record<string, unknown> = {}) => ({
  id, category: 'family', subject: 'Iris', predicate: 'twin_sister_of', object: 'Dahlia Hawthorne', description: `Fact ${id}.`,
  basis: 'explicit', sourcePages: [1], evidence: 'her twin sister, Dahlia Hawthorne', evidenceCheck: check,
  reviewStatus: 'proposed', flags: [], alsoSupportedBy: [], matchesExisting: [], ...extra,
})

function proposal(): LoreProposal {
  const job = parseAnalysisJob({
    id: 'a1', character: 'iris', state: 'review_required', progress: { chunksDone: 3, chunksTotal: 3 }, error: null,
    proposal: {
      id: 'p1', characterId: 'iris', characterName: 'Iris', narrativeReference: 'after Bridge to the Turnabout',
      source: { name: 'Iris.pdf', pageCount: 8, pagesAnalyzed: [1, 2], excludedPages: [], license: 'CC-BY-SA', url: null },
      provider: { type: 'fake', model: null, remote: false },
      summary: { chunks: 3, chunksFailed: 0, facts: 4, needsReview: 1, rejected: 1, duplicatesMerged: 1, conflicts: 1, traits: 2 },
      facts: [
        fact('f1'),
        fact('f2', { predicate: 'raised_at', object: 'Kurain Village', basis: 'interpretation', reviewStatus: 'needs_review' }),
        fact('f3', { matchesExisting: ['Twin sister: Dahlia Hawthorne.'] }),
        fact('f4', { predicate: 'mother', object: 'Morgan Fey' }),
      ],
      rejectedFacts: [fact('f9', { reviewStatus: 'rejected', evidenceCheck: { status: 'not_found', page: null, score: 0 } })],
      traits: [
        { id: 't1', trait: 'sees good in people', guidance: 'Looks for good.', kind: 'explicit_trait', sourcePages: [5], evidence: 'x',
          evidenceCheck: check, reviewStatus: 'proposed', flags: [], alsoSupportedBy: [], alreadyDescribed: true },
        { id: 't2', trait: 'self-blaming', guidance: 'Takes blame.', kind: 'explicit_trait', sourcePages: [5], evidence: 'y',
          evidenceCheck: check, reviewStatus: 'proposed', flags: [], alsoSupportedBy: [], alreadyDescribed: false },
      ],
      rejectedTraits: [],
      conflicts: [
        { id: 'c1', kind: 'direct_contradiction', factId: 'f2', existing: 'raised at the temple', otherFactId: null, note: 'n' },
        { id: 'c2', kind: 'complementary', factId: 'f4', existing: 'Mother: Morgan Fey', otherFactId: null, note: 'n' },
      ],
      comparison: { recovered: ['a'], notRecovered: ['b'], newFactIds: ['f1'] },
      warnings: [],
    },
  })
  assert.ok(job.proposal)
  return job.proposal
}

test('stage labels follow the backend states and never run ahead of them', () => {
  assert.equal(stageOf(null, null, false), 'Ready')
  assert.equal(stageOf('queued', null, false), 'Extracting')
  assert.equal(stageOf('ocr_running', null, false), 'OCR running')
  assert.equal(stageOf('ocr_required', null, false), 'OCR required')
  assert.equal(stageOf('complete', null, false), 'Extraction complete')
  assert.equal(stageOf('complete', 'analyzing', false), 'Analyzing')
  assert.equal(stageOf('complete', 'review_required', false), 'Review required')
  assert.equal(stageOf('complete', 'review_required', true), 'Applied')
  assert.equal(stageOf('failed', null, false), 'Failed')
  assert.equal(progressText(3, 8, 'pages'), '3/8 pages')
  assert.equal(progressText(0, 0, 'pages'), '') // no invented progress before the total is known
})

test('suggested selection skips items that need review, conflict or repeat known lore', () => {
  assert.deepEqual(suggestedSelection(proposal()), ['f1', 'f4', 't2'])
})

test('approval needs acknowledgement for conflicts and known items, and only sends real edits', () => {
  const p = proposal()
  assert.match(acknowledgementReason(p, p.facts[1])!, /Conflicts with: raised at the temple/)
  assert.match(acknowledgementReason(p, p.facts[2])!, /built-in lore/)
  assert.match(acknowledgementReason(p, p.traits[0])!, /built-in personality/)
  assert.equal(acknowledgementReason(p, p.facts[3]), null) // complementary is informational

  let review = { ...emptyReview(), selected: ['f1', 'f2', 't1', 'f9'] }
  let result = buildApprovalPayload(p, review)
  assert.equal(result.problems.length, 2)
  assert.deepEqual(result.payload.factIds, ['f1', 'f2']) // rejected/unknown ids are never sent

  review = { selected: ['f1', 'f2', 't1'], acknowledged: ['f2', 't1', 'f4'],
    edits: { f1: '  Iris and Dahlia are twins.  ', t1: 'Looks for good.', f4: 'not selected' } }
  result = buildApprovalPayload(p, review)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.payload, {
    factIds: ['f1', 'f2'], traitIds: ['t1'], edits: { f1: 'Iris and Dahlia are twins.' }, acknowledge: ['f2', 't1'],
  })
  assert.deepEqual(buildApprovalPayload(p, { ...review, edits: { f1: '   ' } }).problems, ['f1: edited text cannot be empty'])
  assert.deepEqual(buildApprovalPayload(p, emptyReview()).problems, ['Select at least one fact or trait.'])
})

test('consent text names the provider, the document and that OCR stayed local', () => {
  const text = consentText({ type: 'anthropic', model: 'claude-x' }, 'Iris.pdf', 6)
  assert.match(text, /anthropic \/ claude-x is a remote service/)
  assert.match(text, /6 page\(s\) of "Iris\.pdf"/)
  assert.match(text, /OCR\) already ran on this computer/)
  assert.match(consentText(undefined, 'x.pdf', 1), /^the active provider/)
})

test('parsers survive malformed bodies and keep page provenance', () => {
  const job = parseExtractionJob({
    id: 'e1', state: 'complete', sourceName: 'Iris.pdf', progress: { pagesDone: 8, pagesTotal: 8 },
    extraction: { summary: { pageCount: 8, ocrPages: [1, 2], meanOcrConfidence: 91.9 }, errors: [],
      pages: [{ page: 2, method: 'ocr', status: 'ok', text: 'Iris', confidence: 91, warnings: [] }, 'junk'] },
  })
  assert.equal(job.extraction?.pages.length, 1)
  assert.equal(job.extraction?.pages[0].page, 2)
  assert.equal(job.extraction?.summary.meanOcrConfidence, 91.9)
  assert.equal(parseExtractionJob({ state: 'exploded' }).state, 'failed')
  assert.equal(parseAnalysisJob(null).proposal, null)
  assert.deepEqual(parseOcrStatus({ available: false, error: { code: 'tesseract_missing', message: 'm' } }).error,
    { code: 'tesseract_missing', message: 'm' })
  assert.equal(parseKnowledge({ facts: [{ id: 'x', description: 'd', provenance: { sourcePages: [3] } }] }).facts[0].provenance.sourcePages[0], 3)
})

test('server refusals keep their machine-readable code', () => {
  const consent = errorFromResponse(409, { detail: { code: 'remote_consent_required', message: 'm', provider: { type: 'anthropic' } } })
  assert.equal(consent.code, 'remote_consent_required')
  assert.deepEqual(consent.detail.provider, { type: 'anthropic' })
  assert.equal(errorFromResponse(404, { detail: 'Unknown analysis.' }).message, 'Unknown analysis.')
  assert.equal(errorFromResponse(422, { detail: [{ loc: ['body'] }] }).code, 'invalid_request')
  assert.equal(errorFromResponse(500, null).code, 'http_500')
})

test('evidence descriptions and toggles', () => {
  assert.equal(describeEvidence({ status: 'fuzzy', page: 3, score: 0.98 }), 'Close match on p.3 (98%)')
  assert.equal(describeEvidence({ status: 'not_found', page: null, score: 0 }), 'Quote not found in the document')
  assert.deepEqual(toggle([1, 2], 2, true), [1, 2])
  assert.deepEqual(toggle([1, 2], 2, false), [1])
})
