import type { AudioLoopHandle } from './audioEngine.ts'
import type { SoundId } from './manifestTypes.ts'

export interface RingtoneItem { id: string; label: string; sound: SoundId }
export interface RingtoneCatalog { defaultId: string; items: RingtoneItem[] }

/** Event used when no catalog is loaded; it always maps to the original default ringtone. */
export const DEFAULT_RING_EVENT = 'phone_ring_loop'
export const RINGTONE_PREVIEW_MAX_MS = 20000
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export const ringtoneEvent = (id: string): string => `ringtone:${id}`

/** Validates the manifest block; items without a known sound are dropped, no valid default → null. */
export function parseRingtones(raw: unknown, knownSounds: ReadonlySet<SoundId>): RingtoneCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { default: defaultId, items } = raw as { default?: unknown; items?: unknown }
  if (typeof items !== 'object' || items === null) return null
  const list: RingtoneItem[] = []
  for (const [id, item] of Object.entries(items)) {
    const entry = item as { label?: unknown; sound?: unknown } | null
    if (!SAFE_ID.test(id) || typeof entry?.sound !== 'string' || !knownSounds.has(entry.sound)) continue
    list.push({ id, label: typeof entry.label === 'string' && entry.label ? entry.label : id, sound: entry.sound })
  }
  if (typeof defaultId !== 'string' || !list.some((item) => item.id === defaultId)) return null
  return { defaultId, items: list }
}

export function ringtoneEvents(catalog: RingtoneCatalog): Record<string, SoundId> {
  return Object.fromEntries(catalog.items.map((item) => [ringtoneEvent(item.id), item.sound]))
}

/** Unknown, empty or invalid ids fall back to the catalog default. */
export function resolveRingtone(catalog: RingtoneCatalog, id: string | null | undefined): RingtoneItem {
  return catalog.items.find((item) => item.id === id) ?? catalog.items.find((item) => item.id === catalog.defaultId)!
}

let catalog: RingtoneCatalog | null = null
export const setRingtoneCatalog = (next: RingtoneCatalog | null): void => { catalog = next }
export const getRingtoneCatalog = (): RingtoneCatalog | null => catalog

/** The audio event for a settings id (manifest default when unknown or no catalog is loaded). */
export function ringtoneEventFor(id: string | null | undefined): string {
  return catalog ? ringtoneEvent(resolveRingtone(catalog, id).id) : DEFAULT_RING_EVENT
}

// Exactly one ringtone plays at a time: while any lease is open, later acquirers (real ring or
// settings preview) join the tone already playing instead of starting a second source.
let active: { event: string; leases: number } | null = null

export function acquireRingtone(
  audio: { acquireEventLoop(event: string, volume: number): AudioLoopHandle },
  ringtoneId: string | null | undefined,
  volume: number,
): AudioLoopHandle {
  const shared = active ?? (active = { event: ringtoneEventFor(ringtoneId), leases: 0 })
  shared.leases++
  const handle = audio.acquireEventLoop(shared.event, volume)
  let released = false
  return {
    setVolume: (next) => handle.setVolume(next),
    stop() {
      if (released) return
      released = true
      handle.stop()
      if (--shared.leases === 0 && active === shared) active = null
    },
  }
}

/** Settings preview: same shared loop path as the phone, bounded, never ducks BGM (menus have none). */
export function previewRingtone(
  audio: { acquireEventLoop(event: string, volume: number): AudioLoopHandle },
  ringtoneId: string | null | undefined,
  volume: number,
  onEnd: () => void = () => {},
  maxMs = RINGTONE_PREVIEW_MAX_MS,
): () => void {
  const lease = acquireRingtone(audio, ringtoneId, volume)
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => stop(), maxMs)
  function stop() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    lease.stop()
    onEnd()
  }
  return stop
}
