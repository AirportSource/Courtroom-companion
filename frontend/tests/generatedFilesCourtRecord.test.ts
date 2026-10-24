import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { GeneratedArtifact } from '../src/artifacts/artifacts.ts'
import { GENERATED_GRID, generatedMove, generatedPageCount, orderedGeneratedFiles } from '../src/courtRecord/generatedFiles.ts'

function file(id: string, createdAt = '2026-10-24T12:00:00Z'): GeneratedArtifact {
  return { id: id.repeat(32), displayName: `report_${id}.py`, extension: 'py', mimeType: 'text/x-python',
    createdAt, sizeBytes: 24, status: 'ready', contentPreview: 'print("hello")' }
}

test('generated slots use creation time with an ID tie-break and never mutate the API list', () => {
  const a = file('a'), b = file('b'), older = file('c', '2026-10-24T12:30:00+01:00')
  const input = [b, a, older]
  assert.deepEqual(orderedGeneratedFiles(input).map((record) => record.id), [older.id, a.id, b.id])
  assert.deepEqual(input, [b, a, older])
  assert.deepEqual(orderedGeneratedFiles([b, older, a]).map((record) => record.id), [older.id, a.id, b.id])
  assert.deepEqual(orderedGeneratedFiles([]), [])
})

test('each valid artifact has one slot; duplicate IDs and unsafe metadata cannot create slots', () => {
  const valid = file('a')
  const missing = { ...file('b'), status: 'missing' as const }
  assert.deepEqual(orderedGeneratedFiles([valid, valid, missing]), [valid, missing])
  assert.deepEqual(orderedGeneratedFiles([{ ...valid, displayName: '../private/file.py' }]), [])
  assert.deepEqual(orderedGeneratedFiles([{ ...valid, id: 'thinker_statue' }]), [])
})

test('navigation crosses pages deterministically and clamps partial or empty pages', () => {
  assert.equal(GENERATED_GRID.cell, 64)
  assert.equal(GENERATED_GRID.columns * GENERATED_GRID.rows, GENERATED_GRID.pageSize)
  assert.deepEqual([0, 1, 6, 7, 13].map(generatedPageCount), [1, 1, 1, 2, 3])
  assert.equal(generatedMove(5, 13, 'ArrowRight'), 6)
  assert.equal(generatedMove(8, 13, 'ArrowDown'), 11)
  assert.equal(generatedMove(11, 13, 'ArrowDown'), 11)
  assert.equal(generatedMove(8, 13, 'PageUp'), 2)
  assert.equal(generatedMove(8, 13, 'PageDown'), 12)
  assert.equal(generatedMove(12, 13, 'ArrowRight'), 12)
  assert.equal(generatedMove(0, 13, 'ArrowLeft'), 0)
  assert.equal(generatedMove(0, 0, 'PageDown'), 0)
  assert.equal(generatedMove(8, 13, 'Home'), 0)
  assert.equal(generatedMove(8, 13, 'End'), 12)
  assert.equal(generatedMove(30, 13, 'unknown'), 12)
})

test('the DS inspector keeps generated text inert and uses opaque-ID artifact APIs', () => {
  const view = readFileSync(new URL('../src/courtRecord/GeneratedFilesCourtRecord.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/courtRecord/generated-files-court-record.css', import.meta.url), 'utf8')
  assert.match(view, /aria-label="Artifact text preview"/)
  assert.match(view, /readArtifact\(id\)/)
  assert.match(view, /deleteArtifact\(id\)/)
  assert.match(view, /artifactDownloadUrl\(inspected.id\)/)
  assert.match(view, /download=\{inspected.displayName\}/)
  assert.doesNotMatch(view, /dangerouslySetInnerHTML|eval\(|new Function|window\.open|createObjectURL|courtRecord\.ts|entriesOfType/)
  assert.match(css, /width: 256px/)
  assert.match(css, /height: 192px/)
  assert.match(css, /image-rendering: pixelated/)
})
