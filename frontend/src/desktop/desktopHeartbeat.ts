// Desktop (standalone build) liveness ping. The packaged launcher exits when the browser tab stops
// calling /api/app/heartbeat. Inert in development and in a plain web deployment.

const INFO_URL = '/api/app/info'
const HEARTBEAT_URL = '/api/app/heartbeat'
const MIN_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 5 * 60_000

/** Browser seams, so the scheduling logic runs without a DOM. */
export interface HeartbeatEnv {
  isProduction: boolean
  fetchInfo(): Promise<unknown>
  /** Normal heartbeat POST; may reject. */
  post(): Promise<unknown>
  /** Best-effort delivery while the page is going away. Returns false when it could not be queued. */
  beacon(): boolean
  setInterval(cb: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  /** Subscribe to visibilitychange / pagehide; returns the unsubscribe. */
  onVisibilityChange(cb: () => void): () => void
  onPageHide(cb: () => void): () => void
}

/** Heartbeat interval from the /api/app/info payload, or null when this is not the desktop app. */
export function parseHeartbeatInfo(info: unknown): number | null {
  if (typeof info !== 'object' || info === null) return null
  const { desktop, heartbeatIntervalMs } = info as Record<string, unknown>
  if (desktop !== true || typeof heartbeatIntervalMs !== 'number' || !Number.isFinite(heartbeatIntervalMs)) return null
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, heartbeatIntervalMs))
}

export interface DesktopHeartbeat {
  /** Resolves once the app info was checked (and the timer started, if desktop). Never rejects. */
  start(): Promise<void>
  stop(): void
}

export function createDesktopHeartbeat(env: HeartbeatEnv): DesktopHeartbeat {
  let timer: unknown = null
  let started = false
  let stopped = false
  let unsubscribe: Array<() => void> = []

  const ping = () => {
    try {
      void Promise.resolve(env.post()).catch(() => {})
    } catch {
      // A failing heartbeat must never surface in the UI.
    }
  }
  const pageHide = () => {
    try {
      if (!env.beacon()) ping()
    } catch {
      // ignore
    }
  }

  const stop = () => {
    stopped = true
    if (timer !== null) env.clearInterval(timer)
    timer = null
    for (const off of unsubscribe) off()
    unsubscribe = []
  }

  return {
    stop,
    async start() {
      if (!env.isProduction || started) return
      started = true
      let interval: number | null = null
      try {
        interval = parseHeartbeatInfo(await env.fetchInfo())
      } catch {
        return
      }
      if (interval === null || stopped || timer !== null) return
      ping()
      timer = env.setInterval(ping, interval)
      unsubscribe = [env.onVisibilityChange(ping), env.onPageHide(pageHide)]
    },
  }
}

function browserEnv(): HeartbeatEnv {
  return {
    isProduction: Boolean(import.meta.env?.PROD),
    async fetchInfo() {
      const response = await fetch(INFO_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      return response.ok ? response.json() : null
    },
    post: () => fetch(HEARTBEAT_URL, { method: 'POST', keepalive: true }),
    beacon: () => typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(HEARTBEAT_URL),
    setInterval: (cb, ms) => window.setInterval(cb, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    onVisibilityChange(cb) {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    onPageHide(cb) {
      window.addEventListener('pagehide', cb)
      return () => window.removeEventListener('pagehide', cb)
    },
  }
}

let active: DesktopHeartbeat | null = null

/** Production-only; a no-op unless the server reports it is the desktop app. Safe to call more than once. */
export function startDesktopHeartbeat(): void {
  if (active) return
  active = createDesktopHeartbeat(browserEnv())
  void active.start()
}
