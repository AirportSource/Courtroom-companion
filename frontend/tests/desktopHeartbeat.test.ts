import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDesktopHeartbeat, parseHeartbeatInfo, type HeartbeatEnv } from '../src/desktop/desktopHeartbeat.ts'

function fakeEnv(info: unknown, overrides: Partial<HeartbeatEnv> = {}) {
  const log = { posts: 0, beacons: 0, intervals: [] as number[], cleared: 0, tick: null as null | (() => void),
    visibility: null as null | (() => void), hide: null as null | (() => void), unsubscribed: 0 }
  const env: HeartbeatEnv = {
    isProduction: true,
    fetchInfo: () => (info instanceof Error ? Promise.reject(info) : Promise.resolve(info)),
    post: () => { log.posts++; return Promise.resolve() },
    beacon: () => { log.beacons++; return true },
    setInterval: (cb, ms) => { log.intervals.push(ms); log.tick = cb; return 1 },
    clearInterval: () => { log.cleared++ },
    onVisibilityChange: (cb) => { log.visibility = cb; return () => { log.unsubscribed++ } },
    onPageHide: (cb) => { log.hide = cb; return () => { log.unsubscribed++ } },
    ...overrides,
  }
  return { env, log }
}

test('parseHeartbeatInfo accepts only the desktop payload and clamps the interval', () => {
  assert.equal(parseHeartbeatInfo({ desktop: true, heartbeatIntervalMs: 5000 }), 5000)
  assert.equal(parseHeartbeatInfo({ desktop: true, heartbeatIntervalMs: 1 }), 1000)
  assert.equal(parseHeartbeatInfo({ desktop: true, heartbeatIntervalMs: 1e9 }), 300000)
  for (const bad of [null, undefined, 'x', {}, { desktop: false, heartbeatIntervalMs: 5000 },
    { desktop: true }, { desktop: true, heartbeatIntervalMs: 'fast' }, { desktop: true, heartbeatIntervalMs: NaN }]) {
    assert.equal(parseHeartbeatInfo(bad), null)
  }
})

test('does nothing outside production', async () => {
  let fetched = 0
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 5000 },
    { isProduction: false, fetchInfo: () => { fetched++; return Promise.resolve(null) } })
  await createDesktopHeartbeat(env).start()
  assert.equal(fetched, 0)
  assert.equal(log.intervals.length, 0)
})

test('does nothing when the server is not the desktop app or info fails', async () => {
  for (const info of [{ desktop: false }, null, new Error('offline')]) {
    const { env, log } = fakeEnv(info)
    await createDesktopHeartbeat(env).start()
    assert.equal(log.intervals.length, 0)
    assert.equal(log.posts, 0)
  }
})

test('desktop: beats now, on the interval, on visibility change; beacons on pagehide', async () => {
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 })
  await createDesktopHeartbeat(env).start()
  assert.deepEqual(log.intervals, [4000])
  assert.equal(log.posts, 1)
  log.tick!()
  log.visibility!()
  assert.equal(log.posts, 3)
  log.hide!()
  assert.equal(log.beacons, 1)
  assert.equal(log.posts, 3)
})

test('pagehide falls back to a normal post when the beacon cannot be queued', async () => {
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 }, { beacon: () => false })
  await createDesktopHeartbeat(env).start()
  log.hide!()
  assert.equal(log.posts, 2)
})

test('never more than one timer, even when started twice or concurrently', async () => {
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 })
  const heartbeat = createDesktopHeartbeat(env)
  await Promise.all([heartbeat.start(), heartbeat.start()])
  await heartbeat.start()
  assert.equal(log.intervals.length, 1)
})

test('failing post (sync throw or rejection) is swallowed', async () => {
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 }, { post: () => Promise.reject(new Error('down')) })
  await createDesktopHeartbeat(env).start()
  log.tick!()
  const { env: throwing, log: log2 } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 },
    { post: () => { throw new Error('sync') }, beacon: () => { throw new Error('beacon') } })
  await createDesktopHeartbeat(throwing).start()
  log2.tick!()
  log2.hide!()
  await new Promise((resolve) => setTimeout(resolve, 10))
  process.off('unhandledRejection', onRejection)
  assert.deepEqual(rejections, [])
})

test('stop clears the timer and listeners, and stopping during the info fetch prevents a timer', async () => {
  const { env, log } = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 })
  const heartbeat = createDesktopHeartbeat(env)
  await heartbeat.start()
  heartbeat.stop()
  assert.equal(log.cleared, 1)
  assert.equal(log.unsubscribed, 2)

  const early = fakeEnv({ desktop: true, heartbeatIntervalMs: 4000 })
  const pending = createDesktopHeartbeat(early.env)
  const started = pending.start()
  pending.stop()
  await started
  assert.equal(early.log.intervals.length, 0)
})
