// Court Record data. public/assets/court-record/court-record.json lists evidence and profile
// entries with their icon PNGs; adding an entry needs only that data plus the PNG. The validator is
// pure (no fetch, no DOM). Problems with single entries become warnings and the entry is dropped;
// only an unusable manifest throws.
import type { UiImage } from '../engine/manifestTypes.ts'

export const COURT_RECORD_VERSION = 1

export type CourtRecordEntryType = 'evidence' | 'profile'

export interface CourtRecordAsset {
  /** Relative to assets/court-record/ (e.g. "evidence/thinker_statue.png"). */
  src: string
  width: number
  height: number
}

export interface CourtRecordProvenance {
  source: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface CourtRecordEntry {
  id: string
  type: CourtRecordEntryType
  name: string
  description: string
  asset: CourtRecordAsset
  provenance?: CourtRecordProvenance
}

/** An entry with its icon resolved to a URL, ready for rendering. */
export interface LoadedCourtRecordEntry extends Omit<CourtRecordEntry, 'asset'> {
  image: UiImage
}

export interface CourtRecord<T extends { type: CourtRecordEntryType } = CourtRecordEntry> {
  /** Display order: evidence entries first, then profiles, each in the manifest's order lists. */
  entries: T[]
}

export interface LoadedCourtRecord extends CourtRecord<LoadedCourtRecordEntry> {
  warnings: string[]
}

export interface ValidatedCourtRecord extends CourtRecord {
  warnings: string[]
}

export class CourtRecordError extends Error {}

const ENTRY_TYPES: readonly CourtRecordEntryType[] = ['evidence', 'profile']
const ORDER_KEY: Record<CourtRecordEntryType, 'evidence' | 'profiles'> = { evidence: 'evidence', profile: 'profiles' }
const ID_PATTERN = /^[a-z0-9][a-z0-9_]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Asset paths stay inside assets/court-record/: relative, no parent segments, PNG only. */
function isSafeAssetSrc(src: string): boolean {
  return !src.startsWith('/') && !src.split('/').includes('..') && src.endsWith('.png')
}

function readProvenance(raw: unknown): CourtRecordProvenance | undefined | null {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || typeof raw.source !== 'string' || !isRecord(raw.rect)) return null
  const { x, y, width, height } = raw.rect
  if (!isNonNegativeInt(x) || !isNonNegativeInt(y) || !isPositiveInt(width) || !isPositiveInt(height)) return null
  return { source: raw.source, rect: { x, y, width, height } }
}

function readEntry(raw: unknown, warnings: string[]): CourtRecordEntry | null {
  if (!isRecord(raw)) {
    warnings.push('entries: not an object, dropped')
    return null
  }
  const label = typeof raw.id === 'string' ? `entry "${raw.id}"` : 'entry'
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    warnings.push(`${label}: invalid id, dropped`)
    return null
  }
  if (!ENTRY_TYPES.includes(raw.type as CourtRecordEntryType)) {
    warnings.push(`${label}: unknown type "${String(raw.type)}", dropped`)
    return null
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    warnings.push(`${label}: missing name, dropped`)
    return null
  }
  if (typeof raw.description !== 'string') {
    warnings.push(`${label}: missing description, dropped`)
    return null
  }
  const asset = isRecord(raw.asset) ? raw.asset : null
  if (!asset || typeof asset.src !== 'string' || !isSafeAssetSrc(asset.src)) {
    warnings.push(`${label}: asset.src must be a relative .png path, dropped`)
    return null
  }
  if (!isPositiveInt(asset.width) || !isPositiveInt(asset.height)) {
    warnings.push(`${label}: asset width/height must be positive integers, dropped`)
    return null
  }
  const provenance = readProvenance(raw.provenance)
  if (provenance === null) {
    warnings.push(`${label}: provenance malformed, ignored`)
  }
  return {
    id: raw.id,
    type: raw.type as CourtRecordEntryType,
    name: raw.name,
    description: raw.description,
    asset: { src: asset.src, width: asset.width, height: asset.height },
    ...(provenance ? { provenance } : {}),
  }
}

/**
 * Validates a parsed court-record.json. Returns the usable entries in display order. Throws only
 * when the document itself is unusable (wrong version or no entries array).
 */
export function validateCourtRecordManifest(raw: unknown): ValidatedCourtRecord {
  if (!isRecord(raw)) throw new CourtRecordError('court-record.json: not an object')
  if (raw.version !== COURT_RECORD_VERSION) {
    throw new CourtRecordError(`court-record.json: unsupported version ${String(raw.version)}`)
  }
  if (!Array.isArray(raw.entries)) throw new CourtRecordError('court-record.json: missing "entries" array')

  const warnings: string[] = []
  const byId = new Map<string, CourtRecordEntry>()
  for (const item of raw.entries) {
    const entry = readEntry(item, warnings)
    if (!entry) continue
    if (byId.has(entry.id)) {
      warnings.push(`entry "${entry.id}": duplicate id, later copy dropped`)
      continue
    }
    byId.set(entry.id, entry)
  }

  const order = isRecord(raw.order) ? raw.order : {}
  const placed = new Set<string>()
  const entries: CourtRecordEntry[] = []
  for (const type of ENTRY_TYPES) {
    const key = ORDER_KEY[type]
    const ids = Array.isArray(order[key]) ? (order[key] as unknown[]) : []
    for (const id of ids) {
      const entry = typeof id === 'string' ? byId.get(id) : undefined
      if (!entry || entry.type !== type || placed.has(entry.id)) {
        warnings.push(`order.${key}: "${String(id)}" is unknown, mistyped or repeated, ignored`)
        continue
      }
      placed.add(entry.id)
      entries.push(entry)
    }
  }
  // Entries missing from the order lists are appended, evidence before profiles, manifest order.
  for (const entry of byId.values()) {
    if (placed.has(entry.id)) continue
    warnings.push(`entry "${entry.id}": not listed in order, appended`)
    placed.add(entry.id)
    entries.push(entry)
  }
  return { entries: sortByType(entries), warnings }
}

function sortByType(entries: CourtRecordEntry[]): CourtRecordEntry[] {
  return ENTRY_TYPES.flatMap((type) => entries.filter((entry) => entry.type === type))
}

export function entriesOfType<T extends { type: CourtRecordEntryType }>(
  record: CourtRecord<T>,
  type: CourtRecordEntryType,
): T[] {
  return record.entries.filter((entry) => entry.type === type)
}

/** Fetches court-record.json and resolves each icon URL against the manifest. */
export async function loadCourtRecord(): Promise<LoadedCourtRecord> {
  const manifestUrl = new URL(`${import.meta.env.BASE_URL}assets/court-record/court-record.json`, window.location.href)
  const response = await fetch(manifestUrl)
  if (!response.ok) throw new CourtRecordError(`${manifestUrl.pathname}: HTTP ${response.status}`)
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new CourtRecordError(`${manifestUrl.pathname}: invalid JSON`)
  }
  const { entries, warnings } = validateCourtRecordManifest(raw)
  return {
    entries: entries.map(({ asset, ...entry }) => ({
      ...entry,
      image: { url: new URL(asset.src, manifestUrl).href, width: asset.width, height: asset.height },
    })),
    warnings,
  }
}
