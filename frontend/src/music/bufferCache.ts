// Small LRU cache for decoded audio. Lazy (nothing is decoded until asked), dedupes
// in-flight loads for the same key and evicts least-recently-used entries over budget.
// A failed load is never cached.

export interface BufferCacheOptions {
  /** Maximum number of decoded entries kept. */
  maxEntries: number
  /** Maximum total decoded size (as reported by `sizeOf`), in bytes. */
  maxBytes: number
}

export interface BufferCache<T> {
  /** Returns the cached value or runs `load` once (shared by concurrent callers). */
  get(key: string, load: () => Promise<T>): Promise<T>
  has(key: string): boolean
  clear(): void
  readonly size: number
}

export const DEFAULT_BUFFER_CACHE: BufferCacheOptions = { maxEntries: 3, maxBytes: 160 * 1024 * 1024 }

export function createBufferCache<T>(sizeOf: (value: T) => number, options: BufferCacheOptions = DEFAULT_BUFFER_CACHE): BufferCache<T> {
  const ready = new Map<string, { value: T; bytes: number }>() // insertion order = recency
  const inflight = new Map<string, Promise<T>>()
  let totalBytes = 0

  function evict(): void {
    while (ready.size > 1 && (ready.size > options.maxEntries || totalBytes > options.maxBytes)) {
      const oldest = ready.keys().next().value as string
      totalBytes -= ready.get(oldest)?.bytes ?? 0
      ready.delete(oldest)
    }
  }

  return {
    get(key, load) {
      const hit = ready.get(key)
      if (hit) {
        ready.delete(key)
        ready.set(key, hit)
        return Promise.resolve(hit.value)
      }
      const pending = inflight.get(key)
      if (pending) return pending
      const promise = load().then(
        (value) => {
          inflight.delete(key)
          const bytes = sizeOf(value)
          ready.set(key, { value, bytes })
          totalBytes += bytes
          evict()
          return value
        },
        (error: unknown) => {
          inflight.delete(key)
          throw error
        },
      )
      inflight.set(key, promise)
      return promise
    },
    has: (key) => ready.has(key),
    clear() {
      ready.clear()
      totalBytes = 0
    },
    get size() {
      return ready.size
    },
  }
}
