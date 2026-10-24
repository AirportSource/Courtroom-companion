import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { artifactDownloadUrl, cancelTurn, deleteArtifact, listArtifacts, parseArtifact, parseTurnTask, readArtifact, watchTurn } from '../src/artifacts/artifacts.ts'
import { ChatError, parseChatResponse, sendChat, timelineToLines } from '../src/engine/performance.ts'
import { nextPhase } from '../src/engine/presentation.ts'

const id = 'a'.repeat(32)
const turnId = 'b'.repeat(32)
const artifact = { id, displayName: 'hello_maya.py', extension: 'py', mimeType: 'text/x-python',
  createdAt: '2026-10-24T12:00:00+00:00', sizeBytes: 25, status: 'ready', contentPreview: 'print("Hello from Maya")\n' }
const task = { id: turnId, state: 'artifact-ready', cue: 'artifact_ready', artifactId: id, error: null, cues: ['artifact_working', 'artifact_ready'] }
const performance = { characterId: 'maya_fey', segments: [
  { text: 'All done! Your file is ready below.', emotion: 'happy', animation: 'smile_front', intensity: .4, reaction: null, gesture: null, estimatedMs: 1000 },
], settle: { emotion: 'happy', animation: 'smile_front' }, notes: [] }
const response = { performance, provider: { type: 'fake', model: 'fake' }, warnings: [], task, artifacts: [artifact] }
const json = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem: () => {} },
} })

test('artifact metadata is bounded and URLs can only address opaque local IDs', () => {
  assert.deepEqual(parseArtifact(artifact), artifact)
  assert.equal(artifactDownloadUrl(id), `/api/artifacts/${id}/download`)
  for (const bad of ['../../evil.py', 'https://evil.example', 'C:\\evil.py', 'hello_maya.py']) assert.throws(() => artifactDownloadUrl(bad))
  for (const overrides of [{ id: '../evil' }, { displayName: '../evil.py' }, { extension: 'html' }, { sizeBytes: 65537 }, { createdAt: 'not-a-date' }]) {
    assert.equal(parseArtifact({ ...artifact, ...overrides }), null)
  }
  assert.equal(parseArtifact({ ...artifact, displayName: 'こんにちは.py' })?.displayName, 'こんにちは.py')
})

test('ready requires an actual artifact; failed and normal tasks cannot retain ready cues', () => {
  assert.equal(parseTurnTask({ ...task, artifactId: null }), null)
  const failed = parseTurnTask({ ...task, state: 'failed', error: 'artifact_creation_failed' })!
  assert.equal(failed.artifactId, null)
  assert.equal(failed.cue, null)
  assert.deepEqual(failed.cues, ['artifact_working'])
  assert.equal(parseTurnTask({ ...task, state: 'idle' })?.cues.includes('artifact_ready'), false)
  assert.throws(() => parseChatResponse({ ...response, artifacts: [] }), /metadata was missing/)
  const parsed = parseChatResponse(response)
  assert.equal(parsed.task?.artifactId, id)
  assert.equal(timelineToLines(parsed.performance, { lineWidths: [241, 241, 233], measure: (text) => text.length * 8 }).map((line) => line.text).join(' ').includes('print('), false)
  assert.equal(nextPhase(nextPhase(nextPhase('input', 'submit'), 'response'), 'finished'), 'input')
})

test('list/read/delete handle local data and missing files without interpreting text', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls: string[] = []
  const text = '<script>throw new Error("MUST NOT RUN")</script>\nprint("text only")'
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return String(url).endsWith('/content') ? json({ id, content: text }) : json({ artifacts: [artifact, { id: '../bad' }] })
  }
  assert.deepEqual(await listArtifacts(), [artifact])
  assert.equal(await readArtifact(id), text)
  await deleteArtifact(id)
  const before = calls.length
  await assert.rejects(readArtifact('../../outside'))
  assert.equal(calls.length, before)
  globalThis.fetch = async () => json({}, 404)
  await assert.rejects(readArtifact(id), /missing/)
  const panel = readFileSync(new URL('../src/artifacts/ArtifactPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /<pre aria-label="Artifact text preview">/)
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|eval\(|new Function|window\.open|createObjectURL/)
})

test('status polling tolerates the pre-POST 404 and stops on a terminal result', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let count = 0
  globalThis.fetch = async () => ++count === 1 ? json({}, 404) : json(task)
  const states: string[] = []
  await watchTurn(turnId, new AbortController().signal, (state) => states.push(state.state), 1)
  assert.deepEqual(states, ['artifact-ready'])
  assert.equal(count, 2)
  const abort = new AbortController()
  abort.abort()
  await watchTurn(turnId, abort.signal, () => assert.fail('stale callback'), 1)
  assert.equal(count, 2)
})

test('one chat POST delivers working/ready metadata and the final response once', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let posts = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('provider-profiles')) return json({ migrationWarnings: [] })
    if (String(url).includes('/turns/')) return json({ ...task, state: 'working', cue: 'artifact_working', artifactId: null, cues: ['artifact_working'] })
    posts++
    await new Promise((resolve) => setTimeout(resolve, 10))
    return json(response)
  }
  const observed: string[] = []
  const result = await sendChat({ character: 'maya_fey', message: 'Make a file', sessionId: 'test', requestId: turnId }, 2000,
    { onTask: (state) => observed.push(state.state) })
  assert.equal(posts, 1)
  assert.ok(observed.includes('working'))
  assert.equal(observed.at(-1), 'artifact-ready')
  assert.equal(result.performance.segments[0].text, 'All done! Your file is ready below.')
  assert.equal(result.artifacts?.[0].displayName, 'hello_maya.py')
})

test('cancellation aborts the request and asks the backend to stop without a ready state', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const external = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  let posts = 0, cancellations = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('provider-profiles')) return json({ migrationWarnings: [] })
    if (String(url).includes('/turns/')) {
      if (init?.method === 'DELETE') cancellations++
      return json({ ...task, state: 'failed', cue: null, artifactId: null, error: 'cancelled', cues: [] })
    }
    posts++; started()
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  }
  const pending = sendChat({ character: 'maya_fey', message: 'Make a file', sessionId: 'test', requestId: turnId }, 2000, { signal: external.signal })
  await ready
  external.abort()
  await assert.rejects(pending, (error) => error instanceof ChatError && error.cancelled)
  assert.equal(posts, 1)
  assert.equal(cancellations, 1)
  assert.equal(await cancelTurn('invalid-id'), null)
  assert.equal(nextPhase('waiting', 'cancel'), 'input')
})
