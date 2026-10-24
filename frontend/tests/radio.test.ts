// Radio tests: fake YT namespace + fake player, no network, no DOM.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { SourceState } from '../src/music/types.ts'
import { LOFI_GIRL_PRESET } from '../src/music/radio/presets.ts'
import { createApiLoader, YouTubeApiError } from '../src/music/radio/youtubeIframeApi.ts'
import type { ApiLoaderEnv, YTNamespace, YTPlayerOptions } from '../src/music/radio/youtubeIframeApi.ts'
import { createYouTubeRadioSource, mapPlayerError, mapPlayerState } from '../src/music/radio/youtubeRadioSource.ts'
import { parseYouTubeVideoId } from '../src/music/radio/youtubeUrl.ts'

const ID = LOFI_GIRL_PRESET.videoId

test('parses valid IDs and URLs', () => {
  const ok = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?t=10`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `  youtube.com/watch?v=${ID}  `,
  ]
  for (const input of ok) assert.equal(parseYouTubeVideoId(input), ID, input)
})

test('rejects invalid and malicious input', () => {
  const bad = [
    '',
    'short',
    'jfKfPfyJRdk1',
    'jfKfPfyJRd!',
    'javascript:alert(1)',
    `javascript://youtube.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtu.be.evil.example/${ID}`,
    `https://user:pw@youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/playlist?list=PLabcdefghijk',
    'https://www.youtube.com/watch?v=<script>',
    `ftp://youtube.com/watch?v=${ID}`,
    'https://www.youtube.com/',
  ]
  for (const input of bad) assert.equal(parseYouTubeVideoId(input), null, input)
})

test('preset is configurable data', () => {
  assert.equal(parseYouTubeVideoId(LOFI_GIRL_PRESET.videoId), LOFI_GIRL_PRESET.videoId)
  assert.equal(LOFI_GIRL_PRESET.videoId, 'EWrX250Zhko')
  assert.equal(LOFI_GIRL_PRESET.verified, true)
  assert.equal(LOFI_GIRL_PRESET.available, false)
  assert.match(LOFI_GIRL_PRESET.unavailableReason ?? '', /error 150/i)
})

// ---- fakes -----------------------------------------------------------------------------

class FakePlayer {
  calls: string[] = []
  volumes: number[] = []
  options: YTPlayerOptions
  constructor(options: YTPlayerOptions) {
    this.options = options
  }
  loadVideoById(id: string) { this.calls.push(`load:${id}`) }
  cueVideoById(id: string) { this.calls.push(`cue:${id}`) }
  playVideo() { this.calls.push('play') }
  pauseVideo() { this.calls.push('pause') }
  stopVideo() { this.calls.push('stop') }
  setVolume(v: number) { this.calls.push(`vol:${v}`); this.volumes.push(v) }
  mute() { this.calls.push('mute') }
  unMute() { this.calls.push('unmute') }
  destroy() { this.calls.push('destroy') }
  ready() { this.options.events.onReady?.() }
  state(code: number) { this.options.events.onStateChange?.({ data: code }) }
  error(code: number) { this.options.events.onError?.({ data: code }) }
}

function setup(opts: { autoplayTimeoutMs?: number; online?: boolean; loadApi?: () => Promise<YTNamespace>; autoReady?: boolean } = {}) {
  const players: FakePlayer[] = []
  const yt = {
    Player: class {
      constructor(_host: unknown, options: YTPlayerOptions) {
        const p = new FakePlayer(options)
        players.push(p)
        if (opts.autoReady !== false) queueMicrotask(() => p.ready())
        return p as never
      }
    },
  } as unknown as YTNamespace
  const source = createYouTubeRadioSource({
    loadApi: opts.loadApi ?? (() => Promise.resolve(yt)),
    isOnline: () => opts.online ?? true,
    createMount: (h) => h,
    autoplayTimeoutMs: opts.autoplayTimeoutMs ?? 30,
    bufferTimeoutMs: 60,
    playerReadyTimeoutMs: 60,
    hostTimeoutMs: 60,
    rampStepMs: 1,
  })
  source.attach({} as HTMLElement)
  const states: SourceState[] = []
  source.subscribe((s) => states.push(s))
  const tick = () => new Promise<void>((r) => setTimeout(r, 0))
  return { source, players, states, tick }
}
const opts = (volume = 1, signal = new AbortController().signal) => ({ volume, signal })

