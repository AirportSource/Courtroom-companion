import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { GeneratedArtifact } from '../src/artifacts/artifacts.ts'
import {
  clearConversationRecord, deleteConversationRecord, deleteConversationRecords, getConversationRecord,
  listConversationRecord, parseConversationRecordEntry, parseConversationRecordList,
} from '../src/conversationRecord/api.ts'
import {
  DETAIL_LINE_HEIGHT, entryLabel, formatEntryDate, mapFileAvailability, maxScrollTop, orderedEntries,
  recordPageCount, recordPageOf, scrollByLines, selectionAfterDelete, wheelLines,
} from '../src/conversationRecord/conversationRecord.ts'

const art = (c: string) => c.repeat(32)
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, characterId: 'maya', createdAt: '2026-10-24T12:30:00Z',
  userText: 'hello', assistantText: 'hi there', artifactIds: [], ...extra })
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const mockFetch = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  globalThis.fetch = ((url: string, init?: RequestInit) => Promise.resolve(impl(String(url), init))) as typeof fetch
}

test('entry parsing is defensive and bounds artifact ids', () => {
  assert.deepEqual(parseConversationRecordEntry(entry('a1', { artifactIds: [art('a'), 'bad', 7] }))?.artifactIds, [art('a')])
  assert.equal(parseConversationRecordEntry(entry('../x')), null)
  assert.equal(parseConversationRecordEntry(entry('a1', { createdAt: 'nope' })), null)
  assert.equal(parseConversationRecordEntry(entry('a1', { userText: 5 })), null)
  assert.equal(parseConversationRecordEntry(null), null)
  assert.equal(parseConversationRecordEntry(entry('a1', { userText: 'x'.repeat(30000) }))?.userText.length, 20000)
})

test('list parsing keeps server order, drops invalid entries and repeated ids', () => {
  const list = parseConversationRecordList({ entries: [entry('b'), { junk: true }, entry('a'), entry('b')] })
  assert.deepEqual(list?.map((item) => item.id), ['b', 'a'])
  assert.equal(parseConversationRecordList({}), null)
  assert.equal(parseConversationRecordList(null), null)
})

test('API client never throws: network errors, bad status and bad JSON become results', async () => {
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  assert.deepEqual(await listConversationRecord(), { ok: false, error: 'unavailable' })
  assert.deepEqual(await deleteConversationRecord('a'), { ok: false, error: 'unavailable' })
  mockFetch(() => new Response('not json', { status: 200 }))
  assert.deepEqual(await listConversationRecord(), { ok: false, error: 'unavailable' })
  mockFetch(() => new Response('', { status: 500 }))
  assert.deepEqual(await getConversationRecord('a'), { ok: false, error: 'unavailable' })
  mockFetch(() => new Response('', { status: 404 }))
  assert.deepEqual(await getConversationRecord('a'), { ok: false, error: 'missing' })
  assert.deepEqual(await getConversationRecord('../etc'), { ok: false, error: 'unavailable' })
})

test('API client uses the contract routes', async () => {
  const calls: string[] = []
  mockFetch((url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return init?.method === 'DELETE' ? new Response(null, { status: 204 })
      : url.endsWith('/conversation-record') ? new Response(JSON.stringify({ entries: [entry('a')] }))
        : new Response(JSON.stringify(entry('a')))
  })
  assert.equal((await listConversationRecord()).ok, true)
  assert.equal((await getConversationRecord('a')).ok, true)
  assert.deepEqual(await deleteConversationRecord('a'), { ok: true, value: true })
  assert.deepEqual(calls, ['GET /api/conversation-record', 'GET /api/conversation-record/a', 'DELETE /api/conversation-record/a'])
})

test('ordering is stable (newest first as returned) and paging is by six', () => {
  const input = [entry('c'), entry('a'), entry('b'), entry('a')].map((e) => parseConversationRecordEntry(e)!)
  assert.deepEqual(orderedEntries(input).map((e) => e.id), ['c', 'a', 'b'])
  assert.deepEqual([0, 1, 6, 7, 13].map(recordPageCount), [1, 1, 1, 2, 3])
  assert.deepEqual([0, 5, 6, 12].map(recordPageOf), [0, 0, 1, 2])
  assert.equal(selectionAfterDelete(3, 4), 2)
  assert.equal(selectionAfterDelete(0, 4), 0)
  assert.equal(selectionAfterDelete(0, 1), 0)
})

test('labels are locale-independent', () => {
  assert.equal(formatEntryDate('2026-10-24T12:30:00+01:00'), '2026-10-24 11:30')
  assert.equal(entryLabel({ createdAt: '2026-10-24T12:30:00Z', userText: '\n  こんにちは\nsecond' }), '2026-10-24 12:30 · こんにちは')
  assert.equal(formatEntryDate('bad'), '')
})

test('file availability marks missing or unavailable artifacts', () => {
  const ready = { id: art('a'), displayName: 'a.txt', status: 'ready' } as GeneratedArtifact
  const gone = { id: art('b'), displayName: 'b.txt', status: 'missing' } as GeneratedArtifact
  assert.deepEqual(mapFileAvailability([art('a'), art('b'), art('c')], [ready, gone]), [
    { id: art('a'), name: 'a.txt', available: true },
    { id: art('b'), name: null, available: false },
    { id: art('c'), name: null, available: false },
  ])
  assert.deepEqual(mapFileAvailability([art('a')], null), [{ id: art('a'), name: null, available: true }])
})

test('detail scrolling moves in whole lines and clamps', () => {
  const lh = DETAIL_LINE_HEIGHT
  assert.equal(maxScrollTop(100, 120), 0)
  const max = maxScrollTop(250, 120) // 130 px overflow rounds up to whole lines
  assert.equal(max, Math.ceil(130 / lh) * lh)
  assert.equal(scrollByLines(0, 1, max), lh)
  assert.equal(scrollByLines(lh + 2, 1, max), lh * 2) // snaps a sub-line offset to the grid first
  assert.equal(scrollByLines(max - lh, 5, max), max)
  assert.equal(scrollByLines(0, -3, max), 0)
  assert.equal(scrollByLines(0, 3, 0), 0)
  assert.deepEqual([-120, 0, 3].map(wheelLines), [-1, 0, 1])
})

test('bulk delete and delete all use their routes and never throw', async () => {
  const calls: { method: string; url: string; body: unknown }[] = []
  mockFetch((url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return init?.method === 'POST' ? new Response(JSON.stringify({ deleted: 2 })) : new Response(null, { status: 204 })
  })
  assert.deepEqual(await deleteConversationRecords(['a', 'b']), { ok: true, value: 2 })
  assert.deepEqual(await clearConversationRecord(), { ok: true, value: true })
  assert.deepEqual(calls, [
    { method: 'POST', url: '/api/conversation-record/delete', body: { ids: ['a', 'b'] } },
    { method: 'DELETE', url: '/api/conversation-record', body: { confirm: true } },
  ])
  // Nothing to send, or an invalid id: refused locally without a request.
  assert.deepEqual(await deleteConversationRecords([]), { ok: false, error: 'unavailable' })
  assert.deepEqual(await deleteConversationRecords(['../x']), { ok: false, error: 'unavailable' })
  assert.equal(calls.length, 2)
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  assert.deepEqual(await deleteConversationRecords(['a']), { ok: false, error: 'unavailable' })
  assert.deepEqual(await clearConversationRecord(), { ok: false, error: 'unavailable' })
})
