// Singleton loader for the official YouTube IFrame Player API
// (https://www.youtube.com/iframe_api). Loaded once, on demand.

import type { MusicErrorCode } from '../types.ts'

/** Minimal slice of the YT namespace this app uses. */
export interface YTPlayerEvent {
  data: number
}
export interface YTPlayer {
  loadVideoById(videoId: string): void
  cueVideoById(videoId: string): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  setVolume(volume: number): void
  mute(): void
  unMute(): void
  destroy(): void
}
export interface YTPlayerOptions {
  width: number | string
  height: number | string
  videoId?: string
  playerVars?: Record<string, string | number>
  events: {
    onReady?: () => void
    onStateChange?: (e: YTPlayerEvent) => void
    onError?: (e: YTPlayerEvent) => void
  }
}
export interface YTNamespace {
  Player: new (host: HTMLElement | string, options: YTPlayerOptions) => YTPlayer
}

export class YouTubeApiError extends Error {
  readonly code: Extract<MusicErrorCode, 'network' | 'api_unavailable'>
  constructor(code: 'network' | 'api_unavailable', message: string) {
    super(message)
    this.name = 'YouTubeApiError'
    this.code = code
  }
}

export const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
const DEFAULT_TIMEOUT_MS = 10_000

/** Environment seam so the loader can be tested without a DOM. */
export interface ApiLoaderEnv {
  getYT(): YTNamespace | undefined
  isOnline(): boolean
  /** Chain onto window.onYouTubeIframeAPIReady without clobbering a previous handler. */
  onReady(cb: () => void): void
  injectScript(src: string, onError: () => void): void
  setTimeout(cb: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export function createApiLoader(env: ApiLoaderEnv, timeoutMs = DEFAULT_TIMEOUT_MS): () => Promise<YTNamespace> {
  let pending: Promise<YTNamespace> | null = null
  return () => {
    const ready = env.getYT()
    if (ready?.Player) return Promise.resolve(ready)
    if (pending) return pending
    if (!env.isOnline()) {
      return Promise.reject(new YouTubeApiError('network', 'Offline: cannot load the YouTube player'))
    }
    const attempt = new Promise<YTNamespace>((resolve, reject) => {
      let settled = false
      const fail = (code: 'network' | 'api_unavailable', message: string) => {
        if (settled) return
        settled = true
        env.clearTimeout(timer)
        pending = null // allow a retry later
        reject(new YouTubeApiError(code, message))
      }
      const timer = env.setTimeout(() => fail('api_unavailable', 'YouTube player timed out'), timeoutMs)
      env.onReady(() => {
        const yt = env.getYT()
        if (settled) return
        if (!yt?.Player) return fail('api_unavailable', 'YouTube player API unavailable')
        settled = true
        env.clearTimeout(timer)
        resolve(yt)
      })
      env.injectScript(IFRAME_API_SRC, () =>
        fail(env.isOnline() ? 'api_unavailable' : 'network', 'Could not load the YouTube player'),
      )
    })
    pending = attempt
    return attempt
  }
}

type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }

function browserEnv(): ApiLoaderEnv {
  const w = window as YTWindow
  return {
    getYT: () => w.YT,
    isOnline: () => navigator.onLine !== false,
    onReady(cb) {
      const previous = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        try {
          previous?.()
        } finally {
          cb()
        }
      }
    },
    injectScript(src, onError) {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
      if (existing) existing.remove() // stale failed tag: re-inject so a retry can succeed
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onerror = onError
      document.head.appendChild(script)
    },
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
  }
}

let defaultLoader: (() => Promise<YTNamespace>) | null = null

/** Loads (once) and returns the official YT namespace. Rejects with YouTubeApiError. */
export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  defaultLoader ??= createApiLoader(browserEnv())
  return defaultLoader()
}
