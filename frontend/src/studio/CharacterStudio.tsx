import { useCallback, useEffect, useRef, useState } from 'react'
import {
  StudioError, studioApi, type AnalysisJob, type CharacterKnowledge, type CleanedDocument, type ExtractionJob,
  type LoreProposal, type OcrStatus, type ProposedFact, type ProposedTrait,
} from './studioApi.ts'
import {
  BASIS_LABEL, acknowledgementReason, buildApprovalPayload, conflictsFor, consentText, describeEvidence, emptyReview,
  isAnalysisFinal, isExtractionFinal, progressText, stageOf, suggestedSelection, toggle, type ReviewState,
} from './studioState.ts'
import './character-studio.css'

const POLL_MS = 700

interface CharacterStudioProps {
  characters: { id: string; name: string }[]
  onBack: () => void
  /** Start a conversation with the character to test the result. */
  onTalk: (characterId: string) => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Character Lore Builder UI (D-103), an advanced section outside the DS stage: import a PDF, watch
 * local extraction/OCR, inspect the cleaned text, analyse it with the active provider (remote ones
 * need explicit consent), review each proposed fact/trait, apply the approved ones, and manage or
 * reset the character's approved knowledge. Developer panel: English only (strings.ts convention).
 */
export function CharacterStudio({ characters, onBack, onTalk }: CharacterStudioProps) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? '')
  const [ocr, setOcr] = useState<OcrStatus | null>(null)
  const [languages, setLanguages] = useState<string[]>(['eng', 'fra'])
  const [file, setFile] = useState<File | null>(null)
  const [extraction, setExtraction] = useState<ExtractionJob | null>(null)
  const [cleaned, setCleaned] = useState<CleanedDocument | null>(null)
  const [excluded, setExcluded] = useState<number[]>([])
  const [reocr, setReocr] = useState<number[]>([])
  const [analysis, setAnalysis] = useState<AnalysisJob | null>(null)
  const [consent, setConsent] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState>(emptyReview)
  const [applied, setApplied] = useState<{ approved: string[]; skipped: { id: string; reason: string }[] } | null>(null)
  const [knowledge, setKnowledge] = useState<CharacterKnowledge | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)

  const stopPolling = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null }
  useEffect(() => stopPolling, [])

  useEffect(() => {
    studioApi.ocrStatus().then((status) => {
      setOcr(status)
      setLanguages((current) => current.filter((lang) => !status.available || status.languages.includes(lang)))
    }, (failure) => setError(message(failure)))
  }, [])

  const refreshKnowledge = useCallback((id: string) => {
    if (!id) return
    studioApi.knowledge(id).then(setKnowledge, (failure) => setError(message(failure)))
  }, [])
  useEffect(() => { refreshKnowledge(characterId) }, [characterId, refreshKnowledge])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await action() } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }

  const resetDocument = () => {
    stopPolling()
    if (extraction) void studioApi.discardExtraction(extraction.id).catch(() => {})
    if (analysis) void studioApi.discardAnalysis(analysis.id).catch(() => {})
    setExtraction(null); setCleaned(null); setExcluded([]); setReocr([]); setAnalysis(null)
    setConsent(null); setReview(emptyReview()); setApplied(null); setError(null)
  }

  const pollExtraction = (id: string) => {
    timer.current = window.setTimeout(() => {
      studioApi.extraction(id).then((job) => {
        setExtraction(job)
        if (!isExtractionFinal(job.state)) pollExtraction(id)
        else if (job.extraction) studioApi.cleaned(id).then(setCleaned, (failure) => setError(message(failure)))
      }, (failure) => setError(message(failure)))
    }, POLL_MS)
  }

  const startExtraction = (forceOcr: number[] = []) => run(async () => {
    if (!file || !characterId) return
    const keepExcluded = forceOcr.length ? excluded : []
    resetDocument()
    setExcluded(keepExcluded)
    const job = await studioApi.startExtraction(file, characterId, languages, forceOcr)
    setExtraction(job)
    pollExtraction(job.id)
  })

  const pollAnalysis = (id: string) => {
    timer.current = window.setTimeout(() => {
      studioApi.analysis(id).then((job) => {
        setAnalysis(job)
        if (!isAnalysisFinal(job.state)) pollAnalysis(id)
        else if (job.proposal) setReview({ ...emptyReview(), selected: suggestedSelection(job.proposal) })
      }, (failure) => setError(message(failure)))
    }, POLL_MS)
  }

  const startAnalysis = (allowRemote: boolean) => run(async () => {
    if (!extraction) return
    setConsent(null)
    try {
      const job = await studioApi.startAnalysis(extraction.id, allowRemote, excluded)
      setAnalysis(job)
      pollAnalysis(job.id)
    } catch (failure) {
      if (failure instanceof StudioError && failure.code === 'remote_consent_required') {
        const pages = (extraction.extraction?.pages.filter((p) => p.text.trim()).length ?? 0) - excluded.length
        setConsent(consentText(failure.detail.provider as { type?: unknown; model?: unknown }, extraction.sourceName, Math.max(0, pages)))
        return
      }
      throw failure
    }
  })

  const proposal = analysis?.proposal ?? null
  const { payload, problems } = proposal ? buildApprovalPayload(proposal, review) : { payload: null, problems: [] }

  const apply = () => run(async () => {
    if (!analysis || !payload || problems.length) return
    const result = await studioApi.approve(analysis.id, payload)
    setApplied({ approved: result.approved, skipped: result.skipped })
    setKnowledge(result.knowledge)
  })

  const stage = stageOf(extraction?.state ?? null, analysis?.state ?? null, Boolean(applied?.approved.length))
  const extractionRunning = extraction !== null && !isExtractionFinal(extraction.state)
  const analysisRunning = analysis?.state === 'analyzing'
  const name = characters.find((c) => c.id === characterId)?.name ?? characterId

  return (
    <div className="character-studio">
      <header className="character-studio__header">
        <h1>Character Studio <small>(advanced)</small></h1>
        <span className="character-studio__stage" data-stage={stage} role="status">{stage}</span>
        <button type="button" onClick={() => { stopPolling(); onBack() }}>Back</button>
      </header>
      <p className="character-studio__hint">
        Import a reference PDF, review what it says about the character, and approve what the character should
        know. Nothing changes until you apply your selection; built-in character files are never modified.
      </p>
      {error && <p className="character-studio__error" role="alert">{error}</p>}

      <section className="character-studio__card" aria-label="Document">
        <h2>1. Character and document</h2>
        <label className="character-studio__field">
          <span>Character</span>
          <select value={characterId} disabled={busy || extractionRunning || analysisRunning}
            onChange={(event) => { resetDocument(); setCharacterId(event.target.value) }}>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <OcrLine ocr={ocr} />
        {ocr?.available && (
          <fieldset className="character-studio__languages">
            <legend>OCR languages</legend>
            {Object.entries(ocr.supported).map(([code, label]) => (
              <label key={code}>
                <input type="checkbox" checked={languages.includes(code)} disabled={!ocr.languages.includes(code) || busy}
                  onChange={(event) => setLanguages((current) => toggle(current, code, event.target.checked))} />
                {label}{!ocr.languages.includes(code) && ' (not installed)'}
              </label>
            ))}
          </fieldset>
        )}
        <label className="character-studio__field">
          <span>PDF</span>
          <input type="file" accept="application/pdf,.pdf" disabled={busy || extractionRunning}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <div className="character-studio__actions">
          <button type="button" disabled={!file || !characterId || !languages.length || busy || extractionRunning}
            onClick={() => void startExtraction()}>Extract text</button>
          {extractionRunning && <button type="button" onClick={resetDocument}>Cancel</button>}
          {extraction && !extractionRunning && <button type="button" onClick={resetDocument}>Start over</button>}
        </div>
        {extraction && (
          <ExtractionView job={extraction} cleaned={cleaned} excluded={excluded} reocr={reocr} disabled={busy || analysisRunning}
            onExclude={(page, on) => setExcluded((current) => toggle(current, page, on))}
            onReocr={(page, on) => setReocr((current) => toggle(current, page, on))}
            onRerun={() => void startExtraction(reocr)} />
        )}
      </section>

      {extraction?.extraction && extraction.extraction.summary.textChars > 0 && (
        <section className="character-studio__card" aria-label="Analysis">
          <h2>2. Analyse with the active provider</h2>
          <p className="character-studio__hint">
            The language model proposes facts and personality traits, each with a quote from the document. Every quote is
            checked against the extracted text; unsupported claims are rejected. {excluded.length > 0 && `Excluded pages: ${excluded.join(', ')}.`}
          </p>
          <div className="character-studio__actions">
            <button type="button" disabled={busy || analysisRunning} onClick={() => void startAnalysis(false)}>
              {proposal ? 'Analyse again' : 'Analyse'}
            </button>
            {analysisRunning && <span>{progressText(analysis.progress.chunksDone, analysis.progress.chunksTotal, 'chunks') || 'Starting…'}</span>}
          </div>
          {consent && (
            <div className="character-studio__consent" role="alertdialog" aria-label="Send document to a remote provider?">
              <p>{consent}</p>
              <div className="character-studio__actions">
                <button type="button" onClick={() => void startAnalysis(true)}>Send and analyse</button>
                <button type="button" onClick={() => setConsent(null)}>Cancel</button>
              </div>
            </div>
          )}
          {analysis?.state === 'failed' && <p className="character-studio__error">{analysis.error?.message ?? 'The analysis failed.'}</p>}
        </section>
      )}

      {proposal && (
        <ReviewView proposal={proposal} review={review} onReview={setReview} problems={problems}
          disabled={busy} applied={applied} onApply={() => void apply()} />
      )}

      <KnowledgeView name={name} characterId={characterId} knowledge={knowledge} confirmReset={confirmReset} busy={busy}
        onRemove={(itemId) => void run(async () => setKnowledge(await studioApi.removeItem(characterId, itemId)))}
        onAskReset={() => setConfirmReset(true)} onCancelReset={() => setConfirmReset(false)}
        onReset={() => void run(async () => { setKnowledge(await studioApi.factoryReset(characterId)); setConfirmReset(false) })}
        onTalk={() => { stopPolling(); onTalk(characterId) }} />
    </div>
  )
}

