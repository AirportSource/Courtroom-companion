// Typed client for the local imported-music library (/api/music/imports). Never throws: every
// call resolves to an ApiResult whose error uses the shared MusicErrorCode vocabulary.
// Uploads use fetch (no upload-progress events); the body is the raw file, the name a header.
import { validateLoopRegion } from '../loopMath.ts'
import type { LoopMetadata, LoopProvenance, LoopRegion, MusicError, MusicErrorCode } from '../types.ts'

export const IMPORT_BASE = '/api/music/imports'
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.flac'] as const
export const FILE_ACCEPT = ACCEPTED_EXTENSIONS.join(',')

const KNOWN_MIME = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'application/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/flac', 'audio/x-flac',
])

export interface ImportedTrackRecord {
  id: string
  title: string
  format: 'mp3' | 'ogg' | 'wav' | 'flac'
  mime: string
  sizeBytes: number
  createdAt: string
  /** False when the audio file has gone missing on disk. */
  available: boolean
  loop: LoopMetadata | null
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: MusicError }

const fail = (code: MusicErrorCode, message: string): { ok: false; error: MusicError } => ({ ok: false, error: { code, message } })

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** Cheap checks before anything is uploaded. The server re-validates by content. */
export function precheckFile(file: { name: string; size: number; type: string }): MusicError | null {
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return { code: 'unsupported_codec', message: 'Choose an MP3, OGG, WAV or FLAC file.' }
  }
  if (file.size <= 0) return { code: 'decode_failed', message: 'This file is empty.' }
  if (file.size > MAX_IMPORT_BYTES) {
    return { code: 'unknown', message: `This file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.` }
  }
  if (file.type && !KNOWN_MIME.has(file.type.toLowerCase())) {
    return { code: 'unsupported_codec', message: 'This does not look like an MP3, OGG, WAV or FLAC audio file.' }
  }
  return null
}

export interface DecodeDeps {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  /** Optional: HTMLMediaElement.canPlayType, used only to explain a FLAC failure. */
  canPlayType?: (mime: string) => string
}

/** Decodes the file locally before upload: the only reliable test that the browser can play it. */
export async function testDecode(file: Blob & { name?: string }, deps: DecodeDeps): Promise<ApiResult<AudioBuffer>> {
  try {
    const data = await file.arrayBuffer()
    return { ok: true, value: await deps.decodeAudioData(data) }
  } catch {
    const flac = extensionOf(file.name ?? '') === '.flac'
    if (flac && deps.canPlayType && deps.canPlayType('audio/flac') === '') {
      return fail('unsupported_codec', 'This browser cannot play FLAC. Convert the file to MP3, OGG or WAV.')
    }
    return fail('decode_failed', 'The browser could not decode this audio file.')
  }
}

function httpError(status: number, detail: string | undefined): MusicError {
  const message = detail || `The music library returned an error (${status}).`
  if (status === 404) return { code: 'missing_file', message }
  if (status === 413) return { code: 'unknown', message: detail || 'The audio file is too large.' }
  if (status === 415) return { code: 'unsupported_codec', message }
  if (status === 422) return { code: 'invalid_loop', message }
  if (status === 403) return { code: 'network', message: 'The music library is only available from this computer.' }
  if (status === 409 || status === 503) return { code: 'unavailable', message }
  return { code: 'network', message }
}

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined
    return typeof detail === 'string' ? detail : undefined
  } catch {
    return undefined
  }
}

const PROVENANCES: readonly LoopProvenance[] = ['curated-analysis', 'auto-detected', 'user-accepted', 'user-adjusted', 'none']

/** Reads the server's loop object defensively; anything malformed becomes "no loop". */
export function parseServerLoop(raw: unknown): LoopMetadata | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { region, confidence, provenance, note } = raw as Record<string, unknown>
  const known = PROVENANCES.find((item) => item === provenance) ?? 'none'
  const none: LoopMetadata = { region: null, confidence: null, provenance: 'none' }
  if (typeof region !== 'object' || region === null) return none
  const { startSample, endSample, sampleRate, crossfadeMs } = region as Record<string, unknown>
  if (typeof startSample !== 'number' || typeof endSample !== 'number' || typeof sampleRate !== 'number') return none
  const parsed: LoopRegion = { startSample, endSample, sampleRate }
  if (typeof crossfadeMs === 'number') parsed.crossfadeMs = crossfadeMs
  if (!validateLoopRegion(parsed).ok) return none
  return {
    region: parsed,
    confidence: typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null,
    provenance: known === 'none' ? 'auto-detected' : known,
    ...(typeof note === 'string' ? { note } : {}),
  }
}

