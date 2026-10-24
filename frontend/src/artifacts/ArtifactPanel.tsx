import { useCallback, useEffect, useRef, useState } from 'react'
import { artifactDownloadUrl, deleteArtifact, listArtifacts, readArtifact, type GeneratedArtifact, type TurnTask } from './artifacts.ts'
import './artifacts.css'

/** Temporary pipeline inspector, outside the DS stage. Milestone 3 owns evidence delivery. */
export function ArtifactPanel({ task }: { task: TurnTask | null }) {
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>([])
  const [selection, setSelection] = useState<{ id: string | null; readySeen: string | null }>({ id: null, readySeen: null })
  const [content, setContent] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const readyId = task?.state === 'artifact-ready' ? task.artifactId : null
  useEffect(() => {
    const controller = new AbortController()
    listArtifacts(controller.signal).then((records) => {
      if (!controller.signal.aborted) { setArtifacts(records); setError(null) }
    }, (e) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load generated files.')
    })
    return () => controller.abort()
  }, [readyId, revision])
  const selected = selection.readySeen !== readyId && readyId ? readyId : selection.id
  const artifact = artifacts.find((item) => item.id === selected)
  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not update this file.') }
    finally { if (alive.current) setBusy(false) }
  }
  return (
    <section className="artifacts-panel" aria-label="Generated files">
      <div className="artifacts-panel__heading"><strong>Generated files</strong><button type="button" onClick={() => void refresh()}>Refresh</button></div>
      {task?.cue === 'artifact_working' && <p role="status" data-artifact-cue="artifact_working">Creating a file…</p>}
      {readyId && artifacts.some((item) => item.id === readyId && item.status === 'ready') && <p role="status" data-artifact-cue="artifact_ready">File ready.</p>}
      {task?.state === 'failed' && task.cues.includes('artifact_working') && <p role="status">File creation did not finish.</p>}
      {error && <p role="alert">{error}</p>}
      {artifacts.length === 0 && <p>No generated files.</p>}
      <ul>{artifacts.map((item) => (
        <li key={item.id}><button type="button" aria-pressed={item.id === selected} onClick={() => { setSelection({ id: item.id, readySeen: readyId }); setContent(null) }}>
          {item.displayName} <span>· .{item.extension} · {item.status}</span>
        </button></li>
      ))}</ul>
      {artifact && <div className="artifacts-panel__detail">
        <p><strong>{artifact.displayName}</strong> · {artifact.sizeBytes} bytes · <time dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time></p>
        <p>Text only. Downloaded Python files are never run by Courtroom Companion.</p>
        <pre aria-label="Artifact text preview">{content?.id === artifact.id ? content.text : artifact.contentPreview}</pre>
        <div className="artifacts-panel__actions">
          <button type="button" disabled={busy || artifact.status !== 'ready'} onClick={() => void act(async () => {
            const text = await readArtifact(artifact.id); if (alive.current) setContent({ id: artifact.id, text })
          })}>View full text</button>
          {artifact.status === 'ready' && <a href={artifactDownloadUrl(artifact.id)} download={artifact.displayName}>Download</a>}
          <button type="button" disabled={busy} onClick={() => void act(async () => {
            await deleteArtifact(artifact.id); if (alive.current) {
              setArtifacts((records) => records.filter((item) => item.id !== artifact.id))
              setSelection({ id: null, readySeen: readyId }); setContent(null); refresh()
            }
          })}>Delete</button>
        </div>
      </div>}
    </section>
  )
}
