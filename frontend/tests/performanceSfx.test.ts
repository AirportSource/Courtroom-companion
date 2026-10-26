import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dialogueLineWidths, gridMeasure, type TextLayout } from '../src/engine/dialogueLayout.ts'
import { parseChatResponse, SFX_NAMES, sfxEventId, timelineToLines } from '../src/engine/performance.ts'

const layout: TextLayout = { measure: gridMeasure(8, 5), lineWidths: dialogueLineWidths(), locale: 'en' }
const seg = (over: Record<string, unknown>) => ({
  text: 'Hi.',
  emotion: 'neutral',
  animation: 'neutral_front',
  intensity: 0.5,
  reaction: null,
  gesture: null,
  estimatedMs: 0,
  ...over,
})
const body = (segments: unknown[]) => ({ performance: { characterId: 'c', segments, settle: {}, notes: [] } })

test('closed sfx set maps to audio events', () => {
  assert.equal(SFX_NAMES.length, 11)
  assert.equal(sfxEventId('shock'), 'sfx_shock')
})

test('parseChatResponse accepts known sfx and nulls unknown or malformed ones', () => {
  const r = parseChatResponse(body([seg({ sfx: 'shock' }), seg({ sfx: 'explosion' }), seg({ sfx: 3 }), seg({})]))
  assert.deepEqual(
    r.performance.segments.map((s) => s.sfx),
    ['shock', null, null, null],
  )
})

test('sfx lands only on the first page of a paginated segment', () => {
  const sentence = 'This is a rather long sentence that needs more than one page. '
  let lines: ReturnType<typeof timelineToLines> = []
  for (let repeats = 1; repeats <= 8; repeats += 1) {
    const { performance } = parseChatResponse(body([seg({ text: sentence.repeat(repeats), sfx: 'shock', reaction: 'shocked' })]))
    lines = timelineToLines(performance, layout)
    if (lines.length === 3) break
  }
  assert.equal(lines.length, 3, 'fixture should occupy exactly three pages')
  assert.equal(lines[0].sfx, 'shock')
  assert.equal(lines[0].reaction, 'shocked')
  assert.deepEqual(lines.map((line) => line.sfx), ['shock', null, null])
})

test('a normal reply carries no sfx', () => {
  const { performance } = parseChatResponse(body([seg({})]))
  assert.ok(timelineToLines(performance, layout).every((l) => !l.sfx))
})
