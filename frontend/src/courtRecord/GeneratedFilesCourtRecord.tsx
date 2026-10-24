import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { artifactDownloadUrl, deleteArtifact, readArtifact, type GeneratedArtifact } from '../artifacts/artifacts.ts'
import type { UiImage } from '../engine/manifestTypes.ts'
import { EvidenceTile } from './EvidenceTile.tsx'
import { tileGeometry, tileSlotOrigin } from './evidenceTile.ts'
import { GENERATED_GRID, generatedMove, generatedPageCount, orderedGeneratedFiles } from './generatedFiles.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { createCourtRecordFeedback } from './courtRecordFeedback.ts'
import { useT } from '../i18n/useT.ts'
import './generated-files-court-record.css'

export interface GeneratedFilesCourtRecordProps {
  artifacts: readonly GeneratedArtifact[]
  onClose: () => void
  onArtifactsChanged: () => void
  onRefresh?: () => void
  loading?: boolean
  error?: string | null
  fileIcon?: UiImage | null
  /** Native 70×70 evidence frame (catalog.ui.images.evidence_frame); plain tiles when absent. */
  evidenceFrame?: UiImage | null
}

/** A generated-files-only 256 × 192 surface, mounted inside the existing PixelStage. */
export function GeneratedFilesCourtRecord({ artifacts, onClose, onArtifactsChanged, onRefresh,
  loading = false, error = null, fileIcon = null, evidenceFrame = null }: GeneratedFilesCourtRecordProps) {
  const t = useT()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorId, setInspectorId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [content, setContent] = useState<{ id: string; text: string } | null>(null)
  const [operation, setOperation] = useState<'read' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null)
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const alive = useRef(false)
  const feedback = useMemo(() => createCourtRecordFeedback(playMenuSound), [])
  const records = orderedGeneratedFiles(artifacts).filter((record) => !removed.includes(record.id))
  const selectedIndex = Math.max(0, records.findIndex((record) => record.id === selectedId))
  const selected = records[selectedIndex]
  const inspected = records.find((record) => record.id === inspectorId)
  const activeInspectorId = inspected?.id
  const page = Math.floor(selectedIndex / GENERATED_GRID.pageSize)
  const pages = generatedPageCount(records.length)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { (activeInspectorId ? root.current : grid.current)?.focus() }, [activeInspectorId])

  const choose = (index: number) => { feedback.move(selectedIndex, index); setSelectedId(records[index]?.id ?? null) }
  const open = (id = selected?.id) => { if (id) { feedback.confirm(); setActionError(null); setInspectorId(id) } }
  const back = () => { feedback.back(); if (inspected) setInspectorId(null); else onClose() }
  const refresh = () => {
    feedback.confirm()
    setMissing([])
    setActionError(null)
    setFailedIcon(null)
    const reload = onRefresh ?? onArtifactsChanged
    reload()
  }
  const isMissing = !!inspected && (inspected.status === 'missing' || missing.includes(inspected.id))

  const act = async (kind: 'read' | 'delete') => {
    if (!inspected || operation) return
    feedback.confirm()
    const id = inspected.id
    setOperation(kind)
    setActionError(null)
    try {
      if (kind === 'read') {
        const text = await readArtifact(id)
        if (alive.current) setContent({ id, text })
      } else {
        await deleteArtifact(id)
        if (alive.current) {
          setRemoved((previous) => [...previous, id])
          setInspectorId(null)
          setContent(null)
          onArtifactsChanged()
        }
      }
    } catch (failure) {
      if (alive.current) {
        const absent = failure instanceof Error && failure.message === 'This generated file is missing.'
        if (absent) setMissing((previous) => [...previous, id])
        setActionError({ id, text: t(absent ? 'files.missing' : kind === 'read' ? 'files.readFailed' : 'files.deleteFailed') })
      }
    } finally { if (alive.current) setOperation(null) }
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      back()
      return
    }
    if (inspected) return
    const target = event.target as HTMLElement
    const gridTarget = target === grid.current || target === root.current || target.getAttribute('role') === 'option'
    if (!gridTarget) return
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      choose(generatedMove(selectedIndex, records.length, event.key))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); open()
    }
  }

  return (
    <div className="gcr-view" role="dialog" aria-label={t('files.title')} tabIndex={-1}
      ref={root} onKeyDown={onKey} onClick={(event) => event.stopPropagation()}>
      <header className="gcr-heading">
        <strong>{t(inspected ? 'files.inspector' : 'files.heading')}</strong>
        <button type="button" onClick={back}>{t(inspected ? 'common.back' : 'common.close')}</button>
      </header>
      {inspected ? <section className="gcr-inspector" aria-label="Generated file inspector">
        <strong className="gcr-filename" title={inspected.displayName}>{inspected.displayName}</strong>
        <div className="gcr-metadata">
          <span>.{inspected.extension} · {inspected.sizeBytes} bytes · {isMissing ? 'missing' : 'ready'}</span>
          <time dateTime={inspected.createdAt}>{new Date(inspected.createdAt).toISOString()}</time>
          <span title={inspected.mimeType}>{inspected.mimeType}</span>
        </div>
        <p className="gcr-inert">{t('files.inert')}</p>
        <pre tabIndex={0} aria-label="Artifact text preview">{isMissing ? t('files.textUnavailable')
          : content?.id === inspected.id ? content.text : inspected.contentPreview || t('files.noPreview')}</pre>
        <div className="gcr-actions">
          <button type="button" disabled={!!operation || isMissing} onClick={() => void act('read')}>{t(operation === 'read' ? 'common.reading' : 'common.read')}</button>
          {!isMissing && <a href={artifactDownloadUrl(inspected.id)} download={inspected.displayName} onClick={() => feedback.confirm()}>{t('common.download')}</a>}
          <button type="button" disabled={!!operation} onClick={() => void act('delete')}>{t(operation === 'delete' ? 'common.deleting' : 'common.delete')}</button>
          <button type="button" disabled={loading || !!operation} onClick={refresh}>{t('common.refresh')}</button>
        </div>
        {actionError?.id === inspected.id && <p className="gcr-action-error" role="alert">{actionError.text}</p>}
      </section> : <>
        <div className="gcr-grid" role="listbox" aria-label="Generated files" ref={grid} tabIndex={0}
          aria-activedescendant={selected ? `gcr-${selected.id}` : undefined}>
          {Array.from({ length: GENERATED_GRID.pageSize }, (_, slot) => {
            const index = page * GENERATED_GRID.pageSize + slot
            const record = records[index]
            const { size } = tileGeometry(evidenceFrame, fileIcon)
            const style = { ...tileSlotOrigin(slot, size.width), width: size.width, height: size.height }
            return record ? <button key={record.id} type="button" role="option" id={`gcr-${record.id}`}
              className="gcr-slot" style={style} aria-selected={index === selectedIndex}
              aria-label={`${record.displayName}${record.status === 'missing' || missing.includes(record.id) ? ', missing' : ''}`}
              title={record.displayName} tabIndex={-1}
              onClick={() => { choose(index); grid.current?.focus() }} onDoubleClick={() => { choose(index); open(record.id) }}>
              <EvidenceTile frame={evidenceFrame} selected={index === selectedIndex}
                image={fileIcon && failedIcon !== fileIcon.url ? fileIcon : null}
                onImageError={() => fileIcon && setFailedIcon(fileIcon.url)}>
                {!fileIcon || failedIcon === fileIcon.url ? <span className="gcr-file-symbol" aria-hidden="true">FILE</span> : undefined}
              </EvidenceTile>
              <span className="gcr-format">.{record.extension}</span>
            </button> : <span key={`empty-${slot}`} className="gcr-slot gcr-slot-empty" style={style} aria-hidden="true">
              <EvidenceTile frame={evidenceFrame} empty />
            </span>
          })}
          {records.length === 0 && <p className="gcr-empty" role="status">{t(loading ? 'files.loading' : 'files.empty')}</p>}
        </div>
        <footer className="gcr-footer">
          <div className="gcr-current" title={selected?.displayName}>{selected?.displayName ?? t('files.only')}</div>
          <div className="gcr-paging">
            <button type="button" aria-label={t('common.previousPage')} disabled={page === 0} onClick={() => choose((page - 1) * 6)}>‹</button>
            <span>{page + 1}/{pages}</span>
            <button type="button" aria-label={t('common.nextPage')} disabled={page + 1 >= pages} onClick={() => choose((page + 1) * 6)}>›</button>
            <button type="button" disabled={!selected} onClick={() => open()}>{t('common.inspect')}</button>
            <button type="button" disabled={loading} onClick={refresh}>{t(loading ? 'common.loading' : 'common.refresh')}</button>
          </div>
        </footer>
      </>}
      {error && <p className="gcr-list-error" role="alert">{t('files.unavailable')}</p>}
    </div>
  )
}
