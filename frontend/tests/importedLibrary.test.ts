// Imported-music client and resolver: pre-checks, error mapping, parsing and caching (fake fetch).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createImportApi, loopRequestBody, parseServerLoop, parseTrackRecord, precheckFile, testDecode } from '../src/music/imported/importApi.ts'
import { createImportedResolver } from '../src/music/imported/importedResolver.ts'
import type { LoopMetadata } from '../src/music/types.ts'

const ID = 'a'.repeat(32)
const OTHER = 'b'.repeat(32)

const serverRecord = (id = ID, overrides: Record<string, unknown> = {}) => ({
  id, title: 'Theme', format: 'ogg', mime: 'audio/ogg', sizeBytes: 100, createdAt: '2026-01-01T00:00:00+00:00', available: true,
  loop: { region: { startSample: 44100, endSample: 441000, sampleRate: 44100 }, confidence: 0.7, provenance: 'user-accepted' },
  ...overrides,
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Call = { url: string; init: RequestInit }
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

test('precheck accepts supported audio and rejects the rest before any upload', () => {
  assert.equal(precheckFile({ name: 'Song.MP3', size: 1000, type: 'audio/mpeg' }), null)
  assert.equal(precheckFile({ name: 'a.flac', size: 1000, type: '' }), null)
  assert.equal(precheckFile({ name: 'a.ogg', size: 1000, type: 'application/ogg' }), null)
  assert.equal(precheckFile({ name: 'a.exe', size: 1000, type: 'audio/mpeg' })?.code, 'unsupported_codec')
  assert.equal(precheckFile({ name: 'a', size: 1000, type: '' })?.code, 'unsupported_codec')
  assert.equal(precheckFile({ name: 'a.mp3', size: 1000, type: 'text/html' })?.code, 'unsupported_codec')
  assert.equal(precheckFile({ name: 'a.mp3', size: 0, type: '' })?.code, 'decode_failed')
  assert.match(precheckFile({ name: 'a.mp3', size: 65 * 1024 * 1024, type: '' })?.message ?? '', /64 MB/)
})

test('test-decode reports decode failures and explains a FLAC without browser support', async () => {
  const audio = { arrayBuffer: async () => new ArrayBuffer(8), name: 'a.mp3' } as unknown as Blob & { name: string }
  const buffer = { duration: 1 } as AudioBuffer
  const ok = await testDecode(audio, { decodeAudioData: async () => buffer })
  assert.ok(ok.ok && ok.value === buffer)
  const bad = await testDecode(audio, { decodeAudioData: async () => Promise.reject(new Error('x')) })
  assert.ok(!bad.ok && bad.error.code === 'decode_failed')
  const flac = { arrayBuffer: async () => new ArrayBuffer(8), name: 'a.flac' } as unknown as Blob & { name: string }
  const noFlac = await testDecode(flac, { decodeAudioData: async () => Promise.reject(new Error('x')), canPlayType: () => '' })
  assert.ok(!noFlac.ok && noFlac.error.code === 'unsupported_codec')
  const unreadable = await testDecode({ arrayBuffer: async () => Promise.reject(new Error('io')) } as unknown as Blob, { decodeAudioData: async () => buffer })
  assert.ok(!unreadable.ok && unreadable.error.code === 'decode_failed')
})

test('server errors map to the shared error codes and never throw', async () => {
  const cases: [number, string][] = [[404, 'missing_file'], [413, 'unknown'], [415, 'unsupported_codec'], [422, 'invalid_loop'], [403, 'network'], [503, 'unavailable'], [500, 'network']]
  for (const [status, code] of cases) {
    const { fetcher } = fakeFetch(() => jsonResponse({ detail: 'nope' }, status))
    const result = await createImportApi(fetcher).list()
    assert.ok(!result.ok && result.error.code === code, `${status} -> ${code}`)
  }
  const offline = await createImportApi((async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch).list()
  assert.ok(!offline.ok && offline.error.code === 'network')
  const controller = new AbortController()
  controller.abort()
  const aborted = await createImportApi((async () => Promise.reject(new DOMException('x', 'AbortError'))) as unknown as typeof fetch).list(controller.signal)
  assert.ok(!aborted.ok && aborted.error.code === 'aborted')
  const garbage = await createImportApi(fakeFetch(() => new Response('<html>', { status: 200 })).fetcher).list()
  assert.ok(!garbage.ok && garbage.error.code === 'network')
})

test('list drops malformed records and sanitises loops', async () => {
  const { fetcher } = fakeFetch(() => jsonResponse({ tracks: [serverRecord(), { id: '../x', title: 'bad', format: 'mp3' }, serverRecord(OTHER, { loop: { region: { startSample: 5, endSample: 1, sampleRate: 44100 }, provenance: 'user-accepted' } })] }))
  const result = await createImportApi(fetcher).list()
  assert.ok(result.ok)
  assert.equal(result.value.length, 2)
  assert.equal(result.value[0]!.loop?.provenance, 'user-accepted')
  assert.deepEqual(result.value[1]!.loop, { region: null, confidence: null, provenance: 'none' }, 'an invalid stored loop becomes no loop')
  assert.equal(parseTrackRecord(null), null)
  assert.equal(parseServerLoop(undefined), null)
})

test('upload sends the raw file with an encoded name header and no multipart', async () => {
  const { fetcher, calls } = fakeFetch(() => jsonResponse(serverRecord(), 201))
  const file = new File([new Uint8Array([1, 2, 3])], 'Mon morceau é.mp3', { type: 'audio/mpeg' })
  const result = await createImportApi(fetcher).upload(file)
  assert.ok(result.ok && result.value.id === ID)
  const { url, init } = calls[0]!
  assert.equal(url, '/api/music/imports')
  assert.equal(init.method, 'POST')
  assert.equal(init.body, file)
  const headers = init.headers as Record<string, string>
  assert.equal(decodeURIComponent(headers['X-Filename']!), 'Mon morceau é.mp3')
  assert.equal(headers['Content-Type'], 'application/octet-stream')
  const rejected = await createImportApi(fakeFetch(() => jsonResponse({ detail: 'Unsupported audio.' }, 415)).fetcher).upload(file)
  assert.ok(!rejected.ok && rejected.error.code === 'unsupported_codec' && rejected.error.message === 'Unsupported audio.')
})

test('loop persistence body matches the server contract', async () => {
  const accepted: LoopMetadata = { region: { startSample: 10, endSample: 99999, sampleRate: 44100, crossfadeMs: 12 }, confidence: 0.9, provenance: 'user-accepted', note: 'n' }
  assert.deepEqual(loopRequestBody(accepted), { provenance: 'user-accepted', startSample: 10, endSample: 99999, sampleRate: 44100, crossfadeMs: 12, confidence: 0.9, note: 'n' })
  assert.deepEqual(loopRequestBody({ region: null, confidence: null, provenance: 'none' }), { provenance: 'none' })
  const { fetcher, calls } = fakeFetch(() => jsonResponse(serverRecord()))
  await createImportApi(fetcher).saveLoop(ID, accepted)
  assert.equal(calls[0]!.url, `/api/music/imports/${ID}/loop`)
  assert.equal(calls[0]!.init.method, 'PUT')
  await createImportApi(fetcher).rename(ID, 'New')
  assert.equal(calls[1]!.init.method, 'PATCH')
  const removed = await createImportApi(fakeFetch(() => new Response(null, { status: 204 })).fetcher).remove(ID)
  assert.ok(removed.ok)
  assert.equal(createImportApi().audioUrl(ID), `/api/music/imports/${ID}/audio`)
})

test('resolver builds imported tracks from persisted loops and caches the library', async () => {
  const { fetcher, calls } = fakeFetch(() => jsonResponse({ tracks: [serverRecord(), serverRecord(OTHER, { available: false })] }))
  const api = createImportApi(fetcher)
  let clock = 0
  const resolver = createImportedResolver(api, 1000, () => clock)
  const signal = new AbortController().signal
  const track = await resolver.resolve(ID, signal)
  assert.ok(track)
  assert.equal(track.source, 'imported')
  assert.equal(track.url, `/api/music/imports/${ID}/audio`)
  assert.equal(track.title, 'Theme')
  assert.equal(track.loop.provenance, 'user-accepted')
  assert.deepEqual(track.loop.region, { startSample: 44100, endSample: 441000, sampleRate: 44100 })
  assert.equal(calls.length, 1)
  await resolver.resolve(ID, signal)
  assert.equal(calls.length, 1, 'cached')
  assert.equal(await resolver.resolve(OTHER, signal), null, 'a missing file is not playable')
  assert.equal(calls.length, 1, 'a known but unavailable track needs no refresh')
  assert.equal(await resolver.resolve('c'.repeat(32), signal), null)
  assert.equal(calls.length, 2, 'an unknown id triggers one refresh')
  clock = 5000
  await resolver.resolve(ID, signal)
  assert.equal(calls.length, 3, 'stale cache refreshes')
  resolver.invalidate()
  await resolver.resolve(ID, signal)
  assert.equal(calls.length, 4)
})

test('resolver never throws: backend down, bad list, unknown id', async () => {
  const down = createImportedResolver(createImportApi((async () => Promise.reject(new Error('down'))) as unknown as typeof fetch))
  assert.equal(await down.resolve(ID, new AbortController().signal), null)
  const empty = createImportedResolver(createImportApi(fakeFetch(() => jsonResponse({ tracks: [] })).fetcher))
  assert.equal(await empty.resolve(ID, new AbortController().signal), null)
  const noLoop = createImportedResolver(createImportApi(fakeFetch(() => jsonResponse({ tracks: [serverRecord(ID, { loop: null })] })).fetcher))
  const track = await noLoop.resolve(ID, new AbortController().signal)
  assert.deepEqual(track?.loop, { region: null, confidence: null, provenance: 'none' })
})
