import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { artifactDownloadUrl, listArtifacts, readArtifact, type GeneratedArtifact } from '../artifacts/artifacts.ts'
import { EvidenceTile } from '../courtRecord/EvidenceTile.tsx'
import { tileGeometry, tileSlotOrigin } from '../courtRecord/evidenceTile.ts'
import { createCourtRecordFeedback } from '../courtRecord/courtRecordFeedback.ts'
import { generatedMove } from '../courtRecord/generatedFiles.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import type { UiImage } from '../engine/manifestTypes.ts'
import {
  clearConversationRecord, deleteConversationRecord, deleteConversationRecords, getConversationRecord,
  listConversationRecord, type ConversationRecordEntry,
} from './api.ts'
import {
  DETAIL_LINE_HEIGHT, DETAIL_VISIBLE_LINES, RECORD_PAGE_SIZE, entryLabel, mapFileAvailability, maxScrollTop,
  orderedEntries, recordPageCount, recordPageOf, scrollByLines, selectionAfterDelete, wheelLines,
} from './conversationRecord.ts'
import { useT } from '../i18n/useT.ts'
import './conversation-record.css'

export interface ConversationRecordViewProps {
  onClose: () => void
  /** Native 70×70 evidence frame (ui.images.evidence_frame); plain tiles when absent. */
  evidenceFrame?: UiImage | null
  /** Square portrait for a character id, or null (unknown character / no portrait). Never hard-coded. */
  portraitFor: (characterId: string) => UiImage | null
  /** Display name for a character id; the id itself is shown when unknown. */
  nameFor?: (characterId: string) => string | null
  /** Override for tests; defaults to the generated-files list API. */
  loadArtifacts?: () => Promise<GeneratedArtifact[]>
  /** Called after an entry was deleted on the server. */
  onEntriesChanged?: () => void
  /** Called once when the record opens, e.g. to load every character's portrait. */
  onOpen?: () => void
}

type Mode = 'list' | 'detail' | 'file'
/** Pending bulk deletion in selection mode: the checked entries, or every entry. */
type BulkConfirm = 'some' | 'all' | null
type Load = { status: 'loading' } | { status: 'ready' } | { status: 'error' }
type FileView = { id: string; name: string | null; state: 'loading' | 'ready' | 'error'; text: string }

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']
const BACK_KEYS = ['Escape', 'Backspace', 'x', 'X']