test('radio ducks and restores through bounded volume ramps without replaying the video', async (t) => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts(0.8))
  await tick(); players[0].state(1); await started
  t.mock.timers.enable({ apis: ['setTimeout'] })
  source.setDucking!(0.12, 4)
  for (let i = 0; i < 4; i++) t.mock.timers.tick(1)
  assert.equal(players[0].volumes.at(-1), 10)
  source.setVolume(0)
  source.setDucking!(1, 4)
  for (let i = 0; i < 4; i++) t.mock.timers.tick(1)
  assert.equal(players[0].volumes.at(-1), 0)
  source.setVolume(0.8)
  assert.equal(players[0].volumes.at(-1), 80)
  assert.equal(players[0].calls.filter((call) => call === 'play').length, 1)
  assert.equal(players[0].calls.filter((call) => call.startsWith('load:')).length, 1)
  source.dispose()
})

// ---- lifecycle -------------------------------------------------------------------------

test('start -> playing, pause, resume, stop', async () => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts(0.5))
  await tick()
  assert.equal(source.getState().status, 'loading')
  const p = players[0]
  assert.ok(p.calls.includes(`load:${ID}`) && p.calls.includes('play'))
  p.state(3)
  p.state(1)
  await started
  assert.equal(source.getState().status, 'playing')
  assert.equal(source.getState().trackId, ID)
  source.pause()
  assert.equal(source.getState().status, 'paused')
  assert.ok(p.calls.includes('pause'))
  source.resume()
  p.state(1)
  assert.equal(source.getState().status, 'playing')
  await source.stop()
  assert.equal(source.getState().status, 'idle')
  assert.ok(p.calls.includes('stop'))
  p.state(5) // late event after stop must not revive state
  assert.equal(source.getState().status, 'idle')
})

test('stop with fade ramps volume down', async () => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts(1))
  await tick()
  players[0].state(1)
  await started
  await source.stop({ fadeOutMs: 5 })
  const v = players[0].volumes
  assert.ok(v.includes(0) || v.some((x) => x < 100))
  assert.equal(source.getState().status, 'idle')
})

test('volume mapping and mute at zero', async () => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts(0.456))
  await tick()
  const p = players[0]
  players[0].state(1)
  await started
  assert.ok(p.calls.includes('vol:46'))
  source.setVolume(0)
  assert.deepEqual(p.calls.slice(-2), ['mute', 'vol:0'])
  source.setVolume(1)
  assert.deepEqual(p.calls.slice(-2), ['unmute', 'vol:100'])
  source.setVolume(7) // clamped
  assert.equal(p.calls.at(-1), 'vol:100')
})

// ---- mapping ---------------------------------------------------------------------------

test('state and error mapping tables', () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 5, 9].map(mapPlayerState), ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued', 'unknown'])
  for (const c of [2, 100, 101, 150, 153]) assert.equal(mapPlayerError(c).code, 'unavailable')
  assert.equal(mapPlayerError(5).code, 'unknown')
  assert.equal(mapPlayerError(5, false).code, 'network')
  assert.equal(mapPlayerError(77).code, 'unknown')
})

test('player errors surface as error state', async () => {
  for (const code of [2, 100, 101, 150, 153]) {
    const { source, players, tick } = setup()
    const started = source.start(ID, opts())
    await tick()
    players[0].error(code)
    await started
    assert.equal(source.getState().status, 'error')
    assert.equal(source.getState().error?.code, 'unavailable')
  }
})

test('livestream ended is an unavailable error', async () => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts())
  await tick()
  players[0].state(1)
  await started
  players[0].state(0)
  assert.equal(source.getState().status, 'error')
  assert.deepEqual(source.getState().error, { code: 'unavailable', message: 'Stream ended' })
})

test('unrequested pause while playing is reported as paused', async () => {
  const { source, players, tick } = setup()
  const started = source.start(ID, opts())
  await tick()
  players[0].state(1)
  await started
  players[0].state(2)
  assert.equal(source.getState().status, 'paused')
})

// ---- autoplay --------------------------------------------------------------------------

test('autoplay blocked after timeout, recovered by user resume', async () => {
  const { source, players, tick } = setup({ autoplayTimeoutMs: 10 })
  const started = source.start(ID, opts())
  await tick()
  players[0].state(-1)
  await started // resolves once blocked
  assert.equal(source.getState().status, 'blocked')
  assert.equal(source.getState().error?.code, 'autoplay_blocked')
  source.resume() // the Play button
  assert.equal(source.getState().status, 'loading')
  assert.equal(players[0].calls.filter((c) => c === 'play').length, 2)
  players[0].state(1)
  assert.equal(source.getState().status, 'playing')
  assert.equal(source.getState().error, null)
})

test('paused while loading counts as blocked immediately', async () => {
  const { source, players, tick } = setup({ autoplayTimeoutMs: 5000 })
  const started = source.start(ID, opts())
  await tick()
  players[0].state(2)
  await started
  assert.equal(source.getState().status, 'blocked')
})

