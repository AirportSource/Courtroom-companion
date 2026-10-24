import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { AudioEngine } from '../src/engine/audioEngine.ts'
import {
  acquireRingtone, getRingtoneCatalog, parseRingtones, previewRingtone, resolveRingtone, ringtoneEvents,
  setRingtoneCatalog, RINGTONE_PREVIEW_MAX_MS,
} from '../src/engine/ringtones.ts'
import { startPhoneRinging, PHONE_DUCK_FACTOR, PHONE_DUCK_MS, PHONE_RESTORE_MS } from '../src/artifacts/phoneRinging.ts'

const manifest = JSON.parse(readFileSync(new URL('../public/assets/audio/audio.json', import.meta.url), 'utf8'))
const known = new Set(Object.keys(manifest.sounds))
const catalog = parseRingtones(manifest.ringtones, known)!

class Node {
  stops = 0; starts = 0; loop = false; loopStart = 0; loopEnd = 0
  gain = { value: 1 }
  connect(next: unknown) { return next }
  disconnect() {}
  start() { this.starts++ }
  stop() { this.stops++ }
}
class Context {
  state = 'running'; currentTime = 0; destination = {}
  sources: Node[] = []
  fetched: string[] = []
  addEventListener() {}
  resume() { return Promise.resolve() }
  decodeAudioData() { return Promise.resolve({ duration: 120 }) }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node }
  createGain() { return new Node() }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function setup(t: TestContext) {
  const context = new Context()
  const old = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { return context } } })
  t.after(() => { if (old) Object.defineProperty(globalThis, 'AudioContext', old); else Reflect.deleteProperty(globalThis, 'AudioContext') })
  t.mock.method(globalThis, 'fetch', async (url: string) => { context.fetched.push(String(url)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } })
  const audio = new AudioEngine()
  const sounds = Object.entries(manifest.sounds as Record<string, { category: string; src: string; loop?: { startSeconds: number; endSeconds: number } }>)
    .map(([id, s]) => ({ id, category: s.category, url: `/${s.src}`, ...(s.loop ? { loop: s.loop } : {}) }))
  audio.register(sounds, { phone_ring_loop: 'fx_phone_ring', ...ringtoneEvents(catalog) })
  audio.unlock()
  setRingtoneCatalog(catalog)
  t.after(() => setRingtoneCatalog(null))
  return { audio, context }
}

test('manifest ringtones: default is Phoenix, every item references a looping sound', () => {
  assert.equal(catalog.defaultId, 'phoenix')
  assert.deepEqual(catalog.items.map((item) => item.id), ['phoenix', 'wellington', 'godot'])
  for (const item of catalog.items) assert.ok(manifest.sounds[item.sound].loop, item.id)
  assert.equal(resolveRingtone(catalog, 'phoenix').sound, 'fx_phone_ring')
})

test('resolveRingtone: valid alternate, and unknown/empty/invalid ids fall back to default', () => {
  assert.equal(resolveRingtone(catalog, 'godot').sound, 'fx_phone_ring_godot')
  for (const bad of ['', 'nope', '../x', null, undefined]) assert.equal(resolveRingtone(catalog, bad).id, 'phoenix')
})

test('parseRingtones drops items with unknown sounds and rejects a missing default', () => {
  const raw = { default: 'a', items: { a: { label: 'A', sound: 'x' }, b: { label: 'B', sound: 'missing' } } }
  assert.deepEqual(parseRingtones(raw, new Set(['x']))?.items.map((i) => i.id), ['a'])
  assert.equal(parseRingtones({ ...raw, default: 'b' }, new Set(['x'])), null)
  assert.equal(parseRingtones(undefined, known), null)
  assert.equal(getRingtoneCatalog(), null)
})

test('real phone flow plays the selected ringtone, with unchanged duck numbers', async (t) => {
  const { audio, context } = setup(t)
  const ducks: unknown[][] = []
  const music = { acquireDuck: (...a: number[]) => { ducks.push(a); return () => {} } }
  const stop = startPhoneRinging(audio, music, 0.8, 'godot')
  await flush()
  assert.equal(context.sources.length, 1)
  assert.ok(context.fetched.some((url) => url.includes('godot_ringtone')))
  assert.deepEqual([context.sources[0].loopStart, context.sources[0].loopEnd], [2.0, 38.00068027210884])
  assert.deepEqual(ducks, [[PHONE_DUCK_FACTOR, PHONE_DUCK_MS, PHONE_RESTORE_MS]])
  stop()
  assert.equal(context.sources[0].stops, 1)
  assert.equal(audio.activeLoopCount, 0)
})

test('phone flow reads the stored setting at ring time', async (t) => {
  const { audio, context } = setup(t)
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (k: string) => store.get(k) ?? null } } })
  t.after(() => Reflect.deleteProperty(globalThis, 'window'))
  const music = { acquireDuck: () => () => {} }
  store.set('courtroom-companion.settings', JSON.stringify({ ringtoneId: 'wellington' }))
  startPhoneRinging(audio, music, 1)()
  await flush()
  assert.ok(context.fetched.some((url) => url.includes('wellington_ringtone')), context.fetched.join())
  store.set('courtroom-companion.settings', JSON.stringify({ ringtoneId: 'bogus' }))
  startPhoneRinging(audio, music, 1)()
  await flush()
  assert.ok(context.fetched.some((url) => url.includes('phoenix_ringtone')), context.fetched.join())
})

test('only one ringtone source: later acquirers (even with another id) share the playing tone', async (t) => {
  const { audio, context } = setup(t)
  const first = acquireRingtone(audio, 'phoenix', 1)
  const preview = acquireRingtone(audio, 'godot', 1)
  await flush()
  assert.equal(context.sources.length, 1)
  assert.equal(audio.activeLoopCount, 1)
  preview.stop(); preview.stop()
  assert.equal(context.sources[0].stops, 0)
  first.stop()
  assert.equal(context.sources[0].stops, 1)
  const next = acquireRingtone(audio, 'godot', 1) // released: a new choice can now play
  await flush()
  assert.equal(context.sources.length, 2)
  next.stop()
})

test('preview starts, stops on demand, auto-stops after the bound, and is idempotent', async (t) => {
  const { audio, context } = setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let ended = 0
  const stop = previewRingtone(audio, 'godot', 0.5, () => ended++)
  await flush()
  assert.equal(audio.activeLoopCount, 1)
  stop(); stop()
  assert.equal(ended, 1)
  assert.equal(context.sources[0].stops, 1)
  const auto = previewRingtone(audio, 'wellington', 0.5, () => ended++)
  await flush()
  t.mock.timers.tick(RINGTONE_PREVIEW_MAX_MS - 1)
  assert.equal(audio.activeLoopCount, 1)
  t.mock.timers.tick(1)
  assert.equal(audio.activeLoopCount, 0)
  assert.equal(ended, 2)
  auto()
  assert.equal(ended, 2)
})

test('stopping (unmount) during pending decode never starts a late preview', async (t) => {
  const { audio, context } = setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const stop = previewRingtone(audio, 'godot', 1)
  stop()
  await flush()
  assert.equal(context.sources.length, 0)
  assert.equal(audio.activeLoopCount, 0)
})