/** In-stage (256×192) Conversation Record: one portrait slot per saved exchange. */
export function ConversationRecordView({ onClose, evidenceFrame = null, portraitFor, nameFor,
  loadArtifacts = listArtifacts, onEntriesChanged, onOpen }: ConversationRecordViewProps) {
  const t = useT()
  const opened = useRef(onOpen)
  useEffect(() => { opened.current?.() }, [])
  const [entries, setEntries] = useState<ConversationRecordEntry[]>([])
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('list')
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[] | null>(null)
  const [gone, setGone] = useState<string[]>([])
  const [file, setFile] = useState<FileView | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Selection mode: tiles toggle a check instead of opening; Delete removes the checked entries.
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirm>(null)
  const root = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const alive = useRef(false)
  const feedback = useMemo(() => createCourtRecordFeedback(playMenuSound), [])

  const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId))
  const selected: ConversationRecordEntry | undefined = entries[selectedIndex]
  const page = recordPageOf(selectedIndex)
  const pages = recordPageCount(entries.length)
  const name = (id: string) => nameFor?.(id) || id

  const fetchAll = useCallback(() => Promise.all([listConversationRecord(), loadArtifacts().catch(() => null)]), [loadArtifacts])
  const apply = ([result, files]: Awaited<ReturnType<typeof fetchAll>>) => {
    if (!alive.current) return
    if (result.ok) { setEntries(orderedEntries(result.value)); setLoad({ status: 'ready' }) } else setLoad({ status: 'error' })
    setArtifacts(files)
    setGone([])
  }
  const refresh = () => { setLoad({ status: 'loading' }); void fetchAll().then(apply) }

  useEffect(() => {
    alive.current = true
    void fetchAll().then(apply)
    return () => { alive.current = false }
    // apply only touches state setters and the alive ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll])
  useEffect(() => { (mode === 'list' ? grid.current : root.current)?.focus() }, [mode, load.status])
  useEffect(() => { if (body.current) body.current.scrollTop = 0 }, [mode, selected?.id, file?.id])

  const choose = (index: number) => {
    feedback.move(selectedIndex, index)
    setSelectedId(entries[index]?.id ?? null)
  }

  const open = () => {
    if (!selected) return
    feedback.confirm()
    setNotice(null); setConfirming(false); setFile(null); setMode('detail')
    // Prefer the single-entry route for the freshest text; the list entry is the fallback.
    const id = selected.id
    void getConversationRecord(id).then((result) => {
      if (!alive.current) return
      if (result.ok) setEntries((previous) => previous.map((entry) => (entry.id === id ? result.value : entry)))
      else if (result.error === 'missing') { setEntries((previous) => previous.filter((entry) => entry.id !== id)); setMode('list'); setNotice(t('record.entryGone')) }
    })
  }

  const toggleSelecting = () => {
    if (busy) return
    if (selecting) feedback.back(); else feedback.confirm()
    setSelecting(!selecting); setChecked(new Set()); setBulkConfirm(null); setNotice(null)
  }

  const toggleChecked = (id: string) => {
    setBulkConfirm(null)
    setChecked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const removeBulk = async (kind: 'some' | 'all') => {
    if (busy) return
    feedback.confirm()
    setBusy(true)
    const result = kind === 'all' ? await clearConversationRecord() : await deleteConversationRecords([...checked])
    if (!alive.current) return
    setBusy(false); setBulkConfirm(null)
    if (!result.ok) { setNotice(t('record.deleteManyFailed')); return }
    const remaining = kind === 'all' ? [] : entries.filter((entry) => !checked.has(entry.id))
    setEntries(remaining)
    setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null)
    setChecked(new Set()); setNotice(null)
    if (remaining.length === 0) setSelecting(false)
    onEntriesChanged?.()
  }

  const back = () => {
    feedback.back()
    if (bulkConfirm) setBulkConfirm(null)
    else if (selecting && mode === 'list') { setSelecting(false); setChecked(new Set()) }
    else if (confirming) setConfirming(false)
    else if (mode === 'file') setMode('detail')
    else if (mode === 'detail') setMode('list')
    else onClose()
  }

  const openFile = (id: string, fileName: string | null) => {
    feedback.confirm()
    setFile({ id, name: fileName, state: 'loading', text: '' })
    setMode('file')
    readArtifact(id).then((text) => {
      if (alive.current) setFile((current) => (current?.id === id ? { ...current, state: 'ready', text } : current))
    }, (failure: unknown) => {
      if (!alive.current) return
      if (failure instanceof Error && failure.message === 'This generated file is missing.') {
        setGone((previous) => [...previous, id]); setFile(null); setMode('detail')
      } else setFile((current) => (current?.id === id ? { ...current, state: 'error' } : current))
    })
  }

  const remove = async () => {
    if (!selected || busy) return
    feedback.confirm()
    const id = selected.id
    setBusy(true)
    const result = await deleteConversationRecord(id)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) { setNotice(t('record.deleteFailed')); setConfirming(false); return }
    const nextIndex = selectionAfterDelete(selectedIndex, entries.length)
    const remaining = entries.filter((entry) => entry.id !== id)
    setEntries(remaining)
    setSelectedId(remaining[nextIndex]?.id ?? null)
    setConfirming(false); setMode('list'); setNotice(null)
    onEntriesChanged?.()
  }

  const scroll = (lines: number, sound = false) => {
    const el = body.current
    if (!el) return
    const next = scrollByLines(el.scrollTop, lines, maxScrollTop(el.scrollHeight, el.clientHeight))
    if (next !== el.scrollTop) { el.scrollTop = next; if (sound) playMenuSound('menu_page') }
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    const target = event.target as HTMLElement
    const stop = () => { event.preventDefault(); event.stopPropagation() }
    if (BACK_KEYS.includes(key)) { stop(); back(); return }
    const onButton = target.tagName === 'BUTTON' || target.tagName === 'A'
    if (mode === 'list') {
      if (NAV_KEYS.includes(key)) { stop(); choose(generatedMove(selectedIndex, entries.length, key)) }
      else if ((key === 'Enter' || key === ' ') && !onButton) {
        stop()
        if (!selecting) open()
        else if (selected) toggleChecked(selected.id)
      }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') { stop(); scroll(key === 'ArrowUp' ? -1 : 1) }
    else if (key === 'PageUp' || key === 'PageDown') { stop(); scroll((key === 'PageUp' ? -1 : 1) * (DETAIL_VISIBLE_LINES - 1), true) }
    else if (key === 'Home' || key === 'End') { stop(); scroll((key === 'Home' ? -1 : 1) * 1000, true) }
    else if ((key === 'Enter' || key === ' ') && !onButton) stop()
  }

  const availability = selected ? mapFileAvailability(selected.artifactIds, artifacts) : []
  const heading = t(mode === 'list' ? 'record.heading' : mode === 'file' ? 'record.file' : 'record.conversation')
  const emptyText = t(load.status === 'loading' ? 'record.loading' : load.status === 'error'
    ? 'record.unavailable' : 'record.empty')

  return (
    <div className="rec-view" role="dialog" aria-label={t('record.title')} tabIndex={-1} ref={root}
      onKeyDown={onKey} onClick={(event) => event.stopPropagation()}>
      <header className="rec-heading">
        <strong>{heading}</strong>
        <span className="rec-heading-actions">
          {mode === 'list' && entries.length > 0 &&
            <button type="button" aria-pressed={selecting} disabled={busy} onClick={toggleSelecting}>
              {t(selecting ? 'record.done' : 'record.select')}</button>}
          {!selecting && <button type="button" onClick={back}>{t(mode === 'list' ? 'common.close' : 'common.back')}</button>}
        </span>
      </header>

      {mode === 'list' && <>
        <div className="rec-grid" role="listbox" aria-label={t('record.saved')} ref={grid} tabIndex={0}
          aria-activedescendant={selected ? `rec-${selected.id}` : undefined}>
          {Array.from({ length: RECORD_PAGE_SIZE }, (_, slot) => {
            const index = page * RECORD_PAGE_SIZE + slot
            const entry = entries[index]
            const { size } = tileGeometry(evidenceFrame, null)
            const style = { ...tileSlotOrigin(slot, size.width), width: size.width, height: size.height }
            if (!entry) return <span key={`empty-${slot}`} className="rec-slot" style={style} aria-hidden="true">
              <EvidenceTile frame={evidenceFrame} empty />
            </span>
            const portrait = portraitFor(entry.characterId)
            const isChecked = selecting && checked.has(entry.id)
            const slotClass = ['rec-slot', selecting && 'rec-slot--selecting', isChecked && 'rec-slot--checked'].filter(Boolean).join(' ')
            return <button key={entry.id} type="button" role="option" id={`rec-${entry.id}`} className={slotClass} style={style}
              aria-selected={index === selectedIndex} aria-checked={selecting ? isChecked : undefined}
              aria-label={`${name(entry.characterId)}: ${entryLabel(entry)}`}
              title={entryLabel(entry)} tabIndex={-1}
              onClick={() => { choose(index); if (selecting) toggleChecked(entry.id); grid.current?.focus() }}
              onDoubleClick={() => { if (!selecting) { choose(index); open() } }}>
              <EvidenceTile frame={evidenceFrame} image={portrait} selected={index === selectedIndex}>
                {portrait ? undefined : <span className="rec-unknown" aria-hidden="true">?</span>}
              </EvidenceTile>
              {selecting && <span className="rec-check" aria-hidden="true">{isChecked ? '✓' : ''}</span>}
            </button>
          })}
          {entries.length === 0 && <p className="rec-empty" role="status">{emptyText}</p>}
        </div>
        <footer className="rec-footer">
          {selecting
            ? <div className={bulkConfirm ? 'rec-current rec-confirm' : 'rec-current'} role={bulkConfirm ? 'alertdialog' : undefined}>
              {bulkConfirm === 'all' ? t('record.confirmAll', { count: entries.length })
                : bulkConfirm === 'some' ? t('record.confirmSome', { count: checked.size })
                  : checked.size ? t('record.selectedCount', { count: checked.size }) : t('record.selectHint')}</div>
            : <div className="rec-current" title={selected ? entryLabel(selected) : undefined}>
              {selected ? entryLabel(selected) : t('record.current')}</div>}
          <div className="rec-paging">
            <button type="button" aria-label={t('common.previousPage')} disabled={page === 0} onClick={() => choose((page - 1) * RECORD_PAGE_SIZE)}>‹</button>
            <span>{page + 1}/{pages}</span>
            <button type="button" aria-label={t('common.nextPage')} disabled={page + 1 >= pages} onClick={() => choose((page + 1) * RECORD_PAGE_SIZE)}>›</button>
            {!selecting && <>
              <button type="button" disabled={!selected} onClick={open}>{t('common.open')}</button>
              <button type="button" disabled={load.status === 'loading'} onClick={() => { feedback.confirm(); refresh() }}>{t('common.refresh')}</button>
            </>}
            {selecting && !bulkConfirm && <>
              <button type="button" disabled={busy || checked.size === 0} onClick={() => { feedback.confirm(); setBulkConfirm('some') }}>
                {t('record.deleteSelected')}</button>
              <button type="button" disabled={busy} onClick={() => { feedback.confirm(); setBulkConfirm('all') }}>
                {t('record.deleteAll')}</button>
            </>}
            {selecting && bulkConfirm && <>
              <button type="button" autoFocus onClick={() => { feedback.back(); setBulkConfirm(null) }}>{t('record.cancel')}</button>
              <button type="button" className="rec-danger" disabled={busy} onClick={() => void removeBulk(bulkConfirm)}>
                {t(busy ? 'common.deleting' : 'common.delete')}</button>
            </>}
          </div>
        </footer>
      </>}

      {mode !== 'list' && selected && <section className="rec-detail" aria-label={t('record.savedOne')}>
        <p className="rec-character">{mode === 'file' ? (file?.name ?? t('record.generatedFile')) : t('record.character', { name: name(selected.characterId) })}</p>
        <div className="rec-body" ref={body} tabIndex={-1}
          onWheel={(event) => scroll(wheelLines(event.deltaY))}
          onScroll={(event) => {
            const el = event.currentTarget
            const snapped = Math.round(el.scrollTop / DETAIL_LINE_HEIGHT) * DETAIL_LINE_HEIGHT
            if (snapped !== el.scrollTop) el.scrollTop = snapped
          }}>
          {mode === 'detail' ? <>
            <p className="rec-label">{t('record.you')}</p>
            <p className="rec-text">{selected.userText}</p>
            <p className="rec-label">{name(selected.characterId).toUpperCase()}:</p>
            <p className="rec-text">{selected.assistantText}</p>
            <p className="rec-label">{t('record.files')}</p>
            {availability.length === 0 && <p className="rec-text">None.</p>}
            {availability.map((item) => (item.available && !gone.includes(item.id)
              ? <button key={item.id} type="button" className="rec-file" onClick={() => openFile(item.id, item.name)}>
                {item.name ?? 'Generated file'}</button>
              : <p key={item.id} className="rec-text rec-gone">{t('record.gone')}</p>))}
          </> : <pre className="rec-text rec-file-text">{file?.state === 'loading' ? 'Reading…'
            : file?.state === 'error' ? 'Could not read this file.' : file?.text}</pre>}
        </div>
        <div className="rec-actions">
          {mode === 'file' && file && file.state === 'ready' &&
            <a href={artifactDownloadUrl(file.id)} download={file.name ?? undefined} onClick={() => feedback.confirm()}>Download</a>}
          {mode === 'detail' && !confirming && <button type="button" disabled={busy} onClick={() => { feedback.confirm(); setConfirming(true) }}>{t('record.deleteEntry')}</button>}
          {mode === 'detail' && confirming && <>
            <span className="rec-confirm" role="alertdialog" aria-label={t('record.confirmOne')}>{t('record.confirmOne')}</span>
            <button type="button" autoFocus onClick={() => { feedback.back(); setConfirming(false) }}>{t('record.cancel')}</button>
            <button type="button" disabled={busy} onClick={() => void remove()}>{t(busy ? 'common.deleting' : 'common.delete')}</button>
          </>}
        </div>
      </section>}
      {notice && <p className="rec-notice" role="alert">{notice}</p>}
    </div>
  )
}

