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
  assert.equal(SFX_NAMES.length, 8)
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
  const long = 'This is a rather long sentence that needs more than one page. '.repeat(5)
  const { performance } = parseChatResponse(body([seg({ text: long, sfx: 'shock', reaction: 'shocked' }), seg({ text: 'Okay.' })]))
  const lines = timelineToLines(performance, layout)
  assert.ok(lines.length > 2)
  assert.equal(lines[0].sfx, 'shock')
  assert.equal(lines[0].reaction, 'shocked')
  assert.ok(lines.slice(1).every((l) => !l.sfx))
})

test('a normal reply carries no sfx', () => {
  const { performance } = parseChatResponse(body([seg({})]))
  assert.ok(timelineToLines(performance, layout).every((l) => !l.sfx))
})