function OcrLine({ ocr }: { ocr: OcrStatus | null }) {
  if (!ocr) return <p className="character-studio__hint">Checking local OCR…</p>
  if (!ocr.available) {
    return (
      <p className="character-studio__warning">
        Local OCR (Tesseract) is not available: {ocr.error?.message} Text-based PDFs still work; scanned pages will be
        reported as needing OCR.
      </p>
    )
  }
  return (
    <p className="character-studio__hint">
      Local OCR: Tesseract {ocr.version} ({ocr.languages.filter((l) => l in ocr.supported).join(', ')}). Documents are read on this
      computer.{ocr.missingDefaultLanguages.length > 0 && ` Missing language data: ${ocr.missingDefaultLanguages.join(', ')}.`}
    </p>
  )
}

interface ExtractionViewProps {
  job: ExtractionJob
  cleaned: CleanedDocument | null
  excluded: number[]
  reocr: number[]
  disabled: boolean
  onExclude: (page: number, on: boolean) => void
  onReocr: (page: number, on: boolean) => void
  onRerun: () => void
}

function ExtractionView({ job, cleaned, excluded, reocr, disabled, onExclude, onReocr, onRerun }: ExtractionViewProps) {
  if (job.state === 'failed' || job.state === 'cancelled') {
    return <p className="character-studio__error">{job.error?.message ?? 'Extraction stopped.'}</p>
  }
  if (!job.extraction) {
    return <p role="status">{job.state === 'ocr_running' ? 'Running OCR' : 'Extracting'} {job.sourceName}… {progressText(job.progress.pagesDone, job.progress.pagesTotal, 'pages')}</p>
  }
  const { summary, errors, pages } = job.extraction
  const cleanedText = new Map(cleaned?.pages.map((p) => [p.page, p.text]))
  return (
    <div className="character-studio__extraction">
      <p>
        <strong>{job.sourceName}</strong>: {summary.pageCount} pages · text layer {summary.textPages.length} · OCR {summary.ocrPages.length}
        {summary.meanOcrConfidence !== null && ` (OCR confidence ${summary.meanOcrConfidence}, not a measure of factual accuracy)`}
        {' '}· {summary.textChars.toLocaleString()} characters
      </p>
      {errors.map((e) => <p key={e.code} className="character-studio__warning">{e.message}</p>)}
      {cleaned && (
        <p className="character-studio__hint">
          Cleaning removed {cleaned.removed.length} lines of site navigation, headers and noise (originals are kept).
          {cleaned.license && ` Source licence: ${cleaned.license}.`}
        </p>
      )}
      <table className="character-studio__pages">
        <thead><tr><th>Page</th><th>Read by</th><th>Status</th><th>Use</th><th>Re-OCR</th><th>Text</th></tr></thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.page} data-status={page.status}>
              <td>{page.page}</td>
              <td>{page.method === 'text' ? 'text layer' : page.method === 'ocr' ? `OCR${page.confidence !== null ? ` (${page.confidence})` : ''}` : '—'}</td>
              <td>{page.status}{page.error ? ` (${page.error})` : ''}</td>
              <td><input type="checkbox" aria-label={`Use page ${page.page}`} disabled={disabled || !page.text.trim()}
                checked={!excluded.includes(page.page) && Boolean(page.text.trim())} onChange={(event) => onExclude(page.page, !event.target.checked)} /></td>
              <td><input type="checkbox" aria-label={`Re-OCR page ${page.page}`} disabled={disabled}
                checked={reocr.includes(page.page)} onChange={(event) => onReocr(page.page, event.target.checked)} /></td>
              <td>
                <details>
                  <summary>{cleanedText.has(page.page) ? 'cleaned / original' : 'original'}</summary>
                  {cleanedText.has(page.page) && <pre className="character-studio__text">{cleanedText.get(page.page) || '(nothing left after cleaning)'}</pre>}
                  <pre className="character-studio__text character-studio__text--original">{page.text || '(no text)'}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {reocr.length > 0 && (
        <div className="character-studio__actions">
          <button type="button" disabled={disabled} onClick={onRerun}>Extract again with OCR on pages {reocr.join(', ')}</button>
        </div>
      )}
      {cleaned && cleaned.removed.length > 0 && (
        <details>
          <summary>Removed lines ({cleaned.removed.length})</summary>
          <ul className="character-studio__removed">
            {cleaned.removed.map((line, index) => <li key={index}>p.{line.page} · {line.rule}: {line.text}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

interface ReviewViewProps {
  proposal: LoreProposal
  review: ReviewState
  onReview: (next: ReviewState) => void
  problems: string[]
  disabled: boolean
  applied: { approved: string[]; skipped: { id: string; reason: string }[] } | null
  onApply: () => void
}

function ReviewView({ proposal, review, onReview, problems, disabled, applied, onApply }: ReviewViewProps) {
  const s = proposal.summary
  const select = (id: string, on: boolean) => onReview({ ...review, selected: toggle(review.selected, id, on) })
  const item = (entry: ProposedFact | ProposedTrait) => (
    <ReviewItem key={entry.id} proposal={proposal} item={entry} review={review} onReview={onReview} onSelect={select} disabled={disabled} />
  )
  return (
    <section className="character-studio__card" aria-label="Review">
      <h2>3. Review proposals for {proposal.characterName}</h2>
      <p>
        {s.facts} facts ({s.needsReview} need review) · {s.traits} traits · {s.rejected} rejected · {s.duplicatesMerged} duplicates merged ·
        {' '}{s.conflicts} conflicts · analysed with {proposal.provider.type}{proposal.provider.model ? ` / ${proposal.provider.model}` : ''}
        {proposal.provider.remote ? ' (remote)' : ' (local)'}
      </p>
      {proposal.narrativeReference && <p className="character-studio__hint">Narrative reference point: {proposal.narrativeReference}</p>}
      {s.chunksFailed > 0 && <p className="character-studio__warning">{s.chunksFailed} of {s.chunks} parts of the document could not be analysed.</p>}
      {proposal.warnings.map((w) => <p key={w} className="character-studio__warning">{w}</p>)}
      <div className="character-studio__actions">
        <button type="button" disabled={disabled} onClick={() => onReview({ ...review, selected: suggestedSelection(proposal) })}>Select suggested</button>
        <button type="button" disabled={disabled} onClick={() => onReview({ ...review, selected: [] })}>Select none</button>
      </div>

      <h3>Facts (what {proposal.characterName} knows)</h3>
      {proposal.facts.length ? proposal.facts.map(item) : <p className="character-studio__hint">No facts were proposed.</p>}
      <h3>Personality (how {proposal.characterName} behaves)</h3>
      {proposal.traits.length ? proposal.traits.map(item) : <p className="character-studio__hint">No traits were proposed.</p>}

      {(proposal.rejectedFacts.length + proposal.rejectedTraits.length) > 0 && (
        <details>
          <summary>Rejected: quote not found in the document ({proposal.rejectedFacts.length + proposal.rejectedTraits.length})</summary>
          <ul className="character-studio__removed">
            {[...proposal.rejectedFacts, ...proposal.rejectedTraits].map((r) => (
              <li key={r.id}>{'description' in r ? r.description : `${r.trait}: ${r.guidance}`} — “{r.evidence}” ({describeEvidence(r.evidenceCheck)})</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Comparison with current lore: {proposal.comparison.recovered.length} already known, {proposal.comparison.notRecovered.length} not found in this document</summary>
        <p className="character-studio__hint">Lore lines not found here are not removed; this document simply does not restate them.</p>
        <ul className="character-studio__removed">{proposal.comparison.notRecovered.map((line) => <li key={line}>{line}</li>)}</ul>
      </details>

      {problems.length > 0 && review.selected.length > 0 && (
        <ul className="character-studio__problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <div className="character-studio__actions">
        <button type="button" className="character-studio__primary" disabled={disabled || problems.length > 0 || Boolean(applied)} onClick={onApply}>
          Apply {review.selected.length} selected
        </button>
      </div>
      {applied && (
        <p role="status">
          Applied {applied.approved.length} item(s).
          {applied.skipped.length > 0 && ` Skipped: ${applied.skipped.map((s) => `${s.id} (${s.reason.replace(/_/g, ' ')})`).join(', ')}.`}
        </p>
      )}
    </section>
  )
}

interface ReviewItemProps {
  proposal: LoreProposal
  item: ProposedFact | ProposedTrait
  review: ReviewState
  onReview: (next: ReviewState) => void
  onSelect: (id: string, on: boolean) => void
  disabled: boolean
}

function ReviewItem({ proposal, item, review, onReview, onSelect, disabled }: ReviewItemProps) {
  const isFact = 'predicate' in item
  const original = isFact ? item.description : item.guidance
  const editing = item.id in review.edits
  const reason = acknowledgementReason(proposal, item)
  const conflicts = isFact ? conflictsFor(proposal, item.id).filter((c) => c.kind !== 'complementary' && c.kind !== 'duplicate_assertion') : []
  const selected = review.selected.includes(item.id)
  return (
    <article className="character-studio__item" data-status={item.reviewStatus} data-selected={selected}>
      <label className="character-studio__item-head">
        <input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onSelect(item.id, event.target.checked)} />
        <span className="character-studio__badge" data-status={item.reviewStatus}>{item.reviewStatus === 'proposed' ? 'proposed' : 'needs review'}</span>
        <span className="character-studio__item-title">
          {isFact ? <>{item.subject} · {item.predicate.replace(/_/g, ' ')}{item.object ? ` · ${item.object}` : ''}</> : item.trait}
        </span>
      </label>
      {editing ? (
        <textarea aria-label={`Edit ${item.id}`} value={review.edits[item.id]} maxLength={500} disabled={disabled}
          onChange={(event) => onReview({ ...review, edits: { ...review.edits, [item.id]: event.target.value } })} />
      ) : <p>{original}</p>}
      <p className="character-studio__evidence">
        “{item.evidence}” — p.{item.sourcePages.join(', ')} · {describeEvidence(item.evidenceCheck)}
        {isFact ? ` · ${BASIS_LABEL[item.basis]}` : ` · ${item.kind.replace(/_/g, ' ')}`}
        {item.alsoSupportedBy.length > 0 && ` · also on p.${item.alsoSupportedBy.flatMap((r) => r.pages).join(', ')}`}
      </p>
      {item.flags.length > 0 && <p className="character-studio__flags">{item.flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}</p>}
      {conflicts.map((c) => (
        <p key={c.id} className="character-studio__warning">{c.kind.replace(/_/g, ' ')}: {c.existing} — {c.note}</p>
      ))}
      <div className="character-studio__actions">
        <button type="button" disabled={disabled} onClick={() => {
          const edits = { ...review.edits }
          if (editing) delete edits[item.id]
          else edits[item.id] = original
          onReview({ ...review, edits })
        }}>{editing ? 'Undo edit' : 'Edit'}</button>
        {reason && (
          <label className="character-studio__ack">
            <input type="checkbox" checked={review.acknowledged.includes(item.id)} disabled={disabled}
              onChange={(event) => onReview({ ...review, acknowledged: toggle(review.acknowledged, item.id, event.target.checked) })} />
            Approve anyway — {reason}
          </label>
        )}
      </div>
    </article>
  )
}

interface KnowledgeViewProps {
  name: string
  characterId: string
  knowledge: CharacterKnowledge | null
  confirmReset: boolean
  busy: boolean
  onRemove: (itemId: string) => void
  onAskReset: () => void
  onCancelReset: () => void
  onReset: () => void
  onTalk: () => void
}

function KnowledgeView({ name, characterId, knowledge, confirmReset, busy, onRemove, onAskReset, onCancelReset, onReset, onTalk }: KnowledgeViewProps) {
  const items = knowledge ? [...knowledge.facts, ...knowledge.traits] : []
  return (
    <section className="character-studio__card" aria-label="Approved knowledge">
      <h2>4. Approved knowledge of {name}</h2>
      {!knowledge ? <p className="character-studio__hint">Loading…</p> : items.length === 0 ? (
        <p className="character-studio__hint">Nothing approved yet: {name} uses only the built-in character files.</p>
      ) : (
        <ul className="character-studio__approved">
          {items.map((entry) => (
            <li key={entry.id}>
              <span>{entry.description ?? `${entry.trait}: ${entry.guidance}`}</span>
              <small> ({entry.provenance.sourceDocument} p.{entry.provenance.sourcePages.join(', ')}{entry.provenance.edited ? ', edited' : ''})</small>
              <button type="button" disabled={busy} aria-label={`Remove ${entry.id}`} onClick={() => onRemove(entry.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {knowledge?.contextSize && (
        <p className={knowledge.contextSize.overBudget ? 'character-studio__warning' : 'character-studio__hint'}>
          Character context: {knowledge.contextSize.promptCost.toLocaleString()} of {knowledge.contextSize.budgetCost.toLocaleString()} budget units
          {knowledge.contextSize.overBudget && ' — over budget; consider removing items'}.
        </p>
      )}
      <div className="character-studio__actions">
        <button type="button" onClick={onTalk} disabled={!characterId}>Talk to {name}</button>
        <a href={studioApi.exportUrl(characterId)} target="_blank" rel="noreferrer">View effective lore</a>
        {items.length > 0 && !confirmReset && <button type="button" disabled={busy} onClick={onAskReset}>Factory reset…</button>}
      </div>
      {confirmReset && (
        <div className="character-studio__consent" role="alertdialog" aria-label="Factory reset">
          <p>Remove all {items.length} approved item(s)? {name} will return to the built-in character knowledge. This cannot be undone.</p>
          <div className="character-studio__actions">
            <button type="button" disabled={busy} onClick={onReset}>Reset {name}</button>
            <button type="button" onClick={onCancelReset}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
