import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EVIDENCE_LIMITS, evidenceBadge, evidenceKind, evidenceProblem, formatSize, toBase64 } from '../src/evidence/evidence.ts'
import { generationFailureMessage } from '../src/engine/generation.ts'

test('evidence kind is guessed from MIME type or extension', () => {
  assert.equal(evidenceKind({ name: 'photo.JPG', type: '' }), 'image')
  assert.equal(evidenceKind({ name: 'x', type: 'image/webp' }), 'image')
  assert.equal(evidenceKind({ name: 'contract.pdf', type: '' }), 'pdf')
  assert.equal(evidenceKind({ name: 'main.py', type: 'text/x-python' }), 'text')
  assert.equal(evidenceKind({ name: 'notes', type: '' }), 'text') // the server checks the bytes
  for (const name of ['a.zip', 'report.docx', 'song.mp3', 'scan.bmp', 'logo.svg']) assert.equal(evidenceKind({ name, type: '' }), null, name)
  assert.equal(evidenceKind({ name: 'x.heic', type: 'image/heic' }), null)
})

test('size limits and problems mirror the backend', () => {
  assert.equal(evidenceProblem({ name: 'a.txt', type: 'text/plain', size: 10 }), null)
  assert.match(evidenceProblem({ name: 'a.txt', type: '', size: 0 }) ?? '', /empty/)
  assert.match(evidenceProblem({ name: 'big.png', type: 'image/png', size: EVIDENCE_LIMITS.image + 1 }) ?? '', /image is too large \(limit: 5 MB\)/)
  assert.match(evidenceProblem({ name: 'big.pdf', type: '', size: EVIDENCE_LIMITS.pdf + 1 }) ?? '', /PDF is too large/)
  assert.match(evidenceProblem({ name: 'big.md', type: '', size: EVIDENCE_LIMITS.text + 1 }) ?? '', /100,000 characters/)
  assert.match(evidenceProblem({ name: 'a.zip', type: '', size: 10 }) ?? '', /Unsupported file/)
})

test('base64 encoding matches Buffer for small and chunked inputs', () => {
  for (const length of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 * 3 + 7]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256)
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'), `length ${length}`)
  }
})

test('badges and sizes', () => {
  assert.equal(evidenceBadge('pdf', 'x.pdf'), 'PDF')
  assert.equal(evidenceBadge('text', 'main.py'), 'PY')
  assert.equal(evidenceBadge('text', 'README'), 'TXT')
  assert.equal(evidenceBadge('image', 'a.png'), 'IMG')
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(2048), '2 KB')
  assert.equal(formatSize(3 * 1024 * 1024), '3.0 MB')
})

test('a model that cannot read the file gets an explicit message', () => {
  assert.match(generationFailureMessage('attachment_unsupported') ?? '', /cannot read this file/)
})
