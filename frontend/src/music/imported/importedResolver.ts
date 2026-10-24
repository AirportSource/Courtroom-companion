// TrackResolver for imported tracks: maps a library id to a MusicTrack for the shared Web Audio
// source. Loops come from persisted metadata only; no analysis ever runs during playback.
import type { TrackResolver } from '../webAudioSource.ts'
import type { LoopMetadata, MusicTrack } from '../types.ts'
import type { ImportApi, ImportedTrackRecord } from './importApi.ts'

const NO_LOOP: LoopMetadata = { region: null, confidence: null, provenance: 'none' }

export function recordToTrack(record: ImportedTrackRecord, audioUrl: (id: string) => string): MusicTrack {
  return {
    id: record.id,
    title: record.title,
    source: 'imported',
    url: audioUrl(record.id),
    category: 'imported',
    tags: [],
    gain: 1,
    loop: record.loop ?? { ...NO_LOOP },
    contextual: false,
  }
}

export interface ImportedResolver extends TrackResolver {
  /** Forget cached library data (call after a loop is saved or a track is deleted). */
  invalidate(): void
}

/**
 * The library list is cached briefly so repeated starts do not hit the backend; an unknown id
 * triggers one refresh before giving up. Never throws: unknown or missing files resolve to null.
 */
export function createImportedResolver(api: Pick<ImportApi, 'list' | 'audioUrl'>, maxAgeMs = 5000, now: () => number = () => Date.now()): ImportedResolver {
  let cache: { at: number; tracks: Map<string, ImportedTrackRecord> } | null = null

  async function load(signal: AbortSignal): Promise<Map<string, ImportedTrackRecord> | null> {
    const result = await api.list(signal)
    if (!result.ok) return null
    cache = { at: now(), tracks: new Map(result.value.map((item) => [item.id, item])) }
    return cache.tracks
  }

  return {
    invalidate() {
      cache = null
    },
    async resolve(trackId, signal) {
      try {
        const cached = cache && now() - cache.at < maxAgeMs ? cache.tracks : null
        let tracks = cached ?? (await load(signal))
        let record = tracks?.get(trackId)
        if (!record && cached) {
          tracks = await load(signal) // possibly imported moments ago
          record = tracks?.get(trackId)
        }
        return record && record.available ? recordToTrack(record, api.audioUrl) : null
      } catch {
        return null
      }
    },
  }
}
