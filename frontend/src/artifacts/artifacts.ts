// Generated text data only. A filename is never used to address storage or navigate a URL.
export const ARTIFACT_ID = /^[a-f0-9]{32}$/
export const TURN_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/
export type ArtifactFormat = 'txt' | 'md' | 'py'
export interface GeneratedArtifact {
  id: string
  displayName: string
  extension: ArtifactFormat
  mimeType: string
  createdAt: string
  sizeBytes: number
  status: 'ready' | 'missing'
  contentPreview: string
}

export type TaskState = 'idle' | 'working' | 'artifact-ready' | 'failed'
export type ArtifactCue = 'artifact_working' | 'artifact_ready'
export interface TurnTask {
  id: string
  state: TaskState
  cue: ArtifactCue | null
  artifactId: string | null
  error: string | null
  cues: ArtifactCue[]
}

export function parseArtifact(raw: unknown): GeneratedArtifact | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string' || !ARTIFACT_ID.test(a.id)
    || typeof a.displayName !== 'string' || !a.displayName || a.displayName.length > 120
    || /[/\\]/.test(a.displayName) || [...a.displayName].some((c) => c.charCodeAt(0) < 32)
    || !['txt', 'md', 'py'].includes(String(a.extension)) || typeof a.mimeType !== 'string'
    || typeof a.createdAt !== 'string' || !Number.isFinite(Date.parse(a.createdAt))
    || typeof a.sizeBytes !== 'number' || !Number.isInteger(a.sizeBytes) || a.sizeBytes <= 0 || a.sizeBytes > 65536
    || (a.status !== 'ready' && a.status !== 'missing')) return null
  return { id: a.id, displayName: a.displayName, extension: a.extension as ArtifactFormat, mimeType: a.mimeType,
    createdAt: a.createdAt, sizeBytes: a.sizeBytes, status: a.status,
    contentPreview: typeof a.contentPreview === 'string' ? a.contentPreview.slice(0, 1000) : '' }
}

export function parseTurnTask(raw: unknown): TurnTask | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (typeof t.id !== 'string' || !TURN_ID.test(t.id)
    || !['idle', 'working', 'artifact-ready', 'failed'].includes(String(t.state))) return null
  const ready = t.state === 'artifact-ready'
  const artifactId = typeof t.artifactId === 'string' && ARTIFACT_ID.test(t.artifactId) ? t.artifactId : null
  if (ready && !artifactId) return null
  const cue = ready ? 'artifact_ready' : t.state === 'working' && t.cue === 'artifact_working' ? 'artifact_working' : null
  const cues: ArtifactCue[] = Array.isArray(t.cues)
    ? t.cues.filter((c): c is ArtifactCue => c === 'artifact_working' || (ready && c === 'artifact_ready')) : []
  return { id: t.id, state: t.state as TaskState, cue, artifactId: ready ? artifactId : null,
    error: typeof t.error === 'string' && /^[a-z_]{1,64}$/.test(t.error) ? t.error : null, cues }
}

function idPath(id: string): string {
  if (!ARTIFACT_ID.test(id)) throw new Error('Invalid generated-file ID.')
  return `/api/artifacts/${id}`
}

export function artifactDownloadUrl(id: string): string { return `${idPath(id)}/download` }

async function checked(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(response.status === 404 ? 'This generated file is missing.' : 'Generated-file storage is unavailable. Try Refresh.')
  return response
}

export async function listArtifacts(signal?: AbortSignal): Promise<GeneratedArtifact[]> {
  const raw: unknown = await (await checked(await fetch('/api/artifacts', { signal, cache: 'no-store' }))).json()
  const records = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).artifacts : null
  if (!Array.isArray(records)) throw new Error('The generated-file list could not be read.')
  return records.flatMap((record) => { const parsed = parseArtifact(record); return parsed ? [parsed] : [] })
}

export async function readArtifact(id: string): Promise<string> {
  const raw: unknown = await (await checked(await fetch(`${idPath(id)}/content`, { cache: 'no-store' }))).json()
  if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).content !== 'string') throw new Error('The file text could not be read.')
  const content = (raw as { content: string }).content
  if (new TextEncoder().encode(content).length > 65536) throw new Error('The file exceeds the text limit.')
  return content
}

export async function deleteArtifact(id: string): Promise<void> {
  await checked(await fetch(idPath(id), { method: 'DELETE' }))
}

export async function cancelTurn(id: string): Promise<TurnTask | null> {
  if (!TURN_ID.test(id)) return null
  try { return parseTurnTask(await (await checked(await fetch(`/api/chat/turns/${id}`, { method: 'DELETE' }))).json()) }
  catch { return null }
}

/** Status polling only; the model is called once by POST /chat. Short transitions also survive in cues. */
export async function watchTurn(id: string, signal: AbortSignal, onTask: (task: TurnTask) => void, intervalMs = 300): Promise<void> {
  if (!TURN_ID.test(id)) return
  while (!signal.aborted) {
    try {
      const response = await fetch(`/api/chat/turns/${id}`, { signal, cache: 'no-store' })
      const task = response.ok ? parseTurnTask(await response.json()) : null
      if (!signal.aborted && task) {
        onTask(task)
        if (task.state !== 'working') return
      }
    } catch { if (signal.aborted) return }
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, intervalMs)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }
}
