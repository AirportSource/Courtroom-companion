// Client for the conversation-record API. Every function resolves (never throws) so the UI can
// show a status line instead of crashing; malformed entries are dropped rather than trusted.
import { ARTIFACT_ID } from '../artifacts/artifacts.ts'

export interface ConversationRecordEntry {
  id: string
  characterId: string
  createdAt: string
  userText: string
  assistantText: string
  artifactIds: string[]
}

export type RecordResult<T> = { ok: true; value: T } | { ok: false; error: 'missing' | 'unavailable' }

export const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_TEXT = 20000
const MAX_ARTIFACTS = 16

export function parseConversationRecordEntry(raw: unknown): ConversationRecordEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !RECORD_ID.test(e.id)
    || typeof e.characterId !== 'string' || !RECORD_ID.test(e.characterId)
    || typeof e.createdAt !== 'string' || !Number.isFinite(Date.parse(e.createdAt))
    || typeof e.userText !== 'string' || typeof e.assistantText !== 'string') return null
  const artifactIds = Array.isArray(e.artifactIds)
    ? e.artifactIds.filter((id): id is string => typeof id === 'string' && ARTIFACT_ID.test(id)).slice(0, MAX_ARTIFACTS) : []
  return { id: e.id, characterId: e.characterId, createdAt: e.createdAt,
    userText: e.userText.slice(0, MAX_TEXT), assistantText: e.assistantText.slice(0, MAX_TEXT), artifactIds }
}

/** Order is the server's (newest first); only invalid entries and repeated ids are removed. */
export function parseConversationRecordList(raw: unknown): ConversationRecordEntry[] | null {
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).entries : null
  if (!Array.isArray(list)) return null
  const seen = new Set<string>()
  const entries: ConversationRecordEntry[] = []
  for (const item of list) {
    const entry = parseConversationRecordEntry(item)
    if (entry && !seen.has(entry.id)) { seen.add(entry.id); entries.push(entry) }
  }
  return entries
}

const unavailable = { ok: false, error: 'unavailable' } as const

export async function listConversationRecord(signal?: AbortSignal): Promise<RecordResult<ConversationRecordEntry[]>> {
  try {
    const response = await fetch('/api/conversation-record', { signal, cache: 'no-store' })
    if (!response.ok) return unavailable
    const entries = parseConversationRecordList(await response.json())
    return entries ? { ok: true, value: entries } : unavailable
  } catch { return unavailable }
}

export async function getConversationRecord(id: string, signal?: AbortSignal): Promise<RecordResult<ConversationRecordEntry>> {
  if (!RECORD_ID.test(id)) return unavailable
  try {
    const response = await fetch(`/api/conversation-record/${encodeURIComponent(id)}`, { signal, cache: 'no-store' })
    if (response.status === 404) return { ok: false, error: 'missing' }
    if (!response.ok) return unavailable
    const entry = parseConversationRecordEntry(await response.json())
    return entry && entry.id === id ? { ok: true, value: entry } : unavailable
  } catch { return unavailable }
}

/** A 404 counts as success: the entry is gone either way. */
export async function deleteConversationRecord(id: string): Promise<RecordResult<true>> {
  if (!RECORD_ID.test(id)) return unavailable
  try {
    const response = await fetch(`/api/conversation-record/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return response.ok || response.status === 404 ? { ok: true, value: true } : unavailable
  } catch { return unavailable }
}
