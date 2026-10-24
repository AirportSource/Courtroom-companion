// State for the imported-music library: list, import (pre-check, test-decode, upload, automatic loop
// proposal), loop persistence, rename, delete. UI-agnostic apart from React state; the API, the
// AudioContext and the analyser are injected.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeLoop } from '../loop/analyzeLoop.ts'
import type { AudioBufferLike } from '../loop/analyzeLoop.ts'
import { proposalMetadata } from '../loop/loopEditorState.ts'
import type { AnalysisResult } from '../loop/types.ts'
import type { LoopMetadata, MusicError } from '../types.ts'
import { precheckFile, testDecode } from './importApi.ts'
import type { ImportApi, ImportedTrackRecord } from './importApi.ts'
import { reduceImportStatus } from './importStatus.ts'
import type { ImportEvent, ImportStatus } from './importStatus.ts'

export interface ImportLibraryDeps {
  api: ImportApi
  /** The shared AudioContext (null until audio was unlocked by a user gesture). */
  getContext(): AudioContext | null
  /** Called after any change that could affect playback (loop saved, track deleted). */
  onChange?(): void
  analyse?: (buffer: AudioBufferLike, signal: AbortSignal) => Promise<AnalysisResult>
}

export interface ImportLibrary {
  tracks: ImportedTrackRecord[]
  loading: boolean
  /** Last user-visible problem; cleared by the next successful action. */
  error: MusicError | null
  /** Ids whose automatic loop analysis is running. */
  analysing: ReadonlySet<string>
  /** Why the last automatic analysis found nothing, per track id. */
  notes: Readonly<Record<string, string>>
  importing: boolean
  /** Step-by-step status of the most recent import (null before the first one). */
  status: ImportStatus | null
  /** Id of the track the most recent import created, so the UI can select it. */
  lastImportedId: string | null
  refresh(): Promise<void>
  importFile(file: File): Promise<void>
  remove(id: string): Promise<void>
  saveLoop(id: string, loop: LoopMetadata): Promise<boolean>
  rename(id: string, title: string): Promise<void>
}

const defaultAnalyse: NonNullable<ImportLibraryDeps['analyse']> = (buffer, signal) => analyzeLoop(buffer, {}, signal)

export function useImportLibrary(deps: ImportLibraryDeps): ImportLibrary {
  const [tracks, setTracks] = useState<ImportedTrackRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MusicError | null>(null)
  const [analysing, setAnalysing] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [lastImportedId, setLastImportedId] = useState<string | null>(null)
  const dispatch = useCallback((event: ImportEvent) => setStatus((current) => reduceImportStatus(current, event)), [])
  const latest = useRef(deps)
  useEffect(() => {
    latest.current = deps
  })
  const lifetime = useRef<AbortController | null>(null)

  const replace = useCallback((record: ImportedTrackRecord) => {
    setTracks((current) => current.map((item) => (item.id === record.id ? record : item)))
  }, [])

  const refresh = useCallback(async () => {
    const result = await latest.current.api.list(lifetime.current?.signal)
    if (lifetime.current?.signal.aborted) return
    if (result.ok) {
      setTracks(result.value)
      setError(null)
    } else if (result.error.code !== 'aborted') setError(result.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void refresh()
    return () => controller.abort()
  }, [refresh])

  const saveLoop = useCallback(
    async (id: string, loop: LoopMetadata): Promise<boolean> => {
      const result = await latest.current.api.saveLoop(id, loop)
      if (result.ok) {
        replace(result.value)
        setError(null)
        latest.current.onChange?.()
      } else setError(result.error)
      return result.ok
    },
    [replace],
  )

  const importFile = useCallback(
    async (file: File) => {
      const { api, getContext, analyse = defaultAnalyse, onChange } = latest.current
      setError(null)
      dispatch({ type: 'select', fileName: file.name })
      const fail = (error: MusicError) => {
        setError(error)
        dispatch({ type: 'failed', message: error.message })
      }
      const rejected = precheckFile(file)
      if (rejected) return fail(rejected)
      const context = getContext()
      if (!context) return fail({ code: 'autoplay_blocked', message: 'Audio is locked. Press any button in the app first, then import again.' })
      setImporting(true)
      dispatch({ type: 'checking' })
      try {
        const decoded = await testDecode(file, {
          decodeAudioData: (data) => context.decodeAudioData(data),
          canPlayType: (mime) => document.createElement('audio').canPlayType(mime),
        })
        if (!decoded.ok) return fail(decoded.error)
        dispatch({ type: 'uploading' })
        const uploaded = await api.upload(file, lifetime.current?.signal)
        if (!uploaded.ok) return fail(uploaded.error)
        setTracks((current) => [...current, uploaded.value])
        setLastImportedId(uploaded.value.id)
        dispatch({ type: 'uploaded', trackId: uploaded.value.id })
        dispatch({ type: 'analysing' })
        onChange?.()
        const id = uploaded.value.id
        setAnalysing((current) => new Set(current).add(id))
        const controller = lifetime.current ?? new AbortController()
        try {
          const analysed = await analyse(decoded.value, controller.signal)
          if (controller.signal.aborted) return
          if (analysed.ok && analysed.candidates[0]) {
            const candidate = proposalMetadata(analysed.candidates[0])
            await saveLoop(id, candidate)
            dispatch({ type: 'candidate', confidence: candidate.confidence ?? 0 })
          } else if (!analysed.ok) {
            setNotes((current) => ({ ...current, [id]: analysed.message }))
            dispatch({ type: 'no_candidate', reason: analysed.message })
          } else dispatch({ type: 'no_candidate' })
        } finally {
          setAnalysing((current) => {
            const next = new Set(current)
            next.delete(id)
            return next
          })
        }
      } finally {
        setImporting(false)
      }
    },
    [saveLoop, dispatch],
  )

  const remove = useCallback(async (id: string) => {
    const result = await latest.current.api.remove(id)
    if (result.ok || result.error.code === 'missing_file') {
      setTracks((current) => current.filter((item) => item.id !== id))
      setError(null)
      latest.current.onChange?.()
    } else setError(result.error)
  }, [])

  const rename = useCallback(
    async (id: string, title: string) => {
      const result = await latest.current.api.rename(id, title)
      if (result.ok) replace(result.value)
      else setError(result.error)
    },
    [replace],
  )

  return useMemo(
    () => ({ tracks, loading, error, analysing, notes, importing, status, lastImportedId, refresh, importFile, remove, saveLoop, rename }),
    [tracks, loading, error, analysing, notes, importing, status, lastImportedId, refresh, importFile, remove, saveLoop, rename],
  )
}