// ---- failures --------------------------------------------------------------------------

test('API load failure and offline map to error codes', async () => {
  const a = setup({ loadApi: () => Promise.reject(new YouTubeApiError('api_unavailable', 'nope')) })
  await a.source.start(ID, opts())
  assert.equal(a.source.getState().error?.code, 'api_unavailable')
  const b = setup({ loadApi: () => Promise.reject(new YouTubeApiError('network', 'Offline')) })
  await b.source.start(ID, opts())
  assert.equal(b.source.getState().error?.code, 'network')
  const c = setup({ loadApi: () => Promise.reject(new Error('boom')) })
  await c.source.start(ID, opts())
  assert.equal(c.source.getState().error?.code, 'unknown')
})

test('player that never becomes ready fails cleanly', async () => {
  const { source } = setup({ autoReady: false })
  await source.start(ID, opts())
  assert.equal(source.getState().error?.code, 'api_unavailable')
})

test('API loader: offline, timeout, script error, success, single injection', async () => {
  const mk = (over: Partial<ApiLoaderEnv>) => {
    let yt: YTNamespace | undefined
    let ready: (() => void) | null = null
    const env: ApiLoaderEnv = {
      getYT: () => yt,
      isOnline: () => true,
      onReady: (cb) => {
        ready = cb
      },
      injectScript: () => {},
      setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as never),
      ...over,
    }
    return {
      env,
      fire: () => {
        yt = { Player: class {} as never }
        ready?.()
      },
    }
  }
  await assert.rejects(createApiLoader(mk({ isOnline: () => false }).env)(), (e: YouTubeApiError) => e.code === 'network')
  await assert.rejects(createApiLoader(mk({}).env, 10)(), (e: YouTubeApiError) => e.code === 'api_unavailable')
  await assert.rejects(
    createApiLoader(mk({ injectScript: (_s, onError) => queueMicrotask(onError) }).env)(),
    (e: YouTubeApiError) => e.code === 'api_unavailable',
  )
  let injected = 0
  const ok = mk({
    injectScript: () => {
      injected++
    },
  })
  const load = createApiLoader(ok.env)
  const p1 = load()
  const p2 = load()
  assert.equal(p1, p2)
  ok.fire()
  const yt = await p1
  assert.ok(yt.Player)
  assert.equal(await load(), yt)
  assert.equal(injected, 1)
})

// ---- abort -----------------------------------------------------------------------------

test('abort while loading stops and leaves no state', async () => {
  const { source, players, tick } = setup()
  const ac = new AbortController()
  const started = source.start(ID, opts(1, ac.signal))
  await tick()
  ac.abort()
  await started
  assert.equal(source.getState().status, 'idle')
  assert.equal(source.getState().trackId, null)
  assert.ok(players[0].calls.includes('stop'))
  players[0].state(1) // late event ignored
  assert.equal(source.getState().status, 'idle')
})

test('abort before API resolves never creates a player', async () => {
  let resolveApi!: (y: YTNamespace) => void
  const created: number[] = []
  const yt = {
    Player: class {
      constructor() {
        created.push(1)
      }
    },
  } as unknown as YTNamespace
  const { source, tick } = setup({
    loadApi: () =>
      new Promise((r) => {
        resolveApi = r
      }),
  })
  const ac = new AbortController()
  const started = source.start(ID, opts(1, ac.signal))
  ac.abort()
  await started
  resolveApi(yt)
  await tick()
  assert.equal(created.length, 0)
  assert.equal(source.getState().status, 'idle')
})

test('a second start supersedes the first without leaking', async () => {
  const { source, players, tick } = setup()
  const first = source.start(ID, opts())
  await tick()
  const second = source.start('AAAAAAAAAAA', opts())
  await first
  await tick()
  players[0].state(1)
  await second
  assert.equal(source.getState().trackId, 'AAAAAAAAAAA')
  assert.equal(source.getState().status, 'playing')
})

// ---- compliance ------------------------------------------------------------------------

test('radio code never extracts, proxies or hides audio', () => {
  const dir = new URL('../src/music/radio/', import.meta.url)
  const files = readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f))
  assert.ok(files.length >= 5)
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    assert.doesNotMatch(text, /googlevideo|ytdl|yt-dlp|videoplayback/i, f)
    assert.doesNotMatch(text, /<audio|new Audio\(|createElement\(.audio/i, f)
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|sendBeacon/, f)
    assert.doesNotMatch(text, /display:\s*none|visibility:\s*hidden|opacity:\s*0(?![.\d])/, f + ' hides content')
  }
  const api = readFileSync(new URL('youtubeIframeApi.ts', dir), 'utf8')
  assert.match(api, /https:\/\/www\.youtube\.com\/iframe_api/)
})

