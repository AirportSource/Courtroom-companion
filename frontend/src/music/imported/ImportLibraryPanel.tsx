import { useEffect, useRef, useState, type DragEvent } from 'react'
import { LoopEditor } from '../loop/LoopEditor.tsx'
import type { LoopEditorBuffer } from '../loop/LoopEditor.tsx'
import type { ImportApi } from './importApi.ts'
import { FILE_ACCEPT } from './importApi.ts'
import { describeImportStatus, IMPORT_STEPS, isImportBusy, loopStateOf } from './importStatus.ts'
import type { ImportLibrary } from './useImportLibrary.ts'
import './import-library.css'

export interface ImportLibraryPanelProps {
  library: ImportLibrary
  /** Only `loadAudio` is used (to decode the selected track for the loop editor). */
  api: Pick<ImportApi, 'loadAudio'>
  /** Shared AudioContext (decoding + loop preview); null while audio is still locked. */
  audioContext: AudioContext | null
  /** Id of the imported track the music engine is playing, if any. */
  playingId?: string | null
  /** Called from a real click; the host starts the track through the music engine. */
  onPlay(trackId: string): void
  /** Loop preview started/stopped (the host pauses background music meanwhile). */
  onPreviewChange?(active: boolean): void
}

export function ImportLibraryPanel({ library, api, audioContext, playingId = null, onPlay, onPreviewChange }: ImportLibraryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decoded, setDecoded] = useState<{ id: string; buffer: LoopEditorBuffer } | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // A just-imported track is selected right away so its loop candidate is ready to review.
  const [seenImported, setSeenImported] = useState(library.lastImportedId)
  if (library.lastImportedId !== seenImported) {
    setSeenImported(library.lastImportedId)
    if (library.lastImportedId) {
      setSelectedId(library.lastImportedId)
      setDecoded(null)
      setDecodeError(null)
    }
  }
  const picker = useRef<HTMLInputElement>(null)
  const selected = library.tracks.find((track) => track.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId || !audioContext) return
    const controller = new AbortController()
    void (async () => {
      const loaded = await api.loadAudio(selectedId, controller.signal)
      if (controller.signal.aborted) return
      if (!loaded.ok) return setDecodeError(loaded.error.message)
      try {
        const buffer = await audioContext.decodeAudioData(loaded.value)
        if (!controller.signal.aborted) {
          setDecodeError(null)
          setDecoded({ id: selectedId, buffer })
        }
      } catch {
        if (!controller.signal.aborted) setDecodeError('The browser could not decode this track.')
      }
    })()
    return () => controller.abort()
  }, [api, audioContext, selectedId])

  const choose = (id: string | null) => {
    setSelectedId(id)
    setDecoded(null)
    setDecodeError(null)
  }
  const onFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (picker.current) picker.current.value = ''
    if (file) void library.importFile(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!library.importing) onFiles(event.dataTransfer.files)
  }
  const status = library.status
  const failedIndex = status?.step === 'failed' ? IMPORT_STEPS.findIndex((s) => s.step === status.failedAt) : -1

  return (
    <section className="import-library" aria-label="Imported music">
      <h2 className="import-library__title">Imported music</h2>
      <div
        className="import-library__drop"
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input ref={picker} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => onFiles(event.target.files)} />
        <button type="button" className="import-library__import" disabled={library.importing} onClick={() => picker.current?.click()}>
          {library.importing ? 'Importing...' : 'Import music'}
        </button>
        <span className="import-library__drop-text">or drop an audio file here</span>
        <span className="import-library__formats">MP3, OGG, WAV, FLAC* - up to 64 MB. Files stay on this computer.</span>
        <span className="import-library__formats">*FLAC works only if your browser can play it.</span>
      </div>

      {status && (
        <div className="import-library__status" data-step={status.step} role="status">
          <ol className="import-library__steps" aria-label="Import progress">
            {IMPORT_STEPS.map((item, index) => {
              const reached = IMPORT_STEPS.findIndex((s) => s.step === status.step)
              const state = status.step === 'failed' ? (index < failedIndex ? 'done' : index === failedIndex ? 'failed' : 'todo') : index < reached || status.step === 'ready' ? 'done' : index === reached ? 'active' : 'todo'
              return (
                <li key={item.step} data-state={state}>
                  {item.label}
                </li>
              )
            })}
          </ol>
          <p className="import-library__status-text" data-busy={isImportBusy(status)}>
            {describeImportStatus(status)}
          </p>
        </div>
      )}
      {library.error && !status && (
        <p className="import-library__error" role="alert">
          {library.error.message}
        </p>
      )}
      {library.error && status && status.step !== 'failed' && (
        <p className="import-library__error" role="alert">
          {library.error.message}
        </p>
      )}
      {library.loading && <p className="import-library__hint">Loading the library...</p>}
      {!library.loading && library.tracks.length === 0 && <p className="import-library__hint">No imported tracks yet.</p>}

      <ul className="import-library__list">
        {library.tracks.map((track) => {
          const loopState = loopStateOf(track, library.analysing.has(track.id))
          const note = library.notes[track.id]
          const isSelected = track.id === selectedId
          return (
            <li key={track.id} className="import-library__item" data-selected={isSelected} data-playing={track.id === playingId}>
              <div className="import-library__summary">
                <span className="import-library__name">{track.title}</span>
                <span className="import-library__meta">
                  {track.format.toUpperCase()}
                  <span className="import-library__badge" data-loop={loopState.kind}>
                    {loopState.label}
                  </span>
                  {loopState.kind === 'none' && note ? `: ${note}` : ''}
                </span>
              </div>
              <div className="import-library__buttons">
                <button type="button" disabled={!track.available} onClick={() => onPlay(track.id)}>
                  {track.id === playingId ? 'Playing' : 'Play'}
                </button>
                <button type="button" aria-expanded={isSelected} disabled={!track.available} onClick={() => choose(isSelected ? null : track.id)}>
                  Preview loop
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isSelected) choose(null)
                    void library.remove(track.id)
                  }}
                  aria-label={`Delete ${track.title}`}
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {selected && (
        <>
          {decodeError && (
            <p className="import-library__error" role="alert">
              {decodeError}
            </p>
          )}
          {!audioContext && <p className="import-library__hint">Press any button in the app to unlock audio, then reopen the loop editor.</p>}
          <LoopEditor
            key={selected.id}
            title={selected.title}
            buffer={decoded?.id === selected.id ? decoded.buffer : null}
            loop={selected.loop}
            audioContext={audioContext}
            onAccept={(metadata) => void library.saveLoop(selected.id, metadata)}
            onProposal={(metadata) => void library.saveLoop(selected.id, metadata)}
            onPreviewChange={onPreviewChange}
          />
        </>
      )}
    </section>
  )
}
