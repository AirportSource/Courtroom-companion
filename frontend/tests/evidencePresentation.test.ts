import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EvidenceDraft } from '../src/evidence/evidence.ts'
import { EvidencePresentationLifetime } from '../src/evidence/presentationLifetime.ts'

const photo = (name: string): EvidenceDraft => ({ name, size: 12, kind: 'image', data: 'encoded-bytes', previewUrl: `blob:${name}` })

test('submitted image stays available during waiting, is released at reply, and is absent from unrelated turns', () => {
  const released: EvidenceDraft[] = []
  const lifetime = new EvidencePresentationLifetime((draft) => released.push(draft))
  const image = photo('first.png')
  assert.equal(lifetime.begin('turn-1', image), image)
  assert.deepEqual(released, [])
  assert.equal(lifetime.finish('turn-1'), true)
  assert.deepEqual(released, [image])
  assert.equal(lifetime.begin('turn-2', null), null)
  assert.equal(lifetime.finish('turn-2'), false)
  assert.deepEqual(released, [image])
  // Releasing the local thumbnail never destroys the request/history payload.
  assert.equal(image.data, 'encoded-bytes')
})

test('a stale request completion cannot revoke a replacement turn preview', () => {
  const released: EvidenceDraft[] = []
  const lifetime = new EvidencePresentationLifetime((draft) => released.push(draft))
  const first = photo('first.png'), next = photo('next.png')
  lifetime.begin('first', first)
  lifetime.begin('next', next)
  assert.deepEqual(released, [first])
  assert.equal(lifetime.finish('first'), false)
  assert.deepEqual(released, [first])
  assert.equal(lifetime.finish('next'), true)
  assert.deepEqual(released, [first, next])
})

test('error/cancel completion and navigation cleanup are idempotent and leave pending files alone', () => {
  const released: EvidenceDraft[] = []
  const lifetime = new EvidencePresentationLifetime((draft) => released.push(draft))
  const pending = photo('pending.png')
  const submitted = photo('submitted.png')
  lifetime.begin('failed-or-cancelled', submitted)
  assert.equal(lifetime.finish('failed-or-cancelled'), true)
  assert.equal(lifetime.finish('failed-or-cancelled'), false)
  lifetime.clear()
  assert.deepEqual(released, [submitted])
  // A chip waiting for a future send is not owned by the active presentation.
  assert.ok(!released.includes(pending))
  lifetime.begin('navigation', pending)
  assert.deepEqual(released, [submitted])
  lifetime.clear()
  lifetime.clear()
  assert.deepEqual(released, [submitted, pending])
})
