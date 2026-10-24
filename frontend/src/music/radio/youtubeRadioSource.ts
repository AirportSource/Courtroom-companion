// Radio MusicSource backed by the official YouTube IFrame Player API. The player is a real,
// visible embedded player living in a host element provided by the UI. Audio is never
// extracted, proxied or hidden: we only call the documented player methods.

import type { MusicError, MusicSource, SourceState, StartOptions } from '../types.ts'
import { loadYouTubeIframeApi, YouTubeApiError } from './youtubeIframeApi.ts'
import type { YTNamespace, YTPlayer } from './youtubeIframeApi.ts'

export const PLAYER_WIDTH = 356
export const PLAYER_HEIGHT = 200 // 16:9, above YouTube's 200x200 minimum

export type PlayerStateKind = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown'

export function mapPlayerState(code: number): PlayerStateKind {
  switch (code) {
    case -1:
      return 'unstarted'
    case 0:
      return 'ended'
    case 1:
      return 'playing'
    case 2:
      return 'paused'
    case 3:
      return 'buffering'
    case 5:
      return 'cued'
    default:
      return 'unknown'
  }
}

export function mapPlayerError(code: number, online = true): MusicError {
  switch (code) {
    case 2:
      return { code: 'unavailable', message: 'Invalid video ID' }
    case 5:
      return online
        ? { code: 'unknown', message: 'The YouTube player hit an error' }
        : { code: 'network', message: 'Offline' }
    case 100:
      return { code: 'unavailable', message: 'Video not found or private' }
    case 101:
    case 150:
    case 153:
      return { code: 'unavailable', message: 'The video owner disabled embedded playback' }
    default:
      return { code: 'unknown', message: `YouTube player error ${code}` }
  }
}