export function parseTrackRecord(raw: unknown): ImportedTrackRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const formats = ['mp3', 'ogg', 'wav', 'flac']
  if (typeof r.id !== 'string' || !/^[a-f0-9]{32}$/.test(r.id) || typeof r.title !== 'string' || typeof r.format !== 'string' || !formats.includes(r.format)) return null
  return {
    id: r.id,
    title: r.title,
    format: r.format as ImportedTrackRecord['format'],
    mime: typeof r.mime === 'string' ? r.mime : '',
    sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : 0,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    available: r.available !== false,
    loop: parseServerLoop(r.loop),
  }
}

/** Loop metadata in the flat shape the server validates. */
export function loopRequestBody(loop: LoopMetadata): Record<string, unknown> {
  const { region } = loop
  const body: Record<string, unknown> = { provenance: loop.provenance }
  if (region && loop.provenance !== 'none') {
    body.startSample = region.startSample
    body.endSample = region.endSample
    body.sampleRate = region.sampleRate
    if (region.crossfadeMs) body.crossfadeMs = region.crossfadeMs
  }
  if (loop.confidence !== null) body.confidence = loop.confidence
  if (loop.note) body.note = loop.note.slice(0, 200)
  return body
}

export interface ImportApi {
  audioUrl(id: string): string
  list(signal?: AbortSignal): Promise<ApiResult<ImportedTrackRecord[]>>
  upload(file: File, signal?: AbortSignal): Promise<ApiResult<ImportedTrackRecord>>
  saveLoop(id: string, loop: LoopMetadata): Promise<ApiResult<ImportedTrackRecord>>
  rename(id: string, title: string): Promise<ApiResult<ImportedTrackRecord>>
  remove(id: string): Promise<ApiResult<null>>
  loadAudio(id: string, signal?: AbortSignal): Promise<ApiResult<ArrayBuffer>>
}

export function createImportApi(fetcher: typeof fetch = (...args) => fetch(...args)): ImportApi {
  async function call<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<ApiResult<T>> {
    let response: Response
    try {
      response = await fetcher(url, init)
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return fail('aborted', 'Cancelled.')
      return fail('network', 'The music library could not be reached. Is the backend running?')
    }
    if (!response.ok) return { ok: false, error: httpError(response.status, await detailOf(response)) }
    try {
      return { ok: true, value: await read(response) }
    } catch {
      return fail('network', 'The music library sent an unreadable response.')
    }
  }
  const record = async (response: Response): Promise<ImportedTrackRecord> => {
    const parsed = parseTrackRecord(await response.json())
    if (!parsed) throw new Error('bad record')
    return parsed
  }
  const json = { 'Content-Type': 'application/json' }
  return {
    audioUrl: (id) => `${IMPORT_BASE}/${encodeURIComponent(id)}/audio`,
    list: (signal) =>
      call(IMPORT_BASE, { signal, cache: 'no-store' }, async (response) => {
        const body: unknown = await response.json()
        const tracks = typeof body === 'object' && body !== null ? (body as { tracks?: unknown }).tracks : null
        if (!Array.isArray(tracks)) throw new Error('bad list')
        return tracks.map(parseTrackRecord).filter((item): item is ImportedTrackRecord => item !== null)
      }),
    upload: (file, signal) =>
      call(IMPORT_BASE, { method: 'POST', body: file, signal, headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } }, record),
    saveLoop: (id, loop) =>
      call(`${IMPORT_BASE}/${encodeURIComponent(id)}/loop`, { method: 'PUT', headers: json, body: JSON.stringify(loopRequestBody(loop)) }, record),
    rename: (id, title) =>
      call(`${IMPORT_BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: json, body: JSON.stringify({ title }) }, record),
    remove: (id) => call(`${IMPORT_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, async () => null),
    loadAudio: (id, signal) => call(`${IMPORT_BASE}/${encodeURIComponent(id)}/audio`, { signal }, (response) => response.arrayBuffer()),
  }
}