export interface YouTubeRadioDeps {
  loadApi?: () => Promise<YTNamespace>
  isOnline?: () => boolean
  setTimeout?: (cb: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  /** Creates the element the YT API replaces with its iframe, inside `host`. */
  createMount?: (host: HTMLElement) => HTMLElement
  autoplayTimeoutMs?: number
  bufferTimeoutMs?: number
  playerReadyTimeoutMs?: number
  hostTimeoutMs?: number
  rampStepMs?: number
}

export type YouTubeRadioSource = MusicSource & { attach(host: HTMLElement | null): void }

const IDLE: SourceState = { status: 'idle', trackId: null, title: null, error: null }

export function createYouTubeRadioSource(deps: YouTubeRadioDeps = {}): YouTubeRadioSource {
  const loadApi = deps.loadApi ?? loadYouTubeIframeApi
  const isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const setT = deps.setTimeout ?? ((cb: () => void, ms: number) => globalThis.setTimeout(cb, ms))
  const clearT = deps.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>))
  const createMount =
    deps.createMount ??
    ((host: HTMLElement) => {
      const el = host.ownerDocument.createElement('div')
      host.replaceChildren(el)
      return el
    })
  const autoplayMs = deps.autoplayTimeoutMs ?? 2500
  const bufferMs = deps.bufferTimeoutMs ?? 15_000
  const readyMs = deps.playerReadyTimeoutMs ?? 10_000
  const hostMs = deps.hostTimeoutMs ?? 5000
  const rampStepMs = deps.rampStepMs ?? 50

  let state: SourceState = IDLE
  const listeners = new Set<(s: SourceState) => void>()
  let host: HTMLElement | null = null
  let hostWaiter: ((h: HTMLElement | null) => void) | null = null
  let player: YTPlayer | null = null
  let playerHost: HTMLElement | null = null
  let ready = false
  let readyWaiters: Array<(ok: boolean) => void> = []
  let gen = 0
  let volume = 1
  let duckFactor = 1
  let duckTarget = 1
  let duckTimer: unknown = null
  let fadeLevel = 1
  let muted = false
  let timer: unknown = null
  let release: (() => void) | null = null
  let disposed = false

  const set = (patch: Partial<SourceState>) => {
    state = { ...state, ...patch }
    for (const l of [...listeners]) {
      try {
        l(state)
      } catch {
        // a faulty listener must not break playback
      }
    }
  }
  const clearTimer = () => {
    if (timer !== null) clearT(timer)
    timer = null
  }
  const armTimer = (ms: number, fire: () => void) => {
    clearTimer()
    const myGen = gen
    timer = setT(() => {
      timer = null
      if (myGen === gen) fire()
    }, ms)
  }
  const finishStart = () => {
    const r = release
    release = null
    r?.()
  }
  const safe = (fn: (p: YTPlayer) => void) => {
    if (!player || !ready) return
    try {
      fn(player)
    } catch {
      // the player may be mid-teardown
    }
  }
  const applyVolume = () => {
    const pct = Math.round(Math.min(1, Math.max(0, volume * duckFactor * fadeLevel)) * 100)
    safe((p) => {
      if (pct === 0) {
        p.mute()
        muted = true
      } else {
        if (muted) p.unMute()
        muted = false
      }
      p.setVolume(pct)
    })
  }

  const fail = (error: MusicError) => {
    clearTimer()
    safe((p) => p.stopVideo())
    set({ status: 'error', error })
    finishStart()
  }
  const blocked = () => {
    clearTimer()
    set({ status: 'blocked', error: { code: 'autoplay_blocked', message: 'Autoplay blocked: press Play' } })
    finishStart()
  }

  const onStateChange = (code: number) => {
    if (state.status === 'idle' || state.status === 'error') return
    switch (mapPlayerState(code)) {
      case 'playing':
        clearTimer()
        set({ status: 'playing', error: null })
        finishStart()
        break
      case 'buffering':
        // Buffering proves autoplay was allowed; now only guard against a stream that never starts.
        if (state.status === 'loading') armTimer(bufferMs, () => fail({ code: 'network', message: 'The stream did not start' }))
        break
      case 'paused':
        if (state.status === 'loading') blocked()
        else if (state.status !== 'blocked') set({ status: 'paused', error: null })
        break
      case 'ended':
        fail({ code: 'unavailable', message: 'Stream ended' })
        break
      default:
        break // unstarted / cued: the autoplay timer decides
    }
  }
  const onError = (code: number) => {
    if (state.status === 'idle') return
    fail(mapPlayerError(code, isOnline()))
  }

  const waitForHost = (): Promise<HTMLElement> =>
    new Promise((resolve, reject) => {
      if (host) return resolve(host)
      const t = setT(() => {
        hostWaiter = null
        reject(new Error('The radio player is not mounted'))
      }, hostMs)
      hostWaiter = (h) => {
        clearT(t)
        hostWaiter = null
        if (h) resolve(h)
        else reject(new Error('The radio player is not mounted'))
      }
    })

  const destroyPlayer = () => {
    const p = player
    player = null
    playerHost = null
    ready = false
    muted = false
    for (const w of readyWaiters) w(false)
    readyWaiters = []
    try {
      p?.destroy()
    } catch {
      // already gone
    }
  }

  const ensurePlayer = async (yt: YTNamespace, h: HTMLElement): Promise<YTPlayer> => {
    if (!player || playerHost !== h) {
      destroyPlayer()
      playerHost = h
      const mount = createMount(h)
      const created: YTPlayer = new yt.Player(mount, {
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
        playerVars: { playsinline: 1, rel: 0, enablejsapi: 1 },
        events: {
          onReady: () => {
            if (player !== created) return
            ready = true
            const w = readyWaiters
            readyWaiters = []
            for (const f of w) f(true)
          },
          onStateChange: (e) => {
            if (player === created) onStateChange(e.data)
          },
          onError: (e) => {
            if (player === created) onError(e.data)
          },
        },
      })
      player = created
    }
    const p = player
    const ok = await new Promise<boolean>((resolve) => {
      if (ready) return resolve(true)
      const t = setT(() => resolve(false), readyMs)
      readyWaiters.push((v) => {
        clearT(t)
        resolve(v)
      })
    })
    if (!ok || player !== p) throw new YouTubeApiError('api_unavailable', 'The YouTube player did not become ready')
    return p
  }

  const boot = async (myGen: number, videoId: string) => {
    try {
      const yt = await loadApi()
      if (gen !== myGen) return
      const h = await waitForHost()
      if (gen !== myGen) return
      const p = await ensurePlayer(yt, h)
      if (gen !== myGen) return
      applyVolume()
      armTimer(autoplayMs, blocked)
      p.loadVideoById(videoId)
      p.playVideo()
    } catch (e) {
      if (gen !== myGen) return
      if (e instanceof YouTubeApiError) fail({ code: e.code, message: e.message })
      else fail({ code: 'unknown', message: e instanceof Error ? e.message : 'Radio failed to start' })
    }
  }

  const halt = () => {
    clearTimer()
    safe((p) => p.stopVideo())
    set({ ...IDLE })
  }

  return {
    kind: 'radio',
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async start(videoId: string, options: StartOptions) {
      if (disposed) return
      const myGen = ++gen
      finishStart()
      clearTimer()
      volume = options.volume
      fadeLevel = 1
      set({ status: 'loading', trackId: videoId, title: null, error: null })
      if (options.signal.aborted) {
        halt()
        return
      }
      const outcome = new Promise<void>((resolve) => {
        release = resolve
      })
      const onAbort = () => {
        if (gen === myGen) {
          gen++
          halt()
        }
        finishStart()
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      void boot(myGen, videoId)
      try {
        await outcome
      } finally {
        options.signal.removeEventListener('abort', onAbort)
      }
    },

    pause() {
      if (state.status !== 'playing' && state.status !== 'loading') return
      safe((p) => p.pauseVideo())
      clearTimer()
      set({ status: 'paused', error: null })
    },

    resume() {
      if (!player || !ready) return
      if (state.status === 'idle' || state.status === 'error') return
      if (state.status === 'blocked' || state.status === 'paused') {
        set({ status: 'loading', error: null })
        armTimer(autoplayMs, blocked)
      }
      safe((p) => p.playVideo())
    },

    async stop(options) {
      const myGen = ++gen
      finishStart()
      clearTimer()
      const fadeMs = Math.min(Math.max(options?.fadeOutMs ?? 0, 0), 3000)
      if (fadeMs > 0 && state.status === 'playing' && player && ready) {
        const steps = Math.max(1, Math.round(fadeMs / rampStepMs))
        for (let i = steps - 1; i >= 0 && gen === myGen; i--) {
          fadeLevel = i / steps
          applyVolume()
          await new Promise<void>((r) => setT(r, rampStepMs))
        }
        if (gen !== myGen) return // superseded during the fade
      }
      halt()
      fadeLevel = 1
      applyVolume()
    },

    setVolume(v) {
      volume = v
      applyVolume()
    },

    setDucking(factor, rampMs) {
      const target = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 1))
      if (target === duckTarget && (duckTimer !== null || target === duckFactor)) return
      duckTarget = target
      if (duckTimer !== null) clearT(duckTimer)
      duckTimer = null
      const from = duckFactor
      const steps = Math.max(1, Math.ceil(rampMs / rampStepMs))
      let step = 0
      const tick = () => {
        duckTimer = null
        if (disposed) return
        duckFactor = from + (target - from) * (++step / steps)
        applyVolume()
        if (step < steps) duckTimer = setT(tick, rampStepMs)
      }
      if (rampMs > 0) duckTimer = setT(tick, rampStepMs)
      else { duckFactor = target; applyVolume() }
    },

    attach(next) {
      if (next === host) return
      if (player) {
        // The old host is going away; the iframe goes with it.
        const wasActive = state.status !== 'idle'
        gen++
        finishStart()
        clearTimer()
        destroyPlayer()
        if (wasActive) set({ ...IDLE })
      }
      host = next
      hostWaiter?.(next)
    },

    dispose() {
      disposed = true
      if (duckTimer !== null) clearT(duckTimer)
      duckTimer = null
      gen++
      finishStart()
      clearTimer()
      destroyPlayer()
      listeners.clear()
      state = IDLE
      host = null
    },
  }
}
